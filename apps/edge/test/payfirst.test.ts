// Boss order 2 Nov 2026, "Razorpay first": the payer chooses ONLY the country before paying; Razorpay asks for (and checks) the mobile and the e-mail; the page may add a name, a company and a
// GST / Tax ID to the invoice AFTER paying, or skip; the game is paid at the capture and the tax invoice follows (when the payer sends or skips, or by itself 15 minutes after the capture).
// The public Rs 1 / US$ 1 test needs no key any more and is limited per visitor. Everything runs through the real Worker with a real SQLite D1; the gateway is a small stand-in (param-harness).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HOUR, MIN, T, W, call, capture, create, hmac, j, mails, one, organizer, q, reset, restore, uid, verify, checkout } from "./param-harness";
import { COMPANY_MSG, GSTIN_MSG, INVOICE_AFTER_MS, PAYTEST_PER_DAY, PAYTEST_PER_HOUR, PAY_RULES, isPendingEmail } from "../src/payfirst";
import { issueDueInvoices } from "../src/pay";
import { runTick, type Env } from "../src/worker";

beforeEach(() => reset({ RAZORPAY_INTERNATIONAL: "1" })); afterEach(restore);

/** what Razorpay itself knows about the payer once the payment is captured */
const RZ = { email: "payer.real@razorpay-given.in", contact: "+919876543210", method: "upi", vpa: "ab@okhdfc" };
const GST = "27ABCDE1234F1Z5";

/** a signed-in organizer with an unpaid game */
async function draft() { const o = await organizer(); const id = uid("PF"); expect((await create(o.key, id, { cap: 100 })).status).toBe(200); return { o, id }; }
/** the payer's first step: the game and the country, nothing else (no e-mail, no name, no company, no GST number) */
async function order(g: { o: { h: Record<string, string> }; id: string }, country: string | undefined, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/api/checkout", { eid: g.id, ...(country ? { country } : {}), ...extra }, { ...g.o.h, ...headers });
  return { status: r.status, body: await j(r) };
}
/** Razorpay reports the payment as captured, with what the payer gave it */
const pay = async (c: any, id = "pay_rz1", over: Record<string, unknown> = {}, now = T) => { capture(c, id, { currency: c.razorpay.currency, ...RZ, ...over }); const r = await verify(c, id, {}, now); return { status: r.status, body: await j(r) }; };
const receipt = async (id: string, now = T) => { const r = await call("GET", `/api/payments/${id}/receipt`, undefined, {}, now); return { status: r.status, body: await j(r) }; };
const invoiceCall = async (id: string, body: unknown, now = T) => { const r = await call("POST", `/api/payments/${id}/invoice`, body, {}, now); return { status: r.status, body: await j(r) }; };
const count = (sql: string, ...a: any[]) => one(sql, ...a).c as number;
const invoiceData = (paymentId: string) => JSON.parse(one("SELECT data FROM invoice WHERE payment_id=?", paymentId).data);
const mailTo = (to: string) => mails(to).filter((m) => /invoice|payment received/i.test(m.subject));

describe("where is the payer: only the starting point", () => {
  const where = async (cc?: string) => { const r = await call("GET", "/api/payments/where", undefined, cc === undefined ? {} : { "cf-ipcountry": cc }); expect(r.status).toBe(200); return j(r); };
  test("India from the header is rupees; another country is US dollars", async () => {
    expect(await where("IN")).toMatchObject({ country: "IN", currency: "INR", international: true });
    expect(await where("DE")).toMatchObject({ country: "DE", currency: "USD" });
    expect(await where("in")).toMatchObject({ country: "IN", currency: "INR" });
  });
  test("no header, Tor (T1) and unknown (XX) are NOT guessed: the page then opens its list", async () => {
    for (const cc of [undefined, "T1", "XX", "", "India", "I"]) expect([cc, await where(cc)]).toEqual([cc, expect.objectContaining({ country: null, currency: null })]);
  });
  test("it says whether US-dollar payments are switched on", async () => {
    reset(); expect((await j(await call("GET", "/api/payments/where", undefined, { "cf-ipcountry": "DE" }))).international).toBe(false);
  });
});

