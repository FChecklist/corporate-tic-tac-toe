// The short AI work link (/ai/<key>): manual per role, key-in-path API, GET-only fallback, no leaks, audit, and the widened organizer-AI rights.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { aiMessage, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { sealPii } from "../src/pii";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const ORIGIN = "https://bingo.test";
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const FUT = roundAt(T) + 1200;
const eng = (id: string, cap = 100) => ({ id, startRound: FUT, callSeconds: 6, cap });
const contact = { email: "boss@acme.com", phone: "98765 43210" };
const q = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const j = async (r: Response) => (await r.json()) as any;

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: ORIGIN, DATA_KEY: "test-data-key" };
});

async function organizer() {
  const r = await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" });
  const x = await j(r);
  return { h: { "x-organizer": x.token as string }, token: x.token as string, ai: x.aiKey as string, msg: x.aiMessage as string };
}
const auditRows = () => raw.prepare("SELECT method, path, status, key_id FROM ai_audit ORDER BY id").all() as { method: string; path: string; status: number; key_id: string }[];
const linkGet = (key: string, rest = "", headers: Record<string, string> = {}) => call("GET", `/ai/${key}${rest}`, undefined, headers);

describe("the paste text and the manual", () => {
  test("the paste is two short lines plus the link, framed as the owner's own documentation, with the key only inside the link", async () => {
    const o = await organizer();
    expect(o.msg.split("\n").length).toBe(2); expect(o.msg.length).toBeLessThan(420);
    expect(o.msg).toMatch(/API documentation and instructions for MY OWN Corporate Tic Tac Toe account/); expect(o.msg).toMatch(/I am the owner/);
    expect(o.msg.endsWith(`${ORIGIN}/ai/${o.ai}`)).toBe(true);
    expect(o.msg.split(o.ai).length).toBe(2); // the key appears once: in the link
    expect(o.msg).not.toMatch(/x-organizer/i); expect(o.msg).not.toMatch(/ai-manifest/);
    expect(aiMessage(ORIGIN, "cba_x")).toContain("/ai/cba_x");
    const mail = raw.prepare("SELECT body FROM outbox ORDER BY id DESC LIMIT 1").get() as { body: string };
    expect(mail.body).not.toContain(o.msg); expect(mail.body).not.toContain(o.ai); expect(mail.body).toMatch(/\/ai\/cba_[0-9a-f]{48}/); // the mail has its own 24-hour key
  });
  test("GET /ai/<key> returns the complete organizer manual as plain text, with absolute keyed addresses, rules, refusals and no header demand", async () => {
    const o = await organizer();
    const r = await linkGet(o.ai);
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toMatch(/^text\/plain; charset=utf-8/);
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/); expect(r.headers.get("referrer-policy")).toBe("no-referrer"); expect(r.headers.get("cache-control")).toBe("no-store");
    const t = await r.text(); const base = `${ORIGIN}/ai/${o.ai}`;
    expect(t).toContain(`Base address: ${base}`);
    for (const must of [`GET ${base}/z/{id}/summary`, `POST ${base}/z `, `PATCH ${base}/z/{id}/settings`, `POST ${base}/z/{id}/roster`, `POST ${base}/z/{id}/announce`, `POST ${base}/z/{id}/prizegiven`, `GET ${base}/z/schedule`, `POST ${base}/org/host`, `GET ${base}/org/ai/audit`])
      expect(t).toContain(must);
    expect(t).toMatch(/ONE question at a time/); expect(t).toMatch(/_method=POST/); expect(t).toMatch(/about 20 people/); expect(t).toMatch(/WHAT YOU CANNOT DO/);
    expect(t).toMatch(/Pay for anything/); expect(t).toMatch(/Publish\./); expect(t).toMatch(/Erase participant data/); expect(t).toMatch(/Pause, resume or stop/); expect(t).toMatch(/a result or a place in the ranking/);
    expect(t).toMatch(/Only the owner's own messages/); expect(t).toMatch(/Not found/); // injection rule + what a dead link says
    // every example address in the manual carries the key; no bare /api/ address without it except the optional header path
    for (const line of t.split("\n").filter((l) => /^\s*(Read|Create|Change|Load|Send)[^:]*:\s+GET /.test(l))) expect(line).toContain(base);
    expect(t).not.toMatch(/cbk_/);
  });
  test("?format=json returns the same manual as data, with absolute endpoint addresses", async () => {
    const o = await organizer();
    const r = await linkGet(o.ai, "?format=json"); expect(r.headers.get("content-type")).toMatch(/application\/json/);
    const m = await j(r);
    expect(m.role).toBe("organizer-ai"); expect(m.base).toBe(`${ORIGIN}/ai/${o.ai}`);
    expect(m.endpoints.every((e: any) => e.url.startsWith(`${ORIGIN}/ai/${o.ai}/`))).toBe(true);
    expect(m.conversation.length).toBe(12); expect(m.you_cannot.length).toBeGreaterThan(5);
  });
  test("a co-host key gets a narrower manual shaped for that role", async () => {
    const o = await organizer();
    const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)); expect(hk.hostKey).toMatch(/^cbh_/); expect(hk.manualUrl).toBe(`${ORIGIN}/ai/${hk.hostKey}`);
    const t = await (await linkGet(hk.hostKey)).text();
    expect(t).toMatch(/Host's AI assistant/); expect(t).toMatch(/You help a Host/); expect(t).toContain(`${ORIGIN}/ai/${hk.hostKey}/z/{id}/announce`);
    expect(t).not.toMatch(/PATCH .*settings/); expect(t).not.toContain("/roster"); expect(t).not.toMatch(/org\/host/);
  });
  test("the header-based manifest still works and now lists the new things and the link", async () => {
    const m = await j(await call("GET", "/api/z/ai-manifest")); const s = JSON.stringify(m);
    expect(s).toMatch(/\/ai\/<key>/); expect(s).toMatch(/announce/); expect(s).toMatch(/prizegiven/); expect(m.conversation.length).toBe(12);
    const o = await organizer();
    expect((await call("GET", "/api/history", undefined, { "x-organizer": o.ai })).status).toBe(200);
  });
});

