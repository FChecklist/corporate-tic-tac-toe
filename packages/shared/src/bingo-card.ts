// The Bingo card and the prize patterns (75-ball Bingo, US style).
//
// A card is 5 x 5. Columns are headed B I N G O and hold 1-15, 16-30, 31-45, 46-60 and 61-75. Every column holds 5 different numbers
// from its own range, in any order. The centre square is FREE: it holds no number and counts as marked from the first call.
// Cells are numbered 0..24 row by row (row * 5 + column); the FREE cell is 12.
//
// A pattern is a list of "sets" of cells and a number `need`: the pattern is complete when `need` of its sets are completely marked.
// (Line: any one of the 12 lines. Two Lines: any two of them. Corners: one set of four cells. And so on.)
// Everything that decides a win reads THIS table: the incremental engine, the whole-log settlement, the claim check and the phone page.

export type Card = (number | null)[][]; // 5 rows x 5 columns, null = the FREE square
export type Rand = (n: number) => number; // returns an integer in [0, n)

export const SIZE = 5;
export const CELLS = 25;
export const FREE_CELL = 12;
export const LETTERS = ["B", "I", "N", "G", "O"] as const;
export const MAX_NUMBER = 75;
export const PER_COLUMN = 15;

/** Column c holds 1-15, 16-30, 31-45, 46-60, 61-75. */
export const columnRange = (c: number): [number, number] => [c * PER_COLUMN + 1, c * PER_COLUMN + PER_COLUMN];
/** The column (0..4) a number belongs to, or -1 for a number outside 1..75. */
export const columnOf = (n: number): number => (Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER ? Math.floor((n - 1) / PER_COLUMN) : -1);
/** The letter a number is called with: 7 is "B", 52 is "G". Empty for a number outside 1..75. */
export const letterOf = (n: number): string => LETTERS[columnOf(n)] ?? "";
/** How a call is shown and spoken: letter plus number ("B 7", "G 52"). */
export const callLabel = (n: number): string => (columnOf(n) < 0 ? String(n) : `${letterOf(n)} ${n}`);

/** The cell (0..24) a number sits on in this card, or -1 when the card does not hold it. The FREE square holds no number. */
export function cellOfNumber(t: Card, n: number): number {
  const c = columnOf(n);
  if (c < 0) return -1;
  for (let r = 0; r < SIZE; r++) if (t[r]![c] === n) return r * SIZE + c;
  return -1;
}

export const cryptoRand: Rand = (n) => {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n; // rejection sampling: no modulo bias
  do { crypto.getRandomValues(a); } while (a[0]! >= limit);
  return a[0]! % n;
};

export const shuffle = <T>(arr: T[], rand: Rand): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};

/** A random card (used for demos and for guests who have no seat number). Cards of a real game come from `cardAt` (unique-ticket.ts). */
export function generateTicket(rand: Rand = cryptoRand): Card {
  const t: Card = Array.from({ length: SIZE }, () => Array<number | null>(SIZE).fill(null));
  for (let c = 0; c < SIZE; c++) {
    const [lo, hi] = columnRange(c);
    const pool: number[] = [];
    for (let v = lo; v <= hi; v++) pool.push(v);
    const pick = shuffle(pool, rand).slice(0, c === 2 ? 4 : 5);
    let i = 0;
    for (let r = 0; r < SIZE; r++) t[r]![c] = r * SIZE + c === FREE_CELL ? null : pick[i++]!;
  }
  return t;
}

/** The 24 numbers on the card, row by row (the FREE square is not a number). */
export const ticketNumbers = (t: Card): number[] => t.flat().filter((v): v is number => v !== null);

