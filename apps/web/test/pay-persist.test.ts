// The three payment pages keep EVERYTHING the person typed or chose (Boss order 2 Nov 2026, payment pages redesign, point D; updated for the Razorpay-first pages).
// Each test fills the real page in a DOM that talks to the REAL Worker, makes it go wrong (a busy server, the public test's "please try again later", a failed or closed Razorpay window),
// then reloads the page, and checks after every step that what was typed or chosen is still there. Before paying that is only the Game ID (the public test) and the country; after paying it is
// the optional invoice details. Nothing about a person (name, e-mail, mobile) is ever asked or kept before the payment.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { openPage, type Page } from "./harness";
import { KIT, type O, closeRazorpay, draftOnly, errText, failRazorpay, fillAll, fromCountry, linkOf, organizer, published, reply, snap, tabOf, type, val, watch } from "./pay-helpers";

setDefaultTimeout(60_000);
let open: Page[] = [];
/** the names of the draft slots that hold something */
const kept = (draft: string) => Object.entries(JSON.parse(draft) as Record<string, unknown>).filter(([, v]) => v !== "" && v != null).map(([k]) => k).sort();
afterEach(async () => { for (const p of open) await p.close(); open = []; });

describe("the public payment test (/paytest)", () => {
  const opn = async (o: O, session: Record<string, string> = {}, cc: string | undefined = "IN") => { const p = await openPage(o.world, { url: "http://localhost/paytest.html", html: "paytest.html", scripts: [...KIT, "paytest.js"], session, afterLoad: cc ? fromCountry(cc) : undefined }); open.push(p); return p; };

  test("no key, no sign-in: the page is open to everybody and asks only for an optional Game ID (and the country)", async () => {
    const o = await organizer(); const p = await opn(o);
    const txt = await p.waitFor((x) => /Test our payment/.test(x));
    for (const id of ["#okey", "#okeychk", "#okeyeye", "#nm", "#em", "#ph", "#pcode", "#org", "#tax"]) expect([id, p.$(id)]).toEqual([id, null]);
    expect(txt).toMatch(/Game ID/); expect(txt).toMatch(/optional/i); expect(txt).not.toMatch(/owner key|owner's key/i); expect(p.errors).toEqual([]);
    expect((p.$("#go") as any).disabled).toBe(false);
  });

  test("a busy server, 'please try again later', a failed and a closed Razorpay window, and a reload: the Game ID and the chosen country are still there", async () => {
    const o = await organizer(); const p = await opn(o); await p.waitFor((x) => /Test our payment/.test(x));
    p.click("#ctychange"); type(p, "#ctyq", "united st"); p.click('.pk-ctyopt[data-cty="US"]'); await p.waitFor((x) => /Paying from\s*United States/.test(x));
    type(p, "#gid", "ACME-DIWALI");
    const want = () => expect([val(p, "#gid"), p.text().match(/Paying from\s*([A-Za-z ]+?)\s*·/)?.[1]]).toEqual(["ACME-DIWALI", "United States"]);
    want();

    watch(p, [{ method: "POST", match: /\/api\/payments\/paytest$/, reply: reply(500, { error: "The payment service is busy." }) }]);
    p.click("#go"); await p.waitFor(() => /payment service is busy/.test(errText(p))); want(); expect((p.$("#go") as any).disabled).toBe(false);

    watch(p, [{ method: "POST", match: /\/api\/payments\/paytest$/, reply: reply(429, { error: "Please try again later." }) }]);
    p.click("#go"); await p.waitFor(() => errText(p) === "Please try again later."); want(); // plain words, nothing about limits or addresses
    expect(errText(p)).not.toMatch(/\b429\b|rate|limit|network address|ip\b/i);

    watch(p, [{ method: "POST", match: /\/api\/payments\/paytest$/, reply: reply(200, { mode: "razorpay", paymentId: "pay_0123456789abcdef", razorpay: { orderId: "order_stub" }, hop: "" }) }]);
    failRazorpay(p); p.click("#go"); await p.waitFor(() => /Razorpay could not start/.test(errText(p))); want();
    closeRazorpay(p); p.click("#go"); await p.waitFor(() => /payment window was closed/.test(errText(p))); want(); expect((p.$("#go") as any).disabled).toBe(false);

    const tab = tabOf(p); await p.close();
    const q = await opn(o, tab, "IN"); // the network still says India; the payer's own choice stands
    await q.waitFor((x) => /Paying from\s*United States/.test(x));
    expect(val(q, "#gid")).toBe("ACME-DIWALI");
    expect(JSON.parse(tab["cbz-paydraft-paytest"]!)).toMatchObject({ gameId: "ACME-DIWALI", pick: "US" });
    expect(kept(tab["cbz-paydraft-paytest"]!)).toEqual(["gameId", "pick"]); // only these two hold anything: no personal details, no key
    expect((q.win as any).__ctDirty()).toBe(true); // the automatic page update waits while a Game ID is typed
  });

  test("a Game ID typed wrongly is told so on the page, before any payment is opened, and is kept", async () => {
    const o = await organizer(); const p = await opn(o); await p.waitFor((x) => /Test our payment/.test(x));
    const seen = watch(p); type(p, "#gid", "ab"); p.click("#go"); await p.waitFor(() => /game ID has 4 to 40/.test(errText(p)));
    expect(val(p, "#gid")).toBe("ab"); expect(seen.some((s) => /payments\/paytest$/.test(s) && s.startsWith("POST"))).toBe(false);
    expect((o.world.raw.prepare("SELECT COUNT(*) c FROM payment").get() as any).c).toBe(0);
  });
});

describe("the payment-link page (/paylink)", () => {
  const opn = async (o: O, t: string, session: Record<string, string> = {}, cc: string | undefined = "IN") => {
    const p = await openPage(o.world, { url: "http://localhost/paylink.html" + (t ? "?t=" + t : ""), html: "paylink.html", scripts: [...KIT, "paylink.js"], session, afterLoad: cc ? fromCountry(cc) : undefined }); open.push(p); return p;
  };

  test("information first (game, ID, people, date, organizer, price) and no personal box before the payment; a failed call and a failed or closed Razorpay window keep the chosen country, and so does a reload", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await published(o, "PG-PERSIST1", "Diwali Night"); const t = await linkOf(o, "PG-PERSIST1");
    const p = await opn(o, t, {}, "DE"); const txt = await p.waitFor((x) => /Diwali Night/.test(x));
    expect(txt).toMatch(/PG-PERSIST1/); expect(txt).toMatch(/Order summary/); expect(txt).not.toMatch(/Your details/); expect(txt).not.toMatch(/coupon|discount|reduced/i);
    for (const id of ["#nm", "#em", "#ph", "#pcode", "#org", "#tax"]) expect([id, p.$(id)]).toEqual([id, null]);
    p.click("#ctychange"); type(p, "#ctyq", "india"); p.click('.pk-ctyopt[data-cty="IN"]'); await p.waitFor((x) => /Paying from\s*India/.test(x) && /Pay ₹/.test(x)); // the payer's own choice beats the network (Germany)

    watch(p, [{ method: "POST", match: /\/checkout$/, reply: reply(500, { error: "The payment service is busy." }) }]);
    p.click("#paygo"); await p.waitFor((x) => /payment service is busy/.test(x)); expect((p.$("#paygo") as any).disabled).toBe(false);
    watch(p, [{ method: "POST", match: /\/checkout$/, reply: reply(200, { mode: "razorpay", razorpay: { orderId: "order_stub" }, paymentId: "pay_0123456789abcdef", hop: "" }) }]);
    failRazorpay(p); p.click("#paygo"); await p.waitFor((x) => /Razorpay could not start/.test(x));
    closeRazorpay(p); p.click("#paygo"); await p.waitFor((x) => /payment window was closed/.test(x));
    expect(p.text()).toMatch(/Paying from\s*India/);

    const tab = tabOf(p); expect(p.win.location.search).toBe(""); await p.close(); // the link's secret is kept for this tab only, the address has none
    const q = await opn(o, "", tab, "DE"); const again = await q.waitFor((x) => /Diwali Night/.test(x));
    expect(again).toMatch(/Paying from\s*India/); expect(again).toMatch(/Pay ₹/);
    expect(kept(tab["cbz-paydraft-paylink"]!)).toEqual(["pick"]); // before paying only the country is kept (the typed-details slots are empty)
  });

  test("after the payment the draft holds the payment, not the order; typed invoice details survive a reload; a finished invoice leaves nothing to type", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await published(o, "PG-PERSIST2", "Paid Night"); const t = await linkOf(o, "PG-PERSIST2");
    const p = await opn(o, t); await p.waitFor((x) => /Paid Night/.test(x));
    p.click("#paygo"); await p.waitFor((x) => /Payment received/.test(x), 20_000);
    const paid = JSON.parse(tabOf(p)["cbz-paydraft-paylink"]!); expect(paid.paid).toMatch(/^pay_[0-9a-f]{16}$/);
    fillAll(p, { "#nm": "Fiona Finance", "#org": "Acme Ltd", "#tax": "27AAPFU0939F1ZV" });
    const tab = tabOf(p); await p.close();
    const q = await opn(o, "", tab); await q.waitFor((x) => /Add to your invoice/.test(x));
    expect(snap(q, ["#nm", "#org", "#tax"])).toEqual({ "#nm": "Fiona Finance", "#org": "Acme Ltd", "#tax": "27AAPFU0939F1ZV" });
    expect((q.win as any).__ctDirty()).toBe(true);
    q.click("#invadd"); await q.waitFor((x) => /Your invoice/.test(x));
    expect((q.win as any).__ctDirty()).toBe(false); // nothing half done any more
    expect((await o.json(await o.api("GET", `/api/paylink/${t}`))).status).toBe("paid");
  });
});

