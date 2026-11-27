// Snakes and Ladders rules module (rules taken from the live site, docs/RULES.md R1-R40; group race). See docs/SNAKES_RULES_BOOK.md.
// Boards (made from the game id, seat and the first public random value), the rolls (made from the public value of each turn) and fate numbers come in from the host site.
import { MANIFESTS } from "../../manifest/src";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export type SpecialKind = "upgrade" | "downgrade" | "reward" | "punishment";
export interface Special { kind: SpecialKind; n?: number } // n = squares for upgrade/downgrade
export interface Board { size: number; snakes: Record<number, number>; ladders: Record<number, number>; specials?: Record<number, Special> } // from -> to
export const SIZES = [100, 144, 225];
/** R6-R10: counts, ends, lengths and no trap. Returns the problems in plain words; [] when the board is sound. */
export function checkBoard(b: Board, perKind = [6, 12]): string[] {
  const bad: string[] = [], last = b.size, sn = Object.entries(b.snakes).map(([f, t]) => [+f, t] as const), la = Object.entries(b.ladders).map(([f, t]) => [+f, t] as const);
  const k = last / 100; // longer boards scale the lengths
  if (sn.length < perKind[0]! || sn.length > perKind[1]! || la.length < perKind[0]! || la.length > perKind[1]!) bad.push("a board has 6 to 12 snakes and 6 to 12 ladders");
  const used = new Set<number>();
  for (const [f, t] of [...sn, ...la]) {
    if (f === 1 || t === last || f === last) bad.push("no snake or ladder starts on square 1 or ends on the last square");
    if (used.has(f) || used.has(t)) bad.push("no square is used twice"); used.add(f); used.add(t);
  }
  for (const [f, t] of la) if (t - f < 8 * k || t - f > 30 * k) bad.push("a ladder climbs 8 to 30 squares");
  for (const [f, t] of sn) if (f - t < 8 * k || f - t > 40 * k) bad.push("a snake drops 8 to 40 squares");
  for (const [q, sp] of Object.entries(b.specials ?? {})) {
    const f = +q;
    if (f === 1 || f === last) bad.push("a special square is never on square 1 or the last square");
    if (used.has(f)) bad.push("no square is used twice");
    used.add(f);
    if ((sp.kind === "upgrade" || sp.kind === "downgrade") && !(Number.isInteger(sp.n) && sp.n! >= 1 && sp.n! <= 6 * k)) bad.push("an upgrade or downgrade moves 1 to 6 squares (scaled on larger boards)");
  }
  if (!reachable(b)) bad.push("nobody may be trapped");
  return [...new Set(bad)];
}
/** R10: from every square the last square can be reached (rolls 1-6, exact finish). */
function reachable(b: Board): boolean {
  const next = (s: number, r: number) => { const n = s + r; return n > b.size ? s : (b.snakes[n] ?? b.ladders[n] ?? specialTo(b, n) ?? n); };
  const can = new Set<number>([b.size]);
  for (let changed = true; changed;) { changed = false; for (let s = 1; s < b.size; s++) if (!can.has(s) && [1, 2, 3, 4, 5, 6].some((r) => can.has(next(s, r)))) { can.add(s); changed = true; } }
  return Array.from({ length: b.size }, (_, i) => i + 1).every((s) => can.has(s));
}
/** R16-R18, R19: the new square after a roll. Exact finish needed unless `pass` ("reach or pass"). Returns the square and whether a ladder/snake moved the pawn. */
/** Where an upgrade/downgrade square sends the pawn (never onto the last square, never below square 2), or undefined when n is not one. */
function specialTo(b: Board, n: number): number | undefined {
  const sp = b.specials?.[n]; if (!sp || (sp.kind !== "upgrade" && sp.kind !== "downgrade")) return undefined;
  return sp.kind === "upgrade" ? Math.min(n + (sp.n ?? 3), b.size - 1) : Math.max(n - (sp.n ?? 3), 2);
}
/** Optional special squares: put `counts` of each kind on free squares 2..size-1 (never on 1, the last square, or a square already used). Counts of 0 add nothing, so the live board is unchanged. `rnd` returns [0,1). */
export function placeSpecials(b: Board, counts: Partial<Record<SpecialKind, number>>, n: number, rnd: () => number): Board {
  const used = new Set<number>([1, b.size]); for (const [f, t] of [...Object.entries(b.snakes), ...Object.entries(b.ladders)]) { used.add(+f); used.add(t); }
  const free: number[] = []; for (let q = 2; q < b.size; q++) if (!used.has(q)) free.push(q);
  const specials: Record<number, Special> = { ...(b.specials ?? {}) };
  for (const kind of ["upgrade", "downgrade", "reward", "punishment"] as SpecialKind[]) for (let i = 0; i < (counts[kind] ?? 0) && free.length; i++) {
    const q = free.splice(Math.floor(rnd() * free.length), 1)[0]!; specials[q] = kind === "upgrade" || kind === "downgrade" ? { kind, n } : { kind };
  }
  const nb = Object.keys(specials).length ? { ...b, specials } : b;
  return checkBoard(nb).length ? b : nb; // a board that would be unsound keeps its plain squares
}
/** Owner board (31 Oct 2026): ONE board for everyone, 100 equal squares, fixed counts. */
export const OWNER_COUNTS = { snakes: 30, ladders: 15, penalty: 10, reward: 10 } as const;
export const REWARD_THROWS = 2;
/** Square n (1..100) to its grid cell. Row 0 is the bottom row: 1..10 left to right, the next row up runs right to left (11 at the right edge), and so on to 100 at the top. */
export function squareXY(n: number): { col: number; row: number } {
  const row = Math.floor((n - 1) / 10), i = (n - 1) % 10;
  return { col: row % 2 === 0 ? i : 9 - i, row };
}
/** What is drawn on a square: its own picture. Snake head / ladder foot carry the length; tails and tops are plain squares with a mark. */
export type SquareKind = "plain" | "snake-head" | "ladder-foot" | "penalty" | "reward" | "start" | "finish";
export function squareKind(b: Board, n: number): SquareKind {
  if (n === 1) return "start"; if (n === b.size) return "finish";
  if (b.snakes[n]) return "snake-head"; if (b.ladders[n]) return "ladder-foot";
  const sp = b.specials?.[n]; if (sp?.kind === "punishment") return "penalty"; if (sp?.kind === "reward") return "reward";
  return "plain";
}
/** How many players stand on each square (for the number shown inside the square). */
export function playersOn(s: Pick<SnakesState, "pawns">): Record<number, number> {
  const c: Record<number, number> = {}; for (const w of Object.values(s.pawns)) c[w.at] = (c[w.at] ?? 0) + 1; return c;
}
const seeded = (seed: string): (() => number) => {
  let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), h | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
