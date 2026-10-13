// The browser-side engine (packages/ttt/src/phone.ts): what every phone computes from the public seed and the moves the mailbox stored. No server, no database here.
// Rule numbers refer to docs/RULES.md. The mailbox side (who may write, reports, agreement) is tested in apps/edge/test/tournament.test.ts.
import { describe, expect, test } from "bun:test";
import { ABSENT, effOf, planOf, planPayload, replayMatch, wallOf, type EventRow, type MatchRec, type Setup } from "../src/phone";
import { fateOf, lastGame, moverOf, type BoardState } from "../src/match";
import { startTournament, type MatchState } from "../src/bracket";

const T0 = 5_000_000;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ pid: `p${String(i + 1).padStart(4, "0")}`, name: `Player ${i + 1}` }));
const setupOf = (n: number, seed = "seed-1", roster = people(n)): Setup => ({ eid: "E1", state: "running", commit: "c", seed, roster, opts: { format: "solo", teamSize: 1, moveMs: 10_000, readyMs: 15_000 }, startedMs: T0, pauses: [], serverNow: T0 });
const firstReal = (p: Awaited<ReturnType<typeof planOf>>): MatchState => Object.values(p.t.matches).filter((m) => m.round === 1 && !m.bye).sort((a, b) => a.idx - b.idx)[0]!;
const recOf = (m: MatchState, events: EventRow[]): MatchRec => ({ mid: m.mid, reg: null, complete: false, boards: [{ j: 0, a: m.boards[0]!.a, b: m.boards[0]!.b, events, result: null, reports: [] }], t: { state: "running", pauses: [], serverNow: T0 } });
/** A fresh copy of a round-1 match as a phone sees it, replayed from the stored events. */
const replay = async (p: Awaited<ReturnType<typeof planOf>>, base: MatchState, events: EventRow[], pauses: [number, number | null][] = []) => {
  const m = structuredClone(base) as MatchState; const r = await replayMatch(p, T0, m, recOf(m, events), T0, pauses); return r.m.boards[0]!;
};
const ev = (seq: number, pid: string, sq: number, ms: number): EventRow => ({ seq, pid, sq, ms });

describe("the bracket and every starter are computed on the phone from the public seed (R9, R18, R26)", () => {
  test("R18/R26: the same player list and seed give the same bracket on any phone, whatever order the list arrives in; another seed gives another bracket", async () => {
    const a = await planOf(setupOf(20)), b = await planOf(setupOf(20, "seed-1", [...people(20)].reverse())), c = await planOf(setupOf(20, "seed-2"));
    expect(JSON.stringify(a.t.matches)).toBe(JSON.stringify(b.t.matches)); expect(a.digest).toBe(b.digest);
    expect(c.digest).not.toBe(a.digest);
  });
  test("R9: who has X in game 1 is the same on every phone (a fair coin from the seed) and is not the same in every match", async () => {
    const a = await planOf(setupOf(64)), b = await planOf(setupOf(64));
    const xs = (p: typeof a) => Object.values(p.t.matches).filter((m) => m.round === 1 && !m.bye).map((m) => m.boards[0]!.games[0]!.x === m.boards[0]!.a);
    expect(xs(a)).toEqual(xs(b)); expect(new Set(xs(a)).size).toBe(2);
  });
  test("R17: the draw that goes to the mailbox lists only round-1 matches, the byes with their winner, and the players of each board", async () => {
    const p = await planOf(setupOf(11)); const pay = planPayload(p);
    expect(pay.matches.length).toBe(p.t.size / 2); expect(pay.rounds).toBe(p.t.rounds);
    const byes = pay.matches.filter((m) => m.bye); expect(byes.length).toBe(p.t.size - 11); expect(byes.every((m) => m.winner && m.boards.length === 0)).toBe(true);
    expect(pay.matches.filter((m) => !m.bye).every((m) => m.boards.length === 1 && m.boards[0]!.length === 2)).toBe(true);
    expect(pay.digest).toBe(p.digest);
  });
  test("R20: in the team format every team match has one board per seat, and the leftover players are held in reserve", async () => {
    const s = setupOf(14); s.opts = { format: "team", teamSize: 3, moveMs: 10_000, readyMs: 15_000 };
    const p = await planOf(s); expect(p.t.entrants.length).toBe(4); expect(p.t.reserve.length).toBe(2);
    expect(p.t.entrants.every((e) => e.members.length === 3)).toBe(true);
    expect(planPayload(p).matches.every((m) => m.boards.length === 3)).toBe(true);
    expect(p.entOfPid.size).toBe(12);
  });
  test("a bracket made here is what startTournament makes (the engine was not changed, only moved to the phone)", async () => {
    const p = await planOf(setupOf(9)); const t = await startTournament({ eid: "E1", seed: "seed-1", players: people(9), format: "solo", moveMs: 10_000, readyMs: 15_000, startAt: T0 });
    expect(JSON.stringify(p.t.matches)).toBe(JSON.stringify(t.matches));
  });
});