describe("the order asks for the country and nothing else", () => {
  test("no e-mail, name, company or GST number is needed; the e-mail on the payment is a placeholder, a different one for every payment", async () => {
    const g = await draft();
    const a = await order(g, "IN"), b = await order(g, "IN");
    expect([a.status, b.status]).toEqual([200, 200]);
    const rows = q("SELECT id, email, meta FROM payment ORDER BY created_ms, id");
    expect(rows.length).toBe(2);
    for (const r of rows) { expect(isPendingEmail(r.email)).toBe(true); expect(JSON.parse(r.meta).deferInvoice).toBe(true); }
    expect(new Set(rows.map((r) => r.email)).size).toBe(2); // two payers can never be taken for one organizer
    expect(a.body.razorpay.prefill).toBeUndefined(); // nothing is pre-filled: Razorpay asks the payer itself
    expect(JSON.stringify(W.orders)).not.toContain("payer.invalid");
  });
  test("change India to the United States and back: rupees, US dollars, rupees", async () => {
    const g = await draft();
    const inr1 = await order(g, "IN"), usd = await order(g, "US"), inr2 = await order(g, "IN");
    expect(W.orders.map((o) => o.currency)).toEqual(["INR", "USD", "INR"]);
    expect(W.orders[1]!.amount).toBe(3400); // the US$ price of a 100-person game: US$ 34
    expect(W.orders[0]!.amount).toBe(W.orders[2]!.amount); expect(W.orders[0]!.amount).toBeGreaterThan(W.orders[1]!.amount);
    expect([inr1.body.razorpay.currency, usd.body.razorpay.currency, inr2.body.razorpay.currency]).toEqual(["INR", "USD", "INR"]);
  });
  test("what the network header says never overrides the country the payer chose", async () => {
    const g = await draft();
    await order(g, "US", { "cf-ipcountry": "IN" }); // header says India, the payer chose the United States: dollars
    await order(g, "IN", { "cf-ipcountry": "DE" }); // header says Germany, the payer chose India: rupees
    expect(W.orders.map((o) => o.currency)).toEqual(["USD", "INR"]);
  });
  test("a payment in US dollars is refused (plainly) while the dollar payments are not switched on", async () => {
    reset(); const g = await draft();
    const r = await order(g, "US"); expect(r.status).toBe(400); expect(r.body.error).toMatch(/US dollars/);
    expect((await order(g, "IN")).status).toBe(200);
  });
  test("an older caller that still sends its name and e-mail is served exactly as before: the invoice comes with the payment", async () => {
    const g = await draft();
    const c = await checkout(g.o.key, { eid: g.id, email: "old@acme.com", name: "Old Caller" });
    expect(c.status).toBe(200); capture(c.body, "pay_old"); const v = await j(await verify(c.body, "pay_old"));
    expect(v.invoiceUrl).toMatch(/^\/api\/invoice\//); expect(v.invoicePending).toBeUndefined();
    expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1);
  });
});

