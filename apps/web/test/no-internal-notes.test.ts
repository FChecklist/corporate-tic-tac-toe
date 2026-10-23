// Nothing that is deployed (or that belongs to the Terms boxes) may carry an internal note: who asked for something, or any review or approval status.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(30_000); // it reads every deployed file; on a busy laptop that takes more than bun's 5 seconds
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERN = /COUNSEL|\[●\]|legal(ly)?\s+(review|pending|sign-?off)|review\s+pending|pending\s+(legal|review|approval)|awaiting\s+(legal|counsel|lawyer|approval|review)|\blawyer\b|\badvocate\b|owner'?s?\s+(told|instruction|order|directive|decision)|\bTODO\b|\bFIXME\b|under review|not yet (reviewed|approved)|Shobha/i;
const LEGAL_ONLY = /draft/i; // on the legal pages only: the bare word is fine elsewhere (a draft game)
const LEGAL_PAGES = ["terms.html", "legal.html", "refund-policy.html", "about.html", "contact.html", "pricing.html", "dpa.html", "subprocessors.html", "privacy.html", "partner-terms.html"];
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SKIP_DIR = new Set(["node_modules", ".git", "fonts", "img", ".wrangler", "vendor"]);
const TEXT = /\.(html|js|css|txt|xml|json|webmanifest|md|toml|py|mjs|ts|sql)$|^_headers$|^_routes\.json$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!SKIP_DIR.has(n)) walk(p, out); }
    else if (TEXT.test(n)) out.push(p);
  }
  return out;
}

describe("no internal notes in what is deployed", () => {
  test("every file of the deployed pages (source and built copy) is free of internal notes", () => {
    const files = [...walk(join(ROOT, "apps/web/public")), ...walk(join(ROOT, "pages"))];
    expect(files.length).toBeGreaterThan(30);
    const bad = files.filter((f) => PATTERN.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length));
    expect(bad).toEqual([]);
  });
  test("the legal pages do not use the word draft", () => {
    for (const f of LEGAL_PAGES) { const p = join(ROOT, "apps/web/public", f); if (existsSync(p)) expect([f, LEGAL_ONLY.test(readFileSync(p, "utf8"))]).toEqual([f, false]); }
  });
  test("the consent code, its wording and the Terms tests are free of them too", () => {
    const files = ["apps/edge/src/consent.ts", "apps/edge/src/consent-text.json", "apps/edge/src/tournament.ts", "apps/edge/migrations/0022_consent.sql", "apps/edge/test/consent.test.ts", "docs/RULES.md", "docs/GATES.md", "docs/PRIVACY_AND_LIFECYCLE.md", "docs/GAME.md", "README.md"]
      .map((f) => join(ROOT, f)).filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(4);
    const bad = files.filter((f) => PATTERN.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length));
    expect(bad).toEqual([]);
  });
  test("the pattern itself catches what it should (so the scan is not asleep)", () => {
    for (const s of ["pending legal review", "ask the lawyer", "COUNSEL to confirm", "Shobha Kamal", "owner's instruction", "TODO", "under review", "[●]"]) expect([s, PATTERN.test(s)]).toEqual([s, true]);
    for (const s of ["Terms and Conditions", "Grievance Officer", "unpublished game"]) expect([s, PATTERN.test(s)]).toEqual([s, false]);
  });
});
