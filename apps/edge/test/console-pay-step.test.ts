// The console's Pay step in Corporate Tic Tac Toe (docs/GAME_PAY_CONTRACT.md of the console repo, section 8):
//   payInfo for the organizer, a host, a stranger and a paid game; markPaid twice in a row; markPaid with the wrong size or owner refused with nothing changed;
//   the old "Pay now" link when PAY_VIA_CONSOLE is off (and its redirect when on); the descriptor; the game's own CSP.
import { beforeEach, describe, expect, test, setDefaultTimeout } from "bun:test";
setDefaultTimeout(60_000); // the laptop is slow when several sessions run at once; a slow set-up must never overlap the next one
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { consoleAdapter } from "../src/console-adapter";
import { payRedirect } from "../src/pay-redirect";
// @ts-ignore the contract kit is plain JavaScript copied from the console repo
import { makeCtx, buildAssertion } from "./console-contract/kit.mjs";
import { readFileSync } from "node:fs";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundOf = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const roundMs = (r: number) => (GEN + (r - 1) * 3) * 1000;
const ORIGIN = "https://ttt.test";
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
let env: Env, raw: any, ctx: any, n = 0;
const ad = () => consoleAdapter(T);
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request(ORIGIN + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;

async function boot(extra: Record<string, string> = {}) {
  ctx = await makeCtx();
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "10000000", PHONE_SALT: "salt", DATA_KEY: "k", PUBLIC_ORIGIN: ORIGIN, CONSOLE_PUBKEYS: "k1:" + ctx.publicB64u, ...extra } as any;
}
async function organizer(email: string) {
  const s = await j(await call("POST", "/api/start", { email }, { "cf-connecting-ip": "10.0.1." + ++n }));
  return { email, key: s.token as string, hash: await sha("email|" + email) };
}
async function makeGame(key: string, id: string, o: { cap?: number; publish?: boolean; startRound?: number } = {}) {
  const start = o.startRound ?? roundOf(T) + 1200;
  expect((await call("POST", "/api/z", { id, startRound: start, callSeconds: 9, cap: o.cap ?? 100 }, { "x-organizer": key })).status).toBe(200);
  if (o.publish !== false) expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, { "x-organizer": key })).status).toBe(200);
}
const row = (eid: string) => raw.query("SELECT id, org, cap, pack, start_round, cancelled_ms, unplayed_ms FROM engagement WHERE id=?").get(eid);
const kv = (eid: string) => raw.query("SELECT k, v FROM kv WHERE k IN (?,?,?) ORDER BY k").all(`pub/${eid}`, `cpaid/${eid}`, `paidby/${eid}`);
const snapshot = (eid: string) => JSON.stringify({ e: row(eid), kv: kv(eid) });
const definite = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };

let alice: Awaited<ReturnType<typeof organizer>>, bob: Awaited<ReturnType<typeof organizer>>, hostHash: string, nobodyHash: string;
beforeEach(async () => {
  await boot();
  alice = await organizer("alice@acme.com"); bob = await organizer("bob@other.com");
  hostHash = await sha("email|host@acme.com"); nobodyHash = await sha("email|nobody@nowhere.com");
  await makeGame(alice.key, "PAY-ONE", { cap: 100 });
  raw.run("INSERT INTO game_role(role_id,eid,role,email_hash,email_sealed,state,invited_ms,accepted_ms,invited_by) VALUES ('rrrrrrrrrr','PAY-ONE','host',?,NULL,'accepted',?,?, ?)", [hostHash, T, T, alice.hash]);
});

describe("payInfo (read only)", () => {
  test("the organizer sees owner, the game's size and unpaid; a host, another organizer and a stranger are not the owner", async () => {
    expect(row("PAY-ONE").pack).toBe(0); // published and waiting for payment
    expect(await ad().payInfo!(env, { eid: "PAY-ONE", sub: alice.hash })).toEqual({ owner: true, item: "100", paid: false });
    for (const sub of [hostHash, bob.hash, nobodyHash]) expect(await ad().payInfo!(env, { eid: "PAY-ONE", sub })).toEqual({ owner: false, item: null, paid: false });
    expect(await ad().payInfo!(env, { eid: "NO-SUCH-GAME", sub: alice.hash })).toEqual({ owner: false, item: null, paid: false });
  });
  test("a paid game says paid, to its organizer only", async () => {
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: "GAME-tictactoe-PAY-ONE", nowMs: T });
    expect(await ad().payInfo!(env, { eid: "PAY-ONE", sub: alice.hash })).toEqual({ owner: true, item: "100", paid: true });
    expect(await ad().payInfo!(env, { eid: "PAY-ONE", sub: hostHash })).toEqual({ owner: false, item: null, paid: false });
  });
  test("it changes nothing", async () => {
    const before = snapshot("PAY-ONE"), tables = raw.query("SELECT COUNT(*) c FROM kv").get().c;
    for (const sub of [alice.hash, hostHash, bob.hash, nobodyHash]) await ad().payInfo!(env, { eid: "PAY-ONE", sub });
    expect(snapshot("PAY-ONE")).toBe(before); expect(raw.query("SELECT COUNT(*) c FROM kv").get().c).toBe(tables);
  });
});

