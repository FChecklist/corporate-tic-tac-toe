// TEST AUTHOR, fix pass 1.4.1 (31 Oct 2026). The join page's ID box (ttt.js): where the hint "The system will read this as ..." may appear, the "either" mode, the regexes the coder wrote
// (checked by behaviour: a missing backslash would change what they accept), and the script order on the new public pages (guide.js before blackbox.js).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openJoin } from "./t30-joinpage";
const HINT = "The system will read this as ";
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");

describe("the hint is shown only where the server really cleans (employee-ID game)", () => {
  test("shown when 1 to 30 letters and numbers are left and cleaning changes what was typed", async () => {
    const p = await openJoin({ verify: "id" });
    for (const [typed, shown] of [["1b-678", "1B678"], ["1B 678", "1B678"], ["１Ｂ６７８", "1B678"], ["e101", "E101"], ["ß5", "SS5"], ["A-".repeat(15), "A".repeat(15)], ["x-".repeat(15) + "y", "X".repeat(15) + "Y"]] as const) { await p.type(typed); expect([typed, p.hint()]).toEqual([typed, HINT + shown]); }
  });
  test("not shown when typing is already the clean form (nothing to explain)", async () => { const p = await openJoin({ verify: "id" }); for (const t of ["1B678", "ABC", "0042"]) { await p.type(t); expect([t, p.hint()]).toEqual([t, ""]); } });
  test("never for an e-mail typed in an employee-ID box: plain, full-width, small and with spaces", async () => {
    for (const verify of ["id", "both", "either"]) {
      const p = await openJoin({ verify, employeesOnly: false });
      for (const t of ["demo1@demo-test.invalid", "a@b.co", "demo1＠demo-test.invalid", "demo1﹫demo-test.invalid", "de mo1 @ demo-test.invalid", "x@", "@y", "1B-678@x"]) { await p.type(t); expect([verify, t, p.hint()]).toEqual([verify, t, ""]); }
    }
  });
  test("the 'will read this as' hint is not shown when more than 30 are left after cleaning (the server refuses them), shown at exactly 30", async () => {
    const p = await openJoin({ verify: "id" });
    await p.type("a".repeat(31)); expect(p.hint()).not.toContain(HINT); await p.type("ab-".repeat(16)); expect(p.hint()).not.toContain(HINT); /* 32 left; the owner rule puts the too-long sentence here instead, see t42-join-texts */ await p.type("ab-".repeat(15)); expect(p.hint()).toBe(HINT + "AB".repeat(15)); /* 30 left */ await p.type("a".repeat(30)); expect(p.hint()).toBe(HINT + "A".repeat(30)); await p.type("a-".repeat(15)); expect(p.hint()).toBe(HINT + "A".repeat(15));
  });
  test("not shown when nothing is left (symbols, emoji, zero-width only)", async () => { const p = await openJoin({ verify: "id" }); for (const t of ["---//", "😀😀", "​‌", "..."]) { await p.type(t); expect([t, p.hint()]).toEqual([t, ""]); } });
});

describe("the hint for an Email ID game (idKind email)", () => {
  test("a complete address that cleaning changes shows the cleaned address: upper case, inner spaces, full-width, zero-width", async () => {
    const p = await openJoin({ verify: "id", idKind: "email" });
    for (const [typed, shown] of [["DEMO1@Demo-Test.Invalid", "demo1@demo-test.invalid"], ["demo1 @ demo-test.invalid", "demo1@demo-test.invalid"], ["demo1＠demo-test.invalid", "demo1@demo-test.invalid"], ["dem​o1@demo-test.invalid", "demo1@demo-test.invalid"], ["Sam@Corp.com", "sam@corp.com"]] as const) { await p.type(typed); expect([typed, p.hint()]).toEqual([typed, HINT + shown]); }
  });
  test("an address already in clean form shows no hint; an incomplete one shows no hint", async () => {
    const p = await openJoin({ verify: "id", idKind: "email" });
    for (const t of ["demo1@demo-test.invalid", "demo1", "demo1@", "a@bcom", "a@b.c", "@b.com", "a@@b.com", "a@b@c.com"]) { await p.type(t); expect([t, p.hint()]).toEqual([t, ""]); }
  });
  test("the box is an e-mail box: its label says Email ID, it allows 254 characters and asks for the e-mail keyboard", async () => {
    const p = await openJoin({ verify: "id", idKind: "email" });
    expect(p.d.querySelector('label[for="emp"]')!.textContent).toMatch(/Your Email ID/); expect(p.emp().getAttribute("maxlength")).toBe("254"); expect(p.emp().getAttribute("inputmode")).toBe("email");
    const q = await openJoin({ verify: "id" }); expect(q.d.querySelector('label[for="emp"]')!.textContent).toMatch(/Your employee ID/); expect(q.emp().getAttribute("maxlength")).toBe("60");
  });
});

