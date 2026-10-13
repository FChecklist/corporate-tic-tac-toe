// E-scenarios: erasure of guest data (23 h after the end, for played AND unplayed games, after a cancel), what stays, and the mails around it.
// Spec: docs/ROLES_AND_CONSOLE_SPEC_5.md A.1-A.4, A.7; docs/PRIVACY_AND_LIFECYCLE.md.
import { sc, HOUR, MIN, DAY, sql, call, mailbox } from "./lib.mjs";

const PERSONAL = ["participant", "seat", "person", "waiting", "claim", "settled", "rvote", "rcand", "overvote"];
const rowsAll = async (eid) => { const o = {}; for (const t of PERSONAL) { const c = (await sql(`SELECT COUNT(*) c FROM ${t} WHERE eid=?`, [eid]))[0].c; if (c) o[t] = c; } return o; };

sc("E01", "PLAYED game: guests, people list and Co-host details exist 1 ms before end+23h and are all gone AT end+23h", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3, people: 2 });
  await org.inviteCohost({ label: "Chitra", phone: "9822200021", e: g.id });
  await w.goTo(g.endMs + 10 * MIN, 5 * MIN); // the game was played (time passed), the report went out
  w.expect("report mail went to the Organizer", (await w.mails(org.email, "game report")).length === 1, JSON.stringify((await w.mails(org.email)).map((m) => m.subject)));
  await w.tickAt(g.erasureMs - 1);
  w.expect("guests present 1 ms before", (await w.personal(g.id)) >= 5, JSON.stringify(await rowsAll(g.id)));
  w.eq("Co-host details present 1 ms before", await w.cohostRows(g.id), 1);
  await w.tickAt(g.erasureMs);
  w.eq("every personal table empty at end+23h", await rowsAll(g.id), {});
  w.eq("Co-host name/number gone", await w.cohostRows(g.id), 0);
  w.expect("life row says purged", (await sql("SELECT purged_ms FROM life WHERE eid=?", [g.id]))[0]?.purged_ms != null);
});
sc("E02", "the minute the data goes: first tick on or after end+23h, never at 22h59 and never later than 23h01", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.goTo(g.endMs + 22 * HOUR, 30 * MIN);
  let gone = null;
  for (let t = g.endMs + 22 * HOUR; t <= g.endMs + 23 * HOUR + 2 * MIN; t += MIN) { await w.tickAt(t); if (!(await w.personal(g.id))) { gone = t; break; } }
  w.expect("erased within [23h, 23h01]", gone !== null && gone >= g.endMs + 23 * HOUR && gone <= g.endMs + 23 * HOUR + MIN, gone === null ? "never" : `at end+${(gone - g.endMs) / MIN} min`);
});
sc("E03", "after the erasure exactly one 'data deleted' mail goes to the Organizer (and each Host); nobody else; repeats send nothing", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.goTo(g.erasureMs - HOUR, 30 * MIN); await w.tickAt(g.erasureMs); for (let i = 0; i < 4; i++) await w.go(30 * MIN, 10 * MIN);
  w.eq("Organizer: one", await w.mailCount(org.email, "personal data has been deleted"), 1);
  w.eq("Host: one", await w.mailCount(host.email, "personal data has been deleted"), 1);
  await w.teamOnly(); await w.noGuestDataInMail();
});
sc("E04", "UNPLAYED published game: heads-up exactly 6 h before the erasure (once), none earlier", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 2 });
  await w.tickAt(g.erasureMs - 6 * HOUR - MIN); w.eq("none at 6h01 before", await w.mailCount(org.email, "Your game time has passed"), 0);
  await w.tickAt(g.erasureMs - 6 * HOUR); w.eq("one at 6h before", await w.mailCount(org.email, "Your game time has passed"), 1);
  const m = (await w.mails(org.email, "Your game time has passed"))[0]; w.expect("mail has the 'Tap to reschedule and keep it' line and the game link", /reschedule and keep it/.test(m.text) && m.text.includes("/zc.html?e=" + g.id), m.text.slice(0, 200));
  await w.go(5 * HOUR, 10 * MIN); w.eq("still one", await w.mailCount(org.email, "Your game time has passed"), 1);
});
sc("E05", "UNPLAYED game after the erasure: closed for everyone, calm messages, no payment possible, settings still readable", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 2, people: 2, name: "Diwali Night" });
  await w.tickAt(g.erasureMs);
  const e = await w.engagement(g.id); w.expect("closed (unplayed_ms set)", e.unplayed_ms != null);
  w.eq("guest data gone", await rowsAll(g.id), {});
  const info = await w.info(g.id); w.expect("guest info: 'This game did not start. Your details have been erased.'", info.body.didNotStart === true && /did not start/i.test(info.body.message ?? ""), JSON.stringify(info.body).slice(0, 200));
  const j = await call("POST", `/api/z/${g.id}/join`, { phone: "9812300001", name: "Late Larry", device: "a".repeat(32) }); w.expect("join refused 403 did-not-start", j.status === 403 && j.body.code === "did-not-start", `${j.status} ${JSON.stringify(j.body).slice(0, 160)}`);
  const s = await w.summary(org, g.id); w.expect("Organizer sees 'did not start (closed)'", /did not start/.test(s.status) && s.name === "Diwali Night", s.status);
  w.eq("one 'did not start' mail", await w.mailCount(org.email, "Your game did not start"), 1);
  const m = (await w.mails(org.email, "Your game did not start"))[0]; w.expect("mail says 'We erased the guest list'", /We erased the guest list/.test(m.text));
});
sc("E06", "UNPLAYED erasure does not touch Organizer/Host data: sign-in, history, mail address, payments", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  await w.tickAt(g.erasureMs);
  w.expect("Organizer key still works", (await org.whoami()).status === 200);
  w.expect("Host key still works", (await host.api("GET", "/api/whoami")).status === 200);
  w.expect("engagement still in history", (await org.history()).body.engagements.some((x) => x.id === g.id));
  w.expect("Organizer e-mail still stored (orgmail)", (await sql("SELECT COUNT(*) c FROM kv WHERE k LIKE 'orgmail/%'"))[0].c >= 1);
  w.expect("Host e-mail still stored", (await sql("SELECT COUNT(*) c FROM organizer_key WHERE kind='host' AND email_sealed IS NOT NULL AND revoked=0"))[0].c >= 1);
});
sc("E07", "PLAYED game with ZERO guests but a people list: the list goes at end+23h with the same mail", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, people: 3 });
  await w.goTo(g.erasureMs - HOUR, 30 * MIN); w.expect("list present", (await w.personal(g.id)) >= 3);
  await w.tickAt(g.erasureMs); w.eq("list gone", await w.personal(g.id), 0); w.eq("one deleted mail", await w.mailCount(org.email, "personal data has been deleted"), 1);
});
sc("E08", "PLAYED game with only a Co-host (nobody joined): Co-host details still go at end+23h", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  await org.inviteCohost({ label: "Chitra", phone: "9822200022", e: g.id });
  await w.tickAt(g.erasureMs - 1); w.eq("present", await w.cohostRows(g.id), 1);
  await w.tickAt(g.erasureMs); w.eq("gone", await w.cohostRows(g.id), 0);
});
sc("E09", "CANCELLED paid game: Co-host details go AT cancel; guests 23 h after the CANCEL time (not the game time)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 5 * DAY, pay: true, guests: 3, people: 2 });
  await org.inviteCohost({ label: "Chitra", phone: "9822200023", e: g.id }); await w.goTo(g.startMs - 3 * DAY, DAY);
  const cancelAt = await w.now(); const r = await org.cancel(g.id); w.expect("cancelled", r.status === 200);
  w.eq("Co-host gone at once", await w.cohostRows(g.id), 0);
  await w.tickAt(cancelAt + 23 * HOUR - 1); w.expect("guests still there 1 ms before cancel+23h", (await w.personal(g.id)) >= 5);
  await w.tickAt(cancelAt + 23 * HOUR); w.eq("guests gone at cancel+23h", await w.personal(g.id), 0);
  w.eq("one deleted mail", await w.mailCount(org.email, "personal data has been deleted"), 1);
});
sc("E10", "CANCELLED unpaid game: same, clock from the cancel time", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 3 * DAY, guests: 2 });
  await w.goTo(g.startMs - DAY, 6 * HOUR); const cancelAt = await w.now(); await org.cancel(g.id);
  await w.tickAt(cancelAt + 23 * HOUR - 1); w.expect("present", (await w.personal(g.id)) >= 2);
  await w.tickAt(cancelAt + 23 * HOUR); w.eq("gone", await w.personal(g.id), 0);
});
sc("E11", "winners record, payment and invoice stay after the guest erasure (only personal data goes)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.tickAt(g.erasureMs);
  w.eq("engagement row stays", (await w.engagement(g.id)) != null, true);
  w.expect("payment row stays", (await sql("SELECT COUNT(*) c FROM payment WHERE eid=? AND status='paid'", [g.id]))[0].c === 1);
  w.expect("invoice stays", (await sql("SELECT COUNT(*) c FROM invoice"))[0].c >= 1);
});
sc("E12", "Organizer erases by hand: everything personal goes at once, later ticks do not fail or mail twice", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3, people: 2 });
  const r = await org.erase(g.id); w.expect("erase accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  w.eq("personal rows gone now", await rowsAll(g.id), {});
  await w.goTo(g.erasureMs + HOUR, 30 * MIN); w.expect("engagement intact", (await w.engagement(g.id)) != null);
  w.expect("at most one deleted mail", (await w.mailCount(org.email, "personal data has been deleted")) <= 1);
});
sc("E13", "nothing personal is left anywhere: planted names and numbers are in no table after the erasure", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 4, people: 3 });
  await w.tickAt(g.erasureMs + MIN);
  const left = [];
  for (const [t, col] of [["kv", "v"], ["outbox", "body"], ["outbox", "subject"], ["audit_pii", "*"], ["ai_audit", "*"]]) {
    for (const s of w.planted) {
      let c;
      try { c = col === "*" ? (await sql(`SELECT COUNT(*) c FROM ${t} WHERE CAST(${t === "ai_audit" ? "path" : "pii"} AS TEXT) LIKE ?`, ["%" + s + "%"]))[0].c : (await sql(`SELECT COUNT(*) c FROM ${t} WHERE ${col} LIKE ?`, ["%" + s + "%"]))[0].c; } catch { c = 0; }
      if (c) left.push(`${s} in ${t}.${col}`);
    }
  }
  w.eq("planted guest/list strings found nowhere", left.slice(0, 5), []);
  w.eq("personal tables empty", await rowsAll(g.id), {});
  const shred = (await sql("SELECT COUNT(*) c FROM shred WHERE eid=?", [g.id]))[0].c; w.expect("participants' audit part is crypto-shredded (marker row)", shred >= 1, `shred rows ${shred}`);
});
sc("E14", "two games of one Organizer: only the one whose time came is erased", async (w) => {
  const org = await w.org(); const a = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 }); const b = await w.game(org, { leadMs: 3 * DAY, pay: true, guests: 2 });
  await w.tickAt(a.erasureMs); w.eq("A erased", await w.personal(a.id), 0); w.expect("B untouched", (await w.personal(b.id)) >= 2);
});
sc("E15", "UNPLAYED game with a Co-host: Co-host details erased with the guests, key stops", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200024", e: g.id });
  await w.tickAt(g.erasureMs); w.eq("Co-host details gone", await w.cohostRows(g.id), 0);
  const r = await call("GET", `/api/z/${g.id}/cohost`, undefined, { "x-organizer": c.cohostKey }); w.expect("Co-host key no longer works", r.status === 401 || r.status === 403, `${r.status}`);
});
sc("E16", "backups statement: the life API says backups clear within 7 days and the dates add up", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true });
  const l = await w.life(org, g.id); w.eq("backupDays", l.backupDays, 7);
  w.eq("personalDeleteAt = end + 23 h", l.personalDeleteAtMs - l.endMs, 23 * HOUR);
  w.expect("fullDeleteAt is 00:00 IST after end + 365 d", (l.fullDeleteAtMs + 19_800_000) % DAY === 0 && l.fullDeleteAtMs > l.endMs + 365 * DAY && l.fullDeleteAtMs <= l.endMs + 366 * DAY, `${l.fullDeleteAtMs}`);
});
sc("E17", "a guest who joins in the last minutes before the erasure is erased with everyone else", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 1 });
  await w.goTo(g.erasureMs - 20 * MIN, 30 * MIN); const late = await w.guests(g.id, 1); w.expect("late join worked or was refused calmly", late.length === 1);
  await w.tickAt(g.erasureMs); w.eq("all gone", await w.personal(g.id), 0);
});
sc("E18", "no guest e-mail address or number is ever mailed: the whole lifecycle sends only to the team", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3, people: 3 });
  await w.goTo(g.erasureMs + 2 * HOUR, 20 * MIN);
  await w.teamOnly(); await w.noGuestDataInMail();
  w.expect("no AI link in any lifecycle mail", !(await mailbox.list()).some((m) => /\/ai\/[a-z0-9]{16,}/i.test(m.text) && !/AI work link/.test(m.subject)), "found /ai/ link");
});
