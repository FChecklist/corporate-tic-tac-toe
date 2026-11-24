// N*: the Snakes and Ladders owner numbers (31 Oct 2026), checked on the vendored core copy: one shared board of 100 squares, 30 snakes, 15 ladders, 10 penalty, 10 reward squares.
import { describe, expect, test } from "bun:test";
import * as S from "../../vendor/game-core/packages/snakes/src";
import { ownerBoard, snakesRules, squareXY, finalRanking, move, standing, playersOn, type Board, type Pawn } from "../../vendor/game-core/packages/snakes/src";

const IDS = Array.from({ length: 25 }, (_, i) => `SNK-${i}-game`);
const boards = IDS.map((id) => [id, ownerBoard(id)] as const);
/** My own check that the last square is reachable from every square: rolls 1-6, an exact finish is needed, a snake or ladder moves the pawn. */
const reachable = (b: Board) => {
  const next = (s: number, r: number) => { const n = s + r; return n > 100 ? s : (b.snakes[n] ?? b.ladders[n] ?? n); };
  const can = new Set([100]); for (let c = true; c;) { c = false; for (let s = 1; s < 100; s++) if (!can.has(s) && [1, 2, 3, 4, 5, 6].some((r) => can.has(next(s, r)))) { can.add(s); c = true; } }
  return can.size === 100;
};
const tiny = (sp: Record<number, { kind: "reward" | "punishment" }>): Board => ({ size: 100, snakes: {}, ladders: {}, specials: sp });
const clock = (phase: string) => ({ phase, frozenAt: null, pausedMs: 0, pauses: [] }) as any;
const start = (b: Board, players = ["a", "b"], extra: Record<string, unknown> = {}) => snakesRules.init({ board: b, timeLimitMinutes: 8, ...extra } as any, players);

describe("N1 the board", () => {
  test("N1: 100 squares, 30 snakes, 15 ladders, 10 penalty and 10 reward squares", () => {
    expect(S.OWNER_COUNTS).toEqual({ snakes: 30, ladders: 15, penalty: 10, reward: 10 });
    for (const [id, b] of boards) {
      expect([id, b.size]).toEqual([id, 100]); expect(Object.keys(b.snakes).length).toBe(30); expect(Object.keys(b.ladders).length).toBe(15);
      const sp = Object.values(b.specials ?? {}); expect(sp.filter((x) => x.kind === "punishment").length).toBe(10); expect(sp.filter((x) => x.kind === "reward").length).toBe(10);
    }
  });
  test("N1b: every snake and ladder has a different length (45 different lengths)", () => {
    for (const [, b] of boards) { const l = [...Object.entries(b.snakes).map(([f, t]) => +f - t), ...Object.entries(b.ladders).map(([f, t]) => t - +f)]; expect(l.every((x) => x > 0)).toBe(true); expect(new Set(l).size).toBe(45); }
  });
  test("N1c: the longest snake goes from 99 to 9 and the longest ladder from 31 to 80, on every board", () => {
    for (const [, b] of boards) {
      const sn = Object.entries(b.snakes).map(([f, t]) => [+f, t] as const).sort((x, y) => y[0] - y[1] - (x[0] - x[1])), la = Object.entries(b.ladders).map(([f, t]) => [+f, t] as const).sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
      expect(sn[0]).toEqual([99, 9]); expect(la[0]).toEqual([31, 80]);
      expect(sn[0]![0] - sn[0]![1]).toBeGreaterThan(sn[1]![0] - sn[1]![1]); expect(la[0]![1] - la[0]![0]).toBeGreaterThan(la[1]![1] - la[1]![0]);
    }
  });
  test("N1d: no two things on one square; nothing starts on 1 or 100; snakes go down and ladders go up, and they all end on a plain square", () => {
    for (const [, b] of boards) {
      const starts = [...Object.keys(b.snakes), ...Object.keys(b.ladders), ...Object.keys(b.specials ?? {})].map(Number); expect(new Set(starts).size).toBe(starts.length); expect(starts.includes(1) || starts.includes(100)).toBe(false);
      for (const [f, t] of Object.entries(b.snakes)) { expect(t).toBeLessThan(+f); expect(starts.includes(t)).toBe(false); }
      for (const [f, t] of Object.entries(b.ladders)) { expect(t).toBeGreaterThan(+f); expect(starts.includes(t)).toBe(false); }
    }
  });
  test("N2: the last square is reachable from every square (checked by my own search)", () => { for (const [id, b] of boards) expect([id, reachable(b)]).toEqual([id, true]); });
  test("N2b: the core's own check agrees: no problem is listed for any board, and a board with a trap is refused", () => {
    for (const [, b] of boards) expect(S.checkOwnerBoard(b)).toEqual([]);
    const trap: Board = { ...boards[0]![1], snakes: { ...boards[0]![1].snakes } }; for (const r of [1, 2, 3, 4, 5, 6]) trap.snakes[94 + r > 99 ? 99 : 94 + r] = 2;
    expect(S.checkOwnerBoard(trap).length).toBeGreaterThan(0);
  });
  test("N3: one board for everybody: the same game id gives the same board, and every player of a game has that one board", () => {
    expect(JSON.stringify(ownerBoard("SAME-ID"))).toBe(JSON.stringify(ownerBoard("SAME-ID"))); expect(JSON.stringify(ownerBoard("SAME-ID"))).not.toBe(JSON.stringify(ownerBoard("OTHER-ID")));
    const s = start(ownerBoard("SAME-ID"), ["a", "b", "c", "d"]); expect(new Set(Object.values(s.boards).map((x) => JSON.stringify(x))).size).toBe(1);
  });
  test("N4: squares are numbered from the bottom-left, row by row, back and forth: 1 to 10 left to right, 11 above 10, 20 above 1, 100 top left", () => {
    expect(squareXY(1)).toEqual({ col: 0, row: 0 }); expect(squareXY(10)).toEqual({ col: 9, row: 0 }); expect(squareXY(11)).toEqual({ col: 9, row: 1 }); expect(squareXY(20)).toEqual({ col: 0, row: 1 }); expect(squareXY(21)).toEqual({ col: 0, row: 2 }); expect(squareXY(100)).toEqual({ col: 0, row: 9 });
  });
  test("N4b: 100 different cells, and square n+1 always touches square n", () => {
    const cells = new Set<string>(); for (let n = 1; n <= 100; n++) { const c = squareXY(n); cells.add(`${c.col},${c.row}`); if (n < 100) { const d = squareXY(n + 1); expect(Math.abs(c.col - d.col) + Math.abs(c.row - d.row)).toBe(1); } }
    expect(cells.size).toBe(100);
  });
});

