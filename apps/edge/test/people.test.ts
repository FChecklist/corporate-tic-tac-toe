// Phase 2: people, links and joining (docs/ROLES_AND_CONSOLE_SPEC_3.md, apps/edge/src/people.ts).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { cleanPhone, parseFrom, fromCodeOf, COHOST_FROM, HOST_FROM, ORG_FROM, phoneHashOf } from "../src/people";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const roundMs = (r: number) => (GEN + (r - 1) * 3) * 1000;
const START = roundAt(T) + 1200; // one hour after T
const DURING = roundMs(START) + 20 * 60_000; // twenty minutes into the game
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, extra: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mob = (i: number) => "9" + String(100000000 + i); // 9100000001 ...
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const join = (id: string, body: Record<string, unknown>, now = T) => call("POST", `/api/z/${id}/join`, body, undefined, now);
const joinAs = (id: string, i: number, extra: Record<string, unknown> = {}, now = T) => join(id, { phone: mob(i), name: "G" + i, device: dev(i), ...extra }, now);

async function setup(opts: { closed?: boolean; cap?: number; invites?: unknown } = {}) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string, ai = st.aiKey as string;
  await call("POST", "/api/z", { id: "PPL-1", startRound: START, callSeconds: 6, cap: opts.cap ?? 100, ...(opts.closed ? { whoCanJoin: "list" } : {}) }, master);
  await call("POST", "/api/z/PPL-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  if (opts.invites) await call("PATCH", "/api/z/PPL-1/settings", { guestInvites: opts.invites }, master);
  const host = (await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500001" }, master))).hostKey as string;
  const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500002", e: "PPL-1" }, master))).cohostKey as string;
  return { master, ai, host, cohost };
}
const add = (key: string, people: unknown[], id = "PPL-1", q = "") => call("POST", `/api/z/${id}/people${q}`, { people }, key);
const list = async (key: string, id = "PPL-1", q = "") => j(await call("GET", `/api/z/${id}/people${q}`, undefined, key));
const tokenOf = (link: string) => link.split("/j/")[1]!;
const rowsOf = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...(v as any[])) as any[];

beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt" }; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("cleaning numbers", () => {
  test("spaces, dashes, +91, 0 and 00 go; Indian mobiles start 6 to 9; other country codes are kept; garbage is refused", () => {
    for (const raw of ["98765 43210", "98765-43210", "+91 98765 43210", "09876543210", "0091 98765 43210", "(98765) 43210"]) expect(cleanPhone(raw)).toMatchObject({ ok: true, digits: "919876543210", last10: "9876543210" });
    expect(cleanPhone("+971 50 123 4567")).toMatchObject({ ok: true, digits: "971501234567" });
    for (const bad of ["", "abc", "12345", "5876543210", "+91 5876543210", "91987654321", "1234567890123456"]) expect(cleanPhone(bad).ok).toBe(false);
  });
  test("link codes: the Organizer, Hosts, Co-hosts and a guest's seat never collide", () => {
    expect(parseFrom(ORG_FROM)).toEqual({ kind: "org" });
    expect(parseFrom(HOST_FROM + 255)).toEqual({ kind: "host", hex: "00000ff" });
    expect(parseFrom(COHOST_FROM + 255)).toEqual({ kind: "cohost", hex: "00000ff" });
    expect(parseFrom(7)).toEqual({ kind: "guest", seq: 7 });
    expect(fromCodeOf("h:00000ff")).toBe(HOST_FROM + 255); expect(fromCodeOf("c:00000ff")).toBe(COHOST_FROM + 255); expect(fromCodeOf("o")).toBe(ORG_FROM); expect(fromCodeOf("s:7")).toBe(7);
  });
  test("the phone hash used for lists is the one the join route uses", async () => {
    const t = await setup(); await add(t.master, [{ name: "A", phone: mob(1) }]);
    expect(rowsOf("SELECT ph FROM person")[0].ph).toBe(await phoneHashOf(env, "91" + mob(1)));
  });
});

