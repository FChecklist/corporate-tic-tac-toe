// TEST AUTHOR v3 (31 Oct 2026). Join-page and guide texts, written from the OWNER'S RULES. A test named "OWNER RULE" that is red is a PRODUCT DEFECT (see docs/TESTER_REPORT.md). Fake data only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openJoin } from "./t30-joinpage";
const HINT = "The system will read this as ";
const TOO_LONG = "This ID is too long. An employee ID may be up to 30 characters once cleaned.";
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const pageText = (p: any) => String(p.d.body.textContent || "");

describe("hint texts on the join page (employee-ID game)", () => {
  test("OWNER RULE: over 30 characters once cleaned, the page shows 'This ID is too long. An employee ID may be up to 30 characters once cleaned.' and not the 'read this as' hint", async () => {
    const p = await openJoin({ verify: "id" });
    for (const t of ["a".repeat(31), "ab-".repeat(16), "1".repeat(60)]) { await p.type(t); expect([t, pageText(p).includes(TOO_LONG), p.hint().includes(HINT)]).toEqual([t, true, false]); }
  });
  test("at exactly 30 cleaned characters the too-long sentence is NOT shown", async () => {
    const p = await openJoin({ verify: "id" });
    for (const t of ["a".repeat(30), "ab-".repeat(15)]) { await p.type(t); expect([t, pageText(p).includes(TOO_LONG)]).toEqual([t, false]); }
  });
  test("an e-mail typed in an employee-ID box shows neither the 'read this as' hint nor the too-long sentence nor any cleaned letters", async () => {
    for (const verify of ["id", "both", "either"]) {
      const p = await openJoin({ verify, employeesOnly: false });
      for (const t of ["dev@corp.in", "dev＠corp.in", "d e v @ c o r p . i n", ("x".repeat(40)) + "@corp.in"]) { await p.type(t); expect([verify, t, p.hint().includes(HINT), p.hint().toUpperCase().includes("DEVCORPIN"), pageText(p).includes(TOO_LONG)]).toEqual([verify, t, false, false, false]); }
    }
  });
  test("the hint wording is exactly 'The system will read this as <cleaned>'", async () => {
    const p = await openJoin({ verify: "id" }); await p.type("ab-12"); expect(p.hint()).toBe("The system will read this as AB12");
  });
  test("an Email ID game shows the hint for a changed complete address and nothing for an employee-style ID", async () => {
    const p = await openJoin({ verify: "id", idKind: "email" });
    await p.type("Dev@Corp.IN"); expect(p.hint()).toBe(HINT + "dev@corp.in"); await p.type("dev@corp.in"); expect(p.hint()).toBe(""); await p.type("1B-678"); expect(p.hint()).toBe("");
  });
});

describe("guide.js has a card for each ID-lock sentence (what happened, what to do)", () => {
  const g = pub("guide.js");
  test("both lock sentences are matched by a catalogue entry that is not a dead end", () => {
    for (const s of ["You already have people listed. Start a new game to use a different kind of ID.", "You already have people listed. Start a new game to use a different way of asking for IDs."]) {
      const i = g.indexOf(s); expect([s, i > 0]).toEqual([s, true]); const line = g.slice(g.lastIndexOf("\n", i), g.indexOf("\n", i)); expect(line).toMatch(/ t: "/); expect(line).toMatch(/ w: "/); expect(line).toMatch(/ d: \[/);
    }
  });
});
