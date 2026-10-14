// A player's own rights, with no account (gates U5, U6, D7):
//   * LEAVE  - POST /api/z/{id}/leave {pid, device}: the player takes their own seat and details out of the game, at any time.
//   * REQUEST - POST /api/z/{id}/datareq {pid, device, kind: access | correction | erasure, note?}: "what do you hold about me / correct / delete me".
//               The request is stored, the game's organizer and the owner are told by e-mail, the player is shown the promised answer time (PROMISE_DAYS),
//               and an erasure is carried out at once with the same code a player leaving uses. {kind: "status"} lists the player's own requests.
// The player proves who they are the same way the prize-confirmation route does: their card id (pid) AND the phone's own random device id, whose hash
// is the one stored with the seat (the pid alone is public: it is in the seat list every phone reads). Nobody else can ask on a player's behalf.
// What a request row holds: the card id, the kind, a short free note and three times. No name, number, address or device. It is deleted with the
// game's other participant data (lifecycle.ts erasePersonal) and again with the game at 365 days (deleteEngagementRows).
import { openPii } from "./pii";
import type { D1, D1Stmt } from "./worker";
import { sendMail, type PayEnv } from "./pay";
import { ownerAddress } from "./owner-mail";
import { BRAND } from "./brand";

/** The answer time we promise a player. ONE constant: change it here and the page, the e-mails and the tests all follow. */
export const PROMISE_DAYS = 7;
export const PROMISE_TEXT = `within ${PROMISE_DAYS} days`;
/** What this game calls a player's place in it (card, ticket, board, place): the one word the answers and e-mails use. */
export const NOUN = "place";
const Noun = NOUN[0]!.toUpperCase() + NOUN.slice(1);
/** "nomination" is the right to name another person who may use these rights for you if you cannot (DPDP Act, section 14). The row lands in the owner's request queue like any other; the person is named by e-mail to BRAND.support. */
export const REQUEST_KINDS = ["access", "correction", "erasure", "nomination"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
/** A player may send at most this many requests per game (the same kind twice while one is open is answered with the first). */
export const MAX_REQUESTS_PER_PLAYER = 5;

export const RIGHTS_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS data_request (id TEXT PRIMARY KEY, eid TEXT NOT NULL, pid TEXT NOT NULL, kind TEXT NOT NULL, note TEXT, created_ms INTEGER NOT NULL, due_ms INTEGER NOT NULL, status TEXT NOT NULL, done_ms INTEGER)`,
  `CREATE INDEX IF NOT EXISTS data_request_eid ON data_request (eid, pid)`,
];

export interface RightsCtx {
  env: PayEnv & { DATA_KEY?: string; ORGANIZER_SECRET?: string };
  db: D1;
  e: any;
  eid: string;
  now: number;
  /** The game has begun: the seat then stays in the public list (every phone must work out identical winners) but loses everything personal. */
  started: boolean;
  b: any;
  json: (o: unknown, status?: number) => Response;
  gameName: string;
  /** The organizer's e-mail address (null when none is known). */
  orgEmail: () => Promise<string | null>;
  /** When this game's participant data is deleted for good (ms). */
  erasureMs: () => Promise<number>;
  /** Spends from the day's write allowance; false = too busy. */
  spend: (n: number) => Promise<boolean>;
  /** Statements for whatever this game keeps about a player in its OWN tables (names on a bracket, a nickname, votes ...). */
  extraLeave?: (eid: string, pid: string) => D1Stmt[];
}

const enc = new TextEncoder();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))), (x) => x.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, "0")).join("");
const istTime = (ms: number) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " IST";
const istDay = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

interface Seat { seq: number; pid: string; ph: string; dev: string | null; src: string | null; inv: number | null; role: string | null; blocked: number | null }

/** The player's own seat, or the answer to send: needs the card id and the phone's own device id, and the phone must be the one that holds the card. */
async function ownSeat(c: RightsCtx): Promise<Seat | Response> {
  const pid = typeof c.b?.pid === "string" ? c.b.pid : "", device = typeof c.b?.device === "string" ? c.b.device : "";
  if (!/^[0-9a-z]{3,40}$/.test(pid) || !/^[0-9a-f]{16,64}$/.test(device)) return c.json({ error: `Please open this from the phone that holds your ${NOUN}.`, code: "bad-request" }, 400);
  const dev = (await sha(`dev|${c.eid}|${device}`)).slice(0, 32);
  const s = await c.db.prepare("SELECT seq, pid, ph, dev, src, inv, role, blocked FROM seat WHERE eid=? AND pid=? AND dev=?").bind(c.eid, pid, dev).first<Seat>();
  if (!s) return c.json({ error: `This is not the phone that holds this ${NOUN}. Nobody can ask for another player.`, code: "not-your-card" }, 403);
  return s;
}

/** The statements that take one player out of a game. Same removal rule the organizer's "remove" button follows (people.ts removePerson): before the start the seat and the
 *  details are deleted; once the game has begun the seat stays as an anonymous id in the public list (winners must be identical on every phone), blocked, with nothing personal left. */
export function leaveStatements(c: Pick<RightsCtx, "db" | "eid" | "now" | "started" | "extraLeave">, s: Seat): D1Stmt[] {
  const { db, eid, now } = c;
  const st: D1Stmt[] = [
    db.prepare("DELETE FROM claim WHERE eid=? AND pid=?").bind(eid, s.pid),
    db.prepare("DELETE FROM consent_log WHERE kind='K4' AND ref=? AND subject=?").bind(eid, s.pid),
    db.prepare("UPDATE prize SET pii=NULL, orig=NULL, trail=NULL WHERE eid=? AND seat=?").bind(eid, s.seq), // a prize record keeps no identity once the person leaves
  ];
  // the player's line on the organizer's list: before the start it is deleted (the player may come back later); once the game has begun it stays as "removed by self" with nothing personal in it
  if (c.started) st.push(db.prepare("UPDATE person SET status='removed', removed_ms=?, removed_by='self', pii='', tok_hash=NULL, tok_sealed=NULL WHERE eid=? AND ph=? AND status<>'removed'").bind(now, eid, s.ph));
  else st.push(db.prepare("DELETE FROM person WHERE eid=? AND ph=? AND role IS NULL").bind(eid, s.ph));
  if (c.extraLeave) st.push(...c.extraLeave(eid, s.pid));
  if (c.started) st.push(db.prepare("UPDATE participant SET pii=NULL, name=NULL WHERE eid=? AND pid=?").bind(eid, s.pid), db.prepare("UPDATE seat SET blocked=1 WHERE eid=? AND pid=?").bind(eid, s.pid));
  else st.push(db.prepare("DELETE FROM participant WHERE eid=? AND pid=?").bind(eid, s.pid), db.prepare("DELETE FROM seat WHERE eid=? AND pid=?").bind(eid, s.pid));
  return st;
}
async function refreshBlocked(db: D1, eid: string): Promise<void> {
  try {
    const rows = (await db.prepare("SELECT pid FROM seat WHERE eid=? AND blocked=1").bind(eid).all<{ pid: string }>()).results ?? [];
    await db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`seats-blk/${eid}`, JSON.stringify(rows.map((r) => r.pid))).run();
  } catch { /* the next removal writes it again */ }
}
async function takeOut(c: RightsCtx, s: Seat): Promise<void> {
  await c.db.batch(leaveStatements(c, s));
  if (c.started) await refreshBlocked(c.db, c.eid);
}

/** POST /api/z/{id}/leave */
export async function leaveRoute(c: RightsCtx): Promise<Response> {
  const s = await ownSeat(c);
  if (s instanceof Response) return s;
  if (!(await c.spend(4))) return c.json({ error: "It is busy right now. Please try again in a few minutes.", code: "busy" }, 503);
  await takeOut(c, s);
  return c.json({ ok: true, left: true, message: "You have left the game. Your name and your place were deleted from our system just now. You can close this page." });
}

/** What we hold about this player right now, in plain words (the answer to "what do you hold about me"). */
export async function heldAbout(c: RightsCtx, s: Seat): Promise<{ what: string; value: string }[]> {
  const out: { what: string; value: string }[] = [];
  const p = await c.db.prepare("SELECT pii, joined_ms FROM participant WHERE eid=? AND pid=?").bind(c.eid, s.pid).first<{ pii: string | null; joined_ms: number }>();
  const who = await openPii(c.env as any, p?.pii);
  out.push({ what: "Your name for this game", value: who?.name ? who.name : "none" });
  if (who?.phone) out.push({ what: "Your mobile number (given by the organizer's list)", value: "ending " + who.phone.slice(-2) });
  out.push({ what: `Your ${NOUN} number`, value: String(s.seq) });
  if (p?.joined_ms) out.push({ what: "When you joined", value: istTime(p.joined_ms) });
  out.push({ what: "How you joined", value: s.inv !== null ? `through the invite of ${NOUN} ${s.inv}` : "through a game link" });
  const claims = (await c.db.prepare("SELECT COUNT(*) AS n FROM claim WHERE eid=? AND pid=?").bind(c.eid, s.pid).first<{ n: number }>())?.n ?? 0;
  out.push({ what: "Your winning claims", value: String(claims) });
  const pr = (await c.db.prepare("SELECT pii FROM prize WHERE eid=? AND seat=? AND pii IS NOT NULL").bind(c.eid, s.seq).all<{ pii: string }>()).results ?? [];
  if (pr.length) { const w = await openPii(c.env as any, pr[0]!.pii); out.push({ what: "Details you confirmed to collect a prize", value: `${w?.name ?? ""}${w?.phone ? ", mobile ending " + w.phone.slice(-2) : ""}`.trim() || "yes" }); }
  out.push({ what: "Your phone", value: `only a scrambled form of its random id, to keep one ${NOUN} to one phone` });
  out.push({ what: "Deleted for good", value: istTime(await c.erasureMs()) + " at the latest (within 24 hours after the game ends)" });
  return out;
}

const cleanNote = (n: unknown): string => (typeof n === "string" ? n.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 300) : "");
const KIND_WORDS: Record<RequestKind, string> = { access: "to see what is held about them", correction: "to correct their details", erasure: "to be deleted", nomination: "to name another person who may use their rights for them (DPDP Act, section 14)" };

async function mailBoth(c: RightsCtx, id: string, kind: RequestKind, seat: Seat, name: string, note: string, due: number, erased: boolean): Promise<void> {
  const subjectEnd = `${c.gameName} (${NOUN} ${seat.seq})`;
  const base = [
    `A player of "${c.gameName}" has asked ${KIND_WORDS[kind]}.`, "",
    `Game: ${c.gameName} (${c.eid})`, `${Noun} number: ${seat.seq}`, `Request: ${kind}`, `Received: ${istTime(c.now)}`,
    `We promised the player an answer ${PROMISE_TEXT}, by ${istDay(due)}.`,
  ];
  const orgBody = [...base, ...(name ? [`Name the player gave: ${name}`] : []), ...(note ? [`Note from the player: ${note}`] : []), "",
    erased ? "The player's name and place were deleted at once, as they asked. Nothing more is needed from you." : kind === "nomination" ? `The player has been asked to write to ${BRAND.support} with the name of the person they nominate. Please answer the player.` : kind === "access" ? "The player has already been shown what we hold. Please answer anything more they ask." : "You are the one who holds this name for the game. Please answer the player.",
    `Request number: ${id}`].join("\n");
  const ownerBody = [...base, `Organizer informed: yes`, "", erased ? "Deleted at once." : "Open.", `Request number: ${id}`].join("\n");
  try { const to = await c.orgEmail(); if (to) await sendMail(c.env, c.db, to, `A player's data request: ${subjectEnd}`, orgBody, c.now); } catch { /* the request is stored; a mail is a nudge */ }
  try { await sendMail(c.env, c.db, ownerAddress(c.env), `Player data request (${kind}): ${subjectEnd}`, ownerBody, c.now, { owner: true }); } catch { /* the request is stored */ }
}