/** Structural validity check (used by tests and the server): 5 x 5, FREE centre, every column from its own range, no repeats. */
export function isValidTicket(t: Card): boolean {
  if (!Array.isArray(t) || t.length !== SIZE || t.some((r) => !Array.isArray(r) || r.length !== SIZE)) return false;
  if (t[2]![2] !== null) return false;
  const seen = new Set<number>();
  for (let c = 0; c < SIZE; c++) {
    const [lo, hi] = columnRange(c);
    for (let r = 0; r < SIZE; r++) {
      const v = t[r]![c];
      if (r * SIZE + c === FREE_CELL) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi || seen.has(v)) return false;
      seen.add(v);
    }
  }
  return seen.size === 24;
}

export const ticketKey = (t: Card) => JSON.stringify(t);

// ---------- patterns ----------
export type PatternId = "line" | "twolines" | "corners" | "plus" | "x" | "frame" | "stamp" | "letterL" | "letterT" | "blackout";
export type Scope = "ticket";

const rowCells = (r: number) => [0, 1, 2, 3, 4].map((c) => r * SIZE + c);
const colCells = (c: number) => [0, 1, 2, 3, 4].map((r) => r * SIZE + c);
const DIAG1 = [0, 6, 12, 18, 24], DIAG2 = [4, 8, 12, 16, 20];
/** The 12 lines of a card: 5 rows, 5 columns and the 2 diagonals. */
export const LINES: readonly (readonly number[])[] = [0, 1, 2, 3, 4].map(rowCells).concat([0, 1, 2, 3, 4].map(colCells), [DIAG1, DIAG2]);

export interface PatternRule { sets: readonly (readonly number[])[]; need: number }
export const PATTERN_RULES: Record<PatternId, PatternRule> = {
  line: { sets: LINES, need: 1 },
  twolines: { sets: LINES, need: 2 },
  corners: { sets: [[0, 4, 20, 24]], need: 1 },
  plus: { sets: [[...rowCells(2), 2, 7, 17, 22]], need: 1 },
  x: { sets: [[...DIAG1, 4, 8, 16, 20]], need: 1 },
  frame: { sets: [[...rowCells(0), ...rowCells(4), 5, 10, 15, 9, 14, 19]], need: 1 },
  stamp: { sets: [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]], need: 1 },
  letterL: { sets: [[...colCells(0), 21, 22, 23, 24]], need: 1 },
  letterT: { sets: [[...rowCells(0), 7, 12, 17, 22]], need: 1 },
  blackout: { sets: [Array.from({ length: CELLS }, (_, i) => i)], need: 1 },
};

export const PATTERNS: Record<PatternId, { name: string; desc: string }> = {
  line: { name: "Line", desc: "Any one row, column or diagonal. FREE counts." },
  twolines: { name: "Two Lines", desc: "Any two different lines." },
  corners: { name: "Four Corners", desc: "The four corner squares." },
  plus: { name: "Plus", desc: "The middle row and the middle column." },
  x: { name: "X", desc: "Both diagonals." },
  frame: { name: "Frame", desc: "The whole outer border." },
  stamp: { name: "Postage Stamp", desc: "A 2 x 2 block in any corner." },
  letterL: { name: "Letter L", desc: "The B column and the bottom row." },
  letterT: { name: "Letter T", desc: "The top row and the N column." },
  blackout: { name: "Blackout", desc: "Every square on the card." },
};

/** The numbers (FREE excluded) of each set of a pattern on this card. */
export function patternSets(t: Card, p: PatternId): number[][] {
  const flat = t.flat();
  return PATTERN_RULES[p].sets.map((cells) => cells.filter((i) => i !== FREE_CELL).map((i) => flat[i]!));
}

export const ordinalName = (k: number): string =>
  ["", "1st", "2nd", "3rd"][k] ?? `${k}th`;

/** Human name of a reward line, e.g. "2nd Line", "Blackout". */
export function rewardName(pattern: PatternId, _scope: Scope, ordinal: number, ofTotal: number): string {
  const base = PATTERNS[pattern].name;
  return ofTotal > 1 ? `${ordinalName(ordinal)} ${base}` : base;
}
