// Sales funnel (funnel.ts, owner order 1 Nov 2026), the parts that need no Worker: the switch (off until audited), once per key, what a page may send, Do Not Track / Global Privacy Control,
// the report by day / week / total with drop-off, the CSV, and proof that nothing personal can be in a row. Needs only the database stand-in.
import { beforeEach, describe, expect, test } from "bun:test";
import { FUNNEL_EVENTS, FUN_LABELS, funKey, funnelBeacon, funnelCsv, funnelReport, funnelRows, recordFun, resetFunnelRate, sweepFunnel, weekOf } from "../src/funnel";
import { Database } from "bun:sqlite";

/** The smallest D1 stand-in this file needs (prepare, bind, run, all, first) on bun:sqlite, with the mode row mode.ts keeps; it does not load the Worker. */
function makeD1(): { db: any; raw: Database } {
  const raw = new Database(":memory:"); raw.run("CREATE TABLE mode (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL DEFAULT 'LIVE')"); raw.run("INSERT INTO mode(id,mode) VALUES(1,'LIVE')");
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    run: async () => { raw.prepare(sql).run(...(args as any[])); return { success: true }; },
    all: async () => ({ results: raw.prepare(sql).all(...(args as any[])) }),
    first: async () => raw.prepare(sql).get(...(args as any[])) ?? null,
  });
  return { db: { prepare: (sql: string) => stmt(sql) }, raw };
}

