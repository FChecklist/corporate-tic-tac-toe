// Bundled to apps/web/public/tttengine.js (window.TTTENG): the common engine's text reactions and its Tic Tac Toe stage rules (pure; every phone computes the same result from the start time and the public log). Loaded only on the new flow (?flow=new); the live game does not use it.
import { createReactions } from "../../../vendor/game-core/packages/ui/src/reactions";
import { clockAt, settleStages, viewFor, keepAfter, STAGES, SLOTS_PER_STAGE } from "../../../vendor/game-core/packages/tictactoe/src";
import { agreed, deadlineOf, fateOf, gameFrom, slotKey } from "./stageplay";
(globalThis as any).TTTENG = { agreed, deadlineOf, fateOf, gameFrom, slotKey, createReactions, clockAt, settleStages, viewFor, keepAfter, STAGES, SLOTS_PER_STAGE };
