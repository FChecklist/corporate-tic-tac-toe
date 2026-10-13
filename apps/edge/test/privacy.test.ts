// Privacy and lifecycle, end to end through the real Worker code and a real SQLite: names and numbers are sealed, invitations obey the organizer's rules,
// the winners record outlives the personal data, the report is built and e-mailed, and everything is deleted on time.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { settleByPhones } from "./settle";
import { layoutPeoplePart, layoutReport } from "../src/report-layout";
import { purgeOld, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { endBoundMs, fullDeleteAt, lifecycleTick, personalDeleteAt, PURGE_AFTER_MS } from "../src/lifecycle";
import { sentReports } from "../src/pay";
import { sealPii } from "../src/pii";

const SECRET = "org-secret";
let env: Env; let raw: ReturnType<typeof makeD1>["raw"];
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const roundOf = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const org = { "x-organizer": SECRET };
const tick = (now: number) => lifecycleTick(env as any, now);
/** An engagement whose game is long over at T (it began 2 hours before). */
const create = (id = "PRV-1", over: Record<string, unknown> = {}) => call("POST", "/api/z", { id, startRound: roundOf(T - 2 * 3_600_000), callSeconds: 6, cap: 5000, ...over }, org);
const setContact = (id: string, email = "boss@acme.com") => env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?)").bind(`contact/${id}`, JSON.stringify({ email, phone: "9811122233" })).run();
const joinAs = (i: number, name: string, id = "PRV-1", extra: Record<string, unknown> = {}, now = T - 3 * 3_600_000) => call("POST", `/api/z/${id}/join`, { phone: "9876" + String(500000 + i), name, device: String(i).padStart(32, "0"), ...extra }, {}, now);

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: SECRET, DAILY_WRITE_BUDGET: "10000000" };
  sentReports.length = 0;
});

