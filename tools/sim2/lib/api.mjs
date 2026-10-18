// API clients for each role, built on real HTTP calls to the sim server (no in-process shortcuts), plus the e-mail sink client.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PLATFORM_KEY, SIM, sleep } from "./env.mjs";
import { clock } from "./clock.mjs";
import { roundAt, roundTimeMs } from "./beacon.mjs";

export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const deviceOf = (s) => sha("dev|" + s).slice(0, 32);
export const phoneOf = (i) => "98" + String(10000000 + i).slice(-8);

// The simulated people tick the Terms boxes the way a person does on the page (apps/edge/src/consent.ts): the server refuses these actions without them.
const CONSENT_TEXT = JSON.parse(readFileSync(new URL("../../../apps/edge/src/consent-text.json", import.meta.url), "utf8"));
const consentKind = (method, path, body) => {
  if (method !== "POST") return null;
  if (path === "/api/start") return "K2";
  if (path === "/api/auth/google") return body && body.intent === "host" ? "K5" : body && body.intent === "signup" ? "K2" : null;
  if (path === "/api/checkout" || path === "/api/payments/test" || path === "/api/payments/paytest" || /^\/api\/paylink\/[0-9a-f]{48}\/checkout$/.test(path)) return "K3";
  if (path === "/api/host/setup/email" || path === "/api/org/role/accept") return "K5";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/publish$/.test(path)) return "K1";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/join$/.test(path)) return "K4";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/(roster|people)(\?.*)?$/.test(path)) return "K6";
  return null;
};
const withConsent = (method, path, body) => {
  const k = consentKind(method, path, body);
  if (!k || !body || typeof body !== "object" || body.consent) return body;
  return { ...body, consent: { v: CONSENT_TEXT.version, boxes: Object.keys(CONSENT_TEXT[k]) } };
};

/** One HTTP call; returns { status, body } (body parsed as JSON when possible, else { text }). `ip` = the simulated address of the caller (per-address limits). */
export async function call(method, path, body, headers = {}, { base = SIM, ip } = {}, retried = false) {
  const h = { "content-type": "application/json", ...(ip ? { "x-sim-ip": ip } : {}), ...headers };
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(withConsent(method, path, body)), redirect: "manual" });
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { text }; }
  // This game asks the Terms boxes at more points than the first attempt knows (for example the Host's code check): a person ticks them when the answer says so, and so does the harness, once.
  if (r.status === 400 && j && j.code === "consent-required" && method === "POST" && body && typeof body === "object" && !(retried)) return call(method, path, { ...body, consent: { v: j.version || CONSENT_TEXT.version, boxes: Object.keys((j.consent && j.consent.boxes ? Object.fromEntries(j.consent.boxes.map((b) => [b.id, 1])) : { A: 1, B: 1 })) } }, headers, { base, ip }, true);
  return { status: r.status, body: j, ok: r.ok };
}
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };

