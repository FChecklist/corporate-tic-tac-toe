// TEST AUTHOR 30 Oct 2026. Regression of the earlier features through the real Worker (in-memory database): join, check-in, results, pause, game log, 24-hour erase (with its exact boundary), consent version safe.
import { afterEach, describe, expect, test } from "bun:test";
import { handle as realHandle, type Env } from "../src/worker";
import { handle, consentFor } from "./with-terms";
import { world, T_NEW, roundAt, dev, j, mob } from "./t30-kit";
import { TttConsole } from "../../../packages/ttt/src/phone";
import { apiFor, playCrowd } from "../../../tools/sim2/phones";
import { CHECKIN_OPENS_BEFORE_MS, checkinOpensMs, perm10k, seatOfPidText, ticketId, codeFor } from "../src/checkin";
import { PURGE_AFTER_MS, REPORT_LINK_MS, PURGE_HOURS } from "../src/lifetimes";
import { fullDeleteAt, personalDeleteAt, eraseEverything } from "../src/lifecycle";
import { readGameRecords, keepGameRecord } from "../src/gamerecord";
import { CONSENT_VERSION, hasConsent, hasConsented, recordConsent } from "../src/consent";

let W: ReturnType<typeof world>; afterEach(() => W?.restore());
const T = T_NEW;
const sql = (q: string, ...a: unknown[]) => W.raw.query(q).all(...(a as any[])) as any[];
const callH = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = W.now) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), W.env as unknown as Env, now);
async function game(id: string, n = 1) { const g = await W.game(id, { n }); W.raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]); return { id, h: { "x-organizer": g.key }, key: g.key }; }
async function joinAll(id: string, count: number, from = 1) { const out: { pid: string; device: string; name: string }[] = []; for (let i = from; i < from + count; i++) { const r = await W.join(id, { name: `Player ${i}`, device: dev(i) }); expect(r.status).toBe(200); out.push({ pid: (await j(r)).pid, device: dev(i), name: `Player ${i}` }); } return out; }

describe("join", () => {
  test("a mobile typed as +91 98765 43210, 098765 43210, 9876543210 and 98765-43210 is one person with one place", async () => {
    W = world(T); await W.game("RG-1", { who: undefined }); W.raw.run("UPDATE engagement SET config=json_set(coalesce(config,'{}'),'$.join','phone') WHERE id='RG-1'");
    const pids = new Set<string>(); let n = 0;
    for (const p of ["+91 98765 43210", "098765 43210", "9876543210", "98765-43210"]) { const r = await W.join("RG-1", { name: "Asha Demo", phone: p, device: dev(1) }); expect([p, r.status]).toEqual([p, 200]); pids.add((await j(r)).pid); n++; }
    expect(pids.size).toBe(1); expect(sql("SELECT COUNT(*) c FROM participant")[0].c).toBe(1);
  });
  test("without the two ticks the join is refused 400 consent-required (the real handle, no helper), and nothing is stored", async () => {
    W = world(T); await W.game("RG-2");
    const r = await realHandle(new Request("http://x/api/z/RG-2/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Asha Demo", device: dev(2) }) }), W.env as unknown as Env, T);
    expect(r.status).toBe(400); const b = await j(r); expect([b.code, b.kind, b.version]).toEqual(["consent-required", "K4", CONSENT_VERSION]); expect(sql("SELECT COUNT(*) c FROM participant")[0].c).toBe(0);
  });
  test("a draft (not published) game cannot be joined: 403 'not open yet'", async () => {
    W = world(T); const key = await W.organizer(2); await W.call("POST", "/api/z", { id: "RG-3", startRound: roundAt(T) + 1200, callSeconds: 6, cap: 100 }, key);
    const r = await W.join("RG-3", { name: "Asha Demo", device: dev(3) }); expect(r.status).toBe(403); expect((await j(r)).error).toContain("not open yet");
  });
  test("the same person on the same device twice is one participant; the second answer says again:true", async () => {
    W = world(T); await W.game("RG-4"); const a = await j(await W.join("RG-4", { name: "Asha Demo", device: dev(4) })); const b = await j(await W.join("RG-4", { name: "Asha Demo", device: dev(4) }));
    expect([a.again, b.again, b.pid]).toEqual([undefined, true, a.pid]);
  });
  test("one phone, one place: a second name typed on the same phone is the same place (same pid), never a second card", async () => {
    W = world(T); await W.game("RG-5"); const a = await j(await W.join("RG-5", { name: "Asha Demo", device: dev(5) })); const b = await W.join("RG-5", { name: "Ravi Demo", device: dev(5) });
    expect(b.status).toBe(200); expect((await j(b)).pid).toBe(a.pid); expect(sql("SELECT COUNT(*) c FROM participant")[0].c).toBe(1);
  });
});

