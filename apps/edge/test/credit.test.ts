import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { lifecycleTick } from "../src/lifecycle";
import { applyCreditToGame, creditExpiryMs, creditLastDay, creditTick } from "../src/credit";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

// Spec 6 (docs/ROLES_AND_CONSOLE_SPEC_6.md): NO REFUNDS. A cancelled paid game becomes credit for the account for 365 days; credit pays for a next game (in full, in part with a top-up, or leaving a remainder),
// oldest-expiring first, atomically and once; it lapses at the end of day 365 (India time); the five e-mails go to the Organizer and Hosts only, once each.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const H = 3_600_000, DAY = 24 * H;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let orders: any[]; let payments: Record<string, any>; let razorpayCalls: number; let refundCalls: number;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, ip?: string) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}), ...(ip ? { "cf-connecting-ip": ip } : {}) }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mailsTo = (to: string) => raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(to) as { subject: string; body: string }[];
const mailsLike = (to: string, re: RegExp) => mailsTo(to).filter((m) => re.test(m.subject));
const ever = new Map<number, { id: number; to_addr: string; subject: string; body: string }>();
/** Like mailsLike, but also counts mails the 3-day mail-log clean-up of the tick has since forgotten (each one is seen at least once: the test looks after every step). */
const mailsEver = (to: string, re: RegExp) => { for (const m of raw.prepare("SELECT id, to_addr, subject, body FROM outbox WHERE to_addr=?").all(to) as any[]) ever.set(m.id, m); return [...ever.values()].filter((m) => m.to_addr === to && re.test(m.subject)).sort((a, b) => a.id - b.id); };

beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {}; razorpayCalls = 0; refundCalls = 0;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (!u.startsWith("https://rzp.test")) return realFetch(url, init);
    razorpayCalls++;
    if (/\/refund$/.test(u)) { refundCalls++; return new Response("{}", { status: 404 }); }
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
/** Organizer + a Host (own e-mail) + a Co-host for game GAME-1 (300 places = the 500 pack, Rs 4,699, no GST), starting 3 hours after T. */
const team = async () => {
  const master = await start("boss@acme.com"); const ai = lastAi;
  await game(master, "GAME-1", 300, T + 3 * H);
  const hostR = await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master));
  const cohostR = await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "98765 00001", e: "GAME-1" }, master));
  return { master, ai, host: hostR.hostKey as string, cohost: cohostR.cohostKey as string };
};
const game = async (key: string, id: string, cap: number, startMs: number, now = T) => (await call("POST", "/api/z", { id, startRound: roundAt(startMs), callSeconds: 9, cap }, key, now)).status;
const pay = (key: string, eid: string, now = T) => call("POST", "/api/checkout", { eid, org: "Acme Ltd", name: "Boss", email: "payer@acme.com", country: "IN", taxId: "", currency: "INR" }, key, now);
const sign = (c: any, id: string) => createHmac("sha256", "sek").update(`${c.razorpay.orderId}|${id}`).digest("hex");
const complete = async (c: any, id = "pay_" + (Object.keys(payments).length + 1), now = T, status = "captured") => {
  payments[id] = { id, order_id: c.razorpay.orderId, status, amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: sign(c, id) }, undefined, now);
};
const paidWithMoney = async (key: string, eid: string, now = T) => { const c = await j(await pay(key, eid, now));  const r = await j(await complete(c, undefined, now)); expect(r.published).toBe(true); return c; };
const cancelIt = (key: string, eid: string, now = T) => call("POST", `/api/z/${eid}/cancel`, { confirmations: 3 }, key, now);
const withCredit = (key: string | undefined, eid: string, now = T, body: unknown = {}) => call("POST", `/api/z/${eid}/pay-with-credit`, body, key, now);
const credits = async (key: string, now = T) => j(await call("GET", "/api/org/credit", undefined, key, now));
const paidOf = (cap: number) => ({ 100: 2399, 250: 3499, 300: 4699, 750: 5899 } as Record<number, number>)[cap]!;

