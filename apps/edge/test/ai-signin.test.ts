// The sign-in e-mail with three ways in: two single-use one-click links (10 minutes) and the 6-digit code; a mail scanner opening a link consumes nothing.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { SIGNIN_SUBJECT, signInMail } from "../src/mails";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const MIN = 60_000;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const outbox = () => raw.prepare("SELECT to_addr, subject, body FROM outbox ORDER BY id").all() as { to_addr: string; subject: string; body: string }[];
const LEAK = /cba_[0-9a-f]|cbh_[0-9a-f]|\/ai\//;
const ORIGIN = "https://bingo.test";

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: ORIGIN, DATA_KEY: "test-data-key", TEST_MODE: "1" };
});
async function account() { const x = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" })); return { ai: x.aiKey as string, token: x.token as string }; }
async function ask(now = T, ip = "5.5.5.5") { const r = await j(await call("POST", "/api/auth/email", { email: "boss@acme.com" }, { "cf-connecting-ip": ip }, now)); return r as { devCode: string; devToken: string }; }
const link = (t: string, ip = "6.6.6.6", now = T) => call("POST", "/api/auth/link", { token: t }, { "cf-connecting-ip": ip }, now);

describe("the sign-in e-mail", () => {
  test("subject, heading, intro, the three options, the footer, an HTML and a plain-text part; no AI key or paste text anywhere", async () => {
    await account(); const r = await ask();
    const m = outbox().find((x) => x.subject === SIGNIN_SUBJECT)!;
    expect(m.to_addr).toBe("boss@acme.com"); expect(SIGNIN_SUBJECT).toBe("Sign in to Corporate Tic Tac Toe - choose how you want to continue");
    for (const t of ["YOU ARE ALMOST IN", "Choose one way to sign in.", "OPTION 1 - LET YOUR AI DO THE WORK", "Sign in and get my AI work link", "Your AI asks a few questions and sets it all up. You keep payment and publishing.", "OPTION 2 - WORK ON YOUR OWN", "Open my console", "OPTION 3 - SIGN-IN PAGE ALREADY OPEN?", `Type this 6-digit code there: ${r.devCode}`, "It works for 10 minutes.", "If you did not ask for this, ignore it. Do not forward it: it opens your account."]) expect(m.body).toContain(t);
    expect(m.body + m.subject).not.toMatch(LEAK); expect(m.body).not.toMatch(/Corporate Tic Tac Toe account\. I am the owner/);
    expect(m.body).toContain(`${ORIGIN}/signin.html?t=${r.devToken}&go=ai`); expect(m.body).toContain(`${ORIGIN}/signin.html?t=${r.devToken}&go=console`);
    const b = signInMail(ORIGIN, "123456", "ab".repeat(24));
    expect(b.html).toContain("You are almost in"); expect(b.html).toContain("Let your AI do the work"); expect(b.html).toContain("Work on your own"); expect(b.html).toContain("Sign-in page already open?"); expect(b.html).toContain("123456");
    expect(b.html + b.text).not.toMatch(LEAK);
    expect([...b.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1]).filter((h) => !/^mailto:|legal.html$/.test(h!))).toEqual([`${ORIGIN}/signin.html?t=${"ab".repeat(24)}&amp;go=ai`, `${ORIGIN}/signin.html?t=${"ab".repeat(24)}&amp;go=console`]);
    expect(env.DB).toBeTruthy();
    expect(JSON.stringify(raw.prepare("SELECT * FROM login_code").all())).not.toContain(r.devToken); // only a hash is kept
  });
  test("an unknown address gets the same answer and no mail", async () => {
    const r = await call("POST", "/api/auth/email", { email: "stranger@nowhere.com" }); expect(r.status).toBe(200); expect((await j(r)).devToken).toBeUndefined();
    expect(outbox().filter((x) => x.subject === SIGNIN_SUBJECT).length).toBe(0);
  });
});

