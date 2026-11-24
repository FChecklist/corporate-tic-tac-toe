// v1.6.3, fourth audit round of PR 9 (24 Nov 2026, head 4fe14715), the SECURITY audit: M-1 (one address could shut every listed guest out of ID entry), M-2 (the waiting room could be filled by a script:
// per-game limit on new requests, one-tap close and clear, a proof of work on the no-ID path), M-3 (a Host belongs to one game: no Host without a game, no game access for old Hosts with none, `/api/org/*` checks the game),
// and Low 1 (one player cannot fill a board). Every test here fails if the fix it protects is taken out (each was broken once, the test failed, the fix was put back).
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env, handle as realHandle } from "../src/worker";
import { handle, consentFor } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { powSolve } from "./pow-solve";
import { powText, powValid, powWindow, zeroBits, POW_BITS, POW_BITS_BUSY } from "../src/pow";
import { __authRules } from "../src/worker";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
const sql = (q: string, ...a: unknown[]) => raw.query(q).all(...(a as any[])) as any[];
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; });

async function account() {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.1.0.${n}` }));
  return { "x-organizer": r.token as string };
}
async function listGame(id: string, h: Record<string, string>, cap = 100) {
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap, whoCanJoin: "list" }, h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
}
/** A join as a phone does it (the test helper finds the proof of work by itself when the server asks for it). */
const tryJoin = (id: string, i: number, empId: string | null, ip: string, now = T, extra: Record<string, unknown> = {}) =>
  handle(new Request(`http://x/api/z/${id}/join`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ name: "Guest " + i, ...(empId ? { empId } : {}), device: dev(i), consent: consentFor("K4"), ...extra }) }), env, now);
/** A join straight to the real Worker: no helper, so nothing finds the proof of work for it. */
const rawJoin = (id: string, i: number, ip: string, body: Record<string, unknown> = {}, now = T) =>
  realHandle(new Request(`http://x/api/z/${id}/join`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ name: "Guest " + i, device: dev(i), consent: consentFor("K4"), ...body }) }), env, now);
const ipOf = (i: number) => `7.${Math.floor(i / 250) % 250}.${i % 250}.9`;

