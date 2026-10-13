// Ledger C (this website's own payment ledger), connected to the central ledger B and to Razorpay A: ids, every attempt, refunds, fee and tax, commission and monthly figures posted to B.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";
import { SITE_CODE, monthKeyOf, monthRange, prevMonthKey, txnIdOf } from "../src/ledgerc";

const T = Date.UTC(2026, 9, 1, 10, 0, 0); // 2026-10-01 15:30 IST
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
interface Rz { orders: any[]; payments: Record<string, any>; calls: { url: string; init: any; body: any }[]; commission: (b: any) => { status: number; body: any }; summary: (b: any) => { status: number; body: any } }
let rz: Rz;
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");
const plat = { "x-organizer": "plat" };
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const buy = (o: Record<string, unknown> = {}) => call("POST", "/api/checkout", { org: "Acme Ltd", email: "Boss@Acme.com", country: "IN", taxId: "", pack: 500, currency: "INR", ...o });
const ok = (b: unknown = {}) => ({ status: 200, body: b });

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  rz = { orders: [], payments: {}, calls: [], commission: () => ok({ ok: true }), summary: () => ok({ ok: true }) };
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url); let body: any = null; try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    rz.calls.push({ url: u, init, body });
    if (u.startsWith("https://rzp.test/v1/orders")) { const o = { id: "order_" + (rz.orders.length + 1), amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created" }; rz.orders.push(o); return new Response(JSON.stringify(o), { status: 200 }); }
    const pm = u.match(/rzp\.test\/v1\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = rz.payments[pm[1]!]; if (!p) return new Response(JSON.stringify({ error: { description: "no such payment" } }), { status: 404 }); if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p), { status: 200 }); }
    if (u === "https://central.test/api/pay/order") { const o = { id: "order_c" + (rz.orders.length + 1), amount: body.amount_minor, currency: body.currency }; rz.orders.push(o); return new Response(JSON.stringify({ ok: true, orderId: o.id, txn_id: `${SITE_CODE}-${body.payment_ref}` }), { status: 200 }); }
    if (u === "https://central.test/api/pay/verify") return new Response(JSON.stringify({ ok: true, txn_id: `${SITE_CODE}-x`, fee_minor: 11800, tax_minor: 1800, paid: true }), { status: 200 });
    if (u === "https://central.test/api/pay/commission") { const r = rz.commission(body); return new Response(JSON.stringify(r.body), { status: r.status }); }
    if (u === "https://central.test/api/pay/site-summary") { const r = rz.summary(body); return new Response(JSON.stringify(r.body), { status: r.status }); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

const central = () => { env.PAY_SERVICE_KEY = "site-key-for-tests"; env.PAY_SERVICE_URL = "https://central.test"; };
const centralCalls = (path: string) => rz.calls.filter((c) => c.url === "https://central.test" + path);
const hook = (ev: unknown, eventId?: string, secret = "whsec") => { const body = JSON.stringify(ev); return call("POST", "/api/payments/webhook", body, { "x-razorpay-signature": hmac(secret, body), ...(eventId ? { "x-razorpay-event-id": eventId } : {}) }); };
const entity = (orderId: string, id: string, extra: Record<string, unknown> = {}, amount = 469900) => ({ id, order_id: orderId, amount, currency: "INR", ...extra });
const captured = (orderId: string, id = "pay_ok", extra: Record<string, unknown> = {}, createdAt = Math.floor(T / 1000)) => ({ event: "payment.captured", created_at: createdAt, payload: { payment: { entity: entity(orderId, id, { status: "captured", ...extra }) } } });
const failed = (orderId: string, id = "pay_f1", createdAt = Math.floor(T / 1000) - 60) => ({ event: "payment.failed", created_at: createdAt, payload: { payment: { entity: entity(orderId, id, { status: "failed", method: "upi", vpa: "someone@okbank", error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed because of insufficient balance", error_source: "customer", error_step: "payment_authorization", error_reason: "insufficient_funds" }) } } });
const attempts = () => raw.query("SELECT * FROM payment_attempt ORDER BY rzp_payment_id").all() as any[];
const payRow = (id: string) => raw.query("SELECT * FROM payment WHERE id=?").get(id) as any;
const newBuy = async () => { const r = await (await buy()).json() as any; return { paymentId: r.paymentId as string, orderId: r.razorpay.orderId as string }; };

describe("the id that ties A, B and C together", () => {
  test("txn_id is the site code, a dash and the website's own payment id; it is stored on the payment and put in the Razorpay order notes", async () => {
    expect(SITE_CODE).toBe("TTT");
    expect(txnIdOf("pay_0123456789abcdef")).toBe("TTT-pay_0123456789abcdef");
    const { paymentId } = await newBuy();
    expect(paymentId).toMatch(/^pay_[0-9a-f]{16}$/);
    expect(payRow(paymentId).txn_id).toBe(`TTT-${paymentId}`);
    expect(rz.orders[0].notes.txn_id).toBe(`TTT-${paymentId}`); // the order opened straight with Razorpay (no central service key) carries it in the notes (A)
    expect(rz.orders[0].notes.payment_ref).toBe(paymentId);
  });
  test("the Rs 1 payment test gets its txn_id too, and so does a payment made in TEST mode (no Razorpay)", async () => {
    const r = await (await call("POST", "/api/payments/paytest", { email: "t@x.com", name: "Tess Tester" })).json() as any;
    expect(payRow(r.paymentId).txn_id).toBe(`TTT-${r.paymentId}`);
    expect(rz.orders.at(-1).notes.txn_id).toBe(`TTT-${r.paymentId}`);
    env.RAZORPAY_KEY_ID = undefined; env.RAZORPAY_KEY_SECRET = undefined; env.TEST_MODE = "1";
    const t = await (await buy({ email: "other@x.com" })).json() as any;
    expect(payRow(t.paymentId).txn_id).toBe(`TTT-${t.paymentId}`);
  });
  test("the central order carries the same id back and the payment keeps its own; the unique index forbids two payments with one txn_id", async () => {
    central();
    const { paymentId } = await newBuy();
    expect(centralCalls("/api/pay/order")[0]!.body.payment_ref).toBe(paymentId);
    expect(payRow(paymentId).txn_id).toBe(`TTT-${paymentId}`);
    expect(() => raw.run("UPDATE payment SET txn_id='TTT-dup' WHERE id=?", [paymentId])).not.toThrow();
    const { paymentId: second } = await (async () => { const r = await (await buy({ email: "b@x.com" })).json() as any; return { paymentId: r.paymentId as string }; })();
    expect(() => raw.run("UPDATE payment SET txn_id='TTT-dup' WHERE id=?", [second])).toThrow();
  });
});

describe("every attempt is kept (webhook), success and failure, once", () => {
  test("a failed try never marks the payment paid; the paying try that follows does, exactly once; a repeated event id is ignored", async () => {
    const { paymentId, orderId } = await newBuy();
    expect((await hook(failed(orderId), "evt_f1")).status).toBe(200);
    expect(await (await hook(failed(orderId), "evt_f1")).json()).toMatchObject({ duplicate: "evt_f1" });
    expect(payRow(paymentId).status).toBe("created");
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT COUNT(*) c FROM invoice").get()).toEqual({ c: 0 });
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toMatchObject({ rzp_payment_id: "pay_f1", payment_id: paymentId, rzp_order_id: orderId, txn_id: `TTT-${paymentId}`, status: "failed", method: "upi", error_code: "BAD_REQUEST_ERROR", error_reason: "insufficient_funds", amount_minor: 469900, currency: "INR", failed_ms: (Math.floor(T / 1000) - 60) * 1000 });
    expect(attempts()[0].error_description).toContain("insufficient balance");
    // the buyer tries again and pays
    expect((await hook(captured(orderId, "pay_ok", { method: "upi" }), "evt_c1")).status).toBe(200);
    expect(await (await hook(captured(orderId, "pay_ok", { method: "upi" }), "evt_c1")).json()).toMatchObject({ duplicate: "evt_c1" });
    expect((await hook(captured(orderId, "pay_ok", { method: "upi" }), "evt_c2")).status).toBe(200); // a different event id, same payment: still one grant, one attempt row
    expect(payRow(paymentId)).toMatchObject({ status: "paid", rzp_payment_id: "pay_ok", txn_id: `TTT-${paymentId}` });
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT COUNT(*) c FROM invoice").get()).toEqual({ c: 1 });
    expect(attempts().map((a) => [a.rzp_payment_id, a.status])).toEqual([["pay_f1", "failed"], ["pay_ok", "captured"]]);
    expect(raw.query("SELECT rzp_event_id FROM event_seen ORDER BY rzp_event_id").all()).toEqual([{ rzp_event_id: "evt_c1" }, { rzp_event_id: "evt_c2" }, { rzp_event_id: "evt_f1" }]);
    const outcomes = (raw.query("SELECT outcome FROM webhook_log ORDER BY id").all() as any[]).map((r) => r.outcome);
    expect(outcomes.filter((o) => o === "duplicate event ignored")).toHaveLength(2);
  });
  test("without Razorpay's event-id header (the central service does not forward it) a repeated message is still recognised from its own content", async () => {
    const { paymentId, orderId } = await newBuy();
    const body = JSON.stringify(captured(orderId, "pay_ok")), sign = { "x-razorpay-signature": hmac("whsec", body) };
    expect((await call("POST", "/api/payments/webhook", body, sign)).status).toBe(200);
    expect(await (await call("POST", "/api/payments/webhook", body, sign)).json()).toMatchObject({ duplicate: expect.stringMatching(/^d:payment\.captured:pay_ok:\d+$/) });
    expect(payRow(paymentId).status).toBe("paid"); expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 1 });
    const later = JSON.stringify(captured(orderId, "pay_ok", {}, Math.floor(T / 1000) + 5)); // a different moment is a different event
    expect(await (await call("POST", "/api/payments/webhook", later, { "x-razorpay-signature": hmac("whsec", later) })).json()).toMatchObject({ ok: true, fulfilled: paymentId });
  });
  test("a payment that failed and was then authorised by the bank (same Razorpay payment) is one row that ends captured, with both times kept; a late failed message never undoes a capture", async () => {
    const { paymentId, orderId } = await newBuy();
    await hook(failed(orderId, "pay_u1", Math.floor(T / 1000) - 120), "e1");
    await hook(captured(orderId, "pay_u1", { method: "upi" }, Math.floor(T / 1000)), "e2");
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toMatchObject({ status: "captured", failed_ms: (Math.floor(T / 1000) - 120) * 1000, captured_ms: Math.floor(T / 1000) * 1000, event_ms: Math.floor(T / 1000) * 1000, error_reason: "insufficient_funds" });
    expect(payRow(paymentId).status).toBe("paid");
    await hook(failed(orderId, "pay_u1", Math.floor(T / 1000) - 120), "e3"); // a delayed copy of the old failure
    expect(attempts()[0].status).toBe("captured");
    expect(payRow(paymentId).status).toBe("paid");
  });
  test("an authorized message is kept as an attempt and marks nothing paid", async () => {
    const { paymentId, orderId } = await newBuy();
    await hook({ event: "payment.authorized", created_at: Math.floor(T / 1000), payload: { payment: { entity: entity(orderId, "pay_a1", { status: "authorized", method: "card", card: { network: "Visa", type: "credit", last4: "1111" } }) } } }, "ea");
    expect(attempts()[0]).toMatchObject({ status: "authorized", card_network: "Visa", card_type: "credit", card_last4: "1111", authorized_ms: Math.floor(T / 1000) * 1000 });
    expect(payRow(paymentId).status).toBe("created");
  });
  test("a message for an order this website did not open is not filed; a message that was not processed (a busy day) is not marked as seen", async () => {
    await hook(failed("order_unknown"), "ex");
    expect(attempts()).toHaveLength(0);
    const { orderId } = await newBuy();
    env.DAILY_WRITE_BUDGET = "0"; // fulfilment answers 503 "busy"
    const r = await hook(captured(orderId), "e-busy");
    expect(r.status).toBe(503);
    expect(raw.query("SELECT COUNT(*) c FROM event_seen WHERE rzp_event_id='e-busy'").get()).toEqual({ c: 0 }); // Razorpay will deliver it again and it will be handled then
  });
});

describe("refunds", () => {
  test("a refund is one row however often it is reported; its status only moves forward", async () => {
    const { paymentId, orderId } = await newBuy();
    await hook(captured(orderId, "pay_ok"), "ec");
    const rf = (event: string, status: string, id = "rfnd_1") => ({ event, created_at: Math.floor(T / 1000), payload: { refund: { entity: { id, payment_id: "pay_ok", amount: 100000, currency: "INR", status, created_at: Math.floor(T / 1000) } } } });
    expect((await hook(rf("refund.created", "pending"), "r1")).status).toBe(200);
    await hook(rf("refund.processed", "processed"), "r2");
    await hook(rf("refund.created", "pending"), "r3"); // a stale copy of the first message
    const rows = raw.query("SELECT * FROM payment_refund").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rzp_refund_id: "rfnd_1", rzp_payment_id: "pay_ok", payment_id: paymentId, txn_id: `TTT-${paymentId}`, amount_minor: 100000, status: "processed", currency: "INR" });
    await hook(rf("refund.failed", "failed", "rfnd_2"), "r4");
    expect(raw.query("SELECT status FROM payment_refund WHERE rzp_refund_id='rfnd_2'").get()).toEqual({ status: "failed" });
    expect(payRow(paymentId).status).toBe("paid"); // a refund message never changes what was sold
  });
});

describe("fee, tax, method and the bank reference are kept", () => {
  const detailed = { method: "card", fee: 11800, tax: 1800, card: { network: "Visa", type: "credit", last4: "1111", number: "4111111111111111" }, vpa: "someone@okbank", bank: "HDFC", acquirer_data: { rrn: "123456789012", auth_code: "A1B2C3" } };
  test("webhook path: the payment row and the attempt carry fee, tax, method, bank, card tail and rrn", async () => {
    const { paymentId, orderId } = await newBuy();
    await hook(captured(orderId, "pay_ok", detailed), "ec");
    expect(payRow(paymentId)).toMatchObject({ fee_minor: 11800, tax_minor: 1800, method: "card", bank: "HDFC", card_network: "Visa", card_type: "credit", rrn: "123456789012", txn_id: `TTT-${paymentId}` });
    expect(attempts()[0]).toMatchObject({ fee_minor: 11800, tax_minor: 1800, rrn: "123456789012", card_last4: "1111", vpa_masked: "so***@okbank" });
  });
  test("no full card number and no full UPI id is stored anywhere", async () => {
    const { orderId } = await newBuy();
    await hook(failed(orderId), "ef");
    await hook(captured(orderId, "pay_ok", detailed), "ec");
    const dump = JSON.stringify(["payment", "payment_attempt", "payment_refund", "webhook_log", "event_seen"].map((t) => raw.query(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toContain("4111111111111111");
    expect(dump).not.toContain("someone@okbank");
    expect(dump).toContain("so***@okbank");
  });
  test("browser path: Razorpay's payment gives the figures; if it lacks them, the central service's answer does", async () => {
    central();
    const { paymentId, orderId } = await newBuy();
    rz.payments.pay_v1 = { id: "pay_v1", order_id: orderId, status: "captured", amount: 469900, currency: "INR", method: "upi", acquirer_data: { rrn: "999" } };
    const r = await call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_v1", razorpay_signature: hmac("sek", `${orderId}|pay_v1`) });
    expect(r.status).toBe(200);
    expect(payRow(paymentId)).toMatchObject({ status: "paid", method: "upi", rrn: "999", fee_minor: 11800, tax_minor: 1800 }); // fee and tax from B's answer (Razorpay's message had none yet)
    expect(attempts()[0]).toMatchObject({ rzp_payment_id: "pay_v1", status: "captured", payment_id: paymentId, currency: "INR" });
  });
  test("browser path: a failed payment is kept as a failed attempt with Razorpay's reason and the payment stays unpaid", async () => {
    const { paymentId, orderId } = await newBuy();
    rz.payments.pay_bad = { id: "pay_bad", order_id: orderId, status: "failed", amount: 469900, error_code: "GATEWAY_ERROR", error_reason: "payment_timeout", error_description: "timed out" };
    const r = await call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_bad", razorpay_signature: hmac("sek", `${orderId}|pay_bad`) });
    expect(r.status).toBe(402);
    expect(attempts()[0]).toMatchObject({ rzp_payment_id: "pay_bad", status: "failed", error_code: "GATEWAY_ERROR", error_reason: "payment_timeout", currency: "INR" });
    expect(payRow(paymentId).status).toBe("created");
  });
});

describe("commission is posted to the central ledger", () => {
  let CODE = "";
  const addPartner = (isTest = 0) => { CODE = "ABCDEFGH"; raw.run("INSERT INTO partner(code,key_hash,name,source,enrolled_ms,consent_ms,state,is_test) VALUES(?,?,?,?,?,?,?,?)", [CODE, "kh", "Asha", "direct", T, T, "active", isTest]); };
  /** a referred purchase paid through the browser path */
  const paidSale = async (payId: string, email = "b@x.com") => {
    const r = await (await buy({ ref: CODE, email })).json() as any;
    rz.payments[payId] = { id: payId, order_id: r.razorpay.orderId, status: "captured", amount: r.razorpay.amount, currency: "INR", method: "upi" };
    await call("POST", "/api/payments/verify", { paymentId: r.paymentId, razorpay_order_id: r.razorpay.orderId, razorpay_payment_id: payId, razorpay_signature: hmac("sek", `${r.razorpay.orderId}|${payId}`) });
    return r.paymentId as string;
  };
  const crow = (paymentId: string) => raw.query("SELECT * FROM commission WHERE payment_id=?").get(paymentId) as any;
  beforeEach(() => { central(); addPartner(); });

  test("a new accrued commission is posted at once with the exact body the central ledger expects", async () => {
    const pid = await paidSale("pay_s1");
    const c = crow(pid);
    expect(c).toMatchObject({ status: "accrued", amount: 2349.5, sync_status: "accrued" }); expect(c.synced_ms).toBe(T);
    const posts = centralCalls("/api/pay/commission");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.init.headers["x-site-key"]).toBe("site-key-for-tests");
    expect(posts[0]!.body).toEqual({ site: "corporate-tic-tac-toe.pages.dev", site_ref: String(c.id), payment_ref: pid, partner_code: CODE, amount_minor: 234950, currency: "INR", status: "accrued" });
  });
  test("409 (the sale is not in B yet) keeps the row unsynced and it is retried by the tick, not sooner than 10 minutes", async () => {
    let answer = 409; rz.commission = () => (answer === 409 ? { status: 409, body: { error: "the sale is not a paid sale in the central ledger yet" } } : ok({ ok: true }));
    const pid = await paidSale("pay_s1");
    expect(crow(pid)).toMatchObject({ sync_status: null, synced_ms: null }); expect(crow(pid).sync_error).toContain("409");
    const before = centralCalls("/api/pay/commission").length;
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 5 * 60_000); // too soon
    expect(centralCalls("/api/pay/commission").length).toBe(before);
    answer = 200;
    const t = await (await call("POST", "/api/lifecycle/tick", {}, plat, T + 11 * 60_000)).json() as any;
    expect(t.ledgerC.commission).toMatchObject({ posted: 1 });
    expect(crow(pid)).toMatchObject({ sync_status: "accrued", sync_error: null }); expect(crow(pid).synced_ms).toBe(T + 11 * 60_000);
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 30 * 60_000); // synced rows are not posted again
    expect(centralCalls("/api/pay/commission").filter((c) => c.body.status === "accrued").length).toBe(before + 1);
  });
  test("void and paid are posted when they happen: void by the owner's route, paid with the payout reference", async () => {
    const a = await paidSale("pay_s1", "a@x.com"), b = await paidSale("pay_s2", "b2@x.com");
    centralCalls("/api/pay/commission").length; rz.calls.length = 0;
    expect((await call("POST", "/api/partners/commission/void", { paymentId: a, reason: "refund" }, plat)).status).toBe(200);
    expect(centralCalls("/api/pay/commission").map((c) => [c.body.payment_ref, c.body.status])).toEqual([[a, "void"]]);
    expect(crow(a)).toMatchObject({ status: "void", sync_status: "void" });
    rz.calls.length = 0;
    await call("POST", "/api/partners/payout", { code: CODE, reference: "UTR12345" }, plat);
    const paid = centralCalls("/api/pay/commission");
    expect(paid).toHaveLength(1); expect(paid[0]!.body).toMatchObject({ payment_ref: b, status: "paid", paid_ref: "UTR12345", amount_minor: 234950, site_ref: String(crow(b).id) });
    expect(crow(b)).toMatchObject({ status: "paid", sync_status: "paid" });
  });
  test("rows that must not be posted are not: TEST-mode rows, TEST-mode payments, rows waiting for a rate, blocked rows, a void that B never heard of", async () => {
    const pid = await paidSale("pay_s1");
    rz.calls.length = 0;
    raw.run("UPDATE commission SET is_test=1, sync_status=NULL, synced_ms=NULL WHERE payment_id=?", [pid]);
    raw.run("INSERT INTO payment(id,email,pack,currency,amount,tax,status,created_ms,meta,is_test,rzp_payment_id) VALUES('pay_t','t@x.com',100,'INR',1,0,'paid',?, '{}',1,'pay_zzz')", [T]);
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms,is_test) VALUES('pay_t',?,1,'INR',0.5,0.5,'accrued',?,0)", [CODE, T]); // a real row on a TEST-mode payment
    raw.run("INSERT INTO payment(id,email,pack,currency,amount,tax,status,created_ms,meta,is_test,rzp_payment_id) VALUES('pay_r','r@x.com',100,'INR',1,0,'paid',?, '{}',0,'pay_rrr')", [T]);
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,status,created_ms) VALUES('pay_r',?,1,'INR','pending_rate',?)", [CODE, T]);
    raw.run("INSERT INTO payment(id,email,pack,currency,amount,tax,status,created_ms,meta,is_test,rzp_payment_id) VALUES('pay_b','b@x.com',100,'INR',1,0,'paid',?, '{}',0,'pay_bbb')", [T]);
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,status,reason,created_ms) VALUES('pay_b',?,1,'INR','blocked','self_referral',?)", [CODE, T]);
    raw.run("INSERT INTO payment(id,email,pack,currency,amount,tax,status,created_ms,meta,is_test,rzp_payment_id) VALUES('pay_v','v@x.com',100,'INR',1,0,'paid',?, '{}',0,'pay_vvv')", [T]);
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,amount,status,created_ms) VALUES('pay_v',?,1,'INR',0.5,'void',?)", [CODE, T]);
    const t = await (await call("POST", "/api/lifecycle/tick", {}, plat, T + 60_000)).json() as any;
    expect(centralCalls("/api/pay/commission")).toHaveLength(0);
    expect(t.ledgerC.commission).toMatchObject({ posted: 0, skipped: 1 }); // only the void that was never posted is closed without a call
    expect(raw.query("SELECT sync_status FROM commission WHERE payment_id='pay_v'").get()).toEqual({ sync_status: "void" });
    raw.run("UPDATE commission SET status='accrued', amount=0.5 WHERE payment_id='pay_r'"); // the rate is set: now it is posted
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 120_000);
    expect(centralCalls("/api/pay/commission").map((c) => c.body.payment_ref)).toEqual(["pay_r"]);
  });
  test("with no central key nothing is sent and nothing breaks", async () => {
    env.PAY_SERVICE_KEY = undefined;
    const pid = await paidSale("pay_s1");
    expect(crow(pid)).toMatchObject({ status: "accrued", sync_status: null });
    expect(centralCalls("/api/pay/commission")).toHaveLength(0);
  });
});

