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

describe("cancel: who, when, how many confirmations", () => {
  test("cancel-preview: unpaid game = no money; paid game = the credit it would leave (the amount paid, valid 365 days), never a refund", async () => {
    const t = await team();
    const u = await j(await call("GET", "/api/z/CAN-1/cancel-preview", undefined, t.master));
    expect(u).toEqual({ canCancel: true, paid: false, credit: null });
    await paidGame(t);
    const p = await j(await call("GET", "/api/z/CAN-1/cancel-preview", undefined, t.master));
    const paid = paymentRow().amount;
    expect(p.canCancel).toBe(true); expect(p.paid).toBe(true);
    expect(p.credit.amountInr).toBe(paid); expect(p.credit.expiresMs).toBe(creditExpiryMs(T)); expect(p).not.toHaveProperty("refund");
  });
  test("only the Organizer and a Host can cancel; a Co-host, an AI key, a stranger and no key cannot", async () => {
    const t = await team();
    expect(t.ai).toMatch(/^cba_/);
    for (const key of [t.cohost, "cbk_" + "0".repeat(48), undefined, t.ai]) {
      expect((await cancelIt(key as string)).status).toBe(403);
      expect((await call("GET", "/api/z/CAN-1/cancel-preview", undefined, key as string)).status).toBe(403);
    }
    expect(raw.prepare("SELECT cancelled_ms FROM engagement WHERE id='CAN-1'").get()).toEqual({ cancelled_ms: null });
    expect((await cancelIt(t.host)).status).toBe(200); // a Host may
  });
  test("the server requires confirmations: 3 (one, two, or none cancels nothing)", async () => {
    const t = await team();
    for (const c of [0, 1, 2, 4, undefined]) expect((await call("POST", "/api/z/CAN-1/cancel", c === undefined ? {} : { confirmations: c }, t.master)).status).toBe(400);
    expect((await call("POST", "/api/z/CAN-1/cancel", { confirmations: "3" }, t.master)).status).toBe(400);
    expect(raw.prepare("SELECT cancelled_ms FROM engagement WHERE id='CAN-1'").get()).toEqual({ cancelled_ms: null });
    expect((await cancelIt(t.master)).status).toBe(200);
  });
  test("a paid game cannot be cancelled once its start time has passed (friendly message); an unpaid one can, any time", async () => {
    const t = await team(); await paidGame(t);
    const after = T + 4 * H;
    const pre = await j(await call("GET", "/api/z/CAN-1/cancel-preview", undefined, t.master, after));
    expect(pre.canCancel).toBe(false); expect(pre.reason).toMatch(/End the game/);
    const r = await cancelIt(t.master, after);
    expect(r.status).toBe(409); expect((await j(r)).error).toMatch(/End the game/);
    expect(raw.prepare("SELECT cancelled_ms FROM engagement WHERE id='CAN-1'").get()).toEqual({ cancelled_ms: null });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 0 });
    // the same far-later time on an unpaid game is fine
    await call("POST", "/api/z", { id: "CAN-2", startRound: START, callSeconds: 9, cap: 100 }, t.master);
    expect((await call("POST", "/api/z/CAN-2/cancel", { confirmations: 3 }, t.master, after)).status).toBe(200);
  });
});

