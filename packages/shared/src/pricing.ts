/**
 * Packs are sold as "Up to N participants" (glossary). [participants, INR price the customer pays, USD price].
 * product decision 2026-10-09: the seller is not registered for GST, so NO GST is charged. The INR price is the old GST-inclusive price rounded to the nearest number ending in 99
 * (for example 1999 + 18% = 2358.82 -> 2399). GST_ON is the one switch: when the seller registers, set it to true and GST (18%) is added ON TOP of these prices (review the prices first).
 */
export const PACKS: ReadonlyArray<readonly [number, number, number]> = [
  [100, 2399, 34], [250, 3499, 51], [500, 4699, 67], [750, 5899, 84], [1000, 7099, 101], [2500, 11799, 169], [5000, 17699, 253], [10000, 29499, 421],
];
export const GST_ON = false;
export const GST = 0.18;
export type Currency = "INR" | "USD";
const r2 = (x: number) => Math.round(x * 100) / 100;

export function price(pack: number, currency: Currency): { total: number; base: number; tax: number } {
  const p = PACKS.find((x) => x[0] === pack);
  if (!p) throw new RangeError(`unknown pack ${pack}`);
  if (currency === "INR") {
    const tax = GST_ON ? r2(p[1] * GST) : 0;
    return { total: r2(p[1] + tax), base: p[1], tax };
  }
  return { total: p[2], base: p[2], tax: 0 };
}

/** Where brand breaks go by default: near-equal intervals over the 75 calls. */
export function proposeBreakPositions(count: number): number[] {
  if (count <= 0) return [];
  if (count > 3) throw new RangeError("at most 3 brand breaks");
  return ({ 1: [38], 2: [25, 50], 3: [19, 38, 56] } as Record<number, number[]>)[count]!;
}
