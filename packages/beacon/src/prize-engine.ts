// Every phone works out the winners itself. This is the incremental engine behind that: it holds one unit per card, is told each called number once,
// and knows at every moment which participants completed which house at which call. It gives exactly the answer `settleAll` gives from the whole log
// (a test proves it for every pattern), but a call costs a few thousand tiny updates instead of re-reading every card.
//
// How a house is counted: a house is a list of "sets" of squares and a count `need` (PATTERN_RULES in packages/shared/src/bingo-card.ts). Each card keeps, for every
// set, how many of its numbers are still missing (the FREE square never is); a set finishing raises the house's counter; the house is complete when the counter reaches `need`.
//
// Late joiners: a participant who joined after the game began counts only the numbers whose beacon round is at or after `countFrom`
// (their join round plus LATE_LAG_ROUNDS), so every phone has heard of them before their first number counts and nobody's result changes later.
import { PATTERN_RULES, cellOfNumber, ticketNumbers, FREE_CELL, type PatternId } from "../../shared/src/ticket";
import { LATE_LAG_ROUNDS, keysInPlay, linesFor, roundEid, type EngagementCfg, type PatternKey } from "./config";
import { assignOrdinals, ticketsFor, type Settled } from "./game";
import { NUMBERS } from "./index";

/** The first beacon round whose number counts for a seat that joined in round `jr` (0 or missing: joined in time, everything counts). */
export const countFromOf = (jr: number | null | undefined): number => (jr && jr > 0 ? jr + LATE_LAG_ROUNDS : 0);

export interface SeatIn { pid: string; countFrom: number }

export class PrizeEngine {
  /** The houses that have reward lines. */
  readonly keys: PatternKey[];
  private readonly eid: string;
  // The sets of every house in play, in one flat list: setKey[s] = the house a set belongs to; cellSets[cell] = the sets that contain that cell; setSize[s] = its numbers (FREE excluded).
  private readonly setKey: number[] = [];
  private readonly setSize: number[] = [];
  private readonly cellSets: number[][] = Array.from({ length: 25 }, () => []);
  private readonly need: number[];
  // one unit per card
  private unitPid: string[] = [];
  private unitCf: number[] = [];
  private unitCell: Int8Array[] = []; // number (1..75) -> cell, -1 when the card does not hold it
  private unitLeft0: Uint8Array[] = [];
  private unitLeft: Uint8Array[] = [];
  private unitDone0: Uint8Array[] = [];
  private unitDone: Uint8Array[] = [];
  private inv: number[][] = Array.from({ length: NUMBERS + 1 }, () => []);
  private callNum: number[] = [];
  private callBr: number[] = [];
  private donePid: Set<string>[];
  private byKey: Map<number, string[]>[];
  private known = new Set<string>();
  private queue: SeatIn[] = [];

  constructor(engagementId: string, readonly cfg: EngagementCfg, readonly round = 1) {
    this.eid = roundEid(engagementId, round);
    this.keys = keysInPlay(cfg.rewards);
    this.need = this.keys.map((k) => PATTERN_RULES[k as PatternId].need);
    this.keys.forEach((k, h) => {
      for (const cells of PATTERN_RULES[k as PatternId].sets) {
        const s = this.setKey.length;
        this.setKey.push(h);
        this.setSize.push(cells.filter((c) => c !== FREE_CELL).length);
        for (const c of cells) if (c !== FREE_CELL) this.cellSets[c]!.push(s);
      }
    });
    this.donePid = this.keys.map(() => new Set());
    this.byKey = this.keys.map(() => new Map());
  }

  get seatCount() { return this.known.size; }
  get pending() { return this.queue.length; }
  get calls() { return this.callNum.length; }

  /** Queues seats not seen before. Their cards are made later, in small slices (`work`), so a big list never freezes the screen. */
  addSeats(seats: readonly SeatIn[]) { for (const s of seats) if (!this.known.has(s.pid)) { this.known.add(s.pid); this.queue.push(s); } }

