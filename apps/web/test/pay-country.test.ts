// The Razorpay-first payment pages (Boss order 2 Nov 2026): BEFORE paying the payer sees one line, "Paying from India · ₹ · change", and nothing else to fill in; AFTER paying the page shows what
// Razorpay gave and a short optional form for the invoice with a Skip button. Each test opens the real page in a DOM that talks to the REAL Worker.
//   country: India header -> rupees; Germany -> US dollars; no header (or Tor "T1", unknown "XX") -> the list opens; change India -> United States -> India = three orders in the right money;
//            what the header says never overrides the payer's own choice (also after a reload of the tab)
//   after paying: pay then skip, pay then add details, a GST number without a company, pay then close the page (the invoice follows by itself 15 minutes later)
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { openPage, T } from "./harness";
import { KIT, type O, closeRazorpay, draftOnly, errText, fromCountry, linkOf, organizer, published, reply, snap, tabOf, type, val, watch } from "./pay-helpers";

setDefaultTimeout(60_000);
let pages: { close: () => Promise<void> }[] = [];
afterEach(async () => { for (const p of pages) await p.close(); pages = []; });

const GST = "27AAPFU0939F1ZV";
const MIN = 60_000;
/** the page text without the one-line hint inside the country list (it names both currencies, whatever the country) */
const shown = (t: string) => t.replace(/India pays in rupees[^.]*\.\s*Every other country pays in US dollars \(US\$\)\./, "");
const opn = async (o: O, t: string, x: { session?: Record<string, string>; cc?: string } = {}) => {
  const p = await openPage(o.world, { url: "http://localhost/paylink.html" + (t ? "?t=" + t : ""), html: "paylink.html", scripts: [...KIT, "paylink.js"], session: x.session ?? {}, afterLoad: x.cc ? fromCountry(x.cc) : undefined });
  pages.push(p); return p;
};
const line = (country: string, cur: "₹" | "US$") => new RegExp(`Paying from ${country}\\s*·\\s*${cur.replace("$", "\\$")}\\s*·\\s*change`);
const visibleCountries = (p: any) => (Array.from(p.win.document.querySelectorAll("#ctylist li")) as any[]).filter((li) => !li.hidden).map((li) => String(li.textContent).trim());
const NOT_ASKED = ["#nm", "#em", "#ph", "#pcode", "#org", "#tax", "#okey", "#cty"];
const game = async (id = "PC-1", name = "Diwali Night") => { const o = await organizer({ TEST_MODE: "1" }); await published(o, id, name); return { o, t: await linkOf(o, id) }; };

