// The owner's invite rule (23 Nov 2026), for every game that comes in through the console:
// 1. one game link for everybody; 2. an ID that is on the organizer's list is checked and lets the person in, no approval;
// 3. no ID, or an ID not on the list: the person gives a NAME (the only thing needed; ID, department or team, region, mobile number and e-mail are optional), and the organizer or host says yes or no (only they see the details);
// 4. the ID is ONE alphanumeric field (no mobile / either / both), cleaned the same way at upload, join, approval and matching (A-1101 = A 1101 = A/1101); lists made before still work;
// 5. the list and all IDs are deleted within 24 hours after the game ends.
// Every test here fails if the change it protects is taken out.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle, consentFor } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { empHashOf, verifyOf, migrateEmpAliases, fromCodeOf } from "../src/people";
import { openPii, sealPii } from "../src/pii";
import { erasePersonal, personalDeleteAt } from "../src/lifecycle";
import { validateCfg, VERIFY_MODES } from "../../../packages/beacon/src/config";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 10, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, extra: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mob = (i: number) => "9" + String(100000000 + i);
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const join = (body: Record<string, unknown>) => call("POST", "/api/z/INV-1/join", body);
const rowsOf = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...(v as any[])) as any[];
const add = (key: string, people: unknown[]) => call("POST", "/api/z/INV-1/people", { people }, key);

async function setup(opts: { employeesOnly?: boolean } = {}) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "INV-1", startRound: START, callSeconds: 6, cap: 100, whoCanJoin: "list" }, master); // the console makes list games; there is no choice of mobile / ID: a game is made without saying how people come in
  await call("POST", "/api/z/INV-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  if (opts.employeesOnly) expect((await call("PATCH", "/api/z/INV-1/settings", { employeesOnly: true }, master)).status).toBe(200);
  const host = (await j(await call("POST", "/api/org/host", { e: "INV-1", label: "Priya", email: "priya@acme.com", mobile: "9876500001" }, master))).hostKey as string;
  const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500002", e: "INV-1" }, master))).cohostKey as string;
  return { master, host, cohost };
}
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt" } as PayEnv; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("a game anyone with the link may join (made before, or through the API) keeps its name-only join", () => {
  test("a name is enough there, the page is told it is not a game by invitation, and a list game tells the page it is", async () => {
    const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "7.7.8.1" }, body: JSON.stringify({ email: "open@acme.com" }) }), env as Env, T)); const master = st.token as string;
    await call("POST", "/api/z", { id: "OPN-1", startRound: START, callSeconds: 6, cap: 100 }, master); await call("POST", "/api/z/OPN-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
    expect((await j(await call("GET", "/api/z/OPN-1/info"))).byInvite).toBe(false);
    expect((await call("POST", "/api/z/OPN-1/join", { name: "Maya Lopez", device: dev(9), consent: consentFor("K4") })).status).toBe(200);
    await setup(); expect((await j(await call("GET", "/api/z/INV-1/info"))).byInvite).toBe(true);
  });
});

