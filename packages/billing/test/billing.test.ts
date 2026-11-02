import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  BRANDS, DEFAULT_COMPANY, companyGaps, createOrder, financialYear, formatInvoiceNumber, renderInvoiceHtml, renderInvoiceText, splitGst, toMinor,
  verifyPaymentSignature, verifyWebhookSignature, paymentInfo, istStamp, INVOICE_KEEP_NOTE, type InvoiceData,
} from "../src";

describe("brands", () => {
  test("four brands, each with its own invoice series and name exactly as given", () => {
    expect(Object.values(BRANDS).map((b) => b.name)).toEqual(["Corporate Tic Tac Toe", "dpdp.VERIDIAN-AIOS.COM", "projexa-ai.com", "dewberry.in"]);
    expect(new Set(Object.values(BRANDS).map((b) => b.invoicePrefix)).size).toBe(4);
  });
  test("one legal entity on every invoice", () => { expect(DEFAULT_COMPANY.legalName).toBe("IT Services by Rajat Agarwal"); });
});

describe("GST", () => {
  test("same state: CGST + SGST 9% each; amounts add back to the total", () => {
    const t = splitGst(2000, "INR", "27", "27ABCDE1234F1Z5", true);
    expect(t.mode).toBe("intra");
    expect(t.cgst).toBe(t.sgst);
    expect(Math.abs(t.taxable + t.cgst + t.sgst - 2000)).toBeLessThan(0.011);
  });
  test("different state: IGST 18%", () => {
    const t = splitGst(1180, "INR", "27", "29ABCDE1234F1Z5", true);
    expect(t).toMatchObject({ mode: "inter", taxable: 1000, igst: 180, cgst: 0 });
  });
  test("supplier state unknown: never claims CGST/SGST", () => { expect(splitGst(1180, "INR", "", "27ABCDE1234F1Z5", true).mode).toBe("inter"); });
  test("US dollar sale (export of services): no GST charged", () => { expect(splitGst(399, "USD", "27", undefined, true)).toMatchObject({ mode: "export", igst: 0, total: 399 }); });
});

describe("invoice numbers", () => {
  test("Indian financial year runs April to March", () => {
    expect(financialYear(new Date("2026-10-01T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T18:00:00Z"))).toBe("2026-27"); // 23:30 IST on 31 March (the old line used 23:00 UTC = 04:30 IST on 1 April, which is already the new year)
    expect(financialYear(new Date("2027-04-01T00:00:00Z"))).toBe("2027-28");
    expect(financialYear(new Date("2026-01-15T00:00:00Z"))).toBe("2025-26");
  });
  test("numbers are brand-wise", () => {
    expect(formatInvoiceNumber(BRANDS.corporate_tic_tac_toe, "2026-27", 1)).toBe("CB/2026-27/000001");
    expect(formatInvoiceNumber(BRANDS.projexa, "2026-27", 42)).toBe("PXA/2026-27/000042");
    expect(formatInvoiceNumber(BRANDS.dpdp, "2026-27", 7)).toBe("DPDP/2026-27/000007");
    expect(formatInvoiceNumber(BRANDS.dewberry, "2026-27", 7)).toBe("DEW/2026-27/000007");
  });
});

const invoice = (draft: boolean, company = DEFAULT_COMPANY, gstOn = true): InvoiceData => ({
  number: "CB/2026-27/000001", issuedAt: Date.UTC(2026, 9, 1), brand: BRANDS.corporate_tic_tac_toe, company, draft,
  buyer: { name: "Acme <script>alert(1)</script> Industries", gstin: "27ABCDE1234F1Z5", email: "hr@acme.com" }, currency: "INR",
  lines: [{ description: "Corporate Tic Tac Toe, up to 250 participants", quantity: 1, amount: 847.46 }], tax: splitGst(1000, "INR", "27", "27ABCDE1234F1Z5", gstOn), paymentRef: "pay_123",
});

describe("invoice rendering", () => {
  test("brand is the title and the legal entity is named as the supplier", () => {
    const html = renderInvoiceHtml(invoice(false));
    expect(html).toContain("<h1>Corporate Tic Tac Toe</h1>");
    expect(html).toContain("A product of <b>IT Services by Rajat Agarwal</b>");
    expect(html).toContain("CB/2026-27/000001");
  });
  test("the invoice carries the brand kit's badge, the kit's blue, and says who takes the payment (owner order 2026-10-29)", () => {
    const html = renderInvoiceHtml(invoice(false)), text = renderInvoiceText(invoice(false));
    expect(html).toContain('<svg class="bdg"'); expect(html).toContain('fill="#17784A"'); expect(html).toContain("#0B3D91"); expect(html).not.toContain("#0B5D5B"); // the badge is drawn in the page: a printed invoice and a PDF need no outside file
    expect(html).toContain("All payments are taken only by IT Services by Rajat Agarwal, through Razorpay.");
    expect(text).toContain("All payments are taken only by IT Services by Rajat Agarwal, through Razorpay.");
  });
  test("buyer text is escaped", () => { expect(renderInvoiceHtml(invoice(false))).not.toContain("<script>"); });
  test("an invoice with missing supplier details says DRAFT instead of pretending to be valid", () => {
    expect(companyGaps(DEFAULT_COMPANY, true)).toEqual(["GSTIN", "state code", "registered address", "SAC code"]);
    expect(renderInvoiceHtml(invoice(true))).toContain("DRAFT");
    expect(renderInvoiceText(invoice(true))).toContain("DRAFT - TAX INVOICE");
    expect(companyGaps({ ...DEFAULT_COMPANY, gstin: "x", stateCode: "27", addressLines: ["a"], sacCode: "998314" }, true)).toEqual([]);
  });
  test("text invoice shows CGST/SGST for the same state", () => {
    const t = renderInvoiceText(invoice(false));
    expect(t).toContain("CGST 9%");
    expect(t).toContain("SGST 9%");
    expect(t).toContain("pay_123");
  });
});

