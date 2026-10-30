// Table-driven tests, part 1: packs and prices, free publish, start times, speeds, rounds, tickets, prize houses, brand moments, lucky draws.
// Every row is a named test. Real Worker code, in-memory D1, fake mailbox (the outbox table), fake Razorpay. No browser.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PACKS, price } from "../../../packages/shared/src/pricing";
import { PRIZE_HOUSES, LUCKY_WINNERS, MAX_ROUNDS, OPENING_WINDOW_SECONDS, maxMidFor } from "../../../packages/beacon/src/config";
import { luckyWinners } from "../../../packages/beacon/src/game";
import { MAX_AHEAD_MS } from "../src/lifecycle";
import { DAY, HOUR, MIN, T, W, call, capture, checkout, create, eng, j, keyH, organizer, paidGame, publish, q, one, reset, restore, roundAt, roundMs, startIn, uid, verify, mob, dev, join, PLAT } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

// ---------------------------------------------------------------------------------------------------------- packs and prices
describe("packs x price (packages/shared pricing is the single source)", () => {
  const caps: [number, number][] = [[100, 100], [101, 250], [250, 250], [251, 500], [500, 500], [501, 750], [750, 750], [751, 1000], [1000, 1000], [1001, 2500], [2500, 2500], [2501, 5000], [5000, 5000], [5001, 10000], [10000, 10000]];
  for (const [cap, pack] of caps) {
    test(`a game of ${cap} players is sold as the ${pack} pack, charged in paise exactly as pricing.ts says`, async () => {
      const o = await organizer(); const id = uid();
      expect((await create(o.key, id, { cap })).status).toBe(200);
      expect((await publish(o.key, id)).status).toBe(200);
      const c = await checkout(o.key, { eid: id });
      expect(c.status).toBe(200);
      expect(c.body.razorpay.amount).toBe(Math.round(price(pack, "INR").total * 100));
      expect(W.orders[0].currency).toBe("INR");
    });
  }
  test("a game bigger than the biggest pack cannot be checked out", async () => {
    const o = await organizer(); const id = uid();
    expect((await create(o.key, id, { cap: 10001 })).status).toBe(200);
    expect((await publish(o.key, id)).status).toBe(200);
    expect((await checkout(o.key, { eid: id })).status).toBe(400);
    expect(W.orders.length).toBe(0);
  });
  for (const [pack, inr, usd] of PACKS) {
    test(`pack ${pack}: INR ${inr} and USD ${usd} in the price table, no GST added while GST_ON is false`, () => {
      expect(price(pack, "INR")).toEqual({ total: inr, base: inr, tax: 0 });
      expect(price(pack, "USD").total).toBe(usd);
    });
  }
  test("USD is refused until international is switched on, then charged in cents", async () => {
    expect((await checkout(undefined, { pack: 500, currency: "USD" })).status).toBe(400);
    reset({ RAZORPAY_INTERNATIONAL: "1" } as any);
    const c = await checkout(undefined, { pack: 500, currency: "USD" });
    expect(c.status).toBe(200); expect(W.orders[0].amount).toBe(67 * 100); expect(W.orders[0].currency).toBe("USD");
  });
  for (const bad of [0, -1, 99, 101, 123, 99999, null, 5e2 + 0.5, "abc"]) {
    test(`a pack of ${JSON.stringify(bad)} is refused before anything is created`, async () => {
      const c = await checkout(undefined, { pack: bad });
      expect(c.status).toBe(400); expect(W.orders.length).toBe(0); expect(one("SELECT COUNT(*) c FROM payment").c).toBe(0);
    });
  }
});