describe("markPaid", () => {
  const ref = "GAME-tictactoe-PAY-ONE";
  test("it unlocks the start: the held game is held before and not held after (the only place the start is unlocked from the console)", async () => {
    const late = roundMs(roundOf(T) + 1200) + 10_000; // the start time has come
    expect((await j(await call("GET", "/api/z/PAY-ONE/control", undefined, {}, late))).locked).toBe(true);
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: late });
    expect((await j(await call("GET", "/api/z/PAY-ONE/control", undefined, {}, late + 1000))).locked).not.toBe(true);
    expect(row("PAY-ONE").pack).toBe(100);
    expect(row("PAY-ONE").start_round).toBe(Math.floor((late / 1000 - GEN) / 3) + 2 + 40 - 40); // a late payment: the game begins 2 minutes after it (the old rule)
  });
  test("an early payment keeps the start time; the order reference stays with the game; the console's list says paid", async () => {
    const start = row("PAY-ONE").start_round;
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T });
    expect(row("PAY-ONE").start_round).toBe(start);
    expect(JSON.parse(raw.query("SELECT v FROM kv WHERE k=?").get("cpaid/PAY-ONE").v).orderRef).toBe(ref);
    const list = await ad().listGames(env, { org: row("PAY-ONE").org, roles: [], cursor: null, limit: 10 });
    expect(list.games.find((g: any) => g.eid === "PAY-ONE")).toMatchObject({ status: "ready", payment: { state: "paid" } });
  });
  test("twice in a row: the second call changes nothing and extends or resets nothing", async () => {
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T });
    const after1 = snapshot("PAY-ONE");
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T + 600_000 }); // same order, later
    expect(snapshot("PAY-ONE")).toBe(after1);
    expect((await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: "GAME-tictactoe-OTHER", nowMs: roundMs(roundOf(T) + 5000) })))?.definite).toBe(true); // another order, after the start time: refused for good (audit M4)
    expect(snapshot("PAY-ONE")).toBe(after1);
  });
  test("M4: a game paid another way (the old checkout) is not 'paid by this order': the console order is refused for good, and no console record is written on it", async () => {
    raw.run("UPDATE engagement SET pack=100 WHERE id='PAY-ONE'");
    const before = snapshot("PAY-ONE");
    const e = await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T }));
    expect(e?.definite).toBe(true); expect(String(e?.message)).toMatch(/already paid/);
    expect(snapshot("PAY-ONE")).toBe(before);
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k='cpaid/PAY-ONE'").get().c).toBe(0);
  });
  test("M4 (layer 1, on its own): the same order repeated stays a success after the game has since closed; a different order does not", async () => {
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T });
    raw.run("UPDATE engagement SET cancelled_ms=? WHERE id='PAY-ONE'", [T + 1]); // the repeat must be answered as a repeat, not as 'closed'
    const after = snapshot("PAY-ONE");
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T + 2 });
    expect(snapshot("PAY-ONE")).toBe(after);
    expect((await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: "GAME-tictactoe-OTHER", nowMs: T + 2 })))?.definite).toBe(true);
  });
  test("M4 (layer 2, on its own) and the race: another path unlocks the game between the check and the write: nothing is overwritten and no console record is left on it", async () => {
    const realBatch = env.DB.batch.bind(env.DB);
    (env.DB as any).batch = async (xs: any[]) => { raw.run("UPDATE engagement SET pack=250 WHERE id='PAY-ONE'"); return realBatch(xs); }; // the other path wins just before our batch
    const e = await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T }));
    expect(e?.definite).toBe(true);
    expect(row("PAY-ONE").pack).toBe(250); // not set to 100 by us
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k IN ('cpaid/PAY-ONE','paidby/PAY-ONE')").get().c).toBe(0); // the game does not look console-paid when it was not
  });
  test("a rerun after a call that did not finish is safe: the unlock and its records are one step, so nothing is ever half there", async () => {
    // a call that died before it wrote anything leaves the game exactly as it was; the rerun then does everything once
    const before = snapshot("PAY-ONE");
    expect(before).not.toContain("cpaid");
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T });
    expect(row("PAY-ONE").pack).toBe(100);
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k IN (?,?,?)").get("pub/PAY-ONE", "cpaid/PAY-ONE", "paidby/PAY-ONE").c).toBe(3);
    // the records are written only when the unlock itself happened (never a "paid" record on a game that is still held)
    await makeGame(alice.key, "PAY-TWO", { cap: 100, publish: false });
    raw.run("DELETE FROM kv WHERE k='pub/PAY-TWO'");
    raw.run("UPDATE engagement SET cancelled_ms=1 WHERE id='PAY-TWO'");
    expect(await definite(ad().markPaid!(env, { eid: "PAY-TWO", sub: alice.hash, item: "100", orderRef: "GAME-tictactoe-PAY-TWO", nowMs: T }))).toMatchObject({ definite: true });
    expect(raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE '%/PAY-TWO' AND k IN ('pub/PAY-TWO','cpaid/PAY-TWO','paidby/PAY-TWO')").get().c).toBe(0);
  });
  test("the wrong size is refused for good and nothing changes", async () => {
    const before = snapshot("PAY-ONE");
    for (const item of ["250", "10", "99", "100.0", ""]) { const e = await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item, orderRef: ref, nowMs: T })); expect([item, e?.definite]).toEqual([item, true]); }
    expect(snapshot("PAY-ONE")).toBe(before);
  });
  test("the wrong owner (a host, another organizer, a stranger, an unknown game) is refused for good and nothing changes", async () => {
    const before = snapshot("PAY-ONE");
    for (const sub of [hostHash, bob.hash, nobodyHash]) { const e = await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub, item: "100", orderRef: ref, nowMs: T })); expect([sub === hostHash, e?.definite]).toEqual([sub === hostHash, true]); }
    expect((await definite(ad().markPaid!(env, { eid: "NO-SUCH-GAME", sub: alice.hash, item: "100", orderRef: ref, nowMs: T })))?.definite).toBe(true);
    expect(snapshot("PAY-ONE")).toBe(before);
  });
  test("a paid game is not paid again by the wrong person either", async () => {
    await ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T });
    const after = snapshot("PAY-ONE");
    expect((await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: bob.hash, item: "100", orderRef: ref, nowMs: T })))?.definite).toBe(true);
    expect((await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "250", orderRef: ref, nowMs: T })))?.definite).toBe(true);
    expect(snapshot("PAY-ONE")).toBe(after);
  });
  test("a cancelled game is refused (the money is the console's to give back), the free size has nothing to pay", async () => {
    raw.run("UPDATE engagement SET cancelled_ms=? WHERE id='PAY-ONE'", [T]);
    expect((await definite(ad().markPaid!(env, { eid: "PAY-ONE", sub: alice.hash, item: "100", orderRef: ref, nowMs: T })))?.definite).toBe(true);
    expect(row("PAY-ONE").pack).toBe(0);
    await makeGame(alice.key, "PAY-FREE", { cap: 10, publish: false });
    expect((await definite(ad().markPaid!(env, { eid: "PAY-FREE", sub: alice.hash, item: "10", orderRef: "GAME-tictactoe-PAY-FREE", nowMs: T })))?.definite).toBe(true);
    expect(row("PAY-FREE").pack).toBe(0);
  });
  test("a size between two packs pays the smallest pack that holds it; the game keeps its own size", async () => {
    await makeGame(alice.key, "PAY-120", { cap: 120 });
    await ad().markPaid!(env, { eid: "PAY-120", sub: alice.hash, item: "120", orderRef: "GAME-tictactoe-PAY-120", nowMs: T });
    expect(row("PAY-120")).toMatchObject({ pack: 250, cap: 120 });
  });
});

