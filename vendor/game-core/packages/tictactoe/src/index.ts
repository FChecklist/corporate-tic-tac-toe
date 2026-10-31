// Tic Tac Toe rules module (rules taken from the live Tic Tac Toe site, docs/RULES.md R01-R25). See docs/TICTACTOE_RULES_BOOK.md.
// The sealed seed, bracket shuffle, who-has-X coins and fate numbers are made by the host site and come in as inputs; the core never makes them.
import { MANIFESTS } from "../../manifest/src";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export type Mark = "X" | "O";
export type Board = (Mark | null)[];
const WINS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** Book rule 7: X and O alternate between a player's games. Side "a" has X in game 0 (or O if the site's coin says `bHasX`), then they swap every game; side "b" always has the other mark. */
export const markFor = (player: "a" | "b", gameIndex: number, bHasX = false): Mark => ((player === "a") !== bHasX) === (gameIndex % 2 === 0) ? "X" : "O";
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
// ---- OWNER-APPROVED RULES (31 Oct 2026, stages): see docs/TICTACTOE_RULES_BOOK.md. 2:00 waiting room + 3 x 5:00 stages = 17:00 on the clock, 15:00 of play at most.
export const WAIT_SECONDS = 120, STAGE_SECONDS = 300, STAGES = 3, MOVE_SECONDS = 10, SUDDEN_SECONDS = 5, PLAY_SECONDS = STAGES * STAGE_SECONDS, TOTAL_SECONDS = WAIT_SECONDS + PLAY_SECONDS;
export const WINNERS = 5, BYE_POINTS = 1;
export const MOVE_CLOCKS = [MOVE_SECONDS];
/** Move clock: 10 s a move, 5 s in a sudden-death game. No other clock exists. */
export const moveClockFor = (suddenDeath: boolean): number => (suddenDeath ? SUDDEN_SECONDS : MOVE_SECONDS);
/** A missed move loses that turn and the opponent moves (they then get their own clock). If both players miss, the game is a draw. */
export const afterMissedMove = (missedByMover: boolean, opponentAlsoMissed: boolean): "opponent-moves" | "draw" => (missedByMover && opponentAlsoMissed ? "draw" : "opponent-moves");
export const gamePoints = (g: "a" | "b" | "draw", me: "a" | "b"): number => (g === "draw" ? 1 : g === me ? 2 : 0);
/** How many stay after the end of a stage: stage 1 keeps 50%, stage 2 keeps half of the survivors (25% of the start), stage 3 makes the final ranking (everybody left is ranked, the top five win). Rounded up, never below 1. */
export const keepAfter = (stage: number, alive: number): number => (stage >= STAGES ? alive : Math.max(1, Math.ceil(alive / 2)));
export interface Stat { points: number; wins: number; stagePoints: number; lastOpp?: string; byeStages: number[] }
export interface TttState {
  stage: number; alive: string[]; free: string[]; stats: Record<string, Stat>; fate: Record<string, number>; out: { player: string; stage: number }[]; over: boolean; ranking?: string[];
}
export type TttEvent =
  | { type: "game"; a: string; b: string; winner: "a" | "b" | "draw" }   // a 1-game match finished (both players missing a move is a "draw")
  | { type: "stageEnd"; running?: { a: string; b: string }[] };           // the stage clock ran out; games still running are draws
const zero = (): Stat => ({ points: 0, wins: 0, stagePoints: 0, byeStages: [] });
const stat = (s: Pick<TttState, "stats">, p: string): Stat => s.stats[p] ?? zero();
/** Cut and ranking order: points, then wins, then points in the last stage, then fate (lower wins). Never tied. */
export const order = (s: Pick<TttState, "stats" | "fate">, players: string[]): string[] =>
  [...players].sort((x, y) => {
    const a = stat(s, x), b = stat(s, y);
    return (b.points - a.points) || (b.wins - a.wins) || (b.stagePoints - a.stagePoints) || ((s.fate[x] ?? 0) - (s.fate[y] ?? 0)) || (x < y ? -1 : 1);
  });
/**
 * Pair the free players (Swiss style): sort by points, pair neighbours, never the same opponent twice in a row. An odd count: ONE free player sits out and gets 1 point
 * (call `applyBye`), the lowest-ranked free player who has not had a bye in this stage.
 */