describe("names and numbers are sealed", () => {
  test("the database never holds a name or a mobile number in the clear, and every record is sealed differently", async () => {
    await create();
    await joinAs(1, "Asha Verma"); await joinAs(2, "Asha Verma");
    expect((await call("POST", "/api/z/PRV-1/roster", { people: [{ phone: "9876543210", name: "Roster Rani" }] }, org, T - 3 * 3_600_000)).status).toBe(200);
    const dump = JSON.stringify([raw.query("SELECT * FROM participant").all(), raw.query("SELECT * FROM seat").all(), raw.query("SELECT * FROM kv").all(), raw.query("SELECT * FROM outbox").all()]);
    for (const secret of ["Asha", "Verma", "Roster", "Rani", "9876500001", "9876500002", "9876543210", "987654321"]) expect(dump).not.toContain(secret);
    const rows = raw.query("SELECT name, pii FROM participant ORDER BY pid").all() as any[];
    expect(rows.every((r) => r.name === null && /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(r.pii))).toBe(true);
    expect(new Set(rows.map((r) => r.pii)).size).toBe(3); // the same name twice gives different sealed text (fresh nonce each time)
  });
  test("a sealed record opens only with the right key, and cannot be altered", async () => {
    const sealed = await sealPii({ DATA_KEY: "key-one" }, { phone: "9876543210", name: "Asha" });
    const { openPii } = await import("../src/pii");
    expect(await openPii({ DATA_KEY: "key-one" }, sealed)).toEqual({ phone: "9876543210", name: "Asha" });
    expect(await openPii({ DATA_KEY: "key-two" }, sealed)).toBeNull();
    const parts = sealed.split("."); const flipped = parts[0] + "." + parts[1] + "." + (parts[2]![0] === "A" ? "B" : "A") + parts[2]!.slice(1);
    expect(await openPii({ DATA_KEY: "key-one" }, flipped)).toBeNull();
    expect(await openPii({ DATA_KEY: "key-one" }, "plain text")).toBeNull();
  });
  test("the participant list carries ids, join rounds, roles and inviters but no names; the organizer opens a few names at a time", async () => {
    await create(); await joinAs(1, "Asha"); await joinAs(2, "Bala");
    const list = await j(await call("GET", "/api/z/PRV-1/participants", undefined, org));
    expect(JSON.stringify(list)).not.toMatch(/Asha|Bala/); expect(Object.keys(list.participants[0]).sort()).toEqual(["cat", "inv", "jr", "pid", "role"]);
    const pids = list.participants.map((p: any) => p.pid).join(",");
    expect((await call("GET", `/api/z/PRV-1/names?pids=${pids}`)).status).toBe(403); // nobody but the organizer
    expect((await call("GET", `/api/z/PRV-1/names?pids=${pids}`, undefined, { "x-organizer": "wrong" })).status).toBe(403);
    const names = (await j(await call("GET", `/api/z/PRV-1/names?pids=${pids}`, undefined, org))).names as Record<string, string>;
    expect(Object.values(names).sort()).toEqual(["Asha", "Bala"]);
  });
  test("people on the invitation list get seats too (collision-free tickets, one device), and the first device to open the link takes the seat", async () => {
    await create();
    await call("POST", "/api/z/PRV-1/roster", { people: [{ phone: "9876543210", name: "Rani" }] }, org, T - 3 * 3_600_000);
    const seat = raw.query("SELECT seq, pid, dev, src FROM seat").get() as any; expect(seat.pid).toMatch(/^1x[0-9a-f]{12}$/); expect(seat.dev).toBeNull(); expect(seat.src).toBe("roster");
    const r = await j(await call("POST", "/api/z/PRV-1/join", { phone: "98765 43210", device: "a".repeat(32) }, {}, T - 3 * 3_600_000 + 60_000));
    expect(r.pid).toBe(seat.pid);
    expect((await call("POST", "/api/z/PRV-1/join", { phone: "9876543210", device: "b".repeat(32) }, {}, T - 3 * 3_600_000 + 90_000)).status).toBe(423);
  });
  test("reuse copies the earlier list as sealed records, and says so plainly when that list has already been deleted", async () => {
    await create("PRV-OLD"); await create("PRV-NEW");
    await joinAs(1, "Asha", "PRV-OLD"); await joinAs(2, "Bala", "PRV-OLD");
    const r = await j(await call("POST", "/api/z/PRV-NEW/reuse", { from: "PRV-OLD" }, org));
    expect(r.copied).toBe(2);
    const names = (await j(await call("GET", `/api/z/PRV-NEW/names?pids=${(await j(await call("GET", "/api/z/PRV-NEW/participants", undefined, org))).participants.map((p: any) => p.pid).join(",")}`, undefined, org))).names;
    expect(Object.values(names).sort()).toEqual(["Asha", "Bala"]);
    await call("POST", "/api/z/PRV-OLD/erase", {}, org);
    const gone = await call("POST", "/api/z/PRV-NEW/reuse", { from: "PRV-OLD" }, org);
    expect(gone.status).toBe(410); expect((await j(gone)).error).toMatch(/deleted within 24 hours/);
  });
});

