// Owner decision 1 Nov 2026: a game is for at most 2,000 people. The server refuses 2,001 (param-config tests); here the console and the texts say the same.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const rd = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
describe("the 2,000 people limit in the console and its texts", () => {
  test("the number box stops at 2000 and the texts name 2,000, not 10,000", () => {
    expect(rd("zc.js")).toContain('min="1" max="2000" step="1"'); expect(rd("zc.js")).not.toContain('max="10000"');
    expect(rd("pay.js")).toContain("up to 2,000 participants"); expect(rd("pay.js")).not.toMatch(/more than 10,000/);
    expect(rd("guide.js")).toContain("at most 2,000 people"); expect(rd("guide.js")).not.toMatch(/Standard packs go up to 10,000|standard packs go up to 10,000/i);
  });
});