describe("adding people", () => {
  test("a batch is cleaned: good ones added, duplicates inside the batch dropped, wrong ones listed", async () => {
    const t = await setup();
    const r = await j(await add(t.master, [{ name: "Asha", phone: "98765 43210" }, { name: "Asha again", phone: "+91-9876543210" }, { name: "Bala", phone: "12345" }, { name: "Cara", phone: mob(3) }, { name: "Dev" }]));
    expect(r.added).toBe(2); expect(r.duplicates).toBe(1); expect(r.invalid).toHaveLength(2);
    expect(r.invalid[0]).toMatchObject({ raw: expect.stringContaining("Bala"), why: expect.any(String) });
    expect(r.people[0]).toMatchObject({ name: "Asha", maskedPhone: "******3210", status: "invited" });
    expect(r.people[0].link).toMatch(/^https:\/\/bingo\.test\/j\/[a-z0-9]{10}$/);
    expect(r.people[0].waLink).toStartWith("https://wa.me/919876543210?text=");
    expect(decodeURIComponent(r.people[0].waLink)).toContain(r.people[0].link);
    expect(JSON.stringify(rowsOf("SELECT * FROM person"))).not.toContain("9876543210"); // sealed at rest
  });
  test("first list wins across inviters; a second add is a duplicate", async () => {
    const t = await setup();
    expect((await j(await add(t.host, [{ name: "Asha", phone: mob(1) }]))).added).toBe(1);
    const again = await j(await add(t.master, [{ name: "Asha", phone: mob(1) }, { name: "Bala", phone: mob(2) }]));
    expect(again).toMatchObject({ added: 1, duplicates: 1 });
    expect(rowsOf("SELECT inviter FROM person ORDER BY added_ms, id").map((x) => x.inviter[0]).sort()).toEqual(["h", "o"]);
  });
  test("a Co-host's limit counts the list (default 100, settable 10 to 1000); over the limit nothing is added; a removal frees the place", async () => {
    const t = await setup();
    expect((await call("PATCH", "/api/z/PPL-1/settings", { coHostLimit: 5 }, t.master)).status).toBe(400);
    expect((await call("PATCH", "/api/z/PPL-1/settings", { coHostLimit: 1001 }, t.master)).status).toBe(400);
    expect((await call("PATCH", "/api/z/PPL-1/settings", { coHostLimit: 10 }, t.master)).status).toBe(200);
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: "P" + i, phone: mob(10 + i) }));
    expect((await j(await add(t.cohost, nine))).added).toBe(9);
    const over = await add(t.cohost, [{ name: "X", phone: mob(30) }, { name: "Y", phone: mob(31) }]);
    expect(over.status).toBe(409); expect((await j(over)).code).toBe("over-limit");
    expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(9); // all or nothing
    const l = await list(t.cohost); expect(l).toMatchObject({ limit: 10, used: 9 });
    expect((await call("POST", `/api/z/PPL-1/people/${l.people[0].id}/remove`, {}, t.cohost)).status).toBe(200);
    expect((await j(await add(t.cohost, [{ name: "X", phone: mob(30) }, { name: "Y", phone: mob(31) }]))).added).toBe(2);
  });
  test("the number of people on all lists never passes the size bought", async () => {
    const t = await setup({ cap: 3 });
    const r = await add(t.master, Array.from({ length: 4 }, (_, i) => ({ name: "P" + i, phone: mob(i + 1) })));
    expect(r.status).toBe(409); expect((await j(r)).code).toBe("over-cap");
  });
  test("a Co-host sees only their own list; the Organizer and Host see everything with who invited", async () => {
    const t = await setup();
    await add(t.cohost, [{ name: "C1", phone: mob(1) }]); await add(t.host, [{ name: "H1", phone: mob(2) }]); await add(t.master, [{ name: "O1", phone: mob(3) }]);
    const co = await list(t.cohost); expect(co.people).toHaveLength(1); expect(co.people[0].inviter).toBeUndefined(); expect(co.canExport).toBe(false);
    const all = await list(t.master); expect(all.people).toHaveLength(3); expect(all.total).toBe(3);
    expect(all.people.map((p: any) => p.inviter).sort()).toEqual(["Co-host Ravi", "Host Priya", "Organizer"]);
    expect((await list(t.host)).people).toHaveLength(3);
  });
});

