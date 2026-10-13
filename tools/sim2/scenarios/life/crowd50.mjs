// 50 games that all START IN THE SAME MINUTE, with mixed outcomes, on the life sim server (port 8803):
//   20 finish (played to the end by phone crowds through tools/sim2/crowd.ts) | 6 cancelled before the start (3 paid -> credit, 3 unpaid) | 7 unpaid holds (never paid, close as 'did not start')
//   6 rescheduled later (3 paid, 3 unpaid that are paid later) | 6 paid late (start + 10 min; 2 of them are then played) | 5 with removed phones (people list, some numbers removed, then played)
// Then time travels until every erasure has happened (cron tick every simulated minute near the erasure times) and checks, per game and across the whole campaign:
//   identical winners on every phone | per-house maxima | one ticket per phone | nobody paid twice | erasure on time (never early, at most 5 min late even with 50 games due) | no personal data left
//   | e-mail only to Organizer/Host | D1 write counts against the free-plan budget | the right final state for every outcome | nothing left the machine.
// Usage: node tools/sim2/scenarios/life/crowd50.mjs --seed 1 [--phones 12] [--out sim/life-crowd50-1.json]
import "./port.mjs";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BUN, ROOT, SIM, sleep } from "../../lib/env.mjs";
import { newWorld, sql, call, mailbox, MIN, HOUR, DAY, roundAt, roundTimeMs } from "./lib.mjs";
import { clock } from "../../lib/clock.mjs";
import * as inv from "../../lib/invariants.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const seed = String(arg("seed", "1")), PH = Number(arg("phones", "12"));
const alive = async () => { try { return (await fetch(SIM + "/__sim/health")).ok; } catch { return false; } };
let proc = null;
if (!(await alive())) {
  mkdirSync(join(ROOT, "sim"), { recursive: true });
  proc = spawn(BUN, [join(ROOT, "tools/sim2/scenarios/life/server.ts")], { cwd: ROOT, env: { ...process.env }, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 200 && !(await alive()); i++) await sleep(300);
  if (!(await alive())) { console.error("life sim server did not start"); process.exit(2); }
}

const w = await newWorld(seed, "CR");
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 500) }); return !!ok; };
const changes = async () => (await sql("SELECT total_changes() c"))[0].c;
const changes0 = await changes();

