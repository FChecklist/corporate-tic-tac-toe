// The internal audit log: sealed at rest, hash-chained, owner-only, every owner use logged, AI provenance, deletion certificate and legal hold.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { analyzeChain, classify, maskedAggregate, redact, vendorOfModel, vendorOfUa, loadRows, GENESIS } from "../src/audit";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const eng = (id: string) => ({ id, startRound: roundAt(T) + 1200, callSeconds: 6, cap: 100 });
const j = async (r: Response) => (await r.json()) as any;
const PLAT = { "x-organizer": "plat" };
const IP = "203.0.113.77", UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36";
const rows = (chain: string) => raw.prepare("SELECT * FROM audit_log WHERE chain=? ORDER BY seq").all(chain) as any[];

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "test-data-key" };
});
async function organizer() {
  const x = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" }));
  return { h: { "x-organizer": x.token as string, "cf-connecting-ip": IP, "user-agent": UA }, ai: x.aiKey as string };
}
async function withEngagement() {
  const o = await organizer();
  expect((await call("POST", "/api/z", eng("EVT1"), o.h)).status).toBe(200);
  expect((await call("PATCH", "/api/z/EVT1/settings", { cap: 80 }, o.h)).status).toBe(200);
  return o;
}

describe("what is recorded, and sealed", () => {
  test("a create and an edit are rows of the engagement's chain; the full IP, user agent and values are not readable in the database", async () => {
    await withEngagement();
    const r = rows("EVT1");
    expect(r.map((x) => x.event)).toEqual(["create", "edit"]); expect(r.map((x) => x.seq)).toEqual([1, 2]);
    expect(r[0].prev_hash).toBe(GENESIS); expect(r[1].prev_hash).toBe(r[0].row_hash);
    expect(r[0].actor).toBe("organizer"); expect(r[0].at_ms).toBe(T);
    const dump = JSON.stringify(raw.prepare("SELECT * FROM audit_log").all());
    expect(dump).not.toContain(IP); expect(dump).not.toContain("Chrome/120"); expect(dump).not.toContain('"cap"'); expect(r[0].sealed).toMatch(/^v1\./);
    const out = await j(await call("GET", "/api/owner/audit/EVT1", undefined, PLAT));
    const e = out.rows[1];
    expect(e.details.ip).toBe(IP); expect(e.details.ua).toBe(UA); expect(e.details.browser).toBe("Chrome"); expect(e.details.os).toBe("Windows");
    expect(e.details.changes).toEqual({ cap: 80 }); expect(e.details.server_utc).toBe(new Date(T).toISOString()); expect(e.corr.length).toBeGreaterThan(8);
  });
  test("client time, zone and skew are kept next to the server's clock, which is the authority", async () => {
    const o = await withEngagement();
    await call("PATCH", "/api/z/EVT1/settings", { cap: 70 }, { ...o.h, "x-cb-client-ms": String(T + 90_000), "x-cb-tz": "Asia/Kolkata" });
    const last = (await j(await call("GET", "/api/owner/audit/EVT1", undefined, PLAT))).rows.at(-1);
    expect(last.details.client).toEqual({ ms: T + 90_000, tz: "Asia/Kolkata", skew_ms: 90_000 }); expect(last.at_ms).toBe(T);
  });
  test("passwords, one-time codes, card data and keys never reach the log, even sealed", async () => {
    await call("POST", "/api/auth/verify", { email: "boss@acme.com", code: "424242" }, { "cf-connecting-ip": IP });
    expect(redact({ code: "1", otp: "2", password: "3", cardNumber: "4", apiKey: "5", ok: "fine", nested: { token: "x", n: 1 } })).toEqual({ code: "[redacted]", otp: "[redacted]", password: "[redacted]", cardNumber: "[redacted]", apiKey: "[redacted]", ok: "fine", nested: { token: "[redacted]", n: 1 } });
    const sys = (await j(await call("GET", "/api/owner/audit/sys", undefined, PLAT))).rows;
    expect(sys.some((x: any) => x.event === "login_failed")).toBe(true);
    expect(JSON.stringify(sys)).not.toContain("424242"); expect(JSON.stringify(sys)).toContain("[redacted]");
  });
  test("a join records the phone's raw device id sealed and its hash; the raw id is not in the clear", async () => {
    const o = await withEngagement();
    await call("POST", "/api/z/EVT1/publish", {}, o.h); // may be refused for an AI-less test; the join below only needs the engagement row
    const dev = "ab".repeat(16);
    raw.prepare("UPDATE engagement SET pack=100 WHERE id='EVT1'").run();
    await call("POST", "/api/z/EVT1/join", { phone: "9876543210", name: "Asha", device: dev }, { "cf-connecting-ip": "198.51.100.5", "user-agent": UA }, T);
    const jr = (await j(await call("GET", "/api/owner/audit/EVT1", undefined, PLAT))).rows.find((x: any) => x.event.startsWith("join"));
    expect(jr).toBeTruthy(); expect(jr.actor).toBe("participant"); expect(jr.details.device_id).toBe(dev); expect(jr.details.device_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(raw.prepare("SELECT * FROM audit_log").all())).not.toContain(dev);
  });
  test("classify names the events", () => {
    expect(classify("POST", "/api/z/EVT1/announce", 200, "organizer", {})?.event).toBe("announce");
    expect(classify("POST", "/api/z/EVT1/control/request", 200, "ai_key", { action: "pause" })?.event).toBe("pause");
    expect(classify("POST", "/api/z/EVT1/unbind", 200, "organizer", {})?.event).toBe("unbind");
    expect(classify("POST", "/api/z/EVT1/prizegiven", 200, "cohost", {})?.event).toBe("prize");
    expect(classify("GET", "/api/z/EVT1/results", 200, "participant", null)).toBeNull(); // plain reads by phones are not logged
    expect(classify("POST", "/api/lifecycle/tick", 200, "system", null)).toBeNull();
  });
});

