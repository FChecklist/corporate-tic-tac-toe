// A simulated crowd of phones for the new flow: every slot, the phones compute the pairing from the public log (settleStages), play, and add results to the log.
import { settleStages, type SlotResult, type Settled } from "../../vendor/game-core/packages/tictactoe/src";

export const START = Date.UTC(2026, 9, 31, 10, 0, 0);
export const players = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(4, "0")}`);
export const fateMap = (ps: string[], seed = "seed") => Object.fromEntries(ps.map((p, i) => [p, ((i * 2654435761 + seed.length * 97) >>> 0) % 1_000_003]));
/** Deterministic outcomes of a game: from the pair, the slot and a salt. */
export const outcomeOf = (salt: number) => (st: number, sl: number, a: string, b: string): "a" | "b" | "draw" => {
  let h = salt; for (const ch of `${st}${sl}${a}${b}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const r = h % 10; return r < 4 ? "a" : r < 8 ? "b" : "draw";
};
export interface Run { gameId: string; ps: string[]; fate: Record<string, number>; results: SlotResult[]; startMs: number; pausedMs: number }
const nowOf = (r: Run, st: number, sl: number) => r.startMs + r.pausedMs + (120 + (st - 1) * 300 + (sl - 1) * 100) * 1000 + 1000;
/** Play every slot: at each slot start every phone sees the same pairs; `outcome` says who wins each pair; the agreed results are logged. Returns the log and the settled game at the end. */
export function playAll(r: Run, outcome: (st: number, sl: number, a: string, b: string) => "a" | "b" | "draw", log?: (st: number, sl: number, s: Settled) => void): Settled {
  for (let st = 1; st <= 3; st++) for (let sl = 1; sl <= 3; sl++) {
    const s = settleStages({ gameId: r.gameId, startMs: r.startMs, nowMs: nowOf(r, st, sl), pausedMs: r.pausedMs, players: r.ps, fate: r.fate, results: r.results });
    if (s.stage !== st || s.slot !== sl) throw new Error(`clock says stage ${s.stage} slot ${s.slot}, expected ${st} ${sl}`);
    log?.(st, sl, s);
    for (const [a, b] of s.pairsNow) r.results.push({ stage: st, slot: sl, a, b, winner: outcome(st, sl, a, b) });
  }
  return settleStages({ gameId: r.gameId, startMs: r.startMs, nowMs: r.startMs + r.pausedMs + 1020_000, pausedMs: r.pausedMs, players: r.ps, fate: r.fate, results: r.results });
}
export const run = (n: number, gameId = "G-1"): Run => { const ps = players(n); return { gameId, ps, fate: fateMap(ps), results: [], startMs: START, pausedMs: 0 }; };
// seeded shuffle for arrival-order tests
export const shuffled = <T,>(a: T[], seed: number): T[] => { const o = [...a]; let h = seed >>> 0; const r = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; }; for (let i = o.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [o[i], o[k]] = [o[k]!, o[i]!]; } return o; };