/** The board for a game, made only from the game id (same on every phone and the server). 30 snakes, 15 ladders, 10 penalty, 10 reward squares; the longest snake is 99 to 9, the longest ladder 31 to 80; every snake and ladder has a different length. A snake or ladder ends on a plain square; several may end on the same plain square. */
export function ownerBoard(gameId: string): Board {
  for (let attempt = 0; attempt < 20000; attempt++) {
    const r = seeded(gameId + "#" + attempt), shuf = <T,>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
    const pool = shuf(Array.from({ length: 98 }, (_, i) => i + 2).filter((q) => q !== 99 && q !== 31 && q !== 80 && q !== 9));
    const take = (n: number, ok: (q: number) => boolean): number[] => { const out: number[] = []; for (let i = 0; i < pool.length && out.length < n; i++) if (ok(pool[i]!)) out.push(...pool.splice(i--, 1)); return out; };
    const hd = take(29, (q) => q >= 12), ft = take(14, (q) => q <= 88), pen = take(10, () => true), rew = take(10, () => true); // heads need room to fall, feet room to climb
    if (hd.length < 29 || ft.length < 14) continue;
    const heads = [99, ...hd], feet = [31, ...ft];
    const plain = [...pool, 80, 9], used = new Set<number>([90, 49]), snakes: Record<number, number> = { 99: 9 }, ladders: Record<number, number> = { 31: 80 };
    let ok = true;
    for (const f of heads.slice(1)) { const o = plain.filter((t) => t <= f - 3 && !used.has(f - t)); if (!o.length) { ok = false; break; } const t = o[Math.floor(r() * o.length)]!; used.add(f - t); snakes[f] = t; }
    if (!ok) continue;
    for (const f of feet.slice(1)) { const o = plain.filter((t) => t >= f + 3 && !used.has(t - f)); if (!o.length) { ok = false; break; } const t = o[Math.floor(r() * o.length)]!; used.add(t - f); ladders[f] = t; }
    if (!ok) continue;
    const specials: Record<number, Special> = {}; for (const q of pen) specials[q] = { kind: "punishment" }; for (const q of rew) specials[q] = { kind: "reward" };
    const b: Board = { size: 100, snakes, ladders, specials };
    if (!checkOwnerBoard(b).length) return b;
  }
  throw new Error("no sound board for this game id");
}
/** Owner board rules in plain words; [] when sound. Includes the proof that the last square is reachable from every square. */
export function checkOwnerBoard(b: Board): string[] {
  const bad: string[] = [], sn = Object.entries(b.snakes).map(([f, t]) => [+f, t] as const), la = Object.entries(b.ladders).map(([f, t]) => [+f, t] as const), sp = Object.entries(b.specials ?? {});
  if (b.size !== 100) bad.push("the board has 100 squares");
  if (sn.length !== OWNER_COUNTS.snakes || la.length !== OWNER_COUNTS.ladders || sp.filter(([, v]) => v.kind === "punishment").length !== OWNER_COUNTS.penalty || sp.filter(([, v]) => v.kind === "reward").length !== OWNER_COUNTS.reward) bad.push("30 snakes, 15 ladders, 10 penalty and 10 reward squares");
  const starts = [...sn.map(([f]) => f), ...la.map(([f]) => f), ...sp.map(([q]) => +q)];
  if (new Set(starts).size !== starts.length) bad.push("no square is used twice");
  if (starts.some((q) => q === 1 || q === 100)) bad.push("nothing sits on square 1 or 100");
  const ends = [...sn.map(([, t]) => t), ...la.map(([, t]) => t)];
  if (ends.some((t) => starts.includes(t) || t < 2 || t > 99)) bad.push("a snake or ladder ends on a plain square");
  const lens = [...sn.map(([f, t]) => f - t), ...la.map(([f, t]) => t - f)];
  if (lens.some((d) => d < 3) || new Set(lens).size !== lens.length) bad.push("every snake and ladder has a different length");
  if (b.snakes[99] !== 9 || Math.max(...sn.map(([f, t]) => f - t)) !== 90) bad.push("the longest snake is on 99 and goes to 9");
  if (b.ladders[31] !== 80 || Math.max(...la.map(([f, t]) => t - f)) !== 49) bad.push("the longest ladder starts on 31 and goes to 80");
  if (!reachable(b)) bad.push("nobody may be trapped");
  return [...new Set(bad)];
}
/** The plain message shown on the board for what the move did. */
export function noteFor(r: { ladder: boolean; snake: boolean; special?: SpecialKind; to: number; n?: number }): string {
  if (r.ladder) return `Ladder! Up to ${r.to}`; if (r.snake) return `Snake! Down to ${r.to}`;
  if (r.special === "upgrade") return `Upgrade! Forward ${r.n} to ${r.to}`; if (r.special === "downgrade") return `Downgrade! Back ${r.n} to ${r.to}`;
  if (r.special === "reward") return `Reward! ${REWARD_THROWS} extra throws`; if (r.special === "punishment") return "Punishment! You lose your next throw";
  return "";
}
export function move(b: Board, at: number, roll: number, pass = false): { to: number; ladder: boolean; snake: boolean; special?: SpecialKind; n?: number } {
  let n = at + roll;
  if (n > b.size) { if (!pass) return { to: at, ladder: false, snake: false }; n = b.size; }
  if (b.ladders[n]) return { to: b.ladders[n]!, ladder: true, snake: false };
  if (b.snakes[n]) return { to: b.snakes[n]!, ladder: false, snake: true };
  const sp = b.specials?.[n]; if (sp) return { to: specialTo(b, n) ?? n, ladder: false, snake: false, special: sp.kind, n: sp.n };
  return { to: n, ladder: false, snake: false };
}
export interface Pawn { at: number; ladders: number; missed: number; fate: number; finishedTurn?: number; extra?: number; skip?: number; note?: string }
export interface SnakesState {
  boards: Record<string, Board>; pawns: Record<string, Pawn>; turn: number; turnLimit: number; pass: boolean; presence: boolean;
  finishers: string[]; survivors: number; roundTurns: number; out: string[]; milestones: number[]; milestoneWon: Record<number, string>; over: boolean; timeLimitMs: number; gameMs: number; settledMs: number;
}
export type SnakesEvent = { type: "turn"; rolls: Record<string, number>; threw?: string[]; gameMs?: number; only?: string } | { type: "tick" };
/** Rule 20: each player has this long per throw, clocked per player. */
export const WINDOW_MS = 10_000;
export const nextWindowAt = (openedAt: number): number => openedAt + WINDOW_MS;
/** Rule 27: the gap is also the settle time. The next window opens only when the 10 s have passed (game time) AND the state of the throw that opened the last window is settled (moves, snake/ladder effects applied, ahead/behind recounted). */
export const windowOpen = (s: Pick<SnakesState, "settledMs"> & Partial<Pick<SnakesState, "pawns">>, lastOpenedAt: number, gameMs: number, player?: string): boolean =>
  (player !== undefined && (s.pawns?.[player]?.extra ?? 0) > 0) || (gameMs >= nextWindowAt(lastOpenedAt) && s.settledMs >= lastOpenedAt); // a held extra throw (reward) opens the window at once, each time
