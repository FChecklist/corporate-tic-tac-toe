// Phase 4: "Continue with Google" (docs/ROLES_AND_CONSOLE_SPEC_4.md section C item 1, docs/GOOGLE_SIGNIN_SETUP.md). Google is replaced by a fake signing key (google-fake.ts): no test calls Google.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { setGoogleKeyProvider, verifyGoogleCredential } from "../src/google";
import { makeD1 } from "./d1-sqlite";
import { CLIENT_ID, claims, makeIdp, trust, type Idp } from "./google-fake";

const T = Date.UTC(2026, 9, 8, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let idp: Idp; let ip = 0;
const realFetch = globalThis.fetch; let googleCalls = 0;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, ipAddr = "8.8.8.8") =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ipAddr, ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const google = (credential: string, intent = "signup", extra: Record<string, unknown> = {}, ipAddr = "8.8.8.8") => call("POST", "/api/auth/google", { credential, intent, ...extra }, undefined, T, ipAddr);
const mailsTo = (to: string) => raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(to) as { subject: string; body: string }[];

beforeEach(async () => {
  const d = makeD1(); raw = d.raw; googleCalls = 0; idp = await makeIdp(); trust(idp);
  (globalThis as any).fetch = async (u: string) => { if (/google/i.test(String(u))) googleCalls++; return new Response("{}", { status: 404 }); };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "http://x", GOOGLE_CLIENT_ID: CLIENT_ID } as PayEnv;
});
afterEach(() => { globalThis.fetch = realFetch; setGoogleKeyProvider(); });

describe("configuration: no client id, no button, no route", () => {
  test("GET /api/auth/config says the client id, or null; POST /api/auth/google answers 404 when none is set", async () => {
    expect(await j(await call("GET", "/api/auth/config"))).toEqual({ google: CLIENT_ID });
    delete env.GOOGLE_CLIENT_ID;
    expect(await j(await call("GET", "/api/auth/config"))).toEqual({ google: null });
    const r = await google(await idp.sign(claims("a@acme.com", T)));
    expect(r.status).toBe(404);
    env.GOOGLE_CLIENT_ID = "   "; expect((await j(await call("GET", "/api/auth/config"))).google).toBeNull();
  });
});

describe("the token is really checked", () => {
  test("a good token verifies, and returns the lower-cased e-mail only", async () => {
    const v = await verifyGoogleCredential(env, await idp.sign(claims("Sam@Acme.COM", T, { name: "Sam", picture: "https://x/p.png" })), T);
    expect(v).toEqual({ ok: true, email: "sam@acme.com" });
  });
  test("every way a token can be wrong is refused: bad signature, other key, unknown key id, wrong issuer, wrong client, expired, future, e-mail not verified, no e-mail, none/HS256, garbage", async () => {
    const other = await makeIdp("fake-kid-1"); // same key id, different private key
    const good = await idp.sign(claims("a@acme.com", T));
    const [h, p, s] = good.split("."); const forgedPayload = Buffer.from(JSON.stringify(claims("boss@bigco.com", T))).toString("base64url");
    const cases: Array<[string, string, string]> = [
      ["tampered payload", `${h}.${forgedPayload}.${s}`, "signature"], ["signed by another key", await other.sign(claims("a@acme.com", T)), "signature"],
      ["unknown key id", await idp.sign(claims("a@acme.com", T), { kid: "nope" }), "key"],
      ["wrong issuer", await idp.sign(claims("a@acme.com", T, { iss: "https://evil.example" })), "claims"], ["wrong audience", await idp.sign(claims("a@acme.com", T, { aud: "someone-else.apps.googleusercontent.com" })), "claims"],
      ["expired", await idp.sign(claims("a@acme.com", T, { exp: Math.floor(T / 1000) - 1 })), "expired"], ["issued in the future", await idp.sign(claims("a@acme.com", T, { iat: Math.floor(T / 1000) + 3600 })), "claims"],
      ["e-mail not verified", await idp.sign(claims("a@acme.com", T, { email_verified: false })), "unverified"], ["no e-mail", await idp.sign(claims("a@acme.com", T, { email: undefined })), "claims"],
      ["alg none", `${Buffer.from(JSON.stringify({ alg: "none", kid: idp.kid })).toString("base64url")}.${p}.`, "format"], ["alg HS256", await idp.sign(claims("a@acme.com", T), { alg: "HS256" }), "format"],
      ["garbage", "not.a.token!", "format"], ["empty", "", "format"],
    ];
    for (const [why, token, reason] of cases) { const v = await verifyGoogleCredential(env, token, T); expect([why, v.ok, (v as any).why]).toEqual([why, false, reason]); }
    expect(await verifyGoogleCredential(env, 12345, T)).toEqual({ ok: false, why: "format" });
  });
  test("the signing keys are fetched once and kept: a second token does not ask again, and an unknown key id does not make the Worker hammer Google", async () => {
    let asked = 0; setGoogleKeyProvider(async () => { asked++; return [idp.jwk]; });
    for (let i = 0; i < 3; i++) expect((await verifyGoogleCredential(env, await idp.sign(claims("a@acme.com", T)), T + i)).ok).toBe(true);
    expect(asked).toBe(1);
    for (let i = 0; i < 4; i++) await verifyGoogleCredential(env, await idp.sign(claims("a@acme.com", T), { kid: "other" + i }), T + 10_000 + i);
    expect(asked).toBe(1); // inside the 5-minute floor
  });
});