describe("the country: the only thing asked before paying", () => {
  test("India from the network: it says so, shows rupees, and asks for nothing else", async () => {
    const { o, t } = await game(); const p = await opn(o, t, { cc: "IN" });
    const txt = await p.waitFor((x) => /Diwali Night/.test(x));
    expect(txt).toMatch(line("India", "₹")); expect(txt).toMatch(/Pay ₹/); expect(shown(txt)).not.toMatch(/US\$/);
    expect((p.$("#ctybox") as any).hidden).toBe(true); expect((p.$("#paygo") as any).disabled).toBe(false);
    for (const id of NOT_ASKED) expect([id, p.$(id)]).toEqual([id, null]); // no name, e-mail, mobile, company or GST box before the payment
    expect(p.$("#paygo")).not.toBeNull(); expect(p.errors).toEqual([]);
  });
  test("Germany from the network: US dollars, charged in US$, no GST", async () => {
    const { o, t } = await game(); const p = await opn(o, t, { cc: "DE" });
    const txt = await p.waitFor((x) => /Diwali Night/.test(x) && /US\$34/.test(x));
    expect(txt).toMatch(line("Germany", "US$")); expect(txt).toMatch(/Pay US\$34/); expect(txt).toMatch(/Charged in US\$/); expect(shown(txt)).not.toMatch(/₹/); expect(txt).toMatch(/No Indian GST is added/);
  });
  test("no header, Tor (T1) or unknown (XX): nothing is guessed - the list opens, the price and the button wait; picking India (typed in the search box) fills them in", async () => {
    for (const cc of [undefined, "T1", "XX"]) {
      const { o, t } = await game("PC-U" + (cc ?? "N"), "Unknown Night"); const p = await opn(o, t, { cc });
      const txt = await p.waitFor((x) => /Unknown Night/.test(x));
      expect([cc, /Where are you paying from/.test(txt)]).toEqual([cc, true]); expect((p.$("#ctybox") as any).hidden).toBe(false);
      expect(txt).toMatch(/Choose your country to see the price/); expect(p.$("#ctychange")).toBeNull();
      expect((p.$("#paygo") as any).disabled).toBe(true); expect(p.$("#paygo").textContent).toMatch(/Choose your country first/);
      type(p, "#ctyq", "india"); expect(visibleCountries(p)).toContain("India"); expect(visibleCountries(p)).not.toContain("Germany");
      type(p, "#ctyq", "zzzz"); expect(visibleCountries(p)).toEqual([]); expect((p.$("#ctyno") as any).hidden).toBe(false);
      type(p, "#ctyq", "india"); p.click('.pk-ctyopt[data-cty="IN"]');
      await p.waitFor((x) => line("India", "₹").test(x) && /Pay ₹/.test(x));
      expect((p.$("#paygo") as any).disabled).toBe(false); expect(tabOf(p)["cbz-paydraft-paylink"]).toContain('"pick":"IN"'); // remembered for this tab
    }
  });
  test("change India -> United States -> India: the three orders are in rupees, US dollars, rupees; none carries a name, e-mail or GST number", async () => {
    const { o, t } = await game(); const p = await opn(o, t, { cc: "IN" }); await p.waitFor((x) => /Diwali Night/.test(x));
    const seen = watch(p, [{ method: "POST", match: /\/checkout$/, reply: reply(500, { error: "The payment service is busy." }) }]);
    const orders = () => seen.bodies.filter((b) => /^POST .*\/checkout$/.test(b.at));
    p.click("#paygo"); await p.waitFor(() => orders().length === 1 && errText(p) !== "");
    p.click("#ctychange"); expect((p.$("#ctybox") as any).hidden).toBe(false);
    type(p, "#ctyq", "united st"); expect(visibleCountries(p)).toContain("United States"); p.click('.pk-ctyopt[data-cty="US"]');
    await p.waitFor((x) => line("United States", "US$").test(x) && /Pay US\$34/.test(x));
    p.click("#paygo"); await p.waitFor(() => orders().length === 2);
    p.click("#ctychange"); type(p, "#ctyq", "india"); p.click('.pk-ctyopt[data-cty="IN"]');
    await p.waitFor((x) => line("India", "₹").test(x) && /Pay ₹/.test(x));
    p.click("#paygo"); await p.waitFor(() => orders().length === 3);
    expect(orders().map((b) => [b.country, b.currency])).toEqual([["IN", "INR"], ["US", "USD"], ["IN", "INR"]]);
    for (const b of orders()) for (const k of ["name", "email", "phone", "phoneCode", "org", "taxId"]) expect([k, k in b]).toEqual([k, false]);
  });
  test("the network never overrides the payer's own choice, not even after a reload of the tab", async () => {
    const { o, t } = await game();
    const p = await opn(o, t, { cc: "IN" }); await p.waitFor((x) => /Diwali Night/.test(x));
    p.click("#ctychange"); type(p, "#ctyq", "united st"); p.click('.pk-ctyopt[data-cty="US"]'); await p.waitFor((x) => line("United States", "US$").test(x) && /US\$34/.test(x));
    const tab = tabOf(p); await p.close();
    const q = await opn(o, "", { session: tab, cc: "IN" }); // the network still says India
    const txt = await q.waitFor((x) => /Diwali Night/.test(x)); expect(txt).toMatch(line("United States", "US$")); expect(txt).toMatch(/Pay US\$34/);
    const r = await opn(o, t, { cc: "DE", session: { "cbz-paydraft-paylink": JSON.stringify({ pick: "IN" }) } }); // the network says Germany, the payer chose India
    const txt2 = await r.waitFor((x) => /Diwali Night/.test(x)); expect(txt2).toMatch(line("India", "₹")); expect(txt2).toMatch(/Pay ₹/);
  });
  test("the console payment page has the same line and the same money: Germany pays US dollars for the game it opens", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await draftOnly(o, "PC-CON", "Console Night");
    const p = await openPage(o.world, { url: "http://localhost/pay.html?e=PC-CON", html: "pay.html", scripts: [...KIT, "pay.js"], session: { "cbz-org": o.token }, afterLoad: fromCountry("DE") }); pages.push(p);
    const txt = await p.waitFor((x) => /Console Night/.test(x) && /Paying from/.test(x));
    expect(txt).toMatch(line("Germany", "US$")); expect(txt).toMatch(/Pay US\$34/);
    for (const id of NOT_ASKED) expect([id, p.$(id)]).toEqual([id, null]);
    const seen = watch(p, [{ method: "POST", match: /\/api\/checkout$/, reply: reply(500, { error: "The payment service is busy." }) }]);
    p.click("#paygo"); await p.waitFor(() => seen.bodies.some((b) => /\/api\/checkout$/.test(b.at)));
    const b = seen.bodies.find((x) => /\/api\/checkout$/.test(x.at))!; expect([b.country, b.currency, b.eid]).toEqual(["DE", "USD", "PC-CON"]); expect("email" in b || "name" in b).toBe(false);
  });
  test("the public payment test has the line too, and its button names the money: US$1 from Germany, ₹1 from India, nothing until a country is known", async () => {
    const o = await organizer();
    const at = async (cc?: string) => { const p = await openPage(o.world, { url: "http://localhost/paytest.html", html: "paytest.html", scripts: [...KIT, "paytest.js"], afterLoad: cc ? fromCountry(cc) : undefined }); pages.push(p); await p.waitFor((x) => /Test our payment/.test(x)); return p; };
    const de = await at("DE"); expect(de.text()).toMatch(line("Germany", "US$")); expect(de.$("#go").textContent).toBe("Pay US$1 (test)");
    const inn = await at("IN"); expect(inn.text()).toMatch(line("India", "₹")); expect(inn.$("#go").textContent).toBe("Pay ₹1 (test)");
    const none = await at(); expect(none.$("#go").disabled).toBe(true); expect(none.$("#go").textContent).toMatch(/Choose your country first/); expect((none.$("#ctybox") as any).hidden).toBe(false);
    for (const id of ["#nm", "#em", "#ph", "#org", "#tax", "#okey"]) expect([id, inn.$(id)]).toEqual([id, null]);
  });
});

