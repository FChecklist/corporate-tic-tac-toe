// Corporate Tic Tac Toe: the rules of the game, as pure functions. Runs identically on every phone and laptop; no server is involved.
//
// A match is three boards: 3x3, 4x4, 5x5. Every board is played until it is full. Points come from RUNS (unbroken stretches of one
// player's marks along a row, a column or a diagonal). The player with the most points over all three boards wins the match.

export type Dir = "H" | "V" | "D";
export type Cell = 0 | 1 | 2; // 0 empty, 1 = X (moves first on that board), 2 = O
export const BOARD_SIZES = [3, 4, 5] as const;
export type Size = (typeof BOARD_SIZES)[number];

/** Points for a run, by its length and direction. Shown to every player before and during the match (owner order: players are told exactly how points are calculated). */
export const POINTS: Readonly<Record<number, Readonly<Record<Dir, number>>>> = {
  2: { H: 1, V: 2, D: 3 },
  3: { H: 5, V: 10, D: 15 },
  4: { H: 15, V: 30, D: 45 },
  5: { H: 40, V: 80, D: 120 },
};
export const DIR_NAME: Readonly<Record<Dir, string>> = { H: "horizontal", V: "vertical", D: "diagonal" };

/** Bonus points for the player who moves SECOND on a board. On an odd board the first player places one more mark; this evens it out. Set from `sim/komi.ts`. */
export const KOMI: Readonly<Record<Size, number>> = { 3: 8, 4: 6, 5: 22 };
// Starting values from `sim/komi.ts` (2026-10-12): with no bonus the first player scored about 7-9 (3x3), 4-8 (4x4) and 17-27 (5x5) points more than the second one against simple bots; these are the averages of the two bot kinds. Re-check them with real matches.

/** Seconds a player has for one move. After that a move is chosen at random for them (the mover's own phone signs it). */
export const MOVE_SECONDS = 8;

export interface Run { dir: Dir; len: number; points: number; cells: number[] }
export interface SideScore { total: number; runs: Run[]; komi: number }
export interface BoardScore { x: SideScore; o: SideScore }

export const emptyBoard = (n: Size): Cell[] => Array<Cell>(n * n).fill(0);
export const isFull = (b: readonly Cell[]): boolean => b.every((c) => c !== 0);
export const marksOf = (b: readonly Cell[], who: 1 | 2): number => { let t = 0; for (const c of b) if (c === who) t++; return t; };

/** Every line of the board as a list of cell indexes, with its direction. Diagonals shorter than 2 cells are left out. */
export function linesOf(n: number): { dir: Dir; cells: number[] }[] {
  const out: { dir: Dir; cells: number[] }[] = [];
  for (let r = 0; r < n; r++) out.push({ dir: "H", cells: Array.from({ length: n }, (_, c) => r * n + c) });
  for (let c = 0; c < n; c++) out.push({ dir: "V", cells: Array.from({ length: n }, (_, r) => r * n + c) });
  for (let s = 0; s < n; s++) {
    // down-right diagonals starting on the top row and on the left column
    for (const [r0, c0] of (s === 0 ? [[0, 0]] : [[0, s], [s, 0]]) as [number, number][]) {
      const cells: number[] = []; for (let r = r0, c = c0; r < n && c < n; r++, c++) cells.push(r * n + c);
      if (cells.length >= 2) out.push({ dir: "D", cells });
    }
    // down-left diagonals starting on the top row and on the right column
    for (const [r0, c0] of (s === 0 ? [[0, n - 1]] : [[0, n - 1 - s], [s, n - 1]]) as [number, number][]) {
      const cells: number[] = []; for (let r = r0, c = c0; r < n && c >= 0; r++, c--) cells.push(r * n + c);
      if (cells.length >= 2) out.push({ dir: "D", cells });
    }
  }
  return out;
}

