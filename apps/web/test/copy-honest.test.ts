// Gap plan 2026-10-29 (TT-15 and the wording items): the public copy must be true and must use the owner's wording. Reads the real page files, no browser.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUB = join(import.meta.dir, "../public");
const pages = readdirSync(PUB).filter((f) => f.endsWith(".html"));
const read = (f: string) => readFileSync(join(PUB, f), "utf8");
/** Visible text of a page: scripts, styles and tags removed, entities for the rupee sign and non-breaking space turned back. */
const textOf = (f: string) => read(f).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/** Fails with the few words around the hit, not the whole page. */
const no = (f: string, re: RegExp) => { const m = re.exec(textOf(f)); if (m) throw new Error(`${f} still says: "...${textOf(f).slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)}..."`); };

describe("TT-15: the 1,000-player claim says it was a computer rehearsal", () => {
  test("no page says 'tested with 1,000 players'; the home page says 'simulated' and that a live event of that size has not been run", () => {
    for (const f of pages) no(f, /tested with 1,?000 players/i);
    const t = textOf("index.html");
    expect(t).toMatch(/1,000 simulated players/); expect(t).toMatch(/live event of that size has not been run/i);
  });
});
