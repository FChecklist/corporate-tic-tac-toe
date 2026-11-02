// Puts the Corporate Games look on every public page: the head (kit stylesheets, icons, manifest, share tags), the games bar, the six-item header and the footer.
// The page text between <main ...> and </main> is never touched. Safe to run again: it rebuilds the same chrome from the same parts.
// Run: node tools/make-site-chrome.mjs        (writes apps/web/public/*.html; commit the result)
//      node tools/make-site-chrome.mjs --check (changes nothing; exits 1 if a page is not up to date)
// The kit files themselves (tokens.css, components.css, fonts.css, brandkit.js, theme-init.js, console.css, gamesbar.*) are copies from docs/boss/brand-kit and docs/boss/games-bar: never edited here.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PUB = new URL("../apps/web/public/", import.meta.url);
const SITE = "https://tictactoe.corporatetambola.com";
export const NAME = "Corporate Tic Tac Toe";
export const V = { kit: 1, site: 1, icons: 3, bar: 2 }; // ?v= numbers: raise one whenever its files change (Cloudflare keeps files for hours)
export const MENU = [["How it works", "/how-it-works.html", ""], ["Free demo game", "/zc.html?demo=1", "demo"], ["Guide", "/organizer-guide.html", ""], ["Brochure", "/brochure.html", ""], ["Refer &amp; earn", "/partner.html", ""], ["Log in", "/zc.html", "login"]];

/** The one badge this site uses (the symbol `i-ttt` of the brand kit sprite, byte for byte). */
export const SPRITE = '<svg class="ck-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>\n<symbol id="i-ttt" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#17784A"/><g stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" fill="none"><path d="M24.5 9v46M39.5 9v46M9 24.5h46M9 39.5h46"/></g><path d="M11 11L21 21M21 11L11 21" stroke="#FF8A7A" stroke-width="3.6" stroke-linecap="round"/><circle cx="47" cy="16" r="5.4" fill="none" stroke="#FFD43B" stroke-width="3.4"/><path d="M27 27L37 37M37 27L27 37" stroke="#FF8A7A" stroke-width="3.6" stroke-linecap="round"/><circle cx="16" cy="47" r="5.4" fill="none" stroke="#FFD43B" stroke-width="3.4"/><circle cx="32" cy="47" r="5.4" fill="none" stroke="#FFD43B" stroke-width="3.4"/><path d="M43 43L53 53M53 43L43 53" stroke="#FF8A7A" stroke-width="3.6" stroke-linecap="round"/><path d="M11 11L53 53" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 4"/></symbol>\n</defs></svg>';

export const header = (o = {}) => `<a class="ck-skip" href="#${o.skip ?? "main"}">Skip to the content</a>
<header class="ck-top"><div class="ck-top-in">
<a class="ck-brand" href="/" aria-label="${NAME}, home"><svg class="ck-badge" aria-hidden="true" focusable="false"><use href="#i-ttt"/></svg><span class="ck-name"><i>Corporate</i><b>Tic Tac Toe</b></span></a>
<button class="ck-menu" type="button" id="ck-menu" aria-expanded="false" aria-controls="ck-nav">Menu</button>
<nav class="ck-nav" id="ck-nav" aria-label="Main">${MENU.map(([t, h, c]) => `<a href="${h}"${c ? ` class="${c}"` : ""}${c === "login" && o.loginId ? ` id="${o.loginId}"` : ""}${o.current === h ? ' aria-current="page"' : ""}>${t}</a>`).join("")}<span class="ck-dots" role="group" aria-label="Colour theme"><button type="button" data-t="blue" aria-pressed="true" aria-label="Studio blue theme" title="Studio blue"></button><button type="button" data-t="maroon" aria-pressed="false" aria-label="Maroon theme" title="Maroon"></button><button type="button" data-t="emerald" aria-pressed="false" aria-label="Emerald theme" title="Emerald"></button></span></nav>
</div></header>`;

