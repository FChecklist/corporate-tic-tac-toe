// docs/RULES.md sections B and C: R07 to R15 (a board, the clock, starters, draws, fate, forfeits).
import { describe, expect, test } from "bun:test";
import { advanceBoard, applyMove, fateOf, lastGame, moverOf, newBoard, shiftBoard, type BoardState, type Cfg } from "../src/match";
import { coin } from "../src/random";
import { emptiesOf } from "../src/classic";

const cfg: Cfg = { seed: "seed-A", moveMs: 20_000, readyMs: 30_000 };
const T0 = 1_000_000;
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8]; // X0 O1 X2 O4 X3 O5 X7 O6 X8 : a drawn game, X first
const WIN_X = [0, 3, 1, 4, 2]; // X0 O3 X1 O4 X2 : X wins on the top row

/** Plays the listed cells, each by whoever is to move, one second apart, from `t`. Returns the time after the last move. */
async function seq(board: BoardState, cells: number[], t: number, mid = "m1", c = cfg): Promise<number> {
  for (const cell of cells) { const g = lastGame(board); const r = await applyMove(c, mid, board, moverOf(g), cell, t); expect(r.ok).toBe(true); t += 1000; }
  return t;
}

describe("R07-R10 a board", () => {
  test("R07: the first decided game ends the board, the winner is the player with three in a row", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); await seq(b, WIN_X, T0 + 1000);
    const g = lastGame(b);
    expect(b.done).toBe(true); expect(b.via).toBe("win"); expect(b.winner).toBe(g.x); expect(b.games.length).toBe(1);
  });
  test("R08: a drawn game is replayed at once with the marks swapped", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const x1 = b.games[0]!.x;
    await seq(b, DRAW, T0 + 1000);
    expect(b.done).toBe(false); expect(b.games.length).toBe(2);
    expect(b.games[1]!.x).not.toBe(x1); expect(b.games[1]!.o).toBe(x1);
    expect(b.games[1]!.cells.every((c) => c === 0)).toBe(true);
  });
  test("R08: a draw then a win in game 2 decides the board, and the win counts for whoever has X in game 2", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const t = await seq(b, DRAW, T0 + 1000); await seq(b, WIN_X, t);
    expect(b.done).toBe(true); expect(b.games.length).toBe(2); expect(b.winner).toBe(b.games[1]!.x);
  });
  test("R08: at most three games", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); let t = T0 + 1000;
    for (let i = 0; i < 3; i++) t = await seq(b, DRAW, t);
    expect(b.games.length).toBe(3); expect(b.done).toBe(true);
  });
  test("R09: game 1 starter is a coin from the seed, game 2 swaps, game 3 is its own coin; the same on every run", async () => {
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      const c = { ...cfg, seed };
      const b = await newBoard(c, "m9", 2, "ann", "ben", T0); let t = T0 + 1000;
      const aHasX = await coin(seed, "first|m9|2");
      expect(b.games[0]!.x).toBe(aHasX ? "ann" : "ben");
      t = await seq(b, DRAW, t, "m9", c); expect(b.games[1]!.x).toBe(aHasX ? "ben" : "ann");
      await seq(b, DRAW, t, "m9", c);
      expect(b.games[2]!.x).toBe((await coin(seed, "third|m9|2")) ? "ann" : "ben");
      const again = await newBoard(c, "m9", 2, "ann", "ben", T0); expect(again.games[0]!.x).toBe(b.games[0]!.x);
    }
  });
  test("R09: over many boards each player gets X about half the time", async () => {
    let a = 0; const N = 400;
    for (let i = 0; i < N; i++) if ((await newBoard(cfg, `r1m${i}`, 0, "ann", "ben", T0)).games[0]!.x === "ann") a++;
    expect(a).toBeGreaterThan(N * 0.4); expect(a).toBeLessThan(N * 0.6);
  });
  test("R10: three drawn games are decided by fate: the lower fate number wins, and it is recomputable from public data", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); let t = T0 + 1000;
    for (let i = 0; i < 3; i++) t = await seq(b, DRAW, t);
    const [fa, fb] = [await fateOf(cfg.seed, "m1", 0, "ann"), await fateOf(cfg.seed, "m1", 0, "ben")];
    expect(b.via).toBe("fate"); expect(b.winner).toBe(fa < fb ? "ann" : "ben");
    expect(b.points).toEqual({ ann: 3, ben: 3 });
  });
});