const DAY = 86_400_000, T = Date.UTC(2026, 9, 5, 10, 0, 0); // a Monday
let env: any; let raw: ReturnType<typeof makeD1>["raw"];
beforeEach(() => { const d = makeD1(); raw = d.raw; resetFunnelRate(); env = { DB: d.db, FUNNEL_EVENTS: "on", PHONE_SALT: "salt", PUBLIC_ORIGIN: "https://ttt.test" }; });
const rows = () => (raw.prepare("SELECT name FROM sqlite_master WHERE name='ttt_fun'").get() ? (raw.prepare("SELECT * FROM ttt_fun ORDER BY at_ms, ev").all() as any[]) : []); // no table yet: no rows
const post = (body: unknown, headers: Record<string, string> = {}, now = T) =>
  funnelBeacon(new Request("https://ttt.test/api/f", { method: "POST", headers: { origin: "https://ttt.test", "content-type": "text/plain", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env, now);
const V = (n: number) => n.toString(36).padStart(12, "a");

describe("the steps", () => {
  test("the thirteen events of the owner's list, in order, each with a label", () => {
    expect([...FUNNEL_EVENTS]).toEqual(["viewed", "size_chosen", "signup_started", "game_created", "game_published", "payment_page_reached", "payment_page_opened", "payment_link_copied", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"]);
    for (const e of FUNNEL_EVENTS) expect(FUN_LABELS[e].length).toBeGreaterThan(3);
  });
  test("percentages follow the chain (payment_failed is a side branch); a week starts on Monday", () => {
    const by = Object.fromEntries(funnelRows({ viewed: 200, size_chosen: 100, signup_started: 50, game_created: 25, payment_failed: 5, game_published: 10 }).map((r) => [r.step, r]));
    expect(by.size_chosen!.ofPrevious).toBe(50); expect(by.game_published!.ofPrevious).toBe(40); expect(by.game_published!.ofFirst).toBe(5); expect(by.payment_failed!.ofPrevious).toBeNull(); expect(by.viewed!.ofPrevious).toBeNull();
    expect(funnelRows({}).every((r) => r.count === 0 && r.ofFirst === null)).toBe(true);
    expect(weekOf(T)).toBe("2026-10-05"); expect(weekOf(T + 6 * DAY)).toBe("2026-10-05"); expect(weekOf(T + 7 * DAY)).toBe("2026-10-12");
  });
});

describe("the switch: off until audited", () => {
  test("with FUNNEL_EVENTS unset or anything but on, a page event and a server step write nothing, and no table is made", async () => {
    for (const v of [undefined, "", "off", "1", "true"]) {
      env.FUNNEL_EVENTS = v;
      expect((await post({ event: "viewed", at: T, visit: V(1) })).status).toBe(204); await recordFun(env, "g1", "game_created", T);
    }
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='ttt_fun'").get()).toBeNull();
  });
  test("on: a page event and a server step are kept", async () => {
    expect((await post({ event: "viewed", at: T, visit: V(1) })).status).toBe(204); await recordFun(env, "g1", "game_created", T, { size: 100 });
    expect(rows().map((r) => r.ev).sort()).toEqual(["game_created", "viewed"]);
  });
});

describe("what a page may send", () => {
  test("once per visit and step; a size only as a number; other steps and bad ids are refused", async () => {
    await post({ event: "size_chosen", at: T, visit: V(1), size: 200 }); await post({ event: "size_chosen", at: T + 1, visit: V(1), size: 500 });
    expect(rows().length).toBe(1); expect(rows()[0].size).toBe(200);
    expect((await post({ event: "game_created", at: T, visit: V(1) })).status).toBe(400); // a server step cannot be claimed by a page
    expect((await post({ event: "viewed", at: T, visit: "x@y.com" })).status).toBe(400); expect((await post({ event: "viewed", at: T, visit: "short" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400); expect((await post("x".repeat(700))).status).toBe(413);
    expect(rows().length).toBe(1);
  });
  test("Do Not Track and Global Privacy Control: nothing is kept; another site's page and a cross-site call are refused", async () => {
    expect((await post({ event: "viewed", at: T, visit: V(2) }, { "sec-gpc": "1" })).status).toBe(204); expect((await post({ event: "viewed", at: T, visit: V(3) }, { dnt: "1" })).status).toBe(204);
    expect(rows().length).toBe(0);
    expect((await post({ event: "viewed", at: T, visit: V(4) }, { origin: "https://evil.test" })).status).toBe(403); expect((await post({ event: "viewed", at: T, visit: V(4) }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await funnelBeacon(new Request("https://ttt.test/api/f"), env, T)).status).toBe(405);
    expect(rows().length).toBe(0);
  });
  test("a flood from one address is slowed down", async () => {
    let last = 0; for (let i = 0; i < 70; i++) last = (await post({ event: "viewed", at: T, visit: V(100 + i) }, { "cf-connecting-ip": "203.0.113.9" })).status;
    expect(last).toBe(429); expect(rows().length).toBeLessThanOrEqual(60);
  });
});

describe("server steps", () => {
  test("once per game or payment, from a hashed key; a test game is not counted", async () => {
    await recordFun(env, "GAME-1", "game_published", T); await recordFun(env, "GAME-1", "game_published", T + 1000); await recordFun(env, "GAME-2", "game_published", T, { test: true });
    expect(rows().length).toBe(1); expect(rows()[0].k).toBe(await funKey("salt", "GAME-1")); expect(rows()[0].k).toMatch(/^[0-9a-f]{12}$/); expect(rows()[0].k).not.toContain("GAME");
    await recordFun(env, "GAME-3", "game_started", T, { size: 50 }); expect(rows().length).toBe(2);
  });
  test("TEST mode: nothing made while the owner is trying the site is counted", async () => {
    raw.prepare("UPDATE mode SET mode='TEST' WHERE id=1").run();
    await recordFun(env, "GAME-9", "game_created", T); expect((await post({ event: "viewed", at: T, visit: V(9) })).status).toBe(204);
    expect(rows().length).toBe(0);
  });
  test("a step a page owns, no id, or an unknown step writes nothing", async () => {
    await recordFun(env, "G", "viewed", T); await recordFun(env, null, "game_created", T); await recordFun(env, "G", "nonsense" as any, T);
    expect(rows().length).toBe(0);
  });
  test("a broken database never throws", async () => { await recordFun({ ...env, DB: { prepare: () => { throw new Error("down"); } } }, "G", "game_created", T); });
});

describe("the report and the CSV", () => {
  const seed = async () => {
    await post({ event: "viewed", at: T, visit: V(1) }, {}, T); await post({ event: "viewed", at: T, visit: V(2) }, {}, T); await post({ event: "viewed", at: T, visit: V(3) }, {}, T + 7 * DAY);
    await post({ event: "size_chosen", at: T, visit: V(1), size: 100 }, {}, T); await post({ event: "size_chosen", at: T, visit: V(3), size: 100 }, {}, T + 7 * DAY);
    await post({ event: "signup_started", at: T, visit: V(1) }, {}, T); await recordFun(env, "G1", "game_created", T); await recordFun(env, "G1", "game_published", T);
  };
  test("counts per step for the total, each day and each week, with the drop-off", async () => {
    await seed(); const r = await funnelReport(env, T - DAY, T + 10 * DAY), t = Object.fromEntries(r.total.map((x) => [x.step, x]));
    expect(t.viewed!.count).toBe(3); expect(t.size_chosen!.count).toBe(2); expect(t.signup_started!.count).toBe(1); expect(t.game_created!.count).toBe(1); expect(t.game_published!.count).toBe(1);
    expect(t.size_chosen!.ofPrevious).toBe(66.7); expect(t.signup_started!.ofPrevious).toBe(50);
    expect(r.days.map((d) => d.period)).toEqual(["2026-10-05", "2026-10-12"]); expect(r.weeks.map((w) => w.period)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(r.days[0]!.rows.find((x) => x.step === "viewed")!.count).toBe(2); expect(r.weeks[1]!.rows.find((x) => x.step === "size_chosen")!.count).toBe(1);
  });
  test("the CSV has one line per scope, period and step; a report with no table is empty, not an error", async () => {
    await seed(); const csv = funnelCsv(await funnelReport(env, T - DAY, T + 10 * DAY)).trim().split("\n");
    expect(csv[0]).toBe("scope,period,step,label,count,percent_of_previous,percent_of_first"); expect(csv.length).toBe(1 + FUNNEL_EVENTS.length * (1 + 2 + 2)); expect(csv).toContain("total,all,viewed,Page viewed,3,,100");
    const e = await funnelReport({ DB: { prepare: () => { throw new Error("no table"); } } as any }, 0, T); expect(e.total.every((x) => x.count === 0)).toBe(true);
  });
  test("old rows are swept after 400 days", async () => {
    await post({ event: "viewed", at: T, visit: V(1) }, {}, T - 401 * DAY); await post({ event: "viewed", at: T, visit: V(2) }, {}, T - 10 * DAY); await sweepFunnel(env, T);
    expect(rows().length).toBe(1);
  });
});

describe("nothing personal can be in a row", () => {
  test("extra fields a page sends (name, mobile, e-mail, ID, a game id with an @ or long digits) never reach the table", async () => {
    await post({ event: "size_chosen", at: T, visit: V(1), size: 100, game: "ravi@acme.com", name: "Ravi Kumar", phone: "9876543210", email: "ravi@acme.com", empId: "E12345", reason: "ravi@acme.com", mode: "9876543210" });
    await post({ event: "viewed", at: T, visit: V(2), size: 9876543210 }); // not a size
    const all = JSON.stringify(rows());
    expect(all).not.toMatch(/ravi|kumar|acme|9876543210|E12345|@/i);
    expect(Object.keys(rows()[0]!).sort()).toEqual(["at_ms", "ev", "k", "mode", "reason", "size"]);
    expect(rows().every((r) => r.mode === null && r.reason === null)).toBe(true);
  });
});
