// Collision-free Bingo cards. Every card of an engagement round comes from a different position in one huge, shuffled list of valid cards,
// so two cards of the same game can never be the same. No server, no lookup: the position is the seat number the player received on joining,
// and the shuffle is keyed by the engagement, so every phone (and the organizer console) makes the same card for the same seat.
//
// The list: every valid 5 x 5 card. Each column holds an ORDERED choice of numbers from its own range of 15 (5 numbers for B, I, G and O,
// 4 for N because the centre is FREE): 15P5 x 15P5 x 15P4 x 15P5 x 15P5 = 360360^4 x 32760, about 5.5e26 cards.
//   position p  ->  q = a keyed permutation of [0, TOTAL)   (a Feistel network with cycle walking: a true permutation, no repeats)
//                   q  = mixed-radix code, one digit per column, each digit unranks one ordered choice.
// Different positions give different q, and different q give different cards, so different positions give different cards.
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { FREE_CELL, PER_COLUMN, SIZE, columnRange, type Ticket } from "../../shared/src/ticket";

/** Ordered choices of k numbers from 15: 15P5 = 360360 and 15P4 = 32760. */
const arrangements = (k: number): bigint => { let p = 1n; for (let i = 0; i < k; i++) p *= BigInt(PER_COLUMN - i); return p; };
const A5 = arrangements(5), A4 = arrangements(4);
/** Size of the whole list of cards. */
export const TOTAL: bigint = A5 ** 4n * A4;
export const spaceSize = (): bigint => TOTAL;
/** A column's digit base: 360360 for B, I, G, O and 32760 for N. */
const BASE = [A5, A5, A4, A5, A5] as const;
const COUNT = [5, 5, 4, 5, 5] as const;

/** The `rank`-th ordered choice of k numbers from lo..lo+14 (rank in [0, 15P k)). */
export function unrankArrangement(rank: bigint, k: number, lo: number): number[] {
  const pool = Array.from({ length: PER_COLUMN }, (_, i) => lo + i), out: number[] = [];
  let r = rank;
  for (let i = 0; i < k; i++) {
    const base = BigInt(PER_COLUMN - i), pick = Number(r % base);
    r /= base;
    out.push(pool.splice(pick, 1)[0]!);
  }
  return out;
}

// ---- a keyed shuffle of positions (Feistel network + cycle walking over the smallest even-bit domain that holds the list: for the card space, 2^90 > TOTAL) ----
const keyCache = new Map<string, Uint8Array>();
const keyOf = (eid: string) => { let k = keyCache.get(eid); if (!k) { if (keyCache.size > 64) keyCache.clear(); k = sha256(utf8ToBytes("card-space|" + eid)); keyCache.set(eid, k); } return k; };
function roundFn(right: bigint, r: number, key: Uint8Array, buf: Uint8Array, half: number): bigint {
  let v = Number(right); // below 2^45: exact in a double
  buf[key.length] = r;
  for (let i = 0; i < 6; i++) { buf[key.length + 1 + i] = v % 256; v = Math.floor(v / 256); }
  const h = sha256(buf);
  let f = 0;
  for (let i = 0; i < 6; i++) f = f * 256 + h[i]!;
  return BigInt(f % 2 ** half);
}
function feistel(x: bigint, half: number, key: Uint8Array): bigint {
  const hb = BigInt(half), mask = (1n << hb) - 1n;
  let left = x >> hb, right = x & mask;
  const buf = new Uint8Array(key.length + 7); buf.set(key);
  for (let r = 0; r < 6; r++) {
    const next = left ^ roundFn(right, r, key, buf, half);
    left = right; right = next;
  }
  return (left << hb) | right;
}
/** A keyed permutation of 0..n-1 (n at most 2^90): every input gives a different output, and the same key always gives the same shuffle. */
export function permute(i: number | bigint, n: bigint, key: Uint8Array): bigint {
  const x0 = BigInt(i);
  if (x0 < 0n || x0 >= n) throw new Error("position outside the list");
  let bits = 2; while ((1n << BigInt(bits)) < n) bits++; if (bits & 1) bits++;
  const half = bits / 2;
  if (half > 45) throw new Error("list too long");
  let x = x0;
  do x = feistel(x, half, key); while (x >= n);
  return x;
}

/** The card at `position` of the (shuffled) list of this engagement round. Positions 0..n-1 always give n different valid cards. */
export function ticketAt(engagementId: string, position: number): Ticket {
  let q = permute(position, TOTAL, keyOf(engagementId));
  const t: Ticket = Array.from({ length: SIZE }, () => Array<number | null>(SIZE).fill(null));
  for (let c = 0; c < SIZE; c++) {
    const digit = q % BASE[c]!; q /= BASE[c]!;
    const nums = unrankArrangement(digit, COUNT[c]!, columnRange(c)[0]);
    let i = 0;
    for (let r = 0; r < SIZE; r++) t[r]![c] = r * SIZE + c === FREE_CELL ? null : nums[i++]!;
  }
  return t;
}

/** A participant id made by the store carries its seat number: "<seat>x<hash>". Older ids (plain hash) have none. */
export const seatOfPid = (pid: string): number | null => { const m = /^(\d{1,7})x[0-9a-f]{8,}$/.exec(pid); const s = m ? Number(m[1]) : 0; return s >= 1 ? s : null; };
/** Seat s (1, 2, 3, ...) owns positions 2(s-1) (first card) and 2(s-1)+1 (second card). */
export const positionOf = (seat: number, which: 0 | 1) => 2 * (seat - 1) + which;