describe("cancel: what guests and everybody see afterwards", () => {
  test("guests see 'cancelled by the organizer'; nobody can join, publish, pay or change it; the keys still read the state", async () => {
    const t = await team(); await paidGame(t);
    expect((await join("9876543210")).status).toBe(200);
    expect((await cancelIt(t.master)).status).toBe(200);
    const info = await j(await call("GET", "/api/z/CAN-1/info"));
    expect(info.cancelled).toBe(true); expect(info.message).toBe("This game was cancelled by the organizer.");
    const ctl = await j(await call("GET", "/api/z/CAN-1/control")); expect(ctl.cancelled).toBe(true);
    const jn = await join("9876543211"); expect(jn.status).toBe(403); expect((await j(jn)).error).toBe("This game was cancelled by the organizer.");
    expect((await call("PATCH", "/api/z/CAN-1/settings", { name: "x" }, t.master)).status).toBe(409);
    expect((await call("POST", "/api/z/CAN-1/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master)).status).toBe(409);
    expect((await call("POST", "/api/z/CAN-1/announce", { text: "hi" }, t.master)).status).toBe(409);
    expect((await pay(t.master)).status).toBe(409);
    expect((await pay(t.cohost)).status).toBe(403); // the Co-host key was retired at the cancel
    const s = await j(await call("GET", "/api/z/CAN-1/summary", undefined, t.master));
    expect(s.cancelled).toBe(true); expect(s.status).toMatch(/cancelled/); expect(s.cancelCredit.amountInr).toBe(paymentRow().amount); expect(s).not.toHaveProperty("refund");
    expect((await call("POST", "/api/z/CAN-1/cancel", { confirmations: 3 }, t.master)).status).toBe(200); // saying it twice is harmless
  });
  test("an unpublished-payment game that was cancelled never sends the 'payment is due' nudge to guests who open it", async () => {
    const t = await team();
    await call("POST", "/api/z/CAN-1/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master);
    await cancelIt(t.master);
    await call("GET", "/api/z/CAN-1/info", undefined, undefined, T + 4 * H);
    expect(outbox("%could not begin%")).toHaveLength(0);
  });
  test("guests' names and numbers are erased 23 hours after the CANCEL time (not the start time), and the Organizer and Host are told", async () => {
    const t = await team(); await paidGame(t);
    await join("9876543210", "Asha"); await join("9876543211", "Ben");
    const at = T + 30 * 60_000;
    await cancelIt(t.master, at);
    await lifecycleTick(env as any, at + PURGE_AFTER_MS - 60_000);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='CAN-1'").get()).toEqual({ c: 2 }); // not yet
    await lifecycleTick(env as any, at + PURGE_AFTER_MS + 1000);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='CAN-1'").get()).toEqual({ c: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM seat WHERE eid='CAN-1'").get()).toEqual({ c: 0 });
    expect(raw.prepare("SELECT purged_ms FROM life WHERE eid='CAN-1'").get()).toEqual({ purged_ms: at + PURGE_AFTER_MS + 1000 });
    for (const to of ["boss@acme.com", "priya@acme.com"]) expect(mailsTo(to).some((m) => /personal data has been deleted/i.test(m.subject))).toBe(true);
  });
});

describe("cancel e-mails", () => {
  test("the Organizer and each Host are told, with the credit amount and date, never a refund; the payer and the Co-host (no e-mail) are not; a Host's cancel says so", async () => {
    const t = await team(); await paidGame(t);
    expect((await cancelIt(t.host)).status).toBe(200);
    const paid = paymentRow().amount;
    for (const to of ["boss@acme.com", "priya@acme.com"]) {
      const m = mailsTo(to).find((x) => /^Game cancelled/.test(x.subject))!; expect(m).toBeTruthy();
      expect(m.body).toContain("cancelled by a Host"); expect(m.body).toContain("stays as credit until"); expect(m.body).toContain(paid.toLocaleString("en-IN")); expect(m.body).toContain("We do not give refunds.");
      expect(m.body).not.toMatch(/refund of|2\.36|credit note/i);
    }
    expect(mailsTo("payer@acme.com").some((x) => /^Game cancelled/.test(x.subject))).toBe(false);
  });
  test("when the Organizer cancels, the Organizer (not only a Host) is mailed; addresses are not repeated", async () => {
    const t = await team(); await paidGame(t);
    await cancelIt(t.master);
    expect(mailsTo("boss@acme.com").filter((m) => /^Game cancelled/.test(m.subject))).toHaveLength(1);
    expect(mailsTo("boss@acme.com").find((m) => /^Game cancelled/.test(m.subject))!.body).toContain("cancelled by the Organizer");
  });
});

describe("no refund machinery is left", () => {
  test("cancelling a paid game makes no Razorpay call, no refund row, no credit note, and leaves the partner's commission alone", async () => {
    const t = await team(); await paidGame(t);
    raw.prepare("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms) VALUES(?,?,?,?,?,?,?,?)").run(paymentRow().id, "BBBBBBBB", 1000, "INR", 0.5, 500, "accrued", 1);
    const before = razorpayCalls;
    const r = await j(await cancelIt(t.master));
    expect(razorpayCalls).toBe(before); expect(refundCalls).toHaveLength(0);
    expect(r.credit).toMatchObject({ amountInr: paymentRow().amount }); expect(r).not.toHaveProperty("refund");
    expect(raw.prepare("SELECT COUNT(*) AS c FROM refund").get()).toEqual({ c: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit_note").get()).toEqual({ c: 0 });
    expect(raw.prepare("SELECT status FROM commission WHERE partner_code='BBBBBBBB'").get()).toEqual({ status: "accrued" });
    expect(mailsTo("owner@platform.test")).toHaveLength(0); // nobody has a refund to process by hand
  });
  test("the source has no refund fee, no Razorpay refund call and no REFUND_FEE_RATE any more", async () => {
    for (const f of ["../src/cancel.ts", "../src/pay.ts", "../src/credit.ts", "../src/worker.ts", "../../../packages/billing/src/index.ts"]) {
      const t = await Bun.file(new URL(f, import.meta.url)).text();
      expect([f, /REFUND_FEE_RATE|createRefund|refundPayment|issueCreditNote|\/refund`/.test(t)]).toEqual([f, false]);
    }
  });
});

describe("Confirming your payment", () => {
  test("a correctly signed payment the gateway has not confirmed shows 'confirming', never Paid; confirmation then marks it Paid", async () => {
    const t = await team();
    const c = await j(await pay(t.master));
    const r1 = await complete(c, "pay_1", T, "created");
    expect(r1.status).toBe(202); expect((await j(r1)).confirming).toBe(true);
    const s = await j(await call("GET", "/api/z/CAN-1/summary", undefined, t.master));
    expect(s.payment.status).toBe("confirming"); expect(s.paid).toBe(false);
    expect((await j(await call("GET", "/api/z/CAN-1/cohost", undefined, t.cohost))).payment.status).toBe("confirming");
    expect(raw.prepare("SELECT status FROM payment").get()).toEqual({ status: "created" });
    expect((await j(await complete(c, "pay_1", T + 5000, "captured"))).published).toBe(true);
    expect((await j(await call("GET", "/api/z/CAN-1/summary", undefined, t.master))).payment.status).toBe("paid");
  });
  test("a failed or mismatched payment does not leave the game 'confirming'", async () => {
    const t = await team();
    const c = await j(await pay(t.master));
    expect((await complete(c, "pay_9", T, "failed")).status).toBe(402);
    expect((await j(await call("GET", "/api/z/CAN-1/summary", undefined, t.master))).payment.status).toBe("pending");
  });
  test("the gateway's 'authorized' webhook alone shows confirming (and still nothing is Paid)", async () => {
    const t = await team();
    const c = await j(await pay(t.master));
    const raw2 = JSON.stringify({ event: "payment.authorized", payload: { payment: { entity: { id: "pay_w", order_id: c.razorpay.orderId, amount: orders[0].amount } } } });
    const sig = createHmac("sha256", "whsec").update(raw2).digest("hex");
    const r = await handle(new Request("http://x/api/payments/webhook", { method: "POST", headers: { "x-razorpay-signature": sig }, body: raw2 }), env as Env, T);
    expect(r.status).toBe(200);
    expect((await j(await call("GET", "/api/z/CAN-1/summary", undefined, t.master))).payment.status).toBe("confirming");
    expect(raw.prepare("SELECT COUNT(*) AS c FROM payment WHERE status='paid'").get()).toEqual({ c: 0 });
  });
  test("the 'confirming' state wears off after 30 minutes", async () => {
    const t = await team();
    const c = await j(await pay(t.master)); await complete(c, "pay_1", T, "created");
    expect((await j(await call("GET", "/api/z/CAN-1/summary", undefined, t.master, T + 31 * 60_000))).payment.status).toBe("pending");
  });
});

describe("late payment starts 2 minutes after confirmation", () => {
  test("the first number comes 120 to 123 seconds after the payment is confirmed (was about 3 minutes)", async () => {
    const master = await start("boss@acme.com");
    await call("POST", "/api/z", { id: "CAN-1", startRound: START, callSeconds: 9, cap: 300 }, master);
    await call("POST", "/api/z/CAN-1/publish", { email: "boss@acme.com", phone: "9876543210" }, master);
    const late = T + 5 * H + 1234;
    const c = await j(await pay(master, "CAN-1", late));
    const v = await j(await complete(c, "pay_1", late));
    const firstNumber = v.restartedAtMs + 40 * 3000; // GRACE_ROUNDS (40) x 3 s after the start
    expect(firstNumber - late).toBeGreaterThanOrEqual(120_000); expect(firstNumber - late).toBeLessThanOrEqual(123_100);
  });
});

describe("Host e-mail", () => {
  test("a Host needs a valid e-mail; the Host's own link goes to the Host's address, sealed on the key row, never to the Organizer", async () => {
    const master = await start("boss@acme.com");
    for (const bad of ["not-an-email", "a@b"]) expect((await call("POST", "/api/org/host", { mobile: "9876500009", label: "X", ...(bad === undefined ? {} : { email: bad }) }, master)).status).toBe(400);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM organizer_key WHERE kind='host'").get()).toEqual({ c: 0 });
    const r = await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "Priya@Acme.com" }, master));
    expect(r.emailed).toBe(true); expect(r.email).toBe("priya@acme.com");
    const m = mailsTo("priya@acme.com").find((x) => /Host/.test(x.subject))!;
    expect(m.body).toContain(`/zc.html?k=${r.hostKey}`);
    expect(mailsTo("boss@acme.com").some((x) => x.body.includes(`/zc.html?k=${r.hostKey}`))).toBe(false); // the Organizer does not get the Host's own link
    const row = raw.prepare("SELECT email_sealed FROM organizer_key WHERE kind='host'").get() as any;
    expect(row.email_sealed).toMatch(/^v1\./); expect(row.email_sealed).not.toContain("priya");
    expect(JSON.stringify(raw.prepare("SELECT * FROM organizer_key").all())).not.toContain("priya@acme.com");
  });
  test("the team list shows a Host's e-mail to the Organizer and to Hosts, never to an AI key or a Co-host", async () => {
    const t = await team();
    for (const key of [t.master, t.host]) expect((await j(await call("GET", "/api/org/team", undefined, key))).hosts[0].email).toBe("priya@acme.com");
    expect((await call("GET", "/api/org/team", undefined, t.cohost)).status).toBe(403);
    const r = await call("GET", "/api/org/team", undefined, t.ai); expect(r.status).toBe(200);
    expect(JSON.stringify(await j(r))).not.toContain("priya@acme.com");
  });
  test("retiring a Host revokes the key at once and drops the stored e-mail", async () => {
    const t = await team();
    expect((await call("GET", "/api/whoami", undefined, t.host)).status).toBe(200);
    expect((await call("POST", "/api/org/team/retire", { id: t.hostId }, t.master)).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, t.host)).status).toBe(403);
    expect(raw.prepare("SELECT email_sealed, revoked FROM organizer_key WHERE kind='host'").get()).toEqual({ email_sealed: null, revoked: 1 });
  });
});

describe("Co-host: name + mobile (no e-mail), bound to one game", () => {
  test("a name and a valid mobile number are required, and the game must be the account's own", async () => {
    const master = await start("boss@acme.com");
    await call("POST", "/api/z", { id: "CAN-1", startRound: START, callSeconds: 9, cap: 300 }, master);
    const base = { label: "Ravi", phone: "9876500001", e: "CAN-1" };
    for (const bad of [{ ...base, label: "" }, { ...base, label: undefined }, { ...base, phone: "" }, { ...base, phone: "123" }, { ...base, e: undefined }, { ...base, e: "NOPE-1" }]) expect((await call("POST", "/api/org/cohost", bad, master)).status).toBe(400);
    const other = await start("other@rival.com");
    await call("POST", "/api/z", { id: "RIV-1", startRound: START, callSeconds: 9, cap: 100 }, other);
    expect((await call("POST", "/api/org/cohost", { ...base, e: "RIV-1" }, master)).status).toBe(400); // someone else's game
    expect((await call("POST", "/api/org/cohost", base, master)).status).toBe(200);
  });
  test("the mobile number is stored sealed; the team list shows only the last 4 digits, per game", async () => {
    const t = await team();
    await call("POST", "/api/z", { id: "CAN-2", startRound: START, callSeconds: 9, cap: 100 }, t.master);
    await call("POST", "/api/org/cohost", { label: "Sunita", phone: "+91 91234 56789", e: "CAN-2" }, t.master);
    expect(JSON.stringify(raw.prepare("SELECT * FROM organizer_key").all())).not.toMatch(/9876500001|9123456789/);
    const one = await j(await call("GET", "/api/org/team?e=CAN-1", undefined, t.host));
    expect(one.cohosts).toHaveLength(1); expect(one.cohosts[0]).toMatchObject({ label: "Ravi", phoneMasked: "******0001", eid: "CAN-1" });
    const two = await j(await call("GET", "/api/org/team?e=CAN-2", undefined, t.master));
    expect(two.cohosts).toHaveLength(1); expect(two.cohosts[0]).toMatchObject({ label: "Sunita", phoneMasked: "******6789" });
    expect((await j(await call("GET", "/api/org/team", undefined, t.master))).cohosts).toHaveLength(2);
  });
  test("an AI key cannot add a Co-host (it must not handle a mobile number)", async () => {
    const t = await team();
    expect((await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: "CAN-1" }, t.ai)).status).toBe(403);
  });
  test("the Co-host key works for its own game only: header and payment for another game are refused", async () => {
    const t = await team();
    await call("POST", "/api/z", { id: "CAN-2", startRound: START, callSeconds: 9, cap: 100 }, t.master);
    expect((await call("GET", "/api/z/CAN-1/cohost", undefined, t.cohost)).status).toBe(200);
    expect((await call("GET", "/api/z/CAN-2/cohost", undefined, t.cohost)).status).toBe(403);
    expect((await pay(t.cohost, "CAN-2")).status).toBe(403);
    expect((await pay(t.cohost, "CAN-1")).status).toBe(200);
  });
  test("a Co-host's invite link only brings people into its own game", async () => {
    const t = await team();
    await call("POST", "/api/z/CAN-1/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master);
    const h = await j(await call("GET", "/api/z/CAN-1/cohost", undefined, t.cohost));
    expect(h.inviteLink).toContain("from=");
    const from = Number(h.inviteLink.match(/from=(\d+)/)![1]);
    await call("POST", "/api/z", { id: "CAN-2", startRound: START, callSeconds: 9, cap: 100 }, t.master); await call("POST", "/api/z/CAN-2/publish", { email: "boss@acme.com", phone: "9876543210" }, t.master);
    await call("POST", "/api/z/CAN-1/join", { phone: "9876543210", from }); await call("POST", "/api/z/CAN-2/join", { phone: "9876543211", from });
    expect(raw.prepare("SELECT src FROM seat WHERE eid='CAN-1'").get()).toMatchObject({ src: expect.stringMatching(/^co:/) });
    expect((raw.prepare("SELECT src FROM seat WHERE eid='CAN-2'").get() as any).src).toBe("link"); // not credited to a Co-host of another game
  });
  test("name and mobile are erased (key retired) when the game's participant data is erased", async () => {
    const t = await team(); await paidGame(t); await join("9876543210");
    expect((await call("POST", "/api/z/CAN-1/erase", {}, t.master)).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, t.cohost)).status).toBe(403);
    expect(raw.prepare("SELECT label, pii, revoked FROM organizer_key WHERE kind='cohost'").get()).toEqual({ label: null, pii: null, revoked: 1 });
  });
  test("name and mobile are erased by the automatic 23-hour deletion, even if nobody joined", async () => {
    const t = await team(); await paidGame(t);
    await lifecycleTick(env as any, T + 3 * H + 22 * H); // the game ended long before; 23 h after the end has not passed yet
    expect((raw.prepare("SELECT revoked FROM organizer_key WHERE kind='cohost'").get() as any).revoked).toBe(0);
    await lifecycleTick(env as any, T + 3 * H + 40 * H);
    expect(raw.prepare("SELECT label, pii, revoked FROM organizer_key WHERE kind='cohost'").get()).toEqual({ label: null, pii: null, revoked: 1 });
  });
  test("cancelling the game erases the Co-hosts at once", async () => {
    const t = await team();
    await cancelIt(t.master);
    expect(raw.prepare("SELECT label, pii, revoked FROM organizer_key WHERE kind='cohost'").get()).toEqual({ label: null, pii: null, revoked: 1 });
    expect((await call("POST", "/api/org/cohost", { label: "New", phone: "9876500009", e: "CAN-1" }, t.master)).status).toBe(409);
  });
});

describe("'your guests' personal data has been deleted' e-mail", () => {
  test("the automatic deletion mails the Organizer and every Host with the exact time in IST; the Co-host (no e-mail) gets nothing", async () => {
    const t = await team(); await paidGame(t); await join("9876543210", "Asha");
    const at = T + 3 * H + 40 * H;
    await lifecycleTick(env as any, at);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='CAN-1'").get()).toEqual({ c: 0 });
    for (const to of ["boss@acme.com", "priya@acme.com"]) {
      const m = mailsTo(to).filter((x) => /personal data has been deleted/i.test(x.subject));
      expect(m).toHaveLength(1);
      expect(m[0]!.body).toMatch(/IST/); expect(m[0]!.body).toMatch(/permanently deleted on/);
    }
    expect(outbox("%personal data has been deleted%").every((m) => ["boss@acme.com", "priya@acme.com"].includes(m.to_addr))).toBe(true);
    const n = outbox("%personal data has been deleted%").length;
    await lifecycleTick(env as any, at + H); // a second tick does not mail again
    expect(outbox("%personal data has been deleted%")).toHaveLength(n);
  });
});
