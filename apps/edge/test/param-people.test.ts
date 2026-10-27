// Table-driven tests, part 3: phone number formats, guest list sizes, invitation policies, free-text safety (unicode, long, script and SQL-looking strings).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HOUR, MIN, PLAT, T, W, call, create, dev, j, join, keyH, mob, one, organizer, paidGame, publish, q, reset, restore, roundMs, startIn, uid } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

const add = (key: string, id: string, people: unknown[], query = "") => call("POST", `/api/z/${id}/people${query}`, { people }, { "x-organizer": key });

// ---------------------------------------------------------------------------------------------------------- phone formats
describe("phone number formats on a guest list", () => {
  const VALID: [string, string][] = [
    ["plain ten digits", "9876543210"], ["a space in the middle", "98765 43210"], ["a dash", "98765-43210"], ["+91 and spaces", "+91 98765 43210"], ["a leading zero", "09876543210"],
    ["00 91 prefix", "0091 98765 43210"], ["brackets", "(98765) 43210"], ["91 with no plus", "919876543210"], ["+91 glued", "+919876543210"], ["a dot separator", "98765.43210"],
    ["UAE number", "+971 50 123 4567"], ["UAE with 00", "00971501234567"], ["UK number", "+44 7911 123456"], ["US number", "+1 415 555 2671"],
  ];
  for (const [label, raw] of VALID) {
    test(`${label} (${raw}) is accepted and stored sealed`, async () => {
      const g = await paidGame({ cap: 100 });
      const r = await j(await add(g.key, g.id, [{ name: "Asha", phone: raw }]));
      expect(r.added).toBe(1); expect(r.invalid).toEqual([]);
      expect(JSON.stringify(q("SELECT * FROM person"))).not.toContain("Asha");
      expect(JSON.stringify(q("SELECT * FROM person"))).not.toMatch(/9876543210|50 123|7911/);
    });
  }
  const INVALID: [string, unknown][] = [
    ["empty", ""], ["letters", "abc"], ["too short", "12345"], ["an Indian number starting with 5", "5876543210"], ["+91 then a number starting with 5", "+91 5876543210"], ["91 then 9 digits", "91987654321"],
    ["16 digits", "1234567890123456"], ["a trailing letter", "9876543210x"], ["SQL after the number", "98765 43210; DROP TABLE person"], ["an emoji in the number", "🙂9876543210"], ["only spaces", "     "], ["a number as an object", { n: 1 }], ["null", null],
  ];
  for (const [label, raw] of INVALID) {
    test(`${label} is refused by name, nothing is stored`, async () => {
      const g = await paidGame({ cap: 100 });
      const r = await j(await add(g.key, g.id, [{ name: "Asha", phone: raw }]));
      expect(r.added ?? 0).toBe(0); expect((r.invalid ?? []).length).toBe(1);
      expect(q("SELECT * FROM person").length).toBe(0);
    });
  }
  test("the same number written five ways in one batch is added once, the other four are duplicates", async () => {
    const g = await paidGame({ cap: 100 });
    const r = await j(await add(g.key, g.id, ["9876543210", "98765 43210", "+91 98765 43210", "09876543210", "919876543210"].map((phone, i) => ({ name: "P" + i, phone }))));
    expect(r.added).toBe(1); expect(r.duplicates).toBe(4);
  });
  test("a number already on the list is a duplicate when added again later; the first name wins", async () => {
    const g = await paidGame({ cap: 100 });
    await add(g.key, g.id, [{ name: "First", phone: "9876543210" }]);
    const r = await j(await add(g.key, g.id, [{ name: "Second", phone: "+91 98765 43210" }]));
    expect(r.added).toBe(0); expect(r.duplicates).toBe(1);
    const list = await j(await call("GET", `/api/z/${g.id}/people`, undefined, g.h));
    expect(list.people.map((p: any) => p.name)).toEqual(["First"]);
  });
  test("the list shows the number masked to its last four digits (the WhatsApp link is the organizer's own way to send the invitation)", async () => {
    const g = await paidGame({ cap: 100 });
    await add(g.key, g.id, [{ name: "Asha", phone: "9876543210" }]);
    const p = (await j(await call("GET", `/api/z/${g.id}/people`, undefined, g.h))).people[0];
    expect(p.maskedPhone).toBe("******3210"); expect(Object.keys(p)).not.toContain("phone");
    expect((await call("GET", `/api/z/${g.id}/people`, undefined, {})).status).toBe(403); // and nobody without a key sees any of it
  });
  test("the CSV export neutralises a cell that starts with = + - or @ (spreadsheet formulas)", async () => {
    const g = await paidGame({ cap: 100 });
    for (const [i, nm] of ["=SUM(A1)", "+cmd|calc", "-2+3", "@HYPERLINK(1)", "Plain"].entries()) await add(g.key, g.id, [{ name: nm, phone: mob(i + 1) }]);
    const csv = await (await call("GET", `/api/z/${g.id}/people/export`, undefined, g.h)).text();
    for (const bad of ["=SUM", "+cmd", "-2+3", "@HYPER"]) { expect(csv).not.toContain("\n" + bad); expect(csv).not.toContain(",\"" + bad); expect(csv).toContain(bad.replace(/^[=+\-@]+/, "")); }
  });
});

