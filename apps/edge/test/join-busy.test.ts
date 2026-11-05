// A join that meets a passing database overload (Cloudflare D1: "D1 DB is overloaded. Too many resources consumed within a 10 second window") is tried again,
// seats the person exactly once, and if the database stays busy the guest gets a gentle busy answer (503 + retry-after), never a bare server error.
// Found by the 250-player run on 5 Nov 2026: two joins of 250 answered 500 "Something went wrong".
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { W, call, dev, j, mob, one, paidGame, reset, restore, uid } from "./param-harness";
import { joinRetry, transientDb } from "../src/worker";

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
