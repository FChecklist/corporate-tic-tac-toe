// Technical search-engine hygiene of the public pages (no promise about rankings): sitemap, robots, unique titles and descriptions, canonical, share tags, structured data that matches the real prices, image alt text, quick loading hints.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PACKS } from "../../../packages/shared/src/pricing";

const PUB = new URL("../public/", import.meta.url), ORIGIN = "https://tictactoe.corporatetambola.com";
const rd = (f: string) => readFileSync(new URL(f, PUB), "utf8");
const INDEXABLE = ["index.html", "how-it-works.html", "partner.html", "helpdesk.html", "legal.html", "terms.html", "legal-position.html", "dpa.html", "subprocessors.html", "privacy.html", "partner-terms.html", "organizer-guide.html", "trust.html", "brochure.html", "about.html", "contact.html", "pricing.html", "refund-policy.html"];
const NOINDEX = ["signin.html", "pay.html", "paytest.html", "ai-link.html", "helpdesk-accept.html", "helpdesk-approve.html", "report.html", "z.html", "zc.html", "big.html", "404.html", "owner-visits.html"];
const urlOf = (f: string) => ORIGIN + (f === "index.html" ? "/" : "/" + f);
const meta = (h: string, re: RegExp) => (h.match(re) ?? [])[1] ?? "";

describe("sitemap and robots", () => {
  const sm = rd("sitemap.xml"), locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  test("every indexable page is listed once, with a real last-modified date, and nothing else is", () => {
    expect(locs.sort()).toEqual(INDEXABLE.map(urlOf).sort());
    const entries = [...sm.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]);
    expect(entries.length).toBe(INDEXABLE.length);
    for (const e of entries) { expect(e).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/); const d = meta(e, /<lastmod>([^<]+)</); expect(Date.parse(d)).toBeGreaterThan(Date.parse("2026-09-01")); expect(Date.parse(d)).toBeLessThanOrEqual(Date.now() + 86_400_000); }
    expect(sm).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });
  test("robots.txt allows the site, keeps crawlers out of the API, app and payment pages, and points at the sitemap", () => {
    const r = rd("robots.txt");
    expect(r).toMatch(/User-agent: \*\s+Allow: \//); expect(r).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    for (const p of ["/api/", "/ai/", "/pay.html", "/signin.html", "/z.html", "/zc.html", "/big.html"]) expect(r).toContain("Disallow: " + p);
    for (const f of INDEXABLE) expect(r).not.toMatch(new RegExp("Disallow: /" + (f === "index.html" ? "$" : f.replace(".", "\."))));
  });
  test("a page that says noindex is never in the sitemap, and the owner page is not linked from any public page", () => {
    for (const f of NOINDEX) { let h = ""; try { h = rd(f); } catch { continue; } if (/name="robots" content="[^"]*noindex/.test(h)) expect(sm).not.toContain("/" + f); }
    expect(rd("owner-visits.html")).toMatch(/name="robots" content="noindex, nofollow"/);
    for (const f of [...INDEXABLE, "signin.html", "pay.html"]) expect(rd(f)).not.toContain("owner-visits");
    expect(readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8")).toContain('["/owner-visits", PLAINCSP, true]'); // served with X-Robots-Tag: noindex too
  });
});