describe("through the bridge's own addresses (the console's signed notices)", () => {
  const post = async (path: string, body: unknown) => handle(new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, T);
  const note = async (act: string, email: string, eid: string) => { ctx.people.tmp = { email, sub: await sha("email|" + email) }; return (await buildAssertion(ctx, { act, person: "tmp", eid }, ORIGIN, T)).token as string; };
  test("payable: the organizer gets owner, size, paid; a host gets owner false", async () => {
    let r = await j(await post("/api/console/payable", { eid: "PAY-ONE", assertion: await note("payable", "alice@acme.com", "PAY-ONE") }));
    expect(r).toMatchObject({ ok: true, owner: true, item: "100", paid: false });
    r = await j(await post("/api/console/payable", { eid: "PAY-ONE", assertion: await note("payable", "host@acme.com", "PAY-ONE") }));
    expect(r).toMatchObject({ ok: true, owner: false, item: null, paid: false });
  });
  test("paid twice with the same order: the second answer is a repeat and nothing changes; a wrong size is a definite refusal", async () => {
    const body = async (item: string) => ({ eid: "PAY-ONE", item, orderRef: "GAME-tictactoe-PAY-ONE", assertion: await note("paid", "alice@acme.com", "PAY-ONE") });
    const bad = await post("/api/console/paid", await body("250"));
    expect(bad.status).toBe(409); expect((await j(bad)).definite).toBe("true"); expect(row("PAY-ONE").pack).toBe(0);
    const first = await j(await post("/api/console/paid", await body("100"))); expect(first).toMatchObject({ ok: true, repeat: false });
    const snap = snapshot("PAY-ONE");
    const second = await j(await post("/api/console/paid", await body("100"))); expect(second).toMatchObject({ ok: true, repeat: true });
    expect(snapshot("PAY-ONE")).toBe(snap);
  });
  test("dark (no CONSOLE_PUBKEYS): the pay addresses answer the ordinary 404", async () => {
    await boot({ CONSOLE_PUBKEYS: "" });
    for (const p of ["/api/console/payable", "/api/console/paid"]) expect((await post(p, {})).status).toBe(404);
  });
});

