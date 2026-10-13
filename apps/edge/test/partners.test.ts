import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env, now);
const plat = { "x-organizer": "plat" };
let CODE = "";
/** Two steps: ask (an e-mailed code), then confirm with the code. Returns the partner's random code and private key. */
const enroll = async (phone = "98111 22233", name = "Asha", email = "asha@partner.example", extra: Record<string, unknown> = {}) => {
  const a: any = await (await call("POST", "/api/partner/enroll", { phone, name, email, consent: true, ...extra })).json();
  if (!a.devCode) return { ...a, existed: true } as any;
  const r: any = await (await call("POST", "/api/partner/enroll/verify", { email, code: a.devCode })).json(); if (r.code) CODE = r.code; return r;
};
const buy = (o: Record<string, unknown> = {}) => call("POST", "/api/checkout", { org: "Acme Ltd", email: `b${Math.random().toString(36).slice(2, 7)}@acme.com`, country: "IN", taxId: "", pack: 500, currency: "INR", ...o });

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", TEST_MODE: "1", PUBLIC_ORIGIN: "https://bingo.test" };
});

describe("enrolling as a sales partner", () => {
  test("the code is random (8 characters, no mobile number anywhere in it, in the link or in the database), the key is private", async () => {
    const a = await enroll("+91 98111-22233");
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/); expect(a.code).not.toContain("9811122233");
    expect(a.link).toBe(`https://bingo.test/?ref=${a.code}`); expect(a.partnerKey).toMatch(/^cbp_[0-9a-f]{40}$/);
    const dump = JSON.stringify([raw.query("SELECT * FROM partner").all(), raw.query("SELECT * FROM kv").all(), raw.query("SELECT * FROM outbox").all().map((r: any) => ({ s: r.subject }))]);
    expect(dump).not.toContain("9811122233"); expect(dump).not.toContain("asha@partner.example"); expect(dump).not.toContain(a.partnerKey);
    const b = await enroll("9811122234", "Rita", "rita@partner.example"); expect(b.code).not.toBe(a.code);
  });
  test("the number is not enough: a 6-digit code mailed to the address must be given back; a wrong or expired code enrols nobody", async () => {
    const a: any = await (await call("POST", "/api/partner/enroll", { phone: "9811122233", email: "x@partner.example", consent: true })).json();
    expect(a.ok).toBe(true); expect(raw.query("SELECT COUNT(*) c FROM partner").get()).toEqual({ c: 0 });
    expect((await call("POST", "/api/partner/enroll/verify", { email: "x@partner.example", code: "000000" })).status).toBe(400);
    expect((await call("POST", "/api/partner/enroll/verify", { email: "x@partner.example", code: a.devCode }, {}, T + 11 * 60_000)).status).toBe(400); // expired
    expect(raw.query("SELECT COUNT(*) c FROM partner").get()).toEqual({ c: 0 });
    expect((await call("POST", "/api/partner/enroll/verify", { email: "x@partner.example", code: a.devCode }, {}, T + 60_000)).status).toBe(200);
    expect((await call("POST", "/api/partner/enroll/verify", { email: "x@partner.example", code: a.devCode })).status).toBe(400); // single use
    expect(raw.query("SELECT COUNT(*) c FROM partner").get()).toEqual({ c: 1 });
  });
  test("five wrong codes lock that attempt", async () => {
    const a: any = await (await call("POST", "/api/partner/enroll", { phone: "9811122233", email: "y@partner.example", consent: true })).json();
    for (let i = 0; i < 5; i++) await call("POST", "/api/partner/enroll/verify", { email: "y@partner.example", code: "111111" });
    expect((await call("POST", "/api/partner/enroll/verify", { email: "y@partner.example", code: a.devCode })).status).toBe(400);
  });
  test("agreeing is required, and a bad number or e-mail is refused", async () => {
    const c = (b: unknown) => call("POST", "/api/partner/enroll", b);
    expect((await c({ phone: "98111 22233", email: "a@b.example" })).status).toBe(400);
    expect((await c({ phone: "98111 22233", email: "a@b.example", consent: "yes" })).status).toBe(400);
    expect((await c({ phone: "123", email: "a@b.example", consent: true })).status).toBe(400);
    expect((await c({ phone: "98111 22233", email: "nope", consent: true })).status).toBe(400);
    expect((await c("junk")).status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM partner").get()).toEqual({ c: 0 });
  });
  test("no enumeration: asking to enrol answers the same for a new and for an already enrolled number or e-mail; an existing partner gets no second key and is mailed to sign in", async () => {
    const first = await enroll();
    const strip = (r: any) => JSON.stringify({ ok: r.ok, sent: r.sent, keys: Object.keys(r).filter((k) => k !== "devCode").sort() });
    const fresh: any = await (await call("POST", "/api/partner/enroll", { phone: "9000000001", email: "new@partner.example", consent: true })).json();
    const sameNumber: any = await (await call("POST", "/api/partner/enroll", { phone: "9811122233", email: "other@partner.example", consent: true, name: "Someone Else" })).json();
    const sameEmail: any = await (await call("POST", "/api/partner/enroll", { phone: "9000000002", email: "asha@partner.example", consent: true })).json();
    expect(strip(sameNumber)).toBe(strip(fresh)); expect(strip(sameEmail)).toBe(strip(fresh));
    expect(sameNumber.devCode).toBeUndefined(); expect(sameEmail.devCode).toBeUndefined(); expect(fresh.devCode).toBeTruthy(); // test mode only: a real caller never sees a code
    expect(first.partnerKey).toBeTruthy(); expect(raw.query("SELECT COUNT(*) c FROM partner").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT name FROM partner").get()).toEqual({ name: "Asha" });
    expect((raw.query("SELECT subject FROM outbox ORDER BY id DESC").all() as any[]).some((r) => /already have an account/.test(r.subject))).toBe(true);
  });
  test("enrolling is limited per network and per address", async () => {
    for (let i = 0; i < 10; i++) expect((await call("POST", "/api/partner/enroll", { phone: "98111 2223" + (i % 10), email: `u${i}@partner.example`, consent: true }, { "cf-connecting-ip": "9.9.9.9" })).status).toBe(200);
    expect((await call("POST", "/api/partner/enroll", { phone: "9811122239", email: "u11@partner.example", consent: true }, { "cf-connecting-ip": "9.9.9.9" })).status).toBe(429);
    expect((await call("POST", "/api/partner/enroll", { phone: "9811122239", email: "u11@partner.example", consent: true }, { "cf-connecting-ip": "8.8.8.8" })).status).toBe(200);
  });
  test("the key is stored only as a hash, names are cleaned, and the source is kept", async () => {
    const a = await enroll("9811122234", "<b>Rita</b>", "rita@partner.example", { source: "card" });
    expect(JSON.stringify(raw.query("SELECT * FROM partner").all()).includes(a.partnerKey)).toBe(false);
    expect(raw.query("SELECT name, source FROM partner").get()).toEqual({ name: "bRita/b", source: "card" });
  });
  test("a busy day says so and enrols nobody half-way", async () => {
    env.DAILY_WRITE_BUDGET = "1";
    expect((await call("POST", "/api/partner/enroll", { phone: "9811122235", email: "z@partner.example", consent: true })).status).toBe(503);
    expect(raw.query("SELECT COUNT(*) c FROM partner").get()).toEqual({ c: 0 });
  });
  test("the link check says only whether a code is a real, active partner, and cannot be tried without limit", async () => {
    await enroll();
    expect(await (await call("GET", `/api/partner/check?code=${CODE}`)).json()).toEqual({ valid: true });
    expect(await (await call("GET", "/api/partner/check?code=ABCDEFGH")).json()).toEqual({ valid: false });
    expect(await (await call("GET", "/api/partner/check?code=9811122233")).json()).toEqual({ valid: false }); // a mobile number is not a code any more
    expect(await (await call("GET", "/api/partner/check?code=abc")).json()).toEqual({ valid: false });
    await call("POST", "/api/partners/state", { code: CODE, state: "blocked" }, plat);
    expect(await (await call("GET", `/api/partner/check?code=${CODE}`)).json()).toEqual({ valid: false });
    for (let i = 0; i < 70; i++) await call("GET", `/api/partner/check?code=ZZZZZZ${i % 10}2`, undefined, { "cf-connecting-ip": "7.7.7.7" });
    await call("POST", "/api/partners/state", { code: CODE, state: "active" }, plat);
    expect(await (await call("GET", `/api/partner/check?code=${CODE}`, undefined, { "cf-connecting-ip": "7.7.7.7" })).json()).toEqual({ valid: false }); // that network is out of tries, even for a real code
    expect(await (await call("GET", `/api/partner/check?code=${CODE}`, undefined, { "cf-connecting-ip": "6.6.6.6" })).json()).toEqual({ valid: true });
  });
});

describe("a referred purchase", () => {
  let key = "";
  beforeEach(async () => { key = (await enroll()).partnerKey; });
  test("a paid purchase through the link is attributed; the partner earns 50% of the taxable value (never of the GST)", async () => {
    const r = await (await buy({ ref: CODE })).json() as any;
    expect(r.result.ok).toBe(true);
    const c = raw.query("SELECT partner_code, base, currency, rate, amount, status FROM commission").get() as any;
    expect(c).toMatchObject({ partner_code: CODE, currency: "INR", rate: 0.5, amount: 2349.5, status: "accrued" });
    expect(c.base).toBe(4699); // 500 participants = Rs 4,699 software price (no GST is charged); commission is 50% of it
  });
  test("no purchase, no commission: an unpaid or unknown-code or no-code order writes nothing", async () => {
    await buy({ ref: "9000000000" }); await buy({});
    expect(raw.query("SELECT COUNT(*) c FROM commission").get()).toEqual({ c: 0 });
    env.RAZORPAY_KEY_ID = "k"; env.RAZORPAY_KEY_SECRET = "s"; env.RAZORPAY_BASE_URL = "https://rzp.test/v1";
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => new Response(JSON.stringify({ id: "order_1", amount: 150000, currency: "INR" }), { status: 200 });
    try { const r = await (await buy({ ref: CODE })).json() as any; expect(r.mode).toBe("razorpay"); } finally { globalThis.fetch = realFetch; }
    expect(raw.query("SELECT COUNT(*) c FROM commission").get()).toEqual({ c: 0 }); // created, not paid
    expect(raw.query("SELECT ref FROM payment WHERE status='created'").get()).toEqual({ ref: CODE });
  });
  test("a stopped partner earns nothing from new sales", async () => {
    await call("POST", "/api/partners/state", { code: CODE, state: "blocked" }, plat);
    await buy({ ref: CODE });
    expect(raw.query("SELECT COUNT(*) c FROM commission").get()).toEqual({ c: 0 });
  });
  test("buying through your own link is blocked with a reason, however the number is typed", async () => {
    await buy({ ref: CODE, phone: "+91 98111 22233" });
    expect(raw.query("SELECT status, reason FROM commission").get()).toEqual({ status: "blocked", reason: "self_referral" });
  });
  test("a customer's first purchase earns the partner half of the software price: 100 = Rs 2,399, 250 = Rs 3,499, 500 = Rs 4,699", async () => {
    let n = 0;
    for (const [pack, base, earn] of [[100, 2399, 1199.5], [250, 3499, 1749.5], [500, 4699, 2349.5]] as const) {
      await buy({ ref: CODE, pack, email: `new${++n}@buyer.example` });
      const c = raw.query("SELECT base, rate, amount, status FROM commission ORDER BY id DESC LIMIT 1").get() as any;
      expect(c).toEqual({ base, rate: 0.5, amount: earn, status: "accrued" });
    }
  });
  test("the same customer buying again within 12 months earns the partner who first brought them 50%, even when they come back without the link", async () => {
    await buy({ ref: CODE, pack: 500, email: "loyal@buyer.example" });
    await buy({ pack: 250, email: "Loyal@Buyer.example" }); // no link this time, same customer
    const rows = raw.query("SELECT base, rate, amount, partner_code FROM commission ORDER BY id").all() as any[];
    expect(rows).toEqual([{ base: 4699, rate: 0.5, amount: 2349.5, partner_code: CODE }, { base: 3499, rate: 0.5, amount: 1749.5, partner_code: CODE }]);
  });
  test("after 12 months a returning customer is new again (50%), and a customer who first bought with no partner never earns a later link-user more than the repeat rate", async () => {
    await buy({ pack: 100, email: "plain@buyer.example" }); // no partner at all
    await buy({ ref: CODE, pack: 100, email: "plain@buyer.example" }); // a link used for a customer who already bought: repeat rate
    expect(raw.query("SELECT rate, amount FROM commission").get()).toEqual({ rate: 0.5, amount: 1199.5 });
    raw.run("UPDATE payment SET paid_ms = paid_ms - ?", [400 * 86_400_000]); // a year and more later
    await buy({ ref: CODE, pack: 100, email: "plain@buyer.example" });
    expect(raw.query("SELECT rate FROM commission ORDER BY id DESC LIMIT 1").get()).toEqual({ rate: 0.5 });
  });
  test("a rate set later by us still works for any sale that was waiting (old rows), exactly once", async () => {
    raw.run("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms) VALUES('old-1','9811122233',1000,'INR',NULL,NULL,'pending_rate',1)");
    expect((await call("POST", "/api/partners/commission/rate", { rate: 0.1 }, plat)).status).toBe(200);
    expect((await call("POST", "/api/partners/commission/rate", { rate: 0.2 }, plat)).status).toBe(200); // nothing left to change
    expect(raw.query("SELECT base, rate, amount, status FROM commission").get()).toEqual({ base: 1000, rate: 0.1, amount: 100, status: "accrued" });
  });
  test("a lower rate can be set by the owner; absurd rates (above 50%) are refused", async () => {
    env.PARTNER_COMMISSION_RATE = "0.15";
    await buy({ ref: CODE });
    expect(raw.query("SELECT rate, amount, status FROM commission").get()).toEqual({ rate: 0.15, amount: 704.85, status: "accrued" });
    for (const rate of [-0.1, 0.51, "x", null]) expect((await call("POST", "/api/partners/commission/rate", { rate }, plat)).status).toBe(400);
  });
  test("a refunded purchase can be voided, but a paid-out one cannot", async () => {
    env.PARTNER_COMMISSION_RATE = "0.1";
    const a = await (await buy({ ref: CODE })).json() as any;
    const b = await (await buy({ ref: CODE })).json() as any;
    await call("POST", "/api/partners/payout", { code: CODE, reference: "UTR12345" }, plat);
    const r1 = await (await call("POST", "/api/partners/commission/void", { paymentId: a.paymentId }, plat)).json() as any;
    expect(r1.voided).toBe(0);
    env.PARTNER_COMMISSION_RATE = "0.1";
    const c = await (await buy({ ref: CODE })).json() as any;
    expect(((await (await call("POST", "/api/partners/commission/void", { paymentId: c.paymentId, reason: "refund" }, plat)).json()) as any).voided).toBe(1);
    expect(b.result.ok).toBe(true);
  });
  test("only we can set rates, record payouts, void sales, stop partners or list everyone", async () => {
    for (const [m, p, b] of [["POST", "/api/partners/commission/rate", { rate: 0.1 }], ["POST", "/api/partners/payout", { code: CODE, reference: "x1234" }], ["POST", "/api/partners/commission/void", { paymentId: "p" }], ["POST", "/api/partners/state", { code: CODE, state: "blocked" }], ["GET", "/api/partners", undefined]] as const) {
      expect((await call(m, p, b)).status).toBe(403);
      expect((await call(m, p, b, { "x-partner": key })).status).toBe(403); // a partner cannot award themselves anything
    }
  });
});

describe("what a partner can see", () => {
  test("their own sales and totals, never who bought; and nobody else's", async () => {
    const a = await enroll(); const codeA = CODE; const b = await enroll("9822233344", "Bilal", "bilal@partner.example"); const codeB = CODE; CODE = codeA;
    env.PARTNER_COMMISSION_RATE = "0.1";
    await buy({ ref: CODE, org: "Secret Buyer Pvt Ltd", email: "private@buyer.com" });
    await buy({ ref: CODE, pack: 1000 });
    await buy({ ref: codeB });
    const me = await (await call("GET", "/api/partner/me", undefined, { "x-partner": a.partnerKey })).json() as any;
    expect(me.code).toBe(CODE);
    expect(me.totals.sales).toBe(2);
    expect(me.totals.accruedInr).toBeCloseTo(469.9 + 709.9, 1);
    expect(me.rateAnnounced).toBe(true);
    const txt = JSON.stringify(me);
    expect(/Secret Buyer|private@buyer|@/.test(txt.replace(/"link":"[^"]*"/, ""))).toBe(false);
    const mine = await (await call("GET", "/api/partner/me", undefined, { "x-partner": b.partnerKey })).json() as any;
    expect(mine.totals.sales).toBe(1);
  });
  test("the partner sees the 50% earned on each sale, never who bought", async () => {
    const a = await enroll();
    await buy({ ref: CODE });
    const me = await (await call("GET", "/api/partner/me", undefined, { "x-partner": a.partnerKey })).json() as any;
    expect(me.totals).toMatchObject({ sales: 1, accruedInr: 2349.5, waitingForRate: 0 });
    expect(me.rateAnnounced).toBe(true); expect(me.rate).toBe(0.5); expect(me.repeatRate).toBe(0.5);
    expect(me.sales[0].amount).toBe(2349.5); expect(JSON.stringify(me.sales)).not.toMatch(/boss|acme|@/i);
  });
  test("a wrong or missing key sees nothing", async () => {
    await enroll();
    expect((await call("GET", "/api/partner/me")).status).toBe(403);
    expect((await call("GET", "/api/partner/me", undefined, { "x-partner": "cbp_nope" })).status).toBe(403);
    expect((await call("GET", "/api/partner/me", undefined, { "x-organizer": "plat" })).status).toBe(403);
  });
  test("a payout records once and the partner then sees it as paid", async () => {
    const a = await enroll(); env.PARTNER_COMMISSION_RATE = "0.1";
    await buy({ ref: CODE });
    expect((await call("POST", "/api/partners/payout", { code: CODE, reference: "UTR998877" }, plat)).status).toBe(200);
    expect(((await (await call("POST", "/api/partners/payout", { code: CODE, reference: "UTR998877" }, plat)).json()) as any).paidRows).toBe(0);
    const me = await (await call("GET", "/api/partner/me", undefined, { "x-partner": a.partnerKey })).json() as any;
    expect(me.totals.accruedInr).toBe(0);
    expect(me.totals.paidInr).toBeGreaterThan(100);
  });
  test("we can see all partners with their counts and what is owed", async () => {
    await enroll(); env.PARTNER_COMMISSION_RATE = "0.1"; await buy({ ref: CODE });
    const l = await (await call("GET", "/api/partners", undefined, plat)).json() as any;
    expect(l.partners[0]).toMatchObject({ code: CODE, sales: 1, state: "active" });
    expect(l.partners[0].accrued).toBeGreaterThan(100);
  });
});
