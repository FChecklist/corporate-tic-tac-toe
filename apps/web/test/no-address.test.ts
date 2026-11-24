// Owner order 1 Nov 2026: no street, city, state or pin code of the seller anywhere in what ships. Only "India". The jurisdiction is "the courts in India".
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BAD = /Ghaziabad|Uttar Pradesh|Shipra|Indirapuram|Krishna Vista|B-1105|\b201014\b/i;
const SKIP = new Set(["node_modules", ".git", "vendor", "test", "pdfjs"]);
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { if (SKIP.has(n)) continue; const p = join(dir, n); const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (/\.(html|js|mjs|ts|json|css|toml|md|txt|xml)$/.test(n) && s.size < 3_000_000) out.push(p); }
  return out;
}

describe("no address in the shipped files", () => {
  test("pages, scripts, Worker, packages and config name no street, city, state or pin code", () => {
    const hits: string[] = [];
    for (const d of ["apps/web/public", "apps/edge/src", "apps/edge/wrangler.toml", "packages", "config"]) {
      const p = join(ROOT, d); let files: string[]; try { files = statSync(p).isDirectory() ? walk(p) : [p]; } catch { continue; }
      for (const f of files) if (!/pdf\.worker|\.min\./.test(f) && BAD.test(readFileSync(f, "utf8"))) hits.push(f.replace(ROOT, ""));
    }
    expect(hits).toEqual([]);
  }, 60000);
  test("the terms name the courts in India and the contact lines name only India", () => {
    const t = readFileSync(join(ROOT, "apps/web/public/terms.html"), "utf8").replace(/<[^>]+>/g, " ");
    expect(t).toContain("The courts in India have exclusive jurisdiction"); expect(t).toContain("arbitrator in India");
    for (const f of ["contact.html"]) expect(readFileSync(join(ROOT, "apps/web/public", f), "utf8")).toContain("India");
  });
  test("the default company details carry no address line", () => {
    const src = readFileSync(join(ROOT, "packages/billing/src/index.ts"), "utf8");
    expect(src).toMatch(/addressLines: \[\]/); expect(readFileSync(join(ROOT, "apps/edge/wrangler.toml"), "utf8")).not.toMatch(/addressLines|"address"/);
  });
});
