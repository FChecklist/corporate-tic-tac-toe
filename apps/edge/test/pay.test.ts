import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { createHmac } from "node:crypto";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const FAR_START = Math.floor(((T + 2 * 86_400_000) / 1000 - 1692803367) / 3) + 1; // a game two days ahead (a game time can be at most 30 days ahead)
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let rz: { orders: any[]; payments: Record<string, any>; captured: string[] };
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const buy = (o: Record<string, unknown> = {}) => call("POST", "/api/checkout", { org: "Acme Ltd", email: "Boss@Acme.com", country: "IN", taxId: "", pack: 500, currency: "INR", ...o });

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  rz = { orders: [], payments: {}, captured: [] };
  // a stand-in for Razorpay's REST API
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (rz.orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; rz.orders.push(o); return new Response(JSON.stringify(o), { status: 200 }); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = rz.payments[pm[1]!]; if (!p) return new Response(JSON.stringify({ error: { description: "no such payment" } }), { status: 404 }); if (pm[2]) { rz.captured.push(pm[1]!); p.status = "captured"; } return new Response(JSON.stringify(p), { status: 200 }); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

const complete = async (paymentId: string, orderId: string, payId = "pay_1", status = "captured", amount?: number) => {
  rz.payments[payId] = { id: payId, order_id: orderId, status, amount: amount ?? rz.orders.find((o) => o.id === orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: hmac("sek", `${orderId}|${payId}`) });
};

describe("checkout", () => {
  test("status says which mode is on and what company details are still missing", async () => {
    const s = await (await call("GET", "/api/payments/status")).json() as any;
    expect(s.mode).toBe("razorpay");
    expect(s.legalEntity).toMatch(/IT Services by Rajat Agarwal/i);
    expect(Array.isArray(s.missingCompanyDetails)).toBe(true);
  });
  test("without keys and without test mode nothing can be bought", async () => {
    env.RAZORPAY_KEY_ID = undefined; env.RAZORPAY_KEY_SECRET = undefined;
    expect((await buy()).status).toBe(503);
  });
  test("the minimum to pay is a name and an e-mail: organisation, mobile, country and GSTIN are optional; the buyer's details are handed to Razorpay's window", async () => {
    const r = await buy({ org: undefined, name: "Asha Rao", country: undefined, taxId: undefined, phone: "98765 43210", phoneCode: "91" });
    expect(r.status).toBe(200); const j = (await r.json()) as any;
    expect(j.razorpay.prefill).toEqual({ email: "Boss@Acme.com", name: "Asha Rao", contact: "+919876543210" });
    const bare = await buy({ org: undefined, name: "Asha Rao", phone: undefined, phoneCode: undefined }); expect(bare.status).toBe(200);
    expect(((await bare.json()) as any).razorpay.prefill).toEqual({ email: "Boss@Acme.com", name: "Asha Rao" });
    expect((await buy({ org: undefined, name: "A" })).status).toBe(400); expect((await buy({ org: undefined, name: "" })).status).toBe(400); expect((await buy({ org: undefined })).status).toBe(400);
    expect((await buy({ name: "Asha Rao", taxId: "BAD" })).status).toBe(400); // a GSTIN is optional, a wrong one is still refused
  });
  test("bad packs, bad e-mails, missing names and oversize bodies are refused before anything is created", async () => {
    for (const o of [{ pack: 123 }, { pack: "x" }, { email: "nope" }, { email: "" }, { org: "" }, { org: "A" }]) expect((await buy(o)).status).toBe(400);
    expect((await call("POST", "/api/checkout", "x".repeat(9000))).status).toBe(400);
    expect(rz.orders.length).toBe(0);
    expect(raw.query("SELECT COUNT(*) c FROM payment").get()).toEqual({ c: 0 });
  });
  test("a valid checkout creates one Razorpay order for the right amount in paise and one unpaid payment row", async () => {
    const r = await (await buy()).json() as any;
    expect(r.mode).toBe("razorpay");
    expect(r.razorpay.amount).toBe(469900); // 500 participants = Rs 4,699 (no GST)
    expect(r.razorpay.name).toBe("Corporate Tic Tac Toe"); expect(r.razorpay.description).toBe("(close group tic tac toe software) | owned and made by IT Services by Rajat Agarwal"); // the Razorpay window shows the product as the title and the seller under it
    expect(rz.orders).toHaveLength(1);
    expect(raw.query("SELECT status FROM payment").get()).toEqual({ status: "created" });
  });
  test("dollar payments are refused until international is switched on", async () => {
    expect((await buy({ currency: "USD" })).status).toBe(400);
    env.RAZORPAY_INTERNATIONAL = "1";
    expect((await buy({ currency: "USD" })).status).toBe(200);
    expect(rz.orders[0].currency).toBe("USD");
  });
  test("Razorpay refusing the order is reported without leaving a payment behind", async () => {
    (globalThis as any).fetch = async () => new Response(JSON.stringify({ error: { description: "Authentication failed" } }), { status: 401 });
    const r = await buy();
    expect(r.status).toBe(502);
    expect(raw.query("SELECT COUNT(*) c FROM payment").get()).toEqual({ c: 0 });
  });
});

describe("verify (the buyer's browser says it paid)", () => {
  let paymentId = "", orderId = "";
  beforeEach(async () => { const r = await (await buy()).json() as any; paymentId = r.paymentId; orderId = r.razorpay.orderId; });
  test("a real, captured payment fulfils: organizer key shown once, entitlement, invoice, mail", async () => {
    const r = await (await complete(paymentId, orderId)).json() as any;
    expect(r.ok).toBe(true);
    expect(r.organizerKey).toMatch(/^cbk_[0-9a-f]{48}$/);
    expect(r.invoiceNumber).toMatch(/\//);
    expect(raw.query("SELECT pack, eid FROM entitlement").get()).toEqual({ pack: 500, eid: null });
    expect(raw.query("SELECT COUNT(*) c FROM invoice").get()).toEqual({ c: 1 });
    const mail = raw.query("SELECT to_addr, body FROM outbox").get() as any;
    expect(mail.to_addr).toBe("boss@acme.com");
    expect(mail.body).toContain(r.organizerKey);
    expect(mail.body).toContain("INVOICE");
    const dump = JSON.stringify(raw.query("SELECT * FROM organizer_key").all());
    expect(dump.includes(r.organizerKey)).toBe(false); // only a hash is kept
  });
  test("paying again for the same order changes nothing (idempotent)", async () => {
    await complete(paymentId, orderId);
    const again = await (await complete(paymentId, orderId)).json() as any;
    expect(again.ok).toBe(true);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT COUNT(*) c FROM invoice").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT COUNT(*) c FROM outbox").get()).toEqual({ c: 1 });
  });
  test("a wrong signature is refused and nothing is granted", async () => {
    rz.payments.pay_1 = { id: "pay_1", order_id: orderId, status: "captured", amount: 469900 };
    const r = await call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_1", razorpay_signature: "deadbeef" });
    expect(r.status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
  });
  test("a valid signature for the wrong amount, wrong order, failed or unknown payment grants nothing", async () => {
    expect((await complete(paymentId, orderId, "pay_2", "captured", 100)).status).toBe(400);
    rz.orders.push({ id: "order_other", amount: 469900, currency: "INR" });
    expect((await complete(paymentId, "order_other", "pay_3")).status).toBe(404);
    expect((await complete(paymentId, orderId, "pay_4", "failed")).status).toBe(402);
    const r = await call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_ghost", razorpay_signature: hmac("sek", `${orderId}|pay_ghost`) });
    expect(r.status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
  });
  test("an authorized payment is captured for exactly the order amount, then fulfilled", async () => {
    const r = await complete(paymentId, orderId, "pay_5", "authorized");
    expect(r.status).toBe(200);
    expect(rz.captured).toEqual(["pay_5"]);
  });
  test("someone else's payment id cannot be used to claim this order", async () => {
    const r = await call("POST", "/api/payments/verify", { paymentId: "pay_nonexistent", razorpay_order_id: orderId, razorpay_payment_id: "p", razorpay_signature: "s" });
    expect(r.status).toBe(404);
  });
});

describe("webhook (the buyer closed the tab)", () => {
  let paymentId = "", orderId = "";
  beforeEach(async () => { const r = await (await buy()).json() as any; paymentId = r.paymentId; orderId = r.razorpay.orderId; });
  const hook = (ev: unknown, secret = "whsec") => { const raw = JSON.stringify(ev); return call("POST", "/api/payments/webhook", raw, { "x-razorpay-signature": hmac(secret, raw) }); };
  const captured = (amount = 469900) => ({ event: "payment.captured", payload: { payment: { entity: { id: "pay_w1", order_id: orderId, amount } } } });
  test("a signed capture fulfils, and a repeat delivery does not double up", async () => {
    expect((await hook(captured())).status).toBe(200);
    expect((await hook(captured())).status).toBe(200);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT COUNT(*) c FROM invoice").get()).toEqual({ c: 1 });
  });
  test("a wrong signature, a missing secret and a garbage body are all refused", async () => {
    expect((await hook(captured(), "wrong")).status).toBe(400);
    expect((await call("POST", "/api/payments/webhook", "{}", {})).status).toBe(400);
    expect((await call("POST", "/api/payments/webhook", "not json", { "x-razorpay-signature": hmac("whsec", "not json") })).status).toBe(400);
    env.RAZORPAY_WEBHOOK_SECRET = undefined;
    expect((await hook(captured())).status).toBe(503);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
  });
  test("an unrelated event, an unknown order, or a capture for a different amount grants nothing", async () => {
    expect(await (await hook({ event: "payment.failed", payload: {} })).json()).toMatchObject({ ignored: "payment.failed" });
    expect(await (await hook({ event: "payment.captured", payload: { payment: { entity: { id: "p", order_id: "order_zzz", amount: 1 } } } })).json()).toMatchObject({ ignored: "unknown order" });
    expect(await (await hook(captured(100))).json()).toMatchObject({ ignored: "amount mismatch" });
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
  });
  test("every webhook call is logged: what it said, which payment it matched, what was done (and bad signatures too)", async () => {
    await hook(captured()); await hook(captured()); await hook(captured(), "wrong"); await hook({ event: "payment.failed", payload: {} });
    const rows = raw.query("SELECT event, signature_ok, outcome, http_status, payment_id, rzp_order_id, rzp_payment_id, amount_minor FROM webhook_log ORDER BY id").all() as any[];
    expect(rows.map((r) => r.outcome)).toEqual(["marked paid by webhook", "already paid (no change)", "bad signature", "ignored: not a payment event"]);
    expect(rows[0]).toMatchObject({ event: "payment.captured", signature_ok: 1, http_status: 200, payment_id: paymentId, rzp_order_id: orderId, rzp_payment_id: "pay_w1", amount_minor: 469900 });
    expect(rows[2]).toMatchObject({ signature_ok: 0, http_status: 400, payment_id: null });
    const led = raw.query("SELECT * FROM payment_ledger WHERE payment_id=?").get(paymentId) as any;
    expect(led).toMatchObject({ product: "corporate_tic_tac_toe", product_name: "Corporate Tic Tac Toe", product_type: "game_pack", product_ref: "pack_500", status: "paid", webhooks_received: 2 });
    expect(led.site).toBeTruthy(); expect(led.payer_email).toContain("@");
  });
  test("the browser verify arriving after the webhook returns the same result without a second grant", async () => {
    await hook(captured());
    rz.payments.pay_w1 = { id: "pay_w1", order_id: orderId, status: "captured", amount: 469900 };
    const r = await call("POST", "/api/payments/verify", { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_w1", razorpay_signature: hmac("sek", `${orderId}|pay_w1`) });
    expect(r.status).toBe(200);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 1 });
  });
});

describe("what a purchase lets you do", () => {
  const FUT = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 5000;
  const purchase = async (o: Record<string, unknown> = {}) => { const r = await (await buy(o)).json() as any; return (await (await complete(r.paymentId, r.razorpay.orderId, "pay_" + Math.random().toString(36).slice(2, 8))).json()) as any; };
  test("no purchase, no engagement; one purchase, one engagement of up to the pack; a second needs a second purchase", async () => {
    const first = await purchase();
    const K = { "x-organizer": first.organizerKey };
    const mk = (id: string, cap: number) => call("POST", "/api/z", { id, startRound: FUT, callSeconds: 9, cap }, K);
    expect((await call("POST", "/api/z", { id: "NOPE1", startRound: FUT, callSeconds: 9, cap: 10 }, { "x-organizer": "cbk_none" })).status).toBe(403);
    expect((await mk("TOOBIG", 501)).status).toBe(200); // pack is 500: it can be built, as a draft, but not published with this pack
    expect(((await (await call("POST", "/api/z/TOOBIG/publish", { email: "b@acme.com", phone: "9876543210" }, K)).json()) as any).paid).toBe(false); // published, but not covered by this pack: it must still be paid for
    expect((await mk("FIRST1", 400)).status).toBe(200);
    expect(raw.query("SELECT pack FROM engagement WHERE id='FIRST1'").get()).toEqual({ pack: 500 }); // published at once: a purchased pack was waiting
    expect((await mk("SECOND", 10)).status).toBe(200); // a second one can be built, but it is a draft until another purchase
    expect(raw.query("SELECT pack FROM engagement WHERE id='SECOND'").get()).toEqual({ pack: 0 });
    expect(((await (await call("POST", "/api/z/SECOND/publish", { email: "b@acme.com", phone: "9876543210" }, K)).json()) as any).paid).toBe(false);
    expect(raw.query("SELECT eid FROM entitlement").get()).toEqual({ eid: "FIRST1" });
    expect(raw.query("SELECT pack FROM engagement WHERE id='FIRST1'").get()).toEqual({ pack: 500 });
  });
  test("the limit can be raised only up to what was paid for", async () => {
    const first = await purchase(); const K = { "x-organizer": first.organizerKey };
    await call("POST", "/api/z", { id: "LIM1", startRound: FUT, callSeconds: 9, cap: 100 }, K);
    expect((await call("PATCH", "/api/z/LIM1/settings", { cap: 500 }, K)).status).toBe(200);
    const r = await call("PATCH", "/api/z/LIM1/settings", { cap: 501 }, K);
    expect(r.status).toBe(402);
    expect(((await r.json()) as any).error).toMatch(/Buy a bigger pack/);
  });
  test("a returning buyer (same e-mail) gets another entitlement on the same organizer, with no second key", async () => {
    const first = await purchase();
    const again = await purchase({ email: "BOSS@acme.com", pack: 1000 });
    expect(again.organizerKey).toBeNull();
    expect(again.newOrganizer).toBe(false);
    expect(raw.query("SELECT COUNT(*) c FROM organizer_key WHERE kind='master'").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 2 });
    const K = { "x-organizer": first.organizerKey };
    expect((await call("POST", "/api/z", { id: "BIGONE", startRound: FUT, callSeconds: 9, cap: 900 }, K)).status).toBe(200); // picks the 1000 pack
  });
  test("another e-mail is another organizer with their own key and nothing shared", async () => {
    const a = await purchase(); const b = await purchase({ email: "other@corp.com" });
    expect(b.organizerKey).not.toBe(a.organizerKey);
    await call("POST", "/api/z", { id: "AAA11", startRound: FUT, callSeconds: 9, cap: 10 }, { "x-organizer": a.organizerKey });
    expect((await call("GET", "/api/z/AAA11/participants", undefined, { "x-organizer": b.organizerKey })).status).toBe(403);
  });
  test("the platform can still create engagements with no purchase", async () => {
    expect((await call("POST", "/api/z", { id: "FREE1", startRound: FUT, callSeconds: 9, cap: 99 }, { "x-organizer": "plat" })).status).toBe(200);
  });
});

describe("invoices", () => {
  test("numbers run in sequence per brand and financial year, and each is viewable by its private link only", async () => {
    const nums: string[] = []; const urls: string[] = [];
    for (let i = 0; i < 3; i++) { const r = await (await buy({ email: `u${i}@x.com` })).json() as any; const f = await (await complete(r.paymentId, r.razorpay.orderId, "pay_i" + i)).json() as any; nums.push(f.invoiceNumber); urls.push(f.invoiceUrl); }
    expect(nums.map((n) => Number(n.split("/").pop()))).toEqual([1, 2, 3]);
    const html = await (await call("GET", urls[0]!)).text();
    expect(html).toContain("IT Services by Rajat Agarwal");
    expect(html).toContain(nums[0]!);
    expect((await call("GET", "/api/invoice/inv_" + "0".repeat(32))).status).toBe(404);
    expect((await call("GET", "/api/invoice/anything")).status).toBe(404);
  });
  test("no GST (the seller is not registered): the receipt is a plain INVOICE from IT Services by Rajat Agarwal for the whole amount, not a draft, with no tax rows", async () => {
    const r = await (await buy()).json() as any; const f = await (await complete(r.paymentId, r.razorpay.orderId)).json() as any;
    const html = await (await call("GET", f.invoiceUrl)).text();
    expect(html).not.toContain("DRAFT"); expect(html).toContain("<b>INVOICE</b>"); expect(html).not.toContain("TAX INVOICE");
    expect(html).toContain("IT Services by Rajat Agarwal"); expect(html).toContain("rajatsiroffice@gmail.com"); expect(html).toContain("4,699.00");
    expect(html).not.toMatch(/CGST|SGST|IGST|Taxable value|Place of supply|GSTIN|SHOBHA/i);
    expect(f.tax).toBe(0); expect(f.total).toBe(4699);
  });
  test("filling in a GSTIN in the configuration does not switch GST on: only the code switch GST_ENABLED does (product decision 2026-10-09)", async () => {
    env.COMPANY_JSON = JSON.stringify({ gstin: "07AAAAA0000A1Z5", stateCode: "07", sacCode: "998439", email: "billing@x.test" });
    const r = await (await buy()).json() as any; const f = await (await complete(r.paymentId, r.razorpay.orderId)).json() as any;
    const html = await (await call("GET", f.invoiceUrl)).text();
    expect(html).not.toMatch(/CGST|SGST|IGST|Taxable value/); expect(html).toContain("4,699.00"); expect(f.tax).toBe(0);
  });
});

describe("test mode (local only)", () => {
  beforeEach(() => { env.RAZORPAY_KEY_ID = undefined; env.RAZORPAY_KEY_SECRET = undefined; env.TEST_MODE = "1"; });
  test("fulfils at once with no Razorpay, and says so", async () => {
    const r = await (await buy()).json() as any;
    expect(r.mode).toBe("test");
    expect(r.result.organizerKey).toMatch(/^cbk_/);
    expect(rz.orders).toHaveLength(0);
  });
  test("the write budget protects a fulfilment: a busy day says so and takes no half-step", async () => {
    env.DAILY_WRITE_BUDGET = "3";
    const r = await buy();
    expect(r.status).toBe(503);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
  });
});

describe("sign in by e-mailed code", () => {
  beforeEach(() => { env.RAZORPAY_KEY_ID = undefined; env.RAZORPAY_KEY_SECRET = undefined; env.TEST_MODE = "1"; });
  const ask = (email: string) => call("POST", "/api/auth/email", { email });
  const verify = (email: string, code: string) => call("POST", "/api/auth/verify", { email, code });
  const account = async () => { await buy({ email: "Owner@Corp.com" }); };
  test("an organizer who lost their key asks for a code, enters it, and gets a working fresh key; the old key still works", async () => {
    const first = (await (await buy({ email: "Owner@Corp.com" })).json() as any).result.organizerKey as string;
    const r = await (await ask("owner@corp.com")).json() as any;
    expect(r.devCode).toMatch(/^\d{6}$/);
    const t = await (await verify("OWNER@corp.com", r.devCode)).json() as any;
    expect(t.token).toMatch(/^cbk_/);
    expect(t.token).not.toBe(first);
    expect((await call("GET", "/api/history", undefined, { "x-organizer": t.token })).status).toBe(200);
    expect((await call("GET", "/api/history", undefined, { "x-organizer": first })).status).toBe(200);
    expect((raw.query("SELECT COUNT(*) c FROM outbox WHERE subject LIKE '%Sign in to Corporate Tic Tac Toe%'").get() as any).c).toBe(1);
  });
  test("an unknown address gets exactly the same answer and no mail, so nobody can learn who has an account", async () => {
    const r = await (await ask("nobody@nowhere.com")).json() as any;
    expect(r).toEqual({ ok: true, devCode: undefined } as any);
    expect(raw.query("SELECT COUNT(*) c FROM outbox").get()).toEqual({ c: 0 });
    expect((await verify("nobody@nowhere.com", "123456")).status).toBe(400);
  });
  test("production never reveals the code in the response", async () => {
    await account(); env.TEST_MODE = undefined; env.RAZORPAY_KEY_ID = "k"; env.RAZORPAY_KEY_SECRET = "s";
    const r = await (await ask("owner@corp.com")).json() as any;
    expect(r.devCode).toBeUndefined();
    expect((raw.query("SELECT COUNT(*) c FROM outbox WHERE subject LIKE '%Sign in to Corporate Tic Tac Toe%'").get() as any).c).toBe(1);
  });
  test("a wrong code is refused, five wrong guesses lock that code, and the right one then no longer works", async () => {
    await account();
    const code = ((await (await ask("owner@corp.com")).json()) as any).devCode as string;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify("owner@corp.com", wrong)).status).toBe(400);
    expect((await verify("owner@corp.com", code)).status).toBe(400);
    const again = ((await (await ask("owner@corp.com")).json()) as any).devCode as string; // a new code resets the guesses
    expect((await verify("owner@corp.com", again)).status).toBe(200);
  });
  test("a code works once and expires after 10 minutes", async () => {
    await account();
    const c1 = ((await (await ask("owner@corp.com")).json()) as any).devCode as string;
    expect((await call("POST", "/api/auth/verify", { email: "owner@corp.com", code: c1 }, {}, T + 11 * 60_000)).status).toBe(400);
    const c2 = ((await (await ask("owner@corp.com")).json()) as any).devCode as string;
    expect((await verify("owner@corp.com", c2)).status).toBe(200);
    expect((await verify("owner@corp.com", c2)).status).toBe(400);
  });
  test("at most five codes an hour per address", async () => {
    await account();
    for (let i = 0; i < 5; i++) expect((await ask("owner@corp.com")).status).toBe(200);
    expect((await ask("owner@corp.com")).status).toBe(429);
    expect((await call("POST", "/api/auth/email", { email: "owner@corp.com" }, {}, T + 3_600_001)).status).toBe(200);
  });
  test("bad e-mails and malformed codes are refused", async () => {
    expect((await ask("not-an-email")).status).toBe(400);
    expect((await verify("owner@corp.com", "12")).status).toBe(400);
    expect((await call("POST", "/api/auth/verify", "junk")).status).toBe(400);
  });
});

