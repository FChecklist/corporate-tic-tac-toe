// Smoke-test T-51 (2026-11-04): the start route accepts up to 10,000 players, so the draw of 10,000 players must fit the mailbox's request limits (400,000 characters, 600 matches).
import { describe, expect, test } from "bun:test";
import { PLAN_BODY_LIMIT, planOf, planPayload, planRequests, type Setup } from "../src/phone";

const hex16 = (i: number) => (Math.imul(i + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, "0") + (Math.imul(i + 7, 0x85ebca6b) >>> 0).toString(16).padStart(8, "0");
const setupOf = (n: number, format: "solo" | "team", teamSize: number): Setup => ({ eid: "cap", state: "running", commit: "c", seed: "ab".repeat(16), roster: Array.from({ length: n }, (_, i) => ({ pid: hex16(i), name: ("Employee with a rather long name number " + i).padEnd(60, "x").slice(0, 60) })), opts: { format, teamSize, moveMs: 20000, readyMs: 30000 }, startedMs: 1_000_000, pauses: [], serverNow: 1_000_000 } as Setup);

describe("the draw is sent in requests the mailbox accepts", () => {
  for (const [n, format, teamSize] of [[7000, "solo", 1], [10000, "solo", 1], [10000, "team", 5], [2000, "solo", 1], [2, "solo", 1]] as const) {
    test(`${n} players, ${format}`, async () => {
      const pl = planPayload(await planOf(setupOf(n, format, teamSize)));
      const reqs = planRequests(pl);
      for (const r of reqs) { expect(JSON.stringify(r).length).toBeLessThanOrEqual(PLAN_BODY_LIMIT); expect((r.matches as unknown[]).length).toBeLessThanOrEqual(400); }
      // nothing lost, nothing doubled, and exactly the last request closes the draw
      expect(reqs.flatMap((r) => (r.entrants as { id: string }[] | undefined) ?? []).map((e) => e.id)).toEqual(pl.entrants.map((e) => e.id));
      expect(reqs.flatMap((r) => r.matches as { mid: string }[]).map((m) => m.mid)).toEqual(pl.matches.map((m) => m.mid));
      expect(reqs.filter((r) => r.last === true).length).toBe(1);
      expect(reqs[reqs.length - 1]!.last).toBe(true);
      expect(reqs[reqs.length - 1]!.entrantCount).toBe(pl.entrants.length);
    }, 60_000);
  }
});
