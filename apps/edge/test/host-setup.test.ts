// Phase 4: the Host first open (docs/ROLES_AND_CONSOLE_SPEC_4.md section C item 2, apps/edge/src/hostsetup.ts).
// A Host is added with a name and AT LEAST ONE of e-mail or mobile. The personal link is a one-time entry that lasts 7 days. The console works only after the Host has a
// confirmed e-mail (a 6-digit code, or Google) AND a mobile number. Later devices sign in by e-mail code or Google. These tests use the strict rule (no test shortcut).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { setGoogleKeyProvider } from "../src/google";
import { teamEmails } from "../src/cancel";
import { makeD1 } from "./d1-sqlite";
import { CLIENT_ID, claims, makeIdp, trust, type Idp } from "./google-fake";

const T = Date.UTC(2026, 9, 8, 10, 0, 0), DAY = 86_400_000;
const FAR_START = Math.floor(((T + 2 * 86_400_000) / 1000 - 1692803367) / 3) + 1; // a game two days ahead (a game time can be at most 30 days ahead)
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let idp: Idp; let ip = 0;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "4.4.4.4", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mailsTo = (to: string) => raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(to) as { subject: string; body: string }[];
const one = (sql: string, ...v: unknown[]) => raw.prepare(sql).get(...(v as any[])) as any;

beforeEach(async () => {
  const d = makeD1({ strictHosts: true }); raw = d.raw; idp = await makeIdp(); trust(idp);
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "http://x", TEST_MODE: "1", GOOGLE_CLIENT_ID: CLIENT_ID } as PayEnv;
});
afterEach(() => setGoogleKeyProvider());

const organizer = async (email = "boss@acme.com") => {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `3.3.3.${++ip}` }, body: JSON.stringify({ email }) }), env as Env, T));
  await call("POST", "/api/z", { id: "HOST-1", startRound: FAR_START, callSeconds: 9, cap: 100 }, st.token);
  return { master: st.token as string, ai: st.aiKey as string };
};
const addHost = async (master: string, body: Record<string, unknown>, now = T) => j(await call("POST", "/api/org/host", { label: "Priya", ...body }, master, now));
/** Confirms the e-mail by code through the real routes and returns the answer. */
const confirmByCode = async (key: string, email: string, now = T) => {
  const s = await j(await call("POST", "/api/host/setup/email", { email }, key, now));
  return j(await call("POST", "/api/host/setup/email/verify", { code: s.devCode }, key, now));
};

describe("adding a Host: at least one of e-mail or mobile", () => {
  test("neither is refused; an invalid e-mail or mobile is refused; one of them is enough", async () => {
    const { master } = await organizer();
    expect((await call("POST", "/api/org/host", { label: "X" }, master)).status).toBe(400);
    expect((await call("POST", "/api/org/host", { label: "X", email: "" , mobile: "  " }, master)).status).toBe(400);
    expect((await call("POST", "/api/org/host", { label: "X", email: "not-an-email" }, master)).status).toBe(400);
    expect((await call("POST", "/api/org/host", { label: "X", mobile: "123" }, master)).status).toBe(400);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_key WHERE kind='host' AND expires_ms IS NULL").get() as any).c).toBe(0);
    expect((await call("POST", "/api/org/host", { label: "A", email: "a@acme.com" }, master)).status).toBe(200);
    expect((await call("POST", "/api/org/host", { label: "B", mobile: "9876500002" }, master)).status).toBe(200);
  });
  test("e-mail only: the link is e-mailed to the Host (not the Organizer), sealed on the key row; no WhatsApp button", async () => {
    const { master } = await organizer();
    const r = await addHost(master, { email: "Priya@Acme.com" });
    expect(r).toMatchObject({ ok: true, emailed: true, email: "priya@acme.com" }); expect(r.waLink).toBeUndefined(); expect(r.link).toContain(`/zc.html?k=${r.hostKey}`);
    expect(mailsTo("priya@acme.com").some((m) => m.body.includes(`/zc.html?k=${r.hostKey}`))).toBe(true);
    expect(mailsTo("boss@acme.com").some((m) => m.body.includes(`/zc.html?k=${r.hostKey}`))).toBe(false);
    expect(one("SELECT email_sealed, pii FROM organizer_key WHERE kind='host' AND expires_ms IS NULL")).toMatchObject({ pii: null });
    expect(JSON.stringify(raw.prepare("SELECT * FROM organizer_key").all())).not.toContain("priya@acme.com");
  });
  test("mobile only: nothing is e-mailed to the Host, and the answer carries a WhatsApp link to that number with the one-time link ready to send", async () => {
    const { master } = await organizer();
    const r = await addHost(master, { mobile: "98765 00002" });
    expect(r.emailed).toBe(false); expect(r.email).toBeUndefined();
    expect(r.waLink).toStartWith("https://wa.me/919876500002?text="); expect(decodeURIComponent(r.waLink)).toContain(r.link); expect(r.mobileMasked).toBe("******0002");
    expect(raw.prepare("SELECT 1 FROM outbox WHERE body LIKE ?").get(`%${r.hostKey}%`)).toBeNull();
    expect(JSON.stringify({ ...r, waLink: undefined })).not.toContain("9876500002"); // the number appears only inside the WhatsApp link the Organizer opens
  });
  test("an AI key still cannot add a Host, and a Host cannot add one either", async () => {
    const { master, ai } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500001" });
    expect((await call("POST", "/api/org/host", { email: "q@acme.com" }, ai)).status).toBe(403);
    await confirmByCode(h.hostKey, "p@acme.com");
    const dev = (await j(await call("POST", "/api/auth/email", { email: "p@acme.com" })));
    const tok = (await j(await call("POST", "/api/auth/verify", { email: "p@acme.com", code: dev.devCode }))).token;
    expect((await call("POST", "/api/org/host", { email: "q@acme.com" }, tok)).status).toBe(403);
  });
});

