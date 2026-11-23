// v1.6.1, second audit of PR 9 (23 Nov 2026), angle 2 (security, abuse): the stage log and the game replay.
// H1: only the two players of a slot write to it; a missed move counts only after the move clock; nothing but a square, a miss or a result word is kept.
// Side finding: a real missed move must not freeze the board (the mark belongs to the player, not to the count of marks on the board).
// Every test here fails if the fix it protects is taken out.
import { beforeEach, describe, expect, test } from "bun:test";
import { gameFrom, type Entry } from "../../packages/ttt/src/stageplay";
import { T, callIn, j, join, makeGame, newWorld, startStages, write, type Call, type P, type World } from "./kit";

let w: World, call: Call;
beforeEach(() => { w = newWorld(); call = callIn(w); });
const slotOf = (a: P, b: P, st = 1, sl = 1) => `${st}-${sl}-${a.pid}-${b.pid}`;
const sql = (q: string, ...a: unknown[]) => w.raw.query(q).all(...(a as any[])) as any[];
const en = (id: number, seq: number, pid: string, body: string, at_ms = 0): Entry => ({ id, slot: "s", kind: "move", pid, seq, body, at_ms });
async function game(id: string) { const h = await makeGame(w, call, id); const ps = await join(call, id, 4); await startStages(call, id, h); return { h, ps }; }

describe("H1 who may write to a slot", () => {
  test("a third player cannot write a move, a missed move or a result into somebody else's slot: 403, nothing is stored", async () => {
    const { ps } = await game("A2-1"); const s = slotOf(ps[0]!, ps[1]!), third = ps[2]!;
    for (const e of [{ kind: "move", seq: 0, body: "-" }, { kind: "move", seq: 0, body: "4" }, { kind: "result", seq: 0, body: "a" }]) {
      const r = await write(call, "A2-1", third, { slot: s, ...e }, T + 1000); expect([e.kind, e.body, r.status]).toEqual([e.kind, e.body, 403]); expect((await j(r)).code).toBe("not-in-slot");
    }
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE slot=?", s)[0].c).toBe(0);
  });
  test("the audit's repro no longer works: three misses from a third player do not burn a turn, end the game as a draw, or block the agreed result", async () => {
    const { ps } = await game("A2-2"); const [a, b, c] = [ps[0]!, ps[1]!, ps[2]!], s = slotOf(a, b);
    for (let i = 0; i < 2; i++) await write(call, "A2-2", c, { slot: s, kind: "move", seq: i, body: "-" }, T + 1000 + i * 11_000);
    await write(call, "A2-2", c, { slot: s, kind: "result", seq: 0, body: "b" }, T + 30_000);
    for (const p of [a, b]) expect((await write(call, "A2-2", p, { slot: s, kind: "result", seq: 0, body: "a" }, T + 40_000)).status).toBe(200);
    const log = sql("SELECT slot, kind, pid, seq, body, at_ms FROM ttt_sl WHERE slot=? ORDER BY id", s) as Entry[];
    expect(log.map((x) => x.pid).sort()).toEqual([a.pid, b.pid].sort()); // only the two players are in the log
    const g = gameFrom(log.map((x, i) => ({ ...x, id: i + 1 })), a.pid, b.pid); expect(g.done).toBe(false); expect(g.entries).toBe(0); // the board was not touched
  });
  test("the two players of the slot may write, whichever of them is first or second in the key; a pid that only ends in the same letters is not in the slot", async () => {
    const { ps } = await game("A2-3"); const [a, b] = [ps[0]!, ps[1]!];
    expect((await write(call, "A2-3", a, { slot: slotOf(a, b), kind: "move", seq: 0, body: "4" }, T + 1000)).status).toBe(200);
    expect((await write(call, "A2-3", b, { slot: slotOf(a, b), kind: "move", seq: 1, body: "0" }, T + 2000)).status).toBe(200);
    expect((await write(call, "A2-3", ps[2]!, { slot: `1-2-${a.pid}-${b.pid.slice(1)}`, kind: "move", seq: 0, body: "4" }, T + 3000)).status).toBe(403);
  });
});

