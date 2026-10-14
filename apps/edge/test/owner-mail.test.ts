// E9: the owner is told of every paid order, once. Through the real Worker, with a stand-in for Razorpay's REST API; mail is read from the local outbox.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { OWNER_NOTIFY_EMAIL, notifyOwnerOfPaidOrder } from "../src/owner-mail";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let rz: { orders: any[]; payments: Record<string, any> };
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const buy = (o: Record<string, unknown> = {}) => call("POST", "/api/checkout", { org: "Acme Ltd", name: "Asha Rao", email: "asha@acme.com", country: "IN", taxId: "", pack: 500, currency: "INR", ...o });
const ownerMails = () => raw.query("SELECT to_addr, subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(OWNER_NOTIFY_EMAIL) as { to_addr: string; subject: string; body: string }[];

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  rz = { orders: [], payments: {} };
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (rz.orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; rz.orders.push(o); return new Response(JSON.stringify(o), { status: 200 }); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = rz.payments[pm[1]!]; if (!p) return new Response("{}", { status: 404 }); if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p), { status: 200 }); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

const verify = (paymentId: string, orderId: string, payId = "pay_1") => {
  rz.payments[payId] = { id: payId, order_id: orderId, status: "captured", amount: rz.orders.find((o) => o.id === orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: hmac("sek", `${orderId}|${payId}`) });
};
const hook = (orderId: string, payId = "pay_w1") => {
  const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: payId, order_id: orderId, amount: rz.orders.find((o) => o.id === orderId)!.amount } } } });
  return call("POST", "/api/payments/webhook", rawBody, { "x-razorpay-signature": hmac("whsec", rawBody) });
};

describe("E9: the owner is told of each paid order", () => {
  test("a verified payment mails the owner once: game, plan, amount, transaction id, organizer name and e-mail", async () => {
    const o = (await (await buy()).json()) as any;
    expect(ownerMails().length).toBe(0); // an order that is only opened is not a paid order
    expect((await verify(o.paymentId, o.razorpay.orderId)).status).toBe(200);
    const m = ownerMails(); expect(m.length).toBe(1);
    const txn = (raw.query("SELECT txn_id FROM payment").get() as any).txn_id as string; expect(txn).toMatch(/^TTT-/);
    expect(m[0]!.subject).toContain("Paid order"); expect(m[0]!.subject).toContain("Corporate Tic Tac Toe");
    for (const part of ["Game: Corporate Tic Tac Toe", "up to 500", txn, "Asha Rao", "asha@acme.com", "Rs"]) expect(m[0]!.body).toContain(part);
  });
  test("the webhook and the verify call for the same payment send the note only once, whichever comes first", async () => {
    const o = (await (await buy()).json()) as any;
    expect((await hook(o.razorpay.orderId)).status).toBe(200);
    expect((await verify(o.paymentId, o.razorpay.orderId)).status).toBe(200);
    expect((await hook(o.razorpay.orderId)).status).toBe(200);
    expect(ownerMails().length).toBe(1);
    const o2 = (await (await buy({ email: "second@acme.com" })).json()) as any;
    expect((await verify(o2.paymentId, o2.razorpay.orderId, "pay_2")).status).toBe(200);
    expect((await hook(o2.razorpay.orderId, "pay_w2")).status).toBe(200);
    expect(ownerMails().length).toBe(2); // a second payment is a second note
  });
  test("the claim is one row per payment, so two calls at the same instant cannot both send", async () => {
    const sent: string[] = [];
    const order = { gameLabel: "Corporate Tic Tac Toe", paymentId: "pay_same", txnId: "TTT-pay_same", planLabel: "up to 500 players", amountText: "Rs 100", organizerName: "Asha", organizerEmail: "asha@acme.com" };
    const results = await Promise.all([1, 2, 3].map(() => notifyOwnerOfPaidOrder(async (subject) => { sent.push(subject); return true; }, env.DB, order, T)));
    expect(results.filter(Boolean).length).toBe(1); expect(sent.length).toBe(1);
    expect((raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE 'ownerpaid/%'").get() as any).c).toBe(1);
  });
  test("in TEST mode the note still reaches the owner (marked TEST)", async () => {
    expect((await call("POST", "/api/owner/mode", { mode: "TEST", reason: "rehearsal" }, { "x-organizer": "plat" })).status).toBe(200);
    const r = (await (await buy()).json()) as any; expect(r.mode).toBe("test"); expect(r.result.ok).toBe(true); // TEST mode fulfils at once, without Razorpay
    const m = ownerMails(); expect(m.length).toBe(1); expect(m[0]!.subject.startsWith("[TEST]")).toBe(true);
  });
  test("a payment that is refused (wrong signature) sends nothing", async () => {
    const o = (await (await buy()).json()) as any;
    rz.payments["pay_x"] = { id: "pay_x", order_id: o.razorpay.orderId, status: "captured", amount: rz.orders[0].amount };
    const r = await call("POST", "/api/payments/verify", { paymentId: o.paymentId, razorpay_order_id: o.razorpay.orderId, razorpay_payment_id: "pay_x", razorpay_signature: "bad" });
    expect(r.status).toBeGreaterThanOrEqual(400); expect(ownerMails().length).toBe(0);
  });
});
