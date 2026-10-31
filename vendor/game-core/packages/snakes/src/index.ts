// Snakes and Ladders rules module (rules taken from the live site, docs/RULES.md R1-R40; group race). See docs/SNAKES_RULES_BOOK.md.
// Boards (made from the game id, seat and the first public random value), the rolls (made from the public value of each turn) and fate numbers come in from the host site.
import { MANIFESTS } from "../../manifest/src";
import type { Outcome, RulesModule, SetupField } from "../../core/src";
export interface Board { size: number; snakes: Record<number, number>; ladders: Record<number, number> } // from -> to
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
  if (!reachable(b)) bad.push("nobody may be trapped");
  return [...new Set(bad)];
}
/** R10: from every square the last square can be reached (rolls 1-6, exact finish). */
function reachable(b: Board): boolean {
  const next = (s: number, r: number) => { const n = s + r; return n > b.size ? s : (b.snakes[n] ?? b.ladders[n] ?? n); };
  const can = new Set<number>([b.size]);
  for (let changed = true; changed;) { changed = false; for (let s = 1; s < b.size; s++) if (!can.has(s) && [1, 2, 3, 4, 5, 6].some((r) => can.has(next(s, r)))) { can.add(s); changed = true; } }
  return Array.from({ length: b.size }, (_, i) => i + 1).every((s) => can.has(s));
}
/** R16-R18, R19: the new square after a roll. Exact finish needed unless `pass` ("reach or pass"). Returns the square and whether a ladder/snake moved the pawn. */
export function move(b: Board, at: number, roll: number, pass = false): { to: number; ladder: boolean; snake: boolean } {
  let n = at + roll;
  if (n > b.size) { if (!pass) return { to: at, ladder: false, snake: false }; n = b.size; }
  if (b.ladders[n]) return { to: b.ladders[n]!, ladder: true, snake: false };
  if (b.snakes[n]) return { to: b.snakes[n]!, ladder: false, snake: true };
  return { to: n, ladder: false, snake: false };
}
export interface Pawn { at: number; ladders: number; missed: number; fate: number; finishedTurn?: number }
export interface SnakesState {
  boards: Record<string, Board>; pawns: Record<string, Pawn>; turn: number; turnLimit: number; pass: boolean; presence: boolean;
  finishers: string[]; survivors: number; roundTurns: number; out: string[]; milestones: number[]; milestoneWon: Record<number, string>; over: boolean;
}
export type SnakesEvent = { type: "turn"; rolls: Record<string, number>; threw?: string[] } | { type: "tick" };
export const setupFields: SetupField[] = [
  { key: "turnLimit", label: "Most turns", kind: "number", default: 60 },
  { key: "mode", label: "How throws happen", kind: "choice", choices: ["fate", "presence"], default: "fate" },
  { key: "milestones", label: "Milestone squares", kind: "text", default: "75", advanced: true },
  { key: "survivors", label: "Players who stay in after each round", kind: "number", default: 0, help: "0 = nobody is sent out. Otherwise the front runners stay in; the rest are out." },
  { key: "roundTurns", label: "Turns in a round", kind: "number", default: 10, advanced: true },
  { key: "pass", label: "Reach or pass finishes", kind: "toggle", default: false, advanced: true },
];
/** R25: on the same turn the higher square, then more ladders climbed, then fewer missed turns, then fate (lower wins). */
export const raceOrder = (a: Pawn, b: Pawn): number => b.at - a.at || b.ladders - a.ladders || a.missed - b.missed || a.fate - b.fate;
export const snakesRules: RulesModule<SnakesState, SnakesEvent> = {
  manifest: MANIFESTS.snakes,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: (s) => ["1st", "2nd", "3rd", "4th", "5th", ...String(s.milestones ?? "75").split(",").filter(Boolean).map((m) => `milestone ${m}`)],
  lateJoin: MANIFESTS.snakes.lateJoin,
  init(setup, players) {
    const boards = (setup.boards ?? {}) as Record<string, Board>, fate = (setup.fate ?? {}) as Record<string, number>, pawns: Record<string, Pawn> = {};
    for (const p of players) { if (!boards[p]) throw new Error("every player needs a board"); pawns[p] = { at: 1, ladders: 0, missed: 0, fate: fate[p] ?? 0 }; }
    return { boards, pawns, turn: 0, turnLimit: Number(setup.turnLimit ?? 60), pass: !!setup.pass, presence: setup.mode === "presence", finishers: [], survivors: Math.max(0, Math.floor(Number(setup.survivors ?? 0))), roundTurns: Math.max(1, Math.floor(Number(setup.roundTurns ?? 10))), out: [],
      milestones: String(setup.milestones ?? "75").split(",").map(Number).filter(Boolean).slice(0, 3), milestoneWon: {}, over: false };
  },
  step(s, e, _now, clock) {
    if (s.over || e.type !== "turn" || clock.phase === "paused") return { state: s, out: [] };
    const pawns: Record<string, Pawn> = {}, out: Outcome[] = [], turn = s.turn + 1;
    for (const [p, w] of Object.entries(s.pawns)) pawns[p] = { ...w };
    for (const p of Object.keys(pawns)) {
      const w = pawns[p]!;
      if (w.finishedTurn || s.out.includes(p)) continue; // R20; a player who is out no longer plays
      if (s.presence && !e.threw?.includes(p)) { w.missed++; continue; } // R21: not thrown in the window = miss the turn
      const roll = e.rolls[p]; if (!roll || roll < 1 || roll > 6) continue;
      const r = move(s.boards[p]!, w.at, roll, s.pass); w.at = r.to; if (r.ladder) w.ladders++;
      if (w.at === s.boards[p]!.size) w.finishedTurn = turn;
    }
    // R24-R25: this turn's finishers take the next places in tie-break order
    const fin = Object.keys(pawns).filter((p) => pawns[p]!.finishedTurn === turn).sort((a, b) => raceOrder(pawns[a]!, pawns[b]!));
    const finishers = [...s.finishers, ...fin].slice(0, 5);
    fin.forEach((p, i) => { if (s.finishers.length + i < 5) out.push({ kind: "win", player: p, position: ["1st", "2nd", "3rd", "4th", "5th"][s.finishers.length + i]! }); });
    // R23: the first on or past a milestone square at the end of a turn
    const milestoneWon = { ...s.milestoneWon };
    for (const m of s.milestones) if (!milestoneWon[m]) {
      const hit = Object.keys(pawns).filter((p) => pawns[p]!.at >= m).sort((a, b) => raceOrder(pawns[a]!, pawns[b]!))[0];
      if (hit) { milestoneWon[m] = hit; out.push({ kind: "win", player: hit, position: `milestone ${m}` }); }
    }
    // spec 410: at the end of a round the Organizer's number of survivors stay in (front runners by the race order, never tied); the rest are out
    let outList = s.out;
    if (s.survivors && turn % s.roundTurns === 0) {
      const live = Object.keys(pawns).filter((p) => !pawns[p]!.finishedTurn && !outList.includes(p)).sort((a, b) => raceOrder(pawns[a]!, pawns[b]!));
      const gone = live.slice(s.survivors);
      for (const p of gone) out.push({ kind: "out", player: p, why: "behind the front runners" });
      if (gone.length) outList = [...outList, ...gone];
      out.push({ kind: "round", n: turn / s.roundTurns + 1, alive: live.length - gone.length });
    }
    const stillIn = Object.keys(pawns).filter((p) => !pawns[p]!.finishedTurn && !outList.includes(p)).length;
    const over = finishers.length >= 5 || turn >= s.turnLimit || stillIn === 0;
    return { state: { ...s, pawns, turn, finishers, milestoneWon, out: outList, over }, out: [...out, ...(over ? [{ kind: "end" as const }] : [])] };
  },
};
/** R27, R30: a complete order, never tied. Finishers first (in finishing order), then everyone else by square and the tie chain. */
export const finalRanking = (s: Pick<SnakesState, "pawns" | "finishers"> & { out?: string[] }): string[] => {
  const rest = Object.keys(s.pawns).filter((p) => !s.finishers.includes(p)), byRace = (a: string, b: string) => raceOrder(s.pawns[a]!, s.pawns[b]!);
  // players who were sent out come after everybody still in
  return [...s.finishers, ...rest.filter((p) => !s.out?.includes(p)).sort(byRace), ...rest.filter((p) => s.out?.includes(p)).sort(byRace)];
};
