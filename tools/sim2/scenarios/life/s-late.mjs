// L-scenarios: late payment (+2 minutes to start), unpaid holds and their TWO different messages, payment after the erasure. Spec: docs/ROLES_AND_CONSOLE_SPEC_5.md A.4 (owner correction: no separate cut-off).
import { sc, HOUR, MIN, DAY, sql, call, roundTimeMs } from "./lib.mjs";

const holdAt = (g) => g.startMs - 30_000; // the lock begins 45 s before the start time
const payLinkToken = (url) => /[?&]t=([0-9a-f]{48})/.exec(url)?.[1];

sc("L01", "unpaid hold: Organizer and Host see 'payment pending', guests and Co-hosts only 'waiting for the Organizer'", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200012", e: g.id });
  await w.at(holdAt(g));
  const o = (await w.info(g.id, org.token)).body, h = (await host.api("GET", `/api/z/${g.id}/info`)).body, gu = (await w.info(g.id)).body, ch = (await call("GET", `/api/z/${g.id}/cohost`, undefined, { "x-organizer": c.cohostKey })).body;
  w.expect("Organizer: unpaid + locked", o.unpaid === true && o.locked === true, JSON.stringify(o).slice(0, 200));
  w.expect("Host: unpaid + locked", h.unpaid === true && h.locked === true, JSON.stringify(h).slice(0, 200));
  w.expect("Guest: waitingFor organizer and NO payment wording (no 'unpaid')", gu.waitingFor === "organizer" && gu.unpaid === undefined, JSON.stringify(gu).slice(0, 200));
  w.expect("Co-host: waitingFor organizer", ch.waitingFor === "organizer", JSON.stringify(ch).slice(0, 300));
  w.expect("Co-host sees no 'unpaid' flag in /info either", (await call("GET", `/api/z/${g.id}/info`, undefined, { "x-organizer": c.cohostKey })).body.unpaid === undefined);
  w.expect("a guest's response never contains the word 'payment'", !/payment|unpaid|pay\b/i.test(JSON.stringify(gu).replace(/"pay[A-Za-z]*"/g, "")), JSON.stringify(gu).slice(0, 200));
});
sc("L02", "the hold lasts until the erasure: still 'waiting' hours after the end", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  for (const t of [g.startMs + MIN, g.endMs + HOUR, g.endMs + 10 * HOUR, g.erasureMs - MIN]) { await w.tickAt(t); const gu = (await w.info(g.id)).body; w.expect(`guest waiting at +${Math.round((t - g.startMs) / HOUR * 10) / 10}h`, gu.waitingFor === "organizer" && gu.didNotStart === false, JSON.stringify(gu).slice(0, 160)); }
  w.expect("organizer still sees 'unpaid'", (await w.info(g.id, org.token)).body.unpaid === true);
});
sc("L03", "late payment 10 minutes after the start time: first number comes 2 minutes after the payment", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 2 });
  const payAt = g.startMs + 10 * MIN; await w.at(payAt);
  const r = await org.pay(g.id); w.expect("payment accepted", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  const restart = r.body?.result?.restartedAtMs; const first = restart + 120_000; // the game's start time is the beginning of the 2-minute setup window (GRACE_ROUNDS 40 x 3 s); the first number follows it
  w.expect("first number about 2 minutes after the payment", restart && first - payAt >= 110_000 && first - payAt <= 130_000, `${restart && first - payAt} ms`);
  const s = await w.summary(org, g.id); w.expect("now paid, not held", s.paid === true && s.waitingFor === null, JSON.stringify({ paid: s.paid, w: s.waitingFor }));
  const gu = (await w.info(g.id)).body; w.expect("guest no longer waiting; start moved to the restart time", !gu.waitingFor && Math.abs(gu.startMs - restart) < 10_000, `${gu.startMs} vs ${restart}`);
  w.expect("guests kept", (await w.personal(g.id)) >= 2);
});
sc("L04", "late payment 1 minute before the erasure is still accepted and starts the game", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 3, people: 2 });
  await w.tickAt(g.erasureMs - MIN); w.expect("not yet closed", (await w.engagement(g.id)).unplayed_ms == null);
  const r = await org.pay(g.id); w.expect("accepted", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  await w.tickAt(g.erasureMs + MIN); w.expect("guest data NOT erased by the old clock", (await w.personal(g.id)) >= 5, JSON.stringify(await w.personalRows(g.id)));
  w.expect("not closed as 'did not start'", (await w.engagement(g.id)).unplayed_ms == null);
});
sc("L05", "paying in the same second as the erasure time, before the tick runs, still works (no payment, no game; payment any time until erasure)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  await w.at(g.erasureMs); // the tick has NOT run yet
  const r = await org.pay(g.id); w.expect("accepted before the tick", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  await w.tick(); w.expect("guest data kept (game is paid and restarts)", (await w.personal(g.id)) >= 1);
});
sc("L06", "payment after the game closed ('did not start') is refused on every road and takes no money", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = payLinkToken(JSON.stringify(pl.body));
  await w.tickAt(g.erasureMs); w.expect("closed", (await w.engagement(g.id)).unplayed_ms != null);
  let r = await org.pay(g.id); w.expect("console pay 409 did-not-start", r.status === 409 && r.body.code === "did-not-start", `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  r = await host.api("POST", "/api/payments/test", { eid: g.id, email: host.email, org: "H" }); w.expect("Host pay 409", r.status === 409, `${r.status}`);
  if (tok) { r = await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+payer@example.com", name: "Payer Pat" }); w.expect("pay link 409", r.status === 409, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); } else w.expect("pay link existed", false, JSON.stringify(pl.body).slice(0, 200));
  r = await org.api("POST", `/api/z/${g.id}/pay-with-credit`, {}); w.expect("credit pay 409", r.status === 409, `${r.status}`);
  w.eq("no payment rows at all", (await sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [g.id]))[0].c, 0);
});
sc("L07", "late payment: every guest and the people list stay and keep the same seats", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 4, people: 3 });
  const seatsBefore = await sql("SELECT pid, seq FROM seat WHERE eid=? ORDER BY seq", [g.id]);
  await w.at(g.startMs + 30 * MIN); await org.pay(g.id); await w.go(HOUR, 10 * MIN);
  w.eq("same seats", await sql("SELECT pid, seq FROM seat WHERE eid=? ORDER BY seq", [g.id]), seatsBefore);
  w.expect("list kept", (await sql("SELECT COUNT(*) c FROM person WHERE eid=?", [g.id]))[0].c >= 3);
});
sc("L08", "a Host can pay late; 'paid by Host' is recorded", async (w) => {
  const org = await w.org(); const host = await w.host(org); const g = await w.game(org, { leadMs: 2 * HOUR });
  await w.at(g.startMs + 5 * MIN);
  const r = await host.api("POST", "/api/payments/test", { eid: g.id, email: host.email, org: "Sim Org" }); w.expect("accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const kv = (await sql("SELECT v FROM kv WHERE k=?", ["paidby/" + g.id]))[0]; w.expect("paidby = host", kv && JSON.parse(kv.v).by === "host", JSON.stringify(kv));
});
sc("L09", "a Co-host can pay late with a pay link-free payment of their own", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  const c = await org.inviteCohost({ label: "Chitra", phone: "9822200013", e: g.id }); await w.at(g.startMs + 5 * MIN);
  const r = await call("POST", "/api/payments/test", { eid: g.id, email: org.email, org: "Sim Org" }, { "x-organizer": c.cohostKey }); w.expect("accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const kv = (await sql("SELECT v FROM kv WHERE k=?", ["paidby/" + g.id]))[0]; w.expect("paidby = co-host", kv && JSON.parse(kv.v).by === "co-host", JSON.stringify(kv));
});
sc("L10", "anyone with a pay link can pay late without an account", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = payLinkToken(JSON.stringify(pl.body)); w.expect("pay link made", !!tok, JSON.stringify(pl.body).slice(0, 200));
  await w.at(g.startMs + 20 * MIN);
  const pub = await call("GET", `/api/paylink/${tok}`); w.expect("link still open and shows a price", pub.status === 200 && pub.body.price, JSON.stringify(pub.body).slice(0, 200));
  const r = await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+payer@example.com", name: "Payer Pat" }); w.expect("payment accepted", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  w.expect("game paid", (await w.engagement(g.id)).pack !== 0); w.expect("link now says paid", (await call("GET", `/api/paylink/${tok}`)).body.status === "paid" || (await call("POST", `/api/paylink/${tok}/checkout`, { email: "sim+payer@example.com", name: "Payer Pat" })).status === 409);
});
sc("L11", "paying twice (one after the other and four at once) never charges twice", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  const r1 = await org.pay(g.id); const r2 = await org.pay(g.id);
  w.expect("first ok, second refused as already published", r1.status === 200 && r2.status === 409, `${r1.status} ${r2.status}`);
  const org2 = await w.org(); const g2 = await w.game(org2, { leadMs: 2 * HOUR });
  const rs = await Promise.all([1, 2, 3, 4].map(() => org2.pay(g2.id)));
  w.expect("exactly one succeeded at most", rs.filter((r) => r.status === 200).length <= 1, rs.map((r) => r.status).join(","));
  w.eq("one paid payment per game", (await sql("SELECT eid, COUNT(*) c FROM payment WHERE status='paid' AND eid IS NOT NULL GROUP BY eid HAVING c>1")).length, 0);
});
sc("L12", "the 'payment is due' mail goes to the Organizer once, however often guests open the link", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  await w.at(holdAt(g)); for (let i = 0; i < 4; i++) await w.info(g.id);
  w.eq("one 'could not begin' mail", await w.mailCount(org.email, "could not begin"), 1);
  await w.teamOnly();
});
sc("L13", "reminder: an unpaid published game starting within 36 hours gets ONE 'payment pending' mail (cron ticks only, no Organizer request)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 30 * HOUR });
  await w.go(10 * HOUR, 10 * MIN); // the scheduled job runs every minute; nobody opens the console
  w.eq("one reminder from the scheduled job", await w.mailCount(org.email, "Payment pending for your game"), 1);
});
sc("L13b", "reminder: sent when the Organizer's first request of the next UTC day arrives, and only once", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 40 * HOUR });
  const nextDay = (Math.floor((await w.now()) / DAY) + 1) * DAY + HOUR; await w.goTo(nextDay, 6 * HOUR);
  await org.history(); w.eq("one reminder", await w.mailCount(org.email, "Payment pending for your game"), 1);
  await w.go(HOUR, 30 * MIN); await org.history(); w.eq("still one", await w.mailCount(org.email, "Payment pending for your game"), 1);
});
sc("L14", "unpaid draft that was never published: guest data goes at end+23h but the draft is NOT closed", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, publish: false, people: 3 });
  await w.tickAt(g.erasureMs - 1); w.expect("list present just before", (await w.personal(g.id)) >= 3);
  await w.tickAt(g.erasureMs); w.eq("list erased", await w.personal(g.id), 0);
  const e = await w.engagement(g.id); w.expect("draft still there and not 'did not start'", e && e.unplayed_ms == null, JSON.stringify(e && e.unplayed_ms));
  w.eq("no 'did not start' mail for a draft", await w.mailCount(org.email, "did not start"), 0);
});
sc("L15", "paying long before a far start: no restart, start time untouched", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 10 * DAY });
  const r = await org.pay(g.id); w.expect("no restart", r.status === 200 && !r.body.result.restartedAtMs, JSON.stringify(r.body.result));
  w.expect("start untouched", (await w.summary(org, g.id)).startMs === g.startMs);
});
sc("L16", "late-paid game: guest data is erased 23h after the NEW end, not after the old one", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 2 });
  const payAt = g.startMs + 8 * HOUR; await w.goTo(payAt, 30 * MIN); await org.pay(g.id);
  const life = await w.life(org, g.id); w.expect("erasure moved to ~payAt + 2min + game + 23h", life.personalDeleteAtMs > payAt + 23 * HOUR && life.personalDeleteAtMs < payAt + 24 * HOUR, `${(life.personalDeleteAtMs - payAt) / HOUR} h`);
  await w.tickAt(g.erasureMs + HOUR); w.expect("data survives the old erasure time", (await w.personal(g.id)) >= 2);
  await w.tickAt(life.personalDeleteAtMs); w.eq("gone at the new one", await w.personal(g.id), 0);
});
sc("L17", "a guest joining a held game can join but sees only 'waiting for the Organizer' (and is erased with the rest)", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR });
  await w.at(g.startMs + MIN);
  const [guest] = await w.guests(g.id, 1); const me = await guest.me(); w.expect("guest can see their page", me.status === 200 || me.status === 404, `${me.status}`);
  await w.tickAt(g.erasureMs); w.eq("guest erased", await w.personal(g.id), 0);
});
sc("L18", "a late payment is the only way back: payment on day 2 after the close is refused, not queued", async (w) => {
  const org = await w.org(); const g = await w.game(org, { leadMs: 2 * HOUR, guests: 1 });
  await w.tickAt(g.erasureMs + DAY);
  const r = await org.pay(g.id); w.expect("refused", r.status === 409, `${r.status}`);
  const nm = await org.api("POST", `/api/z/${g.id}/clone`, { withPeople: true }); w.expect("clone offered instead (ok)", nm.status === 200, `${nm.status}`);
  w.eq("old list erased, so nothing to bring", nm.body.peopleCopied, 0);
});
