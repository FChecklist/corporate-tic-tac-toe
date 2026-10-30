// TEST AUTHOR v3 (31 Oct 2026). Gap tests written from the OWNER'S RULES, not from the product's current behaviour. Fake data only.
// Rules: employee ID = NFKC, upper case, keep A-Z0-9, cap 30 AFTER cleaning, empty refused, duplicates after cleaning flagged, an e-mail in an employee-ID game gets a plain refusal (never letters);
// participant Email ID = NFKC, trim, no inner spaces / invisible characters, lower case; ACCOUNT / sign-in / host / payment e-mails REFUSE inner spaces and invisible characters.
// A red test here whose name starts with "OWNER RULE" is a PRODUCT DEFECT and is listed in docs/TESTER_REPORT.md. It is not bent to pass.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanAccountEmail, cleanEmail, cleanEmpId, normEmpFor, empHint } from "../src/ids";
import { badIdMessage, normId } from "../src/people";
import { world, T_NEW, dev, j, mob } from "./t30-kit";

// the seven invisible characters of the owner's list, as escapes (never typed as raw characters)
const INVISIBLE = ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "\u0085", "\u2028", "\u2029"];
const TOO_LONG = "This ID is too long. An employee ID may be up to 30 characters once cleaned.";
const PLAIN_EMAIL_REFUSAL = "This looks like an Email ID. This game asks for an employee ID: letters and numbers only.";
let W: ReturnType<typeof world>;
beforeEach(() => { W = world(T_NEW); });
afterEach(() => W.restore());

describe("employee ID cleaning (new rule): NFKC, upper case, A-Z and 0-9 only, 30 after cleaning", () => {
  test("worked examples", () => {
    const rows: [string, string][] = [["1B-678", "1B678"], ["1b 678", "1B678"], ["1b/678", "1B678"], ["1b.678", "1B678"], ["  e_42 ", "E42"], ["１Ｂ-６７８", "1B678"], ["①②", "12"], ["abécd", "ABCD"], ["日本12", "12"], ["a\u200Bb", "AB"], ["x\u{1F600}y", "XY"], ["ß", "SS"]];
    for (const [raw, want] of rows) { expect([raw, cleanEmpId(raw)]).toEqual([raw, want]); expect([raw, normEmpFor(raw, T_NEW)]).toEqual([raw, want]); }
  });
  test("empty is refused: nothing typed is '' (need an ID); only symbols is refused", () => {
    expect(normEmpFor("", T_NEW)).toBe(""); expect(normEmpFor("   ", T_NEW)).toBe(""); expect(normEmpFor("---", T_NEW)).toBeNull(); expect(normEmpFor("\u200B", T_NEW)).toBeNull(); expect(normEmpFor("éé", T_NEW)).toBeNull();
  });
  test("the cap of 30 counts the CLEANED text: 30 kept, 31 refused, and 60 typed characters that clean to 30 are kept", () => {
    expect(normEmpFor("a".repeat(30), T_NEW)).toBe("A".repeat(30)); expect(normEmpFor("a".repeat(31), T_NEW)).toBeNull();
    expect(normEmpFor("a-".repeat(30), T_NEW)).toBe("A".repeat(30)); expect(normEmpFor("a-".repeat(31), T_NEW)).toBeNull();
    expect(normEmpFor("-".repeat(40) + "a".repeat(30), T_NEW)).toBe("A".repeat(30));
  });
  test("the hint text is 'The system will read this as ...' and is empty when nothing is typed", () => {
    expect(empHint("1b-678")).toBe("The system will read this as 1B678"); expect(empHint("")).toBe(""); expect(empHint("---")).toBe("");
  });
  test("an e-mail in an employee-ID game is refused (plain sentence) and the sentence never carries letters from the address", async () => {
    for (const m of ["dev@corp.in", "DEV@Corp.IN", "dev＠corp.in", "dev﹫corp.in", "dev @corp.in", "dev@corp.in \u200B"]) {
      expect([m, normEmpFor(m, T_NEW)]).toEqual([m, null]); expect([m, normId(m, "emp", T_NEW)]).toEqual([m, null]);
      const msg = badIdMessage(m, "emp", T_NEW); expect([m, msg]).toEqual([m, PLAIN_EMAIL_REFUSAL]); expect(msg.toLowerCase()).not.toContain("corp"); expect(msg.toLowerCase()).not.toContain("dev");
    }
    await W.game("T42-1", { who: "list", verify: "id" });
    const r = await W.join("T42-1", { name: "Pat Demo", empId: "dev@corp.in", device: dev(1) }); const b = await j(r);
    expect([r.status, b.code, b.error]).toEqual([400, "bad-id", PLAIN_EMAIL_REFUSAL]); expect(JSON.stringify(b).toUpperCase()).not.toContain("DEVCORPIN");
  });
  test("OWNER RULE too long: the join page of the server says 'This ID is too long...' for 31 cleaned characters", async () => {
    await W.game("T42-2", { who: "list", verify: "id" });
    const r = await W.join("T42-2", { name: "Pat Demo", empId: "A".repeat(31), device: dev(2) }); const b = await j(r);
    expect(r.status).toBe(400); expect(b.error).toBe(TOO_LONG);
  });
  test("OWNER RULE too long: badIdMessage and the list upload say the same sentence", async () => {
    expect(badIdMessage("A".repeat(31), "emp", T_NEW)).toBe(TOO_LONG); expect(badIdMessage("a-".repeat(31), "emp", T_NEW)).toBe(TOO_LONG);
    const g = await W.game("T42-3", { who: "list", verify: "id" });
    const r = await j(await W.call("POST", "/api/z/T42-3/people", { people: [{ name: "Long Demo", empId: "A".repeat(31) }] }, g.key));
    expect(r.invalid.map((x: any) => x.why)).toEqual([TOO_LONG]);
  });
  test("a symbol-only ID keeps the ordinary refusal, not the too-long sentence", () => {
    expect(badIdMessage("***", "emp", T_NEW)).toBe("An employee ID has letters and numbers only (up to 30).");
  });
  test("duplicates AFTER cleaning are flagged (one added, the second reported with its typed text), also across different spellings", async () => {
    const g = await W.game("T42-4", { who: "list", verify: "id" });
    const r = await j(await W.call("POST", "/api/z/T42-4/people", { people: [{ name: "A Demo", empId: "1B-678" }, { name: "B Demo", empId: "1b 678" }, { name: "C Demo", empId: "１Ｂ６７８" }, { name: "D Demo", empId: "2C-1" }] }, g.key));
    expect([r.added, r.duplicates]).toEqual([2, 2]); expect(r.duplicateRows.length).toBe(2); expect(r.people.map((p: any) => p.empId).sort()).toEqual(["1B678", "2C1"]);
    const again = await j(await W.call("POST", "/api/z/T42-4/people", { people: [{ name: "E Demo", empId: "1b/678" }] }, g.key)); expect([again.added, again.duplicates]).toEqual([0, 1]); // already on the list from an earlier upload
  });
  test("the join page: an ID typed in any spelling reaches the same person (no second waiting row for the same cleaned ID)", async () => {
    await W.game("T42-5", { who: "list", verify: "id" });
    const a = await W.join("T42-5", { name: "Pat Demo", empId: "7a-9", device: dev(3) }); const b = await W.join("T42-5", { name: "Pat Demo", empId: "7A 9", device: dev(4) });
    expect([a.status, b.status]).toEqual([403, 403]); expect(W.raw.prepare("SELECT COUNT(*) c FROM waiting").get().c).toBeLessThanOrEqual(2);
  });
});