describe("invitations", () => {
  const withInvites = (id: string, invites: unknown) => call("PATCH", `/api/z/${id}/settings`, { invites }, org, T - 4 * 3_600_000);
  test("the organizer's settings are checked: between 1 and 10 invites each, kinds from the list, at least one kind when on", async () => {
    await create();
    for (const bad of [{ on: true, per: 0 }, { on: true, per: 11 }, { on: true, per: 2, cats: ["aliens"] }, { on: true, per: 2, cats: [] }, { per: 2 }, "yes"]) expect((await withInvites("PRV-1", bad)).status).toBe(400);
    expect((await withInvites("PRV-1", { on: true, per: 4, cats: ["family", "colleagues", "dealers", "vendors"] })).status).toBe(200);
    const info = await j(await call("GET", "/api/z/PRV-1/info", undefined, org));
    expect(info.invites).toEqual({ on: true, per: 4, cats: ["family", "colleagues", "dealers", "vendors"] });
    const { INVITE_CATEGORIES } = await import("../../../packages/beacon/src/config"); expect(INVITE_CATEGORIES.length).toBe(10);
  });
  test("with invitations off, a link with an inviter still lets the person join but records no inviter", async () => {
    await create(); await joinAs(1, "Asha");
    const s = raw.query("SELECT seq FROM seat").get() as any;
    expect((await joinAs(2, "Bala", "PRV-1", { from: s.seq, cat: "family" })).status).toBe(200);
    expect(raw.query("SELECT inv, cat FROM seat WHERE seq=2").get()).toEqual({ inv: null, cat: null });
  });
  test("one person can invite at most 4: the 5th person using their link is told so, and each invitee is recorded with the kind of guest", async () => {
    await create(); await withInvites("PRV-1", { on: true, per: 4, cats: ["family", "colleagues"] });
    await joinAs(1, "Asha"); const inviter = (raw.query("SELECT seq FROM seat").get() as any).seq;
    for (let i = 2; i <= 5; i++) expect((await joinAs(i, "G" + i, "PRV-1", { from: inviter, cat: i % 2 ? "family" : "colleagues" })).status).toBe(200);
    const fifth = await joinAs(6, "G6", "PRV-1", { from: inviter, cat: "family" });
    expect(fifth.status).toBe(409); const b = await j(fifth); expect(b.code).toBe("invite-full"); expect(b.error).toMatch(/4 people/);
    expect(raw.query("SELECT COUNT(*) c FROM participant").get()).toEqual({ c: 5 }); // the 5th was not let in through that link
    expect(raw.query("SELECT inv, cat FROM seat WHERE seq=2").get()).toEqual({ inv: inviter, cat: "colleagues" });
    // two levels only: someone who was invited by a participant cannot invite; their link still lets the guest in but records no inviter
    expect((await joinAs(7, "Chain", "PRV-1", { from: 2, cat: "family" })).status).toBe(200);
    expect(raw.query("SELECT inv, cat FROM seat WHERE seq=6").get()).toEqual({ inv: null, cat: null });
  });
  test("a kind of guest the organizer did not allow is not recorded; an unknown inviter is ignored", async () => {
    await create(); await withInvites("PRV-1", { on: true, per: 4, cats: ["family"] });
    await joinAs(1, "Asha");
    await joinAs(2, "Bala", "PRV-1", { from: 1, cat: "dealers" }); await joinAs(3, "Cara", "PRV-1", { from: 999, cat: "family" });
    expect(raw.query("SELECT inv, cat FROM seat WHERE seq=2").get()).toEqual({ inv: 1, cat: null });
    expect(raw.query("SELECT inv, cat FROM seat WHERE seq=3").get()).toEqual({ inv: null, cat: null });
  });
  test("the organizer, hosts and co-hosts can invite any number of people, and their seats are flagged", async () => {
    await create(); await withInvites("PRV-1", { on: true, per: 2, cats: ["family"] });
    await joinAs(1, "Boss"); await joinAs(2, "Host");
    expect((await call("POST", "/api/z/PRV-1/mark", { phone: "9876500001", role: "organizer" })).status).toBe(403); // only the organizer can mark
    expect((await call("POST", "/api/z/PRV-1/mark", { phone: "9876500001", role: "organizer" }, org, T - 4 * 3_600_000)).status).toBe(200);
    expect((await call("POST", "/api/z/PRV-1/mark", { phone: "9876500002", role: "co-host" }, org, T - 4 * 3_600_000)).status).toBe(200);
    expect((await call("POST", "/api/z/PRV-1/mark", { phone: "9876500002", role: "king" }, org, T - 4 * 3_600_000)).status).toBe(400);
    expect((await call("POST", "/api/z/PRV-1/mark", { phone: "9000000000", role: "host" }, org, T - 4 * 3_600_000)).status).toBe(404);
    for (let i = 3; i <= 9; i++) expect((await joinAs(i, "G" + i, "PRV-1", { from: 2, cat: "family" })).status).toBe(200); // seven people from a co-host, quota is 2
    expect(raw.query("SELECT COUNT(*) c FROM seat WHERE inv=2").get()).toEqual({ c: 7 });
    expect(raw.query("SELECT role FROM seat WHERE seq=1").get()).toEqual({ role: "organizer" });
  });
  test("a crowd using one inviter's link at the same instant can never pass that person's limit", async () => {
    await create(); await withInvites("PRV-1", { on: true, per: 4, cats: ["family"] });
    await joinAs(1, "Asha");
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => joinAs(i + 2, "G" + i, "PRV-1", { from: 1, cat: "family" })));
    expect(rs.filter((r) => r.status === 200).length).toBe(4); expect(rs.filter((r) => r.status === 409).length).toBe(8);
    expect(raw.query("SELECT COUNT(*) c FROM seat WHERE inv=1").get()).toEqual({ c: 4 });
  });
});

