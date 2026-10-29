// Developer tool: real-browser screenshots of demo/ at 360, 390, 768, 1280, 1920 px in light and dark, plus layout, header and CSP checks.
// Run under the heavy lock:  node tools/shots.mjs [pageNames] [widths]     e.g.  node tools/shots.mjs tambola,bingo 390,1280
// Output: C:/ct/test-sites/data/ui/brand-kit/<page>-<width>-<scheme>.png and results.json
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer, launchChrome } from "./browser.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "C:/ct/test-sites/data/ui/brand-kit";
mkdirSync(OUT, { recursive: true });
const PAGES = (process.argv[2] || "index,tambola,bingo,tictactoe,snakes,luck,draw").split(",");
const WIDTHS = (process.argv[3] || "360,390,768,1280,1920").split(",").map(Number);
const heightFor = (w) => (w < 700 ? 800 : w < 1100 ? 900 : 1000);
const LABELS = ["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"];

const srv = await startServer(ROOT);
const chrome = await launchChrome();
const results = [];
try {
  for (const name of PAGES) for (const w of WIDTHS) for (const scheme of ["light", "dark"]) {
    const ctx = await chrome.browser.newContext({ viewport: { width: w, height: heightFor(w) }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const problems = [], external = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(m.type() + ": " + m.text().slice(0, 160)); });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
    page.on("request", (r) => { if (!r.url().startsWith(srv.base) && !r.url().startsWith("data:")) external.push(r.url().slice(0, 100)); });
    await page.goto(`${srv.base}/demo/${name === "index" ? "" : name + ".html"}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(([w, labels, isIndex]) => {
      const q = (s) => document.querySelector(s);
      const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
      const nav = q(".ck-nav"), menu = q("#ck-menu");
      const links = nav ? [...nav.querySelectorAll(":scope>a")] : [];
      const tops = links.filter(vis).map((a) => Math.round(a.getBoundingClientRect().top));
      const over = [];
      for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed") { over.push(el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(" ")[0]); if (over.length > 4) break; } }
      return {
        pageX: document.documentElement.scrollWidth > innerWidth + 1, overflowing: over,
        fonts: document.fonts.check("700 20px Fraunces") && document.fonts.check("16px Inter"),
        headerLabels: isIndex ? null : links.map((a) => a.textContent.trim()),
        headerOneRow: isIndex ? null : (w >= 1024 ? new Set(tops).size === 1 : null),
        menuButtonShown: menu ? vis(menu) : null, navVisible: nav ? vis(nav) : null,
        dots: document.querySelectorAll(".ck-dots button").length,
        h1: (q("h1") || {}).textContent,
      };
    }, [w, LABELS, name === "index"]);
    const bad = [];
    if (m.pageX) bad.push("page scrolls sideways " + m.overflowing.join(","));
    if (!m.fonts) bad.push("self-hosted fonts did not load");
    if (name !== "index") {
      if (JSON.stringify(m.headerLabels) !== JSON.stringify(LABELS)) bad.push("header labels: " + JSON.stringify(m.headerLabels));
      if (w >= 1024 && !m.headerOneRow) bad.push("header menu is not one row");
      if (w >= 1024 && m.menuButtonShown) bad.push("Menu button shown on laptop");
      if (w < 1024 && (!m.menuButtonShown || m.navVisible)) bad.push("phone menu not collapsed");
      if (m.dots !== 3) bad.push("theme dots: " + m.dots);
    }
    if (problems.length) bad.push(...problems);
    if (external.length) bad.push("outside request: " + external.join(" "));
    results.push({ page: name, w, scheme, ok: bad.length === 0, bad, h1: m.h1 });
    console.log(name, w, scheme, bad.length ? "PROBLEM " + bad.join(" | ") : "ok");
    await page.screenshot({ path: `${OUT}/${name}-${w}-${scheme}.png`, fullPage: true });
    if (w < 1024 && scheme === "light" && name === "tambola") {
      await page.click("#ck-menu"); await page.waitForTimeout(120);
      await page.screenshot({ path: `${OUT}/tambola-${w}-menu-open.png`, clip: { x: 0, y: 0, width: w, height: heightFor(w) } });
    }
    await ctx.close();
  }
} finally { await chrome.close(); await srv.close(); }
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(results.every((r) => r.ok) ? "ALL OK" : "SOME PROBLEMS: " + results.filter((r) => !r.ok).length);
