// The owner's private price for ONE game id (price-adjust.ts): owner key only, only while unpaid, net between 1 and twice the list price, the list price never changes,
// the checkout / pay link / invoice / owner mail / order notes follow it, the organizer is told nothing but the amount payable, and a game with a Rs 1 net goes from payment pending to paid.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPayLink } from "../src/paylink";
import { lazyTickReset } from "../src/worker";
import { PLAT, T, W, call, capture, checkout, create, j, keyH, one, organizer, publish, q, reset, restore, uid, verify } from "./param-harness";

const adj = (body: unknown, h: Record<string, string> = PLAT) => call("POST", "/api/owner/price", body, h);
const unpaidGame = async (cap = 100) => { const o = await organizer(), id = uid("CP"); expect((await create(o.key, id, { cap })).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200); return { ...o, id }; };
let sentOrders: any[];
const hook = () => { const inner = globalThis.fetch; (globalThis as any).fetch = async (url: string, init?: any) => { if (String(url).includes("/orders")) sentOrders.push(JSON.parse(init.body)); return inner(url, init); }; };
beforeEach(() => { reset(); lazyTickReset(); sentOrders = []; hook(); });
afterEach(restore);
const SECRET_WORDS = /coupon|discount|promo|agreed on phone|owner_adjust|list_minor|adjust_minor/i;

describe("owner price: who may use it", () => {
  test("without the owner key, through an AI work link, or with an organizer key every owner route gives the same 404", async () => {
    const g = await unpaidGame();
    for (const h of [{}, { "x-organizer": "wrong" }, keyH(g.key), { ...PLAT, "x-cb-link": "1" }, g.aiH]) {
      expect((await adj({ eid: g.id, currency: "INR", amount: -100, reason: "agreed on phone" }, h as any)).status).toBe(404);
      expect((await call("GET", `/api/owner/price?eid=${g.id}`, undefined, h as any)).status).toBe(404);
      expect((await call("GET", "/api/owner/panel", undefined, h as any)).status).toBe(404);
      expect((await call("GET", `/api/owner/panel?q=${g.id}`, undefined, h as any)).status).toBe(404);
    }
    expect(q("SELECT * FROM price_adjust")).toEqual([]);
  });
});

describe("owner price: setting it", () => {
  test("lookup shows pack, list prices, status; a set price is shown with its note and audited (who, when, old, new, reason)", async () => {
    const g = await unpaidGame(100);
    const a = await j(await call("GET", `/api/owner/price?eid=${g.id}`, undefined, PLAT));
    expect(a).toMatchObject({ eid: g.id, status: "published, not paid", pack: 100, editable: true, adjustment: null, list: { INR: 2399, USD: 34 } });
    expect((await adj({ eid: g.id, currency: "INR", direction: "down", amount: 400, reason: "agreed on phone 2 Nov" })).status).toBe(200);
    const b = await j(await call("GET", `/api/owner/price?eid=${g.id}`, undefined, PLAT));
    expect(b.adjustment).toMatchObject({ currency: "INR", amount: -400, net: 1999, reason: "agreed on phone 2 Nov", applies: true });
    await adj({ eid: g.id, currency: "INR", direction: "up", amount: 150, reason: "added a logo" });
    const au = q("SELECT action, old_adjust_minor, new_adjust_minor, net_minor, list_minor, reason, actor FROM price_adjust_audit WHERE eid=? ORDER BY id", g.id);
    expect(au).toEqual([{ action: "set", old_adjust_minor: null, new_adjust_minor: -40000, net_minor: 199900, list_minor: 239900, reason: "agreed on phone 2 Nov", actor: "owner" }, { action: "change", old_adjust_minor: -40000, new_adjust_minor: 15000, net_minor: 254900, list_minor: 239900, reason: "added a logo", actor: "owner" }]);
  });
  test("the panel (the owner's form, sent as data) has the find box, the facts, the fields, the Remove button and the history", async () => {
    const g = await unpaidGame(100);
    const find = await j(await call("GET", "/api/owner/panel", undefined, PLAT));
    expect(find.form).toMatchObject({ method: "GET", path: "/api/owner/panel", submit: "Find game" });
    await adj({ eid: g.id, currency: "INR", direction: "down", amount: 400, reason: "agreed on phone 2 Nov" });
    const v = await j(await call("GET", `/api/owner/panel?q=${g.id}`, undefined, PLAT));
    expect(v.facts).toContainEqual(["List price", "Rs 2,399 / US$ 34"]); expect(v.facts).toContainEqual(["Status", "published, not paid"]); expect(v.facts).toContainEqual(["Organizer pays", "Rs 1,999"]);
    expect(v.form.fields.map((f: any) => f.id)).toEqual(["currency", "direction", "amount", "reason"]);
    expect(v.form.fills.map((f: any) => f.set.amount)).toEqual(["2398", "33"]); // "Make it 1" for rupees and for dollars
    expect(v.buttons[0]).toMatchObject({ label: "Remove", body: { eid: g.id, remove: true } });
    expect(v.table.rows.length).toBe(1);
    const paid = await paidGame(); const pv = await j(await call("GET", `/api/owner/panel?q=${paid.id}`, undefined, PLAT));
    expect(pv.form).toBeUndefined(); expect(pv.buttons).toBeUndefined(); expect(pv.text.join(" ")).toMatch(/locked/);
    expect((await call("GET", "/api/owner/panel?q=NO-SUCH", undefined, PLAT)).status).toBe(404);
  });
  test("the net can never go below Rs 1 (US$ 1) or above twice the list price; zero, a missing note and an unknown game are refused", async () => {
    const g = await unpaidGame(100);
    expect((await adj({ eid: g.id, currency: "INR", amount: -2399, reason: "free" })).status).toBe(400); // net 0
    expect((await adj({ eid: g.id, currency: "INR", amount: -2398.5, reason: "too low" })).status).toBe(400); // net 0.5
    expect((await adj({ eid: g.id, currency: "INR", amount: -2398, reason: "payment test" })).status).toBe(200); // net exactly Rs 1
    expect((await adj({ eid: g.id, currency: "INR", amount: 2399, reason: "double" })).status).toBe(200); // exactly twice
    expect((await adj({ eid: g.id, currency: "INR", amount: 2400, reason: "typo" })).status).toBe(400);
    expect((await adj({ eid: g.id, currency: "USD", direction: "down", amount: 34, reason: "free" })).status).toBe(400);
    expect((await adj({ eid: g.id, currency: "USD", direction: "down", amount: 33, reason: "dollar test" })).status).toBe(200);
    expect((await adj({ eid: g.id, currency: "INR", amount: 0, reason: "nothing" })).status).toBe(400);
    expect((await adj({ eid: g.id, currency: "INR", amount: -10, reason: "" })).status).toBe(400);
    expect((await adj({ eid: g.id, currency: "INR", amount: "abc", reason: "bad" })).status).toBe(400);
    expect((await adj({ eid: "NO-SUCH-GAME", currency: "INR", amount: -10, reason: "none" })).status).toBe(404);
  });
});