describe("the winners record", () => {
  test("a game is over only when several different phones say so, and never before it could be", async () => {
    await create(); for (let i = 1; i <= 5; i++) await joinAs(i, "P" + i);
    const pids = (raw.query("SELECT pid FROM seat ORDER BY seq").all() as any[]).map((x) => x.pid);
    const early = T - 2 * 3_600_000; // the very start of this game
    for (const p of pids) await call("POST", "/api/z/PRV-1/over", { pid: p }, {}, early);
    expect(raw.query("SELECT COUNT(*) c FROM overvote").get()).toEqual({ c: 0 }); // too early to count
    const afterTwenty = T - 2 * 3_600_000 + 400_000;
    await call("POST", "/api/z/PRV-1/over", { pid: pids[0] }, {}, afterTwenty); await call("POST", "/api/z/PRV-1/over", { pid: pids[0] }, {}, afterTwenty + 1000); // the same phone twice is one vote
    await call("POST", "/api/z/PRV-1/over", { pid: pids[1] }, {}, afterTwenty);
    expect(raw.query("SELECT COUNT(*) c FROM life WHERE end_src='phones'").get()).toEqual({ c: 0 }); // two of five is not enough
    await call("POST", "/api/z/PRV-1/over", { pid: pids[2] }, {}, afterTwenty + 5000);
    expect(raw.query("SELECT end_src, end_ms FROM life").get()).toEqual({ end_src: "phones", end_ms: afterTwenty + 5000 });
  });
});