describe("rule 4: the ID is one field, there is no choice of mobile / either / both", () => {
  test("validateCfg accepts only 'id'; the older choices are refused for new input and read as the ID rule when a game is read back", () => {
    expect(VERIFY_MODES).toEqual(["id"]);
    for (const bad of ["mobile", "either", "both", "passport"]) { const r = validateCfg({ verify: bad }); expect([bad, r.ok]).toEqual([bad, false]); }
    const ok = validateCfg({ verify: "id" }); expect(ok.ok && ok.cfg.verify).toBe("id");
    const stored = validateCfg({ verify: "either" }, undefined, { stored: true }); expect(stored.ok).toBe(true); expect(stored.ok && stored.cfg.verify).toBeUndefined(); // an older game still opens
  });
  test("the server refuses the older choices when the organizer saves, and tells every guest page 'id'", async () => {
    const t = await setup();
    for (const bad of ["mobile", "either", "both"]) expect([bad, (await call("PATCH", "/api/z/INV-1/settings", { verify: bad }, t.master)).status]).toEqual([bad, 400]);
    expect((await call("PATCH", "/api/z/INV-1/settings", { verify: "id" }, t.master)).status).toBe(200);
    expect((await j(await call("GET", "/api/z/INV-1/info"))).verify).toBe("id");
    expect((await j(await call("GET", "/api/z/INV-1/summary", undefined, t.master))).verify).toBe("id");
  });
  test("verifyOf has no mode: a game saved with 'either' or 'both' is read as the one ID rule", () => {
    for (const v of ["mobile", "either", "both", "id", undefined]) expect(verifyOf({ config: JSON.stringify({ verify: v, employeesOnly: true }) })).toEqual({ employeesOnly: true, idKind: "emp" });
    expect(verifyOf({ config: null })).toEqual({ employeesOnly: false, idKind: "emp" });
  });
});

describe("rule 2: an ID on the organizer's list lets the person in, no approval", () => {
  test("A-1101, A 1101, A/1101 and a1101 are one ID: listed once, any spelling gets in at once, nobody waits", async () => {
    const t = await setup();
    const r = await j(await add(t.master, [{ name: "Asha", empId: "A-1101" }, { name: "Again", empId: "A 1101" }, { name: "Slash", empId: "a/1101" }]));
    expect(r.added).toBe(1); expect(r.duplicates).toBe(2);
    for (const typed of ["A-1101", "A 1101", "A/1101", "a1101", " a.11-01 "]) { const x = await join({ name: "Asha", empId: typed, device: dev(1), consent: consentFor("K4") }); expect([typed, x.status]).toEqual([typed, 200]); }
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(0); expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1);
    expect(rowsOf("SELECT ph FROM person").map((x) => x.ph)).toEqual([await empHashOf(env, "A1101")]); // stored once, in one form
    const who = await j(await call("POST", "/api/z/INV-1/who", { empId: "A 1101", consent: consentFor("K4") })); expect(who.known).toBe(true);
  });
  test("the person on the list keeps the name the organizer gave and is not asked for a mobile number or an e-mail", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha Rao", empId: "A-1101" }]);
    const x = await join({ name: "someone", empId: "A1101", device: dev(1), consent: consentFor("K4") }); expect(x.status).toBe(200);
    const p = await openPii(env as any, (rowsOf("SELECT pii FROM participant")[0]).pii); expect(p?.name).toBe("Asha Rao");
  });
});

