// The Worker refuses to run in production without its secrets (no built-in fallback keys).
import { describe, expect, test } from "bun:test";
import { missingKeys, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";

const ALL = { DATA_KEY: "d", PHONE_SALT: "p", ORGANIZER_SECRET: "o", CRON_KEY: "c", INBOUND_SECRET: "i" };
const mk = (extra: Record<string, string>) => ({ DB: makeD1().db, DAILY_WRITE_BUDGET: "1000", ...extra }) as unknown as Env;
const hit = (env: Env) => handle(new Request("http://x/api/whoami"), env, Date.UTC(2026, 9, 1));

describe("strict keys", () => {
  test("strict mode with every secret set: the service answers normally", async () => {
    const env = mk({ STRICT_KEYS: "1", ...ALL }); expect(missingKeys(env)).toEqual([]); expect((await hit(env)).status).toBe(403);
  });
  for (const k of Object.keys(ALL) as (keyof typeof ALL)[]) test(`strict mode without ${k}: every request is refused with 503 and nothing else is said`, async () => {
    const { [k]: _gone, ...rest } = ALL; const env = mk({ STRICT_KEYS: "1", ...rest });
    expect(missingKeys(env)).toEqual([k]); const r = await hit(env); expect(r.status).toBe(503); expect(await r.text()).not.toContain(k);
  });
  test("a blank (spaces only) secret counts as missing", () => { expect(missingKeys(mk({ STRICT_KEYS: "1", ...ALL, DATA_KEY: "  " }))).toEqual(["DATA_KEY"]); });
  test("without STRICT_KEYS (local runs, tests) nothing changes", async () => { expect(missingKeys(mk({}))).toEqual([]); expect((await hit(mk({}))).status).toBe(403); });
});