describe("N5 throws, rewards, penalties", () => {
  test("N5: a reward square gives 2 extra throws", () => {
    expect(S.REWARD_THROWS).toBe(2);
    const s0 = start(tiny({ 2: { kind: "reward" } })), s1 = snakesRules.step(s0, { type: "turn", rolls: { a: 1, b: 3 } }, 0, clock("live")).state;
    expect(s1.pawns.a!.at).toBe(2); expect(s1.pawns.a!.extra).toBe(2); expect(S.hasExtra(s1, "a")).toBe(true); expect(S.hasExtra(s1, "b")).toBe(false);
  });
  test("N5b: a penalty square cuts the next throw: the throw after it does not move the pawn, the one after that does", () => {
    const s0 = start(tiny({ 2: { kind: "punishment" } })); let s = snakesRules.step(s0, { type: "turn", rolls: { a: 1, b: 1 } }, 0, clock("live")).state;
    expect(s.pawns.a!.skip).toBe(1);
    s = snakesRules.step(s, { type: "turn", rolls: { a: 4, b: 4 } }, 0, clock("live")).state; expect(s.pawns.a!.at).toBe(2); expect(s.pawns.a!.skip).toBe(0); // a lost that throw
    s = snakesRules.step(s, { type: "turn", rolls: { a: 4, b: 4 } }, 0, clock("live")).state; expect(s.pawns.a!.at).toBe(6);
  });
  test("N5c: a snake takes the pawn down and a ladder up; an exact finish is needed (too high a throw stays)", () => {
    const b: Board = { size: 100, snakes: { 5: 2 }, ladders: { 3: 40 } };
    expect(move(b, 1, 4)).toMatchObject({ to: 2, snake: true }); expect(move(b, 1, 2)).toMatchObject({ to: 40, ladder: true }); expect(move(b, 98, 6).to).toBe(98); expect(move(b, 98, 2).to).toBe(100);
  });
  test("N6: each player throws their own dice: a throw is the player's own roll, nobody else's (two players on one turn get their own numbers)", () => {
    const s = snakesRules.step(start(tiny({})), { type: "turn", rolls: { a: 2, b: 5 } }, 0, clock("live")).state; expect([s.pawns.a!.at, s.pawns.b!.at]).toEqual([3, 6]);
  });
  test("N7: a throw not made in the 10 s window is lost (a miss): the pawn does not move and a miss is counted", () => {
    const s0 = start(tiny({}), ["a", "b"], { mode: "presence" }), s = snakesRules.step(s0, { type: "turn", rolls: { a: 3, b: 3 }, threw: ["a"] }, 0, clock("live")).state;
    expect(s.pawns.a!.at).toBe(4); expect(s.pawns.b!.at).toBe(1); expect(s.pawns.b!.missed).toBe(1);
  });
  test("N8: the window is 10 s per player, and the next one opens only after a 10 s gap", () => {
    expect(S.WINDOW_MS).toBe(10_000); expect(S.nextWindowAt(5_000)).toBe(15_000);
    const st = { settledMs: 5_000 }; expect(S.windowOpen(st, 5_000, 14_999)).toBe(false); expect(S.windowOpen(st, 5_000, 15_000)).toBe(true);
    expect(S.windowOpen({ settledMs: 0 }, 5_000, 20_000)).toBe(false); // not settled yet
  });
  test("N9: while paused nothing moves", () => { const s0 = start(tiny({})), r = snakesRules.step(s0, { type: "turn", rolls: { a: 3, b: 3 } }, 0, clock("paused")); expect(r.state).toBe(s0); expect(r.out).toEqual([]); });
});

