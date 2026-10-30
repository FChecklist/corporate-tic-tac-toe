// TEST AUTHOR 30 Oct 2026. The seven new public pages (docs/TEST_HANDOFF.md "Pages"): menu, logo, bar v3, canonical, share image, banned words, no style attributes / inline script,
// demo link, home page structured data and links, sitemap, robots, noindex headers (from a real pages/build.mjs run), guide script rule.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PACKS } from "../../../packages/shared/src/pricing";

const PUB = new URL("../public/", import.meta.url), ORIGIN = "https://tictactoe.corporatetambola.com";
const rd = (f: string) => readFileSync(new URL(f, PUB), "utf8");
const PAGES = ["index", "how-it-works", "guide", "brochure", "refer", "thank-you", "game-completed"];
const SIX = ["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"];
const menuOf = (h: string) => { const n = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(h); if (!n) return null; return [...n[1]!.replace(/<span class="ck-dots"[\s\S]*?<\/span>/, "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()); };
const outsideFooter = (h: string) => h.replace(/<footer[\s\S]*?<\/footer>/, "");

for (const p of PAGES) describe(`page ${p}.html`, () => {
  const h = rd(p + ".html");
  test("the header menu is the six items in this order", () => { expect(menuOf(h)).toEqual(SIX); });
  test("Free demo game goes to /zc?demo=1; the Log in item goes to /zc", () => {
    const nav = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1]!;
    expect(/<a href="\/zc\?demo=1"[^>]*>Free demo game<\/a>/.test(nav)).toBe(true); expect(/<a href="\/zc"[^>]*>Log in<\/a>/.test(nav)).toBe(true);
  });
  test("the logo uses symbol #i-ttt and the Corporate Games bar is version 3", () => { expect(h).toContain('<use href="#i-ttt"/>'); expect(h).toContain('src="/gamesbar.js?v=3"'); expect(h).not.toMatch(/gamesbar\.js\?v=[12]\b/); });
  test("canonical is the page's own address (.html; the home page is the bare site address) and the share image is og-card.png", () => {
    const want = p === "index" ? ORIGIN + "/" : `${ORIGIN}/${p}.html`;
    expect(/<link rel="canonical" href="([^"]+)"/.exec(h)![1]).toBe(want);
    expect(/property="og:image" content="([^"]+)"/.exec(h)![1]).toBe(ORIGIN + "/og-card.png"); expect(/property="og:url" content="([^"]+)"/.exec(h)![1]).toBe(want);
  });
  test("the word 'private' never appears (close group is the word), in any case", () => { expect(h.match(/private/gi)).toBeNull(); });
  test("no style attributes and no inline script (a script tag without src is allowed only for application/ld+json)", () => {
    expect(h.match(/\sstyle\s*=/gi)).toBeNull();
    const inline = [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]!) && !/application\/ld\+json/.test(m[1]!));
    expect(inline.map((m) => m[2]!.slice(0, 40))).toEqual([]);
    expect(h.match(/\son[a-z]+\s*=\s*["']/gi)).toBeNull(); // no inline handlers either
  });
  test("no Bingo or Tambola word outside the footer (the site's own address corporatetambola.com does not count)", () => {
    const body = outsideFooter(h).replace(/corporatetambola\.com/gi, "").replace(/Corporate Tambola/gi, "CT");
    expect([...body.matchAll(/bingo|tambola/gi)].map((m) => body.slice(Math.max(0, m.index! - 30), m.index! + 30))).toEqual([]);
  });
  test("it is a complete page: doctype, lang=en, a title, a description, the brand kit scripts and the version footer element", () => {
    expect(h.startsWith("<!doctype html>")).toBe(true); expect(h).toContain('<html lang="en"'); expect(/<title>[^<]{10,}<\/title>/.test(h)).toBe(true); expect(/<meta name="description" content="[^"]{30,}"/.test(h)).toBe(true);
    expect(h).toContain("/theme-init.js"); expect(h).toContain("/brandkit.js"); expect(h).toContain("/siteversion.js"); expect(h).toContain("data-version"); expect(h).toContain("Version 1.5.0");
  });
  test("it is indexable (index, follow) except thank-you and game-completed, which say noindex", () => {
    const r = /<meta name="robots" content="([^"]+)"/.exec(h)![1]!; expect(/noindex/.test(r)).toBe(p === "thank-you" || p === "game-completed");
  });
});

