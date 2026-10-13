import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { endBoundMs, lifecycleTick, personalDeleteAt, PURGE_AFTER_MS } from "../src/lifecycle";
const MAX_AHEAD_MS = 30 * 86_400_000, SETTINGS_KEEP_MS = 30 * 86_400_000, UNPLAYED_WARN_MS = 6 * 3_600_000; // the owner's numbers, written out here on purpose: the test must not follow a changed constant
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

// Spec 5 A (docs/ROLES_AND_CONSOLE_SPEC_5.md): a game that did not start. No separate payment cut-off: pay at any time until the guest data is erased (scheduled end + 23 h), a late payment starts 2 minutes after
// confirmation; unpaid = Organizer/Host see "Payment pending", everyone else "Waiting for the Organizer or Host"; after the erasure the game is closed ("This game did not start. Your details have been erased.");
// settings stay 30 days; a game time is at most 30 days ahead; the clock follows the newest time; heads-up 6 h before and a mail after, once each.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const H = 3_600_000, DAY = 24 * H;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const roundMs = (r: number) => (1692803367 + (r - 1) * 3) * 1000;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let orders: any[]; let payments: Record<string, any>;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, ip?: string) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}), ...(ip ? { "cf-connecting-ip": ip } : {}) }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mailsTo = (to: string) => raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(to) as { subject: string; body: string }[];
const mailsLike = (to: string, re: RegExp) => mailsTo(to).filter((m) => re.test(m.subject));
const count = (sql: string, ...a: any[]) => (raw.prepare(sql).get(...a) as any).c as number;

beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {};
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (!u.startsWith("https://rzp.test")) return realFetch(url, init);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = payments[pm[1]!]; if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p)); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test", OWNER_EMAIL: "owner@platform.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