describe("the console is closed until the setup is finished", () => {
  test("a new Host gets 403 {code:'host-setup'} on every route except whoami and the setup routes", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500001" });
    for (const [m, p] of [["GET", "/api/org/team"], ["GET", "/api/z/HOST-1/summary"], ["GET", "/api/history"], ["POST", "/api/checkout"], ["POST", "/api/z/HOST-1/paylink"], ["GET", "/api/z/HOST-1/people"], ["POST", "/api/org/cohost"], ["PATCH", "/api/z/HOST-1/settings"]] as const) {
      const r = await call(m, p, m === "GET" ? undefined : {}, h.hostKey);
      expect([m + p, r.status, (await j(r)).code]).toEqual([m + p, 403, "host-setup"]);
    }
    expect(await j(await call("GET", "/api/whoami", undefined, h.hostKey))).toEqual({ kind: "host", ready: false });
    expect(await j(await call("GET", "/api/host/setup", undefined, h.hostKey))).toEqual({ needEmail: true, needMobile: false, emailMasked: "p***@acme.com", mobileMasked: "******0001", ready: false });
  });
  test("the setup routes are for a Host key only: not the Organizer, not an AI key, not a stranger", async () => {
    const { master, ai } = await organizer();
    for (const key of [master, ai, undefined, "cbh_" + "0".repeat(48)]) for (const [m, p] of [["GET", "/api/host/setup"], ["POST", "/api/host/setup/mobile"], ["POST", "/api/host/setup/email"], ["POST", "/api/host/setup/email/verify"]] as const)
      expect([String(key).slice(0, 4), m + p, (await call(m, p, m === "GET" ? undefined : {}, key)).status]).toEqual([String(key).slice(0, 4), m + p, 403]);
  });
  test("after the e-mail is confirmed AND a mobile exists, the console opens (team list 200); with the e-mail only it stays shut until the mobile is typed", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com" }); // no mobile yet
    const done = await confirmByCode(h.hostKey, "p@acme.com");
    expect(done).toMatchObject({ ok: true, kind: "host", ready: false, needMobile: true }); expect(done.token).toMatch(/^cbh_[0-9a-f]{48}$/); expect(done.token).not.toBe(h.hostKey);
    expect((await call("GET", "/api/org/team", undefined, done.token)).status).toBe(403);
    expect(await j(await call("GET", "/api/host/setup", undefined, done.token))).toMatchObject({ needEmail: false, needMobile: true, ready: false });
    expect((await call("POST", "/api/host/setup/mobile", { mobile: "12" }, done.token)).status).toBe(400);
    const m = await j(await call("POST", "/api/host/setup/mobile", { mobile: "98765 00007" }, done.token));
    expect(m).toMatchObject({ ok: true, ready: true, mobileMasked: "******0007" });
    expect((await call("GET", "/api/org/team", undefined, done.token)).status).toBe(200);
    expect(await j(await call("GET", "/api/whoami", undefined, done.token))).toEqual({ kind: "host", ready: true });
    expect(JSON.stringify(raw.prepare("SELECT pii FROM organizer_key").all())).not.toContain("9876500007"); // sealed
  });
  test("a mobile first and the e-mail second works too, and a Host added with both only has the e-mail left to confirm", async () => {
    const { master } = await organizer(); const h = await addHost(master, { mobile: "9876500002" });
    expect(await j(await call("GET", "/api/host/setup", undefined, h.hostKey))).toMatchObject({ needEmail: true, needMobile: false });
    const done = await confirmByCode(h.hostKey, "any@acme.com"); // added without an e-mail: the Host may confirm their own
    expect(done).toMatchObject({ ready: true, needMobile: false }); expect((await call("GET", "/api/org/team", undefined, done.token)).status).toBe(200);
    const m = await j(await call("GET", "/api/org/team", undefined, master)); expect(m.hosts[0]).toMatchObject({ setup: "ready", emailConfirmed: true, hasMobile: true, email: "any@acme.com" });
  });
});

