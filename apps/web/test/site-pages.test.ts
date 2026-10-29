// The look of every public page (owner order, 2026-10-29): the Corporate Games brand kit, the six-item header menu, the footer, the share tags, the cache rules.
// Each rule here fails when its subject is broken (the plant-and-see-red notes are in docs/SITE-TICTACTOE-2026-10-29.md).
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FREE_GAME_CAP } from "../../edge/src/pay";

const ROOT = join(import.meta.dir, "../../..");
const PUB = join(ROOT, "apps/web/public"), OUT = join(ROOT, "pages/public"), ORIGIN = "https://tictactoe.corporatetambola.com";
const rd = (f: string) => readFileSync(join(PUB, f), "utf8");
/** Pages with the full kit look (head, games bar, header, footer). */
const SITE = ["index", "how-it-works", "organizer-guide", "brochure", "partner", "partner-terms", "legal", "terms", "privacy", "legal-position", "refund-policy", "dpa", "subprocessors", "about", "contact", "pricing", "trust", "helpdesk", "404", "offline", "signin"].map((p) => p + ".html");
/** The organizer console and the tournament page: only the visual shell (tokens, header, logo, fonts, chips, spacing). */
const CONSOLE = ["zc.html", "host.html"];
const MENU = ["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"];
const noindex = (h: string) => /name="robots" content="[^"]*noindex/.test(h);

describe("the header menu: exactly six items, in the owner's order, on every page", () => {
  for (const f of [...SITE, ...CONSOLE]) test(f, () => {
    const h = rd(f), nav = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1]!.replace(/<span class="ck-dots"[\s\S]*?<\/span>/, "");
    const links = [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links.map((m) => m[2]!.replace(/&amp;/g, "&").trim())).toEqual(MENU);
    expect(links.map((m) => /href="([^"]+)"/.exec(m[1]!)![1])).toEqual(["/how-it-works.html", "/zc.html?demo=1", "/organizer-guide.html", "/brochure.html", "/partner.html", "/zc.html"]);
    expect(h).not.toMatch(/AI assistant for organizers<\/a>|class="aipill"|>Video<|>Pricing<\/a><a|wa\.me/); // none of the old header items
  });
});

