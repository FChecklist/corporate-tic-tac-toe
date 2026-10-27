// Present check-in (owner decision 2026-10-23): before a game, every participant marks themselves PRESENT, and only then does their card open.
//   - Opens 5 minutes before the organizer's start time and stays open (a late joiner checks in at once). Until it is done the card is hidden and no claim is accepted.
//   - The participant sees their Game ID, Participant ID and Card ID, checks their name and mobile number (confirm, or edit), reads who invited them (cannot be edited), and types the
//     4-digit code shown on THEIR OWN card page. Each participant of a game has a different code (a keyed permutation of 0000-9999 over the card number: never two the same).
//   - A game made before CHECKIN_FROM_MS is played the old way (no check-in), so games already running are not touched.
//   - Evidence: the time of the check-in is kept with the winners record for 365 days (it shows the winner was present and passed the check); every other check-in record is deleted
//     with the participants' data within 24 hours of the end (lifecycle.ts erasePersonal).
import type { D1, Env } from "./worker";
import { cleanPhone, keptFromClean, keptPhone } from "./phonekit";
import { openPii, sealPii } from "./pii";

/** Games created at or after this moment require the check-in. */
export const CHECKIN_FROM_MS = Date.UTC(2026, 9, 23, 10, 0, 0);
export const CHECKIN_OPENS_BEFORE_MS = 5 * 60_000;
export const CHECKIN_MAX_TRIES = 5;
export const CHECKIN_LOCK_MS = 10 * 60_000;

/** The end of a key range for a prefix that ends in "/": every key that starts with the prefix is >= prefix and < prefixEnd(prefix). Used instead of LIKE, where "_" is a wildcard and capitals match small letters (a game id may hold "_"). */
export const prefixEnd = (prefix: string): string => prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
/** Corporate Tic Tac Toe has no check-in step (that is a Corporate Tambola rule): its cards open straight away, so this is always false and no claim waits for a "present" mark. */
export const checkinRequired = (_e: { created_ms?: number | null }): boolean => false;
/** Is this the phone of the card? The participant id is public (the seat list shows it), so every action done for a card also carries the phone's own random device id, whose hash is kept with the seat. */
export async function deviceMatches(env: Env, eid: string, pid: string, device: unknown): Promise<boolean> {
  if (typeof device !== "string" || !/^[0-9a-f]{16,64}$/.test(device)) return false;
  const row = await env.DB.prepare("SELECT dev FROM seat WHERE eid=? AND pid=?").bind(eid, pid).first<{ dev: string | null }>();
  return !!row?.dev && row.dev === (await sha(`dev|${eid}|${device}`)).slice(0, 32);
}
export const checkinOpensMs = (startMs: number): number => startMs - CHECKIN_OPENS_BEFORE_MS;
export const seatOfPidText = (pid: string): number | null => { const m = /^(\d{1,6})x/.exec(String(pid)); return m ? Number(m[1]) : null; };
export const ticketId = (eid: string, seat: number): string => `${eid}-T${String(seat).padStart(4, "0")}`;

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

/** A keyed permutation of 0..9999 (a 14-bit Feistel network with cycle-walking): different inputs never give the same output, and the mapping cannot be guessed without the key. */
export function perm10k(keyHex: string, x: number): number {
  const kb = Array.from({ length: 32 }, (_, i) => parseInt(keyHex.slice(i * 2, i * 2 + 2), 16));
  const f = (r: number, h: number) => (kb[(r * 8 + (h & 7)) % 32]! * 131 + kb[(r * 5 + 3 + (h >> 3)) % 32]! * 29 + h * 17 + r * 101) & 127;
  let v = x % 16384;
  do {
    let L = v >> 7, R = v & 127;
    for (let r = 0; r < 6; r++) { const nL = R, nR = L ^ f(r, R); L = nL; R = nR; }
    v = (L << 7) | R;
  } while (v >= 10000);
  return v;
}
export async function codeFor(env: Env, eid: string, seat: number): Promise<string> {
  const key = await sha(`ckin|${eid}|${(env as any).DATA_KEY ?? ""}|${(env as any).PHONE_SALT ?? ""}`);
  return String(perm10k(key, (seat - 1 + 10000) % 10000)).padStart(4, "0");
}

