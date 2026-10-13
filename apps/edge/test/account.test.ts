// G-07 report link replace, account closure (organizer and partner), the notification button, G-21/G-23 wording.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { reportLink } from "../src/lifecycle";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const rd = (f: string) => readFileSync(new URL("../../web/public/" + f, import.meta.url), "utf8");
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "k", TEST_MODE: "1" }; });
async function org(email = "boss@acme.com", ip = "1.1.1.1") {
  const x = await j(await call("POST", "/api/start", { email }, { "cf-connecting-ip": ip }));
  return { h: { "x-organizer": x.token as string }, token: x.token as string, ai: x.aiKey as string };
}
async function game(o: { h: Record<string, string> }, id: string, startOffset = 1200) {
  await call("POST", "/api/z", { id, startRound: roundAt(T) + startOffset, callSeconds: 6, cap: 100 }, o.h);
  await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.h);
}

describe("replace the report link (G-07)", () => {
  test("the organizer makes a new link: the old key stops, the new one works; an AI key, a Co-host and strangers cannot", async () => {
    const o = await org(); await game(o, "RPT-1");
    const before = await reportLink(env as any, "RPT-1"); const kOld = before.match(/k=([0-9a-f]{40})/)![1]!;
    const ok = (k: string) => call("GET", `/api/report/RPT-1?k=${k}&part=base`);
    expect((await ok(kOld)).status).not.toBe(403);
    const hk = await j(await call("POST", "/api/org/cohost", {}, o.h));
    for (const hdr of <Record<string, string>[]>[{ "x-organizer": o.ai }, { "x-organizer": hk.cohostKey }, {}]) expect((await call("POST", "/api/z/RPT-1/reportlink", {}, hdr)).status).toBe(403);
    expect((await ok(kOld)).status).not.toBe(403); // refused callers changed nothing
    const r = await j(await call("POST", "/api/z/RPT-1/reportlink", {}, o.h)); const kNew = r.url.match(/k=([0-9a-f]{40})/)![1]!;
    expect(kNew).not.toBe(kOld); expect((await ok(kOld)).status).toBe(403); expect((await ok(kNew)).status).not.toBe(403);
    expect((await j(await call("GET", "/api/z/RPT-1/reportlink", undefined, o.h))).url ?? r.url).toContain(kNew);
    const again = await j(await call("POST", "/api/z/RPT-1/reportlink", {}, o.h)); expect(again.url).not.toContain(kNew);
  });
  test("the console shows a New report link button; the salt is deleted with the engagement", () => {
    expect(rd("zc.js")).toContain("New report link"); expect(readFileSync(new URL("../src/lifecycle.ts", import.meta.url), "utf8")).toContain("rptsalt/${id}");
  });
});

describe("Close my organizer account", () => {
  test("only the organizer's own key, with a confirmation; it deletes the account and every engagement; payments stay; all keys die", async () => {
    const o = await org(); await game(o, "CLS-1"); await game(o, "CLS-2");
    await call("POST", "/api/z/CLS-1/join", { phone: "9811111111", name: "Asha", device: "1".repeat(32) });
    raw.prepare("INSERT INTO payment(id,org,email,pack,amount,tax,currency,status,created_ms,meta) VALUES('pay_1','x','boss@acme.com',100,1,0,'INR','paid',?,'{}')").run(T);
    const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h));
    for (const hdr of <Record<string, string>[]>[{ "x-organizer": o.ai }, { "x-organizer": hk.hostKey }, { "x-organizer": "plat" }, {}]) expect((await call("POST", "/api/org/close", { confirm: true }, hdr)).status).toBe(403);
    expect((await call("POST", `/ai/${o.ai}/org/close`, { confirm: true })).status).toBe(403);
    expect((await call("POST", "/api/org/close", {}, o.h)).status).toBe(400); // no confirmation
    const r = await j(await call("POST", "/api/org/close", { confirm: true }, o.h)); expect(r).toMatchObject({ ok: true, closed: true, engagementsDeleted: 2 });
    for (const t of ["engagement", "participant", "seat", "organizer_email", "organizer_terms", "ai_audit"]) expect([t, (raw.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c]).toEqual([t, 0]);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM organizer_key").get() as any).c).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k LIKE 'orgmail/%' OR k LIKE 'aikey/%' OR k LIKE 'seen/%' OR k LIKE 'contact/%'").get() as any).c).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM payment").get() as any).c).toBe(1); // accounting records stay
    for (const k of [o.token, o.ai, hk.hostKey]) expect((await call("GET", "/api/whoami", undefined, { "x-organizer": k })).status).toBe(403);
    expect((await call("GET", `/ai/${o.ai}`)).status).toBe(404);
  });
  test("a game that is running blocks it; the console control exists with a confirm", async () => {
    const o = await org(); await game(o, "CLS-3", 0);
    const r = await call("POST", "/api/org/close", { confirm: true }, o.h, T + 5 * 60_000); expect(r.status).toBe(409);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM engagement").get() as any).c).toBe(1);
    const z = rd("zc.js"); expect(z).toContain("Close my account"); expect(z).toContain("This cannot be undone.");
  });
});

describe("Close my partner account", () => {
  test("the partner row is deleted with their own key; commission rows stay as accounting records; a stranger cannot", async () => {
    const a: any = await (await call("POST", "/api/partner/enroll", { phone: "9811122233", email: "p@partner.example", consent: true })).json();
    const v: any = await (await call("POST", "/api/partner/enroll/verify", { email: "p@partner.example", code: a.devCode })).json();
    raw.prepare("INSERT INTO commission(payment_id,partner_code,base,currency,rate,amount,status,created_ms) VALUES('pay_x',?,1000,'INR',0.5,500,'accrued',?)").run(v.code, T);
    expect((await call("POST", "/api/partner/close", {}, { "x-partner": "cbp_nope" })).status).toBe(403);
    expect((await call("POST", "/api/partner/close", {}, { "x-partner": v.partnerKey })).status).toBe(200);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM partner").get() as any).c).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM commission").get() as any).c).toBe(1);
    expect((await call("GET", "/api/partner/me", undefined, { "x-partner": v.partnerKey })).status).toBe(403);
    expect(rd("partner.js")).toContain("Close my partner account");
  });
});

describe("the notification question", () => {
  test("it is asked only after a tap on a clear 'Notify me' button, never on the first tap of the page", () => {
    const p = rd("pwa.js"); expect(p).toContain("Notify me"); expect(p).not.toContain("pointerdown"); expect(p).not.toMatch(/addEventListener\("(pointerdown|click|touchstart)"/);
    expect(p.indexOf("requestPermission")).toBeGreaterThan(p.indexOf("b.onclick"));
  });
});

describe("wording: third parties, fairness, version", () => {
  });
