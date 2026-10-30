// TEST AUTHOR 30 Oct 2026. E-mail ID cleaner (ids.ts cleanEmail), the Organizer/Host/Google paths that use it, and "the ID cleaner is never applied to an e-mail".
import { describe, expect, test } from "bun:test";
import { cleanEmail, cleanEmpId, normEmpFor, EMP_CLEAN_FROM_MS } from "../src/ids";
import { normMail } from "../src/mode";
import { emailHashOf } from "../src/hostsetup";
const NEW = EMP_CLEAN_FROM_MS + 1;
/** every upper/lower combination of the letters in `s` (2^letters strings) */
function* caseMixes(s: string): Generator<string> { const idx = [...s].map((c, i) => (c.toLowerCase() !== c.toUpperCase() ? i : -1)).filter((i) => i >= 0); for (let m = 0; m < 1 << idx.length; m++) { const a = [...s]; idx.forEach((p, b) => { a[p] = (m >> b) & 1 ? a[p]!.toUpperCase() : a[p]!.toLowerCase(); }); yield a.join(""); } }

describe("e-mail: one address however it is typed", () => {
  test("RAJAT1＠DEMO.COM (full-width @, upper case) is rajat1@demo.com", () => { expect(cleanEmail("RAJAT1＠DEMO.COM")).toBe("rajat1@demo.com"); expect(normMail("RAJAT1＠DEMO.COM")).toBe("rajat1@demo.com"); });
  test("every case mix of demo7@demo-test.invalid local part + first domain word is ONE address (2^8 = 256 mixes)", () => {
    const seen = new Set<string>(); let n = 0; for (const m of caseMixes("demo7@demo")) { n++; seen.add(cleanEmail(m + "-test.invalid")); }
    expect(n).toBe(256); expect([...seen]).toEqual(["demo7@demo-test.invalid"]);
  });
  test("every case mix of the WHOLE address demo3@demo-test.invalid (all 2^19 = 524,288 mixes are built, every 97th is checked) is one address", () => {
    const all = [...caseMixes("demo3@demo-test.invalid")]; expect(all.length).toBe(1 << 19); // 19 letters
    for (let i = 0; i < all.length; i += 97) expect([all[i], cleanEmail(all[i]!)]).toEqual([all[i], "demo3@demo-test.invalid"]);
  });
  test("inner spaces, tabs, new lines and zero-width marks are removed; leading/trailing too", () => {
    for (const t of ["  demo1 @ demo-test.invalid ", "de mo1@demo-test.invalid", "demo1@demo-test.invalid\n", "\tdemo1@demo-test.invalid", "demo1\u200B@demo-test.invalid", "demo1@demo\uFEFF-test.invalid", "demo1\u00A0@demo-test.invalid"]) expect([t, cleanEmail(t)]).toEqual([t, "demo1@demo-test.invalid"]);
  });
  test("full-width letters and full-width @ and dot become plain (NFKC)", () => { expect(cleanEmail("ｄｅｍｏ１＠ｄｅｍｏ－ｔｅｓｔ．ｉｎｖａｌｉｄ")).toBe("demo1@demo-test.invalid"); });
  test("two different people stay different: demo1 and demo2, demo1 and demo11", () => { expect(cleanEmail("DEMO1@demo-test.invalid")).not.toBe(cleanEmail("demo2@demo-test.invalid")); expect(cleanEmail("demo1@demo-test.invalid")).not.toBe(cleanEmail("demo11@demo-test.invalid")); });
  test("empty / non-string input gives an empty string and does not throw", () => { for (const t of ["", "   ", undefined, null, 0]) expect(cleanEmail(t)).toBe(t === 0 ? "0" : ""); });
});
describe("e-mail: normMail drops the +tag part and nothing else", () => {
  test("Demo4+Tag@Demo-Test.Invalid -> demo4@demo-test.invalid; two tags and no tag are one person", () => {
    expect(normMail("Demo4+Tag@Demo-Test.Invalid")).toBe("demo4@demo-test.invalid"); expect(normMail("demo4+a+b@demo-test.invalid")).toBe("demo4@demo-test.invalid"); expect(normMail("DEMO4＠demo-test.invalid")).toBe("demo4@demo-test.invalid");
  });
  test("a + in the DOMAIN is kept (only the local part is cut); no @ gives the cleaned text unchanged", () => { expect(normMail("demo4@demo+x.invalid")).toBe("demo4@demo+x.invalid"); expect(normMail("NoAtSign")).toBe("noatsign"); });
  test("the + is dropped only after cleaning: a full-width ＋ is NFKC '+', so it is dropped too", () => { expect(normMail("demo4＋tag@demo-test.invalid")).toBe("demo4@demo-test.invalid"); });
});
describe("e-mail: the Host e-mail hash is the same for every spelling (hostsetup.ts uses cleanEmail)", () => {
  test("hash of DEMO5＠Demo-Test.invalid == hash of demo5@demo-test.invalid; a different person differs", async () => {
    const a = await emailHashOf("demo5@demo-test.invalid"); expect(a).toMatch(/^[0-9a-f]{32,}$/);
    expect(await emailHashOf("DEMO5＠Demo-Test.invalid")).toBe(a); expect(await emailHashOf(" demo5 @demo-test.invalid ")).toBe(a); expect(await emailHashOf("demo6@demo-test.invalid")).not.toBe(a);
  });
});
describe("the ID cleaner is never applied to an e-mail (and the e-mail cleaner never to an ID)", () => {
  test("cleanEmail keeps . - _ @ that the ID cleaner would delete", () => { expect(cleanEmail("a.b-c_d@x-y.com")).toBe("a.b-c_d@x-y.com"); expect(cleanEmpId("a.b-c_d@x-y.com")).toBe("ABCDXYCOM"); });
  test("an e-mail in the employee-ID box is refused (null), not 'DEMO1DEMOTESTINVALID'", () => { expect(normEmpFor("demo1@demo-test.invalid", NEW)).toBeNull(); expect(normEmpFor("DEMO1＠DEMO-TEST.INVALID", NEW)).toBeNull(); });
  test("an employee ID is not lower-cased or stripped by the e-mail cleaner: it is only used on e-mail inputs", () => { expect(cleanEmail("1B-678")).toBe("1b-678"); expect(normEmpFor("1B-678", NEW)).toBe("1B678"); });
});
