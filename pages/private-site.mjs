// Private game site (owner order 1 Nov 2026): home.corporatetambola.com is the one public face; this site is reached by link only and is never listed by a search engine.
// Applied to the BUILT folder only (the sources and their older public-SEO tests stay as they were). Four parts:
//   1. every shipped HTML page says <meta name="robots" content="noindex, nofollow"> (any older robots meta is replaced);
//   2. robots.txt disallows everything for everyone;
//   3. there is no sitemap.xml;
//   4. the _headers "/*" rule adds X-Robots-Tag (see PRIVATE_ROBOTS_HEADER, used by build.mjs).
// Links, join pages, payment return, e-mail links and API routes are not touched: noindex stops listing, not visiting.
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export const PRIVATE_ROBOTS_HEADER = "\n  X-Robots-Tag: noindex, nofollow, noai, noimageai";
export const PRIVATE_ROBOTS_TXT = "# Private product site: not listed in search. The public site is https://home.corporatetambola.com/\nUser-agent: *\nDisallow: /\n";
const META = '<meta name="robots" content="noindex, nofollow">';
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

export function hideFromSearch(outDir) {
  let n = 0;
  for (const f of walk(outDir).filter((x) => x.endsWith(".html"))) {
    const s = readFileSync(f, "utf8");
    let t = s.replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, "");
    if (!/<head\b[^>]*>/i.test(t)) continue;
    t = t.replace(/<head\b[^>]*>/i, (m) => m + META);
    if (t !== s) { writeFileSync(f, t); n++; }
  }
  writeFileSync(join(outDir, "robots.txt"), PRIVATE_ROBOTS_TXT);
  if (existsSync(join(outDir, "sitemap.xml"))) rmSync(join(outDir, "sitemap.xml"));
  return n;
}
