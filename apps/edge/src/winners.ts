// Winners are decided by the software, never by a person.
//   - Every phone works out the winners from the public numbers and the public seat list, and reports them here (`vote`).
//   - A result is accepted only when `quorumFor(people)` DIFFERENT phones (one card per phone) reported exactly the same winners. The organizer, co-host and AI have no way to
//     post, change or remove a winner.
//   - Each accepted winner gets a prize record: the winner confirms their name and mobile number on their own phone after the game (every change is kept as an audit trail and
//     shown to the organizer / co-host), and the organizer / co-host ticks "prize given" with the date.
//   - Every call the organizer's external AI makes is written to an audit trail with where it came from.
import { keysInPlay, linesFor, quorumFor } from "../../../packages/beacon/src/config";
import { seatOfPid } from "../../../packages/beacon/src/unique-ticket";
import { openPii, openText, sealPii, sealText, type PiiEnv } from "./pii";
import { cfgOfRow, recordWinners } from "./lifecycle";
import { checkinRequired, deviceMatches } from "./checkin";
import type { D1, Env } from "./worker";
import { cleanPhone, keptFromClean, keptPhone } from "./phonekit";

export const WINNERS_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS rvote (eid TEXT NOT NULL, round INTEGER NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL, seat INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY (eid, round, pattern, ordinal, seat))`,
  `CREATE TABLE IF NOT EXISTS rcand (eid TEXT NOT NULL, round INTEGER NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL, digest TEXT NOT NULL, idx INTEGER NOT NULL, pids TEXT NOT NULL, PRIMARY KEY (eid, round, pattern, ordinal, digest))`,
  `CREATE TABLE IF NOT EXISTS prize (eid TEXT NOT NULL, round INTEGER NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL, seat INTEGER NOT NULL, pii TEXT, orig TEXT, trail TEXT, confirmed_ms INTEGER, given_ms INTEGER, given_by TEXT, PRIMARY KEY (eid, round, pattern, ordinal, seat))`,
  `CREATE TABLE IF NOT EXISTS ai_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT NOT NULL, eid TEXT, at_ms INTEGER NOT NULL, key_id TEXT, method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER, ip TEXT, ua TEXT, country TEXT)`,
  // one card per phone per engagement: finding a phone's seat must not read the whole seat list (a free database counts rows read)
  `CREATE INDEX IF NOT EXISTS seat_dev ON seat (eid, dev)`,
];

type Spend = (env: Env, now: number, n?: number) => Promise<boolean>;
type Json = (o: unknown, s?: number) => Response;
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const PID = /^[0-9]{1,6}x[0-9a-f]{12}$/;
const cleanName = (n: unknown) => (typeof n === "string" ? n.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) : "");

/** A phone reports the winners it worked out. Several different phones must report exactly the same before the result is accepted. */
export async function acceptVotes(env: Env & PiiEnv, e: any, eid: string, b: any, now: number, json: Json, spend: Spend): Promise<Response> {
  const seat = typeof b?.pid === "string" ? seatOfPid(b.pid) : null;
  if (!b || seat === null || !Array.isArray(b.results) || b.results.length < 1 || b.results.length > 3) return json({ error: "Bad report." }, 400);
  const who = await env.DB.prepare("SELECT 1 AS x FROM participant WHERE eid=? AND pid=?").bind(eid, b.pid).first();
  if (!who) return json({ error: "Not a participant of this game." }, 403);
  if (!(await deviceMatches(env, eid, b.pid, b.device))) return json({ error: "This place belongs to another phone.", code: "other-phone" }, 403); // the participant id is public: a report counts only from the phone that holds the card, so strangers cannot invent a result
  const cfg = cfgOfRow(e), valid = new Set<string>(keysInPlay(cfg.rewards)), luckyCount = cfg.breaks.filter((x) => x.kind === "lucky").length;
  const people = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 1;
  const need = quorumFor(people);
  let accepted = 0, counted = 0; const done: string[] = [];
  for (const x of b.results) {
    const lucky = x?.pattern === "lucky";
    if ((!lucky && !valid.has(x?.pattern)) || (lucky && (!Number.isInteger(x?.ordinal) || x.ordinal < 1 || x.ordinal > luckyCount)) || !Number.isInteger(x?.ordinal) || x.ordinal < 1 || (!lucky && !linesFor(cfg.rewards, x.pattern).some((l) => l.ordinal === x.ordinal))
      || !Number.isInteger(x?.round) || x.round < 1 || x.round > cfg.rounds || (lucky && x.round !== 1) || !Number.isInteger(x?.idx) || x.idx < 0 || x.idx > 74
      || !Array.isArray(x?.pids) || x.pids.length < 1 || x.pids.length > (lucky ? 10 : 500) || x.pids.some((p: unknown) => typeof p !== "string" || !PID.test(p))) continue;
    if (await env.DB.prepare("SELECT 1 AS x FROM settled WHERE eid=? AND round=? AND pattern=? AND ordinal=?").bind(eid, x.round, x.pattern, x.ordinal).first()) { done.push(`${x.round}:${x.pattern}:${x.ordinal}`); continue; }
    const pids: string[] = [...new Set<string>(x.pids)].sort();
    const digest = (await sha(JSON.stringify([x.pattern, x.ordinal, x.round, x.idx, pids]))).slice(0, 32);
    if (!(await spend(env, now, 3))) return json({ error: "Busy day. Your report is kept on your phone and will be sent again.", counted }, 503);
    const v = await env.DB.prepare("INSERT OR IGNORE INTO rvote(eid,round,pattern,ordinal,seat,digest) VALUES(?,?,?,?,?,?)").bind(eid, x.round, x.pattern, x.ordinal, seat, digest).run();
    if (!(v.meta?.changes ?? 0)) continue; // this phone already reported this prize
    counted++;
    await env.DB.prepare("INSERT OR IGNORE INTO rcand(eid,round,pattern,ordinal,digest,idx,pids) VALUES(?,?,?,?,?,?,?)").bind(eid, x.round, x.pattern, x.ordinal, digest, x.idx, JSON.stringify(pids)).run();
    const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM rvote WHERE eid=? AND round=? AND pattern=? AND ordinal=? AND digest=?").bind(eid, x.round, x.pattern, x.ordinal, digest).first<{ c: number }>())?.c ?? 0;
    if (n < need) continue;
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO settled(eid,pattern,ordinal,round,idx,pids) VALUES(?,?,?,?,?,?)").bind(eid, x.pattern, x.ordinal, x.round, x.idx, JSON.stringify(pids.slice(0, 500))).run();
    if (!(ins.meta?.changes ?? 0)) continue;
    accepted++;
    await recordWinners(env, e, eid, [{ pattern: x.pattern, ordinal: x.ordinal, round: x.round, idx: x.idx, pids }], now, "phones");
    await makePrizeRows(env, eid, x.round, x.pattern, x.ordinal, pids.slice(0, 100));
  }
  return json({ ok: true, counted, accepted, done, need });
}

/** One record per winning seat, holding the sealed name and number the person joined with (they are asked to confirm it after the game). */
async function makePrizeRows(env: Env, eid: string, round: number, pattern: string, ordinal: number, pids: string[]) {
  try {
    for (const pid of pids) {
      const seat = seatOfPid(pid);
      if (seat === null) continue;
      const row = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(eid, pid).first<{ pii: string | null }>();
      await env.DB.prepare("INSERT OR IGNORE INTO prize(eid,round,pattern,ordinal,seat,pii,orig) VALUES(?,?,?,?,?,?,?)").bind(eid, round, pattern, ordinal, seat, row?.pii ?? null, row?.pii ?? null).run();
    }
  } catch { /* the winner record itself already stands; the prize list is filled the next time */ }
}

/** The winner, on their own phone, confirms (or corrects) the name and mobile number the prize goes to. The phone proves it is the one that holds the card. Every change is kept. */
export async function confirmPrize(env: Env & PiiEnv, eid: string, b: any, now: number, json: Json, spend: Spend): Promise<Response> {
  const seat = typeof b?.pid === "string" ? seatOfPid(b.pid) : null;
  if (!b || seat === null || typeof b.device !== "string" || !/^[0-9a-f]{16,64}$/.test(b.device)) return json({ error: "Bad request." }, 400);
  const dev = (await sha(`dev|${eid}|${b.device}`)).slice(0, 32);
  const mine = await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND pid=? AND dev=?").bind(eid, b.pid, dev).first();
  if (!mine) return json({ error: "This is not the phone that holds this seat." }, 403);
  const rows = (await env.DB.prepare("SELECT round, pattern, ordinal, pii, orig, trail FROM prize WHERE eid=? AND seat=?").bind(eid, seat).all<any>()).results ?? [];
  if (!rows.length) return json({ error: "No reward recorded for this seat." }, 404);
  const name = cleanName(b.name), cur = await openPii(env, rows[0].pii), typed = String(b.phone ?? "").trim() ? cleanPhone(b.phone) : null;
  if (!name) return json({ error: "Please write your name." }, 400);
  if (typed && !typed.ok) return json({ error: typed.why }, 400); // from any country: the page sends +<country code><number>
  // a mobile number is optional (a guest who joined with a name only has none): the prize is handed over by name and seat
  if (false) return json({ error: "Please enter your mobile number." }, 400); // a winner who came in by employee ID may be found by the ID: the number is then welcome, not needed
  if (!(await spend(env, now, rows.length + 1))) return json({ error: "Busy day. Please try again after midnight UTC." }, 503);
  const phone = typed && typed.ok ? keptFromClean(typed.digits) : cur?.phone ?? "";
  const changed = !cur || keptPhone(cur.phone ?? "") !== phone || (cur.name ?? "") !== name;
  const sealed = await sealPii(env, { phone, name, ...(cur?.empId ? { empId: cur.empId } : {}) }); // the employee ID stays with the record
  for (const r of rows) {
    let trail: any[] = []; try { trail = JSON.parse((await openText(env, r.trail)) ?? "[]"); } catch { /* none yet */ }
    if (changed) trail.push({ at: now, name, phone });
    await env.DB.prepare("UPDATE prize SET pii=?, trail=?, confirmed_ms=? WHERE eid=? AND round=? AND pattern=? AND ordinal=? AND seat=?").bind(sealed, await sealText(env, JSON.stringify(trail)), now, eid, r.round, r.pattern, r.ordinal, seat).run();
  }
  return json({ ok: true, changed });
}

/** What a winner's own phone needs: which of its rewards are recorded and the details currently on file (only to the phone that holds the card). */
export async function myPrizes(env: Env & PiiEnv, eid: string, url: URL, json: Json): Promise<Response> {
  const pid = url.searchParams.get("pid") ?? "", device = url.searchParams.get("device") ?? "";
  const seat = seatOfPid(pid);
  if (seat === null || !/^[0-9a-f]{16,64}$/.test(device)) return json({ error: "Bad request." }, 400);
  const dev = (await sha(`dev|${eid}|${device}`)).slice(0, 32);
  if (!(await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND pid=? AND dev=?").bind(eid, pid, dev).first())) return json({ error: "This is not the phone that holds this seat." }, 403);
  const rows = (await env.DB.prepare("SELECT round, pattern, ordinal, pii, confirmed_ms FROM prize WHERE eid=? AND seat=? ORDER BY round, pattern, ordinal").bind(eid, seat).all<any>()).results ?? [];
  const cur = rows.length ? await openPii(env, rows[0].pii) : null;
  return json({ prizes: rows.map((r: any) => ({ round: r.round, pattern: r.pattern, ordinal: r.ordinal })), name: cur?.name ?? "", phone: cur?.phone ?? "", confirmed: rows.some((r: any) => r.confirmed_ms) });
}

/** The organizer's / co-host's list of winners with the details they confirmed, whether anything was changed after the game, and whether the prize has been given. */
/** `outside` = an outside AI is asking: mobile numbers are cut to their last two digits and the change history is left out, so a full number never travels through a chat. */
export async function listPrizes(env: Env & PiiEnv, eid: string, json: Json, outside = false, canOverride = false): Promise<Response> {
  const rows = (await env.DB.prepare("SELECT prize.round AS round, prize.pattern AS pattern, prize.ordinal AS ordinal, prize.seat AS seat, prize.pii AS pii, prize.orig AS orig, prize.trail AS trail, prize.confirmed_ms AS confirmed_ms, prize.given_ms AS given_ms, prize.given_by AS given_by, COALESCE(s.blocked,0) AS removed FROM prize LEFT JOIN seat s ON s.eid=prize.eid AND s.seq=prize.seat WHERE prize.eid=? ORDER BY prize.round, prize.pattern, prize.ordinal, prize.seat LIMIT 400").bind(eid).all<any>()).results ?? [];
  const out = [];
  for (const r of rows) {
    const cur = await openPii(env, r.pii), orig = await openPii(env, r.orig);
    let trail: any[] = []; try { trail = JSON.parse((await openText(env, r.trail)) ?? "[]"); } catch { /* none */ }
    const hide = (ph: string | undefined) => (outside ? (ph ? "XXXXXXXX" + ph.slice(-2) : "") : ph ?? "");
    if (outside) out.push({ round: r.round, pattern: r.pattern, ordinal: r.ordinal, seat: r.seat, confirmed: !!r.confirmed_ms, changed: trail.length > 0, given: !!r.given_ms, givenMs: r.given_ms ?? null, givenBy: r.given_by ?? null, ...(r.removed ? { notGiven: "removed" } : {}) });
    else out.push({ round: r.round, pattern: r.pattern, ordinal: r.ordinal, seat: r.seat, name: cur?.name ?? "", phone: cur?.phone ?? "", ...(cur?.empId ? { empId: cur.empId } : {}), confirmed: !!r.confirmed_ms, confirmedMs: r.confirmed_ms ?? null,
      changed: trail.length > 0, joinedWithName: orig?.name ?? "", joinedWithPhone: orig?.phone ?? "", trail, given: !!r.given_ms, givenMs: r.given_ms ?? null, givenBy: r.given_by ?? null, ...(r.removed ? { notGiven: "removed" } : {}) }); // a person removed during the game keeps the win, but the prize is not given
  }
  if (canOverride && !outside) { // the organizer has the final say: each row tells which tickets claimed this prize, so the console can offer them as choices
    const cl = (await env.DB.prepare("SELECT DISTINCT round, pattern, pid FROM claim WHERE eid=? LIMIT 3000").bind(eid).all<{ round: number; pattern: string; pid: string }>()).results ?? [];
    for (const o of out as any[]) { o.canOverride = true; o.claimants = cl.filter((c) => c.round === o.round && c.pattern === o.pattern).slice(0, 60).map((c) => { const s = seatOfPid(c.pid); return { seat: s, label: s === null ? c.pid : "Card " + String(s).padStart(4, "0") }; }).filter((c) => c.seat !== null); }
  }
  return json({ prizes: out });
}

/** The organizer / co-host ticks "prize given" (with the date) or takes the tick back. */
export async function markGiven(env: Env, eid: string, b: any, kind: string | null, now: number, json: Json, spend: Spend): Promise<Response> {
  if (!b || !Number.isInteger(b.round) || !Number.isInteger(b.ordinal) || !Number.isInteger(b.seat) || typeof b.pattern !== "string" || typeof b.given !== "boolean") return json({ error: "Bad request." }, 400);
  if (b.given && (await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND seq=? AND blocked=1").bind(eid, b.seat).first())) return json({ error: "Not given: this person was removed from the game.", code: "removed" }, 409);
  if (!(await spend(env, now))) return json({ error: "Busy day. Please try again after midnight UTC." }, 503);
  const r = await env.DB.prepare("UPDATE prize SET given_ms=?, given_by=? WHERE eid=? AND round=? AND pattern=? AND ordinal=? AND seat=?").bind(b.given ? now : null, b.given ? (kind === "host" ? "co-host" : kind === "ai" ? "organizer's AI" : "organizer") : null, eid, b.round, b.pattern, b.ordinal, b.seat).run();
  return (r.meta?.changes ?? 0) > 0 ? json({ ok: true, givenMs: b.given ? now : null }) : json({ error: "No such reward." }, 404);
}

// ---------------------------------------------------------------------------------------------------- the external AI's audit trail
/** Writes one line for a call made with an organizer's AI key: when, which key, what was asked, the answer's status, and where the call came from (network address, program and country). */
export async function auditAi(db: D1, org: string, req: Request, keyId: string, status: number, now: number) {
  try {
    const u = new URL(req.url);
    const m = u.pathname.match(/^\/api\/z\/([A-Za-z0-9_-]{4,40})\//);
    await db.prepare("INSERT INTO ai_audit(org,eid,at_ms,key_id,method,path,status,ip,ua,country) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(org, m ? m[1] : null, now, keyId, req.method, u.pathname.slice(0, 120), status, (req.headers.get("cf-connecting-ip") ?? "").slice(0, 64), (req.headers.get("user-agent") ?? "").slice(0, 200), (req.headers.get("cf-ipcountry") ?? "").slice(0, 8)).run();
  } catch { /* the trail must never break the work */ }
}
export async function listAiAudit(db: D1, org: string | null, json: Json): Promise<Response> {
  const r = org
    ? await db.prepare("SELECT at_ms, eid, key_id, method, path, status, ip, ua, country FROM ai_audit WHERE org=? ORDER BY id DESC LIMIT 300").bind(org).all<any>()
    : await db.prepare("SELECT org, at_ms, eid, key_id, method, path, status, ip, ua, country FROM ai_audit ORDER BY id DESC LIMIT 300").all<any>();
  return json({ trail: r.results ?? [] });
}

/** The organizer (or a Host) has the final say on who receives a prize: the software's result stands unless they change it here. Choose one of the tickets that claimed this prize, or nobody. Every change is kept with who made it and when. */
export async function overridePrize(env: Env & PiiEnv, eid: string, b: any, kind: string | null, now: number, json: Json, spend: Spend): Promise<Response> {
  if (!b || !Number.isInteger(b.round) || b.round < 1 || !Number.isInteger(b.ordinal) || b.ordinal < 1 || typeof b.pattern !== "string" || !/^[a-z0-9]{2,12}$/.test(b.pattern) || !(b.seat === null || (Number.isInteger(b.seat) && b.seat >= 1))) return json({ error: "Choose the prize and who gets it.", code: "bad-override" }, 400);
  const had = (await env.DB.prepare("SELECT seat FROM prize WHERE eid=? AND round=? AND pattern=? AND ordinal=?").bind(eid, b.round, b.pattern, b.ordinal).all<{ seat: number }>()).results ?? [];
  if (!had.length) return json({ error: "That prize has no winner recorded yet, so there is nothing to change.", code: "no-prize" }, 404);
  let pid: string | null = null;
  if (b.seat !== null) {
    const claims = (await env.DB.prepare("SELECT pid FROM claim WHERE eid=? AND round=? AND pattern=? LIMIT 3000").bind(eid, b.round, b.pattern).all<{ pid: string }>()).results ?? [];
    pid = claims.map((c) => c.pid).find((p) => seatOfPid(p) === b.seat) ?? null;
    if (!pid) return json({ error: "Only a card that claimed this prize can be given it.", code: "not-a-claimant" }, 409);
    if (await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND seq=? AND blocked=1").bind(eid, b.seat).first()) return json({ error: "That person was removed from the game.", code: "removed" }, 409);
  }
  if (!(await spend(env, now, 4))) return json({ error: "Busy day. Please try again after midnight UTC." }, 503);
  await env.DB.prepare("DELETE FROM prize WHERE eid=? AND round=? AND pattern=? AND ordinal=?").bind(eid, b.round, b.pattern, b.ordinal).run();
  if (pid) await makePrizeRows(env, eid, b.round, b.pattern, b.ordinal, [pid]);
  try { await env.DB.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`override/${eid}/${b.round}/${b.pattern}/${b.ordinal}/${now}`, JSON.stringify({ by: kind, at: now, from: had.map((h) => h.seat), to: b.seat })).run(); } catch { /* the change itself stands */ }
  return json({ ok: true, seat: b.seat, message: b.seat === null ? "Nobody gets this prize now." : "The prize now goes to the card you chose." });
}
