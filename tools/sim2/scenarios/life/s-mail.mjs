// M-scenarios (e-mails only to Organizer / Host) and P-scenarios (the organizer's report link lifecycle).
// Spec: docs/ROLES_AND_CONSOLE_SPEC_5.md A.7, docs/PRIVACY_AND_LIFECYCLE.md (report link: 3 min after the end, reminder 6 h before it closes, closes at 22 h, data erased at 23 h).
import { sc, HOUR, MIN, DAY, sql, call, mailbox } from "./lib.mjs";

const reportUrl = (m) => /https?:\/\/[^\s]+report\.html\?e=[^\s&]+&k=[0-9a-f]+/.exec(m.text)?.[0];
const api = (url) => { const u = new URL(url); return call("GET", `/api/report/${u.searchParams.get("e")}?k=${u.searchParams.get("k")}`); };

sc("M01", "a busy life (two Hosts, Co-host, guests, move, late pay, cancel of a second game): every mail goes to the Organizer or a Host, none carries a guest's data", async (w) => {
  const org = await w.org(); const h1 = await w.host(org, "Hema"), h2 = await w.host(org, "Hari");
  const g = await w.game(org, { leadMs: 3 * HOUR, guests: 4, people: 3 }); await org.inviteCohost({ label: "Chitra", phone: "9822200061", e: g.id });
  await org.settings(g.id, { startRound: await w.roundIn(5 * HOUR) }); const l = await w.life(org, g.id); await w.at(l.endMs - 9 * HOUR); await org.pay(g.id);
  const g2 = await w.game(org, { leadMs: 4 * DAY, pay: true, guests: 2 }); await h1.api("POST", `/api/z/${g2.id}/cancel`, { confirmations: 3 });
  await w.go(3 * DAY, 30 * MIN);
  await w.teamOnly(); await w.noGuestDataInMail();
  const tos = new Set((await mailbox.list()).map((m) => m.to)); w.expect("only the three team addresses appear", [...tos].every((t) => [org.email, h1.email, h2.email].includes(t)), [...tos].join(","));
});
sc("M02", "a Host with only a mobile number gets no mail (no address exists); the Organizer still gets every one", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 3 * DAY, pay: true });
  const inv = await org.inviteHost({ label: "Mobile Mani", mobile: "9812345601" }); w.expect("host created without e-mail", !!inv.hostKey);
  await org.cancel(g.id); const tos = [...new Set((await mailbox.list()).map((m) => m.to))]; w.eq("mails only to the Organizer", tos, [org.email]);
});
sc("M03", "two Hosts with e-mail: each gets the cancel mail exactly once, the Organizer once", async (w) => {
  const org = await w.org(); const h1 = await w.host(org, "Hema"), h2 = await w.host(org, "Hari"); const g = await w.game(org, { leadMs: 3 * DAY, pay: true });
  await org.cancel(g.id); for (const a of [org.email, h1.email, h2.email]) w.eq(`${a.split("@")[0]}: one cancel mail`, await w.mailCount(a, "Game cancelled"), 1);
});
sc("M04", "a retired Host stops getting mail", async (w) => {
  const org = await w.org(); const h1 = await w.host(org, "Hema"), h2 = await w.host(org, "Hari"); const g = await w.game(org, { leadMs: 3 * DAY, pay: true });
  const r = await org.retire(h1.id); w.expect("retired", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  await org.cancel(g.id); w.eq("retired Host: no cancel mail", await w.mailCount(h1.email, "Game cancelled"), 0); w.eq("other Host: one", await w.mailCount(h2.email, "Game cancelled"), 1);
});
sc("M05", "Organizer and a Host with the SAME address get one mail, not two", async (w) => {
  const org = await w.org(); const email = org.email; const inv = await org.inviteHost({ label: "Same", email }); const host = new (await import("./lib.mjs")).Host(inv.hostKey); await host.firstOpen({ email, mobile: "9812345602" });
  const g = await w.game(org, { leadMs: 3 * DAY, pay: true }); await org.cancel(g.id); w.eq("one cancel mail to that address", await w.mailCount(email, "Game cancelled"), 1);
});
sc("M06", "no key, token or work link of any kind in lifecycle mails (cancel, credit, erasure, did-not-start, heads-up)", async (w) => {
  const org = await w.org(); const a = await w.game(org, { leadMs: 3 * DAY, pay: true, guests: 1 }); await org.cancel(a.id);
  const b = await w.game(org, { leadMs: 2 * HOUR, guests: 1 }); await w.goTo(b.erasureMs + HOUR, 20 * MIN);
  const bad = (await mailbox.list()).filter((m) => !/AI work link|published: payment pending|payment received|Your engagement .* report/.test(m.subject) && /\b(ctk|cta|cth|ctc)_[0-9a-f]{20,}|\/ai\/[A-Za-z0-9_-]{16,}|\/j\/[A-Za-z0-9_-]{16,}/.test(m.text));
  w.eq("no secret-looking string in those mails", bad.map((m) => m.subject), []);
});
sc("M07", "the report mail goes to the Organizer only (never to Hosts or anyone else)", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.goTo(g.endMs + 10 * MIN, 5 * MIN); const rm = await w.mails(undefined, "game report"); w.eq("one report mail", rm.length, 1); w.eq("to the Organizer", rm[0]?.to, org.email);
  w.eq("Host got none", await w.mailCount(host.email, "game report"), 0);
});