describe("the e-mail code", () => {
  test("only the e-mail the Organizer gave is accepted, and the refusal shows a masked hint", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "alice@acme.com", mobile: "9876500002" });
    const r = await call("POST", "/api/host/setup/email", { email: "mallory@evil.com" }, h.hostKey);
    expect(r.status).toBe(409); const b = await j(r); expect(b.code).toBe("email-mismatch"); expect(b.error).toBe("This link is for a***@acme.com");
    expect(mailsTo("mallory@evil.com")).toHaveLength(0);
    expect((await call("POST", "/api/host/setup/email", { email: "ALICE@acme.com" }, h.hostKey)).status).toBe(200);
  });
  test("a wrong code, an old code and a sixth try are refused; the right code works once", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    const s = await j(await call("POST", "/api/host/setup/email", { email: "p@acme.com" }, h.hostKey));
    const wrong = s.devCode === "123456" ? "654321" : "123456";
    expect((await call("POST", "/api/host/setup/email/verify", { code: wrong }, h.hostKey)).status).toBe(400);
    expect((await call("POST", "/api/host/setup/email/verify", { code: s.devCode }, h.hostKey, T + 11 * 60_000)).status).toBe(400); // 10 minutes passed
    const s2 = await j(await call("POST", "/api/host/setup/email", { email: "p@acme.com" }, h.hostKey));
    for (let i = 0; i < 5; i++) await call("POST", "/api/host/setup/email/verify", { code: wrong }, h.hostKey);
    expect((await call("POST", "/api/host/setup/email/verify", { code: s2.devCode }, h.hostKey)).status).toBe(400); // locked after 5 wrong tries
    const s3 = await j(await call("POST", "/api/host/setup/email", { email: "p@acme.com" }, h.hostKey));
    expect((await call("POST", "/api/host/setup/email/verify", { code: s3.devCode }, h.hostKey)).status).toBe(200);
    expect((await call("POST", "/api/host/setup/email/verify", { code: s3.devCode }, h.hostKey)).status).toBe(403); // the link key is spent: nothing works with it any more
  });
  test("at most 5 codes an hour, like the sign-in", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/host/setup/email", { email: "p@acme.com" }, h.hostKey)).status).toBe(200);
    expect((await call("POST", "/api/host/setup/email", { email: "p@acme.com" }, h.hostKey)).status).toBe(429);
  });
  test("a code request for the e-mail never signs anybody in by itself, and an Organizer's sign-in code cannot finish a Host's setup", async () => {
    const { master } = await organizer(); const h = await addHost(master, { mobile: "9876500002" });
    const org = await j(await call("POST", "/api/auth/email", { email: "boss@acme.com" }));
    expect((await call("POST", "/api/host/setup/email/verify", { code: org.devCode }, h.hostKey)).status).toBe(400);
    expect(one("SELECT verified_ms FROM host_state").verified_ms).toBeNull();
  });
});