describe("cancel: a paid game becomes credit, never a refund", () => {
  test("cancel a paid game before the start: credit of exactly what was paid, valid to the end of day 365 in India time", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1");
    const r = await j(await cancelIt(t.master, "GAME-1"));
    expect(r.ok).toBe(true); expect(r.cancelled).toBe(true);
    expect(r.credit).toEqual({ id: expect.stringMatching(/^cr_/), amountInr: paidOf(300), expiresMs: creditExpiryMs(T) });
    // T = 1 Oct 2026, 15:30 IST: day 365 is 1 Oct 2027, the credit lapses at 00:00 IST on 2 Oct 2027
    expect(new Date(r.credit.expiresMs).toISOString()).toBe("2027-10-01T18:30:00.000Z");
    expect(creditLastDay(r.credit.expiresMs)).toBe("1 Oct 2027");
    const row = raw.prepare("SELECT * FROM credit").get() as any;
    expect(row).toMatchObject({ org: expect.any(String), eid: "GAME-1", kind: "cancel", total_inr: paidOf(300), remaining_inr: paidOf(300), status: "active", currency: "INR" });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM refund").get()).toEqual({ c: 0 });
    expect(refundCalls).toBe(0);
  });
  test("validity counts from the date of the ORIGINAL payment, not from the cancel", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1", T);
    const r = await j(await cancelIt(t.master, "GAME-1", T + 2 * H));
    expect(r.credit.expiresMs).toBe(creditExpiryMs(T));
    expect(creditExpiryMs(Date.UTC(2026, 9, 1, 18, 29, 0))).toBe(Date.UTC(2027, 9, 1, 18, 30, 0)); // 23:59 IST on day 0: same India date
    expect(creditExpiryMs(Date.UTC(2026, 9, 1, 18, 31, 0))).toBe(Date.UTC(2027, 9, 2, 18, 30, 0)); // 00:01 IST the next day: one day later
  });
  test("cancel an UNPAID game: no credit, no money effect; cancel a paid game after the start: refused, no credit", async () => {
    const t = await team();
    const r = await j(await cancelIt(t.master, "GAME-1")); expect(r.credit).toBeNull();
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 0 });
    await game(t.master, "GAME-2", 300, T + 3 * H); await paidWithMoney(t.master, "GAME-2");
    const late = await cancelIt(t.master, "GAME-2", T + 4 * H); expect(late.status).toBe(409);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 0 });
  });
  test("cancelling twice (or by a Host and the Organizer together) makes ONE credit and sends ONE mail per person", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1");
    const a = await j(await cancelIt(t.master, "GAME-1")); const b = await j(await cancelIt(t.host, "GAME-1")); const c = await j(await cancelIt(t.master, "GAME-1"));
    expect(b.already).toBe(true); expect(c.credit).toEqual(a.credit);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 1 });
    expect(mailsLike("boss@acme.com", /^Game cancelled/)).toHaveLength(1); expect(mailsLike("priya@acme.com", /^Game cancelled/)).toHaveLength(1);
    const both = await Promise.all([cancelIt(t.master, "GAME-1"), cancelIt(t.host, "GAME-1")]); for (const r of both) expect(r.status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 1 });
  });
  test("the credit mail goes to the Organizer and the Host only and says the exact words of the rule", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.host, "GAME-1");
    for (const to of ["boss@acme.com", "priya@acme.com"]) {
      const m = mailsLike(to, /^Game cancelled/)[0]!;
      expect(m.body).toContain("stays as credit until 1 Oct 2027"); expect(m.body).toContain("We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365.");
    }
    expect(mailsLike("payer@acme.com", /^Game cancelled/)).toHaveLength(0);
  });
});