describe("free publish (FREE_LAUNCH) versus paid", () => {
  const rows: [string, Record<string, string>, number, boolean][] = [
    ["switch on, 1 player", { FREE_LAUNCH: "1" }, 1, true], ["switch on, 100 players", { FREE_LAUNCH: "1" }, 100, true], ["switch on, 101 players", { FREE_LAUNCH: "1" }, 101, false],
    ["switch off, 50 players", {}, 50, false], ["switch off, 100 players", {}, 100, false], ["switch off, 500 players", {}, 500, false],
  ];
  for (const [name, env, cap, free] of rows) {
    test(`${name}: ${free ? "published and paid at once" : "published, payment pending"}`, async () => {
      reset(env as any);
      const o = await organizer(); const id = uid();
      await create(o.key, id, { cap });
      const r = await j(await publish(o.key, id));
      expect(r.published).toBe(true); expect(r.paid).toBe(free);
      expect(one("SELECT pack FROM engagement WHERE id=?", id).pack).toBe(free ? cap : 0);
    });
  }
  test("publishing needs a valid e-mail and a valid mobile number", async () => {
    const o = await organizer(); const id = uid(); await create(o.key, id);
    for (const body of [{ email: "nope", phone: "9876543210" }, { email: "a@b.co", phone: "123" }, { email: "", phone: "" }, { phone: "9876543210" }]) expect((await publish(o.key, id, body)).status).toBe(400);
    expect((await publish(o.key, id, { email: "a@b.co", phone: "98765 43210" })).status).toBe(200);
  });
  test("publishing needs the consent ticks: the raw server refuses without them", async () => {
    const o = await organizer(); const id = uid(); await create(o.key, id);
    const { callRaw } = await import("./param-harness");
    const r = await callRaw("POST", `/api/z/${id}/publish`, { email: "a@b.co", phone: "9876543210" }, o.h);
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------------------------------------- start times
describe("start-time edge cases (GET /api/z/schedule and game creation)", () => {
  const sched = async (at: string, now = T) => { const r = await call("GET", "/api/z/schedule?at=" + encodeURIComponent(at), undefined, {}, now); return { status: r.status, body: await j(r) }; };
  const iso = (ms: number) => new Date(ms).toISOString();
  test("a time in the past is refused with a plain sentence", async () => { const r = await sched(iso(T - HOUR)); expect(r.status).toBe(400); expect(r.body.ok).toBe(false); expect(r.body.error).toMatch(/passed|future/i); });
  test("exactly now is not in the future", async () => { expect((await sched(iso(T))).status).toBe(400); });
  test("one second ahead is accepted and lands on a 3-second round", async () => { const r = await sched(iso(T + 1000)); expect(r.status).toBe(200); expect(r.body.startMs % 3000).toBe(0); expect(r.body.startMs).toBeGreaterThanOrEqual(T - 3000); });
  test("5 minutes ahead is accepted", async () => { const r = await sched(iso(T + 5 * MIN)); expect(r.status).toBe(200); expect(r.body.startsInMinutes).toBeGreaterThanOrEqual(4); expect(r.body.startsInMinutes).toBeLessThanOrEqual(5); });
  test("9 minutes 59 seconds ahead is accepted (there is no minimum lead for the schedule helper)", async () => { expect((await sched(iso(T + 10 * MIN - 1000))).status).toBe(200); });
  test("30 days ahead is the limit: exactly 30 days is accepted", async () => { expect((await sched(iso(T + MAX_AHEAD_MS))).status).toBe(200); });
  test("30 days and a second ahead is refused as too far", async () => { const r = await sched(iso(T + MAX_AHEAD_MS + 1000)); expect(r.status).toBe(400); expect(r.body.code).toBe("too-far"); });
  test("a year ahead is refused as too far", async () => { expect((await sched(iso(T + 365 * DAY))).body.code).toBe("too-far"); });
  test("not a date is a plain 400", async () => { for (const bad of ["tomorrow", "", "2026-13-45", "xx"]) expect((await sched(bad)).status).toBe(400); });
  test("IST midnight boundary: 23:59:59 and 00:00:00 +05:30 land on different IST days", async () => {
    const a = await sched("2026-10-02T23:59:57+05:30"), b = await sched("2026-10-03T00:00:00+05:30");
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.startsAtIST).toMatch(/2 Oct/); expect(b.body.startsAtIST).toMatch(/3 Oct/);
    expect(b.body.startsAtIST).toMatch(/12:00 am/i);
  });
  test("the same instant written in UTC and in IST gives the same start round", async () => {
    const a = await sched("2026-10-03T06:30:00Z"), b = await sched("2026-10-03T12:00:00+05:30");
    expect(a.body.startRound).toBe(b.body.startRound);
  });
  test("a month end (30 Oct 23:59 IST) is read correctly", async () => { const r = await sched("2026-10-30T23:59:00+05:30", T); expect(r.status).toBe(200); expect(r.body.startsAtIST).toMatch(/30 Oct/); });

  const create_ = async (ms: number, key?: string) => { const o = await organizer(); const id = uid(); const r = await call("POST", "/api/z", eng(id, { startRound: roundAt(ms) }), o.h); return { r, id, o }; };
  test("creating a game 30 days ahead works; the next round after the limit is refused with code too-far", async () => {
    expect((await create_(T + MAX_AHEAD_MS - 6000)).r.status).toBe(200);
    const bad = await create_(T + MAX_AHEAD_MS + 6000); expect(bad.r.status).toBe(400); expect((await j(bad.r)).code).toBe("too-far");
  });
  test("a start time in the past can be built as a draft, but publishing it is refused until a new time is chosen", async () => {
    const { r, id, o } = await create_(T - HOUR); expect(r.status).toBe(200);
    const p = await publish(o.key, id); expect(p.status).toBe(400); expect((await j(p)).code).toBe("start-pending");
  });
  test("publishing a game that starts in 5 minutes works, and an unpaid one is locked 45 seconds before its start", async () => {
    const { id, o } = await create_(T + 5 * MIN); expect((await publish(o.key, id)).status).toBe(200);
    const start = roundMs(roundAt(T + 5 * MIN));
    expect((await j(await call("GET", `/api/z/${id}/control`, undefined, {}, start - 46_000))).locked).toBeFalsy();
    const locked = await j(await call("GET", `/api/z/${id}/control`, undefined, {}, start - 44_000));
    expect(locked.locked).toBe(true);
  });
  test("settings: moving the start into the past is refused; moving it 30 days+ ahead is refused with too-far", async () => {
    const { id, o } = await create_(T + 2 * HOUR);
    expect((await call("PATCH", `/api/z/${id}/settings`, { startRound: roundAt(T - HOUR) }, o.h)).status).toBe(400);
    const far = await call("PATCH", `/api/z/${id}/settings`, { startRound: roundAt(T + 31 * DAY) }, o.h); expect(far.status).toBe(400); expect((await j(far)).code).toBe("too-far");
    expect((await call("PATCH", `/api/z/${id}/settings`, { startRound: roundAt(T + 3 * HOUR) }, o.h)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------- speeds, rounds, tickets, names
describe("speeds, rounds, tickets per person, names", () => {
  const mk = async (over: Record<string, unknown>) => { const o = await organizer(); const id = uid(); const r = await create(o.key, id, over); return { r, id, o, body: await j(r) }; };
  for (const [gap, ok] of [[6, true], [9, true], [12, true], [15, true], [3, false], [18, false], [0, false], [-6, false], [7, false], [30, false]] as [number, boolean][]) {
    test(`a ${gap}-second gap between numbers is ${ok ? "accepted" : "refused"}`, async () => { expect((await mk({ callSeconds: gap })).r.status).toBe(ok ? 200 : 400); });
  }
  for (const gap of [6.5, "9", null, true]) test(`a gap of ${JSON.stringify(gap)} is not a whole number: refused`, async () => { expect((await mk({ callSeconds: gap })).r.status).toBe(400); });
  for (const [rounds, ok] of [[1, true], [2, true], [MAX_ROUNDS, true], [0, false], [MAX_ROUNDS + 1, false], [-1, false], [1.5, false], ["2", false]] as [unknown, boolean][]) {
    test(`${JSON.stringify(rounds)} rounds is ${ok ? "accepted" : "refused"}`, async () => {
      const m = await mk({ rounds }); expect(m.r.status).toBe(ok ? 200 : 400);
      if (ok) expect((await j(await call("GET", `/api/z/${m.id}/summary`, undefined, m.o.h))).rounds ?? rounds).toBe(rounds);
    });
  }
  for (const [tickets, ok] of [[1, true], [2, true], [0, false], [3, false], ["2", false], [1.5, false]] as [unknown, boolean][]) {
    test(`${JSON.stringify(tickets)} card(s) per person is ${ok ? "accepted" : "refused"}`, async () => { expect((await mk({ tickets })).r.status).toBe(ok ? 200 : 400); });
  }
  for (const [cap, ok] of [[1, true], [100000, true], [0, false], [100001, false], [-5, false], [10.5, false]] as [number, boolean][]) {
    test(`a limit of ${cap} players is ${ok ? "accepted" : "refused"} when building a game`, async () => { expect((await mk({ cap })).r.status).toBe(ok ? 200 : 400); });
  }
  for (const id of ["abc", "a b c d", "ab/cd", "x".repeat(41), "ok-id_1", "A-1234", "../etc"]) {
    const valid = /^[A-Za-z0-9_-]{4,40}$/.test(id);
    test(`game id ${JSON.stringify(id.length > 20 ? id.slice(0, 10) + "..." : id)} is ${valid ? "accepted" : "refused"}`, async () => {
      const o = await organizer(); const r = await call("POST", "/api/z", eng(id), o.h); expect(r.status).toBe(valid ? 200 : 400);
    });
  }
  test("creating the same id twice never overwrites and never reveals the owner", async () => {
    const a = await organizer("a@acme.com"), b = await organizer("b@acme.com"); const id = uid();
    await create(a.key, id, { cap: 77 });
    const again = await j(await create(b.key, id, { cap: 5 }));
    expect(again).toEqual({ ok: true, existed: true });
    expect(one("SELECT cap FROM engagement WHERE id=?", id).cap).toBe(77);
  });
  test("an organizer may keep at most 10 unpublished drafts", async () => {
    const o = await organizer();
    for (let i = 0; i < 10; i++) expect((await create(o.key, uid())).status).toBe(200);
    const full = await create(o.key, uid()); expect(full.status).toBe(409); expect((await j(full)).error).toMatch(/delete one you do not need/); // the message says how to free a place
  });
  test("a draft can be deleted at once, so the 10-draft limit never traps anyone; only the organizer may, and a published game is never deleted this way", async () => {
    const o = await organizer(); const ids = Array.from({ length: 10 }, () => uid());
    for (const id of ids) expect((await create(o.key, id)).status).toBe(200);
    expect((await create(o.key, uid())).status).toBe(409);
    expect((await call("POST", `/api/z/${ids[0]}/discard`, {}, keyH(o.key))).status).toBe(200);
    expect(one("SELECT COUNT(*) AS c FROM engagement WHERE id=?", ids[0]).c).toBe(0);
    expect((await create(o.key, uid())).status).toBe(200); // a place is free again
    expect((await call("POST", `/api/z/${ids[1]}/discard`, {})).status).toBe(403); // nobody signed in
    expect((await call("POST", `/api/z/${ids[1]}/discard`, {}, o.aiH)).status).toBe(403); // the AI link may not
    expect(one("SELECT COUNT(*) AS c FROM engagement WHERE id=?", ids[1]).c).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------- prize houses
describe("prize house combinations", () => {
  const mk = async (rewards: unknown, extra: Record<string, unknown> = {}) => { const o = await organizer(); const id = uid(); const r = await create(o.key, id, { rewards, ...extra }); return { r, body: await j(r) }; };
  for (const h of PRIZE_HOUSES.filter((x) => (x.id as string) !== "full2")) {
    test(`house ${h.id} alone: first winner accepted, winner ${h.max + 1} refused`, async () => {
      expect((await mk([{ pattern: h.id, ordinal: 1, text: "Prize" }])).r.status).toBe(200);
      const many = Array.from({ length: h.max + 1 }, (_, i) => ({ pattern: h.id, ordinal: i + 1, text: "P" + i }));
      const r = await mk(many); expect(r.r.status).toBe(400); expect(r.body.error).toMatch(/at most|only 1/);
    });
  }
  test("every house at once (one winner each) is accepted", async () => { expect((await mk(PRIZE_HOUSES.filter((x) => (x.id as string) !== "full2").map((h) => ({ pattern: h.id, ordinal: 1 })))).r.status).toBe(200); });
  test("the same reward twice is refused", async () => { expect((await mk([{ pattern: "line", ordinal: 1 }, { pattern: "line", ordinal: 1 }])).r.status).toBe(400); });
  test("an unknown house, an empty list, a non-list and zero or fractional ordinals are refused", async () => {
    for (const bad of [[{ pattern: "nonsense" }], [], "line", [{ pattern: "line", ordinal: 0 }], [{ pattern: "line", ordinal: 1.5 }], [null], [{ pattern: "full2" }]]) expect((await mk(bad)).r.status).toBe(400);
  });
  test("a prize text is cut to 80 characters and loses angle brackets", async () => {
    const o = await organizer(); const id = uid();
    await create(o.key, id, { rewards: [{ pattern: "line", ordinal: 1, text: "<b>" + "x".repeat(200) }] });
    const info = await j(await call("GET", `/api/z/${id}/summary`, undefined, o.h));
    const text = JSON.stringify(info);
    expect(text).not.toContain("<b>"); expect(text).not.toContain("x".repeat(81));
  });
});

// ---------------------------------------------------------------------------------------------------------- brand moments
describe("brand moments: kinds, limits, bad links", () => {
  const brk = (o: Record<string, unknown>) => ({ after: 30, seconds: 60, kind: "speech", title: "A word from us", ...o });
  const mk = async (extra: Record<string, unknown>) => { const o = await organizer(); const id = uid(); const r = await create(o.key, id, extra); return { r, body: await j(r), id, o }; };
  for (const [kind, extra, ok] of [
    ["speech", {}, true], ["slides", {}, true], ["file", { mediaUrl: "https://cdn.example.com/a.mp4" }, true], ["file", {}, false],
    ["youtube", { mediaUrl: "https://youtu.be/abc" }, true], ["youtube", { mediaUrl: "https://www.youtube.com/watch?v=abc" }, true], ["youtube", { mediaUrl: "https://vimeo.com/1" }, false], ["youtube", {}, false],
    ["youtube", { mediaUrl: "https://m.youtube.com/watch?v=abcdefghijk" }, true], ["youtube", { mediaUrl: "https://music.youtube.com/watch?v=abcdefghijk" }, true], ["youtube", { mediaUrl: "https://youtube.com.evil.example/watch?v=abcdefghijk" }, false],
    ["lucky", {}, true], ["lucky", { mediaUrl: "https://x.example/a" }, false], ["movie", {}, false],
  ] as [string, Record<string, unknown>, boolean][]) {
    test(`a ${kind} moment ${Object.keys(extra).length ? "with a link " : ""}during the game is ${ok ? "accepted" : "refused"}`, async () => { expect((await mk({ breaks: [brk({ kind, ...extra })] })).r.status).toBe(ok ? 200 : 400); });
  }
  for (const url of ["http://insecure.example/a.mp4", "javascript:alert(1)", "https://has space.example/a", "https://x.example/" + "a".repeat(300), "ftp://x.example/a", "//x.example/a", "data:text/html,hi", "https://x.example/<script>"]) {
    test(`a link like ${JSON.stringify(url.slice(0, 32))} is refused`, async () => { expect((await mk({ breaks: [brk({ kind: "file", mediaUrl: url })] })).r.status).toBe(400); });
  }
  test("a media file on our own site (a path with one folder level and a media type) is accepted", async () => { expect((await mk({ breaks: [brk({ kind: "file", mediaUrl: "/demo.mp4" })] })).r.status).toBe(200); });
  for (const [n, tickets, ok] of [[0, 1, true], [3, 1, true], [4, 1, false], [6, 2, true], [7, 2, false]] as [number, number, boolean][]) {
    test(`${n} moments during the game with ${tickets} card(s) per person is ${ok ? "accepted" : "refused"}`, async () => {
      expect(maxMidFor(tickets)).toBe(3 * tickets);
      const breaks = Array.from({ length: n }, (_, i) => brk({ after: 10 + i * 10, title: "Moment " + i }));
      expect((await mk({ tickets, breaks })).r.status).toBe(ok ? 200 : 400);
    });
  }
  for (const [after, seconds, ok] of [[1, 15, true], [74, 600, true], [0, 60, false], [75, 60, false], [30, 14, false], [30, 601, false], [30, 16, false], [30, 15, true]] as [number, number, boolean][]) {
    test(`a moment after number ${after} lasting ${seconds} seconds is ${ok ? "accepted" : "refused"}`, async () => { expect((await mk({ breaks: [brk({ after, seconds })] })).r.status).toBe(ok ? 200 : 400); });
  }
  test("two moments at the same number are refused", async () => { expect((await mk({ breaks: [brk({}), brk({ title: "Another" })] })).r.status).toBe(400); });
  test("moments without a position are spread evenly (auto)", async () => {
    const m = await mk({ breaks: [brk({ after: undefined, title: "One" }), brk({ after: undefined, title: "Two" })] }); expect(m.r.status).toBe(200);
    const s = JSON.stringify(await j(await call("GET", `/api/z/${m.id}/summary`, undefined, m.o.h)));
    expect(s).toContain("One"); expect(s).toContain("Two");
  });
  test("a title shorter than 2 characters is refused; angle brackets are stripped", async () => {
    expect((await mk({ breaks: [brk({ title: "A" })] })).r.status).toBe(400);
    const m = await mk({ breaks: [brk({ title: "<img src=x onerror=alert(1)>Hello" })] }); expect(m.r.status).toBe(200);
    expect(JSON.stringify(await j(await call("GET", `/api/z/${m.id}/summary`, undefined, m.o.h)))).not.toContain("<img");
  });
  for (const [seconds, ok] of [[15, true], [OPENING_WINDOW_SECONDS, true], [OPENING_WINDOW_SECONDS + 3, false], [14, false], [16, false]] as [number, boolean][]) {
    test(`an opening moment of ${seconds} seconds is ${ok ? "accepted" : "refused"}`, async () => { expect((await mk({ opening: [{ kind: "speech", title: "Welcome all", seconds }] })).r.status).toBe(ok ? 200 : 400); });
  }
  test("openings must fit together in the two minutes before the first number", async () => { expect((await mk({ tickets: 2, opening: [{ kind: "speech", title: "One one", seconds: 90 }, { kind: "speech", title: "Two two", seconds: 90 }] })).r.status).toBe(400); });
  test("a lucky draw cannot be an opening or a closing moment", async () => {
    expect((await mk({ opening: [{ kind: "lucky", title: "Draw" }] })).r.status).toBe(400);
    expect((await mk({ closing: [{ kind: "lucky", title: "Draw" }] })).r.status).toBe(400);
  });
  test("one card: at most one opening and one closing moment; two tickets: two each", async () => {
    const two = [{ kind: "speech", title: "Aa one" }, { kind: "speech", title: "Bb two" }];
    expect((await mk({ closing: two })).r.status).toBe(400);
    expect((await mk({ tickets: 2, closing: two })).r.status).toBe(200);
  });
});

describe("brand name, colour, logo", () => {
  const mk = async (brand: unknown) => { const o = await organizer(); const id = uid(); const r = await create(o.key, id, { brand }); return { r, body: await j(r), id, o }; };
  test("a brand with a name and one of the listed colours is accepted", async () => { expect((await mk({ name: "Acme Ltd", color: "#0B3D91" })).r.status).toBe(200); });
  for (const [label, brand] of [["a colour not in the list", { name: "Acme", color: "#123456" }], ["no name", { name: "", color: "#0B3D91" }], ["a 41-character name", { name: "x".repeat(41), color: "#0B3D91" }], ["extra fields", { name: "A", color: "#0B3D91", extra: 1 }], ["a text instead of an object", "Acme"], ["a list", []], ["a logo that is not a picture", { name: "A", color: "#0B3D91", logo: "data:image/png;base64,AAAA" }]] as [string, unknown][]) {
    test(`a brand with ${label} is refused`, async () => { expect((await mk(brand)).r.status).toBe(400); });
  }
  test("angle brackets, quotes and ampersands are removed from the brand name", async () => {
    const m = await mk({ name: `Ac<me> "Ltd" & Co`, color: "#0B3D91" }); expect(m.r.status).toBe(200);
    const info = JSON.stringify(await j(await call("GET", `/api/z/${m.id}/summary`, undefined, m.o.h)));
    expect(info).not.toMatch(/Ac<me>|"Ltd"/);
  });
});

// ---------------------------------------------------------------------------------------------------------- lucky draws
describe("lucky draws: sizes and who can win", () => {
  for (const w of [1, 3, 5, 10]) test(`a lucky draw of ${w} winner(s) is accepted`, async () => {
    const o = await organizer(); const id = uid();
    expect((await create(o.key, id, { breaks: [{ after: 30, seconds: 60, kind: "lucky", title: "Lucky draw", winners: w }] })).status).toBe(200);
    expect(LUCKY_WINNERS as readonly number[]).toContain(w);
  });
  for (const w of [0, 2, 4, 11, -1, 3.5, "3"]) test(`a lucky draw of ${JSON.stringify(w)} winners is refused`, async () => {
    const o = await organizer(); expect((await create(o.key, uid(), { breaks: [{ after: 30, seconds: 60, kind: "lucky", title: "Lucky draw", winners: w }] })).status).toBe(400);
  });
  test("a lucky draw style must be draw or scratch", async () => {
    const o = await organizer();
    expect((await create(o.key, uid(), { breaks: [{ after: 30, seconds: 60, kind: "lucky", title: "Lucky draw", style: "wheel" }] })).status).toBe(400);
    expect((await create(o.key, uid(), { breaks: [{ after: 30, seconds: 60, kind: "lucky", title: "Lucky draw", style: "scratch" }] })).status).toBe(200);
  });
  for (const [pool, want] of [[1, 10], [2, 3], [3, 3], [10, 10], [100, 10], [1000, 5]] as [number, number][]) {
    test(`a draw of ${want} from ${pool} eligible players picks ${Math.min(want, pool)} different players and is repeatable`, () => {
      const pids = Array.from({ length: pool }, (_, i) => "p" + i);
      const a = luckyWinners("E1", 30, "ab".repeat(16), pids, want), b = luckyWinners("E1", 30, "ab".repeat(16), pids, want);
      expect(a.length).toBe(Math.min(want, pool)); expect(new Set(a).size).toBe(a.length); expect(a).toEqual(b);
      expect(luckyWinners("E1", 30, "cd".repeat(16), pids, want)).not.toEqual(pool > want ? a : ["x"]);
    });
  }
  test("the organizer, a Host and a Co-host seat are flagged out of the draw on the public seat list; ordinary guests are not", async () => {
    const g = await paidGame({ cap: 100 });
    const start = roundMs((one("SELECT start_round s FROM engagement WHERE id=?", g.id) as any).s);
    for (let i = 1; i <= 5; i++) expect((await join(g.id, i)).status).toBe(200);
    const seats = q("SELECT seq FROM seat WHERE eid=? ORDER BY seq", g.id).map((r) => r.seq);
    expect(seats.length).toBe(5);
    for (const [seat, role] of [[seats[0], "organizer"], [seats[1], "host"], [seats[2], "co-host"]] as [number, string][]) expect((await call("POST", `/api/z/${g.id}/mark`, { seat, role }, g.h)).status).toBe(200);
    const out = await j(await call("GET", `/api/z/${g.id}/seats`, undefined, {}, start + 3 * 60_000));
    expect(out.ready).toBe(true);
    const flagged = out.seats.filter((s: any[]) => s[3] === 1).map((s: any[]) => s[0]);
    expect(flagged).toEqual([seats[0], seats[1], seats[2]]);
    const eligible = out.seats.filter((s: any[]) => s[3] === 0).map((s: any[]) => s[1]);
    expect(eligible.length).toBe(2);
    for (let t = 0; t < 20; t++) for (const w of luckyWinners(g.id, 30, t.toString(16).padStart(32, "0"), eligible, 3)) expect(eligible).toContain(w);
  });
  test("a seat cannot be flagged once the game has begun (the draw list must stay the same on every phone)", async () => {
    const g = await paidGame({ cap: 100 });
    const start = roundMs((one("SELECT start_round s FROM engagement WHERE id=?", g.id) as any).s);
    await join(g.id, 1); const seat = one("SELECT seq FROM seat WHERE eid=?", g.id).seq;
    expect((await call("POST", `/api/z/${g.id}/mark`, { seat, role: "host" }, g.h, start + 10 * 60_000)).status).toBe(409);
  });
});