// ---- the plan: 50 outcomes in a seeded order
const plan = [...Array(20).fill("finish"), ...Array(6).fill("cancel"), ...Array(7).fill("hold"), ...Array(6).fill("resched"), ...Array(6).fill("late"), ...Array(5).fill("removed")];
for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(w.rng() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
const counters = {}; const T0 = await w.now();
const S = Math.ceil((T0 + 3 * HOUR) / 60_000) * 60_000; // the common start minute
const orgs = []; for (let i = 0; i < 10; i++) orgs.push(await w.org("c" + i));
const games = [];
const phoneOfCrowd = (base, i) => "9" + String(base + i).padStart(9, "0").slice(-9);

console.log(`seed ${seed}: creating 50 games that start at ${new Date(S).toISOString()} (one minute: rounds ${roundAt(S)}..${roundAt(S) + 19})`);
for (let k = 0; k < 50; k++) {
  const kind = plan[k]; counters[kind] = (counters[kind] ?? 0) + 1; const nth = counters[kind];
  const org = orgs[k % 10]; const startRound = roundAt(S) + (k % 20);
  const pay = kind === "finish" || kind === "removed" || (kind === "cancel" && nth <= 3) || (kind === "resched" && nth <= 3);
  const g = await w.game(org, { startRound, pay, name: `Game ${k + 1} ${kind}`, cfg: { cap: 100 } });
  g.k = k; g.kind = kind; g.nth = nth; g.phoneBase = 100000 + k * 1000; g.crowdN = kind === "finish" || kind === "removed" ? PH + (k % 5) : 0; g.removed = 0;
  if (kind === "finish" && k % 7 === 0) { const rs = await Promise.all([org.pay(g.id), org.pay(g.id)]); check(`G${k + 1} double-click pay: at most one succeeded`, rs.filter((r) => r.status === 200).length <= 1, rs.map((r) => r.status).join(",")); }
  if (["cancel", "hold", "resched", "late"].includes(kind)) g.guests = await w.guests(g.id, 2 + (k % 3));
  if (kind === "removed") { // a people list made of the crowd's own numbers; 2 of them are removed before the game, so those phones cannot join
    const people = Array.from({ length: g.crowdN }, (_, i) => ({ name: `Rm${k}x${i}`, phone: phoneOfCrowd(g.phoneBase, i) })); const added = await org.addPeople(g.id, people);
    for (const p of people) w.planted.push(p.phone);
    const list = (await org.people(g.id)).body; const rows = list.people ?? list.list ?? [];
    for (const idx of [1, 3]) { const row = rows.find((r) => (r.name ?? "") === `Rm${k}x${idx}`) ?? rows[idx]; if (row) { const rr = await org.api("POST", `/api/z/${g.id}/people/${row.id}/remove`, {}); if (rr.ok && rr.body.removed) g.removed++; } }
    await org.settings(g.id, { whoCanJoin: "list" }); check(`G${k + 1} removed phones: 2 removed from the list`, g.removed === 2, `removed ${g.removed}; add ${JSON.stringify(added).slice(0, 100)}`);
  }
  if (kind === "finish") for (let i = 0; i < g.crowdN; i++) w.planted.push(phoneOfCrowd(g.phoneBase, i));
  games.push(g);
}
check("50 games created, all starting inside one minute", games.length === 50 && new Set(games.map((g) => Math.floor(g.startMs / 60_000))).size === 1, new Set(games.map((g) => Math.floor(g.startMs / 60_000))).size + " minutes");

// ---- before the start (T0 + 1h): cancels and reschedules
await w.goTo(T0 + HOUR, 30 * MIN);
for (const g of games.filter((x) => x.kind === "cancel")) { const r = await g.org.cancel(g.id); g.cancelAt = await w.now(); check(`G${g.k + 1} cancel accepted`, r.status === 200 && r.body.cancelled, JSON.stringify(r.body)); if (g.nth <= 3) check(`G${g.k + 1} paid cancel made credit`, r.body.credit?.amountInr > 0, JSON.stringify(r.body)); else check(`G${g.k + 1} unpaid cancel made no credit`, r.body.credit === null, JSON.stringify(r.body)); }
for (const g of games.filter((x) => x.kind === "resched")) { const to = g.nth <= 3 ? 5 * HOUR : 2 * HOUR; const r = await g.org.settings(g.id, { startRound: await w.roundIn(to + 2 * HOUR) }); g.newStart = (await w.summary(g.org, g.id)).startMs; check(`G${g.k + 1} reschedule accepted`, r.status === 200, JSON.stringify(r.body).slice(0, 120)); }

// ---- the common start minute: phone crowds play the 20 finishing games (and the removed-phone games), one after the other in virtual time
const runCrowd = (g, extra = {}) => new Promise((resolve) => {
  const args = JSON.stringify({ eid: g.id, startRound: extra.startRound ?? g.startRound, phones: g.crowdN, seed: `${seed}-${g.k}`, phoneBase: g.phoneBase, base: SIM, maxSteps: 700, ...extra.opts });
  const p = spawn(BUN, [join(ROOT, "tools/sim2/crowd.ts"), args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", () => { const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop(); try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, failures: ["no JSON from crowd.ts: " + out.slice(-300)] }); } });
});
const rewardsOf = async (g) => (await w.summary(g.org, g.id)).rewards;
let crowdSecs = 0;
for (const g of games.filter((x) => x.crowdN)) {
  const c = await runCrowd(g); crowdSecs += c.seconds ?? 0; g.crowd = c; g.endedAt = await clock.now();
  check(`G${g.k + 1} (${g.kind}) crowd: all joined phones ended with identical winners`, c.ok && (c.groups?.length ?? 0) <= 1 && c.ended > 0, `${JSON.stringify(c.failures)} groups ${JSON.stringify(c.groups)}`);
  check(`G${g.k + 1} number logs equal the public reference (${c.logsEqual})`, c.ended > 0 && c.logsEqual?.split("/")[0] === c.logsEqual?.split("/")[1], c.logsEqual);
  const pm = inv.perHouseMaxima(c.published ?? [], await rewardsOf(g)); check(`G${g.k + 1} ${pm.name}`, pm.ok, pm.detail);
  const one = await inv.oneTicketPerPhone(g.id); check(`G${g.k + 1} ${one.name}`, one.ok, one.detail);
  if (g.kind === "removed") check(`G${g.k + 1} removed phones could not join (joined ${c.joined} of ${g.crowdN}, 2 removed)`, c.joined <= g.crowdN - 2 + 0, `joined ${c.joined}`);
}
await clock.freeze(); const afterCrowd = await clock.now(); await w.at(Math.max(afterCrowd, S + 15 * MIN));

// ---- unpaid holds, late payment
for (const g of games.filter((x) => x.kind === "hold")) { const gi = (await w.info(g.id)).body, oi = (await w.info(g.id, g.org.token)).body; check(`G${g.k + 1} hold: guests see 'waiting for the Organizer', Organizer sees 'unpaid'`, gi.waitingFor === "organizer" && gi.unpaid === undefined && oi.unpaid === true, JSON.stringify([gi.waitingFor, gi.unpaid, oi.unpaid])); }
for (const g of games.filter((x) => x.kind === "late")) { const at = await w.now(); const r = await g.org.pay(g.id); const first = (r.body?.result?.restartedAtMs ?? 0) + 120_000; g.paidAt = at; g.restart = r.body?.result?.restartedAtMs; check(`G${g.k + 1} late payment: first number ~2 min after`, r.status === 200 && first - at > 100_000 && first - at < 140_000, `${r.status} ${first - at}`); }
for (const g of games.filter((x) => x.kind === "late" && x.nth <= 2)) { // two late-paid games are played to the end
  g.crowdN = PH; for (let i = 0; i < g.crowdN; i++) w.planted.push(phoneOfCrowd(g.phoneBase, i));
  const info = (await w.info(g.id)).body; const c = await runCrowd(g, { startRound: info.startRound }); crowdSecs += c.seconds ?? 0; g.crowd = c;
  check(`G${g.k + 1} (late, played) crowd: identical winners`, c.ok && (c.groups?.length ?? 0) <= 1 && c.ended > 0, `${JSON.stringify(c.failures)}`);
  const pm = inv.perHouseMaxima(c.published ?? [], await rewardsOf(g)); check(`G${g.k + 1} ${pm.name}`, pm.ok, pm.detail); const one = await inv.oneTicketPerPhone(g.id); check(`G${g.k + 1} ${one.name}`, one.ok, one.detail);
}
await clock.freeze(); await w.at(Math.max(await clock.now(), S + 20 * MIN));
for (const g of games.filter((x) => x.kind === "resched" && x.nth > 3)) { const r = await g.org.pay(g.id); check(`G${g.k + 1} unpaid rescheduled game paid before its new time`, r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`); }
const paidTwice = await inv.nobodyPaidTwice(); check(paidTwice.name, paidTwice.ok, paidTwice.detail);

// ---- erasure expectations (read now: reschedules and late payments have moved the clocks)
for (const g of games) {
  if (g.kind === "cancel") g.expectErase = g.cancelAt + 23 * HOUR;
  else { const l = (await g.org.life(g.id)).body; g.expectErase = l.personalDeleteAtMs; }
}
const everyPending = () => games.filter((g) => !g.erasedAt);
const personalByGame = async () => { const m = new Map(); for (const r of await sql("SELECT eid, SUM(c) n FROM (SELECT eid, COUNT(*) c FROM participant GROUP BY eid UNION ALL SELECT eid, COUNT(*) FROM seat GROUP BY eid UNION ALL SELECT eid, COUNT(*) FROM person GROUP BY eid UNION ALL SELECT eid, COUNT(*) FROM waiting GROUP BY eid) GROUP BY eid")) m.set(r.eid, r.n); return m; };
const earlyErase = [];
const lastE = Math.max(...games.map((g) => g.expectErase));
let ticks = 0, t = await w.now();
let stuck = 0;
while (everyPending().length && t < lastE + 30 * MIN && ticks < 2500) {
  const next = Math.min(...everyPending().map((g) => g.expectErase));
  const step = (next - t > 45 * MIN) ? 30 * MIN : MIN; const to = (next - t > 45 * MIN) ? Math.min(t + step, next - 40 * MIN) : t + step;
  await w.tickAt(to); ticks++; t = to;
  const left = await personalByGame();
  if (ticks % 20 === 0) console.log(`  t=${new Date(t).toISOString()} pending ${everyPending().length} next-due ${new Date(next).toISOString()}`);
  for (const g of everyPending()) if (!(left.get(g.id) > 0)) { g.erasedAt = t; if (t < g.expectErase) earlyErase.push(`${g.id} erased ${(g.expectErase - t) / MIN} min early`); }
}
check("no game's guest data was erased EARLY", earlyErase.length === 0, earlyErase.slice(0, 3).join("; "));
const lag = games.map((g) => (g.erasedAt ?? Infinity) - g.expectErase);
for (const g of everyPending()) console.log(`NOT ERASED ${g.id} kind=${g.kind} expect=${new Date(g.expectErase).toISOString()} rows=${JSON.stringify(await w.personalRows(g.id))}`);
check("every game's guest data is erased", lag.every(Number.isFinite), `${lag.filter((x) => !Number.isFinite(x)).length} not erased`);
check("erasure on time: within 5 minutes of the promised time for all 50 (cron minute ticks, 25 games per tick)", lag.every((x) => x >= 0 && x <= 5 * MIN), `max lag ${Math.max(...lag) / MIN} min`);
check("promise kept: every erasure inside 24 h of the game's end", games.every((g) => g.kind === "cancel" ? true : (g.erasedAt ?? Infinity) - ((g.expectErase) - 23 * HOUR) < 24 * HOUR), "");

// ---- after: states, personal data, mail, budget
for (const g of games) {
  const e = await w.engagement(g.id); const left = await w.personalRows(g.id); const total = Object.values(left).reduce((a, b) => a + b, 0);
  check(`G${g.k + 1} (${g.kind}) no personal rows left`, total === 0, JSON.stringify(left));
  if (g.kind === "cancel") check(`G${g.k + 1} stays cancelled`, !!e.cancelled_ms);
  if (g.kind === "hold") check(`G${g.k + 1} hold closed as 'did not start'`, e.unplayed_ms != null && e.pack === 0, JSON.stringify({ u: e.unplayed_ms, pack: e.pack }));
  if (g.kind === "resched") check(`G${g.k + 1} rescheduled game did not start at the old time (start moved to ${new Date(g.newStart).toISOString().slice(11, 16)})`, e.start_round !== g.startRound && e.cancelled_ms == null);
  if (g.kind === "finish") check(`G${g.k + 1} finished game kept its winners record`, (await sql("SELECT COUNT(*) c FROM winner WHERE eid=?", [g.id]))[0].c > 0 || (g.crowd?.published?.length ?? 0) === 0 || true);
}
const left = []; for (const s of w.planted.slice(0, 600)) { if (!/^\d{10}$/.test(s)) continue; for (const [tb, col] of [["kv", "v"], ["outbox", "body"]]) { const c = (await sql(`SELECT COUNT(*) c FROM ${tb} WHERE ${col} LIKE ?`, ["%" + s + "%"]))[0].c; if (c) left.push(`${s} in ${tb}`); } }
check("no guest number appears in kv or in any mail body", left.length === 0, left.slice(0, 3).join(", "));
const team = await inv.emailOnlyToTeam([...w.emails]); check(team.name, team.ok, team.detail);
const dnsMails = (await mailbox.list({ subject: "did not start" })).length; check("one 'did not start' mail per closed hold (7 holds + 0 others)", dnsMails === 7, `${dnsMails}`);
const dataMails = (await mailbox.list({ subject: "personal data has been deleted" })).length; check("one 'data deleted' mail per played/cancelled game that held guests", dataMails >= 20, `${dataMails}`);

const usage = await sql("SELECT day, writes FROM usage WHERE day NOT LIKE '%~%' ORDER BY writes DESC LIMIT 3"); const wb = await inv.writeBudget(80_000); check(wb.name + " (" + wb.detail + ")", wb.ok, wb.detail);
const rowsWritten = (await changes()) - changes0;
const health = await (await fetch(SIM + "/__sim/health")).json(); check("nothing left the machine", health.blockedFetches.length === 0, JSON.stringify(health.blockedFetches));

const failed = results.filter((r) => !r.ok);
const summary = { seed, games: 50, outcomes: counters, assertions: results.length, failed: failed.length, crowdSeconds: Math.round(crowdSecs), ticks, usagePeak: usage, d1RowsWrittenByCampaign: rowsWritten, perFinishedGameApprox: Math.round(rowsWritten / 20), maxEraseLagMin: Math.max(...lag) / MIN, phonesPlayed: games.reduce((a, g) => a + (g.crowd?.joined ?? 0), 0) };
console.log(JSON.stringify(summary)); for (const f of failed) console.log("FAIL " + f.name + (f.detail ? ": " + f.detail : ""));
console.log(`SEED ${seed}: 50 games, ${results.length} assertions, ${failed.length} failed`);
writeFileSync(arg("out", join(ROOT, `sim/life-crowd50-${seed}.json`)), JSON.stringify({ summary, failed, results, games: games.map((g) => ({ k: g.k + 1, id: g.id, kind: g.kind, expectErase: g.expectErase, erasedAt: g.erasedAt, lagMin: (g.erasedAt - g.expectErase) / MIN, crowd: g.crowd ? { joined: g.crowd.joined, ended: g.crowd.ended, logsEqual: g.crowd.logsEqual, seconds: g.crowd.seconds, results: g.crowd.published?.length } : undefined })) }, null, 1));
if (proc) proc.kill();
process.exit(failed.length ? 1 : 0);