describe("N10 time and the end", () => {
  test("N10: waiting room 120 s, time limit 7 or 8 minutes (default 8), nothing else", () => {
    expect(S.WAITING_ROOM_MS).toBe(120_000); expect([...S.TIME_LIMIT_CHOICES_MIN]).toEqual([7, 8]); expect(S.timeLimitMsFor(7)).toBe(420_000); expect(S.timeLimitMsFor(8)).toBe(480_000); expect(S.timeLimitMsFor("7")).toBe(420_000);
    for (const bad of [5, 9, 10, 0, undefined, "x"]) expect(S.timeLimitMsFor(bad)).toBe(480_000); expect(S.DEFAULT_TIME_LIMIT_MS).toBe(480_000);
    expect(S.setupFields.find((f) => f.key === "timeLimitMinutes")!.choices).toEqual(["7", "8"]);
  });
  test("N10b: the game ends when the time limit is reached, not before", () => {
    const s0 = start(tiny({}), ["a", "b"], { timeLimitMinutes: 7 }); expect(s0.timeLimitMs).toBe(420_000);
    expect(snakesRules.step(s0, { type: "turn", rolls: { a: 1, b: 1 }, gameMs: 419_999 }, 0, clock("live")).state.over).toBe(false);
    expect(snakesRules.step(s0, { type: "turn", rolls: { a: 1, b: 1 }, gameMs: 420_000 }, 0, clock("live")).state.over).toBe(true);
  });
  test("N11: ahead and behind counts and the players on each square", () => {
    const pawn = (at: number): Pawn => ({ at, ladders: 0, missed: 0, fate: 0 }), pawns = { me: pawn(10), p1: pawn(20), p2: pawn(30), p3: pawn(5), p4: pawn(10), p5: pawn(12) };
    expect(standing({ pawns }, "me")).toEqual({ ahead: 3, behind: 1, within: 3 }); expect(playersOn({ pawns })).toEqual({ 10: 2, 20: 1, 30: 1, 5: 1, 12: 1 });
  });
  test("N12: the winner and the full ranking at the end: everybody is ranked once, finishers first, never tied", () => {
    const pawn = (at: number, ladders = 0, missed = 0, fate = 0, finishedTurn?: number): Pawn => ({ at, ladders, missed, fate, finishedTurn });
    const pawns = { a: pawn(100, 0, 0, 5, 7), b: pawn(100, 0, 0, 1, 6), c: pawn(50, 2, 0, 9), d: pawn(50, 2, 0, 3), e: pawn(50, 1, 0, 0), f: pawn(10, 0, 0, 4) };
    const r = finalRanking({ pawns, finishers: ["b", "a"] }); expect(r).toEqual(["b", "a", "d", "c", "e", "f"]); expect(S.winnerOf({ pawns, finishers: ["b", "a"] })).toBe("b"); expect(new Set(r).size).toBe(6);
  });
  test("N12b: a whole game of 30 players through the rules ends with a winner and a ranking of all 30", () => {
    const ps = Array.from({ length: 30 }, (_, i) => `n${i}`), b = ownerBoard("FULL-GAME"); let s = start(b, ps, { timeLimitMinutes: 8, turnLimit: 5000 }), t = 0, h = 12345;
    while (!s.over && t < 5000) { const rolls: Record<string, number> = {}; for (const p of ps) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; rolls[p] = (h >>> 16) % 6 + 1; } t++; s = snakesRules.step(s, { type: "turn", rolls, gameMs: t * 10_000 }, 0, clock("live")).state; }
    expect(s.over).toBe(true); const r = finalRanking(s); expect(r.length).toBe(30); expect(new Set(r).size).toBe(30); expect(S.winnerOf(s)).toBe(r[0]);
    expect(s.gameMs).toBeLessThanOrEqual(480_000); // 8 minutes at one throw every 10 s is 48 throws at most
  });
});