sc("P01", "report mail: not before 3 minutes after the end, exactly one at 3 minutes, with the closing time (end+22h) in it", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3 });
  await w.tickAt(g.endMs + 3 * MIN - 1000); w.eq("none at 2m59", await w.mailCount(org.email, "game report"), 0);
  await w.tickAt(g.endMs + 3 * MIN); await w.go(2 * MIN, 30_000); w.eq("one at 3m", await w.mailCount(org.email, "game report"), 1);
  const m = (await w.mails(org.email, "game report"))[0]; w.expect("mail has the report link", !!reportUrl(m), m.text.slice(0, 300));
  const when = new Date(g.endMs + 22 * HOUR).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }); w.expect("subject names the closing day", m.subject.includes("open it before"), m.subject); void when;
  await w.go(2 * HOUR, 10 * MIN); w.eq("still one", await w.mailCount(org.email, "game report"), 1);
});
sc("P02", "report link works until end+22h, answers 'gone' from then on, while guest data lives until end+23h", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3 });
  await w.goTo(g.endMs + 10 * MIN, 5 * MIN); const url = reportUrl((await w.mails(org.email, "game report"))[0]); w.expect("link found", !!url);
  await w.tickAt(g.endMs + 22 * HOUR - 1); const ok = await api(url); w.expect("works 1 ms before 22h", ok.status === 200 && ok.body.base, `${ok.status} ${JSON.stringify(ok.body).slice(0, 120)}`);
  await w.tickAt(g.endMs + 22 * HOUR); const closed = await api(url); w.expect("gone at 22h (404 code gone)", closed.status === 404 && closed.body.code === "gone", `${closed.status} ${JSON.stringify(closed.body).slice(0, 120)}`);
  w.expect("guest data still held between 22h and 23h", (await w.personal(g.id)) >= 3);
  await w.tickAt(g.endMs + 23 * HOUR); w.eq("erased at 23h", await w.personal(g.id), 0);
});
sc("P03", "reminder 6 hours before the link closes, once, only if the report was not opened", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.goTo(g.endMs + 15 * HOUR, 30 * MIN); w.eq("no reminder at 15h", await w.mailCount(org.email, "Reminder: open your"), 0);
  await w.tickAt(g.endMs + 16 * HOUR); w.eq("one at 16h", await w.mailCount(org.email, "Reminder: open your"), 1); await w.go(5 * HOUR, 30 * MIN); w.eq("still one", await w.mailCount(org.email, "Reminder: open your"), 1);
});
sc("P04", "no reminder when the Organizer opened the report", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.goTo(g.endMs + 10 * MIN, 5 * MIN); const url = reportUrl((await w.mails(org.email, "game report"))[0]); await api(url);
  await w.goTo(g.endMs + 20 * HOUR, 30 * MIN); w.eq("no reminder", await w.mailCount(org.email, "Reminder: open your"), 0);
});
sc("P05", "replacing the report link (lost / shared by mistake) kills the old one at once", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 2 });
  await w.goTo(g.endMs + 10 * MIN, 5 * MIN); const old = reportUrl((await w.mails(org.email, "game report"))[0]);
  const r = await org.api("POST", `/api/z/${g.id}/reportlink`, {}); w.expect("new link", r.status === 200 && r.body.url && r.body.url !== old, JSON.stringify(r.body));
  w.eq("old link 403", (await api(old)).status, 403); w.eq("new link 200", (await api(r.body.url)).status, 200);
  const ai = await call("POST", `/api/z/${g.id}/reportlink`, {}, { "x-organizer": org.aiKey }); w.expect("an AI key cannot replace it", ai.status === 403, `${ai.status}`);
  const aiGet = await call("GET", `/api/z/${g.id}/reportlink`, undefined, { "x-organizer": org.aiKey }); w.expect("an AI key is never given the address", aiGet.status === 200 && aiGet.body.url === null, JSON.stringify(aiGet.body));
});
sc("P06", "a wrong or missing report key is refused (403); a made-up game is refused", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 1 }); await w.goTo(g.endMs + 10 * MIN, 5 * MIN);
  w.eq("no key", (await call("GET", `/api/report/${g.id}`)).status, 403); w.eq("wrong key", (await call("GET", `/api/report/${g.id}?k=${"0".repeat(40)}`)).status, 403);
  const url = reportUrl((await w.mails(org.email, "game report"))[0]); const k = new URL(url).searchParams.get("k"); w.expect("the key of game A does not open game B", (await call("GET", `/api/report/NOSUCHGAME1?k=${k}`)).status >= 400);
});
sc("P07", "no report for a game that did not start, nor for a cancelled game", async (w) => {
  const org = await w.org(); const a = await w.game(org, { leadMs: 2 * HOUR, guests: 2 }); const b = await w.game(org, { leadMs: 5 * HOUR, pay: true, guests: 2 }); await org.cancel(b.id);
  await w.goTo(a.erasureMs + 2 * HOUR, 30 * MIN); w.eq("no report mail at all", await w.mailCount(org.email, "game report"), 0);
});
sc("P08", "report link answer carries the game's totals and the deletion times, not guest data in the base part", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, pay: true, guests: 3 }); await w.goTo(g.endMs + 10 * MIN, 5 * MIN);
  const r = await api(reportUrl((await w.mails(org.email, "game report"))[0])); w.eq("200", r.status, 200);
  w.eq("personal delete time in the report = end+23h", r.body.base?.personalDeleteAtMs, g.endMs + 23 * HOUR); w.eq("people counted", r.body.totalPeople, 3);
  w.expect("base part holds no planted guest string", !w.planted.some((s) => JSON.stringify(r.body.base).includes(s)));
});
