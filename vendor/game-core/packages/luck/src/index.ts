// Luck by Chance rules module. Scoring rules come from the live site (docs/RULES.md R01-R33); elimination (survivors per round, re-throw on a tie) is spec 410 section 5. See docs/LUCK_RULES_BOOK.md.
// Targets, dice and fate numbers are made by the host site from the game id and the public beacon; they come in as inputs, the core never makes them.
import { MANIFESTS } from "../../manifest/src";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export const DICE_PER_ROUND = 10, WINDOWS = [6, 10, 15], REVEAL_S = 3, BREAK_S = 20;
export interface Score { points: number; best: number; hits: number; lastHitAt: number; fate: number }
/** R05: a dice that shows the target scores that many points; anything else scores nothing. */
export const hit = (target: number, dice: number): number => (dice === target ? target : 0);
/** R15-R19: points, then the highest single hit, then the most hits, then who reached that score first, then fate (lower wins). Always strict. */
export const rankOrder = (a: Score, b: Score): number => b.points - a.points || b.best - a.best || b.hits - a.hits || a.lastHitAt - b.lastHitAt || a.fate - b.fate;
/** A re-throw: players tied for the last survivor places throw again (not counted as a dice round) until the tie is gone. */
export interface Rethrow { sure: string[]; tied: string[]; need: number }
export interface LuckState {
  rounds: number; survivors: number; diceIndex: number; scores: Record<string, Score>; roundScores: Record<string, Score>[];
  alive: string[]; outRound: Record<string, number>; rethrow?: Rethrow; over: boolean; winner?: string;
}
export type LuckEvent = { type: "dice"; target: number; dice: Record<string, number> } | { type: "tick" };
export const setupFields: SetupField[] = [
  { key: "rounds", label: "Rounds", kind: "number", default: 10, help: "1 to 20. Each round has 10 dice rounds." },
  { key: "window", label: "Seconds to press the dice", kind: "choice", choices: WINDOWS.map(String), default: 10 },
  { key: "survivors", label: "Players who stay in after each round", kind: "number", default: 0, help: "0 = everybody plays on. Otherwise the best players of the round stay in; the rest are out." },
];
const fresh = (fate: number): Score => ({ points: 0, best: 0, hits: 0, lastHitAt: 0, fate });
function clone(m: Record<string, Score>, zero = false): Record<string, Score> {
  const o: Record<string, Score> = {};
  for (const [k, v] of Object.entries(m)) o[k] = zero ? fresh(v.fate) : { ...v };
  return o;
}
/** End of a round with survivors set: keep the top N by round points; a tie across the cut goes to a re-throw. */
function cut(s: { alive: string[]; survivors: number }, round: Record<string, Score>): { keep: string[]; rethrow?: Rethrow } {
  const order = [...s.alive].sort((a, b) => rankOrder(round[a]!, round[b]!));
  if (!s.survivors || order.length <= s.survivors) return { keep: order };
  const at = round[order[s.survivors - 1]!]!.points;
  if (round[order[s.survivors]!]!.points !== at) return { keep: order.slice(0, s.survivors) };
  const tied = order.filter((p) => round[p]!.points === at), sure = order.filter((p) => round[p]!.points > at);
  return { keep: sure, rethrow: { sure, tied, need: s.survivors - sure.length } };
}
export const luckRules: RulesModule<LuckState, LuckEvent> = {
  manifest: MANIFESTS.luck,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: () => ["1st", "2nd", "3rd", "4th", "5th"],
  lateJoin: MANIFESTS.luck.lateJoin,
  init(setup, players) {
    const rounds = Math.floor(Number(setup.rounds ?? 10));
    if (!(rounds >= 1 && rounds <= 20)) throw new Error("a game has 1 to 20 rounds"); // R01
    if (players.length < 2) throw new Error("at least 2 players are needed"); // R34
    const survivors = Math.floor(Number(setup.survivors ?? 0));
    if (!(survivors >= 0)) throw new Error("survivors must be 0 or more");
    const fate = (setup.fate ?? {}) as Record<string, number>, scores: Record<string, Score> = {};
    for (const p of players) scores[p] = fresh(fate[p] ?? 0);
    return { rounds, survivors, diceIndex: 0, scores, roundScores: [clone(scores, true)], alive: [...players], outRound: {}, over: false };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "dice" || clock.phase === "paused") return { state: s, out: [] }; // R14: in order, none skipped; paused: nothing is played
    if (!Number.isInteger(e.target) || e.target < 1 || e.target > 6) return { state: s, out: [] };
    if (s.rethrow) return throwAgain(s, s.rethrow, e);
    const diceIndex = s.diceIndex + 1, scores = clone(s.scores), cur = clone(s.roundScores[s.roundScores.length - 1]!);
    for (const p of s.alive) {
      const pts = hit(e.target, e.dice[p] ?? 0);
      if (!pts) continue;
      for (const sc of [scores[p]!, cur[p]!]) { sc.points += pts; sc.best = Math.max(sc.best, pts); sc.hits++; sc.lastHitAt = diceIndex; }
    }
    const roundScores = [...s.roundScores.slice(0, -1), cur];
    let st: LuckState = { ...s, diceIndex, scores, roundScores }, out: Outcome[] = [];
    if (diceIndex % DICE_PER_ROUND === 0) {
      const round = diceIndex / DICE_PER_ROUND, c = cut(st, cur);
      if (c.rethrow) return { state: { ...st, rethrow: c.rethrow }, out };
      ({ st, out } = drop(st, c.keep, round, out));
      if (diceIndex < s.rounds * DICE_PER_ROUND && !st.over) { st = { ...st, roundScores: [...roundScores, clone(scores, true)] }; out.push({ kind: "round", n: round + 1, alive: st.alive.length }); }
    }
    if (diceIndex >= s.rounds * DICE_PER_ROUND && !st.over) st = { ...st, over: true };
    return finish(st, out);
  },
};
/** Players not in `keep` are out; one left standing wins at once. */
function drop(st: LuckState, keep: string[], round: number, out: Outcome[]): { st: LuckState; out: Outcome[] } {
  const outRound = { ...st.outRound }, o = [...out];
  for (const p of st.alive) if (!keep.includes(p)) { outRound[p] = round; o.push({ kind: "out", player: p, why: "not among the players who stay in" }); }
  const alive = st.alive.filter((p) => keep.includes(p));
  return { st: { ...st, alive, outRound, over: alive.length <= 1 ? true : st.over }, out: o };
}
function throwAgain(s: LuckState, r: Rethrow, e: Extract<LuckEvent, { type: "dice" }>): { state: LuckState; out: Outcome[] } {
  const pts: Record<string, number> = {};
  for (const p of r.tied) pts[p] = hit(e.target, e.dice[p] ?? 0);
  const order = [...r.tied].sort((a, b) => pts[b]! - pts[a]!), sure = [...r.sure];
  let need = r.need, i = 0;
  while (i < order.length) { // take whole groups of equal throws while they fit
    const g = order.filter((p) => pts[p] === pts[order[i]!]);
    if (g.length > need) { const rethrow = { sure, tied: g, need }; return { state: { ...s, rethrow }, out: [] }; } // still tied: throw again
    sure.push(...g); need -= g.length; i += g.length;
    if (need === 0) break;
  }
  const round = Math.ceil(s.diceIndex / DICE_PER_ROUND);
  const d = drop({ ...s, rethrow: undefined }, sure, round, []);
  let st = d.st; const out = d.out;
  if (st.diceIndex < st.rounds * DICE_PER_ROUND && !st.over) { st = { ...st, roundScores: [...st.roundScores, clone(st.scores, true)] }; out.push({ kind: "round", n: round + 1, alive: st.alive.length }); }
  if (st.diceIndex >= st.rounds * DICE_PER_ROUND) st = { ...st, over: true };
  return finish(st, out);
}
function finish(st: LuckState, out: Outcome[]): { state: LuckState; out: Outcome[] } {
  if (!st.over) return { state: st, out };
  const rank = overall(st);
  return { state: { ...st, winner: rank[0] }, out: [...out, ...rank.slice(0, 5).map((p, i): Outcome => ({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][i]! })), { kind: "end" }] };
}
/** R20-R21 with survivors: players still in come first by the strict chain; players who went out follow, the later out the better, then by the chain. */
export function overall(x: Record<string, Score> | Pick<LuckState, "scores" | "alive" | "outRound">): string[] {
  // a plain scores record (nobody out) is ranked by the chain alone
  const st = "scores" in x && "alive" in x ? (x as Pick<LuckState, "scores" | "alive" | "outRound">) : { scores: x as Record<string, Score>, alive: Object.keys(x), outRound: {} };
  return Object.keys(st.scores).sort((a, b) => {
    const ia = st.alive.includes(a), ib = st.alive.includes(b);
    if (ia !== ib) return ia ? -1 : 1;
    if (!ia && st.outRound[a] !== st.outRound[b]) return (st.outRound[b] ?? 0) - (st.outRound[a] ?? 0);
    return rankOrder(st.scores[a]!, st.scores[b]!);
  });
}