  /** Makes cards for queued seats until `budgetMs` has passed. Returns true when nothing is left to do. */
  work(budgetMs: number, now: () => number = () => performance.now()): boolean {
    const t0 = now();
    while (this.queue.length) {
      const s = this.queue.shift()!;
      this.build(s);
      if (now() - t0 >= budgetMs) break;
    }
    return this.queue.length === 0;
  }

  private build(s: SeatIn) {
    const cards = ticketsFor(this.eid, s.pid, this.cfg.tickets);
    const first = this.unitPid.length;
    for (const t of cards) {
      const cell = new Int8Array(NUMBERS + 1).fill(-1);
      for (const n of ticketNumbers(t)) cell[n] = cellOfNumber(t, n);
      const left = Uint8Array.from(this.setSize);
      const u = this.unitPid.length;
      this.unitPid.push(s.pid); this.unitCf.push(s.countFrom); this.unitCell.push(cell); this.unitLeft0.push(left); this.unitLeft.push(left.slice());
      const done = new Uint8Array(this.keys.length);
      this.unitDone0.push(done); this.unitDone.push(done.slice());
      for (let n = 1; n <= NUMBERS; n++) if (cell[n]! >= 0) this.inv[n]!.push(u);
    }
    // numbers already called that count for this seat.
    // CALL BY CALL (oldest first) across all of this seat's cards, exactly as if the seat had been here from the start: "their other card got there first" in `apply` must be decided by call order.
    // Going card by card instead made a two-card seat whose SECOND card completed a house earlier keep the FIRST card's later completion, so a phone that built its cards late (every late
    // joiner) saw a different tie than every other phone.
    for (let j = 0; j < this.callNum.length; j++) for (let u = first; u < this.unitPid.length; u++) this.apply(u, j, this.callNum[j]!, this.callBr[j]!);
  }

  private apply(u: number, j: number, n: number, br: number) {
    if (br < this.unitCf[u]!) return; // joined late: this number was called before it counted for them
    const c = this.unitCell[u]![n]!;
    if (c < 0) return;
    const left = this.unitLeft[u]!, done = this.unitDone[u]!;
    for (const s of this.cellSets[c]!) {
      if (--left[s]! !== 0) continue; // this set is not complete yet
      const h = this.setKey[s]!;
      if (++done[h]! !== this.need[h]!) continue; // the house needs more sets (Two Lines)
      const pid = this.unitPid[u]!;
      if (this.donePid[h]!.has(pid)) continue; // their other card got there first
      this.donePid[h]!.add(pid);
      const g = this.byKey[h]!.get(j); if (g) g.push(pid); else this.byKey[h]!.set(j, [pid]);
    }
  }

  /** Tells the engine the next called number (in call order) and the beacon round it was called in. */
  feed(number: number, beaconRound: number) {
    const j = this.callNum.length;
    this.callNum.push(number); this.callBr.push(beaconRound);
    if (number < 1 || number > NUMBERS) return;
    for (const u of this.inv[number]!) this.apply(u, j, number, beaconRound);
  }

  /** Forgets the calls (the schedule moved, for example after a pause message) but keeps the cards: feed the calls again. */
  resetCalls() {
    this.callNum = []; this.callBr = [];
    this.unitLeft = this.unitLeft0.map((l) => l.slice());
    this.unitDone = this.unitDone0.map((l) => l.slice());
    this.donePid = this.keys.map(() => new Set());
    this.byKey = this.keys.map(() => new Map());
  }

  /** One reward line per ordinal: the 1st goes to whoever completed the house at the earliest call (ties share), the 2nd to the next distinct call, and so on. */
  results(): Settled[] {
    const out: Settled[] = [];
    this.keys.forEach((k, h) => {
      out.push(...assignOrdinals(this.eid, k, [...this.byKey[h]!.entries()], linesFor(this.cfg.rewards, k).map((l) => l.ordinal), this.round));
    });
    return out;
  }
}