describe("GET /api/org/credit", () => {
  test("shape, totals and the next expiry; Organizer and Host may read it, a Co-host, an AI key and a stranger may not", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1");
    for (const key of [t.master, t.host]) {
      const r = await credits(key);
      expect(r.activeTotalInr).toBe(paidOf(300)); expect(r.nextExpiryMs).toBe(creditExpiryMs(T));
      expect(r.credits).toHaveLength(1);
      expect(r.credits[0]).toMatchObject({ id: expect.stringMatching(/^cr_/), amountInr: paidOf(300), remainingInr: paidOf(300), createdMs: T, expiresMs: creditExpiryMs(T), status: "active", sourceGame: "GAME-1", uses: [] });
    }
    await game(t.master, "GAME-9", 100, T + 8 * H); // a live Co-host (the first Co-host's key was retired by the cancel, which would make this check empty)
    const co = (await j(await call("POST", "/api/org/cohost", { label: "Ravi9", phone: "98765 00009", e: "GAME-9" }, t.master))).cohostKey as string;
    expect((await call("GET", "/api/whoami", undefined, co)).status).toBe(200);
    for (const key of [co, t.ai, undefined]) expect((await call("GET", "/api/org/credit", undefined, key as string)).status).toBe(403);
    expect(await credits(t.master)).toEqual(await credits(t.host));
  });
  test("credit is isolated per organization", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1");
    const other = await start("rival@other.com");
    const r = await credits(other); expect(r.credits).toEqual([]); expect(r.activeTotalInr).toBe(0); expect(r.nextExpiryMs).toBeNull();
    await game(other, "RIV-1", 100, T + 5 * H);
    const p = await j(await withCredit(other, "RIV-1")); expect(p).toMatchObject({ ok: true, paid: false, usedInr: 0, toPayInr: paidOf(100) });
    expect((await withCredit(other, "NOPE-1")).status).toBe(404);
    expect((await withCredit(t.master, "RIV-1")).status).toBe(404); // not their game
    expect(raw.prepare("SELECT remaining_inr FROM credit").get()).toEqual({ remaining_inr: paidOf(300) });
  });
});

