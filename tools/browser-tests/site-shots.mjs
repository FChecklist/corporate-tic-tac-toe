// Looks at the public pages in a real browser: screenshots at 360, 390, 768, 1280 and 1920 wide in light and dark, no sideways scroll, no script or style error, the six menu
// links in the right order for a keyboard (Tab / Enter / Escape), and (with --axe) the colour-contrast check of axe-core. Nothing is sent anywhere: the pages are served from this folder.
//   node tools/browser-tests/site-shots.mjs --out C:/ct/shots/tictactoe [--pages index,how-it-works] [--widths 360,1280] [--axe]
// Needs playwright-core (a dev dependency) and a Chrome or Chromium (set CHROME=<path>; the one that ships with Playwright is found by itself).
// The pages call /api/... and /version.json, which this plain file server does not have: those two 404s are expected and ignored. The beacon, Google and Razorpay are never contacted.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
const root = resolve(import.meta.dirname, "../.."), pub = join(root, "apps/web/public");
const require = createRequire(join(root, "package.json"));
const { chromium } = require("playwright-core");
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const OUT = resolve(opt("out", join(root, "site-shots"))), AXE = args.includes("--axe");
const PAGES = (opt("pages", "index,how-it-works,organizer-guide,brochure,partner,privacy,terms,legal,about,pricing,trust,404,offline,signin,zc,helpdesk")).split(",");
const WIDTHS = opt("widths", "360,390,768,1280,1920").split(",").map(Number);
const MENU = ["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf", ".txt": "text/plain", ".xml": "application/xml" };
const server = createServer((req, res) => { const u = new URL(req.url, "http://x"), p = u.pathname === "/" ? "/index.html" : u.pathname, f = join(pub, decodeURIComponent(p)); if (!f.startsWith(pub) || !existsSync(f)) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }).end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const pw = "/opt/pw-browsers", found = existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith("chromium-")).map((d) => join(pw, d, "chrome-linux64/chrome")) : [];
const exe = [process.env.CHROME, ...found, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((b) => existsSync(b));
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] });
mkdirSync(OUT, { recursive: true });
const R = { base: BASE, shots: 0, problems: [], keyboard: [], axe: [] };
const bad = (m) => { R.problems.push(m); console.log("PROBLEM", m); };

for (const scheme of ["light", "dark"]) for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
  for (const name of PAGES) {
    const page = await ctx.newPage(), errs = [];
    page.on("pageerror", (e) => errs.push("script: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errs.push(m.text().slice(0, 160)); });
    page.on("response", (r) => { if (r.status() === 404 && !/\/api\/|\/version\.json$|\/favicon\.ico$/.test(r.url())) errs.push("404 " + r.url().replace(BASE, "")); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // nothing outside is contacted
    await page.goto(`${BASE}/${name}.html`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await page.screenshot({ path: join(OUT, `${name}-${w}-${scheme}.png`), fullPage: true }); R.shots++;
    if (wide) bad(`${name} ${w} ${scheme}: sideways scroll`);
    for (const e of errs) bad(`${name} ${w} ${scheme}: ${e}`);
    if (AXE && w === 1280) {
      await page.addScriptTag({ path: join(root, "node_modules/axe-core/axe.min.js") });
      const res = await page.evaluate(async () => (await axe.run(document, { runOnly: ["color-contrast"] })).violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " :: " + (n.any[0]?.message ?? "").slice(0, 100)) })));
      R.axe.push({ page: name, scheme, violations: res }); if (res.length) bad(`${name} ${scheme}: contrast ${JSON.stringify(res).slice(0, 300)}`);
    }
    await page.close();
  }
  await ctx.close();
}

// keyboard: Tab goes through the six menu links in order (on a laptop they are always there; on a phone the Menu button opens them, Escape closes them)
for (const [w, phone] of [[1280, false], [360, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 } }), page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" }); await page.waitForTimeout(300);
  const stops = [], tab = async () => { await page.keyboard.press("Tab"); stops.push(await page.evaluate(() => { const a = document.activeElement; return a ? (a.textContent || a.getAttribute("aria-label") || a.tagName).replace(/\s+/g, " ").trim().slice(0, 40) : ""; })); };
  for (let i = 0; i < 40 && !MENU.every((m) => stops.includes(m)); i++) {
    await tab();
    if (phone && stops.at(-1) === "Menu") { await page.keyboard.press("Enter"); const open = await page.evaluate(() => document.getElementById("ck-nav").classList.contains("open")); if (!open) bad("phone: Enter on Menu did not open the menu"); }
  }
  const order = stops.filter((s) => MENU.includes(s));
  const ok = JSON.stringify(order) === JSON.stringify(MENU);
  R.keyboard.push({ width: w, first_stops: stops, menu_order: order, ok }); console.log(ok ? "KEYBOARD ok" : "KEYBOARD FAIL", w, order.join(" > "));
  if (!ok) bad(`keyboard ${w}: menu order ${order.join(" > ")}`);
  if (phone) { await page.keyboard.press("Escape"); const closed = await page.evaluate(() => !document.getElementById("ck-nav").classList.contains("open")); if (!closed) bad("phone: Escape did not close the menu"); }
  const visible = await page.evaluate(() => [...document.querySelectorAll("#ck-nav > a")].map((a) => a.getBoundingClientRect().width > 0));
  if (!phone && !visible.every(Boolean)) bad("laptop: a menu link is not shown");
  await ctx.close();
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(R, null, 1));
console.log(`\n${R.shots} screenshots in ${OUT}; ${R.problems.length} problem(s)`);
await browser.close(); server.close();
process.exit(R.problems.length ? 1 : 0);