/** POST /api/z/{id}/datareq  {pid, device, kind: "access"|"correction"|"erasure"|"status", note?} */
export async function requestRoute(c: RightsCtx): Promise<Response> {
  const s = await ownSeat(c);
  if (s instanceof Response) return s;
  const kind = c.b?.kind;
  if (kind === "status") {
    const rows = (await c.db.prepare("SELECT id, kind, created_ms, due_ms, status, done_ms FROM data_request WHERE eid=? AND pid=? ORDER BY created_ms").bind(c.eid, s.pid).all<any>()).results ?? [];
    return c.json({ promiseDays: PROMISE_DAYS, promise: PROMISE_TEXT, requests: rows.map((r: any) => ({ id: r.id, kind: r.kind, status: r.status, receivedMs: r.created_ms, answerByMs: r.due_ms, doneMs: r.done_ms ?? null })) });
  }
  if (!REQUEST_KINDS.includes(kind)) return c.json({ error: "Please choose what you want: to see your data, to correct it, or to delete it.", code: "bad-kind" }, 400);
  const note = cleanNote(c.b?.note);
  if (kind === "correction" && note.length < 2) return c.json({ error: "Please write what should be corrected.", code: "note-needed" }, 400);
  const mine = (await c.db.prepare("SELECT id, kind, status, created_ms, due_ms FROM data_request WHERE eid=? AND pid=?").bind(c.eid, s.pid).all<any>()).results ?? [];
  const open = mine.find((r: any) => r.kind === kind && r.status === "open");
  if (open) return c.json({ ok: true, again: true, id: open.id, kind, status: "open", promiseDays: PROMISE_DAYS, promise: PROMISE_TEXT, receivedMs: open.created_ms, answerByMs: open.due_ms, message: `We already have your request. You will have your answer ${PROMISE_TEXT}.` });
  if (mine.length >= MAX_REQUESTS_PER_PLAYER) return c.json({ error: "You have already sent several requests for this game. Please wait for our answer.", code: "too-many" }, 429);
  if (!(await c.spend(6))) return c.json({ error: "It is busy right now. Please try again in a few minutes.", code: "busy" }, 503);
  const id = "dr_" + randHex(8), due = c.now + PROMISE_DAYS * 86_400_000;
  const held = kind === "access" ? await heldAbout(c, s) : undefined; // read BEFORE anything is deleted
  const p = await c.db.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(c.eid, s.pid).first<{ pii: string | null }>();
  const name = kind === "erasure" ? "" : (await openPii(c.env as any, p?.pii))?.name ?? "";
  const erased = kind === "erasure";
  await c.db.prepare("INSERT INTO data_request(id,eid,pid,kind,note,created_ms,due_ms,status,done_ms) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, c.eid, s.pid, kind, note || null, c.now, due, erased ? "done" : "open", erased ? c.now : null).run();
  if (erased) await takeOut(c, s);
  await mailBoth(c, id, kind, s, name, note, due, erased);
  return c.json({
    ok: true, id, kind, status: erased ? "done" : "open", promiseDays: PROMISE_DAYS, promise: PROMISE_TEXT, receivedMs: c.now, answerByMs: due, ...(held ? { held } : {}), ...(erased ? { erased: true } : {}),
    message: erased ? "Done. Your name and your place were deleted just now. We told the organizer." : kind === "nomination" ? `We have your request. To name the person, please write to ${BRAND.support} with their name and how to reach them. You will have your answer ${PROMISE_TEXT}, by ${istDay(due)}.` : `We have your request. You will have your answer ${PROMISE_TEXT}, by ${istDay(due)}.`,
  });
}
