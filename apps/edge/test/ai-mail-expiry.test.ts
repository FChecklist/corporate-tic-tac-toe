// The e-mailed link lasts 24 hours; "Get a fresh AI link"; the signed-in "Show my AI work link" read; the alert on unfamiliar use.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { AI_SUBJECT } from "../src/mails";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const H = 3_600_000;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const outbox = () => raw.prepare("SELECT to_addr, subject, body FROM outbox ORDER BY id").all() as { to_addr: string; subject: string; body: string }[];
const mailedKey = (b: string) => b.match(/cba_[0-9a-f]{48}/)![0];
const LEAK = /cba_[0-9a-f]|cbh_[0-9a-f]|\/ai\//;

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "test-data-key" };
});
async function organizer(email = "boss@acme.com", ip = "1.1.1.1") {
  const x = await j(await call("POST", "/api/start", { email }, { "cf-connecting-ip": ip }));
  return { h: { "x-organizer": x.token as string }, ai: x.aiKey as string };
}

describe("the e-mailed link lasts 24 hours", () => {
  test("valid at 23 h 59 min, the same plain 404 as an unknown key after 24 h; the lasting key is unaffected", async () => {
    const o = await organizer(); const mk = mailedKey(outbox()[0]!.body);
    const at = (ms: number, p: string) => call("GET", p, undefined, {}, T + ms);
    expect((await at(23 * H + 59 * 60_000, `/ai/${mk}`)).status).toBe(200);
    expect((await at(23 * H + 59 * 60_000, `/ai/${mk}/whoami`)).status).toBe(200);
    const gone = await at(24 * H, `/ai/${mk}`), unknown = await at(24 * H, `/ai/cba_${"0".repeat(48)}`);
    expect(gone.status).toBe(404); expect(await gone.text()).toBe(await unknown.text());
    expect((await at(24 * H + 1, `/ai/${mk}/whoami`)).status).toBe(404);
    expect((await call("GET", "/api/whoami", undefined, { "x-organizer": mk }, T + 25 * H)).status).toBe(403);
    expect((await at(30 * 24 * H, `/ai/${o.ai}`)).status).toBe(200); // the lasting key never expires
    expect((await call("GET", "/api/whoami", undefined, o.h, T + 30 * 24 * H)).status).toBe(200);
  });
  test("Get a fresh AI link: a new 24-hour key by mail; the lasting key and earlier links are untouched; AI, co-host, platform and anonymous callers are refused", async () => {
    const o = await organizer(); const first = mailedKey(outbox()[0]!.body);
    const r = await call("POST", "/api/org/ai/fresh", {}, o.h, T + H); const x = await j(r);
    expect(r.status).toBe(200); expect(x.mailed).toBe(true); expect(x.expiresMs).toBe(T + H + 24 * H); expect(x.aiMessage).toBeUndefined();
    const m = outbox().at(-1)!; expect(m.subject).toBe(AI_SUBJECT); expect(m.body).toMatch(/fresh personal AI work link/i); const fresh = mailedKey(m.body);
    expect(fresh).not.toBe(first); expect(fresh).not.toBe(o.ai);
    for (const k of [fresh, first, o.ai]) expect((await call("GET", `/ai/${k}`, undefined, {}, T + 4 * H)).status).toBe(200);
    expect((await call("GET", `/ai/${first}`, undefined, {}, T + 24 * H + 30 * 60_000)).status).toBe(404); expect((await call("GET", `/ai/${fresh}`, undefined, {}, T + 24 * H + 30 * 60_000)).status).toBe(200); // each key has its own 24 hours
    const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h));
    for (const hdr of <Record<string, string>[]>[{ "x-organizer": o.ai }, { "x-organizer": hk.hostKey }, { "x-organizer": fresh }, { "x-organizer": "plat" }, {}]) expect((await call("POST", "/api/org/ai/fresh", {}, hdr)).status).toBe(403);
    expect((await call("POST", `/ai/${o.ai}/org/ai/fresh`, {})).status).toBe(403);
  });
  test("5 live fresh links at most; Replace kills every AI key, the 24-hour ones too; a co-host key made by mail does not use up the co-host places", async () => {
    const o = await organizer(); const first = mailedKey(outbox()[0]!.body);
    for (let i = 0; i < 4; i++) expect((await call("POST", "/api/org/ai/fresh", {}, o.h)).status).toBe(200);
    expect((await call("POST", "/api/org/ai/fresh", {}, o.h)).status).toBe(429);
    const x = await j(await call("POST", "/api/org/ai/replace", {}, o.h));
    expect((await call("GET", `/ai/${first}`)).status).toBe(404); expect((await call("GET", `/ai/${o.ai}`)).status).toBe(404); expect((await call("GET", `/ai/${x.aiKey}`)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)).status).toBe(200);
    expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)).status).toBe(409);
  });
  test("an organizer with no e-mail on file gets the 24-hour paste in the answer (mailed: false)", async () => {
    const mk = await j(await call("POST", "/api/org", {}, { "x-organizer": "plat" }));
    const x = await j(await call("POST", "/api/org/ai/fresh", {}, { "x-organizer": mk.organizerKey }));
    expect(x.mailed).toBe(false); expect(x.aiMessage).toContain("/ai/cba_");
  });
});

