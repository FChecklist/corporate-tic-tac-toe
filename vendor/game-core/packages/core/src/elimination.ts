// Reference implementation for the Elimination type (TTT, Snakes, Luck). Rounds are run by software in both start modes.
// Not playing in time = out next round. Loss = out. Last standing wins. Ties: "replay-once" (TTT: replay once, then the first mover is out) or "rethrow" (Luck).
export type TieRule = "replay-once" | "rethrow";
export type Result = { outcome: "win" | "loss" | "tie"; score?: number; firstMover?: boolean };
export interface ElimState {
  round: number; alive: string[]; out: { player: string; why: string; round: number }[];
  results: Record<string, Result>; deadline: number; roundMs: number; tieRule: TieRule; replays: number;
  /** Snakes/Luck: Organizer sets how many survive each round (undefined = everyone who did not lose). */
  survivors?: number; winner?: string; over: boolean;
}
export interface ElimSetup { roundMs: number; tieRule: TieRule; survivors?: number }
export function elimInit(s: ElimSetup, players: string[], now: number): ElimState {
  return { round: 1, alive: [...players], out: [], results: {}, deadline: now + s.roundMs, roundMs: s.roundMs, tieRule: s.tieRule, replays: 0, survivors: s.survivors, over: false };
}
/** A player reports their result for this round (ignored when out or after the deadline). */
export function submit(st: ElimState, player: string, r: Result, now: number): ElimState {
  if (st.over || now > st.deadline || !st.alive.includes(player)) return st;
  return { ...st, results: { ...st.results, [player]: r } };
}
/** Close the round at its deadline: no result = out ("not playing in time"), loss = out, ties by the tie rule, survivors cut by score. */
export function closeRound(st: ElimState, now: number): ElimState {
  if (st.over || now < st.deadline) return st;
  const out: ElimState["out"] = [];
  let keep: string[] = [];
  let replay = false;
  for (const p of st.alive) {
    const r = st.results[p];
    if (!r) out.push({ player: p, why: "not playing in time", round: st.round });
    else if (r.outcome === "loss") out.push({ player: p, why: "lost", round: st.round });
    else if (r.outcome === "tie") {
      if (st.tieRule === "rethrow") { keep.push(p); replay = true; }
      else if (st.replays >= 1) { if (r.firstMover) out.push({ player: p, why: "tie, first mover out", round: st.round }); else keep.push(p); } // second tie: no more replay
      else { keep.push(p); replay = true; }
    } else keep.push(p);
  }
  // nobody left to continue: the round is void and everyone who was in it plays again (ambiguity noted in README)
  if (!keep.length) return { ...st, results: {}, deadline: now + st.roundMs, replays: st.replays + 1 };
  if (st.survivors && keep.length > st.survivors && !replay) {
    const sorted = [...keep].sort((a, b) => (st.results[b]?.score ?? 0) - (st.results[a]?.score ?? 0));
    const cut = st.results[sorted[st.survivors - 1]!]?.score ?? 0;
    if ((st.results[sorted[st.survivors]!]?.score ?? 0) === cut) replay = true; // a tie at the cut: rethrow among the tied
    else { for (const p of sorted.slice(st.survivors)) out.push({ player: p, why: "below the cut", round: st.round }); keep = sorted.slice(0, st.survivors); }
  }
  const all = [...st.out, ...out];
  if (keep.length === 1 && !replay) return { ...st, alive: keep, out: all, results: {}, winner: keep[0], over: true };
  return { ...st, alive: keep, out: all, results: {}, round: replay ? st.round : st.round + 1, replays: replay ? st.replays + 1 : 0, deadline: now + st.roundMs };
}
