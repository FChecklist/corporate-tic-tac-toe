// Guard: every page this repo produces carries the small mark exactly once, with the approved look (owner order, 25 Nov 2026).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const PUB = join(ROOT, "apps/web/public");
const read = (p: string) => readFileSync(p, "utf8");

const MARK = '<div class="mark139" lang="hi" aria-hidden="true"><span>१३९</span></div>';
const CSS = '.mark139{position:absolute;top:0;left:0;right:0;margin:0;padding:1px 0 0;text-align:center;line-height:1;pointer-events:none;user-select:none;z-index:2147483647;font-family:"Noto Sans Devanagari","Mukta","Nirmala UI","Mangal","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif;font-size:6px;font-weight:700;color:#0B2A6B}.mark139 span{display:inline-block;border-bottom:.5px solid #7A1010;padding-bottom:.5px}';
const squash = (s: string) => s.replace(/\s+/g, "");

// static pages (every .html in the public folder, 404 included) + the prototype page
const staticPages = [...readdirSync(PUB).filter((f) => f.endsWith(".html")).map((f) => join(PUB, f)), join(ROOT, "prototype/web/index.html")];
// pages built in code: [file, how many pages that file builds]
const codePages: [string, number][] = [["apps/edge/src/admin.ts", 1], ["apps/edge/src/people.ts", 2], ["apps/edge/src/trust-page.ts", 1], ["packages/billing/src/index.ts", 1]];

function checkPage(src: string, sharedCss: string, label: string) {
  expect([label, (src.match(/class="mark139"/g) ?? []).length]).toEqual([label, 1]);
  expect([label, src.includes(MARK)]).toEqual([label, true]);
  expect([label, /<body[^>]*>\s*<div class="mark139"/.test(src)]).toEqual([label, true]); // first child of body
  expect([label, squash(src + sharedCss).includes(squash(CSS))]).toEqual([label, true]);
}

describe("mark १३९ on every page", () => {
  const appCss = read(join(PUB, "app.css"));
  test("the shared stylesheet holds the approved CSS once", () => {
    expect(squash(appCss).split(squash(CSS)).length - 1).toBe(1);
    for (const t of ["#0B2A6B", "#7A1010", "font-size:6px", "font-weight:700", ".5px", "pointer-events:none", "user-select:none", "position:absolute"]) expect(CSS).toContain(t);
  });
  for (const p of staticPages) {
    test("static page " + p.slice(ROOT.length + 1), () => {
      const src = read(p);
      const usesApp = /<link rel="stylesheet" href="\/app\.css">/.test(src);
      checkPage(src, usesApp ? appCss : "", p);
      if (usesApp) expect(src.includes(".mark139{")).toBe(false); // CSS once per page: never inline as well
    });
  }
  for (const [f, n] of codePages) {
    test("code-built page(s) in " + f, () => {
      const src = read(join(ROOT, f));
      expect(src.split(MARK).length - 1).toBe(n);
      expect(src.split(CSS).length - 1).toBe(f.includes("trust-page") ? 0 : n); // the trust page loads app.css
    });
  }
  test("the invoice fragment (not a page) drops the mark in both places it is cut out", () => {
    expect((read(join(ROOT, "apps/edge/src/pay.ts")).match(/mark139/g) ?? []).length).toBe(2);
  });
});
