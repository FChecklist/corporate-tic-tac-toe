// Security rules found in the review of PR 9 (version 1.4.1). Each test fails on 1.4.0.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { scopedKeyMayCall } from "../src/console-adapter";

describe("a console key tied to one game", () => {
  test("a broken %-escape in the address is refused, it never throws (1.4.0 threw a URIError out of the Worker)", () => {
    expect(() => scopedKeyMayCall("GAME-1", "GET", "/api/z/%E0%A4%A/summary")).not.toThrow();
    expect(scopedKeyMayCall("GAME-1", "GET", "/api/z/%E0%A4%A/summary")).toBe(false);
    expect(scopedKeyMayCall("GAME-1", "GET", "/api/z/%/summary")).toBe(false);
  });
  test("its own game is allowed, even spelled with %-escapes; another game and the account-wide addresses are not", () => {
    expect(scopedKeyMayCall("GAME-1", "GET", "/api/z/GAME-1/summary")).toBe(true);
    expect(scopedKeyMayCall("GAME-1", "GET", "/api/z/GAME%2D1/summary")).toBe(true);
    expect(scopedKeyMayCall("GAME-1", "GET", "/api/z/GAME-2/summary")).toBe(false);
    expect(scopedKeyMayCall("GAME-1", "GET", "/api/z/GAME-1%2F..%2FGAME-2/summary")).toBe(false);
    for (const p of ["/api/keys", "/api/account", "/api/games", "/api/owner/anything", "/api/z"]) expect(scopedKeyMayCall("GAME-1", "GET", p)).toBe(false);
  });
});

describe("money switches are OFF in every shipped config", () => {
  test("neither wrangler file sets PAY_VIA_CONSOLE or CONSOLE_PUBKEYS to a value", () => {
    for (const f of ["../wrangler.toml", "../../../pages/wrangler.toml"]) {
      const t = readFileSync(new URL(f, import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
      expect(t).not.toMatch(/PAY_VIA_CONSOLE\s*=\s*"?1/);
      expect(t).not.toMatch(/CONSOLE_PUBKEYS\s*=\s*"[^"]+"/);
    }
  });
});