describe("Show my AI work link: the signed-in read behind the e-mail's button", () => {
  test("only the organizer's own sign-in gets the lasting paste; it is never the key in the mail; AI, co-host, platform and anonymous are refused", async () => {
    const o = await organizer(); const mailKey = mailedKey(outbox()[0]!.body);
    const r = await j(await call("GET", "/api/org/ai/link", undefined, o.h));
    expect(r.aiMessage).toContain(`/ai/${o.ai}`); expect(r.aiMessage.split("\n").length).toBe(2); expect(r.aiMessage).not.toContain(mailKey);
    const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h));
    for (const hdr of <Record<string, string>[]>[{ "x-organizer": o.ai }, { "x-organizer": mailKey }, { "x-organizer": hk.hostKey }, { "x-organizer": "plat" }, {}]) expect((await call("GET", "/api/org/ai/link", undefined, hdr)).status).toBe(403);
    expect((await call("GET", `/ai/${o.ai}/org/ai/link`)).status).toBe(403);
    const x = await j(await call("POST", "/api/org/ai/replace", {}, o.h));
    expect((await j(await call("GET", "/api/org/ai/link", undefined, o.h))).aiMessage).toContain(`/ai/${x.aiKey}`);
    await call("POST", "/api/org/ai/revoke", {}, o.h);
    expect((await j(await call("GET", "/api/org/ai/link", undefined, o.h))).aiMessage).toBeNull();
  });
  test("the lasting key is stored sealed, never in the clear, and never mailed", async () => {
    const o = await organizer();
    expect(JSON.stringify(raw.prepare("SELECT * FROM kv").all())).not.toContain(o.ai);
    for (const m of outbox()) expect(m.body).not.toContain(o.ai);
  });
});

describe("alert when a link is used from somewhere new", () => {
  const alerts = () => outbox().filter((m) => /Someone new used/.test(m.subject));
  const use = (key: string, ip: string, country: string, ua: string, at: number, path = "") => call("GET", `/ai/${key}${path}`, undefined, { "cf-connecting-ip": ip, "cf-ipcountry": country, "user-agent": ua }, at);
  test("first use is the baseline; the same place and program: nothing; a new country: one plain alert with no link; another new place within 24 h: none; after 24 h: again", async () => {
    const o = await organizer();
    await use(o.ai, "203.0.113.5", "US", "ChatGPT-User/1.0", T);
    await use(o.ai, "203.0.113.77", "US", "ChatGPT-User/1.0 (more)", T + 1000, "/whoami");
    expect(alerts().length).toBe(0);
    await use(o.ai, "198.51.100.9", "DE", "ChatGPT-User/1.0", T + 2000);
    expect(alerts().length).toBe(1);
    const a = alerts()[0]!; expect(a.to_addr).toBe("boss@acme.com"); expect(a.body).toMatch(/Replace my AI link/); expect(a.body).toContain("DE");
    expect(a.body + a.subject).not.toMatch(LEAK); expect(a.body).not.toContain(o.ai);
    await use(o.ai, "198.51.100.9", "DE", "ChatGPT-User/1.0", T + 3000); // seen now
    await use(o.ai, "192.0.2.4", "FR", "Claude-User/1.0", T + 4000); // new again, within 24 h
    expect(alerts().length).toBe(1);
    await use(o.ai, "192.0.2.5", "JP", "Gemini/2", T + 25 * H);
    expect(alerts().length).toBe(2);
  });
  test("a new program or network prefix alone counts; API calls through the link count; unknown keys never alert", async () => {
    const o = await organizer();
    await use(o.ai, "203.0.113.5", "US", "ChatGPT-User/1.0", T, "/whoami");
    await use(o.ai, "203.0.113.5", "US", "curl/8.0", T + 1000, "/whoami");
    expect(alerts().length).toBe(1);
    const o2 = await organizer("second@acme.com", "9.9.9.9");
    await use(o2.ai, "203.0.113.5", "US", "ChatGPT-User/1.0", T);
    await use(o2.ai, "198.51.100.1", "US", "ChatGPT-User/1.0", T + 1000);
    expect(alerts().length).toBe(2);
    const n = alerts().length; await use("cba_" + "1".repeat(48), "1.2.3.4", "XX", "x", T); expect(alerts().length).toBe(n);
  });
});
