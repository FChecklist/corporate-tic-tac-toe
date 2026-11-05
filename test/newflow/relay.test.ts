// R*: the server relay routes of the new flow (flag ON) and the old routes (flag OFF). The server only stores and relays.
import { beforeEach, describe, expect, test } from "bun:test";
import { eraseEverything } from "../../apps/edge/src/lifecycle";
import { T, callIn, dev, j, join, makeGame, newWorld, startStages, write, type Call, type P, type World } from "./kit";

let w: World, call: Call;
beforeEach(() => { w = newWorld(); call = callIn(w); });
const slotOf = (a: P, b: P, st = 1, sl = 1) => `${st}-${sl}-${a.pid}-${b.pid}`;
const sql = (q: string, ...a: unknown[]) => w.raw.query(q).all(...(a as any[])) as any[];
const read = async (id: string, q = "", now = T) => j(await call("GET", `/api/z/${id}/ttt/stagelog${q}`, undefined, {}, now));

describe("F flag OFF: the live game is unchanged", () => {
  test("F1: the new routes do not exist for a game without the flag: log read 404, log write 404, start-stage 409", async () => {
    const h = await makeGame(w, call, "OFF-1"); const ps = await join(call, "OFF-1", 4);
    const rd = await call("GET", "/api/z/OFF-1/ttt/stagelog"); expect(rd.status).toBe(404);
    const wr = await write(call, "OFF-1", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }); expect(wr.status).toBe(404);
    const go = await call("POST", "/api/z/OFF-1/ttt/stagego", {}, h); expect(go.status).toBe(409); expect((await j(go)).code).toBe("no-stages");
    expect(sql("SELECT COUNT(*) c FROM ttt_sl")[0].c).toBe(0);
  });
  test("F2: the setup answer of an old game has exactly the old fields: opts is format, teamSize, moveMs, readyMs and nothing about stages", async () => {
    const h = await makeGame(w, call, "OFF-2"); await join(call, "OFF-2", 4);
    expect((await call("POST", "/api/z/OFF-2/ttt/start", { moveSecs: 20 }, h)).status).toBe(200);
    const s = await j(await call("GET", "/api/z/OFF-2/ttt/setup", undefined, h));
    expect(Object.keys(s.opts).sort()).toEqual(["format", "moveMs", "readyMs", "teamSize"]);
    expect(JSON.stringify(s)).not.toContain("stages");
  });
  test("F3: the old start route answers with the old keys and the old flow still starts (state 'starting', then the draw)", async () => {
    const h = await makeGame(w, call, "OFF-3"); await join(call, "OFF-3", 4);
    const r = await j(await call("POST", "/api/z/OFF-3/ttt/start", {}, h)); expect(r.ok).toBe(true); expect(r.state).toBe("starting"); expect(JSON.stringify(r)).not.toContain("stages");
    expect(JSON.stringify(await j(await call("GET", "/api/z/OFF-3/ttt/view"))).includes("stage")).toBe(false);
  });
  test("F4: an old game's players, join and view carry no trace of the flag in the database", async () => {
    const h = await makeGame(w, call, "OFF-4"); await join(call, "OFF-4", 3); await call("POST", "/api/z/OFF-4/ttt/start", {}, h);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE eid='OFF-4'")[0].c).toBe(0); expect(JSON.parse(sql("SELECT opts FROM ttt_t WHERE eid='OFF-4'")[0].opts ?? "{}").stages).toBeUndefined();
  });
  test("F5: the flag can only be set before the start, by the Organizer or a Host; after the old start it is refused and the old game stays old", async () => {
    const h = await makeGame(w, call, "OFF-5"); await join(call, "OFF-5", 4);
    expect((await call("POST", "/api/z/OFF-5/ttt/stageon", {})).status).toBe(403);
    await call("POST", "/api/z/OFF-5/ttt/start", {}, h);
    expect((await call("POST", "/api/z/OFF-5/ttt/stageon", {}, h)).status).toBe(409);
    expect((await call("GET", "/api/z/OFF-5/ttt/stagelog")).status).toBe(404);
  });
  test("F6: the player page loads the new flow only when asked for it (?flow=new or ct-flow=new on that device)", async () => {
    const js = await Bun.file(new URL("../../apps/web/public/ttt.js", import.meta.url)).text();
    expect(js).toMatch(/engineOn\s*=[^;]*flow/); expect(js).toMatch(/if \(engineOn\)/);
  });
});

