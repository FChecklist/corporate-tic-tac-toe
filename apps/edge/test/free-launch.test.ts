import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const FUT = roundAt(T) + 1200; // an hour ahead
const eng = (id: string, cap = 100) => ({ id, startRound: FUT, callSeconds: 6, cap });

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "https://bingo.test" };
});

/** A new organizer types an email and the console opens at once: no mail, no code. */
async function organizer(email = "boss@acme.com", ip = "1.1.1.1") {
  const r = await call("POST", "/api/start", { email }, { "cf-connecting-ip": ip });
  const j = await r.json() as any;
  expect(r.status).toBe(200); expect(j.token).toMatch(/^cbk_/); expect(j.aiKey).toMatch(/^cba_/);
  return { h: { "x-organizer": j.token as string }, ai: j.aiKey as string, aiMessage: j.aiMessage as string };
}
const ok = { email: "boss@acme.com", phone: "98765 43210" };

describe("build first, pay to publish", () => {
  test("entering an email opens the console at once, with a ready AI work link, and the same link is e-mailed to the organizer", async () => {
    const o = await organizer();
    expect(o.aiMessage).toContain(`https://bingo.test/ai/${o.ai}`); expect(o.aiMessage).toMatch(/MY OWN Corporate Tic Tac Toe account/); expect(o.aiMessage.split(String.fromCharCode(10)).length).toBe(2);
    expect((await call("GET", "/api/history", undefined, { "x-organizer": o.ai })).status).toBe(200); // the AI link really works
    const sent = raw.prepare("SELECT to_addr, subject, body FROM outbox").all() as { to_addr: string; subject: string; body: string }[];
    expect(sent.length).toBe(1); expect(sent[0]!.to_addr).toBe("boss@acme.com"); expect(sent[0]!.subject).toMatch(/personal AI work link/i);
    expect(sent[0]!.body).not.toContain(o.ai); expect(sent[0]!.body).toMatch(/\/ai\/cba_[0-9a-f]{48}/); expect(sent[0]!.body).toMatch(/24 HOURS/); // the mail has its own 24-hour key; the lasting one stays in the console
  });
  test("an email that already has an account is not let in by typing it: it is asked for the e-mailed code", async () => {
    await organizer();
    const r = await (await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "2.2.2.2" })).json() as any;
    expect(r.exists).toBe(true); expect(r.token).toBeUndefined();
    await call("POST", "/api/auth/email", { email: "boss@acme.com" });
    const mail = raw.prepare("SELECT body FROM outbox WHERE to_addr=? ORDER BY id DESC LIMIT 1").get("boss@acme.com") as { body: string };
    const code = mail.body.match(/\b\d{6}\b/)![0];
    expect(((await (await call("POST", "/api/auth/verify", { email: "boss@acme.com", code })).json()) as any).token).toMatch(/^cbk_/);
  });
  test("a network address can open only a few new organizer accounts a day", async () => {
    for (let i = 1; i <= 10; i++) await organizer(`u${i}@acme.com`, "9.9.9.9");
    expect((await call("POST", "/api/start", { email: "u11@acme.com" }, { "cf-connecting-ip": "9.9.9.9" })).status).toBe(429);
    expect((await call("POST", "/api/start", { email: "u7@acme.com" }, { "cf-connecting-ip": "8.8.8.8" })).status).toBe(200);
  });
  test("an organizer builds an engagement with no payment: it is a draft", async () => {
    const { h } = await organizer();
    const r = await (await call("POST", "/api/z", eng("DRAFT-1", 500), h)).json() as any;
    expect(r.ok).toBe(true); expect(r.draft).toBe(true);
    const hist = await (await call("GET", "/api/history", undefined, h)).json() as any;
    expect(hist.engagements[0].id).toBe("DRAFT-1"); expect(!!hist.engagements[0].draft).toBe(true);
  });
  test("participants cannot see or join a draft; the organizer can read it", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("DRAFT-2"), h);
    expect((await call("POST", "/api/z/DRAFT-2/join", { phone: "9876543210" })).status).toBe(403);
    expect((await call("GET", "/api/z/DRAFT-2/info")).status).toBe(403);
    expect((await call("GET", "/api/z/DRAFT-2/info", undefined, h)).status).toBe(200);
  });
  test("publishing is free: the link opens to participants at once, unpaid, and the organizer is e-mailed what is due", async () => {
    const { h, ai } = await organizer();
    await call("POST", "/api/z", eng("PUB-1", 500), h);
    const r = await call("POST", "/api/z/PUB-1/publish", ok, h);
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.published).toBe(true); expect(j.paid).toBe(false); expect(j.shareUrl).toBe("https://bingo.test/z.html?e=PUB-1"); expect(j.payUrl).toBe("https://bingo.test/pay.html?e=PUB-1");
    expect((await call("POST", "/api/z/PUB-1/join", { phone: "9876543210" })).status).toBe(200); // everyone can join before the organizer has paid
    const info = await (await call("GET", "/api/z/PUB-1/info")).json() as any;
    expect(info.unpaid).toBeUndefined(); expect(info.locked).toBe(false); // participants are never told it is unpaid
    expect(((await (await call("GET", "/api/z/PUB-1/info", undefined, h)).json()) as any).unpaid).toBe(true); // the organizer is
    const mail = raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id DESC LIMIT 1").get("boss@acme.com") as { subject: string; body: string };
    expect(mail.subject).toMatch(/payment pending/i); expect(mail.body).toMatch(/does not begin until it is paid/);
    expect(mail.body).toContain("/pay.html?e=PUB-1"); expect(mail.body).toContain("/z.html?e=PUB-1");
    expect(mail.body).not.toMatch(/cba_|cbh_|\/ai\//); // the publish mail is forwardable: the AI work link has its own dedicated e-mail
    expect((await call("GET", "/api/history", undefined, { "x-organizer": ai })).status).toBe(200); // and the AI key already in use was not touched
    expect((await call("GET", "/api/history", undefined, { "x-organizer": ai })).status).toBe(200); // and the AI key already in use was not cut off expect(mail.body).toContain("/pay.html?e=PUB-1"); expect(mail.body).toContain("/z.html?e=PUB-1");
  });
  test("not paid by the start time: the engagement does not begin. Phones are told to hold, and the organizer is e-mailed once", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("LOCK-1"), h);
    await call("POST", "/api/z/LOCK-1/publish", ok, h);
    const after = T + 3 * 3_600_000; // two hours past the start
    const ctl = await (await call("GET", "/api/z/LOCK-1/control", undefined, {}, after)).json() as any;
    expect(ctl.locked).toBe(true);
    const info = await (await call("GET", "/api/z/LOCK-1/info", undefined, {}, after)).json() as any;
    expect(info.locked).toBe(true);
    await call("GET", "/api/z/LOCK-1/info", undefined, {}, after + 1000);
    const n = (raw.prepare("SELECT COUNT(*) AS c FROM outbox WHERE to_addr='boss@acme.com' AND subject LIKE '%could not begin%'").get() as any).c;
    expect(n).toBe(1); // once, not once per participant
    const early = await call("GET", "/api/z/LOCK-1/control", undefined, {}, T);
    expect(early.status === 404 || ((await early.json()) as any).locked === undefined).toBe(true); // before the start nothing is held
  });
  test("an unpaid engagement can be moved to a new start time even after the old one passed", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("LOCK-2"), h);
    await call("POST", "/api/z/LOCK-2/publish", ok, h);
    const after = T + 3 * 3_600_000;
    expect((await call("PATCH", "/api/z/LOCK-2/settings", { startRound: roundAt(after) + 100 }, h, after)).status).toBe(200);
  });
  test("a published engagement that starts within 36 hours gets one payment reminder in the daily clean-up", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", { ...eng("REM-1"), startRound: roundAt(T + 30 * 3_600_000) }, h); // starts 30 hours from now
    await call("POST", "/api/z/REM-1/publish", ok, h);
    const { housekeeping } = await import("../src/worker");
    await housekeeping(env as Env, T + 86_400_000); await housekeeping(env as Env, T + 2 * 86_400_000); // the next day: 6 hours to go; the day after: already started
    const n = (raw.prepare("SELECT COUNT(*) AS c FROM outbox WHERE to_addr='boss@acme.com' AND subject LIKE '%Payment pending for your game%'").get() as any).c;
    expect(n).toBe(1);
  });
  test("after a pack is bought, publishing counts as paid at once", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("DRAFT-4", 100), h);
    const org = (raw.prepare("SELECT org FROM engagement WHERE id='DRAFT-4'").get() as any).org;
    raw.prepare("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES('ent_t',?,500,'p',NULL,?)").run(org, T);
    const j = await (await call("POST", "/api/z/DRAFT-4/publish", ok, h)).json() as any;
    expect(j.paid).toBe(true);
    expect((await call("POST", "/api/z/DRAFT-4/join", { phone: "9876543210" })).status).toBe(200);
    expect((raw.prepare("SELECT eid FROM entitlement WHERE id='ent_t'").get() as any).eid).toBe("DRAFT-4");
  });
  test("the AI key cannot publish or pay, but hands the organizer the link", async () => {
    const { h, ai: key } = await organizer();
    await call("POST", "/api/z", eng("DRAFT-5"), h);
    const r = await (await call("POST", "/api/z/DRAFT-5/publish", {}, { "x-organizer": key })).json() as any;
    expect(r.published).toBe(false); expect(r.needsOrganizer).toBe(true); expect(r.consoleUrl).toBe("https://bingo.test/zc.html?e=DRAFT-5"); expect(r.payUrl).toBeUndefined(); // a draft is opened in the console first; the pay page link only exists once it is published
    expect(raw.prepare("SELECT pack FROM engagement WHERE id='DRAFT-5'").get()).toEqual({ pack: 0 });
    expect((await call("POST", "/api/z/DRAFT-5/join", { phone: "9876543210" })).status).toBe(403); // still a draft
  });
  test("publishing first asks the organizer to confirm a valid email and mobile number", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("CONF-1"), h);
    expect((await call("POST", "/api/z/CONF-1/publish", {}, h)).status).toBe(400);
    expect((await call("POST", "/api/z/CONF-1/publish", { email: "nope", phone: "9876543210" }, h)).status).toBe(400);
    expect((await call("POST", "/api/z/CONF-1/publish", { email: "boss@acme.com", phone: "123" }, h)).status).toBe(400);
    const r = await call("POST", "/api/z/CONF-1/publish", { email: "New.Boss@acme.com", phone: "+91 98765 43210" }, h); // corrected details are accepted
    expect(r.status).toBe(200); const j = await r.json() as any;
    expect(j.confirmed).toEqual({ email: "New.Boss@acme.com", phone: "9876543210" });
    expect(JSON.parse((raw.prepare("SELECT v FROM kv WHERE k='contact/CONF-1'").get() as any).v).phone).toBe("9876543210");
    const mail = raw.prepare("SELECT to_addr FROM outbox ORDER BY id DESC LIMIT 1").get() as any;
    expect(mail.to_addr).toBe("New.Boss@acme.com"); // the corrected address is the one that is e-mailed
  });
  test("a published engagement cannot be published again, and cannot be published once its start time has passed", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("TWICE-1"), h);
    await call("POST", "/api/z/TWICE-1/publish", ok, h);
    expect(((await (await call("POST", "/api/z/TWICE-1/publish", ok, h)).json()) as any).already).toBe(true);
    await call("POST", "/api/z", eng("LATE-1"), h);
    expect((await call("POST", "/api/z/LATE-1/publish", ok, h, T + 3 * 3_600_000)).status).toBe(400);
  });
  test("an unpaid engagement is forgotten after 30 days, with its flags and contact details", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", eng("OLD-DRAFT"), h);
    await call("POST", "/api/z/OLD-DRAFT/publish", ok, h);
    const { purgeOld } = await import("../src/worker");
    expect(await purgeOld(env as Env, T + 29 * 86_400_000)).toBe(0);
    expect(await purgeOld(env as Env, T + 31 * 86_400_000)).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k LIKE '%/OLD-DRAFT'").get()).toEqual({ c: 0 });
  });
  test("optional free-publish switch lets small engagements go out already paid", async () => {
    env.FREE_LAUNCH = "1";
    const { h } = await organizer();
    await call("POST", "/api/z", eng("DRAFT-6", 100), h);
    expect(((await (await call("POST", "/api/z/DRAFT-6/publish", ok, h)).json()) as any).paid).toBe(true);
    await call("POST", "/api/z", eng("DRAFT-7", 101), h);
    expect(((await (await call("POST", "/api/z/DRAFT-7/publish", ok, h)).json()) as any).paid).toBe(false);
  });
  test("ten unpublished drafts at most", async () => {
    const { h } = await organizer();
    for (let i = 1; i <= 10; i++) expect((await call("POST", "/api/z", eng("DR-" + String(i).padStart(2, "0")), h)).status).toBe(200);
    expect((await call("POST", "/api/z", eng("DR-11"), h)).status).toBe(409);
  });
  test("games that were published but not paid for never block a new game: only never-published drafts count toward the ten (owner order 2026-10-27)", async () => {
    const { h } = await organizer();
    for (let i = 1; i <= 12; i++) { const id = "PU-" + String(i).padStart(2, "0"); expect((await call("POST", "/api/z", eng(id, 101), h)).status).toBe(200); expect((await call("POST", `/api/z/${id}/publish`, ok, h)).status).toBe(200); } // twelve published, each waiting for payment
    expect((await call("POST", "/api/z", eng("PU-NEW", 101), h)).status).toBe(200); // a thirteenth game can still be made
    for (let i = 1; i <= 9; i++) expect((await call("POST", "/api/z", eng("PD-" + i, 101), h)).status).toBe(200); // and nine more never-published drafts: ten drafts in all
    expect((await call("POST", "/api/z", eng("PD-10", 101), h)).status).toBe(409); // the eleventh draft is refused as before
  });
  test("the platform key still creates a published engagement at once", async () => {
    const r = await (await call("POST", "/api/z", eng("PLAT-1"), { "x-organizer": "plat" })).json() as any;
    expect(r.draft).toBe(false);
    expect((await call("POST", "/api/z/PLAT-1/join", { phone: "9876543210" })).status).toBe(200);
  });
});
