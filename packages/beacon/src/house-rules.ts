// What each prize house asks of ONE card, in one place, so the incremental engine, the whole-log settlement, the claim check and the phone page can never disagree.
//   A rule is a list of `sets` of numbers (the FREE square is already left out) and a count `need`: the house is complete when `need` of the sets are fully called.
//   Line = any one of 12 lines (need 1); Two Lines = any two of the same 12 (need 2); Four Corners = one set of 4; Stamp = any of four 2 x 2 corner blocks; and so on.
import { patternSets, type PatternId, type Ticket, PATTERN_RULES } from "../../shared/src/ticket";
import type { PatternKey } from "./config";

export type Rule = { sets: number[][]; need: number };

/** The rule of house `key` on card `t`. */
export function ruleOf(t: Ticket, key: PatternKey): Rule | null {
  const r = PATTERN_RULES[key as PatternId];
  return r ? { sets: patternSets(t, key as PatternId), need: r.need } : null;
}

/** Index in `log` at which the card completes `key`, or -1. A 0 in the log (a number hidden from a late joiner) matches nothing. */
export function ticketCompletion(t: Ticket, key: PatternKey, log: readonly number[]): number {
  const r = ruleOf(t, key);
  if (!r) return -1;
  const first = new Map<number, number>();
  for (let i = 0; i < log.length; i++) { const n = log[i]!; if (n > 0 && !first.has(n)) first.set(n, i); }
  const done: number[] = [];
  for (const set of r.sets) {
    let last = -1, ok = true;
    for (const n of set) { const i = first.get(n); if (i === undefined) { ok = false; break; } if (i > last) last = i; }
    if (ok) done.push(last);
  }
  if (done.length < r.need) return -1;
  return done.sort((a, b) => a - b)[r.need - 1]!;
}

/** How many more numbers this card needs for `key` after `called` (the smallest number of numbers that still completes the house). */
export function ticketStillNeeds(t: Ticket, key: PatternKey, called: ReadonlySet<number>): number {
  const r = ruleOf(t, key);
  if (!r) return 99;
  const left = r.sets.map((s) => s.filter((n) => !called.has(n)));
  if (r.need === 1) return Math.min(...left.map((l) => l.length));
  let best = 99; // two sets: the pair whose still-missing numbers (shared ones counted once) are fewest
  for (let a = 0; a < left.length; a++) for (let b = a + 1; b < left.length; b++) best = Math.min(best, new Set([...left[a]!, ...left[b]!]).size);
  return best;
}

/** The numbers to light up for a win: the set(s) that completed the house, as of the winning call `idx`. */
export function winningNumbers(t: Ticket, key: PatternKey, log: readonly number[], idx: number): number[] {
  const r = ruleOf(t, key);
  if (!r) return [];
  const upto = log.slice(0, idx + 1), first = new Map<number, number>();
  for (let i = 0; i < upto.length; i++) { const n = upto[i]!; if (n > 0 && !first.has(n)) first.set(n, i); }
  const done: { set: number[]; at: number }[] = [];
  for (const set of r.sets) {
    let at = -1, ok = true;
    for (const n of set) { const i = first.get(n); if (i === undefined) { ok = false; break; } if (i > at) at = i; }
    if (ok) done.push({ set, at });
  }
  done.sort((a, b) => a.at - b.at);
  const picked = done.slice(0, r.need);
  // every set that finished on the winning call also lights up when it ties with the last one picked
  if (picked.length) { const edge = picked[picked.length - 1]!.at; for (const d of done.slice(r.need)) if (d.at === edge) picked.push(d); }
  return [...new Set(picked.flatMap((d) => d.set))];
}
