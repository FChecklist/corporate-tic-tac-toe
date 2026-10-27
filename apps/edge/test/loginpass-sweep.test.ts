// Audit finding 23 (1.2.0 review): a demo-pass secret held for a sign-in that never finished (kv key loginpass/<emailhash>) was only removed when the same
// e-mail signed in again, so it stayed for ever. It is usable for 2 hours (useHeldPass), so the retention sweep must drop anything older and keep what is still usable.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { retentionSweep } from "../src/worker";
import { HOUR, T, W, one, q, reset, restore } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

const put = (k: string, v: string) => W.raw.prepare("INSERT INTO kv(k,v) VALUES(?,?)").run(k, v);

describe("held demo-pass secrets", () => {
  test("the retention sweep drops a held secret older than 2 hours (and an unreadable one) and keeps a fresh one", async () => {
    put("loginpass/old", JSON.stringify({ t: "a".repeat(32), at: T - 3 * HOUR }));
    put("loginpass/broken", "not json");
    put("loginpass/fresh", JSON.stringify({ t: "b".repeat(32), at: T - 10 * 60_000 }));
    put("unrelated/key", "stays");
    await retentionSweep(W.env as any, T);
    expect(q("SELECT k FROM kv WHERE k LIKE 'loginpass/%' ORDER BY k").map((r) => r.k)).toEqual(["loginpass/fresh"]);
    expect(one("SELECT v FROM kv WHERE k='unrelated/key'").v).toBe("stays");
  });
});
