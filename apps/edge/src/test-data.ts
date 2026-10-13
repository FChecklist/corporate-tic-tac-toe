// Deletes everything that was made while the service was in TEST mode (owner-only: POST /api/owner/purge-test-data, see mode.ts). Added 2026-10-06.
// What goes: every is_test engagement (and every engagement of a test organizer account) with all its rows, test organizer accounts and their keys, test payments with their
// invoices and entitlements, test partners and commissions, and test visitor sessions. What stays: the append-only internal audit log (audit_log, audit_stats, audit_cert),
// the owner's access log (where this purge is recorded as one line), the e-mail event log (no addresses, only hashes), and every real (is_test = 0) record.
import { logAccess } from "./audit";
import { purgeTestEngagement } from "./lifecycle";
import type { D1, Env } from "./worker";

const CHUNK = 40; // D1 allows about 100 bound values in one statement
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
async function each(db: D1, ids: string[], sql: (m: string) => string, times = 1): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += CHUNK) { const part = ids.slice(i, i + CHUNK); const r = await db.prepare(sql(marks(part.length))).bind(...Array.from({ length: times }, () => part).flat()).run(); n += r.meta?.changes ?? 0; }
  return n;
}
const col = async (db: D1, sql: string, ...v: unknown[]): Promise<string[]> => ((await db.prepare(sql).bind(...v).all<any>()).results ?? []).map((r: any) => String(Object.values(r)[0]));

export async function purgeTestData(env: Env, now: number): Promise<Record<string, number>> {
  const db = env.DB, out: Record<string, number> = {};
  const orgs = [...new Set([...(await col(db, "SELECT org FROM organizer_key WHERE is_test=1")), ...(await col(db, "SELECT org FROM organizer_email WHERE is_test=1"))])];
  // 1. engagements: flagged themselves, or belonging to a test account
  const engs = new Set(await col(db, "SELECT id FROM engagement WHERE is_test=1"));
  for (let i = 0; i < orgs.length; i += CHUNK) { const part = orgs.slice(i, i + CHUNK); for (const id of await col(db, `SELECT id FROM engagement WHERE org IN (${marks(part.length)})`, ...part)) engs.add(id); }
  for (const id of engs) { await purgeTestEngagement(env, id, now); try { await (env as any).CONTROL_R2?.delete(`c/${id}.json`); } catch { /* the object expires with its engagement anyway */ } }
  out.engagements = engs.size;
  // 2. payments and what hangs off them
  const pays = new Set(await col(db, "SELECT id FROM payment WHERE is_test=1"));
  for (let i = 0; i < orgs.length; i += CHUNK) { const part = orgs.slice(i, i + CHUNK); for (const id of await col(db, `SELECT id FROM payment WHERE org IN (${marks(part.length)})`, ...part)) pays.add(id); }
  const pl = [...pays];
  await each(db, pl, (m) => `DELETE FROM invoice WHERE payment_id IN (${m})`);
  await each(db, pl, (m) => `DELETE FROM entitlement WHERE payment_id IN (${m})`);
  await each(db, pl, (m) => `DELETE FROM commission WHERE payment_id IN (${m})`);
  await each(db, orgs, (m) => `DELETE FROM credit_use WHERE credit_id IN (SELECT id FROM credit WHERE org IN (${m}))`); // credit made while testing
  await each(db, pl, (m) => `DELETE FROM credit_use WHERE credit_id IN (SELECT id FROM credit WHERE payment_id IN (${m}))`);
  await db.prepare("DELETE FROM credit_use WHERE credit_id IN (SELECT id FROM credit WHERE is_test=1)").run();
  await each(db, orgs, (m) => `DELETE FROM credit WHERE org IN (${m})`);
  out.credits = ((await db.prepare("DELETE FROM credit WHERE is_test=1").run()).meta?.changes ?? 0);
  out.payments = await each(db, pl, (m) => `DELETE FROM payment WHERE id IN (${m})`);
  // 3. partners (a partner who joined in TEST) and any commission row flagged test
  const partners = await col(db, "SELECT code FROM partner WHERE is_test=1");
  await each(db, partners, (m) => `DELETE FROM commission WHERE partner_code IN (${m})`);
  out.partners = await each(db, partners, (m) => `DELETE FROM partner WHERE code IN (${m})`);
  out.commissions = (await db.prepare("DELETE FROM commission WHERE is_test=1").run()).meta?.changes ?? 0;
  // 4. visitor sessions made in TEST mode (and any session tied to a test account)
  await db.prepare("DELETE FROM visit_event WHERE sid IN (SELECT sid FROM visit_session WHERE is_test=1)").run();
  out.visitorSessions = (await db.prepare("DELETE FROM visit_session WHERE is_test=1").run()).meta?.changes ?? 0;
  // 5. the accounts themselves: sign-in codes, key bookkeeping, then the keys and e-mail rows
  await each(db, orgs, (m) => `DELETE FROM login_code WHERE email_hash IN (SELECT email_hash FROM organizer_email WHERE org IN (${m}))`);
  await each(db, orgs, (m) => `DELETE FROM kv WHERE k IN (SELECT 'seen/'||substr(hash,1,10) FROM organizer_key WHERE org IN (${m})) OR k IN (SELECT 'alert/'||substr(hash,1,10) FROM organizer_key WHERE org IN (${m}))`, 2);
  for (const o of orgs) await db.prepare("DELETE FROM kv WHERE k=? OR k=?").bind(`orgmail/${o}`, `aikey/${o}`).run();
  await each(db, orgs, (m) => `DELETE FROM ai_audit WHERE org IN (${m})`);
  await each(db, orgs, (m) => `DELETE FROM organizer_terms WHERE org IN (${m})`);
  await each(db, orgs, (m) => `DELETE FROM suggestion_vote WHERE org IN (${m}) OR sid IN (SELECT id FROM suggestion WHERE org IN (${m}))`, 2);
  await each(db, orgs, (m) => `DELETE FROM suggestion WHERE org IN (${m})`);
  await each(db, orgs, (m) => `DELETE FROM entitlement WHERE org IN (${m})`);
  await each(db, orgs, (m) => `DELETE FROM organizer_email WHERE org IN (${m})`);
  for (const t of ["host_state", "host_login", "paylink"]) await each(db, orgs, (m) => `DELETE FROM ${t} WHERE org IN (${m})`); // Host first-open state, e-mail sign-in of Hosts, pay links
  out.accounts = orgs.length;
  await each(db, orgs, (m) => `DELETE FROM organizer_key WHERE org IN (${m})`);
  out.keys = (await db.prepare("DELETE FROM organizer_key WHERE is_test=1").run()).meta?.changes ?? 0;
  await logAccess(db, now, "purge-test-data", null, null, Object.values(out).reduce((a, b) => a + b, 0), true, Object.entries(out).map(([k, v]) => `${k}=${v}`).join(" "));
  return out;
}
