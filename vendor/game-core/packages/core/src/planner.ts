// The Auto prize planner, copied unchanged from Tambola 1.9.0 (frozen-1.9.0, apps/web/public/prize-planner.js): eight approved splits, whole units, leftover to the biggest prize.
// prize-planner.js must stay byte-identical to Tambola's copy so both give the same results. Game-neutral: patterns are the game's own words ("top", "full"...).
import api from "./prize-planner.js";
export type { PlannedPrize, PrizePlanResult, ManualPrizeRow } from "./prize-planner.d";
export const prizePlanner = api;
export const { plan: planPrizes, shareOut, validateManual, hint: planHint } = api;
