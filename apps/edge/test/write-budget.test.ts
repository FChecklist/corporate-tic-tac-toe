// The daily write guard is a runaway guard only (the Cloudflare account is on the paid Workers plan, owner 2026-10-27): a crowd joining must never meet "very busy" because of it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
describe("write budget", () => {
  test("pages/wrangler.toml sets DAILY_WRITE_BUDGET to 2,000,000", () => {
    const toml = readFileSync(new URL("../../../pages/wrangler.toml", import.meta.url), "utf8");
    expect(/^DAILY_WRITE_BUDGET\s*=\s*"2000000"/m.test(toml)).toBe(true);
  });
});
