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
/** Owner-approved rules (31 Oct 2026, boss message): a match is 3 games (Organizer may choose 1); marks swap each game; 2 points a win, 1 a draw; more points goes through; level -> up to 3 tie-breaker games (5 s moves), still level -> lower fate. */
export const MATCH_GAMES = [1, 3] as const, DEFAULT_MATCH_GAMES = 3, TIEBREAK_GAMES = 3;
export const MOVE_SECONDS = 10, TIEBREAK_MOVE_SECONDS = 5;
export const MOVE_CLOCKS = [MOVE_SECONDS];
/** Move clock for game number `n` (1-based) of a match of `matchGames` games: 10 s in the match, 5 s in tie-breaker games. No other clock exists. */
export const moveClockFor = (n: number, matchGames: number): number => (n > matchGames ? TIEBREAK_MOVE_SECONDS : MOVE_SECONDS);
/** One game of a match. winner: "a" | "b" | "draw". */
export interface GameEnd { winner: "a" | "b" | "draw" }
/** A missed move loses that turn and the opponent moves (they then get their own clock). If both players miss in a row, the game is a draw. */
export const afterMissedMove = (missedByMover: boolean, opponentAlsoMissed: boolean): "opponent-moves" | "draw" => (missedByMover && opponentAlsoMissed ? "draw" : "opponent-moves");
/** Points of a player in a list of games. */
export const pointsIn = (games: GameEnd[], me: "a" | "b"): number => games.reduce((n, g) => n + gamePoints(g.winner, me), 0);
/**
 * Who goes through a match. `games` = the match games then any tie-breaker games, in order; `matchGames` = 1 or 3.
 * After the match games: more points goes through. Level: the FIRST tie-breaker game with a winner decides (assumption, see book rule 8); a drawn tie-breaker is followed by the next, up to 3; still level: lower fate number.
 * Returns null while more games are needed.
 */
export function matchWinner(games: GameEnd[], fate: { a: number; b: number }, matchGames: number = DEFAULT_MATCH_GAMES): "a" | "b" | null {
  if (games.length < matchGames) return null;
  const main = games.slice(0, matchGames), pa = pointsIn(main, "a"), pb = pointsIn(main, "b");
  if (pa !== pb) return pa > pb ? "a" : "b";
  const tb = games.slice(matchGames);
  for (const g of tb) if (g.winner !== "draw") return g.winner;
  if (tb.length < TIEBREAK_GAMES) return null;
  return fate.a < fate.b ? "a" : "b";
}
/** Round pairing: players are paired at random (`order` is the seeded shuffle given by the host site). An odd count gives ONE bye to the first player in the order who has not had a bye before. */
export function pairRound(order: string[], hadBye: readonly string[]): { pairs: [string, string | null][]; bye: string | null } {
  const list = [...order]; let bye: string | null = null;
  if (list.length % 2 === 1) { const i = Math.max(0, list.findIndex((p) => !hadBye.includes(p))); bye = list.splice(i, 1)[0]!; }
  const pairs: [string, string | null][] = []; for (let i = 0; i < list.length; i += 2) pairs.push([list[i]!, list[i + 1]!]);
  if (bye) pairs.push([bye, null]);
  return { pairs, bye };
}
/** R23: 2 points for a game won (a forfeit counts as a win for the other player), 1 for a draw. */
export const gamePoints = (g: GameEnd["winner"], me: "a" | "b"): number => (g === "draw" ? 1 : g === me ? 2 : 0);
export interface TttState {
  round: number; matches: { a: string | null; b: string | null; winner?: string }[][]; points: Record<string, number>; lastPoints: Record<string, number>;
  reached: Record<string, number>; fate: Record<string, number>; over: boolean; champion?: string; byes: string[]; matchGames: number;
}
export type TttEvent = { type: "matchResult"; round: number; index: number; winner: string; pointsA: number; pointsB: number } | { type: "tick" };
export const setupFields: SetupField[] = [
  { key: "matchGames", label: "Games in each match", kind: "choice", choices: MATCH_GAMES.map(String), default: DEFAULT_MATCH_GAMES },
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
    const { pairs, bye } = pairRound(order, []);
    const r1 = pairs.map(([a, b]) => ({ a, b, winner: b === null ? a : undefined }));
    const reached: Record<string, number> = {}; for (const p of players) reached[p] = 1;
    return { round: 1, matches: [r1], points: {}, lastPoints: {}, reached, fate: (setup.fate as Record<string, number>) ?? {}, over: false, byes: bye ? [bye] : [], matchGames: Number(setup.matchGames) === 1 ? 1 : DEFAULT_MATCH_GAMES };
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
      const pr = pairRound(winners.filter((w): w is string => !!w), s.byes); // winners are paired again at random; an odd count gives one bye to someone who has not had one
      const next = pr.pairs.map(([a, b]) => ({ a, b, winner: b === null ? a : undefined }));
      const reached = { ...s.reached }; for (const w of winners) if (w) reached[w] = e.round + 1;
      matches.push(next);
      out.push({ kind: "round", n: e.round + 1, alive: winners.length });
      return { state: { ...s, round: e.round + 1, matches, points, lastPoints: last, reached, byes: pr.bye ? [...s.byes, pr.bye] : s.byes }, out };
    }
    return { state: { ...s, matches, points, lastPoints: last }, out };
  },
};
/** R24: strict ranking, no ties: round reached, total points, points in the last match, then fate (lower wins). */
export const ranking = (s: Pick<TttState, "reached" | "points" | "lastPoints" | "fate">): string[] =>
  Object.keys(s.reached).sort((x, y) => (s.reached[y]! - s.reached[x]!) || ((s.points[y] ?? 0) - (s.points[x] ?? 0)) || ((s.lastPoints[y] ?? 0) - (s.lastPoints[x] ?? 0)) || ((s.fate[x] ?? 0) - (s.fate[y] ?? 0)));
