// The game ID travels with a game's payment: Razorpay order notes (A), the central ledger order (B) and this game's own payment meta (C) all carry it,
// and the invoice and the mails print it as "Game ID". A bare pack purchase has none. Nothing about it reveals the owner's private price.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lazyTickReset } from "../src/worker";
import { call, capture, checkout, create, j, one, organizer, publish, q, reset, restore, uid, verify } from "./param-harness";

let sentOrders: any[], centralOrders: any[];
const hook = () => {
  const inner = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u === "https://central.test/api/pay/order") { const b = JSON.parse(init.body); centralOrders.push(b); return new Response(JSON.stringify({ ok: true, orderId: "order_c" + centralOrders.length }), { status: 200 }); }
    if (u.includes("/orders")) sentOrders.push(JSON.parse(init.body));
    return inner(url, init);
  };
};
beforeEach(() => { reset(); lazyTickReset(); sentOrders = []; centralOrders = []; hook(); });
afterEach(restore);
const game = async (cap = 100) => { const o = await organizer(), id = uid("GI"); expect((await create(o.key, id, { cap })).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200); return { ...o, id }; };

describe("game ID with the payment", () => {
  test("the Razorpay order notes and this game's payment record carry the game ID; a bare pack purchase has none", async () => {
    const g = await game();
    const c = await checkout(g.key, { eid: g.id, email: g.email }); expect(c.status).toBe(200);
    expect(sentOrders.at(-1).notes.game_id).toBe(g.id);
    expect(JSON.parse(one("SELECT meta FROM payment WHERE id=?", c.body.paymentId).meta).gameId).toBe(g.id);
    const bare = await checkout(g.key, { pack: 100, email: g.email }); expect(bare.status).toBe(200);
    expect(sentOrders.at(-1).notes.game_id).toBeUndefined();
    expect(JSON.parse(one("SELECT meta FROM payment WHERE id=?", bare.body.paymentId).meta).gameId).toBeUndefined();
  });
  test("through the central service the order carries game_id (and the notes do not repeat it)", async () => {
    reset({ PAY_SERVICE_KEY: "site-key", PAY_SERVICE_URL: "https://central.test" }); sentOrders = []; centralOrders = []; hook();
    const g = await game();
    const c = await checkout(g.key, { eid: g.id, email: g.email }); expect(c.status).toBe(200);
    expect(centralOrders.at(-1).game_id).toBe(g.id);
    const bare = await checkout(g.key, { pack: 100, email: g.email }); expect(bare.status).toBe(200);
    expect(centralOrders.at(-1).game_id).toBeUndefined();
  });
  test("the invoice, the organizer's mail and the owner's paid-order mail print the Game ID", async () => {
    const g = await game();
    const c = await checkout(g.key, { eid: g.id, email: g.email }); capture(c.body, "pay_gi1");
    const res = await j(await verify(c.body, "pay_gi1")); expect(res.ok).toBe(true);
    const inv = await (await call("GET", res.invoiceUrl)).text();
    expect(inv).toContain("Game ID"); expect(inv).toContain(g.id);
    const mails = q("SELECT subject, body FROM outbox").map((m) => m.subject + "\n" + m.body).join("\n");
    expect(mails).toContain(`Game ID: ${g.id}`);
    const owner = q("SELECT body FROM outbox WHERE subject LIKE '%Paid order%'").map((m) => m.body).join("\n");
    expect(owner).toContain(`Game ID: ${g.id}`);
  });
  test("a game with the owner's private price: still just the game ID, and no new words anywhere an organizer can see", async () => {
    const g = await game();
    expect((await call("POST", "/api/owner/price", { eid: g.id, currency: "INR", amount: -2398, reason: "Rs 1 live test" }, { "x-organizer": "plat" })).status).toBe(200);
    const c = await checkout(g.key, { eid: g.id, email: g.email }); expect(c.body.razorpay.amount).toBe(100);
    expect(sentOrders.at(-1).notes.game_id).toBe(g.id);
    capture(c.body, "pay_gi2"); const res = await j(await verify(c.body, "pay_gi2"));
    const inv = await (await call("GET", res.invoiceUrl)).text();
    expect(inv).toContain(g.id); expect(inv).not.toMatch(/coupon|discount|promo/i);
  });
});