describe("the old Pay now link (PAY_VIA_CONSOLE)", () => {
  const OLD: Array<[string, string]> = [["GET", "/pay.html"], ["GET", "/paylink.html"], ["GET", "/paytest.html"], ["POST", "/api/checkout"], ["POST", "/api/payments/test"], ["POST", "/api/payments/paytest"], ["GET", "/api/paylink/" + "a".repeat(48)], ["POST", "/api/paylink/" + "a".repeat(48) + "/checkout"], ["POST", "/api/z/PAY-ONE/paylink"], ["POST", "/api/z/PAY-ONE/pay-with-credit"]];
  const KEEP: Array<[string, string]> = [["POST", "/api/payments/webhook"], ["POST", "/api/payments/verify"], ["GET", "/api/payments/status"], ["GET", "/zc.html"], ["GET", "/api/whoami"]];
  const req = (m: string, p: string) => new Request(ORIGIN + p, { method: m });
  test("switch off (or any value but 1): payRedirect answers nothing for every route", () => {
    for (const flag of [undefined, "", "0", "true"]) for (const [m, p] of [...OLD, ...KEEP]) expect([flag, p, payRedirect(req(m, p), { PAY_VIA_CONSOLE: flag })]).toEqual([flag, p, null]);
  });
  test("switch on: every old pay route sends the person to the console; webhook, verify, status and the other pages stay", () => {
    for (const [m, p] of OLD) { const r = payRedirect(req(m, p), { PAY_VIA_CONSOLE: "1" })!; expect([p, r?.status, r?.headers.get("location")]).toEqual([p, 302, "https://console.corporatetambola.com/"]); }
    for (const [m, p] of KEEP) expect([p, payRedirect(req(m, p), { PAY_VIA_CONSOLE: "1" })]).toEqual([p, null]);
    expect(payRedirect(req("GET", "/pay.html"), { PAY_VIA_CONSOLE: "1", CONSOLE_ORIGIN: "https://corporate-console.pages.dev/" })!.headers.get("location")).toBe("https://corporate-console.pages.dev/");
  });
  test("switch off: the old Pay now answers exactly as before (the game's own answers, never a redirect)", async () => {
    await boot(); // no PAY_VIA_CONSOLE at all
    const o = await organizer("old@acme.com"); await makeGame(o.key, "OLD-ONE", { cap: 100, publish: false });
    const body = { pack: 100, email: "old@acme.com", org: "Acme", country: "IN", eid: "OLD-ONE" };
    const r = await call("POST", "/api/checkout", body, { "x-organizer": o.key });
    expect(r.status).toBe(503); expect(r.headers.get("location")).toBeNull(); // live mode with no payment provider set up: the old answer (apps/edge/test/mode.test.ts says the same)
    expect(row("OLD-ONE").pack).toBe(0);
    expect((await call("GET", "/api/payments/status")).status).toBe(200);
    for (const [m, p] of [["GET", "/pay.html"], ["POST", "/api/payments/test"]] as const) expect(payRedirect(new Request(ORIGIN + p, { method: m }), env as any)).toBeNull();
    await boot({ TEST_MODE: "1" }); // and the old test payment: it publishes and pays the draft the old way
    const t = await organizer("old2@acme.com"); await makeGame(t.key, "OLD-TWO", { cap: 100, publish: false });
    await call("POST", "/api/owner/mode", { mode: "TEST", reason: "walk-through" }, { "x-organizer": "plat" });
    const tr = await call("POST", "/api/payments/test", { ...body, eid: "OLD-TWO", email: "old2@acme.com" }, { "x-organizer": t.key });
    expect(tr.status).not.toBe(302);
  });
  test("switch on through the real router: /api/checkout answers 302 to the console, the webhook route is still the game's own", async () => {
    await boot({ PAY_VIA_CONSOLE: "1" });
    const r = await call("POST", "/api/checkout", {}); expect(r.status).toBe(302); expect(r.headers.get("location")).toBe("https://console.corporatetambola.com/");
    expect((await call("GET", "/api/payments/status")).status).toBe(200);
    expect((await call("POST", "/api/payments/webhook", {})).status).not.toBe(302);
  });
});