describe("rule 3: no ID, or an ID that is not on the list, goes to the organizer or host with a name (everything else is optional)", () => {
  test("H-1: the name is the only thing needed: no name is asked for, a name alone waits for the organizer, a mobile number or e-mail is never needed", async () => {
    const t = await setup();
    const none = await join({ device: dev(2), consent: consentFor("K4") }); expect(none.status).toBe(400); expect((await j(none)).code).toBe("need-name");
    const short = await join({ name: "M", phone: mob(2), email: "maya@acme.com", device: dev(2), consent: consentFor("K4") }); expect(short.status).toBe(400); expect((await j(short)).code).toBe("need-name");
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(0); expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(0);
    const w = await join({ name: "Maya Lopez", device: dev(2), consent: consentFor("K4") }); expect(w.status).toBe(403); const wb = await j(w); expect(wb.code).toBe("waiting");
    const held = await openPii(env as any, rowsOf("SELECT pii FROM waiting")[0].pii); expect(held).toMatchObject({ name: "Maya Lopez", phone: "" }); expect(held?.email).toBeUndefined();
    expect(JSON.stringify((await j(await call("GET", "/api/z/INV-1/waiting", undefined, t.master))).waiting)).toContain("Maya Lopez");
    expect((await call("POST", `/api/z/INV-1/waiting/${wb.wid}`, { decision: "admit" }, t.master)).status).toBe(200);
    expect((await join({ name: "Maya Lopez", device: dev(2), consent: consentFor("K4") })).status).toBe(200); // the same phone asks again after the yes: in
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1);
  });
  test("an optional answer that is wrong is refused with a plain sentence (it can be left empty), and nothing is kept", async () => {
    await setup();
    const badMail = await join({ name: "Maya Lopez", email: "maya-at-acme", device: dev(2), consent: consentFor("K4") }); expect(badMail.status).toBe(400); expect((await j(badMail)).code).toBe("bad-email");
    const badPhone = await join({ name: "Maya Lopez", phone: "12", device: dev(2), consent: consentFor("K4") }); expect(badPhone.status).toBe(400);
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(0);
  });
  test("H-1/H-3: the optional answers (ID, department or team, region, mobile number, e-mail) are kept, shown in full to the Organizer and a Host only, never to a Co-host", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha", empId: "A-1101" }]);
    const w = await join({ name: "Dev Nair", empId: "Z 999", dept: "Finance Ops", region: "South", phone: mob(3), email: "dev@acme.com", device: dev(3), consent: consentFor("K4") }); expect(w.status).toBe(403);
    const held = await openPii(env as any, rowsOf("SELECT pii FROM waiting")[0].pii); expect(held).toMatchObject({ name: "Dev Nair", empId: "Z999", dept: "Finance Ops", region: "South", email: "dev@acme.com" });
    for (const key of [t.master, t.host]) { const q = (await j(await call("GET", "/api/z/INV-1/waiting", undefined, key))).waiting[0]; expect(q).toMatchObject({ name: "Dev Nair", empId: "Z999", dept: "Finance Ops", region: "South", email: "dev@acme.com" }); }
    expect(JSON.stringify((await j(await call("GET", "/api/z/INV-1/waiting", undefined, t.cohost))).waiting)).not.toContain("Finance");
  });
  test("M2 (audit 2): an approved place cannot be taken by typing the approved person's mobile number on another phone", async () => {
    const t = await setup();
    const w = await join({ name: "Maya Lopez", phone: mob(2), email: "maya@acme.com", device: dev(2), consent: consentFor("K4") }); const wb = await j(w);
    expect((await call("POST", `/api/z/INV-1/waiting/${wb.wid}`, { decision: "admit" }, t.master)).status).toBe(200);
    const thief = await join({ name: "Somebody Else", phone: mob(2), email: "maya@acme.com", device: dev(9), consent: consentFor("K4") }); expect(thief.status).toBe(403); expect((await j(thief)).code).toBe("waiting"); // the number is not a key: the other phone has to ask
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(0);
    expect((await join({ name: "Maya Lopez", phone: mob(2), device: dev(2), consent: consentFor("K4") })).status).toBe(200); // the real phone comes in
  });
  test("with all three the request waits for the organizer; it carries name, mobile and e-mail; the organizer and a Host see them, a Co-host does not; yes lets the person in", async () => {
    const t = await setup();
    const w = await join({ name: "Maya Lopez", phone: mob(2), email: "Maya@Acme.com", device: dev(2), consent: consentFor("K4") });
    expect(w.status).toBe(403); const wb = await j(w); expect(wb.code).toBe("waiting"); expect(wb.wid).toBeTruthy();
    const held = await openPii(env as any, rowsOf("SELECT pii FROM waiting")[0].pii); expect(held).toMatchObject({ name: "Maya Lopez", email: "maya@acme.com" }); expect(held?.phone).toContain(mob(2).slice(-10));
    for (const key of [t.master, t.host]) { const q = (await j(await call("GET", "/api/z/INV-1/waiting", undefined, key))).waiting[0]; expect(q).toMatchObject({ name: "Maya Lopez", email: "maya@acme.com" }); expect(q.mobile).toContain(mob(2).slice(-10)); }
    expect((await j(await call("GET", "/api/z/INV-1/waiting", undefined, t.cohost))).waiting).toHaveLength(0); // it did not come through the Co-host's link
    const ch = fromCodeOf("c:" + rowsOf("SELECT substr(hash,1,7) h FROM organizer_key WHERE kind='cohost'")[0].h)!;
    expect((await join({ name: "Dev Nair", phone: mob(3), email: "dev@acme.com", from: ch, device: dev(3), consent: consentFor("K4") })).status).toBe(403); // asked through the Co-host's own link
    const mine = (await j(await call("GET", "/api/z/INV-1/waiting", undefined, t.cohost))).waiting; expect(mine).toHaveLength(1); expect(mine[0].firstName).toBe("Dev"); expect(mine[0].last4).toBe(mob(3).slice(-4));
    const co = JSON.stringify(mine); expect(co).not.toContain("dev@acme.com"); expect(co).not.toContain(mob(3).slice(-10)); expect(co).not.toContain("Nair"); expect(co).not.toContain("email"); expect(co).not.toContain("mobile");
    expect(JSON.stringify((await j(await call("GET", "/api/z/INV-1/waiting", undefined, t.master))).waiting)).toContain("dev@acme.com"); // the Organizer sees both requests in full
    const pending = await j(await call("GET", `/api/z/INV-1/me?wid=${wb.wid}`)); expect(JSON.stringify(pending)).not.toContain("maya@acme.com"); expect(JSON.stringify(pending)).not.toContain(mob(2).slice(-4) + "x");
    expect((await call("POST", `/api/z/INV-1/waiting/${wb.wid}`, { decision: "admit" }, t.master)).status).toBe(200);
    const again = await join({ name: "Maya Lopez", phone: mob(2), email: "maya@acme.com", device: dev(2), consent: consentFor("K4") }); expect(again.status).toBe(200); // asked again after yes: in, nothing waits for ever
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1);
  });
  test("an ID that is not on the list is asked for a name, is shown to the organizer, and a decline keeps the person out", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha", empId: "A-1101" }]);
    const asked = await join({ empId: "Z 999", device: dev(3), consent: consentFor("K4") }); expect(asked.status).toBe(400); expect((await j(asked)).error).toMatch(/not on the list/); // an ID that is not on the list, no name: the name is asked for
    const w = await join({ name: "Dev Nair", empId: "Z 999", phone: mob(3), email: "dev@acme.com", device: dev(3), consent: consentFor("K4") }); expect(w.status).toBe(403); const wb = await j(w);
    const q = (await j(await call("GET", "/api/z/INV-1/waiting", undefined, t.master))).waiting[0]; expect(q.empId).toBe("Z999"); expect(q.email).toBe("dev@acme.com");
    expect((await call("POST", `/api/z/INV-1/waiting/${wb.wid}`, { decision: "decline" }, t.master)).status).toBe(200);
    expect((await join({ name: "Dev Nair", empId: "Z 999", phone: mob(3), email: "dev@acme.com", device: dev(3), consent: consentFor("K4") })).status).toBe(403);
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(0);
  });
  test("a mobile number on the list is no way in by itself (a personal link is); the same person waits for a yes", async () => {
    const t = await setup(); const r = await j(await add(t.master, [{ name: "Ravi", phone: mob(5) }]));
    const x = await join({ name: "Ravi", phone: mob(5), email: "ravi@acme.com", device: dev(5), consent: consentFor("K4") }); expect(x.status).toBe(403); expect((await j(x)).code).toBe("waiting");
    const link = r.people[0].link as string; const tok = link.split("/j/")[1]!;
    expect((await join({ token: tok, name: "Ravi", device: dev(6), consent: consentFor("K4") })).status).toBe(200);
  });
  test("an employees-only game still asks for the ID first", async () => {
    await setup({ employeesOnly: true });
    const x = await join({ name: "Maya Lopez", phone: mob(2), email: "maya@acme.com", device: dev(2), consent: consentFor("K4") }); expect(x.status).toBe(400); expect((await j(x)).code).toBe("need-id");
  });
});