export function pairFree(s: TttState, free: string[]): { pairs: [string, string][]; bye: string | null } {
  const list = order(s, free); let bye: string | null = null;
  if (list.length % 2 === 1) {
    for (let i = list.length - 1; i >= 0; i--) if (!stat(s, list[i]!).byeStages.includes(s.stage)) { bye = list.splice(i, 1)[0]!; break; }
    if (!bye) bye = list.pop()!;
  }
  const pairs: [string, string][] = [];
  while (list.length > 1) {
    const a = list.shift()!; let j = list.findIndex((x) => stat(s, a).lastOpp !== x && stat(s, x).lastOpp !== a); if (j < 0) j = 0;
    pairs.push([a, list.splice(j, 1)[0]!]);
  }
  return { pairs, bye };
}
export const applyBye = (s: TttState, p: string): TttState => { const t = stat(s, p); return { ...s, stats: { ...s.stats, [p]: { ...t, points: t.points + BYE_POINTS, stagePoints: t.stagePoints + BYE_POINTS, byeStages: [...t.byeStages, s.stage] } } }; };
const addGame = (s: TttState, a: string, b: string, w: "a" | "b" | "draw"): TttState => {
  const A = stat(s, a), B = stat(s, b), pa = gamePoints(w, "a"), pb = gamePoints(w, "b");
  return { ...s, stats: { ...s.stats, [a]: { ...A, points: A.points + pa, stagePoints: A.stagePoints + pa, wins: A.wins + (w === "a" ? 1 : 0), lastOpp: b }, [b]: { ...B, points: B.points + pb, stagePoints: B.stagePoints + pb, wins: B.wins + (w === "b" ? 1 : 0), lastOpp: a } } };
};
/** What a player sees live: place, whether they are inside the cut, how many places to the line. */
export function standing(s: Pick<TttState, "stats" | "fate" | "alive" | "stage">, me: string): { place: number; of: number; keep: number; safe: boolean; placesToLine: number } {
  const o = order(s, s.alive), place = o.indexOf(me) + 1, keep = keepAfter(s.stage, s.alive.length);
  return { place, of: o.length, keep, safe: place > 0 && place <= keep, placesToLine: place <= keep ? keep - place : place - keep };
}
/** The reaction rule (owner, 31 Oct): each shows 2 to 3 seconds, never over the board, only at a fitting event, about one per 20-25 seconds for a player, at most 15 in a 10-minute game. */
export const REACTION_SHOW_MS = 2500, REACTION_GAP_MS = 22_000, REACTION_MAX = 15;
export function reactionGate(): { allow(now: number): boolean } {
  let last = -Infinity, n = 0;
  return { allow(now) { if (n >= REACTION_MAX || now - last < REACTION_GAP_MS) return false; last = now; n++; return true; } };
}
export const setupFields: SetupField[] = []; // the settings are only the prize text and the start mode (common engine); the rules have no choices
export const tttRules: RulesModule<TttState, TttEvent> = {
  manifest: MANIFESTS.tictactoe,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: () => ["1st", "2nd", "3rd", "4th", "5th"],
  lateJoin: MANIFESTS.tictactoe.lateJoin,
  init(setup, players) {
    return { stage: 1, alive: [...players], free: [...players], stats: {}, fate: (setup.fate as Record<string, number>) ?? {}, out: [], over: false };
  },
  step(s, e, _now, clock) {
    if (s.over || clock.phase === "paused") return { state: s, out: [] }; // paused: the stage clock and every move clock are frozen
    const out: Outcome[] = [];
    let st = s;
    if (e.type === "game") {
      if (!st.alive.includes(e.a) || !st.alive.includes(e.b) || e.a === e.b) return { state: s, out: [] };
      return { state: addGame(st, e.a, e.b, e.winner), out };
    }
    if (e.type !== "stageEnd") return { state: s, out: [] };
    for (const r of e.running ?? []) if (st.alive.includes(r.a) && st.alive.includes(r.b)) st = addGame(st, r.a, r.b, "draw"); // still running at the stage end = a draw
    const o = order(st, st.alive);
    if (st.stage >= STAGES) {
      o.slice(0, WINNERS).forEach((p, i) => out.push({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][i]! }));
      out.push({ kind: "end" });
      return { state: { ...st, over: true, ranking: o }, out };
    }
    const keep = keepAfter(st.stage, o.length), stay = o.slice(0, keep), gone = o.slice(keep);
    for (const p of gone) out.push({ kind: "out", player: p, why: `below the cut line after stage ${st.stage}` });
    out.push({ kind: "round", n: st.stage + 1, alive: stay.length });
    const stats: Record<string, Stat> = {}; for (const p of stay) stats[p] = { ...stat(st, p), stagePoints: 0, lastOpp: undefined };
    return { state: { ...st, stage: st.stage + 1, alive: stay, free: [...stay], stats, out: [...st.out, ...gone.map((player) => ({ player, stage: st.stage }))] }, out };
  },
};
export * from "./stages";
