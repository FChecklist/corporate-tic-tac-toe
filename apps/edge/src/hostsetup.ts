// A Host's first open (Phase 4, docs/ROLES_AND_CONSOLE_SPEC_4.md section C item 2).
//
// The Organizer adds a Host with a name and AT LEAST ONE of e-mail or mobile. The Host gets a personal link (zc.html?k=<key>). That link is a ONE-TIME ENTRY:
//   - it works for 7 days, and only until the Host has confirmed an e-mail address (by a 6-digit code or by Google);
//   - the moment the e-mail is confirmed the Host receives a NEW key for this device (a "device key", minted from the same Host row, same label and details), and the
//     link stops working. Later devices sign in with the e-mail code or Google: `host_login` maps the confirmed e-mail to the Host, and the normal sign-in routes
//     (/api/auth/email, /verify, /google) mint a fresh device key. The Organizer retires a Host once and every device key stops with it.
//   - until the Host has a confirmed e-mail AND a mobile number (typed, never verified, sealed) every Host route answers 403 {code:'host-setup'} (worker.ts).
// A Host is identified by `host_id` = the hash of the key row the Organizer created (the "identity row"); device keys are extra organizer_key rows whose host_id points at it.
// Only the Organizer and Hosts have e-mail addresses; nothing here is available to an AI key (the setup routes need a Host key, the new-link route the Organizer's own key).
import { consentRequired, recordConsent } from "./consent";
import { openPii, openText, sealPii, sealText } from "./pii";
import type { D1, Env } from "./worker";

export const HOST_LINK_TTL_MS = 7 * 86_400_000;
export const HOST_SCHEMA: string[] = [
  `ALTER TABLE organizer_key ADD COLUMN host_id TEXT`,
  `CREATE TABLE IF NOT EXISTS host_state (host_id TEXT PRIMARY KEY, org TEXT NOT NULL, email_hash TEXT, verified_ms INTEGER, pend_hash TEXT, pend_sealed TEXT, link_exp_ms INTEGER NOT NULL, spent INTEGER NOT NULL DEFAULT 0, mobile_ok INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS host_login (email_hash TEXT NOT NULL, host_id TEXT NOT NULL, org TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY (email_hash, host_id))`,
  // Hosts added before this change: the same 7-day window starts now, and a Host who already has a mobile number does not have to type it again
  `INSERT OR IGNORE INTO host_state(host_id,org,link_exp_ms,mobile_ok) SELECT hash, org, CAST(strftime('%s','now') AS INTEGER) * 1000 + 604800000, CASE WHEN pii IS NOT NULL THEN 1 ELSE 0 END FROM organizer_key WHERE kind='host' AND expires_ms IS NULL AND revoked=0`,
];

const encoder = new TextEncoder();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const emailHashOf = (email: string) => sha("email|" + email.trim().toLowerCase());
/** "a***@acme.com": enough for the Host to recognise their own address, not enough to learn it. */
export const maskEmail = (e: string): string => { const [l = "", d = ""] = e.split("@"); return `${l.slice(0, 1)}***@${d}`; };
export const maskMobile = (digits: string): string => "******" + digits.slice(-4);

export interface HostState { host_id: string; org: string; email_hash: string | null; verified_ms: number | null; pend_hash: string | null; pend_sealed: string | null; link_exp_ms: number; spent: number; mobile_ok: number }
export const hostStateRow = (db: D1, hid: string) => db.prepare("SELECT host_id, org, email_hash, verified_ms, pend_hash, pend_sealed, link_exp_ms, spent, mobile_ok FROM host_state WHERE host_id=?").bind(hid).first<HostState>();

/** For authOfKey: may this Host key be used at all, and is the Host's setup finished? A link key that was used or is older than 7 days without a confirmed e-mail is no key. */
export async function hostKeyStatus(db: D1, hash: string, hostId: string | null, now: number): Promise<{ usable: boolean; hid: string; ready: boolean }> {
  const hid = hostId ?? hash, st = await hostStateRow(db, hid);
  if (!st) return { usable: true, hid, ready: false }; // an old key from before this feature, or a 24-hour AI key: still needs the setup before the console opens
  if (hash === hid && (st.spent || (!st.verified_ms && now > st.link_exp_ms))) return { usable: false, hid, ready: false };
  return { usable: true, hid, ready: !!st.verified_ms && !!st.mobile_ok };
}

/** The Host's identity row (the one the Organizer sees in "Your team"). */
export const identityRow = (db: D1, hid: string) => db.prepare("SELECT hash, org, label, email_sealed, pii, is_test FROM organizer_key WHERE hash=? AND kind='host' AND revoked=0").bind(hid).first<{ hash: string; org: string; label: string | null; email_sealed: string | null; pii: string | null; is_test: number }>();

/** A new key for another device of the same Host: same row details, same Host identity. The old keys are untouched. */
export async function mintDeviceKey(env: Env, hid: string, key: string, now: number): Promise<string> {
  await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,label,email_sealed,pii,created_by,host_id) SELECT ?,org,kind,0,?,is_test,label,email_sealed,pii,created_by,? FROM organizer_key WHERE hash=?").bind(await sha("key|" + key), now, hid, hid).run();
  return key;
}

