// What a person must give to get in (mobile / employee ID / both) and "employees only": the organizer chooses it per game (people.ts verifyOf, worker.ts join).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { normEmp, empHashOf } from "../src/people";
import { makeD1 } from "./d1-sqlite";
import { setMode } from "../src/mode";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200; // one hour after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mob = (i: number) => "9" + String(100000000 + i);
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const join = (id: string, body: Record<string, unknown>, now = T) => call("POST", `/api/z/${id}/join`, body, undefined, now);
const joinAs = (id: string, i: number, extra: Record<string, unknown> = {}, now = T) => join(id, { phone: mob(i), name: "G" + i, device: dev(i), ...extra }, now);
const rowsOf = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...(v as any[])) as any[];

async function setup(opts: { closed?: boolean; verify?: string; employeesOnly?: boolean; invites?: unknown } = {}) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "PPL-1", startRound: START, callSeconds: 6, cap: 100, ...(opts.closed ? { whoCanJoin: "list" } : {}) }, master);
  await call("POST", "/api/z/PPL-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  const body = { ...(opts.invites ? { guestInvites: opts.invites } : {}), ...(opts.verify ? { verify: opts.verify } : {}), ...(opts.employeesOnly !== undefined ? { employeesOnly: opts.employeesOnly } : {}) };
  if (Object.keys(body).length) expect((await call("PATCH", "/api/z/PPL-1/settings", body, master)).status).toBe(200);
  return { master };
}
const add = (key: string, people: unknown[]) => call("POST", "/api/z/PPL-1/people", { people }, key);

beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt" }; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("employee ID", () => {
  test("an ID is trimmed and upper-cased; rubbish is refused; blank is blank", () => {
    expect(normEmp(" ab 123 ")).toBe("AB123"); expect(normEmp("")).toBe(""); expect(normEmp(undefined)).toBe(""); expect(normEmp("a<b>")).toBe("AB"); expect(normEmp("<>")).toBeNull(); /* test author 30 Oct 2026: symbols are removed now (ids.ts); only an ID with nothing left is refused */ expect(normEmp("x".repeat(31))).toBeNull();
  });
});

describe("the settings", () => {
  test("verify and employeesOnly are saved and shown; employees only forces 'only people on a list' and switches guest invites off", async () => {
    const t = await setup({ verify: "both", invites: { on: true, per: 3, cats: ["family"] } });
    let s = await j(await call("GET", "/api/z/PPL-1/summary", undefined, t.master)); expect(s.verify).toBe("both"); expect(s.employeesOnly).toBe(false); expect(s.invites.on).toBe(true);
    expect((await call("PATCH", "/api/z/PPL-1/settings", { employeesOnly: true }, t.master)).status).toBe(200);
    s = await j(await call("GET", "/api/z/PPL-1/summary", undefined, t.master)); expect(s.employeesOnly).toBe(true); expect(s.invites.on).toBe(false); expect(s.whoCanJoin).toBe("list");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { verify: "passport" }, t.master)).status).toBe(400);
  });
  test("a later save that does not mention them (prizes, brand moments, tickets) keeps what a person must give and employees only", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    const keep = async (what: string) => { const s = await j(await call("GET", "/api/z/PPL-1/summary", undefined, t.master)); expect([what, s.verify, s.employeesOnly, s.whoCanJoin]).toEqual([what, "id", true, "list"]); };
    await keep("after setup");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { rewards: [{ pattern: "first", ordinal: 1, text: "" }] }, t.master)).status).toBe(200); await keep("after the prizes");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { tickets: 1, opening: [], breaks: [], closing: [] }, t.master)).status).toBe(200); await keep("after the brand moments");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { rounds: 2 }, t.master)).status).toBe(200); await keep("after the rounds");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { verify: "mobile", employeesOnly: false }, t.master)).status).toBe(200); // choosing differently still works
    const s = await j(await call("GET", "/api/z/PPL-1/summary", undefined, t.master)); expect([s.verify, s.employeesOnly]).toEqual(["mobile", false]);
  });
});

