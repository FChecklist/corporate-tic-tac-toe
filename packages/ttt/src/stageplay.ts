// The phone side of the new flow (stages). PURE helpers: every phone gets the same answer from the public log. The server only stores and relays the log (apps/edge/src/tournament.ts: stagelog).
// Rules: vendor/game-core/packages/tictactoe (book docs/TICTACTOE_RULES_BOOK.md). A game is ONE board between two players in a slot; its moves are entries kind "move" (square 0-8, or "-" for a missed move);
// its result is entry kind "result" from each player ("a", "b" or "draw"); a result counts when BOTH players wrote the same word.
import { boardResult, markFor, MOVE_SECONDS, type Board } from "../../../vendor/game-core/packages/tictactoe/src";
import { sha256Hex } from "../../../vendor/game-core/packages/core/src/sha256";

export interface Entry { id: number; slot: string; kind: string; pid: string; seq: number; body: string; at_ms?: number }
export const slotKey = (stage: number, slot: number, a: string, b: string): string => `${stage}-${slot}-${a}-${b}`;
/** The fate number of a player: lower wins a tie. Made from the sealed seed, the same on every phone. */
export const fateOf = (seed: string, pid: string): number => parseInt(sha256Hex(`${seed}|${pid}`).slice(0, 8), 16);
export interface Game { board: Board; next: string | null; done: boolean; winner: "a" | "b" | "draw" | null; entries: number; lastAtMs: number | null; xIs: string }
/**
 * Read one game from the entries of its slot. Entry n must come from the player whose turn it is (X first) or be a miss ("-", written by either player when the 10 s ran out); the first valid one for each number counts.
 * A miss gives the turn to the opponent. Two misses in a row (both players missed): the game is a draw.
 */
export function gameFrom(entries: Entry[], a: string, b: string): Game {
  const xIs = markFor("a", 0) === "X" ? a : b, oIs = xIs === a ? b : a;
  let board: Board = Array(9).fill(null), n = 0, misses = 0, last: number | null = null, winner: Game["winner"] = null, done = false;
  const moves = entries.filter((e) => e.kind === "move").sort((x, y) => x.seq - y.seq || x.id - y.id);
  for (;;) {
    const who = n % 2 === 0 ? xIs : oIs, e = moves.find((m) => m.seq === n && (m.body === "-" || m.pid === who));
    if (!e) break;
    if (e.body === "-") { misses++; if (misses >= 2) { done = true; winner = "draw"; n++; last = e.at_ms ?? last; break; } }
    else {
      // A move is a square 0 to 8 that is empty. The mark belongs to the PLAYER (X moves first), not to the count of marks on the board: after a missed move the same player moves again, so the board holds one X and no O and X is still to move (audit 2, 23 Nov 2026: play() looked at the count and froze the game after a miss).
      const sq = /^[0-8]$/.test(e.body) ? Number(e.body) : -1;
      if (sq < 0 || board[sq]) break; // not a legal move: ignored (the game waits)
      const nb = board.slice(); nb[sq] = who === xIs ? "X" : "O";
      board = nb; misses = 0;
      const r = boardResult(board);
      if (r) { done = true; winner = r === "draw" ? "draw" : (r === "X" ? xIs : oIs) === a ? "a" : "b"; n++; last = e.at_ms ?? last; break; }
    }
    n++; last = e.at_ms ?? last;
  }
  return { board, next: done ? null : (n % 2 === 0 ? xIs : oIs), done, winner, entries: n, lastAtMs: last, xIs };
}
/** When must the next entry of this game arrive? The slot start (or the last entry) plus the move clock, plus any pause in between. */
export function deadlineOf(g: Game, slotStartMs: number, pauses: readonly [number, number | null][], nowMs: number): number {
  const from = g.lastAtMs ?? slotStartMs; let paused = 0;
  for (const [x, y] of pauses) { const e = y == null ? nowMs : y; paused += Math.max(0, Math.min(e, nowMs) - Math.max(x, from)); }
  return from + MOVE_SECONDS * 1000 + paused;
}
/** The results every phone may use: both players wrote the same word for the same pair. */
export function agreed(results: Entry[]): { stage: number; slot: number; a: string; b: string; winner: "a" | "b" | "draw" }[] {
  const by = new Map<string, Map<string, string>>();
  for (const r of results) if (r.kind === "result") { const m = by.get(r.slot) ?? new Map<string, string>(); if (!m.has(r.pid)) m.set(r.pid, r.body); by.set(r.slot, m); }
  const out: { stage: number; slot: number; a: string; b: string; winner: "a" | "b" | "draw" }[] = [];
  for (const [key, m] of by) {
    const parts = key.split("-"); if (parts.length < 4) continue;
    // the two pids may contain "-": the pair is whatever two writers of this slot there are, ordered as the key lists them
    const writers = [...m.keys()]; if (writers.length !== 2) continue;
    const a = writers.find((w) => key.startsWith(`${parts[0]}-${parts[1]}-${w}-`)), b = writers.find((w) => key.endsWith(`-${w}`));
    if (!a || !b || a === b) continue;
    const wa = m.get(a)!, wb = m.get(b)!;
    if (wa === wb && (wa === "a" || wa === "b" || wa === "draw")) out.push({ stage: Number(parts[0]), slot: Number(parts[1]), a, b, winner: wa });
  }
  return out;
}
