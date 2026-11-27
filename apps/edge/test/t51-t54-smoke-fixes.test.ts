// Smoke-test fixes of 2026-11-04 (T-52, T-53, T-54): the two ID cleaners agree, the shared Host list refuses a shapeless e-mail, a cut name never ends in a blank or half an emoji.
import { describe, expect, test } from "bun:test";
import { cleanEmpId } from "../src/ids";
import { cleanName } from "../src/people";
import * as core from "../../../vendor/game-core/packages/core/src/ids";
import { addHost, addCohost, newTeam } from "../../../vendor/game-core/packages/core/src/people";

describe("T-52: one employee-ID cleaner", () => {
  for (const raw of ["-KＡz_-QǰA_ıbßßßKAＡQŉǰ٣-ǰ_", "FGZ75GM8Jß", "1b-678", "ﬃx", "é1", "ı"]) test(JSON.stringify(raw), () => expect(core.cleanEmpId(raw)).toBe(cleanEmpId(raw)));
  test("a sharp s becomes SS in both", () => { expect(core.cleanEmpId("ß1")).toBe("SS1"); expect(cleanEmpId("ß1")).toBe("SS1"); });
});
describe("T-53: the shared Host / Co-host list refuses an e-mail ID with no shape", () => {
  for (const junk of ["@@", "...", "a@b", "no-at-sign", "x@", "@y.com"]) test(junk, () => {
    expect(addHost(newTeam(), "organizer", "email", junk, 1).ok).toBe(false); expect(addCohost(newTeam(), "organizer", "email", junk, 1).ok).toBe(false);
  });
  test("an inner space is removed first, as on the server: \"a b@c.de\" is the address ab@c.de", () => { const r = addHost(newTeam(), "organizer", "email", "a b@c.de", 1); expect(r.ok).toBe(true); });
  test("a real address still works", () => { const r = addHost(newTeam(), "organizer", "email", " Sam@Corp.Example ", 1); expect(r.ok).toBe(true); if (r.ok) expect(r.team.hosts[0]!.id).toBe("sam@corp.example"); });
});
describe("T-54: a cleaned name never ends in a blank or half a character", () => {
  test("the 60th unit is a space", () => { const n = cleanName("x".repeat(59) + " tail"); expect(n).toBe("x".repeat(59)); });
  test("the 60th unit is half an emoji", () => { const n = cleanName("x".repeat(59) + "\u{1F600}tail"); expect(n).toBe("x".repeat(59)); expect(/[\ud800-\udbff]$/.test(n)).toBe(false); });
  test("a whole emoji that fits is kept", () => { expect(cleanName("x".repeat(58) + "\u{1F600}tail")).toBe("x".repeat(58) + "\u{1F600}"); });
  test("a short name is unchanged", () => { expect(cleanName("  Sam  Lee ")).toBe("Sam Lee"); });
});