describe("the monthly figures are posted to the central ledger", () => {
  const sep = Date.UTC(2026, 8, 10, 6, 0, 0), oct = Date.UTC(2026, 9, 1, 4, 0, 0);
  const addPay = (id: string, o: { amount: number; paid?: number | null; status?: string; test?: number; type?: string; rzp?: string | null; fee?: number; tax?: number }) =>
    raw.run("INSERT INTO payment(id,email,pack,currency,amount,tax,status,created_ms,paid_ms,meta,is_test,product_type,rzp_payment_id,fee_minor,tax_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [id, `${id}@x.com`, 100, "INR", o.amount, 0, o.status ?? "paid", o.paid ?? oct, o.paid ?? oct, "{}", o.test ?? 0, o.type ?? "game_pack", o.rzp === undefined ? "rzp_" + id : o.rzp, o.fee ?? null, o.tax ?? null]);
  const seed = () => {
    addPay("pay_1", { amount: 1000, fee: 2360, tax: 360 });
    addPay("pay_2", { amount: 2000.5, fee: 4720, tax: 720 });
    addPay("pay_old", { amount: 500, paid: sep, fee: 1180, tax: 180 });
    addPay("pay_test", { amount: 1, test: 1, type: "payment_test", fee: 0, tax: 0 }); // the Rs 1 payment test is real money in A and a paid sale in B
    addPay("pay_mode", { amount: 999, test: 1, rzp: null }); // made in TEST mode: no Razorpay, never counted
    addPay("pay_credit", { amount: 0, rzp: null }); // a game paid wholly from credit: not a new sale
    addPay("pay_unpaid", { amount: 700, status: "created", paid: null });
    raw.run("INSERT INTO payment_attempt(rzp_payment_id,payment_id,status,currency,amount_minor,failed_ms,updated_ms) VALUES('pay_x1','pay_unpaid','failed','INR',70000,?,?)", [oct, oct]);
    raw.run("INSERT INTO payment_attempt(rzp_payment_id,payment_id,status,currency,amount_minor,failed_ms,updated_ms) VALUES('pay_x2','pay_1','failed','INR',100000,?,?)", [sep, sep]);
    raw.run("INSERT INTO payment_refund(rzp_refund_id,rzp_payment_id,payment_id,currency,amount_minor,status,created_ms,updated_ms) VALUES('rfnd_a','rzp_pay_1','pay_1','INR',30000,'processed',?,?)", [oct, oct]);
    raw.run("INSERT INTO payment_refund(rzp_refund_id,rzp_payment_id,payment_id,currency,amount_minor,status,created_ms,updated_ms) VALUES('rfnd_b','rzp_pay_1','pay_1','INR',99900,'failed',?,?)", [oct, oct]);
    raw.run("INSERT INTO partner(code,key_hash,enrolled_ms,consent_ms) VALUES('ABCDEFGH','k',0,0)");
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms,is_test) VALUES('pay_1','ABCDEFGH',1000,'INR',0.5,500,'accrued',?,0)", [oct]);
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms,paid_ms,paid_ref,is_test) VALUES('pay_2','ABCDEFGH',2000,'INR',0.5,1000.25,'paid',?,?,'UTR1',0)", [oct, oct]);
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms,is_test) VALUES('pay_old','ABCDEFGH',500,'INR',0.5,250,'accrued',?,1)", [oct]); // a test commission is never counted
  };
  beforeEach(() => { central(); seed(); });

  test("month helpers use the Indian month", () => {
    expect(monthKeyOf(Date.UTC(2026, 8, 30, 18, 29, 59))).toBe("2026-09"); expect(monthKeyOf(Date.UTC(2026, 8, 30, 18, 30, 0))).toBe("2026-10"); // 00:00 IST on 1 October
    expect(prevMonthKey("2026-01")).toBe("2025-12"); expect(monthRange("2026-10").from).toBe(Date.UTC(2026, 8, 30, 18, 30, 0));
  });
  test("the tick sends this month and last month with the right figures, at most once every 30 minutes, and a failed try is repeated after 5 minutes", async () => {
    const t1 = await (await call("POST", "/api/lifecycle/tick", {}, plat, T)).json() as any;
    expect(t1.ledgerC.summary).toMatchObject({ pushed: 2 });
    const posts = centralCalls("/api/pay/site-summary").map((c) => c.body);
    expect(posts).toHaveLength(2);
    const cur = posts.find((p) => p.period_key === "2026-10")!, old = posts.find((p) => p.period_key === "2026-09")!;
    expect(cur).toEqual({ site: "corporate-tic-tac-toe.pages.dev", period_key: "2026-10", currency: "INR", paid_count: 3, failed_count: 1, revenue_minor: 100000 + 200050 + 100, fee_minor: 2360 + 4720, tax_minor: 360 + 720, refunded_minor: 30000, commission_accrued_minor: 50000, commission_paid_minor: 100025 });
    expect(old).toMatchObject({ period_key: "2026-09", paid_count: 1, failed_count: 1, revenue_minor: 50000, fee_minor: 1180, tax_minor: 180, refunded_minor: 0, commission_accrued_minor: 0, commission_paid_minor: 0 });
    expect(raw.query("SELECT v FROM ledger_state WHERE k='last_push_ms'").get()).toEqual({ v: String(T) });
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 29 * 60_000);
    expect(centralCalls("/api/pay/site-summary")).toHaveLength(2); // not again within 30 minutes
    rz.summary = () => ({ status: 500, body: { error: "down" } });
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 31 * 60_000); // due, but B refuses
    expect(centralCalls("/api/pay/site-summary")).toHaveLength(4);
    expect(raw.query("SELECT v FROM ledger_state WHERE k='last_push_ms'").get()).toEqual({ v: String(T) }); // not recorded as sent
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 33 * 60_000); // within 5 minutes of the failed try
    expect(centralCalls("/api/pay/site-summary")).toHaveLength(4);
    rz.summary = () => ok({ ok: true });
    await call("POST", "/api/lifecycle/tick", {}, plat, T + 37 * 60_000);
    expect(centralCalls("/api/pay/site-summary")).toHaveLength(6);
    expect(raw.query("SELECT v FROM ledger_state WHERE k='last_push_ms'").get()).toEqual({ v: String(T + 37 * 60_000) });
  });
});