describe("home page content", () => {
  const h = rd("index.html");
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const j = JSON.parse(m[1]!); return Array.isArray(j) ? j : [j]; });
  test("structured data has the real prices: AggregateOffer from the cheapest to the dearest pack, in INR, with the real offer count", () => {
    const o = ld.find((x: any) => x["@type"] === "SoftwareApplication")!.offers;
    expect(o).toEqual({ "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: String(Math.min(...PACKS.map((x) => x[1]))), highPrice: String(Math.max(...PACKS.map((x) => x[1]))), offerCount: String(PACKS.length) });
  });
  test("structured data has Organization, WebSite and a FAQ whose questions each have a non-empty answer", () => {
    expect(ld.map((x: any) => x["@type"])).toEqual(expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]));
    const faq = ld.find((x: any) => x["@type"] === "FAQPage")!; expect(faq.mainEntity.length).toBeGreaterThanOrEqual(3);
    for (const q of faq.mainEntity) { expect(q.name.length).toBeGreaterThan(5); expect(q.acceptedAnswer.text.length).toBeGreaterThan(10); }
  });
  test("it carries the line 'Festive offer: 50% off'", () => { expect(h).toContain("Festive offer: 50% off"); });
  test("it links terms, privacy, dpa, organizer-guide and partner", () => { for (const l of ["/terms.html", "/privacy.html", "/dpa.html", "/organizer-guide.html", "/partner.html"]) expect([l, h.includes(`href="${l}"`)]).toEqual([l, true]); });
});

describe("sitemap and robots", () => {
  const sm = rd("sitemap.xml"), rb = rd("robots.txt");
  for (const p of ["how-it-works", "guide", "refer"]) test(`sitemap lists ${p}.html once with a 2026 last-modified date`, () => {
    expect(sm.split(`${ORIGIN}/${p}.html</loc>`).length - 1).toBe(1);
    expect(new RegExp(`${p}\\.html</loc><lastmod>2026-\\d\\d-\\d\\d</lastmod>`).test(sm)).toBe(true);
  });
  test("the sitemap does NOT list thank-you or game-completed (noindex pages)", () => { expect(sm).not.toContain("thank-you"); expect(sm).not.toContain("game-completed"); });
  test("robots: crawlers are allowed on the site, not on /api/, and are told where the sitemap is; none of the three new pages is disallowed", () => {
    expect(rb).toMatch(/User-agent: \*\s+Allow: \//); expect(rb).toContain("Disallow: /api/"); expect(rb).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    for (const p of ["how-it-works", "guide", "refer"]) expect([p, new RegExp(`Disallow: /${p}`).test(rb)]).toEqual([p, false]);
    for (const p of ["how-it-works", "guide", "refer"]) expect([p, rb.includes(`Allow: /${p}`)]).toEqual([p, true]);
  });
});

describe("headers from a real build (pages/build.mjs): thank-you and game-completed are noindex, the others are not", () => {
  let headers = "";
  beforeAll(() => {
    const r = spawnSync("bun", ["pages/build.mjs"], { cwd: new URL("../../../", import.meta.url).pathname, encoding: "utf8" });
    expect(r.status).toBe(0); headers = readFileSync(new URL("../../../pages/public/_headers", import.meta.url), "utf8");
  }, 60_000);
  const block = (path: string) => { const i = headers.split("\n").findIndex((l) => l === path); if (i < 0) return null; const out: string[] = []; for (let k = i + 1; k < headers.split("\n").length && /^\s/.test(headers.split("\n")[k]!); k++) out.push(headers.split("\n")[k]!.trim()); return out.join("\n"); };
  for (const p of PAGES) for (const path of [`/${p}.html`, `/${p}`]) test(`${path}: ${p === "thank-you" || p === "game-completed" ? "X-Robots-Tag has noindex" : "no noindex header"}`, () => {
    const b = block(path); expect(b).not.toBeNull(); const x = /X-Robots-Tag: (.*)/.exec(b!)?.[1] ?? "";
    expect(/noindex/.test(x)).toBe(p === "thank-you" || p === "game-completed"); expect(b).toContain("Content-Security-Policy:"); expect(b).toContain("X-Frame-Options: DENY");
  });
  test("the built site serves every new page and a version.json with a build time", () => {
    for (const p of PAGES) expect(existsSync(new URL(`../../../pages/public/${p}.html`, import.meta.url))).toBe(true);
    const v = JSON.parse(readFileSync(new URL("../../../pages/public/version.json", import.meta.url), "utf8")); expect(Number.isNaN(Date.parse(v.builtAt))).toBe(false);
  });
});

