// Tic Tac Toe rules module (rules taken from the live Tic Tac Toe site, docs/RULES.md R01-R25). See docs/TICTACTOE_RULES_BOOK.md.
// The sealed seed, bracket shuffle, who-has-X coins and fate numbers are made by the host site and come in as inputs; the core never makes them.
import { MANIFESTS } from "../../manifest/src";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export type Mark = "X" | "O";
export type Board = (Mark | null)[];
const WINS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** R01-R06: nine squares; returns the winner, "draw" for a full board, or null while play goes on. */
export const boardResult = (b: Board): Mark | "draw" | null => {
  for (const [a, c, d] of WINS) if (b[a!] && b[a!] === b[c!] && b[a!] === b[d!]) return b[a!]!;
  return b.every(Boolean) ? "draw" : null;
};
/** A move: only on an empty square on the board, and only on your turn (X first). Returns the new board or null when refused. */
export const play = (b: Board, sq: number, mark: Mark): Board | null => {
  const xs = b.filter((m) => m === "X").length, os = b.filter((m) => m === "O").length;
  if (!Number.isInteger(sq) || sq < 0 || sq > 8 || b[sq] || boardResult(b)) return null;
  if (mark !== (xs === os ? "X" : "O")) return null;
  const n = [...b]; n[sq] = mark; return n;
};
export const MAX_GAMES = 2, MOVE_CLOCKS = [10, 20, 30, 60];
/** firstMover: who had X (moved first) in that game. */
export interface GameEnd { winner: "a" | "b" | "draw"; firstMover?: "a" | "b" }
/**
 * Spec 410 section 5: one board between players a and b. A win ends it. A draw is replayed ONCE with the marks swapped; if the replay is drawn too, the first mover of the replay is out and the other wins.
 * (The live site replayed up to 3 games and then used fate; fate is now only the fallback when the replay does not say who moved first.)
 * `forfeit` = the player who lost by two clock-outs in a row in one game (R13), which ends the board at once.
 */
export function boardWinner(games: GameEnd[], fate: { a: number; b: number }, forfeit?: "a" | "b"): "a" | "b" | null {
  if (forfeit) return forfeit === "a" ? "b" : "a";
  for (const g of games) if (g.winner !== "draw") return g.winner;
  if (games.length < MAX_GAMES) return null;
  const fm = games[MAX_GAMES - 1]!.firstMover;
  return fm ? (fm === "a" ? "b" : "a") : fate.a < fate.b ? "a" : "b";
}
/** R16-R18: the knockout bracket. `order` is the seeded shuffle of the players; places = next power of two; byes only in round 1 and never two in one pair. */
export function bracket(order: string[]): (string | null)[][] {
  let size = 1; while (size < order.length) size *= 2;
  const byes = size - order.length, slots: (string | null)[] = [];
  // spread the byes: pair i gets a bye while byes remain, so no pair has two
  let p = 0;
  for (let i = 0; i < size / 2; i++) { slots.push(order[p++] ?? null); slots.push(i < byes ? null : (order[p++] ?? null)); }
  const round1: (string | null)[][] = [];
  for (let i = 0; i < slots.length; i += 2) round1.push([slots[i]!, slots[i + 1]!]);
  return round1;
}
/** R23: 2 points for a game won (a forfeit counts as a win for the other player), 1 for a draw. */
export const gamePoints = (g: GameEnd["winner"], me: "a" | "b"): number => (g === "draw" ? 1 : g === me ? 2 : 0);
export interface TttState {
  round: number; matches: { a: string | null; b: string | null; winner?: string }[][]; points: Record<string, number>; lastPoints: Record<string, number>;
  reached: Record<string, number>; fate: Record<string, number>; over: boolean; champion?: string;
}
export type TttEvent = { type: "matchResult"; round: number; index: number; winner: string; pointsA: number; pointsB: number } | { type: "tick" };
export const setupFields: SetupField[] = [
  { key: "moveClock", label: "Seconds for each move", kind: "choice", choices: MOVE_CLOCKS.map(String), default: 20 },
  { key: "format", label: "Format", kind: "choice", choices: ["knockout", "team"], default: "knockout", advanced: true },
];
export const tttRules: RulesModule<TttState, TttEvent> = {
  manifest: MANIFESTS.tictactoe,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: () => ["1st", "2nd", "3rd", "4th", "5th"],
  lateJoin: MANIFESTS.tictactoe.lateJoin,
  init(setup, players) {
    const order = (setup.order as string[] | undefined) ?? players; // the seeded shuffle comes from the host site
    const r1 = bracket(order).map(([a, b]) => ({ a: a!, b: b!, winner: a && !b ? a : !a && b ? b : undefined }));
    const reached: Record<string, number> = {}; for (const p of players) reached[p] = 1;
    return { round: 1, matches: [r1], points: {}, lastPoints: {}, reached, fate: (setup.fate as Record<string, number>) ?? {}, over: false };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "matchResult" || clock.phase === "paused") return { state: s, out: [] }; // paused: clocks are frozen, nothing changes
    const m = s.matches[e.round - 1]?.[e.index];
    if (!m || m.winner || (e.winner !== m.a && e.winner !== m.b)) return { state: s, out: [] };
    const matches = s.matches.map((r) => r.map((x) => ({ ...x })));
    matches[e.round - 1]![e.index]!.winner = e.winner;
    const loser = e.winner === m.a ? m.b : m.a, out: Outcome[] = [];
    const points = { ...s.points }, last = { ...s.lastPoints };
    if (m.a && m.b) { points[m.a] = (points[m.a] ?? 0) + e.pointsA; points[m.b] = (points[m.b] ?? 0) + e.pointsB; last[m.a] = e.pointsA; last[m.b] = e.pointsB; }
    if (loser) out.push({ kind: "out", player: loser, why: "lost the board" });
    // R22: a later match opens as soon as both its feeder matches are finished
    const cur = matches[e.round - 1]!;
    if (cur.every((x) => x.winner !== undefined)) {
      const winners = cur.map((x) => x.winner ?? x.a ?? x.b ?? null);
      if (winners.length === 1) {
        out.push({ kind: "win", player: winners[0]!, position: "1st" }, { kind: "end" });
        return { state: { ...s, matches, points, lastPoints: last, over: true, champion: winners[0]! }, out };
      }
      const next = []; for (let i = 0; i < winners.length; i += 2) next.push({ a: winners[i] ?? null, b: winners[i + 1] ?? null });
      const reached = { ...s.reached }; for (const w of winners) if (w) reached[w] = e.round + 1;
      matches.push(next);
      out.push({ kind: "round", n: e.round + 1, alive: winners.length });
      return { state: { ...s, round: e.round + 1, matches, points, lastPoints: last, reached }, out };
    }
    return { state: { ...s, matches, points, lastPoints: last }, out };
  },
};
/** R24: strict ranking, no ties: round reached, total points, points in the last match, then fate (lower wins). */
export const ranking = (s: Pick<TttState, "reached" | "points" | "lastPoints" | "fate">): string[] =>
  Object.keys(s.reached).sort((x, y) => (s.reached[y]! - s.reached[x]!) || ((s.points[y] ?? 0) - (s.points[x] ?? 0)) || ((s.lastPoints[y] ?? 0) - (s.lastPoints[x] ?? 0)) || ((s.fate[x] ?? 0) - (s.fate[y] ?? 0)));
