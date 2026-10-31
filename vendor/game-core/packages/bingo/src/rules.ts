// The Bingo rules module: plugs into the core (roles, participation, flow, pause, prizes, retention, wording come from there). See docs/BINGO_RULES_BOOK.md.
import { MANIFESTS } from "../../manifest/src";
import { gameNow, type Clock, type Outcome, type RulesModule, type SetupField } from "../../core/src";
import { HOUSES, HOUSE_IDS, MAX_NUMBER, completedAt, isValidCard, meets, type Card, type House } from "./card";
export const FIRST_CALL_DELAY_MS = 120_000;
export const GAPS = [6, 9, 12, 15];
export const setupFields: SetupField[] = [
  { key: "gapSeconds", label: "Seconds between numbers", kind: "choice", choices: GAPS.map(String), default: 9 },
  { key: "housesCount", label: "Prizes to win", kind: "text", default: "line:1,corners:1,x:1,blackout:1", help: "Line, Four Corners, X and Blackout are set for you." },
  { key: "mark", label: "Marking", kind: "choice", choices: ["auto", "tap"], default: "auto", advanced: true },
];
export type HouseCounts = Partial<Record<House, number>>;
/** A new game starts with Line, Four Corners, X and Blackout, one prize line each (book rule 9). */
export const DEFAULT_HOUSES: HouseCounts = { line: 1, corners: 1, x: 1, blackout: 1 };
const housesOf = (setup: Record<string, unknown>): HouseCounts => (setup.housesCount as HouseCounts | undefined) ?? DEFAULT_HOUSES;
/** The prize lines of a game: one per house and ordinal, e.g. line#1, line#2. Each has exactly ONE winner (owner rule 12 Oct 2026). */
export const prizeLines = (houses: HouseCounts): string[] =>
  HOUSE_IDS.flatMap((h) => Array.from({ length: Math.min(houses[h] ?? 0, HOUSES[h].max) }, (_, i) => `${h}#${i + 1}`));
export interface Claim { player: string; house: House; fate: number }
export interface BingoState {
  /** The 75 numbers in call order. Derived by the host site from the game id and the public beacon (its pickNumber); the core never makes it. */
  order: number[]; called: number; nextCallAt: number; gapMs: number;
  cards: Record<string, Card>; lines: string[]; won: Record<string, string>; claims: Claim[]; over: boolean;
}
export type BingoEvent =
  | { type: "tick" }
  | { type: "claim"; player: string; house: House; fate: number } // fate: opaque number from the host site; the lower goes first on the same call
  | { type: "settle" };
/** Same house: an earlier call beats a later one; on the same call the lower fate number goes first. */
export const settleOrder = (a: { at: number; fate: number }, b: { at: number; fate: number }): number => a.at - b.at || a.fate - b.fate;
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
    const cards = (setup.cards ?? {}) as Record<string, Card>;
    for (const p of players) if (!cards[p] || !isValidCard(cards[p]!)) throw new Error("every player needs a valid card");
    const lines = prizeLines(housesOf(setup));
    if (!lines.length) throw new Error("a game needs at least one prize line");
    return { order, called: 0, nextCallAt: now + FIRST_CALL_DELAY_MS, gapMs: Number(setup.gapSeconds ?? 9) * 1000, cards, lines, won: {}, claims: [], over: false };
  },
  step(s, e, now, clock: Clock) {
    if (s.over || clock.phase === "paused") return { state: s, out: [] }; // paused: nothing is called, nothing settles
    if (e.type === "claim") {
      const card = s.cards[e.player];
      const called = new Set(s.order.slice(0, s.called));
      // a wrong or repeated claim changes nothing; the game continues
      if (!card || !meets(card, e.house, called) || s.claims.some((c) => c.player === e.player && c.house === e.house)) return { state: s, out: [] };
      return { state: { ...s, claims: [...s.claims, { player: e.player, house: e.house, fate: e.fate }] }, out: [] };
    }
    // after the 75th call the game stays open until a round is closed, so the last claims are still settled (rule 15)
    if (e.type === "settle") return finish(settle(s), s.called >= MAX_NUMBER);
    if (gameNow(clock, now) < s.nextCallAt) return { state: s, out: [] };
    if (s.called >= MAX_NUMBER) return finish(settle(s), true);
    // claims made before this call are settled first, then the next number is called
    const r = settle(s);
    const called = r.state.called + 1;
    return finish({ state: { ...r.state, called, nextCallAt: s.nextCallAt + s.gapMs }, out: r.out }, false);
  },
};
/** The game is over when every prize line has a winner, or when the last number is out and the last claims are settled (`last`). */
function finish(r: { state: BingoState; out: Outcome[] }, last: boolean): { state: BingoState; out: Outcome[] } {
  const over = last || r.state.lines.every((l) => r.state.won[l]);
  return over && !r.state.over ? { state: { ...r.state, over }, out: [...r.out, { kind: "end" }] } : r;
}
/** Give each house's open prize lines to its pending claims, earliest completion first, then fate. One person wins one line per house. */
function settle(s: BingoState): { state: BingoState; out: Outcome[] } {
  const won = { ...s.won }, out: Outcome[] = [], left: Claim[] = [];
  for (const h of HOUSE_IDS) {
    const open = s.lines.filter((l) => l.startsWith(h + "#") && !won[l]);
    const held = new Set(Object.entries(won).filter(([l]) => l.startsWith(h + "#")).map(([, p]) => p));
    const pend = s.claims.filter((c) => c.house === h && !held.has(c.player))
      .map((c) => ({ c, at: completedAt(s.cards[c.player]!, h, s.order) ?? 99, fate: c.fate })).sort(settleOrder);
    for (const { c } of pend) {
      const line = open.shift();
      if (!line) break;
      won[line] = c.player; out.push({ kind: "win", player: c.player, position: line });
    }
  }
  // a claim stays pending only while it has no prize line yet and lines remain
  for (const c of s.claims) if (!Object.entries(won).some(([l, p]) => p === c.player && l.startsWith(c.house + "#")) && s.lines.some((l) => l.startsWith(c.house + "#") && !won[l])) left.push(c);
  return { state: { ...s, won, claims: left }, out };
}
