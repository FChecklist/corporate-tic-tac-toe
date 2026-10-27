// Join behaviour per organizer setting and per country, written from the target matrix in docs/handover-2026-10-26/join_design.json
// (rows 1-7, 14, 17, 18). Expected values come from that design, not from recording what the code did. Replaces the temporary join-probe.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mob = (i: number) => "9" + String(100000000 + i);
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const join = (body: Record<string, unknown>) => call("POST", "/api/z/PPL-1/join", { name: "G", ...body }, undefined, T);
const rowsOf = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...(v as any[])) as any[];

async function setup(opts: { closed?: boolean; verify?: "mobile" | "id" | "both" | "either"; employeesOnly?: boolean } = {}) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "PPL-1", startRound: START, callSeconds: 6, cap: 100, ...(opts.closed ? { whoCanJoin: "list" } : {}) }, master);
  await call("POST", "/api/z/PPL-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  const body = { ...(opts.verify ? { verify: opts.verify } : {}), ...(opts.employeesOnly !== undefined ? { employeesOnly: opts.employeesOnly } : {}) };
  if (Object.keys(body).length) expect((await call("PATCH", "/api/z/PPL-1/settings", body, master)).status).toBe(200);
  return { master };
}
const add = (key: string, people: unknown[]) => call("POST", "/api/z/PPL-1/people", { people }, key);
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt" } as any; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); });
afterEach(() => { globalThis.fetch = realFetch; });
const card = async (r: Response) => { expect(r.status).toBe(200); const b = await j(r); expect(b.pid).toBeTruthy(); return b; };
const waits = async (r: Response) => { expect(r.status).toBe(403); expect((await j(r)).code).toBe("waiting"); };

describe("row 1 and 7: mobile number only", () => {
  test("an open game lets any valid number in at once", async () => {
    await setup(); await card(await join({ phone: mob(1), device: dev(1) }));
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1);
  });
  test("a list-only game: a listed number gets its card at once, an unlisted number waits and takes no place", async () => {
    const t = await setup({ closed: true }); await add(t.master, [{ name: "Asha", phone: mob(1) }]);
    await card(await join({ phone: mob(1), device: dev(1) }));
    await waits(await join({ phone: mob(2), device: dev(2) }));
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1);
  });
  test("a number with fewer than 8 digits in all, or with letters, is refused and nothing is stored", async () => {
    await setup();
    expect((await join({ phone: "+1234567", device: dev(1) })).status).toBe(400);
    expect((await join({ phone: "98abc43210", device: dev(2) })).status).toBe(400);
    expect((await join({ device: dev(3) })).status).toBe(400); // blank
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(0);
  });
});

describe("row 2: employee ID only, employees only", () => {
  test("a listed ID gets the card, with or without a mobile typed; the mobile is never a reason to refuse", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    await add(t.master, [{ name: "Asha Rao", empId: "E101", phone: mob(1) }, { name: "Ravi", empId: "E102" }, { name: "Meera", empId: "E103" }]);
    await card(await join({ empId: "E101", device: dev(1) }));
    await card(await join({ empId: "E102", phone: mob(77), device: dev(2) })); // some other mobile typed: kept as contact, not a reason to refuse
    await card(await join({ empId: "e103", device: dev(3) })); // case does not matter
  });
  test("an ID that is not on the list waits for the organizer; no ID at all is refused, and a mobile alone does not replace the ID", async () => {
    const t = await setup({ verify: "id", employeesOnly: true }); await add(t.master, [{ name: "Asha", empId: "E101", phone: mob(1) }]);
    await waits(await join({ empId: "E555", device: dev(1) }));
    const none = await join({ phone: mob(1), device: dev(2) }); expect(none.status).toBe(400); expect((await j(none)).code).toBe("need-id");
    expect((await join({ device: dev(3) })).status).toBe(400);
  });
  test("one ID, one card: the same ID from a second phone is refused (423 id-used), the first phone still gets its card back", async () => {
    const t = await setup({ verify: "id", employeesOnly: true }); await add(t.master, [{ name: "Asha", empId: "E101" }]);
    const a = await card(await join({ empId: "E101", device: dev(1) }));
    const second = await join({ empId: "E101", device: dev(2) }); expect(second.status).toBe(423); expect((await j(second)).code).toBe("id-used");
    expect((await card(await join({ empId: "E101", device: dev(1) }))).pid).toBe(a.pid);
  });
});