describe("employees only, ID alone", () => {
  test("a listed employee joins with the ID only; a wrong ID waits; a missing ID is asked for; a mobile number alone is no way in", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    const r = await j(await add(t.master, [{ name: "Asha", empId: "e-101" }, { name: "Ravi", empId: "E102", phone: mob(2) }, { name: "NoId", phone: mob(3) }, { name: "Dup", empId: "E-101" }]));
    expect(r.added).toBe(2); expect(r.duplicates).toBe(1); expect(r.invalid.length).toBe(1);
    expect(r.people.find((p: any) => p.name === "Asha")).toMatchObject({ empId: "E-101", maskedPhone: "", waLink: null });
    const ok = await joinAs("PPL-1", 5, { phone: undefined, empId: " e-101 " }); expect(ok.status).toBe(200);
    expect((await joinAs("PPL-1", 5, { phone: undefined, empId: "E-101" })).status).toBe(200); // the same ID again is the same person
    const wrong = await joinAs("PPL-1", 6, { phone: undefined, empId: "E999" }); expect(wrong.status).toBe(403); expect((await j(wrong)).code).toBe("waiting");
    const none = await joinAs("PPL-1", 7, { phone: undefined }); expect(none.status).toBe(400); expect((await j(none)).code).toBe("need-id");
    expect((await joinAs("PPL-1", 8, {})).status).toBe(400);
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(1);
    expect(rowsOf("SELECT ph FROM person").map((x) => x.ph)).toContain(await empHashOf(env, "E-101"));
  });
});

describe("employees only, mobile and ID", () => {
  test("right number but wrong ID waits for the organizer; right number with no ID is asked for the ID; both right gets in", async () => {
    const t = await setup({ verify: "both", employeesOnly: true });
    const r = await j(await add(t.master, [{ name: "Asha", phone: mob(1), empId: "E101" }, { name: "NoId", phone: mob(2) }]));
    expect(r.added).toBe(1); expect(r.invalid.length).toBe(1);
    const w = await joinAs("PPL-1", 1, { empId: "E555", device: dev(41) }); expect(w.status).toBe(403); expect((await j(w)).code).toBe("waiting");
    const m = await joinAs("PPL-1", 1, { device: dev(42) }); expect(m.status).toBe(400); expect((await j(m)).code).toBe("need-id");
    expect((await joinAs("PPL-1", 1, { empId: "e101", device: dev(43) })).status).toBe(200);
  });
});

describe("an employee known by ID stays known by it", () => {
  test("sending the link again with a new contact number keeps the ID (the ID still gets in; the export still shows it)", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    const r = await j(await add(t.master, [{ name: "Asha", empId: "E101", phone: mob(2) }])); const id = r.people[0].id;
    const re = await call("POST", `/api/z/PPL-1/people/${id}/resend`, { phone: mob(7) }, t.master); expect(re.status).toBe(200);
    expect((await joinAs("PPL-1", 5, { phone: undefined, empId: "e101" })).status).toBe(200);
    const csv = await (await call("GET", "/api/z/PPL-1/people/export", undefined, t.master)).text(); expect(csv).toContain("E101"); expect(csv).toContain(mob(7));
  });
});

