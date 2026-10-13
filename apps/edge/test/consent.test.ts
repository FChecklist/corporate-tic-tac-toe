// The Terms boxes (K1 publish, K2 sign-up and sign-in, K3 before paying, K4 joining, K5 Host and Co-host, K6 guest lists) and the money gate (nothing is ever taken from a player).
// This file uses the REAL handle (no helper that ticks for you): the server must refuse each of these actions without the ticks.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { handle, type Env } from "../src/worker";
import { CONSENT_VERSION, KINDS, boxesOf, hasConsented, wordingOf, type Kind } from "../src/consent";
import { TERMS_VERSION } from "../src/brand";
import TEXT from "../src/consent-text.json";
import { makeD1 } from "./d1-sqlite";

const realFetch = globalThis.fetch;
const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let ip = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ip}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
const tick = (k: Kind, v: string = CONSENT_VERSION) => ({ v, boxes: boxesOf(k).map(([id]) => id) });
const rows = (kind: string) => raw.query("SELECT * FROM consent_log WHERE kind=? ORDER BY at_ms, id").all(kind) as any[];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const JSON_FILE = "C:/Users/Dell/AppData/Local/Temp/claude/C--ct-ct/2cf843e7-2735-4b37-9fc2-d660aa06a369/scratchpad/CONSENT_TEXT.json";

beforeEach(() => {
  const d = makeD1({ strictHosts: true }); raw = d.raw; ip = 0;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); return new Response(JSON.stringify({ id: "order_1", amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" })); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env;
});
afterEach(() => { globalThis.fetch = realFetch; });

async function organizer(email = "boss@acme.com") { const r = await j(await call("POST", "/api/start", { email, consent: tick("K2") })); return { "x-organizer": r.token as string }; }
async function game(h: Record<string, string>, id: string) { expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, h)).status).toBe(200); return id; }
const REFUSED = { error: "Please tick the box to continue.", code: "consent-required" };

describe("test 5: the wording is the contract's wording, from one place", () => {
  test("consent-text.json holds the version and the exact boxes; the version is the one constant in brand.ts", () => {
    expect((TEXT as any).version).toBe(TERMS_VERSION); expect(CONSENT_VERSION).toBe(TERMS_VERSION);
    if (existsSync(JSON_FILE)) expect(JSON.parse(readFileSync(JSON_FILE, "utf8"))).toEqual(TEXT);
    expect(boxesOf("K1").map((b) => b[0])).toEqual(["A", "B"]); expect(boxesOf("K4").map((b) => b[0])).toEqual(["A", "B"]); expect(boxesOf("K2").map((b) => b[0])).toEqual(["A"]);
  });
  test("the server gives the pages that exact wording for every point, string for string", async () => {
    for (const k of KINDS) {
      const r = await j(await call("GET", `/api/consent/text?kind=${k}`)); expect(r.version).toBe(TERMS_VERSION);
      expect(r.boxes.map((b: any) => [b.id, b.text])).toEqual(Object.entries((TEXT as any)[k]));
    }
  });
  test("no page types the wording itself, and nothing is ticked in advance", () => {
    const dir = new URL("../../web/public/", import.meta.url);
    const all = Object.entries(TEXT as any).filter(([k]) => /^K\d/.test(k)).flatMap(([, v]) => Object.values(v as any)) as string[];
    for (const f of readdirSync(dir).filter((x) => /\.(js|html)$/.test(x) && !["terms.html", "legal-position.html"].includes(x))) { const t = readFileSync(new URL(f, dir), "utf8"); for (const w of all) expect([f, t.includes(w)]).toEqual([f, false]); if (["termsbox.js", "ttt.js", "site.js", "pay.js", "paylink.js", "signin.js", "ai-link.js", "host.js"].includes(f)) expect([f, /type="checkbox"[^>]*[ ]checked[ >]/.test(t)]).toEqual([f, false]); }
  });
});