describe("row 3, 4, 5, 6: ID and mobile together", () => {
  test("ID, others by mobile (not employees only): a listed ID and an outsider's mobile both get tickets; an unknown ID waits", async () => {
    const t = await setup({ verify: "id" }); await add(t.master, [{ name: "Asha", empId: "E101" }]);
    await card(await join({ empId: "E101", device: dev(1) }));
    await card(await join({ phone: mob(22), device: dev(2) }));
    await waits(await join({ phone: mob(23), empId: "E555", device: dev(3) })); // D4: today's behaviour in an open game
    expect((await join({ device: dev(4) })).status).toBe(400);
  });
  test("mobile always, ID if employee (both, not employees only): a non-employee needs only a mobile; a listed employee must give the matching ID", async () => {
    const t = await setup({ verify: "both" }); await add(t.master, [{ name: "Asha Rao", empId: "E101", phone: mob(1) }]);
    await card(await join({ phone: mob(22), device: dev(1) })); // not on the list: a mobile is enough
    const noId = await join({ phone: mob(1), device: dev(2) }); expect(noId.status).toBe(400); expect((await j(noId)).code).toBe("need-id"); // on the list with an ID: the ID is asked
    await card(await join({ phone: mob(1), empId: "E101", device: dev(3) }));
  });
  test("both compulsory, employees only: a listed mobile with a DIFFERENT ID waits", async () => {
    const t = await setup({ verify: "both", employeesOnly: true }); await add(t.master, [{ name: "Asha Rao", empId: "E101", phone: mob(1) }]);
    await waits(await join({ phone: mob(1), empId: "E555", device: dev(1) }));
    await card(await join({ phone: mob(1), empId: "E101", device: dev(2) }));
  });
  test("ID or mobile (either): the listed ID wins, a listed mobile alone also works, an unknown pair waits", async () => {
    const t = await setup({ verify: "either", employeesOnly: true }); await add(t.master, [{ name: "Asha", empId: "E101" }, { name: "Ravi", phone: mob(2) }]);
    await card(await join({ empId: "E101", device: dev(1) }));
    await card(await join({ phone: mob(2), device: dev(2) }));
    await waits(await join({ phone: mob(9), empId: "E555", device: dev(3) }));
    expect((await join({ device: dev(4) })).status).toBe(400);
  });
});

describe("row 14, 17, 18: waiting, returning phone, second phone", () => {
  test("a waiting request uses no place; once admitted the same person joins and gets a card", async () => {
    const t = await setup({ closed: true });
    await waits(await join({ phone: mob(5), device: dev(5) }));
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(0);
    const w = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting; expect(w).toHaveLength(1);
    expect((await call("POST", `/api/z/PPL-1/waiting/${w[0].id}`, { decision: "admit" }, t.master)).status).toBe(200);
    await card(await join({ phone: mob(5), device: dev(5) }));
  });
  test("the same phone again gets the same card; a second phone for the same number is refused (423 other-phone) and gets no second card", async () => {
    await setup();
    const a = await card(await join({ phone: mob(1), device: dev(1) }));
    expect((await card(await join({ phone: mob(1), device: dev(1) }))).pid).toBe(a.pid);
    const other = await join({ phone: mob(1), device: dev(2) }); expect(other.status).toBe(423); expect((await j(other)).code).toBe("other-phone");
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1);
  });
});

describe("countries", () => {
  test("numbers of any country with 8 to 15 digits in all get a card; the same person typed another way is the same person", async () => {
    await setup();
    await card(await join({ phone: "+6591234567", device: dev(1) })); // Singapore, 10 digits in all
    await card(await join({ phone: "+68212345", device: dev(2) })); // Cook Islands, 8 digits in all: a short table row must never lock someone out
    const uk = await card(await join({ phone: "+44 7911 123456", device: dev(3) }));
    expect((await card(await join({ phone: "0044 7911 123456", device: dev(3) }))).pid).toBe(uk.pid); // 00 and + are the same
    const india = await card(await join({ phone: "+91 98765 43210", device: dev(4) }));
    const other = await join({ phone: "9876543210", device: dev(5) }); expect(other.status).toBe(423); // bare Indian number = the same person on another phone
    expect((await card(await join({ phone: "098765 43210", device: dev(4) }))).pid).toBe(india.pid);
  });
  test("the kept form: India as 91 + 10 digits, any other country as +<code><number>", async () => {
    await setup(); await join({ phone: "98765 43210", device: dev(1) }); await join({ phone: "+44 7911 123456", device: dev(2) });
    const kept = rowsOf("SELECT pii FROM participant").length; expect(kept).toBe(2);
  });
});
