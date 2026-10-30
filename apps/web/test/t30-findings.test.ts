// TEST AUTHOR 30 Oct 2026. KNOWN PRODUCT FINDINGS (docs/TEST_FINDINGS.md): these tests are RED on purpose until the coder fixes the product. They are kept apart so the other t30 files can be green and be break-checked.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openJoin } from "./t30-joinpage";
const PUB = new URL("../public/", import.meta.url);
const rd = (f: string) => readFileSync(new URL(f, PUB), "utf8");
const PAGES = ["index", "how-it-works", "guide", "brochure", "refer", "thank-you", "game-completed"];

describe("F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages)", () => {
  for (const p of PAGES) test(`${p}.html: guide.js before blackbox.js`, () => { const h = rd(p + ".html"); if (h.includes('src="/blackbox.js"')) { expect(h).toContain('src="/guide.js"'); expect(h.indexOf('src="/guide.js"')).toBeLessThan(h.indexOf('src="/blackbox.js"')); } });
});

describe("the employee ID box and its hint line", () => {
  // PRODUCT FINDING F-4 (docs/TEST_FINDINGS.md): ttt.js askWhat() only knows "id" and "both"; the server also offers "either" (mobile number or employee ID).
  test("F-4: a game set to 'mobile number or employee ID' (verify=either) shows the employee-ID box and its hint line", async () => {
    const p = await openJoin({ verify: "either", employeesOnly: false }); expect(!!p.emp()).toBe(true); expect(p.d.getElementById("emphint")).toBeTruthy();
  });
  // PRODUCT FINDING F-3 (docs/TEST_FINDINGS.md): the line promises a reading for input the server refuses.
  test("F-3: an e-mail typed in the ID box does not get a 'will read this as' promise (the server refuses it with bad-id)", async () => {
    const p = await openJoin({ verify: "id" }); await p.type("demo1@demo-test.invalid"); expect(p.hint()).not.toMatch(/will read this as/);
  });
  test("F-3: an ID that is longer than 30 after cleaning does not get a 'will read this as' promise (the server refuses it)", async () => {
    const p = await openJoin({ verify: "id" }); await p.type("A".repeat(35)); expect(p.hint()).not.toMatch(/will read this as/);
  });
});
