// The permanent settings record of a game (gamerecord.ts) through the real lifecycle: written while the game is alive, kept after everything personal is deleted, with counts and no person.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { endBoundMs, lifecycleTick } from "../src/lifecycle";
import { lazyTickReset } from "../src/worker";
import { sentReports } from "../src/pay";
import { HOUR, MIN, T, W, create, join, mob, one, reset, restore, startIn, uid } from "./param-harness";

beforeEach(() => { reset(); lazyTickReset(); sentReports.length = 0; });
afterEach(restore);
const tick = (now: number) => lifecycleTick(W.env as any, now);

describe("game settings record", () => {
  test("a played game: the record is made, survives the deletion of the players' data, holds counts and not one person", async () => {
    const id = uid("REC");
    expect((await create(undefined, id, { startRound: startIn(-2 * HOUR), callSeconds: 6, cap: 5000 })).status).toBe(200);
    await W.env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?)").bind(`contact/${id}`, JSON.stringify({ email: "boss@acme.com", phone: "9811122233" })).run();
    for (let i = 1; i <= 3; i++) expect((await join(id, i, {}, T - 3 * HOUR)).status).toBe(200);
    const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", id));
    await tick(end + 5 * MIN);
    const mid = one("SELECT * FROM game_record WHERE eid=?", id);
    expect(mid).toBeTruthy(); expect(JSON.parse(mid.settings)).toMatchObject({ gameId: id, callSeconds: 6, cap: 5000 });
    await tick(end + 22 * HOUR); // the players' data is deleted at 20 hours
    expect(one("SELECT COUNT(*) c FROM participant WHERE eid=?", id).c).toBe(0);
    const after = one("SELECT * FROM game_record WHERE eid=?", id);
    expect(after).toBeTruthy();
    expect(JSON.parse(after.outcome).joined).toBe(3); // the count is kept, not the people
    const all = after.settings + (after.outcome ?? "");
    for (let i = 1; i <= 3; i++) expect(all.includes(String(mob(i)))).toBe(false);
    expect(all.includes("9811122233")).toBe(false); expect(all.includes("boss@acme.com")).toBe(false);
  });
});
