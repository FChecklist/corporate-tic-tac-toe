// Written from the owner's order (1 Nov 2026), not from the build code:
//   "The game sites are private; home.corporatetambola.com is the one public face. No search engine lists a game site; join links, organizer links,
//    payment return, e-mail links and report links keep working."
// Builds the site, then reads what would be uploaded.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const OUT = join(ROOT, "pages/public");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

describe("the game site is private (not listed by search engines) but still reachable by link", () => {
  test("build, then: noindex meta on every page, robots.txt disallows all, no sitemap, X-Robots-Tag header on every address", () => {
    const b = Bun.spawnSync(["bun", "run", join(ROOT, "pages/build.mjs")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(b.exitCode, new TextDecoder().decode(b.stderr)).toBe(0);
    const pages = walk(OUT).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(10);
    const bad = pages.filter((f) => { const h = readFileSync(f, "utf8"); const m = [...h.matchAll(/<meta\s+name=["']robots["'][^>]*>/gi)].map((x) => x[0]); return !(m.length === 1 && /noindex/.test(m[0]!)); }).map((f) => relative(OUT, f));
    expect(bad).toEqual([]);
    const robots = readFileSync(join(OUT, "robots.txt"), "utf8").replace(/\r/g, "");
    expect(robots).toMatch(/^User-agent: \*\nDisallow: \/$/m);
    expect(robots).not.toMatch(/^Allow:/m);
    expect(robots).not.toMatch(/^Sitemap:/mi);
    expect(existsSync(join(OUT, "sitemap.xml"))).toBe(false);
    const headers = readFileSync(join(OUT, "_headers"), "utf8").replace(/\r/g, "");
    expect(headers).toMatch(/\n\/\*\n[^\n/]*\n?\s+X-Robots-Tag: noindex, nofollow/);
    // a more specific rule that sets its own X-Robots-Tag replaces the "/*" one on Cloudflare Pages, so every X-Robots-Tag line must itself say noindex
    const xrt = headers.split("\n").filter((l) => /X-Robots-Tag:/.test(l)); expect(xrt.length).toBeGreaterThan(20); expect(xrt.filter((l) => !/noindex/.test(l))).toEqual([]);
    expect(headers.split("\n").filter((l) => l.startsWith("/")).length).toBeLessThanOrEqual(100);
  });

  test("hiding changes nothing a person uses: the join, organizer, payment, report and sign-in pages and the version stamp are still shipped", () => {
    for (const f of ["index.html", "zc.html", "signin.html", "pay.html", "version.json"]) expect(existsSync(join(OUT, f)), f).toBe(true);
  });
});