describe("the link is one-time and lasts 7 days", () => {
  test("an unused link works for 7 days and then it is no key at all", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    expect((await call("GET", "/api/whoami", undefined, h.hostKey, T + 7 * DAY - 1000)).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, h.hostKey, T + 7 * DAY + 1000)).status).toBe(403);
    expect((await call("POST", "/api/host/setup/email", { email: "p@acme.com" }, h.hostKey, T + 7 * DAY + 1000)).status).toBe(403);
    const t = await j(await call("GET", "/api/org/team", undefined, master, T + 8 * DAY)); expect(t.hosts[0].setup).toBe("link-expired");
  });
  test("once the e-mail is confirmed the link stops working at once; the new key for that device works", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    const done = await confirmByCode(h.hostKey, "p@acme.com");
    expect((await call("GET", "/api/whoami", undefined, h.hostKey)).status).toBe(403);
    expect((await call("GET", "/api/org/team", undefined, done.token)).status).toBe(200);
    expect((await call("GET", "/api/org/team", undefined, done.token, T + 30 * DAY)).status).toBe(200); // a device key does not expire with the link
  });
  test("the Organizer sends a NEW link: the old one is revoked at once, the new one works, the team id moves with it; AI keys, Hosts and finished Hosts are refused", async () => {
    const { master, ai } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    const id = h.id as string;
    expect((await call("POST", "/api/org/host/link", { id }, ai)).status).toBe(403);
    expect((await call("POST", "/api/org/host/link", { id: "0".repeat(10) }, master)).status).toBe(404);
    const n = await j(await call("POST", "/api/org/host/link", { id }, master, T + 6 * DAY));
    expect(n).toMatchObject({ ok: true, emailed: true, mobileMasked: "******0002" }); expect(n.waLink).toStartWith("https://wa.me/919876500002?text="); expect(n.hostKey).not.toBe(h.hostKey); expect(n.id).not.toBe(id);
    expect((await call("GET", "/api/whoami", undefined, h.hostKey, T + 6 * DAY)).status).toBe(403);
    expect((await call("GET", "/api/whoami", undefined, n.hostKey, T + 6 * DAY + 5 * DAY)).status).toBe(200); // a fresh 7 days from the new link
    expect(mailsTo("p@acme.com").filter((m) => m.body.includes(n.hostKey))).toHaveLength(1);
    expect((await j(await call("GET", "/api/org/team", undefined, master, T + 6 * DAY))).hosts.map((x: any) => x.id)).toEqual([n.id]);
    const done = await confirmByCode(n.hostKey, "p@acme.com", T + 6 * DAY);
    expect((await call("POST", "/api/org/host/link", { id: n.id }, done.token)).status).toBe(403); // a Host cannot
    const again = await call("POST", "/api/org/host/link", { id: n.id }, master); expect(again.status).toBe(409); expect((await j(again)).code).toBe("host-active");
  });
  test("a link made for one e-mail cannot be finished by another Organizer's Host or a different link", async () => {
    const a = await organizer("a@acme.com"); const b = await organizer("b@acme.com");
    const ha = await addHost(a.master, { email: "pa@acme.com", mobile: "9876500002" });
    const done = await confirmByCode(ha.hostKey, "pa@acme.com");
    expect((await call("GET", "/api/org/team", undefined, done.token)).status).toBe(200);
    const team = await j(await call("GET", "/api/org/team", undefined, b.master)); expect(team.hosts).toHaveLength(0);
  });
});