describe("mobile number OR employee ID", () => {
  test("a listed person gets in with either one and is the same card both ways; unlisted people wait; an outsider in an open game gives a mobile number", async () => {
    const t = await setup({ verify: "either", employeesOnly: true });
    const r = await j(await add(t.master, [{ name: "Both", phone: mob(1), empId: "E101" }, { name: "IdOnly", empId: "E102" }, { name: "PhoneOnly", phone: mob(3) }, { name: "Nobody" }]));
    expect(r.added).toBe(3); expect(r.invalid.length).toBe(1); expect(r.invalid[0].why).toMatch(/mobile number or an employee ID/);
    const byId = await j(await joinAs("PPL-1", 21, { phone: undefined, empId: "e101", device: dev(50) })); expect(byId.pid).toBeTruthy();
    const byPhone = await j(await joinAs("PPL-1", 1, { device: dev(50) })); expect(byPhone.pid).toBe(byId.pid); // the same person, the same card, whichever they give
    expect((await joinAs("PPL-1", 22, { phone: undefined, empId: "E102" })).status).toBe(200); // known by ID alone
    expect((await joinAs("PPL-1", 3, {})).status).toBe(200); // known by mobile alone
    const wrong = await joinAs("PPL-1", 40, { phone: undefined, empId: "E999" }); expect(wrong.status).toBe(403); expect((await j(wrong)).code).toBe("waiting");
    const stranger = await joinAs("PPL-1", 41, {}); expect(stranger.status).toBe(403); expect((await j(stranger)).code).toBe("waiting"); // employees only: an unlisted number waits
    const none = await joinAs("PPL-1", 42, { phone: undefined }); expect(none.status).toBe(400); expect((await j(none)).code).toBe("need-id");
    const csv = await (await call("GET", "/api/z/PPL-1/people/export", undefined, t.master)).text(); expect(csv).toContain("E101"); expect(csv).toContain("E102");
  });
  test("the same employee ID cannot be given to two people of one list, and an ID still finds its person after the link is sent again with a new number", async () => {
    const t = await setup({ verify: "either" });
    const r = await j(await add(t.master, [{ name: "First", phone: mob(1), empId: "E101" }, { name: "Second", phone: mob(2), empId: "e101" }]));
    expect(r.added).toBe(1); expect(r.duplicates).toBe(1);
    const re = await call("POST", `/api/z/PPL-1/people/${r.people[0].id}/resend`, { phone: mob(9) }, t.master); expect(re.status).toBe(200);
    const byId = await j(await joinAs("PPL-1", 40, { phone: undefined, empId: "E101", device: dev(60) })); expect(byId.pid).toBeTruthy();
    const byNew = await j(await joinAs("PPL-1", 9, { device: dev(60) })); expect(byNew.pid).toBe(byId.pid); // the new number and the ID are the same person
  });
  test("everyone including employees: an outsider joins with a mobile number alone; settings accept the mode", async () => {
    const t = await setup({ verify: "either" }); await add(t.master, [{ name: "Both", phone: mob(1), empId: "E101" }]);
    expect((await joinAs("PPL-1", 5, {})).status).toBe(200);
    expect((await joinAs("PPL-1", 6, { phone: undefined, empId: "E101" })).status).toBe(200);
    const s = await j(await call("GET", "/api/z/PPL-1/summary", undefined, t.master)); expect(s.verify).toBe("either");
  });
});

