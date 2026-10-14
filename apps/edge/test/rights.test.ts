// A player's own rights, with no account: leave at any time (U5), and "what do you hold about me / correct / delete me" with a promised answer time (U6, D7).
// Through the real Worker code and a real SQLite. Mail is read from the local outbox (no mail key in tests).
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { erasePersonal } from "../src/lifecycle";
import { PROMISE_DAYS, PROMISE_TEXT, MAX_REQUESTS_PER_PLAYER, NOUN } from "../src/rights";
import { OWNER_NOTIFY_EMAIL } from "../src/owner-mail";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200; // 1 hour ahead of T
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0; let orgMail = "";
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => String(i).padStart(2, "0").repeat(16); // 32 hex characters
const mails = () => raw.query("SELECT to_addr, subject, body FROM outbox ORDER BY id").all() as { to_addr: string; subject: string; body: string }[];
async function game(id: string) {
  orgMail = `org${++n}@acme.com`;
  const r = await j(await call("POST", "/api/start", { email: orgMail }, { "cf-connecting-ip": `10.0.0.${n}` }));
  const h = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
  return h;
}
const joinAs = async (id: string, i: number, name = `Player ${i}`) => { const r = await call("POST", `/api/z/${id}/join`, { name, device: dev(i) }); expect(r.status).toBe(200); return (await j(r)).pid as string; };
const leave = (id: string, pid: string, device: string) => call("POST", `/api/z/${id}/leave`, { pid, device });
const ask = (id: string, pid: string, device: string, kind: string, extra: Record<string, unknown> = {}, now = T) => call("POST", `/api/z/${id}/datareq`, { pid, device, kind, ...extra }, {}, now);
const count = (sql: string, ...a: any[]) => (raw.prepare(sql).get(...a) as any).c as number;

beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; });

describe("U5: a player can leave at any time", () => {
  test("before the game starts the seat, the name and the consent record are deleted, and the answer says so in plain words", async () => {
    await game("LV-1");
    const a = await joinAs("LV-1", 1, "Maya Lopez"); await joinAs("LV-1", 2, "Other Person");
    expect(count("SELECT COUNT(*) c FROM seat WHERE eid='LV-1'")).toBe(2);
    const r = await leave("LV-1", a, dev(1)); expect(r.status).toBe(200);
    const b = await j(r); expect(b.left).toBe(true); expect(b.message).toMatch(/you have left the game/i); expect(b.message).toMatch(/deleted/i);
    expect(count("SELECT COUNT(*) c FROM seat WHERE pid=?", a)).toBe(0);
    expect(count("SELECT COUNT(*) c FROM participant WHERE pid=?", a)).toBe(0);
    expect(count("SELECT COUNT(*) c FROM consent_log WHERE subject=?", a)).toBe(0);
    expect(count("SELECT COUNT(*) c FROM seat WHERE eid='LV-1'")).toBe(1); // the other player is untouched
    expect(JSON.stringify(raw.query("SELECT * FROM participant").all())).not.toContain("Maya");
  });
  test("after the Organizer has started the tournament the player stays in the draw by id (the plan lists ids) but holds no name", async () => {
    const h = await game("LV-2");
    const a = await joinAs("LV-2", 1, "Maya Lopez"); await joinAs("LV-2", 2);
    expect((await call("POST", "/api/z/LV-2/ttt/start", { format: "solo", moveSecs: 20 }, h)).status).toBe(200);
    expect(raw.query("SELECT name FROM ttt_p WHERE pid=?").get(a)).toEqual({ name: "Maya Lopez" });
    const r = await leave("LV-2", a, dev(1)); expect(r.status).toBe(200);
    const row = raw.query("SELECT pii, name FROM participant WHERE pid=?").get(a) as any; expect(row.pii).toBeNull(); expect(row.name).toBeNull();
    expect((raw.query("SELECT blocked FROM seat WHERE pid=?").get(a) as any).blocked).toBe(1);
    expect(raw.query("SELECT name FROM ttt_p WHERE pid=?").get(a)).toEqual({ name: "Left player" }); // still on the roster, so the draw the Organizer sends next is accepted
    expect(JSON.stringify(raw.query("SELECT * FROM ttt_p").all())).not.toContain("Maya");
    expect(JSON.parse((raw.query("SELECT v FROM kv WHERE k='seats-blk/LV-2'").get() as any).v)).toContain(a);
  });
  test("only the player's own phone can do it: another phone, a stranger's card id, a missing device and a made-up id are all refused", async () => {
    await game("LV-3");
    const a = await joinAs("LV-3", 1), b = await joinAs("LV-3", 2);
    expect((await leave("LV-3", a, dev(2))).status).toBe(403); // player 2's phone, player 1's card
    expect((await leave("LV-3", b, dev(1))).status).toBe(403);
    expect((await leave("LV-3", a, dev(9))).status).toBe(403); // a phone that never joined
    expect((await call("POST", "/api/z/LV-3/leave", { pid: a })).status).toBe(400); // no device
    expect((await call("POST", "/api/z/LV-3/leave", { pid: "nope!", device: dev(1) })).status).toBe(400);
    expect(count("SELECT COUNT(*) c FROM seat WHERE eid='LV-3'")).toBe(2);
    expect((await leave("LV-3", a, dev(1))).status).toBe(200);
    expect((await leave("LV-3", a, dev(1))).status).toBe(403); // already gone: nothing to leave
  });
  test("a player who left may join again later as a new player (before the game starts)", async () => {
    await game("LV-4");
    const a = await joinAs("LV-4", 1); expect((await leave("LV-4", a, dev(1))).status).toBe(200);
    const again = await joinAs("LV-4", 1, "Maya Again"); expect(again).toBeTruthy();
  });
  test("a cancelled game still lets a player leave", async () => {
    const h = await game("LV-5");
    const a = await joinAs("LV-5", 1);
    expect((await call("POST", "/api/z/LV-5/cancel", { confirmations: 3 }, h)).status).toBe(200);
    expect((await leave("LV-5", a, dev(1))).status).toBe(200);
  });
});

