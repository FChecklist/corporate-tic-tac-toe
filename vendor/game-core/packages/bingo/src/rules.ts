// The Bingo rules module: plugs into the core (roles, participation, flow, pause, prizes, retention, wording come from there). See docs/BINGO_RULES_BOOK.md.
import { MANIFESTS } from "../../manifest/src";
import { gameNow, type Clock, type Outcome, type RulesModule, type SetupField } from "../../core/src";
import { HOUSES, HOUSE_IDS, MAX_NUMBER, isValidCard, type Card, type House } from "./card";
import { assignOrdinals, ordinalsOf, roundEid, seatCompletion, countedLog, type HouseCounts } from "./settle";
export const FIRST_CALL_DELAY_MS = 120_000;
export const GAPS = [6, 9, 12, 15];
export const setupFields: SetupField[] = [
  { key: "gapSeconds", label: "Seconds between numbers", kind: "choice", choices: GAPS.map(String), default: 9 },
  { key: "housesCount", label: "Prizes to win", kind: "text", default: "line:1,corners:1,x:1,blackout:1", help: "Line, Four Corners, X and Blackout are set for you." },
  { key: "mark", label: "Marking", kind: "choice", choices: ["auto", "tap"], default: "auto", advanced: true },
];
/** A new game starts with Line, Four Corners, X and Blackout, one prize line each (book rule 9). */
export const DEFAULT_HOUSES: HouseCounts = { line: 1, corners: 1, x: 1, blackout: 1 };
const housesOf = (setup: Record<string, unknown>): HouseCounts => (setup.housesCount as HouseCounts | undefined) ?? DEFAULT_HOUSES;
/** The prize lines of a game: one per house and ordinal, e.g. line#1, line#2. Each has exactly ONE winner (owner rule 12 Oct 2026). */
export const prizeLines = (houses: HouseCounts): string[] =>
  HOUSE_IDS.flatMap((h) => Array.from({ length: Math.min(houses[h] ?? 0, HOUSES[h].max) }, (_, i) => `${h}#${i + 1}`));
type Entrant = { id: string; key: string | number };
/** A claim is only a cross-check now: it never decides a prize (live Bingo settles from the public log). `fate` is accepted and ignored. */
export interface Claim { player: string; house: House; fate?: number }
export interface BingoState {
  /** The 75 numbers in call order, from the host site (its pickNumber); the core never makes it. */
  order: number[]; called: number; nextCallAt: number; gapMs: number;
  eid: string; round: number;
  /** Per house: the seats that complete it, by call index, kept only as far as the prize lines can reach. Worked out once at the start from the cards and the full order. */
  groups: Partial<Record<House, [number, Entrant[]][]>>;
  lines: string[]; won: Record<string, string>; over: boolean;
}
export type BingoEvent =
  | { type: "tick" }
  | { type: "claim"; player: string; house: House; fate?: number }
  | { type: "settle" };
export const bingoRules: RulesModule<BingoState, BingoEvent> = {
  manifest: MANIFESTS.bingo,
  setupFields,
  claimType: "player-presses",
  goldenButton: "Claim",
  prizePositions: (s) => prizeLines(housesOf(s)),
  lateJoin: MANIFESTS.bingo.lateJoin,
  init(setup, players, now) {
    const order = setup.order as number[];
    if (!Array.isArray(order) || order.length !== MAX_NUMBER || !order.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER) || new Set(order).size !== MAX_NUMBER) throw new Error("setup.order must be the 75 numbers, each once");
    const given = (setup.cards ?? {}) as Record<string, Card | Card[]>;
    const cardsOf = (p: string): Card[] => { const c = given[p]; return !c ? [] : Array.isArray(c[0]?.[0]) || c[0] === undefined ? (c as unknown as Card[]) : [c as Card]; };
    for (const p of players) { const cs = cardsOf(p); if (!cs.length || cs.length > 2 || !cs.every(isValidCard)) throw new Error("every player needs one or two valid cards"); }
    const houses = housesOf(setup), lines = prizeLines(houses);
    if (!lines.length) throw new Error("a game needs at least one prize line");
    const eid = roundEid(String(setup.eid ?? ""), Number(setup.round ?? 1));
    const keys = (setup.seats ?? {}) as Record<string, string | number>, from = (setup.countFrom ?? {}) as Record<string, number>, rounds = setup.callRounds as number[] | undefined;
    const by: Partial<Record<House, Map<number, Entrant[]>>> = {};
    for (const p of players) {
      const mine = countedLog(order, from[p], rounds), cs = cardsOf(p);
      for (const h of HOUSE_IDS) {
        if (!ordinalsOf(houses, h).length) continue;
        const i = seatCompletion(cs, h, mine);
        if (i < 0) continue;
        const g = (by[h] ??= new Map()), e = { id: p, key: keys[p] ?? p };
        const arr = g.get(i); if (arr) arr.push(e); else g.set(i, [e]);
      }
    }
    const groups: BingoState["groups"] = {};
    for (const h of HOUSE_IDS) {
      let need = ordinalsOf(houses, h).length; const kept: [number, Entrant[]][] = [];
      for (const [i, es] of [...(by[h]?.entries() ?? [])].sort((a, b) => a[0] - b[0])) { if (need <= 0) break; kept.push([i, es]); need -= es.length; }
      groups[h] = kept;
    }
    return { order, called: 0, nextCallAt: now + FIRST_CALL_DELAY_MS, gapMs: Number(setup.gapSeconds ?? 9) * 1000, eid, round: Number(setup.round ?? 1), groups, lines, won: {}, over: false };
  },
  step(s, e, now, clock: Clock) {
    if (s.over || clock.phase === "paused") return { state: s, out: [] }; // paused: nothing is called, nothing settles
    if (e.type === "claim") return { state: s, out: [] }; // the button is pressed on the phone; the prize does not wait for it
    if (e.type === "settle") return finish(settle(s), s.called >= MAX_NUMBER);
    if (gameNow(clock, now) < s.nextCallAt) return { state: s, out: [] };
    if (s.called >= MAX_NUMBER) return finish(settle(s), true);
    const next = settle({ ...s, called: s.called + 1, nextCallAt: s.nextCallAt + s.gapMs });
    return finish(next, next.state.called >= MAX_NUMBER);
  },
};
/** The game is over when every prize line has a winner, or when the 75th number is out and settled (`last`). */
function finish(r: { state: BingoState; out: Outcome[] }, last: boolean): { state: BingoState; out: Outcome[] } {
  const over = last || r.state.lines.every((l) => r.state.won[l]);
  return over && !r.state.over ? { state: { ...r.state, over }, out: [...r.out, { kind: "end" }] } : r;
}
/** Give the open prize lines to the seats that completed a house on a call already made: earliest call first, then fate. One winner per line, from the public data only. */
function settle(s: BingoState): { state: BingoState; out: Outcome[] } {
  const won = { ...s.won }, out: Outcome[] = [];
  for (const h of HOUSE_IDS) {
    const open = s.lines.filter((l) => l.startsWith(h + "#")).map((l) => Number(l.slice(h.length + 1)));
    const upto = (s.groups[h] ?? []).filter(([i]) => i < s.called);
    for (const w of assignOrdinals(s.eid, h, upto, open)) {
      const line = `${h}#${w.ordinal}`;
      if (!won[line]) { won[line] = w.player; out.push({ kind: "win", player: w.player, position: line }); }
    }
  }
  return { state: { ...s, won }, out };
}
