// Bundled to apps/web/public/zgame.js (window.ZG): everything the phone page and the organizer page need from the shared logic.
import { PATTERNS, PATTERN_RULES, callLabel, letterOf, columnOf, cellOfNumber } from "../../shared/src/ticket";
import { spokenPhrase } from "../../shared/src/audio";
import { rankWinners, rankName, fateOf, ALL_PATTERNS, activeBreak, activeIntermission, callRoundFull, callRoundR, unshiftedRound, luckyRound, luckyWinners, checkClaims, completionIndex, completionIndexKey, logFrom, RoundStore, scheduleFull, settleAll, stillToWin, ticketFor, ticketsFor } from "./game";
import { INVITE_CATEGORIES, GRACE_ROUNDS, LATE_LAG_ROUNDS, INTERMISSION_ROUNDS, MAX_ROUNDS, roundEid, MAX_BREAKS, PATTERN_ORDER, PRIZE_HOUSES, HOUSE_ORDER, HOUSES_LINE, maxWinnersFor, houseLabel, LEGACY_MAX_ORDINAL, breakShift, defaultCfg, keysInPlay, linesFor, validateCfg } from "./config";
import { PhoneRuntime } from "./phone-runtime";
import { PrizeEngine, countFromOf } from "./prize-engine";
import { QUICKNET, deriveCalls, fetchRound, roundAt, roundTimeMs, scheduleFor } from "./index";
import { callRound, resolveControl, cfgOf, scheduleWithControl } from "./control";

(globalThis as any).ZG = { rankWinners, rankName, fateOf, PATTERN_RULES, callLabel, letterOf, columnOf, cellOfNumber, spokenPhrase, PRIZE_HOUSES, HOUSE_ORDER, HOUSES_LINE, maxWinnersFor, houseLabel, LEGACY_MAX_ORDINAL, INVITE_CATEGORIES, PrizeEngine, countFromOf, GRACE_ROUNDS, LATE_LAG_ROUNDS, activeIntermission, callRoundR, unshiftedRound, INTERMISSION_ROUNDS, MAX_ROUNDS, roundEid, luckyRound, luckyWinners, ticketsFor, completionIndexKey, activeBreak, callRoundFull, scheduleFull, MAX_BREAKS, PATTERN_ORDER, breakShift, defaultCfg, keysInPlay, linesFor, validateCfg, PATTERNS, ALL_PATTERNS, checkClaims, completionIndex, logFrom, RoundStore, settleAll, stillToWin, ticketFor, PhoneRuntime, QUICKNET, deriveCalls, fetchRound, roundAt, roundTimeMs, scheduleFor, callRound, resolveControl, cfgOf, scheduleWithControl };