/** The e-mail is confirmed (by code or by Google): remember it, let this Host sign in by e-mail from now on, end the one-time link, and hand over a key for this device. */
export async function confirmHostEmail(env: Env, hid: string, org: string, email: string, key: string, now: number): Promise<{ token: string; ready: boolean; needMobile: boolean }> {
  const eh = await emailHashOf(email), sealed = await sealText(env as any, email.trim().toLowerCase());
  await env.DB.batch([
    env.DB.prepare("UPDATE organizer_key SET email_sealed=? WHERE hash=? OR host_id=?").bind(sealed, hid, hid),
    env.DB.prepare("INSERT INTO host_state(host_id,org,email_hash,verified_ms,pend_hash,link_exp_ms,spent,mobile_ok) VALUES(?,?,?,?,NULL,?,1,COALESCE((SELECT CASE WHEN pii IS NOT NULL THEN 1 ELSE 0 END FROM organizer_key WHERE hash=?),0)) ON CONFLICT(host_id) DO UPDATE SET email_hash=excluded.email_hash, verified_ms=excluded.verified_ms, pend_hash=NULL, pend_sealed=NULL, spent=1").bind(hid, org, eh, now, now, hid),
    env.DB.prepare("INSERT INTO host_login(email_hash,host_id,org,created_ms) VALUES(?,?,?,?) ON CONFLICT(email_hash,host_id) DO UPDATE SET created_ms=excluded.created_ms").bind(eh, hid, org, now),
  ]);
  const token = await mintDeviceKey(env, hid, key, now);
  const st = await hostStateRow(env.DB, hid);
  return { token, ready: !!st?.mobile_ok, needMobile: !st?.mobile_ok };
}

/** A confirmed e-mail address that belongs to a Host who is still on the team (the newest one when it belongs to several). */
export async function hostForEmail(db: D1, emailHash: string): Promise<{ host_id: string; org: string } | null> {
  return db.prepare("SELECT l.host_id AS host_id, l.org AS org FROM host_login l JOIN organizer_key k ON k.hash=l.host_id AND k.revoked=0 AND k.kind='host' WHERE l.email_hash=? ORDER BY l.created_ms DESC LIMIT 1").bind(emailHash).first<{ host_id: string; org: string }>();
}

/** Stops everything of a Host: the identity row and every device key, and forgets the sign-in mapping. */
export async function retireHost(db: D1, hid: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE organizer_key SET revoked=1, pii=NULL, email_sealed=NULL WHERE hash=? OR host_id=?").bind(hid, hid),
    db.prepare("DELETE FROM host_login WHERE host_id=?").bind(hid), db.prepare("DELETE FROM host_state WHERE host_id=?").bind(hid),
  ]);
}

export interface HostCtx {
  req: Request; env: Env; now: number; p: string; hid: string; org: string; presented: string; origin: string;
  json: (o: unknown, status?: number) => Response; body: (req: Request, max?: number) => Promise<any | null>;
  spend: (n?: number) => Promise<boolean>; busy: () => Response; sendMail: (to: string, subject: string, text: string) => Promise<boolean>;
  newKey: () => string; cleanPhone: (v: unknown) => { ok: true; digits: string } | { ok: false; why: string }; test: boolean;
}

/** The progress of a Host's setup, as `GET /api/host/setup` answers it. */
export async function setupView(c: HostCtx): Promise<{ needEmail: boolean; needMobile: boolean; emailMasked?: string; mobileMasked?: string; ready: boolean }> {
  const st = await hostStateRow(c.env.DB, c.hid), row = await identityRow(c.env.DB, c.hid);
  const email = row?.email_sealed ? await openText(c.env as any, row.email_sealed) : null;
  const who = row?.pii ? await openPii(c.env as any, row.pii) : null;
  const needEmail = !st?.verified_ms, needMobile = !st?.mobile_ok;
  return { needEmail, needMobile, ...(email ? { emailMasked: maskEmail(email) } : {}), ...(who?.phone ? { mobileMasked: maskMobile(who.phone) } : {}), ready: !needEmail && !needMobile };
}