describe("each indexable page", () => {
  const titles = new Map<string, string>(), descs = new Map<string, string>();
  for (const f of INDEXABLE) test(`${f}: unique title and description, canonical, Open Graph and Twitter tags`, () => {
    const h = rd(f), title = meta(h, /<title>([^<]+)<\/title>/), desc = meta(h, /<meta name="description" content="([^"]+)"/);
    expect(title.length).toBeGreaterThan(10); expect(title.length).toBeLessThanOrEqual(70);
    expect(desc.length).toBeGreaterThanOrEqual(50); expect(desc.length).toBeLessThanOrEqual(320);
    expect(titles.has(title)).toBe(false); titles.set(title, f); expect(descs.has(desc)).toBe(false); descs.set(desc, f);
    expect(h.match(/<link rel="canonical"/g)?.length).toBe(1); expect(meta(h, /<link rel="canonical" href="([^"]+)"/)).toBe(urlOf(f));
    expect(meta(h, /<meta property="og:url" content="([^"]+)"/)).toBe(urlOf(f)); expect(h).toMatch(/<meta property="og:title" content="[^"]+"/); expect(h).toMatch(/<meta property="og:description" content="[^"]+"/); expect(h).toMatch(/<meta property="og:image" content="https:\/\/tictactoe\.corporatetambola\.com\/[^"]+"/);
    expect(h).toContain('<meta name="twitter:card" content="summary_large_image">'); expect(h).toMatch(/<meta name="twitter:title" content="[^"]+"/);
    expect(h).not.toMatch(/name="robots" content="[^"]*noindex/); expect(h).toMatch(/<html lang="en"/); expect(h).toContain('name="viewport"');
    for (const tag of ['name="description"', 'rel="canonical"', 'property="og:title"', 'name="twitter:card"']) expect(h.split(tag).length).toBe(2); // each exactly once
  });
  test("the home page's structured data parses and its prices equal the real packs", () => {
    const h = rd("index.html"), raw = meta(h, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/), ld = JSON.parse(raw) as any[];
    expect(ld.map((x) => x["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]);
    const offer = ld[2].offers; expect(offer).toMatchObject({ "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: String(Math.min(...PACKS.map((p) => p[1]))), highPrice: String(Math.max(...PACKS.map((p) => p[1]))), offerCount: String(PACKS.length) });
    for (const x of ld) expect(x["@context"]).toBe("https://schema.org"); expect(ld[3].mainEntity.length).toBeGreaterThanOrEqual(5);
    for (const q of ld[3].mainEntity) { expect(q.name.length).toBeGreaterThan(5); expect(q.acceptedAnswer.text.length).toBeGreaterThan(20); }
  });
  test("every image has alt text and a size, and the picture at the top loads early", () => {
    for (const f of [...INDEXABLE, ...NOINDEX]) { let h = ""; try { h = rd(f); } catch { continue; } for (const img of h.match(/<img\b[^>]*>/g) ?? []) { expect([f, /\balt="[^"]+"/.test(img)]).toEqual([f, true]); expect([f, /\bwidth="\d+"/.test(img) && /\bheight="\d+"/.test(img)]).toEqual([f, true]); } }
    const og = readFileSync(new URL("og-card.png", PUB)); expect([og.readUInt32BE(16), og.readUInt32BE(20)]).toEqual([1200, 630]); // the share card of the brand kit
    for (const f of INDEXABLE) expect([f, rd(f).includes(`${ORIGIN}/og-card.png`)]).toEqual([f, true]);
  });
  test("quick loading: fonts are self-hosted and swap in, the two main fonts are preloaded, scripts do not block the page, nothing third-party is loaded on the home page", () => {
    const h = rd("index.html"), f = rd("fonts.css");
    expect(f.match(/font-display:\s*swap/g)!.length).toBe(f.match(/@font-face/g)!.length);
    for (const w of ["Inter-normal-400.woff2", "Fraunces-normal-500-700.woff2"]) expect(h).toContain(`<link rel="preload" href="/fonts/${w}" as="font" type="font/woff2" crossorigin>`);
    for (const s of h.match(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g) ?? []) if (!/theme-init\.js|keep\.js|common\.js|google\.js|termsbox\.js|site\.js/.test(s)) expect(s).toMatch(/\bdefer\b/); /* termsbox.js is NOT deferred: site.js draws the Terms boxes at once when the page is opened as /#login */ // theme-init.js must run first (no flash of the wrong colours); common.js and site.js are the last thing in the body
    expect(h).toMatch(/<script src="\/common\.js"><\/script><script src="\/google\.js"><\/script>(<script src="\/termsbox\.js"><\/script>)?<script src="\/site\.js"><\/script>\s*<\/body>/); // the page scripts sit at the very end
    expect(h).not.toMatch(/<(script|link|img|iframe|source|video|audio)\b[^>]*\b(src|href)="https?:\/\/(?!tictactoe\.corporatetambola\.com)/); // nothing is LOADED from elsewhere; the uniform footer only links to the sister sites
    expect(rd("../../../pages/build.mjs" as any).includes("max-age=31536000, immutable")).toBe(true);
  });
});
