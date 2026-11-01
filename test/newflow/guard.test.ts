// G*: the server does no game work (the guard test of the repo stays green) and the new relay code keeps it so.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const code = (f: string) => readFileSync(resolve(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

describe("G the server only stores and relays", () => {
  test("G1: apps/edge/test/server-does-no-game-work.test.ts passes", async () => {
    const p = Bun.spawn(["bun", "test", "apps/edge/test/server-does-no-game-work.test.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const [out, err, rc] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    expect(err + out).toMatch(/0 fail/); expect(rc).toBe(0);
  }, 120_000);
  test("G2: the Worker takes nothing of the stage rules: no import of the game-core tictactoe module, stageplay or the stage functions", () => {
    for (const f of ["apps/edge/src/tournament.ts", "apps/edge/src/worker.ts", "apps/edge/src/lifecycle.ts"]) {
      const c = code(f);
      expect(c).not.toMatch(/vendor\/game-core\/packages\/(tictactoe|snakes)/); expect(c).not.toMatch(/ttt\/src\/stageplay/);
      for (const n of ["settleStages", "pairSlot", "clockAt", "viewFor", "gameFrom", "deadlineOf", "keepAfter", "moveClockFor", "afterMissedMove"]) expect(c).not.toMatch(new RegExp(`\\b${n}\\b`));
    }
  });
  test("G3: the relay routes of the new flow compute no pairing, no ranking and no clock: the code of the stage routes has no sort, no sha256 and no tictactoe rule", () => {
    const c = code("apps/edge/src/tournament.ts"); const from = c.indexOf('sub === "stageon"'), to = c.indexOf('sub === "view"'); expect(from).toBeGreaterThan(0); expect(to).toBeGreaterThan(from);
    const block = c.slice(from, to); expect(block).not.toMatch(/\.sort\(|sha256|boardResult|pairSlot|rank/i);
  });
  test("G4: the game-core packages that hold rules are not imported by anything under apps/edge/src", () => {
    const glob = new Bun.Glob("apps/edge/src/**/*.ts");
    for (const f of glob.scanSync({ cwd: ROOT })) expect(code(f)).not.toMatch(/vendor\/game-core\/packages\/(tictactoe|snakes|bingo)\/src/);
  });
});
