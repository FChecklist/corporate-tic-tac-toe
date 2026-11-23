// v1.6.1, second audit of PR 9 (23 Nov 2026), angle 2 (security, privacy, abuse): M3 (look-ups of an ID), M4 (the waiting queue), M7 (the 24-hour deletion), L1 (secret compare), L4 (deletion code).
// Every test here fails if the fix it protects is taken out.
import { beforeEach, describe, expect, test } from "bun:test";
import { safeEq, type Env } from "../src/worker";
import { handle, consentFor } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { erasePersonal } from "../src/lifecycle";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 10, 1, 10, 0, 0), GEN = 1692803367, HOUR = 3_600_000;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, extra: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
const one = (sql: string, ...v: unknown[]) => raw.prepare(sql).get(...(v as any[])) as any;
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt", DATA_KEY: "k", INBOUND_SECRET: "inbound-secret-x" } as PayEnv; });

async function listGame(id = "AP-1") {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id, startRound: roundAt(T) + 1200, callSeconds: 6, cap: 600, whoCanJoin: "list" }, master);
  await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, master);
  await call("POST", `/api/z/${id}/people`, { people: [{ name: "Asha Rao", empId: "A-1101" }] }, master);
  return master;
}
const who = (id: string, ip: string, empId = "A1101") => call("POST", `/api/z/${id}/who`, { empId, consent: consentFor("K4") }, undefined, T, { "cf-connecting-ip": ip });
const ask = (id: string, i: number, ip: string, now = T) => call("POST", `/api/z/${id}/join`, { name: "Guest " + i, device: dev(i), consent: consentFor("K4") }, undefined, now, { "cf-connecting-ip": ip });

describe("M3: every 'Is this you?' look-up counts, a right ID too", () => {
  test("60 look-ups from one network in ten minutes are answered, the 61st is refused (429) even though every ID was on the list; another network is not affected", async () => {
    await listGame();
    const codes: number[] = []; for (let i = 0; i < 61; i++) codes.push((await who("AP-1", "5.5.5.5")).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true); expect(codes[60]).toBe(429);
    expect((await who("AP-1", "5.5.5.6")).status).toBe(200);
  });
  test("the whole game allows 600 look-ups in ten minutes, however many networks they come from", async () => {
    await listGame();
    for (let i = 0; i < 600; i++) expect([i, (await who("AP-1", `6.${i % 250}.${Math.floor(i / 250)}.1`)).status]).toEqual([i, 200]);
    const r = await who("AP-1", "6.250.9.9"); expect(r.status).toBe(429); expect((await j(r)).code).toBe("too-many-tries");
  }, 60_000);
});

describe("M4: one network cannot fill the organizer's queue", () => {
  test("60 open requests from one network in a game; the 61st is told to ask the organizer (429, waiting-net-full); a request already waiting is still answered; another network can ask; the counters go with the game's data", async () => {
    await listGame();
    for (let i = 1; i <= 60; i++) expect([i, (await ask("AP-1", i, "8.8.8.8")).status]).toEqual([i, 403]);
    const full = await ask("AP-1", 61, "8.8.8.8"); expect(full.status).toBe(429); expect((await j(full)).code).toBe("waiting-net-full");
    expect(one("SELECT COUNT(*) c FROM waiting").c).toBe(60);
    expect((await ask("AP-1", 7, "8.8.8.8")).status).toBe(403); // the same phone asking again is answered as before
    expect((await ask("AP-1", 62, "8.8.4.4")).status).toBe(403); // another network
    expect(one("SELECT COUNT(*) c FROM kv WHERE k LIKE 'wnet/AP-1/%'").c).toBeGreaterThan(0);
    await erasePersonal(env as any, "AP-1", T + 25 * HOUR, "organizer");
    expect(one("SELECT COUNT(*) c FROM kv WHERE k LIKE 'wnet/AP-1/%' OR k LIKE 'idlook%/AP-1/%' OR k LIKE 'idmiss/AP-1/%'").c).toBe(0);
  });
  test("the organizer is told, in the panel, that what a person typed is not checked", async () => {
    const js = await Bun.file(new URL("../../web/public/zc.js", import.meta.url)).text();
    expect(js).toContain("Everything here was typed by the person asking. Nothing is checked");
  });
});

