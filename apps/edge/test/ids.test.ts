// Owner rule 30 Oct 2026: one cleaner for employee IDs (A-Z 0-9 only) and e-mail IDs (case-insensitive), same on every path.
import { describe, expect, test } from "bun:test";
import { cleanEmpId, cleanEmail, empHint, normEmpFor, EMP_CLEAN_FROM_MS } from "../src/ids";
import { normMail } from "../src/mode";
const NEW = EMP_CLEAN_FROM_MS + 1, OLD = EMP_CLEAN_FROM_MS - 1;
describe("employee ID", () => {
  test("the four examples all become 1B678", () => { for (const x of ["1B-678", "1b-678", "1B/678", "1B 678"]) expect(cleanEmpId(x)).toBe("1B678"); });
  test("dots, underscores, symbols, accents, other scripts, emoji, zero-width and full-width", () => {
    expect(cleanEmpId("1B.6_7#8")).toBe("1B678"); expect(cleanEmpId("1B\u200B6\u200D78")).toBe("1B678"); expect(cleanEmpId("１Ｂ６７８")).toBe("1B678");
    expect(cleanEmpId("1B😀678")).toBe("1B678"); expect(cleanEmpId("१B678")).toBe("B678"); expect(cleanEmpId("é1")).toBe("1");
  });
  test("empty, only symbols, long and the hint", () => {
    expect(normEmpFor("   ", NEW)).toBe(""); expect(normEmpFor("---//", NEW)).toBeNull(); expect(normEmpFor("A".repeat(31), NEW)).toBeNull(); expect(normEmpFor("-" + "A".repeat(30), NEW)).toBe("A".repeat(30));
    expect(empHint("1B-678")).toBe("The system will read this as 1B678"); expect(empHint("--")).toBe("");
  });
  test("an e-mail typed in the employee-ID box is refused, not mangled", () => { expect(normEmpFor("a.b@x.com", NEW)).toBeNull(); expect(normEmpFor("a＠x.com", NEW)).toBeNull(); });
  test("two typings of one ID are the same person after cleaning, and an old game keeps the old rule", () => {
    expect(normEmpFor("1B-678", NEW)).toBe(normEmpFor("1b 678", NEW));
    expect(normEmpFor("1B-678", OLD)).toBe("1B-678"); expect(normEmpFor("1B*678", OLD)).toBeNull();
  });
});
describe("e-mail ID", () => {
  test("every upper/lower variant, spaces and full-width @ are one participant Email ID (an account e-mail is not repaired)", () => {
    const base = "rajat1@demo.com", variants = new Set<string>();
    for (let m = 0; m < 16; m++) { const s = [...base.slice(0, 5)].map((c, i) => (m >> (i % 4)) & 1 ? c.toUpperCase() : c).join("") + "1@" + (m & 1 ? "DEMO" : "Demo") + ".com"; variants.add(cleanEmail(s)); }
    expect([...variants]).toEqual([base]);
    expect(cleanEmail("  Rajat1 @DEMO.com ")).toBe(base); expect(cleanEmail("RAJAT1＠DEMO.COM")).toBe(base); expect(normMail("Rajat1＠Demo.com")).toBe("rajat1＠demo.com"); // OWNER RULE: an account e-mail is NOT repaired (no NFKC, no inner-space removal); only a participant Email ID is
    expect(normMail("Rajat1＠Demo.com")).not.toBe(base); expect(normMail("Rajat1 @Demo.com")).toBe("rajat1 @demo.com"); expect(normMail("  Rajat1@Demo.com ")).toBe(base);
  });
  test("the employee-ID cleaner is never the e-mail cleaner", () => { expect(cleanEmail("a.b@x.com")).toBe("a.b@x.com"); expect(cleanEmpId("a.b@x.com")).toBe("ABXCOM"); });
});