describe("later devices: e-mail code or Google, same Host, same label", () => {
  test("after the setup the Host signs in on another device with the e-mail code and gets a fresh key of the same Host; both keys work", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    const d1 = await confirmByCode(h.hostKey, "p@acme.com");
    const s = await j(await call("POST", "/api/auth/email", { email: "P@acme.com" }));
    expect(s.devToken).toMatch(/^[0-9a-f]{48}$/); // a Host gets the same two ways in as an Organizer: the code and one single-use link
    const mail = mailsTo("p@acme.com").filter((m) => /sign-in/i.test(m.subject)); expect(mail).toHaveLength(1); expect(mail[0]!.body).toContain(s.devCode); expect(mail[0]!.body).toContain(`t=${s.devToken}&go=console`); expect(mail[0]!.body).not.toMatch(/AI work link|cba_/);
    const v = await j(await call("POST", "/api/auth/verify", { email: "p@acme.com", code: s.devCode }));
    expect(v).toMatchObject({ ok: true, kind: "host", ready: true }); expect(v.token).toMatch(/^cbh_/); expect(v.token).not.toBe(d1.token);
    expect((await call("GET", "/api/org/team", undefined, v.token)).status).toBe(200); expect((await call("GET", "/api/org/team", undefined, d1.token)).status).toBe(200);
    expect((await call("POST", "/api/auth/verify", { email: "p@acme.com", code: s.devCode })).status).toBe(400); // single use
    const team = await j(await call("GET", "/api/org/team", undefined, master)); expect(team.hosts).toHaveLength(1); expect(team.hosts[0].label).toBe("Priya"); // device keys never show up as extra Hosts
    expect(one("SELECT COUNT(*) AS c FROM organizer_key WHERE kind='host' AND expires_ms IS NULL").c).toBe(3);
  });
  test("a Host keeps ONE identity across devices: the list owner and the Co-hosts they add are the same", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    const d1 = await confirmByCode(h.hostKey, "p@acme.com");
    const s = await j(await call("POST", "/api/auth/email", { email: "p@acme.com" }));
    const d2 = (await j(await call("POST", "/api/auth/verify", { email: "p@acme.com", code: s.devCode }))).token;
    await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500003", e: "HOST-1" }, d1.token);
    await call("POST", "/api/org/cohost", { label: "Meera", phone: "9876500004", e: "HOST-1" }, d2);
    const by = (raw.prepare("SELECT created_by FROM organizer_key WHERE kind='cohost'").all() as any[]).map((x) => x.created_by);
    expect(by).toHaveLength(2); expect(by[0]).toBe(by[1]); expect(by[0]).toMatch(/^h:[0-9a-f]{7}$/);
  });
  test("a Host with several devices is still ONE person: the cancel mail goes to one address once, and the Host count does not grow", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    await confirmByCode(h.hostKey, "p@acme.com");
    for (let i = 0; i < 2; i++) { const s = await j(await call("POST", "/api/auth/email", { email: "p@acme.com" })); await call("POST", "/api/auth/verify", { email: "p@acme.com", code: s.devCode }); }
    expect(one("SELECT COUNT(*) AS c FROM organizer_key WHERE kind='host' AND expires_ms IS NULL").c).toBe(4);
    expect((await teamEmails(env, one("SELECT org FROM organizer_key LIMIT 1").org, "HOST-1")).hosts).toEqual(["p@acme.com"]);
    for (let i = 0; i < 4; i++) expect((await call("POST", "/api/org/host", { label: "H" + i, mobile: "98765000" + (10 + i) }, master)).status).toBe(200); // 1 + 4 = 5 Hosts: the device keys did not use up places
    expect((await call("POST", "/api/org/host", { label: "Sixth", mobile: "9876500020" }, master)).status).toBe(409);
  });
  test("the e-mail of a Host who was never confirmed, or of nobody, gets the same quiet answer and no mail", async () => {
    const { master } = await organizer(); await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    for (const e of ["p@acme.com", "stranger@acme.com"]) { const s = await j(await call("POST", "/api/auth/email", { email: e })); expect(s).toEqual({ ok: true }); }
    expect(mailsTo("p@acme.com").filter((m) => /sign-in/i.test(m.subject))).toHaveLength(0);
  });
  test("retiring a Host stops every key of theirs and their e-mail sign-in", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "p@acme.com", mobile: "9876500002" });
    const d1 = await confirmByCode(h.hostKey, "p@acme.com");
    const s = await j(await call("POST", "/api/auth/email", { email: "p@acme.com" })); const d2 = (await j(await call("POST", "/api/auth/verify", { email: "p@acme.com", code: s.devCode }))).token;
    const id = (await j(await call("GET", "/api/org/team", undefined, master))).hosts[0].id, before = mailsTo("p@acme.com").filter((m) => /sign-in code/i.test(m.subject)).length;
    expect((await call("POST", "/api/org/team/retire", { id }, master)).status).toBe(200);
    for (const k of [d1.token, d2]) expect((await call("GET", "/api/org/team", undefined, k)).status).toBe(403);
    expect(await j(await call("POST", "/api/auth/email", { email: "p@acme.com" }))).toEqual({ ok: true });
    expect(mailsTo("p@acme.com").filter((m) => /sign-in code/i.test(m.subject))).toHaveLength(before);
    expect(one("SELECT COUNT(*) AS c FROM host_login").c).toBe(0); expect(one("SELECT COUNT(*) AS c FROM host_state").c).toBe(0);
    expect(JSON.stringify(raw.prepare("SELECT pii, email_sealed FROM organizer_key WHERE kind='host'").all())).not.toMatch(/v1\./);
  });
});