describe("using credit: pay-with-credit", () => {
  const setup = async () => { const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1"); return t; };
  test("credit >= price pays the game in full with no Razorpay: paid by credit, published, the remainder stays with the same expiry", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H);
    const before = razorpayCalls; const orders0 = orders.length;
    const r = await j(await withCredit(t.master, "GAME-2"));
    expect(r).toEqual({ ok: true, paid: true, usedInr: paidOf(100), toPayInr: 0 });
    expect(razorpayCalls).toBe(before); expect(orders.length).toBe(orders0);
    expect(raw.prepare("SELECT pack FROM engagement WHERE id='GAME-2'").get()).toEqual({ pack: 100 });
    const s = await j(await call("GET", "/api/z/GAME-2/summary", undefined, t.master));
    expect(s.paid).toBe(true); expect(s.payment).toMatchObject({ status: "paid", paidBy: "organizer", paidVia: "credit" });
    const c = await credits(t.master);
    expect(c.credits[0]).toMatchObject({ remainingInr: Math.round((paidOf(300) - paidOf(100)) * 100) / 100, status: "active", expiresMs: creditExpiryMs(T), uses: [{ game: "GAME-2", amountInr: paidOf(100), atMs: T }] });
    expect(c.activeTotalInr).toBe(Math.round((paidOf(300) - paidOf(100)) * 100) / 100);
  });
  test("a game paid by credit gets an invoice record that says 'Paid from credit of invoice <number>' with no new GST", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H); await withCredit(t.master, "GAME-2");
    const orig = raw.prepare("SELECT number FROM invoice ORDER BY issued_ms, seq LIMIT 1").get() as any;
    const rows = raw.prepare("SELECT number, data FROM invoice ORDER BY seq").all() as any[];
    expect(rows).toHaveLength(2);
    const d = JSON.parse(rows[1].data);
    expect(d.note).toContain(`Paid from credit of invoice ${orig.number}`); expect(d.tax.total).toBe(0); expect(d.tax.taxable).toBe(0);
    expect(d.lines[0].description).toMatch(/paid from credit/);
  });
  test("credit < price: ALL of it is used and only the difference is paid through the normal checkout, bound to the same game", async () => {
    const t = await setup(); await game(t.master, "GAME-3", 750, T + 6 * H);
    const r = await j(await withCredit(t.master, "GAME-3"));
    expect(r).toEqual({ ok: true, paid: false, usedInr: paidOf(300), toPayInr: 1200 });
    expect((await credits(t.master)).activeTotalInr).toBe(0);
    expect(raw.prepare("SELECT pack FROM engagement WHERE id='GAME-3'").get()).toEqual({ pack: 0 });
    const c = await j(await pay(t.master, "GAME-3"));
    expect(c.razorpay.amount).toBe(120000); // paise: exactly the difference
    expect(raw.prepare("SELECT amount, pack FROM payment WHERE id=?").get(c.paymentId)).toEqual({ amount: 1200, pack: 750 });
    const done = await j(await complete(c)); expect(done.published).toBe(true);
    expect((await j(await call("GET", "/api/z/GAME-3/summary", undefined, t.master))).paid).toBe(true);
    const inv = raw.prepare("SELECT data FROM invoice WHERE payment_id=?").get(c.paymentId) as any; const d = JSON.parse(inv.data);
    expect(d.tax.total).toBe(1200); expect(d.note).toMatch(/Paid from credit of invoice/); expect(d.lines[0].description).toMatch(/balance after credit/);
  });
  test("asking twice (or two taps at once) never uses credit twice: a game can never get more credit than its price", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H);
    const rs = await Promise.all([withCredit(t.master, "GAME-2"), withCredit(t.master, "GAME-2"), withCredit(t.host, "GAME-2")]);
    for (const r of rs) expect(r.status).toBe(200);
    const again = await j(await withCredit(t.master, "GAME-2")); expect(again).toMatchObject({ ok: true, paid: true, toPayInr: 0 });
    expect(raw.prepare("SELECT COALESCE(SUM(amount_inr),0) AS s FROM credit_use WHERE eid='GAME-2' AND status='applied'").get()).toEqual({ s: paidOf(100) });
    expect(raw.prepare("SELECT remaining_inr FROM credit").get()).toEqual({ remaining_inr: Math.round((paidOf(300) - paidOf(100)) * 100) / 100 });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM payment WHERE eid='GAME-2'").get()).toEqual({ c: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM invoice").get()).toEqual({ c: 2 });
    // a partial game asked twice also uses the credit once
    await game(t.master, "GAME-4", 750, T + 7 * H);
    await withCredit(t.master, "GAME-4"); await withCredit(t.master, "GAME-4");
    expect(raw.prepare("SELECT COALESCE(SUM(amount_inr),0) AS s FROM credit_use WHERE eid='GAME-4' AND status='applied'").get()).toEqual({ s: Math.round((paidOf(300) - paidOf(100)) * 100) / 100 });
    expect((raw.prepare("SELECT remaining_inr AS r FROM credit").get() as any).r).toBeGreaterThanOrEqual(0);
  });
  test("the guard inside the insert holds in a real race: even when a stale read says nothing is applied yet, a game never gets more credit than its price", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H);
    const orgId = (raw.prepare("SELECT org FROM engagement WHERE id='GAME-2'").get() as any).org as string;
    const real = env.DB;
    const stale: any = { batch: real.batch.bind(real), prepare: (sql: string) => {
      const st = real.prepare(sql);
      if (/^SELECT COALESCE\(SUM\(amount_inr\),0\) AS s FROM credit_use WHERE eid=\? AND status='applied'$/.test(sql)) return { ...st, bind: (...v: unknown[]) => ({ ...st.bind(...v), first: async () => ({ s: 0 }) }) }; // the other request's use is not visible yet
      return st;
    } };
    await applyCreditToGame(stale, orgId, "GAME-2", paidOf(100), "INR", T);
    await applyCreditToGame(stale, orgId, "GAME-2", paidOf(100), "INR", T); // the second request saw the same stale 0
    expect(raw.prepare("SELECT COALESCE(SUM(amount_inr),0) AS s FROM credit_use WHERE eid='GAME-2' AND status='applied'").get()).toEqual({ s: paidOf(100) });
    expect((raw.prepare("SELECT remaining_inr AS r FROM credit").get() as any).r).toBe(Math.round((paidOf(300) - paidOf(100)) * 100) / 100);
  });
  test("a credit can never go below zero, even when a second game races for the last rupees", async () => {
    const t = await setup(); await game(t.master, "GAME-5", 750, T + 6 * H); await game(t.master, "GAME-6", 750, T + 6 * H);
    const rs = await Promise.all([withCredit(t.master, "GAME-5"), withCredit(t.master, "GAME-6")]);
    for (const r of rs) expect(r.status).toBe(200);
    const left = (raw.prepare("SELECT remaining_inr AS r FROM credit").get() as any).r;
    const used = (raw.prepare("SELECT COALESCE(SUM(amount_inr),0) AS s FROM credit_use WHERE status='applied'").get() as any).s;
    expect(left).toBeGreaterThanOrEqual(0); expect(Math.round((left + used) * 100) / 100).toBe(paidOf(300));
  });
  test("oldest-expiring credit is used first; two credits are drawn in order", async () => {
    const t = await team(); const LATER = T + 10 * DAY;
    await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1");
    await game(t.master, "GAME-7", 100, LATER + 3 * H, LATER); await paidWithMoney(t.master, "GAME-7", LATER); await cancelIt(t.master, "GAME-7", LATER);
    const c = await credits(t.master, LATER); expect(c.credits).toHaveLength(2);
    const first = c.credits.find((x: any) => x.sourceGame === "GAME-1"), second = c.credits.find((x: any) => x.sourceGame === "GAME-7");
    expect(first.expiresMs).toBeLessThan(second.expiresMs);
    await game(t.master, "GAME-8", 750, LATER + 5 * H, LATER);
    const r = await j(await withCredit(t.master, "GAME-8", LATER));
    expect(r).toMatchObject({ paid: true, usedInr: paidOf(750), toPayInr: 0 }); // the older Rs 4,699 first, then Rs 1,200 of the newer one
    const after = await credits(t.master, LATER);
    expect(after.credits.find((x: any) => x.sourceGame === "GAME-1").uses).toEqual([{ game: "GAME-8", amountInr: paidOf(300), atMs: LATER }]);
    expect(after.credits.find((x: any) => x.sourceGame === "GAME-1").status).toBe("used");
    expect(after.credits.find((x: any) => x.sourceGame === "GAME-7").uses).toEqual([{ game: "GAME-8", amountInr: 1200, atMs: LATER }]);
    expect(after.credits.find((x: any) => x.sourceGame === "GAME-7").remainingInr).toBe(Math.round((paidOf(100) - 1200) * 100) / 100);
  });
  test("oldest first within one draw: a small game takes only the older credit", async () => {
    const t = await team(); const LATER = T + 10 * DAY;
    await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1");
    await game(t.master, "GAME-7", 300, LATER + 3 * H, LATER); await paidWithMoney(t.master, "GAME-7", LATER); await cancelIt(t.master, "GAME-7", LATER);
    await game(t.master, "GAME-9", 100, LATER + 6 * H, LATER);
    await withCredit(t.master, "GAME-9", LATER);
    const c = await credits(t.master, LATER);
    expect(c.credits.find((x: any) => x.sourceGame === "GAME-1").uses).toHaveLength(1);
    expect(c.credits.find((x: any) => x.sourceGame === "GAME-7").uses).toHaveLength(0);
    expect(c.credits.find((x: any) => x.sourceGame === "GAME-7").remainingInr).toBe(paidOf(300));
  });
  test("who may use it: the Organizer, a Host, and a Co-host of that game; never an AI key, a stranger, or another account; refused for a cancelled game", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H);
    expect((await withCredit(t.ai, "GAME-2")).status).toBe(403); expect((await withCredit(undefined, "GAME-2")).status).toBe(403);
    const other = await start("rival@other.com"); expect((await withCredit(other, "GAME-2")).status).toBe(404);
    await cancelIt(t.master, "GAME-2");
    expect((await withCredit(t.master, "GAME-2")).status).toBe(409);
    await game(t.master, "GAME-10", 100, T + 7 * H);
    const co = await j(await call("POST", "/api/org/cohost", { label: "Ravi2", phone: "98765 00002", e: "GAME-10" }, t.master));
    expect((await withCredit(co.cohostKey, "GAME-10")).status).toBe(200);
    expect((await withCredit(co.cohostKey, "GAME-10")).status).toBe(200); // the same answer again
  });
  test("paying with credit after the start time follows the late-payment rule: the first number comes 2 minutes after", async () => {
    const t = await setup(); await game(t.master, "GAME-11", 100, T + 6 * H);
    await call("POST", "/api/z/GAME-11/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master);
    const late = T + 7 * H + 1234;
    const r = await j(await withCredit(t.master, "GAME-11", late));
    expect(r.paid).toBe(true); const firstNumber = r.restartedAtMs + 40 * 3000;
    expect(firstNumber - late).toBeGreaterThanOrEqual(120_000); expect(firstNumber - late).toBeLessThanOrEqual(123_100);
  });
  test("info and summary carry the caller's active credit; an outside caller and a stranger see none", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H);
    await call("POST", "/api/z/GAME-2/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master);
    for (const key of [t.master, t.host]) { expect((await j(await call("GET", "/api/z/GAME-2/info", undefined, key))).credit).toBe(paidOf(300)); }
    expect((await j(await call("GET", "/api/z/GAME-2/summary", undefined, t.master))).credit).toBe(paidOf(300));
    expect((await j(await call("GET", "/api/z/GAME-2/info"))).credit).toBeNull();
    expect((await j(await call("GET", "/api/z/GAME-2/info", undefined, t.ai))).credit).toBeNull();
  });
});