describe("AI provenance", () => {
  test("an AI call records vendor from the program, the declared model/version/session/machine, a proof level and a mismatch flag", async () => {
    const o = await withEngagement();
    const key = o.ai;
    const hdr = { "user-agent": "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)", "cf-connecting-ip": "20.171.0.9" };
    // declared through the address (the work link), and the declared model belongs to ANOTHER vendor
    expect((await call("GET", `/ai/${key}/z/EVT1/summary?ai_model=claude-sonnet-5&ai_version=5.5&ai_session=chat-77&ai_machine=laptop-1`, undefined, hdr)).status).toBe(200);
    // declared through a POST body
    expect((await call("PATCH", `/ai/${key}/z/EVT1/settings`, { cap: 60, ai: { model: "gpt-5", version: "1", session: "s9", machine: "m2" } }, hdr)).status).toBe(200);
    // observed only (no declaration)
    await call("GET", `/ai/${key}/z/EVT1/summary`, undefined, hdr);
    // nothing to go on
    await call("GET", `/ai/${key}/z/EVT1/summary`, undefined, { "user-agent": "curl/8", "cf-connecting-ip": "20.171.0.9" });
    const ai = (await j(await call("GET", "/api/owner/audit/EVT1", undefined, PLAT))).rows.filter((x: any) => x.actor === "ai_key");
    expect(ai.length).toBe(4);
    expect(ai[0].proof).toBe("declared"); expect(ai[0].mismatch).toBe(true); expect(ai[0].ai_vendor).toBe("openai");
    expect(ai[0].details.ai.declared).toEqual({ model: "claude-sonnet-5", version: "5.5", session: "chat-77", machine: "laptop-1" });
    expect(ai[0].key_id).toMatch(/^[0-9a-f]{10}$/); expect(ai[0].details.ip).toBe("20.171.0.9");
    expect(ai[1].proof).toBe("declared"); expect(ai[1].mismatch).toBe(false); expect(ai[1].details.ai.declared.session).toBe("s9"); expect(ai[1].event).toBe("edit");
    expect(ai[2].proof).toBe("observed"); expect(ai[3].proof).toBe("inferred");
    expect(vendorOfUa("ClaudeBot")).toBe("anthropic"); expect(vendorOfModel("Gemini 2")).toBe("google"); expect(vendorOfModel("mystery")).toBeNull();
  });
  test("an AI key trying to publish, erase or pay is recorded as a denied attempt", async () => {
    const o = await withEngagement();
    for (const what of ["erase", "settle"]) expect([401, 403]).toContain((await call("POST", `/ai/${o.ai}/z/EVT1/${what}`, {}, { "user-agent": "curl/8" })).status);
    expect((await j(await call("GET", "/api/owner/audit/EVT1", undefined, PLAT))).rows.filter((x: any) => x.event === "ai_denied_attempt").length).toBe(2);
  });
});