describe("rule 4 of the 07:16 brief: a person who is in may add details in a small panel, all optional (route /details)", () => {
  const dpost = (body: Record<string, unknown>) => call("POST", "/api/z/INV-1/details", body);
  test("H-3: a listed guest adds name, department or team, region, mobile and e-mail; the Organizer's list and the stored record show them; the ID stays", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha Rao", empId: "A-1101" }]);
    const x = await j(await join({ empId: "A1101", device: dev(1), consent: consentFor("K4") })); expect(x.pid).toBeTruthy();
    const r = await dpost({ pid: x.pid, device: dev(1), name: "Asha R", dept: "Sales Team 4", region: "North", phone: mob(8), email: "Asha@Acme.com" }); expect(r.status).toBe(200); expect((await j(r)).saved).toEqual(["name", "dept", "region", "mobile", "email"]);
    const p = await openPii(env as any, rowsOf("SELECT pii FROM participant")[0].pii); expect(p).toMatchObject({ name: "Asha R", dept: "Sales Team 4", region: "North", email: "asha@acme.com", empId: "A1101" }); expect(p?.phone).toContain(mob(8).slice(-10));
    const q = (await j(await call("GET", "/api/z/INV-1/people", undefined, t.master))).people[0]; expect(q).toMatchObject({ name: "Asha R", dept: "Sales Team 4", region: "North", empId: "A1101" });
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1); // nothing about the place changed
  });
  test("it needs the phone that holds the place; an empty or wrong answer changes nothing; leaving every box empty is fine (nothing is needed to play)", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha Rao", empId: "A-1101" }]);
    const x = await j(await join({ empId: "A1101", device: dev(1), consent: consentFor("K4") }));
    expect((await dpost({ pid: x.pid, device: dev(7), dept: "Sales" })).status).toBe(403); // another phone
    expect((await dpost({ pid: "nobody", device: dev(1), dept: "Sales" })).status).toBe(403);
    expect((await dpost({ pid: x.pid, device: "zz", dept: "Sales" })).status).toBe(400);
    expect((await dpost({ pid: x.pid, device: dev(1), email: "not-an-email" })).status).toBe(400);
    expect((await dpost({ pid: x.pid, device: dev(1), phone: "12" })).status).toBe(400);
    const none = await dpost({ pid: x.pid, device: dev(1) }); expect(none.status).toBe(200); expect((await j(none)).saved).toEqual([]);
    const p = await openPii(env as any, rowsOf("SELECT pii FROM participant")[0].pii); expect(p).toMatchObject({ name: "Asha Rao", empId: "A1101" }); expect(p?.dept).toBeUndefined();
    expect((await call("GET", "/api/z/INV-1/people", undefined, t.cohost)).status).toBeLessThan(500);
  });
  test("the details are participant details: erased with the rest within 24 hours after the game ends", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha Rao", empId: "A-1101" }]);
    const x = await j(await join({ empId: "A1101", device: dev(1), consent: consentFor("K4") }));
    expect((await dpost({ pid: x.pid, device: dev(1), dept: "Sales Team 4", region: "North" })).status).toBe(200);
    await erasePersonal(env as any, "INV-1", T + 25 * 3_600_000, "auto");
    expect(rowsOf("SELECT COUNT(*) c FROM participant")[0].c).toBe(0); expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(0);
  });
});