export async function presentMsOf(db: D1, eid: string, seat: number): Promise<number | null> {
  const r = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`present/${eid}/${seat}`).first<{ v: string }>();
  if (!r) return null;
  try { return Number(JSON.parse(r.v).t) || null; } catch { return null; }
}
export async function presentCount(db: D1, eid: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS c FROM kv WHERE k >= ? AND k < ?").bind(`present/${eid}/`, prefixEnd(`present/${eid}/`)).first<{ c: number }>())?.c ?? 0;
}

interface Ctx { env: Env; e: any; eid: string; now: number; startMs: number; json: (o: unknown, s?: number) => Response; spend: (n?: number) => Promise<boolean>; busy: () => Response; body: (req: Request) => Promise<any>; req: Request; url: URL }

/** GET /checkin?pid=  and  POST /checkin  (the participant's own pid is the key, like every other call a phone makes). */
export async function checkinRoute(c: Ctx): Promise<Response> {
  const { env, e, eid, now, json } = c; const db = env.DB;
  if (!checkinRequired(e)) return json({ required: false });
  const pidIn = c.req.method === "GET" ? c.url.searchParams.get("pid") ?? "" : "";
  const b = c.req.method === "POST" ? await c.body(c.req) : null;
  const pid = c.req.method === "GET" ? pidIn : typeof b?.pid === "string" ? b.pid : "";
  const seat = seatOfPidText(pid);
  const who = seat ? await db.prepare("SELECT p.pii AS pii, p.name AS name, s.seq AS seq, s.inv AS inv, s.dev AS dev, s.blocked AS blocked FROM participant p JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=? AND p.pid=?").bind(eid, pid).first<{ pii: string | null; name: string | null; seq: number; inv: number | null; dev: string | null; blocked: number | null }>() : null;
  if (!who) return json({ error: "Not a participant of this engagement." }, 403);
  if (who.blocked) return json({ error: "You were removed from this game by the organizer.", code: "removed", removed: true }, 403);
  // The participant id is not a secret (the seat list is public once the game starts), so the phone proves it is THE phone of this card: its own random device id, whose hash is kept with the seat (the same rule as joining).
  const devIn = c.req.method === "GET" ? c.url.searchParams.get("device") ?? "" : typeof b?.device === "string" ? b.device : "";
  const devHash = /^[0-9a-f]{16,64}$/.test(devIn) ? (await sha(`dev|${eid}|${devIn}`)).slice(0, 32) : null;
  if (!devHash || !who.dev || who.dev !== devHash) return json({ error: "This card belongs to another phone. Open your own link on your own phone to check in.", code: "other-phone" }, 403);
  const opensMs = checkinOpensMs(c.startMs), open = now >= opensMs, presentMs = await presentMsOf(db, eid, who.seq);
  const pii = await openPii(env as any, who.pii);
  if (c.req.method === "GET") {
    let invitedBy: string | null = null;
    if (who.inv) { const up = await db.prepare("SELECT p.pii AS pii, p.name AS name FROM seat s JOIN participant p ON p.eid=s.eid AND p.pid=s.pid WHERE s.eid=? AND s.seq=?").bind(eid, who.inv).first<{ pii: string | null; name: string | null }>(); const upii = up ? await openPii(env as any, up.pii) : null; invitedBy = (upii?.name || up?.name || `Card ${who.inv}`).toString().slice(0, 60); }
    return json({
      required: true, gameId: eid, participantId: pid, ticketId: ticketId(eid, who.seq), seat: who.seq, opensMs, open, present: presentMs !== null, presentMs,
      name: pii?.name ?? who.name ?? "", mobile: pii?.phone ? "******" + String(pii.phone).slice(-4) : "", hasName: !!(pii?.name ?? who.name), hasMobile: !!pii?.phone, invitedBy, ...(open && presentMs === null ? { code: await codeFor(env, eid, who.seq) } : {}),
    });
  }
  // ---- POST: the participant presses Submit ----
  if (presentMs !== null) return json({ ok: true, present: true, presentMs });
  if (!open) return json({ error: `Check-in opens at ${new Date(opensMs + 5.5 * 3600_000).toISOString().slice(11, 16)} India time, 5 minutes before the game.`, code: "not-open", opensMs }, 403);
  const hadName = !!(pii?.name ?? who.name), hadMobile = !!pii?.phone; // a person who came in by employee ID may have neither on file: there is nothing to confirm then
  if ((hadName && b?.confirmName !== true) || (hadMobile && b?.confirmMobile !== true)) return json({ error: hadName && hadMobile ? "Please confirm your name and your mobile number." : hadName ? "Please confirm your name." : "Please confirm your mobile number.", code: "confirm" }, 400);
  const failKey = `ckfail/${eid}/${who.seq}`;
  const fr = await db.prepare("SELECT v FROM kv WHERE k=?").bind(failKey).first<{ v: string }>(); const f = fr ? JSON.parse(fr.v) as { n: number; t: number } : null;
  if (f && f.n >= CHECKIN_MAX_TRIES && now - f.t < CHECKIN_LOCK_MS) return json({ error: "Too many wrong codes. Please wait a few minutes and try again.", code: "locked" }, 429);
  const typed = String(b?.code ?? "").replace(/\D/g, "");
  if (typed.length !== 4 || typed !== (await codeFor(env, eid, who.seq))) {
    if (!(await c.spend(1))) return c.busy();
    const n = f && now - f.t < CHECKIN_LOCK_MS ? f.n + 1 : 1;
    await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(failKey, JSON.stringify({ n, t: now })).run();
    return json({ error: "That code is not the one on your card. Look at your code again and type its 4 digits.", code: "wrong-code", triesLeft: Math.max(0, CHECKIN_MAX_TRIES - n) }, 400);
  }
  // optional edits: the name and the mobile number kept for the prize hand-over (the identity of the card itself never changes)
  let name = pii?.name ?? who.name ?? null, phone = pii?.phone ?? null, editedName = false, editedMobile = false;
  const nn = typeof b?.name === "string" ? Array.from(b.name as string).filter((ch: string) => { const c = ch.charCodeAt(0); return !(c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)); }).join("").replace(/[<>`]/g, "").replace(/^[=+\-@\s]+/, "").trim().slice(0, 60) : "";
  if (nn && nn !== name) { name = nn; editedName = true; }
  const rawMob = typeof b?.mobile === "string" ? b.mobile.trim() : ""; // from any country: the page sends +<country code><number>
  if (rawMob) { const cl = cleanPhone(rawMob); if (!cl.ok) return json({ error: cl.why, code: "bad-mobile" }, 400); const kept = keptFromClean(cl.digits); if (kept !== keptPhone(phone ?? "")) { phone = kept; editedMobile = true; } }
  if (!(await c.spend(2))) return c.busy();
  const stmts = [db.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`present/${eid}/${who.seq}`, JSON.stringify({ t: now, pid, dev: who.dev, en: editedName, em: editedMobile })), db.prepare("DELETE FROM kv WHERE k=?").bind(failKey)];
  if ((editedName || editedMobile) && pii) stmts.push(db.prepare("UPDATE participant SET pii=?, name=? WHERE eid=? AND pid=?").bind(await sealPii(env as any, { phone: phone ?? pii.phone, name, ...(pii.empId ? { empId: pii.empId } : {}) }), name, eid, pid));
  await db.batch(stmts);
  return json({ ok: true, present: true, presentMs: now, editedName, editedMobile });
}

/** The organizer's view: how many are present now, and which card numbers. */
export async function presenceRoute(env: Env, eid: string, json: Ctx["json"]): Promise<Response> {
  const rows = (await env.DB.prepare("SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k LIMIT 100000").bind(`present/${eid}/`, prefixEnd(`present/${eid}/`)).all<{ k: string }>()).results ?? [];
  const total = (await env.DB.prepare("SELECT COUNT(*) AS c FROM seat WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
  return json({ present: rows.length, total, seats: rows.map((r) => Number(r.k.split("/")[2])) });
}

/** Called when winners are recorded: the winners' check-in time and ids are copied to the record that is kept 365 days (everyone else's check-in data goes within 24 hours). */
export async function keepWinnerEvidence(env: Env, eid: string, seats: number[]): Promise<void> {
  for (const seat of seats) {
    const r = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`present/${eid}/${seat}`).first<{ v: string }>();
    if (r) { let t: unknown = null; try { t = JSON.parse(r.v).t; } catch { /* none */ } if (typeof t === "number") await env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`wev/${eid}/${seat}`, JSON.stringify({ t })).run(); } // only the time of the check-in is kept for 365 days (not the device or the ids)
  }
}
