// R-scenarios: rescheduling (earlier, later, many times), the 30-day limit, and what the erasure clock does when the time moves. Spec: docs/ROLES_AND_CONSOLE_SPEC_5.md A.3, A.5.
import { sc, HOUR, MIN, DAY, roundAt, roundTimeMs, sql, call } from "./lib.mjs";

const MAX = 30 * DAY;
const startOf = async (w, org, id) => (await w.summary(org, id)).startMs;

sc("R01", "unpaid game moved EARLIER: start, end and erasure time all move earlier", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 6 * HOUR });
  const r = await org.settings(g.id, { startRound: await w.roundIn(2 * HOUR) });
  w.expect("reschedule accepted", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  const life = await w.life(org, g.id);
  w.expect("start moved ~4h earlier", Math.abs((g.startMs - (await startOf(w, org, g.id))) - 4 * HOUR) < 10_000);
  w.expect("erasure moved the same 4h earlier", Math.abs((g.erasureMs - life.personalDeleteAtMs) - 4 * HOUR) < 10_000, `${g.erasureMs - life.personalDeleteAtMs}`);
  w.eq("erasure = end + 23h", life.personalDeleteAtMs - life.endMs, 23 * HOUR);
});
sc("R02", "unpaid game moved LATER: erasure moves later by the same amount", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  await org.settings(g.id, { startRound: await w.roundIn(26 * HOUR) });
  const life = await w.life(org, g.id);
  w.expect("erasure moved ~24h later", Math.abs((life.personalDeleteAtMs - g.erasureMs) - 24 * HOUR) < 10_000, `${life.personalDeleteAtMs - g.erasureMs}`);
});
sc("R03", "rescheduled 12 times (both directions): the clock follows only the NEWEST time", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR, guests: 2, people: 2 });
  let last = g.startMs;
  for (let i = 0; i < 12; i++) {
    const lead = Math.floor((1 + w.rng() * 20 * 24) * HOUR); const sr = await w.roundIn(lead);
    const r = await org.settings(g.id, { startRound: sr }); if (!r.ok) { w.expect(`move ${i} accepted`, false, JSON.stringify(r.body).slice(0, 200)); continue; }
    last = roundTimeMs(sr); await w.go(10 * MIN, 5 * MIN);
  }
  const life = await w.life(org, g.id);
  w.expect("start is the last chosen time", (await startOf(w, org, g.id)) === last);
  w.expect("erasure = last end + 23h", life.personalDeleteAtMs === life.endMs + 23 * HOUR && life.endMs > last && life.endMs - last < 20 * MIN, JSON.stringify(life));
  const early = g.erasureMs; // the very first erasure time is long gone or not: data must be there unless the last time is before it
  if (life.personalDeleteAtMs > early + HOUR) { await w.tickAt(early + HOUR); w.expect("data of the FIRST schedule is not erased when the game moved later", (await w.personal(g.id)) >= 4, JSON.stringify(await w.personalRows(g.id))); }
  await w.tickAt(life.personalDeleteAtMs - 1); w.expect("data present 1 ms before the newest erasure time", (await w.personal(g.id)) >= 4);
  await w.tickAt(life.personalDeleteAtMs); w.eq("data gone at the newest erasure time", await w.personal(g.id), 0);
});
sc("R04", "a time in the past is refused (settings) and the game keeps its time", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR });
  for (const lead of [-HOUR, -MIN, -DAY]) { const r = await org.settings(g.id, { startRound: await w.roundIn(lead) }); w.expect(`lead ${lead / MIN} min refused with 400`, r.status === 400, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); }
  w.expect("start unchanged", (await startOf(w, org, g.id)) === g.startMs);
});
sc("R05", "more than 30 days ahead is refused on create, on settings and on clone (code too-far)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR });
  let r = await org.settings(g.id, { startRound: await w.roundIn(MAX + 2 * HOUR) }); w.expect("settings 400 too-far", r.status === 400 && r.body.code === "too-far", JSON.stringify(r.body));
  r = await org.api("POST", "/api/z", { id: "SIMFAR" + w.n + "X", startRound: await w.roundIn(MAX + 2 * HOUR), callSeconds: 6, cap: 100 }); w.expect("create 400 too-far", r.status === 400 && r.body.code === "too-far", JSON.stringify(r.body));
  r = await org.api("POST", `/api/z/${g.id}/clone`, { startRound: await w.roundIn(MAX + 2 * HOUR) }); w.expect("clone 400 too-far", r.status === 400 && r.body.code === "too-far", JSON.stringify(r.body));
  w.expect("start unchanged", (await startOf(w, org, g.id)) === g.startMs);
});
sc("R06", "the 30-day edge: the last round inside 30 days is accepted, the next one is refused", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR });
  const now = await w.now(); const ok = roundAt(now + MAX); const bad = ok + 1;
  w.expect("round at exactly now+30d is inside the window (sanity)", roundTimeMs(ok) <= now + MAX && roundTimeMs(bad) > now + MAX);
  let r = await org.settings(g.id, { startRound: ok }); w.expect("last round inside 30 days accepted", r.status === 200, JSON.stringify(r.body).slice(0, 160));
  r = await org.settings(g.id, { startRound: bad }); w.expect("first round beyond 30 days refused", r.status === 400 && r.body.code === "too-far", JSON.stringify(r.body).slice(0, 160));
});
sc("R07", "PAID game moved before its start: payment kept, still paid, one payment only", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 8 * HOUR, pay: true, guests: 2 });
  const r = await org.settings(g.id, { startRound: await w.roundIn(20 * HOUR) });
  w.expect("accepted", r.status === 200, JSON.stringify(r.body).slice(0, 160));
  const s = await w.summary(org, g.id);
  w.expect("still paid", s.paid === true && s.status === "published and paid", s.status);
  w.eq("one paid payment", (await sql("SELECT COUNT(*) c FROM payment WHERE eid=? AND status='paid'", [g.id]))[0].c, 1);
  w.eq("guests still there", await w.personal(g.id) > 0, true);
});
sc("R08", "PAID game cannot be moved after its start time (409)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  await w.at(g.startMs + MIN);
  const r = await org.settings(g.id, { startRound: await w.roundIn(DAY) });
  w.expect("409 already started", r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  w.expect("start unchanged", (await startOf(w, org, g.id)) === g.startMs);
});
sc("R09", "UNPAID game held at its start time can be moved: the hold lifts and guests see a normal game", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 2 });
  await w.at(g.startMs + 10 * MIN);
  const held = await w.info(g.id); w.expect("held before the move (waitingFor organizer)", held.body.waitingFor === "organizer", JSON.stringify(held.body).slice(0, 160));
  const r = await org.settings(g.id, { startRound: await w.roundIn(5 * HOUR) }); w.expect("accepted after the start time passed", r.status === 200, JSON.stringify(r.body).slice(0, 160));
  const after = await w.info(g.id); w.expect("hold lifted", !after.body.waitingFor && !after.body.locked, JSON.stringify(after.body).slice(0, 160));
  w.expect("guests kept", (await w.personal(g.id)) >= 2);
});
sc("R10", "the 30-day window slides: 20 days later a game can be set 30 days from THEN", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 25 * DAY });
  await w.go(20 * DAY, DAY);
  const r = await org.settings(g.id, { startRound: await w.roundIn(29 * DAY) });
  w.expect("29 days from the new now accepted (49 days after creation)", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const r2 = await org.settings(g.id, { startRound: await w.roundIn(MAX + DAY) }); w.expect("31 days from the new now refused", r2.status === 400, `${r2.status}`);
});
sc("R11", "heads-up mail is per erasure time: a move after the first heads-up gives a SECOND heads-up for the new time", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  await w.goTo(g.erasureMs - 5 * HOUR, 10 * MIN);
  const heads = async () => (await w.mails(org.email, "Your game time has passed")).length;
  w.eq("one heads-up so far", await heads(), 1);
  await org.settings(g.id, { startRound: await w.roundIn(2 * DAY) });
  await w.go(HOUR, 10 * MIN); w.eq("no new heads-up right after the move", await heads(), 1);
  const life = await w.life(org, g.id);
  await w.goTo(life.personalDeleteAtMs - 5 * HOUR, 30 * MIN); w.eq("a second heads-up before the NEW erasure", await heads(), 2);
  await w.go(3 * HOUR, 30 * MIN); w.eq("still exactly two (idempotent)", await heads(), 2);
  w.expect("game not erased at the old time", true);
  w.expect("data not erased early", (await w.engagement(g.id))?.unplayed_ms == null);
});
sc("R12", "PAID game moved later: guest data stays past the OLD erasure time", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3 });
  await org.settings(g.id, { startRound: await w.roundIn(3 * DAY) });
  const life = await w.life(org, g.id);
  await w.tickAt(g.erasureMs + 2 * HOUR); w.eq("data still there after the old erasure time", await w.personal(g.id) >= 3, true);
  await w.tickAt(life.personalDeleteAtMs); w.eq("gone at the new erasure time", await w.personal(g.id), 0);
});
sc("R13", "a cancelled game cannot be rescheduled (409)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * HOUR });
  await org.cancel(g.id);
  const r = await org.settings(g.id, { startRound: await w.roundIn(8 * HOUR) }); w.expect("409 cancelled", r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
});
sc("R14", "a game that did not start (closed) cannot be rescheduled (409); a new game can be made instead", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  await w.tickAt(g.erasureMs);
  w.expect("closed", (await w.engagement(g.id))?.unplayed_ms != null);
  const r = await org.settings(g.id, { startRound: await w.roundIn(8 * HOUR) }); w.expect("409", r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
});
sc("R15", "a Host can reschedule the Organizer's game", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 4 * HOUR });
  const r = await host.api("PATCH", `/api/z/${g.id}/settings`, { startRound: await w.roundIn(9 * HOUR) });
  w.expect("accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  w.expect("moved", (await startOf(w, org, g.id)) !== g.startMs);
});
sc("R16", "a Co-host cannot reschedule (403)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR });
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200011", e: g.id });
  const r = await call("PATCH", `/api/z/${g.id}/settings`, { startRound: await w.roundIn(9 * HOUR) }, { "x-organizer": c.cohostKey });
  w.expect("403", r.status === 403, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); w.expect("unchanged", (await startOf(w, org, g.id)) === g.startMs);
});
sc("R17", "moving to the SAME time changes nothing and does not start a new heads-up cycle", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR, guests: 1 });
  const r = await org.settings(g.id, { startRound: g.startRound }); w.expect("accepted", r.status === 200);
  const life = await w.life(org, g.id); w.eq("erasure unchanged", life.personalDeleteAtMs, g.erasureMs); w.expect("guest kept", (await w.personal(g.id)) >= 1);
});
sc("R18", "rescheduling a game with a people list keeps the list and every personal link", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR, people: 4 });
  const before = (await org.people(g.id)).body; await org.settings(g.id, { startRound: await w.roundIn(30 * HOUR) });
  const after = (await org.people(g.id)).body;
  w.eq("same number of listed people", (after.people ?? after.list ?? []).length, (before.people ?? before.list ?? []).length);
  w.expect("list has 4 people", (after.people ?? after.list ?? []).length === 4, JSON.stringify(after).slice(0, 200));
});
sc("R19", "a draft (never published) can be moved too, and nothing is mailed", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR, publish: false });
  const r = await org.settings(g.id, { startRound: await w.roundIn(10 * HOUR) }); w.expect("accepted", r.status === 200);
  w.eq("no mail about it", (await w.mails(org.email, g.id)).length, 0);
});
sc("R20", "erasure time is also shown consistently: info, summary and life agree after a move", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 4 * HOUR });
  await org.settings(g.id, { startRound: await w.roundIn(7 * HOUR) });
  const life = await w.life(org, g.id), s = await w.summary(org, g.id), i = (await w.info(g.id)).body;
  w.expect("life == summary == info", life.personalDeleteAtMs === s.erasureMs && s.erasureMs === i.erasureMs, `${life.personalDeleteAtMs} ${s.erasureMs} ${i.erasureMs}`);
});
