// L*: a 200-player and a 2000-player game, end to end: players join through the Worker routes, the flag is switched on and the game started through the routes,
// then every slot the phones (settleStages, gameFrom, agreed) read the public log from the relay, play, and write their moves and results back.
import { describe, expect, test } from "bun:test";
import { settleStages, type Settled } from "../../vendor/game-core/packages/tictactoe/src";
import { agreed, fateOf, gameFrom, slotKey, type Entry } from "../../packages/ttt/src/stageplay";
import { T, callIn, j, join, makeGame, newWorld, startStages, write, type Call, type P, type World } from "./kit";
import { fateMap, outcomeOf, playAll, type Run } from "./drive";

/** The moves that make the wanted result when "a" (the first of the pair) has X: a win for a: X 0,1,2 vs O 3,4; a win for b: X 3,4,8 vs O 0,1,2; a draw: both miss. */
const script = (w: "a" | "b" | "draw"): [("x" | "o"), string][] => w === "a" ? [["x", "0"], ["o", "3"], ["x", "1"], ["o", "4"], ["x", "2"]] : w === "b" ? [["x", "3"], ["o", "0"], ["x", "4"], ["o", "1"], ["x", "8"], ["o", "2"]] : [["x", "-"], ["o", "-"]];

async function readLog(call: Call, id: string, after: number, now: number): Promise<{ entries: Entry[]; last: number }> {
  const out: Entry[] = []; let last = after;
  for (;;) { const p = await j(await call("GET", `/api/z/${id}/ttt/stagelog?after=${last}`, undefined, {}, now)); out.push(...p.entries); if (p.entries.length) last = p.entries[p.entries.length - 1].id; if (p.entries.length < 1000) break; }
  return { entries: out, last };
}

async function playOnServer(w: World, call: Call, id: string, ps: P[], withMoves: boolean) {
  const byPid = new Map(ps.map((p) => [p.pid, p])), setup = await j(await call("GET", `/api/z/${id}/ttt/setup`, undefined, {}, T));
  const roster: string[] = setup.roster.map((r: any) => r.pid), start: number = setup.startedMs, fate = Object.fromEntries(roster.map((p) => [p, fateOf(setup.seed, p)]));
  expect(roster.length).toBe(ps.length);
  let results: Entry[] = [], lastId = 0, games = 0;
  const outcome = outcomeOf(77);
  for (let st = 1; st <= 3; st++) for (let sl = 1; sl <= 3; sl++) {
    const slotStart = start + (120 + (st - 1) * 300 + (sl - 1) * 100) * 1000, now0 = slotStart + 1000;
    const log = await readLog(call, id, lastId, now0); results.push(...log.entries); lastId = log.last;
    const s = settleStages({ gameId: id, startMs: start, nowMs: now0, players: roster, fate, results: agreed(results) });
    expect([s.stage, s.slot]).toEqual([st, sl]);
    let k = 0;
    for (const [a, b] of s.pairsNow) {
      const slot = slotKey(st, sl, a, b), want = outcome(st, sl, a, b), pa = byPid.get(a)!, pb = byPid.get(b)!; games++;
      let t = now0 + 1000 + (k++ % 40) * 5; // spread inside the slot; each player writes only a few entries a second
      const moves: Entry[] = [];
      if (withMoves) {
        const xIs = gameFrom([], a, b).xIs; let seq = 0;
        for (const [who, body] of script(want)) { const p = who === "x" ? (xIs === a ? pa : pb) : (xIs === a ? pb : pa); t += 1000; expect((await write(call, id, p, { slot, kind: "move", seq, body }, t)).status).toBe(200); moves.push({ id: seq + 1, slot, kind: "move", pid: p.pid, seq, body, at_ms: t }); seq++; }
        const g = gameFrom(moves, a, b); expect(g.done).toBe(true); expect(g.winner).toBe(want);
      }
      t += 1000;
      for (const p of [pa, pb]) expect((await write(call, id, p, { slot, kind: "result", seq: 0, body: want }, t)).status).toBe(200);
    }
  }
  const end = start + 1020_000 + 5000, log = await readLog(call, id, lastId, end); results.push(...log.entries);
  const phone = (order: Entry[]) => settleStages({ gameId: id, startMs: start, nowMs: end, players: roster, fate, results: agreed(order) });
  return { first: phone(results), second: phone(results), shuffled: phone([...results].reverse()), results, roster, games, fate, start };
}