describe("credit that has not been used is never visible to, or used by, an outside pay-link payer", () => {
  const setup = async () => { const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1"); return t; };
  const tokenOf = (url: string) => url.split("t=")[1]!;
  test("the pay link shows and charges the FULL price and never mentions credit, even though the account has credit", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H);
    const link = await j(await call("POST", "/api/z/GAME-2/paylink", {}, t.master)); const tok = tokenOf(link.url);
    const v = await call("GET", `/api/paylink/${tok}`); const body = await v.text();
    expect(JSON.parse(body).price.total).toBe(paidOf(100)); expect(body).not.toMatch(/credit/i);
    const c = await j(await call("POST", `/api/paylink/${tok}/checkout`, { name: "Finance", email: "fin@acme.com" }, undefined, T, "7.7.7.7"));
    expect(c.razorpay.amount).toBe(Math.round(paidOf(100) * 100));
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit_use").get()).toEqual({ c: 0 });
    expect((await credits(t.master)).activeTotalInr).toBe(paidOf(300));
  });
  test("if the creator applied credit BEFORE making the link, the link charges only the difference (and still shows no credit)", async () => {
    const t = await setup(); await game(t.master, "GAME-3", 750, T + 6 * H);
    await withCredit(t.master, "GAME-3");
    const link = await j(await call("POST", "/api/z/GAME-3/paylink", {}, t.master)); const tok = tokenOf(link.url);
    const body = await (await call("GET", `/api/paylink/${tok}`)).text(); expect(JSON.parse(body).price.total).toBe(1200); expect(body).not.toMatch(/credit/i);
    const c = await j(await call("POST", `/api/paylink/${tok}/checkout`, { name: "Finance", email: "fin@acme.com" }, undefined, T, "7.7.7.8"));
    expect(c.razorpay.amount).toBe(120000);
  });
});

