// A join that meets a passing database overload (Cloudflare D1: "D1 DB is overloaded. Too many resources consumed within a 10 second window") is tried again,
// seats the person exactly once, and if the database stays busy the guest gets a gentle busy answer (503 + retry-after), never a bare server error.
// Found by the 250-player run on 5 Nov 2026: two joins of 250 answered 500 "Something went wrong".
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { W, call, dev, j, mob, one, paidGame, reset, restore, uid } from "./param-harness";
import { joinRetry, retryKind, transientDb } from "../src/worker";

const OVERLOAD = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window";
const wrapStmt = (s: any, fail: (sql: string) => void, sql: string): any => new Proxy(s, {
  get(t, k) {
    const v = t[k];
    if (k === "__raw") return t;
    if (k === "bind") return (...a: any[]) => wrapStmt(v.apply(t, a), fail, sql);
    if (k === "first" || k === "run" || k === "all" || k === "raw") return async (...a: any[]) => { fail(sql); return v.apply(t, a); };
    return v;
  },
});
/** The test database, with `fail(sql)` run before every read/write; it throws to play the overload. */
const flaky = (fail: (sql: string) => void) => {
  const real = W.env.DB as any;
  (W.env as any).DB = { prepare: (sql: string) => wrapStmt(real.prepare(sql), fail, sql), batch: async (xs: any[]) => { fail("BATCH"); return real.batch(xs.map((x) => x.__raw ?? x)); } };
};
const join = (id: string, i: number) => call("POST", `/api/z/${id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i) });
const seated = (id: string) => one("SELECT COUNT(*) c FROM participant WHERE eid=?", id).c as number;
const oldTries = joinRetry.tries, oldBase = joinRetry.baseMs;

describe("a join through a passing database overload", () => {
  beforeEach(() => { reset(); joinRetry.baseMs = 0; joinRetry.tries = 3; }); afterEach(() => { restore(); joinRetry.tries = oldTries; joinRetry.baseMs = oldBase; });

  test("which errors count as passing: the overload, a lost connection, a timeout; not a bug", () => {
    expect(transientDb(new Error(OVERLOAD))).toBe(true);
    expect(transientDb(new Error("D1_ERROR: Network connection lost"))).toBe(true);
    expect(transientDb(new Error("D1_ERROR: timed out"))).toBe(true);
    expect(transientDb(new Error("D1_ERROR: internal error; reference = d3rg4auvdvpoci8nm5qmu78l"))).toBe(true); // seen on Snakes, 5 Nov 2026
    expect(transientDb(new Error("TypeError: x is undefined"))).toBe(false);
    expect(transientDb(new Error("D1_ERROR: UNIQUE constraint failed: seat.pid"))).toBe(false);
  });

  test("one overload on the way in: the guest still gets in, once", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let n = 1; flaky((sql) => { if (n > 0 && sql.startsWith("SELECT * FROM engagement")) { n--; throw new Error(OVERLOAD); } });
    const r = await join(id, 1); expect(r.status).toBe(200); expect((await j(r)).pid).toBeTruthy();
    expect(n).toBe(0); expect(seated(id)).toBe(1);
  });

  test("a D1 internal error (as seen on Snakes, 5 Nov 2026) is retried as well", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let n = 1; flaky((sql) => { if (n > 0 && sql.startsWith("SELECT * FROM engagement")) { n--; throw new Error("D1_ERROR: internal error; reference = d3rg4auvdvpoci8nm5qmu78l"); } });
    const r = await join(id, 1); expect(r.status).toBe(200); expect(seated(id)).toBe(1);
  });

  test("an overload at the final write (the batch): tried again, still one seat", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let n = 2; flaky((sql) => { if (n > 0 && sql === "BATCH") { n--; throw new Error(OVERLOAD); } });
    const r = await join(id, 1); expect(r.status).toBe(200);
    expect(seated(id)).toBe(1);
    expect((await join(id, 1)).status).toBe(200); expect(seated(id)).toBe(1); // the same person again is the same participant
  });

  test("still busy after the tries: a gentle 503 with retry-after, not a 500", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let calls = 0; flaky((sql) => { if (sql.startsWith("SELECT * FROM engagement")) { calls++; throw new Error(OVERLOAD); } });
    const r = await join(id, 1); expect(r.status).toBe(503); expect(r.headers.get("retry-after")).toBe("3");
    const b = await j(r); expect(b.code).toBe("busy"); expect(String(b.error)).toMatch(/busy/i); expect(String(b.error)).not.toMatch(/something went wrong/i);
    expect(calls).toBe(4); // the first go and three more
  });

  test("a real bug is not hidden: it is still a 500 and is tried once", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let calls = 0; flaky((sql) => { if (sql.startsWith("SELECT * FROM engagement")) { calls++; throw new Error("TypeError: boom"); } });
    const r = await join(id, 1); expect(r.status).toBe(500); expect(calls).toBe(1);
  });

  test("250 guests join at the same moment while the database keeps refusing every second try: all 250 are seated once", async () => {
    const id = uid("BZ"); await paidGame({ id, cap: 250 });
    joinRetry.tries = 10;
    let c = 0, refused = 0; flaky((sql) => { if (sql.startsWith("SELECT * FROM engagement WHERE")) { c++; if (c % 2 === 1) { refused++; throw new Error(OVERLOAD); } } });
    const rs = await Promise.all(Array.from({ length: 250 }, (_, i) => join(id, i + 1)));
    expect(rs.filter((r) => r.status === 200).length).toBe(250);
    expect(rs.filter((r) => r.status >= 500).length).toBe(0);
    expect(refused).toBeGreaterThan(100); expect(seated(id)).toBe(250);
  });
});

describe("a plain read (the control file, check-in, ...) through a passing database overload", () => {
  beforeEach(() => { reset(); joinRetry.baseMs = 0; joinRetry.tries = 3; }); afterEach(() => { restore(); joinRetry.tries = oldTries; joinRetry.baseMs = oldBase; });
  const ctl = (id: string) => call("GET", `/api/z/${id}/control`);

  test("one overload on the way in: the control file is still answered (found by the 250 run, 5 Nov 2026: GET control -> 500)", async () => {
    const id = uid("BZ"); await paidGame({ id });
    const ok = await ctl(id); expect(ok.status).toBeLessThan(500);
    let n = 1; flaky((sql) => { if (n > 0 && sql.startsWith("SELECT id, pack, start_round")) { n--; throw new Error(OVERLOAD); } });
    const r = await ctl(id); expect(n).toBe(0); expect(r.status).toBe(ok.status);
  });

  test("still busy after the tries: a gentle 503 with retry-after for the read, not a 500", async () => {
    const id = uid("BZ"); await paidGame({ id });
    const oldSleep = joinRetry.sleep; let calls = 1; joinRetry.sleep = async () => { calls++; }; flaky(() => { throw new Error(OVERLOAD); });
    const r = await ctl(id); joinRetry.sleep = oldSleep; expect(r.status).toBe(503); expect(r.headers.get("retry-after")).toBe("3");
    const b = await j(r); expect(b.code).toBe("busy"); expect(String(b.error)).not.toMatch(/seat/i);
    expect(calls).toBe(4); // the first go and three more
  });

  test("a real bug in a read is not hidden: still a 500, tried once", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let first = "", calls = 0; flaky((sql) => { if (!first) first = sql; if (sql === first) calls++; throw new Error("TypeError: boom"); });
    const r = await ctl(id); expect(r.status).toBe(500); expect(calls).toBe(1);
  });

  test("a write that is not a join is never asked twice by the server", async () => {
    const id = uid("BZ"); await paidGame({ id });
    let first = "", calls = 0; flaky((sql) => { if (!first) first = sql; if (sql === first) calls++; throw new Error(OVERLOAD); });
    const r = await call("POST", `/api/z/${id}/claims`, { pid: "x", claims: [] }); expect(r.status).toBeGreaterThanOrEqual(400);
    expect(calls).toBe(1);
  });
});

describe("check-in (mark present) through a passing database overload", () => {
  beforeEach(() => { reset(); joinRetry.baseMs = 0; joinRetry.tries = 3; }); afterEach(() => { restore(); joinRetry.tries = oldTries; joinRetry.baseMs = oldBase; });
  test("POST check-in meeting one overload is asked again, not a 500 (39 of 1,135 errors in the 990-player run)", async () => {
    const id = uid("BZ"); await paidGame({ id });
    const oldSleep = joinRetry.sleep; let sleeps = 0; joinRetry.sleep = async () => { sleeps++; };
    let n = 1; flaky((sql) => { if (n > 0 && sql.startsWith("SELECT * FROM engagement")) { n--; throw new Error(OVERLOAD); } });
    const r = await call("POST", `/api/z/${id}/checkin`, { pid: "p-none", device: "d" }); joinRetry.sleep = oldSleep;
    expect(n).toBe(0); expect(sleeps).toBe(1); expect(r.status).toBeLessThan(500);
  });
  test("still busy: gentle 503 with retry-after, no talk of seats", async () => {
    const id = uid("BZ"); await paidGame({ id });
    flaky((sql) => { if (sql.startsWith("SELECT * FROM engagement")) throw new Error(OVERLOAD); });
    const r = await call("POST", `/api/z/${id}/checkin`, { pid: "p-none", device: "d" });
    expect(r.status).toBe(503); expect(r.headers.get("retry-after")).toBe("3"); expect(String((await j(r)).error)).not.toMatch(/seat/i);
  });
});

describe("what the server may ask twice on a passing database hiccup (round 2 audit, 5 Nov 2026)", () => {
  beforeEach(() => { reset(); joinRetry.baseMs = 0; joinRetry.tries = 3; }); afterEach(() => { restore(); joinRetry.tries = oldTries; joinRetry.baseMs = oldBase; });
  const kinds = (m: string, p: string) => retryKind(m, p);
  test("the classes: reads and idempotent writes are asked again; money, keys, winners and cancel never", () => {
    for (const r of ["claims", "mark", "unbind", "erase", "discard", "reuse", "roster", "settings", "over", "prizegiven", "confirm", "checkin", "who", "presence", "join", "forget", "person"]) expect(kinds("POST", `/api/z/ABCD/${r}`)).toBe("write");
    expect(kinds("PATCH", "/api/z/ABCD/settings")).toBe("write");
    for (const r of ["cancel", "reopen", "override", "reportlink", "vote", "publish", "clone", "rehearsal", "bogey", "announce", "control/request"]) expect(kinds("POST", `/api/z/ABCD/${r}`)).toBe("once");
    for (const p of ["/api/auth/email", "/api/org/host", "/api/pay/webhook", "/api/z"]) expect(kinds("POST", p)).toBe("once");
    expect(kinds("GET", "/api/z/ABCD/control")).toBe("read");
  });
  test("an idempotent write (mark) meeting one overload is asked again", async () => {
    const id = uid("BZ"); await paidGame({ id });
    const oldSleep = joinRetry.sleep; let sleeps = 0; joinRetry.sleep = async () => { sleeps++; };
    let n = 1; flaky((sql) => { if (n > 0 && sql.startsWith("SELECT * FROM engagement")) { n--; throw new Error(OVERLOAD); } });
    const r = await call("POST", `/api/z/${id}/mark`, { seat: 1, role: "organizer" }); joinRetry.sleep = oldSleep;
    expect(n).toBe(0); expect(sleeps).toBe(1); expect(r.status).toBeLessThan(500);
  });
  test("a write that must not be asked twice (cancel) meets an overload: 503 busy with retry-after, tried once, nothing half-done", async () => {
    const id = uid("BZ"); await paidGame({ id });
    const oldSleep = joinRetry.sleep; let sleeps = 0; joinRetry.sleep = async () => { sleeps++; };
    let reads = 0; flaky((sql) => { if (sql.startsWith("SELECT * FROM engagement")) { reads++; throw new Error(OVERLOAD); } });
    const r = await call("POST", `/api/z/${id}/cancel`, { confirm: 3 }); joinRetry.sleep = oldSleep;
    expect(r.status).toBe(503); expect(r.headers.get("retry-after")).toBe("3"); expect((await j(r)).code).toBe("busy");
    expect(sleeps).toBe(0); expect(reads).toBe(1);
  });
});

describe("the winners' vote when the database hiccups in the middle (round 2 audit: 'settled' used to be written first)", () => {
  beforeEach(() => { reset(); joinRetry.baseMs = 0; joinRetry.tries = 3; }); afterEach(() => { restore(); joinRetry.tries = oldTries; joinRetry.baseMs = oldBase; });
  const settledN = (id: string) => one("SELECT COUNT(*) c FROM settled WHERE eid=?", id).c as number;
  const winnersN = (id: string) => one("SELECT COUNT(*) c FROM winner WHERE eid=?", id).c as number;
  test("a hiccup while the winner record is written: 503 busy, the prize is NOT settled; the same phone's repeat finishes it with the winner record in place", async () => {
    const id = uid("BZ"); await paidGame({ id });
    const pids: string[] = []; for (let i = 1; i <= 8; i++) pids.push((await j(await join(id, i))).pid);
    const rep = (pid: string) => call("POST", `/api/z/${id}/vote`, { pid, device: dev(pids.indexOf(pid) + 1), results: [{ pattern: "first", ordinal: 1, round: 1, idx: 70, pids: [pids[1], pids[2]] }] });
    let fails = 1; flaky((sql) => { if (fails > 0 && sql.startsWith("INSERT INTO winner")) { fails--; throw new Error(OVERLOAD); } });
    let bad: Response | null = null, who = "";
    for (const pid of pids) { const r = await rep(pid); if (r.status === 503) { bad = r; who = pid; break; } }
    expect(bad).not.toBeNull(); expect(fails).toBe(0);
    expect((await j(bad!)).code).toBe("busy");
    expect(settledN(id)).toBe(0); // not marked settled over a missing winner record
    const ok = await j(await rep(who)); // the phone sends the same report again
    expect(ok.accepted).toBe(1); expect(settledN(id)).toBe(1); expect(winnersN(id)).toBe(2);
  });
});