describe("R11-R15 the clock", () => {
  test("R06/R11: a move out of turn is refused; the first move of a match has the ready time", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const g = lastGame(b);
    expect(g.deadline).toBe(T0 + cfg.readyMs);
    const other = g.x === "ann" ? "ben" : "ann";
    expect((await applyMove(cfg, "m1", b, other, 4, T0 + 1)).ok).toBe(false);
    expect(await applyMove(cfg, "m1", b, moverOf(g), 4, T0 + 1)).toMatchObject({ ok: true });
    expect(lastGame(b).deadline).toBe(T0 + 1 + cfg.moveMs); // after a real move the clock is the move clock
  });
  test("R11: a move at the last moment of the clock is accepted, one millisecond later the software has already played", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const g = lastGame(b);
    expect((await applyMove(cfg, "m1", b, moverOf(g), 4, T0 + cfg.readyMs)).ok).toBe(true);
    expect(lastGame(b).moves[0]!.auto).toBeUndefined();
    const b2 = await newBoard(cfg, "m1", 0, "ann", "ben", T0);
    await applyMove(cfg, "m1", b2, moverOf(lastGame(b2)), 4, T0 + cfg.readyMs + 1);
    expect(lastGame(b2).moves[0]!.auto).toBe(true);
  });
  test("R11 late move: a tap after the turn ended is answered late-move, nothing of it is placed, and the square the software played stays", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const g = lastGame(b); const late = moverOf(g);
    const r = await applyMove(cfg, "m1", b, late, 4, T0 + cfg.readyMs + 1);
    expect(r).toMatchObject({ ok: false, error: "late-move" });
    expect(lastGame(b).moves.length).toBe(1); expect(lastGame(b).moves[0]!.auto).toBe(true); expect(lastGame(b).moves[0]!.pid).toBe(late);
    expect(lastGame(b).cells.filter((c) => c).length).toBe(1);
    const other = late === "ann" ? "ben" : "ann";
    expect((await applyMove(cfg, "m1", b, other, emptiesOf(lastGame(b).cells)[0]!, T0 + cfg.readyMs + 2)).ok).toBe(true); // the other player's turn is open and unharmed
  });
  test("R11 late move: the same late tap by the player whose clock-out made them forfeit is also late-move; a player who was away so long that it is their turn again is accepted", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const first = moverOf(lastGame(b));
    await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + 1); await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + cfg.moveMs + 1); // X and O each missed once
    // 80 s after the start the first player taps: both clock-outs have been played and it is their turn again with a fresh clock
    const ok = await applyMove(cfg, "m1", b, first, emptiesOf(lastGame(b).cells)[0]!, T0 + cfg.readyMs + cfg.moveMs + 5_000);
    expect(ok.ok).toBe(true);
    const f = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const x = moverOf(lastGame(f));
    await advanceBoard(cfg, "m1", f, T0 + cfg.readyMs + 1); await advanceBoard(cfg, "m1", f, T0 + cfg.readyMs + cfg.moveMs + 1); // each missed once; X is to move again
    const r = await applyMove(cfg, "m1", f, x, emptiesOf(lastGame(f).cells)[0]!, T0 + cfg.readyMs + 2 * cfg.moveMs + 1); // X's second miss makes X forfeit before this tap
    expect(r).toMatchObject({ ok: false, error: "late-move" }); expect(f.done).toBe(true); expect(f.winner).not.toBe(x);
  });
  test("R11: a tap in time is never answered late-move (a move at the last millisecond, a tap by the player who is not to move)", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const g = lastGame(b); const other = g.x === "ann" ? "ben" : "ann";
    expect(await applyMove(cfg, "m1", b, other, 0, T0 + 5_000)).toMatchObject({ ok: false, error: "not-your-turn" });
    expect((await applyMove(cfg, "m1", b, g.x, 0, T0 + cfg.readyMs)).ok).toBe(true);
  });
  test("R12: when the clock runs out the software plays a seeded square for that player, the same every time", async () => {
    const mk = async () => { const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + 1); return b; };
    const [b1, b2] = [await mk(), await mk()];
    const m = lastGame(b1).moves[0]!;
    expect(m.auto).toBe(true); expect(m.at).toBe(T0 + cfg.readyMs); expect(m.pid).toBe(b1.games[0]!.x);
    expect(lastGame(b2).moves[0]!.cell).toBe(m.cell);
  });
  test("R12/R15: the result does not depend on when anybody looks (one late look equals many early looks)", async () => {
    const once = await newBoard(cfg, "m1", 0, "ann", "ben", T0); await advanceBoard(cfg, "m1", once, T0 + 500_000);
    const many = await newBoard(cfg, "m1", 0, "ann", "ben", T0); for (let t = T0; t <= T0 + 500_000; t += 7_000) await advanceBoard(cfg, "m1", many, t); await advanceBoard(cfg, "m1", many, T0 + 500_000);
    expect(JSON.stringify(many)).toBe(JSON.stringify(once));
  });
  test("R13: a second clock-out in a row in one game loses the board by forfeit", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const first = b.games[0]!.x;
    await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + 1); // X's first clock-out: a square is played for X
    expect(b.done).toBe(false);
    await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + cfg.moveMs + 1); // O's first clock-out
    expect(b.done).toBe(false);
    await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + 2 * cfg.moveMs + 1); // X's second in a row
    expect(b.done).toBe(true); expect(b.via).toBe("forfeit"); expect(b.winner).not.toBe(first);
  });
  test("R13: a real move resets the count", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const g = b.games[0]!; const xs = g.x, os = g.o;
    await advanceBoard(cfg, "m1", b, T0 + cfg.readyMs + 1); // X missed once
    const cell = emptiesOf(g.cells)[0]!;
    expect((await applyMove(cfg, "m1", b, os, cell, T0 + cfg.readyMs + 2)).ok).toBe(true); // O moves for real
    const cell2 = emptiesOf(g.cells)[0]!;
    expect((await applyMove(cfg, "m1", b, xs, cell2, T0 + cfg.readyMs + 3)).ok).toBe(true); // X moves for real: X's count is back to zero
    expect(g.missed[xs]).toBe(0);
  });
  test("R14: if both players stay away the one due to start loses", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const first = b.games[0]!.x;
    await advanceBoard(cfg, "m1", b, T0 + 10 * 60_000);
    expect(b.done).toBe(true); expect(b.via).toBe("forfeit"); expect(b.winner).not.toBe(first);
  });
  test("R15: a stale tap (an old screen) is refused, a player outside the board is refused, bad squares are refused", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const g = lastGame(b);
    expect(await applyMove(cfg, "m1", b, moverOf(g), 4, T0 + 1, 3)).toMatchObject({ ok: false, error: "stale" });
    expect(await applyMove(cfg, "m1", b, "eve", 4, T0 + 1)).toMatchObject({ ok: false, error: "not-in-board" });
    expect(await applyMove(cfg, "m1", b, moverOf(g), 9, T0 + 1)).toMatchObject({ ok: false, error: "bad-square" });
    await applyMove(cfg, "m1", b, moverOf(g), 4, T0 + 1);
    expect(await applyMove(cfg, "m1", b, moverOf(lastGame(b)), 4, T0 + 2)).toMatchObject({ ok: false, error: "square-taken" });
  });
  test("R28: a pause shifts the open clock by the length of the pause", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); const d = lastGame(b).deadline; shiftBoard(b, 60_000);
    expect(lastGame(b).deadline).toBe(d + 60_000);
    await advanceBoard(cfg, "m1", b, d + 1); expect(lastGame(b).moves.length).toBe(0); // still waiting, no clock-out yet
  });
  test("a finished board accepts no more moves", async () => {
    const b = await newBoard(cfg, "m1", 0, "ann", "ben", T0); await seq(b, WIN_X, T0 + 1000);
    expect(await applyMove(cfg, "m1", b, "ann", 8, T0 + 9000)).toMatchObject({ ok: false, error: "match-over" });
  });
});
