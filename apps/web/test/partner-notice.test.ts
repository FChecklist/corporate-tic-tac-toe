// Refer & earn sign-up has no tick-box (owner rule: no tick-boxes anywhere). Joining is the act; one small agreement line with links comes from consent.js.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pub = (f: string) => readFileSync(join(import.meta.dir, "../public", f), "utf8");

describe("Refer & earn sign-up: no tick-box, one agreement line", () => {
  test("partner.js: no checkbox, no 'tick the box' guard, the line comes from consent.js, the request still says consent: true", () => {
    const s = pub("partner.js");
    expect(s).not.toMatch(/type="checkbox"/);
    expect(s).not.toMatch(/Please tick the box/);
    expect(s).toContain('CBConsent.html("K2")');
    expect(s).toMatch(/consent: true/);
  });
  test("partner.html loads consent.js before partner.js", () => {
    const h = pub("partner.html");
    const c = h.indexOf('<script src="/consent.js"></script>'), p = h.indexOf('<script src="/partner.js"></script>');
    expect(c).toBeGreaterThan(-1);
    expect(c).toBeLessThan(p);
  });
  test("consent.js gives the one line with three links and nothing to tick", () => {
    const s = pub("consent.js");
    expect(s).toContain("By continuing, you agree to the");
    expect(s).not.toMatch(/type="checkbox"/);
  });
});
