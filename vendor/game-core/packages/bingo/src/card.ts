// Bingo card and houses (prize patterns), ported from the Bingo site (packages/shared/src/bingo-card.ts and beacon/config.ts PRIZE_HOUSES). 75-ball, 5 x 5, centre FREE.
export type Card = (number | null)[][];
export const SIZE = 5, CELLS = 25, FREE_CELL = 12, MAX_NUMBER = 75, PER_COLUMN = 15;
export const LETTERS = ["B", "I", "N", "G", "O"] as const;
export type House = "line" | "twolines" | "corners" | "plus" | "x" | "frame" | "stamp" | "letterL" | "letterT" | "blackout";
export const columnOf = (n: number): number => (Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER ? Math.floor((n - 1) / PER_COLUMN) : -1);
export const callLabel = (n: number): string => (columnOf(n) < 0 ? String(n) : `${LETTERS[columnOf(n)]} ${n}`);
/** A valid card: column c holds 5 different numbers from its range (N holds 4 plus FREE in the centre). */
export function isValidCard(t: Card): boolean {
  if (t.length !== SIZE || t.some((r) => r.length !== SIZE)) return false;
  for (let c = 0; c < SIZE; c++) {
    const col = t.map((r) => r[c]!);
    if (c === 2 && col[2] !== null) return false;
    const nums = col.filter((v): v is number => v !== null);
    if (nums.length !== (c === 2 ? 4 : 5) || new Set(nums).size !== nums.length || nums.some((n) => columnOf(n) !== c)) return false;
  }
  return true;
}
const row = (r: number) => [0, 1, 2, 3, 4].map((c) => r * SIZE + c);
const col = (c: number) => [0, 1, 2, 3, 4].map((r) => r * SIZE + c);
const D1 = [0, 6, 12, 18, 24], D2 = [4, 8, 12, 16, 20];
export const LINES: number[][] = [0, 1, 2, 3, 4].map(row).concat([0, 1, 2, 3, 4].map(col), [D1, D2]);
/** A house is met when `need` of its sets are fully marked (one set for most; two different lines for twolines). `max` = most prize lines. */
export const HOUSES: Record<House, { label: string; sets: number[][]; need: number; max: number; dflt: boolean }> = {
  line: { label: "Line", sets: LINES, need: 1, max: 3, dflt: true },
  twolines: { label: "Two Lines", sets: LINES, need: 2, max: 2, dflt: false },
  corners: { label: "Four Corners", sets: [[0, 4, 20, 24]], need: 1, max: 3, dflt: true },
  plus: { label: "Plus", sets: [[...row(2), 2, 7, 17, 22]], need: 1, max: 2, dflt: false },
  x: { label: "X", sets: [[...D1, 4, 8, 16, 20]], need: 1, max: 2, dflt: true },
  frame: { label: "Frame", sets: [[...row(0), ...row(4), 5, 10, 15, 9, 14, 19]], need: 1, max: 2, dflt: false },
  stamp: { label: "Postage Stamp", sets: [[0, 1, 5, 6], [3, 4, 8, 9], [15, 16, 20, 21], [18, 19, 23, 24]], need: 1, max: 3, dflt: false },
  letterL: { label: "Letter L", sets: [[...col(0), 21, 22, 23, 24]], need: 1, max: 2, dflt: false },
  letterT: { label: "Letter T", sets: [[...row(0), 7, 12, 17, 22]], need: 1, max: 2, dflt: false },
  blackout: { label: "Blackout", sets: [Array.from({ length: CELLS }, (_, i) => i)], need: 1, max: 2, dflt: true },
};
export const HOUSE_IDS = Object.keys(HOUSES) as House[];
/** Does this card meet the house when `called` numbers are out? FREE always counts as marked. */
export function meets(t: Card, house: House, called: ReadonlySet<number>): boolean {
  const flat = t.flat(), h = HOUSES[house];
  const done = (set: number[]) => set.every((i) => i === FREE_CELL || (flat[i] != null && called.has(flat[i]!)));
  return h.sets.filter(done).length >= h.need;
}
/** The first call count k (1..75) at which the house is met, or null if never within `order`. */
export function completedAt(t: Card, house: House, order: readonly number[]): number | null {
  const called = new Set<number>();
  for (let k = 0; k < order.length; k++) { called.add(order[k]!); if (meets(t, house, called)) return k + 1; }
  return null;
}
