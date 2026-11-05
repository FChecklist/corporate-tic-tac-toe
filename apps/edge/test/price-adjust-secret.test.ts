// The private price is a secret between the owner and the boss: nothing a visitor, organizer or player can fetch may name it. Every public page and script (source and built copy),
// the public text files and the public API answers are scanned for its words and routes.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lazyTickReset } from "../src/worker";
import { call, reset, restore } from "./param-harness";

setDefaultTimeout(30_000);
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const WORDS = /coupon|discount code|promo code|promo-code|price as agreed|price of one game|payment test\)|api\/owner\/price|owner_adjust|price_adjust|adjust_minor|list_minor|make it (rs|us\$) 1/i;
const TEXT = /\.(html|js|css|txt|xml|json|webmanifest|md)$|^_headers$|^_routes\.json$/;
const SKIP = new Set(["node_modules", "fonts", "img", ".wrangler"]);
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (!SKIP.has(n)) walk(p, out); } else if (TEXT.test(n)) out.push(p); }
  return out;
}
beforeEach(() => { reset(); lazyTickReset(); });
afterEach(restore);

describe("the private price is invisible to the public", () => {
  test("no public page, script or text file (source or built copy) carries its words or its route", () => {
    const files = [...walk(join(ROOT, "apps/web/public")), ...walk(join(ROOT, "pages/public"))];
    expect(files.length).toBeGreaterThan(30);
    const bad = files.filter((f) => WORDS.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length));
    expect(bad).toEqual([]);
  });
  test("the owner's form is not in a public script: owner-desk.js only draws a panel it is sent", () => {
    const js = readFileSync(join(ROOT, "apps/web/public/owner-desk.js"), "utf8");
    expect(js).not.toMatch(/\/api\/owner\/price|reduce|Save price|payment test/i);
    expect(js).toContain("/api/owner/panel"); // the one generic route; it answers 404 without the owner key
  });
  test("public API answers (payment status, the AI manifest, the mode word) do not name it", async () => {
    for (const path of ["/api/payments/status", "/api/z/ai-manifest", "/api/mode", "/api/demo/status", "/api/notices"]) {
      const t = await (await call("GET", path)).text();
      expect([path, WORDS.test(t)]).toEqual([path, false]);
    }
  });
  test("a stranger asking for the owner routes learns nothing: the same plain 404 as an unknown address", async () => {
    const unknown = await (await call("GET", "/api/owner/no-such-thing")).text();
    for (const path of ["/api/owner/panel", "/api/owner/panel?q=X-1", "/api/owner/price?eid=X-1"]) { const r = await call("GET", path); expect(r.status).toBe(404); expect(await r.text()).toBe(unknown); }
  });
});

describe("the server code never names the private price in a response field", () => {
  test("no source file other than price-adjust.ts has the word coupon, discount or promo (a response key such as `coupon:` would reach an organizer's browser)", () => {
    const dir = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const hits: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && x !== "price-adjust.ts")) readFileSync(join(dir, f), "utf8").split("\n").forEach((l, i) => { if (/\b(coupon|promo)\b/i.test(l)) hits.push(`${f}:${i + 1}`); });
    expect(hits).toEqual([]);
  });
});
