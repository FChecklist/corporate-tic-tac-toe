// The owner's hidden free test accounts (worker.ts OWNER_TEST_FREE): a game up to the allowed size is treated as paid (not a draft); everybody else still gets a draft.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lazyTickReset } from "../src/worker";
import { sentReports } from "../src/pay";
import { OWNER_TEST_FREE } from "../src/worker";
import { W, create, j, one, organizer, reset, restore, uid } from "./param-harness";

beforeEach(() => { reset(); lazyTickReset(); sentReports.length = 0; });
afterEach(restore);

describe("owner test accounts", () => {
  test("the test account makes a 250-person game with no payment (not a draft); a stranger's same game is a draft; a game above the allowed size is a draft", async () => {
    const owner = await organizer("demo1@xyz.in"); const other = await organizer();
    const a = uid("OT"), b = uid("OT"), c = uid("OT");
    const r1 = await j(await create(owner.key, a, { cap: 250 })); expect(r1.draft).toBe(false);
    expect(one("SELECT pack FROM engagement WHERE id=?", a).pack).toBeGreaterThan(0);
    expect(one("SELECT payment_id, eid FROM entitlement WHERE org=?", one("SELECT org FROM engagement WHERE id=?", a).org)).toMatchObject({ payment_id: "owner-test", eid: a });
    const r2 = await j(await create(other.key, b, { cap: 250 })); expect(r2.draft).toBe(true);
    const real = await organizer("raajat.agarwal@gmail.com"); expect((await j(await create(real.key, uid("OT"), { cap: 250 }))).draft).toBe(true); // the owner's real account sees the real unpaid flow
    const r3 = await j(await create(owner.key, c, { cap: 5000 })); expect(r3.draft).toBe(true); // above the owner's allowed size
  });
  test("the list holds only the named accounts, with an end date", () => {
    expect(OWNER_TEST_FREE.map((x) => x.email)).toEqual(["demo1@xyz.in"]); // the owner's real addresses see the real flow
    for (const t of OWNER_TEST_FREE) expect(t.until).toBeGreaterThan(Date.now());
  });
});