// ---------------------------------------------------------------------------------------------------------------- M-1
describe("M-1: a wrong ID is counted, a right ID never is: nobody can lock the listed guests out", () => {
  const roster = async (id: string, h: Record<string, string>) => expect((await call("POST", `/api/z/${id}/people`, { people: [{ name: "Asha Rao", empId: "A-1101" }, { name: "Dev Nair", empId: "B-2202" }, { name: "Mia Das", empId: "C-3303" }] }, h)).status).toBe(200);
  test("the audit's probe: ONE address sends 700 wrong IDs; a listed guest from another address still gets in (200)", async () => {
    const h = await account(); await listGame("M1-1", h); await roster("M1-1", h);
    const codes: Record<string, number> = {};
    for (let i = 1; i <= 700; i++) { const r = await tryJoin("M1-1", i, "ZZ" + i, "9.0.0.1"); const k = r.status + ":" + ((await j(r)).code ?? ""); codes[k] = (codes[k] ?? 0) + 1; }
    expect(codes["403:waiting"]).toBe(30); expect(codes["429:too-many-tries"]).toBe(670);
    expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-1/%'")[0].v)).toBe(30); // that address used 30 of the game's allowance, not 600
    const guest = await tryJoin("M1-1", 9001, "B2202", "9.0.0.2"); expect(guest.status).toBe(200);
    expect((await j(guest)).pid).toBeTruthy();
  }, 120_000);
  test("a crowd of addresses uses up the game's allowance of WRONG IDs: a new wrong ID is refused (429), a listed ID still gets in (200), a name-only request is held by the separate limit of new requests", async () => {
    const h = await account(); await listGame("M1-2", h); await roster("M1-2", h);
    const crowd = async (a: number) => { for (let t = 0; t < 30; t++) { const i = a * 30 + t + 1; const r = await tryJoin("M1-2", i, "ZZ" + i, `9.1.0.${a + 1}`); expect([i, [403, 429].includes(r.status)]).toEqual([i, true]); if (t === 0) expect(r.status).toBe(403); } };
    await crowd(0); expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-2/%'")[0].v)).toBe(30);
    raw.run("UPDATE kv SET v='570' WHERE k LIKE 'idmissg/M1-2/%'"); // 18 more addresses did the same: the allowance of 600 is 30 away (the first address counted 30, then 570 is set)
    await crowd(1); // the 20th address uses up the allowance
    expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-2/%'")[0].v)).toBe(600); // the 601st wrong try was refused before it was counted
    const wrong = await tryJoin("M1-2", 8000, "ZZ8000", "9.1.9.9"); expect(wrong.status).toBe(429); expect((await j(wrong)).code).toBe("too-many-tries");
    for (const [i, id, ip] of [[8001, "A1101", "9.1.9.10"], [8002, "B-2202", "9.1.9.11"], [8003, "c 3303", "9.1.9.12"]] as const) { const r = await tryJoin("M1-2", i, id, ip); expect([id, r.status]).toEqual([id, 200]); }
    const noId = await tryJoin("M1-2", 8004, null, "9.1.9.13"); expect(noId.status).toBe(429); expect((await j(noId)).code).toBe("waiting-busy"); // the 60 new requests of this window were taken by the wrong IDs above: that limit is separate (M-2 a)
    expect((await tryJoin("M1-2", 8005, "ZZ8005", "9.1.9.14", T + 11 * 60_000)).status).toBe(403); // ten minutes later the allowance is fresh
  }, 180_000);
  test("an address that has used up its own 30 wrong tries is still let in with a RIGHT ID, and right IDs use none of the allowance", async () => {
    const h = await account(); await listGame("M1-3", h); await roster("M1-3", h);
    for (let i = 1; i <= 31; i++) await tryJoin("M1-3", i, "ZZ" + i, "9.2.0.1");
    expect((await tryJoin("M1-3", 32, "ZZ32", "9.2.0.1")).status).toBe(429);
    for (const [i, id] of [[40, "A1101"], [41, "B2202"], [42, "C3303"]] as const) expect([id, (await tryJoin("M1-3", i, id, "9.2.0.1")).status]).toEqual([id, 200]);
    expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-3/%'")[0].v)).toBe(30);
  }, 60_000);
  test("'Is this you?': right IDs from many addresses leave the game's allowance untouched, and wrong ones are counted once", async () => {
    const h = await account(); await listGame("M1-4", h); await roster("M1-4", h);
    const who = (i: number, empId: string, ip: string) => handle(new Request("http://x/api/z/M1-4/who", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ empId, consent: consentFor("K4") }) }), env, T);
    for (let i = 0; i < 40; i++) { const r = await who(i, "A1101", `8.1.0.${i + 1}`); expect(await j(r)).toMatchObject({ known: true }); }
    expect(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-4/%'").length).toBe(0);
    await who(1, "ZZ1", "8.1.1.1"); await who(2, "ZZ2", "8.1.1.1");
    expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-4/%'")[0].v)).toBe(2);
  }, 60_000);
  test("a wrong ID that becomes a request is counted ONCE (when the phone comes back with its proof, not on the 428), and an address over its 30 is refused at once, before any proof is asked", async () => {
    const h = await account(); await listGame("M1-6", h); await roster("M1-6", h);
    const first = await rawJoin("M1-6", 1, "9.6.0.1", { empId: "ZZ1" }); expect(first.status).toBe(428);
    expect(sql("SELECT COUNT(*) c FROM kv WHERE k LIKE 'idmiss%'")[0].c).toBe(0); // nothing counted yet
    const ask = (await j(first)).pow; const nonce = await powSolve("M1-6", dev(1), ask.bucket, ask.bits);
    expect((await rawJoin("M1-6", 1, "9.6.0.1", { empId: "ZZ1", pow: { b: ask.bucket, n: nonce } })).status).toBe(403);
    expect(sql("SELECT v FROM kv WHERE k LIKE 'idmiss/M1-6/%'").map((r) => Number(r.v))).toEqual([1]); expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idmissg/M1-6/%'")[0].v)).toBe(1);
    raw.run("UPDATE kv SET v='30' WHERE k LIKE 'idmiss/M1-6/%'");
    const over = await rawJoin("M1-6", 2, "9.6.0.1", { empId: "ZZ2" }); expect(over.status).toBe(429); expect((await j(over)).code).toBe("too-many-tries"); // no 428: the refusal comes first
  });
  test("a game with a large cap keeps room for its own guests: the allowance of wrong IDs is 3 for every place", async () => {
    const h = await account(); await listGame("M1-5", h, 2000); await roster("M1-5", h);
    raw.run("INSERT INTO kv(k,v) VALUES(?,?)", [`idmissg/M1-5/${new Date(T).toISOString().slice(0, 15)}`, "5999"]);
    expect((await tryJoin("M1-5", 1, "ZZ1", "9.3.0.1")).status).toBe(403); // the 6,000th wrong try is the last one counted
    expect((await tryJoin("M1-5", 2, "ZZ2", "9.3.0.2")).status).toBe(429);
    expect((await tryJoin("M1-5", 3, "A1101", "9.3.0.3")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------- M-2
describe("M-2 (c): a proof of work on the request path of a person who is not on the list", () => {
  test("without a proof the Worker answers 428 need-pow and writes nothing and counts nothing; a good proof is let through", async () => {
    const h = await account(); await listGame("M2-1", h);
    const a = await rawJoin("M2-1", 1, "9.4.0.1"); expect(a.status).toBe(428);
    const ask = (await j(a)).pow; expect(ask).toEqual({ v: 1, bucket: powWindow(T), bits: POW_BITS });
    expect(sql("SELECT COUNT(*) c FROM waiting")[0].c).toBe(0); expect(sql("SELECT COUNT(*) c FROM kv WHERE k LIKE 'wnew/%' OR k LIKE 'wnet/%'")[0].c).toBe(0);
    const nonce = await powSolve("M2-1", dev(1), ask.bucket, ask.bits);
    const ok = await rawJoin("M2-1", 1, "9.4.0.1", { pow: { b: ask.bucket, n: nonce } }); expect(ok.status).toBe(403); expect((await j(ok)).code).toBe("waiting");
    expect(sql("SELECT COUNT(*) c FROM waiting")[0].c).toBe(1);
  });
  test("a proof that is wrong, for another phone, for another game, too old, or too short is refused", async () => {
    const h = await account(); await listGame("M2-2", h); await listGame("M2-3", h);
    const win = powWindow(T), good = await powSolve("M2-2", dev(1), win, POW_BITS);
    const refused = async (pow: unknown, i = 1, id = "M2-2") => { const r = await rawJoin(id, i, "9.4.1.1", { pow }); return [r.status, (await j(r)).code]; };
    expect(await refused({ b: win, n: good + "x" })).toEqual([428, "need-pow"]);                                        // not the number that was found (unless by luck: 1 in 65 thousand)
    expect(await refused({ b: win, n: good }, 2)).toEqual([428, "need-pow"]);                                            // found for another phone id
    expect(await refused({ b: win, n: good }, 1, "M2-3")).toEqual([428, "need-pow"]);                                    // found for another game
    expect(await refused({ b: win - 2, n: await powSolve("M2-2", dev(1), win - 2, POW_BITS) })).toEqual([428, "need-pow"]); // two windows old
    expect(await refused({ b: win + 1, n: await powSolve("M2-2", dev(1), win + 1, POW_BITS) })).toEqual([428, "need-pow"]); // a window that has not begun
    expect(await refused({ b: win, n: "not a number!" })).toEqual([428, "need-pow"]);
    expect(await refused("yes")).toEqual([428, "need-pow"]); expect(await refused(null)).toEqual([428, "need-pow"]);
    const weak = async () => { for (let i = 0; ; i++) { const nn = i.toString(36); const z = zeroBits(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(powText("M2-2", dev(1), win, nn))))); if (z >= POW_BITS - 4 && z < POW_BITS) return nn; } }; // 12 to 15 zero bits: nearly enough, still not enough
    expect(await refused({ b: win, n: await weak() })).toEqual([428, "need-pow"]);                                       // a number that does not give enough zero bits
    expect(await refused({ b: win - 1, n: await powSolve("M2-2", dev(1), win - 1, POW_BITS) })).toEqual([403, "waiting"]); // the window before this one is still good
  });
  test("the work is counted in zero bits of SHA-256 of 'pow1|game|phone|window|number' (the page does the same)", async () => {
    const nonce = await powSolve("G-1", "abcd", 7, 12);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pow1|G-1|abcd|7|${nonce}`)));
    expect(zeroBits(h)).toBeGreaterThanOrEqual(12); expect(zeroBits(new Uint8Array([0, 0b00010000]))).toBe(11); expect(zeroBits(new Uint8Array([0b10000000]))).toBe(0);
  });
  test("a listed ID needs no proof, and a person who already asked gets the same answer again with no proof and no new count", async () => {
    const h = await account(); await listGame("M2-4", h);
    await call("POST", "/api/z/M2-4/people", { people: [{ name: "Asha Rao", empId: "A-1101" }] }, h);
    expect((await rawJoin("M2-4", 5, "9.4.2.1", { empId: "A1101" })).status).toBe(200);
    const w = await tryJoin("M2-4", 6, null, "9.4.2.2"); expect(w.status).toBe(403);
    const again = await rawJoin("M2-4", 6, "9.4.2.2"); expect(again.status).toBe(403); expect((await j(again)).code).toBe("waiting");
    expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'wnew/M2-4/%'")[0].v)).toBe(1);
  });
  test("the work asked for grows when the game is getting many new requests", async () => {
    const h = await account(); await listGame("M2-5", h);
    raw.run("INSERT INTO kv(k,v) VALUES(?,?)", [`wnew/M2-5/${new Date(T).toISOString().slice(0, 15)}`, "30"]);
    const a = await rawJoin("M2-5", 1, "9.4.3.1"); expect(a.status).toBe(428); expect((await j(a)).pow.bits).toBe(POW_BITS_BUSY);
    const low = await powSolve("M2-5", dev(1), powWindow(T), POW_BITS);
    if (!(await powValid("M2-5", dev(1), { b: powWindow(T), n: low }, POW_BITS_BUSY, T))) expect((await rawJoin("M2-5", 1, "9.4.3.1", { pow: { b: powWindow(T), n: low } })).status).toBe(428); // the cheaper proof no longer passes (unless it also has the extra zero bits)
  });
});

describe("M-2 (a): at most 60 NEW requests to join in 10 minutes for a whole game, from all networks together", () => {
  test("60 requests from 60 networks are taken, the 61st is told to try again in a few minutes (429 waiting-busy), the first 60 and a repeat are still answered, and the next window is open", async () => {
    const h = await account(); await listGame("M2-6", h);
    for (let i = 1; i <= 60; i++) { const r = await tryJoin("M2-6", i, null, ipOf(i)); expect([i, r.status]).toEqual([i, 403]); }
    const late = await tryJoin("M2-6", 61, null, ipOf(61)); expect(late.status).toBe(429); const body = await j(late); expect(body.code).toBe("waiting-busy"); expect(body.error).toContain("try again in a few minutes");
    expect(sql("SELECT COUNT(*) c FROM waiting")[0].c).toBe(60);
    const repeat = await tryJoin("M2-6", 7, null, ipOf(7)); expect(repeat.status).toBe(403); expect((await j(repeat)).code).toBe("waiting"); // somebody who already asked is not counted again
    expect((await tryJoin("M2-6", 61, null, ipOf(61), T + 10 * 60_000)).status).toBe(403);
  }, 120_000);
  test("a listed ID is not held back by this limit", async () => {
    const h = await account(); await listGame("M2-7", h);
    await call("POST", "/api/z/M2-7/people", { people: [{ name: "Asha Rao", empId: "A-1101" }] }, h);
    raw.run("INSERT INTO kv(k,v) VALUES(?,?)", [`wnew/M2-7/${new Date(T).toISOString().slice(0, 15)}`, "60"]);
    expect((await tryJoin("M2-7", 1, "A1101", ipOf(1))).status).toBe(200);
    expect((await tryJoin("M2-7", 2, null, ipOf(2))).status).toBe(429);
  });
});

describe("M-2 (b): the Organizer and a Host stop new requests and clear the list with one tap", () => {
  async function twoGames() {
    const h = await account();
    for (const id of ["M2-A", "M2-B"]) await listGame(id, h);
    const host = await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500001", e: "M2-A" }, h));
    const co = await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500002", e: "M2-A" }, h));
    return { h, host: { "x-organizer": host.hostKey as string }, co: { "x-organizer": co.cohostKey as string } };
  }
  const room = (id: string, action: string, h: Record<string, string>) => call("POST", `/api/z/${id}/waiting/room`, { action }, h);
  test("close: new requests are refused with 403 waiting-closed, the Organizer sees closed:true, open allows them again", async () => {
    const { h } = await twoGames();
    expect((await tryJoin("M2-A", 1, null, ipOf(1))).status).toBe(403);
    expect(await j(await room("M2-A", "close", h))).toMatchObject({ ok: true, closed: true, cleared: 0 });
    const no = await tryJoin("M2-A", 2, null, ipOf(2)); expect(no.status).toBe(403); expect((await j(no)).code).toBe("waiting-closed");
    const again = await tryJoin("M2-A", 1, null, ipOf(1)); expect((await j(again)).code).toBe("waiting"); // a request made before keeps its place
    expect(await j(await call("GET", "/api/z/M2-A/waiting", undefined, h))).toMatchObject({ closed: true, total: 1, max: 500, full: false });
    expect(sql("SELECT COUNT(*) c FROM waiting WHERE eid='M2-A'")[0].c).toBe(1); expect(sql("SELECT COUNT(*) c FROM waiting WHERE eid='M2-B'")[0].c).toBe(0);
    expect((await tryJoin("M2-B", 3, null, ipOf(3))).status).toBe(403); expect((await j(await tryJoin("M2-B", 4, null, ipOf(4)))).code).toBe("waiting"); // another game is not closed
    expect(await j(await room("M2-A", "open", h))).toMatchObject({ ok: true, closed: false });
    expect((await j(await tryJoin("M2-A", 2, null, ipOf(2)))).code).toBe("waiting");
  });
  test("clear: every request still waiting is deleted with its name, e-mail and mobile number; people already let in or declined are not touched; close-clear does both", async () => {
    const { h, host } = await twoGames();
    for (let i = 1; i <= 5; i++) await tryJoin("M2-A", i, null, ipOf(i), T, { email: `g${i}@x.com`, phone: "98765 4321" + i });
    const list = await j(await call("GET", "/api/z/M2-A/waiting", undefined, h)); expect(list.waiting.length).toBe(5);
    await call("POST", `/api/z/M2-A/waiting/${list.waiting[0].id}`, { decision: "admit" }, h); await call("POST", `/api/z/M2-A/waiting/${list.waiting[1].id}`, { decision: "decline" }, h);
    const done = await j(await room("M2-A", "clear", host)); expect(done).toMatchObject({ ok: true, cleared: 3, closed: false });
    expect(sql("SELECT status FROM waiting WHERE eid='M2-A' ORDER BY status").map((r) => r.status)).toEqual(["admitted", "declined"]);
    expect((await j(await call("GET", "/api/z/M2-A/waiting", undefined, h))).waiting).toEqual([]);
    for (let i = 10; i < 13; i++) await tryJoin("M2-A", i, null, ipOf(i));
    expect(await j(await room("M2-A", "close-clear", h))).toMatchObject({ ok: true, cleared: 3, closed: true });
    expect((await j(await tryJoin("M2-A", 20, null, ipOf(20)))).code).toBe("waiting-closed");
  });
  test("only the Organizer and a Host of THIS game may do it: a Co-host, a Host of another game, a stranger and an AI link are refused, and nothing changes", async () => {
    const { h, host, co } = await twoGames();
    await tryJoin("M2-A", 1, null, ipOf(1));
    for (const [who, hd] of [["co-host", co], ["stranger", {}]] as const) { const r = await room("M2-A", "close-clear", hd as Record<string, string>); expect([who, r.status >= 400 && r.status < 500]).toEqual([who, true]); }
    expect((await room("M2-B", "close-clear", host)).status).toBe(403); // the Host of M2-A on M2-B
    expect((await j(await call("POST", "/api/z/M2-A/waiting/room", { action: "explode" }, h))).error).toContain("Say close");
    expect(sql("SELECT COUNT(*) c FROM waiting WHERE eid='M2-A'")[0].c).toBe(1); expect(sql("SELECT COUNT(*) c FROM kv WHERE k LIKE 'wroom/%'")[0].c).toBe(0);
  });
});

describe("M-2: the waiting list is full: the guest is told so in words, and the Organizer sees it", () => {
  test("500 waiting: a new request gets 429 waiting-full with a sentence that says what to do; the Organizer's list says full; clearing makes room", async () => {
    const h = await account(); await listGame("M2-F", h);
    raw.run("WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM s WHERE i<500) INSERT INTO waiting(eid,id,ph,pii,via,inviter,chain,overlimit,status,at_ms) SELECT 'M2-F', printf('%012x', i), 'ph' || i, 'x', 'direct', 'o', ',o,', 0, 'waiting', 1 FROM s");
    const r = await tryJoin("M2-F", 1, null, ipOf(1)); expect(r.status).toBe(429); const b = await j(r); expect(b.code).toBe("waiting-full");
    expect(b.error).toContain("full (500 requests)"); expect(b.error).toContain("add you to the list");
    expect(await j(await call("GET", "/api/z/M2-F/waiting", undefined, h))).toMatchObject({ total: 500, full: true, max: 500 });
    expect((await j(await call("POST", "/api/z/M2-F/waiting/room", { action: "clear" }, h))).cleared).toBe(500);
    expect((await tryJoin("M2-F", 1, null, ipOf(1))).status).toBe(403);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------- M-3
describe("M-3: a Host belongs to one game", () => {
  async function twoGames() {
    const h = await account();
    for (const id of ["AP-1", "AP-2"]) await listGame(id, h);
    const ask = await tryJoin("AP-2", 9, null, "9.5.0.1", T, { name: "Carol Guest", email: "carol@x.com" }); expect(ask.status).toBe(403);
    const host = await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500001", e: "AP-1" }, h));
    const cohost = await j(await call("POST", "/api/org/cohost", { label: "Ravi Two", phone: "9876500002", e: "AP-2" }, h));
    const cohost1 = await j(await call("POST", "/api/org/cohost", { label: "Anil One", phone: "9876500003", e: "AP-1" }, h));
    return { h, hostKey: host.hostKey as string, hostId: host.id as string, co2: cohost.id as string, co1: cohost1.id as string };
  }
  test("(a) no Host is made without a game, through the API or the console; with a game it works and the game is stored on the key", async () => {
    const h = await account(); await listGame("AP-1", h);
    for (const body of [{ label: "Priya", email: "priya@acme.com" }, { label: "Priya", email: "priya@acme.com", e: "NOT-MINE" }, { label: "Priya", email: "priya@acme.com", e: "" }]) {
      const r = await call("POST", "/api/org/host", body, h); expect(r.status).toBe(400); expect((await j(r)).code).toBe("host-needs-game");
    }
    expect(sql("SELECT COUNT(*) c FROM organizer_key WHERE kind='host'")[0].c).toBe(0);
    expect((await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", e: "AP-1" }, h)).status).toBe(200);
    expect(sql("SELECT eid FROM organizer_key WHERE kind='host'")[0].eid).toBe("AP-1");
  });
  test("(a) an old Host with no game stored has NO access to any game: every game route, the team list and paying answer 403 host-no-game; the Organizer is not affected", async () => {
    const { h, hostKey, hostId } = await twoGames(); const k = { "x-organizer": hostKey };
    expect((await call("GET", "/api/z/AP-1/waiting", undefined, k)).status).toBe(200); // before: the Host works in their own game
    raw.run("UPDATE organizer_key SET eid=NULL WHERE kind='host' AND substr(hash,1,10)=?", [hostId]); // the way a Host made before 1.6.2 looks
    for (const id of ["AP-1", "AP-2"]) for (const a of ["waiting", "people", "people/export", "participants", "names", "prizes", "summary", "claims", "reportlink", "seats"]) { const r = await call("GET", `/api/z/${id}/${a}`, undefined, k); expect([id, a, r.status, (await j(r)).code]).toEqual([id, a, 403, "host-no-game"]); }
    for (const [m, a, b] of [["POST", "erase", {}], ["POST", "publish", {}], ["PATCH", "settings", { name: "x" }], ["POST", "clone", {}], ["POST", "ttt/stageon", {}], ["POST", "waiting/room", { action: "clear" }], ["POST", "paylink", {}], ["POST", "pay-with-credit", {}]] as const) { const r = await call(m, `/api/z/AP-2/${a}`, b, k); expect([a, r.status, (await j(r)).code]).toEqual([a, 403, "host-no-game"]); }
    for (const [m, p, b] of [["GET", "/api/org/team", undefined], ["GET", "/api/org/team?e=AP-2", undefined], ["POST", "/api/org/cohost", { label: "Ravi", phone: "9876500009", e: "AP-2" }], ["GET", "/api/org/credit", undefined], ["POST", "/api/checkout", { eid: "AP-2" }]] as const) { const r = await call(m, p, b, k); expect([p, r.status, (await j(r)).code]).toEqual([p, 403, "host-no-game"]); }
    expect((await call("GET", "/api/z/AP-2/waiting", undefined, h)).status).toBe(200); expect((await call("GET", "/api/z/AP-1/waiting", undefined, h)).status).toBe(200);
    const team = await j(await call("GET", "/api/org/team", undefined, h)); expect(team.hosts[0]).toMatchObject({ label: "Priya", noGame: true }); // the Organizer is told which Host has to be added again
    const link = await call("POST", "/api/org/host/link", { id: hostId }, h); expect(link.status).toBe(409); expect((await j(link)).code).toBe("host-needs-game");
  });
  test("(a) the rules themselves: a Host with no game fits no game, a Host with a game fits only that one (defence behind the route gate)", () => {
    const g = (id: string) => ({ org: "o1", id });
    expect(__authRules.can({ plat: false, org: "o1", kind: "host", noGame: true }, g("AP-1"))).toBe(false);
    expect(__authRules.canAi({ plat: false, org: "o1", kind: "host", noGame: true }, g("AP-1"))).toBe(false);
    expect(__authRules.mayPay({ plat: false, org: "o1", kind: "host", noGame: true }, g("AP-1"))).toBe(false);
    const own = { plat: false, org: "o1", kind: "host" as const, eid: "AP-1", gameOnly: true };
    expect(__authRules.can(own, g("AP-1"))).toBe(true); expect(__authRules.can(own, g("AP-2"))).toBe(false);
    expect(__authRules.can({ plat: false, org: "o1", kind: "master" }, g("AP-2"))).toBe(true);
  });
  test("(a) re-adding works: the Organizer retires the old Host and adds them inside a game; the new key works in that game only", async () => {
    const { h, hostId } = await twoGames();
    raw.run("UPDATE organizer_key SET eid=NULL WHERE kind='host' AND substr(hash,1,10)=?", [hostId]);
    expect((await call("POST", "/api/org/team/retire", { id: hostId }, h)).status).toBe(200);
    const again = await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500001", e: "AP-2" }, h));
    const k = { "x-organizer": again.hostKey as string };
    expect((await call("GET", "/api/z/AP-2/waiting", undefined, k)).status).toBe(200); expect((await call("GET", "/api/z/AP-1/waiting", undefined, k)).status).toBe(403);
  });
  test("(b) the audit's probe: an AP-1 Host cannot read AP-2's team (Co-hosts, Host e-mails) and cannot retire its Co-host", async () => {
    const { hostKey, co2, co1 } = await twoGames(); const k = { "x-organizer": hostKey };
    const read = await call("GET", "/api/org/team?e=AP-2", undefined, k), readBody = await j(read); expect(read.status).toBe(403); expect(readBody.code).toBe("other-game"); expect(JSON.stringify(readBody)).not.toContain("Ravi");
    const own = await j(await call("GET", "/api/org/team?e=AP-1", undefined, k)); expect(own.cohosts.map((c: any) => c.label)).toEqual(["Anil One"]);
    const noE = await j(await call("GET", "/api/org/team", undefined, k)); expect(noE.cohosts.map((c: any) => c.label)).toEqual(["Anil One"]); // no ?e= : still only this game
    expect(JSON.stringify(noE)).not.toContain("Ravi");
    const no = await call("POST", "/api/org/team/retire", { id: co2 }, k); expect(no.status).toBe(403); expect((await j(no)).code).toBe("other-game");
    expect(sql("SELECT revoked FROM organizer_key WHERE substr(hash,1,10)=?", co2)[0].revoked).toBe(0); // AP-2's Co-host is still there
    expect((await call("POST", "/api/org/team/retire", { id: co1 }, k)).status).toBe(200); expect(sql("SELECT revoked FROM organizer_key WHERE substr(hash,1,10)=?", co1)[0].revoked).toBe(1); // their own game's Co-host can be retired
  });
  test("(b) the list of games (/api/history) shows a Host their own game only; the Organizer sees every game", async () => {
    const { h, hostKey } = await twoGames();
    expect((await j(await call("GET", "/api/history", undefined, { "x-organizer": hostKey }))).engagements.map((e: any) => e.id)).toEqual(["AP-1"]);
    expect((await j(await call("GET", "/api/history", undefined, h))).engagements.map((e: any) => e.id).sort()).toEqual(["AP-1", "AP-2"]);
  });
  test("(b) a Host sees only the Hosts of their own game; the Organizer sees all and which one has no game", async () => {
    const { h, hostKey } = await twoGames();
    await call("POST", "/api/org/host", { label: "Other Host", email: "o@acme.com", mobile: "9876500005", e: "AP-2" }, h);
    const mine = await j(await call("GET", "/api/org/team", undefined, { "x-organizer": hostKey })); expect(mine.hosts.map((x: any) => x.label)).toEqual(["Priya"]);
    const all = await j(await call("GET", "/api/org/team", undefined, h)); expect(all.hosts.map((x: any) => [x.label, x.eid])).toEqual([["Priya", "AP-1"], ["Other Host", "AP-2"]]);
  });
  test("(b) the same Host cannot make a pay link, pay with credit, or start a payment for another game", async () => {
    const { hostKey } = await twoGames(); const k = { "x-organizer": hostKey };
    for (const [p, b] of [["/api/z/AP-2/paylink", {}], ["/api/z/AP-2/pay-with-credit", {}]] as const) { const r = await call("POST", p, b, k); expect([p, r.status, (await j(r)).code]).toEqual([p, 403, "other-game"]); }
    for (const p of ["/api/checkout", "/api/proforma"]) { const r = await call("POST", p, { eid: "AP-2", currency: "INR" }, k); expect([p, r.status]).toEqual([p, 403]); }
    expect((await call("POST", "/api/z/AP-1/paylink", {}, k)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------- Low 1
describe("Low 1: one player cannot fill a board", () => {
  test("a player who writes as fast as allowed stops at 40 entries; the other player's move and the Organizer's claim still go through", async () => {
    const { TttConsole, planOf } = await import("../../../packages/ttt/src/phone");
    const { apiFor } = await import("../../../tools/sim2/phones");
    const h = await account();
    expect((await call("POST", "/api/z", { id: "L1-1", startRound: START, callSeconds: 6, cap: 100 }, h)).status).toBe(200);
    expect((await call("POST", "/api/z/L1-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200); raw.run("UPDATE engagement SET pack=100 WHERE id='L1-1'");
    const ps: { pid: string; device: string }[] = [];
    for (let i = 0; i < 4; i++) { const r = await call("POST", "/api/z/L1-1/join", { name: "Player " + (i + 1), device: dev(i + 1) }); expect(r.status).toBe(200); ps.push({ pid: (await j(r)).pid, device: dev(i + 1) }); }
    expect((await call("POST", "/api/z/L1-1/ttt/start", {}, h, T)).status).toBe(200);
    const clock = { t: T }; await new TttConsole(apiFor(call, clock, h), "L1-1").tick();
    const setup = await j(await call("GET", "/api/z/L1-1/ttt/setup", undefined, {}, T)); const plan = await planOf(setup);
    const m = Object.values(plan.t.matches).filter((x: any) => x.round === 1 && !x.bye)[0] as any; const A = ps.find((p) => p.pid === m.boards[0].a)!, B = ps.find((p) => p.pid === m.boards[0].b)!;
    const mv = (p: { pid: string; device: string }, body: Record<string, unknown>, at: number) => call("POST", "/api/z/L1-1/ttt/move", { pid: p.pid, device: p.device, mid: m.mid, ...body }, {}, at);
    let seq = 0, at = T + 5000; for (; seq < 40; seq++, at += 1000) expect([seq, (await mv(A, { seq, sq: 4 }, at)).status]).toEqual([seq, 200]);
    const flood = await mv(A, { seq, sq: 4 }, at); expect(flood.status).toBe(409); expect((await j(flood)).code).toBe("player-board-full");
    expect((await mv(B, { seq, sq: 3 }, at + 1000)).status).toBe(200); seq++;
    const claim = await call("POST", "/api/z/L1-1/ttt/move", { mid: m.mid, j: 0, seq, absent: true }, h, at + 2000); expect(claim.status).toBe(200);
    expect(sql("SELECT COUNT(*) c FROM ttt_mv WHERE pid=?", A.pid)[0].c).toBe(40);
  }, 60_000);
});
