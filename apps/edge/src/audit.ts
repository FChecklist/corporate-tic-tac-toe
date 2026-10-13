// The internal audit log (owner-approved spec, 2026-10-06). Bingo is a one-time game, so this log exists for security, dispute and legal purposes only (DPDP Rules 6 and 8(3)).
//   - INSERT-ONLY in code; a trigger refuses UPDATE. Rows of one engagement form a hash chain (prev_hash -> row_hash), so a removed, edited or re-ordered row is detectable (`verifyChain`).
//   - Everything identifying (full IP, full user agent, raw device id, field values, the AI's self-declared identity) is sealed with the data key (pii.ts); only coarse columns used for
//     aggregation stay in the clear (event, actor, country, ASN, vendor, proof level). No participant, host, co-host, organizer or AI endpoint can read a row: the only readers are the
//     platform-key (owner) routes in worker.ts, and every owner read, download, verification and analysis is itself written to `audit_access`.
//   - Never recorded: passwords, one-time codes, card or bank data, keys (see `redact`).
//   - The log is deleted with its engagement at 365 days (`closeAuditFor`); before that an anonymous statistics row and a deletion certificate (no personal data) are written and kept for good.
//     A `legal_hold` row stops that deletion until it is lifted.
//   - PARTICIPANTS' personal details (their rows' IP, user agent, raw device id, field changes) are NOT kept in `audit_log.sealed`: they live in `audit_pii`, sealed under a per-engagement key
//     (pii.ts `sealEng`: HKDF of DATA_KEY with a random salt stored in `eng_key`). The hash chain covers only the non-personal core of each row plus `pdig` = SHA-256 of that sealed blob.
//     23 hours after the game ends `shredParticipantAudit` deletes the blobs AND the salt and writes a `shred` marker: the personal part is unrecoverable and `verifyChain` still passes,
//     because it never needs the blob. Rows of the organizer, host, co-host, AI key and the winners' prize confirmations ("prize" events) keep everything until 365 days.
import { openEng, openText, sealEng, sealText, type PiiEnv } from "./pii";
import type { D1, Env } from "./worker";

export const AUDIT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, chain TEXT NOT NULL, seq INTEGER NOT NULL, eid TEXT, org TEXT, at_ms INTEGER NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, target TEXT, corr TEXT NOT NULL, status INTEGER, country TEXT, asn TEXT, ai_vendor TEXT, key_id TEXT, proof TEXT, mismatch INTEGER NOT NULL DEFAULT 0, sealed TEXT NOT NULL, prev_hash TEXT NOT NULL, row_hash TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS audit_chain_seq ON audit_log (chain, seq)`,
  `CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at_ms)`,
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END`,
  `CREATE TABLE IF NOT EXISTS audit_access (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, action TEXT NOT NULL, eid TEXT, fmt TEXT, row_count INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS audit_cert (eid TEXT PRIMARY KEY, deleted_ms INTEGER NOT NULL, row_count INTEGER NOT NULL, final_hash TEXT NOT NULL, first_ms INTEGER, last_ms INTEGER)`,
  `CREATE TABLE IF NOT EXISTS audit_stats (eid TEXT PRIMARY KEY, deleted_ms INTEGER NOT NULL, stats TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS legal_hold (eid TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, note TEXT)`,
  // 0011: participants' personal part of a log row, sealed under a per-engagement key that can be destroyed (crypto-shredding); pdig = SHA-256 of the sealed blob, covered by the chain
  `ALTER TABLE audit_log ADD COLUMN pdig TEXT`,
  `CREATE TABLE IF NOT EXISTS audit_pii (chain TEXT NOT NULL, seq INTEGER NOT NULL, eid TEXT NOT NULL, sealed TEXT NOT NULL, PRIMARY KEY (chain, seq))`,
  `CREATE INDEX IF NOT EXISTS audit_pii_eid ON audit_pii (eid)`,
  `CREATE TABLE IF NOT EXISTS eng_key (eid TEXT PRIMARY KEY, salt TEXT NOT NULL, made_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shred (eid TEXT PRIMARY KEY, shredded_ms INTEGER NOT NULL, row_count INTEGER NOT NULL)`,
];

export type Actor = "organizer" | "host" | "cohost" | "participant" | "ai_key" | "system" | "owner";
export const GENESIS = "0".repeat(64);
export interface AuditEnv extends Env, PiiEnv { ANALYZE_AI_URL?: string; ANALYZE_AI_KEY?: string; ANALYZE_AI_MODEL?: string }
interface AuthLike { plat: boolean; org: string | null; kind: "platform" | "master" | "ai" | "host" | "cohost" | null }

const enc = new TextEncoder();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n) : "");