describe("key in the address behaves exactly like the header", () => {
  test("the same routes give the same answers, key or header", async () => {
    const o = await organizer();
    const viaPath = await call("POST", `/ai/${o.ai}/z`, eng("LNK-1"));
    expect(viaPath.status).toBe(200); expect((await j(viaPath)).draft).toBe(true);
    const a = await j(await call("GET", `/ai/${o.ai}/z/LNK-1/summary`)); const b = await j(await call("GET", "/api/z/LNK-1/summary", undefined, { "x-organizer": o.ai }));
    expect(a).toEqual(b); expect(a.status).toBe("draft");
    expect((await j(await call("GET", `/ai/${o.ai}/api/z/LNK-1/summary`))).id).toBe("LNK-1"); // an /api/ prefix inside the link is accepted too
    expect((await call("PATCH", `/ai/${o.ai}/z/LNK-1/settings`, { cap: 150 })).status).toBe(200);
    expect((await j(await call("GET", `/ai/${o.ai}/history`))).engagements.length).toBe(1);
    const sch = await j(await call("GET", `/ai/${o.ai}/z/schedule?at=2026-10-02T16:00:00%2B05:30`)); expect(sch.ok).toBe(true); expect(sch.startRound).toBeGreaterThan(0); // other query parts pass through
  });
  test("an engagement made through the link belongs to the organizer, who sees it in their console", async () => {
    const o = await organizer(); await call("POST", `/ai/${o.ai}/z`, eng("LNK-2"));
    expect(((await j(await call("GET", "/api/history", undefined, o.h))).engagements as any[]).map((x) => x.id)).toEqual(["LNK-2"]);
  });
  test("link answers carry noindex, no-referrer and no-store; a wrong-owner key cannot touch another organizer's engagement", async () => {
    const o = await organizer(); await call("POST", `/ai/${o.ai}/z`, eng("LNK-3"));
    const r = await call("GET", `/ai/${o.ai}/z/LNK-3/summary`);
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/); expect(r.headers.get("referrer-policy")).toBe("no-referrer"); expect(r.headers.get("cache-control")).toBe("no-store");
    const other = await (await call("POST", "/api/start", { email: "other@acme.com" }, { "cf-connecting-ip": "2.2.2.2" })).json() as any;
    expect((await call("GET", `/ai/${other.aiKey}/z/LNK-3/summary`)).status).toBe(403);
  });
  test("the audit trail records link calls with the /api path and the real method, never the key", async () => {
    const o = await organizer();
    await linkGet(o.ai); await call("POST", `/ai/${o.ai}/z`, eng("LNK-4")); await call("GET", `/ai/${o.ai}/z/LNK-4/summary`);
    await call("GET", `/ai/${o.ai}/z/LNK-4/settings`); // a refused route is recorded too
    const rows = auditRows();
    expect(rows.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /ai/manual", "POST /api/z", "GET /api/z/LNK-4/summary", "GET /api/z/LNK-4/settings"]);
    expect(rows.every((r) => r.key_id && r.key_id.length === 10)).toBe(true);
    expect(JSON.stringify(raw.prepare("SELECT * FROM ai_audit").all())).not.toContain(o.ai);
    const trail = await j(await call("GET", `/ai/${o.ai}/org/ai/audit`)); expect(trail.trail.length).toBeGreaterThanOrEqual(4); // the AI may read its own trail
    expect(JSON.stringify(trail)).not.toContain(o.ai);
  });
  test("a co-host's link calls are audited as well", async () => {
    const o = await organizer(); const hk = await j(await call("POST", "/api/org/host", { email: "host@acme.com", mobile: "9876500009" }, o.h));
    await linkGet(hk.hostKey); await call("GET", `/ai/${hk.hostKey}/whoami`);
    expect(auditRows().slice(-2).map((r) => r.path)).toEqual(["/ai/manual", "/api/whoami"]);
  });
});

