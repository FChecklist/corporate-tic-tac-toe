// The master console bridge in Corporate Tic Tac Toe: dark by default; with a console key set it lists the person's games, makes Host / Co-host keys tied to ONE game, and refuses everything else.
// The bridge itself and its contract kit are copied from the console repo (console-bridge/, test/console-contract/); this file tests Tic Tac Toe's side: the adapter and the key rules in worker.ts.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env, __authRules } from "../src/worker";
import { handle } from "./with-terms";
import { handle as rawHandle } from "../src/worker";
import { makeD1 } from "./d1-sqlite";
// @ts-ignore the contract kit is plain JavaScript copied from the console repo
import { FIXTURES, makeCtx, runFixture, buildAssertion, validate } from "./console-contract/kit.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundOf = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
let env: Env, raw: any, ctx: any, server: any, origin = "", n = 0;
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

async function boot(opts: { dark?: boolean } = {}) {
  ctx = await makeCtx();
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "10000000", PHONE_SALT: "salt", DATA_KEY: "k", PUBLIC_ORIGIN: "https://bingo.test", CONSOLE_ORIGIN: "https://console.test", ...(opts.dark ? {} : { CONSOLE_PUBKEYS: "k1:" + ctx.publicB64u }) } as any;
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => handle(req, env, T) });
  origin = `http://127.0.0.1:${server.port}`;
  (env as any).PUBLIC_ORIGIN = origin;
}
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, T);
const j = async (r: Response) => (await r.json()) as any;
const asr = async (spec: any) => (await buildAssertion(ctx, spec, origin, T)).token;
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => handle(new Request(origin + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, T);

/** a real organizer account made the ordinary way (so we know its e-mail hash is the one the console uses) */
async function organizer(email: string) {
  const s = await j(await call("POST", "/api/start", { email }, { "cf-connecting-ip": "10.0.0." + ++n }));
  return { email, key: s.token as string, hash: await sha("email|" + email) };
}
async function makeGame(key: string, id: string, o: { publish?: boolean; cap?: number } = {}) {
  const start = roundOf(T) + 1200;
  expect((await call("POST", "/api/z", { id, startRound: start, callSeconds: 9, cap: o.cap ?? 10 }, { "x-organizer": key })).status).toBe(200);
  if (o.publish) expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, { "x-organizer": key })).status).toBe(200);
}
/** the console's note for a person who is not `alice@...` but any e-mail: the hash is what the game looks up */
const noteFor = async (email: string, spec: any) => {
  ctx.people.tmp = { email, sub: await sha("email|" + email) };
  return asr({ ...spec, person: "tmp" });
};
afterEachStop();
function afterEachStop() { /* servers are stopped in each test's finally */ }

describe("Tic Tac Toe console bridge: dark", () => {
  beforeEach(async () => { await boot({ dark: true }); });
  test("without CONSOLE_PUBKEYS every console address answers the ordinary 404 and nothing else changes", async () => {
    try {
      for (const [m, p] of [["GET", "/api/console/capabilities"], ["GET", "/api/console/live"], ["POST", "/api/console/session"], ["POST", "/api/console/games"], ["POST", "/api/console/role"], ["POST", "/api/console/handoff"], ["POST", "/api/console/preview"]]) {
        const r = await rawHandle(new Request("http://x" + p, { method: m, body: m === "POST" ? "{}" : undefined }), env, T);
        expect([m, p, r.status]).toEqual([m, p, 404]);
      }
      const a = await organizer("dark@acme.com");
      expect((await call("GET", "/api/history", undefined, { "x-organizer": a.key })).status).toBe(200);
    } finally { server.stop(true); }
  });
});