describe("tests 1-4 at every point", () => {
  test("K2 sign-up: refused without the tick (nothing is created), accepted with it; the row is re-read from the database", async () => {
    const no = await call("POST", "/api/start", { email: "a@acme.com" }); expect(no.status).toBe(400); expect(await j(no)).toMatchObject({ ...REFUSED, kind: "K2", version: CONSENT_VERSION });
    expect(raw.query("SELECT COUNT(*) c FROM organizer_email").get()).toEqual({ c: 0 }); expect(raw.query("SELECT COUNT(*) c FROM consent_log").get()).toEqual({ c: 0 });
    expect((await call("POST", "/api/start", { email: "a@acme.com", consent: { v: CONSENT_VERSION, boxes: [] } })).status).toBe(400);
    const ok = await call("POST", "/api/start", { email: "a@acme.com", consent: tick("K2") }, {}, T + 5); expect(ok.status).toBe(200);
    const r = rows("K2"); expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ kind: "K2", version: CONSENT_VERSION, boxes: "A", at_ms: T + 5, text_hash: sha(wordingOf("K2")) });
    expect(r[0].subject).toBe((raw.query("SELECT org FROM organizer_email").get() as any).org);
    expect((raw.query("SELECT COUNT(*) c FROM organizer_terms").get() as any).c).toBe(1); // the older record of the Terms version is kept too
  });
  test("K2 sign-in by e-mail code needs the tick too", async () => {
    await organizer("b@acme.com");
    expect((await call("POST", "/api/auth/email", { email: "b@acme.com" })).status).toBe(400);
    expect((await call("POST", "/api/auth/email", { email: "b@acme.com", consent: tick("K2") })).status).toBe(200);
    expect(rows("K2").length).toBe(2);
  });
  test("K1 publish: both boxes are needed; the game stays unpublished without them; with them the rows carry the game id", async () => {
    const h = await organizer(); const id = await game(h, "CON-1"); const body = { email: "boss@acme.com", phone: "98765 43210" };
    const none = await call("POST", `/api/z/${id}/publish`, body, h); expect(none.status).toBe(400); expect(await j(none)).toMatchObject({ ...REFUSED, kind: "K1" });
    expect((await call("POST", `/api/z/${id}/publish`, { ...body, consent: { v: CONSENT_VERSION, boxes: ["A"] } }, h)).status).toBe(400);
    expect(rows("K1").length).toBe(0); expect((raw.query("SELECT pack FROM engagement WHERE id=?").get(id) as any).pack).toBe(0);
    expect((await call("POST", `/api/z/${id}/publish`, { ...body, consent: tick("K1") }, h, T + 9)).status).toBe(200);
    const r = rows("K1"); expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ kind: "K1", ref: id, version: CONSENT_VERSION, boxes: "A,B", at_ms: T + 9, text_hash: sha(wordingOf("K1")) });
    expect(r[0].subject).toBe((raw.query("SELECT org FROM engagement WHERE id=?").get(id) as any).org);
  });
  test("K1: the AI helper's path stays a hand-over; it cannot tick (it only gets 'ask the organizer')", async () => {
    const o = await j(await call("POST", "/api/start", { email: "ai@acme.com", consent: tick("K2") })); const ai = { "x-organizer": o.aiKey as string };
    await game({ "x-organizer": o.token }, "CON-1A");
    const r = await j(await call("POST", "/api/z/CON-1A/publish", { email: "ai@acme.com", phone: "98765 43210", consent: tick("K1") }, ai));
    expect(r.needsOrganizer).toBe(true); expect(rows("K1").length).toBe(0);
  });
  test("K3 before paying: no order without the tick; with it the order is made and the row names the payment", async () => {
    const h = await organizer(); await game(h, "CON-2");
    const pay = { eid: "CON-2", org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", pack: 500 };
    const no = await call("POST", "/api/checkout", pay, h); expect(no.status).toBe(400); expect(await j(no)).toMatchObject({ ...REFUSED, kind: "K3" });
    expect(raw.query("SELECT COUNT(*) c FROM payment").get()).toEqual({ c: 0 });
    expect((await call("POST", "/api/checkout", { ...pay, consent: tick("K3") }, h, T + 3)).status).toBe(200);
    const r = rows("K3"); expect(r.length).toBe(1); expect(r[0]).toMatchObject({ kind: "K3", version: CONSENT_VERSION, boxes: "A", at_ms: T + 3, text_hash: sha(wordingOf("K3")) });
    expect(r[0].ref).toBe((raw.query("SELECT id FROM payment").get() as any).id);
  });
  async function published(id: string) { const h = await organizer(); await game(h, id); await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210", consent: tick("K1") }, h); raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]); return h; }
  test("K4 joining: no seat and no name stored without both boxes; with both the person joins and the row is tied to their seat", async () => {
    await published("CON-3"); const body = { name: "Maya Lopez", device: dev(1) };
    const none = await call("POST", "/api/z/CON-3/join", body); expect(none.status).toBe(400); expect(await j(none)).toMatchObject({ ...REFUSED, kind: "K4" });
    expect((await call("POST", "/api/z/CON-3/join", { ...body, consent: { v: CONSENT_VERSION, boxes: ["A"] } })).status).toBe(400);
    expect(raw.query("SELECT COUNT(*) c FROM seat").get()).toEqual({ c: 0 }); expect(raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 0 });
    const ok = await call("POST", "/api/z/CON-3/join", { ...body, consent: tick("K4") }, {}, T + 7); expect(ok.status).toBe(200); const pid = (await j(ok)).pid;
    const r = rows("K4"); expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ subject: pid, kind: "K4", ref: "CON-3", version: CONSENT_VERSION, boxes: "A,B", at_ms: T + 7, text_hash: sha(wordingOf("K4")) });
  });
  test("K4: the notice says who invited me is recorded; 24 hours after the game that row, the seat and the invitation record are gone, the organizer's rows stay", async () => {
    const h = await published("CON-4"); expect(boxesOf("K4")[0]![1]).toContain("who invited me is recorded until then");
    expect((await call("POST", "/api/z/CON-4/people", { people: [{ name: "Ravi", phone: "9876500001" }] }, h)).status).toBe(400); // K6 needed
    expect((await call("POST", "/api/z/CON-4/people", { people: [{ name: "Ravi", phone: "9876500001" }], consent: tick("K6") }, h)).status).toBe(200);
    const tok = (await j(await call("GET", "/api/z/CON-4/people", undefined, h))).people[0].link.split("/j/")[1];
    expect((await call("POST", "/api/z/CON-4/join", { token: tok, device: dev(5), name: "Ravi", consent: tick("K4") })).status).toBe(200);
    expect((raw.query("SELECT COUNT(*) c FROM person WHERE eid='CON-4'").get() as any).c).toBe(1);
    await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, T + 3 * 86_400_000);
    for (const t of ["person", "seat", "participant"]) expect([t, (raw.query(`SELECT COUNT(*) c FROM ${t} WHERE eid='CON-4'`).get() as any).c]).toEqual([t, 0]);
    expect(rows("K4").length).toBe(0); expect(rows("K1").length).toBe(1); expect(rows("K6").length).toBe(1);
  });
  async function team() {
    const master = await organizer(); await game(master, "CON-5");
    const host = (await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master))).hostKey as string;
    const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: "CON-5" }, master))).cohostKey as string;
    return { master, host, cohost };
  }
  test("K5 Co-host: nothing works until the box is ticked; the tick is stored; a row from an older version does not count", async () => {
    const t = await team(); const ch = { "x-organizer": t.cohost };
    const blocked = await call("GET", "/api/z/CON-5/cohost", undefined, ch); expect(blocked.status).toBe(403); expect((await j(blocked)).code).toBe("consent-required");
    expect((await call("POST", "/api/org/role/accept", {}, ch)).status).toBe(400);
    expect((await call("POST", "/api/org/role/accept", { consent: tick("K5") }, ch, T + 4)).status).toBe(200);
    expect((await call("GET", "/api/z/CON-5/cohost", undefined, ch)).status).toBe(200);
    expect(rows("K5")[0]).toMatchObject({ kind: "K5", ref: "CON-5", version: CONSENT_VERSION, boxes: "A", at_ms: T + 4, text_hash: sha(wordingOf("K5")) });
    raw.run("UPDATE consent_log SET version='2020-01-01' WHERE kind='K5'"); // as if the Terms had changed since
    expect((await call("GET", "/api/z/CON-5/cohost", undefined, ch)).status).toBe(403);
  });
  test("K5 Host: the first-open setup refuses the e-mail step without the tick", async () => {
    const t = await team(); const hh = { "x-organizer": t.host };
    const no = await call("POST", "/api/host/setup/email", { email: "priya@acme.com" }, hh); expect(no.status).toBe(400); expect((await j(no)).code).toBe("consent-required");
    expect((await call("POST", "/api/host/setup/email", { email: "priya@acme.com", consent: tick("K5") }, hh)).status).not.toBe(400);
    expect(rows("K5").length).toBe(1);
  });
  test("K6 guest lists: the invite list (roster) and people added in the console are refused without the tick and stored with it", async () => {
    const h = await published("CON-6"); const list = { people: [{ name: "Ravi", phone: "9876500001" }] };
    for (const path of ["/api/z/CON-6/roster", "/api/z/CON-6/people"]) { const no = await call("POST", path, list, h); expect([path, no.status]).toEqual([path, 400]); expect(await j(no)).toMatchObject({ ...REFUSED, kind: "K6" }); }
    expect((raw.query("SELECT COUNT(*) c FROM person WHERE eid='CON-6'").get() as any).c).toBe(0);
    expect((await call("POST", "/api/z/CON-6/people", { ...list, consent: tick("K6") }, h, T + 8)).status).toBe(200);
    expect(rows("K6")[0]).toMatchObject({ kind: "K6", ref: "CON-6", version: CONSENT_VERSION, boxes: "A", at_ms: T + 8, text_hash: sha(wordingOf("K6")) });
  });
});

