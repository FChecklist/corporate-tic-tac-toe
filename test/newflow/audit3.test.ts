// v1.6.2, third audit round of PR 9 (23 Nov 2026, head 776e5ee6), the CORRECTNESS audit, M-A: in a stage game the opponent could take the first move.
// The second player wrote a missed move ("-") at number 0 right at the start; the replay then gave the first move to them. The first move of a slot now has a clock too: it runs from the start of the slot.
// Every test here fails if the fix it protects is taken out.
import { beforeEach, describe, expect, test } from "bun:test";
import { gameFrom, type Entry } from "../../packages/ttt/src/stageplay";
import { STAGE_CALENDAR_MS } from "../../apps/edge/src/tournament";
import { SLOT_SECONDS } from "../../vendor/game-core/packages/tictactoe/src/stages";
import { STAGE_SECONDS, WAIT_SECONDS } from "../../vendor/game-core/packages/tictactoe/src";
import { T, callIn, j, join, makeGame, newWorld, startStages, write, type Call, type P, type World } from "./kit";

let w: World, call: Call;
beforeEach(() => { w = newWorld(); call = callIn(w); });
const slotOf = (a: P, b: P, st = 1, sl = 1) => `${st}-${sl}-${a.pid}-${b.pid}`;
const sql = (q: string, ...a: unknown[]) => w.raw.query(q).all(...(a as any[])) as any[];
async function game(id: string) { const h = await makeGame(w, call, id); const ps = await join(call, id, 4); await startStages(call, id, h); return { h, ps }; }
const SLOT1 = T + STAGE_CALENDAR_MS.wait; // the first slot of the first stage begins 120 s after the published start

describe("M-A: nobody can take the first move of a stage game", () => {
  test("the audit's probe: the second player writes '-' at number 0 right at the start: refused (409 too-early), nothing stored, and the first player's move opens the game", async () => {
    const { ps } = await game("A3-1"); const [a, b] = [ps[0]!, ps[1]!], s = slotOf(a, b);
    for (const at of [1000, 60_000, SLOT1 - T, SLOT1 - T + 5000, SLOT1 - T + 8400]) { const r = await write(call, "A3-1", b, { slot: s, kind: "move", seq: 0, body: "-" }, T + at); expect([at, r.status]).toEqual([at, 409]); expect((await j(r)).code).toBe("too-early"); }
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE slot=?", s)[0].c).toBe(0);
    expect((await write(call, "A3-1", a, { slot: s, kind: "move", seq: 0, body: "4" }, SLOT1 + 2000)).status).toBe(200);
    const log = sql("SELECT slot, kind, pid, seq, body, at_ms FROM ttt_sl WHERE slot=? ORDER BY id", s).map((x, i) => ({ ...x, id: i + 1 })) as Entry[];
    const g = gameFrom(log, a.pid, b.pid); expect(g.board[4]).toBe("X"); expect(g.next).toBe(g.xIs === a.pid ? b.pid : a.pid); expect(g.entries).toBe(1); // the first player moved first, and it is now the other player's turn
  });
  test("a real no-show still works: after the 10 s move clock of the slot the miss at number 0 is stored, and the other player moves", async () => {
    const { ps } = await game("A3-2"); const [a, b] = [ps[0]!, ps[1]!], s = slotOf(a, b);
    expect((await write(call, "A3-2", b, { slot: s, kind: "move", seq: 0, body: "-" }, SLOT1 + 8600)).status).toBe(200); // 10 s from the slot start, less the slack for a phone's clock
    expect((await write(call, "A3-2", b, { slot: s, kind: "move", seq: 1, body: "4" }, SLOT1 + 9000)).status).toBe(200);
    const log = sql("SELECT slot, kind, pid, seq, body, at_ms FROM ttt_sl WHERE slot=? ORDER BY id", s).map((x, i) => ({ ...x, id: i + 1 })) as Entry[];
    const g = gameFrom(log, a.pid, b.pid); expect(g.entries).toBe(2); expect(g.board[4]).toBe(g.xIs === b.pid ? "X" : "O");
  });
  test("the clock of a later slot and a later stage runs from THEIR start: slot 2 begins 100 s after slot 1, stage 2 begins 300 s after stage 1", async () => {
    const { ps } = await game("A3-3"); const [a, b] = [ps[0]!, ps[1]!];
    const slot2 = slotOf(a, b, 1, 2), stage2 = slotOf(a, b, 2, 1);
    expect((await write(call, "A3-3", b, { slot: slot2, kind: "move", seq: 0, body: "-" }, SLOT1 + 50_000)).status).toBe(409); // still inside slot 1
    expect((await write(call, "A3-3", b, { slot: slot2, kind: "move", seq: 0, body: "-" }, SLOT1 + 100_000 + 8600)).status).toBe(200);
    expect((await write(call, "A3-3", b, { slot: stage2, kind: "move", seq: 0, body: "-" }, SLOT1 + 200_000)).status).toBe(409);
    expect((await write(call, "A3-3", b, { slot: stage2, kind: "move", seq: 0, body: "-" }, SLOT1 + 300_000 + 8600)).status).toBe(200);
  });
  test("a pause moves the slot start: while the game was paused the clock stood still", async () => {
    const { h, ps } = await game("A3-4"); const [a, b] = [ps[0]!, ps[1]!], s = slotOf(a, b);
    expect((await call("POST", "/api/z/A3-4/ttt/pause", {}, h, T + 10_000)).status).toBe(200);
    expect((await call("POST", "/api/z/A3-4/ttt/resume", {}, h, T + 70_000)).status).toBe(200); // 60 s paused
    expect((await write(call, "A3-4", b, { slot: s, kind: "move", seq: 0, body: "-" }, SLOT1 + 8600)).status).toBe(409); // without the pause this would be stored
    expect((await write(call, "A3-4", b, { slot: s, kind: "move", seq: 0, body: "-" }, SLOT1 + 60_000 + 8600)).status).toBe(200);
  });
  test("the three calendar numbers the server uses are the numbers the phones use (the game-core files); they cannot drift apart unseen", () => {
    expect(STAGE_CALENDAR_MS).toEqual({ wait: WAIT_SECONDS * 1000, stage: STAGE_SECONDS * 1000, slot: SLOT_SECONDS * 1000 });
  });
  test("the second player's miss cannot be written before the first player's own clock, whichever way the slot key lists them", async () => {
    const { ps } = await game("A3-5"); const [a, b] = [ps[0]!, ps[1]!];
    for (const [first, second] of [[a, b], [b, a]] as const) {
      const r = await write(call, "A3-5", second, { slot: slotOf(first, second, 1, first === a ? 1 : 3), kind: "move", seq: 0, body: "-" }, T + 2000); expect(r.status).toBe(409);
      const r2 = await write(call, "A3-5", first, { slot: slotOf(first, second, 1, first === a ? 1 : 3), kind: "move", seq: 0, body: "-" }, T + 2000); expect(r2.status).toBe(409);
    }
  });
});
