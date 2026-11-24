// The per-game manifest (spec 410 sections 2-5). The master console reads it; labels choose which shared pieces load. Labels are internal and never shown to customers.
export const LABELS = ["Claim", "Elimination", "Lucky Draw", "Team"] as const;
export type GameId = "tambola" | "bingo" | "tictactoe" | "snakes" | "luck" | "luckydraw";
export type Label = "Claim" | "Elimination" | "Lucky Draw" | "Team";
export type StartMode = "auto" | "manual";
/** Tambola and Bingo have 4 play modes (who calls x when it starts); the other games have "start only". */
export type PlayMode = "auto-called" | "host-called" | "start-only";
export type PrizeMode = "auto" | "manual";
export type GoldenLabel = "Claim" | "You won";
export type LateJoin = { kind: "until-end" } | { kind: "none-after-round-1"; windowSeconds?: number } | { kind: "until-draw" };
export interface Caps { auto: number; manual?: number }
export interface Manifest {
  id: GameId;
  /** Internal name (same as the console grouping) and the display title. */
  name: string;
  title: string;
  /** Pause/Resume by Organizer or Host, clocks frozen: every game supports it. */
  pauseSupport: boolean;
  /** player-presses = Claim; auto = auto-claimed, button announces "You won". */
  claimType: "player-presses" | "auto";
  /** Prize positions offered (shown in the Prizes step). */
  prizePositions: string[];
  labels: Label[];
  caps: Caps;
  startModes: StartMode[];
  playModes: PlayMode[];
  goldenButton: GoldenLabel;
  prizeModes: PrizeMode[];
  rehearsalMax: number;
  lateJoin: LateJoin;
  /** Organizer keeps the final say on prizes after the game (Tambola + Bingo only). */
  organizerFinalSay: boolean;
}
const REQUIRED: (keyof Manifest)[] = ["id", "name", "title", "labels", "caps", "startModes", "playModes", "goldenButton", "prizeModes", "rehearsalMax", "lateJoin", "organizerFinalSay", "pauseSupport", "claimType", "prizePositions"];
/** Hard limits from spec 410 section 3, by label. */
const LIMITS = { claim: { auto: 100_000, manual: 1_000 }, elimination: { auto: 2_000 }, draw: { auto: 100_000 } };
/** Problems with a manifest, in plain words; [] when it is sound. */
export function checkManifest(m: Manifest): string[] {
  const bad: string[] = [];
  const missing = REQUIRED.filter((k) => m[k] === undefined || m[k] === null);
  if (missing.length) return [`missing fields: ${missing.join(", ")}`];
  if (!m.labels.length) bad.push("labels[] is empty");
  for (const l of m.labels) if (!(LABELS as readonly string[]).includes(l)) bad.push(`unknown label ${l}`);
  if (!m.startModes.length || !m.playModes.length || !m.prizeModes.length) bad.push("start, play and prize modes need at least one entry");
  if (!m.pauseSupport) bad.push("every game supports Pause/Resume");
  if (!m.prizePositions.length) bad.push("prizePositions is empty");
  const claim = m.labels.includes("Claim"), elim = m.labels.includes("Elimination"), draw = m.labels.includes("Lucky Draw");
  const lim = claim ? LIMITS.claim : elim ? LIMITS.elimination : draw ? LIMITS.draw : null;
  if (m.caps.auto < 1) bad.push("auto cap must be positive");
  if (lim && m.caps.auto > lim.auto) bad.push(`auto cap ${m.caps.auto} is above ${lim.auto}`);
  if (m.caps.manual !== undefined && (!claim || m.caps.manual > LIMITS.claim.manual || m.caps.manual > m.caps.auto)) bad.push("manual cap is only for Claim games, up to 1,000");
  if (claim !== (m.goldenButton === "Claim")) bad.push("golden button Claim goes with the Claim label only");
  if (claim !== (m.claimType === "player-presses")) bad.push("claimType player-presses goes with the Claim label only");
  if (claim !== m.organizerFinalSay) bad.push("organizer final say goes with the Claim label only");
  const reh = claim && (m.id === "tambola" || m.id === "bingo") ? 20 : 10;
  if (m.rehearsalMax !== reh) bad.push(`rehearsal max is ${reh} for ${m.id}`);
  return bad;
}
