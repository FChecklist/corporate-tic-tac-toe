import { describe, expect, test } from "bun:test";
import { BOARD_SIZES, KOMI, POINTS, breakTie, emptyBoard, explainSide, linesOf, matchScore, nextMark, rulesText, scoreBoard, type Cell } from "../src/engine";

const B = (s: string): Cell[] => s.replace(/\s/g, "").split("").map((c) => (c === "X" ? 1 : c === "O" ? 2 : 0)) as Cell[];

describe("lines", () => {
  test("the number of lines on each board", () => {
    // n rows + n columns + the diagonals of length >= 2 in both directions: 3x3 -> 3+3+6, 4x4 -> 4+4+10, 5x5 -> 5+5+14
    expect(linesOf(3).length).toBe(12); expect(linesOf(4).length).toBe(18); expect(linesOf(5).length).toBe(24);
  });
  test("every line is straight and inside the board", () => {
    for (const n of [3, 4, 5]) for (const l of linesOf(n)) {
      expect(l.cells.length).toBeGreaterThanOrEqual(2);
      for (const c of l.cells) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(n * n); }
      const steps = new Set(l.cells.slice(1).map((c, i) => c - l.cells[i]!)); expect(steps.size).toBe(1);
    }
  });
});

describe("scoring (the default table)", () => {
  test("the table", () => {
    expect(POINTS[2]).toEqual({ H: 1, V: 2, D: 3 }); expect(POINTS[3]).toEqual({ H: 5, V: 10, D: 15 });
    expect(POINTS[4]).toEqual({ H: 15, V: 30, D: 45 }); expect(POINTS[5]).toEqual({ H: 40, V: 80, D: 120 });
  });
  test("the worked example: X 14, O 11", () => {
    const s = scoreBoard(B("XOX XOO XXO"), 3);
    expect(s.x.total).toBe(14); expect(s.o.total).toBe(11 + KOMI[3]);
    expect(s.x.runs.map((r) => `${r.dir}${r.len}`).sort()).toEqual(["D2", "H2", "V3"]);
    expect(s.o.runs.map((r) => `${r.dir}${r.len}`).sort()).toEqual(["D2", "D2", "H2", "V2", "V2"]);
    expect(explainSide(s.x).sort()).toEqual(["diagonal run of 2 = 3", "horizontal run of 2 = 1", "vertical run of 3 = 10"]);
  });
  test("only the unbroken run counts: a run of 4 is a 4, not also a 3 and a 2", () => {
    const b = emptyBoard(4); for (const i of [0, 1, 2, 3]) b[i] = 1;
    const s = scoreBoard(b, 4); expect(s.x.runs).toHaveLength(1); expect(s.x.total).toBe(POINTS[4]!.H);
  });
  test("an opponent's mark breaks a run: X X O X in a row is one run of 2", () => {
    const b = emptyBoard(4); b[0] = 1; b[1] = 1; b[2] = 2; b[3] = 1;
    const s = scoreBoard(b, 4); expect(s.x.total).toBe(1); expect(s.x.runs).toHaveLength(1);
  });
  test("a single mark scores nothing, an empty board scores nothing", () => {
    expect(scoreBoard(emptyBoard(5), 5).x.total).toBe(0);
    const b = emptyBoard(3); b[4] = 1; expect(scoreBoard(b, 3).x.total).toBe(0);
  });
  test("both diagonals score as diagonals", () => {
    const b = emptyBoard(3); b[0] = 1; b[4] = 1; b[8] = 1; const c = emptyBoard(3); c[2] = 1; c[4] = 1; c[6] = 1;
    expect(scoreBoard(b, 3).x.total).toBe(15); expect(scoreBoard(c, 3).x.total).toBe(15);
  });
  test("a full row of 5 on the 5x5 is worth 40, a full column 80, the main diagonal 120", () => {
    const row = emptyBoard(5); for (let c = 0; c < 5; c++) row[c] = 1; expect(scoreBoard(row, 5).x.total).toBe(40);
    const col = emptyBoard(5); for (let r = 0; r < 5; r++) col[r * 5] = 1; expect(scoreBoard(col, 5).x.total).toBe(80);
    const dia = emptyBoard(5); for (let i = 0; i < 5; i++) dia[i * 6] = 1; expect(scoreBoard(dia, 5).x.total).toBe(120);
  });
  test("a run on a shorter diagonal scores too: two in the corner diagonal of a 4x4", () => {
    const b = emptyBoard(4); b[1] = 1; b[6] = 1; expect(scoreBoard(b, 4).x.total).toBe(3);
  });
  test("the second-player bonus is added to O only", () => {
    for (const n of BOARD_SIZES) { const s = scoreBoard(emptyBoard(n), n); expect(s.o.total).toBe(KOMI[n]); expect(s.x.total).toBe(0); }
  });
});