describe("R1 keys", () => {
  test("R1: switching the flag on and starting needs the Organizer's or a Host's key", async () => {
    const h = await makeGame(w, call, "KEY-1"); await join(call, "KEY-1", 4);
    expect((await call("POST", "/api/z/KEY-1/ttt/stageon", {})).status).toBe(403);
    expect((await call("POST", "/api/z/KEY-1/ttt/stageon", {}, { "x-organizer": "wrong-key" })).status).toBe(403);
    expect((await call("POST", "/api/z/KEY-1/ttt/stageon", {}, h)).status).toBe(200);
    expect((await call("POST", "/api/z/KEY-1/ttt/stagego", {})).status).toBe(403);
    expect((await call("POST", "/api/z/KEY-1/ttt/stagego", {}, h)).status).toBe(200);
  });
  test("R1b: the key of another game's Organizer is refused (wrong game's key)", async () => {
    const hA = await makeGame(w, call, "KEY-A"), hB = await makeGame(w, call, "KEY-B"); await join(call, "KEY-A", 4); await join(call, "KEY-B", 4);
    expect((await call("POST", "/api/z/KEY-A/ttt/stageon", {}, hB)).status).toBe(403);
    expect((await call("POST", "/api/z/KEY-B/ttt/stageon", {}, hA)).status).toBe(403);
    expect((await call("POST", "/api/z/KEY-A/ttt/stageon", {}, hA)).status).toBe(200);
    expect((await call("POST", "/api/z/KEY-A/ttt/stagego", {}, hB)).status).toBe(403);
    expect((await call("POST", "/api/z/KEY-B/ttt/stageon", {}, hB)).status).toBe(200);
    expect(sql("SELECT state FROM ttt_t WHERE eid='KEY-A'")[0]!.state).not.toBe("running");
  });
  test("R1c: writing to the log needs a player of THIS game on their own phone: no pid, no device, a stranger's device, and a player of another game are all refused", async () => {
    const hA = await makeGame(w, call, "KEY-C"), hB = await makeGame(w, call, "KEY-D"); const pa = await join(call, "KEY-C", 4), pb = await join(call, "KEY-D", 4, 101);
    await startStages(call, "KEY-C", hA); await startStages(call, "KEY-D", hB);
    const e = { slot: slotOf(pa[0]!, pa[1]!), kind: "move", seq: 0, body: "4" };
    expect((await call("POST", "/api/z/KEY-C/ttt/stagelog", { ...e }, {}, T + 1000)).status).toBe(400);
    expect((await call("POST", "/api/z/KEY-C/ttt/stagelog", { pid: pa[0]!.pid, ...e }, {}, T + 1000)).status).toBe(400);
    expect((await call("POST", "/api/z/KEY-C/ttt/stagelog", { pid: pa[0]!.pid, device: dev(900), ...e }, {}, T + 1000)).status).toBe(403);
    expect((await write(call, "KEY-C", pb[0]!, e, T + 1000)).status).toBe(403); // a player of game D writing into game C
    expect((await call("POST", "/api/z/KEY-C/ttt/stagelog", { pid: pa[0]!.pid, device: pb[0]!.device, ...e }, {}, T + 1000)).status).toBe(403);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE eid='KEY-C' AND kind<>'flag'")[0].c).toBe(0);
    expect((await write(call, "KEY-C", pa[0]!, e, T + 1000)).status).toBe(200);
  });
  test("R1d: a player removed by the organizer can no longer write", async () => {
    const h = await makeGame(w, call, "KEY-E"); const ps = await join(call, "KEY-E", 4); await startStages(call, "KEY-E", h);
    w.raw.run("UPDATE seat SET blocked=1 WHERE eid='KEY-E' AND pid=?", [ps[0]!.pid]);
    expect((await write(call, "KEY-E", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }, T + 1000)).status).toBe(403);
  });
});