describe("paid first, the invoice after", () => {
  test("pay, then skip: the game is paid at once; the tax invoice comes only when they skip, to the e-mail Razorpay gave", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string;
    const p = await pay(c.body);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ok: true, invoicePending: true, invoiceUrl: null, payer: { email: RZ.email, phone: RZ.contact, method: "UPI" } });
    // paid and published at the capture, nothing waits for the form
    expect(one("SELECT status, email FROM payment WHERE id=?", pid)).toEqual({ status: "paid", email: RZ.email }); // the placeholder is overwritten by what Razorpay holds
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
    expect(count("SELECT COUNT(*) c FROM entitlement WHERE payment_id=?", pid)).toBe(1);
    expect(count("SELECT COUNT(*) c FROM invoice")).toBe(0); expect(mailTo(RZ.email).length).toBe(0);
    // what the page may read: no organizer key
    const r = await receipt(pid); expect(r.status).toBe(200); expect(r.body.invoicePending).toBe(true); expect(JSON.stringify(r.body)).not.toContain("cbk_"); expect(r.body.organizerKey).toBeUndefined();
    // skip
    const s = await invoiceCall(pid, { skip: true });
    expect(s.status, JSON.stringify(s.body)).toBe(200); expect(s.body.invoicePending).toBe(false); expect(s.body.invoiceUrl).toMatch(/^\/api\/invoice\//); expect(s.body.invoiceNumber).toBeTruthy();
    expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1);
    const d = invoiceData(pid); expect(d.buyer.gstin).toBeUndefined(); expect(d.buyer.email).toBe(RZ.email); expect(d.buyer.phone).toBe(RZ.contact);
    expect(mailTo(RZ.email).length).toBeGreaterThanOrEqual(1);
    expect(mails().filter((m) => isPendingEmail(m.to_addr)).length).toBe(0); // nobody ever mails the placeholder
    // pressing again changes nothing
    const again = await invoiceCall(pid, { skip: true }); expect(again.status).toBe(200); expect(again.body.alreadyIssued).toBe(true); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1);
  });
  test("pay, then add the details: the invoice carries the company and the GST number; a tax invoice is never edited after it is issued", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string; await pay(c.body);
    const s = await invoiceCall(pid, { name: "Asha Rao", org: "Acme Ltd", taxId: GST.toLowerCase() });
    expect(s.status, JSON.stringify(s.body)).toBe(200); expect(s.body.invoiceUrl).toBeTruthy();
    const d = invoiceData(pid); expect(d.buyer).toMatchObject({ name: "Acme Ltd", gstin: GST, email: RZ.email });
    expect(JSON.stringify(d)).toContain("Asha Rao");
    const late = await invoiceCall(pid, { name: "Someone Else", org: "Other Pvt Ltd", taxId: GST }); // too late: it is issued
    expect(late.status).toBe(200); expect(late.body.alreadyIssued).toBe(true);
    expect(invoiceData(pid).buyer.name).toBe("Acme Ltd"); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1);
  });
  test("a GST number without a company name is asked for the company; a wrong GSTIN is told so; nothing is issued until the details are fine", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string; await pay(c.body);
    const noCo = await invoiceCall(pid, { taxId: GST }); expect(noCo.status).toBe(400); expect(noCo.body.error).toBe(COMPANY_MSG);
    const bad = await invoiceCall(pid, { org: "Acme Ltd", taxId: "12345" }); expect(bad.status).toBe(400); expect(bad.body.error).toBe(GSTIN_MSG);
    expect(count("SELECT COUNT(*) c FROM invoice")).toBe(0); // still open for the payer
    expect((await invoiceCall(pid, { org: "Acme Ltd", taxId: GST })).status).toBe(200); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1);
    expect(PAY_RULES.taxIdNeedsCompany).toBe(true);
  });
  test("pay, then close the page: the invoice is issued by itself 15 minutes after the capture, as it is (billed to the Razorpay e-mail and mobile, no company, no GST number)", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string; await pay(c.body);
    expect(INVOICE_AFTER_MS).toBe(15 * MIN);
    expect(await issueDueInvoices(W.env, T + 14 * MIN)).toBe(0); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(0);
    expect(await issueDueInvoices(W.env, T + 15 * MIN)).toBe(1);
    const d = invoiceData(pid); expect(d.buyer).toMatchObject({ name: RZ.email, email: RZ.email, phone: RZ.contact }); expect(d.buyer.gstin).toBeUndefined();
    expect(mailTo(RZ.email).length).toBeGreaterThanOrEqual(1);
    expect(await issueDueInvoices(W.env, T + 30 * MIN)).toBe(0); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1); // once only
    expect(one("SELECT COUNT(*) c FROM entitlement").c).toBe(1);
  });
  test("an invoice that is due is also issued the next time anybody reads the receipt (when no scheduled tick ran)", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string; await pay(c.body);
    expect((await receipt(pid, T + 10 * MIN)).body.invoicePending).toBe(true);
    const r = await receipt(pid, T + 16 * MIN); expect(r.body.invoicePending).toBe(false); expect(r.body.invoiceUrl).toBeTruthy();
  });
  test("the worker's own scheduled tick issues due invoices (and purges old test counters)", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string; await pay(c.body);
    const early = await runTick(W.env as Env, T + 5 * MIN); expect(early.invoices).toBe(0);
    const due = await runTick(W.env as Env, T + 20 * MIN); expect(due.invoices).toBe(1);
    expect(invoiceData(pid).buyer.email).toBe(RZ.email); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1);
    expect(g.id).toBeTruthy();
  });
  test("the webhook delivered twice, and the browser verify after it: one payment, one grant, nothing issued twice", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string;
    W.payments["pay_w1"] = { id: "pay_w1", order_id: c.body.razorpay.orderId, status: "captured", amount: W.orders[0]!.amount, currency: "INR", ...RZ };
    const ev = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_w1", order_id: c.body.razorpay.orderId, amount: W.orders[0]!.amount } } } });
    const hook = () => call("POST", "/api/payments/webhook", ev, { "x-razorpay-signature": hmac("whsec", ev) });
    expect((await hook()).status).toBe(200); expect((await hook()).status).toBe(200);
    expect(count("SELECT COUNT(*) c FROM entitlement")).toBe(1); expect(count("SELECT COUNT(*) c FROM invoice")).toBe(0);
    expect(one("SELECT email FROM payment WHERE id=?", pid).email).toBe(RZ.email); // the webhook took the e-mail from Razorpay too
    const v = await j(await verify(c.body, "pay_w1")); expect(v.invoicePending).toBe(true);
    const rs = await Promise.all([invoiceCall(pid, { skip: true }), invoiceCall(pid, { skip: true }), invoiceCall(pid, { org: "Acme Ltd" })]);
    for (const r of rs) expect(r.status).toBe(200);
    expect(count("SELECT COUNT(*) c FROM invoice")).toBe(1); expect(mailTo(RZ.email).length).toBe(1);
  });
  test("a payment in US dollars: no Indian GST on the invoice, and the invoice is in US dollars", async () => {
    const g = await draft(); const c = await order(g, "US"); const pid = c.body.paymentId as string;
    const p = await pay(c.body, "pay_usd", { method: "card", card: { network: "Visa", type: "credit", last4: "4242" }, international: true, contact: "+14155550100" });
    expect(p.body).toMatchObject({ currency: "USD", total: 34, payer: { method: "Card" } });
    expect(one("SELECT tax FROM payment WHERE id=?", pid).tax).toBe(0);
    expect((await invoiceCall(pid, { skip: true })).status).toBe(200);
    const d = invoiceData(pid); expect(d.currency).toBe("USD"); expect(d.tax.mode).toBe("none");
  });
  test("if Razorpay gives no usable e-mail the game is still paid, and nobody is mailed at the placeholder", async () => {
    const g = await draft(); const c = await order(g, "IN"); const pid = c.body.paymentId as string;
    const p = await pay(c.body, "pay_noem", { email: undefined }); expect(p.status).toBe(200);
    expect(isPendingEmail(one("SELECT email FROM payment WHERE id=?", pid).email)).toBe(true); expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
    expect(p.body.payer.email).toBeNull();
    expect((await invoiceCall(pid, { skip: true })).status).toBe(200);
    expect(mails().filter((m) => isPendingEmail(m.to_addr)).length).toBe(0);
  });
  test("only a payment id that exists and was paid can be read or finished", async () => {
    expect((await receipt("pay_0000000000000000")).status).toBe(404);
    expect((await invoiceCall("pay_0000000000000000", { skip: true })).status).toBe(404);
    const g = await draft(); const c = await order(g, "IN");
    expect((await receipt(c.body.paymentId)).status).toBe(202); // not paid yet: still confirming
    expect((await invoiceCall(c.body.paymentId, { skip: true })).status).toBe(202);
    expect(count("SELECT COUNT(*) c FROM invoice")).toBe(0);
  });
});

