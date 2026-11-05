// Start modes, pause/resume with the clock-freeze contract, size caps, rehearsal (spec 410 section 2).
import type { LateJoin, Manifest, StartMode } from "../../manifest/src";
import { canControlClock, type Role } from "./roles";
export type Phase = "waiting" | "running" | "paused" | "over";
/**
 * Clock-freeze contract: while paused NOTHING counts down (call gap, round timer, move timer, draw countdown, "not playing in time").
 * `frozenAt` is kept; on resume every deadline moves later by the paused time. Players see "Paused". Each pause is logged by role.
 * All deadlines must be computed with gameNow(), never with the wall clock.
 */
export interface Clock { phase: Phase; frozenAt: number | null; pausedMs: number; pauses: { role: Role; from: number; to?: number }[] }
export const newClock = (): Clock => ({ phase: "waiting", frozenAt: null, pausedMs: 0, pauses: [] });
export const PAUSED_MSG = "Paused";
/** Game time: wall time minus time spent paused. */
export const gameNow = (c: Clock, now: number): number => (c.frozenAt ?? now) - c.pausedMs;
export function pause(c: Clock, role: Role, now: number): Clock {
  if (!canControlClock(role) || c.phase !== "running") return c;
  return { ...c, phase: "paused", frozenAt: now, pauses: [...c.pauses, { role, from: now }] };
}
export function resume(c: Clock, role: Role, now: number): Clock {
  if (!canControlClock(role) || c.phase !== "paused" || c.frozenAt === null) return c;
  const pauses = c.pauses.map((p, i) => (i === c.pauses.length - 1 ? { ...p, to: now } : p));
  return { ...c, phase: "running", frozenAt: null, pausedMs: c.pausedMs + (now - c.frozenAt), pauses };
}
/** Start: auto at the published time, manual when the Organizer or Host presses Start. The time is published in both modes. */
export const shouldStart = (mode: StartMode, publishedAt: number, now: number, pressedBy: Role | null): boolean =>
  mode === "auto" ? now >= publishedAt : pressedBy !== null && canControlClock(pressedBy);
export const start = (c: Clock): Clock => (c.phase === "waiting" ? { ...c, phase: "running" } : c);
export const end = (c: Clock): Clock => ({ ...c, phase: "over", frozenAt: null });
/** Size caps: manual play (Host calls) has the lower cap in Tambola and Bingo. */
export const capFor = (m: Manifest, manualPlay: boolean): number => (manualPlay && m.caps.manual ? m.caps.manual : m.caps.auto);
/** Rehearsal ("Try it first"): no prizes, no payment, marked Rehearsal, not counted. */
export const rehearsalLimit = (m: Manifest): number => m.rehearsalMax;
export const REHEARSAL_TAG = "Rehearsal";

/** Late join (spec 410 section 5). Elimination: no join after round 1 unless the Organizer set a short window (counted from the end of round 1, at most 5 minutes). Lucky Draw: until draw time. */
export const MAX_LATE_WINDOW_S = 300;
export interface JoinCtx { round: number; over: boolean; msSinceRound1End: number; now: number; closeAt?: number }
export const canJoinLate = (rule: LateJoin, c: JoinCtx): boolean => {
  if (c.over) return false;
  if (rule.kind === "until-end") return true;
  if (rule.kind === "until-draw") return c.closeAt !== undefined && c.now < c.closeAt;
  return c.round <= 1 || c.msSinceRound1End <= (rule.windowSeconds ?? 0) * 1000;
};
/** The Organizer sets a late-join window; only the none-after-round-1 rule takes one (0 to 300 s). Other rules come back unchanged. */
export const withLateWindow = (rule: LateJoin, seconds: number): LateJoin =>
  rule.kind === "none-after-round-1" ? { kind: rule.kind, windowSeconds: Math.max(0, Math.min(MAX_LATE_WINDOW_S, Math.floor(seconds) || 0)) } : rule;