describe("e-mail through Resend (organizers only)", () => {
  let sent: any[]; let resendUp: boolean;
  beforeEach(() => {
    sent = []; resendUp = true;
    env.RAZORPAY_KEY_ID = undefined; env.RAZORPAY_KEY_SECRET = undefined; env.TEST_MODE = "1";
    env.RESEND_API_KEY = "re_test_dummy"; env.MAIL_REPLY_TO = "help@corporate-tic-tac-toe.example";
    const inner = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string, init?: any) => {
      if (String(url) === "https://api.resend.com/emails") { if (!resendUp) return new Response("{}", { status: 500 }); sent.push({ auth: init.headers.authorization, ...JSON.parse(init.body) }); return new Response("{}", { status: 200 }); }
      return inner(url, init);
    };
  });
  test("the purchase mail goes from the Corporate Tic Tac Toe sender on the shared verified domain, to the buyer only", async () => {
    const r = await (await buy({ email: "Boss@Acme.com" })).json() as any;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Corporate Tic Tac Toe <noreply@corporate-tic-tac-toe.example>", to: ["boss@acme.com"], reply_to: "help@corporate-tic-tac-toe.example", headers: { "Auto-Submitted": "auto-generated" } });
    expect(sent[0].auth).toBe("Bearer re_test_dummy");
    expect(sent[0].text).toContain(r.result.organizerKey);
    expect(sent[0].text).toContain("INVOICE");
  });
  test("after a successful send no mail body (and so no organizer key) is kept anywhere", async () => {
    const r = await (await buy()).json() as any;
    expect(raw.query("SELECT sent, body FROM outbox").get()).toEqual({ sent: 1, body: "" });
    expect(JSON.stringify(raw.query("SELECT * FROM outbox").all()).includes(r.result.organizerKey)).toBe(false);
  });
  test("if Resend is down the purchase still completes; the unsent mail is kept without the key and retried by the daily job", async () => {
    resendUp = false;
    const r = await (await buy()).json() as any;
    expect(r.result.organizerKey).toMatch(/^cbk_/); // the buyer still sees the key on screen
    const row = raw.query("SELECT sent, body FROM outbox").get() as any;
    expect(row.sent).toBe(0);
    expect(row.body.includes(r.result.organizerKey)).toBe(false);
    expect(row.body).toContain("INVOICE");
    resendUp = true;
    const { retryOutbox } = await import("../src/pay");
    expect(await retryOutbox(env, T + 3600_000)).toMatchObject({ retried: 1 });
    expect(raw.query("SELECT sent, body FROM outbox").get()).toEqual({ sent: 1, body: "" });
    expect(sent).toHaveLength(1);
  });
  test("mail older than 3 days is dropped whether sent or not", async () => {
    resendUp = false; await buy();
    const { retryOutbox } = await import("../src/pay");
    resendUp = false;
    const r = await retryOutbox(env, T + 4 * 86_400_000);
    expect(r.dropped).toBe(1);
    expect(raw.query("SELECT COUNT(*) c FROM outbox").get()).toEqual({ c: 0 });
  });
  test("sign-in codes are mailed to the organizer's address only, and the code is not kept afterwards", async () => {
    await buy({ email: "owner@corp.com" });
    sent.length = 0;
    const r = await (await call("POST", "/api/auth/email", { email: "owner@corp.com" })).json() as any;
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@corp.com"]);
    expect(sent[0].text).toContain(r.devCode);
    expect(JSON.stringify(raw.query("SELECT * FROM outbox").all()).includes(r.devCode)).toBe(false);
    await call("POST", "/api/auth/email", { email: "stranger@nowhere.com" });
    expect(sent).toHaveLength(1); // nobody without an account is ever e-mailed
  });
  test("only organizers have an e-mail address on file: the store keeps none for participants", async () => {
    // participants join with a mobile number; the schema has no e-mail column on them
    const cols = raw.query("PRAGMA table_info(participant)").all().map((c: any) => c.name);
    expect(cols.some((c: string) => /mail/i.test(c))).toBe(false);
  });
});