/** `/api/host/setup...` : the Host key only (never an AI key, never an Organizer). */
export async function hostSetupRoute(c: HostCtx): Promise<Response | null> {
  const { req, env, now, p } = c, db = env.DB;
  if (p === "/api/host/setup" && req.method === "GET") return c.json(await setupView(c));
  if (req.method !== "POST") return null;
  if (p === "/api/host/setup/mobile") {
    const b = await c.body(req);
    const m = c.cleanPhone(b?.mobile ?? b?.phone);
    if (!m.ok) return c.json({ error: "Please give your mobile number. " + m.why }, 400);
    const st = await hostStateRow(db, c.hid);
    if (st?.verified_ms && st.mobile_ok) return c.json({ error: "Your mobile number is already saved. Ask the Organizer to change it.", code: "already-set" }, 409);
    if (!(await c.spend(2))) return c.busy();
    const row = await identityRow(db, c.hid);
    const sealed = await sealPii(env as any, { phone: m.digits, name: row?.label || null });
    await db.batch([
      db.prepare("UPDATE organizer_key SET pii=? WHERE hash=? OR host_id=?").bind(sealed, c.hid, c.hid),
      db.prepare("INSERT INTO host_state(host_id,org,link_exp_ms,mobile_ok) VALUES(?,?,?,1) ON CONFLICT(host_id) DO UPDATE SET mobile_ok=1").bind(c.hid, c.org, now + HOST_LINK_TTL_MS),
    ]);
    const v = await setupView(c);
    return c.json({ ok: true, mobileMasked: v.mobileMasked, ready: v.ready, needEmail: v.needEmail });
  }
  if (p === "/api/host/setup/email") {
    { const mt = consentRequired(await c.body(req.clone()), "K5"); if (mt) return mt; } // K5: "I will not charge any player. I will hand over prizes as the organizer decides. I follow the Terms."
    await recordConsent(db, { subject: c.hid, kind: "K5", ref: null, now });
    const b = await c.body(req);
    const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) return c.json({ error: "Please enter a valid e-mail address." }, 400);
    const st = await hostStateRow(db, c.hid);
    if (st?.verified_ms) return c.json({ error: "Your e-mail is already confirmed. Sign in with it on other devices.", code: "already-verified" }, 409);
    const row = await identityRow(db, c.hid), onFile = row?.email_sealed ? await openText(env as any, row.email_sealed) : null;
    if (onFile && onFile.toLowerCase() !== email) return c.json({ error: `This link is for ${maskEmail(onFile)}`, code: "email-mismatch" }, 409);
    const eh = await emailHashOf(email);
    const lc = await db.prepare("SELECT win_start, sent FROM login_code WHERE email_hash=?").bind(eh).first<{ win_start: number; sent: number }>();
    const fresh = !lc || now - lc.win_start > 3_600_000;
    if (!fresh && lc!.sent >= 5) return c.json({ error: "Too many codes requested. Please try again in an hour." }, 429);
    if (!(await c.spend(3))) return c.busy();
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
    await db.batch([
      db.prepare("INSERT INTO login_code(email_hash,code_hash,expires_ms,attempts,win_start,sent,link_hash) VALUES(?,?,?,0,?,1,NULL) ON CONFLICT(email_hash) DO UPDATE SET code_hash=excluded.code_hash, expires_ms=excluded.expires_ms, attempts=0, win_start=?, sent=?, link_hash=NULL").bind(eh, await sha("code|" + eh + "|" + code), now + 600_000, fresh ? now : lc!.win_start, fresh ? now : lc!.win_start, fresh ? 1 : lc!.sent + 1),
      db.prepare("INSERT INTO host_state(host_id,org,pend_hash,pend_sealed,link_exp_ms) VALUES(?,?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET pend_hash=excluded.pend_hash, pend_sealed=excluded.pend_sealed").bind(c.hid, c.org, eh, await sealText(env as any, email), now + HOST_LINK_TTL_MS),
    ]);
    await c.sendMail(email, "Your Corporate Tic Tac Toe code", `Your 6-digit code is ${code}.\n\nType it on the page where you are finishing your Host setup. It works for 10 minutes.\n\nDid not ask for this? Ignore this e-mail.`);
    return c.json({ ok: true, ...(c.test ? { devCode: code } : {}) });
  }
  if (p === "/api/host/setup/email/verify") {
    const b = await c.body(req);
    const code = typeof b?.code === "string" ? b.code.replace(/\D/g, "") : "";
    if (code.length !== 6) return c.json({ error: "Enter the 6-digit code." }, 400);
    const st = await hostStateRow(db, c.hid);
    const bad = () => c.json({ error: "That code is not right or has expired. Please ask for a new one." }, 400);
    if (!st?.pend_hash || st.verified_ms) return bad();
    const eh = st.pend_hash, lc = await db.prepare("SELECT code_hash, expires_ms, attempts FROM login_code WHERE email_hash=?").bind(eh).first<{ code_hash: string; expires_ms: number; attempts: number }>();
    if (!lc || lc.expires_ms < now || lc.attempts >= 5) return bad();
    if (lc.code_hash !== (await sha("code|" + eh + "|" + code))) { await db.prepare("UPDATE login_code SET attempts=attempts+1 WHERE email_hash=?").bind(eh).run(); return bad(); }
    if (!(await c.spend(3))) return c.busy();
    const use = st.pend_sealed ? await openText(env as any, st.pend_sealed) : null;
    if (!use || (await emailHashOf(use)) !== eh) return bad();
    await db.prepare("DELETE FROM login_code WHERE email_hash=?").bind(eh).run();
    const done = await confirmHostEmail(env, c.hid, c.org, use, c.newKey(), now);
    return c.json({ ok: true, token: done.token, kind: "host", ready: done.ready, needMobile: done.needMobile });
  }
  return null;
}
