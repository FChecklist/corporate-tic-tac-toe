// docs/RULES.md section A (the plain 3x3 game): R01 to R06.
import { describe, expect, test } from "bun:test";
import { LINES, emptyCells, emptiesOf, markToMove, outcomeOf, place, type Mark } from "../src/classic";

const b = (s: string): Mark[] => [...s.replace(/\s/g, "")].map((c) => (c === "X" ? 1 : c === "O" ? 2 : 0));

describe("R01-R06 the game", () => {
  test("R01: the board has nine squares and eight lines", () => {
    expect(emptyCells().length).toBe(9); expect(LINES.length).toBe(8);
    expect(new Set(LINES.flat()).size).toBe(9);
  });
  test("R02: X moves first, then O, taking turns", () => {
    let c = emptyCells(); const seen: number[] = [];
    for (const cell of [4, 0, 8, 2]) { seen.push(markToMove(c)); c = place(c, cell, markToMove(c)); }
    expect(seen).toEqual([1, 2, 1, 2]);
  });
  test("R03: a taken square or a square off the board is refused", () => {
    const c = place(emptyCells(), 4, 1);
    expect(() => place(c, 4, 2)).toThrow("taken");
    for (const bad of [-1, 9, 1.5, NaN]) expect(() => place(c, bad, 2)).toThrow("not on the board");
  });
  test("R04: each of the eight lines wins, for X and for O", () => {
    for (const l of LINES) for (const mark of [1, 2] as const) {
      const c = emptyCells(); for (const i of l) c[i] = mark;
      expect(outcomeOf(c)).toEqual({ kind: "win", mark, line: [...l] });
    }
  });
  test("R04: two in a row is not a win", () => { expect(outcomeOf(b("XX. ... ...")).kind).toBe("playing"); });
  test("R05: a full board with no line is a draw", () => { expect(outcomeOf(b("XOX XOO OXX")).kind).toBe("draw"); });
  test("R05: a full board that has a line is a win, not a draw", () => { expect(outcomeOf(b("XXX OOX XOO")).kind).toBe("win"); });
  test("R06: only empty squares are listed as moves", () => { expect(emptiesOf(b("XO. ... ..O"))).toEqual([2, 3, 4, 5, 6, 7]); });
});