describe("R2 the log is immutable, small and rate limited", () => {
  const setup = async (id = "LOG-1", n = 4) => { const h = await makeGame(w, call, id); const ps = await join(call, id, n); expect((await startStages(call, id, h)).status).toBe(200); return { h, ps }; };
  test("R2: an entry is never replaced: the same entry written again with other text is not stored and the first text stays", async () => {
    const { ps } = await setup(); const e = { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0 };
    const a = await j(await write(call, "LOG-1", ps[0]!, { ...e, body: "4" }, T + 1000)); expect(a.stored).toBe(true);
    const b = await j(await write(call, "LOG-1", ps[0]!, { ...e, body: "0" }, T + 2000)); expect(b.stored).toBe(false);
    const es = (await read("LOG-1", `?slot=${e.slot}`)).entries; expect(es.length).toBe(1); expect(es[0].body).toBe("4"); expect(es[0].at_ms).toBe(T + 1000);
  });
  test("R2b: there is no route to change or delete an entry: PUT, PATCH and DELETE are refused", async () => {
    const { ps } = await setup(); await write(call, "LOG-1", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }, T + 1000);
    for (const m of ["PUT", "PATCH", "DELETE"]) { const r = await call(m, "/api/z/LOG-1/ttt/stagelog", { pid: ps[0]!.pid, device: ps[0]!.device, slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "0" }, {}, T + 2000); expect(r.status).toBeGreaterThanOrEqual(400); }
    expect(sql("SELECT body FROM ttt_sl WHERE kind='move'")[0].body).toBe("4");
  });
  test("R2c: the entry is stamped with the SERVER's clock, never the phone's", async () => {
    const { ps } = await setup(); await call("POST", "/api/z/LOG-1/ttt/stagelog", { pid: ps[0]!.pid, device: ps[0]!.device, slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4", at_ms: 5, client_ms: 7 }, {}, T + 4321);
    expect(sql("SELECT at_ms FROM ttt_sl WHERE kind='move'")[0].at_ms).toBe(T + 4321);
  });
  test("R3: an entry is at most 200 bytes: 200 is stored, 201 is refused", async () => {
    const { ps } = await setup(); const s = slotOf(ps[0]!, ps[1]!);
    expect((await write(call, "LOG-1", ps[0]!, { slot: s, kind: "result", seq: 0, body: "x".repeat(200) }, T + 1000)).status).toBe(200);
    expect((await write(call, "LOG-1", ps[0]!, { slot: s, kind: "result", seq: 1, body: "x".repeat(201) }, T + 2000)).status).toBe(400);
  });
  test("R3b: only 'move' and 'result' entries, a seq from 0 to 40, and a well-formed slot key are stored", async () => {
    const { ps } = await setup(); const s = slotOf(ps[0]!, ps[1]!);
    for (const bad of [{ kind: "flag" }, { kind: "other" }, { seq: -1 }, { seq: 41 }, { seq: 1.5 }, { slot: "x" }, { slot: "1-1-a-b" }, { slot: "../../etc" } ])
      expect((await write(call, "LOG-1", ps[0]!, { slot: s, kind: "move", seq: 0, body: "4", ...bad } as any, T + 3000)).status).toBe(400);
    expect((await write(call, "LOG-1", ps[0]!, { slot: s, kind: "move", seq: 40, body: "4" }, T + 3000)).status).toBe(200);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE kind='flag'")[0].c).toBe(1); // nobody wrote a second flag row
  });
  test("R4: at most 5 writes per player per second: the 6th in the same second is refused (429), the next second is free", async () => {
    const { ps } = await setup(); const s = slotOf(ps[0]!, ps[1]!), codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await write(call, "LOG-1", ps[0]!, { slot: s, kind: "move", seq: i, body: "-" }, T + 5000 + i * 10)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect((await write(call, "LOG-1", ps[0]!, { slot: s, kind: "move", seq: 7, body: "-" }, T + 6500)).status).toBe(200);
    expect((await write(call, "LOG-1", ps[1]!, { slot: s, kind: "move", seq: 0, body: "-" }, T + 5100)).status).toBe(200); // another player has their own allowance
  });
  test("R5: at most 250,000 entries in one game: the next one is refused with 409 'full'", async () => {
    const { ps } = await setup();
    w.raw.run("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<249998) INSERT INTO ttt_sl(eid,slot,kind,pid,seq,body,at_ms) SELECT 'LOG-1','9-9-filler-filler','move','filler',x,'-',1 FROM c");
    const have = sql("SELECT COUNT(*) c FROM ttt_sl WHERE eid='LOG-1'")[0].c; expect(have).toBe(249_999);
    expect((await write(call, "LOG-1", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }, T + 9000)).status).toBe(200);
    const full = await write(call, "LOG-1", ps[1]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 1, body: "4" }, T + 9000); expect(full.status).toBe(409); expect((await j(full)).code).toBe("full");
  });
  test("R6: the log takes writes only while the game runs (not before the start)", async () => {
    const h = await makeGame(w, call, "LOG-2"); const ps = await join(call, "LOG-2", 4); await call("POST", "/api/z/LOG-2/ttt/stageon", {}, h);
    const r = await write(call, "LOG-2", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }, T + 1000); expect(r.status).toBe(409); expect((await j(r)).code).toBe("not-running");
  });
});

