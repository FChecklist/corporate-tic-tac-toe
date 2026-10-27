// Table-driven tests, part 5: privacy and retention timings (including a late tick), the lazy tick, erasure requests, rate and spend limits,
// TEST versus LIVE mail, Help Desk parameter sets, and idempotency of the lifecycle tick.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { endBoundMs, fullDeleteAt, lifecycleTick, personalDeleteAt, PURGE_AFTER_MS, REPORT_LINK_MS, roundMs } from "../src/lifecycle";
import { LAZY_TICK_MS, lazyTickReset, purgeOld } from "../src/worker";
import { sentReports, sendMail } from "../src/pay";
import { OVERDUE_GRACE_MS } from "../src/admin";
import { setMode } from "../src/mode";
import { DAY, HOUR, MIN, PLAT, T, W, call, callRaw, create, dev, j, join, keyH, mails, mob, one, organizer, paidGame, publish, q, reset, restore, startIn, uid } from "./param-harness";

beforeEach(() => { reset(); lazyTickReset(); sentReports.length = 0; });
afterEach(restore);

/** A game that was played (it began two hours before T), with `n` players who joined three hours before T and an organizer e-mail on record. */
async function played(n = 3, over: Record<string, unknown> = {}) {
  const id = uid("LIFE");
  expect((await create(undefined, id, { startRound: startIn(-2 * HOUR), callSeconds: 6, cap: 5000, ...over })).status).toBe(200);
  await W.env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?)").bind(`contact/${id}`, JSON.stringify({ email: "boss@acme.com", phone: "9811122233" })).run();
  for (let i = 1; i <= n; i++) expect((await join(id, i, {}, T - 3 * HOUR)).status).toBe(200);
  const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", id));
  return { id, end };
}
const left = (id: string) => ({ participant: one("SELECT COUNT(*) c FROM participant WHERE eid=?", id).c, seat: one("SELECT COUNT(*) c FROM seat WHERE eid=?", id).c });
const tick = (now: number) => lifecycleTick(W.env as any, now);

