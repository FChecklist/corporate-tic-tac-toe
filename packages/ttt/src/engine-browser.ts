// Bundled to apps/web/public/tttengine.js (window.TTTENG): the common engine's text reactions and its Tic Tac Toe rule constants. Loaded only on the new flow (?flow=new); the live game does not use it.
import { react, setReactionMode } from "../../../vendor/game-core/packages/ui/src/reactions";
import { MAX_GAMES } from "../../../vendor/game-core/packages/tictactoe/src";
(globalThis as any).TTTENG = { react, setReactionMode, ENGINE_MAX_GAMES: MAX_GAMES };