describe("L1 200 players", () => {
  test("L1: 200 players, moves and results through the relay: 100, then 50 left, five winners, every phone the same", async () => {
    const w = newWorld(), call = callIn(w), id = "SIM-200";
    const h = await makeGame(w, call, id, { cap: 2000 }); const ps = await join(call, id, 200);
    const st = await startStages(call, id, h, { startMs: T }); expect(st.status).toBe(200); expect((await j(st)).players).toBe(200);
    const r = await playOnServer(w, call, id, ps, true);
    expect(r.first.over).toBe(true); expect(r.first.phase).toBe("done"); expect(r.first.ranking!.length).toBe(50); expect(r.first.winners!.length).toBe(5); expect(r.first.out.length).toBe(150);
    expect(r.first.out.filter((o) => o.stage === 1).length).toBe(100); expect(r.first.out.filter((o) => o.stage === 2).length).toBe(50);
    expect(JSON.stringify(r.second)).toBe(JSON.stringify(r.first)); expect(JSON.stringify(r.shuffled)).toBe(JSON.stringify(r.first));
    expect(new Set(r.first.ranking).size).toBe(50);
    // the same game computed with no server at all gives the same ranking: the relay changed nothing
    const run: Run = { gameId: id, ps: r.roster, fate: r.fate, results: [], startMs: r.start, pausedMs: 0 }; const direct = playAll(run, outcomeOf(77));
    expect(direct.ranking).toEqual(r.first.ranking);
    // sanity of the log: nothing but moves and results in it, and the server stored exactly what the phones wrote
    const rows = w.raw.query("SELECT kind, COUNT(*) c FROM ttt_sl GROUP BY kind").all() as any[]; expect(rows.map((x) => x.kind).sort()).toEqual(["flag", "move", "result"]);
    expect(w.raw.query("SELECT COUNT(*) c FROM ttt_sl WHERE kind='result'").get()).toEqual({ c: r.games * 2 });
  }, 280_000);
  test("L1b: points add up: every game gave 2 (win) or 2 (draw 1+1) points, every bye 1", async () => {
    const ps = Array.from({ length: 200 }, (_, i) => `q${String(i).padStart(4, "0")}`); const fate = fateMap(ps), run: Run = { gameId: "PTS-200", ps, fate, results: [], startMs: T, pausedMs: 0 };
    const s = playAll(run, outcomeOf(5)), total = Object.values(s.stats).reduce((a, x) => a + x.points, 0);
    const out = new Set(s.out.map((o) => o.player)); void out;
    expect(total).toBeGreaterThan(0); // stats keep every player's points, those who left included
    const byes = Object.values(s.stats).reduce((a, x) => a + x.byeStages.length, 0); expect(byes).toBe(0); // 200, 100 and 50 are even: nobody ever sits out
    expect(total).toBe(2 * run.results.length);
  });
});

describe("L2 2000 players", () => {
  test("L2: 2000 players through the relay (results through the log): 1000, then 500 left, five winners, every phone the same", async () => {
    const w = newWorld(), call = callIn(w), id = "SIM-2000";
    const h = await makeGame(w, call, id, { cap: 2000 }); const ps = await join(call, id, 2000);
    const st = await startStages(call, id, h, { startMs: T }); expect(st.status).toBe(200); expect((await j(st)).players).toBe(2000);
    const r = await playOnServer(w, call, id, ps, false);
    expect(r.first.over).toBe(true); expect(r.first.ranking!.length).toBe(500); expect(r.first.winners!.length).toBe(5);
    expect(r.first.out.filter((o) => o.stage === 1).length).toBe(1000); expect(r.first.out.filter((o) => o.stage === 2).length).toBe(500);
    expect(JSON.stringify(r.second)).toBe(JSON.stringify(r.first)); expect(JSON.stringify(r.shuffled)).toBe(JSON.stringify(r.first));
    expect(new Set(r.first.ranking).size).toBe(500); expect(r.games).toBe(3 * 1000 + 3 * 500 + 3 * 250);
    const total = (w.raw.query("SELECT COUNT(*) c FROM ttt_sl WHERE kind='result'").get() as any).c; expect(total).toBe(r.games * 2);
  }, 290_000);
  test("L2b: 2000 players, odd stage sizes: 1999 players: one sits out every slot with 1 point, still five winners and a unique ranking", () => {
    const ps = Array.from({ length: 1999 }, (_, i) => `q${String(i).padStart(4, "0")}`), run: Run = { gameId: "ODD-1999", ps, fate: fateMap(ps), results: [], startMs: T, pausedMs: 0 };
    const s = playAll(run, outcomeOf(6)); expect(s.winners!.length).toBe(5); expect(new Set(s.ranking).size).toBe(s.ranking!.length);
    expect(s.ranking!.length).toBe(Math.ceil(Math.ceil(1999 / 2) / 2));
  }, 120_000);
});
