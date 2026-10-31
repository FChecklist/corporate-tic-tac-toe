// The organizer flow as one shared definition (spec 410 section 2). Plain words, defaults filled, advanced options behind "More options".
import type { Manifest } from "../../manifest/src";
export type StepId = "game" | "people" | "time" | "prizes" | "brand" | "check";
export interface Step { id: StepId; title: string; optional: boolean; applies: (m: Manifest) => boolean }
export const FLOW: Step[] = [
  { id: "game", title: "Game", optional: false, applies: () => true },
  { id: "people", title: "People", optional: false, applies: () => true },
  { id: "time", title: "Time", optional: false, applies: () => true },
  { id: "prizes", title: "Prizes", optional: false, applies: () => true },
  { id: "brand", title: "Brand and Breaks", optional: true, applies: () => true },
  { id: "check", title: "Check and publish", optional: false, applies: () => true },
];
export const MORE_OPTIONS = "More options";
export const SKIP_STEP = "Skip this step";
export const SAVE_CONTINUE = "Save and continue";
export const PUBLISH = "Publish";
/** Steps this game shows; steps that do not apply are skipped (also when the type changes on a copy). */
export const stepsFor = (m: Manifest): Step[] => FLOW.filter((s) => s.applies(m));
/** Published start: in the future, within 30 days, in 15-minute steps (Tambola). */
export const MAX_AHEAD_MS = 30 * 86_400_000;
export const SLOT_MS = 15 * 60_000;
export const timeOk = (t: number, now: number): string | null =>
  t <= now ? "Pick a time in the future." : t - now > MAX_AHEAD_MS ? "Pick a time within the next 30 days." : t % SLOT_MS !== 0 ? "Times are in 15-minute steps." : null;
