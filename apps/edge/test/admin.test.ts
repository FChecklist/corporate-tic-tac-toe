// The owner's desk (src/admin.ts): A5 site switch, A3 organizer lookup, A6 data-request queue, A7 error counter and health read, E12 mail bounce log.
// Through the real Worker code and a real SQLite. Owner-only addresses answer the same 404 to everybody else.
import { beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { ERROR_ALERT_THRESHOLD, MAIL_EVENT_DAYS, maskMail, verifyMailSignature } from "../src/admin";

const T = Date.UTC(2026, 9, 14, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: Env & Record<string, any>; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const PLAT = { "x-organizer": "plat" };
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T, e: any = env) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), e, now);
const j = async (r: Response) => (await r.json()) as any;
const one = (sql: string, ...a: any[]) => raw.prepare(sql).get(...a) as any;
const all = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[];
const dev = (i: number) => String(i).padStart(2, "0").repeat(16);
async function organizer(email: string) {
  const r = await call("POST", "/api/start", { email }, { "cf-connecting-ip": `10.1.0.${++n}` }); const b = await j(r); expect(r.status).toBe(200);
  return { h: { "x-organizer": b.token as string }, ai: b.aiKey as string };
}
async function game(id: string, email = `org${++n}@acme.com`) {
  const o = await organizer(email);
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, o.h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.h)).status).toBe(200);
  return o;
}
beforeEach(() => { const d = makeD1(); raw = d.raw; n = 0; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://game.test", PHONE_SALT: "salt", DATA_KEY: "k" } as any; });

describe("A5: the owner's site switch", () => {
  test("only the owner can read or switch it; everybody else gets the same 404 as an unknown address, and the try is on the access log", async () => {
    const o = await organizer("boss@acme.com");
    for (const h of [{}, o.h, { "x-organizer": o.ai }, { "x-organizer": "wrong" }, { ...PLAT, "x-cb-link": "1" }]) {
      expect((await call("POST", "/api/owner/site", { off: true }, h as any)).status).toBe(404);
      expect((await call("GET", "/api/owner/site", undefined, h as any)).status).toBe(404);
    }
    expect(one("SELECT COUNT(*) c FROM audit_access WHERE action='denied:site'").c).toBe(10);
    expect(await j(await call("GET", "/api/owner/site", undefined, PLAT))).toEqual({ off: false, since: null, note: null });
  });
  test("ON: every public page and API answers a plain 503 'Back soon'; a browser gets a page, anything else gets JSON", async () => {
    expect((await call("POST", "/api/owner/site", { off: true, note: "moving the database" }, PLAT)).status).toBe(200);
    for (const [m, p] of [["GET", "/api/z/ABCD/control"], ["POST", "/api/start"], ["GET", "/api/notices"], ["GET", "/ai/cba_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"], ["GET", "/j/abc"], ["GET", "/api/report/abcd"], ["POST", "/api/z/ABCD/join"], ["POST", "/api/z/ABCD/leave"]] as const) {
      const r = await call(m, p, m === "POST" ? {} : undefined); expect([p, r.status]).toEqual([p, 503]);
      const b = await j(r); expect(b.maintenance).toBe(true); expect(b.error).toMatch(/back soon/i); expect(r.headers.get("retry-after")).toBe("300");
    }
    const page = await call("GET", "/j/abc", undefined, { accept: "text/html,application/xhtml+xml" }); expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toMatch(/text\/html/); const html = await page.text(); expect(html).toMatch(/Back soon/); expect(html).not.toMatch(/owner|legal|review pending/i);
    const s = await j(await call("GET", "/api/owner/site", undefined, PLAT)); expect(s.off).toBe(true); expect(s.note).toBe("moving the database");
    expect(one("SELECT note FROM audit_access WHERE action='site-switch'").note).toBe("on->off: moving the database");
  });
  test("ON: the mode read, the owner's addresses, the health read, the 24-hour deletion tick and the webhooks still answer", async () => {
    await call("POST", "/api/owner/site", { off: true }, PLAT);
    expect(await j(await call("GET", "/api/mode"))).toEqual({ mode: "LIVE" });
    expect((await call("GET", "/api/owner/ledger", undefined, PLAT)).status).toBe(200);
    expect((await call("GET", "/api/owner/mode", undefined, PLAT)).status).toBe(200);
    const h = await call("GET", "/api/status/health"); expect(h.status).toBe(200); expect((await j(h)).maintenance).toBe(true);
    const tick = await call("POST", "/api/lifecycle/tick", {}, PLAT); expect(tick.status).toBe(200); expect((await j(tick)).ok).toBe(true);
    const hook = await call("POST", "/api/payments/webhook", "{}", { "x-razorpay-signature": "bad" }); expect((await j(hook)).maintenance).toBeUndefined(); // answered by the payment code itself (not set up / bad signature), not by the switch
    expect((await call("POST", "/api/mail/events", "{}")).status).toBe(404); // not configured: 404, never 503
    expect((await j(await call("POST", "/api/inbound-email", {}, { "x-inbound-secret": "nope" }))).maintenance).toBeUndefined();
  });
  test("OFF again: the site answers as before (a game made earlier is still there)", async () => {
    await game("SW-1");
    await call("POST", "/api/owner/site", { off: true }, PLAT);
    expect((await call("GET", "/api/z/SW-1/control")).status).toBe(503);
    const r = await call("POST", "/api/owner/site", { off: false }, PLAT); expect(await j(r)).toEqual({ ok: true, off: false, was: true });
    expect((await call("GET", "/api/z/SW-1/control")).status).not.toBe(503);
    expect(one("SELECT COUNT(*) c FROM kv WHERE k='site/off'").c).toBe(0);
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: true, maintenance: false });
  });
  test("a switch made by another Worker instance is seen within a few seconds; an unreadable flag leaves the site up", async () => {
    raw.prepare("INSERT INTO kv(k,v) VALUES('site/off','{}')").run(); // as if another instance had switched it
    expect((await call("GET", "/api/notices", undefined, {}, T + 10_000)).status).toBe(503);
    raw.prepare("DELETE FROM kv WHERE k='site/off'").run();
    expect((await call("GET", "/api/notices", undefined, {}, T + 20_000)).status).not.toBe(503);
    const broken = { ...env, DB: { prepare: () => { throw new Error("db down"); }, batch: async () => [] } } as any;
    const r = await call("GET", "/api/notices", undefined, {}, T, broken); expect(r.status).not.toBe(503);
  });
  test("a bad request is refused plainly", async () => {
    expect((await call("POST", "/api/owner/site", { off: "yes" }, PLAT)).status).toBe(400);
    expect((await call("POST", "/api/owner/site", {}, PLAT)).status).toBe(400);
  });
});