describe("POST /api/auth/google does what the e-mail code does", () => {
  test("sign up with a new e-mail makes the Organizer account, the console key works, and the AI link goes out in the dedicated mail", async () => {
    const r = await google(await idp.sign(claims("new@acme.com", T)));
    expect(r.status).toBe(200); const b = await j(r);
    expect(b).toMatchObject({ ok: true, created: true }); expect(b.token).toMatch(/^cbk_[0-9a-f]{48}$/); expect(b.aiKey).toMatch(/^cba_/); expect(b.aiMessage).toContain(b.aiKey);
    expect((await j(await call("GET", "/api/whoami", undefined, b.token))).kind).toBe("master");
    expect(mailsTo("new@acme.com").some((m) => /AI work link/i.test(m.subject))).toBe(true);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_email").get() as any).c).toBe(1);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_terms").get() as any).c).toBe(1);
  });
  test("an existing account signs in (with either intent): a fresh console key, no second account, no AI key in the answer", async () => {
    const first = await j(await google(await idp.sign(claims("old@acme.com", T))));
    for (const intent of ["signin", "signup"]) {
      const r = await j(await google(await idp.sign(claims("OLD@acme.com", T)), intent));
      expect(r).toMatchObject({ ok: true, created: false }); expect(r.token).not.toBe(first.token); expect(r.aiKey).toBeUndefined();
      expect((await j(await call("GET", "/api/whoami", undefined, r.token))).kind).toBe("master");
    }
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_email").get() as any).c).toBe(1);
  });
  test("signing in with an e-mail that has no account is a calm 404 with a code, and makes nothing", async () => {
    const r = await google(await idp.sign(claims("nobody@acme.com", T)), "signin");
    expect(r.status).toBe(404); expect((await j(r)).code).toBe("no-account");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_email").get() as any).c).toBe(0);
  });
  test("a bad token answers 400 'google-failed' and creates nothing; an unknown intent is refused", async () => {
    const r = await google(await idp.sign(claims("x@acme.com", T, { aud: "other" })));
    expect(r.status).toBe(400); expect((await j(r)).code).toBe("google-failed");
    expect((await google(await idp.sign(claims("x@acme.com", T)), "admin")).status).toBe(400);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_key").get() as any).c).toBe(0);
  });
  test("the same limits as the e-mail sign-in: 20 failures from one network then 429; new accounts per network per day", async () => {
    for (let i = 0; i < 20; i++) expect((await google("a.b.c", "signin", {}, "6.6.6.6")).status).toBe(400);
    expect((await google(await idp.sign(claims("ok@acme.com", T)), "signup", {}, "6.6.6.6")).status).toBe(429);
    expect((await google(await idp.sign(claims("ok@acme.com", T)), "signup", {}, "6.6.6.7")).status).toBe(200); // another network is not affected
    for (let i = 0; i < 10; i++) expect((await google(await idp.sign(claims(`n${i}@acme.com`, T)), "signup", {}, "6.6.6.8")).status).toBe(200);
    const r = await google(await idp.sign(claims("n11@acme.com", T)), "signup", {}, "6.6.6.8");
    expect(r.status).toBe(429); expect((await j(r)).error).toMatch(/Too many/);
  });
  test("it stores only the e-mail: nothing else from the token is kept, and Google is never called", async () => {
    await google(await idp.sign(claims("kept@acme.com", T, { name: "Secret Name", picture: "https://x/me.png", sub: "SUB-999", given_name: "Secret" })));
    const all = JSON.stringify([raw.prepare("SELECT * FROM kv").all(), raw.prepare("SELECT * FROM organizer_key").all(), raw.prepare("SELECT * FROM organizer_email").all(), raw.prepare("SELECT * FROM outbox").all()]);
    for (const leak of ["Secret", "SUB-999", "me.png", "kept@acme.com"].slice(0, 3)) expect(all).not.toContain(leak);
    expect(googleCalls).toBe(0);
  });
});