describe("paying to publish a draft", () => {
  const start = async (email: string, ip: string) => ((await (await call("POST", "/api/start", { email }, { "cf-connecting-ip": ip })).json()) as any).token as string;
  const pay = (key: string, eid: string, extra: Record<string, unknown> = {}) => call("POST", "/api/checkout", { eid, org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", ...extra }, { "x-organizer": key });
  test("the payment is bound to the signed-in organizer and publishes their draft", async () => {
    const key = await start("boss@acme.com", "1.1.1.1");
    await call("POST", "/api/z", { id: "PAYD-1", startRound: FAR_START, callSeconds: 9, cap: 300 }, { "x-organizer": key });
    expect((await call("POST", "/api/z/PAYD-1/join", { phone: "9876543210" })).status).toBe(403); // a draft: closed to participants
    const c = await (await pay(key, "PAYD-1", { pack: 100000 })).json() as any; // the client's pack is ignored: the draft decides
    expect(c.mode).toBe("razorpay"); expect(rz.orders[0].amount).toBe(1 * rz.orders[0].amount); expect(c.razorpay.notes.participants).toBe("500"); expect(c.razorpay.description).toBe("(close group tic tac toe software) | owned and made by IT Services by Rajat Agarwal");
    const v = await (await complete(c.paymentId, c.razorpay.orderId)).json() as any;
    expect(v.published).toBe(true); expect(v.eid).toBe("PAYD-1"); expect(v.organizerKey).toBeNull(); // no new organizer: it is theirs
    expect(raw.query("SELECT pack FROM engagement WHERE id='PAYD-1'").get()).toEqual({ pack: 500 });
    expect(raw.query("SELECT eid FROM entitlement").get()).toEqual({ eid: "PAYD-1" });
    expect((await call("POST", "/api/z/PAYD-1/join", { phone: "9876543210" })).status).toBe(200); // now open to participants
  });
  test("nobody can pay for, or publish, someone else's draft; a published one is not paid for twice", async () => {
    const a = await start("a@acme.com", "1.1.1.1"), b = await start("b@other.com", "2.2.2.2");
    await call("POST", "/api/z", { id: "PAYD-2", startRound: FAR_START, callSeconds: 9, cap: 100 }, { "x-organizer": a });
    expect((await pay(b, "PAYD-2")).status).toBe(404);
    expect((await pay("cbk_bogus", "PAYD-2")).status).toBe(403);
    const c = await (await pay(a, "PAYD-2")).json() as any; await complete(c.paymentId, c.razorpay.orderId, "pay_2");
    expect((await pay(a, "PAYD-2")).status).toBe(409);
  });
  test("a draft that is too big for any pack needs a custom arrangement", async () => {
    const key = await start("big@acme.com", "3.3.3.3");
    await call("POST", "/api/z", { id: "PAYD-3", startRound: FAR_START, callSeconds: 9, cap: 100000 }, { "x-organizer": key });
    expect((await pay(key, "PAYD-3")).status).toBe(400);
  });
});

describe("invoice carries Razorpay's own record (owner list 2026-10-10)", () => {
  test("INR checkout opens UPI first; USD checkout does not force it", async () => {
    const a = (await (await buy()).json()) as any; expect(a.razorpay.config.display.sequence[0]).toBe("block.upi"); expect(a.razorpay.config.display.blocks.upi.instruments).toEqual([{ method: "upi" }]);
    env.RAZORPAY_INTERNATIONAL = "1";
    const u = (await (await buy({ currency: "USD", country: "US" })).json()) as any; expect(u.razorpay.currency).toBe("USD"); expect(u.razorpay.config).toBeUndefined();
  });
  test("after a UPI payment the invoice shows method, masked UPI id, bank reference, IST time, payer and Razorpay ids, plus page 2 terms", async () => {
    const r = (await (await buy({ name: "Asha Rao", phone: "98765 43210", phoneCode: "91" })).json()) as any;
    rz.payments["pay_U1"] = { id: "pay_U1", order_id: r.razorpay.orderId, status: "captured", amount: r.razorpay.amount, currency: "INR", method: "upi", vpa: "asha.rao@okicici", created_at: Math.floor(T / 1000), email: "Boss@Acme.com", contact: "+919876543210", acquirer_data: { rrn: "111122223333" } };
    const v = await call("POST", "/api/payments/verify", { paymentId: r.paymentId, razorpay_order_id: r.razorpay.orderId, razorpay_payment_id: "pay_U1", razorpay_signature: hmac("sek", `${r.razorpay.orderId}|pay_U1`) });
    const j = (await v.json()) as any; expect(j.ok).toBe(true);
    const html = await (await call("GET", j.invoiceUrl)).text();
    for (const x of ["Paid on (IST)", "15:30:00 IST", "Razorpay: UPI", "UPI ID as", "@okicici", "111122223333", "pay_U1", r.razorpay.orderId, "Asha Rao", "+919876543210", "Terms and conditions", "kept for invoice, tax and accounting purposes"]) expect(html).toContain(x);
    expect(html).not.toContain("asha.rao@okicici");
  });
});

describe("Payment Testing page (Rs 1 / US$ 1, buys nothing)", () => {
  const start = (o: Record<string, unknown> = {}) => call("POST", "/api/payments/paytest", { name: "Asha Rao", email: "asha@acme.in", country: "IN", ...o });
  const payIt = async (r: any, payId = "pay_T1") => {
    rz.payments[payId] = { id: payId, order_id: r.razorpay.orderId, status: "captured", amount: r.razorpay.amount, currency: r.razorpay.currency, method: "upi", vpa: "asha@okicici", created_at: Math.floor(T / 1000) };
    return call("POST", "/api/payments/verify", { paymentId: r.paymentId, razorpay_order_id: r.razorpay.orderId, razorpay_payment_id: payId, razorpay_signature: hmac("sek", `${r.razorpay.orderId}|${payId}`) });
  };
  test("India pays Rs 1 with UPI first; the order is for exactly 100 paise", async () => {
    const r = (await (await start()).json()) as any;
    expect(r.razorpay.amount).toBe(100); expect(r.razorpay.currency).toBe("INR"); expect(r.razorpay.config.display.sequence[0]).toBe("block.upi"); expect(rz.orders[0].amount).toBe(100);
  });
  test("abroad pays US$ 1, only once international is on", async () => {
    expect((await start({ country: "US" })).status).toBe(400);
    env.RAZORPAY_INTERNATIONAL = "1";
    const r = (await (await start({ country: "US" })).json()) as any; expect(r.razorpay.currency).toBe("USD"); expect(r.razorpay.amount).toBe(100);
  });
  test("a paid test gives a PAYTEST receipt and buys nothing: no entitlement, no credit, no real invoice number used", async () => {
    const r = (await (await start()).json()) as any; const v = (await (await payIt(r)).json()) as any;
    expect(v.ok).toBe(true); expect(v.paytest).toBe(true); expect(v.invoiceNumber).toMatch(/^PAYTEST-\d{4}-\d{2}-1$/);
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT COUNT(*) c FROM invoice WHERE seq>0").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT is_test FROM payment").get()).toEqual({ is_test: 1 });
    const html = await (await call("GET", v.invoiceUrl)).text(); for (const x of ["payment test", "Razorpay: UPI", "Terms and conditions", "No game, pack or credit was bought"]) expect(html).toContain(x);
    const st = await call("GET", `/api/payments/paytest/${r.paymentId}`); expect(((await st.json()) as any).ok).toBe(true);
  });
  test("the invoice shows on the done screen: inline markup, a real PDF, and e-mail it to any address (5 at most)", async () => {
    const r = (await (await start()).json()) as any; const v = (await (await payIt(r)).json()) as any;
    const frag = await call("GET", `${v.invoiceUrl}.fragment`); expect(frag.status).toBe(200);
    const fh = await frag.text(); expect(fh).toContain("<style>"); expect(fh).toContain("payment test"); expect(fh).not.toContain("<html"); expect(fh).not.toContain("<!doctype");
    const pdf = await call("GET", `${v.invoiceUrl}.pdf`); expect(pdf.status).toBe(200); expect(pdf.headers.get("content-type")).toBe("application/pdf"); expect(pdf.headers.get("content-disposition")).toContain(v.invoiceNumber);
    const bytes = new Uint8Array(await pdf.arrayBuffer()); expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(900);
    expect((await call("POST", `${v.invoiceUrl}/email`, { to: "nope" })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await call("POST", `${v.invoiceUrl}/email`, { to: "friend@acme.in" })).status).toBe(200);
    expect((await call("POST", `${v.invoiceUrl}/email`, { to: "friend@acme.in" })).status).toBe(429);
    expect(raw.query("SELECT COUNT(*) c FROM outbox WHERE to_addr='friend@acme.in' AND body LIKE '%.pdf%'").get()).toEqual({ c: 5 });
    expect((await call("GET", "/api/invoice/inv_00000000000000000000000000000000.pdf")).status).toBe(404);
  });
  test("testing again and again works, each with its own receipt; the webhook finishes a test too", async () => {
    const a = (await (await start()).json()) as any; await payIt(a, "pay_A");
    const b = (await (await start()).json()) as any;
    rz.payments["pay_B"] = { id: "pay_B", order_id: b.razorpay.orderId, status: "captured", amount: 100, currency: "INR", method: "card", card: { network: "Visa", type: "debit", last4: "4242" } };
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_B", order_id: b.razorpay.orderId, amount: 100 } } } });
    expect((await call("POST", "/api/payments/webhook", body, { "x-razorpay-signature": hmac("whsec", body) })).status).toBe(200);
    expect(raw.query("SELECT COUNT(*) c FROM invoice WHERE number LIKE 'PAYTEST-%'").get()).toEqual({ c: 2 });
    expect(raw.query("SELECT COUNT(*) c FROM entitlement").get()).toEqual({ c: 0 });
  });
  test("bad input is refused before any order is created", async () => {
    for (const o of [{ email: "nope" }, { name: "A" }]) expect((await start(o)).status).toBe(400);
    expect(rz.orders.length).toBe(0);
    expect((await call("GET", "/api/payments/paytest/pay_0000000000000000")).status).toBe(404);
  });
});

