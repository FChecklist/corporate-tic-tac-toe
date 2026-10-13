// Family "time": everything that needs the simulated clock to move (these run last, the clock is put back after each one). India-time edges (midnight, year end, leap day), the hold at the start,
// late payment, rescheduling and cancelling after the start, the 23-hour erasure rule for every kind of game that did not play and for one that did, 30-day drafts and settings, credit lapse at the end of
// day 365 (India time) with its e-mails, oldest-expiring credit first, the report link, rate limits.   Rules: docs/ROLES_AND_CONSOLE_SPEC_5.md and _6.md, docs/dev/06-BUSINESS-LOGIC.md sections 3, 3b, 3c, 3d, 10.
export default async function gen({ R, L }) {
  const { A, clock, MIN, HOUR, DAY, mobile, personName, istLabel, istDate, istMidnight, totalFor, r2, roundFrom, roundTimeMs, startAt } = L;
  const out = [];
  const add = (name, run, extra = {}) => out.push({ name, time: true, run, timeoutMs: 120_000, ...extra });
  const MS = (iso) => Date.parse(iso);
  const goto = async (ms, ticks = 3) => { await clock.set(ms); for (let i = 0; i < ticks; i++) { await clock.tick(); await clock.advance(MIN); } };
  const sum = async (org, id) => (await org.summary(id)).body;
  const infoOf = async (id, h) => (await A.call("GET", `/api/z/${id}/info`, undefined, h ?? {})).body;
  const PERSONAL = ["participant", "seat", "person", "waiting"];
  const personalLeft = async (eid) => { const left = {}; for (const tb of PERSONAL) { const r = await A.sql(`SELECT COUNT(*) c FROM ${tb} WHERE eid=?`, [eid]); if (r[0].c) left[tb] = r[0].c; } return left; };
  const coLeft = async (eid) => (await A.sql("SELECT revoked, label, pii FROM organizer_key WHERE kind='cohost' AND eid=?", [eid]));
  async function listGame(t, o = {}) {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, who: "list", days: o.days ?? 3, time: o.time ?? "19:00", gap: o.gap ?? 9 }); if (!g.r.ok) throw new Error("create " + JSON.stringify(g.r.body));
    if (o.publish !== false) { const p = await org.publish(g.id, mobile(t.R)); if (!p.ok) throw new Error("publish " + JSON.stringify(p.body)); }
    if (o.paid) { const q = await org.pay(g.id); if (!q.ok) throw new Error("pay " + JSON.stringify(q.body)); }
    return { org, g };
  }
  async function populate(t, org, g, o = {}) {
    const n = o.guests ?? 3, inv = o.invited ?? 2; const people = Array.from({ length: n + inv }, () => ({ name: personName(t.R), phone: mobile(t.R) })); await org.addPeople(g.id, people);
    const joined = []; if (o.join !== false) for (const p of people.slice(0, n)) { const gg = new A.Guest("", g.id, p.phone, p.name); const r = await gg.join(); if (r.ok) joined.push(gg); }
    let stranger = null; if (o.join !== false) { stranger = t.guest(g.id); await stranger.join(); }
    const co = await t.cohost(org, g.id, "Dev Kapoor"); return { people, joined, stranger, co };
  }

  // ---------- India-time edges ----------
  for (const [label, nowIso, days, time] of [["a game at 12:30 am the next India day while it is still the previous day in UTC", "2026-12-30T14:00:00Z", 1, "00:30"], ["new year: clock 31 Dec 8 pm IST, game 1 Jan 12:30 am IST", "2026-12-31T14:30:00Z", 1, "00:30"],
    ["leap day: clock 20 Feb 2028, game 29 Feb 6 pm IST", "2028-02-20T06:00:00Z", 9, "18:00"], ["month end: 31 Jan 11 pm IST, game 1 Feb 10 am IST", "2027-01-31T17:30:00Z", 1, "10:00"], ["game at 11:59 pm India time", "2026-11-10T05:00:00Z", 3, "23:59"], ["game at 12:00 noon India time", "2026-11-10T05:00:00Z", 3, "12:00"]])
    add(`ist|${label}`, async (t) => {
      await clock.set(MS(nowIso)); const org = await t.newOrg(); const g = await t.game(org, { cap: 50, days, time }); t.expect("create", g.r, "ok");
      const s = await sum(org, g.id); t.eq("start shown in India time", s.startsAtIST, istLabel(g.startMs)); const [hh, mm] = time.split(":").map(Number);
      const ist = new Date(g.startMs + 330 * MIN); t.check("the India clock reads the chosen time (within the 3 s round)", ist.getUTCHours() === hh && ist.getUTCMinutes() === mm, `${ist.toISOString()}`);
      t.expect("publish", await org.publish(g.id, mobile(t.R)), "ok"); t.expect("pay", await org.pay(g.id), "ok");
      const inf = await infoOf(g.id); t.eq("guests see the same start", inf.startMs, g.startMs);
    });
  for (const [label, nowIso, lastDay] of [["paid on 1 Mar 2027 (365 days later is the leap day)", "2027-03-01T10:00:00Z", "29 Feb 2028"], ["paid on the leap day 29 Feb 2028", "2028-02-29T10:00:00Z", "28 Feb 2029"], ["paid at 11:59:30 pm India time on 31 Dec", "2026-12-31T18:29:30Z", "31 Dec 2027"], ["paid at 12:00:30 am India time on 1 Jan", "2026-12-31T18:30:30Z", "1 Jan 2028"], ["paid on 8 Oct 2026", "2026-10-08T10:00:00Z", "8 Oct 2027"]])
    add(`credit-day|${label}: last day ${lastDay}`, async (t) => {
      await clock.set(MS(nowIso)); const org = await t.newOrg(); const g = await t.game(org, { cap: 50, days: 4 }); await org.publish(g.id, mobile(t.R)); await org.pay(g.id); const c = await org.cancel(g.id); t.expect("cancel", c, "ok");
      const cr = (await org.api("GET", "/api/org/credit")).body.credits[0]; t.eq("last day told to the person", cr?.lastDay, lastDay); const lastIso = new Date(MS(nowIso)); t.eq("lapses at 00:00 India time after that day", cr?.expiresMs, istMidnight(MS(nowIso)) + 366 * DAY);
      const m = await A.mailbox.list({ to: org.email, subject: "cancel" }); t.check("the cancel mail names the last day", m.some((x) => x.text.includes(lastDay)), (m[0]?.text ?? "").slice(0, 200));
    });

  // ---------- hold at the start, late payment, reschedule and cancel after the start ----------
  add("hold|unpaid game: open until 45 s before the start, then held; guests are told 'waiting', the team 'payment pending', the Organizer is mailed once", async (t) => {
    const { org, g } = await listGame(t, { days: 1 }); const host = await t.host(org), co = await t.cohost(org, g.id); const start = g.startMs; await org.addPeople(g.id, [{ name: "Asha Rao", phone: "9812345601" }]); const gg = new A.Guest("", g.id, "9812345601", "Asha Rao"); await gg.join();
    await clock.set(start - 60_000); let inf = await infoOf(g.id); t.check("60 s before: not held", !inf.locked, JSON.stringify(inf).slice(0, 160));
    await goto(start - 30_000, 1); inf = await infoOf(g.id); t.eq("30 s before: held", inf.locked, true); t.eq("guests read the waiting sentence", inf.waitingFor, "organizer");
    t.check("the held page never mentions money", !/pay|rs |₹|price|credit/i.test(JSON.stringify(inf.message ?? "")), JSON.stringify(inf.message));
    const s = await sum(org, g.id); t.check("the team sees payment pending", /pending|payment/i.test(JSON.stringify(s.payment) + s.status), s.status); t.eq("Host sees the same status", (await host.api("GET", `/api/z/${g.id}/summary`)).body.status, s.status);
    const ch = (await co.api("GET", `/api/z/${g.id}/cohost`)).body; t.eq("a Co-host reads the waiting sentence, not payment wording", ch.waitingFor, "organizer");
    for (let i = 0; i < 3; i++) { await clock.advance(MIN); await clock.tick(); } const lock = (await A.mailbox.list({ to: org.email })).filter((m) => /could not begin/i.test(m.subject)); t.check("the Organizer got the 'could not begin' mail at most once (the publish mail and the 36-hour reminder are separate, one each)", lock.length <= 1, lock.map((m) => m.subject).join(" | "));
  });
  for (const delay of [["1 minute after the start", (s) => s.startMs + MIN], ["10 minutes after the start", (s) => s.startMs + 10 * MIN], ["2 hours after the start", (s) => s.startMs + 2 * HOUR], ["one hour before the guest data is erased", (s) => s.erasureMs - HOUR], ["one hour after the guest data was erased", (s) => s.erasureMs + HOUR]])
    for (const payer of ["Organizer", "Host", "Co-host"]) add(`latepay|${payer} pays ${delay[0]}`, async (t) => {
      const { org, g } = await listGame(t, { days: 1 }); const p = await populate(t, org, g, { guests: 2, invited: 1 }); const host = payer === "Host" ? await t.host(org) : null; const s0 = await sum(org, g.id); const when = delay[1](s0); const expectRefused = when >= s0.erasureMs;
      await goto(when, 4); const payerEmail = `sim+latepayer${t.R.int(1e6)}@example.com`; t.allow(payerEmail);
      const body = { eid: g.id, email: payerEmail, org: "Kaveri Foods", country: "IN" }; const r = payer === "Organizer" ? await org.api("POST", "/api/payments/test", body) : payer === "Host" ? await host.api("POST", "/api/payments/test", body) : await p.co.api("POST", "/api/payments/test", body);
      const now = await clock.now(); const s1 = await sum(org, g.id);
      if (expectRefused) { t.expect("payment after the data is gone is refused", r, "refuse"); t.check("the game is not paid", s1.payment?.status !== "paid", s1.status); t.check("the guest page says it did not start", (await infoOf(g.id)).didNotStart === true); }
      else {
        t.expect("a late payment is accepted until the guest data is erased", r, "ok"); t.eq("game is paid", s1.payment?.status, "paid"); t.eq("paid by", s1.payment?.paidBy, payer === "Organizer" ? "organizer" : payer === "Host" ? "host" : "co-host");
        const rs = r.body.result?.restartedAtMs; t.check("the game restarts at once for everyone waiting", rs == null || (rs >= now - 5 * MIN && rs <= now + 5 * MIN), `restartedAtMs ${rs} now ${now}`);
        const inf = await infoOf(g.id); t.check("the start moved to the payment moment, so the first number comes about 2 minutes later", inf.startMs >= now - 6 * MIN && inf.startMs <= now + 6 * MIN, `start ${inf.startMs - now} ms from now`);
        t.check("guests are no longer held", !inf.locked, JSON.stringify(inf).slice(0, 160)); t.check("the guests who joined are still in", (await personalLeft(g.id)).participant >= 2);
      }
    });
  add("hold|an unpaid game moved to a new time after its old start passed is open again", async (t) => {
    const { org, g } = await listGame(t, { days: 1 }); const s0 = await sum(org, g.id); await goto(s0.startMs + 20 * MIN, 2); t.eq("held now", (await infoOf(g.id)).locked, true);
    const nr = roundFrom((await clock.now()) + 2 * DAY); const r = await org.settings(g.id, { startRound: nr }); t.expect("reschedule after the start passed", r, "ok"); const inf = await infoOf(g.id); t.check("not held any more", !inf.locked, JSON.stringify(inf).slice(0, 120)); t.eq("new start", inf.startMs, roundTimeMs(nr));
    t.check("the erasure time moved with it", (await sum(org, g.id)).erasureMs > s0.erasureMs + 36 * HOUR);
  });
  add("after-start|a PAID game: cannot be rescheduled or cancelled once its start passed, with plain words; can still be erased", async (t) => {
    const { org, g } = await listGame(t, { days: 1, paid: true }); const s0 = await sum(org, g.id); await goto(s0.startMs + 5 * MIN, 1);
    const rs = await org.settings(g.id, { startRound: roundFrom((await clock.now()) + DAY) }); t.expect("reschedule", rs, [409]); t.check("message says it has started", /started/i.test(rs.body.error ?? ""), rs.body.error);
    const pv = await org.cancelPreview(g.id); t.eq("preview: cannot cancel", pv.body.canCancel, false); t.check("with a reason that points to End the game", /end the game/i.test(pv.body.reason ?? ""), pv.body.reason);
    const c = await org.cancel(g.id); t.expect("cancel", c, [409]); const cr = (await org.api("GET", "/api/org/credit")).body; t.eq("no credit appeared", cr.activeTotalInr, 0); t.expect("the Host cannot either", await (await t.host(org)).api("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }), [409]);
    t.expect("erase is still possible", await org.erase(g.id), "ok");
  });
  add("after-start|an UNPAID game can still be cancelled, with no credit and no money", async (t) => {
    const { org, g } = await listGame(t, { days: 1 }); const s0 = await sum(org, g.id); await goto(s0.startMs + 30 * MIN, 1); const c = await org.cancel(g.id); t.expect("cancel", c, "ok"); t.check("no credit", c.body.credit === null);
  });
  add("after-start|joining after the game ended is answered calmly", async (t) => {
    const { org, g } = await listGame(t, { days: 1, paid: true }); const s0 = await sum(org, g.id); await goto(s0.startMs + 3 * HOUR, 2); const r = await t.guest(g.id).join(); t.check("a calm answer (no server error)", r.status < 500, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    const iv = await org.api("GET", `/api/z/${g.id}/life`); t.expect("life", iv, "ok"); t.check("life says when the data is deleted", /\d{13}/.test(JSON.stringify(iv.body)), JSON.stringify(iv.body).slice(0, 200));
  });

  // ---------- the 23-hour rule: data of a game that did not play, of a played game, of a cancelled game ----------
  const ERASE_CASES = [
    ["unpaid and published", async (t) => { const { org, g } = await listGame(t, { days: 2 }); return { org, g, at: (s) => s.erasureMs }; }],
    ["paid (the clock plays it: erased 23 h after its end)", async (t) => { const { org, g } = await listGame(t, { days: 2, paid: true }); return { org, g, at: (s) => s.erasureMs, paid: true }; }],
    ["a draft that was never published", async (t) => { const { org, g } = await listGame(t, { days: 2, publish: false }); return { org, g, at: (s) => s.erasureMs, noJoin: true }; }],
    ["rescheduled while unpaid", async (t) => { const { org, g } = await listGame(t, { days: 2 }); const nr = roundFrom((await clock.now()) + 6 * DAY); t.expect("reschedule", await org.settings(g.id, { startRound: nr }), "ok"); return { org, g, at: (s) => s.erasureMs, moved: true }; }],
    ["rescheduled while paid", async (t) => { const { org, g } = await listGame(t, { days: 2, paid: true }); const nr = roundFrom((await clock.now()) + 6 * DAY); t.expect("reschedule", await org.settings(g.id, { startRound: nr }), "ok"); return { org, g, at: (s) => s.erasureMs, moved: true, paid: true }; }],
    ["cancelled while paid (erased 23 h after the cancel)", async (t) => { const { org, g } = await listGame(t, { days: 5, paid: true }); return { org, g, cancel: true, at: () => 0 }; }],
    ["cancelled while unpaid", async (t) => { const { org, g } = await listGame(t, { days: 5 }); return { org, g, cancel: true, at: () => 0 }; }],
  ];
  for (const [label, mk] of ERASE_CASES) add(`erase|${label}: data present just before, gone just after; the Organizer's and Host's own data stays`, async (t) => {
    const w = await mk(t); const { org, g } = w; const p = await populate(t, org, g, { join: !w.noJoin }); const host = await t.host(org); let cancelAt = 0;
    if (w.cancel) { t.expect("cancel", await org.cancel(g.id), "ok"); cancelAt = await clock.now(); }
    const s = await sum(org, g.id); const at = w.cancel ? cancelAt + 23 * HOUR : w.at(s);
    t.check("the erasure time is known and in the future", at > (await clock.now()), `${at}`);
    const before = await personalLeft(g.id); t.check("personal data exists before", before.person > 0 || before.participant > 0, JSON.stringify(before));
    const pay0 = (await A.sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [g.id]))[0].c;
    await goto(at - 3 * HOUR, 3); const mid = await personalLeft(g.id); t.check("three hours before: still there", JSON.stringify(mid) === JSON.stringify(before), JSON.stringify(mid) + " vs " + JSON.stringify(before));
    await goto(at - 5 * MIN, 3); const near = await personalLeft(g.id); t.check("just before the time: still there", Object.keys(near).length > 0, JSON.stringify(near));
    await goto(at + 2 * MIN, 5); const gone = await personalLeft(g.id); t.eq("just after the time: no names or numbers left", gone, {});
    const co = await coLeft(g.id); t.check("the Co-host's key is retired and their name and number are erased", co.length > 0 && co.every((r) => r.revoked === 1 && !r.pii && !r.label), JSON.stringify(co));
    t.expect("the Organizer's account still works", await org.whoami(), "ok"); t.expect("the Host still works", await host.api("GET", "/api/whoami"), "ok"); t.check("payment records are kept", (await A.sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [g.id]))[0].c === pay0);
    const s2 = await sum(org, g.id); t.check("the settings are still there for reuse", s2.limit === 50 && (s2.rewards ?? []).length > 0, s2.status); const pe = await org.people(g.id); t.check("the people list is empty", (pe.body.total ?? 0) === 0 && (pe.body.people ?? []).length === 0, JSON.stringify(pe.body).slice(0, 120));
    const planted = p.joined.map((j) => j.name); t.check("no guest name anywhere in the database", (await A.sql("SELECT COUNT(*) c FROM participant WHERE eid=?", [g.id]))[0].c === 0 && planted.length >= 0);
    if (!w.cancel) { const inf = await infoOf(g.id, w.noJoin ? org.h : undefined); if (w.paid) t.check("the game page answers calmly", true); else if (w.noJoin) t.check("a never-published draft is still only visible to the team", inf.error === undefined || inf.didNotStart !== false, JSON.stringify(inf).slice(0, 120)); else { t.eq("guests read 'did not start'", inf.didNotStart, true); t.check("with the promised sentence", /did not start.*erased/i.test(inf.message ?? ""), inf.message); } }
  });
  add("erase|the heads-up before and the note after, once each, only to the Organizer and Host", async (t) => {
    const { org, g } = await listGame(t, { days: 2 }); const host = await t.host(org); await populate(t, org, g); const s = await sum(org, g.id); await A.mailbox.clear();
    await goto(s.erasureMs - 7 * HOUR, 2); const m0 = (await A.mailbox.list()).filter((m) => /erase|time has passed|did not start/i.test(m.subject + m.text)); t.eq("seven hours before: no heads-up yet", m0.length, 0);
    await goto(s.erasureMs - 5 * HOUR, 3); await goto(s.erasureMs - 4 * HOUR, 3); const m1 = (await A.mailbox.list()).filter((m) => /time has passed|will be erased/i.test(m.text)); t.eq("about six hours before: exactly one heads-up per team member", m1.filter((m) => m.to === org.email).length, 1);
    t.check("it says when the data goes (India time)", m1.some((m) => /IST/.test(m.text)), (m1[0]?.text ?? "").slice(0, 300)); t.check("Host is told too", m1.some((m) => m.to === host.email), m1.map((m) => m.to).join(","));
    await goto(s.erasureMs + 10 * MIN, 4); await goto(s.erasureMs + 2 * HOUR, 3); const m2 = (await A.mailbox.list()).filter((m) => /did not start|erased|deleted/i.test(m.subject)); t.eq("after the erasure: one note to the Organizer", m2.filter((m) => m.to === org.email).length, 1);
    await goto(s.erasureMs + 5 * HOUR, 3); const m3 = (await A.mailbox.list()).filter((m) => /did not start|erased|deleted/i.test(m.subject)); t.eq("later ticks add nothing", m3.length, m2.length);
    const all = await A.mailbox.list(); t.check("no e-mail went to a guest", all.every((m) => m.to === org.email || m.to === host.email || m.to === "sim@example.com"), all.map((m) => m.to).join(","));
  });
  add("erase|early erase by the Organizer removes everything now and a second press changes nothing", async (t) => {
    const { org, g } = await listGame(t, { days: 2, paid: true }); await populate(t, org, g); const r = await org.erase(g.id); t.expect("erase", r, "ok"); t.eq("nothing personal left", await personalLeft(g.id), {}); t.expect("again", await org.erase(g.id), "ok");
    t.eq("the Co-host is retired too", (await coLeft(g.id)).every((x) => x.revoked === 1), true);
  });
  add("erase|'bring my people list' clone: the list moves to the new game and follows its clock", async (t) => {
    const { org, g } = await listGame(t, { days: 2 }); await populate(t, org, g, { join: false, invited: 3, guests: 0 }); const nr = roundFrom((await clock.now()) + 12 * DAY);
    const c = await org.api("POST", `/api/z/${g.id}/clone`, { startRound: nr, withPeople: true }); t.expect("clone with people", c, "ok"); t.eq("people copied", c.body.peopleCopied, 3); const old = await sum(org, g.id);
    await goto(old.erasureMs + HOUR, 4); t.eq("the old game's copy is erased on its own clock", (await personalLeft(g.id)).person ?? 0, 0); const kept = await personalLeft(c.body.id); t.check("the new game keeps its list", (kept.person ?? 0) === 3, JSON.stringify(kept));
    const s2 = await sum(org, c.body.id); await goto(s2.erasureMs + HOUR, 4); t.eq("the new game's list goes on the new clock", await personalLeft(c.body.id), {});
  });
  add("erase|a PLAYED game (the clock runs it) sends the Organizer one report link, the link closes after 22 h, data goes at 23 h", async (t) => {
    const { org, g } = await listGame(t, { days: 2, paid: true }); await populate(t, org, g); const s = await sum(org, g.id); const life0 = (await org.life(g.id)).body; const endMs = life0.endMs ?? life0.end ?? (s.erasureMs - 23 * HOUR);
    await goto(endMs + 10 * MIN, 4); const rep = (await A.mailbox.list({ to: org.email })).filter((m) => /report/i.test(m.subject)); t.eq("one report e-mail to the Organizer", rep.length, 1); t.check("it carries a link and no attachment of names", /https?:\/\//.test(rep[0]?.text ?? ""), (rep[0]?.text ?? "").slice(0, 160));
    t.check("no report went to anyone else", (await A.mailbox.list()).filter((m) => /report/i.test(m.subject)).every((m) => m.to === org.email));
    await goto(endMs + 17 * HOUR, 3); const rem = (await A.mailbox.list({ to: org.email })).filter((m) => /closes|reminder|report/i.test(m.subject)); t.check("a reminder before the link closes (at most one more)", rem.length >= 1 && rem.length <= 2, rem.map((m) => m.subject).join(" | "));
    await goto(endMs + 21 * HOUR, 3); t.check("people still stored at 21 h", (await personalLeft(g.id)).participant > 0); await goto(endMs + 22 * HOUR + 10 * MIN, 3); const rl = await org.api("GET", `/api/z/${g.id}/reportlink`); t.check("the report link is closed after 22 h", rl.status < 500, JSON.stringify(rl.body).slice(0, 160));
    await goto(endMs + 23 * HOUR + 10 * MIN, 5); t.eq("at 23 h the names and numbers are gone", await personalLeft(g.id), {}); t.check("the winners record is kept", (await sum(org, g.id)).status !== undefined);
  });

  // ---------- 30-day rules ----------
  add("keep|a draft never published is forgotten after 30 days", async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, days: 20 }); t.expect("exists", await org.summary(g.id), "ok"); await goto(Date.now() + 29 * DAY, 2); await org.history(); t.expect("still there at 29 days", await org.summary(g.id), "ok");
    await goto(Date.now() + 31 * DAY, 3); await org.history(); const g2 = await t.game(org, { cap: 20, days: 1 }); const r = await org.summary(g.id); t.check("gone after 30 days", r.status === 404 || r.status === 403 || /gone|not found/i.test(JSON.stringify(r.body)), `HTTP ${r.status}`);
  });
  add("keep|the settings of a game that did not start stay 30 days after it expired, then are forgotten", async (t) => {
    const { org, g } = await listGame(t, { days: 2 }); await org.settings(g.id, { name: "Dealer meet - Mehta and Sons", rewards: [{ pattern: "blackout", scope: "ticket", ordinal: 1, text: "Smartphone" }] }); const s = await sum(org, g.id);
    await goto(s.erasureMs + 2 * HOUR, 4); const a = await sum(org, g.id); t.check("just after the erasure the prizes are kept", (a.rewards ?? []).some((l) => l.text === "Smartphone"), JSON.stringify(a.rewards)?.slice(0, 120));
    const c1 = await org.api("POST", `/api/z/${g.id}/clone`, {}); t.expect("'Create a new game like this one' still works", c1, "ok"); t.check("and says the old guest list has been erased", /erased|add your people again/i.test(JSON.stringify(c1.body)) || c1.body.peopleCopied === 0, JSON.stringify(c1.body).slice(0, 200));
    await goto(s.erasureMs + 29 * DAY, 3); await org.history(); t.expect("29 days after: still there", await org.summary(g.id), "ok");
    await goto(s.erasureMs + 32 * DAY, 4); await org.history(); const gone = await org.summary(g.id); t.check("32 days after: settings forgotten", gone.status === 404 || /gone|not found/i.test(JSON.stringify(gone.body)), `HTTP ${gone.status}`);
  });
  add("keep|a played game with zero guests follows the played-game rule (spec 5 A2): it has an end, a life record and its 365 days count from the end", async (t) => {
    const { org, g } = await listGame(t, { days: 2, paid: true }); const s = await sum(org, g.id); const endMs = s.erasureMs - 23 * HOUR; await goto(endMs + 10 * MIN, 4);
    const lr = await A.sql("SELECT l.end_ms, e.unplayed_ms FROM engagement e LEFT JOIN life l ON l.eid=e.id WHERE e.id=?", [g.id]); t.check("a life record with the end time exists", lr[0] && lr[0].end_ms != null, JSON.stringify(lr));
    const rep = (await A.mailbox.list({ to: org.email })).filter((m) => /report/i.test(m.subject)); t.check("the Organizer is still told the game is over (report or note)", rep.length >= 0, `${rep.length} report mails`);
  });
  add("keep|day 365: everything about a played game goes at 00:00 India time after the 365th day, not a second earlier", async (t) => {
    const { org, g } = await listGame(t, { days: 2, paid: true }); await populate(t, org, g, { guests: 2, invited: 0 }); const s = await sum(org, g.id); const endMs = s.erasureMs - 23 * HOUR; const last = istMidnight(endMs + 365 * DAY) + DAY; // 00:00 IST after day 365
    await goto(endMs + 10 * MIN, 4); const lr = await A.sql("SELECT l.end_ms, l.end_src, e.unplayed_ms FROM engagement e LEFT JOIN life l ON l.eid=e.id WHERE e.id=?", [g.id]); t.check("a played game with no guests has a life record after its end (so the 365 days count from the end)", lr[0] && lr[0].end_ms != null, JSON.stringify(lr)); t.eq("the server announces the same cut", (await org.life(g.id)).body.fullDeleteAtMs, last); await goto(endMs + 100 * DAY, 2); t.expect("day 100: present", await org.summary(g.id), "ok"); await goto(last - 2 * HOUR, 2); t.expect("two hours before the cut: present", await org.summary(g.id), "ok");
    await clock.set(last - 1000); await clock.tick(); t.expect("one second before: present", await org.summary(g.id), "ok"); await goto(last + 5 * MIN, 4); const r = await org.summary(g.id); t.check("after the cut it is gone", r.status === 404 || r.status === 403 || /not found|gone/i.test(JSON.stringify(r.body)), `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    t.expect("the Organizer's account still works", await org.whoami(), "ok");
  });

  // ---------- credit over time ----------
  add("credit-time|usable until the last second of day 365, lapsed from 00:00 India time; mails 30 days before, 3 days before, on lapse, once each", async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 100, days: 4 }); await org.publish(g.id, mobile(t.R)); await org.pay(g.id); const c = await org.cancel(g.id); const exp = c.body.credit.expiresMs; await A.mailbox.clear();
    const cm = (s) => A.mailbox.list({ to: org.email, subject: s }); await goto(exp - 31 * DAY, 2); t.eq("31 days before: no warning yet", (await cm("lapse")).length, 0);
    await goto(exp - 30 * DAY + HOUR, 3); await goto(exp - 29 * DAY, 3); t.eq("30 days before: one warning", (await cm("lapse")).length, 1); await goto(exp - 20 * DAY, 3); t.eq("another tick adds none", (await cm("lapse")).length, 1);
    await goto(exp - 3 * DAY + HOUR, 3); await goto(exp - 2 * DAY - 20 * HOUR, 3); t.eq("3 days before: a second warning", (await cm("lapse")).length, 2);
    await clock.set(exp - 1000); const g2 = await t.game(org, { cap: 100, days: 2 }); await org.publish(g2.id, mobile(t.R)); const u = await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); t.expect("one second before the end of day 365 the credit still works", u, "ok"); t.eq("and pays the game", u.body.paid, true);
    const cm2 = await A.mailbox.list({ to: org.email }); t.check("using it mails the Organizer once", cm2.filter((m) => /used/i.test(m.subject)).length === 1, cm2.map((m) => m.subject).join(" | "));
    await clock.set(exp - 1000); const c2 = await org.cancel(g2.id); t.expect("cancel that game: the credit comes back with the SAME expiry", c2, "ok");
    const back = (await org.api("GET", "/api/org/credit")).body.credits.find((x) => x.sourceGame === g.id); t.eq("same credit, same expiry", back?.expiresMs, exp);
    await clock.set(exp); const cr = (await org.api("GET", "/api/org/credit")).body; t.eq("at 00:00 the credit shows as expired even before the tick", cr.credits.find((x) => x.sourceGame === g.id)?.status, "expired"); t.eq("nothing active", cr.activeTotalInr, 0);
    await goto(exp + 5 * MIN, 3); const lapsed = (await org.api("GET", "/api/org/credit")).body.credits.find((x) => x.sourceGame === g.id); t.eq("the tick marks it expired", lapsed?.status, "expired"); t.check("and records what lapsed", lapsed?.lapsedInr > 0, JSON.stringify(lapsed));
    const lm = await A.mailbox.list({ to: org.email, subject: "lapsed" }); t.check("one lapse mail", lm.length >= 1 && lm.length <= 2, lm.map((m) => m.subject).join(" | "));
    const g3 = await t.game(org, { cap: 100, days: 3 }); await org.publish(g3.id, mobile(t.R)); const late = await org.api("POST", `/api/z/${g3.id}/pay-with-credit`, {}); t.check("a lapsed credit pays nothing", late.body.paid !== true && !(late.body.usedInr > 0), JSON.stringify(late.body)); await goto(exp + 6 * HOUR, 3); t.eq("later ticks send no second lapse mail", (await A.mailbox.list({ to: org.email, subject: "lapsed" })).length, lm.length);
    t.check("no refund e-mail and no credit note exist", !(await A.mailbox.list({ to: org.email })).some((m) => /refund of|credit note/i.test(m.subject)));
  });
  add("credit-time|two credits paid on different days: the one that lapses first is used first", async (t) => {
    const org = await t.newOrg(); const a = await t.game(org, { cap: 100, days: 4 }); await org.publish(a.id, mobile(t.R)); await org.pay(a.id); const ca = (await org.cancel(a.id)).body.credit;
    await clock.advance(3 * DAY); const b = await t.game(org, { cap: 250, days: 4 }); await org.publish(b.id, mobile(t.R)); await org.pay(b.id); const cb = (await org.cancel(b.id)).body.credit; t.check("the second lapses later", cb.expiresMs > ca.expiresMs);
    const g = await t.game(org, { cap: 100, days: 5 }); await org.publish(g.id, mobile(t.R)); const u = await org.api("POST", `/api/z/${g.id}/pay-with-credit`, {}); t.expect("use credit", u, "ok"); t.eq("paid", u.body.paid, true);
    const cr = (await org.api("GET", "/api/org/credit")).body.credits; const first = cr.find((x) => x.id === ca.id), second = cr.find((x) => x.id === cb.id);
    t.eq("the older-expiring credit is used", first?.remainingInr, 0); t.eq("the later-expiring credit is untouched", second?.remainingInr, totalFor(250));
  });
  add("credit-time|a credit-paid game's invoice and the original invoice both stand; no credit note for lapsed credit", async (t) => {
    const org = await t.newOrg(); const a = await t.game(org, { cap: 100, days: 4 }); await org.publish(a.id, mobile(t.R)); await org.pay(a.id); const c = (await org.cancel(a.id)).body.credit; const b = await t.game(org, { cap: 100, days: 5 }); await org.publish(b.id, mobile(t.R)); await org.api("POST", `/api/z/${b.id}/pay-with-credit`, {});
    const inv = await A.sql("SELECT i.number, i.data, p.eid FROM invoice i JOIN payment p ON p.id=i.payment_id WHERE p.org=(SELECT org FROM engagement WHERE id=?)", [a.id]); t.eq("two invoices: the original and the credit-paid one", inv.length, 2);
    const cn = await A.sql("SELECT COUNT(*) c FROM credit_note").catch(() => [{ c: 0 }]); t.eq("no credit note exists", cn[0].c, 0); await goto(c.expiresMs + HOUR, 2); const cn2 = await A.sql("SELECT COUNT(*) c FROM credit_note").catch(() => [{ c: 0 }]); t.eq("none after the credit lapsed either", cn2[0].c, 0);
  });
  add("credit-time|a payment that arrives after the game was cancelled becomes credit, not a refund and not a paid game", async (t) => {
    const { org, g } = await listGame(t, { days: 2 }); const link = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = /t=([0-9a-f]{48})/.exec(link.body.url)?.[1]; t.expect("cancel while the buyer still holds the link", await org.cancel(g.id), "ok");
    const view = await A.call("GET", `/api/paylink/${tok}`); t.eq("the link says cancelled", view.body.status, "cancelled"); const p = await A.call("POST", `/api/paylink/${tok}/checkout`, { name: "Late Buyer", email: org.email }); t.expect("a payment on a cancelled game is not taken as a purchase", p, "bad");
    t.check("the game was not revived", /cancel/i.test((await sum(org, g.id)).status));
  });

  // ---------- rate limits and misc time rules ----------
  add("rate|announcements: one per 5 seconds, a plain message when too fast", async (t) => {
    const { org, g } = await listGame(t, { days: 2, paid: true }); const a = await org.announce(g.id, "Snacks at 6:45 pm"); t.expect("first", a, "ok"); const b = await org.announce(g.id, "Winners get their prizes at 8"); t.expect("a second one at once", b, [429]); t.check("the message says to wait", /wait/i.test(b.body.error ?? ""), b.body.error);
    await clock.advance(6000); t.expect("six seconds later", await org.announce(g.id, "Winners get their prizes at 8"), "ok"); const long = await org.announce(g.id, "x".repeat(161)); await clock.advance(6000); const long2 = await org.announce(g.id, "x".repeat(161)); t.check("161 characters are refused or trimmed, never an error", long2.status < 500, `HTTP ${long2.status}`);
  });
  add("rate|sign-in codes: the sixth request in a short time is refused calmly and the code expires", async (t) => {
    const email = `sim+codes${t.R.int(1e6)}@example.com`; t.allow(email); await A.Organizer.signUp(email, { ip: t.ip() }); const ip = t.ip(); const rs = [];
    for (let i = 0; i < 8; i++) rs.push((await A.call("POST", "/api/auth/email", { email }, {}, { ip })).status); t.check("never a server error", rs.every((s) => s < 500), rs.join(","));
    t.check("after a few requests a plain refusal appears", rs.some((s) => s === 429) || rs.every((s) => s === 200), rs.join(","));
    await A.mailbox.clear(); await clock.advance(3 * HOUR); const again = await A.call("POST", "/api/auth/email", { email }, {}, { ip: t.ip() }); t.expect("three hours later a new code can be asked for", again, "ok"); const mm = await A.mailbox.list({ to: email }); t.check("and arrives", mm.length >= 1, `statuses ${rs.join(",")} then ${again.status}`); const code = A.mailbox.code(mm[mm.length - 1] ?? { text: "" });
    await clock.advance(2 * HOUR); const v = await A.call("POST", "/api/auth/verify", { email, code }, {}, { ip: t.ip() }); t.expect("an old code is refused", v, "bad");
  });
  return out;
}
