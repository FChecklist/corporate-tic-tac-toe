// Owner rule 2026-10-28: the games are online and CLOSE GROUP. The word "private" is never used where a person reads it (site, console, e-mails, reports, legal pages).
// It is fine as a programming word (a TypeScript modifier) and in a code comment about a browser's "private mode"; this test looks at what a person could read.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(30_000);
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const GENERATED = new Set(["tttgame.js", "control.js", "zgame.js", "reportgen.js"]); // bundles built from the sources scanned below
const files = (dir: string, ext: RegExp) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((n) => ext.test(n) && !GENERATED.has(n)).map((n) => join(dir, n)) : []);
/** What a person could read: comments and the TypeScript modifier removed. */
const readable = (src: string, f: string) => {
  let t = src;
  if (/\.(js|ts|mjs)$/.test(f)) t = t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(,])\/\/[^\n]*/g, "$1").replace(/\bprivate\s+(readonly\s+|async\s+|static\s+)?[A-Za-z_$]/g, " ");
  else t = t.replace(/<!--[\s\S]*?-->/g, " ");
  return t;
};

describe("the word 'private' is not used in what people read", () => {
  test("pages, scripts, e-mail and report texts, the AI hand-over texts and the page generators", () => {
    const list = [...files("apps/web/public", /\.(html|js|txt|json|webmanifest)$/), ...files("apps/edge/src", /\.(ts|json)$/), ...files("packages/ttt/src", /\.ts$/), "tools/make-legal-pages.mjs"];
    expect(list.length).toBeGreaterThan(80);
    const hits: string[] = [];
    for (const f of list) {
      const t = readable(readFileSync(join(ROOT, f), "utf8"), f);
      for (const m of t.matchAll(/\bprivate\b/gi)) hits.push(`${f}: …${t.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, " ")}…`);
    }
    expect(hits).toEqual([]);
  });
});
