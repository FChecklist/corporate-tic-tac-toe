import { describe, expect, test } from "bun:test";
import { beaconTieBreak, below, coin, pairRound, shuffled, starters, stream, timeoutCell } from "../src/random";

const seedA = "a".repeat(64), seedB = "b".repeat(64);

describe("deterministic randomness", () => {
  test("the same seed and label give the same numbers on every device; a different seed or label gives different ones", async () => {
    expect(await stream(seedA, "x", 5)).toEqual(await stream(seedA, "x", 5));
    expect(await stream(seedA, "x", 5)).not.toEqual(await stream(seedB, "x", 5));
    expect(await stream(seedA, "x", 5)).not.toEqual(await stream(seedA, "y", 5));
  });
  test("a coin is fair over many seeds", async () => {
    let heads = 0; for (let i = 0; i < 2000; i++) if (await coin(String(i), "c")) heads++;
    expect(heads).toBeGreaterThan(900); expect(heads).toBeLessThan(1100);
  });
  test("below(n) stays in range and covers every value", async () => {
    const seen = new Set<number>(); for (let i = 0; i < 300; i++) { const v = await below(String(i), "r", 7); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(7); seen.add(v); }
    expect(seen.size).toBe(7);
  });
  test("a shuffle keeps every item exactly once", async () => {
    const s = await shuffled(seedA, "s", Array.from({ length: 50 }, (_, i) => i)); expect([...s].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe("pairing", () => {
  test("every seat is paired exactly once, nobody plays themselves, and it is the same on every device", async () => {
    const seats = Array.from({ length: 1000 }, (_, i) => i + 1);
    const p = await pairRound(seedA, 1, seats); expect(p.bye).toBeNull();
    const all = p.pairs.flat(); expect(all.length).toBe(1000); expect(new Set(all).size).toBe(1000);
    for (const [a, b] of p.pairs) expect(a).not.toBe(b);
    expect(await pairRound(seedA, 1, seats)).toEqual(p);
    expect(await pairRound(seedB, 1, seats)).not.toEqual(p);
    expect(await pairRound(seedA, 2, seats)).not.toEqual(p);
  });
  test("an odd field gives one bye, and nobody gets a second bye while others have not had one", async () => {
    const seats = [1, 2, 3, 4, 5]; const had = new Set<number>();
    for (let r = 1; r <= 5; r++) { const p = await pairRound(seedA, r, seats, had); expect(p.bye).not.toBeNull(); expect(had.has(p.bye!)).toBe(false); had.add(p.bye!); expect(p.pairs.flat().length).toBe(4); }
    expect(had.size).toBe(5);
  });
  test("pairings do not depend on the order the seat list was given in", async () => {
    expect(await pairRound(seedA, 1, [5, 3, 1, 4, 2, 6])).toEqual(await pairRound(seedA, 1, [1, 2, 3, 4, 5, 6]));
  });
  test("over 200 rounds seat 1 meets every other seat of an 8-seat field", async () => {
    const met = new Set<number>(); for (let r = 0; r < 200; r++) { const p = await pairRound(seedA, r, [1, 2, 3, 4, 5, 6, 7, 8]); for (const [a, b] of p.pairs) { if (a === 1) met.add(b); if (b === 1) met.add(a); } }
    expect(met.size).toBe(7);
  });
});

describe("who has X", () => {
  test("board 2 swaps board 1; board 3 is its own draw", async () => {
    let same = 0;
    for (let i = 0; i < 400; i++) { const [x1, x2, x3] = await starters(String(i), 1, 3, 9); expect(x2).toBe(!x1); if (x3 === x1) same++; }
    expect(same).toBeGreaterThan(140); expect(same).toBeLessThan(260);
  });
  test("it is the same on both phones", async () => { expect(await starters(seedA, 2, 4, 7)).toEqual(await starters(seedA, 2, 4, 7)); });
  test("over many matches each player starts about half of all boards", async () => {
    let a = 0, total = 0; for (let i = 0; i < 600; i++) { const s = await starters(String(i), 1, 1, 2); a += s.filter(Boolean).length; total += 3; }
    expect(a / total).toBeGreaterThan(0.45); expect(a / total).toBeLessThan(0.55);
  });
});

describe("the move placed when time runs out", () => {
  test("a free cell, the same on both phones", async () => {
    const empt = [2, 5, 7]; const c = await timeoutCell(seedA, "m", 0, 4, empt); expect(empt).toContain(c); expect(await timeoutCell(seedA, "m", 0, 4, empt)).toBe(c);
  });
  test("the last tie-break is a deterministic coin", async () => { expect(await beaconTieBreak(seedA, "m")).toBe(await beaconTieBreak(seedA, "m")); });
});
