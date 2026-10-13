// Participant crypto-shredding: 23 hours after the game ends the participants' personal part of the audit log is destroyed (per-engagement key + sealed blobs), the hash chain still verifies,
// the organizer's / host's rows and the winners' prize confirmations stay for 365 days, and a legal hold (owner-set) suspends both the shredding and the 365-day deletion.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { appendAudit, loadRows, verifyChain, shredParticipantAudit } from "../src/audit";
import { endBoundMs, lifecycleTick, PURGE_AFTER_MS, REPORT_LINK_MS, erasePersonal } from "../src/lifecycle";
import { openEng } from "../src/pii";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), HOUR = 3_600_000;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const j = async (r: Response) => (await r.json()) as any;
const PLAT = { "x-organizer": "plat" };
const IP = "198.51.100.5", UA = "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36", DEV = "ab".repeat(16), PHONE = "9876543210";
const rows = (chain: string) => raw.prepare("SELECT * FROM audit_log WHERE chain=? ORDER BY seq").all(chain) as any[];
const count = (sql: string) => (raw.prepare(sql).get() as any).c as number;

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "test-data-key" };
});
async function game() {
  const x = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" }));
  const h = { "x-organizer": x.token as string, "cf-connecting-ip": "203.0.113.9", "user-agent": "OrganizerBrowser/1" };
  expect((await call("POST", "/api/z", { id: "EVT1", startRound: roundAt(T) + 1200, callSeconds: 6, cap: 100 }, h)).status).toBe(200);
  raw.prepare("UPDATE engagement SET pack=100 WHERE id='EVT1'").run();
  await call("POST", "/api/z/EVT1/join", { phone: PHONE, name: "Asha Rao", device: DEV }, { "cf-connecting-ip": IP, "user-agent": UA }, T);
  await call("POST", "/api/z/EVT1/join", { phone: "9123456780", name: "Ravi", device: "cd".repeat(16) }, { "cf-connecting-ip": "198.51.100.6", "user-agent": UA }, T);
  return h;
}
const engagementRow = () => raw.prepare("SELECT * FROM engagement WHERE id='EVT1'").get();