// ------------------------------------------------------------------------------------------------ what is never written
const SECRET_KEY = /pass|otp|code|card|cvv|cvc|bank|account_?no|ifsc|iban|secret|token|key|auth|bearer|signature|upi|pan\b|gstin/i;
/** Copies a body for the log: secret-looking fields become "[redacted]", long text is cut, the roster and big bodies are never copied. */
export function redact(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "string") return v.length > 160 ? v.slice(0, 160) + "..." : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (depth > 3) return "[deep]";
  if (Array.isArray(v)) return v.length > 20 ? { count: v.length } : v.map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) o[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(x, depth + 1);
    return o;
  }
  return "[unsupported]";
}

// ------------------------------------------------------------------------------------------------ reading a request
export function parseUa(ua: string): { browser: string; os: string } {
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl\//i.test(ua) ? "curl" : /python|node|axios|undici|okhttp|go-http|java/i.test(ua) ? "script" : "other";
  const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "other";
  return { browser: b, os: o };
}
/** The AI vendor a fetcher announces in its user agent (observed, not trusted blindly: a script can send any text). */
export function vendorOfUa(ua: string): string | null {
  const t = ua.toLowerCase();
  if (/chatgpt|openai|gptbot|oai-searchbot/.test(t)) return "openai";
  if (/claude|anthropic/.test(t)) return "anthropic";
  if (/gemini|google-extended|googleother|google-agent/.test(t)) return "google";
  if (/perplexity/.test(t)) return "perplexity";
  if (/grok|xai/.test(t)) return "xai";
  if (/meta-external|llama/.test(t)) return "meta";
  if (/mistral/.test(t)) return "mistral";
  if (/cohere/.test(t)) return "cohere";
  if (/bytespider|doubao/.test(t)) return "bytedance";
  if (/deepseek/.test(t)) return "deepseek";
  if (/kimi|moonshot/.test(t)) return "moonshot";
  if (/qwen|alibaba/.test(t)) return "alibaba";
  return null;
}
/** The vendor family a self-declared model name belongs to, or null when we do not know it. */
export function vendorOfModel(model: string): string | null {
  const t = model.toLowerCase();
  if (/gpt|chatgpt|\bo[134]\b|openai|codex/.test(t)) return "openai";
  if (/claude|sonnet|opus|haiku|fable/.test(t)) return "anthropic";
  if (/gemini|gemma|bard/.test(t)) return "google";
  if (/llama/.test(t)) return "meta";
  if (/grok/.test(t)) return "xai";
  if (/mistral|mixtral/.test(t)) return "mistral";
  if (/deepseek/.test(t)) return "deepseek";
  if (/qwen/.test(t)) return "alibaba";
  if (/command|cohere/.test(t)) return "cohere";
  if (/kimi|moonshot/.test(t)) return "moonshot";
  return null;
}
export interface AiDeclared { model: string; version: string; session: string; machine: string }
/** What an AI says about itself: query (ai_model, ai_version, ai_session, ai_machine), headers (x-ai-*) or an `ai` object in the JSON body. Self-declared: it proves nothing by itself. */
export function declaredAi(url: URL, req: Request, body: any): AiDeclared | null {
  const pick = (name: string, bodyKey: string) => clip(url.searchParams.get("ai_" + name) ?? req.headers.get("x-ai-" + name) ?? body?.ai?.[bodyKey] ?? "", 80);
  const d = { model: pick("model", "model"), version: pick("version", "version"), session: pick("session", "session"), machine: pick("machine", "machine") };
  return d.model || d.version || d.session || d.machine ? d : null;
}

export interface Ctx { corr: string; ip: string; country: string; asn: string; ua: string }
export function ctxOf(req: Request): Ctx {
  const h = req.headers, cf = (req as any).cf ?? {};
  return {
    corr: clip(h.get("x-request-id") ?? h.get("cf-ray") ?? "", 64) || crypto.randomUUID(),
    ip: clip(h.get("cf-connecting-ip") ?? "", 64), country: clip(h.get("cf-ipcountry") ?? "", 8),
    asn: clip(String(cf.asn ?? h.get("x-cb-asn") ?? ""), 12), ua: clip(h.get("user-agent") ?? "", 400),
  };
}