describe("payment after a cancel is credit, not a refund", () => {
  test("the buyer had the payment open, the game was cancelled, the payment arrives: it becomes credit for the account and the Organizer and Host are told once", async () => {
    const t = await team();
    const c = await j(await pay(t.master, "GAME-1")); // order created, not yet paid
    await cancelIt(t.master, "GAME-1");
    const done = await complete(c, "pay_late", T + 30 * 60_000); expect(done.status).toBe(200);
    const r = await j(done); expect(r.creditKept).toBe(true); expect(r.published).toBe(false);
    const row = raw.prepare("SELECT * FROM credit").get() as any;
    expect(row).toMatchObject({ kind: "late", total_inr: paidOf(300), remaining_inr: paidOf(300), status: "active", eid: "GAME-1" });
    expect(row.expires_ms).toBe(creditExpiryMs(T + 30 * 60_000));
    expect(raw.prepare("SELECT COUNT(*) AS c FROM entitlement").get()).toEqual({ c: 0 }); // it buys no pack: the money is the credit
    expect(raw.prepare("SELECT pack FROM engagement WHERE id='GAME-1'").get()).toEqual({ pack: 0 });
    for (const to of ["boss@acme.com", "priya@acme.com"]) expect(mailsLike(to, /A payment became credit/)).toHaveLength(1);
    expect(refundCalls).toBe(0); expect(raw.prepare("SELECT COUNT(*) AS c FROM refund").get()).toEqual({ c: 0 });
    expect((await credits(t.master)).activeTotalInr).toBe(paidOf(300));
    // the webhook delivering the same payment again changes nothing
    const again = await complete(c, "pay_late", T + 31 * 60_000); expect(again.status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 1 });
    expect(mailsLike("boss@acme.com", /A payment became credit/)).toHaveLength(1);
  });
  test("a payment that arrives after the game closed as 'did not start' is kept as credit too", async () => {
    const t = await team();
    await call("POST", "/api/z/GAME-1/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master);
    const c = await j(await pay(t.master, "GAME-1"));
    const closedAt = T + 3 * H + 40 * H;
    await lifecycleTick(env as any, closedAt);
    expect((raw.prepare("SELECT unplayed_ms FROM engagement WHERE id='GAME-1'").get() as any).unplayed_ms).toBe(closedAt);
    const done = await j(await complete(c, "pay_x", closedAt + 1000)); expect(done.creditKept).toBe(true);
    expect(raw.prepare("SELECT kind, total_inr FROM credit").get()).toEqual({ kind: "late", total_inr: paidOf(300) });
    expect((raw.prepare("SELECT pack FROM engagement WHERE id='GAME-1'").get() as any).pack).toBe(0);
  });
});