describe("participant crypto-shredding", () => {
  test("a participant's personal part is stored apart, sealed under the engagement's own key, never in audit_log", async () => {
    await game();
    const p = rows("EVT1").filter((x) => x.actor === "participant");
    expect(p.length).toBe(2);
    for (const r of p) { expect(r.sealed).toBe(""); expect(r.pdig).toMatch(/^[0-9a-f]{64}$/); expect(r.asn).toBeNull(); }
    expect(count("SELECT COUNT(*) c FROM audit_pii WHERE eid='EVT1'")).toBe(2);
    expect(count("SELECT COUNT(*) c FROM eng_key WHERE eid='EVT1'")).toBe(1);
    const dump = JSON.stringify([raw.prepare("SELECT * FROM audit_log").all(), raw.prepare("SELECT * FROM audit_pii").all()]);
    for (const bad of [IP, DEV, "Chrome/120", PHONE, "Asha"]) expect(dump).not.toContain(bad);
    const out = await j(await call("GET", "/api/owner/audit/EVT1", undefined, PLAT));
    const jr = out.rows.find((x: any) => x.actor === "participant");
    expect(jr.details.ip).toBe(IP); expect(jr.details.device_id).toBe(DEV);
    expect((await j(await call("GET", "/api/owner/audit/EVT1/verify", undefined, PLAT))).ok).toBe(true);
  });

  test("shredding makes the personal part unrecoverable, keeps the non-personal core, and the chain still verifies", async () => {
    const h = await game();
    await call("PATCH", "/api/z/EVT1/settings", { cap: 90 }, h); // an organizer row after the joins
    const before = rows("EVT1"), headBefore = before.at(-1).row_hash;
    const salt = (raw.prepare("SELECT salt FROM eng_key WHERE eid='EVT1'").get() as any).salt as string;
    const blob = (raw.prepare("SELECT sealed FROM audit_pii WHERE eid='EVT1' ORDER BY seq").get() as any).sealed as string;
    expect(await openEng(env as any, "EVT1", salt, blob)).toContain(IP); // sanity: with the salt it opens...
    expect(await shredParticipantAudit(env as any, "EVT1", T + 23 * HOUR)).toBe(true);
    // ...and nothing the database still holds can open it
    expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(0); expect(count("SELECT COUNT(*) c FROM eng_key")).toBe(0);
    expect(await openEng(env as any, "EVT1", "00".repeat(32), blob)).toBeNull();
    expect(await openEng(env as any, "EVT1", null, blob)).toBeNull();
    expect(raw.prepare("SELECT * FROM shred WHERE eid='EVT1'").get()).toMatchObject({ eid: "EVT1", shredded_ms: T + 23 * HOUR, row_count: 2 });
    // chain intact, same head, same rows
    const v = await verifyChain((env as any).DB, "EVT1");
    expect(v.ok).toBe(true); expect(v.rows).toBe(before.length); expect(v.headHash).toBe(headBefore);
    // core kept
    const after = await loadRows(env as any, "EVT1");
    const joins = after.filter((x) => x.actor === "participant");
    expect(joins.map((x) => x.event)).toEqual(["join", "join"]);
    for (const x of joins) { expect(x.details).toEqual({ personal_data_erased: true }); expect(x.at_ms).toBe(T); expect(x.eid).toBe("EVT1"); expect(x.asn).toBeNull(); }
    // the organizer's row still reads in full
    const org = after.find((x) => x.event === "edit")!; expect(org.details.ip).toBe("203.0.113.9"); expect(org.details.changes).toEqual({ cap: 90 });
    // shredding twice changes nothing
    expect(await shredParticipantAudit(env as any, "EVT1", T + 30 * HOUR)).toBe(true);
    expect(raw.prepare("SELECT shredded_ms FROM shred WHERE eid='EVT1'").get()).toEqual({ shredded_ms: T + 23 * HOUR });
  });

  test("a tampered personal blob is caught while it exists; a removed blob with no recorded erasure is caught too", async () => {
    await game();
    raw.prepare("UPDATE audit_pii SET sealed='e1.AAAA.BBBB' WHERE seq=2 AND eid='EVT1'").run();
    const v = await verifyChain((env as any).DB, "EVT1"); expect(v.ok).toBe(false); expect(v.reason).toMatch(/personal part was changed/);
    raw.prepare("DELETE FROM audit_pii WHERE eid='EVT1'").run();
    const w = await verifyChain((env as any).DB, "EVT1"); expect(w.ok).toBe(false); expect(w.reason).toMatch(/without a recorded erasure/);
  });

  test("rows of the organizer, co-host and AI key, and the winners' prize confirmations, are NOT shredded", async () => {
    await game();
    const base = { eid: "EVT1", org: null, status: 200, now: T, country: "IN", corr: "c" };
    await appendAudit(env as any, { ...base, actor: "participant", event: "prize", target: "confirm", details: { ip: IP, name: "Winner W" } });
    await appendAudit(env as any, { ...base, actor: "cohost", event: "edit", target: "settings", details: { ip: "192.0.2.4" } });
    await appendAudit(env as any, { ...base, actor: "ai_key", event: "ai_read", target: "x", details: { ip: "192.0.2.5" }, aiVendor: "openai" });
    expect(await shredParticipantAudit(env as any, "EVT1", T + 23 * HOUR)).toBe(true);
    const after = await loadRows(env as any, "EVT1");
    expect(after.find((x) => x.event === "prize")!.details.name).toBe("Winner W");
    expect(after.find((x) => x.actor === "cohost")!.details.ip).toBe("192.0.2.4");
    expect(after.find((x) => x.actor === "ai_key")!.details.ip).toBe("192.0.2.5");
    expect(after.filter((x) => x.event === "join").every((x) => x.details.personal_data_erased)).toBe(true);
    expect((await verifyChain((env as any).DB, "EVT1")).ok).toBe(true);
  });

  test("a participant row written after the shredding keeps only its non-personal core and no new key is made", async () => {
    await game();
    await shredParticipantAudit(env as any, "EVT1", T + 23 * HOUR);
    await call("POST", "/api/z/EVT1/join", { phone: "9000000001", name: "Late", device: "ef".repeat(16) }, { "cf-connecting-ip": "198.51.100.77", "user-agent": UA }, T + 24 * HOUR);
    const last = rows("EVT1").at(-1);
    expect(last.actor).toBe("participant"); expect(last.sealed).toBe(""); expect(last.pdig).toBeNull();
    expect(count("SELECT COUNT(*) c FROM eng_key")).toBe(0); expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(0);
    expect(JSON.stringify(raw.prepare("SELECT * FROM audit_log").all())).not.toContain("198.51.100.77");
    expect((await verifyChain((env as any).DB, "EVT1")).ok).toBe(true);
  });

  test("the organizer's own erase shreds at once too", async () => {
    await game();
    await erasePersonal(env as any, "EVT1", T + HOUR, "organizer");
    expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(0); expect(count("SELECT COUNT(*) c FROM shred")).toBe(1);
  });
});

