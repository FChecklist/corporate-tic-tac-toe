// S*: the schedule of the new flow, from the owner numbers (31 Oct 2026): waiting room 120 s, 3 stages of 300 s, 3 slots of 100 s each, move clock 10 s, sudden death 5 s.
import { describe, expect, test } from "bun:test";
import * as TTT from "../../vendor/game-core/packages/tictactoe/src";
import { clockAt, SLOTS_PER_STAGE, SLOT_SECONDS, GAME_MAX_SECONDS, SLOT_PAUSE_SECONDS } from "../../vendor/game-core/packages/tictactoe/src";
import { deadlineOf, gameFrom, slotKey, type Entry } from "../../packages/ttt/src/stageplay";

const S0 = Date.UTC(2026, 9, 31, 10, 0, 0);
const at = (sec: number, pausedSec = 0) => clockAt(S0, S0 + sec * 1000, pausedSec * 1000);

describe("S1 the numbers", () => {
  test("S1: waiting room 120 s, 3 stages of 300 s, 3 slots of 100 s, a game takes at most 90 s plus a 10 s pause", () => {
    expect(TTT.WAIT_SECONDS).toBe(120); expect(TTT.STAGE_SECONDS).toBe(300); expect(TTT.STAGES).toBe(3);
    expect(SLOTS_PER_STAGE).toBe(3); expect(SLOT_SECONDS).toBe(100); expect(GAME_MAX_SECONDS).toBe(90); expect(SLOT_PAUSE_SECONDS).toBe(10);
    expect(9 * TTT.MOVE_SECONDS).toBe(GAME_MAX_SECONDS); expect(GAME_MAX_SECONDS + SLOT_PAUSE_SECONDS).toBe(SLOT_SECONDS); expect(SLOTS_PER_STAGE * SLOT_SECONDS).toBe(TTT.STAGE_SECONDS);
  });
  test("S1b: move clock 10 s, sudden death 5 s, points: win 2, draw 1, loss 0, bye 1, five winners", () => {
    expect(TTT.MOVE_SECONDS).toBe(10); expect(TTT.SUDDEN_SECONDS).toBe(5); expect(TTT.moveClockFor(false)).toBe(10); expect(TTT.moveClockFor(true)).toBe(5);
    expect(TTT.gamePoints("a", "a")).toBe(2); expect(TTT.gamePoints("a", "b")).toBe(0); expect(TTT.gamePoints("draw", "a")).toBe(1); expect(TTT.gamePoints("draw", "b")).toBe(1);
    expect(TTT.BYE_POINTS).toBe(1); expect(TTT.WINNERS).toBe(5);
  });
  test("S1c: 17 minutes on the clock in all (120 + 3 x 300 = 1020 s)", () => { expect(TTT.TOTAL_SECONDS).toBe(1020); expect(TTT.PLAY_SECONDS).toBe(900); });
});

describe("S2 the clock, exact seconds", () => {
  test("S2: second 0 to 119 is the waiting room, with exactly the seconds left to the start", () => {
    for (const [el, left] of [[0, 120], [1, 119], [60, 60], [119, 1]] as const) { const c = at(el); expect(c.phase).toBe("waiting"); expect(c.secondsToStart).toBe(left); expect(c.stage).toBe(0); }
    expect(clockAt(S0, S0 + 119_999).phase).toBe("waiting"); // the 120th second has not begun
    expect(clockAt(S0, S0 + 120_000).phase).toBe("slot");
    expect(at(0).slotEndMs).toBe(S0 + 120_000);
  });
  test("S2b: stage 1 slot 1 opens at second 120 and ends at second 220; slot 2 220-320; slot 3 320-420", () => {
    const rows: [number, number, number, number, number][] = [[120, 1, 1, 120, 220], [219, 1, 1, 120, 220], [220, 1, 2, 220, 320], [319, 1, 2, 220, 320], [320, 1, 3, 320, 420], [419, 1, 3, 320, 420]];
    for (const [el, st, sl, from, to] of rows) { const c = at(el); expect([c.phase, c.stage, c.slot]).toEqual(["slot", st, sl]); expect(c.slotStartMs).toBe(S0 + from * 1000); expect(c.slotEndMs).toBe(S0 + to * 1000); expect(c.stageEndMs).toBe(S0 + 420_000); }
  });
  test("S2c: stage 2 opens at 420 s, stage 3 at 720 s, the game is done at 1020 s", () => {
    expect([at(420).stage, at(420).slot]).toEqual([2, 1]); expect([at(719).stage, at(719).slot]).toEqual([2, 3]);
    expect([at(720).stage, at(720).slot]).toEqual([3, 1]); expect([at(1019).stage, at(1019).slot]).toEqual([3, 3]);
    expect(at(1019).secondsLeftInStage).toBe(1); expect(at(1020).phase).toBe("done"); expect(at(5000).phase).toBe("done");
    expect(at(420).stageEndMs).toBe(S0 + 720_000); expect(at(720).stageEndMs).toBe(S0 + 1020_000);
  });
  test("S2d: seconds left in the stage count down 300 to 1 inside every stage", () => {
    for (const base of [120, 420, 720]) { expect(at(base).secondsLeftInStage).toBe(300); expect(at(base + 150).secondsLeftInStage).toBe(150); expect(at(base + 299).secondsLeftInStage).toBe(1); }
  });
  test("S2e: every one of the 900 play seconds belongs to exactly one slot of exactly 100 s", () => {
    const seen = new Map<string, number>();
    for (let el = 120; el < 1020; el++) { const c = at(el); const k = `${c.stage}-${c.slot}`; seen.set(k, (seen.get(k) ?? 0) + 1); expect(c.slotEndMs - c.slotStartMs).toBe(100_000); expect(el * 1000).toBeGreaterThanOrEqual(c.slotStartMs - S0); expect(el * 1000).toBeLessThan(c.slotEndMs - S0); }
    expect(seen.size).toBe(9); for (const n of seen.values()) expect(n).toBe(100);
  });
  test("S2f: a clock read before the start is the waiting room with more than 120 s to go", () => { const c = clockAt(S0, S0 - 30_000); expect(c.phase).toBe("waiting"); expect(c.secondsToStart).toBe(150); });
});