describe("M7: the 24-hour deletion reaches error reports, the mail outbox and the audit rows of participants", () => {
  test("erasing a game's participant data deletes the error reports and groups that name it and the mail that names it; another game's stay", async () => {
    await listGame("AP-2"); await listGame("AP-3");
    raw.exec("CREATE TABLE IF NOT EXISTS error_group (fp TEXT PRIMARY KEY, kind TEXT, sev TEXT, page TEXT, role TEXT, msg TEXT, first_ts INTEGER, last_ts INTEGER, n INTEGER DEFAULT 1, games INTEGER DEFAULT 0, status TEXT DEFAULT 'new', rel_first TEXT, rel_last TEXT, fixed_ts INTEGER, fix_files TEXT, fix_note TEXT, fix_commit TEXT, today_day TEXT, today_n INTEGER DEFAULT 0)");
    raw.exec("CREATE TABLE IF NOT EXISTS error_report (id TEXT PRIMARY KEY, fp TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)");
    for (const g of ["AP-2", "AP-3"]) {
      raw.prepare("INSERT INTO error_group(fp,kind,page,msg,first_ts,last_ts) VALUES(?,?,?,?,?,?)").run("fp-" + g, "worker", `/api/z/${g}/join`, `Error: x (POST /api/z/${g}/join -> 503)`, T, T);
      raw.prepare("INSERT INTO error_report(id,fp,ts,body) VALUES(?,?,?,?)").run("r-" + g, "fp-" + g, T, JSON.stringify({ page: `/api/z/${g}/join`, game: g, msg: "boom" }));
      raw.prepare("INSERT INTO outbox(to_addr,subject,body,at_ms,sent) VALUES(?,?,?,?,0)").run("boss@acme.com", `Your game ${g}`, "Pay now", T);
    }
    await erasePersonal(env as any, "AP-2", T + 25 * HOUR, "organizer");
    expect(one("SELECT COUNT(*) c FROM error_report WHERE id='r-AP-2'").c).toBe(0); expect(one("SELECT COUNT(*) c FROM error_group WHERE fp='fp-AP-2'").c).toBe(0); expect(one("SELECT COUNT(*) c FROM outbox WHERE subject='Your game AP-2'").c).toBe(0);
    expect(one("SELECT COUNT(*) c FROM error_report WHERE id='r-AP-3'").c).toBe(1); expect(one("SELECT COUNT(*) c FROM error_group WHERE fp='fp-AP-3'").c).toBe(1); expect(one("SELECT COUNT(*) c FROM outbox WHERE subject='Your game AP-3'").c).toBe(1);
  });
  test("a participant's audit row keeps no country and no request id (only the kind of event, the time and the answer)", async () => {
    await listGame("AP-4");
    expect((await call("POST", "/api/z/AP-4/join", { name: "Maya Lopez", device: dev(1), consent: consentFor("K4") }, undefined, T, { "cf-connecting-ip": "9.9.9.9", "cf-ipcountry": "IN", "x-request-id": "req-abc-123" })).status).toBe(403);
    const rows = raw.prepare("SELECT actor, country, corr, asn FROM audit_log WHERE eid='AP-4' AND actor='participant'").all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) { expect(r.country).toBeNull(); expect(r.corr).toBe(""); expect(r.asn).toBeNull(); }
    const { verifyChain } = await import("../src/audit"); const chain = (raw.prepare("SELECT DISTINCT chain FROM audit_log WHERE eid='AP-4' AND actor='participant'").get() as any).chain;
    expect((await verifyChain(env.DB, chain)).ok).toBe(true); // the stored row and its hash still agree
    const orgRows = raw.prepare("SELECT corr FROM audit_log WHERE eid='AP-4' AND actor<>'participant'").all() as any[];
    for (const r of orgRows) expect(String(r.corr).length).toBeGreaterThan(0); // the organizer's own rows are unchanged
  });
});

describe("L1 and L4", () => {
  test("L1: the two secrets are compared in full: equal, different, shorter, longer, empty and non-ASCII", () => {
    expect(safeEq("abc", "abc")).toBe(true); expect(safeEq("abc", "abd")).toBe(false); expect(safeEq("abc", "ab")).toBe(false); expect(safeEq("ab", "abc")).toBe(false); expect(safeEq("", "")).toBe(true); expect(safeEq("", "a")).toBe(false); expect(safeEq("é", "é")).toBe(true); expect(safeEq("é", "e")).toBe(false);
  });
  test("L1: the platform key still opens the owner routes, and a near miss does not", async () => {
    expect((await call("GET", "/api/owner/releases", undefined, "plat")).status).toBe(200); expect((await call("GET", "/api/owner/releases", undefined, "plas")).status).not.toBe(200);
  });
  test("L4: ten wrong 6-digit codes lock a deletion request; the right code then does nothing until a new request", async () => {
    await listGame("AP-5");
    const mail = (text: string) => call("POST", "/api/inbound-email", { from: "boss@acme.com", subject: "delete AP-5", text }, undefined, T, { "x-inbound-secret": "inbound-secret-x" });
    expect((await j(await mail("please delete AP-5"))).action).toBe("confirm-sent");
    const code = String(one("SELECT body FROM outbox WHERE subject LIKE '%Confirm the deletion%' ORDER BY id DESC LIMIT 1").body).match(/\b(\d{6})\b/)![1]!;
    for (let i = 0; i < 12; i++) await mail(`delete AP-5 ${String(111111 + (code === String(111111 + i) ? 50 : i))}`);
    const r = await j(await mail(`delete AP-5 ${code}`)); expect(r.action).not.toBe("deleted");
    expect(one("SELECT COUNT(*) c FROM engagement WHERE id='AP-5'").c).toBe(1);
  });
  test("L4: the right code, with no wrong tries before it, still deletes (nothing else changed)", async () => {
    await listGame("AP-6");
    const mail = (text: string) => call("POST", "/api/inbound-email", { from: "boss@acme.com", subject: "delete AP-6", text }, undefined, T, { "x-inbound-secret": "inbound-secret-x" });
    await mail("please delete AP-6"); const code = String(one("SELECT body FROM outbox WHERE subject LIKE '%Confirm the deletion%' ORDER BY id DESC LIMIT 1").body).match(/\b(\d{6})\b/)![1]!;
    expect((await j(await mail(`delete AP-6 ${code}`))).action).toBe("deleted");
  });
});