export const footer = () => `<footer class="ck-foot"><div class="ck-wrap"><div class="ck-foot-grid">
<div><p class="ck-brandline">${NAME}</p><p>Online games for company events, for the people you invite.</p><p>A product of IT Services by Rajat Agarwal.</p><p><a href="mailto:hello@corporatetambola.com?subject=%5BTic%20Tac%20Toe%5D%20">hello@corporatetambola.com</a><br><a href="tel:+919650397480">(+91) 96503 97480</a></p><p><button class="ck-mode" type="button" data-ck-mode>Dark</button></p></div>
<div><h2>The games</h2><ul><li><a href="https://housie.corporatetambola.com/">Tambola</a></li><li><a href="https://bingo.corporatetambola.com/">Bingo</a></li><li><a href="https://tictactoe.corporatetambola.com/">Tic Tac Toe</a></li><li><a href="https://snakes.corporatetambola.com/">Snakes and Ladders</a></li><li><a href="https://luck.corporatetambola.com/">Luck by Chance</a></li><li><a href="https://home.corporatetambola.com/contact">Lucky Draw: tell us you want it</a></li></ul></div>
<div><h2>This site</h2><ul>${MENU.map(([t, h]) => `<li><a href="${h}">${t}</a></li>`).join("")}<li><a href="/pricing.html">Pricing</a></li></ul></div>
<div><h2>Legal and help</h2><ul><li><a href="/terms.html">Terms</a></li><li><a href="/privacy.html">Privacy notice</a></li><li><a href="/subprocessors.html">Sub-processors</a></li><li><a href="/dpa.html">Data processing terms</a></li><li><a href="/refund-policy.html">Refund policy</a></li><li><a href="/legal.html">Rules and disclaimer</a></li><li><a href="/about.html">About</a></li><li><a href="/contact.html">Contact</a></li></ul></div>
</div>
<div class="ck-legal"><p><a href="https://itservices-rajat-agarwal.pages.dev" target="_blank" rel="noopener">IT Services by Rajat Agarwal</a> is the trade name of Rajat Agarwal, an individual running a sole proprietorship in India. B-1105, Shipra Krishna Vista, Indirapuram, Ghaziabad, Uttar Pradesh, 201014, India. GST is not charged.</p><p>All payments are taken only by IT Services by Rajat Agarwal, through Razorpay.</p><p>&copy; 2026 Rajat Agarwal. All rights reserved.</p></div>
</div></footer>`;

const css = (f, v) => `<link rel="stylesheet" href="/${f}?v=${v}">`;
/** Everything in <head> that is the same on every page. `console` adds console.css. */
export const headAssets = (o = {}) => `<meta name="theme-color" content="#0B3D91">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" href="/favicon-32.png?v=${V.icons}" type="image/png" sizes="32x32"><link rel="icon" href="/icon-192.png?v=${V.icons}" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${V.icons}"><link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/Inter-normal-400.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Fraunces-normal-500-700.woff2" as="font" type="font/woff2" crossorigin>
${css("fonts.css", V.kit)}${o.legacyFirst ? o.legacyFirst.map((f) => css(f, V.site)).join("") : ""}${css("tokens.css", V.kit)}${css("components.css", V.kit)}${o.console ? css("console.css", V.kit) : ""}${(o.css ?? []).map((f) => css(f, V.site)).join("")}
<script src="/theme-init.js?v=${V.kit}"></script>${o.light ? "<script src=\"/console-light.js\"></script>" : ""}`;

const read = (f) => readFileSync(new URL(f, PUB), "utf8");
/** The small icons that site.js, common.js and partner.js draw with <use href="#i-...">. Only pages that run those scripts carry it. */
const ICONS = () => readFileSync(new URL("./site-parts/icons.html", import.meta.url), "utf8").trim();
const meta = (h, re) => (h.match(re) ?? [])[1] ?? "";

/** The scripts a page loads in <head> that are not chrome (kept as they are). */
const KEEP_HEAD_SCRIPTS = ["guide.js", "blackbox.js", "rum.js", "v.js", "pwa.js", "autoupdate.js", "keep.js", "google.js"];
const headScripts = (h) => (h.match(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/g) ?? []).filter((s) => KEEP_HEAD_SCRIPTS.some((k) => s.includes(`/${k}`)));

/**
 * Rebuilds a page: new <head>, chrome around the existing <main>. `cfg`: { file, current, css, scripts (end of body), loginId, console, noindex, bodyClass, jsonld }.
 * The description, canonical, share tags and structured data already in the page are kept (the SEO generators own them).
 */