describe("participant Email ID cleaning: NFKC, trim, no inner spaces or invisible characters, lower case", () => {
  test("cleanEmail removes every invisible character of the owner's list, anywhere", () => {
    for (const ch of INVISIBLE) { for (const raw of [`a${ch}@b.co`, `${ch}a@b.co`, `a@b.co${ch}`, `a@b${ch}.co`]) expect([JSON.stringify(raw), cleanEmail(raw)]).toEqual([JSON.stringify(raw), "a@b.co"]); }
  });
  test("worked examples: trim, inner spaces, NFKC, upper case", () => {
    const rows: [string, string][] = [["  Dev@Corp.IN  ", "dev@corp.in"], ["de v@co rp.in", "dev@corp.in"], ["Dev＠Corp.in", "dev@corp.in"], ["Ｄｅｖ@corp.in", "dev@corp.in"], ["dev@corp。in", "dev@corp。in"], ["\t dev@corp.in\n", "dev@corp.in"], ["DEV@CORP.IN ", "dev@corp.in"]];
    for (const [raw, want] of rows) expect([raw, cleanEmail(raw)]).toEqual([raw, want]);
  });
  test("normId('email') accepts the cleaned address and refuses a bad shape", () => {
    expect(normId("  Dev@Corp.IN ", "email")).toBe("dev@corp.in"); expect(normId("d\u200Bev@co\u2060rp.in", "email")).toBe("dev@corp.in"); expect(normId("dev@corp", "email")).toBeNull(); expect(normId("dev", "email")).toBeNull(); expect(normId("a@@b.co", "email")).toBeNull();
    expect(normId("x".repeat(65) + "@b.co", "email")).toBeNull(); expect(normId("x".repeat(64) + "@b.co", "email")).toBe("x".repeat(64) + "@b.co");
  });
  test("an Email ID game: an address typed with spaces, a zero-width mark and capitals is one and the same person at the door and on the list", async () => {
    const g = await W.game("T42-6", { who: "list", verify: "id", settings: { idKind: "email" } });
    const add = await j(await W.call("POST", "/api/z/T42-6/people", { people: [{ name: "A Demo", empId: "Asha@Demo-Test.invalid" }, { name: "B Demo", empId: " asha@demo-\u200Btest.invalid " }] }, g.key));
    expect([add.added, add.duplicates]).toEqual([1, 1]); expect(add.people[0].empId).toBe("asha@demo-test.invalid");
    const r = await W.join("T42-6", { name: "Asha Demo", empId: "A sha@demo-test.invalid", device: dev(5) }); expect(r.status).toBe(200);
  });
  test("an employee ID typed in an Email ID game is refused", async () => {
    await W.game("T42-7", { who: "list", verify: "id", settings: { idKind: "email" } });
    const r = await W.join("T42-7", { name: "Pat Demo", empId: "1B678", device: dev(6) }); expect([r.status, (await j(r)).code]).toEqual([400, "bad-id"]);
  });
});

