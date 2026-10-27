// Demo passes: a secret link that gives the account opening it ONE free game (Rs 0) of up to a set size. One to one, nothing public, no payment.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEMO_PASSES } from "../src/worker";
import { T, call, create, j, keyH, one, organizer, publish, q, reset, restore, uid } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const TOK = "0123456789abcdef0123456789abcdef", TOK2 = "fedcba9876543210fedcba9876543210";
const arm = async () => { DEMO_PASSES.push({ hash: await sha("dpass|" + TOK), cap: 100, label: "t100" }, { hash: await sha("dpass|" + TOK2), cap: 250, label: "t250" }); };

describe("demo pass", () => {
  test("a signed-in organizer who uses the link gets one free game of up to 100 people: it needs no payment and starts as a paid, published game", async () => {
    await arm(); const o = await organizer();
    const r = await call("POST", "/api/pass", { token: TOK }, keyH(o.key)); expect(r.status).toBe(200); expect(await j(r)).toEqual({ ok: true, cap: 100 });
    expect(one("SELECT COUNT(*) AS c FROM entitlement WHERE org IS NOT NULL AND payment_id='demo-pass' AND pack=100").c).toBe(1);
    const id = uid(); const c = await create(o.key, id, { cap: 100 }); expect(c.status).toBe(200);
    expect(one("SELECT pack FROM engagement WHERE id=?", id).pack).toBe(100); // not a draft: the free pack was used
    expect((await publish(o.key, id)).status).toBe(200);
    const again = await create(o.key, uid(), { cap: 100 }); expect(again.status).toBe(200); expect(one("SELECT COUNT(*) AS c FROM engagement WHERE pack=0").c).toBe(1); // only the first was free: the second is an ordinary draft
  });
  test("the 250 link gives up to 250 people", async () => {
    await arm(); const o = await organizer();
    expect(await j(await call("POST", "/api/pass", { token: TOK2 }, keyH(o.key)))).toEqual({ ok: true, cap: 250 });
    const id = uid(); expect((await create(o.key, id, { cap: 250 })).status).toBe(200); expect(one("SELECT pack FROM engagement WHERE id=?", id).pack).toBe(250);
  });
  test("a link works once: the same account may open it again (nothing more is given), another account is told it is taken", async () => {
    await arm(); const a = await organizer(), b = await organizer();
    expect((await call("POST", "/api/pass", { token: TOK }, keyH(a.key))).status).toBe(200);
    const again = await call("POST", "/api/pass", { token: TOK }, keyH(a.key)); expect(again.status).toBe(200); expect((await j(again)).again).toBe(true);
    expect(one("SELECT COUNT(*) AS c FROM entitlement WHERE payment_id='demo-pass'").c).toBe(1);
    const other = await call("POST", "/api/pass", { token: TOK }, keyH(b.key)); expect(other.status).toBe(409); expect((await j(other)).error).toMatch(/already been used/);
    expect(one("SELECT COUNT(*) AS c FROM entitlement WHERE payment_id='demo-pass'").c).toBe(1);
  });
  test("an unknown, malformed or missing link, nobody signed in, the AI link and a wrong method are all refused; nothing is given", async () => {
    await arm(); const o = await organizer();
    for (const t of ["ffffffffffffffffffffffffffffffff", "short", "", "0123456789abcdef0123456789abcdeg", undefined]) { const r = await call("POST", "/api/pass", { token: t }, keyH(o.key)); expect([404, 400].includes(r.status)).toBe(true); }
    expect((await call("POST", "/api/pass", { token: TOK })).status).toBe(403);
    expect((await call("POST", "/api/pass", { token: TOK }, o.aiH)).status).toBe(403);
    expect((await call("GET", "/api/pass", undefined, keyH(o.key))).status).not.toBe(200);
    expect(q("SELECT * FROM entitlement WHERE payment_id='demo-pass'").length).toBe(0);
  });
  test("the links themselves are not in the code or the repository: only hashes", async () => {
    const { readFileSync } = await import("node:fs"); const w = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(DEMO_PASSES.length).toBeGreaterThanOrEqual(0); for (const x of DEMO_PASSES.filter((d) => d.label.includes("-"))) expect(x.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(w).toMatch(/dpass\|/);
  });
});

describe("demo pass kept with the e-mail address while the person signs in", () => {
  const MAIL = "prospect@acme.com";
  const grants = () => one("SELECT COUNT(*) AS c FROM entitlement WHERE payment_id='demo-pass'").c;
  test("a NEW person who comes through the link gets the free game at once, in the sign-up itself (whatever browser she uses later)", async () => {
    reset({ TEST_MODE: "1" } as any); await arm();
    const r = await call("POST", "/api/start", { email: MAIL, pass: TOK }); expect(r.status).toBe(200); expect((await j(r)).token).toMatch(/^cbk_/);
    expect(grants()).toBe(1); expect(one("SELECT pack FROM entitlement WHERE payment_id='demo-pass'").pack).toBe(100);
  });
  test("an EXISTING person: the link is held with her e-mail, and the code she types (or the one-click link) gives her the free game, in any browser", async () => {
    reset({ TEST_MODE: "1" } as any); await arm(); const o = await organizer();
    const mail = o.email; const ask = await j(await call("POST", "/api/auth/email", { email: mail, pass: TOK })); expect(ask.ok).toBe(true);
    expect(grants()).toBe(0); // nothing is given before the person has proved the address
    const v = await call("POST", "/api/auth/verify", { email: mail, code: ask.devCode }); expect(v.status).toBe(200);
    expect(grants()).toBe(1); expect(one("SELECT pack FROM entitlement WHERE payment_id='demo-pass'").pack).toBe(100);
    expect(q("SELECT k FROM kv WHERE k LIKE 'loginpass/%'").length).toBe(0); // used and forgotten
  });
  test("the one-click link in the e-mail does the same", async () => {
    reset({ TEST_MODE: "1" } as any); await arm(); const o = await organizer();
    const ask = await j(await call("POST", "/api/auth/email", { email: o.email, pass: TOK2 })); expect(ask.devToken).toBeTruthy();
    const l = await call("POST", "/api/auth/link", { token: ask.devToken }); expect(l.status).toBe(200); expect(grants()).toBe(1); expect(one("SELECT pack FROM entitlement WHERE payment_id='demo-pass'").pack).toBe(250);
  });
  test("a made-up secret is not kept, and a used link is not given twice", async () => {
    reset({ TEST_MODE: "1" } as any); await arm(); const a = await organizer(), b = await organizer();
    await call("POST", "/api/auth/email", { email: a.email, pass: "ffffffffffffffffffffffffffffffff" }); expect(q("SELECT k FROM kv WHERE k LIKE 'loginpass/%'").length).toBe(0);
    const x = await j(await call("POST", "/api/auth/email", { email: a.email, pass: TOK })); await call("POST", "/api/auth/verify", { email: a.email, code: x.devCode }); expect(grants()).toBe(1);
    const y = await j(await call("POST", "/api/auth/email", { email: b.email, pass: TOK })); await call("POST", "/api/auth/verify", { email: b.email, code: y.devCode }); expect(grants()).toBe(1); // taken: the second person gets nothing
  });
});
