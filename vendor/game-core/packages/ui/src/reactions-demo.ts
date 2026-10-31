// Ten minutes of fake Snakes events for one participant (p7), run through the scheduler: shows how the throttle keeps it to 10-15 messages.
// Typechecked with the package; print it with `bun tools/reactions-sim.ts`.
import { ReactionScheduler, type Verdict } from "./reactions";
export interface SimRow { t: number; id: string; who: string; priority?: "high"; verdict: Verdict }
const ME = "p7", OTHER = "p3";
// [seconds, reaction id, who it happened to, high priority]
const EVENTS: [number, string, string, boolean?][] = [
  [5, "ready", ""], [12, "go", ""], [24, "six", ME], [45, "snake_bite", OTHER], [52, "snake_bite", ME], [75, "extra_throw", ME], [100, "upgrade", ME], [112, "ouch", ME],
  [150, "round_end", ""], [160, "ladder", OTHER], [180, "missed_turn", ME], [182, "oops", ME], [240, "pause", ""], [250, "resume", ""], [300, "round_end", ""],
  [330, "ladder", ME], [331, "yay", ME], [380, "snake_bite", ME], [410, "close_call", ME], [460, "ahead", ME], [480, "time_up", ""],
  [540, "finish", ME, true], [541, "win", ME, true], [545, "nice", ME], [560, "out", OTHER, true], [575, "last_one", ""],
];
export function simulateTenMinutes(): { rows: SimRow[]; shown: string[] } {
  const shown: string[] = [], rx = new ReactionScheduler(ME, (r) => shown.push(r.id));
  const rows = EVENTS.map(([s, id, who, hi]): SimRow => ({ t: s, id, who, ...(hi ? { priority: "high" as const } : {}), verdict: rx.react(id, { now: s * 1000, who: who || undefined, game: "snakes", ...(hi ? { priority: "high" as const } : {}) }) }));
  return { rows, shown };
}