describe("no GST (the seller is not registered, product decision 2026-10-09)", () => {
  test("GST is off by default: the price is the whole amount, no tax lines", () => {
    const t = splitGst(2399, "INR", "", undefined);
    expect(t).toMatchObject({ mode: "none", taxable: 2399, total: 2399, cgst: 0, sgst: 0, igst: 0 });
    expect(companyGaps(DEFAULT_COMPANY)).toEqual([]); // nothing else is needed on a receipt
  });
  test("the receipt says INVOICE, names the seller plainly, and carries no GST, GSTIN, place of supply or tax rows", () => {
    const inv = invoice(false, DEFAULT_COMPANY, false);
    const html = renderInvoiceHtml(inv), text = renderInvoiceText(inv);
    expect(html).toContain("<b>INVOICE</b>"); expect(html).not.toContain("TAX INVOICE");
    expect(html).toContain("IT Services by Rajat Agarwal"); expect(html).toContain("hello@corporatetambola.com"); expect(html).toContain("(+91) 96503 97480");
    expect(html).not.toMatch(/CGST|SGST|IGST|Taxable value|Place of supply|A product of/); expect(html).toContain("GST is not charged");
    expect(text).toMatch(/^INVOICE/); expect(text).not.toMatch(/CGST|SGST|IGST|Taxable value|A product of|GSTIN: 09/); expect(text).toContain("TOTAL");
  });
  test("the seller is never a company: no Shobha Kamal, no CIN, no company PAN, no GSTIN, no address", () => {
    expect(DEFAULT_COMPANY).toMatchObject({ legalName: "IT Services by Rajat Agarwal", cin: "", pan: "", gstin: "", addressLines: [], email: "hello@corporatetambola.com", phone: "(+91) 96503 97480" });
    expect(JSON.stringify(DEFAULT_COMPANY)).not.toMatch(/shobha/i);
  });
});

describe("Razorpay signatures (the checkout and webhook rules from the public docs)", () => {
  const secret = "test_secret_value";
  test("payment signature = HMAC_SHA256(order_id|payment_id)", () => {
    const sig = createHmac("sha256", secret).update("order_ABC|pay_XYZ").digest("hex");
    expect(verifyPaymentSignature(secret, "order_ABC", "pay_XYZ", sig)).toBe(true);
    expect(verifyPaymentSignature(secret, "order_ABC", "pay_OTHER", sig)).toBe(false);
    expect(verifyPaymentSignature("wrong", "order_ABC", "pay_XYZ", sig)).toBe(false);
    expect(verifyPaymentSignature(secret, "order_ABC", "pay_XYZ", "")).toBe(false);
  });
  test("webhook signature = HMAC_SHA256(raw body)", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyWebhookSignature("whsec", body, sig)).toBe(true);
    expect(verifyWebhookSignature("whsec", body + " ", sig)).toBe(false);
  });
  test("amounts are sent in paise", () => { expect(toMinor(1000)).toBe(100000); expect(toMinor(847.46)).toBe(84746); });
});

describe("Orders API client (against a local stand-in for api.razorpay.com)", () => {
  test("sends Basic auth, paise, the brand in notes; surfaces Razorpay's own error text", async () => {
    let seen: any = null;
    const srv = Bun.serve({ port: 0, async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/v1/orders") {
        seen = { auth: req.headers.get("authorization"), body: await req.json() };
        if (seen.body.amount === 1) return new Response(JSON.stringify({ error: { description: "Order amount less than minimum amount allowed" } }), { status: 400 });
        return new Response(JSON.stringify({ id: "order_TEST1", amount: seen.body.amount, currency: seen.body.currency, receipt: seen.body.receipt, status: "created" }));
      }
      return new Response("no", { status: 404 });
    } });
    try {
      const cfg = { keyId: "rzp_test_abc", keySecret: "sec", baseUrl: `http://localhost:${srv.port}/v1` };
      const o = await createOrder(cfg, { amountMinor: 100000, currency: "INR", receipt: "ord_1", notes: { brand: "Corporate Tic Tac Toe", product: "engagement" } });
      expect(o.id).toBe("order_TEST1");
      expect(seen.auth).toBe("Basic " + Buffer.from("rzp_test_abc:sec").toString("base64"));
      expect(seen.body).toMatchObject({ amount: 100000, currency: "INR", notes: { brand: "Corporate Tic Tac Toe" } });
      await expect(createOrder(cfg, { amountMinor: 1, currency: "INR", receipt: "r", notes: {} })).rejects.toThrow("minimum amount");
    } finally { srv.stop(true); }
  });
});

