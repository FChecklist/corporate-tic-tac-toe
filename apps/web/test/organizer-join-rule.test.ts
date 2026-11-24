// Correctness audit M-B (PR 9, 23 Nov 2026, head 776e5ee6): the organizer's setup screen must tell the owner's join rule (BOSS comment, 23 Nov 07:16 UTC):
// a guest who is not on the list needs only a NAME; ID, department or team, region, mobile number and e-mail are optional; only the organizer and Hosts see what is given.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const zc = readFileSync(join(import.meta.dir, "../public/zc.js"), "utf8");
// the sentence the organizer reads under "Only people on a list"
const line = (zc.split("\n").find((l) => l.includes("One link for everybody. A guest types their ID")) ?? "");
const text = line.slice(line.indexOf("One link for everybody."), line.indexOf('" : "Anyone who clicks'));

describe("organizer setup screen tells the 23 Nov join rule", () => {
  test("the sentence is found", () => { expect(text.length).toBeGreaterThan(100); });
  test("it says only the name is needed and the rest is optional", () => {
    expect(text).toContain("Only their name is needed.");
    expect(text).toContain("Their ID, department or team, region, mobile number and e-mail are optional.");
  });
  test("it no longer says that mobile number and e-mail are required (the old rule)", () => {
    expect(text).not.toMatch(/gives their name, mobile number and e-mail/);
    expect(zc).not.toMatch(/name, mobile number and e-mail\. Only you and your Hosts see them/);
  });
  test("it still says that only the organizer and Hosts see it, and that they say yes or no", () => {
    expect(text).toContain("Only you and your Hosts see them");
    expect(text).toContain("you say yes or no");
  });
  test("it speaks to you (no first-person words)", () => { expect(/\b(I|me|my|we|us|our)\b/i.test(text)).toBe(false); });
});