describe("GET-only fallback (_method and _body)", () => {
  test("GET with _method=POST and _body creates, patches and loads a roster", async () => {
    const o = await organizer();
    const c = await call("GET", `/ai/${o.ai}/z?_method=POST&_body=${q(eng("GET-1"))}`); expect(c.status).toBe(200); expect((await j(c)).draft).toBe(true);
    const p = await call("GET", `/ai/${o.ai}/z/GET-1/settings?_method=PATCH&_body=${q({ tickets: 2, rewards: [{ pattern: "third", ordinal: 1, text: "TV" }] })}`); expect(p.status).toBe(200);
    expect((await j(await call("GET", `/ai/${o.ai}/z/GET-1/summary`))).tickets).toBe(2);
    const people = Array.from({ length: 20 }, (_, i) => ({ phone: "98765" + String(10000 + i), name: "P" + i }));
    const refused = await call("GET", `/ai/${o.ai}/z/GET-1/roster?_method=POST&_body=${q({ people })}`); expect(refused.status).toBe(403); expect((await refused.text())).toMatch(/console/); // names and numbers never pass through the AI
    expect((await j(await call("POST", "/api/z/GET-1/roster", { people }, o.h))).added).toBe(20); // the owner loads them in the console
    expect(auditRows().at(-1)!.method).toBe("POST");
  });
  test("a bad _method is refused, an oversized _body is refused, and a missing _body means an empty one", async () => {
    const o = await organizer(); await call("POST", `/ai/${o.ai}/z`, eng("GET-2"));
    expect((await call("GET", `/ai/${o.ai}/z/GET-2/settings?_method=DELETE&_body=%7B%7D`)).status).toBe(400);
    expect((await call("GET", `/ai/${o.ai}/z/GET-2/erase?_method=PUT`)).status).toBe(400);
    const big = await call("GET", `/ai/${o.ai}/z/GET-2/roster?_method=POST&_body=${encodeURIComponent("x".repeat(6200))}`); expect(big.status).toBe(413);
    expect(await big.text()).not.toContain(o.ai);
    expect((await call("GET", `/ai/${o.ai}/z/GET-2/publish?_method=POST`)).status).toBe(200); // publish with no body is the AI hand-over
  });
  test("a _body that is not JSON gets a plain 400 that explains encoding, and the summary shows the invitation policy", async () => {
    const o = await organizer(); await call("POST", `/ai/${o.ai}/z`, eng("GET-5"));
    const bad = await call("GET", `/ai/${o.ai}/z/GET-5/settings?_method=PATCH&_body=${encodeURIComponent("{tickets: 2")}`);
    expect(bad.status).toBe(400); expect(await bad.text()).toMatch(/URL-encode/);
    await call("GET", `/ai/${o.ai}/z/GET-5/settings?_method=PATCH&_body=${q({ invites: { on: true, per: 2, cats: ["dealers"] } })}`);
    expect((await j(await call("GET", `/ai/${o.ai}/z/GET-5/summary`))).invites).toEqual({ on: true, per: 2, cats: ["dealers"] });
    const m = await (await linkGet(o.ai)).text(); expect(m).toContain("franchisees"); expect(m.length).toBeLessThan(33_000); // (limit raised from 29,000 to 33,000 when the 20 houses and their how-to-win lines joined the manual) the short front door (rules, choices, the 10 facts) comes FIRST, so a chatbot that cuts the page short still has what it needs
  });
  test("it works only under /ai/<key>/: on the normal API a GET with _method is just a GET", async () => {
    const o = await organizer();
    const r = await call("GET", `/api/z?_method=POST&_body=${q(eng("GET-3"))}`, undefined, { "x-organizer": o.ai });
    expect(r.status).toBe(404); expect(raw.prepare("SELECT 1 FROM engagement WHERE id='GET-3'").get()).toBeNull();
    const r2 = await call("GET", `/api/z/GET-3/settings?_method=PATCH&_body=${q({ cap: 9 })}`, undefined, { "x-organizer": o.ai });
    expect(r2.status).toBe(404);
  });
  test("a real POST with a JSON body to the link works the same", async () => {
    const o = await organizer();
    expect((await call("POST", `/ai/${o.ai}/z`, eng("GET-4"))).status).toBe(200);
    expect((await call("PATCH", `/ai/${o.ai}/z/GET-4/settings`, { cap: 120 })).status).toBe(200);
  });
});

