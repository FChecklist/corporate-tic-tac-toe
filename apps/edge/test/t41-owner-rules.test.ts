// TEST AUTHOR, fix pass 1.4.1 (31 Oct 2026). Owner rules: account e-mails refuse inner spaces / full-width at-signs, the ID kind and the verify mode lock once anyone is LISTED or JOINED,
// and EMP_CLEAN_FROM_MS stays far in the future until the release session sets it. Fake data only.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isTestLogin, TEST_LOGINS } from "../src/testlogins";
import { EMP_CLEAN_FROM_MS, cleanAccountEmail, normEmpFor } from "../src/ids";
import { normId, badIdMessage } from "../src/people";
import { world, T_NEW, dev, j, mob } from "./t30-kit";
const GAME = "T41-1";
let W: ReturnType<typeof world>;
beforeEach(() => { W = world(T_NEW); });
afterEach(() => W.restore());

describe("account e-mails refuse inner spaces and full-width at-signs", () => {
  test("isTestLogin: the three plain addresses are test logins (upper case and outer spaces are fine)", () => {
    for (const e of ["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in", "DEMO1@XYZ.IN", "  demo2@xyz.in  ", "\tDemo3@Xyz.In\n"]) expect([e, isTestLogin(e)]).toEqual([e, true]);
    expect([...TEST_LOGINS].sort()).toEqual(["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]);
  });
  test("isTestLogin('demo 1＠xyz.in') is false, and so is every other repaired spelling", () => {
    for (const e of ["demo 1＠xyz.in", "demo1＠xyz.in", "demo 1@xyz.in", "demo1 @xyz.in", "demo1@ xyz.in", "demo1@xyz .in", "demo1@xyz.in x", "ｄｅｍｏ１@xyz.in", "demo1@xyz.in​", "de​mo1@xyz.in", "demo1 @xyz.in", "demo1@xyz。in", "demo1＠ｘｙｚ.in", "", "demo4@xyz.in", "demo1@xyz.in.evil"]) expect([e, isTestLogin(e)]).toEqual([e, false]);
    for (const x of [undefined, null, 0, {}] as any[]) expect(isTestLogin(x)).toBe(false);
  });
  test("cleanAccountEmail only trims and lower-cases: an inner space and the full-width ＠ stay, so the address cannot match", () => {
    expect(cleanAccountEmail("  Demo1@Xyz.In ")).toBe("demo1@xyz.in");
    for (const e of ["demo 1＠xyz.in", "demo1＠xyz.in", "demo 1@xyz.in", "ｄemo1@xyz.in"]) expect(cleanAccountEmail(e)).toBe(e.toLowerCase()); // nothing repaired
    expect(cleanAccountEmail("demo1＠xyz.in")).not.toBe("demo1@xyz.in");
  });
  test("the sign-in door answers 400 for demo 1＠xyz.in and makes no account or key (TEST mode, code 123456 would otherwise open it)", async () => {
    for (const [i, e] of ["demo 1＠xyz.in", "demo1＠xyz.in", "demo 1@xyz.in"].entries()) {
      const r = await W.call("POST", "/api/auth/verify", { email: e, code: "123456" }, undefined, W.now, `9.9.9.${i + 1}`); expect([e, r.status]).toEqual([e, 400]); expect((await j(r)).token).toBeUndefined();
    }
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(0);
  });
});

describe("the ID kind and the verify mode lock once anyone holding an ID hash is listed or has joined", () => {
  // OWNER RULE: refused with 409 and code id-kind-locked. Sentence: '...different kind of ID.' when the kind changes; '...different way of asking for IDs.' when only verify changes.
  const KIND = "You already have people listed. Start a new game to use a different kind of ID.", WAY = "You already have people listed. Start a new game to use a different way of asking for IDs.";
  const patch = (key: string, body: Record<string, unknown>) => W.call("PATCH", `/api/z/${GAME}/settings`, body, key);
  const count = (t: "person" | "participant") => W.raw.prepare(`SELECT COUNT(*) c FROM ${t} WHERE eid = ?`).get(GAME).c as number;
  const shown = async (key: string) => { const s = await j(await W.call("GET", `/api/z/${GAME}/summary`, undefined, key)); return { verify: s.verify, idKind: s.idKind }; };
  const changes: [Record<string, unknown>, string][] = [[{ idKind: "email" }, KIND], [{ verify: "both" }, WAY], [{ verify: "either" }, WAY], [{ verify: "mobile" }, WAY], [{ idKind: "email", verify: "both" }, KIND]];
  const listed = async () => { const g = await W.game(GAME, { who: "list", verify: "id" }); expect((await W.call("POST", `/api/z/${GAME}/people`, { people: [{ name: "Asha Demo", empId: "1B-678" }] }, g.key)).status).toBe(200); expect([count("person"), count("participant")]).toEqual([1, 0]); return g; };
  const joined = async () => { const g = await W.game(GAME, { verify: "id" }); expect((await W.join(GAME, { name: "Sam Demo", phone: mob(5), device: dev(5) })).status).toBe(200); W.raw.prepare("DELETE FROM person WHERE eid = ?").run(GAME); expect([count("person"), count("participant")]).toEqual([0, 1]); return g; }; // ONLY the participant row is left
  test("with nobody on the game, both can change (and change back)", async () => {
    const g = await W.game(GAME, { who: "list", verify: "id" }); expect(count("person") + count("participant")).toBe(0);
    expect((await patch(g.key, { idKind: "email" })).status).toBe(200); expect(await shown(g.key)).toEqual({ verify: "id", idKind: "email" });
    expect((await patch(g.key, { verify: "both" })).status).toBe(200); expect((await patch(g.key, { idKind: "emp", verify: "mobile" })).status).toBe(200); expect(await shown(g.key)).toEqual({ verify: "mobile", idKind: "emp" });
  });
  test("a LISTED person: the refusal sentence is the owner's (kind sentence for a kind change, 'way of asking' for verify only) and nothing changes", async () => {
    const g = await listed(); const before = await shown(g.key);
    for (const [body, msg] of changes) { const b = await j(await patch(g.key, body)); expect([JSON.stringify(body), b.error]).toEqual([JSON.stringify(body), msg]); }
    expect(await shown(g.key)).toEqual(before);
  });
  test("a JOINED person (participant row only): same sentences, nothing changes", async () => {
    const g = await joined(); const before = await shown(g.key);
    for (const [body, msg] of changes.filter(([b]) => !("verify" in b && b.verify === "either"))) { const b = await j(await patch(g.key, body)); expect([JSON.stringify(body), b.error]).toEqual([JSON.stringify(body), msg]); }
    expect(await shown(g.key)).toEqual(before);
  });
  test("OWNER RULE status and code: a LISTED person -> 409 id-kind-locked", async () => {
    const g = await listed();
    for (const [body] of changes) { const r = await patch(g.key, body); const b = await j(r); expect([JSON.stringify(body), r.status, b.code]).toEqual([JSON.stringify(body), 409, "id-kind-locked"]); }
  });
  test("OWNER RULE status and code: a JOINED person -> 409 id-kind-locked", async () => {
    const g = await joined();
    for (const body of [{ idKind: "email" }, { verify: "both" }, { verify: "mobile" }]) { const r = await patch(g.key, body); const b = await j(r); expect([JSON.stringify(body), r.status, b.code]).toEqual([JSON.stringify(body), 409, "id-kind-locked"]); }
  });
  test("an Email ID game locks the other way too (email -> employee ID refused once someone is listed): 409 id-kind-locked", async () => {
    const g = await W.game(GAME, { who: "list", verify: "id", settings: { idKind: "email" } });
    expect((await W.call("POST", `/api/z/${GAME}/people`, { people: [{ name: "Asha Demo", empId: "asha@demo-test.invalid" }] }, g.key)).status).toBe(200);
    const r = await patch(g.key, { idKind: "emp" }); const b = await j(r); expect(b.error).toBe(KIND); expect([r.status, b.code]).toEqual([409, "id-kind-locked"]);
  });
  test("OWNER RULE: only someone HOLDING AN ID HASH locks; a person listed by mobile number alone (verify 'mobile') holds none, so the kind can still be set", async () => {
    const g = await W.game(GAME, { who: "list", verify: "mobile" });
    expect((await W.call("POST", `/api/z/${GAME}/people`, { people: [{ name: "Asha Demo", phone: mob(3) }] }, g.key)).status).toBe(200); expect(count("person")).toBe(1);
    const r = await patch(g.key, { idKind: "email" }); expect(r.status).toBe(200);
  });
  test("the same value is allowed (the console resends it on every save), and other settings still save", async () => {
    const g = await W.game(GAME, { who: "list", verify: "id" });
    await W.call("POST", `/api/z/${GAME}/people`, { people: [{ name: "Asha Demo", empId: "1B678" }] }, g.key);
    expect((await patch(g.key, { verify: "id", idKind: "emp" })).status).toBe(200); expect((await patch(g.key, { cap: 80 })).status).toBe(200);
    expect((await j(await W.call("GET", `/api/z/${GAME}/summary`, undefined, g.key))).limit).toBe(80);
  });
});

describe("EMP_CLEAN_FROM_MS is a far-future placeholder until the release session sets it", () => {
  test("it is 1 Jan 2099 (UTC) or later, and a game created today keeps the old rule on both the cleaner and the wire", async () => {
    expect(EMP_CLEAN_FROM_MS).toBeGreaterThanOrEqual(Date.UTC(2099, 0, 1)); expect(EMP_CLEAN_FROM_MS).toBeGreaterThan(Date.now() + 70 * 365 * 86_400_000 - 1e12);
    const today = Date.now();
    expect(normEmpFor("1b-678", today)).toBe("1B-678"); expect(normEmpFor("1B 678", today)).toBe("1B678"); expect(normEmpFor("1B*678", today)).toBeNull(); // OLD rule: dashes kept, other symbols refused
    expect(normEmpFor("1b-678", EMP_CLEAN_FROM_MS)).toBe("1B678"); // the new rule begins exactly at the constant
    expect(normId("1b-678", "emp", today)).toBe("1B-678"); expect(normId("1b-678", "emp", EMP_CLEAN_FROM_MS)).toBe("1B678");
    const L = world(today); try { await L.game(GAME, { verify: "id" }); const r = await L.join(GAME, { name: "Ravi Demo", empId: "7a-9", device: dev(8) }); expect(r.status).toBe(403); expect((await j(r)).code).toBe("waiting"); // not on a list: waits; the stored ID is the old form
      expect(JSON.stringify(L.raw.prepare("SELECT * FROM waiting").all())).toBeDefined(); } finally { L.restore(); }
  });
  test("the refusal sentence for an e-mail in an employee-ID box follows the same placeholder (old games say the plain sentence)", () => {
    const m = "demo1@demo-test.invalid";
    expect(badIdMessage(m, "emp", Date.now())).toBe("An employee ID has letters and numbers only (up to 30)."); // today's game: old rule, no e-mail sentence
    expect(badIdMessage(m, "emp", EMP_CLEAN_FROM_MS)).toBe("This looks like an Email ID. This game asks for an employee ID: letters and numbers only.");
    expect(badIdMessage("a@b.co", "email", EMP_CLEAN_FROM_MS)).toBe("Please check your Email ID. It looks incomplete.");
  });
});