describe("after paying: add to your invoice, or skip", () => {
  const pay = async (p: any) => { p.click("#paygo"); return p.waitFor((x: string) => /Payment received/.test(x), 20_000); };
  const invoices = (o: O) => o.world.raw.prepare("SELECT payment_id, data FROM invoice").all() as { payment_id: string; data: string }[];

  test("pay, then Skip: the game is paid, the receipt shows the form, Skip issues the invoice 'as it is', and a reload brings the receipt back", async () => {
    const { o, t } = await game(); const p = await opn(o, t, { cc: "IN" }); await p.waitFor((x) => /Diwali Night/.test(x));
    const txt = await pay(p);
    expect(txt).toMatch(/Add to your invoice/); expect(txt).toMatch(/all optional/); expect(p.$("#invadd")).not.toBeNull(); expect(p.$("#invskip").textContent).toBe("Skip");
    for (const id of ["#nm", "#org", "#tax"]) expect([id, p.$(id)]).not.toEqual([id, null]);
    expect((o.world.raw.prepare("SELECT status FROM payment").get() as any).status).toBe("paid"); // paid at once
    expect((await o.json(await o.api("GET", `/api/paylink/${t}`))).status).toBe("paid");
    expect(invoices(o).length).toBe(0); // the tax invoice waits for the buttons
    p.click("#invskip"); const done = await p.waitFor((x) => /Your invoice/.test(x));
    expect(p.$("#pk-invform")).toBeNull(); expect(done).not.toMatch(/Add to your invoice/);
    expect(invoices(o).length).toBe(1); expect(JSON.parse(invoices(o)[0]!.data).buyer.gstin).toBeUndefined();
    const tab = tabOf(p); await p.close();
    const q = await opn(o, "", { session: tab, cc: "IN" }); const again = await q.waitFor((x) => /Payment received/.test(x) && /Your invoice/.test(x)); // after a reload: the receipt, with the invoice
    expect(again).not.toMatch(/Add to your invoice/); expect(q.$("#paygo")).toBeNull();
  });
  test("pay, then add the details: the invoice is made out to the company and carries the GST number; what was typed is kept through a failed send and a reload", async () => {
    const { o, t } = await game("PC-2", "Details Night"); const p = await opn(o, t, { cc: "IN" }); await p.waitFor((x) => /Details Night/.test(x)); await pay(p);
    type(p, "#nm", "Asha Rao"); type(p, "#org", "Acme Ltd"); type(p, "#tax", GST.toLowerCase());
    expect(snap(p, ["#nm", "#org", "#tax"])).toEqual({ "#nm": "Asha Rao", "#org": "Acme Ltd", "#tax": GST.toLowerCase() });
    expect((p.win as any).__ctDirty()).toBe(true); // the automatic page update waits while the form is half done
    const real = p.win.fetch; p.win.fetch = async (u: any, init?: any) => (/\/invoice$/.test(String(u)) && init?.method === "POST" ? reply(500, { error: "The invoice service is busy." })() : real(u, init));
    p.click("#invadd"); await p.waitFor(() => /invoice service is busy/.test(errText(p)));
    expect(errText(p)).toMatch(/What you typed is kept/); expect(snap(p, ["#nm", "#org", "#tax"])).toEqual({ "#nm": "Asha Rao", "#org": "Acme Ltd", "#tax": GST.toLowerCase() }); expect(invoices(o).length).toBe(0);
    const tab = tabOf(p); await p.close();
    const q = await opn(o, "", { session: tab, cc: "IN" }); await q.waitFor((x) => /Add to your invoice/.test(x));
    expect(snap(q, ["#nm", "#org", "#tax"])).toEqual({ "#nm": "Asha Rao", "#org": "Acme Ltd", "#tax": GST.toLowerCase() });
    q.click("#invadd"); await q.waitFor((x) => /Your invoice/.test(x));
    expect(invoices(o).length).toBe(1); const d = JSON.parse(invoices(o)[0]!.data); expect(d.buyer).toMatchObject({ name: "Acme Ltd", gstin: GST });
  });
  test("a GST number with no company name is asked for the company; a wrong GSTIN is told so; nothing is issued meanwhile", async () => {
    const { o, t } = await game("PC-3", "Gst Night"); const p = await opn(o, t, { cc: "IN" }); await p.waitFor((x) => /Gst Night/.test(x)); await pay(p);
    type(p, "#tax", GST); p.click("#invadd"); await p.waitFor(() => /company name/.test(errText(p)));
    expect(errText(p)).toBe("Please add your company name. A GST invoice needs the business name."); expect(p.$("#org").getAttribute("aria-invalid")).toBe("true");
    type(p, "#org", "Acme Ltd"); type(p, "#tax", "12345"); p.click("#invadd"); await p.waitFor(() => /GSTIN does not look right/.test(errText(p)));
    expect(p.$("#tax").getAttribute("aria-invalid")).toBe("true"); expect(invoices(o).length).toBe(0);
    type(p, "#tax", GST); p.click("#invadd"); await p.waitFor((x) => /Your invoice/.test(x)); expect(invoices(o).length).toBe(1);
  });
  test("pay, then close the page: it comes back with the form until 15 minutes have passed, and with the invoice after that (nobody pressed anything)", async () => {
    const { o, t } = await game("PC-4", "Closed Night"); const p = await opn(o, t, { cc: "IN" }); await p.waitFor((x) => /Closed Night/.test(x)); await pay(p);
    type(p, "#org", "Typed Co");
    const tab = tabOf(p); await p.close();
    o.world.now = T + 10 * MIN;
    const q = await opn(o, "", { session: tab, cc: "IN" }); await q.waitFor((x) => /Add to your invoice/.test(x)); expect(val(q, "#org")).toBe("Typed Co"); expect(invoices(o).length).toBe(0);
    const tab2 = tabOf(q); await q.close();
    o.world.now = T + 16 * MIN; // 15 minutes after the capture
    const r = await opn(o, "", { session: tab2, cc: "IN" }); const txt = await r.waitFor((x) => /Your invoice/.test(x));
    expect(txt).not.toMatch(/Add to your invoice/); expect(invoices(o).length).toBe(1); expect(JSON.parse(invoices(o)[0]!.data).buyer.name).not.toBe("Typed Co"); // issued 'as is': what was only typed is not on it
  });
  test("a payment in US dollars: the receipt says US$, and the invoice has no Indian GST", async () => {
    const { o, t } = await game("PC-5", "Dollar Night"); const p = await opn(o, t, { cc: "DE" }); await p.waitFor((x) => /US\$34/.test(x));
    const txt = await pay(p); expect(txt).toMatch(/US\$34/);
    p.click("#invskip"); await p.waitFor((x) => /Your invoice/.test(x));
    const d = JSON.parse((o.world.raw.prepare("SELECT data FROM invoice").get() as any).data); expect(d.currency).toBe("USD"); expect(d.tax.mode).toBe("none");
    expect((o.world.raw.prepare("SELECT currency, amount FROM payment").get() as any)).toEqual({ currency: "USD", amount: 34 });
  });
  test("the public test shows what Razorpay gave (e-mail, mobile, method) and then 'Test again'", async () => {
    const o = await organizer();
    const p = await openPage(o.world, { url: "http://localhost/paytest.html", html: "paytest.html", scripts: [...KIT, "paytest.js"], afterLoad: fromCountry("IN") }); pages.push(p); await p.waitFor((x) => /Test our payment/.test(x));
    watch(p, [{ method: "POST", match: /\/api\/payments\/paytest$/, reply: reply(200, { mode: "razorpay", paymentId: "pay_0123456789abcdef", razorpay: { orderId: "order_stub" }, hop: "" }) }]);
    p.win.TB.pay = async () => ({ ok: true, paytest: true, orderId: "pay_0123456789abcdef", total: 1, currency: "INR", razorpayPaymentId: "pay_rz1", invoiceUrl: null, invoiceNumber: "PAYTEST-2026-27-1", payer: { email: "visitor@acme.in", phone: "+919876501234", method: "UPI", methodDetail: "UPI ID ab**@okhdfc" } });
    p.click("#go"); const txt = await p.waitFor((x) => /The test worked/.test(x));
    expect(txt).toMatch(/visitor@acme\.in/); expect(txt).toMatch(/\+919876501234/); expect(txt).toMatch(/UPI ID ab\*\*@okhdfc/); expect(txt).not.toMatch(/UPI UPI/); expect(txt).toMatch(/E-mail \(from Razorpay\)/); expect(p.$("#invadd")).toBeNull(); // the test needs no invoice details
    p.click("#again"); await p.waitFor((x) => /Test our payment/.test(x) && !!p.$("#go"));
    expect(tabOf(p)["cbz-paydraft-paytest"]).not.toContain("pay_0123456789abcdef");
    void closeRazorpay;
  });
});