// ---- the e-mail sink (never real mail) ----
export const OWNER_MAIL = "hello@corporatetambola.com";
export const mailbox = {
  // the owner of the platform gets a short note on every paid order and on every player data request (apps/edge/src/owner-mail.ts): those are not mail to the team or to a guest, so list() leaves them out
  // unless the caller asks for the owner's address (to: OWNER_MAIL) or passes owner: true
  list: async ({ to, subject, since, owner = false } = {}) => { const q = new URLSearchParams(); if (to) q.set("to", to); if (subject) q.set("subject", subject); if (since) q.set("since", String(since)); const rows = await (await fetch(`${SIM}/__sim/mail.json?${q}`)).json(); return owner || String(to ?? "").toLowerCase() === OWNER_MAIL ? rows : rows.filter((m) => String(m.to).toLowerCase() !== OWNER_MAIL); },
  clear: () => fetch(`${SIM}/__sim/mail.json`, { method: "DELETE" }),
  /** waits for a mail to `to` (optionally with `subject` text) and returns the newest one */
  async waitFor({ to, subject, timeout = 10000, since }) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const l = await mailbox.list({ to, subject, since }); if (l.length) return l[l.length - 1]; await sleep(150); }
    throw new Error(`no mail to ${to}${subject ? ` about "${subject}"` : ""} within ${timeout} ms`);
  },
  code: (m) => /\b(\d{6})\b/.exec(m.text)?.[1] ?? null,
  links: (m) => m.text.match(/https?:\/\/[^\s<>"')]+/g) ?? [],
};

/** A game start `leadMs` after the simulated now, as the round number the API wants. */
export async function startRoundIn(leadMs, extraRounds = 0) { const now = await clock.now(); return roundAt(now + leadMs) + extraRounds; }
export const startMsOf = roundTimeMs;

// ---- Organizer ----
export class Organizer {
  constructor(email, token, aiKey) { this.email = email; this.token = token; this.aiKey = aiKey; this.h = { "x-organizer": token }; }
  /** sign up (POST /api/start) */
  static async signUp(email, opts = {}) { const b = must(await call("POST", "/api/start", { email }, {}, opts), "start " + email); if (!b.token) throw new Error("no token: " + JSON.stringify(b)); return new Organizer(email, b.token, b.aiKey); }
  /** sign in with the e-mailed 6 digit code (read from the capture sink) */
  static async signIn(email, opts = {}) {
    const since = await clock.now() - 1000;
    must(await call("POST", "/api/auth/email", { email }, {}, opts), "auth/email");
    const m = await mailbox.waitFor({ to: email, since: undefined }); const code = mailbox.code(m); if (!code) throw new Error("no code in mail: " + m.text.slice(0, 200));
    const b = must(await call("POST", "/api/auth/verify", { email, code }, {}, opts), "auth/verify");
    return new Organizer(email, b.token, null);
  }
  api(method, path, body) { return call(method, path, body, this.h); }
  /** a draft game starting `leadMs` from the simulated now (default 2 h) */
  async createGame(o = {}) {
    const id = o.id ?? "SIM" + randomBytes(4).toString("hex").toUpperCase();
    const startRound = o.startRound ?? (await startRoundIn(o.leadMs ?? 2 * 3_600_000));
    const body = { id, startRound, callSeconds: 15, cap: 100, ...o.cfg };
    const r = await this.api("POST", "/api/z", body); must(r, "create " + id);
    return { id, startRound, startMs: roundTimeMs(startRound), res: r.body };
  }
  settings(id, patch) { return this.api("PATCH", `/api/z/${id}/settings`, patch); }
  publish(id, phone = "9811122233") { return this.api("POST", `/api/z/${id}/publish`, { email: this.email, phone }); }
  /** test payment (needs TEST_MODE and the site in TEST... see README: the sim answers /api/payments/test only while the site mode is TEST) */
  pay(id, org = "Sim Org") { return this.api("POST", "/api/payments/test", { eid: id, email: this.email, org, country: "IN" }); }
  summary(id) { return this.api("GET", `/api/z/${id}/summary`); }
  info(id) { return call("GET", `/api/z/${id}/info`, undefined, this.h); }
  cancelPreview(id) { return this.api("GET", `/api/z/${id}/cancel-preview`); }
  cancel(id, confirmations = 3) { return this.api("POST", `/api/z/${id}/cancel`, { confirmations }); }
  erase(id) { return this.api("POST", `/api/z/${id}/erase`, {}); }
  life(id) { return this.api("GET", `/api/z/${id}/life`); }
  history() { return this.api("GET", "/api/history"); }
  team() { return this.api("GET", "/api/org/team"); }
  whoami() { return this.api("GET", "/api/whoami"); }
  /** invite a Host. Returns the API body: { hostKey, link, waLink?, id, ... } */
  async inviteHost({ label, email, mobile }) { return must(await this.api("POST", "/api/org/host", { label, email, mobile }), "invite host"); }
  newHostLink(id) { return this.api("POST", "/api/org/host/link", { id }); }
  async inviteCohost({ label, phone, e }) { return must(await this.api("POST", "/api/org/cohost", { label, phone, e }), "invite cohost"); }
  retire(id) { return this.api("POST", "/api/org/team/retire", { id }); }
  /** people list (personal links). Returns the body of POST /api/z/{id}/people */
  async addPeople(eid, people) { return must(await this.api("POST", `/api/z/${eid}/people`, { people }), "add people"); }
  people(eid, q = "") { return this.api("GET", `/api/z/${eid}/people${q}`); }
  waiting(eid) { return this.api("GET", `/api/z/${eid}/waiting`); }
  decide(eid, wid, decision) { return this.api("POST", `/api/z/${eid}/waiting/${wid}`, { decision }); }
  announce(eid, text) { return this.api("POST", `/api/z/${eid}/announce`, { text }); }
  participants(eid, q = "") { return this.api("GET", `/api/z/${eid}/participants${q}`); }
}

// ---- Host (first open) ----
export class Host {
  constructor(hostKey) { this.key = hostKey; this.h = { "x-organizer": hostKey }; }
  api(method, path, body) { return call(method, path, body, this.h); }
  setup() { return this.api("GET", "/api/host/setup"); }
  /** the full first-open flow: confirm the e-mail with the mailed code, then the mobile number. Returns the Host's own key (token) for this device. */
  async firstOpen({ email, mobile }) {
    const s = must(await this.setup(), "host setup");
    let token = this.key;
    if (s.needEmail) {
      const r = must(await this.api("POST", "/api/host/setup/email", { email }), "host email");
      const m = await mailbox.waitFor({ to: email, subject: "code" }).catch(() => mailbox.waitFor({ to: email })); const code = r.devCode ?? mailbox.code(m);
      const v = must(await this.api("POST", "/api/host/setup/email/verify", { code }), "host verify"); token = v.token ?? token;
    }
    this.key = token; this.h = { "x-organizer": token };
    if (s.needMobile || (await this.setup()).body.needMobile) must(await this.api("POST", "/api/host/setup/mobile", { mobile }), "host mobile");
    return { token, setup: (await this.setup()).body };
  }
}

// ---- guests, partners ----
export class Guest {
  constructor(base, eid, phone, name, device) { this.eid = eid; this.phone = phone; this.name = name; this.device = device ?? deviceOf(phone); this.ip = "10.7." + (parseInt(sha(phone).slice(0, 4), 16) % 250) + "." + (parseInt(sha(phone).slice(4, 6), 16) % 250 + 1); }
  join(extra = {}) { return call("POST", `/api/z/${this.eid}/join`, { phone: this.phone, name: this.name, device: this.device, ...extra }, {}, { ip: this.ip }).then((r) => { if (r.ok) this.pid = r.body.pid; return r; }); }
  /** guest level 1 = may invite (has an invite budget), level 2 = joined through someone's link. `from` = the inviter's seat. */
  me() { return call("GET", `/api/z/${this.eid}/me?pid=${this.pid}`); }
  invites() { return call("GET", `/api/z/${this.eid}/invites?pid=${this.pid}`); }
  results() { return call("GET", `/api/z/${this.eid}/results`); }
}
/** the token inside a personal link https://host/j/<token> */
export const tokenOfLink = (link) => /\/j\/([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? null;
/** join through a personal link token (a guest does not even need to type the number) */
export const joinByToken = (eid, token, phone, name, ip) => call("POST", `/api/z/${eid}/join`, { token, phone, name, device: deviceOf(phone) }, {}, { ip });

export class Partner {
  static async enroll(email, phone) {
    const r = must(await call("POST", "/api/partner/enroll", { phone, email, name: "Sim Partner", consent: true }), "partner enroll");
    const m = await mailbox.waitFor({ to: email }); const code = r.devCode ?? mailbox.code(m);
    const v = must(await call("POST", "/api/partner/enroll/verify", { email, code }), "partner verify");
    const p = new Partner(); p.key = v.partnerKey; p.code = v.code; p.h = { "x-organizer": v.partnerKey }; return p;
  }
  me() { return call("GET", "/api/partner/me", undefined, this.h); }
}

export const platform = { h: { "x-organizer": PLATFORM_KEY }, api: (m, p, b) => call(m, p, b, { "x-organizer": PLATFORM_KEY }) };
export const sql = async (q, params = []) => (await (await fetch(SIM + "/__sim/sql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: q, params }) })).json()).rows;
export const setSiteMode = (mode) => fetch(SIM + "/__sim/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then((r) => r.json());
export const googleToken = async (email, sub) => (await fetch(`${SIM}/__sim/google-token?email=${encodeURIComponent(email)}${sub ? "&sub=" + sub : ""}`)).json();
