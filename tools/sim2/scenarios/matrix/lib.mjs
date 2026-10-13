// Shared pieces of the matrix suite: seeded randomness, all-pairs generator, realistic Indian test data, IST time helpers, and the per-scenario helper `t`.
// Nothing here touches anything but the sim server on this suite's own port (default 8802; run.ts sets SIM_PORT before importing this file).
import * as A from "../../lib/api.mjs";
import { clock, MIN, HOUR, DAY } from "../../lib/clock.mjs";
import { roundAt, roundTimeMs } from "../../lib/beacon.mjs";
import { PACKS, price } from "../../../../packages/shared/src/pricing.ts";

export { PLATFORM_KEY, SIM } from "../../lib/env.mjs";
export { A, clock, MIN, HOUR, DAY, roundAt, roundTimeMs, PACKS, price };

// ---- seeded randomness (mulberry32) ----
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.int = (n) => Math.floor(f() * n);
  f.pick = (arr) => arr[f.int(arr.length)];
  f.shuffle = (arr) => { const x = [...arr]; for (let i = x.length - 1; i > 0; i--) { const j = f.int(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  return f;
}

/** Greedy all-pairs covering array: every value pair of every two dimensions appears in at least one row. dims = { name: [values] }. */
export function pairwise(dims, R) {
  const names = Object.keys(dims); const rows = [];
  const need = new Set(); const key = (i, a, j, b) => `${i}:${a}|${j}:${b}`;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) for (const a of dims[names[i]].keys()) for (const b of dims[names[j]].keys()) need.add(key(i, a, j, b));
  const gainOf = (row) => { let g = 0; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (need.has(key(i, row[i], j, row[j]))) g++; return g; };
  while (need.size) {
    let best = null, bestGain = -1;
    for (let c = 0; c < 30; c++) { const row = names.map((n) => R.int(dims[n].length)); const g = gainOf(row); if (g > bestGain) { best = row; bestGain = g; } }
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < names.length; i++) for (let v = 0; v < dims[names[i]].length; v++) { const row = [...best]; row[i] = v; const g = gainOf(row); if (g > bestGain) { best = row; bestGain = g; } }
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) need.delete(key(i, best[i], j, best[j]));
    rows.push(Object.fromEntries(names.map((n, i) => [n, dims[n][best[i]]])));
  }
  return rows;
}
/** Full cross product of small dims. */
export function cross(dims) { let rows = [{}]; for (const [n, vs] of Object.entries(dims)) rows = rows.flatMap((r) => vs.map((v) => ({ ...r, [n]: v }))); return rows; }

// ---- realistic data ----
export const FIRST = ["Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Kavya", "Rahul", "Meera", "Siddharth", "Pooja", "Karan", "Divya", "Aditya", "Neha", "Manish", "Shruti", "Nikhil", "Isha", "Gaurav", "Tanvi", "Harsh", "Ritu", "Sanjay", "Deepa", "Amit", "Lakshmi", "Faisal", "Gurpreet"];
export const LAST = ["Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Mehta", "Joshi", "Kulkarni", "Banerjee", "Singh", "Khan", "Das", "Chopra", "Menon", "Agarwal", "Bhatt", "Shetty", "Verma", "Kapoor"];
export const COMPANIES = ["Sharma Textiles", "Kaveri Foods", "Mehta and Sons", "Bluestone Logistics", "Gupta Agro", "Nair Pharma", "Reddy Infra", "Tulsi Jewellers"];
export const OCCASIONS = ["Diwali party", "Dealer meet", "Annual day", "Team party", "Customer event", "Family day", "Weekend Fun", "Christmas Party", "Eid Party", "Holi Party", "Other"];
export const TIMES = ["10:00", "12:00", "16:00", "18:00", "19:00", "20:00", "21:30"];
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
export const personName = (R) => `${R.pick(FIRST)} ${R.pick(LAST)}`;
/** A valid Indian mobile (10 digits, starts 6-9). */
export const mobile = (R) => String(6 + R.int(4)) + String(R.int(1e9)).padStart(9, "0");
export const fmtMobile = (m, style) => ({ plain: m, plus91: `+91 ${m.slice(0, 5)} ${m.slice(5)}`, dash: `${m.slice(0, 5)}-${m.slice(5)}`, zero: "0" + m, zerozero: "0091" + m, space: `${m.slice(0, 3)} ${m.slice(3, 6)} ${m.slice(6)}`, plus91nospace: "+91" + m })[style] ?? m;

