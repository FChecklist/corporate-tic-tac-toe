// TEST AUTHOR 30 Oct 2026. The employee-ID box and its hint line on the join page (ttt.js).
import { describe, expect, test } from "bun:test";
import { cleanEmpId } from "../../edge/src/ids";
import { openJoin } from "./t30-joinpage";

describe("the employee ID box and its hint line", () => {
  test("the box exists with a hint line (aria-live polite) when the game asks for an employee ID; the hint starts empty", async () => {
    for (const verify of ["id", "both"]) { const p = await openJoin({ verify, employeesOnly: false }); expect([verify, !!p.emp()]).toEqual([verify, true]); expect(p.d.getElementById("emphint")!.getAttribute("aria-live")).toBe("polite"); expect(p.hint()).toBe(""); }
  });
  test("no box and no hint when the game asks for a mobile number only", async () => { const p = await openJoin({ verify: "number" }); expect(p.emp()).toBeNull(); expect(p.d.getElementById("emphint")).toBeNull(); });
  test("typing 1B-678 shows exactly 'The system will read this as 1B678'; typing 1b 678 shows the same; clearing the box clears the line", async () => {
    const p = await openJoin({ verify: "id" });
    await p.type("1B-678"); expect(p.hint()).toBe("The system will read this as 1B678"); await p.type("1b 678"); expect(p.hint()).toBe("The system will read this as 1B678");
    await p.type("１Ｂ６７８"); expect(p.hint()).toBe("The system will read this as 1B678"); await p.type(""); expect(p.hint()).toBe("");
  });
  test("symbols only show no hint (nothing to read)", async () => { const p = await openJoin({ verify: "id" }); await p.type("---//"); expect(p.hint()).toBe(""); await p.type("😀"); expect(p.hint()).toBe(""); });
  test("the box accepts up to 60 typed characters (maxlength 60), more than the 30 that remain after cleaning", async () => {
    const p = await openJoin({ verify: "id" }); expect(p.emp().getAttribute("maxlength")).toBe("60");
    const sixty = "1B-".repeat(20); expect(sixty.length).toBe(60); await p.type(sixty); expect(p.emp().value.length).toBe(60); expect(p.hint()).toBe("The system will read this as " + "1B".repeat(20));
  });
  test("the mobile box (shown with the ID box for outsiders) has its own limit of 20 and no hint", async () => { const p = await openJoin({ verify: "id", employeesOnly: false }); expect(p.d.getElementById("mob")!.getAttribute("maxlength")).toBe("20"); });
  test("the page cleans exactly like the server: 40 probes, hint text == 'The system will read this as ' + ids.ts cleanEmpId", async () => {
    const p = await openJoin({ verify: "id" });
    const probes = ["1B-678", "1b-678", "1B/678", "1B 678", "1b.678", "１Ｂ６७８", "1B😀678", "1B\u200B678", "1B\u200D678", "\uFEFF1B678", "é1", "१B678", "ﬁ9", "a_b", "A-B-C-D", " x ", "ab#12", "E-101", "e101", "ＡＢ-１２", "zoë", "1B\t678", "(1B)678", "N/A", "0042", "007", "Ⅷ9", "²3", "①A", "AB\u00ADCD", "ǅ1", "ß5", "İ1", "ı1", "ſ2", "K9", "ℌ1", "⒈A", "áb", "x".repeat(30)];
    for (const t of probes) { await p.type(t); const want = cleanEmpId(t); expect([t, p.hint()]).toEqual([t, want ? "The system will read this as " + want : ""]); }
  });
});