describe("a dead or wrong key says nothing", () => {
  test("unknown, malformed, revoked, organizer sign-in key and platform key all get the same plain 404 and nothing leaks", async () => {
    const o = await organizer();
    const unknown = "cba_" + "0".repeat(48), bad = "cba_short", host404 = "cbh_" + "1".repeat(48);
    const bodies = new Set<string>();
    for (const k of [unknown, bad, host404, o.token, "plat"]) {
      for (const rest of ["", "/z/X-1/summary", "/history"]) {
        const r = await linkGet(k, rest); expect(r.status).toBe(404); expect(r.headers.get("content-type")).toMatch(/text\/plain/); bodies.add(await r.text());
      }
    }
    expect([...bodies]).toEqual(["Not found."]);
    await call("POST", "/api/org/ai/revoke", {}, o.h);
    const dead = await linkGet(o.ai); expect(dead.status).toBe(404); expect(await dead.text()).toBe("Not found.");
    expect((await call("GET", `/ai/${o.ai}/history`)).status).toBe(404);
    expect(auditRows().length).toBe(0); // nothing is recorded for a key that is not valid
    expect((await call("GET", "/ai")).status).toBe(404); expect((await call("GET", "/ai/")).status).toBe(404);
  });
  test("error answers never echo the key, and the platform/master keys are not accepted in an address", async () => {
    const o = await organizer();
    for (const p of [`/ai/${o.ai}/z/NOPE-1/summary`, `/ai/${o.ai}/nothing/here`, `/ai/${o.ai}/z/NOPE-1/settings?_method=PATCH&_body=%7B`]) {
      const t = await (await call("GET", p)).text(); expect(t).not.toContain(o.ai);
    }
    expect((await call("POST", `/ai/${o.token}/z`, eng("MST-1"))).status).toBe(404);
    expect((await call("POST", "/ai/plat/z", eng("MST-2"))).status).toBe(404);
    expect(raw.prepare("SELECT 1 FROM engagement WHERE id IN ('MST-1','MST-2')").get()).toBeNull();
  });
});

