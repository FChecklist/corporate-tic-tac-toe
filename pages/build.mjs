// Copies the files the live product needs into public/ (the older server-driven pages are deliberately left out: they need a server).
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const SRC = join(import.meta.dir, "../apps/web/public"), OUT = join(import.meta.dir, "public");
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const FILES = ["index.html", "report.html", "report.js", "reportgen.js", "manifest.webmanifest", "zsw.js", "pwa.js", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "site.js", "theme.js", "rum.js", "v.js", "owner-visits.html", "owner-visits.js", "robots.txt", "sitemap.xml", "site.css", "gamesbar.js", "gamesbar.css", "common.js", "termsbox.js", "ttt.js", "tttgame.js", "ttt.css", "host.html", "host.js", "app.css", "fonts.css", "legal.html", "terms.html", "legal-position.html", "about.html", "contact.html", "pricing.html", "refund-policy.html", "dpa.html", "subprocessors.html", "partner-terms.html", "organizer-guide.html", "brochure.html", "partner.html", "partner.js", "partner.css", "404.html", "ai-link.html", "ai-link.js", "signin.html", "signin.js", "google.js", "z.html", "z.css", "demo.html", "demo.js", "trust.html", "llms.txt", "zc.html", "zc.js", "zc.css", "zgame.js", "control.js", "pay.html", "pay.js", "paytest.html", "paytest.js", "paylink.html", "paylink.js", "big.html", "big.js", "big.css"];
for (const f of FILES) { if (!existsSync(join(SRC, f))) throw new Error("missing " + f); cpSync(join(SRC, f), join(OUT, f)); }
for (const d of ["fonts", "img"]) cpSync(join(SRC, d), join(OUT, d), { recursive: true });
// security headers; styles allow inline because the pages set a few style attributes, scripts stay locked to our own files
const CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://cloudflareinsights.com https://api.drand.sh https://api2.drand.sh https://api3.drand.sh https://drand.cloudflare.com https://checkout.razorpay.com https://api.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com https://itservices-rajat-agarwal.pages.dev; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const PAYCSP = CSP.replace("script-src 'self' https://static.cloudflareinsights.com;", "script-src 'self' https://static.cloudflareinsights.com https://checkout.razorpay.com;"); // only the payment page loads Razorpay Checkout
const GAMECSP = CSP.replace(/ frame-src[^;]*;/, " frame-src https://www.youtube-nocookie.com;").replace("media-src 'self' blob:;", "media-src 'self' blob: https:;"); // the phone page may play a break video
const PLAINCSP = CSP.replace(/ frame-src[^;]*;/, "");
// "Continue with Google" (Google Identity Services): its script, frame, connection and style are allowed ONLY on the pages that show the button (signin, index, zc; the Host setup lives in zc)
const GOOGLECSP = PLAINCSP.replace("script-src 'self' https://static.cloudflareinsights.com;", "script-src 'self' https://static.cloudflareinsights.com https://accounts.google.com/gsi/client;").replace("style-src 'self' 'unsafe-inline';", "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style;").replace("connect-src 'self'", "connect-src 'self' https://accounts.google.com/gsi/").replace("frame-ancestors", "frame-src https://accounts.google.com/gsi/; frame-ancestors");
// Cloudflare Pages serves "/z.html" as "/z" (a 308), so every page needs a rule for BOTH spellings or the header silently never applies (found in the 2026-10-05 audit, G-07).
const hdr = (csp, extra = "") => `\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()${extra}\n`;
const NOINDEX = "\n  X-Robots-Tag: noindex";
const PAGES = [ // [clean path, csp, noindex]
  ["/pay", PAYCSP, true], ["/paytest", PAYCSP, true], ["/paylink", PAYCSP, true], ["/z", GAMECSP, true], ["/host", PLAINCSP, true], ["/demo", GAMECSP, true], ["/trust", PLAINCSP, false], ["/zc", GOOGLECSP, true], ["/big", PLAINCSP, true], ["/report", PLAINCSP, true], ["/signin", GOOGLECSP, true], ["/owner-visits", PLAINCSP, true], ["/ai-link", PLAINCSP, true],
  ["/partner", PLAINCSP, true], ["/legal", PLAINCSP, false], ["/terms", PLAINCSP, false], ["/legal-position", PLAINCSP, false], ["/about", PLAINCSP, false], ["/contact", PLAINCSP, false], ["/pricing", PLAINCSP, false], ["/refund-policy", PLAINCSP, false], ["/dpa", PLAINCSP, false], ["/subprocessors", PLAINCSP, false], ["/partner-terms", PLAINCSP, false], ["/organizer-guide", PLAINCSP, false], ["/brochure", PLAINCSP, false], ["/404", PLAINCSP, true], ["/index", GOOGLECSP, false],
];
let rules = "";
for (const [path, csp, noindex] of PAGES) { const h = hdr(csp, noindex ? NOINDEX : ""); rules += `${path}.html${h}${path}${h}`; }
rules += "/" + hdr(GOOGLECSP);
rules += "/*.js\n  Cache-Control: no-cache\n/img/*\n  Cache-Control: public, max-age=604800\n/*.css\n  Cache-Control: no-cache\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n";
writeFileSync(join(OUT, "_headers"), rules);
writeFileSync(join(OUT, "_routes.json"), JSON.stringify({ version: 1, include: ["/api/*", "/ai/*", "/j/*"], exclude: [] }));
console.log("pages/public ready");
