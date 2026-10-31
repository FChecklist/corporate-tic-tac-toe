// A page script that looks for an element the page does not have crashes (or silently does nothing). This happened to a sister site when its header was replaced:
// the landing script wanted ids the new header no longer had, and the price list stayed empty. For every rebuilt page, every id its scripts look for must exist
// in that page's HTML or be created by a script; the only ids allowed to be absent are the optional size pickers of the old buy block (v.js reads them only if present).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUB = join(import.meta.dir, "../public");
const PAGES = ["index", "how-it-works", "guide", "brochure", "refer", "thank-you", "game-completed"];
const OPTIONAL = new Set(["pack", "pack2"]); // v.js: `var p = doc.getElementById("pack"); ... p ? +p.value : 0` (guarded)
const read = (f: string) => readFileSync(join(PUB, f), "utf8");
const idsOf = (html: string) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
const madeBy = (js: string) => new Set([...[...js.matchAll(/id=\\?["']([A-Za-z0-9_-]+)/g)].map((m) => m[1]!), ...[...js.matchAll(/\.id\s*=\s*["']([A-Za-z0-9_-]+)/g)].map((m) => m[1]!)]);
const usedBy = (js: string) => new Set([...[...js.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((m) => m[1]!), ...[...js.matchAll(/querySelector\(["']#([A-Za-z0-9_-]+)["']\)/g)].map((m) => m[1]!)]);

describe("every id a page's scripts look for is in the page (or made by a script)", () => {
  for (const name of PAGES) test(name + ".html", () => {
    const html = read(name + ".html"), ids = idsOf(html), missing: string[] = [];
    const srcs = [...html.matchAll(/<script[^>]+\bsrc="\/?([^"?#]+)/g)].map((m) => m[1]!).filter((s) => !/^https?:/.test(s));
    expect(srcs.length).toBeGreaterThan(3);
    const made = new Set<string>(); for (const s of srcs) if (existsSync(join(PUB, s))) for (const i of madeBy(read(s))) made.add(i);
    for (const s of srcs) {
      expect(existsSync(join(PUB, s))).toBe(true); // a script the page loads must be shipped
      for (const u of usedBy(read(s))) if (!ids.has(u) && !made.has(u) && !OPTIONAL.has(u)) missing.push(`${s}: #${u}`);
    }
    expect(missing).toEqual([]);
  });
  test("the old landing ids that site.js needed are not looked for by any script of the rebuilt pages (site.js is not loaded there)", () => {
    for (const name of PAGES) { const html = read(name + ".html"); expect(html).not.toMatch(/src="\/?site\.js/); }
  });
  test("the pages that still load site.js have the ids it needs", () => {
    const html = read("pricing.html"), ids = idsOf(html), js = read("site.js"), made = madeBy(js), missing: string[] = [];
    if (/src="\/?site\.js/.test(html)) for (const u of usedBy(js)) if (!ids.has(u) && !made.has(u) && !OPTIONAL.has(u)) missing.push("#" + u);
    expect(missing).toEqual([]);
  });
});
