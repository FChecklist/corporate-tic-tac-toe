// Retention holes closed (G-09): address hashes, sign-in codes, "new place" records, e-mailed keys, retired keys and counters expire. See docs/RETENTION.md.
import { beforeEach, describe, expect, test } from "bun:test";
import { purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 10, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const day = (n: number) => new Date(T - n * DAY).toISOString().slice(0, 10);
const kv = (k: string, v = "1") => raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run(k, v);
const has = (k: string) => !!raw.prepare("SELECT 1 FROM kv WHERE k=?").get(k);
const key = (hash: string, org: string, kind: string, revoked: number, created: number, exp: number | null) => raw.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,expires_ms) VALUES(?,?,?,?,?,?)").run(hash, org, kind, revoked, created, exp);
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000" }; });

describe("the daily sweep", () => {
  test("network-address hashes older than two days go; newer ones stay", async () => {
    for (const k of [`start/${day(5)}/aaaa`, `linkfail/${day(3)}/bbbb`, `plim/check/${day(9)}/cccc`]) kv(k);
    for (const k of [`start/${day(0)}/dddd`, `linkfail/${day(1)}/eeee`, `plim/enroll/${day(2)}/ffff`]) kv(k);
    await purgeOld(env as Env, T);
    for (const k of [`start/${day(5)}/aaaa`, `linkfail/${day(3)}/bbbb`, `plim/check/${day(9)}/cccc`]) expect(has(k)).toBe(false);
    for (const k of [`start/${day(0)}/dddd`, `linkfail/${day(1)}/eeee`, `plim/enroll/${day(2)}/ffff`]) expect(has(k)).toBe(true);
  });
  test("sign-in codes go a day after they expire; partner sign-up codes after a day", async () => {
    raw.prepare("INSERT INTO login_code(email_hash,code_hash,expires_ms,attempts,win_start,sent) VALUES('old','x',?,0,?,1)").run(T - 2 * DAY, T - 2 * DAY);
    raw.prepare("INSERT INTO login_code(email_hash,code_hash,expires_ms,attempts,win_start,sent) VALUES('fresh','x',?,0,?,1)").run(T + 600_000, T);
    kv("penr/old", JSON.stringify({ t: T - 2 * DAY })); kv("penr/new", JSON.stringify({ t: T - 3_600_000 })); kv("penr/junk", "not json");
    await purgeOld(env as Env, T);
    expect((raw.prepare("SELECT email_hash FROM login_code").all() as any[]).map((r) => r.email_hash)).toEqual(["fresh"]);
    expect([has("penr/old"), has("penr/new"), has("penr/junk")]).toEqual([false, true, false]);
  });
  test("'new place' records stay only while their key is live", async () => {
    const live = "live000000".padEnd(64, "0"), dead = "dead000000".padEnd(64, "0"), gone = "gone000000".padEnd(64, "0");
    key(live, "o1", "ai", 0, T, null); key(dead, "o1", "ai", 1, T - DAY, null); key(gone, "o1", "ai", 0, T - 3 * DAY, T - DAY); // revoked, expired
    for (const id of ["live000000", "dead000000", "gone000000", "never00000"]) { kv(`seen/${id}`); kv(`alert/${id}`); }
    await purgeOld(env as Env, T);
    expect([has("seen/live000000"), has("alert/live000000")]).toEqual([true, true]);
    for (const id of ["dead000000", "gone000000", "never00000"]) expect([id, has(`seen/${id}`), has(`alert/${id}`)]).toEqual([id, false, false]);
  });
  test("e-mailed 24-hour keys go 7 days after expiry, retired keys after 90 days; live and lasting keys never", async () => {
    key("a".repeat(64), "o", "ai", 0, T - 9 * DAY, T - 8 * DAY); key("b".repeat(64), "o", "ai", 0, T - 3 * DAY, T - 2 * DAY); // expired 8 d / 2 d ago
    key("c".repeat(64), "o", "ai", 1, T - 100 * DAY, null); key("d".repeat(64), "o", "ai", 1, T - 10 * DAY, null);
    key("e".repeat(64), "o", "master", 0, T - 400 * DAY, null); key("f".repeat(64), "o", "ai", 0, T, T + DAY);
    await purgeOld(env as Env, T);
    expect((raw.prepare("SELECT substr(hash,1,1) AS h FROM organizer_key ORDER BY h").all() as any[]).map((r) => r.h)).toEqual(["b", "d", "e", "f"]);
  });
  test("daily counters older than 90 days go", async () => {
    raw.prepare("INSERT INTO usage(day,writes) VALUES(?,1)").run(day(100)); raw.prepare("INSERT INTO usage(day,writes) VALUES(?,1)").run(day(10));
    await purgeOld(env as Env, T);
    expect((raw.prepare("SELECT day FROM usage").all() as any[]).map((r) => r.day)).toEqual([day(10)]);
  });
  test("it runs from the daily housekeeping of a normal request, and a broken step never stops the rest", async () => {
    kv(`start/${day(5)}/zzzz`);
    raw.prepare("DROP TABLE usage").run(); // one step will fail
    await purgeOld(env as Env, T);
    expect(has(`start/${day(5)}/zzzz`)).toBe(false);
    const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000" };
    kv(`start/${day(5)}/yyyy`);
    await handle(new Request("http://x/api/whoami", { headers: { "x-organizer": "plat" } }), env as Env, T);
    await handle(new Request("http://x/api/history", { headers: { "x-organizer": "plat" } }), env as Env, T);
    expect(has(`start/${day(5)}/yyyy`)).toBe(false);
  });
});