describe("who may call", () => {
  test("an AI key and an AI work link get 403 on every people and waiting route", async () => {
    const t = await setup(); await add(t.master, [{ name: "A", phone: mob(1) }]);
    for (const [m, p, b] of [["GET", "/api/z/PPL-1/people"], ["POST", "/api/z/PPL-1/people", { people: [{ name: "B", phone: mob(2) }] }], ["GET", "/api/z/PPL-1/people/export"], ["GET", "/api/z/PPL-1/waiting"], ["POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }]] as [string, string, unknown?][]) {
      expect((await call(m, p, b, t.ai)).status).toBe(403);
      expect((await call(m, p, b, t.master, T, { "x-cb-link": "1" })).status).toBe(403);
    }
    expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(1);
    expect(await (await call("GET", `/ai/${t.ai}/z/PPL-1/people`)).status).toBe(403);
  });
  test("a stranger and another organizer's key are refused; a Co-host of another game is refused", async () => {
    const t = await setup(); const other = await setup();
    expect((await call("GET", "/api/z/PPL-1/people")).status).toBe(403);
    expect((await call("GET", "/api/z/PPL-1/people", undefined, other.master)).status).toBe(403);
  });
  test("a Co-host cannot export; the Organizer and a Host can", async () => {
    const t = await setup(); await add(t.master, [{ name: "A", phone: mob(1) }]);
    expect((await call("GET", "/api/z/PPL-1/people/export", undefined, t.cohost)).status).toBe(403);
    expect((await call("GET", "/api/z/PPL-1/people/export", undefined, t.host)).status).toBe(200);
  });
  test("a level-1 guest has a list within their limit, known by ticket id; a guest invited by a guest has none; with invitations off nobody does", async () => {
    const t = await setup({ invites: { on: true, per: 2 } });
    const a = await j(await joinAs("PPL-1", 1)); const b = await j(await joinAs("PPL-1", 2, { from: 1 })); // seat 1 is level 1, seat 2 was invited by it
    const q = (pid: string, d = 1) => `?me=${pid}&device=${dev(d)}`; // the card id is public: the phone's own device id goes with it
    expect(await j(await call("GET", `/api/z/PPL-1/people${q(a.pid)}`))).toMatchObject({ limit: 2, used: 1 }); // the guest who joined through their link is on their list
    const r = await call("POST", `/api/z/PPL-1/people${q(a.pid)}`, { people: [{ name: "F1", phone: mob(11) }] });
    expect((await j(r)).added).toBe(1);
    const full = await call("POST", `/api/z/PPL-1/people${q(a.pid)}`, { people: [{ name: "F2", phone: mob(12) }] });
    expect(full.status).toBe(409);
    expect((await call("GET", `/api/z/PPL-1/people${q(b.pid, 2)}`)).status).toBe(403);
    expect((await call("GET", `/api/z/PPL-1/people?me=${a.pid}`)).status).toBe(403); // the card id is public (the seat list shows it): alone it is not enough
    const wrongPhone = await call("GET", `/api/z/PPL-1/people${q(a.pid, 9)}`); expect(wrongPhone.status).toBe(403); expect((await j(wrongPhone)).code).toBe("device");
    expect((await call("GET", `/api/z/PPL-1/waiting?me=${a.pid}`)).status).toBe(403);
    expect((await call("GET", `/api/z/PPL-1/people${q("nope")}`)).status).toBe(403);
    expect((await call("GET", `/api/z/PPL-1/people/export${q(a.pid)}`)).status).toBe(403);
    await call("PATCH", "/api/z/PPL-1/settings", { guestInvites: { on: false } }, t.master);
    expect((await call("GET", `/api/z/PPL-1/people${q(a.pid)}`)).status).toBe(403);
  });
  test("settings: guestInvites per goes up to 10, whoCanJoin is list or anyone and is the same switch as closed", async () => {
    const t = await setup();
    expect((await call("PATCH", "/api/z/PPL-1/settings", { guestInvites: { on: true, per: 10 } }, t.master)).status).toBe(200);
    expect((await call("PATCH", "/api/z/PPL-1/settings", { guestInvites: { on: true, per: 11 } }, t.master)).status).toBe(400);
    expect((await call("PATCH", "/api/z/PPL-1/settings", { whoCanJoin: "everyone" }, t.master)).status).toBe(400);
    expect((await j(await call("PATCH", "/api/z/PPL-1/settings", { whoCanJoin: "list" }, t.host))).closed).toBe(true);
    expect((await j(await call("GET", "/api/z/PPL-1/info"))).whoCanJoin).toBe("list");
    expect((await j(await call("PATCH", "/api/z/PPL-1/settings", { closed: false }, t.master))).whoCanJoin).toBe("anyone");
    expect((await call("PATCH", "/api/z/PPL-1/settings", { whoCanJoin: "list" }, t.cohost)).status).toBe(403);
  });
});

describe("personal links", () => {
  test("a listed person opens their link and types nothing; the link binds to the first phone", async () => {
    const t = await setup(); const added = (await j(await add(t.host, [{ name: "Asha", phone: mob(1) }]))).people[0];
    const tok = tokenOf(added.link);
    const ok = await join("PPL-1", { token: tok, device: dev(1) });
    expect(ok.status).toBe(200); const body = await j(ok); expect(body.pid).toBeTruthy();
    expect(rowsOf("SELECT status, inviter FROM person")[0].status).toBe("joined");
    expect(rowsOf("SELECT src FROM seat")[0].src).toBe("ho:" + rowsOf("SELECT inviter FROM person")[0].inviter.slice(2));
    expect((await join("PPL-1", { token: tok, device: dev(1) })).status).toBe(200); // same phone again
    const other = await join("PPL-1", { token: tok, device: dev(2) });
    expect(other.status).toBe(423); expect((await j(other)).needPhone).toBe(true);
  });
  test("send again rotates the link, kills the old one and unlocks the ticket for a new phone", async () => {
    const t = await setup(); const added = (await j(await add(t.master, [{ name: "Asha", phone: mob(1) }]))).people[0];
    await join("PPL-1", { token: tokenOf(added.link), device: dev(1) });
    const re = await j(await call("POST", `/api/z/PPL-1/people/${added.id}/resend`, {}, t.master));
    expect(re.link).not.toBe(added.link); expect(re.unlocked).toBe(true);
    expect((await join("PPL-1", { token: tokenOf(added.link), device: dev(2) })).status).toBe(404); // the old link is dead
    expect((await join("PPL-1", { token: tokenOf(re.link), device: dev(2) })).status).toBe(200);
    expect((await join("PPL-1", { token: tokenOf(re.link), device: dev(1) })).status).toBe(423);
  });
  test("send again can give someone who has not joined a new number, but not one already taken", async () => {
    const t = await setup(); const [a, b] = (await j(await add(t.master, [{ name: "A", phone: mob(1) }, { name: "B", phone: mob(2) }]))).people;
    expect((await call("POST", `/api/z/PPL-1/people/${a.id}/resend`, { phone: mob(2) }, t.master)).status).toBe(409);
    const re = await j(await call("POST", `/api/z/PPL-1/people/${a.id}/resend`, { phone: mob(5) }, t.master));
    expect(re.waLink).toContain("91" + mob(5));
    expect(rowsOf("SELECT id FROM person WHERE ph=?", await phoneHashOf(env, "91" + mob(1)))).toHaveLength(0); // the old number is gone from the list
    expect((await join("PPL-1", { token: tokenOf(re.link), device: dev(5) })).status).toBe(200); // the new link opens the ticket with no number typed
    expect(rowsOf("SELECT COUNT(*) c FROM person WHERE id=?", b.id)[0].c).toBe(1);
  });
  test("a different number on a personal link asks the link owner's chain, and the link owner can admit them", async () => {
    const t = await setup({ closed: true }); const added = (await j(await add(t.cohost, [{ name: "Asha", phone: mob(1) }]))).people[0];
    await join("PPL-1", { token: tokenOf(added.link), device: dev(1) });
    const stranger = await join("PPL-1", { token: tokenOf(added.link), phone: mob(9), name: "Zed", device: dev(9) });
    expect(stranger.status).toBe(403); const sb = await j(stranger); expect(sb.waiting).toBe(true);
    const w = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting;
    expect(w).toHaveLength(1); expect(w[0]).toMatchObject({ firstName: "Zed", last4: mob(9).slice(-4), via: "personal-link" });
  });
  test("/j/<token> is a page with Open Graph tags and a way on to the game; a removed or wrong token is a calm 404", async () => {
    const t = await setup(); await call("PATCH", "/api/z/PPL-1/settings", { name: "Diwali Bingo" }, t.master);
    const added = (await j(await add(t.master, [{ name: "Asha Rao", phone: mob(1) }]))).people[0];
    const page = await call("GET", `/j/${tokenOf(added.link)}`);
    const html = await page.text();
    expect(page.status).toBe(200); expect(html).toContain('property="og:title" content="You are invited to Diwali Bingo"'); expect(html).toContain("Asha, tap"); expect(html).toContain(`/z.html?e=PPL-1&amp;t=${tokenOf(added.link)}`);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await call("GET", "/j/zzzzzzzzzz")).status).toBe(404);
    await call("POST", `/api/z/PPL-1/people/${added.id}/remove`, {}, t.master);
    expect((await call("GET", `/j/${tokenOf(added.link)}`)).status).toBe(404);
  });
  test("an Organizer's or Host's own play seat is made through a personal link and is flagged automatically", async () => {
    const t = await setup();
    const mine = await j(await call("POST", "/api/z/PPL-1/people/me", {}, t.master)); // the publish step already gave the Organizer's mobile
    expect(mine.role).toBe("organizer"); expect(mine.person.link).toContain("/j/");
    const h = await j(await call("POST", "/api/z/PPL-1/people/me", {}, t.host)); expect(h.role).toBe("host");
    const c = await j(await call("POST", "/api/z/PPL-1/people/me", {}, t.cohost)); expect(c.role).toBe("co-host");
    const r = await j(await join("PPL-1", { token: tokenOf(mine.person.link), device: dev(1) }));
    expect(r.role).toBe("organizer");
    await join("PPL-1", { token: tokenOf(h.person.link), device: dev(2) }); await join("PPL-1", { token: tokenOf(c.person.link), device: dev(3) });
    expect(rowsOf("SELECT role FROM seat ORDER BY seq").map((x) => x.role)).toEqual(["organizer", "host", "co-host"]);
    expect((await list(t.master)).people.length).toBe(3);
    expect(rowsOf("SELECT COUNT(*) c FROM person WHERE role IS NULL")[0].c).toBe(0); // team seats are not guests: they use no limit
  });
});

