import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { lifecycleTick, PURGE_AFTER_MS } from "../src/lifecycle";
import { creditExpiryMs } from "../src/credit";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

// Round 2 (rewritten for spec 6: NO REFUNDS, a cancelled paid game becomes credit, see credit.test.ts): cancel a game (Organizer and Host), the Host e-mail, the Co-host bound to one game, "Confirming your payment",
// and the "your guests' personal data has been deleted" e-mail. See docs/ROLES_AND_CONSOLE_SPEC_2.md items 1 to 7.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const H = 3_600_000;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const START = roundAt(T + 3 * H); // the game starts 3 hours after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let orders: any[]; let payments: Record<string, any>; let refundCalls: any[]; let razorpayCalls: number; let refundStatus: string; let refundFails: boolean;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const outbox = (like = "%") => raw.prepare("SELECT to_addr, subject, body FROM outbox WHERE subject LIKE ? OR body LIKE ? ORDER BY id").all(like, like) as { to_addr: string; subject: string; body: string }[];
const mailsTo = (to: string) => raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(to) as { subject: string; body: string }[];

beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {}; refundCalls = []; razorpayCalls = 0; refundStatus = "processed"; refundFails = false;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (!u.startsWith("https://rzp.test")) return realFetch(url, init);
    razorpayCalls++;
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const rf = u.match(/\/payments\/([^/]+)\/refund$/);
    if (rf) { const b = JSON.parse(init.body); refundCalls.push({ payment: rf[1], ...b }); return refundFails ? new Response(JSON.stringify({ error: { description: "gateway down" } }), { status: 502 }) : new Response(JSON.stringify({ id: "rfnd_" + refundCalls.length, status: refundStatus, amount: b.amount })); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = payments[pm[1]!]; if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p)); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test", OWNER_EMAIL: "owner@platform.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

