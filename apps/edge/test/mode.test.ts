// TEST / LIVE mode (src/mode.ts, test-data.ts, migration 0013). Plain words: docs/TEST_AND_LIVE_MODE.md.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { retryOutbox, sendReportMail, sentReports, type PayEnv } from "../src/pay";
import { normMail, setMode, getMode } from "../src/mode";
import { resetRate } from "../src/visits";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 6, 10, 0, 0);
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[];
const one = (sql: string, ...a: any[]) => raw.prepare(sql).get(...a) as any;
const PLAT = { "x-organizer": "plat" };
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const FUT = roundAt(T) + 1200;
const eng = (id: string, cap = 100) => ({ id, startRound: FUT, callSeconds: 6, cap });
const OWNER = "owner@example.com";

beforeEach(() => {
  const d = makeD1(); raw = d.raw; resetRate(); sentReports.length = 0;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "dk", PHONE_SALT: "salt", OWNER_EMAIL: OWNER };
});
const toTest = async (reason = "walk-through") => { const r = await call("POST", "/api/owner/mode", { mode: "TEST", reason }, PLAT); expect(r.status).toBe(200); };
const toLive = async () => { const r = await call("POST", "/api/owner/mode", { mode: "LIVE", reason: "back" }, PLAT); expect(r.status).toBe(200); };
async function organizer(email: string, ip = "1.1.1.1") {
  const r = await call("POST", "/api/start", { email }, { "cf-connecting-ip": ip }); const b = await j(r); expect(r.status).toBe(200);
  return { h: { "x-organizer": b.token as string }, ai: b.aiKey as string };
}
const pubBody = { email: "boss@acme.com", phone: "98765 43210" };

describe("the mode row and its switch", () => {
  test("the default is LIVE, and the public read shows only the word", async () => {
    const r = await call("GET", "/api/mode"); expect(r.status).toBe(200);
    expect(await j(r)).toEqual({ mode: "LIVE" });
    expect(await getMode(env)).toBe("LIVE");
  });
  test("only the owner (platform key, not through an AI link) can switch; everyone else gets the same 404 as an unknown address", async () => {
    const o = await organizer("boss@acme.com");
    for (const h of [{}, o.h, { "x-organizer": o.ai }, { "x-organizer": "wrong" }, { ...PLAT, "x-cb-link": "1" }]) {
      const r = await call("POST", "/api/owner/mode", { mode: "TEST" }, h as any); expect(r.status).toBe(404); expect(await j(r)).toEqual({ error: "Not found" });
    }
    expect(await j(await call("GET", "/api/mode"))).toEqual({ mode: "LIVE" });
    expect(q("SELECT action FROM audit_access WHERE action LIKE 'denied:mode'").length).toBe(5); // every try is on the owner's access log
    expect((await call("POST", "/api/owner/mode", { mode: "SIDEWAYS" }, PLAT)).status).toBe(400);
    expect((await call("GET", "/api/owner/mode", undefined, o.h)).status).toBe(404);
  });
  test("a switch is visible at once, carries the reason and time, and is written to the access log", async () => {
    await toTest("rehearsal for Friday");
    expect(await j(await call("GET", "/api/mode"))).toEqual({ mode: "TEST" });
    const m = await j(await call("GET", "/api/owner/mode", undefined, PLAT)); expect(m).toEqual({ mode: "TEST", changedMs: T, reason: "rehearsal for Friday" });
    const row = one("SELECT action, note, ok FROM audit_access WHERE action='mode-switch'"); expect(row.note).toBe("LIVE->TEST: rehearsal for Friday"); expect(row.ok).toBe(1);
    await toLive(); expect(await j(await call("GET", "/api/mode"))).toEqual({ mode: "LIVE" });
    expect(q("SELECT note FROM audit_access WHERE action='mode-switch' ORDER BY id").map((r) => r.note)).toEqual(["LIVE->TEST: rehearsal for Friday", "TEST->LIVE: back"]);
  });
  test("the mode is cached for a few seconds, and read again after that", async () => {
    await toTest();
    raw.run("UPDATE mode SET mode='LIVE' WHERE id=1"); // changed behind the Worker's back
    expect(await getMode(env)).toBe("TEST"); // still the cached answer
    const realNow = Date.now; try { Date.now = () => realNow() + 6000; expect(await getMode(env)).toBe("LIVE"); } finally { Date.now = realNow; }
  });
  test("if the row cannot be read, the last known mode is kept (a TEST service never quietly turns LIVE)", async () => {
    await toTest();
    raw.run("DROP TABLE mode");
    const realNow = Date.now; try { Date.now = () => realNow() + 6000; expect(await getMode(env)).toBe("TEST"); } finally { Date.now = realNow; }
  });
  test("the start clock is the same in both modes", async () => {
    const at = "2026-10-07T16:00:00+05:30";
    const live = await j(await call("GET", `/api/z/schedule?at=${at}`)); await toTest(); const test = await j(await call("GET", `/api/z/schedule?at=${at}`));
    expect(test).toEqual(live);
    const o = await organizer("a@acme.com"); await call("POST", "/api/z", eng("CLOCK-1"), o.h);
    expect(one("SELECT start_round, call_seconds FROM engagement WHERE id='CLOCK-1'")).toEqual({ start_round: FUT, call_seconds: 6 });
  });
});

