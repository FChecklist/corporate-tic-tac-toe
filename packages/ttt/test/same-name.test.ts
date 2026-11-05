// TT-26 (gap plan 2026-10-29): two players who joined with the same name ("Rahul") must each be told the truth about THEIR board. The view said "You won"
// by comparing names; it now carries youWon, worked out from the player ids, and the page uses it.
import { describe, expect, test } from "bun:test";
import { boardView } from "../src/phone";
import type { BoardState } from "../src/match";

const names = { pA: "Rahul", pB: "Rahul" };
const finished = (winner: string): BoardState => ({
  j: 0, a: "pA", b: "pB", done: true, winner, via: "win", points: { pA: winner === "pA" ? 2 : 0, pB: winner === "pB" ? 2 : 0 },
  games: [{ no: 1, x: "pA", o: "pB", cells: [1, 1, 1, 2, 2, 0, 0, 0, 0], moves: [], deadline: 0, missed: {}, result: { kind: "win", winner, line: [0, 1, 2], at: 1 } }],
} as unknown as BoardState);

describe("a board between two players with the same name", () => {
  test("each player's view says who won by id, not by name", () => {
    const b = finished("pA");
    expect(boardView(b, names, [], false, "pA").youWon).toBe(true);
    expect(boardView(b, names, [], false, "pB").youWon).toBe(false);
    expect(boardView(finished("pB"), names, [], false, "pB").youWon).toBe(true);
    expect(boardView(finished("pB"), names, [], false, "pA").youWon).toBe(false);
  });
  test("an unfinished board and a spectator's view have no youWon claim", () => {
    const open = { ...finished("pA"), done: false, winner: undefined } as unknown as BoardState;
    expect(boardView(open, names, [], false, "pA").youWon).toBe(false);
    expect((boardView(finished("pA"), names, [], false) as any).youWon).toBeUndefined();
  });
});