describe("U6 / D7: what do you hold about me, correct it, delete me", () => {
  test("access: the player is shown what is held, the promised time is 7 days, the organizer and the owner are told by e-mail", async () => {
    await game("RQ-1");
    const a = await joinAs("RQ-1", 1, "Maya Lopez");
    const r = await ask("RQ-1", a, dev(1), "access"); expect(r.status).toBe(200);
    const b = await j(r);
    expect(PROMISE_DAYS).toBe(7); expect(b.promiseDays).toBe(7); expect(b.promise).toBe("within 7 days"); expect(PROMISE_TEXT).toBe("within 7 days");
    expect(b.answerByMs).toBe(T + 7 * 86_400_000); expect(b.status).toBe("open");
    expect(b.message).toMatch(/within 7 days/);
    const held = JSON.stringify(b.held); expect(held).toContain("Maya Lopez"); expect(held).toMatch(new RegExp(NOUN + " number", "i"));
    const row = raw.query("SELECT * FROM data_request").get() as any;
    expect(row).toMatchObject({ eid: "RQ-1", pid: a, kind: "access", status: "open", created_ms: T, due_ms: T + 7 * 86_400_000 });
    // mail: the organizer's own address and the owner's address, each once
    const m = mails(); const toOrg = m.filter((x) => x.to_addr === orgMail && /data request/i.test(x.subject)); const toOwner = m.filter((x) => x.to_addr === OWNER_NOTIFY_EMAIL);
    expect(OWNER_NOTIFY_EMAIL).toBe("raajat.agarwal@gmail.com");
    expect(toOrg.length).toBe(1); expect(toOwner.length).toBe(1);
    expect(toOrg[0]!.body).toContain("within 7 days"); expect(toOrg[0]!.body).toContain("Maya Lopez"); expect(toOrg[0]!.body).toContain(NOUN[0]!.toUpperCase() + NOUN.slice(1) + " number: 1");
    expect(toOwner[0]!.body).toContain("within 7 days"); expect(toOwner[0]!.body).not.toContain("Maya"); // the owner's note names no player
  });
  test("asking the same thing twice while it is open gives the first answer and sends no second e-mail", async () => {
    await game("RQ-2"); const a = await joinAs("RQ-2", 1);
    const first = await j(await ask("RQ-2", a, dev(1), "access")); const before = mails().length;
    const second = await j(await ask("RQ-2", a, dev(1), "access")); expect(second.again).toBe(true); expect(second.id).toBe(first.id);
    expect(mails().length).toBe(before); expect(count("SELECT COUNT(*) c FROM data_request")).toBe(1);
  });
  test("correction needs a note and goes to the organizer with the note", async () => {
    await game("RQ-3"); const a = await joinAs("RQ-3", 1, "Maia Lopes");
    expect((await ask("RQ-3", a, dev(1), "correction")).status).toBe(400);
    const r = await ask("RQ-3", a, dev(1), "correction", { note: "My name is spelled Maya Lopez" }); expect(r.status).toBe(200);
    const m = mails().find((x) => x.to_addr === orgMail && /data request/i.test(x.subject))!; expect(m.body).toContain("Maya Lopez"); expect(m.body).toContain("correct");
    expect((raw.query("SELECT note FROM data_request").get() as any).note).toBe("My name is spelled Maya Lopez");
  });
  test("erasure removes the player at once with the same code as leaving, the request is closed, and both mails say so", async () => {
    await game("RQ-4"); const a = await joinAs("RQ-4", 1, "Maya Lopez"); await joinAs("RQ-4", 2);
    const r = await ask("RQ-4", a, dev(1), "erasure"); expect(r.status).toBe(200);
    const b = await j(r); expect(b.erased).toBe(true); expect(b.status).toBe("done"); expect(b.message).toMatch(/deleted/i);
    expect(count("SELECT COUNT(*) c FROM seat WHERE pid=?", a)).toBe(0); expect(count("SELECT COUNT(*) c FROM participant WHERE pid=?", a)).toBe(0);
    expect((raw.query("SELECT status, done_ms FROM data_request").get() as any)).toEqual({ status: "done", done_ms: T });
    const m = mails(); expect(m.some((x) => x.to_addr === orgMail && /deleted at once/i.test(x.body))).toBe(true); expect(m.some((x) => x.to_addr === OWNER_NOTIFY_EMAIL && /Deleted at once/.test(x.body))).toBe(true);
    expect(m.map((x) => x.body).join("\n")).not.toContain("Maya"); // the player's name is in no mail about an erasure
    expect(count("SELECT COUNT(*) c FROM seat WHERE eid='RQ-4'")).toBe(1);
  });
  test("a request cannot be made for another player: wrong phone, wrong card, no device are refused and nothing is stored or mailed", async () => {
    await game("RQ-5"); const a = await joinAs("RQ-5", 1), b = await joinAs("RQ-5", 2); const before = mails().length;
    for (const kind of ["access", "correction", "erasure", "status"]) {
      expect((await ask("RQ-5", a, dev(2), kind, { note: "x y" })).status).toBe(403);
      expect((await ask("RQ-5", b, dev(1), kind, { note: "x y" })).status).toBe(403);
    }
    expect((await call("POST", "/api/z/RQ-5/datareq", { pid: a, kind: "erasure" })).status).toBe(400);
    expect(count("SELECT COUNT(*) c FROM data_request")).toBe(0); expect(count("SELECT COUNT(*) c FROM seat WHERE eid='RQ-5'")).toBe(2); expect(mails().length).toBe(before);
  });
  test("the status call lists only the player's own requests", async () => {
    await game("RQ-6"); const a = await joinAs("RQ-6", 1), b = await joinAs("RQ-6", 2);
    await ask("RQ-6", a, dev(1), "access"); await ask("RQ-6", b, dev(2), "correction", { note: "fix it" });
    const mine = await j(await ask("RQ-6", a, dev(1), "status")); expect(mine.requests.length).toBe(1); expect(mine.requests[0].kind).toBe("access"); expect(mine.promise).toBe("within 7 days");
  });
  test("an unknown kind is refused, and a player cannot send more than the limit", async () => {
    await game("RQ-7"); const a = await joinAs("RQ-7", 1);
    expect((await ask("RQ-7", a, dev(1), "sell-my-data")).status).toBe(400);
    for (let i = 0; i < MAX_REQUESTS_PER_PLAYER; i++) raw.prepare("INSERT INTO data_request(id,eid,pid,kind,note,created_ms,due_ms,status) VALUES(?,?,?,?,?,?,?,?)").run("x" + i, "RQ-7", a, "access", null, T, T, "done");
    expect((await ask("RQ-7", a, dev(1), "correction", { note: "again please" })).status).toBe(429);
  });
  test("TEST mode: the organizer's mail is held back as always, but the note to the owner still goes", async () => {
    await game("RQ-8"); const a = await joinAs("RQ-8", 1);
    expect((await call("POST", "/api/owner/mode", { mode: "TEST", reason: "rehearsal" }, { "x-organizer": "plat" })).status).toBe(200);
    expect((await ask("RQ-8", a, dev(1), "access")).status).toBe(200);
    const m = mails().filter((x) => /data request/i.test(x.subject)); expect(m.map((x) => x.to_addr)).toEqual([OWNER_NOTIFY_EMAIL]); expect(m[0]!.subject.startsWith("[TEST]")).toBe(true);
  });
});

describe("the request rows do not outlive the game", () => {
  test("they are deleted with the game's other participant data (23 hours after the end), and with the game itself", async () => {
    await game("RQ-9"); const a = await joinAs("RQ-9", 1);
    await ask("RQ-9", a, dev(1), "access");
    expect(count("SELECT COUNT(*) c FROM data_request")).toBe(1);
    await erasePersonal(env as any, "RQ-9", T + 30 * 3_600_000, "test");
    expect(count("SELECT COUNT(*) c FROM data_request")).toBe(0);
  });
  test("the deletion code names the table (so a new table cannot be forgotten)", async () => {
    const life = await Bun.file(new URL("../src/lifecycle.ts", import.meta.url)).text();
    expect((life.match(/DELETE FROM data_request/g) ?? []).length).toBeGreaterThanOrEqual(2); // erasePersonal and deleteEngagementRows
  });
});
