// A match is a chain of signed moves. Each move is signed by the player's own device key and carries the hash of the move before it, so:
//  - the two phones never need a server to agree what happened: both hold the same chain;
//  - nobody can change, remove or invent a move afterwards (a changed move breaks the chain and the signature);
//  - the final score is recomputed from the chain by anyone, using the same rules code (engine.ts). The collector only receives the finished chain.
import { BOARD_SIZES, emptyBoard, matchScore, nextMark, type Cell, type MatchScore, type Size } from "./engine";
import { sha256Hex } from "./random";

export type Player = "A" | "B";
export interface Move { k: string; b: number; s: number; p: Player; c: number; t: number; h: string }
export interface SignedMove { m: Move; sig: string }

const enc = new TextEncoder();
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): ArrayBuffer => { const a = (s.match(/../g) ?? []).map((x) => parseInt(x, 16)); const buf = new ArrayBuffer(a.length); new Uint8Array(buf).set(a); return buf; };
const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export interface DeviceKeys { priv: CryptoKey; pubJwk: JsonWebKey }
export async function newDeviceKeys(): Promise<DeviceKeys> {
  const kp = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  return { priv: kp.privateKey, pubJwk: await crypto.subtle.exportKey("jwk", kp.publicKey) };
}
const importPub = (jwk: JsonWebKey): Promise<CryptoKey> => crypto.subtle.importKey("jwk", jwk, ALG, false, ["verify"]);

/** The exact bytes that are signed: fixed order, so both phones produce the same text. */
export const canonical = (m: Move): string => JSON.stringify([m.k, m.b, m.s, m.p, m.c, m.t, m.h]);
export const GENESIS = "0".repeat(64);

export async function signMove(keys: DeviceKeys, m: Move): Promise<SignedMove> {
  return { m, sig: hex(await crypto.subtle.sign(SIGN, keys.priv, enc.encode(canonical(m)))) };
}
export const hashOf = (sm: SignedMove): Promise<string> => sha256Hex(canonical(sm.m) + sm.sig);

export interface BoardState { n: Size; cells: Cell[]; xIsA: boolean }
export const boardsFor = (xIsA: readonly boolean[]): BoardState[] => BOARD_SIZES.map((n, i) => ({ n, cells: emptyBoard(n), xIsA: xIsA[i]! }));

/** Where the match stands, and the rules for the next move. Used by the screens and by the verifier. */
export class MatchState {
  readonly boards: BoardState[]; seq = 0; lastHash = GENESIS; readonly moves: SignedMove[] = [];
  constructor(readonly key: string, xIsA: readonly boolean[], readonly pubA: JsonWebKey, readonly pubB: JsonWebKey) { this.boards = boardsFor(xIsA); }
  /** Index of the board being played, or -1 when all three are full. */
  get boardIndex(): number { return this.boards.findIndex((bd) => bd.cells.some((c) => c === 0)); }
  get done(): boolean { return this.boardIndex === -1; }
  /** Whose turn it is on the current board. */
  get mover(): Player | null {
    const i = this.boardIndex; if (i < 0) return null; const bd = this.boards[i]!;
    const mark = nextMark(bd.cells); const aHasX = bd.xIsA;
    return (mark === 1) === aHasX ? "A" : "B";
  }
  /** The mark (1 = X, 2 = O) the given player holds on board i. */
  markOf(i: number, p: Player): 1 | 2 { return (this.boards[i]!.xIsA === (p === "A")) ? 1 : 2; }
  async check(sm: SignedMove): Promise<string | null> {
    const { m } = sm;
    if (m.k !== this.key) return "wrong match";
    if (this.done) return "match already finished";
    if (m.s !== this.seq) return `out of order (expected ${this.seq})`;
    if (m.b !== this.boardIndex) return "wrong board";
    if (m.h !== this.lastHash) return "chain broken";
    if (m.p !== this.mover) return "not this player's turn";
    const bd = this.boards[m.b]!;
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= bd.cells.length || bd.cells[m.c] !== 0) return "cell not free";
    const ok = await crypto.subtle.verify(SIGN, await importPub(m.p === "A" ? this.pubA : this.pubB), unhex(sm.sig), enc.encode(canonical(m)));
    return ok ? null : "bad signature";
  }
  /** Applies a signed move if it is valid; returns the reason when it is not. */
  async apply(sm: SignedMove): Promise<string | null> {
    const bad = await this.check(sm); if (bad) return bad;
    this.boards[sm.m.b]!.cells[sm.m.c] = this.markOf(sm.m.b, sm.m.p);
    this.lastHash = await hashOf(sm); this.seq++; this.moves.push(sm); return null;
  }
  score(): MatchScore { return matchScore(this.boards.map((b) => ({ n: b.n, cells: b.cells, xIsA: b.xIsA }))); }
  /** The next move for a player, ready to sign. */
  nextMove(p: Player, cell: number, now = Date.now()): Move { return { k: this.key, b: this.boardIndex, s: this.seq, p, c: cell, t: now, h: this.lastHash }; }
}

/** Replays a finished chain from scratch and returns the score, or the first thing that is wrong with it. */
export async function verifyTranscript(key: string, xIsA: readonly boolean[], pubA: JsonWebKey, pubB: JsonWebKey, chain: readonly SignedMove[]): Promise<{ ok: true; score: MatchScore } | { ok: false; at: number; reason: string }> {
  const st = new MatchState(key, xIsA, pubA, pubB);
  for (let i = 0; i < chain.length; i++) { const bad = await st.apply(chain[i]!); if (bad) return { ok: false, at: i, reason: bad }; }
  if (!st.done) return { ok: false, at: chain.length, reason: "match not finished" };
  return { ok: true, score: st.score() };
}
export const TOTAL_MOVES = BOARD_SIZES.reduce((t, n) => t + n * n, 0); // 9 + 16 + 25 = 50