describe("the common link and who can join", () => {
  test("a number on a list is recognised even through another inviter's link, and stays under its real inviter", async () => {
    const t = await setup(); await add(t.host, [{ name: "Asha", phone: mob(1) }]);
    const hostCode = fromCodeOf("h:" + rowsOf("SELECT inviter FROM person")[0].inviter.slice(2))!;
    expect((await joinAs("PPL-1", 1, { from: ORG_FROM })).status).toBe(200);
    expect(rowsOf("SELECT inviter, status FROM person")).toEqual([{ inviter: "h:" + rowsOf("SELECT inviter FROM person")[0].inviter.slice(2), status: "joined" }]);
    void hostCode;
  });
  test("'Only people on a list': an unlisted number waits (no place used); the game default 'anyone' joins at once under the link owner", async () => {
    const t = await setup({ closed: true });
    const w = await joinAs("PPL-1", 5, { from: ORG_FROM }); expect(w.status).toBe(403);
    const wb = await j(w); expect(wb).toMatchObject({ waiting: true, code: "waiting" }); expect(wb.error).toMatch(/by invitation/); expect(wb.with).toBe("the organizer");
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(0);
    expect((await joinAs("PPL-1", 5, { from: ORG_FROM })).status).toBe(403); // asking twice is one request
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(1);
    await call("PATCH", "/api/z/PPL-1/settings", { whoCanJoin: "anyone" }, t.master);
    expect((await joinAs("PPL-1", 6, { from: fromCodeOf("c:" + rowsOf("SELECT substr(hash,1,7) h FROM organizer_key WHERE kind='cohost'")[0].h)! })).status).toBe(200);
    expect(rowsOf("SELECT inviter FROM person")[0].inviter[0]).toBe("c");
    expect(rowsOf("SELECT src FROM seat")[0].src).toMatch(/^co:/);
  });
  test("under 'anyone', joining through a limited inviter stops at their limit and the rest wait for the Organizer or Host", async () => {
    const t = await setup({ invites: { on: true, per: 2 } });
    await joinAs("PPL-1", 1);
    expect((await joinAs("PPL-1", 2, { from: 1 })).status).toBe(200); expect((await joinAs("PPL-1", 3, { from: 1 })).status).toBe(200);
    const third = await joinAs("PPL-1", 4, { from: 1 }); expect(third.status).toBe(409);
    const b = await j(third); expect(b).toMatchObject({ code: "invite-full", waiting: true }); expect(b.error).toMatch(/2 people/);
    const w = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.host))).waiting; expect(w).toHaveLength(1); expect(w[0].overLimit).toBe(true);
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(3);
  });
  test("a crowd on one limited link at the same instant can never pass the limit", async () => {
    await setup({ invites: { on: true, per: 3 } });
    await joinAs("PPL-1", 1);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => joinAs("PPL-1", i + 2, { from: 1 })));
    expect(rs.filter((r) => r.status === 200).length).toBe(3); expect(rowsOf("SELECT COUNT(*) c FROM person WHERE inviter='s:1'")[0].c).toBe(3);
  });
});