describe("invoice details (2026-10-10 owner list)", () => {
  const raw = { id: "pay_ABC", order_id: "order_XYZ", status: "captured", method: "upi", vpa: "rajat.agarwal@okhdfc", amount: 129900, currency: "INR", created_at: 1791642727, email: "a@b.co", contact: "+919650397480", acquirer_data: { rrn: "628812345678", upi_transaction_id: "UTX1" } };
  const base = (): InvoiceData => ({ number: "CB/2026-27/000007", issuedAt: 1791642730000, brand: BRANDS.corporate_tic_tac_toe!, company: DEFAULT_COMPANY, draft: false, buyer: { name: "Asha Rao", email: "asha@acme.in", phone: "+919800000000", country: "IN" }, currency: "INR", lines: [{ description: "Corporate Tic Tac Toe: up to 250 participants", quantity: 1, amount: 1299 }], tax: splitGst(1299, "INR", "", undefined, false), paymentRef: "pay_ABC", orderRef: "pay_1", paidAtMs: 1791642727000, game: { id: "eng_1", name: "Diwali Dhamaka", startMs: 1791700000000 }, organizer: { name: "Asha Rao", email: "host@acme.in", phone: "+919811111111", org: "Acme" }, pay: paymentInfo(raw) });
  test("IST stamp is IST, with date, time and zone", () => { expect(istStamp(Date.UTC(2026, 9, 10, 20, 0, 0))).toBe("11 Oct 2026, 01:30:00 IST"); });
  test("paymentInfo masks the UPI id and keeps method, bank reference and times", () => {
    const p = paymentInfo(raw);
    expect(p.methodLabel).toBe("UPI"); expect(p.detail).toBe("UPI ID ra***********@okhdfc"); expect(p.rrn).toBe("628812345678");
    expect(JSON.stringify(p)).not.toContain("rajat.agarwal");
    expect(paymentInfo({ id: "p", method: "card", card: { network: "Visa", type: "credit", last4: "1111" } }).detail).toBe("Visa credit card ending 1111");
    expect(paymentInfo(null)).toEqual({});
  });
  test("page 1 shows game, paid-on (IST), paid-via, payer, organizer, Razorpay record and the keep-for-invoice note", () => {
    const h = renderInvoiceHtml(base());
    for (const x of ["Diwali Dhamaka (eng_1)", "Paid on (IST)", "IST", "Razorpay: UPI", "UPI ID ra", "Amount paid", "asha@acme.in", "+919800000000", "host@acme.in", "+919811111111", "Razorpay payment ID", "pay_ABC", "order_XYZ", "628812345678", "a@b.co", "+919650397480", INVOICE_KEEP_NOTE.replace(/'/g, "&#39;")]) expect(h).toContain(x);
  });
  test("page 2 is a separate printed page with the terms", () => {
    const h = renderInvoiceHtml(base());
    expect(h).toContain('class="sheet terms"'); expect(h).toContain("page-break-before:always"); expect(h).toContain("We do not give refunds"); expect(h.indexOf("Terms and conditions")).toBeGreaterThan(h.indexOf("TOTAL"));
  });
  test("USD invoice (outside India) says no GST and prints US$", () => {
    const h = renderInvoiceHtml({ ...base(), currency: "USD", tax: splitGst(17, "USD", "", undefined, false), buyer: { name: "Bob", email: "b@x.com", country: "US" } });
    expect(h).toContain("US$17.00");
  });
  test("details are escaped and the text mail carries the same facts", () => {
    const i = base(); i.organizer = { name: "<script>x</script>" };
    expect(renderInvoiceHtml(i)).not.toContain("<script>x");
    const t = renderInvoiceText(base());
    expect(t).toContain("Paid on:"); expect(t).toContain("Paid for: Diwali Dhamaka"); expect(t).toContain("UPI"); expect(t).toContain("Organizer:"); expect(t).toContain(INVOICE_KEEP_NOTE);
  });
});

describe("financial year is counted in Indian time (rehearsal G10/G13)", () => {
  test("the year turns at 00:00 IST on 1 April, not at 00:00 UTC", () => {
    expect(financialYear(new Date(Date.UTC(2027, 2, 31, 18, 29, 59)))).toBe("2026-27"); // 23:59:59 IST on 31 March
    expect(financialYear(new Date(Date.UTC(2027, 2, 31, 18, 30, 0)))).toBe("2027-28");  // 00:00:00 IST on 1 April
    expect(financialYear(new Date(Date.UTC(2027, 3, 1, 0, 8, 0)))).toBe("2027-28");
    expect(financialYear(new Date(Date.UTC(2027, 2, 31, 12, 0, 0)))).toBe("2026-27");   // 17:30 IST on 31 March
    expect(financialYear(new Date(Date.UTC(2026, 11, 31, 20, 0, 0)))).toBe("2026-27");  // 1 January IST is still the same year
  });
});