describe("junk in a list is cleaned by the server too", () => {
  test("a name that starts like a spreadsheet formula, or holds markup or control characters, is kept tidy; the list export is safe to open", async () => {
    const t = await setup({}); const r = await j(await add(t.master, [{ name: "=HYPERLINK(\"http://x\")", phone: mob(1) }, { name: "<script>alert(1)</script>Bob", phone: mob(2) }, { name: "Ann ​Lee", phone: mob(3) }]));
    expect(r.added).toBe(3); const names = r.people.map((p: any) => p.name); expect(names.join("|")).not.toMatch(/[=<> ​]/);
    const csv = await (await call("GET", "/api/z/PPL-1/people/export", undefined, t.master)).text(); expect(csv.split(/\r?\n/).some((l) => /^"?[=@]/.test(l))).toBe(false);
  });
});

describe("guessing employee IDs", () => {
  test("wrong IDs wait for the organizer, who sees the ID that was typed; after 30 wrong IDs from one network in a game the door closes for ten minutes; a right ID is not counted", async () => {
    const t = await setup({ verify: "id", employeesOnly: true }); await add(t.master, [{ name: "Asha", empId: "E101" }]);
    for (let i = 0; i < 30; i++) expect((await joinAs("PPL-1", 10 + i, { phone: undefined, empId: "X" + (900 + i) })).status).toBe(403);
    const eleventh = await joinAs("PPL-1", 60, { phone: undefined, empId: "X999" }); expect(eleventh.status).toBe(429); expect((await j(eleventh)).code).toBe("too-many-tries");
    const w = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting; expect(w.length).toBe(30); expect(w.map((x: any) => x.empId)).toContain("X900");
    expect((await joinAs("PPL-1", 61, { phone: undefined, empId: "E101" })).status).toBe(200); // the real employee still gets in
  });
});

describe("everyone, including employees", () => {
  test("ID: employees give their ID; an outsider gives a mobile number only and comes in at once; an unknown ID waits; guests can still invite", async () => {
    const t = await setup({ verify: "id", invites: { on: true, per: 2, cats: ["family"] } });
    await add(t.master, [{ name: "Asha", empId: "E101" }]);
    expect((await joinAs("PPL-1", 5, { phone: undefined, empId: "E101" })).status).toBe(200);
    expect((await joinAs("PPL-1", 6, {})).status).toBe(200);
    const bad = await joinAs("PPL-1", 7, { phone: undefined, empId: "E404" }); expect(bad.status).toBe(403); expect((await j(bad)).code).toBe("waiting");
    const s = await j(await call("GET", "/api/z/PPL-1/summary", undefined, t.master)); expect(s.invites.on).toBe(true);
  });
  test("both: an employee must match number and ID; an outsider gives the number alone; an ID on no list waits", async () => {
    const t = await setup({ verify: "both" });
    await add(t.master, [{ name: "Asha", phone: mob(1), empId: "E101" }]);
    expect((await joinAs("PPL-1", 1, {})).status).toBe(400);
    expect((await joinAs("PPL-1", 1, { empId: "E101" })).status).toBe(200);
    expect((await joinAs("PPL-1", 2, {})).status).toBe(200);
    expect((await joinAs("PPL-1", 3, { empId: "E777" })).status).toBe(403);
  });
});

describe("mobile only (the default) is unchanged", () => {
  test("an ID typed in a mobile-only game is ignored", async () => {
    const t = await setup({ closed: true }); await add(t.master, [{ name: "Asha", phone: mob(1) }]);
    expect((await joinAs("PPL-1", 1, { empId: "E1" })).status).toBe(200);
    expect((await joinAs("PPL-1", 2, {})).status).toBe(403);
  });
});

describe("the list download carries the ID", () => {
  test("the Employee ID column is there", async () => {
    const t = await setup({ verify: "id" }); await add(t.master, [{ name: "Asha", empId: "E101" }]);
    const txt = await (await call("GET", "/api/z/PPL-1/people/export", undefined, t.master)).text();
    expect(txt).toContain("Employee ID"); expect(txt).toContain("E101");
  });
});

describe("the owner's three test sign-ins", () => {
  test("demo1/2/3@xyz.in sign in with 123456, no e-mail is sent, the same account comes back each time, and a wrong code or another address is refused", async () => {
    await setMode(env as any, "TEST", "test sign-ins work only in TEST mode (TT-21)", T);
    for (const em of ["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]) {
      expect((await call("POST", "/api/auth/email", { email: em })).status).toBe(200);
      const a = await j(await call("POST", "/api/auth/verify", { email: em, code: "123456" })); expect(a.token).toMatch(/^cbk_/);
      const b = await j(await call("POST", "/api/auth/verify", { email: em, code: "123456" })); expect(b.token).toMatch(/^cbk_/);
      expect((await call("POST", "/api/auth/verify", { email: em, code: "654321" })).status).toBe(400);
    }
    expect(rowsOf("SELECT COUNT(*) c FROM outbox WHERE to_addr LIKE '%xyz.in'")[0].c).toBe(0);
    expect(rowsOf("SELECT COUNT(*) c FROM organizer_email")[0].c).toBe(3);
    expect((await call("POST", "/api/auth/verify", { email: "demo4@xyz.in", code: "123456" })).status).toBe(400);
  });
  test("the test sign-ins are limited per network per day, record no Terms consent, never send mail, and keep only their latest six keys", async () => {
    await setMode(env as any, "TEST", "test sign-ins work only in TEST mode (TT-21)", T);
    const em = "demo2@xyz.in"; const fire = () => call("POST", "/api/auth/verify", { email: em, code: "123456" });
    for (let i = 0; i < 30; i++) expect((await fire()).status).toBe(200);
    const blocked = await fire(); expect(blocked.status).toBe(429);
    expect(rowsOf("SELECT COUNT(*) c FROM consent_log WHERE kind='K2'")[0].c).toBe(0);
    const org = rowsOf("SELECT org FROM organizer_email")[0].org;
    expect(rowsOf("SELECT COUNT(*) c FROM organizer_key WHERE org=? AND kind='master'", org)[0].c).toBeLessThanOrEqual(6);
    const { sendMail } = await import("../src/pay"); expect(await sendMail(env as any, (env as any).DB, em, "Your report", "text", T)).toBe(false);
    expect(rowsOf("SELECT COUNT(*) c FROM outbox WHERE to_addr LIKE '%xyz.in'")[0].c).toBe(0);
  });
});

describe("the owner's three test sign-ins are for TEST mode only (TT-21, WP-17)", () => {
  test("in LIVE mode (the default) demo1/2/3@xyz.in with 123456 open nothing: no token, no organizer account made, and the request-a-code call gives no hint", async () => {
    for (const em of ["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]) {
      const r = await call("POST", "/api/auth/verify", { email: em, code: "123456" });
      expect(r.status).toBe(400); expect((await j(r)).token).toBeUndefined();
      expect((await call("POST", "/api/auth/email", { email: em })).status).toBe(200); // same plain answer as for any address; no code is made or mailed for these
      expect((await call("POST", "/api/auth/verify", { email: em, code: "123456" })).status).toBe(400);
    }
    expect(rowsOf("SELECT COUNT(*) c FROM organizer_email")[0].c).toBe(0);
    expect(rowsOf("SELECT COUNT(*) c FROM organizer_key")[0].c).toBe(0);
    expect(rowsOf("SELECT COUNT(*) c FROM outbox WHERE to_addr LIKE '%xyz.in'")[0].c).toBe(0);
  });
  test("switching the service to LIVE closes them again at once, even for an account made earlier in TEST", async () => {
    await setMode(env as any, "TEST", "walk-through", T);
    const a = await j(await call("POST", "/api/auth/verify", { email: "demo1@xyz.in", code: "123456" })); expect(a.token).toMatch(/^cbk_/);
    await setMode(env as any, "LIVE", "go live", T);
    const b = await call("POST", "/api/auth/verify", { email: "demo1@xyz.in", code: "123456" }); expect(b.status).toBe(400); expect((await j(b)).token).toBeUndefined();
  });
});

describe("this game's name-only joining with IDs asked", () => {
  test("when the organizer asks for IDs, a name alone is not a way in; an ID on no list waits for an answer, a mobile number comes in; 'both' needs the mobile number with the ID", async () => {
    const t = await setup({ verify: "id" });
    const nameOnly = await join("PPL-1", { name: "Sam", device: dev(1) }); expect(nameOnly.status).toBe(400); expect((await j(nameOnly)).code).toBe("need-id");
    expect((await joinAs("PPL-1", 2, { empId: undefined })).status).toBe(200); // an outsider with a mobile number only
    expect((await join("PPL-1", { name: "Sam", device: dev(3), empId: "E-7" })).status).toBe(403); // an ID that is on no list waits for the organizer's answer
    expect((await call("PATCH", "/api/z/PPL-1/settings", { verify: "both" }, t.master)).status).toBe(200);
    const noPhone = await join("PPL-1", { name: "Tia", device: dev(4), empId: "E-8" }); expect(noPhone.status).toBe(400); expect((await j(noPhone)).code).toBe("need-id");
  });
});