describe("hash chain and tamper detection", () => {
  test("an intact chain verifies; a removed row, a changed row and a re-pointed row are each caught", async () => {
    await withEngagement(); await call("PATCH", "/api/z/EVT1/settings", { cap: 50 }, PLAT); await call("PATCH", "/api/z/EVT1/settings", { cap: 40 }, PLAT);
    const v = await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT));
    expect(v.ok).toBe(true); expect(v.rows).toBe(4); expect(v.headHash).toBe(rows("EVT1").at(-1).row_hash);
    // the table refuses UPDATE
    expect(() => raw.prepare("UPDATE audit_log SET event='x' WHERE seq=2").run()).toThrow(/append-only/);
    // someone with direct database access removes the trigger and edits
    raw.prepare("DROP TRIGGER audit_log_no_update").run();
    raw.prepare("UPDATE audit_log SET actor='system' WHERE chain='EVT1' AND seq=2").run();
    let b = await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT)); expect(b.ok).toBe(false); expect(b.brokenAtSeq).toBe(2); expect(b.reason).toMatch(/changed/);
    raw.prepare("UPDATE audit_log SET actor='organizer' WHERE chain='EVT1' AND seq=2").run();
    expect((await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT))).ok).toBe(true);
    raw.prepare("DELETE FROM audit_log WHERE chain='EVT1' AND seq=3").run();
    b = await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT)); expect(b.ok).toBe(false); expect(b.brokenAtSeq).toBe(4); expect(b.reason).toMatch(/missing/);
  });
  test("an edited sealed value is caught (the hash covers the ciphertext)", async () => {
    await withEngagement();
    raw.prepare("DROP TRIGGER audit_log_no_update").run();
    raw.prepare("UPDATE audit_log SET sealed='v1.AAAA.BBBB' WHERE chain='EVT1' AND seq=1").run();
    expect((await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT))).ok).toBe(false);
  });
  test("two writers racing for the same sequence number both land, in order", async () => {
    const o = await organizer();
    await call("POST", "/api/z", eng("EVT1"), o.h);
    await Promise.all([1, 2, 3].map((n) => call("PATCH", "/api/z/EVT1/settings", { cap: 90 + n }, o.h)));
    const r = rows("EVT1"); expect(r.map((x) => x.seq)).toEqual([1, 2, 3, 4]);
    expect((await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT))).ok).toBe(true);
  });
});

describe("only the owner reads it, and every owner use is logged", () => {
  test("organizer, AI key, co-host, a participant and a stranger get a plain 404 and each attempt is logged as denied", async () => {
    const o = await withEngagement();
    const host = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)); const hostKey = host.hostKey as string;
    for (const h of [o.h, { "x-organizer": o.ai }, { "x-organizer": hostKey }, {}, { "x-organizer": "wrong" }]) {
      for (const path of ["/api/owner/audit/EVT1", "/api/owner/audit/EVT1/verify", "/api/org/audit", "/api/owner/audit/access"]) {
        const r = await call("GET", path, undefined, h as any);
        expect(r.status).toBe(404);
      }
      expect((await call("POST", "/api/owner/audit/EVT1/analyze", {}, h as any)).status).toBe(404);
    }
    // not even through an AI work link, and the platform key is not accepted in an address
    expect((await call("GET", `/ai/${o.ai}/owner/audit/EVT1`)).status).toBe(404);
    expect((await call("GET", "/ai/plat/owner/audit/EVT1")).status).toBe(404);
    // a request that carries the platform key but came through a link rewrite is refused too
    expect((await call("GET", "/api/owner/audit/EVT1", undefined, { ...PLAT, "x-cb-link": "1" })).status).toBe(404);
    const acc = (await j(await call("GET", "/api/owner/audit/access", undefined, PLAT))).access;
    expect(acc.filter((x: any) => x.action.startsWith("denied:") && x.ok === 0).length).toBeGreaterThanOrEqual(22);
    expect(JSON.stringify(acc)).not.toContain(o.ai); expect(JSON.stringify(acc)).not.toContain(hostKey);
  });
  test("organizer-facing console routes expose no audit-log row (the old per-AI trail view is its own table)", async () => {
    const o = await withEngagement();
    const t = JSON.stringify(await j(await call("GET", "/api/org/ai/audit", undefined, o.h)));
    expect(t).not.toContain("row_hash"); expect(t).not.toContain("device_id");
  });
  test("download (JSON and CSV), verify and analyze are written to the access log", async () => {
    await withEngagement();
    expect((await call("GET", "/api/owner/audit/EVT1?format=csv", undefined, PLAT)).headers.get("content-type")).toMatch(/text\/csv/);
    const csv = await (await call("GET", "/api/owner/audit/EVT1?format=csv", undefined, PLAT)).text();
    expect(csv.split("\n")[0]).toContain("ip,user_agent"); expect(csv).toContain(IP);
    await call("GET", "/api/owner/audit/EVT1", undefined, PLAT); await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT); await call("POST", "/api/owner/audit/EVT1/analyze", {}, PLAT);
    const acc = (await j(await call("GET", "/api/owner/audit/access", undefined, PLAT))).access.map((x: any) => x.action + ":" + (x.fmt ?? ""));
    for (const want of ["download:csv", "download:json", "verify:", "analyze:built-in rules"]) expect(acc).toContain(want);
    expect((await j(await call("GET", "/api/owner/audit/access", undefined, PLAT))).access.find((x: any) => x.action === "download").row_count).toBeGreaterThan(0);
  });
});