/** Rule 30: a player holding an extra throw (reward) may throw again at once, without waiting for the gap. */
export const hasExtra = (s: Pick<SnakesState, "pawns">, player: string): boolean => (s.pawns[player]?.extra ?? 0) > 0;
/** Rule 23: default game length, 10 minutes. */
export const DEFAULT_TIME_LIMIT_MS = 480_000;
/** Owner timing rule (31 Oct 2026): waiting room 120 s (fixed), then 7 or 8 minutes of play (Organizer chooses; default 8), about 10 minutes in all. */
export const WAITING_ROOM_MS = 120_000;
export const TIME_LIMIT_CHOICES_MIN = [7, 8] as const;
export const timeLimitMsFor = (minutes: unknown): number => (Number(minutes) === 7 ? 7 : 8) * 60_000;
/** Reaction pack id (core ui reactions) for what a throw did, or "" for none. */
export function reactionOf(r: { ladder: boolean; snake: boolean; special?: SpecialKind; finished?: boolean; roll?: number; lost?: boolean }): string {
  if (r.finished) return "finish"; if (r.snake) return "snake_bite"; if (r.ladder) return "ladder";
  if (r.special === "upgrade") return "upgrade"; if (r.special === "downgrade") return "downgrade"; if (r.special === "reward") return "extra_throw"; if (r.special === "punishment" || r.lost) return "missed_turn";
  return r.roll === 6 ? "six" : "";
}
/** Rule 22: "N ahead of you, M behind you" and how many are within 5 squares. */
export function standing(s: Pick<SnakesState, "pawns">, player: string): { ahead: number; behind: number; within: number } {
  const me = s.pawns[player]; if (!me) return { ahead: 0, behind: 0, within: 0 };
  let ahead = 0, behind = 0, within = 0;
  for (const [p, w] of Object.entries(s.pawns)) {
    if (p === player) continue;
    if (w.finishedTurn && !me.finishedTurn) ahead++; else if (me.finishedTurn && !w.finishedTurn) behind++; else if (w.at > me.at) ahead++; else if (w.at < me.at) behind++;
    if (Math.abs(w.at - me.at) <= 5) within++;
  }
  return { ahead, behind, within };
}
/** Rule 24. */
export const winnerOf = (s: Pick<SnakesState, "pawns" | "finishers"> & { out?: string[] }): string | undefined => finalRanking(s)[0];
export const setupFields: SetupField[] = [
  { key: "timeLimitMinutes", label: "Game length in minutes", kind: "choice", choices: ["7", "8"], default: "8", help: "The game ends when this time is up (7 or 8 minutes). Time does not run while paused." },
  { key: "turnLimit", label: "Most turns (safety stop)", kind: "number", default: 600, advanced: true },
  { key: "mode", label: "How throws happen", kind: "choice", choices: ["fate", "presence"], default: "fate" },
  { key: "milestones", label: "Milestone squares", kind: "text", default: "75", advanced: true },
  { key: "upgradeSquares", label: "Upgrade squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one jumps the pawn forward a few squares." },
  { key: "downgradeSquares", label: "Downgrade squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one steps the pawn back a few squares." },
  { key: "rewardSquares", label: "Reward squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one gives one extra throw." },
  { key: "punishmentSquares", label: "Punishment squares", kind: "number", default: 0, advanced: true, help: "0 = none. Landing on one loses the next throw." },
  { key: "specialN", label: "Squares for an upgrade or downgrade", kind: "number", default: 3, advanced: true },
  { key: "survivors", label: "Players who stay in after each round", kind: "number", default: 0, help: "0 = nobody is sent out. Otherwise the front runners stay in; the rest are out." },
  { key: "roundTurns", label: "Turns in a round", kind: "number", default: 10, advanced: true },
  { key: "pass", label: "Reach or pass finishes", kind: "toggle", default: false, advanced: true },
];
/** R25: on the same turn the higher square, then more ladders climbed, then fewer missed turns, then fate (lower wins). */
/** Final tie-break by player id, so a ranking never depends on the order players were listed. */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const raceOrder = (a: Pawn, b: Pawn): number => b.at - a.at || b.ladders - a.ladders || a.missed - b.missed || a.fate - b.fate;
export const snakesRules: RulesModule<SnakesState, SnakesEvent> = {
  manifest: MANIFESTS.snakes,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: (s) => ["1st", "2nd", "3rd", "4th", "5th", ...String(s.milestones ?? "75").split(",").filter(Boolean).map((m) => `milestone ${m}`)],
  lateJoin: MANIFESTS.snakes.lateJoin,
  init(setup, players) {
    const shared = setup.board as Board | undefined, boards = (shared ? Object.fromEntries(players.map((p) => [p, shared])) : (setup.boards ?? {})) as Record<string, Board>, fate = (setup.fate ?? {}) as Record<string, number>, pawns: Record<string, Pawn> = {};
    for (const p of players) { if (!boards[p]) throw new Error("every player needs a board"); pawns[p] = { at: 1, ladders: 0, missed: 0, fate: fate[p] ?? 0 }; }
    return { boards, pawns, turn: 0, turnLimit: Number(setup.turnLimit ?? 600), pass: !!setup.pass, presence: setup.mode === "presence", finishers: [], survivors: Math.max(0, Math.floor(Number(setup.survivors ?? 0))), roundTurns: Math.max(1, Math.floor(Number(setup.roundTurns ?? 10))), out: [],
      milestones: String(setup.milestones ?? "75").split(",").map(Number).filter(Boolean).slice(0, 3), milestoneWon: {}, over: false, timeLimitMs: timeLimitMsFor(setup.timeLimitMinutes), gameMs: 0, settledMs: 0 };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "turn" || clock.phase === "paused") return { state: s, out: [] };
    const pawns: Record<string, Pawn> = {}, out: Outcome[] = [], turn = e.only ? s.turn : s.turn + 1; // an extra throw (`only`) is one more throw by that player, not a new turn
    for (const [p, w] of Object.entries(s.pawns)) pawns[p] = { ...w };
    for (const p of Object.keys(pawns)) {
      const w = pawns[p]!;
      if (e.only && p !== e.only) continue;
      if (w.finishedTurn || s.out.includes(p)) continue; // R20; a player who is out no longer plays
      if (s.presence && !e.threw?.includes(p)) { w.missed++; continue; } // R21: not thrown in the window = miss the turn
      if (w.skip) { w.skip--; w.note = "You lose this throw"; continue; } // punishment: the throw is lost
      const roll = e.rolls[p]; if (!roll || roll < 1 || roll > 6) continue;
      if (w.extra) w.extra--; // an extra throw (reward) is used when taken
      const r = move(s.boards[p]!, w.at, roll, s.pass); w.at = r.to; if (r.ladder) w.ladders++;
      w.note = noteFor(r); if (r.special === "reward") w.extra = (w.extra ?? 0) + REWARD_THROWS; if (r.special === "punishment") w.skip = (w.skip ?? 0) + 1;
      if (w.at === s.boards[p]!.size) w.finishedTurn = turn;
    }
    // R24-R25: this turn's finishers take the next places in tie-break order
    const fin = Object.keys(pawns).filter((p) => pawns[p]!.finishedTurn === turn).sort((a, b) => (raceOrder(pawns[a]!, pawns[b]!) || byId(a, b)));
    const finishers = [...s.finishers, ...fin].slice(0, 5);
    fin.forEach((p, i) => { if (s.finishers.length + i < 5) out.push({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][s.finishers.length + i]! }); });
    // R23: the first on or past a milestone square at the end of a turn
    const milestoneWon = { ...s.milestoneWon };
    for (const m of s.milestones) if (!milestoneWon[m]) {
      const hit = Object.keys(pawns).filter((p) => pawns[p]!.at >= m).sort((a, b) => (raceOrder(pawns[a]!, pawns[b]!) || byId(a, b)))[0];
      if (hit) { milestoneWon[m] = hit; out.push({ kind: "win", player: hit, position: `milestone ${m}` }); }
    }
    // spec 410: at the end of a round the Organizer's number of survivors stay in (front runners by the race order, never tied); the rest are out
    let outList = s.out;
    if (s.survivors && !e.only && turn % s.roundTurns === 0) {
      const live = Object.keys(pawns).filter((p) => !pawns[p]!.finishedTurn && !outList.includes(p)).sort((a, b) => (raceOrder(pawns[a]!, pawns[b]!) || byId(a, b)));
      const gone = live.slice(s.survivors);
      for (const p of gone) out.push({ kind: "out", player: p, why: "behind the front runners" });
      if (gone.length) outList = [...outList, ...gone];
      out.push({ kind: "round", n: turn / s.roundTurns + 1, alive: live.length - gone.length });
    }
    const stillIn = Object.keys(pawns).filter((p) => !pawns[p]!.finishedTurn && !outList.includes(p)).length;
    const gameMs = Math.max(s.gameMs, e.gameMs ?? s.gameMs), over = finishers.length >= 5 || turn >= s.turnLimit || stillIn === 0 || gameMs >= s.timeLimitMs;
    return { state: { ...s, pawns, turn, finishers, milestoneWon, out: outList, over, gameMs, settledMs: gameMs }, out: [...out, ...(over ? [{ kind: "end" as const }] : [])] };
  },
};
/** R27, R30: a complete order, never tied. Finishers first (in finishing order), then everyone else by square and the tie chain. */
export const finalRanking = (s: Pick<SnakesState, "pawns" | "finishers"> & { out?: string[] }): string[] => {
  const rest = Object.keys(s.pawns).filter((p) => !s.finishers.includes(p)), byRace = (a: string, b: string) => raceOrder(s.pawns[a]!, s.pawns[b]!) || byId(a, b);
  // players who were sent out come after everybody still in
  return [...s.finishers, ...rest.filter((p) => !s.out?.includes(p)).sort(byRace), ...rest.filter((p) => s.out?.includes(p)).sort(byRace)];
};
