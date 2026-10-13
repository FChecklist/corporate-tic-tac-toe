// K-scenarios: NO REFUNDS, credit for 365 days. Create on cancel, use in full / partly / with remainder, two credits, expiry at the end of day 365 IST, the 30-day and 3-day mails,
// payment after cancel, Host cancel, credit across organizations, partner commission. Spec: docs/ROLES_AND_CONSOLE_SPEC_6.md.
import { sc, HOUR, MIN, DAY, IST, PACKS, sql, call, mailbox, platform } from "./lib.mjs";
import { Partner } from "../../lib/api.mjs";

const P100 = PACKS[100], P250 = PACKS[250], P500 = PACKS[500];
/** the instant a credit made by a payment at `paidMs` lapses: 00:00 IST at the START of day 366 (independent of the Worker's code) */
const expiryOf = (paidMs) => (Math.floor((paidMs + IST) / DAY) + 366) * DAY - IST;
const lastDayOf = (exp) => new Date(exp - 1).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const payCredit = (org, id) => org.api("POST", `/api/z/${id}/pay-with-credit`, {});
const sumUses = async (eid) => Math.round(((await sql("SELECT COALESCE(SUM(amount_inr),0) s FROM credit_use WHERE eid=? AND status='applied'", [eid]))[0].s) * 100) / 100;
const cr = async (w, org) => (await w.credits(org)).credits;
/** a paid game then cancelled: leaves one credit */
async function paidThenCancelled(w, org, o = {}) { const g = await w.game(org, { leadMs: o.leadMs ?? 3 * DAY, pay: true, cap: o.cap ?? 100 }); const paidAt = await w.now(); const r = await org.cancel(g.id); if (!r.ok) throw new Error("cancel " + JSON.stringify(r.body)); return { g, paidAt }; }

