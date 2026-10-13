// C-scenarios: "Create a new game like this one" with and without the people list. Spec: docs/ROLES_AND_CONSOLE_SPEC_5.md part B.
import { sc, HOUR, MIN, DAY, sql, call } from "./lib.mjs";

const clone = (org, id, body = {}) => org.api("POST", `/api/z/${id}/clone`, body);
const prizeText = async (w, org, id) => (await w.summary(org, id)).rewards.map((r) => r.text);
async function styled(w, org, o = {}) { // a game with settings worth copying
  const g = await w.game(org, { name: "Annual Family Night", ...o });
  const s = await w.summary(org, g.id);
  const rewards = s.rewards.map((r, i) => ({ ...r, text: i === 0 ? "A hamper of sweets" : r.text }));
  const r = await org.settings(g.id, { rewards, whoCanJoin: "list", coHostLimit: 40, name: "Annual Family Night" }); if (!r.ok) throw new Error("settings " + JSON.stringify(r.body));
  return g;
}

sc("C01", "clone WITHOUT people: new game id, draft, date empty ('start pending'), settings copied, no people", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR, people: 3, guests: 2 });
  const r = await clone(org, g.id); w.expect("200", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  const id = r.body.id; w.expect("new id, same family", id !== g.id && id.startsWith(g.id), id);
  w.expect("needsStart: the date must be chosen again", r.body.needsStart === true);
  w.eq("no people copied", r.body.peopleCopied, 0);
  const s = await w.summary(org, id), s0 = await w.summary(org, g.id);
  w.expect("a draft, nothing paid or published", s.status === "draft" && s.paid === false, s.status);
  w.expect("start pending flag", s.startPending === true);
  w.eq("name copied", s.name, "Annual Family Night"); w.eq("prize texts copied", s.rewards.map((x) => x.text), s0.rewards.map((x) => x.text)); w.eq("who can join copied", s.whoCanJoin, "list"); w.eq("Co-host limit copied", s.coHostLimit, 40);
  w.eq("size copied", s.limit, s0.limit); w.eq("tickets copied", s.tickets, s0.tickets); w.eq("rounds copied", s.rounds, s0.rounds);
  w.eq("no guests in the clone", await w.personal(id), 0);
  w.expect("the old game is untouched", (await w.personal(g.id)) >= 5);
});
sc("C02", "clone copies NOTHING of money, status, guests, waiting requests or Co-hosts", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR, pay: true, guests: 3, people: 2 });
  await org.inviteCohost({ label: "Chitra", phone: "9822200031", e: g.id });
  const r = await clone(org, g.id, { startRound: await w.roundIn(2 * DAY) }); w.expect("200", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  const id = r.body.id, e = await w.engagement(id);
  w.expect("pack 0 (unpaid)", e.pack === 0); w.expect("not cancelled / closed", e.cancelled_ms == null && e.unplayed_ms == null);
  w.eq("no payment rows", (await sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [id]))[0].c, 0);
  w.eq("no Co-host keys for the new game", (await sql("SELECT COUNT(*) c FROM organizer_key WHERE eid=? AND kind='cohost'", [id]))[0].c, 0);
  w.eq("no guests, no list, no waiting", await w.personal(id), 0);
  w.expect("date was given, so no start-pending", (await w.summary(org, id)).startPending === undefined);
});
sc("C03", "clone WITH people while the list exists: everyone copied with NEW personal links; old links stay with the old game", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR, people: 4, guests: 2 });
  const oldTok = (await sql("SELECT tok_hash FROM person WHERE eid=?", [g.id])).map((x) => x.tok_hash);
  const r = await clone(org, g.id, { withPeople: true }); w.expect("200", r.status === 200);
  w.eq("6 people copied (4 listed + 2 who joined)", r.body.peopleCopied, 6);
  const nt = (await sql("SELECT tok_hash, status FROM person WHERE eid=?", [r.body.id]));
  w.eq("6 invitations in the new game", nt.length, 6); w.expect("all just 'invited' (nobody joined yet)", nt.every((x) => x.status === "invited"));
  w.expect("no personal-link token is shared with the old game", !nt.some((x) => oldTok.includes(x.tok_hash)));
  w.expect("old list still there", (await w.personal(g.id)) >= 6);
});
sc("C04", "clone WITH people after the erasure: nothing to bring, a calm note", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 2 * HOUR, people: 3, guests: 1 });
  await w.tickAt(g.erasureMs);
  const r = await clone(org, g.id, { withPeople: true }); w.expect("200", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  w.eq("0 copied", r.body.peopleCopied, 0); w.expect("note: 'The old guest list has been erased, so add your people again.'", r.body.peopleNote === "The old guest list has been erased, so add your people again.", r.body.peopleNote);
});
sc("C05", "a clone cannot be published or paid until a date is chosen; choosing one unlocks both", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR });
  const id = (await clone(org, g.id)).body.id;
  let r = await org.publish(id); const pubRefused = r.status >= 400;
  r = await org.pay(id); w.expect("pay refused while the date is empty", r.status === 400 && r.body.code === "start-pending", `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  r = await org.api("POST", `/api/z/${id}/pay-with-credit`, {}); w.expect("credit pay refused too (or no credit)", r.status >= 400, `${r.status}`);
  w.expect("publish refused while the date is empty", pubRefused, `publish gave ${r.status}`);
  r = await org.settings(id, { startRound: await w.roundIn(9 * HOUR) }); w.expect("date accepted", r.status === 200);
  w.expect("start-pending cleared", (await w.summary(org, id)).startPending === undefined);
  r = await org.publish(id); w.expect("publish now ok", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  r = await org.pay(id); w.expect("pay now ok", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
});
sc("C06", "who may clone: Organizer and Host yes; Co-host, AI key and strangers no", async (w) => {
  const org = await w.org(); const host = await w.host(org); const other = await w.org("x"); const g = await styled(w, org, { leadMs: 3 * HOUR });
  w.expect("Host 200", (await host.api("POST", `/api/z/${g.id}/clone`, {})).status === 200);
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200032", e: g.id });
  w.expect("Co-host 403", (await call("POST", `/api/z/${g.id}/clone`, {}, { "x-organizer": c.cohostKey })).status === 403);
  w.expect("AI key 403", (await call("POST", `/api/z/${g.id}/clone`, {}, { "x-organizer": org.aiKey })).status === 403);
  const o = await other.api("POST", `/api/z/${g.id}/clone`, {}); w.expect("another Organizer refused", o.status === 403 || o.status === 404, `${o.status}`);
  w.expect("no key refused", (await call("POST", `/api/z/${g.id}/clone`, {})).status >= 400);
});
sc("C07", "clone of a CANCELLED game and of a CLOSED ('did not start') game both work", async (w) => {
  const org = await w.org(); const a = await styled(w, org, { leadMs: 3 * HOUR }); const b = await styled(w, org, { leadMs: 2 * HOUR });
  await org.cancel(a.id); w.expect("clone of cancelled", (await clone(org, a.id)).status === 200);
  await w.tickAt(b.erasureMs); w.expect("clone of closed", (await clone(org, b.id)).status === 200);
});
sc("C08", "the 10-draft limit applies to clones (409 draft-limit)", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR });
  let last; for (let i = 0; i < 11; i++) { last = await clone(org, g.id); if (last.status !== 200) break; }
  w.expect("an eleventh draft is refused with code draft-limit", last.status === 409 && last.body.code === "draft-limit", `${last.status} ${JSON.stringify(last.body).slice(0, 160)}`);
});
sc("C09", "clone start time: past refused, beyond 30 days refused, inside accepted", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR });
  let r = await clone(org, g.id, { startRound: await w.roundIn(-HOUR) }); w.expect("past 400", r.status === 400, `${r.status}`);
  r = await clone(org, g.id, { startRound: await w.roundIn(31 * DAY) }); w.expect("31 days 400 too-far", r.status === 400 && r.body.code === "too-far", JSON.stringify(r.body).slice(0, 120));
  r = await clone(org, g.id, { startRound: 1.5 }); w.expect("non-integer 400", r.status === 400);
  r = await clone(org, g.id, { startRound: await w.roundIn(29 * DAY) }); w.expect("29 days 200", r.status === 200);
});
sc("C10", "the people list that moved to the new game follows the NEW game's clock, the old copy goes on the old clock", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 2 * HOUR, people: 3 });
  const r = await clone(org, g.id, { withPeople: true, startRound: await w.roundIn(4 * DAY) }); const id = r.body.id; await org.publish(id);
  const life = await w.life(org, id);
  await w.tickAt(g.erasureMs); w.eq("old game's copy erased on its own clock", await w.personal(g.id), 0); w.eq("new game's copy still there", (await w.personal(id)) >= 3, true);
  await w.tickAt(life.personalDeleteAtMs - 1); w.expect("still there 1 ms before the new clock", (await w.personal(id)) >= 3);
  await w.tickAt(life.personalDeleteAtMs); w.eq("gone at the new clock", await w.personal(id), 0);
});
sc("C11", "clone of a clone keeps a short, readable id family", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR });
  const a = (await clone(org, g.id)).body.id, b = (await clone(org, a)).body.id, c = (await clone(org, b)).body.id;
  w.expect("ids are distinct", new Set([g.id, a, b, c]).size === 4); w.expect("id length stays bounded (<= 40)", c.length <= 40, `${c} (${c.length})`);
  w.expect("suffix is not stacked (-XXXX-XXXX)", !/-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c), c);
});
sc("C12", "clone is audit-logged and mails nothing", async (w) => {
  const org = await w.org(); const g = await styled(w, org, { leadMs: 3 * HOUR }); const before = (await w.mails()).length;
  const id = (await clone(org, g.id)).body.id; w.eq("no mail sent by clone", (await w.mails()).length, before);
  const hits = await sql("SELECT COUNT(*) c FROM audit_log WHERE event='clone' AND eid=?", [g.id]); w.eq("one 'clone' event in the audit chain of the source game", hits[0].c, 1);
  const ai = await call("POST", `/api/z/${g.id}/clone`, {}, { "x-organizer": org.aiKey }); w.expect("an AI key's attempt is refused and creates no draft", ai.status === 403 && (await sql("SELECT COUNT(*) c FROM engagement WHERE id LIKE ?", [g.id + "-%"]))[0].c === 1, `${ai.status}`);
});
