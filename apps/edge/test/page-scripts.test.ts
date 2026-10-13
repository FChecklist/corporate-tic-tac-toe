// A page that draws the Terms boxes must load termsbox.js before the script that uses it, and not deferred: a script that runs at once (for example a sign-in sheet opened by a "#login" address)
// finds no boxes otherwise and the person is left with a button that never turns on. Found by the Chrome simulation on the home page (the same fault as Snakes and Ladders S01-03).
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../web/public");
const scripts = (html: string) => [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)].map((m) => ({ src: m[2]!, attrs: (m[1]! + m[3]!).toLowerCase() }));

describe("pages that show the Terms boxes load termsbox.js first and at once", () => {
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
    const list = scripts(readFileSync(join(DIR, f), "utf8"));
    const at = list.findIndex((s) => s.src.includes("termsbox.js"));
    if (at < 0) continue;
    test(f, () => {
      expect(list[at]!.attrs).not.toMatch(/\bdefer\b|\basync\b/);
      const early = list.slice(0, at).filter((s) => !/\b(defer|async)\b/.test(s.attrs) && /\/(site|pay|paylink|signin|ai-link|zc|ttt)\.js$/.test(s.src));
      expect(early.map((s) => s.src)).toEqual([]); // none of the scripts that draw the boxes runs before termsbox.js
    });
  }
  test("every page whose script draws the boxes loads termsbox.js at all", () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
      const list = scripts(readFileSync(join(DIR, f), "utf8"));
      const uses = list.some((s) => /\/(site|pay|paylink|signin|ai-link|zc|ttt)\.js$/.test(s.src));
      if (uses) expect({ page: f, loadsTermsbox: list.some((s) => s.src.includes("termsbox.js")) }).toEqual({ page: f, loadsTermsbox: true });
    }
  });
});