describe("rule 4: cleaned the same way at upload, and lists made before this version still work", () => {
  test("upload stores one form: letters and numbers, capitals; a row with no ID and no mobile number is refused", async () => {
    const t = await setup(); const r = await j(await add(t.master, [{ name: "Asha", empId: "a - 11/01" }, { name: "Nobody" }]));
    expect(r.added).toBe(1); expect(r.invalid).toHaveLength(1); expect(r.invalid[0].why).toMatch(/ID/);
    expect((await openPii(env as any, rowsOf("SELECT pii FROM person")[0].pii))?.empId).toBe("A1101");
  });
  test("a list made before this version holds 'E-101': every spelling finds the person, none adds a second person, the upload sees the duplicate", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha", empId: "E101" }]);
    raw.run("UPDATE person SET ph=?, pii=? WHERE 1=1", [await empHashOf(env, "E-101"), await sealPii(env as any, { phone: "", name: "Asha", empId: "E-101" })]); // what an old list holds
    const before = rowsOf("SELECT ph FROM person").map((x) => x.ph);
    for (const typed of ["E-101", "E 101", "E/101", "e101", " e.1-01 "]) { const x = await join({ name: "Asha", empId: typed, device: dev(7), consent: consentFor("K4") }); expect([typed, x.status]).toEqual([typed, 200]); }
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(0); expect(rowsOf("SELECT ph FROM person").map((x) => x.ph)).toEqual(before);
    expect(rowsOf("SELECT 1 FROM kv WHERE k=?", "empmig/INV-1")).toHaveLength(1); expect(rowsOf("SELECT 1 FROM kv WHERE k=?", `idx/INV-1/${await empHashOf(env, "E101")}`)).toHaveLength(1);
    const again = await j(await add(t.master, [{ name: "Asha again", empId: "E101" }, { name: "Asha third", empId: "e 101" }])); expect(again.added).toBe(0); expect(again.duplicates).toBe(2);
    expect((await j(await call("POST", "/api/z/INV-1/who", { empId: "E 101", consent: consentFor("K4") }))).known).toBe(true);
  });
  test("migrateEmpAliases changes nothing for a list that is already in today's form, and is safe to run twice", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha", empId: "A1101" }]);
    const before = rowsOf("SELECT * FROM person"); await migrateEmpAliases(env as any, "INV-1"); await migrateEmpAliases(env as any, "INV-1");
    expect(rowsOf("SELECT * FROM person")).toEqual(before); expect(rowsOf("SELECT k FROM kv WHERE k LIKE 'idx/INV-1/%'")).toHaveLength(0);
  });
});