describe("e-mail in TEST mode goes only to the owner's allow-list", () => {
  test("LIVE: mail goes out as before, with no test prefix and nothing logged", async () => {
    await organizer("boss@acme.com");
    const sent = q("SELECT to_addr, subject FROM outbox"); expect(sent.length).toBe(1); expect(sent[0].to_addr).toBe("boss@acme.com"); expect(sent[0].subject).not.toContain("[TEST]");
    expect(q("SELECT * FROM mail_event").length).toBe(0);
  });
  test("TEST: a stranger's mail is dropped and logged as suppressed_test_mode (no address kept); the owner's reaches the outbox marked [TEST]", async () => {
    await toTest();
    await organizer("boss@acme.com"); // the AI-link mail would go to a real-looking person
    expect(q("SELECT * FROM outbox").length).toBe(0);
    const ev = q("SELECT outcome, to_hash, subject FROM mail_event"); expect(ev.length).toBe(1); expect(ev[0].outcome).toBe("suppressed_test_mode"); expect(ev[0].to_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toContain("acme");
    await organizer(OWNER, "2.2.2.2"); // the default allow-list is the owner's own address (OWNER_EMAIL)
    const sent = q("SELECT to_addr, subject, body FROM outbox"); expect(sent.length).toBe(1); expect(sent[0].to_addr).toBe(OWNER); expect(sent[0].subject.startsWith("[TEST] ")).toBe(true);
    expect(q("SELECT outcome FROM mail_event ORDER BY id").map((r) => r.outcome)).toEqual(["suppressed_test_mode", "sent_test_allowlist"]);
  });
  test("plus-addresses of the owner count as the owner (many test accounts, one inbox)", async () => {
    expect(normMail("Owner+T1@Example.com")).toBe(OWNER);
    await toTest(); await organizer("owner+t1@example.com");
    expect(q("SELECT to_addr FROM outbox").map((r) => r.to_addr)).toEqual(["owner+t1@example.com"]);
  });
  test("the allow-list is the owner's to manage; once it has entries it replaces the default", async () => {
    const o = await organizer("boss@acme.com");
    expect((await call("GET", "/api/owner/test-mail", undefined, o.h)).status).toBe(404);
    expect((await call("POST", "/api/owner/test-mail", { add: "qa@example.com" }, o.h)).status).toBe(404);
    expect((await j(await call("GET", "/api/owner/test-mail", undefined, PLAT))).allowed).toEqual([OWNER]);
    expect((await j(await call("POST", "/api/owner/test-mail", { add: "QA@example.com" }, PLAT))).allowed).toEqual(["qa@example.com"]);
    expect((await call("POST", "/api/owner/test-mail", { add: "nonsense" }, PLAT)).status).toBe(400);
    await toTest(); q("DELETE FROM outbox");
    await organizer(OWNER, "3.3.3.3"); expect(q("SELECT * FROM outbox").length).toBe(0); // the owner's own address is not on the list now
    await organizer("qa@example.com", "4.4.4.4"); expect(q("SELECT to_addr FROM outbox").map((r) => r.to_addr)).toEqual(["qa@example.com"]);
    await call("POST", "/api/owner/test-mail", { remove: "qa@example.com" }, PLAT);
    expect((await j(await call("GET", "/api/owner/test-mail", undefined, PLAT))).allowed).toEqual([OWNER]); // empty again: back to the default
    expect(q("SELECT note FROM audit_access WHERE action='test-mail-allowlist'").length).toBe(2);
  });
  test("with no owner address configured anywhere, nothing at all is sent", async () => {
    env.OWNER_EMAIL = undefined; await toTest(); await organizer("boss@acme.com"); await organizer(OWNER, "5.5.5.5");
    expect(q("SELECT * FROM outbox").length).toBe(0);
  });
  test("the report mail follows the same rule (handled, not sent) and so does the daily retry of old mail", async () => {
    await toTest();
    expect(await sendReportMail(env, "boss@acme.com", "Report", "hello", [])).toBe(true); expect(sentReports.length).toBe(0);
    expect(await sendReportMail(env, OWNER, "Report", "hello", [])).toBe(true); expect(sentReports.length).toBe(1); expect(sentReports[0]!.subject).toBe("[TEST] [Tic Tac Toe] "+"Report");
    expect(q("SELECT outcome FROM mail_event ORDER BY id").map((r) => r.outcome)).toEqual(["suppressed_test_mode", "sent_test_allowlist"]);
    // a real mail queued before the switch is not sent now
    raw.run("INSERT INTO outbox(to_addr,subject,body,at_ms,sent) VALUES('real@person.com','Hi','body',?,0)", [T]);
    const realFetch = globalThis.fetch; let calls = 0; (globalThis as any).fetch = async () => { calls++; return new Response("{}", { status: 200 }); };
    try { env.RESEND_API_KEY = "re_test"; expect((await retryOutbox(env, T + 1000)).retried).toBe(0); expect(calls).toBe(0); await toLive(); expect((await retryOutbox(env, T + 1000)).retried).toBe(1); expect(calls).toBe(1); }
    finally { (globalThis as any).fetch = realFetch; env.RESEND_API_KEY = undefined; }
  });
  test("a TEST mail never carries the banner wording, and the subject marker is the only trace", async () => {
    await toTest(); await organizer(OWNER);
    const m = one("SELECT subject, body FROM outbox"); expect(m.subject).toMatch(/^\[TEST\] /); expect(m.body).not.toMatch(/TEST MODE/);
  });
});

describe("test payment path", () => {
  const body = (eid: string, extra: Record<string, unknown> = {}) => ({ pack: 100, email: "boss@acme.com", org: "Acme", country: "IN", eid, ...extra });
  test("LIVE refuses the labelled test path, and the normal checkout is unchanged (not switched on here)", async () => {
    const o = await organizer("boss@acme.com"); await call("POST", "/api/z", eng("PPP-1"), o.h);
    const r = await call("POST", "/api/payments/test", body("PPP-1"), o.h); expect(r.status).toBe(403); expect((await j(r)).error).toMatch(/only available while the service is in test mode/);
    expect((await call("POST", "/api/checkout", body("PPP-1"), o.h)).status).toBe(503);
    expect(q("SELECT * FROM payment").length).toBe(0); expect(one("SELECT pack FROM engagement WHERE id='PPP-1'").pack).toBe(0);
  });
  test("TEST: the test path marks the draft paid and published without Razorpay, flagged is_test, with a TEST invoice outside the real number series", async () => {
    await toTest();
    const o = await organizer("boss@acme.com"); await call("POST", "/api/z", eng("PPP-2"), o.h);
    const r = await call("POST", "/api/payments/test", body("PPP-2"), o.h); const b = await j(r); expect(r.status).toBe(200);
    expect(b.mode).toBe("test"); expect(b.testPayment).toBe(true); expect(b.label).toMatch(/TEST payment/); expect(b.result.published).toBe(true);
    expect(one("SELECT status, is_test, rzp_order_id FROM payment")).toEqual({ status: "paid", is_test: 1, rzp_order_id: null });
    expect(one("SELECT pack FROM engagement WHERE id='PPP-2'").pack).toBe(100);
    const inv = one("SELECT number, seq, data FROM invoice"); expect(inv.number).toMatch(/^TEST-/); expect(inv.seq).toBeLessThan(0); expect(JSON.parse(inv.data).draft).toBe(true);
    // the normal checkout in TEST is the same labelled path (no Razorpay order is ever made while testing)
    env.RAZORPAY_KEY_ID = "k"; env.RAZORPAY_KEY_SECRET = "s";
    await call("POST", "/api/z", eng("PPP-3"), o.h); const c = await j(await call("POST", "/api/checkout", body("PPP-3"), o.h)); expect(c.mode).toBe("test"); expect(c.result.published).toBe(true);
    expect(q("SELECT is_test FROM payment").map((r) => r.is_test)).toEqual([1, 1]);
    // back in LIVE a real purchase takes number 1 of the real series
    await toLive(); env.RAZORPAY_KEY_ID = undefined; env.RAZORPAY_KEY_SECRET = undefined; env.TEST_MODE = "1";
    const live = await j(await call("POST", "/api/checkout", { pack: 100, email: "real@buyer.com", org: "Real Co", country: "IN" }));
    expect(live.result.invoiceNumber).toMatch(/\/0*1$|-0*1$/); expect(one("SELECT is_test FROM payment WHERE email='real@buyer.com'").is_test).toBe(0);
    expect(one("SELECT seq FROM invoice WHERE number=?", live.result.invoiceNumber).seq).toBe(1);
  });
});

describe("flag propagation", () => {
  test("everything made in TEST mode carries is_test; everything made in LIVE does not", async () => {
    env.TEST_MODE = "1"; // lets the partner flow hand back its code in the answer
    const live = await organizer("live@acme.com"); await call("POST", "/api/z", eng("LLL-1"), live.h);
    await toTest();
    const t = await organizer("test@acme.com", "7.7.7.7"); await call("POST", "/api/z", eng("TTT-1"), t.h);
    await call("POST", "/api/z", eng("T-LIVEORG"), live.h); // a real account building while TEST is on: that engagement is a test one
    const en = await j(await call("POST", "/api/partner/enroll", { phone: "9811122233", email: "p@partner.example", name: "P", consent: true })); expect(en.devCode).toBeTruthy();
    expect((await call("POST", "/api/partner/enroll/verify", { email: "p@partner.example", code: en.devCode })).status).toBe(200);
    await call("POST", "/api/payments/test", { pack: 100, email: "test@acme.com", org: "Acme", country: "IN", eid: "TTT-1" }, t.h);
    expect(q("SELECT id, is_test FROM engagement ORDER BY id")).toEqual([{ id: "LLL-1", is_test: 0 }, { id: "T-LIVEORG", is_test: 1 }, { id: "TTT-1", is_test: 1 }]);
    expect(q("SELECT k.is_test AS t, count(*) AS c FROM organizer_key k GROUP BY k.is_test ORDER BY k.is_test")).toEqual([{ t: 0, c: 3 }, { t: 1, c: 3 }]);
    expect(q("SELECT is_test FROM organizer_email ORDER BY rowid").map((r) => r.is_test)).toEqual([0, 1]);
    expect(q("SELECT is_test FROM partner").map((r) => r.is_test)).toEqual([1]);
    expect(q("SELECT is_test FROM payment").map((r) => r.is_test)).toEqual([1]);
    await toLive(); const p = await j(await call("POST", "/api/partner/enroll", { phone: "9822233344", email: "q@partner.example", consent: true }));
    await call("POST", "/api/partner/enroll/verify", { email: "q@partner.example", code: p.devCode });
    expect(q("SELECT is_test FROM partner ORDER BY enrolled_ms, rowid").map((r) => r.is_test).sort()).toEqual([0, 1]);
  });
  test("a commission from a test payment is a test commission and stays out of the owner's partner figures", async () => {
    env.TEST_MODE = "1";
    const live = async (email: string, phone: string) => { const en = await j(await call("POST", "/api/partner/enroll", { phone, email, consent: true })); const v = await j(await call("POST", "/api/partner/enroll/verify", { email, code: en.devCode })); return v as { code: string; partnerKey: string }; };
    const real = await live("real@partner.example", "9811100001");
    await toTest();
    const test = await live("tp@partner.example", "9811100002");
    await call("POST", "/api/checkout", { pack: 100, email: "buyer1@x.com", org: "B1", country: "IN", ref: real.code }); // a test purchase "through" the real partner's link
    expect(one("SELECT is_test FROM commission").is_test).toBe(1);
    expect((await j(await call("GET", "/api/partner/me", undefined, { "x-partner": real.partnerKey }))).totals.sales).toBe(0); // the real partner sees nothing from a test sale
    expect((await j(await call("GET", "/api/partner/me", undefined, { "x-partner": test.partnerKey }))).totals.sales).toBe(0);
    const list = await j(await call("GET", "/api/partners", undefined, PLAT)); expect(list.partners.map((p: any) => p.code)).toEqual([real.code]); expect(list.partners[0].sales).toBe(0);
    const lt = await j(await call("GET", "/api/partners?mode=test", undefined, PLAT)); expect(lt.partners.map((p: any) => p.code)).toEqual([test.code]);
    // the rate decision and payouts never touch test rows
    raw.run("UPDATE commission SET status='pending_rate', rate=NULL, amount=NULL");
    expect((await j(await call("POST", "/api/partners/commission/rate", { rate: 0.4 }, PLAT))).applied).toBe(0);
    await toLive();
    await call("POST", "/api/checkout", { pack: 100, email: "buyer2@x.com", org: "B2", country: "IN", ref: real.code });
    expect((await j(await call("GET", "/api/partner/me", undefined, { "x-partner": real.partnerKey }))).totals.sales).toBe(1);
    expect(q("SELECT is_test FROM commission ORDER BY id").map((r) => r.is_test)).toEqual([1, 0]);
  });
  test("the owner's engagement list shows real engagements unless ?mode=test is asked for", async () => {
    const live = await organizer("live@acme.com"); await call("POST", "/api/z", eng("LLL-2"), live.h);
    await toTest(); await call("POST", "/api/z", eng("TTT-2"), live.h);
    expect((await j(await call("GET", "/api/history", undefined, PLAT))).engagements.map((e: any) => e.id)).toEqual(["LLL-2"]);
    expect((await j(await call("GET", "/api/history?mode=test", undefined, PLAT))).engagements.map((e: any) => e.id)).toEqual(["TTT-2"]);
  });
});

describe("visitor reports and funnels leave test data out", () => {
  const beacon = (sid: string, vid: string, now = T) => { const r = new Request("http://x/api/v/b", { method: "POST", headers: { origin: "http://x", "content-type": "text/plain", "cf-connecting-ip": "203.0.113.5", "user-agent": UA }, body: JSON.stringify({ s: sid, d: vid, lp: "/", r: "", dv: "mobile", l: "en-IN", e: [{ k: "pv", p: "/" }, { k: "act", p: "/", n: "pack", v: "₹1", z: 100 }] }) }); return handle(r, env as Env, now); };
  test("sessions made in TEST are flagged, hidden from the default summary, and shown only on request; a private (GPC) test visit leaves no counter", async () => {
    await beacon("a1".repeat(12), "11".repeat(16));
    await toTest(); await beacon("b2".repeat(12), "22".repeat(16));
    const g = new Request("http://x/api/v/b", { method: "POST", headers: { origin: "http://x", "content-type": "text/plain", "cf-connecting-ip": "203.0.113.6", "user-agent": UA, "sec-gpc": "1" }, body: JSON.stringify({ s: "c3".repeat(12), d: "33".repeat(16), g: 1, lp: "/", e: [{ k: "pv", p: "/" }] }) });
    await handle(g, env as Env, T); expect(q("SELECT * FROM visit_agg").length).toBe(0);
    expect(q("SELECT is_test FROM visit_session ORDER BY first_ms, rowid").map((r) => r.is_test)).toEqual([0, 1]);
    const live = await j(await call("GET", "/api/owner/visits/summary?from=2026-10-01&to=2026-10-31", undefined, PLAT)); expect(live.humans.sessions).toBe(1); expect(live.mode).toBe("live");
    expect(live.funnel[0].visitors).toBe(1); expect(live.actions.find((a: any) => a.name === "pack").n).toBe(1);
    const test = await j(await call("GET", "/api/owner/visits/summary?from=2026-10-01&to=2026-10-31&mode=test", undefined, PLAT)); expect(test.humans.sessions).toBe(1); expect(test.mode).toBe("test");
  });
  test("a test account's publish and payment never move the funnel, and its sign-up never claims a real visitor's earlier visit", async () => {
    await beacon("a1".repeat(12), "11".repeat(16)); // a real visitor, in LIVE
    await toTest();
    const r = await call("POST", "/api/start", { email: "t@acme.com" }, { "cf-connecting-ip": "9.9.9.9", "x-cb-vid": "11".repeat(16), "x-cb-vs": "a1".repeat(12) }); const t = { "x-organizer": (await j(r)).token };
    await call("POST", "/api/z", eng("FFF-1"), t); await call("POST", "/api/payments/test", { pack: 100, email: "t@acme.com", org: "T", country: "IN", eid: "FFF-1" }, t);
    const s = one("SELECT org, stage FROM visit_session"); expect(s.org).toBeNull(); expect(s.stage).toBeLessThanOrEqual(2); // the visitor looked at sizes, nothing more
    expect(q("SELECT * FROM visit_event WHERE kind='fun'").length).toBe(0);
    expect(q("SELECT * FROM visit_agg WHERE dim='gpc_fun'").length).toBe(0);
  });
  test("the age-limit sweep forgets test visits without rolling them into the anonymous totals", async () => {
    await toTest(); await beacon("b2".repeat(12), "22".repeat(16), T - 400 * 86_400_000);
    const { sweepVisits } = await import("../src/visits"); await sweepVisits(env, T);
    expect(q("SELECT * FROM visit_session").length).toBe(0); expect(q("SELECT * FROM visit_agg").length).toBe(0);
  });
});

describe("purging test data", () => {
  async function world() {
    env.TEST_MODE = "1";
    const live = await organizer("live@acme.com"); await call("POST", "/api/z", eng("LLL-9"), live.h);
    await call("POST", "/api/checkout", { pack: 100, email: "live@acme.com", org: "Live Co", country: "IN", eid: "LLL-9" }, live.h);
    await call("POST", "/api/z/suggestions", { kind: "feature", title: "A real idea", body: "Something useful for everyone." }, live.h);
    const en = await j(await call("POST", "/api/partner/enroll", { phone: "9811100009", email: "lp@partner.example", consent: true })); await call("POST", "/api/partner/enroll/verify", { email: "lp@partner.example", code: en.devCode });
    await toTest();
    const t = await organizer("test@acme.com", "6.6.6.6"); await call("POST", "/api/z", eng("TTT-9"), t.h);
    await call("POST", "/api/z/TTT-9/publish", pubBody, t.h);
    await call("POST", "/api/payments/test", { pack: 100, email: "test@acme.com", org: "Test Co", country: "IN", eid: "TTT-9" }, t.h);
    await call("POST", "/api/z/suggestions", { kind: "feature", title: "A test idea", body: "Only for the walk-through." }, t.h);
    const tp = await j(await call("POST", "/api/partner/enroll", { phone: "9811100010", email: "tp@partner.example", consent: true })); await call("POST", "/api/partner/enroll/verify", { email: "tp@partner.example", code: tp.devCode });
    await call("POST", "/api/z/TTT-9/join", { phone: "9876543210", name: "Tess", device: "dev1" });
    return { live, t };
  }
  const counts = () => ({
    eng: q("SELECT id FROM engagement ORDER BY id").map((r) => r.id), keys: one("SELECT COUNT(*) c FROM organizer_key").c, emails: one("SELECT COUNT(*) c FROM organizer_email").c, pay: one("SELECT COUNT(*) c FROM payment").c,
    inv: one("SELECT COUNT(*) c FROM invoice").c, ent: one("SELECT COUNT(*) c FROM entitlement").c, partner: one("SELECT COUNT(*) c FROM partner").c, sugg: one("SELECT COUNT(*) c FROM suggestion").c,
  });
  test("it is owner-only, needs the confirmation words, and deletes only what is flagged test (accounts, engagements, payments, partners, their rows)", async () => {
    const { t } = await world();
    const before = counts(); expect(before.eng).toEqual(["LLL-9", "TTT-9"]);
    const auditBefore = one("SELECT COUNT(*) c FROM audit_log").c; expect(auditBefore).toBeGreaterThan(0);
    for (const h of [{}, t.h, { ...PLAT, "x-cb-link": "1" }]) expect((await call("POST", "/api/owner/purge-test-data", { confirm: "purge test data" }, h as any)).status).toBe(404);
    expect((await call("POST", "/api/owner/purge-test-data", {}, PLAT)).status).toBe(400);
    expect(counts()).toEqual(before); // nothing yet
    const r = await call("POST", "/api/owner/purge-test-data", { confirm: "purge test data" }, PLAT); const b = await j(r); expect(r.status).toBe(200);
    expect(b.deleted).toMatchObject({ engagements: 1, payments: 1, partners: 1, accounts: 1 });
    expect(counts()).toEqual({ eng: ["LLL-9"], keys: 3, emails: 1, pay: 1, inv: 1, ent: 1, partner: 1, sugg: 1 });
    expect(q("SELECT * FROM participant WHERE eid='TTT-9'").length).toBe(0); expect(q("SELECT * FROM seat WHERE eid='TTT-9'").length).toBe(0);
    expect(q("SELECT * FROM kv WHERE k LIKE '%TTT-9%'").length).toBe(0); expect(q("SELECT * FROM kv WHERE k LIKE 'orgmail/%'").length).toBe(1);
    expect(q("SELECT * FROM payment WHERE is_test=1").length + q("SELECT * FROM invoice WHERE seq<0").length + q("SELECT * FROM commission WHERE is_test=1").length).toBe(0);
    expect(q("SELECT * FROM visit_session WHERE is_test=1").length).toBe(0);
    // the append-only internal audit log is untouched, and the purge itself is on the owner's access log
    expect(one("SELECT COUNT(*) c FROM audit_log").c).toBeGreaterThanOrEqual(auditBefore);
    expect(one("SELECT action, ok, note FROM audit_access WHERE action='purge-test-data'").note).toMatch(/engagements=1/);
    expect((await j(await call("POST", "/api/owner/purge-test-data", { confirm: "purge test data" }, PLAT))).deleted.engagements).toBe(0); // idempotent
    // the real organizer still works
    expect((await call("GET", "/api/history", undefined, (await organizer("again@acme.com", "8.8.8.8")).h)).status).toBe(200);
  });
  test("a real organizer's key still signs in after a purge, and the test organizer's key is gone", async () => {
    const { live, t } = await world();
    await call("POST", "/api/owner/purge-test-data", { confirm: "purge test data" }, PLAT);
    expect((await call("GET", "/api/whoami", undefined, live.h)).status).toBe(200); expect((await call("GET", "/api/whoami", undefined, t.h)).status).toBe(403);
    expect((await call("GET", "/api/z/TTT-9/info")).status).toBe(404);
  });
});

describe("LIVE: no behaviour change", () => {
  test("a full pass in LIVE flags nothing and logs no mail event", async () => {
    env.TEST_MODE = "1";
    const o = await organizer("live@acme.com"); await call("POST", "/api/z", eng("NNN-1"), o.h);
    await call("POST", "/api/checkout", { pack: 100, email: "live@acme.com", org: "Co", country: "IN", eid: "NNN-1" }, o.h);
    for (const t of ["engagement", "payment", "organizer_key", "organizer_email", "partner", "commission", "visit_session"]) expect(q(`SELECT * FROM ${t} WHERE is_test=1`).length).toBe(0);
    expect(q("SELECT * FROM mail_event").length).toBe(0); expect(q("SELECT subject FROM outbox").every((r) => !r.subject.startsWith("[TEST]"))).toBe(true);
    expect(await setMode(env, "LIVE", "x", T)).toBe("LIVE");
  });
});