// ---------------------------------------------------------------------------------------------------------- list sizes
describe("guest list sizes", () => {
  test("an empty list is refused with a plain 400", async () => {
    const g = await paidGame({ cap: 100 });
    expect((await add(g.key, g.id, [])).status).toBe(400);
  });
  test("one person", async () => {
    const g = await paidGame({ cap: 100 });
    const r = await j(await add(g.key, g.id, [{ name: "One", phone: mob(1) }])); expect(r.added).toBe(1);
  });
  test("a hundred people in one go on a 100-player game, and a 101st is refused", async () => {
    const g = await paidGame({ cap: 100 });
    const r = await j(await add(g.key, g.id, Array.from({ length: 100 }, (_, i) => ({ name: "P" + i, phone: mob(i + 1) })))); expect(r.added).toBe(100);
    const more = await add(g.key, g.id, [{ name: "Extra", phone: mob(500) }]);
    expect(more.status).toBeGreaterThanOrEqual(400); expect(more.status).toBeLessThan(500);
    expect(q("SELECT COUNT(*) c FROM person")[0].c).toBe(100);
  });
  test("a thousand people in five batches of 200 on a 1000-player game; the list reports the total and pages", async () => {
    const g = await paidGame({ cap: 1000 });
    for (let b = 0; b < 5; b++) { const r = await j(await add(g.key, g.id, Array.from({ length: 200 }, (_, i) => ({ name: "P" + (b * 200 + i), phone: "9" + String(200000000 + b * 200 + i) })))); expect(r.added).toBe(200); }
    const page = await j(await call("GET", `/api/z/${g.id}/people?limit=200&offset=800`, undefined, g.h));
    expect(page.total).toBe(1000); expect(page.people.length).toBe(200);
  });
  test("201 people in one request is refused (200 is the most per request)", async () => {
    const g = await paidGame({ cap: 1000 });
    const r = await add(g.key, g.id, Array.from({ length: 201 }, (_, i) => ({ name: "P" + i, phone: mob(i + 1) }))); expect([400, 413]).toContain(r.status);
  });
  test("the roster route takes at most 100 people", async () => {
    const g = await paidGame({ cap: 1000 });
    expect((await call("POST", `/api/z/${g.id}/roster`, { people: Array.from({ length: 101 }, (_, i) => ({ phone: mob(i + 1) })) }, g.h)).status).toBe(400);
    expect((await call("POST", `/api/z/${g.id}/roster`, { people: Array.from({ length: 100 }, (_, i) => ({ phone: mob(i + 1) })) }, g.h)).status).toBe(200);
  });
  test("a game of 2 can take exactly 2 players; the third is told the game is full", async () => {
    const g = await paidGame({ cap: 2 });
    expect((await join(g.id, 1)).status).toBe(200); expect((await join(g.id, 2)).status).toBe(200);
    const r = await join(g.id, 3); expect(r.status).toBe(409);
  });
  test("one phone number joins once; joining again from the same device gives the same card back", async () => {
    const g = await paidGame({ cap: 10 });
    const a = await j(await join(g.id, 1)), b = await j(await join(g.id, 1));
    expect(b.pid).toBe(a.pid); expect(q("SELECT COUNT(*) c FROM participant")[0].c).toBe(1);
  });
  test("a second device for the same number is refused (one card, one phone)", async () => {
    const g = await paidGame({ cap: 10 });
    expect((await join(g.id, 1)).status).toBe(200);
    expect((await join(g.id, 1, { device: dev(40) })).status).toBe(423);
  });
  test("two different numbers cannot share one device", async () => {
    const g = await paidGame({ cap: 10 });
    expect((await join(g.id, 1)).status).toBe(200);
    expect((await join(g.id, 2, { device: dev(1) })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------------------------------------- invitation policies
describe("invitation policies: anyone, invite-only, two-level chain", () => {
  test("anyone: any number joins", async () => {
    const g = await paidGame({ cap: 10 });
    expect((await join(g.id, 1)).status).toBe(200);
    expect((await join(g.id, 2, { phone: "+971 50 123 4567" })).status).toBe(200);
  });
  test("invite-only: a number that is not on the list is refused, a listed number (in any format) is let in", async () => {
    const g = await paidGame({ cap: 10 });
    expect((await call("PATCH", `/api/z/${g.id}/settings`, { closed: true }, g.h)).status).toBe(200);
    await add(g.key, g.id, [{ name: "Asha", phone: "+91 98765 43210" }]);
    expect((await join(g.id, 9, { phone: "9123456789" })).status).toBe(403);
    expect((await join(g.id, 1, { phone: "09876543210" })).status).toBe(200);
  });
  test("invite-only: the info answer says who can join, and a removed person cannot come back", async () => {
    const g = await paidGame({ cap: 10 });
    await call("PATCH", `/api/z/${g.id}/settings`, { closed: true }, g.h);
    const lst = await j(await add(g.key, g.id, [{ name: "Asha", phone: "9876543210" }]));
    const id = lst.people[0].id;
    expect((await j(await call("GET", `/api/z/${g.id}/info`))).whoCanJoin).toBe("list");
    expect((await call("POST", `/api/z/${g.id}/people/${id}/remove`, {}, g.h)).status).toBe(200);
    expect((await join(g.id, 1, { phone: "9876543210" })).status).toBeGreaterThanOrEqual(400);
  });
  test("an open game's info says anyone can join", async () => {
    const g = await paidGame({ cap: 10 }); expect((await j(await call("GET", `/api/z/${g.id}/info`))).whoCanJoin).toBe("anyone");
  });
  test("settings: invitations with 0 or 11 each, or an unknown kind of guest, are refused", async () => {
    const g = await paidGame({ cap: 10 });
    for (const inv of [{ on: true, per: 0, cats: ["family"] }, { on: true, per: 11, cats: ["family"] }, { on: true, per: 2, cats: ["aliens"] }, { on: true, per: 2, cats: [] }, { on: "yes", per: 2, cats: ["family"] }]) expect((await call("PATCH", `/api/z/${g.id}/settings`, { invites: inv }, g.h)).status).toBe(400);
    expect((await call("PATCH", `/api/z/${g.id}/settings`, { invites: { on: true, per: 2, cats: ["family"] } }, g.h)).status).toBe(200);
  });
  test("two-level chain: a guest may invite up to their limit; the next one is refused; a guest they invited may play but not invite", async () => {
    const g = await paidGame({ cap: 20 });
    await call("PATCH", `/api/z/${g.id}/settings`, { invites: { on: true, per: 2, cats: ["family", "colleagues"] } }, g.h);
    const a = await j(await join(g.id, 1));
    const mine = (people: unknown[]) => call("POST", `/api/z/${g.id}/people?me=${a.pid}&device=${dev(1)}`, { people }, {});
    expect((await j(await mine([{ name: "B", phone: mob(2) }, { name: "C", phone: mob(3) }]))).added).toBe(2);
    const over = await mine([{ name: "D", phone: mob(4) }]); expect(over.status).toBeGreaterThanOrEqual(400);
    // B joins from the link they were given; B has the right to play but not to invite
    const b = await j(await join(g.id, 2));
    expect(b.pid).toBeTruthy();
    const bTry = await call("POST", `/api/z/${g.id}/people?me=${b.pid}&device=${dev(2)}`, { people: [{ name: "E", phone: mob(5) }] }, {});
    expect(bTry.status).toBe(403);
  });
  test("a guest cannot invite when the organizer left invitations off", async () => {
    const g = await paidGame({ cap: 20 });
    const a = await j(await join(g.id, 1));
    expect((await call("POST", `/api/z/${g.id}/people?me=${a.pid}&device=${dev(1)}`, { people: [{ name: "B", phone: mob(2) }] }, {})).status).toBe(403);
  });
  test("a made-up card id cannot invite", async () => {
    const g = await paidGame({ cap: 20 });
    await call("PATCH", `/api/z/${g.id}/settings`, { invites: { on: true, per: 2, cats: ["family"] } }, g.h);
    expect((await call("POST", `/api/z/${g.id}/people?me=1zzzzzzzzzzzzz&device=${dev(1)}`, { people: [{ name: "B", phone: mob(2) }] }, {})).status).toBe(403);
  });
  test("an AI key is refused the people lists (names and numbers are for people)", async () => {
    const g = await paidGame({ cap: 20 });
    expect((await call("POST", `/api/z/${g.id}/people`, { people: [{ name: "B", phone: mob(2) }] }, { "x-organizer": g.ai })).status).toBe(403);
    expect((await call("GET", `/api/z/${g.id}/people`, undefined, { "x-organizer": g.ai })).status).toBe(403);
  });
  test("a Co-host has a list of their own with a limit; the Organizer sees it, the Co-host sees only theirs", async () => {
    const g = await paidGame({ cap: 20 });
    const co = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: g.id }, g.h))).cohostKey as string;
    await add(g.key, g.id, [{ name: "OrgGuest", phone: mob(1) }]);
    await add(co, g.id, [{ name: "CoGuest", phone: mob(2) }]);
    const mineAsCo = JSON.stringify(await j(await call("GET", `/api/z/${g.id}/people`, undefined, { "x-organizer": co })));
    expect(mineAsCo).toContain("CoGuest"); expect(mineAsCo).not.toContain("OrgGuest");
    const all = JSON.stringify(await j(await call("GET", `/api/z/${g.id}/people`, undefined, g.h)));
    expect(all).toContain("CoGuest"); expect(all).toContain("OrgGuest");
  });
});

// ---------------------------------------------------------------------------------------------------------- free text
describe("unicode, long names and hostile strings in every free-text field", () => {
  const STRINGS: [string, string][] = [
    ["a script tag", `<script>alert(1)</script>`], ["an image with an onerror", `<img src=x onerror=alert(1)>`], ["a javascript link", `<a href="javascript:alert(1)">x</a>`],
    ["an SVG onload", `<svg onload=alert(1)>`], ["a quote breaker", `"><script>alert(1)</script>`], ["a template string", "${alert(1)}`+`"],
    ["SQL: quote or 1=1", `'; DROP TABLE person; --`], ["SQL: union", `' UNION SELECT * FROM organizer_key --`], ["emoji and Hindi", "राजेश 🎉 कुमार"], ["Arabic", "محمد علي"],
    ["a very long name", "N".repeat(500)], ["null bytes and control characters", "A\u0000B\u0007C\u001bD"], ["right-to-left override", "abc‮def"],
  ];
  for (const [label, text] of STRINGS) {
    test(`a guest named with ${label}: stored sealed, no markup comes back in the list or the winners data, tables survive`, async () => {
      const g = await paidGame({ cap: 20 });
      const r = await add(g.key, g.id, [{ name: text, phone: mob(1) }]);
      expect(r.status).toBe(200);
      const list = JSON.stringify(await j(await call("GET", `/api/z/${g.id}/people`, undefined, g.h)));
      expect(list).not.toMatch(/[<>]/); // angle brackets are removed on the way in, so what comes back can never be read as markup
      expect(list.length).toBeLessThan(5000);
      expect(q("SELECT COUNT(*) c FROM organizer_key")[0].c).toBeGreaterThan(0); // tables still there
      expect(q("SELECT COUNT(*) c FROM person")[0].c).toBe(1);
    });
    test(`a player joining as ${label}: the organizer's name lookup returns no markup`, async () => {
      const g = await paidGame({ cap: 20 });
      const jn = await join(g.id, 1, { name: text }); expect(jn.status).toBe(200);
      const pid = (await j(jn)).pid;
      const names = JSON.stringify(await j(await call("GET", `/api/z/${g.id}/names?pids=${pid}`, undefined, g.h)));
      expect(names).not.toMatch(/[<>]/);
    });
  }
  const FIELDS: [string, (id: string, v: string, key: string) => Promise<Response>][] = [
    ["game name", (id, v, key) => call("PATCH", `/api/z/${id}/settings`, { name: v }, { "x-organizer": key })],
    ["prize text", (id, v, key) => call("PATCH", `/api/z/${id}/settings`, { rewards: [{ pattern: "top", ordinal: 1, text: v }] }, { "x-organizer": key })],
    ["announcement", (id, v, key) => call("POST", `/api/z/${id}/announce`, { text: v }, { "x-organizer": key })],
    ["brand moment title", (id, v, key) => call("PATCH", `/api/z/${id}/settings`, { breaks: [{ after: 30, seconds: 60, kind: "speech", title: v + "ok" }] }, { "x-organizer": key })],
    ["brand name", (id, v, key) => call("PATCH", `/api/z/${id}/settings`, { brand: { name: v + "ok", color: "#0B3D91" } }, { "x-organizer": key })],
  ];
  for (const [field, put] of FIELDS) {
    test(`the ${field} never keeps a script tag or event handler as markup`, async () => {
      const g = await paidGame({ cap: 20 });
      const r = await put(g.id, `<script>alert(1)</script><img src=x onerror=alert(2)>`, g.key);
      expect(r.status).toBeLessThan(500);
      const pub = JSON.stringify(await j(await call("GET", `/api/z/${g.id}/info`)));
      const ctl = JSON.stringify(await j(await call("GET", `/api/z/${g.id}/control`)));
      expect(pub + ctl).not.toMatch(/<script|<img/i);
    });
  }
  test("a 5000-character announcement is refused (160 is the most)", async () => {
    const g = await paidGame({ cap: 20 });
    expect((await call("POST", `/api/z/${g.id}/announce`, { text: "x".repeat(5000) }, g.h)).status).toBe(400);
    expect((await call("POST", `/api/z/${g.id}/announce`, { text: "x".repeat(160) }, g.h)).status).toBe(200);
  });
  test("a request body that is not JSON is a plain 400, never a 500", async () => {
    const g = await paidGame({ cap: 20 });
    const r = await call("POST", `/api/z/${g.id}/announce`, "{not json", g.h); expect(r.status).toBe(400);
  });
  test("a 100-kilobyte body is refused, not processed", async () => {
    const g = await paidGame({ cap: 20 });
    const r = await call("POST", `/api/z/${g.id}/announce`, { text: "x".repeat(100_000) }, g.h); expect([400, 413]).toContain(r.status);
  });
});