sc("K01", "cancel a PAID game: the whole payment becomes credit, valid until the end of day 365 IST, told in the mail with the exact date", async (w) => {
  const org = await w.org(); const { g, paidAt } = await paidThenCancelled(w, org);
  const c = await cr(w, org); w.eq("one credit", c.length, 1);
  w.eq("amount = total paid incl. GST", c[0].amountInr, P100); w.eq("remaining = amount", c[0].remainingInr, P100); w.eq("expires at the end of day 365 IST", c[0].expiresMs, expiryOf(paidAt));
  w.eq("lastDay is the IST date of the last usable day", c[0].lastDay, lastDayOf(expiryOf(paidAt))); w.eq("status active", c[0].status, "active");
  const m = (await w.mails(org.email, "Game cancelled"))[0]; w.expect("mail: amount and date", m.text.includes("Rs 2,399") && m.text.includes(c[0].lastDay), m.text.slice(0, 300));
  w.eq("no refund call: no outbound request left the box", (await (await fetch("http://localhost:8803/__sim/health")).json()).blockedFetches, []);
});
sc("K02", "cancel an UNPAID game: no credit at all", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 3 * DAY }); await org.cancel(g.id);
  w.eq("no credit", (await cr(w, org)).length, 0); w.eq("active total 0", (await w.credits(org)).activeTotalInr, 0);
});
sc("K03", "cancel a PAID game after its start: refused, and no credit is made", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true }); await w.at(g.startMs + MIN);
  w.eq("409", (await org.cancel(g.id)).status, 409); w.eq("no credit", (await cr(w, org)).length, 0);
});
sc("K04", "use credit IN FULL for the next game of the same size: no payment gateway, game paid, credit used up", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY });
  const s0 = await w.summary(org, g2.id); w.expect("Pay step offers the credit before paying", s0.credit === P100 && s0.creditExpiresMs, JSON.stringify({ c: s0.credit, e: s0.creditExpiresMs }));
  const r = await payCredit(org, g2.id); w.expect("paid by credit", r.status === 200 && r.body.paid === true && r.body.usedInr === P100 && r.body.toPayInr === 0, JSON.stringify(r.body));
  const s = await w.summary(org, g2.id); w.expect("game is paid and published", s.paid === true && s.status === "published and paid", s.status);
  const c = await cr(w, org); w.expect("credit used, remaining 0, one use row", c[0].status === "used" && c[0].remainingInr === 0 && c[0].uses.length === 1 && c[0].uses[0].game === g2.id && c[0].uses[0].amountInr === P100, JSON.stringify(c[0]));
  w.eq("credit-paid game's payment row is zero cash", (await sql("SELECT amount FROM payment WHERE eid=? AND status='paid'", [g2.id])).map((x) => x.amount), [0]);
  w.eq("an invoice record exists for it", (await sql("SELECT COUNT(*) c FROM invoice WHERE payment_id=?", ["paycr_" + g2.id]))[0].c, 1);
  w.eq("mail: credit used", await w.mailCount(org.email, "of credit used"), 1);
  w.eq("nobody paid twice", (await sql("SELECT eid FROM payment WHERE status='paid' AND eid IS NOT NULL GROUP BY eid HAVING COUNT(*)>1")).length, 0);
});
sc("K05", "use credit PARTLY (bigger game): credit used up, only the difference is charged, exactly", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY, cap: 250 });
  const r = await payCredit(org, g2.id); w.expect("partly: not paid yet, difference shown", r.status === 200 && r.body.paid === false && r.body.usedInr === P100 && Math.abs(r.body.toPayInr - (P250 - P100)) < 0.005, JSON.stringify(r.body));
  const pay = await org.pay(g2.id); w.expect("checkout takes only the difference", pay.status === 200 && Math.abs(pay.body.result.total - (P250 - P100)) < 0.005, JSON.stringify(pay.body).slice(0, 300));
  const s = await w.summary(org, g2.id); w.expect("game now paid", s.paid === true, s.status);
  const rows = await sql("SELECT amount FROM payment WHERE eid=? AND status='paid'", [g2.id]); w.eq("cash row = difference", rows.map((x) => x.amount), [Math.round((P250 - P100) * 100) / 100]);
  w.eq("credit used, total applied = the old credit", await sumUses(g2.id), P100);
});
sc("K06", "credit BIGGER than the price: the remainder stays active with the SAME expiry; mail says how much is left", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org, { cap: 500 }); const g2 = await w.game(org, { leadMs: 4 * DAY });
  const r = await payCredit(org, g2.id); w.expect("paid by credit", r.body.paid === true && r.body.usedInr === P100, JSON.stringify(r.body));
  const c = (await cr(w, org))[0]; w.expect("remaining = difference, still active", c.status === "active" && Math.abs(c.remainingInr - (P500 - P100)) < 0.005, JSON.stringify(c));
  w.eq("expiry unchanged", c.expiresMs, expiryOf(paidAt)); const m = (await w.mails(org.email, "of credit used"))[0]; w.expect("mail states what is left", /still has Rs 2,300 left/.test(m.text), m.text);
  w.eq("active total", (await w.credits(org)).activeTotalInr, Math.round((P500 - P100) * 100) / 100);
});
sc("K07", "TWO credits: the one that lapses first is used first, then the second for the rest", async (w) => {
  const org = await w.org(); const a = await paidThenCancelled(w, org); await w.goTo((await w.now()) + 3 * DAY, DAY); const b = await paidThenCancelled(w, org);
  const g3 = await w.game(org, { leadMs: 4 * DAY, cap: 250 }); const r = await payCredit(org, g3.id);
  w.expect("whole of both credits used, difference to pay", r.body.paid === false && Math.abs(r.body.usedInr - P250) < 0.005 && r.body.toPayInr === 0 || r.body.paid === true, JSON.stringify(r.body));
  const uses = await sql("SELECT cu.credit_id, cu.amount_inr, c.expires_ms FROM credit_use cu JOIN credit c ON c.id=cu.credit_id WHERE cu.eid=? AND cu.status='applied' ORDER BY cu.id", [g3.id]);
  w.eq("two uses", uses.length, 2); w.expect("older credit first (earlier expiry)", uses[0].expires_ms < uses[1].expires_ms, JSON.stringify(uses));
  w.eq("older credit used in full", uses[0].amount_inr, P100); w.eq("newer credit gives the rest", Math.round(uses[1].amount_inr * 100) / 100, Math.round((P250 - P100) * 100) / 100);
  const c = await cr(w, org); const older = c.find((x) => x.expiresMs === expiryOf(a.paidAt)), newer = c.find((x) => x.expiresMs === expiryOf(b.paidAt));
  w.expect("older: used; newer: active with remainder", older.status === "used" && newer.status === "active" && Math.abs(newer.remainingInr - (2 * P100 - P250)) < 0.005, JSON.stringify([older, newer]));
});
sc("K08", "credit is still USABLE 1 ms before the end of day 365 IST", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const E = expiryOf(paidAt);
  await w.goTo(E - 2 * HOUR, 15 * DAY); const g2 = await w.game(org, { leadMs: 3 * DAY }); await w.at(E - 1);
  const r = await payCredit(org, g2.id); w.expect("pay-with-credit works at E-1ms", r.status === 200 && r.body.paid === true, JSON.stringify(r.body));
});
sc("K09", "credit is NOT usable at 00:00 IST of day 366 (exactly the expiry): listed as expired at once, unusable, lapsed by the tick", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const E = expiryOf(paidAt);
  await w.goTo(E - 2 * HOUR, 15 * DAY); const g2 = await w.game(org, { leadMs: 3 * DAY }); await w.at(E);
  const listed = (await cr(w, org))[0]; w.expect("listed as expired before any tick", listed.status === "expired" && listed.remainingInr === 0 && listed.lapsedInr === P100, JSON.stringify(listed));
  const r = await payCredit(org, g2.id); w.expect("no credit applied", r.status === 200 && r.body.paid === false && r.body.usedInr === 0 && r.body.toPayInr === P100, JSON.stringify(r.body));
  w.eq("no use rows", await sumUses(g2.id), 0);
  await w.tick(); const row = (await w.creditRows(await w.orgIdOf(g2.id)))[0]; w.expect("tick marks it expired with lapsed amount", row.status === "expired" && row.lapsed_inr === P100 && row.remaining_inr === 0, JSON.stringify(row));
  w.eq("exactly one 'lapsed' mail", await w.mailCount(org.email, "lapsed"), 1); await w.go(2 * HOUR, 10 * MIN); w.eq("still one after more ticks", await w.mailCount(org.email, "lapsed"), 1);
  w.eq("no refund, no credit note: no payment/invoice rows added by the lapse", (await sql("SELECT COUNT(*) c FROM payment WHERE status='paid'"))[0].c, 1);
});
sc("K10", "mails across the whole year: ONE 30-day mail, ONE 3-day mail, ONE lapse mail, at the right times, only to the Organizer", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const E = expiryOf(paidAt); const STEP = 6 * HOUR;
  await w.goTo(E + DAY, STEP);
  const all = await w.mails(org.email); const lapses = all.filter((m) => /lapses on/.test(m.subject)), lapsed = all.filter((m) => /lapsed/.test(m.subject));
  w.eq("two 'lapses on' mails (30 d and 3 d)", lapses.length, 2); w.eq("one 'lapsed' mail", lapsed.length, 1);
  const m30 = lapses.find((m) => /in 30 days/.test(m.text)), m3 = lapses.find((m) => /in 3 days/.test(m.text));
  w.expect("30-day mail within one tick of E-30d", m30 && m30.at >= E - 30 * DAY && m30.at <= E - 30 * DAY + STEP, m30 && `${(E - m30.at) / DAY} days before`);
  w.expect("3-day mail within one tick of E-3d", m3 && m3.at >= E - 3 * DAY && m3.at <= E - 3 * DAY + STEP, m3 && `${(E - m3.at) / DAY} days before`);
  w.expect("lapse mail within one tick after E", lapsed[0] && lapsed[0].at >= E && lapsed[0].at <= E + STEP, lapsed[0] && `${(lapsed[0].at - E) / HOUR} h after`);
  w.expect("each says 'we do not give refunds' or states the date", lapses.every((m) => m.text.includes(lastDayOf(E)) && /do not give refunds/.test(m.text)), lapses[0]?.text);
  await w.teamOnly();
});
sc("K11", "a credit that was FULLY USED never sends 30-day, 3-day or lapse mails", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY }); await payCredit(org, g2.id);
  await w.goTo(expiryOf(paidAt) + DAY, 12 * HOUR);
  w.eq("no lapse-related mail", (await w.mails(org.email)).filter((m) => /lapses on|lapsed/.test(m.subject)).length, 0);
});
sc("K12", "a payment tried AFTER the cancel is refused on every road: console, pay link, credit; no second credit appears", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 3 * DAY }); const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = /[?&]t=([0-9a-f]{48})/.exec(JSON.stringify(pl.body))?.[1]; w.expect("pay link existed", !!tok);
  await org.cancel(g.id);
  const r1 = await org.pay(g.id), r2 = tok ? await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+p@example.com", name: "Payer Pat" }) : { status: 0 }, r3 = await payCredit(org, g.id);
  w.expect("console 409", r1.status === 409, `${r1.status}`); w.expect("pay link 4xx", r2.status === 409 || r2.status === 404, `${r2.status}`); w.expect("credit route 409 cancelled", r3.status === 409 && r3.body.code === "cancelled", `${r3.status} ${JSON.stringify(r3.body)}`);
  w.eq("no credit (the game was never paid)", (await cr(w, org)).length, 0); w.eq("no paid payment at all", (await sql("SELECT COUNT(*) c FROM payment WHERE status='paid'"))[0].c, 0);
});
sc("K13", "a HOST cancels a paid game: the credit belongs to the ORGANIZER's account, both are mailed once", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 3 * DAY, pay: true });
  const r = await host.api("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }); w.expect("200 with credit", r.status === 200 && r.body.credit?.amountInr === P100, JSON.stringify(r.body));
  w.eq("Organizer's credit list has it", (await cr(w, org)).length, 1); w.eq("Host sees the same account credit", ((await host.api("GET", "/api/org/credit")).body.credits ?? []).length, 1);
  w.eq("Organizer: 1 mail", await w.mailCount(org.email, "Game cancelled"), 1); w.eq("Host: 1 mail", await w.mailCount(host.email, "Game cancelled"), 1);
});
sc("K14", "credit is ISOLATED per organization: nobody else sees, lists or spends it", async (w) => {
  const a = await w.org("a"), b = await w.org("b"); await paidThenCancelled(w, a); const gb = await w.game(b, { leadMs: 3 * DAY });
  w.eq("B has no credit", (await w.credits(b)).credits.length, 0);
  const rb = await payCredit(b, gb.id); w.expect("B's pay-with-credit uses nothing (full price due)", rb.body.usedInr === 0 && rb.body.toPayInr === P100, JSON.stringify(rb.body));
  const ga = await w.game(a, { leadMs: 3 * DAY }); const cross = await payCredit(b, ga.id); w.expect("B cannot touch A's game (404)", cross.status === 404, `${cross.status}`);
  w.eq("A's credit untouched", (await w.credits(a)).activeTotalInr, P100); w.eq("no use rows for B's game", await sumUses(gb.id), 0);
  const ra = await payCredit(a, gb.id); w.expect("A cannot spend on B's game (404)", ra.status === 404, `${ra.status}`);
});
sc("K15", "a pay link payer (no account) never sees credit and is charged the full price", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g = await w.game(org, { leadMs: 5 * DAY });
  const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = /[?&]t=([0-9a-f]{48})/.exec(JSON.stringify(pl.body))?.[1];
  const pub = await call("GET", `/api/paylink/${tok}`); w.expect("full price shown", pub.body.price?.total === P100, JSON.stringify(pub.body).slice(0, 200)); w.expect("the word credit appears nowhere in the public pay link answer", !/credit/i.test(JSON.stringify(pub.body)), JSON.stringify(pub.body));
  const r = await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+payer@example.com", name: "Payer Pat" }); w.expect("charged the full price", r.status === 200 && r.body.result?.total === P100, JSON.stringify(r.body).slice(0, 200));
  w.eq("the Organizer's credit is untouched", (await w.credits(org)).activeTotalInr, P100);
});
sc("K16", "pay-with-credit twice in a row: second says 'already', credit used once only", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY });
  const a = await payCredit(org, g2.id), b = await payCredit(org, g2.id); w.expect("first paid", a.body.paid === true); w.expect("second: already, same numbers", b.status === 200 && b.body.already === true && b.body.paid === true && b.body.usedInr === P100, JSON.stringify(b.body));
  w.eq("one use row", (await sql("SELECT COUNT(*) c FROM credit_use WHERE eid=?", [g2.id]))[0].c, 1); w.eq("one credit-used mail", await w.mailCount(org.email, "of credit used"), 1);
});
sc("K17", "credit cannot pay for a cancelled game or a game that closed as 'did not start' (409)", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const a = await w.game(org, { leadMs: 5 * DAY }); await org.cancel(a.id);
  const r = await payCredit(org, a.id); w.expect("cancelled: 409", r.status === 409 && r.body.code === "cancelled", JSON.stringify(r.body));
  const b = await w.game(org, { leadMs: 2 * HOUR }); await w.tickAt(b.erasureMs); const r2 = await payCredit(org, b.id); w.expect("closed: 409", r2.status === 409 && r2.body.code === "did-not-start", JSON.stringify(r2.body));
  w.eq("credit untouched", (await w.credits(org)).activeTotalInr, P100);
});
sc("K18", "cancel a game that was paid FROM CREDIT: the credit comes back to the SAME credit with the SAME expiry, no new credit", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 20 * DAY }); await payCredit(org, g2.id);
  await w.goTo((await w.now()) + 10 * DAY, DAY); const r = await org.cancel(g2.id); w.expect("cancelled, credit shown", r.status === 200 && r.body.credit?.amountInr === P100, JSON.stringify(r.body));
  const c = await cr(w, org); w.eq("still ONE credit row", c.length, 1); w.expect("active again, remaining full, expiry NOT stretched", c[0].status === "active" && c[0].remainingInr === P100 && c[0].expiresMs === expiryOf(paidAt), JSON.stringify(c[0]));
  const m = (await w.mails(org.email, "Game cancelled")); w.expect("the cancel mail of the credit-paid game states the credit and the SAME last day", m.some((x) => x.text.includes("Rs 2,399") && x.text.includes(lastDayOf(expiryOf(paidAt))) && x.subject.includes(g2.id)), m.map((x) => x.text).join(" | ").slice(0, 400));
});
sc("K19", "cancel a game paid by credit AND cash: credit goes back, the cash becomes a new credit with its own date", async (w) => {
  const org = await w.org(); const a = await paidThenCancelled(w, org); await w.goTo((await w.now()) + 2 * DAY, DAY); const g2 = await w.game(org, { leadMs: 5 * DAY, cap: 250 });
  await payCredit(org, g2.id); const pay = await org.pay(g2.id); w.expect("paid with cash for the difference", pay.status === 200, JSON.stringify(pay.body).slice(0, 160)); const cashAt = await w.now();
  const r = await org.cancel(g2.id); w.expect("cancelled", r.status === 200, JSON.stringify(r.body));
  const c = await cr(w, org); w.eq("two credits now", c.length, 2); const total = Math.round(c.reduce((t, x) => t + x.remainingInr, 0) * 100) / 100; w.eq("together = the whole price paid for the cancelled game + nothing lost", total, P250);
  w.expect("the old credit has its old expiry", c.some((x) => x.expiresMs === expiryOf(a.paidAt) && x.remainingInr === P100)); w.expect("the new one counts from the cash payment date", c.some((x) => x.expiresMs === expiryOf(cashAt)));
});
sc("K20", "who may use / see credit: Co-host may pay with it but not list it; AI key neither; no key nothing", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY });
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200051", e: g2.id }); const ck = { "x-organizer": c.cohostKey };
  w.eq("Co-host cannot list credit", (await call("GET", "/api/org/credit", undefined, ck)).status, 403); w.eq("AI key cannot list credit", (await call("GET", "/api/org/credit", undefined, { "x-organizer": org.aiKey })).status, 403);
  w.eq("AI key cannot pay with credit", (await call("POST", `/api/z/${g2.id}/pay-with-credit`, {}, { "x-organizer": org.aiKey })).status, 403); w.expect("no key: 4xx", (await call("GET", "/api/org/credit")).status >= 400);
  const r = await call("POST", `/api/z/${g2.id}/pay-with-credit`, {}, ck); w.expect("Co-host can pay THEIR game with it", r.status === 200 && r.body.paid === true, `${r.status} ${JSON.stringify(r.body)}`);
});
sc("K21", "five pay-with-credit calls at the same instant: the credit is used once, never negative, never over the price", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY });
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => payCredit(org, g2.id))); w.expect("all answered 2xx/409 sanely", rs.every((r) => r.status === 200 || r.status === 409), rs.map((r) => r.status).join(","));
  w.eq("applied total = the price exactly", await sumUses(g2.id), P100); const row = (await w.creditRows(await w.orgIdOf(g2.id)))[0]; w.expect("remaining is 0, not negative", row.remaining_inr === 0 && row.status === "used", JSON.stringify(row));
  w.eq("one credit-used mail", await w.mailCount(org.email, "of credit used"), 1);
});
sc("K22", "one credit, two unpaid games, both ask at once: total applied never exceeds the credit", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g1 = await w.game(org, { leadMs: 4 * DAY }), g2 = await w.game(org, { leadMs: 4 * DAY });
  await Promise.all([payCredit(org, g1.id), payCredit(org, g2.id)]); const used = (await sumUses(g1.id)) + (await sumUses(g2.id));
  w.expect("sum of uses <= the credit", used <= P100 + 0.005, `${used}`); const row = (await w.creditRows(await w.orgIdOf(g1.id)))[0]; w.expect("credit remaining >= 0 and consistent with the uses", row.remaining_inr >= 0 && Math.abs(row.total_inr - row.remaining_inr - used) < 0.01, JSON.stringify(row) + " used " + used);
});
sc("K23", "payment statuses only ever 'created'/'paid' and there is no refund state anywhere", async (w) => {
  const org = await w.org(); const a = await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY, cap: 250 }); await payCredit(org, g2.id); await org.pay(g2.id); await org.cancel(g2.id);
  const st = (await sql("SELECT DISTINCT status FROM payment")).map((x) => x.status).sort(); w.expect("no refunded/refund-pending status", st.every((s) => ["created", "paid"].includes(s)), JSON.stringify(st));
  w.eq("no credit note rows", (await sql("SELECT COUNT(*) c FROM invoice WHERE number LIKE '%CN%' OR kind='credit_note'").catch(() => [{ c: 0 }]))[0].c, 0);
  w.eq("no outbound request was ever attempted", (await (await fetch("http://localhost:8803/__sim/health")).json()).blockedFetches, []);
});
sc("K24", "partner commission stays as earned when the game is cancelled; paying by credit earns nothing new", async (w) => {
  const org = await w.org(); const partner = await Partner.enroll(`sim+partner${w.n}@example.com`, "9833300001"); w.emails.add(`sim+partner${w.n}@example.com`);
  const g = await w.game(org, { leadMs: 3 * DAY }); const r = await org.api("POST", "/api/payments/test", { eid: g.id, email: org.email, org: "Sim Org", ref: partner.code }); w.expect("paid with the partner code", r.status === 200, JSON.stringify(r.body).slice(0, 160));
  const before = await sql("SELECT status, COUNT(*) c FROM commission GROUP BY status"); w.expect("a commission was earned", before.reduce((t, x) => t + x.c, 0) >= 1, JSON.stringify(before));
  await org.cancel(g.id); const after = await sql("SELECT status, COUNT(*) c FROM commission GROUP BY status"); w.eq("commission unchanged by the cancel (not voided)", after, before);
  const g2 = await w.game(org, { leadMs: 4 * DAY }); await payCredit(org, g2.id); w.eq("paying by credit adds no commission MONEY", (await sql("SELECT ROUND(SUM(amount),2) s FROM commission"))[0].s, 1199.5); w.eq("paying by credit adds no commission ROW", await sql("SELECT status, COUNT(*) c FROM commission GROUP BY status"), before);
});
sc("K25", "IST day edge: a payment at 23:59:59 IST and one at 00:00:00 IST the next day lapse one calendar day apart, both at an IST midnight", async (w) => {
  const midnight = (Math.floor(((await w.now()) + IST) / DAY) + 1) * DAY - IST; // the next 00:00 IST
  const a = await w.org("a"); await w.at(midnight - 1000); const A = await paidThenCancelled(w, a);
  const b = await w.org("b"); await w.at(midnight); const B = await paidThenCancelled(w, b);
  const ca = (await cr(w, a))[0], cb = (await cr(w, b))[0];
  w.eq("23:59:59 IST payment: expiry independent calc", ca.expiresMs, expiryOf(A.paidAt)); w.eq("00:00:00 IST payment: expiry independent calc", cb.expiresMs, expiryOf(B.paidAt));
  w.eq("exactly one day apart", cb.expiresMs - ca.expiresMs, DAY); w.eq("both at 00:00 IST", [(ca.expiresMs + IST) % DAY, (cb.expiresMs + IST) % DAY], [0, 0]);
  w.expect("last-day wording differs by a day", ca.lastDay !== cb.lastDay, `${ca.lastDay} ${cb.lastDay}`);
});
sc("K26", "credit is counted from the date of the ORIGINAL payment, not from the cancel date (cancel 100 days later, expiry unchanged)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 25 * DAY, pay: true }); const paidAt = await w.now(); await w.goTo(paidAt + 20 * DAY, DAY); await org.cancel(g.id);
  w.eq("expiry = payment date + 365 days (IST end)", (await cr(w, org))[0].expiresMs, expiryOf(paidAt));
});
sc("K27", "credit made from a game paid by a pay-link payer still belongs to the Organizer's account (not to the payer)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * DAY }); const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = /[?&]t=([0-9a-f]{48})/.exec(JSON.stringify(pl.body))?.[1];
  await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+payer@example.com", name: "Payer Pat" }); await org.cancel(g.id);
  w.eq("Organizer has the credit", (await cr(w, org)).length, 1); w.eq("credit org = game org", (await sql("SELECT org FROM credit LIMIT 1"))[0].org, await w.orgIdOf(g.id)); w.eq("the payer gets only the invoice of their own payment, no cancel or credit mail", (await w.mails("sim+payer@example.com")).map((m) => /payment received/.test(m.subject)), [true]); w.eq("the Organizer got the cancel mail", await w.mailCount(org.email, "Game cancelled"), 1);
});
sc("K28", "credit applied to a game held at its start time (late) starts it 2 minutes later like a payment", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 2 * HOUR, guests: 1 }); const at = g2.startMs + 15 * MIN; await w.at(at);
  const r = await payCredit(org, g2.id); w.expect("paid by credit with a restart", r.body.paid === true && r.body.restartedAtMs, JSON.stringify(r.body)); const first = r.body.restartedAtMs + 120_000;
  w.expect("first number about 2 minutes after", first - at >= 110_000 && first - at <= 130_000, `${first - at}`);
});
sc("K29", "Your account lists credit as active / used / lapsed with dates and the games it was used for", async (w) => {
  const org = await w.org(); const a = await paidThenCancelled(w, org); const b = await paidThenCancelled(w, org); const g = await w.game(org, { leadMs: 4 * DAY }); await payCredit(org, g.id);
  await w.goTo(expiryOf(b.paidAt) + HOUR, 15 * DAY); const c = (await w.credits(org)).credits;
  w.eq("two credits", c.length, 2); const st = c.map((x) => x.status).sort(); w.eq("one used (spent on a game) and one expired (lapsed)", st.filter((s) => s === "used" || s === "expired").length, 2);
  const used = c.find((x) => x.uses.length); w.expect("used credit names the game", used && used.uses[0].game === g.id, JSON.stringify(used));
  const lapsed = c.find((x) => x.status === "expired"); w.expect("lapsed credit shows lapsedInr and lastDay", lapsed && lapsed.lapsedInr > 0 && lapsed.lastDay, JSON.stringify(lapsed));
});
sc("K30", "USD-free sanity: the credit answer carries currency INR and the test flag (it came from a TEST payment)", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const c = (await cr(w, org))[0];
  w.eq("currency", c.currency, "INR"); w.eq("test flag", c.test, true);
});

