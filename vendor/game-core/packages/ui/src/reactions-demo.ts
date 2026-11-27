// Ten minutes of fake Snakes events for one participant (p7), run through the scheduler: shows how the throttle keeps it to 10-15 messages.
// Typechecked with the package; print it with `bun tools/reactions-sim.ts`.
import { ReactionScheduler, type Verdict } from "./reactions";
export interface SimRow { t: number; id: string; who: string; priority?: "high"; verdict: Verdict }
const ME = "p7", OTHER = "p3";
// [seconds, reaction id, who it happened to, high priority]
const EVENTS: [number, string, string, boolean?][] = [
  [5, "good_luck", ""], [12, "lets_go", ""], [24, "yeah", ME], [45, "aaah_bitten", OTHER], [52, "aaah_bitten", ME], [75, "extra_throws", ME], [100, "up_you_go", ME], [112, "ouch", ME],
  [150, "ready_set_go", ""], [160, "climb_on", OTHER], [180, "oops", ME], [240, "hang_on", ""], [250, "lets_go", ""], [300, "ready_set_go", ""],
  [330, "climb_on", ME], [380, "not_again", ME], [410, "so_close", ME], [460, "youre_ahead", ME], 
  [540, "bullseye", ME, true], [541, "champion", ME, true], [545, "nice_one", ME], [560, "poof_gone", OTHER, true], [575, "last_chance", ""],
];
export function simulateTenMinutes(): { rows: SimRow[]; shown: string[] } {
  const shown: string[] = [], rx = new ReactionScheduler(ME, (r) => shown.push(r.id));
  const rows = EVENTS.map(([s, id, who, hi]): SimRow => ({ t: s, id, who, ...(hi ? { priority: "high" as const } : {}), verdict: rx.react(id, { now: s * 1000, who: who || undefined, game: "snakes", ...(hi ? { priority: "high" as const } : {}) }) }));
  return { rows, shown };
}
