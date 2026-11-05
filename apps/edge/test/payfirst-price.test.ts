// "Razorpay first" (country only before paying, details after) on a game that has the owner's private price (price-adjust.ts): the order is for the amount payable, the tax invoice that follows
// Add / Skip (or the 15 minutes) has the ONE line with that amount, the owner's mail keeps the full picture, and nothing the payer's browser receives mentions how the price came about.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { INVOICE_AFTER_MS } from "../src/payfirst";
import { issueDueInvoices } from "../src/pay";
import { lazyTickReset } from "../src/worker";
import { PLAT, T, W, call, capture, create, j, one, organizer, publish, q, reset, restore, uid, verify } from "./param-harness";

const adj = (body: unknown) => call("POST", "/api/owner/price", body, PLAT);
const SECRET_WORDS = /coupon|discount|promo|agreed on phone|owner_adjust|list_minor|adjust_minor|owner set price/i;
const RZ = { email: "payer.real@razorpay-given.in", contact: "+919876543210", method: "upi", vpa: "ab@okhdfc" };
let sentOrders: any[];
beforeEach(() => {
  reset({ RAZORPAY_INTERNATIONAL: "1" }); lazyTickReset(); sentOrders = [];
  const inner = globalThis.fetch; (globalThis as any).fetch = async (url: string, init?: any) => { if (String(url).includes("/orders")) sentOrders.push(JSON.parse(init.body)); return inner(url, init); };
});
afterEach(restore);

async function unpaid(cap = 100) { const o = await organizer(), id = uid("FP"); expect((await create(o.key, id, { cap })).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200); return { ...o, id }; }
async function order(g: { id: string; h: Record<string, string> }, country: string) { const r = await call("POST", "/api/checkout", { eid: g.id, country }, g.h); return { status: r.status, body: await j(r) }; }
async function pay(c: any, id = "pay_fp1", now = T) { capture(c, id, { currency: c.razorpay.currency, ...RZ }); const r = await verify(c, id, {}, now); return { status: r.status, body: await j(r) }; }
const skip = async (pid: string) => { const r = await call("POST", `/api/payments/${pid}/invoice`, { skip: true }); return { status: r.status, body: await j(r) }; };
const invoiceData = (pid: string) => JSON.parse(one("SELECT data FROM invoice WHERE payment_id=?", pid).data);

describe("paid first on a game with the owner's price", () => {
  test("the order is for the amount payable; the invoice after Skip has ONE line with it; the owner's mail has the full picture; the payer's browser reads nothing about the price", async () => {
    const g = await unpaid(100);
    expect((await adj({ eid: g.id, currency: "INR", direction: "down", amount: 400, reason: "agreed on phone 2 Nov" })).status).toBe(200);
    const c = await order(g, "IN"); expect(c.status).toBe(200);
    expect(c.body.razorpay.amount).toBe(199900); expect(sentOrders.at(-1).amount).toBe(199900);
    expect(sentOrders.at(-1).notes).toMatchObject({ list_minor: "239900", adjust_minor: "-40000", net_minor: "199900", game_id: g.id });
    expect(JSON.stringify(sentOrders.at(-1))).not.toContain("agreed on phone"); // the owner's own note never leaves this site
    expect(JSON.stringify(c.body)).not.toMatch(SECRET_WORDS);
    const pid = c.body.paymentId as string;
    const p = await pay(c.body); expect(p.status).toBe(200); expect(p.body).toMatchObject({ ok: true, invoicePending: true });
    expect(JSON.stringify(p.body)).not.toMatch(SECRET_WORDS);
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
    expect(one("SELECT status, amount FROM payment WHERE id=?", pid)).toMatchObject({ status: "paid", amount: 1999 });
    // the owner's mail at the capture keeps the full picture
    const owner = q("SELECT body, subject FROM outbox WHERE subject LIKE '%Paid order%'").map((m) => m.subject + "\n" + m.body).join("\n");
    expect(owner).toMatch(/owner set price: list Rs 2,399, adjustment minus Rs 400/);
    // Skip: ONE line, only the amount actually charged; nothing about how the price came about
    const s = await skip(pid); expect(s.status, JSON.stringify(s.body)).toBe(200); expect(s.body.invoiceUrl).toMatch(/^\/api\/invoice\//);
    expect(JSON.stringify(s.body)).not.toMatch(SECRET_WORDS);
    const inv = invoiceData(pid);
    expect(inv.lines).toEqual([{ description: "Corporate Tic Tac Toe: up to 100 participants (one game), price as agreed", quantity: 1, amount: 1999 }]);
    expect(inv.tax.total).toBe(1999);
    const html = await (await call("GET", s.body.invoiceUrl)).text(); expect(html).toContain("price as agreed"); expect(html).not.toMatch(/coupon|discount|2,399|2399/i);
    const orgMail = q("SELECT body, subject FROM outbox WHERE subject NOT LIKE '%Paid order%'").map((m) => m.subject + "\n" + m.body).join("\n");
    expect(orgMail).not.toMatch(/coupon|discount|promo|2,399|2399|owner set price/i);
    expect(one("SELECT seq FROM invoice WHERE payment_id=?", pid).seq).toBe(1); // invoice numbering is unchanged
  });

  test("a net Rs 1 game (the owner's live test): paid at the capture, and the invoice comes by itself 15 minutes later with the same single line", async () => {
    const g = await unpaid(100);
    await adj({ eid: g.id, currency: "INR", direction: "down", amount: 2398, reason: "Rs 1 live test" });
    const c = await order(g, "IN"); expect(c.body.razorpay.amount).toBe(100);
    const pid = c.body.paymentId as string; const p = await pay(c.body); expect(p.status).toBe(200);
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
    expect(q("SELECT 1 FROM invoice WHERE payment_id=?", pid).length).toBe(0); // nothing yet: the payer may still add details
    expect(await issueDueInvoices(W.env, T + INVOICE_AFTER_MS)).toBe(1);
    const inv = invoiceData(pid);
    expect(inv.lines).toEqual([{ description: "Corporate Tic Tac Toe: up to 100 participants (one game), price as agreed", quantity: 1, amount: 1 }]);
  });

  test("a price set in rupees is not applied to a payer in another country (US dollars at the list price); a game with no price is untouched", async () => {
    const g = await unpaid(100);
    await adj({ eid: g.id, currency: "INR", direction: "down", amount: 400, reason: "agreed on phone" });
    const de = await order(g, "DE"); expect(de.status).toBe(200);
    expect(de.body.razorpay).toMatchObject({ currency: "USD", amount: 3400 });
    expect(sentOrders.at(-1).notes.list_minor).toBeUndefined();
    const plain = await unpaid(100); const c = await order(plain, "IN");
    expect(c.body.razorpay.amount).toBe(239900); expect(sentOrders.at(-1).notes.list_minor).toBeUndefined();
    const pid = c.body.paymentId as string; await pay(c.body, "pay_fp2");
    await skip(pid);
    expect(invoiceData(pid).lines[0].description).toBe("Corporate Tic Tac Toe: up to 100 participants (one game)"); // the ordinary line
  });
});