describe("test 4: a new version of the Terms asks again", () => {
  test("a tick made under an older version is refused at every point, and an older row does not count", async () => {
    const OLD = "2020-01-01";
    expect((await call("POST", "/api/start", { email: "v@acme.com", consent: tick("K2", OLD) })).status).toBe(400);
    const h = await organizer("w@acme.com"); const id = await game(h, "CON-V");
    const pub = await call("POST", `/api/z/${id}/publish`, { email: "w@acme.com", phone: "98765 43210", consent: tick("K1", OLD) }, h); expect(pub.status).toBe(400); expect((await j(pub)).version).toBe(CONSENT_VERSION);
    expect((await call("POST", "/api/checkout", { eid: id, org: "A Ltd", email: "w@acme.com", country: "IN", taxId: "", currency: "INR", pack: 500, consent: tick("K3", OLD) }, h)).status).toBe(400);
    expect((await call("POST", `/api/z/${id}/publish`, { email: "w@acme.com", phone: "98765 43210", consent: tick("K1") }, h)).status).toBe(200); raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
    expect((await call("POST", `/api/z/${id}/join`, { name: "Old Tick", device: dev(9), consent: tick("K4", OLD) })).status).toBe(400);
    const d = makeD1({ strictHosts: true });
    d.raw.run("INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES('x','org1','K1','G','2020-01-01','A,B','h',1)");
    expect(await hasConsented(d.db, "org1", "K1")).toBe(false);
    d.raw.run("INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES('y','org1','K1','G',?,'A,B','h',2)", [CONSENT_VERSION]);
    expect(await hasConsented(d.db, "org1", "K1")).toBe(true);
  });
});