describe("check-in", () => {
  test("opens exactly 5 minutes before the start; a ticket id is GAME-T0007 style; the seat is read from the player id", () => {
    expect(CHECKIN_OPENS_BEFORE_MS).toBe(300_000); expect(checkinOpensMs(1_000_000)).toBe(700_000); expect(ticketId("RG-6", 7)).toBe("RG-6-T0007"); expect(ticketId("RG-6", 12345)).toBe("RG-6-T12345");
    expect(seatOfPidText("12x0abc")).toBe(12); expect(seatOfPidText("x12")).toBeNull(); expect(seatOfPidText("")).toBeNull();
  });
  test("perm10k is a true permutation of 0..9999 for a key (all 10,000 codes different) and a different key gives a different order", () => {
    const k1 = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", k2 = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
    const seen = new Set<number>(); for (let x = 0; x < 10000; x++) { const v = perm10k(k1, x); expect(v >= 0 && v < 10000).toBe(true); seen.add(v); }
    expect(seen.size).toBe(10000); let same = 0; for (let x = 0; x < 200; x++) if (perm10k(k1, x) === perm10k(k2, x)) same++; expect(same).toBeLessThan(20);
  });
  test("the check-in code is 4 digits, the same twice for a seat, different for different seats, and different in another game", async () => {
    W = world(T); const a = await codeFor(W.env as any, "RG-7", 1), b = await codeFor(W.env as any, "RG-7", 2), c = await codeFor(W.env as any, "RG-8", 1);
    expect(a).toMatch(/^\d{4}$/); expect(await codeFor(W.env as any, "RG-7", 1)).toBe(a); expect(b).not.toBe(a); expect([a, b].includes(c) && c === a).toBe(false);
  });
});

describe("results and pause (the whole tournament through the Worker, played by simulated phones)", () => {
  const done = (id: string) => () => (W.raw.query("SELECT state FROM ttt_t WHERE eid=?").get(id) as any)?.state === "done";
  let seedRng = 7; const rnd = () => (seedRng = (Math.imul(seedRng, 1664525) + 1013904223) >>> 0) / 0x100000000;
  test("6 phones finish; ranks are 1..6 with the champion first; five places are written to the winners record; the end time is stored; no board is flagged", async () => {
    W = world(T); const g = await game("RG-9"); const ps = await joinAll("RG-9", 6);
    expect((await callH("POST", "/api/z/RG-9/ttt/start", { moveSecs: 10 }, g.h)).status).toBe(200);
    const clock = { t: T }; const con = new TttConsole(apiFor(callH as any, clock, g.h), "RG-9"); expect((await con.tick()).sentPlan).toBe(true);
    const r = await playCrowd({ call: callH as any, eid: "RG-9", phones: ps, orgHeaders: g.h, clock, rng: rnd, isDone: done("RG-9") });
    const v = await j(await callH("GET", "/api/z/RG-9/ttt/view", undefined, {}, clock.t)); expect([v.state, v.players, v.moveSecs]).toEqual(["done", 6, 10]);
    const rank = await j(await callH("GET", "/api/z/RG-9/ttt/rank?n=10", undefined, {}, clock.t)); expect(rank.ranking.map((x: any) => x.rank)).toEqual([1, 2, 3, 4, 5, 6]); expect(rank.ranking[0].name).toBe(v.champion);
    expect(sql("SELECT pattern FROM settled WHERE eid='RG-9' ORDER BY pattern").map((x) => x.pattern)).toEqual(["fifth", "first", "fourth", "second", "third"]); expect(sql("SELECT COUNT(*) c FROM winner WHERE eid='RG-9'")[0].c).toBe(5);
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='RG-9' AND flag=1")[0].c).toBe(0); expect(r.refused).toBe(0);
  }, 120_000);
  test("pause: a move during a pause is refused 409 paused; the pause is listed as [from, null], then [from, to] after resume; pausing twice is one pause; only the Organizer can pause", async () => {
    W = world(T); const g = await game("RG-10"); const ps = await joinAll("RG-10", 4);
    expect((await callH("POST", "/api/z/RG-10/ttt/start", {}, g.h)).status).toBe(200); const clock = { t: T }; await new TttConsole(apiFor(callH as any, clock, g.h), "RG-10").tick();
    expect((await callH("POST", "/api/z/RG-10/ttt/pause", {}, {}, T + 1000)).status).toBe(403); // a player cannot pause
    expect((await callH("POST", "/api/z/RG-10/ttt/pause", {}, g.h, T + 2000)).status).toBe(200); expect((await callH("POST", "/api/z/RG-10/ttt/pause", {}, g.h, T + 2500)).status).toBe(200);
    const s1 = await j(await callH("GET", "/api/z/RG-10/ttt/setup", undefined, {}, T + 3000)); expect(s1.pauses).toEqual([[T + 2000, null]]);
    const mid = (sql("SELECT mid FROM ttt_m WHERE eid='RG-10' LIMIT 1")[0] as any).mid; const p0 = ps[0]!;
    const blocked = await callH("POST", "/api/z/RG-10/ttt/move", { pid: p0.pid, device: p0.device, mid, seq: 0, sq: 4 }, {}, T + 3000); expect(blocked.status).toBe(409); expect((await j(blocked)).code).toBe("paused");
    expect((await callH("POST", "/api/z/RG-10/ttt/resume", {}, g.h, T + 62_000)).status).toBe(200);
    const s2 = await j(await callH("GET", "/api/z/RG-10/ttt/setup", undefined, {}, T + 63_000)); expect(s2.pauses).toEqual([[T + 2000, T + 62_000]]);
  }, 60_000);
  test("a move clock other than 10, 20, 30 or 60 seconds is refused 400 with plain words; so is a team of 4", async () => {
    W = world(T); const g = await game("RG-11"); await joinAll("RG-11", 8);
    for (const moveSecs of [5, 15, 45, 90, 0, -10]) { const r = await callH("POST", "/api/z/RG-11/ttt/start", { moveSecs }, g.h); expect([moveSecs, r.status]).toEqual([moveSecs, 400]); expect((await j(r)).error).toBe("A move clock is 10, 20, 30 or 60 seconds."); }
    const t4 = await callH("POST", "/api/z/RG-11/ttt/start", { format: "team", teamSize: 4 }, g.h); expect(t4.status).toBe(400); expect((await j(t4)).error).toBe("A team has 3 or 5 players.");
  });
});

