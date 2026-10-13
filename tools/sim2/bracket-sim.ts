// Scripted crowd for Corporate Tic Tac Toe (gates G16, G17, X5): N simulated phones join through the real Worker routes (in-memory D1),
// the host starts, every phone plays through the real /ttt/move route on a fake clock, some phones never show up, and we check that nothing is stuck.
// Run:  bun tools/sim2/bracket-sim.ts [players=1000] [awayPercent=10] [seed=7] [team=0]      (one heavy command: take C:/ct/heavy.lock first)
import { type Env } from "../../apps/edge/src/worker";
import { handle } from "../../apps/edge/test/with-terms";
import { makeD1 } from "../../apps/edge/test/d1-sqlite";

const N = Number(process.argv[2] ?? 1000), AWAY = Number(process.argv[3] ?? 10), SEED = Number(process.argv[4] ?? 7), TEAM = Number(process.argv[5] ?? 0);
const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
let s = SEED >>> 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
const d = makeD1(); const raw = d.raw;
const env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k", JOIN_PER_IP_MINUTE: "1000000", JOIN_PER_IP_DAY: "1000000" } as any as Env;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);

const t0 = performance.now();
const org = await j(await call("POST", "/api/start", { email: "o@acme.com" }, { "cf-connecting-ip": "10.0.0.1" })); const h = { "x-organizer": org.token as string };
const EID = "SIM-1";
await call("POST", "/api/z", { id: EID, startRound: START, callSeconds: 6, cap: Math.max(100, N), }, h);
await call("POST", `/api/z/${EID}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h);
raw.run("UPDATE engagement SET pack=?, cap=? WHERE id=?", [10000, Math.max(N, 100), EID]);
const phones: { pid: string; device: string }[] = [];
for (let i = 1; i <= N; i++) { const r = await call("POST", `/api/z/${EID}/join`, { name: `Phone ${i}`, device: dev(i) }); if (r.status !== 200) throw new Error("join " + i + " " + r.status); phones.push({ pid: (await j(r)).pid, device: dev(i) }); }
const byPid = new Map(phones.map((p) => [p.pid, p]));
const away = new Set(phones.filter((_, i) => i % Math.max(1, Math.round(100 / Math.max(AWAY, 0.0001))) === 0 && AWAY > 0).map((p) => p.pid));
const st = await call("POST", `/api/z/${EID}/ttt/start`, TEAM ? { format: "team", teamSize: TEAM, moveSecs: 10 } : { moveSecs: 10 }, h);
const started = await j(st); if (st.status !== 200) throw new Error("start refused: " + JSON.stringify(started));
let now = T + 1000, moves = 0, refused = 0, steps = 0;
for (; steps < 20000; steps++) {
  const live = raw.query("SELECT data FROM ttt_m WHERE eid=? AND status='live'").all(EID) as { data: string }[];
  if (!live.length) { const v = raw.query("SELECT state FROM ttt_t WHERE eid=?").get(EID) as any; if (v.state === "done") break; }
  let any = false;
  for (const row of live) for (const b of JSON.parse(row.data) as any[]) {
    if (b.done) continue; const g = b.games[b.games.length - 1]; const mover = g.moves.length % 2 === 0 ? g.x : g.o;
    if (away.has(mover)) continue;
    const free = g.cells.map((c: number, i: number) => (c === 0 ? i : -1)).filter((i: number) => i >= 0);
    const p = byPid.get(mover)!; const r = await call("POST", `/api/z/${EID}/ttt/move`, { pid: p.pid, device: p.device, cell: free[Math.floor(rnd() * free.length)], ply: g.moves.length }, {}, now);
    if (r.status === 200) { moves++; any = true; } else refused++;
  }
  now += any ? 2000 : 12000;
  if (steps % 5 === 4 || !any) await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, now); // the scheduled job: clock-outs of absent players
}
const done = raw.query("SELECT state, champion, rounds, entrants FROM ttt_t WHERE eid=?").get(EID) as any;
const stuck = (raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND status<>'done'").get(EID) as any).c;
const real = (raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND bye=0 AND status='done'").get(EID) as any).c;
const rank = await j(await call("GET", `/api/z/${EID}/ttt/rank?n=5`, undefined, {}, now));
const secs = ((performance.now() - t0) / 1000).toFixed(1);
const ok = done.state === "done" && stuck === 0 && real === done.entrants - 1;
console.log(JSON.stringify({ ok, players: N, away: away.size, team: TEAM || undefined, entrants: done.entrants, rounds: done.rounds, playedMatches: real, expectedMatches: done.entrants - 1, stuckMatches: stuck, moves, refusedMoves: refused, steps, fakeClockMinutes: Math.round((now - T) / 60000), champion: rank.ranking?.[0]?.name, top5: rank.ranking?.map((r: any) => r.name), wallSeconds: Number(secs) }, null, 1));
process.exit(ok ? 0 : 1);
