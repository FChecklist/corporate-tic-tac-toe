// Writes apps/web/public/sitemap.xml: every public, indexable page with its last-modified date (the date of the last commit that touched the file, or today if it has uncommitted changes).
// Run: bun tools/make-sitemap.mjs   (commit the result). Pages that say noindex, and the app pages, are deliberately not listed (test/seo.test.ts checks this).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const ORIGIN = "https://tictactoe.corporatetambola.com";
export const PAGES = [["index.html", "/", "weekly", "1.0"], ["how-it-works.html", "/how-it-works.html", "monthly", "0.8"], ["partner.html", "/partner.html", "monthly", "0.7"], ["helpdesk.html", "/helpdesk.html", "monthly", "0.5"], ["legal.html", "/legal.html", "monthly", "0.3"], ["terms.html", "/terms.html", "monthly", "0.3"], ["legal-position.html", "/legal-position.html", "monthly", "0.3"], ["dpa.html", "/dpa.html", "monthly", "0.3"], ["subprocessors.html", "/subprocessors.html", "monthly", "0.3"], ["privacy.html", "/privacy.html", "monthly", "0.3"], ["partner-terms.html", "/partner-terms.html", "monthly", "0.3"], ["organizer-guide.html", "/organizer-guide.html", "monthly", "0.3"], ["pricing.html", "/pricing.html", "monthly", "0.8"], ["about.html", "/about.html", "monthly", "0.4"], ["contact.html", "/contact.html", "monthly", "0.4"], ["refund-policy.html", "/refund-policy.html", "monthly", "0.3"], ["trust.html", "/trust.html", "monthly", "0.5"], ["brochure.html", "/brochure.html", "monthly", "0.4"]];
const git = (...a) => { try { return execFileSync("git", a, { cwd: new URL("../", import.meta.url), encoding: "utf8" }).trim(); } catch { return ""; } };
const today = new Date().toISOString().slice(0, 10);
const lastmod = (f) => { const p = "apps/web/public/" + f; return git("status", "--porcelain", "--", p) ? today : git("log", "-1", "--format=%cs", "--", p) || today; };
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(([f, loc, cf, pr]) => `<url><loc>${ORIGIN}${loc}</loc><lastmod>${lastmod(f)}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`;
writeFileSync(new URL("../apps/web/public/sitemap.xml", import.meta.url), xml);
console.log("sitemap written,", PAGES.length, "pages");
