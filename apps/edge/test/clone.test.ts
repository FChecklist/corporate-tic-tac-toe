import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { lifecycleTick } from "../src/lifecycle";
const MAX_AHEAD_MS = 30 * 86_400_000; // written out on purpose: the test must not follow a changed constant
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

// Spec 5 B (docs/ROLES_AND_CONSOLE_SPEC_5.md): POST /api/z/{id}/clone = "Create a new game like this one". A new DRAFT with the settings; never the payment, status, guests, Co-hosts or personal links;
// the date and time are chosen again; the people list can come along (new personal links) while it still exists.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const H = 3_600_000, DAY = 24 * H;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let orders: any[]; let payments: Record<string, any>;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const count = (sql: string, ...a: any[]) => (raw.prepare(sql).get(...a) as any).c as number;
beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {};
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (!u.startsWith("https://rzp.test")) return realFetch(url, init);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = payments[pm[1]!]; if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p)); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test", OWNER_EMAIL: "owner@platform.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

let ip = 0, lastAi = "";
const start = async (email: string) => { const r = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `8.8.8.${++ip}` }, body: JSON.stringify({ email }) }), env as Env, T)); lastAi = r.aiKey as string; return r.token as string; };
const PUB = { email: "boss@acme.com", phone: "9876543210" };
const GAME_START = T + 3 * H;
const BRAND = { name: "Acme Foods", color: "#0B3D91" };
const REWARDS = [{ pattern: "third", text: "Hamper" }, { pattern: "first", text: "Voucher" }, { pattern: "second", text: "Mug" }];
/** An Organizer, a Host and a Co-host; OLD-1 (300 people, 2 tickets, 2 rounds, list-only, prizes, brand, guest invites) with a guest, a listed person and a waiting request. */
const world = async (publish = true) => {
  const master = await start("boss@acme.com"); const ai = lastAi;
  expect((await call("POST", "/api/z", { id: "OLD-1", startRound: roundAt(GAME_START), callSeconds: 12, cap: 300, tickets: 2, rounds: 2, rewards: REWARDS, brand: BRAND, name: "Diwali Party" }, master)).status).toBe(200);
  expect((await call("PATCH", "/api/z/OLD-1/settings", { guestInvites: { on: true, per: 3 }, whoCanJoin: "list", coHostLimit: 50 }, master)).status).toBe(200);
  const host = (await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master))).hostKey as string;
  const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "98765 00001", e: "OLD-1" }, master))).cohostKey as string;
  if (publish) await call("POST", "/api/z/OLD-1/publish", PUB, master);
  return { master, ai, host, cohost };
};
const row = (id: string) => raw.prepare("SELECT * FROM engagement WHERE id=?").get(id) as any;
const clone = (key: string | undefined, body: unknown = {}, id = "OLD-1", now = T) => call("POST", `/api/z/${id}/clone`, body, key, now);
const people = (key: string, list: { name: string; phone: string }[], eid = "OLD-1") => call("POST", `/api/z/${eid}/people`, { people: list }, key);
const pay = (key: string, eid: string, now = T) => call("POST", "/api/checkout", { eid, org: "Acme Ltd", name: "Boss", email: "payer@acme.com", country: "IN", taxId: "", currency: "INR" }, key, now);
const sign = (c: any, id: string) => createHmac("sha256", "sek").update(`${c.razorpay.orderId}|${id}`).digest("hex");
const complete = async (c: any, id = "pay_" + (Object.keys(payments).length + 1), now = T) => {
  payments[id] = { id, order_id: c.razorpay.orderId, status: "captured", amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: sign(c, id) }, undefined, now);
};

describe("who may clone", () => {
  test("the Organizer and a Host (equal rights); never an AI key, a Co-host, a stranger or another account", async () => {
    const t = await world();
    const a = await clone(t.master); expect(a.status).toBe(200);
    const b = await clone(t.host); expect(b.status).toBe(200);
    for (const key of [t.cohost, t.ai, undefined, "cbk_" + "0".repeat(48)]) expect((await clone(key as string)).status).toBe(403);
    const other = await start("rival@other.com"); expect((await clone(other)).status).toBe(403);
    expect((await clone(t.master, {}, "NOPE-1")).status).toBe(404);
    expect(count("SELECT COUNT(*) AS c FROM engagement")).toBe(3);
  });
});