let ip = 0, lastAi = "";
const start = async (email: string) => { const r = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ip}` }, body: JSON.stringify({ email }) }), env as Env, T)); lastAi = r.aiKey as string; return r.token as string; };
const PUB = { email: "boss@acme.com", phone: "9876543210" };
const GAME_START = T + 3 * H;
/** Organizer + Host (own e-mail) + a Co-host; a PUBLISHED but unpaid game UNP-1 for 300 people starting at GAME_START. */
const team = async (publish = true) => {
  const master = await start("boss@acme.com"); const ai = lastAi;
  expect((await call("POST", "/api/z", { id: "UNP-1", startRound: roundAt(GAME_START), callSeconds: 9, cap: 300 }, master)).status).toBe(200);
  const host = (await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master))).hostKey as string;
  const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "98765 00001", e: "UNP-1" }, master))).cohostKey as string;
  if (publish) expect((await call("POST", "/api/z/UNP-1/publish", PUB, master)).status).toBe(200);
  return { master, ai, host, cohost };
};
const row = (id = "UNP-1") => raw.prepare("SELECT * FROM engagement WHERE id=?").get(id) as any;
const endOf = (id = "UNP-1") => endBoundMs(env as any, row(id));
const eraseAt = async (id = "UNP-1") => personalDeleteAt(await endOf(id));
const join = (phone: string, name = "Guest", eid = "UNP-1", now = T) => call("POST", `/api/z/${eid}/join`, { phone, name }, undefined, now);
const people = (key: string, list: { name: string; phone: string }[], eid = "UNP-1") => call("POST", `/api/z/${eid}/people`, { people: list }, key);
const pay = (key: string, eid = "UNP-1", now = T) => call("POST", "/api/checkout", { eid, org: "Acme Ltd", name: "Boss", email: "payer@acme.com", country: "IN", taxId: "", currency: "INR" }, key, now);
const sign = (c: any, id: string) => createHmac("sha256", "sek").update(`${c.razorpay.orderId}|${id}`).digest("hex");
const complete = async (c: any, id = "pay_" + (Object.keys(payments).length + 1), now = T) => {
  payments[id] = { id, order_id: c.razorpay.orderId, status: "captured", amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: sign(c, id) }, undefined, now);
};
/** A guest, a listed person, a waiting request... everything personal about the game. */
const personal = () => ({
  participants: count("SELECT COUNT(*) AS c FROM participant WHERE eid='UNP-1'"), seats: count("SELECT COUNT(*) AS c FROM seat WHERE eid='UNP-1'"), people: count("SELECT COUNT(*) AS c FROM person WHERE eid='UNP-1'"),
  waiting: count("SELECT COUNT(*) AS c FROM waiting WHERE eid='UNP-1'"), cohosts: count("SELECT COUNT(*) AS c FROM organizer_key WHERE kind='cohost' AND eid='UNP-1' AND revoked=0"),
});
const withPersonalData = async (t: { master: string }) => {
  expect((await join("9876543210", "Asha")).status).toBe(200);
  expect((await people(t.master, [{ name: "Ben", phone: "9876543211" }, { name: "Chitra", phone: "9876543212" }])).status).toBe(200);
  await call("PATCH", "/api/z/UNP-1/settings", { whoCanJoin: "list" }, t.master);
  expect((await join("9876543299", "Stranger")).status).toBe(403); // waits for approval
  const p = personal(); expect(p.participants).toBe(1); expect(p.people).toBeGreaterThanOrEqual(2); expect(p.waiting).toBe(1); expect(p.cohosts).toBe(1);
};

describe("a game that did not start: guest data is erased at the scheduled end + 23 hours", () => {
  test("nothing is erased before end + 23 h; at end + 23 h guests, lists, waiting requests, links and Co-host details are all gone, and the game is closed", async () => {
    const t = await team(); await withPersonalData(t);
    const at = await eraseAt();
    expect(at).toBe((await endOf()) + PURGE_AFTER_MS);
    await lifecycleTick(env as any, at - 1000);
    expect(personal().participants).toBe(1); expect(personal().people).toBeGreaterThanOrEqual(2); expect(row().unplayed_ms).toBeNull();
    await lifecycleTick(env as any, at);
    expect(personal()).toEqual({ participants: 0, seats: 0, people: 0, waiting: 0, cohosts: 0 });
    expect(row().unplayed_ms).toBe(at);
  });
  test("Organizer and Host data, payment and invoice records, and the game's settings stay (only personal data goes)", async () => {
    const t = await team(); await withPersonalData(t);
    const keys = count("SELECT COUNT(*) AS c FROM organizer_key WHERE org=? AND kind IN ('master','host') AND revoked=0", row().org);
    const kv = count("SELECT COUNT(*) AS c FROM kv WHERE k LIKE 'contact/%' OR k LIKE 'orgmail/%'");
    await lifecycleTick(env as any, await eraseAt());
    expect(count("SELECT COUNT(*) AS c FROM organizer_key WHERE org=? AND kind IN ('master','host') AND revoked=0", row().org)).toBe(keys);
    expect(count("SELECT COUNT(*) AS c FROM kv WHERE k LIKE 'contact/%' OR k LIKE 'orgmail/%'")).toBe(kv);
    expect(raw.prepare("SELECT email_sealed FROM organizer_key WHERE kind='host'").get()).toMatchObject({ email_sealed: expect.stringMatching(/^v1\./) });
    expect(row().cap).toBe(300); expect(JSON.parse(row().config)).toBeTruthy();
  });
  test("a PLAYED game keeps the old rule (23 h after it ends); only a game nobody paid for follows the new pass", async () => {
    const t = await team();
    const c = await j(await pay(t.master)); expect((await j(await complete(c))).published).toBe(true);
    await join("9876543210", "Asha");
    const end = await endOf();
    await lifecycleTick(env as any, end + PURGE_AFTER_MS - 1000); expect(personal().participants).toBe(1);
    await lifecycleTick(env as any, end + PURGE_AFTER_MS + 1000); expect(personal().participants).toBe(0);
    expect(row().unplayed_ms).toBeNull(); // a played game is not "did not start"
    expect(raw.prepare("SELECT purged_ms FROM life WHERE eid='UNP-1'").get()).toMatchObject({ purged_ms: expect.any(Number) });
  });
  test("a played game with nobody who joined, only a people list, loses the list 23 h after the end", async () => {
    const t = await team();
    const c = await j(await pay(t.master)); await complete(c);
    await people(t.master, [{ name: "Ben", phone: "9876543211" }]);
    expect(personal().people).toBe(1);
    const end = await endOf();
    await lifecycleTick(env as any, end + PURGE_AFTER_MS - 1000); expect(personal().people).toBe(1);
    await lifecycleTick(env as any, end + PURGE_AFTER_MS + 1000); expect(personal().people).toBe(0);
  });
  test("a cancelled game follows the cancel time, people lists included", async () => {
    const t = await team(); await people(t.master, [{ name: "Ben", phone: "9876543211" }]);
    await call("POST", "/api/z/UNP-1/cancel", { confirmations: 3 }, t.master, T);
    await lifecycleTick(env as any, T + PURGE_AFTER_MS - 1000); expect(personal().people).toBe(1);
    await lifecycleTick(env as any, T + PURGE_AFTER_MS + 1000); expect(personal().people).toBe(0);
  });
  test("ticks are idempotent: repeating them changes nothing and mails nothing twice", async () => {
    const t = await team(); await withPersonalData(t);
    const at = await eraseAt();
    for (const now of [at + 1, at + 2, at + 60_000, at + H]) await lifecycleTick(env as any, now);
    expect(row().unplayed_ms).toBe(at + 1);
    for (const a of ["boss@acme.com", "priya@acme.com"]) { expect(mailsLike(a, /did not start/)).toHaveLength(1); expect(mailsLike(a, /time has passed/).length).toBeLessThanOrEqual(1); }
    void t;
  });
  test("a legal hold stops the erasure (as for every game)", async () => {
    const t = await team(); await withPersonalData(t);
    raw.prepare("INSERT INTO legal_hold(eid,at_ms,note) VALUES('UNP-1',1,'test')").run();
    await lifecycleTick(env as any, await eraseAt() + H);
    expect(personal().participants).toBe(1); expect(row().unplayed_ms).toBeNull();
  });
  test("a draft nobody published loses its personal data the same way but is NOT closed and sends no e-mail", async () => {
    const t = await team(false);
    await people(t.master, [{ name: "Ben", phone: "9876543211" }]);
    expect(personal().people).toBe(1);
    await lifecycleTick(env as any, await eraseAt());
    expect(personal().people).toBe(0); expect(row().unplayed_ms).toBeNull();
    expect(mailsLike("boss@acme.com", /did not start|time has passed/)).toHaveLength(0);
    expect((await call("GET", "/api/z/UNP-1/summary", undefined, t.master, await eraseAt() + H)).status).toBe(200);
  });
});

describe("the clock follows the newest time", () => {
  test("rescheduling moves the erasure: nothing happens at the old time, everything at the new one", async () => {
    const t = await team(); await withPersonalData(t);
    const old = await eraseAt();
    const later = GAME_START + 2 * DAY;
    const r = await call("PATCH", "/api/z/UNP-1/settings", { startRound: roundAt(later) }, t.master, old - 2 * H);
    expect(r.status).toBe(200);
    await lifecycleTick(env as any, old + H); expect(personal().participants).toBe(1); expect(row().unplayed_ms).toBeNull();
    const fresh = await eraseAt(); expect(fresh).toBeGreaterThan(old + 40 * H);
    await lifecycleTick(env as any, fresh - 1000); expect(personal().participants).toBe(1);
    await lifecycleTick(env as any, fresh + 1000); expect(personal().participants).toBe(0); expect(row().unplayed_ms).not.toBeNull();
  });
  test("an unplayed game can be rescheduled any time until the erasure, even after its old start time; after the erasure it cannot", async () => {
    const t = await team();
    const afterStart = GAME_START + 5 * H;
    const ok = await call("PATCH", "/api/z/UNP-1/settings", { startRound: roundAt(afterStart + 2 * DAY) }, t.master, afterStart);
    expect(ok.status).toBe(200);
    const closeAt = await eraseAt(); await lifecycleTick(env as any, closeAt);
    const no = await call("PATCH", "/api/z/UNP-1/settings", { startRound: roundAt(closeAt + DAY) }, t.master, closeAt + 1000);
    expect(no.status).toBe(409); expect((await j(no)).error).toBe("This game did not start. Your details have been erased.");
  });
  test("a game that has STARTED (paid, start time passed) cannot be rescheduled", async () => {
    const t = await team(); const c = await j(await pay(t.master)); await complete(c);
    const r = await call("PATCH", "/api/z/UNP-1/settings", { startRound: roundAt(GAME_START + 2 * DAY) }, t.master, GAME_START + H);
    expect(r.status).toBe(409);
  });
  test("a reschedule gets its own heads-up (one per erasure time)", async () => {
    const t = await team();
    const first = await eraseAt();
    await lifecycleTick(env as any, first - UNPLAYED_WARN_MS + 1000);
    expect(mailsLike("boss@acme.com", /time has passed/)).toHaveLength(1);
    await call("PATCH", "/api/z/UNP-1/settings", { startRound: roundAt(GAME_START + 2 * DAY) }, t.master, first - 4 * H);
    const second = await eraseAt();
    await lifecycleTick(env as any, first - H); await lifecycleTick(env as any, second - UNPLAYED_WARN_MS + 1000); await lifecycleTick(env as any, second - UNPLAYED_WARN_MS + 2000);
    expect(mailsLike("boss@acme.com", /time has passed/)).toHaveLength(2);
    expect(t.cohost).toBeTruthy();
  });
});

describe("no separate payment cut-off: pay any time until the data is erased", () => {
  test("a late payment just before the erasure starts the game 2 minutes after confirmation; the guest list is kept", async () => {
    const t = await team(); await join("9876543210", "Asha");
    const at = await eraseAt(); const late = at - 5 * 60_000;
    const c = await j(await pay(t.master, "UNP-1", late));
    const done = await j(await complete(c, undefined, late));
    expect(done.published).toBe(true);
    const first = done.restartedAtMs + 40 * 3000; expect(first - late).toBeGreaterThanOrEqual(120_000); expect(first - late).toBeLessThanOrEqual(123_100);
    await lifecycleTick(env as any, late + 60_000); // the new schedule moved the clock: nothing is erased now
    expect(personal().participants).toBe(1); expect(row().unplayed_ms).toBeNull(); expect(row().pack).toBe(500);
  });
  test("after the erasure nobody can pay: the console pay, the pay link and pay-with-credit all say the game is closed", async () => {
    const t = await team();
    const link = await j(await call("POST", "/api/z/UNP-1/paylink", {}, t.master)); const tok = String(link.url).split("t=")[1]!;
    const closeAt = await eraseAt(); await lifecycleTick(env as any, closeAt);
    const p = await pay(t.master, "UNP-1", closeAt + 1000); expect(p.status).toBe(409); expect((await j(p)).code).toBe("did-not-start");
    const v = await j(await call("GET", `/api/paylink/${tok}`, undefined, undefined, closeAt + 1000)); expect(v.status).toBe("closed");
    const c = await call("POST", `/api/paylink/${tok}/checkout`, { name: "F", email: "f@acme.com" }, undefined, closeAt + 1000, "6.6.6.6"); expect(c.status).toBe(409);
    expect((await call("POST", "/api/z/UNP-1/pay-with-credit", {}, t.master, closeAt + 1000)).status).toBe(409);
  });
});

describe("what each person sees while the game is unpaid, and after it closes", () => {
  test("info: before the start time nothing is held; at the start time waitingFor is 'organizer'; the Organizer/Host get unpaid:true, a guest does not", async () => {
    const t = await team();
    const before = await j(await call("GET", "/api/z/UNP-1/info", undefined, undefined, T));
    expect(before).toMatchObject({ waitingFor: null, didNotStart: false, locked: false }); expect(before.erasureMs).toBe(await eraseAt());
    const held = await j(await call("GET", "/api/z/UNP-1/info", undefined, undefined, GAME_START + 10 * 60_000));
    expect(held).toMatchObject({ waitingFor: "organizer", didNotStart: false, locked: true }); expect(held.unpaid).toBeUndefined();
    for (const key of [t.master, t.host]) { const x = await j(await call("GET", "/api/z/UNP-1/info", undefined, key, GAME_START + 10 * 60_000)); expect(x).toMatchObject({ waitingFor: "organizer", unpaid: true }); }
    const cohost = await j(await call("GET", "/api/z/UNP-1/cohost", undefined, t.cohost, GAME_START + 10 * 60_000)); expect(cohost).toMatchObject({ waitingFor: "organizer", didNotStart: false }); expect(cohost.payment.status).toBe("pending");
    const sum = await j(await call("GET", "/api/z/UNP-1/summary", undefined, t.master, GAME_START + 10 * 60_000)); expect(sum).toMatchObject({ waitingFor: "organizer", didNotStart: false, erasureMs: await eraseAt() }); expect(sum.payment.status).toBe("pending");
  });
  test("the control file the big screen and phones read says locked while held, and didNotStart after the closing", async () => {
    await team();
    expect((await j(await call("GET", "/api/z/UNP-1/control", undefined, undefined, GAME_START + H))).locked).toBe(true);
    const closeAt = await eraseAt(); await lifecycleTick(env as any, closeAt);
    const ctl = await j(await call("GET", "/api/z/UNP-1/control", undefined, undefined, closeAt + 1000)); expect(ctl.didNotStart).toBe(true); expect(ctl.locked).toBeUndefined();
  });
  test("after the erasure: guests and everyone see 'This game did not start. Your details have been erased.'; nobody can join; the Organizer sees it as closed", async () => {
    const t = await team(); const closeAt = await eraseAt(); await lifecycleTick(env as any, closeAt);
    const info = await j(await call("GET", "/api/z/UNP-1/info", undefined, undefined, closeAt + 1000));
    expect(info).toMatchObject({ didNotStart: true, message: "This game did not start. Your details have been erased.", waitingFor: null });
    const jn = await join("9876543299", "Late", "UNP-1", closeAt + 1000); expect(jn.status).toBe(403);
    expect(await j(jn)).toMatchObject({ code: "did-not-start", didNotStart: true, error: "This game did not start. Your details have been erased." });
    const s = await j(await call("GET", "/api/z/UNP-1/summary", undefined, t.master, closeAt + 1000)); expect(s).toMatchObject({ didNotStart: true }); expect(s.status).toMatch(/did not start/);
    expect((await call("POST", "/api/z/UNP-1/announce", { text: "hi" }, t.master, closeAt + 1000)).status).toBe(409);
    expect((await people(t.master, [{ name: "X", phone: "9876543277" }])).status).toBe(409);
    expect((await call("POST", "/api/z/UNP-1/cancel", { confirmations: 3 }, t.master, closeAt + 1000)).status).toBe(409);
    expect((await call("GET", "/api/z/UNP-1/cancel-preview", undefined, t.master, closeAt + 1000)).status).toBe(200);
  });
});

describe("e-mails: a heads-up 6 hours before and a note after, to the Organizer and the Hosts only, once each", () => {
  test("heads-up inside the last 6 hours, not before; the after-erasure mail says it did not start; the Co-host (no e-mail) and guests get nothing", async () => {
    const t = await team(); await withPersonalData(t);
    const at = await eraseAt();
    await lifecycleTick(env as any, at - UNPLAYED_WARN_MS - 60_000);
    expect(mailsLike("boss@acme.com", /time has passed/)).toHaveLength(0);
    await lifecycleTick(env as any, at - UNPLAYED_WARN_MS + 60_000); await lifecycleTick(env as any, at - 3 * H);
    for (const a of ["boss@acme.com", "priya@acme.com"]) {
      const m = mailsLike(a, /time has passed/); expect(m).toHaveLength(1);
      expect(m[0]!.body).toContain("Your game time has passed. Guest data will be erased at"); expect(m[0]!.body).toContain("IST"); expect(m[0]!.body).toContain("Tap to reschedule and keep it."); expect(m[0]!.body).toContain("https://bingo.test/zc.html?e=UNP-1");
    }
    await lifecycleTick(env as any, at + 5000);
    for (const a of ["boss@acme.com", "priya@acme.com"]) { const m = mailsLike(a, /did not start/); expect(m).toHaveLength(1); expect(m[0]!.body).toContain("Your game did not start. We erased the guest list at"); }
    const all = raw.prepare("SELECT to_addr FROM outbox WHERE subject LIKE '%time has passed%' OR subject LIKE '%did not start%'").all() as any[];
    expect(all.every((r) => ["boss@acme.com", "priya@acme.com"].includes(r.to_addr))).toBe(true);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM outbox WHERE to_addr LIKE '%9876%'").get()).toEqual({ c: 0 });
  });
  test("a paid (played) game gets neither of these mails", async () => {
    const t = await team(); const c = await j(await pay(t.master)); await complete(c); await join("9876543210");
    const end = await endOf(); await lifecycleTick(env as any, end + PURGE_AFTER_MS - 3 * H); await lifecycleTick(env as any, end + PURGE_AFTER_MS + 1000);
    expect(mailsLike("boss@acme.com", /time has passed|did not start/)).toHaveLength(0);
  });
});

describe("the settings of a game that did not start stay 30 days", () => {
  test("kept at +29 days, forgotten at +30 days like a draft; clone still works in between", async () => {
    const t = await team(); const closeAt = await eraseAt(); await lifecycleTick(env as any, closeAt);
    await purgeOld(env as any, closeAt + SETTINGS_KEEP_MS - 1000);
    expect(count("SELECT COUNT(*) AS c FROM engagement WHERE id='UNP-1'")).toBe(1);
    expect((await call("POST", "/api/z/UNP-1/clone", {}, t.master, closeAt + 20 * DAY)).status).toBe(200);
    await purgeOld(env as any, closeAt + SETTINGS_KEEP_MS + 1000);
    expect(count("SELECT COUNT(*) AS c FROM engagement WHERE id='UNP-1'")).toBe(0);
  });
});

describe("a game time is at most 30 days ahead", () => {
  const body = (ms: number, extra: object = {}) => ({ id: "FAR-1", startRound: roundAt(ms), callSeconds: 9, cap: 100, ...extra });
  test("create: 30 days is fine, a minute more is refused with a friendly message (console, API and AI key alike)", async () => {
    const master = await start("boss@acme.com"); const ai = lastAi;
    const okAt = T + MAX_AHEAD_MS - 10_000;
    expect((await call("POST", "/api/z", body(okAt), master)).status).toBe(200);
    for (const [key, id] of [[master, "FAR-2"], [ai, "FAR-3"], ["plat", "FAR-4"]] as const) {
      const r = await call("POST", "/api/z", { ...body(T + MAX_AHEAD_MS + 60_000), id }, key);
      expect(r.status).toBe(400); const b = await j(r); expect(b.code).toBe("too-far"); expect(b.error).toBe("A game can be set at most 30 days ahead. Please pick a day within the next 30 days.");
    }
    expect(count("SELECT COUNT(*) AS c FROM engagement")).toBe(1);
  });
  test("reschedule: any number of times inside the window; beyond it is refused; the schedule helper says so too", async () => {
    const master = await start("boss@acme.com");
    await call("POST", "/api/z", body(T + 2 * DAY), master);
    for (const d of [5, 12, 3, 29]) expect((await call("PATCH", "/api/z/FAR-1/settings", { startRound: roundAt(T + d * DAY) }, master)).status).toBe(200);
    const r = await call("PATCH", "/api/z/FAR-1/settings", { startRound: roundAt(T + 31 * DAY) }, master); expect(r.status).toBe(400); expect((await j(r)).code).toBe("too-far");
    expect(roundMs(row("FAR-1").start_round)).toBeLessThanOrEqual(T + 29 * DAY + 3000);
    const h = await call("GET", `/api/z/schedule?at=${encodeURIComponent(new Date(T + 40 * DAY).toISOString())}`, undefined, master); expect(h.status).toBe(400); expect((await j(h)).code).toBe("too-far");
    expect((await call("GET", `/api/z/schedule?at=${encodeURIComponent(new Date(T + 10 * DAY).toISOString())}`, undefined, master)).status).toBe(200);
  });
});