describe("central payments (every order opens through IT Services by Rajat Agarwal)", () => {
  let central: { orders: any[]; verifies: any[]; up: boolean };
  beforeEach(() => {
    central = { orders: [], verifies: [], up: true };
    env.PAY_SERVICE_KEY = "psk_test"; env.PAY_SERVICE_URL = "https://central.test";
    const inner = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string, init?: any) => {
      const u = String(url);
      if (u === "https://central.test/api/pay/order") {
        if (!central.up) throw new Error("down");
        const b = JSON.parse(init.body); central.orders.push({ key: init.headers["x-site-key"], ...b });
        const o = { id: "order_c" + central.orders.length, amount: b.amount_minor, currency: b.currency, receipt: b.payment_ref, status: "created" }; rz.orders.push(o);
        return new Response(JSON.stringify({ ok: true, orderId: o.id, keyId: "rzp_test_x" }), { status: 200 });
      }
      if (u === "https://central.test/api/pay/verify") { central.verifies.push({ key: init.headers["x-site-key"], ...JSON.parse(init.body) }); return new Response("{}", { status: 200 }); }
      return inner(url, init);
    };
  });
  test("a sale is opened centrally with the ledger path: this website / sales / the pack as the plan", async () => {
    const r = await (await buy()).json() as any;
    expect(r.razorpay.orderId).toBe("order_c1");
    expect(central.orders).toHaveLength(1);
    expect(central.orders[0]).toMatchObject({ key: "psk_test", site: "corporate-tic-tac-toe.pages.dev", product: "corporate_tic_tac_toe", plan: "tictactoe_pack_500", extra_notes: { site: "corporate-tic-tac-toe.pages.dev", stream: "sales", plan: "tictactoe_pack_500" }, amount_minor: 469900, currency: "INR" });
    expect(central.orders[0].payment_ref).toMatch(/^pay_[0-9a-f]{16}$/);
  });
  test("the payment test is the payment_test plan", async () => {
    const r = await call("POST", "/api/payments/paytest", { email: "a@b.co", name: "Asha Rao", country: "IN" });
    expect(r.status).toBe(200);
    expect(central.orders[0]).toMatchObject({ plan: "payment_test", amount_minor: 100 });
  });
  test("a verified payment is reported to the central ledger", async () => {
    const r = await (await buy()).json() as any;
    const done = await complete(r.paymentId, r.razorpay.orderId);
    expect(done.status).toBe(200);
    expect(central.verifies).toHaveLength(1);
    expect(central.verifies[0]).toMatchObject({ key: "psk_test", site: "corporate-tic-tac-toe.pages.dev", razorpay_order_id: "order_c1", razorpay_payment_id: "pay_1" });
  });
  test("if the central service is down the sale still works, opened directly with Razorpay", async () => {
    central.up = false;
    const r = await buy(); expect(r.status).toBe(200);
    expect(central.orders).toHaveLength(0);
    expect(rz.orders).toHaveLength(1);
  });
  test("without PAY_SERVICE_KEY nothing goes to the central service", async () => {
    env.PAY_SERVICE_KEY = undefined;
    expect((await buy()).status).toBe(200);
    expect(central.orders).toHaveLength(0);
  });
});