// ------------------------------------------------------------------------------------------------ what happened
const ENG = /^\/api\/z\/([A-Za-z0-9_-]{4,40})\/([a-z]+(?:-[a-z]+)*)(?:\/([A-Za-z0-9/_-]+))?$/;
const AI_FORBIDDEN = /(^|\/)(publish|erase|control|forget|settle|people|waiting|paylink|clone|pay-with-credit)(\/|$)|^\/api\/(checkout|payments|org\/close)/;
/** Name the event and its target for a request, or null when it is not worth a row (plain reads by phones, the schedulers). */
export function classify(method: string, path: string, status: number, actor: Actor, body: any): { event: string; target: string | null; eid: string | null } | null {
  const ok = status >= 200 && status < 300;
  const em = path.match(ENG);
  const eid = em ? em[1]! : typeof body?.id === "string" && path === "/api/z" ? body.id.slice(0, 40) : null;
  let event: string | null = null, target: string | null = em ? em[2]! : null;
  if (path === "/api/lifecycle/tick" || path === "/api/purge" || path === "/api/payments/status" || path === "/api/notices" && method === "GET") return null;
  if (em) {
    const a = em[2]!, sub = em[3] ?? "";
    const writes = method !== "GET" && method !== "HEAD";
    if (a === "join") event = "join";
    else if (a === "claims" || a === "won") event = "claim";
    else if (a === "vote" || a === "over") event = "vote";
    else if (a === "settings") event = writes ? "edit" : null;
    else if (a === "publish") event = "publish";
    else if (a === "cancel") event = writes ? "cancel" : null;
    else if (a === "clone") event = writes ? "clone" : null;
    else if (a === "pay-with-credit") event = writes ? "pay" : null;
    else if (a === "announce") event = "announce";
    else if (a === "confirm" || a === "prizegiven") event = "prize";
    else if (a === "erase" || a === "forget" || a === "person") event = writes ? "erase_request" : null;
    else if (a === "unbind") event = "unbind";
    else if (a === "invites") event = writes ? "invite" : null;
    else if (a === "people" || a === "waiting") event = writes ? (sub === "" ? "invite" : "edit") : null;
    else if (a === "control") event = sub === "request" ? ({ pause: "pause", resume: "resume", stop: "stop", erase: "erase_request" } as Record<string, string>)[String(body?.action)] ?? "control_request" : sub === "key" ? "control_key" : writes ? ({ pause: "pause", resume: "resume", stop: "stop", start: "start" } as Record<string, string>)[String(body?.action)] ?? "control" : null;
    else if (a === "mark" || a === "roster" || a === "reuse" || a === "seats") event = writes ? "edit" : null;
    else if (writes) event = "edit";
    else if (actor === "ai_key") event = "ai_read";
  } else if (path === "/api/z" && method === "POST") event = "create";
  else if (path === "/api/start") event = "create";
  else if (/^\/api\/auth\//.test(path)) event = ok ? "login" : "login_failed";
  else if (/^\/api\/(checkout|payments|paylink)\//.test(path) || path === "/api/checkout") { if (method === "GET") return null; event = "pay"; }
  else if (path === "/api/org/host") event = "invite";
  else if (/^\/api\/org\/(ai|keys)/.test(path)) event = method === "GET" ? (actor === "ai_key" ? "ai_read" : null) : "edit";
  else if (path === "/api/org/close") event = "delete";
  else if (/^\/api\/(partner|partners)/.test(path)) event = method === "GET" ? null : "partner";
  else if (method !== "GET" && method !== "HEAD") event = "other_write";
  else if (actor === "ai_key") event = "ai_read";
  // an AI trying something it may never do, or any refused call
  if (actor === "ai_key" && !ok && AI_FORBIDDEN.test(path)) return { event: "ai_denied_attempt", target: (target ?? path).slice(0, 60), eid };
  if (status === 401 || status === 403) return { event: event === "login_failed" ? event : "denied", target: (event ?? target ?? path).slice(0, 60), eid };
  if (!event) return null;
  if (event === "edit" && !em && /\/ai\//.test(path)) event = "edit";
  return { event: (!ok && event !== "login_failed" && event !== "denied") ? event + "_failed" : event, target: target ? target.slice(0, 60) : null, eid };
}

// ------------------------------------------------------------------------------------------------ writing
export interface RecordIn {
  eid: string | null; org: string | null; actor: Actor; event: string; target: string | null; status: number | null; now: number;
  details: Record<string, unknown>; country?: string; asn?: string; aiVendor?: string | null; keyId?: string | null; proof?: string | null; mismatch?: boolean; corr: string;
}
const rowHash = (r: { chain: string; seq: number; prev: string; at: number; actor: string; event: string; target: string | null; corr: string; status: number | null; country: string | null; asn: string | null; vendor: string | null; key: string | null; proof: string | null; mismatch: number; sealed: string; pdig?: string | null }) =>
  sha(JSON.stringify([r.chain, r.seq, r.prev, r.at, r.actor, r.event, r.target, r.corr, r.status, r.country, r.asn, r.vendor, r.key, r.proof, r.mismatch, r.sealed, ...(r.pdig ? [r.pdig] : [])]));
/** Participant rows keep their personal part apart (shreddable). Winners' prize confirmations are kept whole for 365 days. */
const splitsPersonal = (r: { actor: string; eid: string | null; event: string }) => r.actor === "participant" && !!r.eid && !/^prize/.test(r.event);
export const isShredded = async (db: D1, eid: string) => !!(await db.prepare("SELECT 1 AS x FROM shred WHERE eid=?").bind(eid).first());
/** The engagement's random participant-key salt; made on first use. Null once shredded (a shredded engagement never gets a new one). */
async function engSalt(env: AuditEnv, eid: string, now: number): Promise<string | null> {
  const get = async () => (await env.DB.prepare("SELECT salt FROM eng_key WHERE eid=?").bind(eid).first<{ salt: string }>())?.salt ?? null;
  const have = await get(); if (have) return have;
  if (await isShredded(env.DB, eid)) return null;
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO eng_key(eid,salt,made_ms) VALUES(?,?,?)").bind(eid, salt, now).run();
  return get();
}
export const chainOf = (eid: string | null, org: string | null) => (eid ? eid : org ? "org:" + org : "sys");

/** Appends one row to a chain. Never throws: the log must not break the work it records. Returns true when written. */
export async function appendAudit(env: AuditEnv, r: RecordIn): Promise<boolean> {
  try {
    const chain = chainOf(r.eid, r.org), split = splitsPersonal(r);
    const json = JSON.stringify(r.details);
    let sealed = "", pii: string | null = null, pdig: string | null = null;
    if (!split) sealed = await sealText(env, json);
    else {
      const salt = await engSalt(env, r.eid!, r.now); // null = already shredded: a late participant row keeps its non-personal core only
      if (salt) { pii = await sealEng(env, r.eid!, salt, json); pdig = await sha(pii); }
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const last = await env.DB.prepare("SELECT seq, row_hash FROM audit_log WHERE chain=? ORDER BY seq DESC LIMIT 1").bind(chain).first<{ seq: number; row_hash: string }>();
      const seq = (last?.seq ?? 0) + 1, prev = last?.row_hash ?? GENESIS;
      // a participant's network number is personal too: it lives in the sealed part only
      const f = { chain, seq, prev, at: r.now, actor: r.actor, event: r.event, target: r.target, corr: r.corr, status: r.status, country: r.country || null, asn: split ? null : r.asn || null, vendor: r.aiVendor ?? null, key: r.keyId ?? null, proof: r.proof ?? null, mismatch: r.mismatch ? 1 : 0, sealed, pdig };
      try {
        const ins = env.DB.prepare("INSERT INTO audit_log(chain,seq,eid,org,at_ms,actor,event,target,corr,status,country,asn,ai_vendor,key_id,proof,mismatch,sealed,prev_hash,row_hash,pdig) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(chain, seq, r.eid, r.org, r.now, r.actor, r.event, r.target, r.corr, r.status, f.country, f.asn, f.vendor, f.key, f.proof, f.mismatch, sealed, prev, await rowHash(f), pdig);
        if (pii) await env.DB.batch([ins, env.DB.prepare("INSERT INTO audit_pii(chain,seq,eid,sealed) VALUES(?,?,?,?)").bind(chain, seq, r.eid, pii)]); else await ins.run();
        return true;
      } catch { /* another request took this sequence number: read the new head and try again */ }
    }
  } catch { /* sealing failed or the table is missing */ }
  return false;
}

const actorOf = (a: AuthLike, req: Request, hadKey: boolean): Actor =>
  a.plat ? "owner" : a.kind === "master" ? "organizer" : a.kind === "ai" ? "ai_key" : a.kind === "host" ? "host" : a.kind === "cohost" ? "cohost" : hadKey ? "participant" : "participant";

/**
 * Records what one request did. `peek` is a clone of the request taken BEFORE the route read the body. Called once per request by worker.ts; only writes and AI calls,
 * refused calls and sign-ins produce rows (plain reads by phones would eat the free write allowance).
 */
export async function auditRequest(env: AuditEnv, req: Request, peek: Request | null, a: AuthLike, status: number, now: number, keyId: string | null): Promise<void> {
  try {
    const url = new URL(req.url), path = url.pathname, method = req.method;
    let body: any = null, bodyNote: string | null = null;
    if (peek) {
      const len = Number(peek.headers.get("content-length") ?? "0");
      if (/\/(roster|reuse|people|resend)$/.test(path) || len > 16384) bodyNote = "not copied (size or roster)";
      else { try { const t = await peek.text(); bodyNote = t ? null : "empty"; body = t && t.length <= 16384 ? JSON.parse(t) : null; } catch { body = null; bodyNote = "not json"; } }
    }
    const hadKey = !!(req.headers.get("x-organizer") || req.headers.get("authorization"));
    const actor = actorOf(a, req, hadKey);
    const c = classify(method, path, status, actor, body);
    if (!c) return;
    const ctx = ctxOf(req), ua = parseUa(ctx.ua);
    // client-reported time and zone are optional headers; the server's own clock is the authority
    const cms = Number(req.headers.get("x-cb-client-ms") ?? ""), clientMs = Number.isFinite(cms) && cms > 1e12 ? Math.trunc(cms) : null;
    const device = body && typeof body.device === "string" && /^[0-9a-f]{16,64}$/.test(body.device) ? body.device : null;
    const eid = c.eid;
    const deviceHash = device && eid ? (await sha(`dev|${eid}|${device}`)).slice(0, 32) : null;
    let proof: string | null = null, vendor: string | null = null, mismatch = false, ai: Record<string, unknown> | null = null;
    if (actor === "ai_key" || a.kind === "host" && req.headers.get("x-cb-link") === "1") {
      const dec = declaredAi(url, req, body), uaVendor = vendorOfUa(ctx.ua), modelVendor = dec?.model ? vendorOfModel(dec.model) : null;
      vendor = uaVendor ?? modelVendor;
      mismatch = !!(uaVendor && modelVendor && uaVendor !== modelVendor);
      proof = dec ? "declared" : uaVendor ? "observed" : "inferred"; // inferred = we only know a key of an AI kind made the call
      ai = { vendor_from_ua: uaVendor, vendor_from_declared_model: modelVendor, declared: dec, proof_level: proof, mismatch };
    }
    const fields = body && typeof body === "object" ? redact(Object.fromEntries(Object.entries(body).filter(([k]) => k !== "device" && k !== "ai"))) : null;
    const details = {
      method, path: path.slice(0, 200), query: url.search ? [...url.searchParams.keys()].filter((k) => k !== "_body").slice(0, 20) : [], status,
      ip: ctx.ip, ua: ctx.ua, browser: ua.browser, os: ua.os, country: ctx.country, asn: ctx.asn,
      device_hash: deviceHash, device_id: device, // the phone's own random id; sealed with everything else
      client: { ms: clientMs, tz: clip(req.headers.get("x-cb-tz"), 64) || null, skew_ms: clientMs === null ? null : clientMs - now },
      server_utc: new Date(now).toISOString(), ai, changes: fields, body_note: bodyNote,
    };
    const org = a.org ?? null;
    await appendAudit(env, { eid, org, actor, event: c.event, target: c.target, status, now, details, country: ctx.country, asn: ctx.asn, aiVendor: vendor, keyId, proof, mismatch, corr: ctx.corr });
  } catch { /* the log must never break the work */ }
}

// ------------------------------------------------------------------------------------------------ owner-only reading
export interface OpenRow { id: number; chain: string; seq: number; eid: string | null; org: string | null; at_ms: number; at_utc: string; actor: string; event: string; target: string | null; corr: string; status: number | null; country: string | null; asn: string | null; ai_vendor: string | null; key_id: string | null; proof: string | null; mismatch: boolean; details: any; prev_hash: string; row_hash: string }

/** Writes one line to the owner's access log: who looked at (or downloaded, or had analysed) which engagement's log, and when. */
export async function logAccess(db: D1, now: number, action: string, eid: string | null, fmt: string | null, rows: number, ok = true, note: string | null = null): Promise<void> {
  try { await db.prepare("INSERT INTO audit_access(at_ms,action,eid,fmt,row_count,ok,note) VALUES(?,?,?,?,?,?,?)").bind(now, action, eid, fmt, rows, ok ? 1 : 0, note).run(); } catch { /* best effort */ }
}
export async function loadRows(env: AuditEnv, chain: string, limit = 5000, offset = 0): Promise<OpenRow[]> {
  const r = await env.DB.prepare("SELECT * FROM audit_log WHERE chain=? ORDER BY seq ASC LIMIT ? OFFSET ?").bind(chain, limit, offset).all<any>();
  const out: OpenRow[] = [];
  const salts = new Map<string, string | null>();
  for (const x of r.results ?? []) {
    let details: any;
    if (x.pdig) { // a participant row: the personal part is separate and may have been shredded
      const eid = x.eid as string;
      if (!salts.has(eid)) salts.set(eid, (await env.DB.prepare("SELECT salt FROM eng_key WHERE eid=?").bind(eid).first<{ salt: string }>())?.salt ?? null);
      const pii = (await env.DB.prepare("SELECT sealed FROM audit_pii WHERE chain=? AND seq=?").bind(x.chain, x.seq).first<{ sealed: string }>())?.sealed ?? null;
      const t = pii ? await openEng(env, eid, salts.get(eid), pii) : null;
      details = t !== null ? JSON.parse(t) : pii ? { unreadable: true } : { personal_data_erased: true };
    } else if (x.sealed === "") details = { personal_data_erased: true };
    else { const t = await openText(env, x.sealed); details = t === null ? { unreadable: true } : JSON.parse(t); }
    out.push({ id: x.id, chain: x.chain, seq: x.seq, eid: x.eid, org: x.org, at_ms: x.at_ms, at_utc: new Date(x.at_ms).toISOString(), actor: x.actor, event: x.event, target: x.target, corr: x.corr, status: x.status, country: x.country, asn: x.asn, ai_vendor: x.ai_vendor, key_id: x.key_id, proof: x.proof, mismatch: !!x.mismatch, details, prev_hash: x.prev_hash, row_hash: x.row_hash });
  }
  return out;
}
const csvCell = (v: unknown) => { let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(rows: OpenRow[]): string {
  const head = ["seq", "at_utc", "actor", "event", "target", "status", "corr", "country", "asn", "ip", "user_agent", "browser", "os", "device_hash", "device_id", "client_ms", "client_tz", "client_skew_ms", "ai_vendor", "key_id", "proof", "mismatch", "ai_declared", "changes", "prev_hash", "row_hash"];
  const lines = [head.join(",")];
  for (const r of rows) { const d = r.details ?? {}; lines.push([r.seq, r.at_utc, r.actor, r.event, r.target, r.status, r.corr, r.country, r.asn, d.ip, d.ua, d.browser, d.os, d.device_hash, d.device_id, d.client?.ms, d.client?.tz, d.client?.skew_ms, r.ai_vendor, r.key_id, r.proof, r.mismatch ? 1 : 0, d.ai?.declared, d.changes, r.prev_hash, r.row_hash].map(csvCell).join(",")); }
  return lines.join("\n") + "\n";
}

/** Walks the whole chain and reports the first row that was edited, removed (a gap) or re-ordered. Does not need the data key. */
export async function verifyChain(db: D1, chain: string): Promise<{ ok: boolean; rows: number; brokenAtSeq: number | null; reason: string | null; headHash: string }> {
  const r = await db.prepare("SELECT * FROM audit_log WHERE chain=? ORDER BY seq ASC").bind(chain).all<any>();
  let prev: string | null = null, expectSeq: number | null = null, n = 0, head = GENESIS;
  const piiRows = new Map<number, string>();
  for (const p of (await db.prepare("SELECT seq, sealed FROM audit_pii WHERE chain=?").bind(chain).all<any>()).results ?? []) piiRows.set(p.seq, p.sealed);
  const shredded = await isShredded(db, chain);
  for (const x of r.results ?? []) {
    n++;
    if (expectSeq !== null && x.seq !== expectSeq) return { ok: false, rows: n, brokenAtSeq: x.seq, reason: "a row is missing before this one", headHash: head };
    if (prev !== null && x.prev_hash !== prev) return { ok: false, rows: n, brokenAtSeq: x.seq, reason: "this row does not follow the one before it", headHash: head };
    if (prev === null && x.seq === 1 && x.prev_hash !== GENESIS) return { ok: false, rows: n, brokenAtSeq: x.seq, reason: "the first row does not start the chain", headHash: head };
    const h = await rowHash({ chain: x.chain, seq: x.seq, prev: x.prev_hash, at: x.at_ms, actor: x.actor, event: x.event, target: x.target, corr: x.corr, status: x.status, country: x.country, asn: x.asn, vendor: x.ai_vendor, key: x.key_id, proof: x.proof, mismatch: x.mismatch, sealed: x.sealed, pdig: x.pdig });
    if (h !== x.row_hash) return { ok: false, rows: n, brokenAtSeq: x.seq, reason: "this row was changed", headHash: head };
    if (x.pdig) { // the personal part, while it exists, must be the one the chain committed to; once shredded it is rightly gone (the chain never needed it)
      const blob = piiRows.get(x.seq);
      if (blob !== undefined && (await sha(blob)) !== x.pdig) return { ok: false, rows: n, brokenAtSeq: x.seq, reason: "this row's personal part was changed", headHash: head };
      if (blob === undefined && !shredded) return { ok: false, rows: n, brokenAtSeq: x.seq, reason: "this row's personal part is missing without a recorded erasure", headHash: head };
    }
    prev = x.row_hash; head = x.row_hash; expectSeq = x.seq + 1;
  }
  return { ok: true, rows: n, brokenAtSeq: null, reason: null, headHash: head };
}

// ------------------------------------------------------------------------------------------------ owner-only analysis, on masked data
const count = (xs: Array<string | null | undefined>) => { const m: Record<string, number> = {}; for (const x of xs) { const k = x || "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
/** What may leave this Worker for an AI vendor: counts and coarse buckets only. No IP (not even a masked one), no device id, no user agent, no names, no declared session or machine ids (only how many there were). */
export function maskedAggregate(rows: OpenRow[]) {
  const ips = new Set<string>(), devs = new Set<string>(), sessions = new Set<string>(), machines = new Set<string>(), models = new Set<string>();
  const perDevIps = new Map<string, Set<string>>();
  let skewBig = 0, first: number | null = null, last: number | null = null;
  for (const r of rows) {
    const d = r.details ?? {};
    if (d.ip) ips.add(String(d.ip).split(".").slice(0, 2).join(".") + (String(d.ip).includes(":") ? String(d.ip).split(":").slice(0, 2).join(":") : ""));
    if (d.device_hash) { devs.add(d.device_hash); const s = perDevIps.get(d.device_hash) ?? new Set(); s.add(String(d.ip)); perDevIps.set(d.device_hash, s); }
    if (d.ai?.declared?.session) sessions.add(d.ai.declared.session); if (d.ai?.declared?.machine) machines.add(d.ai.declared.machine); if (d.ai?.declared?.model) models.add(d.ai.declared.model);
    if (typeof d.client?.skew_ms === "number" && Math.abs(d.client.skew_ms) > 300_000) skewBig++;
    first = first === null ? r.at_ms : Math.min(first, r.at_ms); last = last === null ? r.at_ms : Math.max(last, r.at_ms);
  }
  const hour = count(rows.map((r) => new Date(r.at_ms).toISOString().slice(0, 13)));
  const agg = {
    rows: rows.length, firstUtc: first === null ? null : new Date(first).toISOString(), lastUtc: last === null ? null : new Date(last).toISOString(),
    byActor: count(rows.map((r) => r.actor)), byEvent: count(rows.map((r) => r.event)), byCountry: count(rows.map((r) => r.country)), byAiVendor: count(rows.filter((r) => r.actor === "ai_key").map((r) => r.ai_vendor)),
    byProof: count(rows.filter((r) => r.actor === "ai_key").map((r) => r.proof)), byBrowser: count(rows.map((r) => r.details?.browser)), byOs: count(rows.map((r) => r.details?.os)),
    distinctNetworks: ips.size, distinctDevices: devs.size, devicesSeenFromSeveralNetworks: [...perDevIps.values()].filter((s) => s.size > 1).length,
    aiDistinctSessions: sessions.size, aiDistinctMachines: machines.size, aiDistinctDeclaredModels: models.size, aiVendorMismatches: rows.filter((r) => r.mismatch).length,
    deniedAiAttempts: rows.filter((r) => r.event === "ai_denied_attempt").length, failedLogins: rows.filter((r) => r.event === "login_failed").length, refusedCalls: rows.filter((r) => r.event === "denied").length,
    clientClockOffMoreThan5Min: skewBig, busiestHourUtc: Object.entries(hour).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
  };
  const findings: string[] = [];
  if (agg.deniedAiAttempts) findings.push(`${agg.deniedAiAttempts} attempt(s) by an AI key to publish, pay, erase, pause or settle were refused.`);
  if (agg.aiVendorMismatches) findings.push(`${agg.aiVendorMismatches} AI call(s) declared a model from a different vendor than the program that fetched them.`);
  if (agg.failedLogins >= 5) findings.push(`${agg.failedLogins} failed sign-in attempts.`);
  if (agg.devicesSeenFromSeveralNetworks) findings.push(`${agg.devicesSeenFromSeveralNetworks} device(s) were seen from more than one network.`);
  if (agg.aiDistinctMachines > 1 || agg.aiDistinctSessions > 3) findings.push(`The AI key was used from ${agg.aiDistinctMachines} declared machine(s) and ${agg.aiDistinctSessions} session(s).`);
  if (!findings.length) findings.push("Nothing unusual in the recorded events.");
  return { aggregate: agg, findings };
}
/** Asks the configured AI (OpenAI-compatible chat endpoint) to summarise the MASKED aggregate. Falls back to the built-in findings when none is configured or it fails. */
export async function analyzeChain(env: AuditEnv, chain: string, doFetch: typeof fetch = fetch): Promise<{ aggregate: ReturnType<typeof maskedAggregate>["aggregate"]; findings: string[]; summary: string | null; summarizedBy: string }> {
  const m = maskedAggregate(await loadRows(env, chain, 20000, 0));
  if (!env.ANALYZE_AI_URL || !env.ANALYZE_AI_KEY) return { ...m, summary: null, summarizedBy: "built-in rules" };
  try {
    const r = await doFetch(env.ANALYZE_AI_URL, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.ANALYZE_AI_KEY }, body: JSON.stringify({ model: env.ANALYZE_AI_MODEL ?? "default", messages: [{ role: "system", content: "You summarise a security audit of a one-time game. Use only the counts given. Name anything unusual. Do not guess identities." }, { role: "user", content: JSON.stringify(m) }] }) });
    const j: any = await r.json();
    const text = clip(j?.choices?.[0]?.message?.content ?? "", 4000);
    return { ...m, summary: text || null, summarizedBy: text ? "ai" : "built-in rules" };
  } catch { return { ...m, summary: null, summarizedBy: "built-in rules" }; }
}

// ------------------------------------------------------------------------------------------------ deletion
export const isHeld = async (db: D1, eid: string) => !!(await db.prepare("SELECT 1 AS x FROM legal_hold WHERE eid=?").bind(eid).first());
export async function setHold(db: D1, eid: string, on: boolean, now: number, note: string | null) {
  if (on) await db.prepare("INSERT INTO legal_hold(eid,at_ms,note) VALUES(?,?,?) ON CONFLICT(eid) DO UPDATE SET note=excluded.note").bind(eid, now, note ? clip(note, 200) : null).run();
  else await db.prepare("DELETE FROM legal_hold WHERE eid=?").bind(eid).run();
}
/**
 * Called when an engagement is deleted at 365 days (or its account closed). Unless a legal hold is set: writes the anonymous statistics and the deletion certificate
 * (engagement id, date, row count, final hash; nothing personal), then deletes the engagement's log rows. Both records are kept for good. Returns false when held.
 */
export async function closeAuditFor(env: AuditEnv, eid: string, now: number): Promise<boolean> {
  const db = env.DB;
  if (await isHeld(db, eid)) return false;
  const s = await db.prepare("SELECT COUNT(*) AS n, MIN(at_ms) AS f, MAX(at_ms) AS l FROM audit_log WHERE chain=?").bind(eid).first<{ n: number; f: number | null; l: number | null }>();
  const head = await db.prepare("SELECT row_hash FROM audit_log WHERE chain=? ORDER BY seq DESC LIMIT 1").bind(eid).first<{ row_hash: string }>();
  const g = async (col: string) => { const r = await db.prepare(`SELECT ${col} AS k, COUNT(*) AS c FROM audit_log WHERE chain=? GROUP BY ${col}`).bind(eid).all<{ k: string | null; c: number }>(); const o: Record<string, number> = {}; for (const x of r.results ?? []) o[x.k ?? "unknown"] = x.c; return o; };
  const stats = { rows: s?.n ?? 0, byActor: await g("actor"), byEvent: await g("event"), byCountry: await g("country"), byAiVendor: await g("ai_vendor"), byProof: await g("proof"), mismatches: (await db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE chain=? AND mismatch=1").bind(eid).first<{ c: number }>())?.c ?? 0 };
  await db.prepare("INSERT OR IGNORE INTO audit_stats(eid,deleted_ms,stats) VALUES(?,?,?)").bind(eid, now, JSON.stringify(stats)).run();
  await db.prepare("INSERT OR IGNORE INTO audit_cert(eid,deleted_ms,row_count,final_hash,first_ms,last_ms) VALUES(?,?,?,?,?,?)").bind(eid, now, s?.n ?? 0, head?.row_hash ?? GENESIS, s?.f ?? null, s?.l ?? null).run();
  await db.prepare("DELETE FROM audit_log WHERE chain=?").bind(eid).run();
  await db.prepare("DELETE FROM ai_audit WHERE eid=?").bind(eid).run();
  await db.prepare("DELETE FROM audit_pii WHERE eid=?").bind(eid).run();
  await db.prepare("DELETE FROM eng_key WHERE eid=?").bind(eid).run();
  await db.prepare("DELETE FROM shred WHERE eid=?").bind(eid).run();
  return true;
}
/** Rows that belong to no live engagement (sign-ins, refused attempts, calls to ids that never existed) go 365 days after they were written. A held engagement still exists, so its rows stay. */
export async function sweepAudit(db: D1, now: number, days = 365): Promise<void> {
  await db.prepare("DELETE FROM audit_log WHERE at_ms < ? AND (eid IS NULL OR eid NOT IN (SELECT id FROM engagement))").bind(now - days * 86_400_000).run().catch(() => undefined);
  await db.prepare("DELETE FROM audit_pii WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.chain=audit_pii.chain AND a.seq=audit_pii.seq)").run().catch(() => undefined);
  await db.prepare("DELETE FROM eng_key WHERE eid NOT IN (SELECT id FROM engagement)").run().catch(() => undefined);
  await db.prepare("DELETE FROM shred WHERE eid NOT IN (SELECT id FROM engagement)").run().catch(() => undefined);
}

/**
 * Crypto-shreds the participants' personal part of an engagement's audit log (23 hours after the game ends, or when the organizer erases earlier): deletes every sealed blob and the
 * engagement's key salt, then records a `shred` marker (engagement id, time, number of rows; nothing personal). Idempotent. A legal hold set by the owner suspends it (returns false).
 * The chain still verifies afterwards: it covers only the non-personal core and the blobs' digests, never the blobs themselves.
 */
export async function shredParticipantAudit(env: AuditEnv, eid: string, now: number): Promise<boolean> {
  const db = env.DB;
  if (await isHeld(db, eid)) return false;
  const n = (await db.prepare("SELECT COUNT(*) AS c FROM audit_pii WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
  await db.batch([
    db.prepare("DELETE FROM audit_pii WHERE eid=?").bind(eid),
    db.prepare("DELETE FROM eng_key WHERE eid=?").bind(eid),
    db.prepare("INSERT OR IGNORE INTO shred(eid,shredded_ms,row_count) VALUES(?,?,?)").bind(eid, now, n),
  ]);
  return true;
}