describe("R7 public read", () => {
  test("R7: anybody can read the log with no key and no device; results by default, one slot's moves with ?slot=", async () => {
    const h = await makeGame(w, call, "PR-1"); const ps = await join(call, "PR-1", 4); await startStages(call, "PR-1", h);
    const s = slotOf(ps[0]!, ps[1]!);
    await write(call, "PR-1", ps[0]!, { slot: s, kind: "move", seq: 0, body: "4" }, T + 1000); await write(call, "PR-1", ps[0]!, { slot: s, kind: "result", seq: 0, body: "a" }, T + 1100); await write(call, "PR-1", ps[1]!, { slot: s, kind: "result", seq: 0, body: "a" }, T + 1200);
    const all = await read("PR-1"); expect(all.entries.map((e: any) => e.kind)).toEqual(["result", "result"]);
    const one = await read("PR-1", `?slot=${s}`); expect(one.entries.map((e: any) => e.kind).sort()).toEqual(["move", "result", "result"]);
    const r = await call("GET", "/api/z/PR-1/ttt/stagelog"); expect(r.headers.get("cache-control")).toMatch(/public/); expect(typeof all.serverNow).toBe("number");
  });
  test("R7b: the read never shows the internal flag row, and shows no names, emails or devices", async () => {
    const h = await makeGame(w, call, "PR-2"); const ps = await join(call, "PR-2", 4); await startStages(call, "PR-2", h);
    await write(call, "PR-2", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "result", seq: 0, body: "a" }, T + 1000);
    const txt = JSON.stringify([await read("PR-2"), await read("PR-2", `?slot=${slotOf(ps[0]!, ps[1]!)}`)]);
    expect(txt).not.toContain('"flag"'); expect(txt).not.toContain("Player 1"); expect(txt).not.toContain("acme.com"); expect(txt).not.toContain(ps[0]!.device);
  });
  test("R7c: 'after' pages through the log by id; a bad slot is a 400; reading one game never shows another game's entries", async () => {
    const h1 = await makeGame(w, call, "PR-3"), h2 = await makeGame(w, call, "PR-4"); const p1 = await join(call, "PR-3", 4), p2 = await join(call, "PR-4", 4); await startStages(call, "PR-3", h1); await startStages(call, "PR-4", h2);
    for (let i = 0; i < 3; i++) await write(call, "PR-3", p1[i]!, { slot: slotOf(p1[0]!, p1[1]!), kind: "result", seq: 0, body: "draw" }, T + 1000 + i * 10);
    await write(call, "PR-4", p2[0]!, { slot: slotOf(p2[0]!, p2[1]!), kind: "result", seq: 0, body: "draw" }, T + 1000);
    const a = await read("PR-3"); expect(a.entries.length).toBe(3); const last = a.entries[1].id;
    expect((await read("PR-3", `?after=${last}`)).entries.length).toBe(1);
    expect((await read("PR-4")).entries.length).toBe(1);
    expect((await call("GET", "/api/z/PR-3/ttt/stagelog?slot=bad")).status).toBe(400);
  });
  test("R7d: the results read is paged at 1000 entries and a phone that follows 'after' gets all of them", async () => {
    const h = await makeGame(w, call, "PR-5"); await join(call, "PR-5", 4); await startStages(call, "PR-5", h);
    w.raw.run("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<2500) INSERT INTO ttt_sl(eid,slot,kind,pid,seq,body,at_ms) SELECT 'PR-5','1-1-aaaa-bbbb','result','pp'||x,0,'a',1 FROM c");
    let after = 0, got = 0; for (let i = 0; i < 10; i++) { const p = await read("PR-5", `?after=${after}`); got += p.entries.length; if (p.entries.length < 1000) break; after = p.entries[p.entries.length - 1].id; }
    expect(got).toBe(2500);
  });
});