describe("the payment page in the console (/pay)", () => {
  const opn = async (o: O, eid: string, session: Record<string, string> = {}, cc: string | undefined = "IN") => {
    const p = await openPage(o.world, { url: `http://localhost/pay.html?e=${eid}`, html: "pay.html", scripts: [...KIT, "pay.js"], session: { "cbz-org": o.token, "cbz-email": "boss@acme.com", ...session }, afterLoad: cc ? fromCountry(cc) : undefined }); open.push(p); return p;
  };
  test("a failed payment call and a closed Razorpay window keep the chosen country, a reload too; after paying the details form is the only thing to fill", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await draftOnly(o, "PG-PERSIST3", "Console Night");
    const p = await opn(o, "PG-PERSIST3"); await p.waitFor((x) => !!p.$("#paygo"));
    for (const id of ["#nm", "#em", "#ph", "#pcode", "#org", "#tax"]) expect([id, p.$(id)]).toEqual([id, null]);
    p.click("#ctychange"); type(p, "#ctyq", "germany"); p.click('.pk-ctyopt[data-cty="DE"]'); await p.waitFor((x) => /Paying from\s*Germany/.test(x) && /US\$/.test(x));
    watch(p, [{ method: "POST", match: /\/api\/checkout$/, reply: reply(500, { error: "The payment service is busy." }) }]);
    p.click("#paygo"); await p.waitFor((x) => /payment service is busy/.test(x));
    watch(p, [{ method: "POST", match: /\/api\/checkout$/, reply: reply(200, { mode: "razorpay", razorpay: { orderId: "order_stub" }, paymentId: "pay_0123456789abcdef", hop: "" }) }]);
    closeRazorpay(p); p.click("#paygo"); await p.waitFor((x) => /payment window was closed/.test(x));
    const tab = tabOf(p); await p.close();
    const q = await opn(o, "PG-PERSIST3", tab); await q.waitFor((x) => !!q.$("#paygo"));
    expect(q.text()).toMatch(/Paying from\s*Germany/); expect(q.text()).toMatch(/US\$/);
    q.click("#paygo"); await q.waitFor((x) => /Payment received/.test(x), 20_000);
    expect(q.$("#invskip")).not.toBeNull(); expect(q.$("#nm")).not.toBeNull();
  });
});
