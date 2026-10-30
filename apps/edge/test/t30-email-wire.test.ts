// TEST AUTHOR 30 Oct 2026. Wire: Google sign-in and Host setup use the same e-mail form (ids.ts cleanEmail). Google is the fake signing key (google-fake.ts); nothing leaves the machine.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setGoogleKeyProvider, verifyGoogleCredential } from "../src/google";
import { CLIENT_ID, claims, makeIdp, trust, type Idp } from "./google-fake";
import { world, T_NEW, j } from "./t30-kit";
let W: ReturnType<typeof world>; let idp: Idp;
beforeEach(async () => { W = world(T_NEW, { GOOGLE_CLIENT_ID: CLIENT_ID }); idp = await makeIdp(); trust(idp); });
afterEach(() => { W.restore(); setGoogleKeyProvider(); });
const google = (credential: string, intent = "signup", extra: Record<string, unknown> = {}) => W.call("POST", "/api/auth/google", { credential, intent, ...extra }, undefined, W.now, "8.8.8.8");

describe("Google sign-in reads the e-mail in one form", () => {
  test("a verified token for 'Demo1＠Demo-Test.Invalid' with spaces returns demo1@demo-test.invalid", async () => {
    for (const raw of ["Demo1@Demo-Test.Invalid", " DEMO1@demo-test.invalid ", "demo1 @demo-test.invalid", "demo1＠demo-test.invalid"]) {
      const v = await verifyGoogleCredential(W.env, await idp.sign(claims(raw, W.now)), W.now); expect([raw, v]).toEqual([raw, { ok: true, email: "demo1@demo-test.invalid" }]);
    }
  });
  test("sign up with one spelling then sign in with another is the SAME account (no second Organizer)", async () => {
    const a = await j(await google(await idp.sign(claims("demo2@demo-test.invalid", W.now)))); expect(a).toMatchObject({ ok: true, created: true });
    const b = await j(await google(await idp.sign(claims("DEMO2＠DEMO-TEST.INVALID", W.now)), "signin")); expect(b).toMatchObject({ ok: true, created: false });
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(1);
    expect((await j(await W.call("GET", "/api/whoami", undefined, b.token))).kind).toBe("master");
  });
  test("two different e-mails (demo3, demo4) are two accounts", async () => {
    await google(await idp.sign(claims("demo3@demo-test.invalid", W.now))); await google(await idp.sign(claims("demo4@demo-test.invalid", W.now)));
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(2);
  });
  test("signing in with an e-mail that has no account is a calm 404", async () => { const r = await google(await idp.sign(claims("demo5@demo-test.invalid", W.now)), "signin"); expect(r.status).toBe(404); });
});
describe("the Organizer's own sign-up and sign-in e-mail (/api/start, /api/auth/email)", () => {
  test("upper/lower case mixes of demo6@demo-test.invalid are ONE account", async () => {
    let n = 0; for (const m of ["demo6@demo-test.invalid", "DEMO6@DEMO-TEST.INVALID", "Demo6@Demo-Test.Invalid", "dEMO6@demo-TEST.invalid"]) { const r = await W.call("POST", "/api/start", { email: m }, undefined, W.now, `5.5.5.${++n}`); expect([m, r.status]).toEqual([m, 200]); }
    expect(W.raw.prepare("SELECT COUNT(*) c FROM organizer_email").get().c).toBe(1);
  });
});
describe("Host setup: Google e-mail step", () => {
  const addHost = async (master: string, body: Record<string, unknown>) => j(await W.call("POST", "/api/org/host", { label: "Priya", ...body }, master));
  test("a Host added as demo7@demo-test.invalid finishes the e-mail step with Google as 'DEMO7＠Demo-Test.Invalid'", async () => {
    const master = await W.organizer(8); const h = await addHost(master, { email: "demo7@demo-test.invalid", mobile: "9876500002" });
    const r = await j(await google(await idp.sign(claims("DEMO7@Demo-Test.Invalid", W.now)), "host", { hostKey: h.hostKey }));
    expect(r).toMatchObject({ ok: true, kind: "host", ready: true });
  });
  test("a different e-mail is refused 403 email-mismatch and the Host is not verified", async () => {
    const master = await W.organizer(8); const h = await addHost(master, { email: "demo7@demo-test.invalid", mobile: "9876500002" });
    const r = await google(await idp.sign(claims("demo9@demo-test.invalid", W.now)), "host", { hostKey: h.hostKey }); expect(r.status).toBe(403); expect((await j(r)).code).toBe("email-mismatch");
  });
});
