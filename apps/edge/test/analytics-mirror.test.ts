// This game's own visitor tracker also copies each accepted beacon, the organizer link and the funnel steps into ONE central visitor database (apps/edge/src/analytics-core.ts, wired in visits.ts and pay.ts).
// The real Worker handles the beacon; the central database is a bun:sqlite stand-in. Nothing here needs a network. Written by site-analytics/tools/apply-game.mjs.
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { handle, type Env } from "../src/worker";
import { setMode } from "../src/mode";
import { linkVisitor, recordFunnelForOrg, resetRate } from "../src/visits";
import { stepsOf } from "../src/analytics-core";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 10, 3, 10, 0, 0), HOST = "tictactoe.corporatetambola.com", SITE = "tictactoe";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", IP = "203.0.113.77", VID = "a1".repeat(16), VID2 = "c3".repeat(16), SID = "b2".repeat(12);
const central = () => { // the central database stand-in; the collector creates its own tables
  const raw = new Database(":memory:");
  const stmt = (sql: string, vals: unknown[] = []): any => ({ bind: (...v: unknown[]) => stmt(sql, v), run: async () => { const r = raw.query(sql).run(...(vals as any[])); return { meta: { changes: r.changes } }; }, all: async () => ({ results: raw.query(sql).all(...(vals as any[])) }), first: async () => raw.query(sql).get(...(vals as any[])) ?? null });
  return { raw, db: { prepare: (s: string) => stmt(s), batch: async (xs: any[]) => Promise.all(xs.map((x) => x.run())) } };
};
let env: Env & Record<string, any>, local: Database, cen: ReturnType<typeof central>;
beforeEach(() => { const d = makeD1(); local = d.raw; cen = central(); resetRate(); env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: `https://${HOST}`, DATA_KEY: "data-key", ANALYTICS: cen.db, ANALYTICS_KEY: "k-test" } as any; });
const beacon = (events: unknown[], o: Record<string, unknown> = {}, h: Record<string, string> = {}) => {
  const r = new Request(`https://${HOST}/api/v/b`, { method: "POST", headers: { origin: `https://${HOST}`, "content-type": "text/plain", "cf-connecting-ip": IP, "user-agent": UA, ...h }, body: JSON.stringify({ s: SID, d: VID, lp: "/", r: "www.google.com", dv: "mobile", l: "en-IN", e: events, ...o }) });
  (r as any).cf = { country: "IN", city: "Pune", asOrganization: "Example Broadband", asn: 64500 };
  return handle(r, env as Env, T);
};
const lq = (sql: string, ...a: any[]) => local.query(sql).all(...a) as any[];
const cq = (sql: string, ...a: any[]) => { try { return cen.raw.query(sql).all(...a) as any[]; } catch { return []; } };
const pv = { k: "pv", p: "/" };