describe("regexes written by the coder have real backslashes (checked by behaviour and in the file)", () => {
  test("\\s and \\. are real: 's' is allowed in a name, a dot is needed, a space is cleaned away and never ends up inside the address", async () => {
    const p = await openJoin({ verify: "id", idKind: "email" });
    await p.type("SAMSON@SOS.COM"); expect(p.hint()).toBe(HINT + "samson@sos.com"); // [^\s@] without its backslash would refuse every s
    await p.type("SAM@SOScom"); expect(p.hint()).toBe(""); // \. without its backslash would accept any character as the dot
    await p.type("a b@c d.co"); expect(p.hint()).toBe(HINT + "ab@cd.co"); // \s in the cleaning class
  });
  test("the file text has the backslashes, and the zero-width class holds the invisible marks", () => {
    const t = pub("ttt.js");
    expect(t).toContain("/^[^\\s@]{1,64}@[^\\s@]{1,255}\\.[^\\s@]{2,}$/"); expect(t).toContain("replace(/[\\s");
    const m = t.match(/replace\(\/\[\\s([^\]]*)\]\/g, ""\)\.toLowerCase\(\)/); expect(m).toBeTruthy();
    const marks = [...m![1]!.replace(/\\u([0-9a-fA-F]{4})/g, (_x, h) => String.fromCharCode(parseInt(h, 16)))]; // literal marks or \u escapes both read here
    expect(marks.map((c) => c.charCodeAt(0))).toEqual([0x85, 0x200b, 0x2d, 0x200d, 0x2060, 0xfeff]); // U+0085, U+200B-U+200D (a range), U+2060, U+FEFF
  });
});

describe("'either' mode asks for the ID as well (a person may give the ID or the mobile number)", () => {
  test("verify=either shows the ID box with its hint line, and the mobile box", async () => {
    for (const idKind of ["emp", "email"]) {
      const p = await openJoin({ verify: "either", idKind, employeesOnly: false });
      expect([idKind, !!p.emp()]).toEqual([idKind, true]); expect(p.d.getElementById("emphint")).toBeTruthy(); expect(p.d.getElementById("mob")).toBeTruthy();
    }
  });
  test("each of the four modes: mobile = no ID box; id, either, both = ID box", async () => {
    for (const [verify, hasId] of [["number", false], ["mobile", false], ["id", true], ["either", true], ["both", true]] as const) { const p = await openJoin({ verify }); expect([verify, !!p.emp()]).toEqual([verify, hasId]); }
  });
  test("verify=either with a typed ID cleans and hints like the other ID modes", async () => { const p = await openJoin({ verify: "either" }); await p.type("1b-678"); expect(p.hint()).toBe(HINT + "1B678"); });
});

describe("the new public pages load guide.js before blackbox.js", () => {
  const PAGES = ["index", "how-it-works", "guide", "brochure", "refer", "thank-you", "game-completed"];
  for (const f of PAGES) test(f + ".html: guide.js is there, is deferred, and comes before blackbox.js", () => {
    const h = pub(f + ".html"), g = h.indexOf('<script src="/guide.js"'), b = h.indexOf('<script src="/blackbox.js"');
    expect(g).toBeGreaterThan(-1); expect(b).toBeGreaterThan(-1); expect(g).toBeLessThan(b);
    expect(h.slice(g, g + 40)).toContain("defer"); expect(h.split('src="/guide.js"').length - 1).toBe(1);
  });
});

// PRODUCT FINDING (TESTER_REPORT.md, P-2): until EMP_CLEAN_FROM_MS is set, every game keeps the OLD employee-ID rule on the server (1b-678 is stored as 1B-678), but ttt.js already promises the NEW reading ("1B678").
test.todo("the hint says what the server will store: for a game created before EMP_CLEAN_FROM_MS (every game today) 1b-678 is stored as 1B-678, but the page says 1B678");
