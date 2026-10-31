// The plug-in interface (spec 410 section 5). A game supplies ONE rules module; roles, modes, pause, participation, prizes, UI and wording come from the core.
import type { GoldenLabel, LateJoin, Manifest } from "../../manifest/src";
import type { Clock } from "./modes";
export type FieldKind = "number" | "text" | "choice" | "toggle";
/** A setup field the game adds to the "Game" step. Advanced ones sit behind "More options". */
export interface SetupField { key: string; label: string; kind: FieldKind; default: string | number | boolean; choices?: string[]; advanced?: boolean; help?: string }
/** What the game tells the core after each step. */
export type Outcome =
  | { kind: "win"; player: string; position: string }      // a prize position was won (claim accepted, last standing, draw)
  | { kind: "out"; player: string; why: string }
  | { kind: "round"; n: number; alive: number }
  | { kind: "end" };
export type ClaimType = "player-presses" | "auto";
export interface StepResult<S> { state: S; out: Outcome[] }
export interface RulesModule<S = unknown, E = unknown> {
  manifest: Manifest;
  setupFields: SetupField[];
  /** "player-presses": the participant must press Claim. "auto": claimed by the game, the button announces "You won". */
  claimType: ClaimType;
  goldenButton: GoldenLabel;
  /** Prize positions this game offers (e.g. early5, top, mid, bot, full; or "1st", "2nd"). */
  prizePositions(setup: Record<string, unknown>): string[];
  lateJoin: LateJoin;
  /** Create the state when the game starts. `players` are the seated ids. */
  init(setup: Record<string, unknown>, players: string[], now: number): S;
  /** The play loop: advance on a tick or a player/host event. All times are game time (gameNow), so a pause freezes everything. */
  step(state: S, event: E | { type: "tick" }, now: number, clock: Clock): StepResult<S>;
}
/** The labels in a manifest decide which shared pieces load; if the module disagrees with its labels the module wins and the conformance suite flags it. */
export const labelsAgree = (m: RulesModule): string[] => {
  const claim = m.manifest.labels.includes("Claim");
  return claim === (m.claimType === "player-presses") ? [] : ["labels say Claim but claimType differs (or the reverse)"];
};