describe("the report and the deletion", () => {
  const prep = async (n = 6) => {
    await create(); await call("PATCH", "/api/z/PRV-1/settings", { invites: { on: true, per: 4, cats: ["family", "colleagues"] } }, org, T - 4 * 3_600_000);
    await setContact("PRV-1");
    await joinAs(1, "Organizer Olga"); await call("POST", "/api/z/PRV-1/mark", { phone: "9876500001", role: "organizer" }, org, T - 3 * 3_600_000);
    for (let i = 2; i <= n; i++) await joinAs(i, i === 4 ? "Zed अन" : "Guest " + i, "PRV-1", { from: 1, cat: "family" });
    const pids = (raw.query("SELECT pid FROM seat ORDER BY seq").all() as any[]).map((x) => x.pid);
    await settleByPhones(call, "PRV-1", [{ pattern: "third", idx: 72, pids: [pids[2]!] }, { pattern: "first", idx: 30, pids: [pids[0]!, pids[3]!] }], pids);
    return pids;
  };
  /** What the report page does in the organizer's browser: asks for the base, then the people 250 at a time, then lays the PDF out on that device. */
  const buildReport = async (link: string) => {
    const u = new URL(link); const eid = u.searchParams.get("e")!, k = u.searchParams.get("k")!;
    const head = await j(await call("GET", `/api/report/${eid}?k=${k}&part=base`));
    const people: any[] = [];
    for (let i = 0; i < head.chunks; i++) people.push(...(await j(await call("GET", `/api/report/${eid}?k=${k}&part=people&i=${i}`))).people);
    const parts = Math.max(1, Math.ceil(head.totalPeople / head.partSize));
    const pdfs: Uint8Array[] = [];
    if (parts === 1) pdfs.push(layoutReport({ ...head.base, people }));
    else { pdfs.push(layoutReport({ ...head.base, people: [], omitPeople: true, totalPeople: head.totalPeople })); for (let i = 0; i < parts; i++) pdfs.push(layoutPeoplePart(head.base, people.slice(i * head.partSize, (i + 1) * head.partSize), i + 1, parts)); }
    return { head, people, pdfs, text: pdfs.map((x) => new TextDecoder("latin1").decode(x)).join("\n") };
  };
  const linkOf = (m: { text: string }) => (m.text.match(/https?:\/\/\S+\/report\.html\?e=[A-Za-z0-9_-]+&k=[0-9a-f]+/) ?? [""])[0];
  test("the report shows what each winner confirmed, whether they changed it, and whether the prize was given", async () => {
    const pids = await prep();
    const dev = String(3).padStart(32, "0"); // joinAs(3) used this device
    expect((await call("POST", "/api/z/PRV-1/confirm", { pid: pids[2], device: dev, name: "Gita Menon", phone: "9000000003" }, {}, T)).status).toBe(200);
    expect((await call("POST", "/api/z/PRV-1/prizegiven", { round: 1, pattern: "third", ordinal: 1, seat: 3, given: true }, org, T)).status).toBe(200);
    const end = await endBoundMs(env as any, raw.query("SELECT * FROM engagement WHERE id='PRV-1'").get());
    let guard = 0; while (!sentReports.length && guard++ < 20) await tick(end + 5 * 60_000);
    const r = await buildReport(linkOf(sentReports[0]!));
    expect(r.text).toContain("Gita Menon"); expect(r.text).toContain("90000 00003"); expect(r.text).toMatch(/details changed after the game/); expect(r.text).toMatch(/joined as Guest 3/);
  });
  test("22 hours after the end every participant record is gone (working copies too); the winners record, the organizer's details and the engagement stay", async () => {
    await prep();
    const e0 = raw.query("SELECT * FROM engagement WHERE id='PRV-1'").get();
    const end = await endBoundMs(env as any, e0);
    let guard = 0; while (!sentReports.length && guard++ < 20) await tick(end + 5 * 60_000);
    await tick(end + PURGE_AFTER_MS - 60_000);
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(6); // not yet
    const out = await tick(end + PURGE_AFTER_MS + 1000);
    expect(out.purged).toBe(1);
    for (const t of ["participant", "seat", "claim", "settled", "overvote"]) expect((raw.query(`SELECT COUNT(*) c FROM ${t}`).get() as any).c).toBe(0);
    expect((raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE 'rpt%' OR k LIKE 'seats-base%'").get() as any).c).toBe(0);
    const link = linkOf(sentReports[0]!);
    expect((await call("GET", `/api/report/PRV-1?k=${new URL(link).searchParams.get("k")}&part=base`)).status).toBe(404); // the link no longer opens anything
    expect((raw.query("SELECT COUNT(*) c FROM winner").get() as any).c).toBe(3); // what, which round, when, which seat
    expect(JSON.stringify(raw.query("SELECT * FROM winner").all())).not.toMatch(/Olga|Guest|98765/);
    expect(raw.query("SELECT v FROM kv WHERE k='contact/PRV-1'").get()).toBeTruthy(); expect(raw.query("SELECT id FROM engagement").get()).toEqual({ id: "PRV-1" });
    expect(JSON.stringify(raw.query("SELECT * FROM outbox").all())).not.toMatch(/Olga|Guest/);
    expect(personalDeleteAt(end)).toBe(end + PURGE_AFTER_MS); expect(PURGE_AFTER_MS).toBeLessThan(24 * 3_600_000);
  });
  test("even if the report could not be sent, the personal data is deleted on time (the promise does not wait for an e-mail)", async () => {
    await create(); await joinAs(1, "Asha"); // no organizer e-mail on record
    const end = await endBoundMs(env as any, raw.query("SELECT * FROM engagement WHERE id='PRV-1'").get());
    await tick(end + 5 * 60_000);
    expect(raw.query("SELECT report_state FROM life").get()).toEqual({ report_state: "no-email" }); expect(sentReports.length).toBe(0);
    await tick(end + PURGE_AFTER_MS + 1000);
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(0);
  });
  test("a big game: one link, the report page reads the people in pieces and lays out the parts on the device, which together list every person once", async () => {
    await create("PRV-BIG", { cap: 5000 }); await setContact("PRV-BIG");
    const N = 1620;
    for (let i = 1; i <= N; i++) {
      const pii = await sealPii(env as any, { phone: "9876" + String(100000 + i), name: "Person " + i });
      raw.run("INSERT INTO seat(eid,seq,pid,ph,dev,jr,inv,cat,src) VALUES(?,?,?,?,?,0,?,NULL,'link')", ["PRV-BIG", i, `${i}x${String(i).padStart(12, "0")}`, "h" + i, "d" + i, i > 1 ? Math.max(1, Math.floor(i / 3)) : null]);
      raw.run("INSERT INTO participant(eid,pid,phone_hash,name,pii,joined_ms) VALUES(?,?,?,NULL,?,?)", ["PRV-BIG", `${i}x${String(i).padStart(12, "0")}`, "h" + i, pii, T - 3 * 3_600_000 + i * 1000]);
    }
    const end = await endBoundMs(env as any, raw.query("SELECT * FROM engagement WHERE id='PRV-BIG'").get());
    let calls = 0; while (calls++ < 40) { await tick(end + 5 * 60_000); if (sentReports.length >= 1) break; }
    expect(sentReports.length).toBe(1); expect(sentReports[0]!.attachments.length).toBe(0);
    const r = await buildReport(linkOf(sentReports[0]!));
    expect(r.pdfs.length).toBe(3); // a summary and two people parts
    expect(r.people.length).toBe(N);
    expect(r.text).toMatch(/Person 1\b/); expect(r.text).toMatch(/Person 1620\b/); expect(r.text).toMatch(/1620 people/);
    expect((r.text.match(/Person 777\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(25);
  }, 120_000);
});

describe("exact deletion dates", () => {
  test("everything goes at 00:00 IST at the end of the 365th day: not a second earlier", async () => {
    const end = Date.UTC(2026, 9, 1, 10, 0, 0);
    const at = fullDeleteAt(end); const d = new Date(at + 5.5 * 3_600_000);
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]).toEqual([2027, 9, 2, 0, 0, 0]); // 2 Oct 2027, 00:00:00 IST
    expect(at).toBeGreaterThan(end + 365 * 86_400_000); expect(at - (end + 365 * 86_400_000)).toBeLessThanOrEqual(86_400_000);
    await create(); await call("POST", "/api/z/PRV-1/join", { phone: "9876543210", device: "a".repeat(32) }, {}, T - 3 * 3_600_000);
    const e0 = raw.query("SELECT * FROM engagement WHERE id='PRV-1'").get();
    const gameEnd = await endBoundMs(env as any, e0);
    await tick(gameEnd + 3600_000); // life row exists
    expect(await purgeOld(env, fullDeleteAt(gameEnd) - 1)).toBe(0);
    expect(raw.query("SELECT id FROM engagement").get()).toEqual({ id: "PRV-1" });
    expect(await purgeOld(env, fullDeleteAt(gameEnd))).toBe(1);
    for (const t of ["engagement", "life", "winner", "participant", "seat"]) expect((raw.query(`SELECT COUNT(*) c FROM ${t}`).get() as any).c).toBe(0);
    expect((raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE 'contact/%'").get() as any).c).toBe(0);
  });
  test("the scheduler's own door needs the platform key, and the console's Erase deletes personal data at once but keeps the winners record", async () => {
    await create(); await joinAs(1, "Asha"); await joinAs(2, "Bala");
    const pids = (raw.query("SELECT pid FROM seat ORDER BY seq").all() as any[]).map((x) => x.pid);
    await settleByPhones(call, "PRV-1", [{ pattern: "third", idx: 70, pids: [pids[1]!] }], pids);
    expect((await call("POST", "/api/lifecycle/tick")).status).toBe(403);
    expect((await call("POST", "/api/lifecycle/tick", {}, org)).status).toBe(200);
    expect((await call("POST", "/api/z/PRV-1/erase", {})).status).toBe(403);
    expect((await j(await call("POST", "/api/z/PRV-1/erase", {}, org))).erased).toBe(2);
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(0); expect((raw.query("SELECT COUNT(*) c FROM winner").get() as any).c).toBe(1);
  });
});

describe("asking for deletion", () => {
  const key = async () => { const r = await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "boss@acme.com" }) }), env, T); return (await j(r)) as { token: string; aiKey: string }; };
  test("an AI assistant can only ASK for a deletion: nothing is deleted until the organizer confirms in their console, and the organizer is e-mailed", async () => {
    const k = await key();
    await call("POST", "/api/z", { id: "PRV-AI", startRound: roundOf(T - 2 * 3_600_000), callSeconds: 6, cap: 100 }, { "x-organizer": k.token });
    await call("POST", "/api/z/PRV-AI/publish", { email: "boss@acme.com", phone: "9811122233" }, { "x-organizer": k.token }, T - 5 * 3_600_000);
    await joinAs(1, "Asha", "PRV-AI");
    expect((await call("POST", "/api/z/PRV-AI/erase", {}, { "x-organizer": k.aiKey })).status).toBe(403); // the AI key can never erase
    const ask = await call("POST", "/api/z/PRV-AI/control/request", { action: "erase", note: "organizer said delete" }, { "x-organizer": k.aiKey });
    expect(ask.status).toBe(200); expect((await j(ask)).message).toMatch(/Nothing has been deleted yet/);
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='PRV-AI'").get() as any).c).toBe(1);
    expect((await j(await call("GET", "/api/z/PRV-AI/control/request", undefined, { "x-organizer": k.token }))).requests[0].action).toBe("erase");
    const mail = raw.query("SELECT subject, body FROM outbox WHERE to_addr='boss@acme.com' ORDER BY id DESC LIMIT 1").get() as any;
    expect(mail.subject).toMatch(/asked to delete all participant data/); expect(mail.body).toMatch(/Nothing is deleted yet/);
    expect((await call("POST", "/api/z/PRV-AI/erase", {}, { "x-organizer": k.token })).status).toBe(200); // the organizer's own confirmation
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='PRV-AI'").get() as any).c).toBe(0);
  });
  test("an e-mail to us asking for a deletion works only from the organizer's registered address and with the right secret", async () => {
    (env as any).INBOUND_SECRET = "in-secret";
    await create("PRV-MAIL"); await setContact("PRV-MAIL", "boss@acme.com"); await joinAs(1, "Asha", "PRV-MAIL"); await joinAs(2, "Bala", "PRV-MAIL");
    const inbound = (b: unknown, secret = "in-secret") => call("POST", "/api/inbound-email", b, { "x-inbound-secret": secret });
    expect((await inbound({ from: "boss@acme.com", subject: "Delete PRV-MAIL" }, "wrong")).status).toBe(403);
    expect((await j(await inbound({ from: "Someone <stranger@evil.com>", subject: "Please delete PRV-MAIL", text: "delete everything" }))).action).toBe("no-match"); // not the organizer
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(2);
    expect((await j(await inbound({ from: "boss@acme.com", subject: "Hello", text: "thanks for the game PRV-MAIL" }))).action).toBe("none"); // no deletion wish
    // a forged sender is not enough: the first mail only sends a code to the REGISTERED address; nothing is deleted yet
    const first = await j(await inbound({ from: "The Boss <Boss@Acme.com>", subject: "Re: your report", text: "Please DELETE all the data of PRV-MAIL now." }));
    expect(first.action).toBe("confirm-sent"); expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(2);
    const ask = raw.query("SELECT to_addr, subject, body FROM outbox WHERE subject LIKE 'Confirm the deletion%' ORDER BY id DESC LIMIT 1").get() as any;
    expect(ask.to_addr).toBe("boss@acme.com"); const code = ask.body.match(/\b\d{6}\b/)[0];
    expect((await j(await inbound({ from: "Boss@acme.com", subject: "Re: Confirm", text: "delete PRV-MAIL code 000000" }))).action).not.toBe("deleted"); // a wrong code does nothing
    expect((await j(await inbound({ from: "stranger@evil.com", subject: "delete", text: "delete PRV-MAIL " + code }))).action).toBe("no-match"); // another sender, even with the code
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(2);
    expect((await j(await inbound({ from: "Boss@acme.com", subject: "Re: Confirm", text: "delete PRV-MAIL " + code }, "in-secret"))).action).toBe("deleted");
    expect((raw.query("SELECT COUNT(*) c FROM participant").get() as any).c).toBe(0);
    expect((await j(await inbound({ from: "Boss@acme.com", subject: "again", text: "delete PRV-MAIL " + code }))).action).not.toBe("deleted"); // the code works once
    const confirmation = raw.query("SELECT subject, body FROM outbox WHERE subject LIKE 'Deleted:%' ORDER BY id DESC LIMIT 1").get() as any;
    expect(confirmation.subject).toMatch(/Deleted: participant data of PRV-MAIL/); expect(confirmation.body).toMatch(/365 days/);
  });
  test("a deletion code expires after 30 minutes, and a second request within 5 minutes does not send a second code", async () => {
    (env as any).INBOUND_SECRET = "in-secret"; await create("PRV-MAIL2"); await setContact("PRV-MAIL2", "boss@acme.com"); await joinAs(1, "Asha", "PRV-MAIL2");
    const inb = (text: string, at = T) => call("POST", "/api/inbound-email", { from: "boss@acme.com", subject: "delete", text }, { "x-inbound-secret": "in-secret" }, at);
    expect((await j(await inb("delete PRV-MAIL2"))).action).toBe("confirm-sent"); await inb("delete PRV-MAIL2", T + 60_000);
    const mails = raw.query("SELECT body FROM outbox WHERE subject LIKE 'Confirm the deletion%'").all() as any[]; expect(mails.length).toBe(1);
    const code = mails[0].body.match(/\b\d{6}\b/)[0];
    expect((await j(await inb("delete PRV-MAIL2 " + code, T + 31 * 60_000))).action).not.toBe("deleted");
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='PRV-MAIL2'").get() as any).c).toBe(1);
  });
});

