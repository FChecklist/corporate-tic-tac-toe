// Makes apps/web/public/brochure.pdf (one A4 page) from brochure.html and apps/web/public/organizer-guide.pdf from organizer-guide.html, with headless Chrome or Edge.
// The page is opened from a small local web server, so its style sheets and fonts load exactly as on the site; the page's print style hides the site header, footer and games bar.
// Run after editing the brochure or the guide:  node tools/make-brochure.mjs     (set CHROME=<path> to use another browser)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, extname } from "node:path";
const root = resolve(import.meta.dirname, "..");
const pub = join(root, "apps/web/public");
const JOBS = [["brochure.html", "brochure.pdf", 1], ["organizer-guide.html", "organizer-guide.pdf", 0]]; // [page, PDF, exact number of pages (0 = any)]
const pw = "/opt/pw-browsers"; // the browser that ships with Playwright, when there is one
const found = existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith("chromium-")).map((d) => join(pw, d, "chrome-linux64/chrome")) : [];
const browsers = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", ...found].filter(Boolean);
const exe = browsers.find((b) => existsSync(b));
if (!exe) { console.error("No Chrome or Edge found."); process.exit(1); }
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => { const f = join(pub, decodeURIComponent(new URL(req.url, "http://x").pathname)); if (!f.startsWith(pub) || !existsSync(f)) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }).end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
let failed = false;
for (const [page, name, want] of JOBS) {
  const pdf = join(pub, name), url = `http://127.0.0.1:${server.address().port}/${page}`;
  const args = ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=8000", `--print-to-pdf=${pdf}`, url];
  if (process.getuid?.() === 0) args.unshift("--no-sandbox"); // a container runs as root, where Chrome refuses to start without it
  const code = await new Promise((done) => { const c = spawn(exe, args, { stdio: "ignore" }); c.on("exit", done); c.on("error", () => done(-1)); }); // not spawnSync: this process must keep serving the page while the browser reads it
  if (!existsSync(pdf)) { console.error("PDF not written", name, code); failed = true; continue; }
  const pages = (readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log("wrote", pdf, readFileSync(pdf).length, "bytes,", pages, "page(s)");
  if (want && pages !== want) { console.error(`${name} must be exactly ${want} page(s).`); failed = true; }
}
server.close();
if (failed) process.exit(1);