describe("test 7: the log holds no account, address or phone", () => {
  test("consent_log has exactly the agreed columns and nothing that identifies a person's contact details", () => {
    const cols = (raw.query("PRAGMA table_info(consent_log)").all() as any[]).map((c) => c.name);
    expect(cols).toEqual(["id", "subject", "kind", "ref", "version", "boxes", "text_hash", "at_ms"]);
    for (const c of cols) expect(/(^|_)(ip|ua|agent|phone|mobile|email|mail|account|name|address)(_|$)/i.test(c)).toBe(false);
  });
  test("what is stored for a participant is the seat id, never the name, the number or the device", async () => {
    const h = await organizer(); await game(h, "CON-8"); await call("POST", "/api/z/CON-8/publish", { email: "boss@acme.com", phone: "98765 43210", consent: tick("K1") }, h); raw.run("UPDATE engagement SET pack=100 WHERE id='CON-8'");
    await call("POST", "/api/z/CON-8/join", { name: "Maya Lopez", device: dev(3), consent: tick("K4") }, { "cf-connecting-ip": "203.0.113.9", "user-agent": "TestPhone/1.0" });
    const all = JSON.stringify(raw.query("SELECT * FROM consent_log").all());
    for (const x of ["Maya", "203.0.113.9", "TestPhone", dev(3), "98765", "boss@acme.com"]) expect(all).not.toContain(x);
  });
});

describe("nothing is ever taken from a player", () => {
  test("the player's routes have no payment code and no fee setting; a whole game leaves the payment table empty", async () => {
    const src = (f: string) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
    expect(/checkout|razorpay|payment|amount|price\(/i.test(src("tournament.ts"))).toBe(false);
    const pages = new URL("../../web/public/", import.meta.url);
    for (const f of ["ttt.js", "big.js"]) expect([f, /checkout|razorpay|pay\.html|rupee|\u20b9|\/api\/payments/i.test(readFileSync(new URL(f, pages), "utf8"))]).toEqual([f, false]);
    const h = await organizer(); await game(h, "CON-7");
    for (const field of ["fee", "entryFee", "price", "stake", "ticketPrice"]) { await call("PATCH", "/api/z/CON-7/settings", { [field]: 10 }, h); expect([field, ((raw.query("SELECT config FROM engagement WHERE id='CON-7'").get() as any).config ?? "").includes(field)]).toEqual([field, false]); }
    await call("POST", "/api/z/CON-7/publish", { email: "boss@acme.com", phone: "98765 43210", consent: tick("K1") }, h); raw.run("UPDATE engagement SET pack=100 WHERE id='CON-7'");
    const jr = await j(await call("POST", "/api/z/CON-7/join", { name: "Ann Lee", device: dev(1), consent: tick("K4") }));
    expect(JSON.stringify(jr)).not.toMatch(/razorpay|checkout|payment|amount/i); expect(raw.query("SELECT COUNT(*) c FROM payment").get()).toEqual({ c: 0 });
  });
  test("every payment route needs the organizer's own box (K3), and no module pays anybody out", () => {
    expect(readFileSync(new URL("../src/pay.ts", import.meta.url), "utf8")).toContain('consentRequired(b, "K3")');
    expect(readdirSync(new URL("../src/", import.meta.url)).some((f) => /prize|payout|withdraw|wallet/i.test(f))).toBe(false);
  });
});