describe("the public Rs 1 / US$ 1 test", () => {
  const start = (ip = "7.7.7.7", now = T, extra: Record<string, unknown> = {}) => call("POST", "/api/payments/paytest", { country: "IN", ...extra }, { "cf-connecting-ip": ip }, now);
  test("it needs no key: anybody gets an order of 100 paise, recorded as a payment test; the page asks nothing else", async () => {
    const r = await start(); const b = await j(r);
    expect(r.status, JSON.stringify(b)).toBe(200); expect(b.razorpay.amount).toBe(100); expect(b.razorpay.prefill).toBeUndefined();
    expect(one("SELECT product_type, is_test, amount FROM payment WHERE id=?", b.paymentId)).toEqual({ product_type: "payment_test", is_test: 1, amount: 1 });
    expect((await start("7.7.7.8", T, { country: "US" }).then(j)).razorpay.amount).toBe(100); expect(W.orders[1]!.currency).toBe("USD");
  });
  test("the old owner-key addresses are gone: they are plain 404s for everybody", async () => {
    for (const [m, p] of [["GET", "/api/payments/paytest/key"], ["GET", "/api/payments/paytest/game/GAME-ONE"]] as const) expect([p, (await call(m, p, undefined, { "x-organizer": "plat" })).status]).toEqual([p, 404]);
  });
  test(`${PAYTEST_PER_HOUR} orders an hour for each visitor; the next is told to try again later; another visitor and the next hour are fine`, async () => {
    for (let i = 0; i < PAYTEST_PER_HOUR; i++) expect((await start()).status).toBe(200);
    const no = await start(); expect(no.status).toBe(429); expect((await j(no)).error).toBe("Please try again later.");
    expect(count("SELECT COUNT(*) c FROM payment")).toBe(PAYTEST_PER_HOUR); expect(W.orders.length).toBe(PAYTEST_PER_HOUR); // the refused one opened no order
    expect((await start("7.7.7.9")).status).toBe(200);
    expect((await start("7.7.7.7", T + HOUR)).status).toBe(200);
  });
  test(`${PAYTEST_PER_DAY} orders a day for each visitor`, async () => {
    let ok = 0, last = 0;
    for (let h = 0; h < 8 && last !== 429; h++) for (let i = 0; i < PAYTEST_PER_HOUR - 1 && last !== 429; i++) { last = (await start("7.7.7.7", T + h * HOUR)).status; if (last === 200) ok++; }
    expect(ok).toBe(PAYTEST_PER_DAY); expect(last).toBe(429);
  });
  test("the counters keep no raw network address and no e-mail, and the scheduled tick forgets old days", async () => {
    await start("7.7.7.7"); const rows = q("SELECT k FROM kv WHERE k LIKE 'ptl/%'"); expect(rows.length).toBe(2);
    for (const r of rows) expect(r.k).not.toContain("7.7.7.7");
    const { purgePaytestCounters } = await import("../src/payfirst");
    await purgePaytestCounters(W.env.DB, T + 3 * 86_400_000); expect(count("SELECT COUNT(*) c FROM kv WHERE k LIKE 'ptl/%'")).toBe(0);
  });
  test("a Game ID is plain text: it is never looked up and no game detail comes back, whether the game exists or not", async () => {
    const g = await draft(); const named = (await create(g.o.key, "GAME-NAMED", { cap: 100, name: "Secret Diwali Bingo" })).status; expect(named).toBe(200);
    const a = await (await start("7.7.7.1", T, { gameId: "GAME-NAMED" })).text(), b = await (await start("7.7.7.2", T, { gameId: "NO-SUCH-GAME" })).text(), c = await (await start("7.7.7.3")).text();
    for (const x of [a, b, c]) { expect(x).not.toContain("Secret Diwali"); expect(x).not.toContain("GAME-NAMED"); expect(x).not.toMatch(/organizer|startMs|participants/i); }
    expect(Object.keys(JSON.parse(a)).sort()).toEqual(Object.keys(JSON.parse(c)).sort()); // the answer does not depend on the Game ID at all
  });
  test("the receipt shows what Razorpay gave; nothing is bought, no credit, no pack, no invoice of the real series", async () => {
    const r = await j(await start("7.7.7.5")); capture(r, "pay_pt1", { currency: "INR", ...RZ });
    const v = await j(await verify(r, "pay_pt1")); expect(v).toMatchObject({ ok: true, paytest: true, payer: { email: RZ.email, phone: RZ.contact, method: "UPI" } });
    expect(v.invoiceNumber).toMatch(/^PAYTEST-/);
    expect((await j(await call("GET", `/api/payments/paytest/${r.paymentId}`))).paytest).toBe(true); // no key
    expect((await call("GET", `/api/payments/${r.paymentId}/receipt`)).status).toBe(404); // a test has its own receipt
    expect(count("SELECT COUNT(*) c FROM entitlement")).toBe(0); expect(count("SELECT COUNT(*) c FROM invoice WHERE seq>0")).toBe(0);
    expect(mails().filter((m) => isPendingEmail(m.to_addr)).length).toBe(0);
  });
});

describe("the rules live in one place", () => {
  test("the browser kit and the Worker agree on the two messages and the 15 minutes", () => {
    const kit = readFileSync(new URL("../../web/public/paykit.js", import.meta.url), "utf8");
    expect(kit).toContain(GSTIN_MSG); expect(kit).toContain(COMPANY_MSG);
    expect(kit).toContain(`invoiceMinutes: ${INVOICE_AFTER_MS / MIN}`);
    expect(kit).toContain(`taxIdNeedsCompany: ${PAY_RULES.taxIdNeedsCompany}`);
  });
});
