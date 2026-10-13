// Harness for the "life" scenarios: one fresh simulated world per scenario on the life sim server (port 8803, own database sim/life.sqlite), a frozen clock the scenario moves
// with time travel, and tiny helpers so a scenario reads like the sentence it tests. Nothing here touches the live site or any app code: it only calls the sim server's real HTTP API
// and its /__sim/* helpers (clock, tick, mail sink, SELECT-only sql).
//
//   const w = await newWorld(seed, "R01");          // reset the database, freeze the clock at a seed-dependent moment
//   const org = await w.org();                        // a signed-up Organizer (sim+...@example.com, mail is captured, never sent)
//   const g = await w.game(org, { leadMs: 3*H, pay: true, guests: 3 });
//   await w.tickAt(g.erasureMs - 1);  w.expect("still there", await w.personal(g.id) > 0);
//
// Every `w.expect(name, ok, detail)` is one assertion. A scenario fails if one is false or it throws.
import "./port.mjs";
import { createHash } from "node:crypto";
import { Organizer, Host, Guest, mailbox, sql, call, platform } from "../../lib/api.mjs";
import { clock, MIN, HOUR, DAY } from "../../lib/clock.mjs";
import { roundAt, roundTimeMs } from "../../lib/beacon.mjs";
import { SIM } from "../../lib/env.mjs";