describe("A3: look up an organizer and their games", () => {
  test("by e-mail: their games with id, state, start, paid and created; no phone number, nothing about anyone else", async () => {
    const o = await game("LK-1", "Maya.Lopez@acme.com");
    await game("LK-2", "other@acme.com");
    expect((await call("POST", "/api/z", { id: "LK-3", startRound: START + 10, callSeconds: 6, cap: 50 }, o.h)).status).toBe(200); // a draft
    const r = await call("GET", "/api/owner/organizer?email=maya.lopez%40ACME.com", undefined, PLAT); expect(r.status).toBe(200);
    const b = await j(r);
    expect(b.found).toBe(true); expect(b.email).toBe("maya.lopez@acme.com");
    expect(b.games.map((g: any) => g.id).sort()).toEqual(["LK-1", "LK-3"]);
    const g1 = b.games.find((g: any) => g.id === "LK-1"), g3 = b.games.find((g: any) => g.id === "LK-3");
    expect(g1.state).toBe("published, not paid"); expect(g1.paid).toBe(false); expect(g3.state).toBe("draft");
    expect(g1.start).toBe(new Date((GEN + (START - 1) * 3) * 1000).toISOString()); expect(g1.created).toBe(new Date(T).toISOString());
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/98765|9876543210|boss@acme\.com|other@acme\.com/); // the game's contact phone and e-mail, and the other organizer, are not in the answer
    expect(Object.keys(g1).sort()).toEqual(["created", "id", "paid", "start", "state", "test"]);
  });
  test("a paid game shows paid, a cancelled game shows cancelled", async () => {
    const o = await game("LK-4", "pay@acme.com");
    raw.prepare("INSERT INTO payment(id,org,email,pack,currency,amount,tax,status,created_ms,paid_ms,meta,eid) VALUES('p1',(SELECT org FROM engagement WHERE id='LK-4'),'pay@acme.com',100,'INR',1,0,'paid',?,?, '{}','LK-4')").run(T, T);
    let b = await j(await call("GET", "/api/owner/organizer?email=pay@acme.com", undefined, PLAT));
    expect(b.games[0].paid).toBe(true); expect(b.games[0].state).toBe("paid, waiting to start");
    raw.prepare("UPDATE engagement SET cancelled_ms=? WHERE id='LK-4'").run(T);
    b = await j(await call("GET", "/api/owner/organizer?email=pay@acme.com", undefined, PLAT)); expect(b.games[0].state).toBe("cancelled");
    void o;
  });
  test("an unknown e-mail is found:false; a bad one is a 400; everybody else gets 404", async () => {
    expect(await j(await call("GET", "/api/owner/organizer?email=nobody%40acme.com", undefined, PLAT))).toMatchObject({ found: false, games: [] });
    expect((await call("GET", "/api/owner/organizer?email=nope", undefined, PLAT)).status).toBe(400);
    const o = await organizer("boss@acme.com");
    for (const h of [{}, o.h, { "x-organizer": o.ai }, { ...PLAT, "x-cb-link": "1" }]) expect((await call("GET", "/api/owner/organizer?email=boss%40acme.com", undefined, h as any)).status).toBe(404);
    expect((await call("POST", "/api/owner/organizer?email=boss%40acme.com", {}, PLAT)).status).toBe(404);
    expect(one("SELECT COUNT(*) c FROM audit_access WHERE action='denied:organizer'").c).toBe(4);
  });
  test("the e-mail looked up is not written to the access log", async () => {
    await call("GET", "/api/owner/organizer?email=maya%40acme.com", undefined, PLAT);
    expect(JSON.stringify(all("SELECT * FROM audit_access"))).not.toContain("maya");
  });
});