describe("what the new game is", () => {
  test("a new DRAFT with a new id and exactly this answer shape; the old game is untouched", async () => {
    const t = await world(); const before = row("OLD-1");
    const r = await clone(t.master, { withPeople: false }); const b = await j(r); const newId = b.id as string;
    expect(newId).toMatch(/^OLD-1-[A-Z2-9]{4}$/);
    expect({ ok: b.ok, openUrl: b.openUrl, peopleCopied: b.peopleCopied }).toEqual({ ok: true, openUrl: `https://bingo.test/zc.html?e=${newId}`, peopleCopied: 0 });
    expect(Array.isArray(b.copied)).toBe(true); expect(b.copied).toContain("Prizes (all places and their texts)"); expect(b.copied).toContain("Brand strip"); expect(b.copied).toContain("Guest invites");
    const n = row(newId);
    expect(n).toMatchObject({ org: before.org, pack: 0, cap: 300, call_seconds: 12, tickets: 2, closed: 1, cohost_limit: 50, cancelled_ms: null, unplayed_ms: null });
    expect(JSON.parse(n.config)).toEqual(JSON.parse(before.config)); // prizes, brand, rounds, invites, brand moments, name: all of it
    expect(JSON.parse(n.config).brand.name).toBe("Acme Foods"); expect(JSON.parse(n.config).rewards.map((x: any) => x.text)).toEqual(expect.arrayContaining(["Hamper", "Voucher", "Mug"])); expect(JSON.parse(n.config).invites).toMatchObject({ on: true, per: 3 });
    expect(row("OLD-1")).toEqual(before);
    const s = await j(await call("GET", `/api/z/${newId}/summary`, undefined, t.master));
    expect(s.status).toBe("draft"); expect(s.paid).toBe(false); expect(s.participants).toBe(0); expect(s.name).toBe("Diwali Party");
  });
  test("it does NOT copy payment, status, guests, waiting requests, Co-hosts or personal links", async () => {
    const t = await world();
    const c = await j(await pay(t.master, "OLD-1")); expect((await j(await complete(c))).published).toBe(true); // OLD-1 is paid
    await call("PATCH", "/api/z/OLD-1/settings", { whoCanJoin: "list" }, t.master, T);
    await call("POST", "/api/z/OLD-1/join", { phone: "9876543210", name: "Asha" });
    await people(t.master, [{ name: "Ben", phone: "9876543211" }]);
    await call("POST", "/api/z/OLD-1/join", { phone: "9876543299", name: "Stranger" }); // waiting
    const b = await j(await clone(t.master)); const id = b.id;
    expect(row(id).pack).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM payment WHERE eid=?", id)).toBe(0); expect(count("SELECT COUNT(*) AS c FROM entitlement WHERE eid=?", id)).toBe(0);
    for (const tbl of ["participant", "seat", "person", "waiting", "claim"]) expect([tbl, count(`SELECT COUNT(*) AS c FROM ${tbl} WHERE eid=?`, id)]).toEqual([tbl, 0]);
    expect(count("SELECT COUNT(*) AS c FROM organizer_key WHERE kind='cohost' AND eid=?", id)).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM kv WHERE k=? OR k=?", `pub/${id}`, `paidby/${id}`)).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM person WHERE eid='OLD-1'")).toBeGreaterThan(0); // the old game keeps its own
  });
  test("the date and time are never copied: the draft is 'start pending' and cannot be published or paid until a time is chosen", async () => {
    const t = await world(); const id = (await j(await clone(t.master))).id;
    expect((await j(await clone(t.master))).needsStart).toBe(true);
    expect(row(id).start_round).not.toBe(row("OLD-1").start_round);
    const s = await j(await call("GET", `/api/z/${id}/summary`, undefined, t.master)); expect(s.startPending).toBe(true);
    const p = await call("POST", `/api/z/${id}/publish`, PUB, t.master); expect(p.status).toBe(400); expect((await j(p)).code).toBe("start-pending");
    const c = await pay(t.master, id); expect(c.status).toBe(400); expect((await j(c)).code).toBe("start-pending");
    expect((await call("POST", `/api/z/${id}/pay-with-credit`, {}, t.master)).status).toBe(400);
    // choosing the time clears it; then publish works
    expect((await call("PATCH", `/api/z/${id}/settings`, { startRound: roundAt(T + 5 * DAY) }, t.master)).status).toBe(200);
    expect((await j(await call("GET", `/api/z/${id}/summary`, undefined, t.master))).startPending).toBeUndefined();
    expect((await call("POST", `/api/z/${id}/publish`, PUB, t.master)).status).toBe(200);
  });
  test("a start time may be given at once: validated like any other (future, at most 30 days ahead)", async () => {
    const t = await world();
    const ok = await j(await clone(t.master, { startRound: roundAt(T + 6 * DAY) })); expect(ok.needsStart).toBe(false); expect(row(ok.id).start_round).toBe(roundAt(T + 6 * DAY));
    expect((await clone(t.master, { startRound: roundAt(T - H) })).status).toBe(400);
    const far = await clone(t.master, { startRound: roundAt(T + MAX_AHEAD_MS + 60_000) }); expect(far.status).toBe(400); expect((await j(far)).code).toBe("too-far");
    expect((await clone(t.master, { startRound: 1.5 })).status).toBe(400);
  });
  test("the 10-draft limit applies", async () => {
    const t = await world(); // OLD-1 is published but not paid: like every unpaid game it counts toward the 10
    for (let i = 0; i < 9; i++) expect((await clone(t.master)).status).toBe(200);
    const r = await clone(t.master); expect(r.status).toBe(409); expect((await j(r)).code).toBe("draft-limit");
    expect(count("SELECT COUNT(*) AS c FROM engagement WHERE pack=0")).toBe(10);
  });
  test("it is recorded in the audit trail", async () => {
    const t = await world(); const r = await clone(t.host); expect(r.status).toBe(200);
    expect(raw.prepare("SELECT event, status, eid FROM audit_log WHERE event='clone'").get()).toEqual({ event: "clone", status: 200, eid: "OLD-1" });
  });
  test("it works on cancelled, closed (did not start), paid and finished games", async () => {
    const t = await world();
    await call("POST", "/api/z/OLD-1/cancel", { confirmations: 3 }, t.master);
    expect((await clone(t.master)).status).toBe(200);
    const m2 = await start("two@acme.com");
    await call("POST", "/api/z", { id: "CLS-1", startRound: roundAt(GAME_START), callSeconds: 9, cap: 100, brand: BRAND }, m2); await call("POST", "/api/z/CLS-1/publish", { email: "two@acme.com", phone: "9876543210" }, m2);
    await lifecycleTick(env as any, T + 3 * H + 40 * H);
    expect(row("CLS-1").unplayed_ms).not.toBeNull();
    const r = await clone(m2, {}, "CLS-1", T + 3 * H + 41 * H); expect(r.status).toBe(200);
    expect(JSON.parse(row((await j(r)).id).config).brand.name).toBe("Acme Foods");
  });
});

