// Developer helper (not shipped to a site): one headless Chrome at a time, and a tiny static server that sends the same
// Content-Security-Policy as production (so inline script or style, or any outside request, shows up as a failure).
// Take the single heavy lock BEFORE running anything that uses this:  mkdir C:/ct/heavy.lock   (rmdir it when done).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, extname, resolve } from "node:path";

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon" };
export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function startServer(root) {
  root = resolve(root);
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = join(root, p);
    if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[extname(f)] || "application/octet-stream", "Cache-Control": "no-store", "Content-Security-Policy": CSP });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ base: "http://127.0.0.1:" + srv.address().port, close: () => new Promise((r) => srv.close(r)) })));
}

export async function launchChrome() {
  const pw = createRequire("C:/ct/ct/dpdp-app/package.json")("playwright");
  const exe = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const browser = await pw.chromium.launch({ headless: true, ...(existsSync(exe) ? { executablePath: exe } : {}), args: ["--no-sandbox", "--disable-gpu", "--disable-extensions", "--no-first-run"] });
  return { browser, close: () => browser.close() };
}