describe("H1 a missed move counts only after the move clock", () => {
  test("a '-' right after the last entry is refused (409 too-early); after the 10 s clock it is stored", async () => {
    const { ps } = await game("A2-4"); const [a, b] = [ps[0]!, ps[1]!], s = slotOf(a, b);
    expect((await write(call, "A2-4", a, { slot: s, kind: "move", seq: 0, body: "4" }, T + 1000)).status).toBe(200);
    const early = await write(call, "A2-4", b, { slot: s, kind: "move", seq: 1, body: "-" }, T + 2000); expect(early.status).toBe(409); expect((await j(early)).code).toBe("too-early");
    expect((await write(call, "A2-4", b, { slot: s, kind: "move", seq: 1, body: "-" }, T + 1000 + 10_000)).status).toBe(200);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE slot=? AND kind='move'", s)[0].c).toBe(2);
  });
  test("a '-' for a number whose earlier entry is not there is refused: nobody can write misses ahead of the game", async () => {
    const { ps } = await game("A2-5"); const s = slotOf(ps[0]!, ps[1]!);
    for (const seq of [1, 2, 5, 40]) expect([seq, (await write(call, "A2-5", ps[0]!, { slot: s, kind: "move", seq, body: "-" }, T + 500_000)).status]).toEqual([seq, 409]);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE slot=?", s)[0].c).toBe(0);
  });
  test("only a square, a miss or a result word is kept: anything else is a 400", async () => {
    const { ps } = await game("A2-6"); const s = slotOf(ps[0]!, ps[1]!);
    for (const body of ["9", "10", "-1", "abc", "", "4 ", "<b>"]) expect([body, (await write(call, "A2-6", ps[0]!, { slot: s, kind: "move", seq: 0, body }, T + 1000)).status]).toEqual([body, 400]);
    for (const body of ["x", "A", "win", "", "4"]) expect([body, (await write(call, "A2-6", ps[0]!, { slot: s, kind: "result", seq: 0, body }, T + 1000)).status]).toEqual([body, 400]);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE slot=?", s)[0].c).toBe(0);
  });
});

describe("side finding: a real missed move does not freeze the board", () => {
  test("X plays, O misses, X plays again: both of X's squares are on the board and it is O's turn", () => {
    const g = gameFrom([en(1, 0, "x", "0"), en(2, 1, "o", "-"), en(3, 2, "x", "4")], "x", "o");
    expect(g.xIs).toBeTruthy(); const x = g.xIs, o = x === "x" ? "o" : "x";
    const h = gameFrom([en(1, 0, x, "0"), en(2, 1, o, "-"), en(3, 2, x, "4")], "x", "o");
    expect(h.board[0]).toBe("X"); expect(h.board[4]).toBe("X"); expect(h.entries).toBe(3); expect(h.next).toBe(o); expect(h.done).toBe(false);
  });
  test("a miss by X, then O plays, then X plays: the marks stay with their players", () => {
    const x = gameFrom([], "x", "o").xIs, o = x === "x" ? "o" : "x";
    const h = gameFrom([en(1, 0, x, "-"), en(2, 1, o, "4"), en(3, 2, x, "0"), en(4, 3, o, "1")], "x", "o");
    expect(h.board[4]).toBe("O"); expect(h.board[0]).toBe("X"); expect(h.board[1]).toBe("O"); expect(h.entries).toBe(4);
  });
  test("a square that is taken, a number outside 0 to 8 and an empty text are still ignored", () => {
    const x = gameFrom([], "x", "o").xIs, o = x === "x" ? "o" : "x";
    for (const body of ["0", "9", "", "-2", "x"]) { const h = gameFrom([en(1, 0, x, "0"), en(2, 1, o, body)], "x", "o"); expect([body, h.entries]).toEqual([body, body === "0" || body === "9" || body === "" || body === "-2" || body === "x" ? 1 : 2]); }
  });
});

describe("the built phone engine (apps/web/public/tttengine.js) carries the same fix", () => {
  test("loading the file the phones load: X plays, O misses, X plays again is read the same way as the source", async () => {
    const text = await Bun.file(new URL("../../apps/web/public/tttengine.js", import.meta.url)).text();
    const g: any = {}; new Function("globalThis", "window", text)(g, g); const eng = g.TTTENG ?? (globalThis as any).TTTENG; expect(eng?.gameFrom).toBeTruthy();
    const x = eng.gameFrom([], "x", "o").xIs, o = x === "x" ? "o" : "x";
    const h = eng.gameFrom([en(1, 0, x, "0"), en(2, 1, o, "-"), en(3, 2, x, "4")], "x", "o");
    expect(h.board[0]).toBe("X"); expect(h.board[4]).toBe("X"); expect(h.entries).toBe(3); expect(h.next).toBe(o);
  });
});
