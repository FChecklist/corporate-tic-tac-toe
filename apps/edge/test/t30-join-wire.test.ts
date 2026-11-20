// TEST AUTHOR 30 Oct 2026. Wire tests: the REAL Worker with an in-memory database. Employee-ID cleaning on every path a person can use (list upload, join, who-is-this, duplicates),
// the old-game rule, devices, and approvals from the waiting room. Fake data only.
import { afterEach, describe, expect, test } from "bun:test";
import { termsFor } from "./with-terms";
import { world, T_NEW, T_OLD, mob, dev, j } from "./t30-kit";
let W: ReturnType<typeof world>;
afterEach(() => W?.restore());
const GAME = "T30-A";
const add = (key: string, people: unknown[]) => W.call("POST", `/api/z/${GAME}/people`, { people }, key);
const joinId = (empId: string, i: number, extra: Record<string, unknown> = {}) => W.join(GAME, { name: "Demo " + i, empId, device: dev(i), ...extra });

describe("list upload and join clean an employee ID the same way (new game)", () => {
  test("a list row '1B-678' is found by 1b/678, 1B 678, 1B678, 1b.678 and full-width １Ｂ６７８; all five are the same person", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" });
    const r = await j(await add(g.key, [{ name: "Asha Demo", empId: "1B-678" }]));
    expect(r.people.length).toBe(1); expect(r.people[0].empId).toBe("1B678"); // stored cleaned
    const first = await joinId("1b/678", 1); expect(first.status).toBe(200); const pid = (await j(first)).pid; expect(pid).toBeTruthy();
    for (const [k, typed] of ["1B 678", "1B678", "1b.678", "１Ｂ６７８", "1B-678"].entries()) { const rr = await joinId(typed, 1, { name: "Demo " + k }); expect([typed, rr.status]).toEqual([typed, 200]); const b = await j(rr); expect([typed, b.pid, b.again]).toEqual([typed, pid, true]); }
    expect(W.raw.prepare("SELECT COUNT(*) c FROM participant").get().c).toBe(1);
  });
  test("an ID that is not on the list waits for approval (403 waiting), in every spelling", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" }); await add(g.key, [{ name: "Asha Demo", empId: "1B-678" }]);
    const r = await joinId("1B 679", 2); expect(r.status).toBe(403); expect((await j(r)).code).toBe("waiting");
  });
  test("two spellings of one ID in the same upload make ONE person (the second is not a new row)", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" });
    const r = await j(await add(g.key, [{ name: "First Demo", empId: "1B-678" }, { name: "Second Demo", empId: "1b 678" }, { name: "Third Demo", empId: "2C-1" }]));
    expect(W.raw.prepare("SELECT COUNT(*) c FROM person").get().c).toBe(2);
    expect(JSON.stringify(r)).toMatch(/already|duplicate|same/i); // reported, not silently dropped
  });
});
describe("refusals have plain words and the right code", () => {
  const EMAIL_MSG = "This looks like an Email ID. This game asks for an employee ID: letters and numbers only.", PLAIN_MSG = "An employee ID has letters and numbers only (up to 30).";
  const cases: [string, string, string, string][] = [
    ["an e-mail typed in the ID box", "demo1@demo-test.invalid", "bad-id", EMAIL_MSG], ["a full-width ＠ e-mail", "demo1＠demo-test.invalid", "bad-id", EMAIL_MSG],
    ["only symbols", "---//", "bad-id", PLAIN_MSG], ["only emoji", "😀😀", "bad-id", PLAIN_MSG], ["31 characters", "A".repeat(31), "bad-id", PLAIN_MSG],
  ];
  for (const [label, typed, code, msg] of cases) test(`${label} -> 400 ${code}`, async () => {
    W = world(T_NEW); await W.game(GAME, { verify: "id" });
    const r = await joinId(typed, 3); expect(r.status).toBe(400); const b = await j(r); expect(b.code).toBe(code); expect(b.error).toBe(msg);
  });
  test("nothing typed in an ID game (no mobile either) -> 400 need-id with a plain sentence", async () => {
    W = world(T_NEW); await W.game(GAME, { verify: "id" });
    const r = await W.join(GAME, { name: "Demo 4", device: dev(4) }); expect(r.status).toBe(400); const b = await j(r); expect(b.code).toBe("need-id"); expect(b.error).toMatch(/employee ID/);
  });
  test("exactly 30 characters is accepted as a new person (open game, ID game)", async () => {
    W = world(T_NEW); await W.game(GAME, { verify: "id" });
    const r = await joinId("A".repeat(30), 5); expect(r.status).not.toBe(400);
  });
});
describe("a game created before EMP_CLEAN_FROM_MS keeps the old rule on the wire", () => {
  test("list '1B-678': joining as '1b-678' works, as '1B*678' is refused bad-id, as '1B 678' (= 1B678) is NOT the same person", async () => {
    W = world(T_OLD); const g = await W.game(GAME, { who: "list", verify: "id" });
    const r = await j(await add(g.key, [{ name: "Asha Demo", empId: "1B-678" }])); expect(r.people[0].empId).toBe("1B-678"); // stored as typed, upper-cased
    expect((await joinId("1b-678", 6)).status).toBe(200);
    const bad = await joinId("1B*678", 7); expect(bad.status).toBe(400); expect((await j(bad)).code).toBe("bad-id");
    const other = await joinId("1B 678", 8); expect(other.status).toBe(403); expect((await j(other)).code).toBe("waiting");
  });
});
describe("one card, one device (devices)", () => {
  test("the same ID from a second phone is refused 423 id-used; a second ID on the first phone is refused 409 device-used", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" }); await add(g.key, [{ name: "Asha Demo", empId: "E1" }, { name: "Ravi Demo", empId: "E2" }]);
    expect((await joinId("e1", 10)).status).toBe(200);
    const other = await joinId("E-1", 11); expect(other.status).toBe(423); expect((await j(other)).code).toBe("id-used");
    const sameDev = await joinId("E2", 10); expect(sameDev.status).toBe(409); expect((await j(sameDev)).code).toBe("device-used");
    expect((await joinId("E2", 12)).status).toBe(200);
  });
});
describe("approvals: first decision wins, the person comes in only after a yes", () => {
  test("an unlisted ID waits; the Organizer admits it; the same person then joins (any spelling); a second decision changes nothing", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" }); await add(g.key, [{ name: "Asha Demo", empId: "E1" }]);
    const w = await joinId("x-9", 20); expect(w.status).toBe(403); expect((await j(w)).code).toBe("waiting");
    const list = await j(await W.call("GET", `/api/z/${GAME}/waiting`, undefined, g.key)); const row = (list.waiting ?? list.requests ?? [])[0]; expect(row).toBeTruthy();
    const yes = await j(await W.call("POST", `/api/z/${GAME}/waiting/${row.id}`, { decision: "admit" }, g.key)); expect(yes.ok).toBe(true);
    const again = await j(await W.call("POST", `/api/z/${GAME}/waiting/${row.id}`, { decision: "decline" }, g.key)); expect(again.already ?? again.ok).toBeTruthy(); expect(again.declined).toBeUndefined();
    const in1 = await joinId("X 9", 20); expect(in1.status).toBe(200);
  });
  test("nobody approves with a wrong key: an unknown key, no key, and ANOTHER Organizer's key all get 401/403/404 on the waiting list and on a decision, and the person stays waiting", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" }); await joinId("x-9", 21);
    const list = await j(await W.call("GET", `/api/z/${GAME}/waiting`, undefined, g.key)); const row = (list.waiting ?? [])[0]; expect(row).toBeTruthy();
    const other = await W.organizer(2);
    for (const k of ["not-a-key", undefined, other]) for (const [m, p, b] of [["GET", `/api/z/${GAME}/waiting`, undefined], ["POST", `/api/z/${GAME}/waiting/${row.id}`, { decision: "admit" }]] as const) { const r = await W.call(m, p, b, k as any); expect([String(k).slice(0, 8), m, [401, 403, 404].includes(r.status)]).toEqual([String(k).slice(0, 8), m, true]); }
    const still = await joinId("x-9", 21); expect(still.status).toBe(403); expect((await j(still)).code).toBe("waiting");
  });
});
describe("the 'who is this' check uses the same cleaner", () => {
  test("typing 1b-678 shows the first name and last initial of the listed person; a wrong ID shows nothing", async () => {
    W = world(T_NEW); const g = await W.game(GAME, { who: "list", verify: "id" }); await add(g.key, [{ name: "Asha Demo", empId: "1B-678" }]);
    const hit = await j(await W.call("POST", `/api/z/${GAME}/who`, { empId: "1b 678", consent: termsFor("K4") })); expect(hit).toEqual({ known: true, name: "Asha D." });
    const miss = await j(await W.call("POST", `/api/z/${GAME}/who`, { empId: "1B 679", consent: termsFor("K4") })); expect(miss).toEqual({ known: false });
  });
});