describe("a credit-paid game that is cancelled gives the credit back with the SAME expiry (cancelling never stretches 365 days)", () => {
  test("restored to the original credit; partly-applied credit on an unpaid game returns on cancel", async () => {
    const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1");
    await game(t.master, "GAME-2", 100, T + 6 * H); await withCredit(t.master, "GAME-2");
    const mid = await credits(t.master); expect(mid.credits[0].remainingInr).toBe(Math.round((paidOf(300) - paidOf(100)) * 100) / 100);
    const pre = await j(await call("GET", "/api/z/GAME-2/cancel-preview", undefined, t.master, T + H)); expect(pre.credit).toEqual({ amountInr: paidOf(100), expiresMs: creditExpiryMs(T) });
    const r = await j(await cancelIt(t.master, "GAME-2", T + H));
    expect(r.credit).toMatchObject({ amountInr: paidOf(100), expiresMs: creditExpiryMs(T) });
    const after = await credits(t.master, T + H);
    expect(after.credits).toHaveLength(1); expect(after.credits[0]).toMatchObject({ remainingInr: paidOf(300), expiresMs: creditExpiryMs(T), status: "active", uses: [] });
    // an unpaid game with credit applied (partial) gives it back when cancelled
    await game(t.master, "GAME-3", 750, T + 8 * H); await withCredit(t.master, "GAME-3", T + H);
    expect((await credits(t.master, T + H)).activeTotalInr).toBe(0);
    const c3 = await j(await cancelIt(t.master, "GAME-3", T + H));
    expect((await credits(t.master, T + H)).activeTotalInr).toBe(paidOf(300)); expect(c3.cancelled).toBe(true);
  });
});