describe("A6: the data-request queue", () => {
  const joinAs = async (id: string, i: number) => { const r = await call("POST", `/api/z/${id}/join`, { name: `Player ${i}`, device: dev(i) }); expect(r.status).toBe(200); return (await j(r)).pid as string; };
  const ask = (id: string, pid: string, device: string, kind: string, extra: Record<string, unknown> = {}, now = T) => call("POST", `/api/z/${id}/datareq`, { pid, device, kind, ...extra }, {}, now);
  test("a player's request shows in the owner's list, can be closed once, and then moves to the closed list", async () => {
    await game("DQ-1"); const a = await joinAs("DQ-1", 1), b = await joinAs("DQ-1", 2);
    expect((await ask("DQ-1", a, dev(1), "access", { note: "what do you hold?" })).status).toBe(200);
    expect((await ask("DQ-1", b, dev(2), "correction", { note: "my name is wrong" })).status).toBe(200);
    const list = await j(await call("GET", "/api/owner/data-requests", undefined, PLAT));
    expect(list.requests.length).toBe(2);
    const r0 = list.requests.find((r: any) => r.kind === "access");
    expect(r0).toMatchObject({ game: "DQ-1", card: a, status: "open", overdue: false, closed: null, note: "what do you hold?" });
    expect(r0.due).toBe(new Date(T + 7 * 86_400_000).toISOString());
    const closed = await call("POST", "/api/owner/data-requests", { id: r0.id, action: "close" }, PLAT, T + 1000); expect(await j(closed)).toEqual({ ok: true, id: r0.id, status: "done" });
    expect((await j(await call("GET", "/api/owner/data-requests", undefined, PLAT))).requests.map((r: any) => r.kind)).toEqual(["correction"]);
    const done = (await j(await call("GET", "/api/owner/data-requests?status=done", undefined, PLAT))).requests; expect(done.length).toBe(1); expect(done[0].closed).toBe(new Date(T + 1000).toISOString());
    expect((await j(await call("GET", "/api/owner/data-requests?status=all", undefined, PLAT))).requests.length).toBe(2);
    expect(await j(await call("POST", "/api/owner/data-requests", { id: r0.id, action: "close" }, PLAT, T + 5000))).toMatchObject({ ok: true, again: true }); // closing twice changes nothing
    expect(one("SELECT done_ms FROM data_request WHERE id=?", r0.id).done_ms).toBe(T + 1000);
    expect(one("SELECT note FROM audit_access WHERE action='data-request-close'").note).toBe(r0.id);
    const st = await j(await ask("DQ-1", a, dev(1), "status")); expect(st.requests[0].status).toBe("done"); // the player sees it closed
  });
  test("an open request past its promised day is marked overdue", async () => {
    await game("DQ-2"); const a = await joinAs("DQ-2", 1);
    await ask("DQ-2", a, dev(1), "access");
    const later = T + 8 * 86_400_000;
    expect((await j(await call("GET", "/api/owner/data-requests", undefined, PLAT, later))).requests[0].overdue).toBe(true);
  });
  test("closing needs an id and the word close; an unknown id is 404; everybody else gets 404", async () => {
    await game("DQ-3"); const a = await joinAs("DQ-3", 1); await ask("DQ-3", a, dev(1), "access");
    const id = (await j(await call("GET", "/api/owner/data-requests", undefined, PLAT))).requests[0].id;
    expect((await call("POST", "/api/owner/data-requests", { id }, PLAT)).status).toBe(400);
    expect((await call("POST", "/api/owner/data-requests", { id: "nope", action: "close" }, PLAT)).status).toBe(404);
    const o = await organizer("x@acme.com");
    for (const h of [{}, o.h, { "x-organizer": o.ai }, { ...PLAT, "x-cb-link": "1" }]) {
      expect((await call("GET", "/api/owner/data-requests", undefined, h as any)).status).toBe(404);
      expect((await call("POST", "/api/owner/data-requests", { id, action: "close" }, h as any)).status).toBe(404);
    }
    expect(one("SELECT status FROM data_request WHERE id=?", id).status).toBe("open");
  });
});

