// Gaps found by reading the join code (docs/flow/01-join-verify-approval.md, section 5), fixed in worker.ts and pinned here, each by a test that fails on the old code:
// GAP-06 a NEW person could join after the game was over; GAP-07 a game that could not begin (unpaid, past its lock time) still seated new people;
// GAP-03 a person the organizer ADMITTED in mode "both" was asked for the (wrong) ID again for ever and stayed in "waiting";
// GAP-01 an unbound card (organizer pressed "send link again") was handed to a request that sent no device at all.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HOUR, T, W, call, capture, checkout, create, dev, j, join, keyH, mob, organizer, paidGame, publish, reset, restore, roundMs, startIn, uid, verify } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);
const DAY30 = 30 * 24 * HOUR;

describe("join gaps", () => {
  test("GAP-06 (decided: designed behaviour): a person who opens the link after the game is over still gets a card, so the page can show the thank-you and share button; a person who already holds one gets it back", async () => {
    const g = await paidGame({ cap: 20 });
    expect((await join(g.id, 1)).status).toBe(200);
    expect((await join(g.id, 2, {}, T + DAY30)).status).toBe(200);
    const again = await join(g.id, 1, {}, T + DAY30);
    expect(again.status).toBe(200); expect((await j(again)).again).toBe(true);
  });
  test("GAP-07: an unpaid game at its lock time seats no new person (403 locked); before the lock the same join works", async () => {
    const o = await organizer(), id = uid();
    expect((await create(o.key, id, { cap: 20 })).status).toBe(200);
    expect((await publish(o.key, id)).status).toBe(200);
    expect((await join(id, 1)).status).toBe(200);
    const locked = await join(id, 2, {}, roundMs(startIn(2 * HOUR)) - 10_000);
    expect(locked.status).toBe(403); expect((await j(locked)).code).toBe("locked");
  });
  test("GAP-03: in mode 'both' a person admitted by the organizer gets in with the ID they typed, instead of waiting for ever", async () => {
    const g = await paidGame({ cap: 20, over: { whoCanJoin: "list" } });
    expect((await call("PATCH", `/api/z/${g.id}/settings`, { verify: "both", employeesOnly: true }, keyH(g.key))).status).toBe(200);
    expect((await call("POST", `/api/z/${g.id}/people`, { people: [{ name: "Asha Rao", empId: "E1", phone: mob(1) }] }, keyH(g.key))).status).toBe(200);
    const first = await join(g.id, 1, { empId: "E2" }); // listed number, wrong ID: the organizer decides
    expect(first.status).toBe(403); expect((await j(first)).waiting).toBe(true);
    const row = (await j(await call("GET", `/api/z/${g.id}/waiting`, undefined, keyH(g.key)))).waiting[0];
    expect(row).toBeTruthy();
    expect((await call("POST", `/api/z/${g.id}/waiting/${row.id}`, { decision: "admit" }, keyH(g.key))).status).toBe(200);
    const again = await join(g.id, 1, { empId: "E2" }); // the phone sends the same request again after the yes
    expect(again.status).toBe(200); expect((await j(again)).pid).toBeTruthy();
  });
  test("GAP-J1: an Indian number that cannot be a mobile (first digit 5) is refused on join like it is in a list; real Indian and foreign numbers still join", async () => {
    const g = await paidGame({ cap: 30 });
    for (const bad of ["5876543210", "+91 5876543210", "915876543210", "05876543210", "+999 123 456 789", "+0 1234567890"]) {
      const r = await join(g.id, 1, { phone: bad, device: dev(1) }); expect([bad, r.status]).toEqual([bad, 400]);
    }
    let i = 10;
    for (const good of ["9876543210", "+91 98765 43211", "919876543212", "09876543213", "+6591234567", "+44 7911 123456", "+2547123456789", "0091 98765 43214", "0065 9123 4568"]) {
      const r = await join(g.id, ++i, { phone: good, device: dev(i) }); expect([good, r.status]).toEqual([good, 200]);
    }
  });
  test("organizer settings: plain sentences instead of 'check the details', an invalid 'who can join' is refused at creation, a size under the listed people is refused", async () => {
    const o = await organizer();
    const bad = async (over: Record<string, unknown>, re: RegExp) => { const r = await create(o.key, uid(), over); expect(r.status).toBe(400); expect((await j(r)).error).toMatch(re); };
    await bad({ cap: 0 }, /number of people/i);
    await bad({ cap: 2.5 }, /number of people/i);
    await bad({ callSeconds: 4 }, /gap|seconds/i);
    await bad({ whoCanJoin: "LIST" }, /who can join/i);
    await bad({ whoCanJoin: "everybody" }, /who can join/i);
    const g = await paidGame({ cap: 20, over: { whoCanJoin: "list" } });
    expect((await call("POST", `/api/z/${g.id}/people`, { people: Array.from({ length: 15 }, (_, i) => ({ name: "P" + i, phone: mob(i + 50) })) }, keyH(g.key))).status).toBe(200);
    const r = await call("PATCH", `/api/z/${g.id}/settings`, { cap: 10 }, keyH(g.key));
    expect(r.status).toBe(409); expect((await j(r)).error).toMatch(/lower than the people/i);
    expect((await call("PATCH", `/api/z/${g.id}/settings`, { cap: 15 }, keyH(g.key))).status).toBe(200);
  });
  test("G8: unsigned or forged posts to /control do not use up the day's write budget (it was charged before the signature was checked)", async () => {
    const g = await paidGame({ cap: 20 });
    const used = () => (W.raw.prepare("SELECT COALESCE(SUM(writes),0) AS w FROM usage").get() as any).w as number;
    const before = used();
    for (let i = 0; i < 6; i++) {
      const r = await call("POST", `/api/z/${g.id}/control`, { message: { forged: i, sig: "00".repeat(32) } });
      expect(r.status).toBeLessThan(500); expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect((await call("POST", `/api/z/${g.id}/control`, "not a message")).status).toBeGreaterThanOrEqual(400);
    expect(used()).toBe(before); // nothing was charged for what was refused
  });
  test("forged votes and a forged 'game over' (public card ids, no device proof) are refused with 403; the phone that holds the card is accepted", async () => {
    const T2 = Date.UTC(2026, 9, 25, 10, 0, 0), start = Math.floor(((T2 + 2 * HOUR) / 1000 - 1692803367) / 3) + 1; // a game made after the check-in cutoff
    const o = await organizer(), id = uid();
    expect((await create(o.key, id, { cap: 20, startRound: start }, T2)).status).toBe(200);
    expect((await publish(o.key, id, undefined as any, T2)).status).toBe(200);
    const pid = (await j(await join(id, 1, {}, T2))).pid as string; expect(pid).toBeTruthy();
    const vote = (extra: Record<string, unknown>) => call("POST", `/api/z/${id}/vote`, { pid, results: [{ pattern: "early5", ordinal: 1, round: 1, idx: 7, pids: [pid] }], ...extra }, {}, T2);
    const over = (extra: Record<string, unknown>) => call("POST", `/api/z/${id}/over`, { pid, ...extra }, {}, T2);
    for (const r of [await vote({}), await vote({ device: dev(99) }), await over({}), await over({ device: dev(99) })]) { expect(r.status).toBe(403); expect((await j(r)).code).toBe("other-phone"); }
    expect((await vote({ device: dev(1) })).status).toBe(200);
    expect((await over({ device: dev(1) })).status).toBe(200);
  });
  test("the organizer has the final say: /prizes offers the claimants, /override gives the prize to one of them or to nobody, with a record; strangers, Co-hosts and non-claimants cannot", async () => {
    const g = await paidGame({ cap: 20 });
    const a = (await j(await join(g.id, 1))).pid as string, b = (await j(await join(g.id, 2))).pid as string, c = (await j(await join(g.id, 3))).pid as string;
    const seatOf = (p: string) => Number(p.split("x")[0]);
    for (const p of [a, b]) W.raw.prepare("INSERT INTO claim(eid,pid,pattern,round,idx,at_ms) VALUES(?,?,?,?,?,?)").run(g.id, p, "early5", 1, 7, T);
    const pii = (W.raw.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").get(g.id, a) as any).pii;
    W.raw.prepare("INSERT INTO prize(eid,round,pattern,ordinal,seat,pii,orig) VALUES(?,?,?,?,?,?,?)").run(g.id, 1, "early5", 1, seatOf(a), pii, pii);
    const list = await j(await call("GET", `/api/z/${g.id}/prizes`, undefined, keyH(g.key)));
    expect(list.prizes[0]).toMatchObject({ canOverride: true }); expect(list.prizes[0].claimants.map((x: any) => x.seat).sort()).toEqual([seatOf(a), seatOf(b)].sort());
    const ov = (body: Record<string, unknown>, key = g.key) => call("POST", `/api/z/${g.id}/override`, body, keyH(key));
    expect((await call("POST", `/api/z/${g.id}/override`, { round: 1, pattern: "early5", ordinal: 1, seat: seatOf(b) })).status).toBe(403); // a stranger
    expect((await ov({ round: 1, pattern: "early5", ordinal: 1, seat: seatOf(c) })).status).toBe(409); // c never claimed it
    expect((await ov({ round: 1, pattern: "early5", ordinal: 1, seat: seatOf(b) })).status).toBe(200);
    expect((W.raw.prepare("SELECT seat FROM prize WHERE eid=? AND pattern='early5'").all(g.id) as any[]).map((r) => r.seat)).toEqual([seatOf(b)]);
    expect((W.raw.prepare("SELECT COUNT(*) AS n FROM kv WHERE k LIKE ?").get(`override/${g.id}/%`) as any).n).toBe(1); // the change is recorded
    expect((await ov({ round: 1, pattern: "early5", ordinal: 1, seat: null })).status).toBe(200);
    expect((W.raw.prepare("SELECT COUNT(*) AS n FROM prize WHERE eid=?").get(g.id) as any).n).toBe(0);
    expect((await ov({ round: 1, pattern: "early5", ordinal: 1, seat: null })).status).toBe(404); // nothing left to change
  });
  test("erasing all participants' data is refused while the game is being played (409 game-running) and allowed before and after", async () => {
    const g = await paidGame({ cap: 20 });
    expect((await join(g.id, 1)).status).toBe(200);
    const mid = roundMs(startIn(2 * HOUR)) + 60_000; // one minute after the first round of the game
    const r = await call("POST", `/api/z/${g.id}/erase`, {}, keyH(g.key), mid);
    expect(r.status).toBe(409); expect((await j(r)).code).toBe("game-running");
    expect((W.raw.prepare("SELECT COUNT(*) AS n FROM participant WHERE eid=?").get(g.id) as any).n).toBe(1); // nothing was deleted
    expect((await call("POST", `/api/z/${g.id}/erase`, {}, keyH(g.key), mid + 30 * 24 * HOUR)).status).toBe(200);
    expect((W.raw.prepare("SELECT COUNT(*) AS n FROM participant WHERE eid=?").get(g.id) as any).n).toBe(0);
  });
  test("O-04: a size raised while the payment window was open never ends above the pack that was paid for", async () => {
    const o = await organizer(), id = uid();
    expect((await create(o.key, id, { cap: 100 })).status).toBe(200);
    expect((await publish(o.key, id)).status).toBe(200);
    const c = await checkout(o.key, { eid: id, email: o.email }); expect(c.status).toBe(200); // pack 100 is being paid
    expect((await call("PATCH", `/api/z/${id}/settings`, { cap: 600 }, keyH(o.key))).status).toBe(200); // the organizer raises the size in another tab
    capture(c.body, "pay_" + id); expect((await verify(c.body, "pay_" + id)).status).toBe(200);
    const row = W.raw.prepare("SELECT pack, cap FROM engagement WHERE id=?").get(id) as any;
    expect(row.pack).toBe(100); expect(row.cap).toBeLessThanOrEqual(100);
  });
  test("a Host's narrow AI work link cannot register keys or file pause / stop / erase requests (permissions family)", async () => {
    const g = await paidGame({ cap: 20 });
    const hostKey = (await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500001" }, keyH(g.key)))).hostKey as string;
    const link = { "x-organizer": hostKey, "x-cb-link": "1" };
    for (const [m, p, b] of [["POST", `/api/z/${g.id}/control/request`, { action: "stop" }], ["GET", `/api/z/${g.id}/control/request`, undefined], ["PUT", `/api/z/${g.id}/control/key`, { publicKey: "00".repeat(32) }]] as const) {
      const r = await call(m, p, b, link); expect([m, p.slice(-16), r.status]).toEqual([m, p.slice(-16), 403]);
    }
    expect((await call("GET", `/api/z/${g.id}/control`, undefined, link)).status).not.toBe(403); // reading the public pause file stays allowed
  });
  test("GAP-01: an unbound card is handed back only to a phone that sends its device proof (400 without it, 200 with it)", async () => {
    const g = await paidGame({ cap: 20 });
    expect((await join(g.id, 1)).status).toBe(200);
    W.raw.prepare("UPDATE seat SET dev=NULL WHERE eid=?").run(g.id); // what 'send link again' does
    const noDev = await join(g.id, 1, { device: undefined });
    expect(noDev.status).toBe(400);
    const withDev = await join(g.id, 1, { device: dev(1) });
    expect(withDev.status).toBe(200); expect((await j(withDev)).again).toBe(true);
  });
});