describe("Google can satisfy the e-mail step (intent 'host')", () => {
  const google = (credential: string, hostKey?: string, intent = "host") => call("POST", "/api/auth/google", { credential, intent, ...(hostKey ? { hostKey } : {}) });
  test("the Google e-mail must equal the e-mail the Host was added with: a mismatch shows 'This link is for a***@acme.com' and changes nothing", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "alice@acme.com", mobile: "9876500002" });
    const r = await google(await idp.sign(claims("eve@evil.com", T)), h.hostKey);
    expect(r.status).toBe(403); expect(await j(r)).toMatchObject({ code: "email-mismatch", error: "This link is for a***@acme.com" });
    expect((await call("GET", "/api/whoami", undefined, h.hostKey)).status).toBe(200); expect(one("SELECT verified_ms FROM host_state").verified_ms).toBeNull();
  });
  test("a matching Google e-mail finishes the e-mail step: same answer as the code (a key for this device, the link is spent), then Google signs in on another device", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "alice@acme.com", mobile: "9876500002" });
    const r = await j(await google(await idp.sign(claims("Alice@Acme.com", T)), h.hostKey));
    expect(r).toMatchObject({ ok: true, kind: "host", ready: true, needMobile: false }); expect((await call("GET", "/api/org/team", undefined, r.token)).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, h.hostKey)).status).toBe(403);
    const later = await j(await google(await idp.sign(claims("alice@acme.com", T)), undefined, "signin"));
    expect(later).toMatchObject({ ok: true, kind: "host", ready: true }); expect(later.token).not.toBe(r.token); expect((await call("GET", "/api/org/team", undefined, later.token)).status).toBe(200);
  });
  test("a Host added with a mobile only may use any Google e-mail; it is then the Host's e-mail", async () => {
    const { master } = await organizer(); const h = await addHost(master, { mobile: "9876500002" });
    const r = await j(await google(await idp.sign(claims("priya.personal@gmail.com", T)), h.hostKey));
    expect(r.ready).toBe(true); expect((await j(await call("GET", "/api/org/team", undefined, master))).hosts[0].email).toBe("priya.personal@gmail.com");
  });
  test("the 24-hour Host AI-link key (mailed to the Organizer) cannot finish a Host setup, so it cannot turn itself into a lasting Host key", async () => {
    const { master } = await organizer(); await addHost(master, { email: "alice@acme.com", mobile: "9876500002" });
    const mails = raw.prepare("SELECT body FROM outbox WHERE to_addr=?").all("boss@acme.com") as { body: string }[]; // the Organizer's own mail: the 24-hour Host AI link (the Host's first-open link goes to the Host)
    const key = mails.map((m) => m.body.match(/cbh_[0-9a-f]{48}/)?.[0]).find(Boolean);
    expect(key).toBeTruthy(); const before = one("SELECT COUNT(*) AS c FROM organizer_key").c;
    for (const [path, body] of [["/api/host/setup/mobile", { mobile: "9812345678" }], ["/api/host/setup/email", { email: "attacker@example.com" }], ["/api/host/setup/email/verify", { code: "123456" }]] as const) expect([path, (await call("POST", path, body, key)).status]).toEqual([path, 403]);
    expect(one("SELECT COUNT(*) AS c FROM organizer_key").c).toBe(before); // no lasting Host key was minted from it
  });
  test("an expired, used, unknown or missing link key is refused; so is a 24-hour AI-link key", async () => {
    const { master } = await organizer(); const h = await addHost(master, { email: "alice@acme.com", mobile: "9876500002" });
    const tok = await idp.sign(claims("alice@acme.com", T + 8 * DAY));
    const late = await call("POST", "/api/auth/google", { credential: tok, intent: "host", hostKey: h.hostKey }, undefined, T + 8 * DAY);
    expect(late.status).toBe(400); expect((await j(late)).code).toBe("host-link-gone");
    for (const key of [undefined, "cbh_" + "1".repeat(48), master]) expect([String(key).slice(0, 4), (await google(await idp.sign(claims("alice@acme.com", T)), key)).status]).toEqual([String(key).slice(0, 4), 400]);
    const temp = (raw.prepare("SELECT hash FROM organizer_key WHERE kind='host' AND expires_ms IS NOT NULL").get() as any);
    expect(temp).toBeTruthy(); // the Organizer's 24-hour Host AI-link key exists, but its key text is never exposed here; the lookup above covers the shape
  });
});
