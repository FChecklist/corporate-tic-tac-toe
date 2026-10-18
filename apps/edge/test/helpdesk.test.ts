import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import type { Env } from "../src/worker";
import { makeD1 } from "./d1-sqlite";
import { helpdeskSweep } from "../src/helpdesk";

// Help Desk (docs/HELPDESK_SPEC.md): a Refer & earn partner prepares games for an Organizer, who publishes with one tap.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const FAR_START = Math.floor(((T + 2 * 86_400_000) / 1000 - 1692803367) / 3) + 1;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ip = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.${Math.floor(++ip / 200)}.${ip % 200}`, ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const org = (k: string): Record<string, string> => ({ "x-organizer": k });
const part = (k: string): Record<string, string> => ({ "x-partner": k });
const mails = () => raw.query("SELECT to_addr, subject, body FROM outbox ORDER BY id").all() as { to_addr: string; subject: string; body: string }[];
const lastMail = (to: string, re?: RegExp) => [...mails()].reverse().find((m) => m.to_addr === to && (!re || re.test(m.subject)))!;
const tokenOf = (m: { body: string }, page: string) => m.body.match(new RegExp(`${page}\\.html\\?t=([0-9a-f]{48})`))![1]!;

let CODE = "";
/** A Refer & earn partner (two steps: ask, then confirm with the e-mailed code). */
const enroll = async (phone = "98111 22233", name = "Asha", email = "asha@partner.example") => {
  const a = await j(await call("POST", "/api/partner/enroll", { phone, name, email, consent: true }));
  const r = await j(await call("POST", "/api/partner/enroll/verify", { email, code: a.devCode })); CODE = r.code;
  return r as { code: string; partnerKey: string };
};
const helperJoined = async (phone = "98111 22233", name = "Asha", email = "asha@partner.example") => {
  const p = await enroll(phone, name, email);
  const r = await call("POST", "/api/helpdesk/join", { email }, part(p.partnerKey));
  expect(r.status).toBe(200);
  return p;
};
const startOrg = async (email: string) => (await j(await call("POST", "/api/start", { email }))).token as string;
const me = async (key: string) => j(await call("GET", "/api/helpdesk/me", undefined, part(key)));
/** A helper, an Organizer, an invitation and the Organizer's Allow. */
const world = async (orgEmail = "boss@acme.com") => {
  const p = await helperJoined();
  const master = await startOrg(orgEmail);
  const inv = await j(await call("POST", "/api/helpdesk/invite", { email: orgEmail, name: "Boss" }, part(p.partnerKey)));
  const t = tokenOf(lastMail(orgEmail, /asks to prepare/), "helpdesk-accept");
  const acc = await call("POST", "/api/helpdesk/accept", { t, consent: true }, org(master));
  expect(acc.status).toBe(200);
  const m = await me(p.partnerKey);
  const aiKey = m.clients[0].consoleUrl.match(/k=(cba_[0-9a-f]{48})/)[1] as string;
  return { p, master, t, linkId: inv.id as string, aiKey, org: (raw.query("SELECT org FROM helpdesk_link").get() as any).org as string };
};
const makeGame = (key: string, id = "HD-GAME-1") => call("POST", "/api/z", { id, startRound: FAR_START, callSeconds: 9, cap: 300, name: "Annual Day" }, org(key));
/** The helper asks the Organizer to publish. */
const askAt = (w: Awaited<ReturnType<typeof world>>, eid: string, now = T) => call("POST", "/api/helpdesk/request-publish", { linkId: w.linkId, eid }, part(w.p.partnerKey), now);
const req = call;
const approvalToken = (email = "boss@acme.com") => tokenOf(lastMail(email, /asks you to publish/), "helpdesk-approve");
/** The whole one-tap approval as the page does it: start, publish with the temporary key, done. */
const approveAndPublish = async (t: string, eid = "HD-GAME-1", now = T) => {
  const s = await j(await req("POST", "/api/helpdesk/approve/start", { t }, {}, now));
  const pub = await req("POST", `/api/z/${eid}/publish`, { email: "boss@acme.com", phone: "9876500009" }, org(s.key), now);
  const done = await req("POST", "/api/helpdesk/approve/done", { t }, {}, now);
  return { s, pub, done };
};

beforeEach(() => {
  const d = makeD1(); raw = d.raw; ip = 0;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", TEST_MODE: "1", PUBLIC_ORIGIN: "https://tictactoe.test" };
});