describe("the owner's view of C", () => {
  const oct = Date.UTC(2026, 9, 1, 4, 0, 0);
  test("only the owner may read it: no key, a wrong key and an owner key sent through a work link all get the same 404", async () => {
    expect((await call("GET", "/api/owner/ledger?month=2026-10")).status).toBe(404);
    expect((await call("GET", "/api/owner/ledger?month=2026-10", undefined, { "x-organizer": "wrong" })).status).toBe(404);
    expect((await call("GET", "/api/owner/ledger?month=2026-10", undefined, { ...plat, "x-cb-link": "1" })).status).toBe(404);
    expect((await call("POST", "/api/owner/ledger?month=2026-10", {}, plat)).status).toBe(404);
    expect((await call("GET", "/api/owner/ledger?month=2026-10", undefined, plat)).status).toBe(200);
    expect(raw.query("SELECT action, ok FROM audit_access WHERE action LIKE '%ledger-c' ORDER BY id").all()).toEqual([{ action: "denied:ledger-c", ok: 0 }, { action: "denied:ledger-c", ok: 0 }, { action: "denied:ledger-c", ok: 0 }, { action: "denied:ledger-c", ok: 0 }, { action: "ledger-c", ok: 1 }]);
  });
  test("one row per payment with its ids, money, status, times, attempts, plus refunds and commission; a month filter; CSV", async () => {
    const { paymentId, orderId } = await newBuy();
    await hook(failed(orderId), "e1");
    await hook(captured(orderId, "pay_ok", { method: "card", fee: 11800, tax: 1800, card: { network: "Visa", type: "credit", last4: "1111" }, acquirer_data: { rrn: "55" } }), "e2");
    raw.run("UPDATE payment SET meta=json_set(meta,'$.org','=HYPERLINK(\"x\")') WHERE id=?", [paymentId]);
    const j = await (await call("GET", "/api/owner/ledger?month=2026-10", undefined, plat)).json() as any;
    expect(j).toMatchObject({ site: "corporate-tic-tac-toe.pages.dev", month: "2026-10" });
    expect(j.summary).toMatchObject({ currency: "INR", paid_count: 1, failed_count: 1, revenue_minor: 469900, fee_minor: 11800, tax_minor: 1800 });
    expect(j.payments).toHaveLength(1);
    const p = j.payments[0];
    expect(p).toMatchObject({ txn_id: `TTT-${paymentId}`, payment_id: paymentId, rzp_order_id: orderId, rzp_payment_id: "pay_ok", amount: 4699, amount_minor: 469900, currency: "INR", status: "paid", method: "card", fee_minor: 11800, tax_minor: 1800, net_minor: 458100, rrn: "55", plan: "tictactoe_pack_500", product: "corporate_tic_tac_toe", captured_attempts: 1 });
    expect(p.paid_utc).toBe(new Date(T).toISOString()); expect(p.paid_ist).toBe("2026-10-01 15:30:00 IST");
    expect(p.attempts.map((a: any) => [a.rzp_payment_id, a.status, a.error_reason])).toEqual([["pay_f1", "failed", "insufficient_funds"], ["pay_ok", "captured", null]]);
    expect(JSON.stringify(j)).not.toContain("Boss@Acme.com"); expect(JSON.stringify(j)).not.toContain("someone@okbank"); // no payer e-mail, no full UPI id
    expect((await (await call("GET", "/api/owner/ledger?month=2026-09", undefined, plat)).json() as any).payments).toHaveLength(0);
    expect((await call("GET", "/api/owner/ledger?month=bad", undefined, plat)).status).toBe(400);
    const csv = await call("GET", "/api/owner/ledger?month=2026-10&format=csv", undefined, plat);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toStartWith("txn_id,payment_id,rzp_order_id,rzp_payment_id,amount,currency,status");
    expect(lines).toHaveLength(2); expect(lines[1]).toContain(`TTT-${paymentId}`); expect(lines[1]).toContain("'=HYPERLINK"); // a spreadsheet never runs a formula from a name
    void oct;
  });
});