describe("the one-click sign-in link", () => {
  test("opening the link page (a mail scanner's GET) consumes nothing; the POST starts a session once; a second use fails", async () => {
    await account(); const r = await ask();
    for (const path of [`/signin.html?t=${r.devToken}&go=ai`, `/api/auth/link?token=${r.devToken}`]) await call("GET", path); // GET changes nothing
    expect((await call("GET", `/api/auth/link?token=${r.devToken}`)).status).not.toBe(200);
    const row = raw.prepare("SELECT link_hash FROM login_code").get() as any; expect(row.link_hash).toBeTruthy();
    const ok = await link(r.devToken); const x = await j(ok);
    expect(ok.status).toBe(200); expect(x.token).toMatch(/^cbk_[0-9a-f]{48}$/);
    expect((await call("GET", "/api/whoami", undefined, { "x-organizer": x.token })).status).toBe(200); expect(await j(await call("GET", "/api/whoami", undefined, { "x-organizer": x.token }))).toEqual({ kind: "master" });
    expect((await call("GET", "/api/history", undefined, { "x-organizer": x.token })).status).toBe(200);
    const again = await link(r.devToken); expect(again.status).toBe(400);
    expect((await call("POST", "/api/auth/verify", { email: "boss@acme.com", code: r.devCode })).status).toBe(400); // the code died with the link
  });
  test("the 6-digit code still works, and it kills the link (same expiry, one sign-in)", async () => {
    await account(); const r = await ask();
    const v = await call("POST", "/api/auth/verify", { email: "boss@acme.com", code: r.devCode }); expect(v.status).toBe(200); expect((await j(v)).token).toMatch(/^cbk_/);
    expect((await link(r.devToken)).status).toBe(400);
  });
  test("expiry: valid at 9 min 59 s, refused at 10 min 1 s; the code shares it", async () => {
    await account(); const r = await ask();
    expect((await link(r.devToken, "6.6.6.6", T + 10 * MIN + 1000)).status).toBe(400);
    expect((await call("POST", "/api/auth/verify", { email: "boss@acme.com", code: r.devCode }, {}, T + 10 * MIN + 1000)).status).toBe(400);
    const r2 = await ask(T + 20 * MIN); expect((await link(r2.devToken, "6.6.6.6", T + 20 * MIN + 9 * MIN + 59_000)).status).toBe(200);
  });
  test("a new request replaces the old link; wrong, malformed and missing tokens are refused alike and reveal nothing", async () => {
    await account(); const a = await ask(T), b = await ask(T + 1000);
    expect((await link(a.devToken)).status).toBe(400); // replaced
    for (const t of ["0".repeat(48), "zz", "", "x".repeat(200)]) { const r = await link(t); expect(r.status).toBe(400); expect(JSON.stringify(await r.json())).not.toMatch(/boss|cbk_|cba_/); }
    expect((await call("POST", "/api/auth/link", {})).status).toBe(400);
    expect((await link(b.devToken)).status).toBe(200);
  });
  test("destinations: the AI button goes to the AI-link page, the console button to the console; both carry the same single-use token", async () => {
    await account(); const r = await ask();
    const m = outbox().find((x) => x.subject === SIGNIN_SUBJECT)!.body;
    expect(m).toMatch(/signin\.html\?t=[0-9a-f]{48}&go=ai/); expect(m).toMatch(/signin\.html\?t=[0-9a-f]{48}&go=console/);
    expect(new Set([...m.matchAll(/t=([0-9a-f]{48})&go=/g)].map((x) => x[1])).size).toBe(1); expect(m).toContain(r.devToken);
  });
  test("rate limits: at most 5 mails an hour per address (as before); at most 20 bad link tries a day per network; good tries still work from elsewhere", async () => {
    await account();
    for (let i = 0; i < 5; i++) await ask(T + i);
    expect((await call("POST", "/api/auth/email", { email: "boss@acme.com" }, {}, T + 10)).status).toBe(429);
    for (let i = 0; i < 20; i++) expect((await link("0".repeat(48), "7.7.7.7")).status).toBe(400);
    expect((await link("0".repeat(48), "7.7.7.7")).status).toBe(429);
    const good = await ask(T + 61 * MIN); expect((await link(good.devToken, "7.7.7.7", T + 61 * MIN)).status).toBe(429); // that network is out of tries for the day
    expect((await link(good.devToken, "8.8.8.8", T + 61 * MIN)).status).toBe(200);
  });
});