describe("bring my people list", () => {
  test("the listed and the joined people come along as new un-joined invitations with NEW personal links; the old links stay with the old game", async () => {
    const t = await world();
    await people(t.master, [{ name: "Ben", phone: "9876543211" }, { name: "Chitra", phone: "9876543212" }, { name: "Asha", phone: "9876543210" }]);
    expect((await call("POST", "/api/z/OLD-1/join", { phone: "9876543210", name: "Asha" })).status).toBe(200); // joined: on the list as 'joined'
    expect((await call("POST", "/api/z/OLD-1/roster", { people: [{ name: "Dev", phone: "9876543213" }] }, t.master)).status).toBe(200); // an older-style loaded list: a seat with no list entry
    const old = raw.prepare("SELECT tok_hash FROM person WHERE eid='OLD-1'").all().map((x: any) => x.tok_hash);
    const b = await j(await clone(t.master, { withPeople: true, startRound: roundAt(T + 4 * DAY) }));
    expect(b.peopleCopied).toBe(4);
    const rows = raw.prepare("SELECT status, tok_hash, inviter, pii FROM person WHERE eid=?").all(b.id) as any[];
    expect(rows).toHaveLength(4); expect(rows.every((x) => x.status === "invited" && x.inviter === "o")).toBe(true);
    expect(rows.every((x) => !old.includes(x.tok_hash))).toBe(true); // different links
    expect(new Set(rows.map((x) => x.tok_hash)).size).toBe(4);
    expect(JSON.stringify(rows)).not.toMatch(/Ben|Chitra|Asha|Dev|987654/); // still sealed
    const list = await j(await call("GET", `/api/z/${b.id}/people`, undefined, t.master));
    expect(list.people.map((x: any) => x.name).sort()).toEqual(["Asha", "Ben", "Chitra", "Dev"]); expect(list.people.every((x: any) => x.link.startsWith("https://bingo.test/j/") && x.status === "invited")).toBe(true);
    expect(count("SELECT COUNT(*) AS c FROM person WHERE eid='OLD-1'")).toBeGreaterThanOrEqual(3); // the old game keeps its own
  });
  test("without the tick box nobody comes along; once the old list is erased the answer says so calmly", async () => {
    const t = await world(); await people(t.master, [{ name: "Ben", phone: "9876543211" }]);
    expect((await j(await clone(t.master, {}))).peopleCopied).toBe(0);
    await call("POST", "/api/z/OLD-1/erase", {}, t.master);
    const b = await j(await clone(t.master, { withPeople: true }));
    expect(b.peopleCopied).toBe(0); expect(b.peopleNote).toBe("The old guest list has been erased, so add your people again.");
    expect(count("SELECT COUNT(*) AS c FROM person WHERE eid=?", b.id)).toBe(0);
  });
  test("the copy belongs to the new game and follows ITS clock: the old game's copy is erased on the old clock, the new list survives", async () => {
    const t = await world();
    await people(t.master, [{ name: "Ben", phone: "9876543211" }]);
    const b = await j(await clone(t.master, { withPeople: true, startRound: roundAt(T + 10 * DAY) }));
    await lifecycleTick(env as any, T + 3 * H + 45 * H); // the OLD game's erasure time has long passed
    expect(count("SELECT COUNT(*) AS c FROM person WHERE eid='OLD-1'")).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM person WHERE eid=?", b.id)).toBe(1);
    expect((await j(await call("GET", `/api/z/${b.id}/people`, undefined, t.master, T + 3 * H + 45 * H))).people).toHaveLength(1);
    await lifecycleTick(env as any, T + 10 * DAY + 40 * H); // and the new game's own erasure time
    expect(count("SELECT COUNT(*) AS c FROM person WHERE eid=?", b.id)).toBe(0);
    void purgeOld;
  });
});