describe("match totals and tie-breaks", () => {
  test("the most points over the three boards wins", () => {
    const r = matchScore([{ n: 3, cells: B("XOX XOO XXO"), xIsA: true }, { n: 4, cells: emptyBoard(4), xIsA: false }, { n: 5, cells: emptyBoard(5), xIsA: true }]);
    // A has X on 3x3 and 5x5, B has X on 4x4: A gets the second-player bonus on the 4x4, B on the 3x3 and 5x5
    expect(r.a).toBe(14 + KOMI[4]); expect(r.b).toBe(11 + KOMI[3] + KOMI[5]); expect(r.boards[0]).toMatchObject({ n: 3, a: 14, b: 11 + KOMI[3] });
    expect(r.winner).toBe(r.a > r.b ? "A" : "B");
  });
  test("the player who had O on a board collects that board's O points", () => {
    const r = matchScore([{ n: 3, cells: B("XOX XOO XXO"), xIsA: false }, { n: 4, cells: emptyBoard(4), xIsA: true }, { n: 5, cells: emptyBoard(5), xIsA: true }]);
    // B has X on the 3x3 (14), A has O there (11 + bonus); A has X on 4x4 and 5x5, so B gets the bonus on those two
    expect(r.b).toBe(14 + KOMI[4] + KOMI[5]); expect(r.a).toBe(11 + KOMI[3]); expect(r.winner).toBe("B");
  });
  test("tie-break order: most valuable single run, then the last board, then the random beacon", () => {
    expect(breakTie(45, 30, 0, 99)).toEqual({ winner: "A", rule: "most valuable single run" });
    expect(breakTie(30, 30, 10, 20)).toEqual({ winner: "B", rule: "points on the last board" });
    expect(breakTie(30, 30, 20, 20)).toEqual({ winner: null, rule: "beacon" });
  });
  test("a tie on points is broken by the most valuable single run, found by searching real boards", () => {
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const fill = (n: 3 | 4 | 5): Cell[] => { const marks: Cell[] = []; const total = n * n; for (let i = 0; i < total; i++) marks.push(i < Math.ceil(total / 2) ? 1 : 2); for (let i = total - 1; i > 0; i--) { const j = rnd() % (i + 1); [marks[i], marks[j]] = [marks[j]!, marks[i]!]; } return marks; };
    let checked = 0;
    for (let k = 0; k < 40000 && checked < 25; k++) {
      const boards = [{ n: 3 as const, cells: fill(3), xIsA: true }, { n: 4 as const, cells: fill(4), xIsA: false }, { n: 5 as const, cells: fill(5), xIsA: true }];
      const r = matchScore(boards); if (r.a !== r.b) continue;
      const best = (who: "A" | "B") => Math.max(0, ...boards.flatMap((bd) => { const s = scoreBoard(bd.cells, bd.n); const side = (bd.xIsA === (who === "A")) ? s.x : s.o; return side.runs.map((x) => x.points); }));
      if (best("A") === best("B")) continue;
      expect(r.winner).toBe(best("A") > best("B") ? "A" : "B"); expect(r.tieBreak).toBe("most valuable single run"); checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("turn order and the rules card", () => {
  test("X moves first, then they alternate", () => {
    const b = emptyBoard(3); expect(nextMark(b)).toBe(1); b[0] = 1; expect(nextMark(b)).toBe(2); b[1] = 2; expect(nextMark(b)).toBe(1);
  });
  test("the rules card states every number a player needs", () => {
    const t = rulesText().join("\n");
    for (const len of [2, 3, 4, 5]) { expect(t).toContain(`Run of ${len}:`); expect(t).toContain(`horizontal ${POINTS[len]!.H}`); expect(t).toContain(`diagonal ${POINTS[len]!.D}`); }
    expect(t).toContain("8 seconds"); expect(t).toContain("most points over all three boards");
  });
});