export { MIN, HOUR, DAY, SIM, sql, call, mailbox, Organizer, Host, Guest, platform, roundAt, roundTimeMs };
export const IST = 19_800_000;
export const PACKS = { 100: 2399, 250: 3499, 500: 4699, 750: 5899, 1000: 7099 }; // INR, no GST (packages/shared/src/pricing.ts)
const sha = (s) => createHash("sha256").update(s).digest("hex");
const post = async (path, body = {}) => (await fetch(SIM + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

/** small deterministic generator (mulberry32) so one seed always means the same run */
export function rngOf(seed) { let a = [...String(seed)].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 2166136261) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class World {
  constructor(seed, tag) { this.seed = seed; this.tag = tag; this.results = []; this.rng = rngOf(seed + "|" + tag); this.n = 0; this.emails = new Set(); this.planted = []; this.guestSeq = 0; }
  /** assertion */
  expect(name, ok, detail = "") { this.results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 600) }); return !!ok; }
  eq(name, got, want) { return this.expect(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  /** the simulated "now" (the clock is frozen, so this only changes when the scenario moves it) */
  async now() { return clock.now(); }
  async at(ms) { await clock.set(ms); return ms; }
  tick() { return clock.tick(); }
  /** set the clock to exactly `ms` and run one cron tick there (boundary tests) */
  async tickAt(ms) { await clock.set(ms); return clock.tick(); }
  /** move forward by `ms`, ticking every `step` (default 30 min, like a slow cron: boundaries are tested with tickAt) */
  async go(ms, step = 30 * MIN) { return clock.advanceWithTicks(ms, Math.min(step, ms)); }
  /** go to the absolute time `ms` (never backwards) ticking every `step` */
  async goTo(ms, step = 30 * MIN) { const n = await this.now(); if (ms > n) await this.go(ms - n, step); await this.at(ms); return ms; }

  /** a signed-up Organizer with its own captured address */
  async org(label = "") { this.n++; const email = `sim+${this.tag.toLowerCase()}${label}${this.n}@example.com`; const o = await Organizer.signUp(email); o.email = email; this.emails.add(email); return o; }
  /** a Host with a confirmed e-mail (gets the team mails) */
  async host(org, label = "Hema") {
    const email = `sim+${this.tag.toLowerCase()}h${++this.n}@example.com`; this.emails.add(email);
    const inv = await org.inviteHost({ label, email });
    const h = new Host(inv.hostKey); const r = await h.firstOpen({ email, mobile: "98123" + String(40000 + this.n).slice(-5) }); h.email = email; h.hostKey = inv.hostKey; h.id = inv.id;
    return h;
  }
  /** a game. opts: leadMs, cap, name, publish (default true), pay, guests (n), people (n listed), cfg, startRound */
  async game(org, o = {}) {
    const cap = o.cap ?? 100;
    const g = await org.createGame({ leadMs: o.leadMs ?? 3 * HOUR, startRound: o.startRound, cfg: { cap, ...(o.cfg ?? {}) } });
    if (o.name) await org.settings(g.id, { name: o.name });
    if (o.publish !== false || o.pay) { const r = await org.publish(g.id); if (!r.ok) throw new Error("publish " + JSON.stringify(r.body)); }
    if (o.pay) { const r = await org.pay(g.id); if (!r.ok) throw new Error("pay " + JSON.stringify(r.body)); }
    g.org = org; g.cap = cap;
    if (o.people) g.listed = await this.people(org, g.id, o.people);
    if (o.guests) g.guests = await this.guests(g.id, o.guests);
    g.life = await this.life(org, g.id); g.endMs = g.life.endMs; g.erasureMs = g.life.personalDeleteAtMs; g.fullDeleteMs = g.life.fullDeleteAtMs;
    return g;
  }
  /** n guests join (names and numbers are planted strings we look for later) */
  async guests(eid, n) {
    const out = [];
    for (let i = 0; i < n; i++) { const k = ++this.guestSeq; const name = `Zq${sha(this.seed + this.tag + k).slice(0, 6)}`; const g = new Guest(null, eid, "9" + String(600000000 + (parseInt(sha(this.seed + this.tag + k).slice(0, 6), 16) % 399999999)).slice(-9), name); const r = await g.join(); if (!r.ok) throw new Error("join " + JSON.stringify(r.body)); this.planted.push(g.name, g.phone); out.push(g); }
    return out;
  }
  /** a people list (personal links) */
  async people(org, eid, n) {
    const people = Array.from({ length: n }, (_, i) => ({ name: `Zl${sha(this.seed + this.tag + "L" + i + eid).slice(0, 6)}`, phone: "9" + String(700000000 + (parseInt(sha(this.seed + eid + "p" + i).slice(0, 6), 16) % 299999999)).slice(-9) }));
    const r = await org.addPeople(eid, people); for (const p of people) this.planted.push(p.name, p.phone);
    return { people, res: r };
  }
  async life(org, eid) { const r = await org.life(eid); if (!r.ok) throw new Error("life " + JSON.stringify(r.body)); return r.body; }
  async info(eid, key) { return call("GET", `/api/z/${eid}/info`, undefined, key ? { "x-organizer": key } : {}); }
  /** rows of personal data still held for a game, per table */
  async personalRows(eid) { const o = {}; for (const t of ["participant", "seat", "person", "waiting", "claim", "settled"]) o[t] = (await sql(`SELECT COUNT(*) c FROM ${t} WHERE eid=?`, [eid]))[0].c; return o; }
  async personal(eid) { return Object.values(await this.personalRows(eid)).reduce((a, b) => a + b, 0); }
  async cohostRows(eid) { return (await sql("SELECT COUNT(*) c FROM organizer_key WHERE eid=? AND kind='cohost' AND revoked=0 AND pii IS NOT NULL", [eid]))[0].c; }
  async engagement(eid) { return (await sql("SELECT * FROM engagement WHERE id=?", [eid]))[0] ?? null; }
  /** all captured mails (optionally to one address / subject text) */
  async mails(to, sub) { return mailbox.list({ to, subject: sub }); }
  async mailCount(to, sub) { return (await this.mails(to, sub)).length; }
  /** credit rows of an organizer account */
  async credits(org) { return (await org.api("GET", "/api/org/credit")).body; }
  async creditRows(orgId) { return sql("SELECT * FROM credit WHERE org=? ORDER BY created_ms, id", [orgId]); }
  async orgIdOf(eid) { return (await this.engagement(eid))?.org; }
  /** a cancelled/paid/etc. summary */
  async summary(org, eid) { return (await org.summary(eid)).body; }
  /** a start time `ms` from now as a round number */
  async roundIn(ms) { return roundAt((await this.now()) + ms); }
  /** all mails of the world go to team addresses only */
  async teamOnly(extra = []) { const ok = new Set([...this.emails, ...extra].map((s) => s.toLowerCase())); const l = await mailbox.list(); const bad = l.filter((m) => !ok.has(m.to.toLowerCase())); return this.expect("e-mail only to Organizer/Host", !bad.length, bad.slice(0, 3).map((m) => m.to + ": " + m.subject).join(" | ")); }
  /** no mail text carries a planted guest name or number */
  async noGuestDataInMail() { const l = await mailbox.list(); const hit = []; for (const m of l) for (const s of this.planted) if (m.text.includes(s) || m.subject.includes(s)) hit.push(`${s} in "${m.subject}"`); return this.expect("no guest name/number in any e-mail", !hit.length, hit.slice(0, 3).join(" | ")); }
}

/** a fresh world: new database copy, clock frozen at a seed-dependent moment (any hour of the day, so IST day edges get covered across seeds) */
export async function newWorld(seed, tag) {
  // Windows sometimes holds the old run file for a moment (antivirus / search indexer): the sim server answers 500 and a retry works
  let r; for (let i = 0; i < 12; i++) { r = await fetch(SIM + "/__sim/reset", { method: "POST", body: "{}" }); if (r.ok) break; await new Promise((x) => setTimeout(x, 250 * (i + 1))); }
  if (!r.ok) throw new Error("reset " + r.status);
  const w = new World(seed, tag);
  const base = Date.parse("2026-11-02T00:00:00Z") + Math.floor(w.rng() * 20) * DAY + Math.floor(w.rng() * 86_400) * 1000;
  await clock.set(base); await clock.freeze(); await clock.set(base);
  await mailbox.clear();
  w.t0 = base;
  return w;
}

export const scenarios = [];
/** register a scenario: id (e.g. "R01"), what it proves in plain words, the body */
export const sc = (id, title, fn) => scenarios.push({ id, title, fn });
/** Run one scenario; returns { id, title, ok, checks, failed:[...], error?, ms } */
export async function runOne(s, seed) {
  const t0 = Date.now(); let w;
  try { w = await newWorld(seed, s.id); await s.fn(w); }
  catch (e) { const r = w?.results ?? []; return { id: s.id, title: s.title, ok: false, checks: r.length, failed: [...r.filter((x) => !x.ok), { name: "scenario threw", detail: String(e?.stack ?? e).slice(0, 700) }], error: true, ms: Date.now() - t0 }; }
  const failed = w.results.filter((x) => !x.ok);
  return { id: s.id, title: s.title, ok: !failed.length && w.results.length > 0, checks: w.results.length, failed: failed.length || w.results.length ? failed : [{ name: "no assertions", detail: "" }], ms: Date.now() - t0 };
}
