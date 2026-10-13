// R-scenarios: a cancelled PAID game can be moved to a new date for 30 days after the cancel (product rule 2026-10-09). The payment stays with the game; unused credit lapses 365 days after the payment; no refunds.
import { sc, HOUR, DAY, sql } from "./lib.mjs";
import { startRoundIn } from "../../lib/api.mjs";

const eng = async (eid) => (await sql("SELECT cancelled_ms, start_round FROM engagement WHERE id=?", [eid]))[0];
const move = async (org, eid, leadMs) => org.api("POST", `/api/z/${eid}/reopen`, { startRound: await startRoundIn(leadMs) });

sc("RO01", "paid game cancelled, then moved inside 30 days: live again, one payment, no credit left, guests can join", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  w.eq("cancel ok", (await org.cancel(g.id)).status, 200);
  await w.at((await w.now()) + 10 * DAY);
  const r = await move(org, g.id, 3 * DAY); w.expect("moved", r.status === 200 && r.body.reopened === true, JSON.stringify(r.body));
  w.eq("not cancelled", (await eng(g.id)).cancelled_ms, null);
  const credits = await w.creditRows(await w.orgIdOf(g.id)); w.expect("no spendable credit", credits.every((c) => c.status === "revived" && c.remaining_inr === 0), JSON.stringify(credits));
  w.eq("still one paid payment", (await sql("SELECT COUNT(*) AS c FROM payment WHERE status='paid'"))[0].c >= 1, true);
});
sc("RO02", "after 30 days the move is refused (409 window-closed) and the credit stays usable", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  await org.cancel(g.id); await w.at((await w.now()) + 31 * DAY);
  const r = await move(org, g.id, 3 * DAY); w.expect("refused", r.status === 409 && r.body.code === "window-closed", JSON.stringify(r.body));
  w.expect("still cancelled", (await eng(g.id)).cancelled_ms != null); const c = await w.creditRows(await w.orgIdOf(g.id)); w.expect("credit still active", c[0].status === "active" && c[0].remaining_inr > 0, JSON.stringify(c));
});
sc("RO03", "credit used for another game first: the move is refused and nothing is returned", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true }); await org.cancel(g.id);
  const g2 = await w.game(org, { leadMs: 4 * DAY }); const p = await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); w.expect("credit paid game 2", p.status === 200 && p.body.paid === true, JSON.stringify(p.body));
  const r = await move(org, g.id, 3 * DAY); w.expect("refused", r.status === 409 && r.body.code === "credit-gone", JSON.stringify(r.body));
  w.expect("still cancelled", (await eng(g.id)).cancelled_ms != null);
});
sc("RO04", "an unpaid cancelled game cannot be moved", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR }); await org.cancel(g.id);
  const r = await move(org, g.id, 3 * DAY); w.expect("refused (unpaid)", r.status === 409 && r.body.code === "unpaid", JSON.stringify(r.body));
});
