// The rule of this product, in every word a person can read: the PHONES apply the rules (board, turn order, clocks, bracket, ranking); the server ONLY STORES and RELAYS.
// This fails when a page, a mail, the AI manual or the trust text says the server checks, decides, validates, enforces or judges a game rule or a result.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const PUB = join(ROOT, "apps/web/public");
const text = (s: string) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);
// "the server checks/decides/..." or "our server decides/..." followed (in the same sentence) by something the game does
const BAD = /\b(?:our |the |a )?server (?:also |only )?(?:checks|verifies|validates|decides|enforces|rules on|referees|judges|works out|determines|computes|calculates|rejects|refuses)\b/i;
const GAMEY = /\b(move|board|turn|clock|result|winner|bracket|rank|ranking|score|rule|draw|place|champion)\b/i;
const USER_FACING: [string, string][] = [
  ...readdirSync(PUB).filter((f) => /\.(html|txt)$/.test(f)).map((f) => [f, text(readFileSync(join(PUB, f), "utf8"))] as [string, string]),
  ...["ai-facts.ts", "trust-page.ts", "ai-link.ts", "ai-functions.ts", "mails.ts", "report-layout.ts", "legal.ts"].map((f) => [f, readFileSync(join(ROOT, "apps/edge/src", f), "utf8")] as [string, string]),
];

describe("the server only stores and relays (words)", () => {
  test("no page, mail or manual says the server checks, decides or judges a move, a board, a clock, a result or a place", () => {
    const hits: string[] = [];
    for (const [f, t] of USER_FACING) for (const s of sentences(t)) if (BAD.test(s) && GAMEY.test(s)) hits.push(`${f}: ${s.slice(0, 160)}`);
    expect(hits).toEqual([]);
  });
  test("the trust page, the home page and the AI facts say it the right way round: the phones apply the rules and the server only stores and passes on the moves", () => {
    const stores = /server only stores and passes on the moves/i, rules = /same rules/i;
    for (const f of ["trust.html", "index.html"]) { const t = text(readFileSync(join(PUB, f), "utf8")); expect([f, stores.test(t), rules.test(t)]).toEqual([f, true, true]); }
    const facts = readFileSync(join(ROOT, "apps/edge/src/ai-facts.ts"), "utf8"); expect(stores.test(facts) && rules.test(facts)).toBe(true);
  });
});
