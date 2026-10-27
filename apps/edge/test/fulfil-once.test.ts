// The browser's verify call and the payment provider's webhook can arrive together: the payment is finished once (one invoice, one set of mails), and both callers get the same answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HOUR, T, call, capture, checkout, create, j, organizer, publish, reset, restore, roundAt, uid, verify, W } from "./param-harness";
beforeEach(() => reset()); afterEach(restore);
const T2 = Date.UTC(2026, 9, 24, 10, 0, 0);
describe("a payment is completed exactly once", () => {
  test("two verify calls at the same moment: one invoice, one receipt mail, the same answer", async () => {
    const o = await organizer(); const id = uid("FO");
    expect((await create(o.key, id, { startRound: roundAt(T2 + 2 * HOUR), cap: 100 }, T2)).status).toBe(200);
    expect((await publish(o.key, id, undefined, T2)).status).toBe(200);
    const c = await checkout(o.key, { eid: id, email: o.email }, T2); expect(c.status).toBe(200); capture(c.body, "pay_" + id);
    const rs = await Promise.all([verify(c.body, "pay_" + id, {}, T2), verify(c.body, "pay_" + id, {}, T2), verify(c.body, "pay_" + id, {}, T2)]);
    for (const r of rs) expect(r.status).toBe(200);
    const bodies = await Promise.all(rs.map((r) => j(r))); expect(new Set(bodies.map((b) => b.invoiceNumber)).size).toBe(1);
    const raw = W.raw;
    { expect((raw.prepare("SELECT COUNT(*) c FROM invoice").get() as any).c).toBe(1); expect((raw.prepare("SELECT COUNT(*) c FROM outbox WHERE subject LIKE '%payment received%'").get() as any).c).toBe(1); }
  });
  test("a game that was paid for before it was published still keeps the organizer's confirmed e-mail, so the end-of-game report has an address", async () => {
    const o = await organizer(); const id = uid("FP");
    expect((await create(o.key, id, { startRound: roundAt(T2 + 2 * HOUR), cap: 100 }, T2)).status).toBe(200);
    const c = await checkout(o.key, { eid: id, email: o.email }, T2); expect(c.status).toBe(200); capture(c.body, "pay_" + id); expect((await verify(c.body, "pay_" + id, {}, T2)).status).toBe(200); // paid first: the payment published the game
    const pub = await publish(o.key, id, undefined, T2); expect(pub.status).toBe(200);
    const row = W.raw.prepare("SELECT v FROM kv WHERE k=?").get(`contact/${id}`) as any; expect(row).toBeTruthy(); expect(JSON.parse(row.v).email).toBeTruthy();
  });
});