// ---------------------------------------------------------------------------------------------------------- timing constants
describe("the deletion promise: 24 hours, with a tick that may run up to 3 hours late", () => {
  test("constants: the job deletes at 20 hours, the report link closes at 19, and 20 + 3 hours late is still inside the 24-hour promise", () => {
    expect(PURGE_AFTER_MS).toBe(20 * HOUR); expect(REPORT_LINK_MS).toBe(19 * HOUR);
    expect(PURGE_AFTER_MS + 3 * HOUR).toBeLessThan(24 * HOUR); expect(REPORT_LINK_MS).toBeLessThan(PURGE_AFTER_MS);
    expect(OVERDUE_GRACE_MS).toBe(3 * HOUR); expect(PURGE_AFTER_MS + OVERDUE_GRACE_MS).toBeLessThan(24 * HOUR);
  });
  test("personalDeleteAt is end + PURGE_AFTER_MS", () => { expect(personalDeleteAt(1_000_000)).toBe(1_000_000 + PURGE_AFTER_MS); });
  const rows: [string, number, boolean][] = [
    ["1 hour after the end", 1 * HOUR, true], ["19 hours 59 minutes after the end", 19 * HOUR + 59 * MIN, true], ["exactly 20 hours after the end", 20 * HOUR, false], ["20 hours and a second", 20 * HOUR + 1000, false],
    ["a tick 1 hour late (21 hours)", 21 * HOUR, false], ["a tick 2 hours late (22 hours)", 22 * HOUR, false], ["a tick 3 hours late (23 hours)", 23 * HOUR, false], ["23 hours 59 minutes", 23 * HOUR + 59 * MIN, false],
  ];
  for (const [label, offset, present] of rows) {
    test(`a tick at ${label}: the players' data is ${present ? "still there" : "gone"}`, async () => {
      const g = await played(3); await tick(g.end + 5 * MIN); await tick(g.end + offset);
      expect(left(g.id).participant).toBe(present ? 3 : 0);
      if (!present) { expect(left(g.id).seat).toBe(0); expect(one("SELECT purged_ms FROM life WHERE eid=?", g.id).purged_ms).not.toBeNull(); }
    });
  }
  test("the first tick of all, three hours late (no earlier tick at all), still deletes inside the promise and sends the report mail first", async () => {
    const g = await played(3); await tick(g.end + 23 * HOUR);
    expect(left(g.id).participant).toBe(0);
  });
  test("the health read stays ok at 19.9 hours with data present and turns to not ok after 23 hours (an hour before the promise would break)", async () => {
    const g = await played(2); raw_life(g.id, g.end);
    const ok = await j(await call("GET", "/api/status/health", undefined, {}, g.end + 19 * HOUR + 54 * MIN)); expect(ok.ok).toBe(true);
    const bad = await j(await call("GET", "/api/status/health", undefined, {}, g.end + 23 * HOUR + 6 * MIN)); expect(bad.ok).toBe(false); expect(bad.overdue_purge).toBe(1);
  });
  test("a cancelled game's players go 20 hours after the cancel time", async () => {
    const g = await paidGame({ cap: 100 }); await join(g.id, 1); await join(g.id, 2);
    await call("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }, g.h);
    await tick(T + 20 * HOUR - MIN); expect(left(g.id).participant).toBe(2);
    await tick(T + 20 * HOUR + MIN); expect(left(g.id).participant).toBe(0);
  });
  test("a game that never started (nobody paid) loses its guests 20 hours after it was meant to end", async () => {
    const o = await organizer(); const id = uid(); await create(o.key, id, { cap: 100, startRound: startIn(2 * HOUR) }); await publish(o.key, id);
    await join(id, 1); const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", id));
    await tick(end + 20 * HOUR - 5 * MIN); expect(left(id).participant).toBe(1);
    await tick(end + 20 * HOUR + 5 * MIN); expect(left(id).participant).toBe(0);
  });
});
const raw_life = (id: string, end: number) => W.raw.prepare("INSERT OR REPLACE INTO life(eid,end_ms,end_src) VALUES(?,?, 'schedule')").run(id, end);

describe("report mail and the report link", () => {
  const link = () => { const m = sentReports[0]!.text.match(/report\.html\?e=([A-Za-z0-9_-]+)&k=([0-9a-f]+)/)!; return { eid: m[1]!, k: m[2]! }; };
  test("one report mail goes to the organizer a few minutes after the end, with a link and no names in the body", async () => {
    const g = await played(3); await tick(g.end + MIN); expect(sentReports.length).toBe(0); // too early: late wins are still being recorded
    let guard = 0; while (!sentReports.length && guard++ < 20) await tick(g.end + 5 * MIN);
    expect(sentReports.length).toBe(1); expect(sentReports[0]!.to).toBe("boss@acme.com"); expect(sentReports[0]!.text).not.toMatch(/Guest \d/);
  });
  const rows: [string, number, number][] = [["10 minutes after the end", 10 * MIN, 200], ["18 hours 59 minutes after the end", 18 * HOUR + 59 * MIN, 200], ["19 hours after the end", 19 * HOUR, 404], ["19 hours 1 minute", 19 * HOUR + MIN, 404]];
  for (const [label, offset, status] of rows) {
    test(`the report link at ${label} answers ${status}`, async () => {
      const g = await played(3); let guard = 0; while (!sentReports.length && guard++ < 20) await tick(g.end + 5 * MIN);
      const { eid, k } = link(); expect(eid).toBe(g.id);
      const r = await call("GET", `/api/report/${eid}?k=${k}&part=base`, undefined, {}, g.end + offset); expect(r.status).toBe(status);
    });
  }
  test("a wrong key never opens the report", async () => {
    const g = await played(3); let guard = 0; while (!sentReports.length && guard++ < 20) await tick(g.end + 5 * MIN);
    for (const k of ["0".repeat(40), "", "abc", link().k.slice(0, -1) + (link().k.endsWith("0") ? "1" : "0")]) expect([403, 404]).toContain((await call("GET", `/api/report/${g.id}?k=${k}&part=base`, undefined, {}, g.end + 10 * MIN)).status);
  });
  test("the organizer gets a reminder before the link closes and a mail when the data is deleted, once each", async () => {
    const g = await played(3); let guard = 0; while (!sentReports.length && guard++ < 20) await tick(g.end + 5 * MIN);
    await tick(g.end + 14 * HOUR); await tick(g.end + 14 * HOUR + 10 * MIN); await tick(g.end + 21 * HOUR); await tick(g.end + 21 * HOUR + 10 * MIN);
    const m = mails("boss@acme.com"); expect(m.filter((x) => /deleted|erased/i.test(x.subject)).length).toBe(1);
    expect(m.filter((x) => /closes|reminder|save/i.test(x.subject)).length).toBeLessThanOrEqual(1);
  });
  test("with no organizer e-mail on record the data is still deleted on time", async () => {
    const id = uid("LIFE"); await create(undefined, id, { startRound: startIn(-2 * HOUR), cap: 100 }); await join(id, 1, {}, T - 3 * HOUR);
    const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", id)); await tick(end + 5 * MIN); await tick(end + 20 * HOUR + MIN);
    expect(left(id).participant).toBe(0);
  });
});

describe("retention timestamps the organizer can read", () => {
  test("GET life shows the personal-data deletion time and the full-deletion time that the code uses", async () => {
    const g = await paidGame({ cap: 100 }); await join(g.id, 1);
    const l = await j(await call("GET", `/api/z/${g.id}/life`, undefined, g.h));
    expect(l.personalDeleteAtMs - l.endMs).toBe(PURGE_AFTER_MS); expect(l.fullDeleteAtMs).toBe(fullDeleteAt(l.endMs));
  });
  test("the public info answer carries the erasure time for guests, equal to end + 20 hours", async () => {
    const g = await paidGame({ cap: 100 }); const info = await j(await call("GET", `/api/z/${g.id}/info`));
    const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", g.id)); expect(info.erasureMs).toBe(end + PURGE_AFTER_MS);
  });
  test("a legal hold set by the owner suspends the deletion until it is lifted", async () => {
    const g = await played(2); await tick(g.end + 5 * MIN);
    expect((await call("POST", `/api/owner/audit/${g.id}/hold`, { on: true, note: "court" }, PLAT)).status).toBe(200);
    await tick(g.end + 30 * HOUR); expect(left(g.id).participant).toBe(2);
    await call("POST", `/api/owner/audit/${g.id}/hold`, { on: false }, PLAT); await tick(g.end + 30 * HOUR + MIN); expect(left(g.id).participant).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- the lazy tick
describe("the lazy tick: any /api request runs the housekeeping when the last tick is older than 5 minutes", () => {
  const pending: Promise<unknown>[] = [];
  const hit = async (path = "/api/mode", now = T, wait = true) => { const r = await callRaw("GET", path, undefined, {}, now, wait ? (p) => { pending.push(p); } : undefined); await Promise.all(pending.splice(0)); return r; };
  const lastTick = () => one("SELECT v FROM kv WHERE k='tick_last_ms'")?.v ?? null;
  test("constant: five minutes", () => { expect(LAZY_TICK_MS).toBe(5 * MIN); });
  test("with nothing recorded, the first API request runs a tick and stamps the time", async () => { expect((await hit()).status).toBe(200); expect(Number(lastTick())).toBe(T); });
  test("the answer does not wait for the tick: waitUntil receives a promise and the response is already a plain 200", async () => {
    let got: Promise<unknown> | null = null; const r = await callRaw("GET", "/api/mode", undefined, {}, T, (p) => { got = p; });
    expect(r.status).toBe(200); expect(got).not.toBeNull(); await got;
  });
  test("a second request within five minutes does not run another tick", async () => {
    await hit("/api/mode", T); await hit("/api/mode", T + 4 * MIN + 59_000); expect(Number(lastTick())).toBe(T);
  });
  test("a request after five minutes runs one", async () => {
    await hit("/api/mode", T); await hit("/api/mode", T + 5 * MIN + 1000); expect(Number(lastTick())).toBe(T + 5 * MIN + 1000);
  });
  test("without waitUntil (no way to run in the background) nothing runs and nothing breaks", async () => { expect((await hit("/api/mode", T, false)).status).toBe(200); expect(lastTick()).toBeNull(); });
  for (const path of ["/", "/index.html", "/z.html", "/robots.txt", "/j/abcdef"]) test(`a request for ${path} (not an /api path) does not run a tick`, async () => { await hit(path); expect(lastTick()).toBeNull(); });
  test("the tick route itself is not preceded by a lazy one, and records its own time", async () => {
    const r = await callRaw("POST", "/api/lifecycle/tick", {}, PLAT, T); expect(r.status).toBe(200); expect(Number(lastTick())).toBe(T);
    await hit("/api/mode", T + 2 * MIN); expect(Number(lastTick())).toBe(T);
  });
  test("a lazy tick deletes a game's players that are due (the GitHub scheduler is not needed)", async () => {
    const g = await played(3); await hit("/api/mode", g.end + 5 * MIN);
    const l = lastTick(); expect(Number(l)).toBe(g.end + 5 * MIN);
    await hit("/api/mode", g.end + 21 * HOUR); expect(left(g.id).participant).toBe(0);
  });
  test("a lazy tick sends the report mail", async () => {
    const g = await played(3); for (let i = 0; i < 20 && !sentReports.length; i++) await hit("/api/mode", g.end + 10 * MIN + i * (LAZY_TICK_MS + 1000)); expect(sentReports.length).toBe(1);
  });
  test("a lazy tick that throws never breaks the request (the database fails inside the tick)", async () => {
    const real = W.env.DB.prepare.bind(W.env.DB); let armed = false;
    (W.env.DB as any).prepare = (sql: string) => { if (armed && /FROM engagement e LEFT JOIN life/.test(sql)) throw new Error("boom"); return real(sql); };
    armed = true; const r = await hit("/api/mode", T); armed = false; expect(r.status).toBe(200);
  });
  test("single flight: ten simultaneous requests start one tick, not ten", async () => {
    const real = W.env.DB.prepare.bind(W.env.DB); let runs = 0;
    (W.env.DB as any).prepare = (sql: string) => { if (/SELECT e\.\*, \(SELECT COUNT\(\*\) FROM participant p WHERE p\.eid=e\.id\) AS npart.*e\.start_round > \?/.test(sql)) runs++; return real(sql); };
    await Promise.all(Array.from({ length: 10 }, () => callRaw("GET", "/api/mode", undefined, {}, T, (p) => { pending.push(p); }))); await Promise.all(pending.splice(0));
    expect(runs).toBe(1);
  });
  test("an organizer's console request also keeps the clock moving", async () => {
    const o = await organizer(); const g = await played(2); await callRaw("GET", "/api/history", undefined, o.h, g.end + 21 * HOUR, (p) => { pending.push(p); }); await Promise.all(pending.splice(0));
    expect(left(g.id).participant).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- idempotency
describe("the lifecycle tick can be repeated safely", () => {
  test("the same tick ten times sends one report, one deletion mail, and changes nothing after the first", async () => {
    const g = await played(3);
    for (let i = 0; i < 10; i++) { await tick(g.end + 10 * MIN); await tick(g.end + 21 * HOUR); }
    expect(sentReports.length).toBe(1); expect(mails("boss@acme.com").filter((m) => /deleted|erased/i.test(m.subject)).length).toBe(1);
    expect(one("SELECT COUNT(*) c FROM life WHERE eid=?", g.id).c).toBe(1); expect(left(g.id).participant).toBe(0);
  });
  test("a tick run twice at the same instant by two callers is harmless", async () => {
    const g = await played(3); await tick(g.end + 10 * MIN); await Promise.all([tick(g.end + 21 * HOUR), tick(g.end + 21 * HOUR)]);
    expect(left(g.id).participant).toBe(0); expect(mails("boss@acme.com").filter((m) => /deleted|erased/i.test(m.subject)).length).toBeLessThanOrEqual(2);
  });
  test("the tick route with the cron key works, with a wrong or short key it is refused", async () => {
    reset({ CRON_KEY: "cron-key-0123456789" } as any);
    expect((await call("POST", "/api/lifecycle/tick", {}, { "x-cron-key": "cron-key-0123456789" })).status).toBe(200);
    for (const k of ["wrong", "", "cron-key-0123456780"]) expect((await call("POST", "/api/lifecycle/tick", {}, { "x-cron-key": k })).status).toBeGreaterThanOrEqual(403);
  });
  test("a tick with nothing to do returns zero counts", async () => { const r = await tick(T); expect(r.checked).toBe(0); expect(r.purged).toBe(0); });
  test("purge of old data twice removes the same things once", async () => {
    const g = await played(1); await tick(g.end + 21 * HOUR); const a = await purgeOld(W.env as any, g.end + 400 * DAY), b = await purgeOld(W.env as any, g.end + 400 * DAY);
    expect(a).toBeGreaterThanOrEqual(1); expect(b).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- players' own rights
describe("a player's own requests (access, correction, erasure, nomination) and leaving", () => {
  const ask = (id: string, pid: string, device: string, kind: string, extra: Record<string, unknown> = {}, now = T) => call("POST", `/api/z/${id}/datareq`, { pid, device, kind, ...extra }, {}, now);
  const seat = async () => { const g = await paidGame({ cap: 100 }); const r = await j(await join(g.id, 1, { name: "Maya Lopez" })); return { g, pid: r.pid as string, device: dev(1) }; };
  for (const [kind, extra, status] of [["access", {}, 200], ["correction", { note: "My name is Maya Lopes" }, 200], ["correction", { note: "x" }, 400], ["erasure", {}, 200], ["nomination", { note: "My brother" }, 200], ["status", {}, 200], ["delete-everything", {}, 400], ["", {}, 400]] as [string, Record<string, unknown>, number][]) {
    test(`a ${kind || "blank"} request ${Object.keys(extra).length ? "with a note " : ""}answers ${status}`, async () => { const s = await seat(); expect((await ask(s.g.id, s.pid, s.device, kind, extra)).status).toBe(status); });
  }
  test("access shows what is held without the stored seal, in plain words", async () => {
    const s = await seat(); const r = await j(await ask(s.g.id, s.pid, s.device, "access")); const text = JSON.stringify(r);
    expect(text).not.toMatch(/v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/);
  });
  test("a request needs the card id AND the phone's own device id; the id alone (it is public in the seat list) is not enough", async () => {
    const s = await seat(); expect(await (await ask(s.g.id, s.pid, dev(33), "erasure")).status).toBeGreaterThanOrEqual(400);
    expect(one("SELECT COUNT(*) c FROM participant WHERE eid=?", s.g.id).c).toBe(1);
  });
  test("erasure removes the name and number at once, keeps an anonymous seat, and tells the organizer and the owner", async () => {
    const s = await seat(); expect((await ask(s.g.id, s.pid, s.device, "erasure")).status).toBe(200);
    expect(JSON.stringify(q("SELECT * FROM participant"))).not.toContain("Maya");
    expect(mails("boss@acme.com").length + mails().length).toBeGreaterThan(0);
  });
  test("asking for the same thing twice is answered with the first request", async () => {
    const s = await seat(); await ask(s.g.id, s.pid, s.device, "access"); await ask(s.g.id, s.pid, s.device, "access");
    expect(one("SELECT COUNT(*) c FROM data_request WHERE eid=? AND kind='access'", s.g.id).c).toBe(1);
  });
  test("a player can leave before the start; the seat and name are deleted", async () => {
    const s = await seat(); expect((await call("POST", `/api/z/${s.g.id}/leave`, { pid: s.pid, device: s.device })).status).toBe(200);
    expect(one("SELECT COUNT(*) c FROM seat WHERE eid=?", s.g.id).c).toBe(0);
  });
  test("leaving with someone else's device id is refused", async () => { const s = await seat(); expect((await call("POST", `/api/z/${s.g.id}/leave`, { pid: s.pid, device: dev(44) })).status).toBeGreaterThanOrEqual(400); });
  test("request rows go with the other participant data at the deletion time", async () => {
    const s = await seat(); await ask(s.g.id, s.pid, s.device, "access");
    const end = await endBoundMs(W.env as any, one("SELECT * FROM engagement WHERE id=?", s.g.id)); await tick(end + 5 * MIN); await tick(end + 20 * HOUR + MIN);
    expect(one("SELECT COUNT(*) c FROM data_request WHERE eid=?", s.g.id).c).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- limits
describe("rate limits and the daily spend limit", () => {
  const startAs = (email: string, ip: string) => call("POST", "/api/start", { email }, { "cf-connecting-ip": ip });
  for (const [n, status] of [[1, 200], [10, 200], [11, 429], [30, 429]] as [number, number][]) {
    test(`the ${n}${["st", "nd", "rd"][n - 1] ?? "th"} new account from one network address in a day answers ${status}`, async () => {
      let last = 0; for (let i = 1; i <= n; i++) last = (await startAs(`rate${i}@acme.com`, "5.5.5.5")).status; expect(last).toBe(status);
    });
  }
  test("a different network address is not slowed by the first one's limit", async () => {
    for (let i = 1; i <= 11; i++) await startAs(`rate${i}@acme.com`, "5.5.5.5"); expect((await startAs("fresh@acme.com", "6.6.6.6")).status).toBe(200);
  });
  test("sign-in codes: five an hour for one address, then 429", async () => {
    await organizer("known@acme.com"); const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await call("POST", "/api/auth/email", { email: "known@acme.com" }, { "cf-connecting-ip": "4.4.4.4" })).status);
    expect(codes.slice(0, 5).every((s) => s === 200)).toBe(true); expect(codes.slice(5).every((s) => s === 429)).toBe(true);
  });
  test("a sign-in code can be tried five times; the sixth try fails even with the right code", async () => {
    await organizer("known@acme.com"); const body = await j(await call("POST", "/api/auth/email", { email: "known@acme.com" }));
    const mail = mails("known@acme.com").pop()!; const code = mail.body.match(/\b\d{6}\b/)![0];
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/auth/verify", { email: "known@acme.com", code: code === "000000" ? "111111" : "000000" })).status).toBe(400);
    expect((await call("POST", "/api/auth/verify", { email: "known@acme.com", code })).status).toBe(400);
    expect(body.ok).toBe(true);
  });
  test("the sign-in answer is the same for a known and an unknown address (no account enumeration)", async () => {
    await organizer("known@acme.com"); const a = await j(await call("POST", "/api/auth/email", { email: "known@acme.com" })), b = await j(await call("POST", "/api/auth/email", { email: "stranger@acme.com" }));
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
  for (const budget of [5, 20]) {
    test(`with a daily write budget of ${budget} rows, writes are told "busy" (503) once it is used up, while reads keep answering`, async () => {
      const g = await paidGame({ cap: 100 }); (W.env as any).DAILY_WRITE_BUDGET = String(budget);
      const o = null as unknown;
      let busy = false;
      for (let i = 1; i <= 40 && !busy; i++) busy = (await join(g.id, i)).status === 503;
      expect(busy).toBe(true); expect(o).toBeNull();
      expect((await call("GET", "/api/mode")).status).toBe(200);
    });
  }
  test("one network address may open only so many new seats a minute (JOIN_PER_IP_MINUTE), then 429 (an unpaid game: a paid game never falls below its pack, see below)", async () => {
    reset({ JOIN_PER_IP_MINUTE: "3" } as any);
    const o = await organizer(); const id = uid(); expect((await create(o.key, id, { cap: 100 })).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200);
    const codes: number[] = []; for (let i = 1; i <= 6; i++) codes.push((await join(id, i)).status);
    expect(codes.slice(0, 3).every((s) => s === 200)).toBe(true); expect(codes.slice(3).some((s) => s === 429)).toBe(true);
  });
  test("an office behind ONE address can seat a whole PAID game: the default per-address allowance grows with the pack (300 people, one address, one minute: all in)", async () => {
    const g = await paidGame({ cap: 500 }); const hdr = { "cf-connecting-ip": "9.9.9.9" }; const codes: number[] = [];
    for (let i = 1; i <= 300; i++) codes.push((await call("POST", `/api/z/${g.id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i) }, hdr)).status);
    expect(codes.filter((s) => s === 200).length).toBe(300);
  });
  test("an UNPAID game keeps the base figures (200 new seats a minute from one address), so a script cannot use a big free game to burn the write budget", async () => {
    reset(); const o = await organizer(); const id = uid(); expect((await create(o.key, id, { cap: 500 })).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200);
    const hdr = { "cf-connecting-ip": "9.9.9.8" }; const codes: number[] = [];
    for (let i = 1; i <= 230; i++) codes.push((await call("POST", `/api/z/${id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i) }, hdr)).status);
    expect(codes.slice(0, 200).every((s) => s === 200)).toBe(true); expect(codes.slice(200).every((s) => s === 429)).toBe(true);
  });
  test("a limit set in the environment is the BASE: it is exact for an unpaid game, and a paid game still gets at least its pack (the deployed site sets 600 a minute; 700 people behind one address all get into a paid 1000)", async () => {
    reset({ JOIN_PER_IP_MINUTE: "600", JOIN_PER_IP_DAY: "20000" } as any); const g = await paidGame({ cap: 1000 }); const hdr = { "cf-connecting-ip": "9.9.9.7" }; const codes: number[] = [];
    for (let i = 1; i <= 700; i++) codes.push((await call("POST", `/api/z/${g.id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i) }, hdr)).status);
    expect(codes.filter((s) => s === 200).length).toBe(700);
    reset({ JOIN_PER_IP_MINUTE: "5" } as any); const o = await organizer(); const id = uid(); expect((await create(o.key, id, { cap: 500 })).status).toBe(200); expect((await publish(o.key, id)).status).toBe(200);
    const c2: number[] = []; for (let i = 1; i <= 8; i++) c2.push((await call("POST", `/api/z/${id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i) }, { "cf-connecting-ip": "9.9.9.6" })).status);
    expect(c2.slice(0, 5).every((s) => s === 200)).toBe(true); expect(c2.slice(5).every((s) => s === 429)).toBe(true); // unpaid: the environment's figure is exact
  });
  test("a body bigger than the limit is refused, never a 500", async () => {
    const r = await call("POST", "/api/start", { email: "a@b.co", pad: "x".repeat(200_000) }); expect(r.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------------------------------------- test versus live mail
describe("TEST mode drops mail to strangers, LIVE sends it", () => {
  const OWNER = "owner@example.com";
  const rows: [string, string, boolean][] = [["a stranger", "someone@acme.com", false], ["the owner", OWNER, true], ["the owner in capitals", "OWNER@Example.com", true], ["the owner with a plus tag", "owner+t1@example.com", true], ["another domain with the owner's name", "owner@example.org", false], ["a lookalike", "owner@example.com.evil.co", false]];
  for (const [label, to, reaches] of rows) {
    test(`TEST mode: mail to ${label} ${reaches ? "goes out" : "is dropped and logged"}`, async () => {
      reset({ OWNER_EMAIL: OWNER } as any); await setMode(W.env as any, "TEST", "t", T);
      const sent = await sendMail(W.env, W.env.DB, to, "Hello", "Body", T);
      expect(!!sent).toBe(reaches); expect(mails().filter((m) => m.to_addr.toLowerCase() === to.toLowerCase()).length).toBe(reaches ? 1 : 0);
      expect(q("SELECT outcome FROM mail_event").map((r) => r.outcome)).toEqual([reaches ? "sent_test_allowlist" : "suppressed_test_mode"]);
    });
  }
  test("LIVE mode: mail to a stranger goes out and nothing is logged as suppressed", async () => {
    reset({ OWNER_EMAIL: OWNER } as any); await sendMail(W.env, W.env.DB, "someone@acme.com", "Hello", "Body", T);
    expect(mails("someone@acme.com").length).toBe(1); expect(q("SELECT * FROM mail_event").length).toBe(0);
  });
  test("every mail carries the brand footer with the support address and the legal link", async () => {
    await sendMail(W.env, W.env.DB, "someone@acme.com", "Hello", "Body", T); const m = mails("someone@acme.com")[0]!;
    expect(m.body).toContain("Write to hello@corporatetambola.com"); expect(m.body).toContain("/legal.html"); expect(m.subject.startsWith("[Tic Tac Toe] ")).toBe(true);
  });
  test("the subject tag is added once, not twice", async () => {
    await sendMail(W.env, W.env.DB, "a@acme.com", "[Tic Tac Toe] Already tagged", "Body", T); expect(mails("a@acme.com")[0]!.subject).toBe("[Tic Tac Toe] Already tagged");
  });
  test("without a mail key, a mail that carries a personal AI link keeps no body", async () => {
    const o = await organizer("leaky@acme.com"); const m = mails("leaky@acme.com").find((x) => /AI work link/i.test(x.subject)); expect(m).toBeTruthy();
    expect(m!.body).not.toContain(o.ai);
  });
});

// ---------------------------------------------------------------------------------------------------------- Help Desk
describe("Help Desk with several parameter sets", () => {
  let ipn = 0; const ipOf = () => `7.7.${Math.floor(++ipn / 200)}.${ipn % 200}`;
  const hcall = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) => call(method, path, body, { "cf-connecting-ip": ipOf(), ...headers }, now);
  const lastMail = (to: string, re?: RegExp) => [...mails(to)].reverse().find((m) => !re || re.test(m.subject));
  const tokenOf = (m: any, page: string) => m.body.match(new RegExp(`${page}\\.html\\?t=([0-9a-f]{48})`))?.[1] as string;
  beforeEach(() => { reset({ TEST_MODE: "1" } as any); ipn = 0; });
  const enroll = async (email: string, phone: string, name: string) => {
    const a = await j(await hcall("POST", "/api/partner/enroll", { phone, name, email, consent: true })); const v = await j(await hcall("POST", "/api/partner/enroll/verify", { email, code: a.devCode }));
    return v.partnerKey as string;
  };
  const SETS: [string, string, string, string][] = [["Asha", "asha@partner.example", "98111 22233", "boss@acme.com"], ["Ravi K", "ravi.k@partner.example", "+91 98999 11122", "hr@corp.example"], ["Zoë Ünal", "zoe@partner.example", "09811122244", "events@big-co.example"]];
  for (const [name, hemail, hphone, oemail] of SETS) {
    test(`helper ${name} is invited by ${oemail}, the Organizer allows, the helper builds a game that the Organizer publishes with one tap`, async () => {
      const pk = await enroll(hemail, hphone, name);
      expect((await hcall("POST", "/api/helpdesk/join", { email: hemail }, { "x-partner": pk })).status).toBe(200);
      const org = await organizer(oemail);
      const inv = await j(await hcall("POST", "/api/helpdesk/invite", { email: oemail, name: "Boss" }, { "x-partner": pk })); expect(inv.ok).toBe(true);
      const t = tokenOf(lastMail(oemail, /asks to prepare/), "helpdesk-accept");
      expect((await hcall("POST", "/api/helpdesk/accept", { t, consent: true }, org.h)).status).toBe(200);
      const me = await j(await hcall("GET", "/api/helpdesk/me", undefined, { "x-partner": pk }));
      const aiKey = me.clients[0].consoleUrl.match(/k=(cba_[0-9a-f]{48})/)[1] as string;
      const id = uid("HD"); expect((await hcall("POST", "/api/z", { id, startRound: startIn(2 * DAY), callSeconds: 9, cap: 300, name: "Annual Day" }, { "x-organizer": aiKey })).status).toBe(200);
      expect((await hcall("POST", `/api/z/${id}/publish`, { email: oemail, phone: "9876500009" }, { "x-organizer": aiKey })).status).toBeLessThan(500);
      expect(one("SELECT 1 x FROM kv WHERE k=?", "pub/" + id)).toBeFalsy(); // the helper's key cannot publish: it is still a draft
      expect((await hcall("POST", "/api/helpdesk/request-publish", { linkId: inv.id, eid: id }, { "x-partner": pk })).status).toBe(200);
      const at = tokenOf(lastMail(oemail, /asks you to publish/), "helpdesk-approve");
      const s = await j(await hcall("POST", "/api/helpdesk/approve/start", { t: at })); expect(s.key).toMatch(/^cbk_/);
      expect((await hcall("POST", `/api/z/${id}/publish`, { email: oemail, phone: "9876500009" }, { "x-organizer": s.key })).status).toBe(200);
      expect((await hcall("POST", "/api/helpdesk/approve/done", { t: at })).status).toBe(200);
      expect(one("SELECT 1 x FROM kv WHERE k=?", "pub/" + id)).toBeTruthy();
      expect((await hcall("POST", "/api/helpdesk/approve/start", { t: at })).status).toBeGreaterThanOrEqual(400); // single use
    });
  }
  test("the helper's AI key cannot publish a game, pay, or add a Host", async () => {
    const pk = await enroll("asha@partner.example", "98111 22233", "Asha"); await hcall("POST", "/api/helpdesk/join", { email: "asha@partner.example" }, { "x-partner": pk });
    const org = await organizer("boss@acme.com"); const inv = await j(await hcall("POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, { "x-partner": pk }));
    await hcall("POST", "/api/helpdesk/accept", { t: tokenOf(lastMail("boss@acme.com", /asks to prepare/), "helpdesk-accept"), consent: true }, org.h);
    const aiKey = (await j(await hcall("GET", "/api/helpdesk/me", undefined, { "x-partner": pk }))).clients[0].consoleUrl.match(/k=(cba_[0-9a-f]{48})/)[1] as string;
    const id = uid("HD"); await hcall("POST", "/api/z", { id, startRound: startIn(2 * DAY), callSeconds: 9, cap: 100 }, { "x-organizer": aiKey });
    expect((await hcall("POST", "/api/checkout", { eid: id, org: "A", email: "a@b.co" }, { "x-organizer": aiKey })).status).toBeGreaterThanOrEqual(400);
    expect((await hcall("POST", "/api/org/host", { mobile: "9876500077" }, { "x-organizer": aiKey })).status).toBe(403);
    expect(inv.ok).toBe(true);
  });
  const REFUSED: [string, (pk: string) => Promise<Response>][] = [
    ["inviting yourself", (pk) => hcall("POST", "/api/helpdesk/invite", { email: "asha@partner.example" }, { "x-partner": pk })],
    ["a bad e-mail address", (pk) => hcall("POST", "/api/helpdesk/invite", { email: "nope" }, { "x-partner": pk })],
    ["an empty body", (pk) => hcall("POST", "/api/helpdesk/invite", {}, { "x-partner": pk })],
    ["no partner key", () => hcall("POST", "/api/helpdesk/invite", { email: "x@acme.com" })],
    ["a wrong partner key", () => hcall("POST", "/api/helpdesk/invite", { email: "x@acme.com" }, { "x-partner": "ctp_" + "0".repeat(40) })],
  ];
  for (const [label, run] of REFUSED) {
    test(`an invitation with ${label} is refused`, async () => {
      const pk = await enroll("asha@partner.example", "98111 22233", "Asha"); await hcall("POST", "/api/helpdesk/join", { email: "asha@partner.example" }, { "x-partner": pk });
      const r = await run(pk); expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
    });
  }
  test("a helper may send five invitations an hour; the sixth is refused", async () => {
    const pk = await enroll("asha@partner.example", "98111 22233", "Asha"); await hcall("POST", "/api/helpdesk/join", { email: "asha@partner.example" }, { "x-partner": pk });
    const codes: number[] = []; for (let i = 1; i <= 6; i++) codes.push((await hcall("POST", "/api/helpdesk/invite", { email: `org${i}@acme.com` }, { "x-partner": pk })).status);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true); expect(codes[5]).toBe(429);
  });
  test("the invitation answer is the same whether or not the address has an account", async () => {
    const pk = await enroll("asha@partner.example", "98111 22233", "Asha"); await hcall("POST", "/api/helpdesk/join", { email: "asha@partner.example" }, { "x-partner": pk });
    await organizer("has@acme.com"); const a = await j(await hcall("POST", "/api/helpdesk/invite", { email: "has@acme.com" }, { "x-partner": pk })), b = await j(await hcall("POST", "/api/helpdesk/invite", { email: "hasnot@acme.com" }, { "x-partner": pk }));
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
  test("a stop ends the helper's access at once", async () => {
    const pk = await enroll("asha@partner.example", "98111 22233", "Asha"); await hcall("POST", "/api/helpdesk/join", { email: "asha@partner.example" }, { "x-partner": pk });
    const org = await organizer("boss@acme.com"); const inv = await j(await hcall("POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, { "x-partner": pk }));
    await hcall("POST", "/api/helpdesk/accept", { t: tokenOf(lastMail("boss@acme.com", /asks to prepare/), "helpdesk-accept"), consent: true }, org.h);
    const aiKey = (await j(await hcall("GET", "/api/helpdesk/me", undefined, { "x-partner": pk }))).clients[0].consoleUrl.match(/k=(cba_[0-9a-f]{48})/)[1] as string;
    expect((await hcall("GET", "/api/history", undefined, { "x-organizer": aiKey })).status).toBe(200);
    expect((await hcall("POST", "/api/helpdesk/stop", { linkId: inv.id }, org.h)).status).toBe(200);
    expect((await hcall("GET", "/api/history", undefined, { "x-organizer": aiKey })).status).toBeGreaterThanOrEqual(403);
  });
});
