// "Create a new game like this one" (docs/ROLES_AND_CONSOLE_SPEC_5.md part B). Organizer and Host, equal rights; never an AI key, never a Co-host.
//   POST /api/z/{id}/clone {startRound?, withPeople?: boolean} -> {ok, id, openUrl, copied:[...], peopleCopied:n, needsStart, ...}
// It makes a NEW DRAFT with a new game id and copies the SETTINGS: occasion/name, size, tickets, gap between numbers, rounds, who can join, guest-invite options, Co-host limit, prizes
// (all houses and their texts), brand strip, brand moments, lucky draw. It does NOT copy payment, status, guests, waiting requests, Co-hosts (their links are per game) or personal links.
// The date and time are NEVER copied. Without `startRound` the draft is parked 30 days ahead and marked "start pending" (kv startpending/<id>): it cannot be published or paid
// until the Organizer picks a time (the console opens on step 1 with the date empty). With `startRound` it is validated like any other time (future, at most 30 days ahead).
// `withPeople: true` brings the old game's people list (names and numbers stay sealed; each person gets a NEW personal link, the old links stay with the old game). It works only while the
// old list still exists (before its erasure); otherwise `peopleCopied` is 0 and `peopleNote` says so calmly. The old game's own copy is erased on its own clock as always.
import { sealText } from "./pii";
import { newToken, tokenHash, randHex } from "./people";
import { MAX_AHEAD_MS } from "./lifecycle";
import { MAX_DRAFTS } from "./pay";
import { orgIsTest, testFlag } from "./mode";
import type { D1, Env } from "./worker";

const GENESIS = 1692803367;
const roundMs = (r: number) => (GENESIS + (r - 1) * 3) * 1000;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GENESIS) / 3) + 1;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const suffix = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHA[b % ALPHA.length]).join("");

/** Copies the people list of `fromEid` into `toEid` as fresh, un-joined invitations with new personal links. Returns how many people were copied. */
export async function copyPeople(env: Env, fromEid: string, toEid: string, cap: number, now: number, spend: (n: number) => Promise<boolean>): Promise<{ copied: number; busy?: boolean }> {
  const db = env.DB;
  const listed = (await db.prepare("SELECT ph, pii, inviter FROM person WHERE eid=? AND status<>'removed' AND role IS NULL ORDER BY added_ms, id").bind(fromEid).all<{ ph: string; pii: string; inviter: string }>()).results ?? [];
  const joined = (await db.prepare("SELECT p.phone_hash AS ph, p.pii AS pii FROM participant p WHERE p.eid=? AND p.pii IS NOT NULL AND p.phone_hash NOT IN (SELECT ph FROM person WHERE eid=? AND status<>'removed') AND NOT EXISTS (SELECT 1 FROM seat s WHERE s.eid=p.eid AND s.pid=p.pid AND (s.role IS NOT NULL OR s.blocked=1)) ORDER BY p.joined_ms, p.pid").bind(fromEid, fromEid).all<{ ph: string; pii: string }>()).results ?? [];
  const all = [...listed.map((x) => ({ ph: x.ph, pii: x.pii, inviter: /^(o|h:[0-9a-f]+)$/.test(x.inviter) ? x.inviter : "o" })), ...joined.map((x) => ({ ph: x.ph, pii: x.pii, inviter: "o" }))].slice(0, cap);
  if (!all.length) return { copied: 0 };
  if (!(await spend(all.length * 2))) return { copied: 0, busy: true };
  let copied = 0;
  for (let i = 0; i < all.length; i += 40) {
    const stmts = [];
    for (const x of all.slice(i, i + 40)) {
      const token = newToken();
      stmts.push(db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,approved_by,approved_ms,added_ms) VALUES(?,?,?,?,?,NULL,'invited',?,?,NULL,NULL,?)").bind(toEid, randHex(6), x.ph, x.pii, x.inviter, await tokenHash(token), await sealText(env as any, token), now));
    }
    for (const r of await db.batch(stmts)) copied += r.meta?.changes ?? 0;
  }
  return { copied };
}