let ip = 0;
let lastAi = "";
const start = async (email: string) => { const r = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ip}` }, body: JSON.stringify({ email }) }), env as Env, T)); lastAi = r.aiKey as string; return r.token as string; };
/** Organizer + a Host (own e-mail) + a Co-host for game CAN-1, 300 places, starting 3 hours after T. */
const team = async () => {
  const master = await start("boss@acme.com"); const ai = lastAi;
  await call("POST", "/api/z", { id: "CAN-1", startRound: START, callSeconds: 9, cap: 300 }, master);
  const hostR = await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master));
  const cohostR = await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "98765 00001", e: "CAN-1" }, master));
  return { master, ai, host: hostR.hostKey as string, cohost: cohostR.cohostKey as string, hostId: hostR.id as string, cohostId: cohostR.id as string };
};
const pay = (key: string, eid = "CAN-1", now = T) => call("POST", "/api/checkout", { eid, org: "Acme Ltd", name: "Boss", email: "payer@acme.com", country: "IN", taxId: "", currency: "INR" }, key, now);
const sign = (c: any, id: string) => createHmac("sha256", "sek").update(`${c.razorpay.orderId}|${id}`).digest("hex");
const complete = async (c: any, id = "pay_1", now = T, status = "captured") => {
  payments[id] = { id, order_id: c.razorpay.orderId, status, amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: sign(c, id) }, undefined, now);
};
const paidGame = async (t: { master: string }) => { const c = await j(await pay(t.master)); expect((await j(await complete(c))).published).toBe(true); return c; };
const join = (phone: string, name = "Guest") => call("POST", "/api/z/CAN-1/join", { phone, name });
const cancelIt = (key: string, now = T, confirmations = 3) => call("POST", "/api/z/CAN-1/cancel", { confirmations }, key, now);
const paymentRow = () => raw.prepare("SELECT * FROM payment WHERE status='paid'").get() as any;
const DAY = 86_400_000;
const withCredit = (key: string | undefined, eid: string, now = T) => call("POST", `/api/z/${eid}/pay-with-credit`, {}, key, now);
const reopen = (key: string | undefined, startMs: number, eid = "CAN-1", now = T) => call("POST", `/api/z/${eid}/reopen`, { startRound: roundAt(startMs) }, key, now);
const eng = (eid = "CAN-1") => raw.prepare("SELECT * FROM engagement WHERE id=?").get(eid) as any;
const creditsOf = (eid: string) => raw.prepare("SELECT * FROM credit WHERE eid=? ORDER BY created_ms, id").all(eid) as any[];

// product rule 2026-10-09: a cancelled PAID game can be moved to a new date for 30 days after the cancel; its payment stays with the game. Money is never returned; unused credit lapses 365 days after the payment.
describe("reopen: a cancelled paid game moved to a new date within 30 days", () => {
  test("paid game cancelled -> moved: the game is live again, its payment stays, the credit the cancel made is taken out of the account", async () => {
    const t = await team(); await paidGame(t);
    expect((await j(await cancelIt(t.master))).ok).toBe(true);
    const paid = paymentRow().amount;
    expect((await j(await call("GET", "/api/org/credit", undefined, t.master))).activeTotalInr).toBe(paid);
    const pv = await j(await call("GET", "/api/z/CAN-1/cancel-preview", undefined, t.master, T + DAY));
    expect(pv.canReschedule).toBe(true); expect(pv.rescheduleUntilMs).toBe(T + 365 * DAY); expect(pv.paid).toBe(true);
    const newStart = T + 10 * DAY, r = await reopen(t.master, newStart, "CAN-1", T + DAY);
    expect(r.status).toBe(200); const rb = await j(r); expect(rb.reopened).toBe(true);
    const e = eng(); expect(e.cancelled_ms).toBeNull(); expect(e.start_round).toBe(roundAt(newStart)); expect(e.pack).toBeGreaterThan(0);
    const cr = await j(await call("GET", "/api/org/credit", undefined, t.master, T + DAY));
    expect(cr.activeTotalInr).toBe(0); expect(cr.credits.length).toBe(0); // the revived credit is never listed and can never be spent
    expect(creditsOf("CAN-1")[0].status).toBe("revived"); expect(creditsOf("CAN-1")[0].remaining_inr).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM payment WHERE status='paid'").get()).toEqual({ c: 1 }); // no new money, no refund
    expect(refundCalls.length).toBe(0);
    expect(eng().cancelled_by).toBeNull();
    const jn = await join("9811100001"); expect(jn.status).toBe(200); // guests can join the moved game again
    expect(outbox().some((m) => m.subject.startsWith("Your game is back on"))).toBe(true);
  });
  test("the cancel mail tells the owner about the window", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    const m = outbox().find((x) => x.subject.startsWith("Game cancelled"))!;
    expect(m.body).toContain("move this game to a new date until"); expect(m.body).toContain("If you use the credit for another game first");
  });
  test("after 365 days from the payment the game can no longer be moved; inside the window it can", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    const late = T + 365 * DAY + 1000;
    const r = await reopen(t.master, late + 5 * DAY, "CAN-1", late); expect(r.status).toBe(409); expect(["window-closed", "credit-gone"]).toContain((await j(r)).code);
    expect(eng().cancelled_ms).not.toBeNull();
    const inside = T + 360 * DAY; // day 360 after the payment: still allowed, to any date before day 365
    const ok = await reopen(t.master, inside + 3 * DAY, "CAN-1", inside); expect(ok.status).toBe(200);
  });
  test("an unpaid cancelled game cannot be moved (nothing was paid); a game that is not cancelled cannot be reopened", async () => {
    const t = await team();
    expect((await j(await reopen(t.master, T + 5 * DAY))).code).toBe("not-cancelled");
    await cancelIt(t.master);
    const r = await reopen(t.master, T + 5 * DAY); expect(r.status).toBe(409); expect((await j(r)).code).toBe("unpaid"); expect(eng().cancelled_ms).not.toBeNull();
  });
  test("only the Organizer and a Host may move it: a Co-host, an AI key, a stranger and no key may not", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    for (const key of [t.cohost, t.ai, "cbk_" + "0".repeat(48), undefined]) { const r = await reopen(key, T + 5 * DAY); expect([401, 403]).toContain(r.status); }
    expect(eng().cancelled_ms).not.toBeNull();
    expect((await reopen(t.host, T + 5 * DAY)).status).toBe(200); // a Host may
  });
  test("a bad date is refused and nothing changes: past, too far ahead, not a number", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    for (const ms of [T - DAY, T + 400 * DAY]) { const r = await reopen(t.master, ms); expect(r.status).toBe(400); }
    expect((await call("POST", "/api/z/CAN-1/reopen", { startRound: "soon" }, t.master)).status).toBe(400);
    expect(eng().cancelled_ms).not.toBeNull(); expect(creditsOf("CAN-1")[0].status).toBe("active");
  });
  test("the new date cannot be after the money lapses (365 days from the payment)", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    raw.prepare("UPDATE credit SET expires_ms=? WHERE eid='CAN-1'").run(T + 3 * DAY);
    const r = await reopen(t.master, T + 5 * DAY); expect(r.status).toBe(400); expect((await j(r)).code).toBe("after-credit-end");
    expect((await reopen(t.master, T + 2 * DAY)).status).toBe(200);
  });
  test("credit already spent on another game: this game can no longer be moved, and nothing is returned", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    await call("POST", "/api/z", { id: "CAN-2", startRound: START, callSeconds: 9, cap: 300 }, t.master);
    const w = await j(await withCredit(t.master, "CAN-2")); expect(w.paid).toBe(true);
    const pv = await j(await call("GET", "/api/z/CAN-1/cancel-preview", undefined, t.master));
    expect(pv.canReschedule).toBe(false); expect(pv.rescheduleReason).toContain("already been used");
    const r = await reopen(t.master, T + 5 * DAY); expect(r.status).toBe(409); expect((await j(r)).code).toBe("credit-gone");
    expect(eng().cancelled_ms).not.toBeNull(); expect(creditsOf("CAN-1")[0].status).toBe("used");
  });
  test("a half-used credit also blocks it (the money is no longer all here)", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    raw.prepare("UPDATE credit SET remaining_inr=remaining_inr-100 WHERE eid='CAN-1'").run();
    const r = await reopen(t.master, T + 5 * DAY); expect(r.status).toBe(409); expect(eng().cancelled_ms).not.toBeNull();
  });
  test("a game that credit paid for: moving it puts the credit back on the game, and the older game's money stays spent", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master); // CAN-1 paid in cash, cancelled -> credit C1
    await call("POST", "/api/z", { id: "CAN-2", startRound: START, callSeconds: 9, cap: 300 }, t.master);
    expect((await j(await withCredit(t.master, "CAN-2"))).paid).toBe(true); // C1 pays CAN-2
    await call("POST", "/api/z/CAN-2/cancel", { confirmations: 3 }, t.master, T + 1000); // C1 comes back
    const c1 = () => raw.prepare("SELECT * FROM credit WHERE eid='CAN-1'").get() as any;
    expect(c1().status).toBe("active");
    const r = await reopen(t.master, T + 6 * DAY, "CAN-2", T + 2000); expect(r.status).toBe(200);
    expect(eng("CAN-2").cancelled_ms).toBeNull();
    expect(c1().status).toBe("used"); expect(c1().remaining_inr).toBe(0); // C1 is on CAN-2 again, exactly once
    expect(raw.prepare("SELECT status FROM credit_use WHERE eid='CAN-2'").all()).toEqual([{ status: "applied" }]);
    const r1 = await reopen(t.master, T + 6 * DAY, "CAN-1", T + 3000); expect(r1.status).toBe(409); // CAN-1's money is on CAN-2 now
  });
  test("moved, then cancelled a second time: the payment makes credit again, with a new 365 days", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    expect((await reopen(t.master, T + 5 * DAY, "CAN-1", T + DAY)).status).toBe(200);
    const second = T + 2 * DAY;
    const c2 = await j(await cancelIt(t.master, second)); expect(c2.ok).toBe(true); expect(c2.credit.amountInr).toBe(paymentRow().amount);
    expect(c2.rescheduleUntilMs).toBe(second + 365 * DAY);
    const cr = await j(await call("GET", "/api/org/credit", undefined, t.master, second)); expect(cr.activeTotalInr).toBe(paymentRow().amount); // once, never twice
    expect((await reopen(t.master, second + 35 * DAY, "CAN-1", second + 29 * DAY)).status).toBe(200);
  });
  test("moving it twice: the second call changes nothing", async () => {
    const t = await team(); await paidGame(t); await cancelIt(t.master);
    expect((await reopen(t.master, T + 5 * DAY)).status).toBe(200);
    expect((await reopen(t.master, T + 6 * DAY)).status).toBe(409);
    expect(eng().start_round).toBe(roundAt(T + 5 * DAY));
  });
  test("after the 23-hour guest erasure ran, a moved game gets a fresh lifecycle (no stale purged mark) and guests can join again", async () => {
    const t = await team(); await paidGame(t); await join("9811100002"); await cancelIt(t.master);
    const later = T + 2 * DAY; await lifecycleTick(env as any, later); // the erasure ran
    expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='CAN-1'").get() as any).c).toBe(0);
    expect((await reopen(t.master, later + 5 * DAY, "CAN-1", later)).status).toBe(200);
    expect(raw.prepare("SELECT * FROM life WHERE eid='CAN-1'").all()).toEqual([]);
    await lifecycleTick(env as any, later + 3 * DAY);
    expect(eng().cancelled_ms).toBeNull(); expect((await join("9811100003")).status).toBe(200);
  });
});