describe("owner price: checkout", () => {
  test("the organizer's checkout for THAT game charges the net, the notes carry list, adjustment and net, and other games keep the list price", async () => {
    const g = await unpaidGame(100), other = await unpaidGame(100);
    await adj({ eid: g.id, currency: "INR", amount: -400, reason: "agreed on phone" });
    const c = await checkout(g.key, { eid: g.id, email: g.email }); expect(c.status).toBe(200);
    expect(c.body.razorpay.amount).toBe(199900);
    expect(sentOrders.at(-1).amount).toBe(199900);
    expect(sentOrders.at(-1).notes).toMatchObject({ list_minor: "239900", adjust_minor: "-40000", net_minor: "199900", adjust_code: "owner_adjust", pack: "100", plan: "tictactoe_pack_100" });
    expect(JSON.stringify(sentOrders.at(-1))).not.toContain("agreed on phone"); // the owner's own note never leaves this site
    expect(JSON.stringify(c.body)).not.toMatch(SECRET_WORDS); // nothing in the answer to the organizer's browser
    expect(one("SELECT amount, product_ref FROM payment WHERE id=?", c.body.paymentId)).toMatchObject({ amount: 1999, product_ref: "pack_100" });
    expect(JSON.parse(one("SELECT meta FROM payment WHERE id=?", c.body.paymentId).meta).priceAdjust).toEqual({ listMinor: 239900, adjustMinor: -40000, netMinor: 199900, code: "owner_adjust" });
    const c2 = await checkout(other.key, { eid: other.id, email: other.email }); expect(c2.body.razorpay.amount).toBe(239900);
    expect(sentOrders.at(-1).notes.list_minor).toBeUndefined();
    const bare = await checkout(g.key, { pack: 100, email: g.email }); expect(bare.body.razorpay.amount).toBe(239900); // a bare pack is never touched
  });
  test("a price set in dollars is not applied to a rupee checkout; a removed price applies nothing", async () => {
    const g = await unpaidGame(100);
    await adj({ eid: g.id, currency: "USD", amount: -10, reason: "abroad" });
    expect((await checkout(g.key, { eid: g.id, email: g.email })).body.razorpay.amount).toBe(239900);
    await adj({ eid: g.id, currency: "INR", amount: -399, reason: "rupees" });
    expect((await checkout(g.key, { eid: g.id, email: g.email })).body.razorpay.amount).toBe(200000);
    const rm = await j(await adj({ eid: g.id, remove: true })); expect(rm.removed).toBe(true); expect(rm.next).toBe(`/api/owner/panel?q=${g.id}`);
    expect((await checkout(g.key, { eid: g.id, email: g.email })).body.razorpay.amount).toBe(239900);
    expect(q("SELECT action FROM price_adjust_audit WHERE eid=? ORDER BY id", g.id).map((r) => r.action)).toEqual(["set", "change", "remove"]);
  });
  test("the pay link, the game info and the proforma show ONE total (the net): no list price, no extra field, no secret word", async () => {
    const g = await unpaidGame(100);
    await adj({ eid: g.id, currency: "INR", amount: -400, reason: "agreed on phone" });
    const { token } = await createPayLink(W.env.DB, g.id, one("SELECT org FROM engagement WHERE id=?", g.id).org, "organizer", T);
    const plText = await (await call("GET", `/api/paylink/${token}`)).text(), pl = JSON.parse(plText);
    expect(pl.price.total).toBe(1999); expect(Object.keys(pl).sort()).toEqual(["game", "price", "status"]);
    const pc = await call("POST", `/api/paylink/${token}/checkout`, { email: "fin@acme.com", name: "Fin Person", pack: 100, currency: "INR" });
    expect((await j(pc)).razorpay.amount).toBe(199900);
    const infoText = await (await call("GET", `/api/z/${g.id}/info`, undefined, g.h)).text(), info = JSON.parse(infoText);
    expect(info.payable).toEqual({ currency: "INR", amount: 1999 });
    const pfText = await (await call("POST", "/api/proforma", { eid: g.id, currency: "INR", email: "a@b.co", name: "Asha" }, g.h)).text(), pf = JSON.parse(pfText);
    expect(pf.total).toBe(1999); expect(pf.html).toContain("price as agreed");
    for (const t of [plText, infoText, pfText]) { expect(t).not.toMatch(SECRET_WORDS); expect(t).not.toMatch(/2399|2,399/); }
  });
});

