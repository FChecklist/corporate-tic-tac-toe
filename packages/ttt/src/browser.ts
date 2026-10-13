// Bundled for the browser to apps/web/public/tttgame.js (window.TTT): everything that decides a Tic Tac Toe game runs on the phone from this file. The server stores and relays; it never runs any of it.
import { TttConsole, TttPhone, TttWatcher, effOf, planOf, planPayload, replayAll, replayMatch, wallOf, ABSENT } from "./phone";
import { sha256Hex } from "./hash";
import { advanceBoard, applyMove, newBoard, MAX_GAMES, MISSED_LIMIT } from "./match";
import { outcomeOf } from "./classic";
import { rankings, startTournament, tieLine, roundName } from "./bracket";
import { commitOf, seedOf, verifyReveal } from "./seal";

(globalThis as any).TTT = { TttPhone, TttConsole, TttWatcher, effOf, wallOf, planOf, planPayload, replayAll, replayMatch, ABSENT, sha256Hex, advanceBoard, applyMove, newBoard, MAX_GAMES, MISSED_LIMIT, outcomeOf, rankings, startTournament, tieLine, roundName, commitOf, seedOf, verifyReveal };
