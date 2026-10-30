// TEST AUTHOR 30 Oct 2026. Employee ID cleaner (apps/edge/src/ids.ts), every case from docs/TEST_HANDOFF.md "Employee ID". Each test asserts a real value.
import { describe, expect, test } from "bun:test";
import { cleanEmpId, empHint, normEmpFor, EMP_CLEAN_FROM_MS, EMP_MAX } from "../src/ids";
import { normEmp } from "../src/people";
const NEW = EMP_CLEAN_FROM_MS + 1, OLD = EMP_CLEAN_FROM_MS - 1;

describe("employee ID: the five typings become 1B678", () => {
  for (const typed of ["1B-678", "1b-678", "1B/678", "1B 678", "1b.678"]) test(`"${typed}" -> 1B678`, () => { expect(normEmpFor(typed, NEW)).toBe("1B678"); expect(cleanEmpId(typed)).toBe("1B678"); });
  test("tabs, new lines, underscores, backslashes, brackets and a leading/trailing mess also give 1B678", () => {
    for (const typed of ["\t1B\t678\n", "1B_678", "1B\\678", "(1B)678", "  --1B 6 7 8--  ", "1B,678", "1B:678", "1B#678"]) expect([typed, normEmpFor(typed, NEW)]).toEqual([typed, "1B678"]);
  });
});
describe("employee ID: unusual characters", () => {
  test("full-width letters and digits are read as plain ones (NFKC)", () => { expect(normEmpFor("１Ｂ－６７８", NEW)).toBe("1B678"); expect(normEmpFor("ａｂ１２", NEW)).toBe("AB12"); });
  test("emoji and zero-width marks (ZWSP, ZWNJ, ZWJ, word joiner, BOM) vanish", () => {
    expect(normEmpFor("1B😀678", NEW)).toBe("1B678"); expect(normEmpFor("🙂🙂1B678🙂", NEW)).toBe("1B678");
    for (const z of ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"]) expect([z.charCodeAt(0), normEmpFor(`1B${z}678`, NEW)]).toEqual([z.charCodeAt(0), "1B678"]);
  });
  test("accents are removed, not turned into letters: é gives nothing, ñ gives nothing, the plain letters stay", () => {
    expect(normEmpFor("é1", NEW)).toBe("1"); expect(normEmpFor("1ñ2", NEW)).toBe("12"); expect(normEmpFor("Zoë9", NEW)).toBe("ZO9");
  });
  test("other scripts are dropped (Hindi digit, Arabic digit, CJK) and only A-Z 0-9 remain", () => {
    expect(normEmpFor("१B678", NEW)).toBe("B678"); expect(normEmpFor("٣AB", NEW)).toBe("AB"); expect(normEmpFor("员工A7", NEW)).toBe("A7");
  });
  test("a ligature expands by NFKC (ﬁ -> FI) and is kept as letters", () => { expect(normEmpFor("ﬁ9", NEW)).toBe("FI9"); });
});
describe("employee ID: empty, symbols only, too long", () => {
  test("nothing typed (empty, spaces, tabs) is the empty string, not a refusal", () => { for (const t of ["", "   ", "\t\n", undefined, null]) expect([String(t), normEmpFor(t, NEW)]).toEqual([String(t), ""]); });
  test("only symbols / emoji / other scripts is refused (null)", () => { for (const t of ["---//", "😀😀", "é", "१२३", "!#$"]) expect([t, normEmpFor(t, NEW)]).toEqual([t, null]); });
  test("30 characters after cleaning is allowed, 31 is refused; dashes do not count toward the 30", () => {
    expect(EMP_MAX).toBe(30);
    expect(normEmpFor("A".repeat(30), NEW)).toBe("A".repeat(30)); expect(normEmpFor("A".repeat(31), NEW)).toBeNull();
    expect(normEmpFor("-".repeat(20) + "A".repeat(30) + "-".repeat(20), NEW)).toBe("A".repeat(30));
    expect(normEmpFor("A-".repeat(15), NEW)).toBe("A".repeat(15));
  });
  test("a very long input (10,000 characters) is refused quickly and does not hang", () => { const t0 = performance.now(); expect(normEmpFor("A".repeat(10_000), NEW)).toBeNull(); expect(performance.now() - t0).toBeLessThan(200); });
});
describe("employee ID: an e-mail typed in the ID box is refused, never turned into letters", () => {
  test("ascii @, full-width ＠ and small ﹫ are all refused", () => { for (const t of ["demo1@demo-test.invalid", "demo1＠demo-test.invalid", "demo1﹫demo.com", " a@b "]) expect([t, normEmpFor(t, NEW)]).toEqual([t, null]); });
  test("a typed @ in an otherwise good ID still refuses (the whole box is an e-mail)", () => { expect(normEmpFor("1B678@", NEW)).toBeNull(); });
});
describe("employee ID: games created before EMP_CLEAN_FROM_MS keep the old rule", () => {
  test("1B-678 stays 1B-678, 1b-678 is upper-cased only, spaces are dropped", () => { expect(normEmpFor("1B-678", OLD)).toBe("1B-678"); expect(normEmpFor("1b-678", OLD)).toBe("1B-678"); expect(normEmpFor("1B 678", OLD)).toBe("1B678"); });
  test("1B*678 is refused on an old game (symbols outside . _ - /) but accepted-and-cleaned on a new one", () => { expect(normEmpFor("1B*678", OLD)).toBeNull(); expect(normEmpFor("1B*678", NEW)).toBe("1B678"); });
  test("the old rule still allows . _ - / inside and a 30 character limit including them", () => { expect(normEmpFor("1B.6_7/8", OLD)).toBe("1B.6_7/8"); expect(normEmpFor("A".repeat(30), OLD)).toBe("A".repeat(30)); expect(normEmpFor("A".repeat(31), OLD)).toBeNull(); });
  test("the boundary instant: created exactly at EMP_CLEAN_FROM_MS is NEW; one ms earlier is OLD", () => { expect(normEmpFor("1B-678", EMP_CLEAN_FROM_MS)).toBe("1B678"); expect(normEmpFor("1B-678", EMP_CLEAN_FROM_MS - 1)).toBe("1B-678"); });
  test("no created_ms given means the NEW rule", () => { expect(normEmpFor("1B-678")).toBe("1B678"); });
});
describe("employee ID: the browser hint and the people.ts entry point", () => {
  test("hint says exactly 'The system will read this as 1B678'; empty when nothing usable", () => { expect(empHint("1B-678")).toBe("The system will read this as 1B678"); expect(empHint("")).toBe(""); expect(empHint("---")).toBe(""); });
  test("people.normEmp is the same function as normEmpFor for every probe", () => { for (const t of ["1B-678", "", "---", "a@b.c", "é", "A".repeat(31)]) for (const c of [OLD, NEW, undefined]) expect([t, c, normEmp(t, c)]).toEqual([t, c, normEmpFor(t, c)]); });
  test("the result is idempotent: cleaning a cleaned ID changes nothing", () => { for (const t of ["1B-678", "１Ｂ６７８", "a b c"]) { const c = normEmpFor(t, NEW)!; expect(normEmpFor(c, NEW)).toBe(c); } });
});
