// X-scenarios: cancelling a game. Three confirmations (cancel / 'No' at each stage), who may cancel, cancel before / after the start, double cancel, what a cancelled game shows and refuses.
// Spec: docs/ROLES_AND_CONSOLE_SPEC_6.md (cancel flow), docs/ROLES_AND_CONSOLE_SPEC_5.md.
import { sc, HOUR, MIN, DAY, sql, call } from "./lib.mjs";

const cancelRows = async (eid) => (await sql("SELECT cancelled_ms, cancelled_by FROM engagement WHERE id=?", [eid]))[0];

sc("X01", "confirmations other than exactly 3 are refused (0, 1, 2, 4, text, missing) and the game stays alive", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  for (const c of [0, 1, 2, 4, "3", true, undefined]) { const r = await org.api("POST", `/api/z/${g.id}/cancel`, c === undefined ? {} : { confirmations: c }); w.expect(`confirmations=${JSON.stringify(c)} -> 400`, r.status === 400 && r.body.code === "confirmations", `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`); }
  w.eq("not cancelled", (await cancelRows(g.id)).cancelled_ms, null); w.eq("no credit made", (await w.creditRows(await w.orgIdOf(g.id))).length, 0); w.eq("no cancel mail", await w.mailCount(org.email, "Game cancelled"), 0);
});
sc("X02", "'No' at the FIRST confirmation: the screen only reads the preview; reading it any number of times changes nothing", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 2 });
  for (let i = 0; i < 5; i++) { const p = await org.cancelPreview(g.id); w.expect(`preview ${i} ok and says canCancel`, p.status === 200 && p.body.canCancel === true && p.body.credit?.amountInr > 0, JSON.stringify(p.body)); }
  w.eq("still alive", (await cancelRows(g.id)).cancelled_ms, null); w.expect("guests untouched", (await w.personal(g.id)) >= 2); w.eq("no mail", await w.mailCount(org.email, "Game cancelled"), 0);
});
sc("X03", "'No' at the SECOND confirmation: a request with 1 confirmation leaves everything as it was", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 2 });
  const r = await org.cancel(g.id, 1); w.eq("refused", r.status, 400); w.eq("alive", (await cancelRows(g.id)).cancelled_ms, null);
  const i = await w.info(g.id); w.expect("guests see a normal game", !i.body.cancelled);
});
sc("X04", "'No' at the THIRD confirmation: a request with 2 confirmations leaves everything as it was; the final Yes then works", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 2 });
  w.eq("refused", (await org.cancel(g.id, 2)).status, 400); w.eq("alive", (await cancelRows(g.id)).cancelled_ms, null);
  const r = await org.cancel(g.id, 3); w.expect("the third Yes cancels", r.status === 200 && r.body.cancelled === true, JSON.stringify(r.body)); w.expect("cancelled now", (await cancelRows(g.id)).cancelled_ms != null);
});
sc("X05", "cancel an UNPAID game: no money, no credit, and the mail says so", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, guests: 1, name: "Office Party" });
  const r = await org.cancel(g.id); w.expect("ok, no credit", r.status === 200 && r.body.credit === null, JSON.stringify(r.body));
  const m = (await w.mails(org.email, "Game cancelled"))[0]; w.expect("one cancel mail naming the game", !!m && m.subject.includes("Office Party"), m && m.subject);
  w.expect("mail says no money is involved", /no money is involved/i.test(m.text), m.text.slice(0, 300)); w.expect("mail has no credit/refund promise", !/credit until|Rs \d/.test(m.text), m.text.slice(0, 300));
  w.eq("no credit rows", (await w.creditRows(await w.orgIdOf(g.id))).length, 0);
});
sc("X06", "double cancel: the second answers the same (already), changes nothing, no second mail or credit", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  const a = await org.cancel(g.id), b = await org.cancel(g.id), c = await org.cancel(g.id);
  w.expect("first ok", a.status === 200 && !a.body.already); w.expect("second and third say already", b.body.already === true && c.body.already === true && b.status === 200, JSON.stringify([b.body, c.body]));
  w.eq("same credit amount", b.body.credit?.amountInr, a.body.credit?.amountInr);
  w.eq("one credit row", (await w.creditRows(await w.orgIdOf(g.id))).length, 1); w.eq("one mail", await w.mailCount(org.email, "Game cancelled"), 1);
});
sc("X07", "four cancels at the very same moment: one cancel, one credit, one mail", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  const rs = await Promise.all([1, 2, 3, 4].map(() => org.cancel(g.id)));
  w.expect("all 200", rs.every((r) => r.status === 200), rs.map((r) => r.status).join(",")); w.eq("exactly one real cancel", rs.filter((r) => !r.body.already).length, 1);
  w.eq("one credit row", (await w.creditRows(await w.orgIdOf(g.id))).length, 1); w.eq("one mail", await w.mailCount(org.email, "Game cancelled"), 1);
});
sc("X08", "PAID game cannot be cancelled once its start time has passed (409); the message points to 'End the game'", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 1 });
  await w.at(g.startMs + MIN); const p = await org.cancelPreview(g.id); w.expect("preview says no", p.body.canCancel === false && /End the game/.test(p.body.reason), JSON.stringify(p.body));
  const r = await org.cancel(g.id); w.eq("409", r.status, 409); w.eq("no credit", (await w.creditRows(await w.orgIdOf(g.id))).length, 0); w.eq("not cancelled", (await cancelRows(g.id)).cancelled_ms, null);
});
sc("X09", "the start-time edge: 1 ms before the start a paid game can be cancelled, AT the start it cannot", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true }); const g2 = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  await w.at(g.startMs - 1); w.eq("1 ms before: preview canCancel", (await org.cancelPreview(g.id)).body.canCancel, true);
  w.eq("1 ms before: cancel works", (await org.cancel(g.id)).status, 200);
  await w.at(g2.startMs); w.eq("at the start: canCancel false", (await org.cancelPreview(g2.id)).body.canCancel, false);
});
sc("X10", "an UNPAID game can still be cancelled after its start time (nothing started, no money)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 2 });
  await w.at(g.startMs + 30 * MIN); const r = await org.cancel(g.id); w.expect("cancelled", r.status === 200 && r.body.cancelled, JSON.stringify(r.body));
  w.expect("guest info shows cancelled", (await w.info(g.id)).body.cancelled === true);
});
sc("X11", "a Host cancels: Organizer and Host both get the mail, it names 'a Host', cancelled_by = host", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  const r = await host.api("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }); w.expect("200", r.status === 200, JSON.stringify(r.body));
  w.eq("cancelled_by", (await cancelRows(g.id)).cancelled_by, "host");
  for (const [who, addr] of [["Organizer", org.email], ["Host", host.email]]) { const m = await w.mails(addr, "Game cancelled"); w.eq(`${who} got exactly one mail`, m.length, 1); if (m[0]) w.expect(`${who} mail says cancelled by a Host`, /cancelled by a Host/.test(m[0].text), m[0].text.slice(0, 200)); }
});
sc("X12", "who may NOT cancel: Co-host, AI key, a guest, another Organizer, nobody", async (w) => {
  const org = await w.org(); const other = await w.org("x"); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 1 });
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200041", e: g.id });
  const res = {
    cohost: await call("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }, { "x-organizer": c.cohostKey }),
    ai: await call("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }, { "x-organizer": org.aiKey }),
    other: await other.cancel(g.id), nobody: await call("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }),
  };
  for (const [k, r] of Object.entries(res)) w.expect(`${k} refused (4xx)`, r.status >= 400 && r.status < 500, `${r.status}`);
  w.eq("game alive", (await cancelRows(g.id)).cancelled_ms, null);
});
sc("X13", "after a cancel: guests cannot join (403 cancelled), info shows the cancelled message, the Organizer sees 'cancelled'", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, guests: 1 }); await org.cancel(g.id);
  const j = await call("POST", `/api/z/${g.id}/join`, { phone: "9812300002", name: "Late Larry", device: "b".repeat(32) }); w.expect("join 403 cancelled", j.status === 403 && j.body.code === "cancelled", `${j.status} ${JSON.stringify(j.body).slice(0, 120)}`);
  const i = (await w.info(g.id)).body; w.expect("guest info: cancelled + message", i.cancelled === true && /cancelled by the organizer/i.test(i.message), JSON.stringify(i).slice(0, 160));
  w.expect("Organizer summary says cancelled", /cancelled/.test((await w.summary(org, g.id)).status));
});
sc("X14", "after a cancel nothing can be changed: reschedule, publish, settings, announce, pay all refused (409)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR }); await org.cancel(g.id);
  const rs = { reschedule: await org.settings(g.id, { startRound: await w.roundIn(9 * HOUR) }), publish: await org.publish(g.id), pay: await org.pay(g.id), announce: await org.announce(g.id, "hello"), join: await call("POST", `/api/z/${g.id}/join`, { phone: "9812300003", name: "Z", device: "c".repeat(32) }) };
  for (const [k, r] of Object.entries(rs)) w.expect(`${k} refused`, r.status === 409 || r.status === 403, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
});
sc("X15", "a cancelled game can be cloned ('Create a new game like this one') and the clone is a clean draft", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, name: "Gala" }); await org.cancel(g.id);
  const r = await org.api("POST", `/api/z/${g.id}/clone`, {}); w.expect("200", r.status === 200); const s = await w.summary(org, r.body.id); w.expect("draft, not cancelled, same name", s.status === "draft" && !s.cancelled && s.name === "Gala", JSON.stringify(s).slice(0, 120));
});
sc("X16", "cancel erases the Co-host at once and tells the guests nothing by mail (guests never get e-mail)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 3 });
  await org.inviteCohost({ label: "Chitra", phone: "9822200042", e: g.id }); w.eq("co-host present", await w.cohostRows(g.id), 1);
  await org.cancel(g.id); w.eq("co-host gone", await w.cohostRows(g.id), 0); await w.teamOnly(); await w.noGuestDataInMail();
});
sc("X17", "cancel a game that closed as 'did not start': refused (409) with the 'create a new game' hint", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR }); await w.tickAt(g.erasureMs);
  const p = await org.cancelPreview(g.id); w.expect("preview says no with the hint", p.body.canCancel === false && /create a new game like this one/i.test(p.body.reason), JSON.stringify(p.body));
  w.eq("409", (await org.cancel(g.id)).status, 409);
});
sc("X18", "cancel a draft that was never published: allowed, no mail about a game nobody saw... and no credit", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, publish: false });
  const r = await org.cancel(g.id); w.expect("accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); w.eq("no credit", (await w.creditRows(await w.orgIdOf(g.id))).length, 0);
});
sc("X19", "cancel mail wording: no refund promise anywhere; the rule sentence and the exact last day are present", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true }); await org.cancel(g.id);
  const m = (await w.mails(org.email, "Game cancelled"))[0];
  w.expect("contains 'We do not give refunds'", /We do not give refunds/.test(m.text), m.text);
  w.expect("never promises money back", !/(money back|refund of|will be refunded|we will refund|refunded to)/i.test(m.text), m.text);
  const credit = (await w.credits(org)).credits[0]; w.expect("contains the last-day date from the credit", m.text.includes(credit.lastDay), `${credit.lastDay} not in mail`); w.expect("amount in rupees", m.text.includes("Rs 2,399"), m.text.slice(0, 200));
});
sc("X20", "cancel by the platform owner works too and says so", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true });
  const { platform } = await import("./lib.mjs"); const r = await platform.api("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }); w.expect("200", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  w.eq("cancelled_by platform", (await cancelRows(g.id)).cancelled_by, "platform");
});
sc("X21", "cancel with 40 guests and a people list: the cancel itself is fast and complete (one transaction of work)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 40, people: 30 });
  const t0 = Date.now(); const r = await org.cancel(g.id); const ms = Date.now() - t0;
  w.expect("cancelled", r.status === 200); w.expect("under 3 s on the simulator", ms < 3000, `${ms} ms`);
  await w.tickAt((await w.engagement(g.id)).cancelled_ms + 23 * HOUR); w.eq("all 70 gone at cancel+23h", await w.personal(g.id), 0);
});