/** Score one board for both players. Only the unbroken run counts (a run of 4 is worth a 4, not also a 3 and a 2). */
export function scoreBoard(board: readonly Cell[], n: Size): BoardScore {
  const sides: Record<1 | 2, SideScore> = { 1: { total: 0, runs: [], komi: 0 }, 2: { total: 0, runs: [], komi: 0 } };
  for (const line of linesOf(n)) {
    let i = 0;
    while (i < line.cells.length) {
      const who = board[line.cells[i]!]!;
      let j = i; while (j < line.cells.length && board[line.cells[j]!] === who) j++;
      const len = j - i;
      if (who !== 0 && len >= 2) {
        const pts = POINTS[len]?.[line.dir] ?? 0;
        sides[who].runs.push({ dir: line.dir, len, points: pts, cells: line.cells.slice(i, j) });
        sides[who].total += pts;
      }
      i = j;
    }
  }
  sides[2].komi = KOMI[n]; sides[2].total += KOMI[n];
  return { x: sides[1], o: sides[2] };
}

/** One sentence per run, for the live score breakdown on the screen. */
export const explainRun = (r: Run): string => `${DIR_NAME[r.dir]} run of ${r.len} = ${r.points}`;
export const explainSide = (s: SideScore): string[] => [...s.runs.map(explainRun), ...(s.komi ? [`second-player bonus = ${s.komi}`] : [])];

/** The rules card shown to every player before the match. */
export function rulesText(): string[] {
  const rows = [2, 3, 4, 5].map((len) => `Run of ${len}: horizontal ${POINTS[len]!.H}, vertical ${POINTS[len]!.V}, diagonal ${POINTS[len]!.D}`);
  return [
    "Three boards: 3x3, then 4x4, then 5x5. Each board is played until it is full.",
    "A run is an unbroken stretch of your marks along a row, a column or a diagonal. Only the longest unbroken stretch counts, so a run of 4 is worth a 4, not also a 3 and a 2.",
    ...rows,
    "3x3 uses runs of 2 and 3. 4x4 uses 2 to 4. 5x5 uses 2 to 5.",
    "You have 8 seconds per move. If time runs out, a move is placed for you at random.",
    "The player with the most points over all three boards wins the match.",
  ];
}

export interface MatchScore { a: number; b: number; boards: { n: Size; a: number; b: number; xIsA: boolean }[]; winner: "A" | "B" | null; tieBreak?: string }

/** Totals for a match. `xIsA[i]` says whether player A had X (moved first) on board i. */
export function matchScore(boards: readonly { n: Size; cells: readonly Cell[]; xIsA: boolean }[]): MatchScore {
  let a = 0, b = 0; const per: MatchScore["boards"] = []; let bestA = 0, bestB = 0;
  for (const bd of boards) {
    const s = scoreBoard(bd.cells, bd.n);
    const sa = bd.xIsA ? s.x : s.o, sb = bd.xIsA ? s.o : s.x;
    a += sa.total; b += sb.total; per.push({ n: bd.n, a: sa.total, b: sb.total, xIsA: bd.xIsA });
    for (const r of sa.runs) bestA = Math.max(bestA, r.points); for (const r of sb.runs) bestB = Math.max(bestB, r.points);
  }
  const out: MatchScore = { a, b, boards: per, winner: a > b ? "A" : b > a ? "B" : null };
  if (out.winner) return out;
  const last = per[per.length - 1];
  const t = breakTie(bestA, bestB, last?.a ?? 0, last?.b ?? 0);
  return { ...out, winner: t.winner, tieBreak: t.rule };
}

/** An exact tie on total points is decided in this order: the most valuable single run, then the points on the last (5x5) board; the last resort is the random beacon (random.ts). */
export function breakTie(bestA: number, bestB: number, lastA: number, lastB: number): { winner: "A" | "B" | null; rule: string } {
  if (bestA !== bestB) return { winner: bestA > bestB ? "A" : "B", rule: "most valuable single run" };
  if (lastA !== lastB) return { winner: lastA > lastB ? "A" : "B", rule: "points on the last board" };
  return { winner: null, rule: "beacon" };
}

/** The legal moves: every empty cell. */
export const emptyCells = (b: readonly Cell[]): number[] => b.flatMap((c, i) => (c === 0 ? [i] : []));
/** Whose mark goes next: X starts, then they alternate. */
export const nextMark = (b: readonly Cell[]): 1 | 2 => (marksOf(b, 1) === marksOf(b, 2) ? 1 : 2);