describe("A7: the error counter and the health read", () => {
  const strict = () => ({ ...env, STRICT_KEYS: "1", DATA_KEY: "", PHONE_SALT: "" }) as any; // a site missing its secrets answers 503 to everything
  test("every 5xx answer is counted; the health read says how many in the last hour and stays 200", async () => {
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: true, errors_last_hour: 0, threshold: ERROR_ALERT_THRESHOLD, maintenance: false });
    for (let i = 0; i < 4; i++) expect((await call("GET", "/api/notices", undefined, {}, T + i, strict())).status).toBe(503);
    expect((await call("GET", "/api/notices")).status).toBe(200); // a good answer is not counted
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: true, errors_last_hour: 4 });
    expect(await j(await call("GET", "/api/status/health", undefined, {}, T + 3_600_000 + 60_000))).toMatchObject({ errors_last_hour: 0 }); // an hour later they no longer count
  });
  test("the maintenance 503 is not counted as an error", async () => {
    await call("POST", "/api/owner/site", { off: true }, PLAT);
    for (let i = 0; i < 3; i++) await call("GET", "/api/notices");
    expect((await j(await call("GET", "/api/status/health"))).errors_last_hour).toBe(0);
  });
  test("a thrown error becomes a plain 500 and is counted", async () => {
    const boom = { ...env, DB: new Proxy(env.DB, { get: (t: any, k) => (k === "prepare" ? (sql: string) => { if (/engagement/.test(sql)) throw new Error("boom"); return t.prepare(sql); } : t[k]) }) } as any;
    const r = await call("GET", "/api/z/BOOM-1/control", undefined, {}, T, boom);
    expect(r.status).toBe(500); expect((await j(r)).code).toBe("server-error"); expect((await j(await call("GET", "/api/status/health"))).errors_last_hour).toBe(1);
  });
  test("the owner sees the last 24 hours by hour; old counters go with the tick; everybody else gets 404", async () => {
    raw.prepare("INSERT INTO kv(k,v) VALUES('err/2026-10-14T09:5','7'),('err/2026-10-14T08:0','2'),('err/2026-10-14T08:1','3'),('err/2026-10-10T08:0','9')").run();
    const e = await j(await call("GET", "/api/owner/errors", undefined, PLAT));
    expect(e.hours).toEqual([{ hour: "2026-10-14T08:00Z", errors: 5 }, { hour: "2026-10-14T09:00Z", errors: 7 }]);
    expect(e.lastHour).toBe(7); expect(e.threshold).toBe(ERROR_ALERT_THRESHOLD);
    expect((await call("POST", "/api/lifecycle/tick", {}, PLAT)).status).toBe(200);
    expect(all("SELECT k FROM kv WHERE k LIKE 'err/%' ORDER BY k").map((r) => r.k)).toEqual(["err/2026-10-14T08:0", "err/2026-10-14T08:1", "err/2026-10-14T09:5"]);
    for (const h of [{}, { ...PLAT, "x-cb-link": "1" }]) expect((await call("GET", "/api/owner/errors", undefined, h as any)).status).toBe(404);
  });
  test("above the threshold the health read shows it (the scheduler's check fails on this number)", async () => {
    raw.prepare("INSERT INTO kv(k,v) VALUES('err/2026-10-14T10:0',?)").run(String(ERROR_ALERT_THRESHOLD + 5));
    const h = await j(await call("GET", "/api/status/health")); expect(h.errors_last_hour).toBe(ERROR_ALERT_THRESHOLD + 5); expect(h.errors_last_hour > h.threshold).toBe(true);
  });
});