describe("descriptor and the game's own security rules", () => {
  const root = new URL("../../../", import.meta.url);
  const build = readFileSync(new URL("pages/build.mjs", root), "utf8");
  const PAYFRAME = "https://itservices-rajat-agarwal.pages.dev", CONSOLE = "https://console.corporatetambola.com";
  /** the CSP the build gives each page, evaluated from the build's own definitions (nothing is copied into the test) */
  const csps = () => {
    const defs = build.slice(build.indexOf("const CSP ="), build.indexOf("// Cloudflare Pages serves"));
    const hdrs = build.slice(build.indexOf("const PAGES ="), build.indexOf("let rules"));
    return new Function(defs + "\n" + hdrs + "\nconst out = {}; for (const [path, csp] of PAGES) out[path] = path === \"/zc\" ? withConsolePay(csp) : csp; return { out, PAYFRAME_ORIGIN, CONSOLE_ORIGIN };")() as { out: Record<string, string>; PAYFRAME_ORIGIN: string; CONSOLE_ORIGIN: string };
  };
  const directive = (csp: string, name: string) => (csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + " ")) ?? "").split(/\s+/).slice(1);
  test("the descriptor says which game this is and where the shared Pay step lives, and holds no price", () => {
    const src = readFileSync(new URL("apps/web/public/zc-flow-game.js", root), "utf8");
    const w: any = {}; new Function("window", src)(w);
    expect(w.ZFLOW_GAME).toEqual({ brand: "Corporate Tic Tac Toe", payGame: "tictactoe", consoleOrigin: CONSOLE });
    expect(src.replace(/\/\*[\s\S]*?\*\//, "")).not.toMatch(/\d{3,}/); // no price number
  });
  test("the organizer page may frame the payment window and talk to the console: exactly those two addresses, no wildcard", () => {
    const { out, PAYFRAME_ORIGIN, CONSOLE_ORIGIN } = csps();
    expect([PAYFRAME_ORIGIN, CONSOLE_ORIGIN]).toEqual([PAYFRAME, CONSOLE]);
    const zc = out["/zc"]!;
    expect(directive(zc, "frame-src")).toContain(PAYFRAME); expect(directive(zc, "connect-src")).toContain(CONSOLE);
    expect(directive(zc, "frame-src")).toEqual(["https://accounts.google.com/gsi/", PAYFRAME]); // Google's sign-in frame and the payment window, nothing else
    for (const [p, c] of Object.entries(out)) { expect([p, /\*/.test(c)]).toEqual([p, false]); if (p !== "/zc") { expect([p, c.includes(CONSOLE)]).toEqual([p, false]); } }
  });
  test("the payment window address is the one in the console's own config (when that repo is beside this one)", () => {
    const cfg = process.env.CONSOLE_GAMES_JSON || "C:/ct/test-sites/console/.claude/worktrees/master-console-complete-882589/config/games.json";
    let games: any; try { games = JSON.parse(readFileSync(cfg, "utf8")); } catch { return; } // the console repo is not always checked out next to this one
    expect(games.payframeOrigins.live).toContain(PAYFRAME);
    expect(games.consoleOrigin.live).toBe(CONSOLE);
  });
});