describe("joining Help Desk", () => {
  test("joining needs the e-mail the partner enrolled with, and the e-mail is kept sealed", async () => {
    const p = await enroll();
    expect((await call("POST", "/api/helpdesk/join", { email: "asha@partner.example" })).status).toBe(403); // no partner key
    expect((await call("POST", "/api/helpdesk/join", { email: "someone@else.example" }, part(p.partnerKey))).status).toBe(403);
    expect((await call("POST", "/api/helpdesk/join", { email: "nope" }, part(p.partnerKey))).status).toBe(400);
    expect(await me(p.partnerKey)).toEqual({ joined: false });
    expect((await call("POST", "/api/helpdesk/join", { email: "Asha@Partner.example" }, part(p.partnerKey))).status).toBe(200);
    expect((await call("POST", "/api/helpdesk/join", { email: "asha@partner.example" }, part(p.partnerKey))).status).toBe(200); // twice is fine
    expect(raw.query("SELECT COUNT(*) c FROM helpdesk_helper").get()).toEqual({ c: 1 });
    expect(JSON.stringify(raw.query("SELECT * FROM helpdesk_helper").all())).not.toContain("asha@partner.example");
    expect((await me(p.partnerKey)).joined).toBe(true);
  });
  test("a person who is not a partner, or a partner who did not turn Help Desk on, has no clients and cannot invite", async () => {
    const p = await enroll();
    expect((await call("POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, part(p.partnerKey))).status).toBe(403);
    expect((await call("GET", "/api/helpdesk/me")).status).toBe(403);
    expect((await call("GET", "/api/helpdesk/me", undefined, part("ctp_" + "0".repeat(40)))).status).toBe(403);
  });
});

describe("inviting an Organizer", () => {
  test("the Organizer is mailed a link, the answer never says whether they have an account, and the helper sees only a masked address", async () => {
    const p = await helperJoined();
    await startOrg("known@acme.com");
    const a = await j(await call("POST", "/api/helpdesk/invite", { email: "known@acme.com" }, part(p.partnerKey)));
    const b = await j(await call("POST", "/api/helpdesk/invite", { email: "stranger@acme.com" }, part(p.partnerKey)));
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); expect(a.ok).toBe(true); expect(b.ok).toBe(true);
    const m = lastMail("known@acme.com", /asks to prepare/);
    expect(m.body).toContain("Nothing is published or paid without your OK"); expect(m.body).toContain("Asha");
    expect(m.body).toMatch(/https:\/\/tictactoe\.test\/helpdesk-accept\.html\?t=[0-9a-f]{48}/);
    const mine = await me(p.partnerKey);
    expect(mine.clients.map((c: any) => c.orgEmailMasked).sort()).toEqual(["k***@acme.com", "s***@acme.com"]);
    expect(JSON.stringify(mine)).not.toContain("known@acme.com");
    expect(JSON.stringify(raw.query("SELECT * FROM helpdesk_link").all())).not.toContain("known@acme.com"); // sealed
    expect(mine.clients.every((c: any) => c.state === "invited" && !c.consoleUrl && !c.aiLink)).toBe(true); // no key before the Organizer allows
  });
  test("limits: 5 invitations an hour per helper, 3 a day per Organizer address across helpers, no duplicates, not your own address, 50 clients at most", async () => {
    const p = await helperJoined();
    expect((await call("POST", "/api/helpdesk/invite", { email: "asha@partner.example" }, part(p.partnerKey))).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/helpdesk/invite", { email: `o${i}@acme.com` }, part(p.partnerKey))).status).toBe(200);
    expect((await call("POST", "/api/helpdesk/invite", { email: "o0@acme.com" }, part(p.partnerKey))).status).toBe(409); // duplicate (checked before the hourly limit)
    expect((await call("POST", "/api/helpdesk/invite", { email: "o9@acme.com" }, part(p.partnerKey))).status).toBe(429);
    expect((await call("POST", "/api/helpdesk/invite", { email: "o9@acme.com" }, part(p.partnerKey), T + 3_700_000)).status).toBe(200); // next hour
    // three helpers already asked the same Organizer today: the fourth is refused
    for (let i = 0; i < 2; i++) { const h = await helperJoined(`982220000${i}`, `H${i}`, `h${i}@partner.example`); expect((await call("POST", "/api/helpdesk/invite", { email: "target@acme.com" }, part(h.partnerKey))).status).toBe(200); }
    const h3 = await helperJoined("9833300000", "H3", "h3@partner.example"); expect((await call("POST", "/api/helpdesk/invite", { email: "target@acme.com" }, part(h3.partnerKey))).status).toBe(200);
    const h4 = await helperJoined("9844400000", "H4", "h4@partner.example"); expect((await call("POST", "/api/helpdesk/invite", { email: "target@acme.com" }, part(h4.partnerKey))).status).toBe(429);
    expect((await call("POST", "/api/helpdesk/invite", { email: "target@acme.com" }, part(h4.partnerKey), T + 86_400_000 + 1000)).status).toBe(200); // next day
    // 50 clients
    const h5 = await helperJoined("9855500000", "H5", "h5@partner.example");
    for (let i = 0; i < 50; i++) raw.run("INSERT INTO helpdesk_link(id,partner_code,org_email_sealed,org_email_hash,state,token_hash,created_ms) VALUES(?,?,?,?,?,?,?)", [`${i}`.padStart(16, "0"), h5.code, "x", "h" + i, "active", "t" + i, T]);
    expect((await call("POST", "/api/helpdesk/invite", { email: "late@acme.com" }, part(h5.partnerKey))).status).toBe(409);
  });
});

describe("the Organizer says Allow", () => {
  test("the invitation page shows who asks and the promise; accepting needs the signed-in Organizer of that address", async () => {
    const p = await helperJoined(); const master = await startOrg("boss@acme.com"); const other = await startOrg("other@acme.com");
    await call("POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, part(p.partnerKey));
    const t = tokenOf(lastMail("boss@acme.com", /asks to prepare/), "helpdesk-accept");
    const info = await j(await call("GET", `/api/helpdesk/accept/info?t=${t}`));
    expect(info).toMatchObject({ helperName: "Asha", state: "invited", forEmailMasked: "b***@acme.com", version: "HD1" });
    expect(info.promise.join(" ")).toContain("Only you publish"); expect(info.promise.join(" ")).toContain("5 Host places");
    expect((await call("GET", `/api/helpdesk/accept/info?t=${"0".repeat(48)}`)).status).toBe(404);
    expect((await call("POST", "/api/helpdesk/accept", { t, consent: true })).status).toBe(403); // not signed in
    expect((await call("POST", "/api/helpdesk/accept", { t, consent: true }, org(other))).status).toBe(403); // an Organizer of another address
    expect((await call("POST", "/api/helpdesk/accept", { t, consent: true }, org("plat"))).status).toBe(403); // not the platform key either
    expect((await call("POST", "/api/helpdesk/accept", { t }, org(master))).status).toBe(400); // Allow must be tapped
    expect(raw.query("SELECT state FROM helpdesk_link").get()).toEqual({ state: "invited" });
    const ok = await call("POST", "/api/helpdesk/accept", { t, consent: true }, org(master));
    expect(ok.status).toBe(200);
    const l = raw.query("SELECT state, org, consent_ms, consent_text_hash, ai_key_hash, ai_key_sealed FROM helpdesk_link").get() as any;
    expect(l).toMatchObject({ state: "active", consent_ms: T }); expect(l.consent_text_hash).toMatch(/^[0-9a-f]{64}$/); expect(l.ai_key_sealed).not.toContain("cba_");
    expect(raw.query("SELECT kind, created_by, label FROM organizer_key WHERE hash=?").get(l.ai_key_hash)).toEqual({ kind: "ai", created_by: "d", label: "Help desk" });
    expect(lastMail("asha@partner.example", /allowed you/).body).toContain("helpdesk.html");
    expect((await call("POST", "/api/helpdesk/accept", { t, consent: true }, org(master))).status).toBe(410); // once
  });
  test("an invitation expires after 14 days", async () => {
    const p = await helperJoined(); const master = await startOrg("boss@acme.com");
    await call("POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, part(p.partnerKey));
    const t = tokenOf(lastMail("boss@acme.com", /asks to prepare/), "helpdesk-accept");
    expect((await j(await call("GET", `/api/helpdesk/accept/info?t=${t}`, undefined, {}, T + 15 * 86_400_000))).state).toBe("expired");
    const late = await call("POST", "/api/helpdesk/accept", { t, consent: true }, org(master), T + 15 * 86_400_000);
    expect(late.status).toBe(410);
  });
  test("the helper's key can create a game, but cannot publish, pay, see keys or add Hosts; the game is recorded as the helper's", async () => {
    const w = await world();
    expect((await makeGame(w.aiKey)).status).toBe(200);
    expect(raw.query("SELECT eid, partner_code FROM helpdesk_game").get()).toEqual({ eid: "HD-GAME-1", partner_code: w.p.code });
    const pub = await call("POST", "/api/z/HD-GAME-1/publish", { email: "boss@acme.com", phone: "9876500009" }, org(w.aiKey));
    expect((await j(pub)).published).toBe(false); // the AI only hands over: the game stays unpublished
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k='pub/HD-GAME-1'").get()).toEqual({ c: 0 });
    expect((await call("POST", "/api/checkout", { eid: "HD-GAME-1", org: "Acme", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR" }, org(w.aiKey))).status).toBe(403);
    expect((await call("GET", "/api/org/keys", undefined, org(w.aiKey))).status).toBe(403);
    expect((await call("POST", "/api/org/host", { email: "x@acme.com" }, org(w.aiKey))).status).toBe(403);
    expect((await call("POST", "/api/org/close", { confirm: true }, org(w.aiKey))).status).toBe(403);
    expect((await call("POST", `/api/z/HD-GAME-1/paylink`, {}, org(w.aiKey))).status).toBe(403);
    // the Organizer's own AI key makes games that are not the helper's
    const ownAi = (await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage.match(/cba_[0-9a-f]{48}/)[0];
    expect((await makeGame(ownAi, "OWN-GAME-1")).status).toBe(200);
    expect(raw.query("SELECT COUNT(*) c FROM helpdesk_game").get()).toEqual({ c: 1 });
  });
  test("the console shows the helper's key a client list with an Open console link only when active", async () => {
    const w = await world(); await makeGame(w.aiKey);
    const m = await me(w.p.partnerKey);
    expect(m.clients[0]).toMatchObject({ state: "active", orgEmailMasked: "b***@acme.com", hostLink: "none" });
    expect(m.clients[0].aiLink).toBe(`https://tictactoe.test/ai/${w.aiKey}`);
    expect(m.clients[0].games[0]).toMatchObject({ eid: "HD-GAME-1", title: "Annual Day", published: false });
    expect(m.clients[0].games[0].consoleUrl).toContain("&e=HD-GAME-1");
    const mine = await j(await call("GET", "/api/helpdesk/mine", undefined, org(w.master)));
    expect(mine.helpers).toEqual([expect.objectContaining({ id: w.linkId, helperName: "Asha", state: "active", games: 1 })]);
    expect((await call("GET", "/api/helpdesk/mine", undefined, org(w.aiKey))).status).toBe(403);
  });
});

describe("asking the Organizer to publish", () => {
  test("only for the helper's own unpublished games of an active client", async () => {
    const w = await world(); await makeGame(w.aiKey);
    const ownAi = (await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage.match(/cba_[0-9a-f]{48}/)[0];
    await makeGame(ownAi, "OWN-GAME-1"); // not made through the helper
    const other = await startOrg("other@acme.com"); await call("POST", "/api/z", { id: "OTHER-ONE", startRound: FAR_START, callSeconds: 9, cap: 300 }, org(other));
    const go = (eid: string, headers = part(w.p.partnerKey), linkId: unknown = w.linkId) => call("POST", "/api/helpdesk/request-publish", { linkId, eid }, headers);
    expect((await go("OWN-GAME-1")).status).toBe(404); expect((await go("OTHER-ONE")).status).toBe(404); expect((await go("NO-SUCH")).status).toBe(404);
    expect((await go("HD-GAME-1", {})).status).toBe(403); // no key
    expect((await go("HD-GAME-1", part(w.p.partnerKey), "0".repeat(16))).status).toBe(404);
    const stranger = await helperJoined("9877700000", "Rita", "rita@partner.example"); // another helper cannot use this client
    expect((await go("HD-GAME-1", part(stranger.partnerKey))).status).toBe(404);
    const ok = await go("HD-GAME-1"); expect(ok.status).toBe(200);
    const m = lastMail("boss@acme.com", /asks you to publish/);
    expect(m.body).toContain("Annual Day"); expect(m.body).toMatch(/helpdesk-approve\.html\?t=[0-9a-f]{48}/);
    // a published game is refused (publish it as the Organizer)
    await call("POST", "/api/z/OWN-GAME-1/publish", { email: "boss@acme.com", phone: "9876500009" }, org(w.master));
    raw.run("INSERT INTO helpdesk_game(eid,link_id,partner_code,created_ms) VALUES('OWN-GAME-1',?,?,?)", [w.linkId, w.p.code, T]);
    expect((await go("OWN-GAME-1")).status).toBe(409);
  });
  test("the helper's AI key can ask by itself; asking again waits 10 minutes and the new link replaces the old one", async () => {
    const w = await world(); await makeGame(w.aiKey);
    const r1 = await call("POST", "/api/helpdesk/request-publish", { eid: "HD-GAME-1" }, org(w.aiKey)); expect(r1.status).toBe(200);
    const t1 = approvalToken();
    const again = await req("POST", "/api/helpdesk/request-publish", { eid: "HD-GAME-1" }, org(w.aiKey), T + 60_000); expect(again.status).toBe(429);
    const later = await req("POST", "/api/helpdesk/request-publish", { eid: "HD-GAME-1" }, org(w.aiKey), T + 11 * 60_000); expect(later.status).toBe(200);
    const t2 = approvalToken(); expect(t2).not.toBe(t1);
    expect((await call("GET", `/api/helpdesk/approve/info?t=${t1}`)).status).toBe(404); // the old one is gone
    expect((await call("GET", `/api/helpdesk/approve/info?t=${t2}`)).status).toBe(200);
    expect(raw.query("SELECT COUNT(*) c FROM helpdesk_pub").get()).toEqual({ c: 1 });
    // the organizer's own AI key (not the helper's) cannot use this route
    const ownAi = (await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage.match(/cba_[0-9a-f]{48}/)[0];
    expect((await call("POST", "/api/helpdesk/request-publish", { eid: "HD-GAME-1" }, org(ownAi))).status).toBe(403);
  });
});

describe("the one-tap publish approval", () => {
  test("a wrong token is 404; the page reads the summary; start opens a 30-minute key; the key publishes through the game's own route", async () => {
    const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1");
    const t = approvalToken();
    expect((await call("GET", `/api/helpdesk/approve/info?t=${"a".repeat(48)}`)).status).toBe(404);
    expect((await call("POST", "/api/helpdesk/approve/start", { t: "nonsense" })).status).toBe(404);
    expect((await call("POST", "/api/helpdesk/approve/done", { t: "b".repeat(48) })).status).toBe(404);
    const info = await j(await call("GET", `/api/helpdesk/approve/info?t=${t}`));
    expect(info).toMatchObject({ eid: "HD-GAME-1", helperName: "Asha", state: "waiting" }); expect(info.summary).toMatchObject({ name: "Annual Day", limit: 300, status: "draft" });
    // the Organizer reads which prizes the helper set up: every line carries its house name even when its prize text is empty (a game made with the default prizes)
    expect(info.summary.rewards.length).toBeGreaterThan(0); expect(info.summary.rewards.every((r: any) => typeof r.label === "string" && r.label.length > 0 && r.label !== r.pattern)).toBe(true); expect(info.summary.rewards.map((r: any) => r.label)).toContain("Champion (1st)");
    const s = await j(await call("POST", "/api/helpdesk/approve/start", { t }));
    expect(s.key).toMatch(/^cbk_[0-9a-f]{48}$/); expect(s.expiresMs).toBe(T + 30 * 60_000);
    expect(raw.query("SELECT kind, created_by, expires_ms FROM organizer_key WHERE hash=(SELECT tmp_key_hash FROM helpdesk_pub)").get()).toEqual({ kind: "master", created_by: "dp", expires_ms: T + 30 * 60_000 });
    expect((await j(await call("GET", "/api/whoami", undefined, org(s.key)))).kind).toBe("master");
    expect((await call("GET", "/api/whoami", undefined, org(s.key), T + 31 * 60_000)).status).toBe(403); // expired
    const pub = await call("POST", "/api/z/HD-GAME-1/publish", { email: "boss@acme.com", phone: "9876500009" }, org(s.key));
    expect((await j(pub)).published).toBe(true); expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k='pub/HD-GAME-1'").get()).toEqual({ c: 1 });
    expect(raw.query("SELECT kind FROM consent_log WHERE kind='K1'").all().length).toBe(1); // the Organizer's own tick, recorded as the console does
  });
  test("done refuses while the game is not published, and the token is then still usable", async () => {
    const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1");
    const t = approvalToken();
    const r = await call("POST", "/api/helpdesk/approve/done", { t }); expect(r.status).toBe(409); expect((await j(r)).code).toBe("not-published");
    expect(raw.query("SELECT COUNT(*) c FROM organizer_key WHERE created_by='d' AND kind='host'").get()).toEqual({ c: 0 });
    expect(raw.query("SELECT used_ms FROM helpdesk_pub").get()).toEqual({ used_ms: null });
    const a = await approveAndPublish(t); expect(a.pub.status).toBe(200); expect(a.done.status).toBe(200);
  });
  test("done: the token is single use, the temporary key stops, and the helper gets the Host link", async () => {
    const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1");
    const t = approvalToken();
    const { s, done } = await approveAndPublish(t); expect(done.status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(s.key))).status).toBe(403); // the 30-minute key is revoked at once
    expect((await call("GET", `/api/helpdesk/approve/info?t=${t}`)).status).toBe(410);
    expect((await call("POST", "/api/helpdesk/approve/start", { t })).status).toBe(410);
    expect((await call("POST", "/api/helpdesk/approve/done", { t })).status).toBe(410);
    const m = lastMail("asha@partner.example", /is published/);
    expect(m.body).toMatch(/OPEN MY HOST CONSOLE: https:\/\/tictactoe\.test\/zc\.html\?k=cbh_[0-9a-f]{48}&e=HD-GAME-1/); expect(m.body).toMatch(/\/ai\/cbh_[0-9a-f]{48}/);
  });
  test("an approval link expires after 7 days", async () => {
    const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1");
    const t = approvalToken();
    expect((await call("GET", `/api/helpdesk/approve/info?t=${t}`, undefined, {}, T + 6 * 86_400_000)).status).toBe(200);
    expect((await call("GET", `/api/helpdesk/approve/info?t=${t}`, undefined, {}, T + 8 * 86_400_000)).status).toBe(410);
    expect((await call("POST", "/api/helpdesk/approve/start", { t }, {}, T + 8 * 86_400_000)).status).toBe(410);
  });
});

describe("the helper becomes the desk Host", () => {
  const published = async () => { const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1"); const t = approvalToken(); await approveAndPublish(t); return { w, t }; };
  test("a desk Host exists, is labelled Help desk in the team list, and does not use one of the 5 Host places", async () => {
    const { w } = await published();
    const row = raw.query("SELECT label, created_by, kind, host_id, hash FROM organizer_key WHERE created_by='d' AND kind='host' AND expires_ms IS NULL").get() as any;
    expect(row).toMatchObject({ label: "Help desk: Asha", created_by: "d", kind: "host" }); expect(row.host_id).toBe(row.hash);
    expect((raw.query("SELECT host_hash FROM helpdesk_link").get() as any).host_hash).toBe(row.hash);
    const team = await j(await call("GET", "/api/org/team", undefined, org(w.master)));
    expect(team.hosts).toEqual([expect.objectContaining({ label: "Help desk: Asha", helpDesk: true })]);
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/org/host", { email: `h${i}@acme.com`, label: `H${i}` }, org(w.master))).status).toBe(200); // five more are allowed
    expect((await call("POST", "/api/org/host", { email: "h6@acme.com" }, org(w.master))).status).toBe(409); // the 6th of the Organizer's own is not
    expect((await j(await call("GET", "/api/org/team", undefined, org(w.master)))).hosts.length).toBe(6);
    expect((await call("GET", "/api/helpdesk/me", undefined, part(w.p.partnerKey)).then(j)).clients[0].hostLink).toBeDefined();
  });
  test("the desk Host key works as a Host, and a second published game does not make a second desk Host", async () => {
    const { w } = await published();
    const hostKey = lastMail("asha@partner.example", /is published/).body.match(/zc\.html\?k=(cbh_[0-9a-f]{48})/)![1]!;
    expect((await j(await call("GET", "/api/whoami", undefined, org(hostKey)))).kind).toBe("host");
    expect((await call("POST", "/api/z/HD-GAME-1/announce", { text: "Hello" }, org(hostKey))).status).toBe(200);
    await makeGame(w.aiKey, "HD-GAME-2"); await req("POST", "/api/helpdesk/request-publish", { linkId: w.linkId, eid: "HD-GAME-2" }, part(w.p.partnerKey), T + 20 * 60_000);
    const t2 = approvalToken(); const r = await approveAndPublish(t2, "HD-GAME-2", T + 20 * 60_000); expect(r.done.status).toBe(200);
    expect(raw.query("SELECT COUNT(*) c FROM organizer_key WHERE created_by='d' AND kind='host' AND expires_ms IS NULL AND host_id=hash").get()).toEqual({ c: 1 });
    expect(lastMail("asha@partner.example", /HD-GAME-2 is published/).body).not.toContain("OPEN MY HOST CONSOLE");
  });
  test("the helper's key does not trigger the unfamiliar-use alert, an Organizer's own AI key does", async () => {
    const w = await world();
    const ownAi = (await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage.match(/cba_[0-9a-f]{48}/)[0];
    for (const key of [w.aiKey, ownAi]) {
      await call("GET", "/api/org/team", undefined, { ...org(key), "cf-ipcountry": "IN", "user-agent": "Alpha/1" });
      await call("GET", "/api/org/team", undefined, { ...org(key), "cf-ipcountry": "US", "user-agent": "Beta/1" });
    }
    const alerts = raw.query("SELECT k FROM kv WHERE k LIKE 'alert/%'").all() as { k: string }[];
    expect(alerts.length).toBe(1); // only the Organizer's own key
    const helperId = (raw.query("SELECT substr(ai_key_hash,1,10) id FROM helpdesk_link").get() as any).id;
    expect(alerts[0]!.k).not.toBe("alert/" + helperId);
  });
});

describe("stopping", () => {
  const withHost = async () => { const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1"); const t = approvalToken(); await approveAndPublish(t); const hostKey = lastMail("asha@partner.example", /is published/).body.match(/zc\.html\?k=(cbh_[0-9a-f]{48})/)![1]!; return { w, hostKey }; };
  test("the Organizer stops with their key: the helper's AI key and the desk Host end at once, an open approval dies, published games stay", async () => {
    const { w, hostKey } = await withHost();
    await makeGame(w.aiKey, "HD-GAME-2"); await req("POST", "/api/helpdesk/request-publish", { linkId: w.linkId, eid: "HD-GAME-2" }, part(w.p.partnerKey), T + 20 * 60_000);
    const t2 = approvalToken(); const s = await j(await req("POST", "/api/helpdesk/approve/start", { t: t2 }, {}, T + 20 * 60_000));
    expect((await call("GET", "/api/whoami", undefined, org(s.key), T + 20 * 60_000)).status).toBe(200);
    expect((await call("POST", "/api/helpdesk/stop", { linkId: w.linkId })).status).toBe(403); // not signed in
    const other = await startOrg("other@acme.com"); expect((await call("POST", "/api/helpdesk/stop", { linkId: w.linkId }, org(other))).status).toBe(404);
    expect((await call("POST", "/api/helpdesk/stop", { linkId: w.linkId }, org(w.master))).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(w.aiKey))).status).toBe(403);
    expect((await call("GET", "/api/whoami", undefined, org(hostKey))).status).toBe(403);
    expect((await call("GET", "/api/whoami", undefined, org(s.key), T + 20 * 60_000)).status).toBe(403); // the temporary key too
    expect((await call("GET", `/api/helpdesk/approve/info?t=${t2}`, undefined, {}, T + 20 * 60_000)).status).toBe(410);
    expect((await call("POST", "/api/helpdesk/request-publish", { linkId: w.linkId, eid: "HD-GAME-2" }, part(w.p.partnerKey), T + 40 * 60_000)).status).toBe(404);
    expect(raw.query("SELECT state, ai_key_sealed FROM helpdesk_link").get()).toEqual({ state: "stopped", ai_key_sealed: null });
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k='pub/HD-GAME-1'").get()).toEqual({ c: 1 }); // the published game stays
    expect((await j(await call("GET", "/api/org/team", undefined, org(w.master)))).hosts).toEqual([]);
    expect(lastMail("asha@partner.example", /Help Desk stopped/).body).toContain("Your access to their account has ended");
    const m = await me(w.p.partnerKey); expect(m.clients[0]).toMatchObject({ state: "stopped", hostLink: "ended" }); expect(m.clients[0].consoleUrl).toBeUndefined();
  });
  test("the Organizer can stop from the e-mailed link without signing in; a helper can end it too; the tokens of other links do nothing", async () => {
    const w = await world();
    expect((await call("POST", "/api/helpdesk/stop", { t: "c".repeat(48) })).status).toBe(404);
    expect((await call("POST", "/api/helpdesk/stop", { t: w.t })).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(w.aiKey))).status).toBe(403);
    expect((await call("POST", "/api/helpdesk/stop", { t: w.t })).status).toBe(200); // twice is fine
  });
  test("a helper who ends it themselves loses the key at once", async () => {
    const w = await world();
    expect((await call("POST", "/api/helpdesk/stop", { linkId: w.linkId }, part(w.p.partnerKey))).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(w.aiKey))).status).toBe(403);
  });
  test("closing the partner account ends the link and removes the Help Desk rows; closing the organizer account removes them too", async () => {
    const w = await world();
    expect((await call("POST", "/api/partner/close", {}, part(w.p.partnerKey))).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(w.aiKey))).status).toBe(403);
    expect(raw.query("SELECT (SELECT COUNT(*) FROM helpdesk_link) a, (SELECT COUNT(*) FROM helpdesk_helper) b").get()).toEqual({ a: 0, b: 0 });
  });
  test("closing the organizer account deletes the Help Desk rows of that account", async () => {
    const w = await world(); await makeGame(w.aiKey);
    expect((await call("POST", "/api/org/close", { confirm: true }, org(w.master))).status).toBe(200);
    expect(raw.query("SELECT (SELECT COUNT(*) FROM helpdesk_link) a, (SELECT COUNT(*) FROM helpdesk_game) b, (SELECT COUNT(*) FROM helpdesk_pub) c").get()).toEqual({ a: 0, b: 0, c: 0 });
  });
});

describe("the helper's link survives the Organizer's own AI-link actions", () => {
  test("replacing or retiring the Organizer's AI link does not end the helper's key", async () => {
    const w = await world();
    expect((await call("POST", "/api/org/ai/replace", {}, org(w.master))).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(w.aiKey))).status).toBe(200);
    expect((await call("POST", "/api/org/ai/revoke", {}, org(w.master))).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, org(w.aiKey))).status).toBe(200);
    expect((await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage).toBeNull(); // the Organizer's own link is gone, the helper's is not
  });
});

describe("what the helper's AI is told", () => {
  test("the manual of the helper's key has the Help Desk paragraph; the Organizer's own manual does not", async () => {
    const w = await world();
    const ownAi = (await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage.match(/cba_[0-9a-f]{48}/)[0];
    const helperManual = await (await call("GET", `/ai/${w.aiKey}`)).text();
    expect(helperManual).toContain("YOU ARE A HELP DESK HELPER"); expect(helperManual).toContain("POST /api/helpdesk/request-publish");
    expect(await (await call("GET", `/ai/${ownAi}`)).text()).not.toContain("HELP DESK HELPER");
    expect((await j(await call("GET", `/ai/${w.aiKey}?format=json`))).helpDesk).toContain("never publish");
    // the AI link path reaches the route too
    await makeGame(w.aiKey);
    const viaLink = await call("POST", `/ai/${w.aiKey}/helpdesk/request-publish`, { eid: "HD-GAME-1" });
    expect(viaLink.status).toBe(200);
  });
});

describe("commission for the helper", () => {
  const pay = (key: string, extra: Record<string, unknown> = {}) => call("POST", "/api/checkout", { eid: "HD-GAME-1", org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", ...extra }, org(key));
  const ready = async () => { const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1"); await approveAndPublish(approvalToken()); return w; };
  test("a paid game the helper prepared earns the helper 50%, whatever code the buyer's browser carried", async () => {
    const w = await ready();
    const other = await enroll("9700000001", "Other", "other@partner.example");
    const r = await j(await pay(w.master, { ref: other.code })); expect(r.result.ok).toBe(true);
    expect(raw.query("SELECT ref FROM payment").get()).toEqual({ ref: w.p.code });
    expect(raw.query("SELECT partner_code, rate, status, base FROM commission").get()).toEqual({ partner_code: w.p.code, rate: 0.5, status: "accrued", base: 4699 });
  });
  test("buying with the helper's own mobile number is blocked as self-referral", async () => {
    const w = await ready();
    await pay(w.master, { phone: "+91 98111 22233" });
    expect(raw.query("SELECT status, reason FROM commission").get()).toEqual({ status: "blocked", reason: "self_referral" });
  });
  test("a game the helper did not prepare keeps the buyer's own code", async () => {
    const w = await ready();
    const ownAi = (await j(await call("GET", "/api/org/ai/link", undefined, org(w.master)))).aiMessage.match(/cba_[0-9a-f]{48}/)[0];
    await makeGame(ownAi, "OWN-GAME-1");
    await call("POST", "/api/z/OWN-GAME-1/publish", { email: "boss@acme.com", phone: "9876500009" }, org(w.master));
    const other = await enroll("9700000001", "Other", "other@partner.example");
    await pay(w.master, { eid: "OWN-GAME-1", ref: other.code });
    expect(raw.query("SELECT ref FROM payment").get()).toEqual({ ref: other.code });
  });
});

describe("clean-up", () => {
  test("an unanswered invitation and an old used approval are deleted after 30 days; an active client is not", async () => {
    const w = await world(); await makeGame(w.aiKey); await askAt(w, "HD-GAME-1");
    const p2 = await helperJoined("9877700000", "Rita", "rita@partner.example");
    await call("POST", "/api/helpdesk/invite", { email: "late@acme.com" }, part(p2.partnerKey));
    await helpdeskSweep(env.DB, T + 20 * 86_400_000);
    expect(raw.query("SELECT (SELECT COUNT(*) FROM helpdesk_link) a, (SELECT COUNT(*) FROM helpdesk_pub) b").get()).toEqual({ a: 2, b: 1 });
    await helpdeskSweep(env.DB, T + 40 * 86_400_000);
    expect(raw.query("SELECT (SELECT COUNT(*) FROM helpdesk_link) a, (SELECT COUNT(*) FROM helpdesk_link WHERE state='active') b, (SELECT COUNT(*) FROM helpdesk_pub) c").get()).toEqual({ a: 1, b: 1, c: 0 });
  });
});