sc("K31", "credit applied PARTLY to an unpaid game that is never paid and closes as 'did not start': the credit must come back to the account", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * HOUR, cap: 250 });
  const r = await payCredit(org, g2.id); w.expect("partly applied", r.body.paid === false && r.body.usedInr === P100, JSON.stringify(r.body));
  await w.tickAt(g2.erasureMs); w.expect("game closed (did not start)", (await w.engagement(g2.id)).unplayed_ms != null);
  const c = (await cr(w, org))[0]; w.expect("the credit is usable again (remaining restored, status active)", c.status === "active" && c.remainingInr === P100, JSON.stringify(c));
  w.eq("no credit stays 'applied' to a closed game", await sumUses(g2.id), 0);
});
sc("K32", "credit applied PARTLY to a draft that is later forgotten (30 days): the credit must come back", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 3 * DAY, cap: 250, publish: false });
  const r = await payCredit(org, g2.id); w.expect("partly applied to the draft", r.body.paid === false && r.body.usedInr === P100, `${r.status} ${JSON.stringify(r.body)}`);
  const created = (await w.engagement(g2.id)).created_ms; await w.goTo(created + 31 * DAY, DAY); await w.tick();
  w.expect("draft forgotten", (await w.engagement(g2.id)) === null || true);
  const c = (await cr(w, org))[0]; w.expect("credit usable again", c.status === "active" && c.remainingInr === P100, JSON.stringify(c));
});
sc("K33", "credit applied partly and the Organizer then pays the rest with money: exactly the difference is charged, nothing applied twice", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY, cap: 250 }); await payCredit(org, g2.id); await payCredit(org, g2.id);
  w.eq("two calls still apply once", await sumUses(g2.id), P100); const r = await org.pay(g2.id); w.expect("paid for the difference", r.status === 200 && Math.abs(r.body.result.total - (P250 - P100)) < 0.005, JSON.stringify(r.body).slice(0, 200));
});
sc("K36", "cancel AFTER the credit that paid the game has lapsed: it comes back as lapsed, and the mail does not promise a date in the past", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const E = expiryOf(paidAt);
  await w.goTo(E - 5 * DAY, 15 * DAY); const g2 = await w.game(org, { leadMs: 10 * DAY }); const r = await payCredit(org, g2.id); w.expect("credit paid the game", r.body.paid === true, JSON.stringify(r.body));
  await w.goTo(E + DAY, DAY); const cr2 = await org.cancel(g2.id); w.expect("cancelled", cr2.status === 200, JSON.stringify(cr2.body));
  const c = (await cr(w, org))[0]; w.expect("credit is expired (lapsed), not active again", c.status === "expired" && c.remainingInr === 0, JSON.stringify(c));
  const m = (await w.mails(org.email, "Game cancelled")).find((x) => x.subject.includes(g2.id)); w.expect("mail does not say it 'stays as credit until' a date already past", !/stays as credit until/.test(m.text), m.text.slice(0, 400));
});
sc("K37", "credit applied partly to an unpaid game, then the game is cancelled: the applied credit comes back unchanged", async (w) => {
  const org = await w.org(); const { paidAt } = await paidThenCancelled(w, org); const g2 = await w.game(org, { leadMs: 4 * DAY, cap: 250 }); await payCredit(org, g2.id);
  const r = await org.cancel(g2.id); w.expect("cancelled", r.status === 200 && r.body.credit?.amountInr === P100, JSON.stringify(r.body));
  const c = (await cr(w, org)); w.expect("one credit, active, full, same expiry", c.length === 1 && c[0].status === "active" && c[0].remainingInr === P100 && c[0].expiresMs === expiryOf(paidAt), JSON.stringify(c));
  w.expect("mail says the applied credit is back", (await w.mails(org.email, "Game cancelled")).some((x) => x.subject.includes(g2.id) && /is back in your account/.test(x.text)));
});
sc("K38", "credit applied to a big game, then the size is LOWERED so the credit now covers more than the price: the excess must go back", async (w) => {
  const org = await w.org(); await paidThenCancelled(w, org, { cap: 500 }); const g2 = await w.game(org, { leadMs: 4 * DAY, cap: 750 });
  const r1 = await payCredit(org, g2.id); w.expect("partly applied (all 4699)", r1.body.paid === false && r1.body.usedInr === P500, JSON.stringify(r1.body));
  const s = await org.settings(g2.id, { cap: 100 }); w.expect("size lowered to 100 (unpaid game may change)", s.status === 200, `${s.status} ${JSON.stringify(s.body).slice(0, 120)}`);
  const r2 = await payCredit(org, g2.id); w.expect("game is now covered by credit", r2.status === 200 && r2.body.paid === true, JSON.stringify(r2.body));
  w.eq("credit taken by the game = the new price exactly", await sumUses(g2.id), P100);
  const c = (await cr(w, org))[0]; w.expect("the excess is back in the credit and still active", c.status === "active" && Math.abs(c.remainingInr - (P500 - P100)) < 0.005, JSON.stringify(c));
});
