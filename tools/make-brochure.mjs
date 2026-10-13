// Makes apps/web/public/brochure.pdf (one A4 page) from apps/web/public/brochure.html with headless Chrome or Edge.
// Run after editing the brochure:  node tools/make-brochure.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, "..");
const html = join(root, "apps/web/public/brochure.html"), pdf = join(root, "apps/web/public/brochure.pdf");
const browsers = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const exe = browsers.find((b) => existsSync(b));
if (!exe) { console.error("No Chrome or Edge found."); process.exit(1); }
const r = spawnSync(exe, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: "ignore" });
if (!existsSync(pdf)) { console.error("PDF not written", r.status); process.exit(1); }
const pages = (readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log("wrote", pdf, readFileSync(pdf).length, "bytes,", pages, "page(s)");
if (pages !== 1) { console.error("The brochure must be exactly one page."); process.exit(1); }