describe("S3 pause freezes the clock", () => {
  test("S3: 50 s paused in the waiting room shifts everything by exactly 50 s", () => {
    expect(at(100, 50).secondsToStart).toBe(70); expect(at(169, 50).secondsToStart).toBe(1); expect([at(170, 50).phase, at(170, 50).stage, at(170, 50).slot]).toEqual(["slot", 1, 1]);
    expect(at(0, 50).slotEndMs).toBe(S0 + 170_000);
  });
  test("S3b: paused during a slot: the slot, its end and the stage end move by the paused time; the seconds left in the stage do not shrink", () => {
    const a = at(150), b = at(150 + 40, 40);
    expect([b.stage, b.slot, b.secondsLeftInStage]).toEqual([a.stage, a.slot, a.secondsLeftInStage]);
    expect(b.slotEndMs).toBe(a.slotEndMs + 40_000); expect(b.stageEndMs).toBe(a.stageEndMs + 40_000);
  });
  test("S3c: the game is done exactly 1020 s plus the paused time after the start", () => { expect(at(1019 + 600, 600).phase).toBe("slot"); expect(at(1020 + 600, 600).phase).toBe("done"); });
});

describe("S4 move clock arithmetic", () => {
  const pair = ["aaaa1", "bbbb2"] as const;
  const e = (id: number, seq: number, pid: string, body: string, at_ms?: number): Entry => ({ id, slot: slotKey(1, 1, pair[0], pair[1]), kind: "move", pid, seq, body, at_ms });
  test("S4: the first move is due 10 s after the slot start", () => {
    const g = gameFrom([], pair[0], pair[1]); expect(deadlineOf(g, S0, [], S0 + 1)).toBe(S0 + 10_000);
  });
  test("S4b: each next move is due 10 s after the last entry, to the millisecond", () => {
    const g0 = gameFrom([], pair[0], pair[1]); const x = g0.xIs, o = x === pair[0] ? pair[1] : pair[0];
    const g = gameFrom([e(1, 0, x, "4", S0 + 3_250)], pair[0], pair[1]); expect(g.next).toBe(o); expect(deadlineOf(g, S0, [], S0 + 4000)).toBe(S0 + 13_250);
  });
  test("S4c: a pause inside the 10 s adds exactly its length; a pause before the last entry adds nothing; an open pause counts up to now", () => {
    const g = gameFrom([], pair[0], pair[1]);
    expect(deadlineOf(g, S0, [[S0 + 4_000, S0 + 9_000]], S0 + 20_000)).toBe(S0 + 15_000);
    const x = g.xIs; const g1 = gameFrom([e(1, 0, x, "4", S0 + 30_000)], pair[0], pair[1]);
    expect(deadlineOf(g1, S0, [[S0 + 4_000, S0 + 9_000]], S0 + 40_000)).toBe(S0 + 40_000);
    expect(deadlineOf(g, S0, [[S0 + 4_000, null]], S0 + 7_000)).toBe(S0 + 13_000);
  });
  test("S5: a missed move ('-') loses that turn and the opponent moves; two misses in a row are a draw", () => {
    const g0 = gameFrom([], pair[0], pair[1]), x = g0.xIs, o = x === pair[0] ? pair[1] : pair[0];
    const g1 = gameFrom([e(1, 0, o, "-", S0 + 10_000)], pair[0], pair[1]); expect(g1.next).toBe(o); expect(g1.done).toBe(false); expect(g1.board.every((c) => c === null)).toBe(true);
    const g2 = gameFrom([e(1, 0, o, "-", S0 + 10_000), e(2, 1, o, "-", S0 + 20_000)], pair[0], pair[1]); expect(g2.done).toBe(true); expect(g2.winner).toBe("draw");
    expect(TTT.afterMissedMove(true, false)).toBe("opponent-moves"); expect(TTT.afterMissedMove(true, true)).toBe("draw");
  });
  test("S5b: a miss followed by a real move resets the miss count (miss, move, miss does not end the game)", () => {
    const g0 = gameFrom([], pair[0], pair[1]), x = g0.xIs, o = x === pair[0] ? pair[1] : pair[0];
    const g = gameFrom([e(1, 0, x, "-"), e(2, 1, o, "4"), e(3, 2, x, "-")], pair[0], pair[1]); expect(g.done).toBe(false); expect(g.next).toBe(o);
  });
  test("S5c: a game of 9 moves ends in a draw or a win, never later: nine moves of 10 s fit in 90 s", () => {
    const g0 = gameFrom([], pair[0], pair[1]), x = g0.xIs, o = x === pair[0] ? pair[1] : pair[0];
    const sq = [0, 1, 2, 4, 3, 5, 7, 6, 8]; // a full board with no line
    const es = sq.map((s, i) => e(i + 1, i, i % 2 === 0 ? x : o, String(s), S0 + (i + 1) * 10_000));
    const g = gameFrom(es, pair[0], pair[1]); expect(g.done).toBe(true); expect(g.winner).toBe("draw"); expect(g.entries).toBe(9); expect(g.lastAtMs! - S0).toBeLessThanOrEqual(GAME_MAX_SECONDS * 1000);
  });
});