describe("R8 start, cap 2000, pause, erase", () => {
  test("R8: the start needs at least 2 players; the published start is kept only if it is now or up to an hour ahead", async () => {
    const h = await makeGame(w, call, "ST-1"); await join(call, "ST-1", 1); await call("POST", "/api/z/ST-1/ttt/stageon", {}, h);
    expect((await call("POST", "/api/z/ST-1/ttt/stagego", {}, h)).status).toBe(409);
    await join(call, "ST-1", 1, 2);
    const ok = await j(await call("POST", "/api/z/ST-1/ttt/stagego", { startMs: T + 3_600_000 }, h)); expect(ok.startedMs).toBe(T + 3_600_000);
    const h2 = await makeGame(w, call, "ST-2"); await join(call, "ST-2", 3); const bad = await j(await startStages(call, "ST-2", h2, { startMs: T + 3_600_001 })); expect(bad.startedMs).toBe(T);
    const h3 = await makeGame(w, call, "ST-3"); await join(call, "ST-3", 3); expect((await j(await startStages(call, "ST-3", h3, { startMs: T - 1 }))).startedMs).toBe(T);
  });
  test("R8b: the start cannot happen twice, and the roster is fixed at the start (a late phone is refused)", async () => {
    const h = await makeGame(w, call, "ST-4"); await join(call, "ST-4", 4); await startStages(call, "ST-4", h);
    expect((await call("POST", "/api/z/ST-4/ttt/stagego", {}, h)).status).toBe(409);
    expect((await call("POST", "/api/z/ST-4/join", { name: "Late", device: dev(99) })).status).toBe(409);
  });
  test("R9: cap 2000: the server refuses to join a 2001st player to a game", async () => {
    const h = await makeGame(w, call, "CAP-1", { cap: 2000 }); await call("POST", "/api/z/CAP-1/ttt/stageon", {}, h);
    w.raw.run("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<2000) INSERT INTO participant(eid,pid,phone_hash,joined_ms) SELECT 'CAP-1','fill'||x,'h'||x,1 FROM c");
    const r = await call("POST", "/api/z/CAP-1/join", { name: "Number 2001", device: dev(2001) }); expect(r.status).toBeGreaterThanOrEqual(400);
    expect(sql("SELECT COUNT(*) c FROM participant WHERE eid='CAP-1'")[0].c).toBe(2000);
  });
  test("R9b: cap 2000: a game of 2001 cannot be started with the new flow, 2000 can", async () => {
    const mk = async (id: string, n: number) => { const h = await makeGame(w, call, id, { cap: 2000 }); await call("POST", "/api/z/" + id + "/ttt/stageon", {}, h); await join(call, id, 2);
      w.raw.run(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<${n - 2}) INSERT INTO participant(eid,pid,phone_hash,joined_ms) SELECT '${id}','fill'||x,'h'||x,1 FROM c`); return h; };
    const h1 = await mk("CAP-2", 2001); const r1 = await call("POST", "/api/z/CAP-2/ttt/stagego", {}, h1); expect(r1.status).toBe(409); expect((await j(r1)).code).toBe("too-many");
    const h2 = await mk("CAP-3", 2000); const r2 = await call("POST", "/api/z/CAP-3/ttt/stagego", {}, h2); expect(r2.status).toBe(200); expect((await j(r2)).players).toBe(2000);
  });
  test("R10: pause and resume are stored with the server's stamps and handed to every phone with the setup, so every phone shifts its clock by the same time", async () => {
    const h = await makeGame(w, call, "PZ-1"); await join(call, "PZ-1", 4); await startStages(call, "PZ-1", h);
    expect((await call("POST", "/api/z/PZ-1/ttt/pause", {}, {}, T + 130_000)).status).toBe(403);
    expect((await call("POST", "/api/z/PZ-1/ttt/pause", {}, h, T + 130_000)).status).toBe(200);
    expect((await j(await call("GET", "/api/z/PZ-1/ttt/setup", undefined, {}, T + 150_000))).pauses).toEqual([[T + 130_000, null]]);
    expect((await call("POST", "/api/z/PZ-1/ttt/resume", {}, h, T + 190_000)).status).toBe(200);
    expect((await j(await call("GET", "/api/z/PZ-1/ttt/setup", undefined, {}, T + 200_000))).pauses).toEqual([[T + 130_000, T + 190_000]]);
  });
  test("R10b: while the game is paused nothing is written into the log (the clocks stand still, so no move or miss can happen)", async () => {
    const h = await makeGame(w, call, "PZ-2"); const ps = await join(call, "PZ-2", 4); await startStages(call, "PZ-2", h);
    await call("POST", "/api/z/PZ-2/ttt/pause", {}, h, T + 130_000);
    const r = await write(call, "PZ-2", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "-" }, T + 140_000); expect(r.status).toBe(409); expect((await j(r)).code).toBe("paused");
  });
  test("R11: the log is erased with the other participant data (day 365 at the latest) and nothing of it is left", async () => {
    const h = await makeGame(w, call, "ER-1"); const ps = await join(call, "ER-1", 4); await startStages(call, "ER-1", h);
    await write(call, "ER-1", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }, T + 1000);
    await eraseEverything(w.env, "ER-1", T + 366 * 86_400_000);
    expect(sql("SELECT COUNT(*) c FROM ttt_sl WHERE eid='ER-1'")[0].c).toBe(0);
  });
  test("R12: the log holds only opaque ids, squares and stamps: no names are stored in it", async () => {
    const h = await makeGame(w, call, "NM-1"); const ps = await join(call, "NM-1", 4); await startStages(call, "NM-1", h);
    await write(call, "NM-1", ps[0]!, { slot: slotOf(ps[0]!, ps[1]!), kind: "move", seq: 0, body: "4" }, T + 1000);
    expect(JSON.stringify(sql("SELECT * FROM ttt_sl WHERE eid='NM-1'"))).not.toContain("Player ");
  });
});