describe("the beacon is copied into the central visitor database", () => {
  test("a public-page beacon lands in this game's own tracker AND in the central one, under this site's name, with the shortened address only", async () => {
    expect((await beacon([pv, { k: "sec", p: "/", n: "hero", m: 3000 }])).status).toBe(204);
    expect(lq("SELECT COUNT(*) AS c FROM visit_session")[0]!.c).toBe(1); // the game's own tracker is exactly as before
    expect(cq("SELECT site, vid, ipshort, country, city, network, pages FROM a_session")).toEqual([{ site: SITE, vid: VID, ipshort: "203.0.113.0", country: "IN", city: "Pune", network: "Example Broadband", pages: 1 }]);
    expect(cq("SELECT kind FROM a_event ORDER BY id").map((e) => e.kind)).toEqual(["pv", "sec"]);
    for (const t of ["a_session", "a_event", "a_agg"]) expect(JSON.stringify(cq(`SELECT * FROM ${t}`))).not.toContain(IP); // the full address is nowhere
  });
  test("without the ANALYTICS binding nothing changes: same answer, own tracker written, nothing in the central database", async () => {
    delete env.ANALYTICS;
    expect((await beacon([pv])).status).toBe(204);
    expect(lq("SELECT COUNT(*) AS c FROM visit_session")[0]!.c).toBe(1);
    expect(cq("SELECT COUNT(*) AS c FROM a_session")).toEqual([]);
  });
  test("a central database that is down never breaks the visit", async () => {
    env.ANALYTICS = { prepare() { throw new Error("D1 down"); }, batch: async () => { throw new Error("D1 down"); } };
    expect((await beacon([pv])).status).toBe(204);
    expect(lq("SELECT COUNT(*) AS c FROM visit_session")[0]!.c).toBe(1);
  });
  test("a visitor with Global Privacy Control reaches the central database only as anonymous counters", async () => {
    expect((await beacon([pv], {}, { "sec-gpc": "1" })).status).toBe(204);
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]!.c).toBe(0);
    expect(cq("SELECT dim FROM a_agg WHERE dim LIKE 'gpc_%'").length).toBeGreaterThan(0);
  });
  test("a visit made while the service is in TEST mode is not copied (test data stays out of the owner's numbers)", async () => {
    await setMode(env as any, "TEST", "analytics test", T);
    expect((await beacon([pv])).status).toBe(204);
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]?.c ?? 0).toBe(0);
  });
  test("a visitor code handed over from another of our sites joins both codes into one person", async () => {
    await beacon([pv], { d: VID2, ov: VID });
    expect(cq("SELECT old, canon FROM a_alias")).toEqual([{ old: VID, canon: VID2 }]);
    expect(lq("SELECT vid FROM visit_session")[0]!.vid).toBe(VID2); // this game's own tracker simply keeps the new code
  });
});

describe("the organizer link and the funnel steps are copied too", () => {
  test("making an account links the visit to the organizer; later steps are counted once, in order", async () => {
    await beacon([pv]);
    await linkVisitor(env as any, new Request(`https://${HOST}/api/start`, { method: "POST", headers: { "x-cb-vid": VID, "x-cb-vs": SID } }), "org_1", "start", T + 1000, "a@example.com");
    expect(cq("SELECT org FROM a_session")).toEqual([{ org: "org_1" }]);
    await recordFunnelForOrg({ ...env, DB: env.DB } as any, "org_1", "published", T + 2000);
    await recordFunnelForOrg({ ...env, DB: env.DB } as any, "org_1", "paid", T + 3000);
    await recordFunnelForOrg({ ...env, DB: env.DB } as any, "org_1", "paid", T + 4000); // once only
    expect(cq("SELECT name FROM a_event WHERE kind='fun' ORDER BY id").map((e) => e.name)).toEqual(["signin", "published", "paid"]);
    expect(stepsOf(cq("SELECT steps FROM a_session")[0]!.steps)).toEqual(expect.arrayContaining(["visit", "signin", "published", "paid"]));
    expect(lq("SELECT name FROM visit_event WHERE kind='fun' ORDER BY id").map((e) => e.name)).toEqual(["account", "published", "paid"]); // the game's own funnel is as before
  });
  test("with no PUBLIC_ORIGIN set the step still reaches the central database (this game's own host is the default)", async () => {
    await beacon([pv]);
    await linkVisitor(env as any, new Request(`https://${HOST}/api/start`, { method: "POST", headers: { "x-cb-vid": VID } }), "org_2", "start", T + 1000);
    delete env.PUBLIC_ORIGIN;
    await recordFunnelForOrg({ ...env, DB: env.DB } as any, "org_2", "paid", T + 2000);
    expect(cq("SELECT name FROM a_event WHERE kind='fun' ORDER BY id").map((e) => e.name)).toEqual(["signin", "paid"]);
  });
  test("a step with no visit on record only raises an anonymous counter", async () => {
    await recordFunnelForOrg({ ...env, DB: env.DB } as any, "org_unknown", "paid", T);
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]?.c ?? 0).toBe(0);
  });
});
