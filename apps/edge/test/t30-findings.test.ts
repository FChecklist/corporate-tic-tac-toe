// TEST AUTHOR. Findings from the 30 Oct run. F-1 was settled by the OWNER RULE (fix pass 1.4.1): an ACCOUNT e-mail (sign-up, sign-in, Host, Google) is only trimmed and lower-cased; an inner space or a full-width at-sign is REFUSED, never repaired. Only a participant's Email ID removes inner spaces.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { world, T_NEW } from "./t30-kit";
let W: ReturnType<typeof world>;
beforeEach(() => { W = world(T_NEW); });
afterEach(() => W.restore());
describe("the Organizer's own sign-up and sign-in e-mail (/api/start, /api/auth/email)", () => {
  test("F-1 (owner rule): a full-width ＠ or an inner space in an account e-mail is REFUSED (400), and no account is made", async () => {
    const out: Record<string, number> = {}; let n = 10;
    for (const m of ["DEMO6＠DEMO-TEST.INVALID", "demo6 @demo-test.invalid", "demo 6@demo-test.invalid"]) { out[m] = (await W.call("POST", "/api/start", { email: m }, undefined, W.now, `5.5.6.${++n}`)).status; }
    expect(out).toEqual({ "DEMO6＠DEMO-TEST.INVALID": 400, "demo6 @demo-test.invalid": 400, "demo 6@demo-test.invalid": 400 });
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(0);
  });
  test("F-1 (owner rule): the same on the sign-in door /api/auth/email (the full-width spelling does not find the existing account; it is refused 400)", async () => {
    await W.call("POST", "/api/start", { email: "demo6@demo-test.invalid" }, undefined, W.now, "5.5.7.1");
    const r = await W.call("POST", "/api/auth/email", { email: "DEMO6＠DEMO-TEST.INVALID", consent: { v: "x", boxes: [] } }, undefined, W.now, "5.5.7.2");
    expect(r.status).toBe(400);
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(1);
  });
});