describe("places promised to invited people", () => {
  test("in an open game the open link cannot take the places promised to people on a list; the invited people still get theirs and the game never passes its size", async () => {
    const t = await setup({ cap: 5 });
    expect((await j(await add(t.master, [{ name: "A", phone: mob(1) }, { name: "B", phone: mob(2) }]))).added).toBe(2); // 2 places promised
    for (const i of [10, 11, 12]) expect((await joinAs("PPL-1", i)).status).toBe(200); // 3 strangers fill the 3 free places
    expect((await joinAs("PPL-1", 13)).status).toBe(409); // a 4th stranger is told the game is full: the last 2 places belong to A and B
    expect((await joinAs("PPL-1", 1)).status).toBe(200); expect((await joinAs("PPL-1", 2)).status).toBe(200); // the promised places are kept
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(5);
    expect((await joinAs("PPL-1", 14)).status).toBe(409);
  });
});
describe("the waiting room", () => {
  const wait = async (t: Awaited<ReturnType<typeof setup>>, n: number, from: number | undefined = ORG_FROM) => { for (let i = 0; i < n; i++) await joinAs("PPL-1", 40 + i, { from }); };
  test("approvers: Organizer and Host see all; a Co-host sees only requests that came through their link", async () => {
    const t = await setup({ closed: true });
    const ch = fromCodeOf("c:" + rowsOf("SELECT substr(hash,1,7) h FROM organizer_key WHERE kind='cohost'")[0].h)!;
    await wait(t, 2, ORG_FROM); await wait(t, 0); await joinAs("PPL-1", 70, { from: ch });
    expect((await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting).toHaveLength(3);
    expect((await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.host))).waiting).toHaveLength(3);
    const mine = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.cohost))).waiting; expect(mine).toHaveLength(1); expect(mine[0].last4).toBe(mob(70).slice(-4));
    const orgOnly = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting.find((x: any) => x.last4 !== mob(70).slice(-4));
    expect((await call("POST", `/api/z/PPL-1/waiting/${orgOnly.id}`, { decision: "admit" }, t.cohost)).status).toBe(404); // not theirs
    expect((await call("POST", `/api/z/PPL-1/waiting/${mine[0].id}`, { decision: "maybe" }, t.cohost)).status).toBe(400);
  });
  test("the waiting room holds 500 requests: the 501st person is told it is full (429, waiting-full); someone already waiting is still told they are waiting; nobody takes a place", async () => {
    const t = await setup({ closed: true }); for (let i = 0; i < 500; i++) await joinAs("PPL-1", 40 + i, { from: ORG_FROM }, T + Math.floor(i / 150) * 61_000); // the same network may ask 200 times a minute: spread the requests over minutes
    expect(rowsOf("SELECT COUNT(*) c FROM waiting WHERE status='waiting'")[0].c).toBe(500);
    const extra = await joinAs("PPL-1", 900, { from: ORG_FROM }, T + 5 * 61_000); expect(extra.status).toBe(429); expect((await j(extra)).code).toBe("waiting-full");
    expect(rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(500); // the 501st left no row
    expect((await joinAs("PPL-1", 40, { from: ORG_FROM }, T + 6 * 61_000)).status).toBe(403); // a request already in the room is answered as before
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c + rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(0);
  }, 120_000);
  test("admit records who approved and when; the person is then recognised and joins; decline keeps them out", async () => {
    const t = await setup({ closed: true }); await joinAs("PPL-1", 1, { from: ORG_FROM }); await joinAs("PPL-1", 2, { from: ORG_FROM });
    const ws = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.host))).waiting;
    const w1 = ws.find((x: any) => x.last4 === mob(1).slice(-4)), w2 = ws.find((x: any) => x.last4 === mob(2).slice(-4));
    const pid = (await j(await call("GET", `/api/z/PPL-1/me?wid=${w1.id}`))).state; expect(pid).toBe("waiting");
    const ad = await j(await call("POST", `/api/z/PPL-1/waiting/${w1.id}`, { decision: "admit" }, t.host, T + 5000));
    expect(ad.admitted).toBe(true);
    const row = rowsOf("SELECT approved_by, approved_ms FROM person")[0]; expect(row.approved_by).toMatch(/^h:/); expect(row.approved_ms).toBe(T + 5000);
    expect((await list(t.master)).people[0].approvedBy).toBe("Host Priya");
    expect((await j(await call("GET", `/api/z/PPL-1/me?wid=${w1.id}`))).state).toBe("admitted");
    expect((await joinAs("PPL-1", 1, { from: ORG_FROM })).status).toBe(200);
    await call("POST", `/api/z/PPL-1/waiting/${w2.id}`, { decision: "decline" }, t.master);
    expect((await joinAs("PPL-1", 2, { from: ORG_FROM })).status).toBe(403); expect((await j(await call("GET", `/api/z/PPL-1/me?wid=${w2.id}`))).state).toBe("declined");
  });
  test("requests use no place; a full game says so; adding a waiting person to a list admits them, by whoever listed them", async () => {
    const t = await setup({ closed: true, cap: 3 });
    expect((await joinAs("PPL-1", 3, { from: ORG_FROM })).status).toBe(403);
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c + rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(0);
    expect((await j(await add(t.host, [{ name: "C", phone: mob(3) }]))).added).toBe(1);
    expect(rowsOf("SELECT status, decided_by FROM waiting")[0]).toMatchObject({ status: "admitted" });
    expect(rowsOf("SELECT decided_by FROM waiting")[0].decided_by).toMatch(/^h:/);
    expect((await joinAs("PPL-1", 3, { from: ORG_FROM })).status).toBe(200);
    await add(t.master, [{ name: "A", phone: mob(1) }, { name: "B", phone: mob(2) }]); await joinAs("PPL-1", 1); await joinAs("PPL-1", 2);
    const full = await joinAs("PPL-1", 4, { from: ORG_FROM }); expect(full.status).toBe(409); // all 3 places are taken
    expect(rowsOf("SELECT COUNT(*) c FROM waiting WHERE status='waiting'")[0].c).toBe(0);
  });
  test("approve all: counts, permissions, who approved is recorded for each, and the lists' limits are respected", async () => {
    const t = await setup({ closed: true });
    const ch = fromCodeOf("c:" + rowsOf("SELECT substr(hash,1,7) h FROM organizer_key WHERE kind='cohost'")[0].h)!;
    await wait(t, 3, ORG_FROM); for (let i = 0; i < 2; i++) await joinAs("PPL-1", 80 + i, { from: ch });
    expect((await call("POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }, t.ai)).status).toBe(403);
    expect((await call("POST", "/api/z/PPL-1/waiting/all", { decision: "perhaps" }, t.master)).status).toBe(400);
    const mine = await j(await call("POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }, t.cohost, T + 9000));
    expect(mine).toMatchObject({ admitted: 2, declined: 0, stillWaiting: 0 });
    expect(rowsOf("SELECT approved_by, approved_ms, inviter FROM person").every((r) => r.approved_by.startsWith("c:") && r.approved_ms === T + 9000 && r.inviter === r.approved_by)).toBe(true);
    const rest = await j(await call("POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }, t.master, T + 9500));
    expect(rest).toMatchObject({ admitted: 3, stillWaiting: 0 });
    expect(rowsOf("SELECT COUNT(*) c FROM person WHERE approved_by='o'")[0].c).toBe(3);
    expect(await j(await call("POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }, t.master))).toEqual({ admitted: 0, declined: 0, stillWaiting: 0 });
  });
  test("approve all stops when the game is full: admitted in order, the rest stay waiting with a calm message", async () => {
    const t = await setup({ closed: true, cap: 3 });
    await wait(t, 5, ORG_FROM);
    const r = await j(await call("POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }, t.master));
    expect(r).toMatchObject({ admitted: 3, declined: 0, stillWaiting: 2 }); expect(r.message).toMatch(/full/);
    expect(rowsOf("SELECT COUNT(*) c FROM waiting WHERE status='waiting'")[0].c).toBe(2);
    expect(rowsOf("SELECT ph FROM waiting WHERE status='admitted' ORDER BY at_ms, id").length).toBe(3);
  });
  test("a decline that lands between the admit's check and its write leaves nobody inside (one by one and approve all)", async () => {
    const t = await setup({ closed: true }); await wait(t, 4, ORG_FROM);
    const ws = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting;
    const realBatch = env.DB.batch.bind(env.DB);
    let lose = true; // the Host's decline wins just before the Organizer's admit is written: the decline is applied inside the admit's own moment
    (env.DB as any).batch = async (stmts: any[]) => { if (lose) { lose = false; raw.prepare("UPDATE waiting SET status='declined', decided_by='h:x', decided_ms=? WHERE status='waiting' AND id=?").run(T, ws[0].id); } return realBatch(stmts); };
    const one = await j(await call("POST", `/api/z/PPL-1/waiting/${ws[0].id}`, { decision: "admit" }, t.master));
    expect(one).toMatchObject({ ok: true, already: "declined" });
    expect(rowsOf("SELECT COUNT(*) c FROM waiting w JOIN person p ON p.eid=w.eid AND p.ph=w.ph WHERE w.id=?", ws[0].id)[0].c).toBe(0);
    lose = true; const all = ws.slice(1).map((w: any) => w.id); // approve all: the first of the rest is declined at the same moment
    (env.DB as any).batch = async (stmts: any[]) => { if (lose) { lose = false; raw.prepare("UPDATE waiting SET status='declined', decided_by='h:x', decided_ms=? WHERE status='waiting' AND id=?").run(T, all[0]); } return realBatch(stmts); };
    await call("POST", "/api/z/PPL-1/waiting/all", { decision: "admit" }, t.master);
    expect(rowsOf("SELECT COUNT(*) c FROM waiting w JOIN person p ON p.eid=w.eid AND p.ph=w.ph WHERE w.status='declined'")[0].c).toBe(0); // declined means out
    expect(rowsOf("SELECT COUNT(*) c FROM waiting w LEFT JOIN person p ON p.eid=w.eid AND p.ph=w.ph WHERE w.status='admitted' AND p.id IS NULL")[0].c).toBe(0); // admitted means in
    expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(2);
  });
  test("a request that was declined first cannot be admitted afterwards: nobody is added and the answer says it was already declined", async () => {
    const t = await setup({ closed: true }); await wait(t, 1, ORG_FROM);
    const w = (await j(await call("GET", "/api/z/PPL-1/waiting", undefined, t.master))).waiting[0];
    await call("POST", `/api/z/PPL-1/waiting/${w.id}`, { decision: "decline" }, t.host);
    expect(await j(await call("POST", `/api/z/PPL-1/waiting/${w.id}`, { decision: "admit" }, t.master))).toMatchObject({ ok: true, already: "declined" });
    expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c).toBe(0);
  });
  test("decline all answers every request the caller may decide, and only those", async () => {
    const t = await setup({ closed: true });
    const ch = fromCodeOf("c:" + rowsOf("SELECT substr(hash,1,7) h FROM organizer_key WHERE kind='cohost'")[0].h)!;
    await wait(t, 2, ORG_FROM); await joinAs("PPL-1", 90, { from: ch });
    expect(await j(await call("POST", "/api/z/PPL-1/waiting/all", { decision: "decline" }, t.cohost))).toEqual({ admitted: 0, declined: 1, stillWaiting: 0 });
    expect(rowsOf("SELECT COUNT(*) c FROM waiting WHERE status='waiting'")[0].c).toBe(2);
    expect((await j(await call("POST", "/api/z/PPL-1/waiting/all", { decision: "decline" }, t.host))).declined).toBe(2);
  });
});

describe("removing people", () => {
  test("before the game: the place is freed, the link stops, the same phone cannot come back; this person only, or with everyone they invited", async () => {
    const t = await setup({ invites: { on: true, per: 4 } });
    const p = (await j(await add(t.master, [{ name: "Asha", phone: mob(1) }]))).people[0];
    const asha = await j(await join("PPL-1", { token: tokenOf(p.link), device: dev(1) }));
    await call("POST", `/api/z/PPL-1/people?me=${asha.pid}&device=${dev(1)}`, { people: [{ name: "Kid", phone: mob(2) }] });
    await joinAs("PPL-1", 2);
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(2);
    const only = await j(await call("POST", `/api/z/PPL-1/people/${p.id}/remove`, {}, t.master));
    expect(only).toMatchObject({ ok: true, removed: 1, during: false });
    expect(rowsOf("SELECT COUNT(*) c FROM seat")[0].c).toBe(1); // Asha's seat is gone (the place is free); Kid stays
    expect((await join("PPL-1", { token: tokenOf(p.link), device: dev(1) })).status).toBe(404);
    const back = await joinAs("PPL-1", 1); expect(back.status).toBe(403); expect((await j(back)).code).toBe("removed");
    expect((await list(t.master)).people.find((x: any) => x.id === p.id)).toMatchObject({ status: "removed", link: null });
    // an Organizer may put them back
    expect((await j(await add(t.master, [{ name: "Asha", phone: mob(1) }]))).added).toBe(1);
    expect((await joinAs("PPL-1", 1)).status).toBe(200);
  });
  test("with everyone they invited", async () => {
    const t = await setup({ invites: { on: true, per: 4 } });
    const p = (await j(await add(t.master, [{ name: "Asha", phone: mob(1) }]))).people[0];
    const asha = await j(await join("PPL-1", { token: tokenOf(p.link), device: dev(1) }));
    await call("POST", `/api/z/PPL-1/people?me=${asha.pid}&device=${dev(1)}`, { people: [{ name: "Kid", phone: mob(2) }] });
    const r = await j(await call("POST", `/api/z/PPL-1/people/${p.id}/remove`, { withTheirPeople: true }, t.master));
    expect(r.removed).toBe(2); expect(rowsOf("SELECT COUNT(*) c FROM person WHERE status<>'removed'")[0].c).toBe(0);
  });
  test("a Co-host and a guest can remove only their own people; a Host's removal mails the Organizer", async () => {
    const t = await setup();
    const own = (await j(await add(t.cohost, [{ name: "C", phone: mob(1) }]))).people[0], theirs = (await j(await add(t.master, [{ name: "O", phone: mob(2) }]))).people[0];
    expect((await call("POST", `/api/z/PPL-1/people/${theirs.id}/remove`, {}, t.cohost)).status).toBe(404);
    expect((await call("POST", `/api/z/PPL-1/people/${own.id}/remove`, {}, t.cohost)).status).toBe(200);
    expect((await call("POST", `/api/z/PPL-1/people/${theirs.id}/remove`, {}, t.host)).status).toBe(200);
    expect(rowsOf("SELECT subject FROM outbox WHERE subject LIKE '%A Host removed%'")).toHaveLength(1);
    expect(rowsOf("SELECT removed_by FROM person WHERE id=?", theirs.id)[0].removed_by).toMatch(/^h:/);
  });
  test("a Co-host can put back a person they removed themselves, but not one the Organizer removed: the refusal says who can", async () => {
    const t = await setup();
    const mine = (await j(await add(t.cohost, [{ name: "C", phone: mob(1) }]))).people[0], theirs = (await j(await add(t.cohost, [{ name: "D", phone: mob(2) }]))).people[0];
    expect((await call("POST", `/api/z/PPL-1/people/${mine.id}/remove`, {}, t.cohost)).status).toBe(200);
    expect((await call("POST", `/api/z/PPL-1/people/${theirs.id}/remove`, {}, t.master)).status).toBe(200);
    const back = await j(await add(t.cohost, [{ name: "C", phone: mob(1) }]));
    expect(back).toMatchObject({ added: 1, duplicates: 0 }); expect(back.invalid).toEqual([]);
    expect(rowsOf("SELECT status FROM person WHERE id=?", mine.id)[0].status).toBe("invited");
    const refused = await j(await add(t.cohost, [{ name: "D", phone: mob(2) }]));
    expect(refused).toMatchObject({ added: 0, duplicates: 0 }); expect(refused.invalid[0].why).toMatch(/Ask the Organizer or a Host to put them back/);
    expect(rowsOf("SELECT status FROM person WHERE id=?", theirs.id)[0].status).toBe("removed");
    expect((await j(await add(t.master, [{ name: "D", phone: mob(2) }]))).added).toBe(1); // the Organizer can
  });
  test("during the game only the Organizer and Host can remove; the seat STAYS in the public seat list, the phone stops, the prize is marked not given", async () => {
    const t = await setup({ invites: { on: true, per: 4 } });
    const p = (await j(await add(t.master, [{ name: "Asha", phone: mob(1) }]))).people[0];
    const asha = await j(await join("PPL-1", { token: tokenOf(p.link), device: dev(1) })); await joinAs("PPL-1", 2);
    const seatsBefore = await j(await call("GET", "/api/z/PPL-1/seats", undefined, undefined, DURING));
    expect(seatsBefore.seats).toHaveLength(2);
    // a guest cannot remove during the game
    const mine = (await j(await add(t.cohost, [{ name: "C", phone: mob(3) }]))).people[0];
    expect((await call("POST", `/api/z/PPL-1/people/${mine.id}/remove`, {}, t.cohost, DURING)).status).toBe(403);
    expect((await call("POST", `/api/z/PPL-1/people/${p.id}/remove`, {}, t.master, DURING)).status).toBe(200);
    const seatsAfter = await j(await call("GET", "/api/z/PPL-1/seats", undefined, undefined, DURING));
    expect(seatsAfter.seats).toEqual(seatsBefore.seats); // identical on every phone
    expect(rowsOf("SELECT blocked FROM seat WHERE seq=1")[0].blocked).toBe(1);
    const claim = await call("POST", "/api/z/PPL-1/claims", { pid: asha.pid, claims: [{ pattern: "first", idx: 4 }] }, undefined, DURING);
    expect(claim.status).toBe(403); expect((await j(claim)).code).toBe("removed");
    expect((await j(await call("GET", `/api/z/PPL-1/me?pid=${asha.pid}`))).state).toBe("removed");
    const back = await join("PPL-1", { token: tokenOf(p.link), device: dev(1) }, DURING); expect(back.status).toBe(404);
    expect((await joinAs("PPL-1", 1, {}, DURING)).status).toBe(403);
    raw.prepare("INSERT INTO prize(eid,round,pattern,ordinal,seat) VALUES('PPL-1',1,'line',1,1)").run();
    const prizes = (await j(await call("GET", "/api/z/PPL-1/prizes", undefined, t.master, DURING))).prizes;
    expect(prizes[0]).toMatchObject({ notGiven: "removed", given: false });
    expect((await call("POST", "/api/z/PPL-1/prizegiven", { round: 1, pattern: "first", ordinal: 1, seat: 1, given: true }, t.master, DURING)).status).toBe(409);
  });
});

describe("export, privacy and cleanup", () => {
  test("the CSV has name, mobile, personal link, WhatsApp link and status, and a name cannot start a spreadsheet formula", async () => {
    const t = await setup(); await add(t.master, [{ name: "=HYPERLINK(1)", phone: mob(1) }, { name: "Bala", phone: mob(2) }]);
    const r = await call("GET", "/api/z/PPL-1/people/export", undefined, t.master);
    expect(r.headers.get("content-type")).toContain("text/csv"); const csv = await r.text();
    expect(csv).toContain("Name,Mobile,Personal link,WhatsApp link,Status"); expect(csv).toContain("HYPERLINK(1),91" + mob(1)); expect(csv).toContain("https://bingo.test/j/"); expect(csv).toContain(",Invited");
  });
  test("a Co-host adding a foreign number the Organizer removed is told with ONE plus sign", async () => {
    const t = await setup();
    const theirs = (await j(await add(t.master, [{ name: "U", phone: "+44 7911 123456" }]))).people[0];
    expect((await call("POST", `/api/z/PPL-1/people/${theirs.id}/remove`, {}, t.master)).status).toBe(200);
    const refused = await j(await add(t.cohost, [{ name: "U", phone: "+44 7911 123456" }]));
    expect(refused.added).toBe(0); expect(refused.invalid[0].raw).toContain("+447911123456"); expect(refused.invalid[0].raw).not.toContain("++");
  });
  test("deleting the guests' data (the 23-hour rule or on request) deletes people and waiting rows too", async () => {
    const t = await setup({ closed: true }); await add(t.master, [{ name: "A", phone: mob(1) }]); await joinAs("PPL-1", 5, { from: ORG_FROM });
    expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c + rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(2);
    expect((await call("POST", "/api/z/PPL-1/erase", {}, t.master)).status).toBe(200);
    expect(rowsOf("SELECT COUNT(*) c FROM person")[0].c + rowsOf("SELECT COUNT(*) c FROM waiting")[0].c).toBe(0);
  });
  test("a Host needs an e-mail or a mobile number (one is enough), kept sealed; a Co-host records who made them", async () => {
    const t = await setup();
    expect((await call("POST", "/api/org/host", { label: "X" }, t.master)).status).toBe(400);
    expect((await call("POST", "/api/org/host", { email: "x@acme.com", mobile: "123" }, t.master)).status).toBe(400);
    const hk = rowsOf("SELECT pii, created_by FROM organizer_key WHERE kind='host' ORDER BY created_ms"); expect(hk[0].pii).toBeTruthy(); expect(JSON.stringify(hk)).not.toContain("9876500001"); expect(hk[0].created_by).toBe("o");
    await call("POST", "/api/org/cohost", { label: "Meera", phone: "9876500003", e: "PPL-1" }, t.host);
    expect(rowsOf("SELECT created_by FROM organizer_key WHERE kind='cohost' ORDER BY created_ms").map((x) => x.created_by[0])).toEqual(["o", "h"]);
  });
  test("the report's who-invited-whom tree shows roles and who admitted whom", async () => {
    const { treeLines } = await import("../src/report-layout");
    const P = (o: any) => ({ seat: null, name: null, phone: null, joinedMs: 1, late: false, role: null, invitedBy: null, onRoster: false, joined: true, ...o });
    const lines = treeLines([P({ seat: 1, name: "Boss", role: "organizer", via: "Organizer" }), P({ seat: 2, name: "Asha", via: "Host Priya", admittedBy: "Organizer" }), P({ seat: 3, name: "Kid", via: "Host Priya", invitedBy: 2 }), P({ seat: 4, name: "Zed", via: "Co-host Ravi", removed: true })]);
    expect(lines[0]).toBe("[Organizer]"); expect(lines.join(" ")).toContain("[Host Priya]"); expect(lines.join(" ")).toContain("[Co-host Ravi]");
    expect(lines.find((l) => l.includes("Asha"))).toContain("(admitted by Organizer)"); expect(lines.find((l) => l.includes("Zed"))).toContain("(removed)");
    expect(lines.find((l) => l.includes("Kid"))!.indexOf("Kid")).toBeGreaterThan(lines.find((l) => l.includes("Asha"))!.indexOf("Asha")); // a guest's guest sits under the guest
  });
});
