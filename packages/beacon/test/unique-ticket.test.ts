import { describe, expect, test } from "bun:test";
import { isValidTicket, ticketKey, ticketNumbers, columnRange } from "../../shared/src/ticket";
import { TOTAL, permute, positionOf, seatOfPid, spaceSize, ticketAt, unrankArrangement } from "../src/unique-ticket";
import { ticketFor, ticketsFor } from "../src/game";
import { sha256 } from "@noble/hashes/sha256";

describe("collision-free cards (BG-01)", () => {
  test("the card space is about 5.5e26 cards: 15P5 x 15P5 x 15P4 x 15P5 x 15P5", () => {
    expect(spaceSize()).toBe(360360n ** 4n * 32760n);
    expect(Number(TOTAL)).toBeGreaterThan(5.5e26); expect(Number(TOTAL)).toBeLessThan(5.6e26);
  });
  test("the shuffle is a true permutation: a small list comes out as exactly the same set, no repeats", () => {
    const key = sha256(new TextEncoder().encode("k"));
    for (const n of [1000n, 4097n, 65536n]) { const seen = new Set<bigint>(); for (let i = 0n; i < n; i++) seen.add(permute(i, n, key)); expect(seen.size).toBe(Number(n)); expect([...seen].every((x) => x >= 0n && x < n)).toBe(true); }
  });
  test("an ordered choice of k numbers from a column's 15 is unique per rank and stays inside the range", () => {
    const seen = new Set<string>();
    for (let r = 0n; r < 3000n; r++) { const a = unrankArrangement(r * 97n, 5, 16); expect(new Set(a).size).toBe(5); for (const n of a) { expect(n).toBeGreaterThanOrEqual(16); expect(n).toBeLessThanOrEqual(30); } seen.add(a.join(",")); }
    expect(seen.size).toBe(3000);
  });
  test("every card is a valid bingo card: 24 distinct numbers in the right columns, FREE in the middle", () => {
    for (let i = 0; i < 3000; i++) { const t = ticketAt("ENG-1", i * 7919); expect(isValidTicket(t)).toBe(true); expect(ticketNumbers(t).length).toBe(24); expect(t[2]![2]).toBeNull(); }
  });
  test("30,000 consecutive seats of one round: all different", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30_000; i++) seen.add(ticketKey(ticketAt("BIG-1", i)));
    expect(seen.size).toBe(30_000);
  }, 120_000);
  test("the same seat gives the same card every time, a different round or engagement gives a different one", () => {
    expect(ticketKey(ticketAt("E1", 5))).toBe(ticketKey(ticketAt("E1", 5)));
    expect(ticketKey(ticketAt("E1", 5))).not.toBe(ticketKey(ticketAt("E2", 5)));
    expect(ticketKey(ticketAt("E1", 5))).not.toBe(ticketKey(ticketAt("E1~r2", 5)));
  });
  test("seat ids: ticketFor/ticketsFor use the list; two cards of one seat differ; old ids still use the plain generator", () => {
    expect(seatOfPid("17x0123456789abcdef")).toBe(17); expect(seatOfPid("0123456789abcdef")).toBeNull(); expect(seatOfPid("0x0123456789abcdef")).toBeNull();
    const a = ticketFor("E", "17x0123456789abcdef"); expect(ticketKey(a)).toBe(ticketKey(ticketAt("E", positionOf(17, 0))));
    const two = ticketsFor("E", "17x0123456789abcdef", 2); expect(two.length).toBe(2); expect(ticketKey(two[0]!)).toBe(ticketKey(a)); expect(ticketKey(two[1]!)).toBe(ticketKey(ticketAt("E", positionOf(17, 1))));
    expect(ticketKey(two[0]!)).not.toBe(ticketKey(two[1]!));
    const old = ticketFor("E", "0123456789abcdef"); expect(isValidTicket(old)).toBe(true); expect(ticketKey(old)).toBe(ticketKey(ticketFor("E", "0123456789abcdef")));
  });
  test("BG-01: a whole game of 10,000 players: 10,000 cards, none repeated; with two cards each, 20,000 cards, none repeated", () => {
    const one = new Set<string>(), two = new Set<string>();
    for (let s = 1; s <= 10_000; s++) { one.add(ticketKey(ticketsFor("GAME", `${s}x00000000deadbeef`, 1)[0]!)); for (const t of ticketsFor("GAME", `${s}x00000000deadbeef`, 2)) two.add(ticketKey(t)); }
    expect(one.size).toBe(10_000); expect(two.size).toBe(20_000);
  }, 180_000);
});

describe("numbers are spread evenly over the cards", () => {
  for (const eid of ["G04-r1", "SOME-OTHER", "PXA-2"]) {
    test(`${eid}: 6,000 cards: every number from 1 to 75 is on about 24 cards in 75 (within 15% of the expected count)`, () => {
      const N = 6000, cnt = new Array(76).fill(0);
      for (let i = 0; i < N; i++) { const t = ticketAt(eid, i); for (const row of t) for (const n of row) if (n !== null) cnt[n]++; }
      // a number in B, I, G or O is on 5 of 15 slots (1 card in 3); one in N is on 4 of 15
      const off = cnt.map((c, n) => [n, c] as const).filter(([n, c]) => { if (n < 1) return false; const col = Math.floor((n - 1) / 15), expected = (N * (col === 2 ? 4 : 5)) / 15; return Math.abs(c - expected) > expected * 0.15; });
      expect(off).toEqual([]);
    });
  }
  test("each column of the card uses its whole range, and a row position holds any number of its column", () => {
    const seen = new Set<number>(); const firstRow = new Set<number>();
    for (let i = 0; i < 3000; i++) { const t = ticketAt("RANGE", i); for (const row of t) for (const n of row) if (n !== null) seen.add(n); firstRow.add(t[0]![0]!); }
    for (let n = 1; n <= 75; n++) expect(seen.has(n)).toBe(true);
    const [lo, hi] = columnRange(0); expect(firstRow.size).toBe(hi - lo + 1);
  });
});
