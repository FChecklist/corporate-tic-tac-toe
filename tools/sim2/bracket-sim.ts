// Scripted crowd for Corporate Tic Tac Toe (gates G16, G17, X5). N simulated PHONES join through the real Worker routes (in-memory D1), the host starts, and then every phone is a real TttPhone
// (packages/ttt/src/phone.ts, the code the browser ships): it computes the bracket, replays the stored moves with the rules, claims clock-outs, reports its board and registers its next match by itself.
// The Worker is a mailbox: it stores what it is given and hands it back. Some phones never show up. We check that nothing is stuck. A virtual clock moves the time.
// The Organizer's page (TttConsole) is open the whole time: it sends the draw, looks after boards where BOTH players are away, and sends the final ranking.
// Run:  bun tools/sim2/bracket-sim.ts [players=1000] [awayPercent=10] [seed=7] [team=0]      (one heavy command: take C:/ct/heavy.lock first)
import { type Env } from "../../apps/edge/src/worker";
import { handle } from "../../apps/edge/test/with-terms";
import { makeD1 } from "../../apps/edge/test/d1-sqlite";
import { playCrowd, clockOf, type SimPhone } from "./phones";

const N = Number(process.argv[2] ?? 1000), AWAY = Number(process.argv[3] ?? 10), SEED = Number(process.argv[4] ?? 7), TEAM = Number(process.argv[5] ?? 0);
const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
let s = SEED >>> 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
const d = makeD1(); const raw = d.raw;
const env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k", JOIN_PER_IP_MINUTE: "1000000", JOIN_PER_IP_DAY: "1000000" } as any as Env;
const hits: Record<string, number> = {};
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) => {
  const kind = method + " " + path.replace(/\/api\/z\/[^/]+\//, "").replace(/\?.*$/, "").replace(/\/r\d+m\d+/, "/{mid}"); hits[kind] = (hits[kind] ?? 0) + 1;
  return handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
};
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);

const t0 = performance.now();
const org = await j(await call("POST", "/api/start", { email: "o@acme.com" }, { "cf-connecting-ip": "10.0.0.1" })); const h = { "x-organizer": org.token as string };
const EID = "SIM-1";
await call("POST", "/api/z", { id: EID, startRound: START, callSeconds: 6, cap: Math.max(100, N) }, h);
await call("POST", `/api/z/${EID}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h);
raw.run("UPDATE engagement SET pack=?, cap=? WHERE id=?", [10000, Math.max(N, 100), EID]);
const phones: SimPhone[] = [];
for (let i = 1; i <= N; i++) { const r = await call("POST", `/api/z/${EID}/join`, { name: `Phone ${i}`, device: dev(i) }); if (r.status !== 200) throw new Error("join " + i + " " + r.status); phones.push({ pid: (await j(r)).pid, device: dev(i), name: `Phone ${i}` }); }
const away = new Set(phones.filter((_, i) => i % Math.max(1, Math.round(100 / Math.max(AWAY, 0.0001))) === 0 && AWAY > 0).map((p) => p.pid));
const st = await call("POST", `/api/z/${EID}/ttt/start`, TEAM ? { format: "team", teamSize: TEAM, moveSecs: 10 } : { moveSecs: 10 }, h, T);
const started = await j(st); if (st.status !== 200) throw new Error("start refused: " + JSON.stringify(started));
const clock = clockOf(T);
const stateOf = () => (raw.query("SELECT state FROM ttt_t WHERE eid=?").get(EID) as any)?.state as string;
const r = await playCrowd({ call, eid: EID, phones, orgHeaders: h, clock, rng: rnd, away, isDone: () => stateOf() === "done", maxSteps: 20000 });
const t = raw.query("SELECT state, champion, rounds, entrants FROM ttt_t WHERE eid=?").get(EID) as any;
const stuck = (raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND bye=0 AND status<>'done'").get(EID) as any).c;
const real = (raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND bye=0 AND status='done'").get(EID) as any).c;
const how = Object.fromEntries((raw.query("SELECT how, COUNT(*) c FROM ttt_b WHERE eid=? GROUP BY how").all(EID) as any[]).map((x) => [x.how, x.c]));
const flagged = (raw.query("SELECT COUNT(*) c FROM ttt_b WHERE eid=? AND flag=1").get(EID) as any).c;
const events = (raw.query("SELECT COUNT(*) c FROM ttt_mv WHERE eid=?").get(EID) as any).c;
const rank = await j(await call("GET", `/api/z/${EID}/ttt/rank?n=5`, undefined, {}, clock.t));
const secs = ((performance.now() - t0) / 1000).toFixed(1);
const ok = t.state === "done" && stuck === 0 && real === t.entrants - 1 && flagged === 0;
console.log(JSON.stringify({
  ok, players: N, away: away.size, team: TEAM || undefined, entrants: t.entrants, rounds: t.rounds, playedMatches: real, expectedMatches: t.entrants - 1, stuckMatches: stuck, flaggedForOrganizer: flagged,
  resultsKept: how, storedMoves: events, squaresTappedByPhones: r.moves, refusedMoves: r.refused, phoneClaims: r.claims, phoneReports: r.results, laterMatchesRegisteredByPhones: r.opens,
  steps: r.steps, virtualMinutes: Math.round((clock.t - T) / 60000), champion: rank.ranking?.[0]?.name, top5: rank.ranking?.map((x: any) => x.name),
  phoneTicks: r.ticks, phoneRequests: { get: r.gets, post: r.posts }, serverRoutesHit: Object.fromEntries(Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 14)), wallSeconds: Number(secs),
}, null, 1));
process.exit(ok ? 0 : 1);