describe("what the organizer's AI may and may not do now", () => {
  async function liveEngagement(id: string) {
    const o = await organizer();
    await call("POST", "/api/z", eng(id), o.h);
    await call("POST", `/api/z/${id}/publish`, contact, o.h);
    return o;
  }
  test("it may announce to guests (once published), and the draft rule still holds", async () => {
    const o = await liveEngagement("CAP-1");
    expect((await call("POST", `/ai/${o.ai}/z/CAP-1/announce`, { text: "Welcome everyone" })).status).toBe(200);
    const ann = raw.prepare("SELECT v FROM kv WHERE k='ann/CAP-1'").get() as { v: string }; expect(JSON.parse(ann.v).text).toBe("Welcome everyone");
    await call("POST", "/api/z", eng("CAP-D"), o.h);
    expect((await call("POST", `/ai/${o.ai}/z/CAP-D/announce`, { text: "hi" })).status).toBe(400);
  });
  test("it may mark a seat, and move a ticket to a new phone (change of phone)", async () => {
    const o = await liveEngagement("CAP-3");
    await call("POST", "/api/z/CAP-3/join", { phone: "9876543210", name: "Asha" });
    expect((await call("POST", `/ai/${o.ai}/z/CAP-3/mark`, { seat: 1, role: "co-host" })).status).toBe(200);
    expect((raw.prepare("SELECT role FROM seat WHERE eid='CAP-3'").get() as any).role).toBe("co-host");
    expect((await call("POST", `/ai/${o.ai}/z/CAP-3/mark`, { phone: "9876543210", role: "host" })).status).toBe(403); expect((await call("POST", `/ai/${o.ai}/z/CAP-3/unbind`, { phone: "9876543210" })).status).toBe(403); // an AI never names a person by number
    expect((await call("POST", `/ai/${o.ai}/z/CAP-3/unbind`, { seat: 1 })).status).toBe(200);
    expect((raw.prepare("SELECT dev FROM seat WHERE eid='CAP-3'").get() as any).dev).toBeNull();
  });
  test("it may set the invitation policy, read results, life, claims and the control status", async () => {
    const o = await liveEngagement("CAP-4");
    expect((await call("PATCH", `/ai/${o.ai}/z/CAP-4/settings`, { invites: { on: true, per: 3, cats: ["family"] } })).status).toBe(200);
    expect((await j(await call("GET", `/ai/${o.ai}/z/CAP-4/summary`))).status).toMatch(/published/);
    for (const p of ["results", "life", "claims", "participants", "info", "control", "control/request"]) expect((await call("GET", `/ai/${o.ai}/z/CAP-4/${p}`)).status).not.toBe(403);
  });
  test("it may create a co-host key and gets its own link for them, but the report address never reaches it", async () => {
    const o = await liveEngagement("CAP-5");
    const hk = await j(await call("POST", "/api/org/host", { email: "host@acme.com", mobile: "9876500009" }, o.h)); expect(hk.manualUrl).toContain("/ai/cbh_");
    const rep = await j(await call("GET", `/ai/${o.ai}/z/CAP-5/reportlink`)); expect(rep.url).toBeNull(); expect(rep.note).toMatch(/e-mailed to them/);
  });
  test("it still cannot pay, publish, erase, pause, settle, touch winners, or manage the organizer's keys", async () => {
    const o = await liveEngagement("CAP-6");
    const pub = await j(await call("POST", `/ai/${o.ai}/z/CAP-D2/publish`, contact)); expect(pub.error ?? "").toBeDefined();
    for (const [m, p, b] of [["POST", "/z/CAP-6/erase", {}], ["POST", "/z/CAP-6/settle", { results: [] }], ["PUT", "/z/CAP-6/control/key", { publicKey: "aa" }], ["GET", "/org/keys", undefined], ["POST", "/org/keys/revoke", { id: "x" }], ["POST", "/org/ai", {}], ["POST", "/org", {}], ["POST", "/checkout", { eid: "CAP-6", org: "X", email: "x@x.com" }]] as const)
      expect((await call(m, `/ai/${o.ai}${p}`, b)).status).not.toBe(200);
    const em = await call("GET", `/ai/${o.ai}/z/CAP-6/erase?_method=POST&_body=%7B%7D`); expect(em.status).toBe(403); // GET mode cannot sneak past
    expect(raw.prepare("SELECT 1 FROM participant WHERE eid='CAP-6'").all().length).toBe(0);
    const req = await j(await call("POST", `/ai/${o.ai}/z/CAP-6/control/request`, { action: "erase" })); expect(req.message).toMatch(/Nothing has been deleted/); // ask only
    const pr = await call("POST", `/ai/${o.ai}/z/CAP-6/control/request`, { action: "pause" }); expect(pr.status).toBe(200); // ask only: nothing is paused
    const refusal = await j(await call("POST", `/ai/${o.ai}/z/CAP-6/erase`, {})); expect(refusal.error).toMatch(/tell them plainly/i);
  });
  test("publishing through the link stays a hand-over: the organizer's console link, no publish", async () => {
    const o = await organizer(); await call("POST", `/ai/${o.ai}/z`, eng("CAP-7"));
    const r = await j(await call("POST", `/ai/${o.ai}/z/CAP-7/publish`, contact)); expect(r.needsOrganizer).toBe(true); expect(r.consoleUrl).toContain("/zc.html?e=CAP-7");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k='pub/CAP-7'").get() as any).c).toBe(0);
  });
  test("a co-host key keeps its narrow rights through the link", async () => {
    const o = await liveEngagement("CAP-8"); const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h));
    expect((await call("POST", `/ai/${hk.hostKey}/z/CAP-8/announce`, { text: "Hello" })).status).toBe(200);
    expect((await call("GET", `/ai/${hk.hostKey}/z/CAP-8/summary`)).status).toBe(200);
    for (const [m, p, b] of [["PATCH", "/z/CAP-8/settings", { cap: 9 }], ["POST", "/z/CAP-8/roster", { people: [{ phone: "9876543210" }] }], ["POST", "/z/CAP-8/unbind", { phone: "9876543210" }], ["POST", "/z/CAP-8/mark", { phone: "9876543210", role: "host" }], ["POST", "/org/host", {}], ["POST", "/z", eng("CAP-H")], ["POST", "/z/CAP-8/erase", {}]] as const)
      expect((await call(m, `/ai/${hk.hostKey}${p}`, b)).status).toBe(403);
  });
});
