// P12: what is live is recorded. The build writes pages/public/version.json = { commit, dirty, builtAt, game } (served at /version.json), and docs/DEPLOYS.md lists the last deploys.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore (plain .mjs next to the build script)
import { versionStamp } from "../../../pages/version.mjs";

const ROOT = join(import.meta.dir, "../../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string };

describe("P12: the version stamp", () => {
  test("it holds the commit, whether files differed from it, the build time and the game, and nothing else", () => {
    const calls: string[][] = [];
    const v = versionStamp({ root: ROOT, game: "corporate-test", now: () => new Date("2026-10-14T05:00:00Z"), run: (a: string[]) => { calls.push(a); return a[0] === "rev-parse" ? "abc123def456" : ""; } });
    expect(v).toEqual({ commit: "abc123def456", dirty: false, builtAt: "2026-10-14T05:00:00.000Z", game: "corporate-test" });
    expect(Object.keys(v).sort()).toEqual(["builtAt", "commit", "dirty", "game"]);
    expect(versionStamp({ root: ROOT, game: "g", run: (a: string[]) => (a[0] === "rev-parse" ? "abc123def456" : " M file.ts") }).dirty).toBe(true);
  });
  test("built outside git it says so instead of failing", () => {
    const v = versionStamp({ root: ROOT, game: "g", run: () => { throw new Error("not a git repository"); } });
    expect(v.commit).toBe("unknown");
  });
  test("the real build writes version.json with this checkout's commit, the package name and a valid UTC time, and serves it uncached", () => {
    const r = Bun.spawnSync([process.execPath, "pages/build.mjs"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const v = JSON.parse(readFileSync(join(ROOT, "pages/public/version.json"), "utf8"));
    expect(v.game).toBe(pkg.name);
    expect(v.commit).toMatch(/^([0-9a-f]{7,40}|unknown)$/);
    expect(new Date(v.builtAt).toISOString()).toBe(v.builtAt);
    expect(typeof v.dirty).toBe("boolean");
    const head = Bun.spawnSync(["git", "rev-parse", "--short=12", "HEAD"], { cwd: ROOT, stdout: "pipe" });
    if (head.exitCode === 0) expect(v.commit).toBe(new TextDecoder().decode(head.stdout).trim());
    expect(readFileSync(join(ROOT, "pages/public/_headers"), "utf8")).toMatch(/\/version\.json\n\s+Cache-Control: no-store/);
    expect(JSON.stringify(v)).not.toMatch(/key|secret|token|password/i);
  });
  test("docs/DEPLOYS.md exists and names the deploys by commit; the README no longer says nothing is deployed", () => {
    expect(existsSync(join(ROOT, "docs/DEPLOYS.md"))).toBe(true);
    const d = readFileSync(join(ROOT, "docs/DEPLOYS.md"), "utf8");
    expect(d).toMatch(/\/version\.json/);
    expect(d).toMatch(/\| [0-9a-f]{7} \|/); // at least one deploy row, by short commit
    expect(readFileSync(join(ROOT, "README.md"), "utf8")).not.toMatch(/Nothing is deployed/i);
  });
});