describe("E12: the mail bounce log", () => {
  const SECRET = "whsec_" + Buffer.from("test-secret-bytes-0123456789abcd").toString("base64");
  const sign = (id: string, ts: number, body: string, secret = SECRET) => "v1," + createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  const hook = (payload: unknown, id = "msg_1", at = T, opts: { secret?: string; sig?: string; ts?: number } = {}) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload), ts = opts.ts ?? Math.floor(at / 1000);
    return call("POST", "/api/mail/events", body, { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": opts.sig ?? sign(id, ts, body, opts.secret) }, at, { ...env, RESEND_WEBHOOK_SECRET: SECRET });
  };
  const bounced = { type: "email.bounced", created_at: "2026-10-14T10:00:00Z", data: { email_id: "e1", from: "Corporate Tic Tac Toe <bingo@veridian-aios.com>", to: ["Maya.Lopez@Acme.com"], subject: "Corporate Tic Tac Toe: your sign-in code", bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 maya.lopez@acme.com does not exist" } } };
  test("with no secret set the address answers 404 and accepts nothing", async () => {
    const r = await call("POST", "/api/mail/events", JSON.stringify(bounced), { "svix-id": "m", "svix-timestamp": String(Math.floor(T / 1000)), "svix-signature": "v1,x" }); expect(r.status).toBe(404);
    expect(one("SELECT COUNT(*) c FROM mail_bounce").c).toBe(0);
    expect((await call("GET", "/api/mail/events")).status).toBe(404);
  });
  test("a correctly signed bounce is stored with the recipient hashed and masked, and no message text", async () => {
    const r = await hook(bounced); expect(r.status).toBe(200); expect(await j(r)).toEqual({ ok: true, event: "bounced", again: false });
    const row = one("SELECT * FROM mail_bounce"); expect(row).toMatchObject({ id: "msg_1", event: "bounced", to_mask: "m***@acme.com", subject: "Corporate Tic Tac Toe: your sign-in code", detail: "Permanent/General", at_ms: T });
    expect(row.to_hash).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(row)).not.toMatch(/Lopez|maya|does not exist/i);
  });
  test("bounced, complained and delivered are kept; delayed and failed too; other events are ignored; a repeat (same message id) is not stored twice", async () => {
    await hook({ ...bounced, type: "email.complained", data: { ...bounced.data, bounce: undefined } }, "m2");
    await hook({ ...bounced, type: "email.delivered", data: { ...bounced.data, bounce: undefined, tags: { kind: "signin" } } }, "m3");
    await hook({ ...bounced, type: "email.delivery_delayed" }, "m4");
    expect(await j(await hook({ ...bounced, type: "email.opened" }, "m5"))).toEqual({ ok: true, ignored: true });
    expect(await j(await hook(bounced, "m6"))).toMatchObject({ again: false });
    expect(await j(await hook(bounced, "m6"))).toMatchObject({ again: true });
    expect(all("SELECT id, event, kind FROM mail_bounce ORDER BY id")).toEqual([{ id: "m2", event: "complained", kind: null }, { id: "m3", event: "delivered", kind: "signin" }, { id: "m4", event: "delayed", kind: null }, { id: "m6", event: "bounced", kind: null }]);
  });
  test("a wrong signature, a stale time, a wrong secret and a broken body are refused and store nothing", async () => {
    expect((await hook(bounced, "b1", T, { sig: "v1,AAAA" })).status).toBe(400);
    expect((await hook(bounced, "b2", T, { ts: Math.floor(T / 1000) - 3600 })).status).toBe(400);
    expect((await hook(bounced, "b3", T, { secret: "whsec_" + Buffer.from("another-secret-another-secret-12").toString("base64") })).status).toBe(400);
    const body = "{ not json"; const ts = Math.floor(T / 1000);
    expect((await call("POST", "/api/mail/events", body, { "svix-id": "b4", "svix-timestamp": String(ts), "svix-signature": sign("b4", ts, body) }, T, { ...env, RESEND_WEBHOOK_SECRET: SECRET })).status).toBe(400);
    expect((await call("POST", "/api/mail/events", JSON.stringify(bounced), {}, T, { ...env, RESEND_WEBHOOK_SECRET: SECRET })).status).toBe(400);
    expect(one("SELECT COUNT(*) c FROM mail_bounce").c).toBe(0);
  });
  test("the signature check itself: right, wrong body, several signatures in one header", async () => {
    const ts = Math.floor(T / 1000), body = "{}", good = sign("i", ts, body);
    expect(await verifyMailSignature(SECRET, "i", String(ts), good, body, T)).toBe(true);
    expect(await verifyMailSignature(SECRET, "i", String(ts), good, "{ }", T)).toBe(false);
    expect(await verifyMailSignature(SECRET, "i", String(ts), "v1,zzzz " + good, body, T)).toBe(true);
    expect(await verifyMailSignature(SECRET, "i", String(ts), good.replace("v1,", "v2,"), body, T)).toBe(false);
  });
  test("the owner reads them newest first with counts; only the owner; the address and the person are masked", async () => {
    await hook(bounced, "e1", T); await hook({ ...bounced, type: "email.delivered" }, "e2", T + 1000); await hook({ ...bounced, type: "email.complained" }, "e3", T + 2000);
    const ownerEnv = { ...env, RESEND_WEBHOOK_SECRET: SECRET };
    const v = await j(await call("GET", "/api/owner/mail-events", undefined, PLAT, T + 3000, ownerEnv));
    expect(v.counts).toEqual({ bounced: 1, delivered: 1, complained: 1 }); expect(v.events.map((e: any) => e.event)).toEqual(["complained", "delivered", "bounced"]); expect(v.webhook).toBe("on");
    expect(v.events[2]).toMatchObject({ to: "m***@acme.com", subject: "Corporate Tic Tac Toe: your sign-in code", detail: "Permanent/General" }); expect(JSON.stringify(v)).not.toMatch(/Lopez/i);
    expect((await j(await call("GET", "/api/owner/mail-events?event=bounced", undefined, PLAT, T + 3000, ownerEnv))).events.length).toBe(1);
    expect((await j(await call("GET", "/api/owner/mail-events", undefined, PLAT))).webhook).toMatch(/^off/);
    const o = await organizer("boss@acme.com");
    for (const h of [{}, o.h, { "x-organizer": o.ai }, { ...PLAT, "x-cb-link": "1" }]) expect((await call("GET", "/api/owner/mail-events", undefined, h as any, T, ownerEnv)).status).toBe(404);
  });
  test("a bounce shows in the organizer lookup; mail events are deleted after 90 days by the tick", async () => {
    await game("MB-1", "maya.lopez@acme.com");
    await hook(bounced, "old", T - (MAIL_EVENT_DAYS + 1) * 86_400_000, { ts: Math.floor(T / 1000) - (MAIL_EVENT_DAYS + 1) * 86400 });
    await hook(bounced, "new", T);
    expect((await j(await call("GET", "/api/owner/organizer?email=maya.lopez%40acme.com", undefined, PLAT))).mailProblems).toBe(2);
    expect((await call("POST", "/api/lifecycle/tick", {}, PLAT)).status).toBe(200);
    expect(all("SELECT id FROM mail_bounce").map((r) => r.id)).toEqual(["new"]);
  });
  test("masking", () => { expect(maskMail("Maya.Lopez@Acme.com")).toBe("m***@acme.com"); expect(maskMail("nonsense")).toBe("***"); });
});

describe("A7b: the 24-hour promise has an alarm, and the tick keeps the mail log short (data audit fixes 8 and 9)", () => {
  const startMs = () => (GEN + (START - 1) * 3) * 1000;
  const late = () => startMs() + 6 * 3_600_000 + 23 * 3_600_000 + 31 * 60_000; // 31 minutes past the 23-hour deletion of a game that was never started
  async function withPlayer(id: string) {
    await game(id); raw.prepare("UPDATE engagement SET pack=100 WHERE id=?").run(id);
    expect((await call("POST", `/api/z/${id}/join`, { name: "Maya", device: dev(1) })).status).toBe(200);
  }
  test("a game past its 23-hour deletion that still holds a player turns the health read to ok:false (count and hours); the tick clears it; a legal hold is left out", async () => {
    await withPlayer("OVD-1");
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: true, overdue_purge: 0, overdue_hours: null });
    expect(await j(await call("GET", "/api/status/health", undefined, {}, late() - 3_600_000))).toMatchObject({ ok: true, overdue_purge: 0 }); // not yet: the tick still has time
    const h = await j(await call("GET", "/api/status/health", undefined, {}, late())); // nobody has run the tick at all: the alarm sees the stored player anyway
    expect(h).toMatchObject({ ok: false, overdue_purge: 1 }); expect(h.overdue_hours).toBeGreaterThan(0);
    raw.prepare("INSERT INTO legal_hold(eid,at_ms,note) VALUES('OVD-1',?,'x')").run(T);
    expect(await j(await call("GET", "/api/status/health", undefined, {}, late()))).toMatchObject({ ok: true, overdue_purge: 0 }); // kept on purpose
    raw.prepare("DELETE FROM legal_hold WHERE eid='OVD-1'").run();
    expect((await call("POST", "/api/lifecycle/tick", {}, PLAT, late())).status).toBe(200);
    expect(one("SELECT COUNT(*) c FROM participant WHERE eid='OVD-1'").c).toBe(0);
    expect(await j(await call("GET", "/api/status/health", undefined, {}, late()))).toMatchObject({ ok: true, overdue_purge: 0, overdue_hours: null });
  });
  test("a game the tick has seen (a life row) is watched the same way; once purged it no longer counts", async () => {
    await withPlayer("OVD-2");
    raw.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES('OVD-2',?, 'schedule')").run(T - 24 * 3_600_000);
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: false, overdue_purge: 1 });
    raw.prepare("UPDATE life SET purged_ms=? WHERE eid='OVD-2'").run(T);
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: true, overdue_purge: 0 });
  });
  test("the names on the bracket in the clear (ttt_p) count as players' data on their own: the alarm sees them and the tick deletes them", async () => {
    await game("OVD-3"); raw.prepare("UPDATE engagement SET pack=100 WHERE id='OVD-3'").run();
    raw.prepare("INSERT INTO ttt_p(eid,pid,name) VALUES('OVD-3','x1','Maya Lopez')").run();
    raw.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES('OVD-3',?, 'phones')").run(T - 24 * 3_600_000);
    expect(one("SELECT COUNT(*) c FROM participant WHERE eid='OVD-3'").c).toBe(0);
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: false, overdue_purge: 1 });
    expect((await call("POST", "/api/lifecycle/tick", {}, PLAT, T)).status).toBe(200);
    expect(one("SELECT COUNT(*) c FROM ttt_p WHERE eid='OVD-3'").c).toBe(0);
    expect(await j(await call("GET", "/api/status/health"))).toMatchObject({ ok: true, overdue_purge: 0 });
  });
  test("the tick forgets mail-log rows older than 3 days (once an hour) and keeps newer ones", async () => {
    const ins = (id: number, at: number, sent: number) => raw.prepare("INSERT INTO outbox(id,to_addr,subject,body,sent,at_ms) VALUES(?,?,?,?,?,?)").run(id, "a@acme.com", "s", "", sent, at);
    ins(901, T - 4 * 86_400_000, 1); ins(902, T - 11 * 86_400_000, 1); ins(903, T - 2 * 86_400_000, 1);
    expect((await call("POST", "/api/lifecycle/tick", {}, PLAT, T)).status).toBe(200);
    expect(all("SELECT id FROM outbox WHERE id>=901 ORDER BY id").map((r) => r.id)).toEqual([903]);
    ins(904, T - 5 * 86_400_000, 1); // the same hour: not looked at again
    await call("POST", "/api/lifecycle/tick", {}, PLAT, T + 60_000); expect(all("SELECT id FROM outbox WHERE id=904").length).toBe(1);
    await call("POST", "/api/lifecycle/tick", {}, PLAT, T + 3_600_000 + 60_000); expect(all("SELECT id FROM outbox WHERE id=904").length).toBe(0); // the next hour
  });
});
