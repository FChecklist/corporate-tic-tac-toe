// Corporate Tic Tac Toe: the plain 3x3 game, as pure functions. Three in a row wins. A full board with no line is a draw.
// (The earlier scored three-board prototype is still in this folder as engine.ts; the product does not use it. See docs/RULES.md.)

export type Mark = 0 | 1 | 2; // 0 empty, 1 = X (moves first), 2 = O

/** The eight lines of the board: three rows, three columns, two diagonals. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const emptyCells = (): Mark[] => Array<Mark>(9).fill(0);
export const emptiesOf = (cells: readonly Mark[]): number[] => { const o: number[] = []; for (let i = 0; i < 9; i++) if (cells[i] === 0) o.push(i); return o; };

export type Outcome = { kind: "playing" } | { kind: "win"; mark: 1 | 2; line: number[] } | { kind: "draw" };

/** What the board says now: someone has three in a row, or it is full (a draw), or play goes on. */
export function outcomeOf(cells: readonly Mark[]): Outcome {
  for (const l of LINES) {
    const m = cells[l[0]]!;
    if (m !== 0 && m === cells[l[1]] && m === cells[l[2]]) return { kind: "win", mark: m as 1 | 2, line: [...l] };
  }
  return emptiesOf(cells).length === 0 ? { kind: "draw" } : { kind: "playing" };
}

/** A new board with the mark placed. Throws when the cell is not on the board or is taken. */
export function place(cells: readonly Mark[], cell: number, mark: 1 | 2): Mark[] {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw new Error("That square is not on the board.");
  if (cells[cell] !== 0) throw new Error("That square is taken.");
  const n = [...cells]; n[cell] = mark; return n;
}

/** Whose turn it is from the number of marks already placed: X moves first. */
export const markToMove = (cells: readonly Mark[]): 1 | 2 => (cells.filter((c) => c !== 0).length % 2 === 0 ? 1 : 2);
