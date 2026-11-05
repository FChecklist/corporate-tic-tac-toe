// Luck by Chance rules module (owner redesign 31 Oct 2026). See docs/LUCK_RULES_BOOK.md.
// Each round's target and each player's fate number are made by the host site from the game id and the public beacon; they come in as inputs, the core never makes them.
import { MANIFESTS } from "../../manifest/src";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export const ROUNDS = 22, WAITING_ROOM_S = 120, PRESS_S = 10, GAP_S = 10, REVEAL_S = 3 /* inside the gap */, TOP = 5;
/** Pause-free start to end: 22 presses of 10 s and 21 gaps of 10 s (the last gap is not waited for) = 430 s; play is always between 7:00 and 8:00, and with the 120 s waiting room the whole game is at most 10:00. */
export const GAME_MS = (ROUNDS * PRESS_S + (ROUNDS - 1) * GAP_S) * 1000;
export interface Score { points: number; exact: number; fives: number; reachedAt: number; fate: number }
/** Points for one press: exact 10, 1 away 5, 2 away 3, 3 or more away 1, no press (0, undefined or out of range) 0. */
export const pointsFor = (target: number, press: number | undefined | null): number => {
  if (!Number.isInteger(press) || (press as number) < 1 || (press as number) > 6) return 0;
  const d = Math.abs(target - (press as number));
  return d === 0 ? 10 : d === 1 ? 5 : d === 2 ? 3 : 1;
};
/** Total, then most exact hits, then most 5-point hits, then who reached the total first, then the lower fate number. Always strict. */
export const rankOrder = (a: Score, b: Score): number => b.points - a.points || b.exact - a.exact || b.fives - a.fives || a.reachedAt - b.reachedAt || a.fate - b.fate;
export interface LuckState { round: number; scores: Record<string, Score>; over: boolean; winner?: string }
export type LuckEvent = { type: "round"; target: number; press: Record<string, number | undefined> } | { type: "tick" };
/** Shared Reaction pack ids for the moments of a Luck game (ids from packages/ui/src/reactions.ts). */
export const LUCK_REACTIONS = { exact: "boom", near: "nice", miss: "oops", roundStart: "round_start", countdown: "countdown", final: "ta_da", win: "win" } as const;
/** Which reaction a press earns. */
export const reactionFor = (target: number, press: number | undefined | null): string => { const p = pointsFor(target, press); return p === 10 ? LUCK_REACTIONS.exact : p === 5 ? LUCK_REACTIONS.near : LUCK_REACTIONS.miss; };
export const setupFields: SetupField[] = []; // the Organizer's settings are the prize text and the start mode, which the shared flow already asks
const fresh = (fate: number): Score => ({ points: 0, exact: 0, fives: 0, reachedAt: 0, fate });
export const luckRules: RulesModule<LuckState, LuckEvent> = {
  manifest: MANIFESTS.luck,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: () => ["1st", "2nd", "3rd", "4th", "5th"],
  lateJoin: MANIFESTS.luck.lateJoin,
  init(setup, players) {
    if (players.length < 2) throw new Error("at least 2 players are needed");
    const fate = (setup.fate ?? {}) as Record<string, number>, scores: Record<string, Score> = {};
    for (const p of players) scores[p] = fresh(fate[p] ?? 0);
    return { round: 0, scores, over: false };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "round" || clock.phase === "paused") return { state: s, out: [] }; // paused: nothing is played
    if (!Number.isInteger(e.target) || e.target < 1 || e.target > 6) return { state: s, out: [] };
    const round = s.round + 1, scores: Record<string, Score> = {};
    for (const [p, sc] of Object.entries(s.scores)) {
      const pts = pointsFor(e.target, e.press[p]), n = { ...sc };
      if (pts) { n.points += pts; n.reachedAt = round; if (pts === 10) n.exact++; if (pts === 5) n.fives++; }
      scores[p] = n;
    }
    if (round < ROUNDS) return { state: { ...s, round, scores }, out: [{ kind: "round", n: round + 1, alive: Object.keys(scores).length }] };
    const rank = ranking(scores), out: Outcome[] = rank.slice(0, TOP).map((p, i): Outcome => ({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][i]! }));
    return { state: { round, scores, over: true, winner: rank[0] }, out: [...out, { kind: "end" }] };
  },
};
/** Player ids best first. */
export const ranking = (scores: Record<string, Score>): string[] => Object.keys(scores).sort((a, b) => rankOrder(scores[a]!, scores[b]!));