describe("Tic Tac Toe console bridge: switched on", () => {
  beforeEach(async () => { await boot(); });

  test("the contract fixtures that do not depend on seeded data pass against the real game", async () => {
    try {
      for (const fx of FIXTURES.filter((f: any) => !f.gameRoute && !f.fakeOnly)) {
        const r = await runFixture(fx, { ctx, origin, nowMs: T, fake: false });
        expect([fx.name, r.problems]).toEqual([fx.name, []]);
      }
    } finally { server.stop(true); }
  });

  test("capabilities: the sizes and prices come from Tic Tac Toe's own price list, the free size is 10", async () => {
    try {
      const c = await j(await handle(new Request(origin + "/api/console/capabilities"), env, T));
      expect(validate("Capabilities", c)).toEqual([]);
      expect(c.game).toBe("tictactoe"); expect(c.freeDemoCap).toBe(10);
      expect(c.sizes[0]).toEqual({ pack: 10, inrMinor: 0, usdMinor: 0, free: true });
      expect(c.sizes.find((s: any) => s.pack === 100)).toEqual({ pack: 100, inrMinor: 239900, usdMinor: 3400, free: false });
      expect(c.features.roles).toBe(true); expect(c.features.log).toBe(false);
    } finally { server.stop(true); }
  });

  test("live: counts a tournament that is starting or running, so the deploy guard never touches a game that is being played", async () => {
    try {
      const get = async () => j(await handle(new Request(origin + "/api/console/live"), env, T));
      expect((await get()).tournamentsRunning).toBe(0);
      raw.run("INSERT INTO ttt_t(eid,commit_hash,state) VALUES ('T-1','c','running'), ('T-2','c','open'), ('T-3','c','starting'), ('T-4','c','done')");
      const r = await get();
      expect(validate("LiveResponse", r)).toEqual([]);
      expect(r.tournamentsRunning).toBe(2);
    } finally { server.stop(true); }
  });

  test("an organizer's games are listed with the console's words; a game of up to 10 people published at Rs 0 is Ready and free", async () => {
    try {
      const a = await organizer("alice@acme.com");
      await makeGame(a.key, "DRAFT-1"); await makeGame(a.key, "FREE-1", { publish: true });
      ctx.people.alice = { email: a.email, sub: a.hash };
      const s = await j(await post("/api/console/session", { assertion: await asr({ act: "session", person: "alice" }) }));
      expect(s.organizer.label).toBe("console");
      const g = await j(await post("/api/console/games", { assertion: await asr({ act: "games", person: "alice" }) }));
      expect(validate("GamesResponse", g)).toEqual([]);
      const by = Object.fromEntries(g.games.map((x: any) => [x.eid, x]));
      expect(by["DRAFT-1"]).toMatchObject({ role: "organizer", status: "draft", nextAction: "publish", payment: { state: "none" } });
      expect(by["FREE-1"]).toMatchObject({ role: "organizer", status: "ready", nextAction: "share", payment: { state: "free" } });
    } finally { server.stop(true); }
  });

  test("the console key is an ordinary organizer key for the organizer's own games", async () => {
    try {
      const a = await organizer("alice2@acme.com"); await makeGame(a.key, "OWN-1");
      ctx.people.alice = { email: a.email, sub: a.hash };
      const s = await j(await post("/api/console/session", { assertion: await asr({ act: "session", person: "alice" }) }));
      const h = { "x-organizer": s.organizer.key };
      expect((await call("GET", "/api/history", undefined, h)).status).toBe(200);
      expect((await call("GET", "/api/z/OWN-1/summary", undefined, h)).status).toBe(200);
    } finally { server.stop(true); }
  });

  test("an account is made by the console only with a proven mailbox, and the person can then be listed", async () => {
    try {
      const email = "newbie@acme.com", sub = await sha("email|" + email);
      expect(raw.query("SELECT COUNT(*) c FROM organizer_email WHERE email_hash=?").get(sub)).toEqual({ c: 0 });
      const s = await j(await post("/api/console/session", { create: true, assertion: await noteFor(email, { act: "session", withEm: true }) }));
      expect(s.created).toBe(true);
      expect(raw.query("SELECT COUNT(*) c FROM organizer_email WHERE email_hash=?").get(sub)).toEqual({ c: 1 });
      const again = await j(await post("/api/console/session", { create: true, assertion: await noteFor(email, { act: "session", withEm: true }) }));
      expect(again.created).toBe(false); expect(again.organizer.key).toMatch(/^cbk_/);
      // no 'create' flag, no e-mail claim: nothing is made
      const other = await j(await post("/api/console/session", { assertion: await noteFor("ghost@acme.com", { act: "session" }) }));
      expect(other.organizer).toBe(null);
      expect(raw.query("SELECT COUNT(*) c FROM organizer_email WHERE email_hash=?").get(await sha("email|ghost@acme.com"))).toEqual({ c: 0 });
    } finally { server.stop(true); }
  });

  test("a Host invited by e-mail gets a key for THAT game only: the other game, the history and the account pages are refused; the invitation mail goes only to the typed address", async () => {
    try {
      const a = await organizer("alice3@acme.com"); await makeGame(a.key, "HOST-A"); await makeGame(a.key, "HOST-B");
      ctx.people.alice = { email: a.email, sub: a.hash };
      const aliceKey = (await j(await post("/api/console/session", { assertion: await asr({ act: "session", person: "alice" }) }))).organizer.key;
      const bobMail = "bob.helper@acme.com";
      const step = await asr({ act: "stepup", sa: "role-add", eid: "HOST-A", person: "alice" });
      const inv = await post("/api/console/role", { op: "invite", eid: "HOST-A", role: "host", email: bobMail }, { "x-organizer": aliceKey, "x-console-step": step });
      expect(inv.status).toBe(200); const roleId = (await j(inv)).roleId;
      const mails = raw.query("SELECT to_addr, subject FROM outbox").all() as any[];
      expect(mails.filter((m) => /invited/i.test(m.subject)).map((m) => m.to_addr)).toEqual([bobMail]);
      // bob accepts with his own mailbox proof
      const accept = await post("/api/console/role", { op: "accept", eid: "HOST-A", roleId, assertion: await noteFor(bobMail, { act: "role", eid: "HOST-A" }) });
      expect(accept.status).toBe(200);
      const hostKey = (await j(accept)).scoped.key;
      const h = { "x-organizer": hostKey };
      expect((await call("GET", "/api/z/HOST-A/summary", undefined, h)).status).toBe(200); // his game
      expect((await call("GET", "/api/z/HOST-B/summary", undefined, h)).status).toBe(403); // the organizer's other game
      expect((await call("GET", "/api/history", undefined, h)).status).toBe(403);
      expect((await call("GET", "/api/org/keys", undefined, h)).status).toBe(403);
      expect((await call("POST", "/api/z", { id: "NEW-ONE", startRound: roundOf(T) + 900, callSeconds: 9, cap: 10 }, h)).status).toBe(403);
      // the same person later opens the console and gets the same scoped key from a session
      const sess = await j(await post("/api/console/session", { assertion: await noteFor(bobMail, { act: "session" }) }));
      expect(sess.scoped.map((x: any) => [x.eid, x.role])).toEqual([["HOST-A", "host"]]);
      expect(sess.organizer).toBe(null);
      // removing him ends the key at once
      const rm = await post("/api/console/role", { op: "remove", eid: "HOST-A", roleId }, { "x-organizer": aliceKey, "x-console-step": await asr({ act: "stepup", sa: "role-remove", eid: "HOST-A", person: "alice" }) });
      expect(rm.status).toBe(200);
      expect((await call("GET", "/api/z/HOST-A/summary", undefined, h)).status).toBe(403);
    } finally { server.stop(true); }
  });

  test("a Host key tied to one game cannot pay for the organizer's OTHER game", async () => {
    try {
      const a = await organizer("alice6@acme.com"); await makeGame(a.key, "PAY-A"); await makeGame(a.key, "PAY-B");
      ctx.people.alice = { email: a.email, sub: a.hash };
      const aliceKey = (await j(await post("/api/console/session", { assertion: await asr({ act: "session", person: "alice" }) }))).organizer.key;
      const inv = await post("/api/console/role", { op: "invite", eid: "PAY-A", role: "host", email: "pay.helper@acme.com" }, { "x-organizer": aliceKey, "x-console-step": await asr({ act: "stepup", sa: "role-add", eid: "PAY-A", person: "alice" }) });
      const roleId = (await j(inv)).roleId;
      const hostKey = (await j(await post("/api/console/role", { op: "accept", eid: "PAY-A", roleId, assertion: await noteFor("pay.helper@acme.com", { act: "role", eid: "PAY-A" }) }))).scoped.key;
      (env as any).RAZORPAY_KEY_ID = "rzp_test_x"; (env as any).RAZORPAY_KEY_SECRET = "secret_x"; (env as any).RAZORPAY_WEBHOOK_SECRET = "whsec_x"; (env as any).RAZORPAY_BASE_URL = "https://rzp.test/v1";
      const other = await call("POST", "/api/checkout", { eid: "PAY-B", currency: "INR" }, { "x-organizer": hostKey });
      expect(other.status).toBe(403);
      expect((await j(other)).error).toMatch(/one game only/);
      const own = await call("POST", "/api/checkout", { eid: "PAY-A", currency: "INR" }, { "x-organizer": hostKey });
      expect(own.status).not.toBe(403); // his own game: the ordinary payment rules decide (this draft has no size that needs payment, so it may answer 4xx for another reason)
    } finally { server.stop(true); }
  });

  test("the rules for keys: a console key tied to one game fits that game only; every older key behaves as before", () => {
    const { can, canAi, mayPay } = __authRules;
    const host = (o: any) => ({ plat: false, org: "o1", kind: "host", ...o });
    const eg = (id?: string) => ({ org: "o1", id } as any);
    const tied = host({ console: true, eid: "G1", hostReady: true });
    expect(can(tied, eg("G1"))).toBe(true);
    expect(can(tied, eg("G2"))).toBe(false);
    expect(can(tied, eg(undefined))).toBe(false); // a game without an id fails closed
    expect(canAi(tied, eg("G2"))).toBe(false);
    expect(mayPay(tied, { id: "G2", org: "o1" })).toBe(false);
    expect(mayPay(tied, { id: "G1", org: "o1" })).toBe(true);
    // a console key without a game (the Organizer's) and an older key that carries a game (the 24-hour work link) are NOT limited by this rule
    expect(can({ plat: false, org: "o1", kind: "master", console: true, eid: null }, eg("G2"))).toBe(true);
    expect(can(host({ eid: "G1" }), eg("G2"))).toBe(true);
    // somebody else's account is never allowed, whatever the key
    expect(can(tied, { org: "o2", id: "G1" } as any)).toBe(false);
  });

  test("a console key tied to a game stops when the game is over", async () => {
    try {
      const a = await organizer("alice4@acme.com"); await makeGame(a.key, "END-A");
      ctx.people.alice = { email: a.email, sub: a.hash };
      const aliceKey = (await j(await post("/api/console/session", { assertion: await asr({ act: "session", person: "alice" }) }))).organizer.key;
      const ho = await post("/api/console/handoff", { eid: "END-A", target: "organizer" }, { "x-organizer": aliceKey });
      expect(ho.status).toBe(200);
      const t = /t=([0-9a-f]{48})/.exec((await j(ho)).url)![1];
      const rd = await j(await post("/api/console/handoff/redeem", { t }));
      expect(rd.kind).toBe("master"); expect(rd.eid).toBe("END-A");
      const k = { "x-organizer": rd.key };
      expect((await call("GET", "/api/z/END-A/summary", undefined, k)).status).toBe(200);
      raw.run("INSERT INTO life(eid,end_ms,end_src) VALUES (?,?, 'organizer')", ["END-A", T - 1000]);
      expect([401, 403]).toContain((await call("GET", "/api/z/END-A/summary", undefined, k)).status);
      expect([401, 403]).toContain((await call("GET", "/api/whoami", undefined, k)).status);
    } finally { server.stop(true); }
  });

  test("the owner's platform key and an AI work-link key are never accepted on the console routes", async () => {
    try {
      const a = await organizer("alice5@acme.com"); await makeGame(a.key, "AIK-A");
      const ai = (await j(await call("GET", "/api/org/keys", undefined, { "x-organizer": a.key })));
      void ai;
      const aiKey = "cba_" + "d".repeat(48);
      const org = raw.query("SELECT org FROM organizer_email WHERE email_hash=?").get(a.hash).org;
      raw.run("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms) VALUES (?,?,?,0,1)", [await sha("key|" + aiKey), org, "ai"]);
      for (const key of ["plat", aiKey]) for (const [p, b] of [["/api/console/handoff", { eid: "AIK-A", target: "organizer" }], ["/api/console/role", { op: "list", eid: "AIK-A" }]] as const) expect([key.slice(0, 4), p, (await post(p, b, { "x-organizer": key })).status]).toEqual([key.slice(0, 4), p, 403]);
    } finally { server.stop(true); }
  });

  test("a browser on the console's address may send the confirmation header: the game's CORS answer allows x-console-step", async () => {
    try {
      const r = await rawHandle(new Request("http://x/api/console/games", { method: "OPTIONS", headers: { origin: "https://console.test" } }), env, T);
      expect(r.status).toBe(204);
      expect(r.headers.get("access-control-allow-headers")).toContain("x-console-step");
      expect(r.headers.get("access-control-allow-headers")).toContain("x-organizer");
    } finally { server.stop(true); }
  });

  test("the bridge's own files are the console's files, byte for byte (the hash list written when they were copied still matches)", () => {
    try {
      const here = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
      for (const dir of ["src/console-bridge", "test/console-contract"]) {
        const base = join(here, dir), manifest = JSON.parse(readFileSync(join(base, "MANIFEST.json"), "utf8")).files as Record<string, string>;
        const found = readdirSync(base).filter((f) => f !== "MANIFEST.json").sort();
        expect([dir, found]).toEqual([dir, Object.keys(manifest).sort()]);
        for (const f of found) expect([dir, f, createHash("sha256").update(readFileSync(join(base, f), "utf8").replace(/\r\n/g, "\n")).digest("hex")]).toEqual([dir, f, manifest[f]!]);
      }
    } finally { server.stop(true); }
  });
});