describe("analysis sees only masked data", () => {
  test("what is sent to an AI vendor holds counts and buckets: no IP, device id, user agent, session or machine id", async () => {
    const o = await withEngagement();
    await call("GET", `/ai/${o.ai}/z/EVT1/summary?ai_model=gpt-5&ai_session=SECRET-SESSION&ai_machine=SECRET-MACHINE`, undefined, { "user-agent": "ChatGPT-User/1.0", "cf-connecting-ip": "20.171.0.9" });
    await call("POST", `/ai/${o.ai}/z/EVT1/erase`, {}, { "user-agent": "curl/8", "cf-connecting-ip": "20.171.0.9" });
    let sent = "";
    const fake = (async (_u: any, init: any) => { sent = String(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: "One denied erase attempt." } }] })); }) as unknown as typeof fetch;
    const out = await analyzeChain({ ...env, ANALYZE_AI_URL: "https://ai.test/v1/chat", ANALYZE_AI_KEY: "k" } as any, "EVT1", fake);
    expect(out.summary).toBe("One denied erase attempt."); expect(out.summarizedBy).toBe("ai");
    for (const bad of [IP, "20.171.0.9", "20.171", "Chrome/120", "ChatGPT-User", "SECRET-SESSION", "SECRET-MACHINE", "ab".repeat(16)]) expect(sent).not.toContain(bad);
    expect(sent).toContain("deniedAiAttempts"); expect(out.aggregate.deniedAiAttempts).toBe(1); expect(out.findings.join(" ")).toMatch(/refused/);
    // and with no AI configured the built-in rules answer
    const plain = await analyzeChain(env as any, "EVT1"); expect(plain.summary).toBeNull(); expect(plain.summarizedBy).toBe("built-in rules");
    expect(maskedAggregate(await loadRows(env as any, "EVT1")).aggregate.rows).toBe(out.aggregate.rows);
  });
});

describe("deletion at 365 days", () => {
  const LATER = T + 400 * 86_400_000;
  test("the log goes with the engagement; an anonymous statistics row and a certificate (id, date, count, final hash) stay and hold nothing personal", async () => {
    await withEngagement();
    const last = rows("EVT1").at(-1).row_hash; const n = rows("EVT1").length;
    await purgeOld(env as any, LATER);
    expect(rows("EVT1").length).toBe(0);
    const cert = raw.prepare("SELECT * FROM audit_cert WHERE eid='EVT1'").get() as any;
    expect(cert).toMatchObject({ eid: "EVT1", deleted_ms: LATER, row_count: n, final_hash: last });
    const stats = JSON.parse((raw.prepare("SELECT stats FROM audit_stats WHERE eid='EVT1'").get() as any).stats);
    expect(stats.rows).toBe(n); expect(stats.byEvent).toEqual({ create: 1, edit: 1 });
    const kept = JSON.stringify([cert, stats]);
    for (const bad of [IP, "Chrome", "boss@acme.com"]) expect(kept).not.toContain(bad);
    // certificates and stats are never swept
    await purgeOld(env as any, LATER + 5 * 365 * 86_400_000);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM audit_cert").get() as any).c).toBe(1);
  });
  test("a legal hold keeps the engagement and its log until it is lifted", async () => {
    await withEngagement();
    expect((await j(await call("POST", "/api/owner/audit/EVT1/hold", { on: true, note: "court order 12" }, PLAT))).held).toBe(true);
    await purgeOld(env as any, LATER);
    expect(rows("EVT1").length).toBe(2); expect(raw.prepare("SELECT 1 FROM engagement WHERE id='EVT1'").get()).toBeTruthy(); expect(raw.prepare("SELECT 1 FROM audit_cert").get()).toBeFalsy();
    expect((await call("POST", "/api/owner/audit/EVT1/hold", { on: true }, { "x-organizer": "wrong" })).status).toBe(404);
    await call("POST", "/api/owner/audit/EVT1/hold", { on: false }, PLAT);
    await purgeOld(env as any, LATER);
    expect(rows("EVT1").length).toBe(0); expect(raw.prepare("SELECT 1 FROM audit_cert WHERE eid='EVT1'").get()).toBeTruthy();
  });
  test("rows that belong to no live engagement (sign-in attempts) are swept after 365 days", async () => {
    await call("POST", "/api/auth/verify", { email: "x@y.com", code: "000000" }, { "cf-connecting-ip": IP });
    expect((raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE chain='sys'").get() as any).c).toBe(1);
    await purgeOld(env as any, T + 366 * 86_400_000);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE chain='sys'").get() as any).c).toBe(0);
  });
});
