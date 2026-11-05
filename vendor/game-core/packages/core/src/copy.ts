// "Create new game from an earlier game" (spec 410 section 2). Copies settings, start mode, prize plan, roles, look. NEVER the people list, time, results or play data.
import type { StartMode } from "../../manifest/src";
import type { PrizePlan } from "./prizes";
export interface GameSettings {
  name: string; size: number; startMode: StartMode; prizePlan: PrizePlan;
  roles: { hosts: string[]; cohostLimit: number };
  look: { company?: string; colour?: string; logo?: string; theme?: "retro" | "modern" };
  rules: Record<string, unknown>;
}
/** A game record; only `settings` is ever read by a copy. */
export interface EarlierGame { gameType: string; settings: GameSettings; people?: unknown; time?: unknown; results?: unknown }
export const COPIED = ["settings", "startMode", "prizePlan", "roles", "look"] as const;
export const NEVER_COPIED = ["people", "time", "results", "play data"] as const;
export const copyLabel = (from: string) => `Copied from ${from}`;
/** The copy-spec. Game-specific `rules` are kept only when the type is unchanged; other steps are skipped by the flow. */
export function copyFrom(old: EarlierGame, newType: string): { settings: GameSettings; copiedFromType: string } {
  const s = old.settings;
  return {
    copiedFromType: old.gameType,
    settings: { name: s.name, size: s.size, startMode: s.startMode, prizePlan: s.prizePlan, roles: { ...s.roles }, look: { ...s.look }, rules: old.gameType === newType ? { ...s.rules } : {} },
  };
}