describe("lapse, expiry and the e-mails", () => {
  const exp = creditExpiryMs(T);
  const setup = async () => { const t = await team(); await paidWithMoney(t.master, "GAME-1"); await cancelIt(t.master, "GAME-1"); return t; };
  test("credit is usable until the last moment of day 365 and lapses at 00:00 IST after it: the tick marks it expired, no refund, no credit note", async () => {
    const t = await setup(); await game(t.master, "GAME-X", 100, exp - 3 * H, exp - 40 * H);
    const lastMoment = exp - 1;
    expect((await credits(t.master, lastMoment)).credits[0].status).toBe("active");
    await lifecycleTick(env as any, lastMoment);
    expect((raw.prepare("SELECT status FROM credit").get() as any).status).toBe("active");
    await lifecycleTick(env as any, exp);
    expect(raw.prepare("SELECT status, remaining_inr, lapsed_inr FROM credit").get()).toEqual({ status: "expired", remaining_inr: 0, lapsed_inr: paidOf(300) });
    const c = await credits(t.master, exp); expect(c.credits[0]).toMatchObject({ status: "expired", remainingInr: 0, lapsedInr: paidOf(300) }); expect(c.activeTotalInr).toBe(0); expect(c.nextExpiryMs).toBeNull();
    expect(raw.prepare("SELECT COUNT(*) AS c FROM refund").get()).toEqual({ c: 0 }); expect(raw.prepare("SELECT COUNT(*) AS c FROM credit_note").get()).toEqual({ c: 0 });
  });
  test("expired credit cannot be used (even before the tick has run), and the game is simply charged in full", async () => {
    const t = await setup(); await game(t.master, "GAME-Y", 100, exp + 5 * H, exp + H);
    const r = await j(await withCredit(t.master, "GAME-Y", exp)); // exactly at the lapse instant, tick not run
    expect(r).toMatchObject({ ok: true, paid: false, usedInr: 0, toPayInr: paidOf(100) });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit_use").get()).toEqual({ c: 0 });
    expect((await j(await call("GET", "/api/z/GAME-Y/info", undefined, t.master, exp))).credit).toBe(0);
  });
  test("the five mails go to the Organizer and the Host only, once each: cancel, 30 days before, 3 days before, on use, on lapse", async () => {
    ever.clear(); // the tick forgets mail-log rows older than 3 days, so this test remembers every mail it has seen
    const t = await setup();
    const to = ["boss@acme.com", "priya@acme.com"];
    for (const a of to) expect(mailsEver(a, /^Game cancelled/)).toHaveLength(1);
    await creditTick(env, exp - 31 * DAY); for (const a of to) expect(mailsEver(a, /lapses on/)).toHaveLength(0);
    await creditTick(env, exp - 29 * DAY); for (const a of to) { expect(mailsEver(a, /lapses on 1 Oct 2027/)).toHaveLength(1); expect(mailsEver(a, /lapses on/)[0]!.body).toContain("in 30 days"); }
    await creditTick(env, exp - 28 * DAY); await lifecycleTick(env as any, exp - 20 * DAY); for (const a of to) expect(mailsEver(a, /lapses on/)).toHaveLength(1); // not again
    await creditTick(env, exp - 2 * DAY); for (const a of to) { expect(mailsEver(a, /lapses on/)).toHaveLength(2); expect(mailsEver(a, /lapses on/)[1]!.body).toContain("in 3 days"); }
    await creditTick(env, exp - DAY); for (const a of to) expect(mailsEver(a, /lapses on/)).toHaveLength(2);
    await lifecycleTick(env as any, exp + 1000); await lifecycleTick(env as any, exp + 2000);
    for (const a of to) { const m = mailsEver(a, /lapsed/); expect(m).toHaveLength(1); expect(m[0]!.body).toContain(`Rs ${paidOf(300).toLocaleString("en-IN")}`); expect(m[0]!.body).toContain("Credit that lapsed"); }
    expect(raw.prepare("SELECT to_addr FROM outbox WHERE subject LIKE '%credit%' OR subject LIKE '%lapse%'").all().every((r: any) => to.includes(r.to_addr))).toBe(true);
    expect(mailsTo("payer@acme.com").filter((m) => /credit|lapse/i.test(m.subject))).toHaveLength(0);
  });
  test("using credit mails 'Rs X of credit used for <game>' to the Organizer and Host, once per use", async () => {
    const t = await setup(); await game(t.master, "GAME-2", 100, T + 6 * H); await withCredit(t.master, "GAME-2"); await withCredit(t.master, "GAME-2");
    for (const a of ["boss@acme.com", "priya@acme.com"]) { const m = mailsLike(a, /of credit used for/); expect(m).toHaveLength(1); expect(m[0]!.subject).toContain(paidOf(100).toLocaleString("en-IN")); }
  });
  test("a credit used up completely is never mailed about lapsing", async () => {
    const t = await setup(); await game(t.master, "GAME-3", 750, T + 6 * H); await withCredit(t.master, "GAME-3"); // uses it all
    await creditTick(env, exp - 29 * DAY); await creditTick(env, exp - 2 * DAY); await creditTick(env, exp + 1);
    expect(mailsLike("boss@acme.com", /lapse/)).toHaveLength(0);
  });
});

