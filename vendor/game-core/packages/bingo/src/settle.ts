// Bingo settlement as the live Bingo site does it (beacon/game.ts settleAll): from the public call log and the seat list alone, with no claims.
// A phone that is offline still gets its prize, because the winners depend only on public data. One winner per prize line.
import { sha256Hex } from "../../core/src";
import { HOUSES, HOUSE_IDS, FREE_CELL, type Card, type House } from "./card";
export type HouseCounts = Partial<Record<House, number>>;
/** A seat: its id, its cards (one or two), the fate key (the seat number as the site issues it; the id if none) and, for a late joiner, the beacon round from which calls count. */
export interface Seat { id: string; cards: Card[]; seat?: string | number; countFrom?: number }
/** `idx` is the 0-based call at which the house was completed (live `idx`). `tied` is how many seats completed it on that same call. */
export interface Settled { house: House; ordinal: number; idx: number; player: string; round: number; tied?: number }
/** Round 1 keeps the game id; later rounds are `<id>~r<n>` (live roundEid). */
export const roundEid = (eid: string, round: number): string => (round <= 1 ? eid : `${eid}~r${round}`);
/** The fate number of a seat for one prize line, the same on every phone from public data. Lowest goes first. */
export const fateOf = (eid: string, seat: string | number, house: string, ordinal: number): string => sha256Hex(`CB1-TIE|${eid}|${seat}|tie|${house}|${ordinal}`);
/** Calls from the late joiner's countFrom round on count; earlier ones become 0 (a number no card has), so call indexes stay global. */
export const countedLog = (log: readonly number[], countFrom: number | undefined, callRounds?: readonly number[]): readonly number[] =>
  countFrom && countFrom > 0 && callRounds ? log.map((n, k) => ((callRounds[k] ?? Infinity) >= countFrom ? n : 0)) : log;
/** 0-based call at which this card first meets the house within `log`, or -1. Zeros in the log are ignored. */
export function cardCompletion(card: Card, house: House, log: readonly number[]): number {
  const flat = card.flat(), h = HOUSES[house], at = new Map<number, number>();
  log.forEach((n, k) => { if (n && !at.has(n)) at.set(n, k); });
  const when = (set: number[]): number => { let m = -1; for (const i of set) { if (i === FREE_CELL) continue; const k = flat[i] == null ? undefined : at.get(flat[i]!); if (k === undefined) return -1; if (k > m) m = k; } return m; };
  const done = h.sets.map(when).filter((k) => k >= 0).sort((a, b) => a - b);
  return done.length >= h.need ? Math.max(done[h.need - 1]!, 0) : -1;
}
/** Earliest completion over a seat's cards (several cards per seat: the best one counts). */
export function seatCompletion(cards: readonly Card[], house: House, log: readonly number[]): number {
  let best = -1;
  for (const c of cards) { const i = cardCompletion(c, house, log); if (i >= 0 && (best < 0 || i < best)) best = i; }
  return best;
}
/** The ordinals of a house's prize lines: 1..n, never above the house's maximum. */
export const ordinalsOf = (houses: HouseCounts, h: House): number[] => Array.from({ length: Math.min(houses[h] ?? 0, HOUSES[h].max) }, (_, i) => i + 1);
/**
 * Every prize line has exactly one winner. `groups` are the seats that completed the house, by call (earliest first). The 1st line goes to the earliest call;
 * seats that completed it on the same call are put in order by fate (lowest first) and take the next lines in turn, before any later call.
 */
export function assignOrdinals(eid: string, house: House, groups: readonly (readonly [number, readonly { id: string; key: string | number }[]])[], ordinals: readonly number[], round = 1): Settled[] {
  const out: Settled[] = [], ord = [...ordinals].sort((a, b) => a - b); let o = 0;
  for (const [idx, seats] of [...groups].sort((a, b) => a[0] - b[0])) {
    const left = [...seats];
    while (left.length && o < ord.length) {
      const k = ord[o]!, f = new Map(left.map((s) => [s.id, fateOf(eid, s.key, house, k)]));
      left.sort((a, b) => (f.get(a.id)! < f.get(b.id)! ? -1 : f.get(a.id)! > f.get(b.id)! ? 1 : a.id < b.id ? -1 : 1));
      out.push({ house, ordinal: k, idx, player: left.shift()!.id, round, ...(seats.length > 1 ? { tied: seats.length } : {}) }); o++;
    }
    if (o >= ord.length) break;
  }
  return out;
}
/** Who completed each house first, from the public log and the seats only. `log` holds the numbers called so far, in order. */
export function settleFromLog(eid: string, seats: readonly Seat[], log: readonly number[], houses: HouseCounts, round = 1, callRounds?: readonly number[]): Settled[] {
  const id = roundEid(eid, round), out: Settled[] = [];
  const by = new Map<House, Map<number, { id: string; key: string | number }[]>>(HOUSE_IDS.map((h) => [h, new Map()]));
  for (const s of seats) {
    const mine = countedLog(log, s.countFrom, callRounds);
    for (const h of HOUSE_IDS) {
      if (!ordinalsOf(houses, h).length) continue;
      const i = seatCompletion(s.cards, h, mine);
      if (i < 0) continue;
      const g = by.get(h)!, e = { id: s.id, key: s.seat ?? s.id };
      const arr = g.get(i); if (arr) arr.push(e); else g.set(i, [e]);
    }
  }
  for (const h of HOUSE_IDS) out.push(...assignOrdinals(id, h, [...by.get(h)!.entries()], ordinalsOf(houses, h), round));
  return out;
}
/** All rounds of an engagement: one call log per round (index 0 = round 1). */
export const settleRounds = (eid: string, seats: readonly Seat[], logs: readonly (readonly number[])[], houses: HouseCounts, callRounds?: readonly (readonly number[])[]): Settled[] =>
  logs.flatMap((log, r) => settleFromLog(eid, seats, log, houses, r + 1, callRounds?.[r]));
