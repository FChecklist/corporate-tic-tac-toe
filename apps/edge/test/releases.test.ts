import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import RELEASES from "../src/releases.json";

describe("release history (owner only)", () => {
  test("every release has a version number, a date, a title and changes; versions strictly go down the list", () => {
    const rel = RELEASES as { version: string; date: string; title: string; changes: string[] }[];
    expect(rel.length).toBeGreaterThan(3);
    const num = (v: string) => { const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/); expect(m).not.toBeNull(); return Number(m![1]) * 1e6 + Number(m![2]) * 1e3 + Number(m![3]); };
    for (let i = 0; i < rel.length; i++) {
      expect(rel[i]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(rel[i]!.title.length).toBeGreaterThan(3); expect(rel[i]!.changes.length).toBeGreaterThan(0);
      if (i > 0) expect(num(rel[i - 1]!.version)).toBeGreaterThan(num(rel[i]!.version));
    }
  });
  test("the route is owner only, the page is not indexed and is not linked from any public page", () => {
    const w = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(w).toMatch(/p === "\/api\/owner\/releases"[\s\S]{0,400}a\.plat[\s\S]{0,200}404/);
    const page = readFileSync(new URL("../../web/public/owner-versions.html", import.meta.url), "utf8");
    expect(page).toMatch(/name="robots" content="noindex, nofollow"/);
    for (const f of ["index.html", "pricing.html", "about.html", "terms.html", "privacy.html", "trust.html", "contact.html"]) expect(readFileSync(new URL("../../web/public/" + f, import.meta.url), "utf8")).not.toContain("owner-versions");
    expect(readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8")).toContain('["/owner-versions", PLAINCSP, true]');
  });
});