describe("rule 5: the list, the IDs and the requests (with their e-mails) are deleted within 24 hours after the game ends", () => {
  test("the deletion falls due less than 24 hours after the end", () => { expect(personalDeleteAt(1_000_000) - 1_000_000).toBeLessThanOrEqual(24 * 3_600_000); });
  test("erasing removes people, requests (name, mobile, e-mail), seats, the ID pointers and the migration note, and leaves another game alone", async () => {
    const t = await setup(); await add(t.master, [{ name: "Asha", empId: "A-1101" }]);
    raw.run("UPDATE person SET ph=?, pii=? WHERE 1=1", [await empHashOf(env, "A-1101"), await sealPii(env as any, { phone: "", name: "Asha", empId: "A-1101" })]);
    expect((await join({ name: "Asha", empId: "A 1101", device: dev(1), consent: consentFor("K4") })).status).toBe(200); // makes the pointer
    expect((await join({ name: "Maya Lopez", phone: mob(2), email: "maya@acme.com", device: dev(2), consent: consentFor("K4") })).status).toBe(403);
    raw.run("INSERT INTO kv(k,v) VALUES('empmig/OTHER-1','1'),('idx/OTHER-1/abc','x')");
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(1);
    await erasePersonal(env as any, "INV-1", T + 25 * 3_600_000, "auto");
    for (const tbl of ["person", "waiting", "participant", "seat"]) expect([tbl, rowsOf(`SELECT COUNT(*) c FROM ${tbl}`)[0].c]).toEqual([tbl, 0]);
    expect(rowsOf("SELECT k FROM kv WHERE k LIKE 'idx/INV-1/%' OR k LIKE 'empmig/INV-1%'")).toHaveLength(0);
    expect(rowsOf("SELECT k FROM kv WHERE k LIKE '%OTHER-1%'")).toHaveLength(2);
  });
});