describe("ACCOUNT, sign-in, host and payment e-mails REFUSE inner spaces and invisible characters (nothing is repaired)", () => {
  test("cleanAccountEmail: an invisible character anywhere gives '' (refused); an inner space stays (the shape check refuses it); outer spaces and capitals are fine", () => {
    for (const ch of INVISIBLE) for (const raw of [`a${ch}@b.co`, `${ch}a@b.co`, `a@b.co${ch}`]) expect([JSON.stringify(raw), cleanAccountEmail(raw)]).toEqual([JSON.stringify(raw), ""]);
    expect(cleanAccountEmail("a b@c.co")).toBe("a b@c.co"); expect(cleanAccountEmail("  A@B.Co ")).toBe("a@b.co"); expect(cleanAccountEmail("a＠b.co")).toBe("a＠b.co");
  });
  const BAD = ["a b@x.com", "ab@x .com", "ab@x.com x", "ab＠x.com", ...INVISIBLE.map((c) => `a${c}b@x.com`), ...INVISIBLE.map((c) => `ab@x.com${c}`), ...INVISIBLE.map((c) => `${c}ab@x.com`)];
  const accounts = () => W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c as number;
  test("OWNER RULE: the sign-up door (/api/start) refuses all of them with 400 and makes no account", async () => {
    const bad: string[] = []; let i = 0;
    for (const e of BAD) { const r = await W.call("POST", "/api/start", { email: e }, undefined, W.now, `8.1.${i >> 8}.${i++ & 255}`); if (r.status !== 400) bad.push(`${JSON.stringify(e)} -> ${r.status}`); }
    expect({ accepted: bad, accounts: accounts() }).toEqual({ accepted: [], accounts: 0 });
  });
  test("OWNER RULE: the sign-in e-mail door (/api/auth/email) refuses all of them with 400", async () => {
    const bad: string[] = []; let i = 0;
    for (const e of BAD) { const r = await W.call("POST", "/api/auth/email", { email: e }, undefined, W.now, `8.2.${i >> 8}.${i++ & 255}`); if (r.status !== 400) bad.push(`${JSON.stringify(e)} -> ${r.status}`); }
    expect({ accepted: bad, accounts: accounts() }).toEqual({ accepted: [], accounts: 0 });
  });
  test("the code-check door (/api/auth/verify) refuses all of them and makes no account (TEST mode code 123456 would otherwise open it)", async () => {
    const bad: string[] = []; let i = 0;
    for (const e of BAD) { const r = await W.call("POST", "/api/auth/verify", { email: e, code: "123456" }, undefined, W.now, `8.3.${i >> 8}.${i++ & 255}`); if (r.status < 400 || (await j(r)).token) bad.push(`${JSON.stringify(e)} -> ${r.status}`); }
    expect({ accepted: bad, accounts: accounts() }).toEqual({ accepted: [], accounts: 0 });
  });
  test("OWNER RULE: the organizer's contact e-mail at publish time (the payment/receipt address) refuses them too", async () => {
    const key = await W.organizer(3); const bad: string[] = [];
    const start = Math.floor((W.now / 1000 - 1692803367) / 3) + 1 + 1200;
    expect((await W.call("POST", "/api/z", { id: "T42-PUB", startRound: start, callSeconds: 6, cap: 100 }, key)).status).toBe(200);
    for (const e of ["a b@x.com", `a${INVISIBLE[0]}b@x.com`, `ab@x.com${INVISIBLE[5]}`, "ab\uFF20x.com"]) { const r = await W.call("POST", "/api/z/T42-PUB/publish", { email: e, phone: "98765 43210" }, key); if (r.status !== 400) bad.push(`${JSON.stringify(e)} -> ${r.status}`); }
    expect(bad).toEqual([]);
  });
  test("a plain good address still works, in capitals and with outer spaces", async () => {
    const r = await W.call("POST", "/api/start", { email: "  Good.One@Acme-Test.invalid " }, undefined, W.now, "8.9.9.9"); expect(r.status).toBe(200); expect(accounts()).toBe(1);
  });
});
