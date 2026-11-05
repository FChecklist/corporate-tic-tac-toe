// TEST AUTHOR. Wire: Google sign-in and Host setup read an ACCOUNT e-mail in one form: trimmed and lower case only (ids.ts cleanAccountEmail); inner spaces and a full-width at-sign are refused (owner rule, fix pass 1.4.1). Google is the fake signing key (google-fake.ts); nothing leaves the machine.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setGoogleKeyProvider, verifyGoogleCredential } from "../src/google";
import { CLIENT_ID, claims, makeIdp, trust, type Idp } from "./google-fake";
import { world, T_NEW, j } from "./t30-kit";
let W: ReturnType<typeof world>; let idp: Idp;
beforeEach(async () => { W = world(T_NEW, { GOOGLE_CLIENT_ID: CLIENT_ID }); idp = await makeIdp(); trust(idp); });
afterEach(() => { W.restore(); setGoogleKeyProvider(); });
const google = (credential: string, intent = "signup", extra: Record<string, unknown> = {}) => W.call("POST", "/api/auth/google", { credential, intent, ...extra }, undefined, W.now, "8.8.8.8");

describe("Google sign-in reads the e-mail in one form", () => {
  test("a verified token with upper case or outer spaces returns demo1@demo-test.invalid; an inner space or a full-width ＠ is refused", async () => {
    for (const raw of ["Demo1@Demo-Test.Invalid", " DEMO1@demo-test.invalid "]) {
      const v = await verifyGoogleCredential(W.env, await idp.sign(claims(raw, W.now)), W.now); expect([raw, v]).toEqual([raw, { ok: true, email: "demo1@demo-test.invalid" }]);
    }
    for (const raw of ["demo1 @demo-test.invalid", "demo1＠demo-test.invalid"]) {
      const v = await verifyGoogleCredential(W.env, await idp.sign(claims(raw, W.now)), W.now); expect([raw, v.ok]).toEqual([raw, false]);
    }
  });
  test("sign up with one spelling then sign in with upper case is the SAME account; a full-width ＠ does not find it and makes no second Organizer", async () => {
    const a = await j(await google(await idp.sign(claims("demo2@demo-test.invalid", W.now)))); expect(a).toMatchObject({ ok: true, created: true });
    const b = await j(await google(await idp.sign(claims("DEMO2@DEMO-TEST.INVALID", W.now)), "signin")); expect(b).toMatchObject({ ok: true, created: false });
    const c = await google(await idp.sign(claims("DEMO2＠DEMO-TEST.INVALID", W.now)), "signin"); expect(c.status).not.toBe(200); expect((await j(c)).code).toBe("google-failed");
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