describe("owner price: only the owner's panel can set it", () => {
  test("nothing an organizer or player can type or send changes the price: no extra field, code or link works, and a game the owner did not set stays at the list price", async () => {
    const g = await unpaidGame(100);
    for (const extra of [{ coupon: "X" }, { code: "OWNER" }, { adjust: -500 }, { adjust_minor: -100000 }, { price: 1 }, { amount: 1 }, { promo: "Y" }, { net_minor: 100 }]) {
      const c = await checkout(g.key, { eid: g.id, email: g.email, ...extra }); expect(c.status).toBe(200);
      expect(c.body.razorpay.amount).toBe(239900); expect(sentOrders.at(-1).notes.list_minor).toBeUndefined();
    }
    expect(q("SELECT * FROM price_adjust")).toEqual([]);
    await adj({ eid: g.id, currency: "INR", amount: -400, reason: "agreed on phone" }); // the owner sets it for this exact game id
    const other = await unpaidGame(100); expect((await checkout(other.key, { eid: other.id, email: other.email })).body.razorpay.amount).toBe(239900); // another game id: unaffected
    expect((await checkout(g.key, { eid: g.id, email: g.email })).body.razorpay.amount).toBe(199900);
    await adj({ eid: g.id, remove: true }); // removing it restores the normal price
    expect((await checkout(g.key, { eid: g.id, email: g.email })).body.razorpay.amount).toBe(239900);
  });
});

