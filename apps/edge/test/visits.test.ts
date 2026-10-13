// First-party visitor-journey tracking of the public pages (visits.ts, migration 0012): addresses, keys, privacy signals, bots, beacon limits, the funnel, linking to a sale, owner-only reports, retention.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { lifecycleTick } from "../src/lifecycle";
import { PUBLIC_PATHS, STEPS, botName, classifySource, ipHash, normPath, parseBeacon, parseRange, rateLimited, recordFunnelForOrg, resetRate, shortIp, summarize, sweepVisits, type SessRow } from "../src/visits";
import { makeD1 } from "./d1-sqlite";

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 6, 10, 0, 0);
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const IP = "203.0.113.77", VID = "a1".repeat(16), SID = "b2".repeat(12);
let env: Env & Record<string, any>; let raw: ReturnType<typeof makeD1>["raw"];
beforeEach(() => { const d = makeD1(); raw = d.raw; resetRate(); env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "data-key", TEST_MODE: "1" }; });

const beacon = (b: unknown, h: Record<string, string> = {}, now = T, raw_?: string) => {
  const r = new Request("https://bingo.test/api/v/b", { method: "POST", headers: { origin: "https://bingo.test", "content-type": "text/plain", "cf-connecting-ip": IP, "user-agent": UA, ...h }, body: raw_ ?? JSON.stringify(b) });
  (r as any).cf = { country: "IN", city: "Pune" };
  return handle(r, env as Env, now);
};
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) => handle(new Request("https://bingo.test" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const pv = (p = "/") => ({ k: "pv", p });
const msg = (e: unknown[], o: Record<string, unknown> = {}) => ({ s: SID, d: VID, lp: "/", r: "www.google.com", dv: "mobile", l: "en-IN", e, ...o });
const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[];
const one = (sql: string, ...a: any[]) => raw.prepare(sql).get(...a) as any;

describe("network addresses and keys", () => {
  test("IPv4 loses its last part; IPv6 keeps only the first 48 bits; garbage gives nothing", () => {
    expect(shortIp("203.0.113.77")).toBe("203.0.113.0");
    expect(shortIp("::ffff:10.20.30.40")).toBe("10.20.30.0");
    expect(shortIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:db8:85a3::");
    expect(shortIp("2001:db8::1")).toBe("2001:db8:0::");
    expect(shortIp("fe80::1")).toBe("fe80:0:0::");
    for (const bad of ["", "999.1.1.1", "1.2.3", "hello", "1::2::3", "2001:db8:zz::1"]) expect(shortIp(bad)).toBe("");
  });
  test("the keyed hash is stable, hides the address, changes with the key, and falls back to DATA_KEY", async () => {
    const a = await ipHash({ ...env, VISIT_KEY: "vk" } as any, IP), b = await ipHash({ ...env, VISIT_KEY: "vk" } as any, IP);
    expect(a).toBe(b); expect(a).toMatch(/^[0-9a-f]{32}$/); expect(a).not.toContain("203");
    expect(await ipHash({ ...env, VISIT_KEY: "vk" } as any, "203.0.113.78")).not.toBe(a);
    expect(await ipHash({ ...env, VISIT_KEY: "other" } as any, IP)).not.toBe(a);
    const d1 = await ipHash({ DB: env.DB, DATA_KEY: "data-key" } as any, IP), d2 = await ipHash({ DB: env.DB, DATA_KEY: "data-key" } as any, IP);
    expect(d1).toBe(d2); expect(d1).not.toBe(a); expect(await ipHash({ DB: env.DB, DATA_KEY: "another" } as any, IP)).not.toBe(d1);
    expect(await ipHash({ DB: env.DB } as any, IP)).toBe(""); // no key at all: nothing is stored, never a constant
    expect(await ipHash(env as any, "::ffff:203.0.113.77")).toBe(await ipHash(env as any, IP)); // the same address in its mapped spelling
  });
});

describe("sources, bots, paths", () => {
  test("source classification: campaign, paid, search engine, social, other site, own site, direct", () => {
    const own = ["bingo.test"], c = (o: Partial<Parameters<typeof classifySource>[0]>) => classifySource({ refHost: "", utmSource: "", utmMedium: "", ownHosts: own, ...o });
    expect(c({})).toEqual({ src: "direct", label: "" });
    expect(c({ refHost: "www.google.co.in" })).toEqual({ src: "search", label: "google" });
    expect(c({ refHost: "duckduckgo.com" })).toEqual({ src: "search", label: "duckduckgo" });
    expect(c({ refHost: "www.linkedin.com" })).toEqual({ src: "social", label: "linkedin" });
    expect(c({ refHost: "blog.example.org" })).toEqual({ src: "referral", label: "blog.example.org" });
    expect(c({ refHost: "bingo.test" })).toEqual({ src: "internal", label: "bingo.test" });
    expect(c({ utmSource: "Newsletter", utmMedium: "email", refHost: "mail.google.com" })).toEqual({ src: "campaign", label: "newsletter" });
    expect(c({ utmSource: "google", utmMedium: "cpc" }).src).toBe("paid");
  });
  test("crawlers are recognised by their user agent; people are not", () => {
    expect(botName("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("googlebot");
    expect(botName("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe("bingbot");
    expect(botName("curl/8.4.0")).toBe("curl"); expect(botName("")).toBe("unknown");
    expect(botName(UA)).toBeNull(); expect(botName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBeNull();
  });
  test("only the public pages are tracked: the live game and participant pages never are", () => {
    for (const p of ["/", "/index.html", "/legal.html", "/pricing", "/terms", "/partner.html", "/signin.html", "/pay.html?e=XYZ"]) if (p !== "/pricing") expect(normPath(p)).not.toBeNull();
    for (const p of ["/z.html", "/z", "/play.html", "/big.html", "/zc.html", "/screen.html", "/report.html", "/api/x", "/ai/key", "/owner-visits.html", "", null, 5]) expect(normPath(p as any)).toBeNull();
    expect(normPath("/index.html")).toBe("/"); expect(normPath("/Legal.HTML#privacy")).toBe("/legal");
    expect([...PUBLIC_PATHS].sort()).toEqual(["/", "/dpa", "/legal", "/organizer-guide", "/partner", "/partner-terms", "/pay", "/signin", "/subprocessors", "/terms"]);
  });
});

describe("the beacon: validation and limits", () => {
  test("parseBeacon trims, drops what it does not know, and caps at 20 events", () => {
    const evs = [{ k: "pv", p: "/z.html" }, { k: "act", p: "/", n: "drop_table" }, { k: "sec", p: "/", n: "Bad Name" }, { k: "act", p: "/", n: "pack", z: 1000, v: "INR 5999 <script>" }, { k: "x", p: "/" }, ...Array.from({ length: 30 }, () => pv())];
    const r = parseBeacon(JSON.stringify(msg(evs, { d: "not-hex", r: "Evil Host!", l: "xx_yy_zz" })));
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.b.evs.length).toBe(16); expect(r.b.evs[0]).toMatchObject({ k: "act", n: "pack", num: 1000 }); expect(r.b.evs[0]!.v).not.toMatch(/[<>]/);
    expect(r.b.vid).toBe(""); expect(r.b.ref).toBe(""); expect(r.b.lang).toBe("");
    expect(parseBeacon("{").ok).toBe(false); expect(parseBeacon(JSON.stringify({ s: "zz", e: [] })).ok).toBe(false);
  });
  test("an oversize body, a wrong origin, a cross-site request and a GET are refused; nothing is stored", async () => {
    expect((await beacon(null, {}, T, JSON.stringify(msg([pv()], { pad: "x".repeat(7000) })))).status).toBe(413);
    expect((await beacon(msg([pv()]), { origin: "https://evil.example" })).status).toBe(403);
    expect((await beacon(msg([pv()]), { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await beacon(null, {}, T, "not json")).status).toBe(400);
    expect((await call("GET", "/api/v/b")).status).toBe(405);
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0);
    expect((await beacon(msg([pv()]), { origin: "https://bingo.test" })).status).toBe(204);
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(1);
  });
  test("rate limit per address and per session; the helper counts per minute window", async () => {
    expect([1, 2, 3].map((i) => rateLimited("k", T, 2))).toEqual([false, false, true]); expect(rateLimited("k", T + 60_000, 2)).toBe(false);
    resetRate(); let last = 0;
    for (let i = 0; i < 62; i++) last = (await beacon(msg([pv()]), {}, T)).status;
    expect(last).toBe(429);
  });
  test("events from the game pages are dropped; a message with only those stores nothing", async () => {
    expect((await beacon(msg([{ k: "pv", p: "/z.html" }, { k: "sec", p: "/big.html", n: "x" }]))).status).toBe(204);
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0); expect(one("SELECT COUNT(*) c FROM visit_event").c).toBe(0);
  });
  test("both write allowances are honoured: the shared daily one and the tracking one", async () => {
    env.DAILY_WRITE_BUDGET = "3"; await beacon(msg([pv()])); expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0);
    env.DAILY_WRITE_BUDGET = "100000"; env.VISIT_DAILY_WRITES = "3"; await beacon(msg([pv()], { s: "c3".repeat(12) })); expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0);
    env.VISIT_DAILY_WRITES = "20000"; await beacon(msg([pv()], { s: "d4".repeat(12) })); expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(1);
    expect(one("SELECT writes w FROM usage WHERE day='2026-10-06~v'").w).toBeGreaterThan(0);
  });
});

describe("what is stored for a person", () => {
  test("a visit: source, landing, device, language, country and city, shortened address and its keyed hash; the raw address is nowhere", async () => {
    await beacon(msg([pv("/index.html"), { k: "sec", p: "/", n: "pricing", m: 4200 }, { k: "act", p: "/", n: "pack", z: 1000, v: "INR 5999" }], { u: { s: "", m: "", c: "" }, pc: "ab3de4fg" }));
    const s = one("SELECT * FROM visit_session");
    expect(s).toMatchObject({ sid: SID, vid: VID, ipshort: "203.0.113.0", landing: "/", src: "search", ref_host: "google", device: "mobile", lang: "en-IN", country: "IN", city: "Pune", is_bot: 0, visit_no: 1, ip_visit_no: 1, pages: 1, n_events: 3, stage: 2, partner: "AB3DE4FG", os: "Android", browser: "Chrome" });
    expect(s.iph).toBe(await ipHash(env as any, IP));
    for (const t of ["visit_session", "visit_event", "visit_agg", "usage", "kv"]) expect(JSON.stringify(q(`SELECT * FROM ${t}`))).not.toContain(IP);
    expect(q("SELECT kind,name,val,n FROM visit_event ORDER BY id")).toEqual([{ kind: "pv", name: null, val: null, n: null }, { kind: "sec", name: "pricing", val: null, n: 4200 }, { kind: "act", name: "pack", val: "INR 5999", n: 1000 }]);
  });
  test("UTM names beat the referrer; a second beacon adds to the same session and records the exit", async () => {
    await beacon(msg([pv()], { u: { s: "diwali", m: "email", c: "festive" }, r: "mail.google.com" }));
    await beacon(msg([{ k: "exit", p: "/", n: "faq", m: 61000, x: 80 }, { k: "sec", p: "/", n: "faq", m: 9000 }], { lp: undefined }), {}, T + 20_000);
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(1);
    expect(one("SELECT * FROM visit_session")).toMatchObject({ src: "campaign", ref_host: "diwali", utm_medium: "email", utm_campaign: "festive", exit_path: "/", exit_section: "faq", exit_ms: 61000, exit_scroll: 80, n_events: 3, last_ms: T + 20_000, stage: 0 });
  });
  test("a session is capped at 400 events", async () => {
    raw.prepare("INSERT INTO visit_session(sid,first_ms,last_ms,n_events) VALUES(?,?,?,400)").run(SID, T, T);
    await beacon(msg([pv()]));
    expect(one("SELECT COUNT(*) c FROM visit_event").c).toBe(0);
  });
  test("a returning visitor and a returning address are recognised without any raw address", async () => {
    await beacon(msg([pv()]), {}, T);
    await beacon(msg([pv()], { s: "c3".repeat(12) }), {}, T + DAY);                         // same visitor id, same address
    await beacon(msg([pv()], { s: "d4".repeat(12), d: "f6".repeat(16) }), {}, T + 2 * DAY); // new visitor id (cleared cookies), same address
    await beacon(msg([pv()], { s: "e5".repeat(12), d: "07".repeat(16) }), { "cf-connecting-ip": "198.51.100.5" }, T + 3 * DAY);
    const r = q("SELECT visit_no, ip_visit_no FROM visit_session ORDER BY first_ms");
    expect(r).toEqual([{ visit_no: 1, ip_visit_no: 1 }, { visit_no: 2, ip_visit_no: 2 }, { visit_no: 1, ip_visit_no: 3 }, { visit_no: 1, ip_visit_no: 1 }]);
  });
});

describe("privacy signals: counts only", () => {
  for (const [name, h, body] of [["Global Privacy Control header", { "sec-gpc": "1" }, {}], ["Do Not Track header", { dnt: "1" }, {}], ["the page's own flag", {}, { g: 1, d: "" }]] as const) test(name + ": no visitor id, no address, no session; only anonymous counters", async () => {
    await beacon(msg([pv("/index.html"), { k: "sec", p: "/", n: "pricing", m: 3000 }, { k: "act", p: "/", n: "create", z: 500, v: "INR 3999" }, { k: "exit", p: "/", n: "pricing", m: 9000, x: 60 }], body), h);
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0); expect(one("SELECT COUNT(*) c FROM visit_event").c).toBe(0);
    const agg = Object.fromEntries(q("SELECT dim||'|'||k AS dk, n, ms FROM visit_agg").map((r) => [r.dk, r.n]));
    expect(agg).toMatchObject({ "gpc_pv|/": 1, "gpc_section|/#pricing": 1, "gpc_act|create:500": 1, "gpc_exit|/": 1, "gpc_step|create": 1, "gpc_country|IN": 1 });
    expect(JSON.stringify(q("SELECT * FROM visit_agg"))).not.toMatch(new RegExp(VID + "|203\\.0\\.113|" + SID));
  });
  test("with the signal on, an account is only counted, never linked to a visit", async () => {
    await beacon(msg([pv()]), {}, T); // an earlier, tracked visit by the same browser
    const r = await call("POST", "/api/start", { email: "priv@acme.com" }, { "sec-gpc": "1", cookie: `cbv=${VID}` });
    expect(r.status).toBe(200);
    expect(one("SELECT org FROM visit_session").org).toBeNull();
    expect(one("SELECT n FROM visit_agg WHERE dim='gpc_fun' AND k='account'").n).toBe(1);
  });
});

describe("crawlers", () => {
  test("a crawler is stored apart and flagged, with one line per beacon, and is left out of every human count", async () => {
    await beacon(msg([pv("/legal.html"), { k: "sec", p: "/legal", n: "privacy", m: 100 }], { lp: "/legal" }), { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "cf-connecting-ip": "66.249.66.1" });
    await beacon(msg([pv()], { s: "c3".repeat(12), d: "f6".repeat(16) }), {}, T + 1000);
    expect(q("SELECT is_bot, vid, browser, landing FROM visit_session ORDER BY first_ms")).toEqual([{ is_bot: 1, vid: null, browser: "googlebot", landing: "/legal" }, { is_bot: 0, vid: "f6".repeat(16), browser: "Chrome", landing: "/" }]);
    expect(one("SELECT COUNT(*) c FROM visit_event WHERE sid=?", SID).c).toBe(1);
    const s = await j(await call("GET", "/api/owner/visits/summary?from=2026-10-06&to=2026-10-06", undefined, { "x-organizer": "plat" }));
    expect(s.humans.sessions).toBe(1); expect(s.bots.sessions).toBe(1); expect(s.bots.crawlers[0]).toMatchObject({ name: "googlebot", sessions: 1, pages: ["/legal"] }); expect(s.sections).toEqual([]);
  });
});

describe("funnel and conversion arithmetic", () => {
  const row = (o: Partial<SessRow> & { sid: string }): SessRow => ({ vid: null, iph: null, first_ms: T, src: "direct", ref_host: null, landing: "/", device: "mobile", lang: "en", country: "IN", city: null, is_bot: 0, visit_no: 1, ip_visit_no: 1, pages: 1, exit_path: null, exit_section: null, exit_ms: null, exit_scroll: null, stage: 0, browser: "Chrome", last_ms: T, ...o });
  test("steps count visitors who reached at least that step; rates are against the previous step and against all visitors; a visitor with two visits counts once at their furthest", () => {
    const rows = [
      row({ sid: "1", vid: "A", stage: 6, src: "search", ref_host: "google" }), row({ sid: "2", vid: "A", stage: 0, first_ms: T + 5, visit_no: 2 }),
      row({ sid: "3", vid: "B", stage: 4, src: "search", ref_host: "google" }), row({ sid: "4", vid: "C", stage: 3, src: "social", ref_host: "linkedin" }),
      row({ sid: "5", vid: "D", stage: 1 }), row({ sid: "6", vid: "E", stage: 0 }), row({ sid: "7", vid: "F", stage: 2 }),
      row({ sid: "8", vid: "G", is_bot: 1, browser: "googlebot", stage: 6 }),
    ];
    const s = summarize(rows);
    expect(s.humans).toMatchObject({ visitors: 6, sessions: 7, returningVisitors: 1 });
    expect(s.funnel.map((f) => f.visitors)).toEqual([6, 5, 4, 3, 2, 1, 1]);
    expect(s.funnel.map((f) => f.step)).toEqual([...STEPS]);
    expect(s.funnel[1]).toMatchObject({ ofVisits: 83.3, ofPrevious: 83.3 }); expect(s.funnel[4]).toMatchObject({ ofVisits: 33.3, ofPrevious: 66.7 }); expect(s.funnel[6]).toMatchObject({ ofVisits: 16.7, ofPrevious: 100 });
    expect(s.convertedBySource.find((c) => c.label === "google")).toMatchObject({ src: "search", visitors: 2, account: 2, published: 1, paid: 1, paidRate: 50 });
    expect(s.convertedBySource.find((c) => c.label === "linkedin")).toMatchObject({ visitors: 1, paid: 0, paidRate: 0 });
    expect(s.bots.sessions).toBe(1);
  });
  test("an empty period divides by nothing and says null, not NaN", () => { const s = summarize([]); expect(s.funnel.every((f) => f.visitors === 0 && f.ofVisits === null)).toBe(true); expect(s.humans.avgPagesPerSession).toBe(0); });
  test("the date range: whole days, an inclusive end, a 366-day ceiling", () => {
    expect(parseRange(new URLSearchParams("from=2026-10-01&to=2026-10-03"), T)).toEqual({ from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 4) });
    const d = parseRange(new URLSearchParams(""), T); expect(d.to - d.from).toBe(30 * DAY);
    expect(parseRange(new URLSearchParams("from=2020-01-01&to=2026-10-03"), T)).toMatchObject({ to: Date.UTC(2026, 9, 4) }); expect(parseRange(new URLSearchParams("from=2020-01-01&to=2026-10-03"), T).from).toBe(Date.UTC(2026, 9, 4) - 366 * DAY);
  });
});

describe("from visit to sale: linking the person", () => {
  const SEQ = ["visit", "pricing", "size", "create", "account", "published", "paid"];
  test("pricing seen, size chosen, create clicked, account started, engagement published, paid: each step counted once, by source, and the journey reads in order", async () => {
    await beacon(msg([pv(), { k: "sec", p: "/", n: "pricing", m: 5000 }, { k: "act", p: "/", n: "pack", z: 500, v: "INR 3999" }, { k: "act", p: "/", n: "create", z: 500, v: "INR 3999" }]), {}, T);
    expect(one("SELECT stage FROM visit_session").stage).toBe(3);
    // the account: the browser's cookie and session header ride along on the call
    const st = await j(await call("POST", "/api/start", { email: "Boss@Acme.com" }, { cookie: `cbv=${VID}`, "x-cb-vs": SID }, T + 60_000));
    expect(st.token).toBeTruthy();
    const org = one("SELECT org FROM organizer_email").org;
    expect(one("SELECT org, stage, eh FROM visit_session")).toMatchObject({ org, stage: 4 }); expect(one("SELECT eh FROM visit_session").eh).toMatch(/^[0-9a-f]{32}$/); expect(JSON.stringify(q("SELECT * FROM visit_session"))).not.toContain("acme");
    // publishing
    const start = Math.floor((T / 1000 - 1692803367) / 3) + 1200;
    expect((await call("POST", "/api/z", { id: "VIS-1", startRound: start, callSeconds: 6, cap: 100 }, { "x-organizer": st.token }, T + 70_000)).status).toBe(200);
    const pub = await call("POST", "/api/z/VIS-1/publish", { email: "boss@acme.com", phone: "9876543210" }, { "x-organizer": st.token }, T + 80_000);
    expect(pub.status).toBe(200);
    expect(one("SELECT stage FROM visit_session").stage).toBe(5);
    // paying (test mode fulfils at once): the same organizer, found through the e-mail
    const paid = await call("POST", "/api/checkout", { org: "Acme", email: "boss@acme.com", country: "IN", taxId: "", pack: 500, currency: "INR" }, {}, T + 90_000);
    expect(paid.status).toBe(200);
    expect(one("SELECT stage FROM visit_session").stage).toBe(6);
    expect(q("SELECT name FROM visit_event WHERE kind='fun' ORDER BY id").map((r) => r.name)).toEqual(["account", "published", "paid"]);
    await recordFunnelForOrg({ DB: env.DB }, org, "paid", T + 99_000); // a second payment does not count the sale twice
    expect(one("SELECT COUNT(*) c FROM visit_event WHERE name='paid'").c).toBe(1);
    // the owner's view
    const s = await j(await call("GET", "/api/owner/visits/summary?from=2026-10-06&to=2026-10-06", undefined, { "x-organizer": "plat" }, T + 100_000));
    expect(s.funnel.map((f: any) => f.visitors)).toEqual([1, 1, 1, 1, 1, 1, 1]); expect(s.funnel.map((f: any) => f.step)).toEqual(SEQ);
    expect(s.convertedBySource).toEqual([{ src: "search", label: "google", visitors: 1, account: 1, published: 1, paid: 1, paidRate: 100 }]);
    expect(s.sizeChoice).toEqual([{ size: 500, n: 1, shown: [{ price: "INR 3999", n: 1 }] }]); expect(s.sections[0]).toEqual({ section: "/#pricing", views: 1, avgDwellMs: 5000 });
    const jr = await j(await call("GET", "/api/owner/visits/journey/" + VID, undefined, { "x-organizer": "plat" }, T + 100_000));
    expect(jr.visits).toBe(1); expect(jr.sessions[0].stageName).toBe("paid"); expect(jr.sessions[0].events.map((e: any) => e.kind + ":" + (e.name ?? ""))).toEqual(["pv:", "sec:pricing", "act:pack", "act:create", "fun:account", "fun:published", "fun:paid"]);
  });
  test("a returning organizer signing in with their code is linked to a new visitor id, and the first visit stays the source", async () => {
    await beacon(msg([pv()]), {}, T);
    const st = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { cookie: `cbv=${VID}`, "x-cb-vs": SID }, T + 1000));
    expect(st.ok).toBe(true); const org = one("SELECT org FROM organizer_email").org;
    await beacon(msg([pv()], { s: "c3".repeat(12), d: "f6".repeat(16), r: "" }), {}, T + DAY);
    await call("POST", "/api/auth/email", { email: "boss@acme.com" }, {}, T + DAY + 1000);
    const code = (await j(await call("POST", "/api/auth/email", { email: "boss@acme.com" }, {}, T + DAY + 2000))).devCode;
    if (code) { const v = await call("POST", "/api/auth/verify", { email: "boss@acme.com", code }, { cookie: `cbv=${"f6".repeat(16)}` }, T + DAY + 3000); expect(v.status).toBe(200); expect(q("SELECT org FROM visit_session ORDER BY first_ms").map((r) => r.org)).toEqual([org, org]); }
    expect(one("SELECT sid FROM visit_session WHERE org=? ORDER BY first_ms LIMIT 1", org).sid).toBe(SID);
  });
  test("an account with no visit on record only raises an anonymous counter", async () => {
    await call("POST", "/api/start", { email: "direct@acme.com" });
    expect(one("SELECT n FROM visit_agg WHERE dim='gpc_fun' AND k='account'").n).toBe(1);
  });
});

describe("owner-only reports", () => {
  test("anyone but the platform key gets the same 404 as an unknown address, and the attempt is logged; the owner's reads are logged too", async () => {
    await beacon(msg([pv()]));
    const urls = ["/api/owner/visits/summary", "/api/owner/visits/journey/" + VID];
    for (const u of urls) {
      expect((await call("GET", u)).status).toBe(404);
      expect((await call("GET", u, undefined, { "x-organizer": "cbk_nope" })).status).toBe(404);
      expect((await call("GET", u, undefined, { "x-organizer": "plat", "x-cb-link": "1" })).status).toBe(404); // never through an AI work link
      expect((await call("POST", u, {}, { "x-organizer": "plat" })).status).toBe(404);
    }
    const st = await j(await call("POST", "/api/start", { email: "o@acme.com" }));
    expect((await call("GET", urls[0]!, undefined, { "x-organizer": st.token })).status).toBe(404); // an organizer's own key is not the owner's
    expect(q("SELECT action, ok FROM audit_access WHERE action LIKE 'denied:visits%'").length).toBe(9);
    expect((await call("GET", urls[0]!, undefined, { "x-organizer": "plat" })).status).toBe(200);
    expect((await call("GET", urls[1]!, undefined, { "x-organizer": "plat" })).status).toBe(200);
    expect(q("SELECT action FROM audit_access WHERE ok=1 AND action LIKE 'visits-%' ORDER BY id").map((r) => r.action)).toEqual(["visits-summary", "visits-journey"]);
  });
  test("a journey is found by visitor id or by network-address hash, in order from the first visit; bad ids are 404", async () => {
    await beacon(msg([pv()]), {}, T);
    await beacon(msg([pv("/legal.html")], { s: "c3".repeat(12) }), {}, T + DAY);
    const iph = await ipHash(env as any, IP);
    const a = await j(await call("GET", "/api/owner/visits/journey/" + VID, undefined, { "x-organizer": "plat" })), b = await j(await call("GET", "/api/owner/visits/journey/ip_" + iph, undefined, { "x-organizer": "plat" }));
    expect(a.visits).toBe(2); expect(a.sessions.map((s: any) => s.landing)).toEqual(["/", "/"]); expect(a.firstSeenMs).toBe(T); expect(b.visits).toBe(2); expect(b.by).toMatch(/address/);
    expect((await call("GET", "/api/owner/visits/journey/short", undefined, { "x-organizer": "plat" })).status).toBe(404);
    expect((await call("GET", "/api/owner/visits/journey/" + "0".repeat(32), undefined, { "x-organizer": "plat" })).status).toBe(200); // well-formed, nobody: an empty journey
  });
  test("the summary reports sources, landing pages, exits, sections with average time, size choices and returning counts", async () => {
    await beacon(msg([pv(), { k: "sec", p: "/", n: "faq", m: 6000 }, { k: "act", p: "/", n: "pack", z: 100, v: "INR 1999" }, { k: "act", p: "/", n: "cur", v: "USD" }, { k: "exit", p: "/", n: "faq", m: 30000, x: 55 }]), {}, T);
    await beacon(msg([pv("/pricing.html"), pv("/legal.html"), { k: "sec", p: "/legal", n: "faq", m: 2000 }, { k: "act", p: "/", n: "pack", z: 100, v: "INR 1999" }, { k: "exit", p: "/legal", n: "", m: 10000, x: 20 }], { s: "c3".repeat(12), r: "", lp: "/legal" }), {}, T + 2 * DAY);
    const s = await j(await call("GET", "/api/owner/visits/summary?from=2026-10-06&to=2026-10-08", undefined, { "x-organizer": "plat" }, T + 3 * DAY));
    expect(s.humans).toMatchObject({ visitors: 1, sessions: 2, returningVisitors: 1, returningIps: 1 });
    expect(s.sources).toEqual([{ k: "direct", n: 1 }, { k: "search / google", n: 1 }]); expect(s.landing).toEqual([{ k: "/", n: 1 }, { k: "/legal", n: 1 }]);
    expect(s.exits.pages).toEqual([{ k: "/", n: 1 }, { k: "/legal", n: 1 }]); expect(s.exits.avgTimeOnPageMs).toBe(20000); expect(s.exits.avgScrollPct).toBe(38);
    expect(s.sections).toContainEqual({ section: "/#faq", views: 1, avgDwellMs: 6000 }); expect(s.sections).toContainEqual({ section: "/legal#faq", views: 1, avgDwellMs: 2000 });
    expect(s.sizeChoice).toEqual([{ size: 100, n: 2, shown: [{ price: "INR 1999", n: 2 }] }]); expect(s.currencyChoice).toEqual([{ currency: "USD", n: 1 }]);
    expect(s.devices).toEqual([{ k: "mobile", n: 2 }]); expect(s.countries).toEqual([{ k: "IN", n: 2 }]); expect(s.cities).toEqual([{ k: "IN / Pune", n: 2 }]);
  });
});

describe("retention: 365 days", () => {
  async function seed(daysAgo: number, sid: string, vid: string, bot = 0) {
    const t = T - daysAgo * DAY;
    raw.prepare("INSERT INTO visit_session(sid,vid,iph,first_ms,last_ms,landing,src,ref_host,device,country,is_bot,visit_no,stage,exit_path,browser) VALUES(?,?,?,?,?,'/','search','google','mobile','IN',?,1,?,'/','Chrome')").run(sid, vid, "h" + sid, t, t, bot, 2);
    raw.prepare("INSERT INTO visit_event(sid,at_ms,kind,path,name,val,n) VALUES(?,?,'sec','/','pricing',NULL,4000)").run(sid, t);
    raw.prepare("INSERT INTO visit_event(sid,at_ms,kind,path,name,val,n) VALUES(?,?,'act','/','pack','INR 5999',1000)").run(sid, t);
  }
  test("old sessions become anonymous per-day totals and are deleted; recent ones stay; running it again changes nothing", async () => {
    await seed(400, "old1", VID); await seed(400, "old2", VID); await seed(400, "oldbot", "", 1); await seed(30, "new1", "c3".repeat(16));
    const r = await sweepVisits({ DB: env.DB }, T);
    expect(r).toMatchObject({ sessions: 3 });
    expect(q("SELECT sid FROM visit_session").map((x) => x.sid)).toEqual(["new1"]); expect(q("SELECT DISTINCT sid FROM visit_event").map((x) => x.sid)).toEqual(["new1"]);
    const day = new Date(T - 400 * DAY).toISOString().slice(0, 10);
    const agg = Object.fromEntries(q("SELECT dim||'|'||k AS dk, n, ms FROM visit_agg WHERE day=?", day).map((x) => [x.dk, [x.n, x.ms]]));
    expect(agg).toMatchObject({ "sess|human": [2, 0], "sess|bot": [1, 0], "visitors|human": [1, 0], "src|search|google": [2, 0], "landing|/": [2, 0], "stage|2": [2, 0], "section|/#pricing": [2, 8000], "act|pack:1000": [2, 0], "exit|/": [2, 0] });
    expect(JSON.stringify(q("SELECT * FROM visit_agg"))).not.toContain(VID);
    const before = JSON.stringify(q("SELECT * FROM visit_agg ORDER BY day,dim,k"));
    await sweepVisits({ DB: env.DB }, T); expect(JSON.stringify(q("SELECT * FROM visit_agg ORDER BY day,dim,k"))).toBe(before);
  });
  test("a day exactly inside the window is kept, one just outside goes", async () => {
    await seed(364, "in", VID); await seed(366, "out", VID);
    await sweepVisits({ DB: env.DB }, T);
    expect(q("SELECT sid FROM visit_session").map((x) => x.sid)).toEqual(["in"]);
  });
  test("the lifecycle tick runs the sweep once a day", async () => {
    await seed(400, "old1", VID);
    await lifecycleTick(env as any, T);
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0); expect(one("SELECT v FROM kv WHERE k='visit_sweep_day'").v).toBe("2026-10-06");
    await seed(401, "old2", VID); await lifecycleTick(env as any, T + 3600_000); // same day: not again
    expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(1);
    await lifecycleTick(env as any, T + DAY); expect(one("SELECT COUNT(*) c FROM visit_session").c).toBe(0);
  });
  test("the archived totals still show in a summary that reaches back that far", async () => {
    await seed(400, "old1", VID); await sweepVisits({ DB: env.DB }, T);
    const day = new Date(T - 400 * DAY).toISOString().slice(0, 10);
    const s = await j(await call("GET", `/api/owner/visits/summary?from=${day}&to=${day}`, undefined, { "x-organizer": "plat" }));
    expect(s.humans.sessions).toBe(0); expect(s.archived).toContainEqual({ day, dim: "sess", k: "human", n: 1, ms: 0 });
  });
});
