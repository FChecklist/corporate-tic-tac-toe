// One board between two players (a "board" is the unit that always ends with exactly one winner), see docs/RULES.md.
//
//   - A board is up to MAX_GAMES games. The first decided game ends the board. A drawn game is replayed with the marks swapped; after the last draw, fate decides.
//   - Who has X in game 1 is a fair coin from the sealed seed; game 2 swaps; game 3 is a fresh coin. Nobody (no player, no organizer, no browser) can change it.
//   - A move has a clock. When it runs out the software plays a seeded move for that player. A second clock-out in a row in the same game loses the board (forfeit).
//   - Everything depends on (seed, board, moves, clock times) only, so the same input gives the same result on any machine, whenever it is looked at.
import { below, coin, sha256Hex } from "./random";
import { emptiesOf, emptyCells, outcomeOf, place, type Mark } from "./classic";

export const MAX_GAMES = 3;
export const DEFAULT_MOVE_MS = 20_000;
export const DEFAULT_READY_MS = 30_000;
export const MISSED_LIMIT = 2; // clock-outs in a row, in one game, that lose the board

export interface Cfg { seed: string; moveMs: number; readyMs: number; maxGames?: number }
export interface Move { ply: number; pid: string; cell: number; at: number; auto?: true }
export interface GameResult { kind: "win" | "draw" | "forfeit"; winner?: string; line?: number[]; at: number }
export interface GameState { no: number; x: string; o: string; cells: Mark[]; moves: Move[]; deadline: number; missed: Record<string, number>; result?: GameResult }
export interface BoardState {
  j: number; a: string; b: string; games: GameState[]; done: boolean; winner?: string; via?: "win" | "forfeit" | "fate";
  /** 2 points for each game won, 1 for each game drawn. A forfeited game is a win for the other player. Used only for the final ranking. */
  points: Record<string, number>;
}
export type MoveResult = { ok: true; board: BoardState } | { ok: false; error: "match-over" | "not-your-turn" | "square-taken" | "bad-square" | "not-in-board" | "stale" | "late-move"; board: BoardState };

const maxGames = (cfg: Cfg) => cfg.maxGames ?? MAX_GAMES;
const last = <T>(a: readonly T[]): T => a[a.length - 1]!;
export const lastGame = (b: BoardState): GameState => last(b.games);
/** Who is to move now in a game. */
export const moverOf = (g: GameState): string => (g.moves.length % 2 === 0 ? g.x : g.o);
export const markOf = (g: GameState, pid: string): 1 | 2 => (g.x === pid ? 1 : 2);

/** Fate: the lower hash wins. Public data only, so anybody can check it afterwards. */
export const fateOf = (seed: string, mid: string, j: number, pid: string): Promise<string> => sha256Hex(`${seed}|TTT-FATE|${mid}|${j}|${pid}`);

async function xFor(cfg: Cfg, mid: string, j: number, a: string, b: string, no: number, first?: string): Promise<{ x: string; o: string }> {
  let aHasX: boolean;
  if (no === 1) aHasX = await coin(cfg.seed, `first|${mid}|${j}`);
  else if (no === 2) aHasX = first !== a; // swapped: the one who did not have X in game 1 has it now
  else aHasX = await coin(cfg.seed, `third|${mid}|${j}`);
  return aHasX ? { x: a, o: b } : { x: b, o: a };
}

async function startGame(cfg: Cfg, mid: string, b: BoardState, no: number, startAt: number): Promise<GameState> {
  const { x, o } = await xFor(cfg, mid, b.j, b.a, b.b, no, b.games[0]?.x);
  return { no, x, o, cells: emptyCells(), moves: [], deadline: startAt + (no === 1 ? cfg.readyMs : cfg.moveMs), missed: {} };
}

/** A new board; game 1 starts at `startAt` and its first move has `readyMs` (time to open the page). */
export async function newBoard(cfg: Cfg, mid: string, j: number, a: string, b: string, startAt: number): Promise<BoardState> {
  const board: BoardState = { j, a, b, games: [], done: false, points: { [a]: 0, [b]: 0 } };
  board.games.push(await startGame(cfg, mid, board, 1, startAt));
  return board;
}

async function finishGame(cfg: Cfg, mid: string, board: BoardState, g: GameState, res: GameResult): Promise<void> {
  g.result = res;
  if (res.kind === "win" || res.kind === "forfeit") {
    board.points[res.winner!] = (board.points[res.winner!] ?? 0) + 2;
    board.done = true; board.winner = res.winner; board.via = res.kind === "win" ? "win" : "forfeit";
    return;
  }
  board.points[g.x] = (board.points[g.x] ?? 0) + 1; board.points[g.o] = (board.points[g.o] ?? 0) + 1;
  if (board.games.length < maxGames(cfg)) { board.games.push(await startGame(cfg, mid, board, board.games.length + 1, res.at)); return; }
  const [fa, fb] = await Promise.all([fateOf(cfg.seed, mid, board.j, board.a), fateOf(cfg.seed, mid, board.j, board.b)]);
  board.done = true; board.winner = fa < fb ? board.a : board.b; board.via = "fate";
}