describe("the rules are replayed from the stored moves (R1-R8, R15)", () => {
  test("R4: three in a row wins; the winner is computed from the stored moves and the server's stamps", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const g = m.boards[0]!.games[0]!; const x = g.x, o = g.o;
    const b = await replay(p, m, [ev(0, x, 0, T0 + 1000), ev(1, o, 3, T0 + 2000), ev(2, x, 1, T0 + 3000), ev(3, o, 4, T0 + 4000), ev(4, x, 2, T0 + 5000)]);
    expect(b.done).toBe(true); expect(b.winner).toBe(x); expect(b.via).toBe("win"); expect(lastGame(b).result?.line).toEqual([0, 1, 2]);
  });
  test("R15: a move out of turn, on a taken square or after the end is stored by the mailbox but ignored by every phone", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const g = m.boards[0]!.games[0]!; const x = g.x, o = g.o;
    const b = await replay(p, m, [ev(0, o, 5, T0 + 1000) /* not O's turn */, ev(1, x, 0, T0 + 2000), ev(2, o, 0, T0 + 3000) /* taken */, ev(3, x, 8, T0 + 4000) /* X again: not X's turn */]);
    expect(lastGame(b).cells.filter((c) => c !== 0).length).toBe(1); expect(lastGame(b).moves.length).toBe(1);
    expect(b.done).toBe(false);
  });
  test("R8: a drawn game is replayed with the marks swapped; after three draws fate decides, and fate is a public number anyone can re-compute", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const base = m.boards[0]!;
    const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8]; // X: 0 2 3 7 8, O: 1 4 5 6: nobody has a line
    // build the moves by walking a private copy of the board one move at a time
    const events: EventRow[] = []; let ms = T0 + 1000;
    for (let game = 0; game < 3; game++) for (let ply = 0; ply < 9; ply++) {
      const probe = await replay(p, m, events); const g = lastGame(probe); events.push(ev(events.length, moverOf(g), DRAW[ply]!, ms)); ms += 1000;
    }
    const b = await replay(p, m, events);
    expect(b.done).toBe(true); expect(b.via).toBe("fate"); expect(b.games.length).toBe(3);
    expect(b.games[0]!.x).not.toBe(b.games[1]!.x); // the marks were swapped for game 2
    const [fa, fb] = await Promise.all([fateOf("seed-1", m.mid, base.j, base.a), fateOf("seed-1", m.mid, base.j, base.b)]);
    expect(b.winner).toBe(fa < fb ? base.a : base.b);
  });
});

describe("clocks are computed from the server's stamps (R12-R14, R28)", () => {
  test("R12/R13: an opponent-absent claim stamped after the deadline makes the software play a square; a claim stamped before the deadline changes nothing", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const g = m.boards[0]!.games[0]!;
    const early = await replay(p, m, [ev(0, g.o, ABSENT, T0 + 14_000)]); // game 1 first-move deadline is T0 + 15 s
    expect(lastGame(early).moves.length).toBe(0);
    const late = await replay(p, m, [ev(0, g.o, ABSENT, T0 + 15_001)]);
    expect(lastGame(late).moves.length).toBe(1); expect(lastGame(late).moves[0]!.auto).toBe(true); expect(lastGame(late).moves[0]!.pid).toBe(g.x); expect(lastGame(late).moves[0]!.at).toBe(T0 + 15_000);
  });
  test("R14: two clock-outs in a row in one game lose the board; one very late claim is the same as several claims on time", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const g = m.boards[0]!.games[0]!;
    // nobody ever moves: X times out, then O, then X again = X's second in a row => X forfeits
    const one = await replay(p, m, [ev(0, g.o, ABSENT, T0 + 600_000)]);
    const many = await replay(p, m, [ev(0, g.o, ABSENT, T0 + 16_000), ev(1, g.x, ABSENT, T0 + 26_000), ev(2, g.o, ABSENT, T0 + 36_000), ev(3, g.x, ABSENT, T0 + 600_000)]);
    for (const b of [one, many]) { expect(b.done).toBe(true); expect(b.via).toBe("forfeit"); expect(b.winner).toBe(g.o); }
    expect(JSON.stringify(one.games.map((x) => x.moves))).toBe(JSON.stringify(many.games.map((x) => x.moves))); // the same moves were put in, whenever the claims arrived
  });
  test("R12: a player who moves in time is never timed out, and the clock restarts from the move", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const g = m.boards[0]!.games[0]!;
    const b = await replay(p, m, [ev(0, g.x, 4, T0 + 14_000), ev(1, g.o, 0, T0 + 20_000)]);
    expect(lastGame(b).moves.map((x) => !!x.auto)).toEqual([false, false]); expect(lastGame(b).deadline).toBe(T0 + 30_000);
  });
  test("R28: while the host pauses no clock runs; the tournament clock is wall time minus every pause", () => {
    const pauses: [number, number | null][] = [[1000, 2000], [5000, null]];
    expect(effOf(pauses, 500)).toBe(500); expect(effOf(pauses, 1500)).toBe(1000); expect(effOf(pauses, 3000)).toBe(2000); expect(effOf(pauses, 9000)).toBe(5000 - 1000); // paused from 5000 on
    expect(wallOf([[1000, 2000]], 1500)).toBe(2500);
  });
  test("R28: a move made right after a pause is stamped by the server's wall clock and the phones subtract the pause", async () => {
    const p = await planOf(setupOf(4)); const m = firstReal(p); const g = m.boards[0]!.games[0]!;
    // paused for 60 s inside the first 15 s window: X still has the rest of the window when play resumes
    const pauses: [number, number | null][] = [[T0 + 5_000, T0 + 65_000]];
    const b = await replay(p, m, [ev(0, g.x, 4, T0 + 70_000)], pauses); // eff time = 10 s: in time
    expect(lastGame(b).moves.map((x) => !!x.auto)).toEqual([false]);
    const slow = await replay(p, m, [ev(0, g.x, 4, T0 + 90_000)], pauses); // eff time = 30 s: too late, the software played for X first
    expect(lastGame(slow).moves[0]!.auto).toBe(true);
  });
});