describe("the 23-hour clock", () => {
  test("constants: the link closes at 22 hours, participants' data goes at 23 (inside the promised 24)", () => {
    expect(REPORT_LINK_MS).toBe(22 * HOUR); expect(PURGE_AFTER_MS).toBe(23 * HOUR);
  });
  test("the tick deletes participants and shreds their audit part at 23 hours after the end, not at 22", async () => {
    await game();
    const end = await endBoundMs(env as any, engagementRow());
    await lifecycleTick(env as any, end + 5 * 60_000);
    await lifecycleTick(env as any, end + 22 * HOUR + 59 * 60_000);
    expect(count("SELECT COUNT(*) c FROM participant")).toBe(2); expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(2); expect(count("SELECT COUNT(*) c FROM shred")).toBe(0);
    const out = await lifecycleTick(env as any, end + 23 * HOUR + 1000);
    expect(out.purged).toBe(1);
    expect(count("SELECT COUNT(*) c FROM participant")).toBe(0); expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(0); expect(count("SELECT COUNT(*) c FROM eng_key")).toBe(0);
    expect(raw.prepare("SELECT eid FROM shred").get()).toEqual({ eid: "EVT1" });
    expect((await verifyChain((env as any).DB, "EVT1")).ok).toBe(true);
  });
  test("a legal hold suspends the shredding and the 365-day deletion; lifting it lets both run", async () => {
    await game();
    const end = await endBoundMs(env as any, engagementRow());
    await call("POST", "/api/owner/audit/EVT1/hold", { on: true, note: "court order" }, PLAT);
    await lifecycleTick(env as any, end + 5 * 60_000);
    await lifecycleTick(env as any, end + 30 * HOUR);
    expect(count("SELECT COUNT(*) c FROM participant")).toBe(2); expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(2); expect(count("SELECT COUNT(*) c FROM shred")).toBe(0);
    expect(await shredParticipantAudit(env as any, "EVT1", end + 30 * HOUR)).toBe(false);
    await purgeOld(env as any, end + 400 * 86_400_000);
    expect(rows("EVT1").length).toBeGreaterThan(0); expect(raw.prepare("SELECT 1 FROM engagement WHERE id='EVT1'").get()).toBeTruthy();
    await call("POST", "/api/owner/audit/EVT1/hold", { on: false }, PLAT);
    await lifecycleTick(env as any, end + 31 * HOUR);
    expect(count("SELECT COUNT(*) c FROM participant")).toBe(0); expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(0); expect(count("SELECT COUNT(*) c FROM shred")).toBe(1);
  });
  test("after shredding, the 365-day job still works: log, key material and marker go; certificate and statistics stay", async () => {
    const h = await game(); await call("PATCH", "/api/z/EVT1/settings", { cap: 90 }, h);
    const end = await endBoundMs(env as any, engagementRow());
    await lifecycleTick(env as any, end + 5 * 60_000); await lifecycleTick(env as any, end + 24 * HOUR);
    const n = rows("EVT1").length, last = rows("EVT1").at(-1).row_hash;
    await purgeOld(env as any, end + 400 * 86_400_000);
    expect(rows("EVT1").length).toBe(0); expect(count("SELECT COUNT(*) c FROM shred")).toBe(0); expect(count("SELECT COUNT(*) c FROM audit_pii")).toBe(0);
    expect(raw.prepare("SELECT * FROM audit_cert WHERE eid='EVT1'").get()).toMatchObject({ row_count: n, final_hash: last });
    const stats = JSON.parse((raw.prepare("SELECT stats FROM audit_stats WHERE eid='EVT1'").get() as any).stats);
    expect(stats.byActor.participant).toBe(2); expect(JSON.stringify(stats)).not.toContain(IP);
  });
});
