// S-scenarios: how long things are kept. Settings of a game that did not start: 30 days. Drafts: 30 days. Played game's records: 00:00 IST at the end of day 365. Credit records, outbox, counters.
// Spec: docs/ROLES_AND_CONSOLE_SPEC_5.md A.6; docs/RETENTION.md.
import { sc, HOUR, MIN, DAY, IST, sql, call } from "./lib.mjs";

const istMidnightAfter = (ms) => (Math.floor((ms + IST) / DAY) + 1) * DAY - IST; // the next 00:00 IST strictly after ms
const gone = async (w, id) => (await w.engagement(id)) === null;

sc("S01", "settings of a game that did not start are kept 30 days after it closed: readable and usable at day 30-1ms, forgotten at day 30", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, name: "Quiz Night" });
  await w.tickAt(g.erasureMs); const closedAt = (await w.engagement(g.id)).unplayed_ms; w.expect("closed at the erasure tick", closedAt === g.erasureMs, `${closedAt} vs ${g.erasureMs}`);
  await w.tickAt(closedAt + 29 * DAY); const s = await w.summary(org, g.id); w.expect("day 29: settings still readable", s.name === "Quiz Night", JSON.stringify(s).slice(0, 120));
  await w.tickAt(closedAt + 30 * DAY - 1); w.expect("30 days minus 1 ms: still there", !(await gone(w, g.id)));
  w.expect("... and a new game can still be made from it", (await org.api("POST", `/api/z/${g.id}/clone`, {})).status === 200);
  await w.tickAt(closedAt + 30 * DAY); w.expect("30 days: forgotten", await gone(w, g.id));
});
sc("S02", "a draft nobody published is forgotten after 30 days (present at 29d23h, gone just after day 30)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * DAY, publish: false }); const created = (await w.engagement(g.id)).created_ms;
  await w.tickAt(created + 30 * DAY - HOUR); w.expect("present at day 29 + 23h", !(await gone(w, g.id)));
  await w.tickAt(created + 30 * DAY + 2); w.expect("gone after day 30", await gone(w, g.id));
});
sc("S03", "an unpublished draft with a people list: the list is erased at end+23h, the draft itself at day 30", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, publish: false, people: 3 });
  await w.tickAt(g.erasureMs); w.eq("list erased", await w.personal(g.id), 0); w.expect("draft kept (settings are not personal)", !(await gone(w, g.id)));
  await w.tickAt((await w.engagement(g.id)).created_ms + 30 * DAY + 2); w.expect("draft forgotten at day 30", await gone(w, g.id));
});
sc("S04", "PLAYED game: records stay until 00:00 IST at the end of day 365, gone the instant it is reached", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 1 });
  const full = istMidnightAfter(g.endMs + 365 * DAY); w.eq("fullDeleteAt matches the rule 'next 00:00 IST after end+365d'", g.fullDeleteMs, full);
  await w.tickAt(g.erasureMs + HOUR); await w.tickAt(g.endMs + 100 * DAY); w.expect("day 100: settings and records still there", !(await gone(w, g.id)));
  await w.tickAt(full - 1); w.expect("1 ms before: still there", !(await gone(w, g.id)));
  await w.tickAt(full); w.expect("at 00:00 IST: gone", await gone(w, g.id));
  for (const t of ["life", "winner", "prize", "cbl_request"]) w.eq(`${t} rows gone`, (await sql(`SELECT COUNT(*) c FROM ${t} WHERE eid=?`, [g.id]))[0].c, 0);
  w.eq("contact/pub/paidby keys gone", (await sql("SELECT COUNT(*) c FROM kv WHERE k IN (?,?,?)", ["contact/" + g.id, "pub/" + g.id, "paidby/" + g.id]))[0].c, 0);
});
sc("S05", "the day-365 instant is 00:00 IST: 23:59:59 IST on day 365 keeps it, 00:00:00 IST removes it", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  const full = g.fullDeleteMs; w.eq("it is an IST midnight", (full + IST) % DAY, 0);
  await w.tickAt(g.endMs + 2 * HOUR); /* the scheduled job runs every minute in real life, so the game has its end clock long before day 365 */ await w.tickAt(full - 1000); w.expect("23:59:59 IST: kept", !(await gone(w, g.id))); await w.tickAt(full); w.expect("00:00:00 IST: gone", await gone(w, g.id));
});
sc("S06", "a cancelled paid game with guests is purged 365 days after the CANCEL, at the next IST midnight", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * DAY, pay: true, guests: 1 }); await w.goTo(g.startMs - 2 * DAY, DAY); const at = await w.now(); await org.cancel(g.id);
  await w.tickAt(at + HOUR); await w.tickAt(at + 24 * HOUR); const full = istMidnightAfter(at + 365 * DAY);
  await w.tickAt(full - 1); w.expect("kept 1 ms before", !(await gone(w, g.id))); await w.tickAt(full); w.expect("gone at the IST midnight after cancel+365d", await gone(w, g.id));
});
sc("S07", "a cancelled game that never had a guest is also purged on the same IST-midnight rule (not at an odd hour)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * DAY, pay: true }); await w.goTo(g.startMs - 2 * DAY, DAY); const at = await w.now(); await org.cancel(g.id);
  const e = await w.engagement(g.id); const full = istMidnightAfter(at + 365 * DAY);
  await w.tickAt(full - 1); w.expect("kept 1 ms before the IST midnight", !(await gone(w, g.id)));
  await w.tickAt(full); w.expect("gone at the IST midnight after cancel+365d", await gone(w, g.id), `still there; created_ms ${e.created_ms}`);
});
sc("S08", "payment, invoice and entitlement records, the organizer's invoice details and who paid are kept for ever (the law); the game itself is gone at day 365", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  await w.tickAt(g.fullDeleteMs); w.expect("engagement purged", await gone(w, g.id));
  const left = { payment: (await sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [g.id]))[0].c, invoice: (await sql("SELECT COUNT(*) c FROM invoice"))[0].c, entitlement: (await sql("SELECT COUNT(*) c FROM entitlement WHERE eid=?", [g.id]))[0].c };
  w.expect("payment, invoice and entitlement are all still there", left.payment >= 1 && left.invoice >= 1 && left.entitlement >= 1, JSON.stringify(left));
  const lp = (await sql("SELECT * FROM legal_party WHERE eid=?", [g.id]))[0];
  w.expect("the permanent record of the organizer and the payer exists (name, e-mail)", !!lp && !!lp.organizer_email && !!lp.payer_email && !!lp.payer_name, JSON.stringify(lp));
  w.eq("nothing else of the game is left (contact, publish marker)", (await sql("SELECT COUNT(*) c FROM kv WHERE k IN (?,?)", ["contact/" + g.id, "pub/" + g.id]))[0].c, 0);
  await w.tickAt(g.fullDeleteMs + 400 * DAY); w.expect("still there 400 days later", (await sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [g.id]))[0].c >= 1 && (await sql("SELECT COUNT(*) c FROM legal_party WHERE eid=?", [g.id]))[0].c === 1);
});
sc("S09", "credit records are kept 1 year after they lapse, then deleted", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * DAY, pay: true }); await org.cancel(g.id);
  const orgId = await w.orgIdOf(g.id); const c = (await w.creditRows(orgId))[0]; w.expect("credit exists", !!c);
  await w.tickAt(c.expires_ms + 1); w.eq("lapsed", (await w.creditRows(orgId))[0].status, "expired");
  await w.tickAt(c.expires_ms + 365 * DAY - 1); w.expect("kept until a year after the lapse", (await w.creditRows(orgId)).length === 1);
  await w.tickAt(c.expires_ms + 365 * DAY + 1); w.eq("deleted after that", (await w.creditRows(orgId)).length, 0);
});
sc("S10", "unsent mail (no mail key): bodies kept at most 3 days", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  w.expect("mails exist", (await sql("SELECT COUNT(*) c FROM outbox"))[0].c > 0);
  await w.go(4 * DAY, DAY); await org.history();
  w.eq("no outbox row older than 3 days", (await sql("SELECT COUNT(*) c FROM outbox WHERE at_ms < ?", [(await w.now()) - 3 * DAY]))[0].c, 0);
});
sc("S11", "daily write counters older than 90 days are deleted; younger kept", async (w) => {
  const org = await w.org(); await w.game(org, { leadMs: 2 * HOUR }); const start = new Date(await w.now()).toISOString().slice(0, 10);
  w.expect("a usage row exists for today", (await sql("SELECT COUNT(*) c FROM usage WHERE day=?", [start]))[0].c === 1);
  await w.go(89 * DAY, 10 * DAY); await org.history(); w.expect("kept at ~day 90", (await sql("SELECT COUNT(*) c FROM usage WHERE day=?", [start]))[0].c === 1);
  await w.go(3 * DAY, DAY); await org.history(); w.eq("deleted after 90 days", (await sql("SELECT COUNT(*) c FROM usage WHERE day=?", [start]))[0].c, 0);
});
sc("S12", "address hashes for daily limits (pay-link attempts) are deleted after 2 days", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 10 * DAY }); const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = /[?&]t=([0-9a-f]{48})/.exec(JSON.stringify(pl.body))?.[1];
  await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+payer@example.com", name: "Payer Pat" }, {}, { ip: "10.9.9.9" });
  w.expect("a plim/ key exists", (await sql("SELECT COUNT(*) c FROM kv WHERE k LIKE 'plim/%'"))[0].c >= 1);
  await w.go(4 * DAY, DAY); w.eq("gone after 4 days", (await sql("SELECT COUNT(*) c FROM kv WHERE k LIKE 'plim/%'"))[0].c, 0);
});
sc("S13", "a played game's SETTINGS are not forgotten at 30 days (only unplayed ones are)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, name: "Played Night" });
  await w.go(40 * DAY, DAY); const s = await w.summary(org, g.id); w.expect("still readable at day 40", s.name === "Played Night", JSON.stringify(s).slice(0, 100));
});
sc("S14", "the Organizer's account data (sealed e-mail) outlives the purge of every game", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  await w.tickAt(g.fullDeleteMs + DAY); w.expect("game gone", await gone(w, g.id)); w.expect("Organizer can still sign in with their key", (await org.whoami()).status === 200);
});
