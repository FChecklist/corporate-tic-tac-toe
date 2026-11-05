// Written from the release rule (3 Nov 2026), not from the build code:
//   "Every script and stylesheet a shipped page loads must be in the shipped folder."
// Why: the consent commits made pages load /consent.js while pages/build.mjs FILES had no "consent.js". The tests read the
// source tree (apps/web/public), which has the file, so they stayed green while the BUILT site answered 404 for it (and the
// pay page, which calls CBConsent.html, could not render). This test builds the site and reads what would be uploaded.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const OUT = join(ROOT, "pages/public");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

/** local file paths (no query, no hash) of every <script src> and every <link href> that names a file */
const localFiles = (html: string): string[] => {
  const urls: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) urls.push(m[1]!);
  for (const m of html.matchAll(/<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) if (/\.[a-z0-9]{2,12}(\?|#|$)/i.test(m[1]!)) urls.push(m[1]!);
  return urls.filter((u) => u.startsWith("/") && !u.startsWith("//")).map((u) => u.split("#")[0]!.split("?")[0]!);
};
/** the references in a built folder that point at a file the folder does not have */
const missing = (pages: { name: string; html: string }[], has: (p: string) => boolean): string[] =>
  pages.flatMap((p) => localFiles(p.html).filter((f) => !has(f)).map((f) => `${p.name}: ${f}`));

describe("every script and stylesheet a built page loads is in the built folder", () => {
  test("the checker itself catches a missing file (so a pass means something)", () => {
    const have = new Set(["/site.js", "/app.css"]);
    const pages = [{ name: "a.html", html: `<script src="/site.js?v=1"></script><link rel="stylesheet" href="/app.css"><script src="/consent.js?v=1"></script>` }];
    expect(missing(pages, (f) => have.has(f))).toEqual(["a.html: /consent.js"]);
    expect(missing([{ name: "b.html", html: `<link rel="canonical" href="/pricing"><script src="https://static.cloudflareinsights.com/beacon.min.js"></script><script src="/site.js#x"></script>` }], (f) => have.has(f))).toEqual([]);
    expect(missing([{ name: "c.html", html: `<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.ico?v=2">` }], (f) => have.has(f))).toEqual(["c.html: /manifest.webmanifest", "c.html: /favicon.ico"]);
  });

  test("build, then: no built page loads a script or stylesheet that is not in pages/public", () => {
    const b = Bun.spawnSync(["bun", "run", join(ROOT, "pages/build.mjs")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(b.exitCode, new TextDecoder().decode(b.stderr)).toBe(0);
    const files = walk(OUT).filter((f) => f.endsWith(".html"));
    expect(files.length).toBeGreaterThan(10);
    const pages = files.map((f) => ({ name: relative(OUT, f).replace(/\\/g, "/"), html: readFileSync(f, "utf8") }));
    expect(pages.reduce((n, p) => n + localFiles(p.html).length, 0)).toBeGreaterThan(50);
    expect(missing(pages, (f) => existsSync(join(OUT, f)))).toEqual([]);
  });

  test("the pay pages and the Refer & earn page get consent.js in the built folder", () => {
    // consent.js is what draws the one agreement line; these pages call it without a guard
    expect(existsSync(join(OUT, "consent.js"))).toBe(true);
    for (const page of ["pay.html", "paylink.html", "paytest.html"]) expect(readFileSync(join(OUT, page), "utf8")).toContain("/consent.js");
  });
});