describe("24-hour erase (the promise says 24 h, the build erases at 20 h) and the game log", () => {
  test("the clocks: personal data goes 20 h after the end, the report link stops after 19 h, so the link always ends before the data", () => {
    expect(PURGE_AFTER_MS).toBe(20 * 3_600_000); expect(PURGE_HOURS).toBe(20); expect(REPORT_LINK_MS).toBe(19 * 3_600_000); expect(REPORT_LINK_MS).toBeLessThan(PURGE_AFTER_MS); expect(PURGE_AFTER_MS).toBeLessThanOrEqual(24 * 3_600_000);
    expect(personalDeleteAt(1_000_000)).toBe(1_000_000 + PURGE_AFTER_MS);
  });
  test("the game log is kept 365 days and then removed at the end of that Indian day: fullDeleteAt is the next IST midnight after end + 365 days", () => {
    const end = Date.UTC(2026, 10, 5, 12, 0, 0), d = fullDeleteAt(end); const IST = 330 * 60_000;
    expect(d).toBeGreaterThan(end + 365 * 86_400_000); expect(d - (end + 365 * 86_400_000)).toBeLessThanOrEqual(86_400_000); expect((d + IST) % 86_400_000).toBe(0);
  });
  test("19 h 59 min after the end the players are still there; at 20 h they are gone, the game log row stays with counts only and no names", async () => {
    W = world(T); const g = await game("RG-12"); const ps = await joinAll("RG-12", 4);
    expect((await callH("POST", "/api/z/RG-12/ttt/start", { moveSecs: 10 }, g.h)).status).toBe(200); const clock = { t: T }; await new TttConsole(apiFor(callH as any, clock, g.h), "RG-12").tick();
    let seed = 3; await playCrowd({ call: callH as any, eid: "RG-12", phones: ps, orgHeaders: g.h, clock, rng: () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000, isDone: () => (W.raw.query("SELECT state FROM ttt_t WHERE eid='RG-12'").get() as any).state === "done" });
    const endMs = (sql("SELECT end_ms FROM life WHERE eid='RG-12'")[0] as any).end_ms as number; expect(endMs).toBeGreaterThan(T);
    const tick = (at: number) => callH("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, at);
    await tick(endMs + PURGE_AFTER_MS - 60_000); expect(sql("SELECT COUNT(*) c FROM participant WHERE eid='RG-12'")[0].c).toBe(4); expect(sql("SELECT COUNT(*) c FROM ttt_p WHERE eid='RG-12'")[0].c).toBe(4);
    await tick(endMs + PURGE_AFTER_MS + 60_000); expect(sql("SELECT COUNT(*) c FROM participant WHERE eid='RG-12'")[0].c).toBe(0); expect(sql("SELECT COUNT(*) c FROM ttt_p WHERE eid='RG-12'")[0].c).toBe(0);
    const log = (await readGameRecords(W.env.DB as any, "RG-12")) as any[]; expect(log.length).toBe(1);
    expect(log[0].gameId).toBe("RG-12"); expect(log[0].outcome.joined).toBe(4); expect(log[0].outcome.winnerPositions).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toMatch(/Player \d/); expect(sql("SELECT COUNT(*) c FROM winner WHERE eid='RG-12'")[0].c).toBeGreaterThan(0);
    await eraseEverything(W.env as any, "RG-12", endMs + 366 * 86_400_000); expect(sql("SELECT COUNT(*) c FROM life WHERE eid='RG-12'")[0].c).toBe(0);
  }, 90_000);
  test("the game log row is written once per game and a later pass keeps the larger counts (it never overwrites the real count with zero)", async () => {
    W = world(T); await W.game("RG-13"); const e = sql("SELECT * FROM engagement WHERE id='RG-13'")[0];
    W.raw.run("INSERT INTO life(eid,end_ms,end_src) VALUES('RG-13',?,'phones')", [T + 1000]);
    for (let i = 1; i <= 3; i++) await W.join("RG-13", { name: `P ${i}`, device: dev(20 + i) });
    await keepGameRecord(W.env.DB as any, { ...e, npart: 3 }, T + 2000); W.raw.run("DELETE FROM participant WHERE eid='RG-13'");
    await keepGameRecord(W.env.DB as any, { ...e, npart: 0 }, T + 3000);
    const log = (await readGameRecords(W.env.DB as any, "RG-13")) as any[]; expect(sql("SELECT COUNT(*) c FROM game_record WHERE eid='RG-13'")[0].c).toBe(1); expect(log[0].outcome.joined).toBe(3);
  });
});

describe("consent version safe", () => {
  test("a join that carries an OLD consent version is refused with the current version in the answer (the page then says reload), and nothing is stored", async () => {
    W = world(T); await W.game("RG-14");
    const r = await realHandle(new Request("http://x/api/z/RG-14/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Asha Demo", device: dev(30), consent: { v: "2020-01-01", boxes: ["A", "B"] } }) }), W.env as unknown as Env, T);
    expect(r.status).toBe(400); const b = await j(r); expect(b.code).toBe("consent-required"); expect(b.version).toBe(CONSENT_VERSION); expect(sql("SELECT COUNT(*) c FROM participant")[0].c).toBe(0);
  });
  test("one box ticked is not enough; both under the current version is", async () => {
    W = world(T); await W.game("RG-15");
    const go = (boxes: string[], n: number) => realHandle(new Request("http://x/api/z/RG-15/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Asha Demo", device: dev(n), consent: { v: CONSENT_VERSION, boxes } }) }), W.env as unknown as Env, T);
    expect((await go(["A"], 31)).status).toBe(400); expect((await go([], 32)).status).toBe(400); expect((await go(consentFor("K4").boxes, 33)).status).toBe(200);
  });
  test("a person who accepted under an OLDER version: hasConsented (current) is false, hasConsent(anyVersion) is true; after accepting the current one both are true", async () => {
    W = world(T); await W.game("RG-16"); const db = W.env.DB as any;
    W.raw.run("INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES('old1','sub-1','K5',NULL,'2020-01-01','A,B','x',?)", [T]);
    expect(await hasConsented(db, "sub-1", "K5")).toBe(false); expect(await hasConsent(db, "sub-1", "K5", true)).toBe(true); expect(await hasConsent(db, "sub-2", "K5", true)).toBe(false);
    await recordConsent(db, { subject: "sub-1", kind: "K5", ref: null, now: T }); expect(await hasConsented(db, "sub-1", "K5")).toBe(true);
  });
  test("a person already in the game is never locked out by a new consent version: opening the game again after the version changed still returns their place", async () => {
    W = world(T); await W.game("RG-17"); const a = await j(await W.join("RG-17", { name: "Asha Demo", device: dev(40) }));
    const again = await realHandle(new Request("http://x/api/z/RG-17/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Asha Demo", device: dev(40), consent: { v: "2019-01-01", boxes: ["A", "B"] } }) }), W.env as unknown as Env, T);
    expect(again.status).toBe(400); const bb = await j(again); expect([bb.code, bb.version]).toEqual(["consent-required", CONSENT_VERSION]);
    expect(sql("SELECT COUNT(*) c FROM participant WHERE pid=?", a.pid)[0].c).toBe(1); // the person is still there
    const back = await W.join("RG-17", { name: "Asha Demo", device: dev(40) }); expect(back.status).toBe(200); expect((await j(back)).pid).toBe(a.pid); // after the reload the page sends the current version and the same place comes back
  });
});