describe("the scheduled job's key", () => {
  test("the lifecycle tick accepts the platform key or the job's own key, and nothing else", async () => {
    (env as any).CRON_KEY = "job-key-0123456789abcdef";
    expect((await call("POST", "/api/lifecycle/tick", {}, { "x-cron-key": "wrong-wrong-wrong-wrong" })).status).toBe(403);
    expect((await call("POST", "/api/lifecycle/tick", {}, { "x-cron-key": "short" })).status).toBe(403);
    expect((await call("POST", "/api/lifecycle/tick", {})).status).toBe(403);
    expect((await call("POST", "/api/lifecycle/tick", {}, { "x-cron-key": "job-key-0123456789abcdef" })).status).toBe(200);
    expect((await call("POST", "/api/purge", {}, { "x-cron-key": "job-key-0123456789abcdef" })).status).toBe(403); // the job key opens only the one door
    delete (env as any).CRON_KEY;
    expect((await call("POST", "/api/lifecycle/tick", {}, { "x-cron-key": "job-key-0123456789abcdef" })).status).toBe(403);
  });
});

describe("silent news", () => {
  test("the public notice list is the same for everyone, empty by default, and only we (platform key) can publish; nothing about readers is stored", async () => {
    expect(await j(await call("GET", "/api/notices"))).toEqual({ notices: [] });
    expect((await call("POST", "/api/notices", { notices: [{ id: "n1", title: "Hello", body: "News" }] })).status).toBe(403);
    expect((await call("POST", "/api/notices", { notices: [{ id: "n1", title: "Hello", body: "News" }] }, { "x-organizer": "wrong" })).status).toBe(403);
    for (const bad of [{ notices: "x" }, { notices: [{ id: "n 1", title: "T", body: "b" }] }, { notices: [{ id: "n1", title: "", body: "b" }] }, { notices: [{ id: "n1", title: "T", body: "b", url: "https://evil.example" }] }, { notices: Array.from({ length: 11 }, (_, i) => ({ id: "n" + i, title: "T", body: "b" })) }]) expect((await call("POST", "/api/notices", bad, org)).status).toBe(400);
    expect((await call("POST", "/api/notices", { notices: [{ id: "buy-1", title: "New: games for 5,000 people", body: "Tap to see the new packs", url: "/#pricing" }] }, org)).status).toBe(200);
    const r = await call("GET", "/api/notices"); const b = await j(r);
    expect(b.notices).toEqual([{ id: "buy-1", title: "New: games for 5,000 people", body: "Tap to see the new packs", url: "/#pricing", at: T }]);
    expect(r.headers.get("cache-control")).toMatch(/public/);
    const old = await j(await call("GET", "/api/notices", undefined, {}, T + 31 * 86_400_000)); expect(old.notices).toEqual([]); // a month-old notice is gone
    expect((raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE 'notices%'").get() as any).c).toBe(1); // one list, no per-reader rows
  });
});