/** The clone itself. The caller (worker.ts) has already checked who is asking (Organizer, Host or the platform owner; never an AI key or a Co-host) and that the game exists. */
export async function cloneGame(env: Env, e: any, b: any, now: number, origin: string, spend: (n: number) => Promise<boolean>, json: (o: unknown, s?: number) => Response): Promise<Response> {
  const db: D1 = env.DB;
  const org = e.org as string | null;
  let startRound: number | null = null;
  if (b?.startRound !== undefined && b.startRound !== null) {
    if (!Number.isInteger(b.startRound)) return json({ error: "Check the start time." }, 400);
    if (roundMs(b.startRound) <= now) return json({ error: "Pick a start time in the future." }, 400);
    if (roundMs(b.startRound) > now + MAX_AHEAD_MS) return json({ error: "A game can be set at most 30 days ahead. Please pick a day within the next 30 days.", code: "too-far" }, 400);
    startRound = b.startRound;
  }
  if (org) {
    const n = (await db.prepare("SELECT COUNT(*) AS c FROM engagement e WHERE e.org=? AND e.pack=0 AND NOT EXISTS (SELECT 1 FROM kv WHERE k='pub/' || e.id)").bind(org).first<{ c: number }>())?.c ?? 0;
    if (n >= MAX_DRAFTS) return json({ error: `You have ${MAX_DRAFTS} unpublished drafts. Publish one, or delete one you do not need (open Your games, then press Delete next to it). An unpublished draft is also forgotten after 30 days.`, code: "draft-limit" }, 409);
  }
  if (!(await spend(6))) return json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);
  const base = String(e.id).replace(/-[A-Z2-9]{4}$/, "").slice(0, 34);
  let id = "", made = false;
  const pending = startRound === null;
  const sr = startRound ?? roundAt(now + MAX_AHEAD_MS - 60_000); // parked inside the 30-day window until a time is chosen
  const test = (await testFlag(env)) === 1 || (await orgIsTest(env, org)) ? 1 : 0;
  for (let i = 0; i < 6 && !made; i++) {
    id = `${base}-${suffix()}`;
    const r = await db.prepare("INSERT OR IGNORE INTO engagement(id,start_round,call_seconds,cap,created_ms,org,closed,pack,tickets,config,is_test,cohost_limit) VALUES(?,?,?,?,?,?,?,0,?,?,?,?)")
      .bind(id, sr, e.call_seconds, e.cap, now, org, e.closed ? 1 : 0, e.tickets, e.config, test, e.cohost_limit ?? null).run();
    made = (r.meta?.changes ?? 0) > 0;
  }
  if (!made) return json({ error: "Could not make a new game code. Please try again." }, 503);
  if (pending) await db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`startpending/${id}`, String(now)).run();
  let peopleCopied = 0, peopleNote: string | undefined;
  if (b?.withPeople === true) {
    const r = await copyPeople(env, e.id, id, e.cap, now, spend);
    peopleCopied = r.copied;
    if (!r.copied) peopleNote = r.busy ? "It is very busy right now. Add your people again in a few minutes." : "The old guest list has been erased, so add your people again.";
  }
  let cfg: any = {}; try { cfg = e.config ? JSON.parse(e.config) : {}; } catch { cfg = {}; }
  const copied = [
    "Occasion and name", "Number of players", "Who can join", "Co-host limit",
    ...(cfg.invites ? ["Guest invites"] : []), ...(Array.isArray(cfg.rewards) && cfg.rewards.length ? ["Prizes (all places and their texts)"] : []),
    ...(cfg.brand ? ["Brand strip"] : []),
  ];
  return json({ ok: true, id, openUrl: `${origin}/zc.html?e=${id}`, copied, peopleCopied, ...(peopleNote ? { peopleNote } : {}), needsStart: pending, startRound: sr, from: e.id, message: "Your new game is ready to check. Pick the date and time, then publish. This is a new game. Nothing is paid or published yet." });
}