// ---- IST ----
const IST = 330 * MIN;
export const istMidnight = (ms) => Math.floor((ms + IST) / DAY) * DAY - IST;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function istLabel(ms) { const d = new Date(ms + IST); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"} IST`; }
export const istDate = (ms) => { const d = new Date(ms + IST); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** The first beacon round at or after `ms`. */
export const roundFrom = (ms) => { let r = roundAt(ms); if (roundTimeMs(r) < ms) r++; return r; };
/** Start of a game `days` days from the simulated now at an IST wall-clock time "HH:MM" (never earlier than 20 minutes from now). */
export async function startAt(days, hhmm = "19:00") {
  const now = await clock.now(); const [h, m] = hhmm.split(":").map(Number);
  let ms = istMidnight(now) + days * DAY + (h * 60 + m) * MIN; if (ms < now + 20 * MIN) ms = now + 20 * MIN;
  return { ms, round: roundFrom(ms) };
}

export const packFor = (cap) => PACKS.find((p) => p[0] >= cap)?.[0] ?? null;
export const totalFor = (cap) => { const p = packFor(cap); return p ? price(p, "INR").total : null; };
export const r2 = (x) => Math.round(x * 100) / 100;

// ---- friendly error rule: every refusal carries a short, plain sentence, never a stack, SQL or "undefined" ----
const BAD_WORDS = /undefined|\bnull\b|\[object|SQLITE|\bSQL\b|TypeError|ReferenceError|RangeError|Unexpected token|stack trace|\bat [\w.<>]+ \(|\.ts:\d|\.js:\d|NaN/;
export function friendly(body) {
  if (!body || typeof body !== "object") return "no JSON body";
  const e = body.error;
  if (typeof e !== "string") return "no error text";
  if (e.length < 4 || e.length > 400) return `error text length ${e.length}`;
  if (BAD_WORDS.test(e)) return "technical wording: " + e.slice(0, 80);
  return "";
}

// ---- per-scenario helper ----
let orgN = 0, gameN = 0, ipN = 0;
export class T {
  constructor(sc, seed) {
    this.sc = sc; this.seed = seed; this.checks = []; this.team = new Set(); this.eids = [];
    this.R = rng(seed * 1009 + [...sc.name].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 7));
  }
  check(name, ok, detail = "") { this.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); return !!ok; }
  eq(name, got, want) { return this.check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  allow(...emails) { for (const e of emails) this.team.add(e.toLowerCase()); }
  ip() { ipN++; return `10.${40 + ((ipN >> 16) & 15)}.${(ipN >> 8) & 255}.${(ipN & 255) || 1}`; }
  /** 'ok' = 2xx; 'deny' = 401/403/404; 'bad' = a friendly 4xx refusal (400/402/409/410/413/422/423/429); 'refuse' = deny or bad; 'any' = anything below 500; or an exact list. */
  expect(label, r, want) {
    const s = r.status; const okc = s >= 200 && s < 300, denyc = s === 401 || s === 403 || s === 404, badc = [400, 402, 409, 410, 413, 422, 423, 429].includes(s);
    const pass = Array.isArray(want) ? want.includes(s) : want === "ok" ? okc : want === "deny" ? denyc : want === "bad" ? badc : want === "refuse" ? denyc || badc : want === "any" ? s < 500 : false;
    this.check(label, pass, `HTTP ${s} ${JSON.stringify(r.body).slice(0, 160)} (wanted ${JSON.stringify(want)})`);
    return pass;
  }
  async newOrg(tag = "o") { orgN++; const email = `sim+m${this.seed}${tag}${orgN}@example.com`; this.allow(email); const o = await A.Organizer.signUp(email, { ip: this.ip() }); o.n = orgN; return o; }
  gid(prefix = "MX") { gameN++; return `${prefix}${this.seed}-${gameN}-${this.R.int(46656).toString(36)}`.toUpperCase(); }
  /** create a game on the stack. o: { cap, tickets, gap, rounds, name, who, days, time, rewards, breaks, opening, closing, brand, id, startRound } */
  async game(org, o = {}) {
    const st = await startAt(o.days ?? 7, o.time ?? "19:00");
    const id = o.id ?? this.gid();
    const body = { id, startRound: o.startRound ?? st.round, callSeconds: o.gap ?? 9, cap: o.cap ?? 50, ...(o.tickets ? { tickets: o.tickets } : {}), ...(o.rounds ? { rounds: o.rounds } : {}), ...(o.name ? { name: o.name } : {}), ...(o.who ? { whoCanJoin: o.who } : {}), ...(o.rewards ? { rewards: o.rewards } : {}), ...(o.breaks ? { breaks: o.breaks } : {}), ...(o.opening ? { opening: o.opening } : {}), ...(o.closing ? { closing: o.closing } : {}), ...(o.brand ? { brand: o.brand } : {}) };
    const r = await org.api("POST", "/api/z", body); this.eids.push(id);
    return { id, r, startRound: body.startRound, startMs: roundTimeMs(body.startRound), body };
  }
  async publishPay(org, id) { const p = await org.publish(id, mobile(this.R)); const q = await org.pay(id); return { p, q }; }
  /** A Host who has finished the first-open flow. */
  async host(org, label = "Hema") {
    const email = `sim+m${this.seed}h${++orgN}@example.com`; this.allow(email); const mob = mobile(this.R);
    const inv = await org.inviteHost({ label, email, mobile: mob }); const h = new A.Host(inv.hostKey); const fo = await h.firstOpen({ email, mobile: mob });
    h.email = email; h.id = inv.id; h.inv = inv; h.setupBody = fo.setup; return h;
  }
  /** A Co-host bound to one game. */
  async cohost(org, eid, label = personName(this.R)) { const c = await org.inviteCohost({ label, phone: mobile(this.R), e: eid }); return { key: c.cohostKey, h: { "x-organizer": c.cohostKey }, id: c.id, eid, raw: c, api: (m, p, b) => A.call(m, p, b, { "x-organizer": c.cohostKey }) }; }
  guest(eid, name, phone) { return new A.Guest("", eid, phone ?? mobile(this.R), name ?? personName(this.R)); }
}