describe("the kit look on every page", () => {
  for (const f of [...SITE, ...CONSOLE]) test(f + ": kit head, skip link, brand lockup, badge, kit script", () => {
    const h = rd(f);
    expect(h).toMatch(/<html lang="en" data-theme="blue">/); expect(h).toContain('<meta name="theme-color" content="#0B3D91">'); expect(h).toContain('<body class="ck">');
    for (const c of ["fonts", "tokens", "components"]) expect(h).toMatch(new RegExp(`<link rel="stylesheet" href="/${c}\\.css\\?v=\\d+">`));
    expect(h).toMatch(/<script src="\/theme-init\.js\?v=\d+"><\/script>/); expect(h).toMatch(/<script src="\/brandkit\.js\?v=\d+" defer><\/script>/); // theme-init runs before the page is drawn; the menu script waits
    expect(h).toMatch(/<a class="ck-skip" href="#(main|app)">/); expect(h).toContain('<span class="ck-name"><i>Corporate</i><b>Tic Tac Toe</b></span>');
    expect(h).toContain('<symbol id="i-ttt" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#17784A"/>'); expect(h).toContain('<use href="#i-ttt"/>');
    expect(h).not.toMatch(/logo-mark|logo-1024|logo-512|logo\.svg|img\/card\.png/); // the old logo is gone
    if (CONSOLE.includes(f)) { expect(h).toContain('href="/console.css?v='); expect(h).toContain('href="/console-skin.css?v='); expect(h).toContain('<script src="/console-light.js"></script>'); expect(h).not.toContain('<footer'); }
  });
  for (const f of SITE) test(f + ": the footer names the games, the legal pages and the payee; no inline style, script or handler", () => {
    const h = rd(f), foot = /<footer class="ck-foot">[\s\S]*?<\/footer>/.exec(h)![0];
    for (const u of ["https://housie.corporatetambola.com/", "https://bingo.corporatetambola.com/", "https://snakes.corporatetambola.com/", "https://luck.corporatetambola.com/", "https://home.corporatetambola.com/contact", "/terms.html", "/privacy.html", "/subprocessors.html", "/dpa.html", "/refund-policy.html"]) expect(foot).toContain(`href="${u}"`);
    expect(foot).toContain("A product of IT Services by Rajat Agarwal."); expect(foot).toContain("All payments are taken only by IT Services by Rajat Agarwal, through Razorpay.");
    expect(h).not.toMatch(/<style\b/); expect(h).not.toMatch(/\son(click|load|error|change|submit)=/i);
    expect(h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")).not.toMatch(/<script(?![^>]*\bsrc=)/i); // no inline script (the policy allows our own files only)
  });
});

describe("words: close group, never the banned word; English only", () => {
  const files = readdirSync(PUB).filter((f) => /\.(html|txt|xml|webmanifest)$/.test(f) || /^(site|zc|common|ttt|host|big|pay|paylink|paytest|partner|helpdesk|helpdesk-accept|helpdesk-approve|signin|report|preview|demo|ai-link|rights|termsbox|pwa|guide|owner-desk|v|rum|google|autoupdate|keep|offline|brandkit|theme-init|console-light|gamesbar)\.js$/.test(f));
  test("the banned word is on no page, in no script text and in no e-mail or server text", () => {
    const hits: string[] = [];
    for (const f of files) { const t = rd(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1"); for (const m of t.matchAll(/private/gi)) hits.push(f + ": " + t.slice(Math.max(0, m.index! - 30), m.index! + 30).replace(/\s+/g, " ")); }
    for (const f of ["mails.ts", "ai-facts.ts", "ai-go.ts", "ai-link.ts", "pay.ts", "trust-page.ts", "legal.ts", "brand.ts", "report-layout.ts", "lifecycle.ts", "worker.ts", "paylink.ts", "cancel.ts", "credit.ts"]) { const t = readFileSync(join(ROOT, "apps/edge/src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1"); for (const m of t.matchAll(/private/gi)) hits.push(f + ": " + t.slice(Math.max(0, m.index! - 30), m.index! + 30).replace(/\s+/g, " ")); }
    expect(hits).toEqual([]);
  });
  test("the landing, how-it-works and brochure pages say close group (not closed group) and ask the owner's question", () => {
    for (const f of ["index.html", "how-it-works.html", "brochure.html"]) expect([f, /closed[- ]group/i.test(rd(f).replace(/<[^>]+>/g, " "))]).toEqual([f, false]);
    expect(rd("index.html").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("This week, which teams will you engage with a close group online Tic Tac Toe?");
    expect(rd("index.html")).toContain("Choose a game for your close group:");
  });
  test("no page names a payee other than IT Services by Rajat Agarwal, and no other gateway", () => {
    for (const f of [...SITE, ...CONSOLE, "pay.html", "paylink.html", "paytest.html"]) { const t = rd(f).replace(/<[^>]+>/g, " "); expect([f, /stripe|paypal|paytm|payu|cashfree|phonepe|instamojo|ccavenue/i.test(t)]).toEqual([f, false]); if (/razorpay/i.test(t)) expect([f, t.includes("IT Services by Rajat Agarwal")]).toEqual([f, true]); }
    for (const f of ["index.html", "pricing.html", "brochure.html"]) expect(rd(f)).toContain("All payments are taken only by IT Services by Rajat Agarwal, through Razorpay.");
    expect(readFileSync(join(ROOT, "packages/billing/src/index.ts"), "utf8")).toContain("All payments are taken only by IT Services by Rajat Agarwal, through Razorpay.");
  });
});

describe("share tags, sitemap and robots", () => {
  const sm = rd("sitemap.xml"), locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  for (const f of SITE) test(f, () => {
    const h = rd(f), url = ORIGIN + (f === "index.html" ? "/" : "/" + f);
    if (noindex(h)) { expect(locs).not.toContain(url); return; }
    expect(h.match(/<link rel="canonical"/g)?.length).toBe(1); expect(h).toContain(`<link rel="canonical" href="${url}">`); expect(h).toContain(`<meta property="og:url" content="${url}">`);
    expect(h).toContain(`<meta property="og:image" content="${ORIGIN}/og-card.png">`); expect(h).toContain(`<meta name="twitter:image" content="${ORIGIN}/og-card.png">`); expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(locs).toContain(url);
  });
  test("the sitemap lists the new page, robots.txt points at it, and the manifest has the kit colours and icons", () => {
    expect(locs).toContain(ORIGIN + "/how-it-works.html"); expect(rd("robots.txt")).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    const m = JSON.parse(rd("manifest.webmanifest")); expect(m.theme_color).toBe("#0B3D91"); expect(m.background_color).toBe("#FFFAF2"); expect(m.icons.map((i: any) => i.src)).toEqual(["/icon-192.png", "/icon-512.png", "/icon-maskable-192.png", "/icon-maskable-512.png"]);
  });
});

describe("links, files, cache versions, headers", () => {
  beforeAll(() => { const r = Bun.spawnSync(["bun", "pages/build.mjs"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" }); if (r.exitCode !== 0) throw new Error("pages build failed: " + r.stderr.toString()); });
  const built = (f: string) => existsSync(join(OUT, f)) && statSync(join(OUT, f)).isFile();
  const allPages = () => readdirSync(PUB).filter((f) => f.endsWith(".html"));
  test("every internal link, script, style and image of every page resolves to a file the Pages build ships (and every #anchor to an id)", () => {
    const bad: string[] = [];
    for (const f of allPages()) {
      const h = rd(f).replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
      for (const m of h.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        let u = m[1]!; if (u.startsWith(ORIGIN)) u = u.slice(ORIGIN.length) || "/";
        if (!u.startsWith("/") || u.startsWith("//") || /^\/(api|ai|j)\//.test(u)) continue;
        const [pathAndQuery, hash] = u.split("#"), path = pathAndQuery!.split("?")[0]!;
        const file = path === "/" ? "index.html" : path.slice(1);
        const real = built(file) ? file : built(file + ".html") ? file + ".html" : "";
        if (!real) { bad.push(`${f}: ${u}`); continue; }
        if (hash && real.endsWith(".html") && !new RegExp(`\\sid="${hash}"`).test(readFileSync(join(OUT, real), "utf8"))) bad.push(`${f}: ${u} (no such id)`);
      }
    }
    expect(bad).toEqual([]);
  });
  test("no page, script or server text links to the console host that does not exist yet", () => {
    const hits: string[] = [];
    for (const f of readdirSync(PUB)) if (/\.(html|js|txt|xml|webmanifest|css)$/.test(f) && f !== "zgame.js" && rd(f).includes("console.corporatetambola.com")) hits.push(f);
    for (const f of readdirSync(join(ROOT, "apps/edge/src"))) if (f.endsWith(".ts") && readFileSync(join(ROOT, "apps/edge/src", f), "utf8").includes("console.corporatetambola.com")) hits.push("edge/" + f);
    expect(hits).toEqual([]);
  });
  test("every kit file a page loads has a ?v= number (the same on every page), the icons are at v3, and the offline page's files are all saved by the service worker", () => {
    const sw = rd("zsw.js"), saved: string[] = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)![1]!);
    expect(Number(/const CACHE = "ttt-game-v(\d+)"/.exec(sw)![1])).toBeGreaterThanOrEqual(10); // the live set was v9: a new one makes every installed phone fetch the new files
    const seen = new Map<string, Set<string>>();
    for (const f of [...SITE, ...CONSOLE]) for (const m of rd(f).matchAll(/(?:href|src)="\/((?:tokens|components|console|console-skin|fonts|tictactoe|partner)\.css|(?:theme-init|brandkit|gamesbar)\.js)(\?v=\d+)?"/g)) { expect([f, m[1], !!m[2]]).toEqual([f, m[1], true]); (seen.get(m[1]!) ?? seen.set(m[1]!, new Set()).get(m[1]!)!).add(m[2]!); }
    for (const [file, v] of seen) expect([file, v.size]).toEqual([file, 1]);
    for (const f of [...SITE, ...CONSOLE]) { const h = rd(f); expect(h).toContain("/favicon-32.png?v=3"); expect(h).toContain("/icon-192.png?v=3"); expect(h).toContain("/apple-touch-icon.png?v=3"); }
    for (const m of rd("offline.html").matchAll(/(?:href|src)="(\/[^"?]+\.(?:css|js))/g)) if (!/^\/(guide|blackbox|rum|v)\.js$/.test(m[1]!)) expect([m[1], saved.includes(m[1]!)]).toEqual([m[1], true]);
    for (const f of saved) expect([f, existsSync(join(PUB, f.slice(1)))]).toEqual([f, true]);
  });
  test("the Pages build writes no-cache for every .css and .js and for the manifest, and keeps the fonts immutable", () => {
    const hd = readFileSync(join(OUT, "_headers"), "utf8");
    expect(hd).toContain("/*.js\n  Cache-Control: no-cache"); expect(hd).toContain("/*.css\n  Cache-Control: no-cache"); expect(hd).toContain("/manifest.webmanifest\n  Cache-Control: no-cache"); expect(hd).toContain("/fonts/*\n  Cache-Control: public, max-age=31536000, immutable");
    for (const p of ["/how-it-works", "/brochure", "/organizer-guide", "/404", "/signin", "/privacy"]) expect(hd).toContain(`${p}.html\n  Content-Security-Policy:`);
    for (const f of ["tokens.css", "components.css", "console.css", "console-skin.css", "tictactoe.css", "brandkit.js", "theme-init.js", "console-light.js", "gamesbar.js", "gamesbar.css", "favicon.svg", "favicon.ico", "og-card.png", "brochure.pdf", "how-it-works.html"]) expect([f, built(f)]).toEqual([f, true]);
    for (const f of ["site.css", "theme.js", "logo.svg", "logo-mark.svg", "logo-512.png", "logo-1024.png"]) expect([f, built(f)]).toEqual([f, false]); // retired
  });
});

describe("the free demo game is the real free game for 10 people", () => {
  test("the header and the hero lead to the console's demo path, which is the Rs 0 game of up to FREE_GAME_CAP people", () => {
    expect(FREE_GAME_CAP).toBe(10);
    const h = rd("index.html"), hero = h.slice(h.indexOf('<section class="ck-hero'), h.indexOf("</section>", h.indexOf('<section class="ck-hero'))), day = h.slice(h.indexOf('id="game-day"'), h.indexOf("</section>", h.indexOf('id="game-day"')));
    for (const part of [hero, day]) expect(part).toContain('<a class="ck-btn main" href="/zc.html?demo=1">Try a free game with 10 people</a>'); // the hero and the game-day strip both lead to the free game
    expect(rd("zc.js")).toContain('const NEWDEMO = q.get("demo") === "1"'); expect(rd("zc.js")).toContain("Start your demo game");
    expect(rd("site.js")).toContain("demo=1"); // the sign-in hand-back keeps ?demo=1
  });
});

describe("the brochure", () => {
  test("brochure.pdf is one A4 page made from brochure.html, and the page links to it", () => {
    const pdf = readFileSync(join(PUB, "brochure.pdf")), txt = pdf.toString("latin1");
    expect(txt.startsWith("%PDF-")).toBe(true); expect((txt.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1); expect(pdf.length).toBeGreaterThan(20000);
    expect(rd("brochure.html")).toContain('href="/brochure.pdf"'); expect(rd("brochure.html")).toContain('<article class="tt-sheet"');
  });
});