describe("owner price: pending to paid at Rs 1", () => {
  test("through the Razorpay stand-in: a net Rs 1 order is paid and the game goes from not paid to paid; the organizer's invoice has one line, the owner's mail the full picture", async () => {
    const g = await unpaidGame(100);
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(0);
    await adj({ eid: g.id, currency: "INR", amount: -2398, reason: "Rs 1 live test" });
    const c = await checkout(g.key, { eid: g.id, email: g.email }); expect(c.body.razorpay.amount).toBe(100);
    capture(c.body, "pay_cp1"); const v = await verify(c.body, "pay_cp1"); expect(v.status).toBe(200);
    const res = await j(v); expect(res).toMatchObject({ ok: true, pack: 100, total: 1, published: true });
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
    expect(one("SELECT status, amount FROM payment WHERE id=?", c.body.paymentId)).toMatchObject({ status: "paid", amount: 1 });
    const inv = JSON.parse(one("SELECT data FROM invoice WHERE payment_id=?", c.body.paymentId).data);
    expect(inv.lines).toEqual([{ description: "Corporate Tic Tac Toe: up to 100 participants (one game), price as agreed", quantity: 1, amount: 1 }]); // one line, only the amount actually charged
    expect(inv.tax.total).toBe(1);
    const html = await (await call("GET", res.invoiceUrl)).text(); expect(html).toContain("price as agreed"); expect(html).not.toMatch(/coupon|discount|2,399|2399/i);
    expect(JSON.stringify(res)).not.toMatch(SECRET_WORDS);
    const owner = q("SELECT body, subject FROM outbox WHERE subject LIKE '%Paid order%'").map((m) => m.subject + "\n" + m.body).join("\n");
    expect(owner).toMatch(/owner set price: list Rs 2,399, adjustment minus Rs 2,398/); // the owner's own paid-order mail keeps the full picture
    const orgMail = q("SELECT body, subject FROM outbox WHERE subject NOT LIKE '%Paid order%'").map((m) => m.subject + "\n" + m.body).join("\n");
    expect(orgMail).toContain("price as agreed"); expect(orgMail).not.toMatch(/coupon|discount|promo|2,399|2399/i); // the organizer's mails say nothing else
    expect(one("SELECT seq FROM invoice WHERE payment_id=?", c.body.paymentId).seq).toBe(1); // invoice numbering is unchanged
  });
  test("through TEST_MODE (no gateway): the Rs 1 checkout is paid at once and the game is paid", async () => {
    reset({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, RAZORPAY_WEBHOOK_SECRET: undefined, TEST_MODE: "1" });
    const g = await unpaidGame(100);
    await adj({ eid: g.id, currency: "INR", amount: -2398, reason: "Rs 1 test" });
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(0);
    const c = await checkout(g.key, { eid: g.id, email: g.email }); expect(c.status).toBe(200);
    expect(c.body.mode).toBe("test"); expect(c.body.result).toMatchObject({ ok: true, total: 1, pack: 100, published: true });
    expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
    expect(one("SELECT amount, status FROM payment WHERE id=?", c.body.paymentId)).toMatchObject({ amount: 1, status: "paid" });
  });
  test("the webhook finishes the same Rs 1 order when the buyer closed the tab", async () => {
    const g = await unpaidGame(100);
    await adj({ eid: g.id, currency: "INR", amount: -2398, reason: "Rs 1 test" });
    const c = await checkout(g.key, { eid: g.id, email: g.email });
    const raw = JSON.stringify({ event: "payment.captured", created_at: 1, payload: { payment: { entity: { id: "pay_wh", order_id: c.body.razorpay.orderId, amount: 100, status: "captured", currency: "INR" } } } });
    const r = await call("POST", "/api/payments/webhook", raw, { "x-razorpay-signature": createHmac("sha256", "whsec").update(raw).digest("hex"), "x-razorpay-event-id": "evt_cp" });
    expect(r.status).toBe(200); expect(one("SELECT pack FROM engagement WHERE id=?", g.id).pack).toBe(100);
  });
});

describe("owner price: locked once paid", () => {
  test("after the game is paid a price can be neither set, changed nor removed, and the old one is not applied again", async () => {
    const g = await unpaidGame(100);
    await adj({ eid: g.id, currency: "INR", amount: -2398, reason: "Rs 1 test" });
    const c = await checkout(g.key, { eid: g.id, email: g.email }); capture(c.body, "pay_lock"); expect((await verify(c.body, "pay_lock")).status).toBe(200);
    for (const body of [{ eid: g.id, currency: "INR", amount: -100, reason: "late" }, { eid: g.id, remove: true }]) { const r = await adj(body); expect(r.status).toBe(409); expect((await j(r)).code).toBe("paid"); }
    expect(one("SELECT adjust_minor FROM price_adjust WHERE eid=?", g.id).adjust_minor).toBe(-239800); // untouched
    expect(await j(await call("GET", `/api/owner/price?eid=${g.id}`, undefined, PLAT))).toMatchObject({ status: "paid", editable: false });
  });
  test("a cancelled game and a game whose payment is being confirmed cannot take a price", async () => {
    const g = await unpaidGame(100);
    W.raw.prepare("UPDATE engagement SET cancelled_ms=? WHERE id=?").run(T, g.id);
    expect((await adj({ eid: g.id, currency: "INR", amount: -10, reason: "cancelled" })).status).toBe(409);
    const h = await unpaidGame(100); const c = await checkout(h.key, { eid: h.id, email: h.email }); expect(c.status).toBe(200);
    W.raw.prepare("UPDATE payment SET confirming_ms=? WHERE id=?").run(T, c.body.paymentId);
    const r = await adj({ eid: h.id, currency: "INR", amount: -10, reason: "mid payment" }); expect(r.status).toBe(409); expect((await j(r)).code).toBe("confirming");
  });
});

async function paidGame() { const g = await unpaidGame(100); const c = await checkout(g.key, { eid: g.id, email: g.email }); capture(c.body, "pay_" + g.id); expect((await verify(c.body, "pay_" + g.id)).status).toBe(200); return g; }