export function build(file, cfg = {}, src) {
  const old = src ?? read(file);
  const head = old.slice(0, old.indexOf("</head>"));
  const title = meta(head, /<title>([^<]*)<\/title>/);
  const seo = [...head.matchAll(/[ \t]*(<meta name="description"[^>]*>|<link rel="canonical"[^>]*>|<meta name="robots"[^>]*>|<meta name="referrer"[^>]*>|<meta property="og:[^>]*>|<meta name="twitter:[^>]*>|<script type="application\/ld\+json">[\s\S]*?<\/script>)\r?\n?/g)].map((m) => m[1]);
  const shareImg = (t) => t.replace(/(content=")https:\/\/tictactoe\.corporatetambola\.com\/(?:logo-1024\.png|img\/card\.png)(")/g, `$1${SITE}/og-card.png$2`);
  const tags = seo.map(shareImg).filter((t) => !/og:image:alt|og:image:width|og:image:height/.test(t)).map((t) => (/property="og:image"/.test(t) ? t + `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${NAME}">` : t));
  const scripts = headScripts(head).join("");
  const body = old.slice(old.indexOf("</head>") + 7);
  const mainStart = body.search(/<main\b/), mainEnd = body.lastIndexOf("</main>") + 7;
  if (mainStart < 0 || mainEnd < 7) throw new Error(file + ": no <main>");
  let main = body.slice(mainStart, mainEnd);
  const ownId = /<main\b[^>]*\bid="([^"]+)"/.exec(main)?.[1]; // a page whose <main> already has an id (the app pages: "app") keeps it, and the skip link points there
  if (!ownId) main = main.replace(/<main\b([^>]*)>/, '<main$1 id="main">');
  cfg = { ...cfg, skip: ownId ?? "main" };
  const after = body.slice(mainEnd);
  // page scripts that follow the footer (everything after </footer>, minus the old </body></html>)
  const tail = cfg.scripts ?? (after.includes("</footer>") ? after.slice(after.indexOf("</footer>") + 9) : after).replace(/<script src="\/brandkit\.js[^>]*><\/script>\s*/g, "").replace(/<\/body>\s*<\/html>\s*$/, "").trim();
  const mid = cfg.between ?? ""; // markup between </main> and the footer that the page keeps (cookie notes, sheets)
  const html = `<!doctype html>
<html lang="en" data-theme="blue"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
${tags.join("\n")}
${headAssets(cfg)}
${scripts}${cfg.bar === false ? "" : `<script src="/gamesbar.js?v=${V.bar}" defer data-game="tictactoe"></script>`}</head><body class="${cfg.bodyClass ?? "ck"}">
${cfg.allBadges ? readFileSync(new URL("./site-parts/sprite.html", import.meta.url), "utf8").trim() : SPRITE}${cfg.icons ? "\n" + ICONS() : ""}
${header(cfg)}
${main}
${mid}${cfg.footer === false ? "" : footer()}
<script src="/brandkit.js?v=${V.kit}" defer></script>${tail ? "\n" + tail : ""}
</body></html>
`;
  return html;
}

/** The public pages and what each one needs. `css` are the site's own stylesheets, after the kit's. */
const READ = { css: ["tictactoe.css"] };
export const PAGES = {
  "index.html": { loginId: "loginLink", icons: true, allBadges: true, css: ["tictactoe.css"] }, // the landing page shows the six game badges in its "Choose a game" row
  "partner.html": { icons: true, css: ["tictactoe.css", "partner.css"], current: "/partner.html" },
  "helpdesk.html": { icons: true, css: ["tictactoe.css", "partner.css"] },
  "legal.html": READ, "terms.html": READ, "privacy.html": READ, "legal-position.html": READ, "dpa.html": READ, "subprocessors.html": READ, "refund-policy.html": READ, "partner-terms.html": READ,
  "about.html": READ, "contact.html": READ, "pricing.html": READ,
  "organizer-guide.html": { ...READ, current: "/organizer-guide.html" },
  "how-it-works.html": { ...READ, current: "/how-it-works.html" },
  "brochure.html": { ...READ, current: "/brochure.html" },
  // the organizer console and the tournament page: their own style sheets and logic stay; they get the kit's tokens, header, chips and spacing (console-skin.css) and stay light
  "zc.html": { legacyFirst: ["app.css", "z.css", "zc.css"], console: true, css: ["console-skin.css"], light: true, footer: false, bar: false },
  "host.html": { legacyFirst: ["app.css", "z.css", "ttt.css"], console: true, css: ["console-skin.css"], light: true, footer: false, bar: false },
  "404.html": { css: ["tictactoe.css"] },
  "offline.html": { css: ["tictactoe.css"] },
  "signin.html": { css: ["tictactoe.css"] },
  "trust.html": { ...READ, source: "trust" }, // written by tools/make-trust.ts from apps/edge/src/trust-page.ts, then given the chrome here
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const [f, cfg] of Object.entries(PAGES)) {
    if (!existsSync(new URL(f, PUB))) { console.log("skip (missing)", f); continue; }
    if (cfg.source) continue; // written by its own generator, which calls build() itself
    const out = build(f, cfg), was = read(f);
    if (out === was) continue;
    if (check) { console.log("out of date:", f); bad++; } else { writeFileSync(new URL(f, PUB), out); console.log("wrote", f); }
  }
  if (bad) process.exit(1);
}
