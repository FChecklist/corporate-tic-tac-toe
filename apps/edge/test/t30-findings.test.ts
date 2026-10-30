// TEST AUTHOR 30 Oct 2026. KNOWN PRODUCT FINDINGS (docs/TEST_FINDINGS.md): RED on purpose until the coder fixes the product; kept apart so the other t30 files can be green and be break-checked.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { world, T_NEW } from "./t30-kit";
let W: ReturnType<typeof world>;
beforeEach(() => { W = world(T_NEW); });
afterEach(() => W.restore());
describe("the Organizer's own sign-up and sign-in e-mail (/api/start, /api/auth/email)", () => {
  // PRODUCT FINDING F-1 (docs/TEST_FINDINGS.md): worker.ts /api/start and /api/auth/email only do trim().toLowerCase(), not cleanEmail (NFKC, inner spaces), so these spellings are refused with 400.
  test("F-1: a full-width ＠ or an inner space is read as the same address as the plain one (checklist A3), not refused", async () => {
    const out: Record<string, number> = {}; let n = 10;
    for (const m of ["DEMO6＠DEMO-TEST.INVALID", "demo6 @demo-test.invalid", "demo 6@demo-test.invalid"]) { out[m] = (await W.call("POST", "/api/start", { email: m }, undefined, W.now, `5.5.6.${++n}`)).status; }
    expect(out).toEqual({ "DEMO6＠DEMO-TEST.INVALID": 200, "demo6 @demo-test.invalid": 200, "demo 6@demo-test.invalid": 200 });
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(1);
  });
  test("F-1: the same on the sign-in door /api/auth/email (an existing account is found by the full-width spelling)", async () => {
    await W.call("POST", "/api/start", { email: "demo6@demo-test.invalid" }, undefined, W.now, "5.5.7.1");
    const r = await W.call("POST", "/api/auth/email", { email: "DEMO6＠DEMO-TEST.INVALID", consent: { v: "x", boxes: [] } }, undefined, W.now, "5.5.7.2");
    expect(r.status).not.toBe(400);
  });
});
