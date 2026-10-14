// A9: config/SECRETS_NAMES.md lists, by NAME ONLY, every secret and setting the Worker, the Pages functions and the scheduled job read, what it is for and where it is set.
// This test fails when the code reads (or declares) a name that the list does not carry, and when the list holds a value instead of a name.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SKIP_FILE = (f: string) => /\.test\.ts$/.test(f) || f.endsWith("local.ts"); // tests and the local run script (PORT, DB_FILE) are not the deployed code
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "test" || n === "public") continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out); else if (n.endsWith(".ts") && !SKIP_FILE(f)) out.push(f);
  }
  return out;
}
const FILES = [join(ROOT, "apps/edge/src"), join(ROOT, "pages/functions"), join(ROOT, "apps/cron/src"), join(ROOT, "packages")].flatMap((d) => { try { return walk(d); } catch { return []; } });
const NAME = "[A-Z][A-Z0-9_]{1,}";

/** Every name the deployed code reads from its environment, or declares in an Env interface. */
export function namesInCode(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (n: string, f: string) => { if (!found.has(n)) found.set(n, f.slice(ROOT.length + 1)); };
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(new RegExp(`\\benv\\)?\\??\\.(${NAME})\\b`, "g"))) add(m[1]!, f);
    for (const m of src.matchAll(new RegExp(`\\(\\s*env\\s+as\\s+[^)]*\\)\\s*\\??\\.(${NAME})\\b`, "g"))) add(m[1]!, f);
    for (const m of src.matchAll(new RegExp(`\\benv\\??\\[\\s*["'](${NAME})["']\\s*\\]`, "g"))) add(m[1]!, f);
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const blocks = [...stripped.matchAll(/\binterface\s+\w*Env\b[^{\n]*\{[ \t]*\r?\n([\s\S]*?)\r?\n\}/g), ...stripped.matchAll(/\binterface\s+\w*Env\b[^{\n]*\{([^}\n]*)\}/g)];
    for (const m of blocks) { for (const k of m[1]!.matchAll(new RegExp(`(?:^|[\\s;{,])(${NAME})\\??\\s*:`, "g"))) add(k[1]!, f); }
  }
  return found;
}
const md = readFileSync(join(ROOT, "config/SECRETS_NAMES.md"), "utf8");
const listed = new Map<string, string[]>();
for (const line of md.split(/\r?\n/)) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  const m = /^`(\w+)`$/.exec(cells[0] ?? "");
  if (m) listed.set(m[1]!, cells);
}

describe("A9: the secrets list (names only)", () => {
  test("every name the code reads or declares is in config/SECRETS_NAMES.md", () => {
    const missing = [...namesInCode()].filter(([n]) => !listed.has(n)).map(([n, f]) => `${n} (read in ${f})`);
    expect(missing).toEqual([]);
  });
  test("the scanner finds the names it should (so the check above cannot pass by finding nothing)", () => {
    const names = [...namesInCode().keys()];
    for (const n of ["DATA_KEY", "ORGANIZER_SECRET", "RAZORPAY_KEY_SECRET", "RESEND_API_KEY", "CRON_KEY", "PUBLIC_ORIGIN", "RESEND_WEBHOOK_SECRET"]) expect(names).toContain(n);
  });
  test("every row says what it is for, where it is set and whether it is secret; no row holds a value", () => {
    expect(listed.size).toBeGreaterThan(15);
    for (const [n, cells] of listed) {
      expect(cells.length).toBeGreaterThanOrEqual(4);
      expect([n, cells.slice(1, 4).every((c) => c.length > 2)]).toEqual([n, true]);
      expect([n, /^(secret|setting|binding)/i.test(cells[3]!)]).toEqual([n, true]);
      expect([n, /(=|sk_|rzp_|whsec_|re_[A-Za-z0-9]{8,}|[A-Fa-f0-9]{32,}|eyJ[A-Za-z0-9])/.test(cells.join(" "))]).toEqual([n, false]);
    }
  });
  test("every name in the list is read or declared somewhere (the list does not collect dead names)", () => {
    const names = namesInCode();
    const wranglerOnly = new Set<string>(); // names that only wrangler.toml / the Pages dashboard set and that no script reads by that name
    for (const n of listed.keys()) expect([n, names.has(n) || wranglerOnly.has(n)]).toEqual([n, true]);
  });
  test("the list says where each is set and the secrets file in the repo holds no names the list lacks", () => {
    const local = join(ROOT, "config/live-secrets.txt");
    let text = ""; try { text = readFileSync(local, "utf8"); } catch { return; } // git-ignored; absent on a fresh checkout
    for (const line of text.split(/\r?\n/)) { const m = /^\s*([A-Z][A-Z0-9_]+)\s*=/.exec(line); if (m) expect([m[1], listed.has(m[1]!)]).toEqual([m[1], true]); }
  });
});