async function settleMove(cfg: Cfg, mid: string, board: BoardState, g: GameState, at: number): Promise<void> {
  const o = outcomeOf(g.cells);
  if (o.kind === "win") await finishGame(cfg, mid, board, g, { kind: "win", winner: o.mark === 1 ? g.x : g.o, line: o.line, at });
  else if (o.kind === "draw") await finishGame(cfg, mid, board, g, { kind: "draw", at });
}

/** The software plays for a player whose clock ran out. The move is stamped at the moment the clock ran out, not at the moment anybody looked. */
async function clockOut(cfg: Cfg, mid: string, board: BoardState, g: GameState): Promise<void> {
  const who = moverOf(g), at = g.deadline;
  g.missed[who] = (g.missed[who] ?? 0) + 1;
  if (g.missed[who]! >= MISSED_LIMIT) { await finishGame(cfg, mid, board, g, { kind: "forfeit", winner: who === board.a ? board.b : board.a, at }); return; }
  const e = emptiesOf(g.cells);
  const cell = e[await below(cfg.seed, `auto|${mid}|${board.j}|${g.no}|${g.moves.length}`, e.length)]!;
  g.moves.push({ ply: g.moves.length, pid: who, cell, at, auto: true });
  g.cells = place(g.cells, cell, markOf(g, who));
  g.deadline = at + cfg.moveMs;
  await settleMove(cfg, mid, board, g, at);
}

/** Plays every clock-out that is due at time `now`. Safe to call any number of times, at any time: the result does not depend on when it is called. */
export async function advanceBoard(cfg: Cfg, mid: string, board: BoardState, now: number): Promise<BoardState> {
  while (!board.done && now > lastGame(board).deadline) await clockOut(cfg, mid, board, lastGame(board));
  return board;
}

/** A player places a mark. `ply` (optional) is the number of moves the player saw; a stale tap (a double tap, an old screen) is refused.
 *  A tap from the player whose turn had already ended (the clock-out is played first, then the tap is too late) is answered "late-move", not "not-your-turn" or "match-over". */
export async function applyMove(cfg: Cfg, mid: string, board: BoardState, pid: string, cell: number, now: number, ply?: number): Promise<MoveResult> {
  if (pid !== board.a && pid !== board.b) return { ok: false, error: "not-in-board", board };
  const before = board.done ? null : lastGame(board), overdue = !!before && moverOf(before) === pid && now > before.deadline;
  await advanceBoard(cfg, mid, board, now);
  if (overdue && (board.done || moverOf(lastGame(board)) !== pid)) return { ok: false, error: "late-move", board };
  if (board.done) return { ok: false, error: "match-over", board };
  const g = lastGame(board);
  if (ply !== undefined && ply !== g.moves.length) return { ok: false, error: "stale", board };
  if (moverOf(g) !== pid) return { ok: false, error: "not-your-turn", board };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, error: "bad-square", board };
  if (g.cells[cell] !== 0) return { ok: false, error: "square-taken", board };
  g.moves.push({ ply: g.moves.length, pid, cell, at: now });
  g.cells = place(g.cells, cell, markOf(g, pid));
  g.missed[pid] = 0;
  g.deadline = now + cfg.moveMs;
  await settleMove(cfg, mid, board, g, now);
  return { ok: true, board };
}

/** Pause support: every open clock moves later by the time the pause lasted. */
export function shiftBoard(board: BoardState, ms: number): void { if (!board.done) lastGame(board).deadline += ms; }

/** The last moment anything happened on a finished board (for starting the next round). */
export const doneAtOf = (b: BoardState): number => Math.max(0, ...b.games.map((g) => g.result?.at ?? 0));

/** A one-line, plain description of how a board ended. */
export function howBoardEnded(b: BoardState, nameOf: (pid: string) => string): string {
  if (!b.done || !b.winner) return "";
  if (b.via === "fate") return `${nameOf(b.winner)} won by fate (all ${b.games.length} games were drawn; the lower fate number wins)`;
  if (b.via === "forfeit") return `${nameOf(b.winner)} won because the other player's clock ran out twice in a row`;
  const g = b.games.find((x) => x.result?.kind === "win")!;
  return `${nameOf(b.winner)} won with three in a row${b.games.length > 1 ? ` in game ${g.no} (earlier games were drawn)` : ""}`;
}
