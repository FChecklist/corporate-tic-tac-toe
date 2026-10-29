// The life of an engagement's personal data. When a game ends (as seen from the public schedule, or sooner when enough phones say so):
//   1. the organizer's report is built from the sealed records and e-mailed as PDF(s), in small steps because a free Worker has ~10 ms of CPU per call;
//   2. the report link stops working 19 hours after the end; 20 hours after the end (we promise 24) every participant's name, number, seat, invite record and card link is deleted, the report's working copies too,
//      and the participants' personal part of the audit log is crypto-shredded (audit.ts `shredParticipantAudit`: its per-engagement key is destroyed, the hash chain still verifies);
//   3. only the organizer / host / co-host details and the winners record (seat, prize, round, time) remain, until 00:00 IST at the end of the 365th day, then everything goes.
// Called by the scheduled job (and, as a fallback, by any outside timer with the platform key). Every call does a bounded amount of work and can be repeated safely.
import { tzOfRow } from "./tz";
import { checkinRequired, deviceMatches, keepWinnerEvidence, prefixEnd } from "./checkin";
import { restoreCreditUses } from "./credit";
import { keepLegalParty } from "./legal";
import { ensureGameRecordTable, keepGameRecord } from "./gamerecord";
import { sweepVisits } from "./visits";
import { closeAuditFor, isHeld, shredParticipantAudit } from "./audit";
import { GRACE_ROUNDS, INVITE_CATEGORIES, PRIZE_HOUSES, validateCfg, keysInPlay, linesFor, type EngagementCfg, type PatternKey } from "../../../packages/beacon/src/config";
import { callRoundR, luckyRound } from "../../../packages/beacon/src/game";
import { cfgOf as controlCfg, readPublished, resolveControl, type KV } from "../../../packages/beacon/src/control";
import { seatOfPid } from "../../../packages/beacon/src/unique-ticket";
import { openPii, openText, sealText, type PiiEnv } from "./pii";
import { layoutReport, layoutPeoplePart, istDate, istFull, emptyAgg, type Agg, type ReportData, type ReportPerson, type ReportPrize, type ReportWinner } from "./report-layout";
import { purgeOutbox, retryOutbox, sendReportMail, type PayEnv } from "./pay";
import { eraseCohostsSql, mailDataDeleted, mailErasureHeadsUp } from "./cancel";
import { creditTick } from "./credit";
import { endBoundTtt } from "./tournament";
import type { D1, Env } from "./worker";

export const GENESIS = 1692803367;
export const roundMs = (r: number) => (GENESIS + (r - 1) * 3) * 1000;
import { PURGE_AFTER_MS, REPORT_LINK_MS, REPORT_AFTER_MS } from "./lifetimes"; // the three clocks of a finished game live in lifetimes.ts, so the words people read use the same numbers
export { PURGE_AFTER_MS, REPORT_LINK_MS, REPORT_AFTER_MS };
export const UNPLAYED_WARN_MS = 6 * 3_600_000;       // the heads-up e-mail for a game that did not start goes out this long before its guests' data is erased
export const SETTINGS_KEEP_MS = 30 * 86_400_000;      // the settings of a game that did not start (occasion, prizes, brand...) stay this long after it closed, so the Organizer can reuse them
export const PAID_WINDOW_MS = 365 * 86_400_000;      // a PAID game can be set to any date within this long from the day of payment
export const MAX_AHEAD_MS = 30 * 86_400_000;          // a game time can be set at most this far ahead
const IST = 5.5 * 3_600_000, DAY = 86_400_000;
const CHUNK = 250;                                  // people opened per call while preparing a report (keeps a call within a free Worker's CPU)
const PART = 1500;                                  // people per PDF; a bigger game is e-mailed as several parts
const NAMES: Record<string, string> = Object.fromEntries(PRIZE_HOUSES.map((h) => [h.id, h.label]));
const ord = (n: number) => ["", "1st", "2nd", "3rd"][n] ?? `${n}th`;

type LifeEnv = Env & PiiEnv & PayEnv;
const d1kv = (env: Env): KV => ({
  get: async (k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? null,
  put: async (k, v) => { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run(); },
});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** 00:00 IST at the end of the 365th day after the game ended: when everything about the engagement is deleted. */
export const fullDeleteAt = (endMs: number): number => { const t = endMs + 365 * DAY; const istDay = Math.floor((t + IST) / DAY); return (istDay + 1) * DAY - IST; };
export const personalDeleteAt = (endMs: number) => endMs + PURGE_AFTER_MS;
export const reportLinkUntil = (endMs: number) => endMs + REPORT_LINK_MS;

export function cfgOfRow(e: { tickets?: number; config?: string | null }): EngagementCfg {
  try { const j = e.config ? JSON.parse(e.config) : {}; const v = validateCfg({ tickets: e.tickets ?? 1, rewards: j.rewards, breaks: j.breaks, rounds: j.rounds, invites: j.invites, mark: j.mark, join: j.join, tz: j.tz, verify: j.verify, employeesOnly: j.employeesOnly }, undefined, { stored: true }); if (v.ok) return v.cfg; } catch { /* plain defaults */ }
  return (validateCfg({}) as { ok: true; cfg: EngagementCfg }).cfg;
}

/** The engagement's calls on the clock: the organizer's pauses and stop applied, the brand breaks and rounds included. */
async function schedule(env: Env, e: any) {
  const f = await readPublished(d1kv(env), e.id);
  const st = f ? resolveControl(controlCfg(f), f.messages) : null;
  return { cfg: cfgOfRow(e), st, start: e.start_round + GRACE_ROUNDS, stride: e.call_seconds / 3 };
}
async function callTimeMs(env: Env, e: any, round: number, idx: number, sch?: Awaited<ReturnType<typeof schedule>>): Promise<number | null> {
  const s = sch ?? (await schedule(env, e));
  const r = callRoundR(s.st, s.start, s.stride, s.cfg.breaks, round, idx);
  return r === null ? null : roundMs(r);
}
/** When the game will have ended if nobody ends it sooner: the moment the tournament finished (plus a minute), or a fixed time after its scheduled start (tournament.ts, endBoundTtt). */
export async function endBoundMs(env: Env, e: any): Promise<number> {
  const t = await env.DB.prepare("SELECT ended_ms FROM ttt_t WHERE eid=?").bind(e.id).first<{ ended_ms: number | null }>();
  return endBoundTtt(roundMs(e.start_round), t);
}

/** When this game's guest data will be (or was) erased: 20 hours after it ended, after it was cancelled, or, for a game nobody paid for, after it was meant to end. Follows the newest schedule. */
export async function erasureOf(env: Env, e: any): Promise<number> {
  if (e.cancelled_ms) return personalDeleteAt(e.cancelled_ms);
  if (e.pack !== 0) { const l = await env.DB.prepare("SELECT end_ms, end_src FROM life WHERE eid=?").bind(e.id).first<{ end_ms: number; end_src: string }>(); if (l && l.end_src === "phones") return personalDeleteAt(l.end_ms); }
  return personalDeleteAt(await endBoundMs(env, e));
}

// ------------------------------------------------------------------------------------------------ winners record
const lineLabel = (cfg: EngagementCfg, key: PatternKey, ordinal: number) => (linesFor(cfg.rewards, key).length > 1 ? ord(ordinal) + " " : "") + (NAMES[key] ?? key);

/** Called when the organizer's console publishes results: the winners record gets one row per winning seat (never a name or a number). */
export async function recordWinners(env: Env, e: any, eid: string, results: { pattern: string; ordinal?: number; round?: number; idx: number; pids: string[] }[], now: number, src = "console"): Promise<void> {
  try {
    const sch = await schedule(env, e);
    for (const x of results) {
      const round = x.round ?? 1, ordinal = x.ordinal ?? 1;
      let at: number | null;
      if (x.pattern === "lucky") { const b = sch.cfg.breaks.filter((k) => k.kind === "lucky")[ordinal - 1]; const r = b ? luckyRound(sch.st, sch.start, sch.stride, sch.cfg.breaks, b) : null; at = r === null ? null : roundMs(r); }
      else at = await callTimeMs(env, e, round, x.idx, sch);
      const seats = x.pids.slice(0, 100).map(seatOfPid).filter((s): s is number => s !== null);
      for (const seat of seats) await env.DB.prepare("INSERT INTO winner(eid,round,pattern,ordinal,seat,idx,at_ms,src) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(eid,round,pattern,ordinal,seat) DO UPDATE SET idx=excluded.idx, at_ms=excluded.at_ms, src=excluded.src").bind(eid, round, x.pattern, ordinal, seat, x.idx, at, src).run();
      // a later result for the same prize replaces an earlier one: seats that no longer win it are removed
      const keep = seats.length ? seats.map(() => "?").join(",") : "-1";
      await env.DB.prepare(`DELETE FROM winner WHERE eid=? AND round=? AND pattern=? AND ordinal=? AND src=? AND seat NOT IN (${keep})`).bind(eid, round, x.pattern, ordinal, src, ...seats).run();
    }
    // a person who no longer wins any prize keeps no check-in evidence: it goes with everyone else's within 24 hours
    const still = new Set(((await env.DB.prepare("SELECT DISTINCT seat FROM winner WHERE eid=?").bind(eid).all<{ seat: number }>()).results ?? []).map((r) => Number(r.seat)));
    const evid = (await env.DB.prepare("SELECT k FROM kv WHERE k >= ? AND k < ?").bind(`wev/${eid}/`, prefixEnd(`wev/${eid}/`)).all<{ k: string }>()).results ?? [];
    for (const r of evid) if (!still.has(Number(r.k.split("/")[2]))) await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(r.k).run();
  } catch { /* the winners record is best effort here: phones report their own wins too */ }
}

/** A phone reporting a win of its own (so a game without an open console still has a winners record). Console-checked results always win over these. */
export async function acceptWon(_env: Env, _e: any, _eid: string, _b: any, _now: number, jsonFn: (o: unknown, s?: number) => Response, _spend: (env: Env, now: number, n?: number) => Promise<boolean>): Promise<Response> {
  return jsonFn({ ok: true, stored: 0 }); // kept so phones that still have the older page open get a clean answer; a phone's own word about a win is no longer recorded: results come only from several phones agreeing (see winners.ts)
}

/** A phone saying "the game is over for me". Several different phones must say so, and not before the game could plausibly be over, so one person cannot trigger the report and the deletion. */
export async function acceptOver(env: Env, e: any, eid: string, b: any, now: number, jsonFn: (o: unknown, s?: number) => Response, spend: (env: Env, now: number, n?: number) => Promise<boolean>): Promise<Response> {
  const seat = typeof b?.pid === "string" ? seatOfPid(b.pid) : null;
  if (!b || seat === null) return jsonFn({ error: "Bad report." }, 400);
  const who = await env.DB.prepare("SELECT 1 AS x FROM participant WHERE eid=? AND pid=?").bind(eid, b.pid).first();
  if (!who) return jsonFn({ error: "Not a participant of this game." }, 403);
  if (!(await deviceMatches(env, eid, b.pid, b.device))) return jsonFn({ error: "This place belongs to another phone.", code: "other-phone" }, 403); // the participant id is public: only the phone that holds the card can say the game is over
  const earliest = roundMs(e.start_round + GRACE_ROUNDS) + 20 * e.call_seconds * 1000; // no game ends before 20 numbers
  if (now < earliest) return jsonFn({ ok: true, counted: false });
  if (!(await spend(env, now, 1))) return jsonFn({ error: "Busy day. Please try again after midnight UTC." }, 503);
  await env.DB.prepare("INSERT OR IGNORE INTO overvote(eid,seat,at_ms) VALUES(?,?,?)").bind(eid, seat, now).run();
  const votes = (await env.DB.prepare("SELECT COUNT(*) AS c FROM overvote WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
  const people = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 1;
  if (votes >= Math.min(3, Math.max(1, Math.ceil(people / 2)))) {
    const bound = await endBoundMs(env, e);
    const end = Math.min(now, bound);
    await env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.end_src<>'phones' AND life.purged_ms IS NULL").bind(eid, end).run();
  }
  return jsonFn({ ok: true, counted: true });
}

// ------------------------------------------------------------------------------------------------ deletion
/** Deletes every participant's name, number, seat, invite record, card link and working copy of the report, and crypto-shreds the participants' personal part of the audit log (unless the owner set a legal hold). The winners record (seat numbers), the match results (player codes, no names), the organizer's details and the engagement itself stay. */
export async function erasePersonal(env: Env, eid: string, now: number, by: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM claim WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM settled WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM rvote WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM rcand WHERE eid=?").bind(eid),
    env.DB.prepare("DELETE FROM participant WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM ttt_p WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM consent_log WHERE kind='K4' AND ref=?").bind(eid), env.DB.prepare("DELETE FROM seat WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM person WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM waiting WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM overvote WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM data_request WHERE eid=?").bind(eid), // players' data requests (rights.ts) go with the people they are about
    env.DB.prepare("DELETE FROM ttt_e WHERE eid=?").bind(eid), env.DB.prepare("UPDATE ttt_t SET ranking=NULL WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM ttt_mv WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM ttt_r WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM ttt_f WHERE eid=?").bind(eid), env.DB.prepare("DELETE FROM ttt_x WHERE eid=?").bind(eid), // the display names of the tournament go with the other personal data
    env.DB.prepare("DELETE FROM kv WHERE k=? OR k=? OR k=? OR k=? OR (k >= ? AND k < ?) OR k=?").bind(`seats-base/${eid}`, `rpt/${eid}`, `rptopen/${eid}`, `rptremind/${eid}`, `rptc/${eid}/`, prefixEnd(`rptc/${eid}/`), `seats-blk/${eid}`),
    env.DB.prepare("DELETE FROM kv WHERE (k >= ? AND k < ?) OR (k >= ? AND k < ?) OR (k >= ? AND k < ?)").bind(`present/${eid}/`, prefixEnd(`present/${eid}/`), `ckfail/${eid}/`, prefixEnd(`ckfail/${eid}/`), `idx/${eid}/`, prefixEnd(`idx/${eid}/`)), // the check-in records of every participant go with their data (the winners' evidence, wev/, stays with the winners record for 365 days)
    env.DB.prepare(eraseCohostsSql).bind(eid), // the game's Co-hosts: name, mobile number and key go with the participants' data
    env.DB.prepare("INSERT INTO life(eid,end_ms,end_src,purged_ms,report_state) VALUES(?,?, 'organizer', ?, ?) ON CONFLICT(eid) DO UPDATE SET purged_ms=?, report_state=COALESCE(life.report_state, ?)").bind(eid, now, now, by, now, by),
  ]);
  await shredParticipantAudit(env as any, eid, now); // best effort inside: a held engagement keeps its log until the hold is lifted, then the tick shreds it
}
/** Everything about an engagement, at the end of its 365 days (or for a draft nobody published). */
export async function eraseEverything(env: Env, id: string, now = Date.now()): Promise<void> {
  if (!(await closeAuditFor(env as any, id, now))) return; // a legal hold: nothing of this engagement is deleted until it is lifted
  try { if ((await env.DB.prepare("SELECT pack FROM engagement WHERE id=?").bind(id).first<{ pack: number }>())?.pack === 0) await restoreCreditUses(env.DB, id, now); } catch { /* credit stays where it is; the next try repeats */ } // credit applied to a game that is forgotten goes back to the account
  await erasePersonal(env, id, now, "retention");
  await deleteEngagementRows(env, id);
}
/** TEST-mode clean-up (test-data.ts): everything about an engagement, EXCEPT the append-only internal audit log and its certificates, and without a legal-hold check (test data is never held). */
export async function purgeTestEngagement(env: Env, id: string, now = Date.now()): Promise<void> {
  await erasePersonal(env, id, now, "test-purge");
  await deleteEngagementRows(env, id);
  try { await env.DB.prepare("DELETE FROM game_record WHERE eid=?").bind(id).run(); } catch { /* no record table yet */ } // a purged TEST game leaves no settings record (real games keep theirs for ever)
}
async function deleteEngagementRows(env: Env, id: string): Promise<void> {
  { const eg = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(id).first<any>(); if (eg) await keepGameRecord(env.DB, eg, Date.now()); } // the settings of the game are kept for ever (no personal data in them): written one last time before the game's own rows go
  await keepLegalParty(env.DB, id, Date.now()); // the law keeps payments, invoices, the organizer's invoice details and who paid, for ever: copy them out before the game's own rows go
  await env.DB.batch([
    env.DB.prepare("DELETE FROM winner WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM ttt_m WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM ttt_t WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM ttt_b WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM ttt_z WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM kv WHERE k >= ? AND k < ?").bind(`wev/${id}/`, prefixEnd(`wev/${id}/`)), env.DB.prepare("DELETE FROM prize WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM life WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM data_request WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM cbl_request WHERE eid=?").bind(id),
    env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`control/${id}.json`), env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`rptsalt/${id}`), env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`contact/${id}`), env.DB.prepare("DELETE FROM kv WHERE k IN (?,?,?,?,?)").bind(`pub/${id}`, `lockmail/${id}`, `remind/${id}`, `ann/${id}`, `paidby/${id}`),
    env.DB.prepare("DELETE FROM organizer_key WHERE eid=? AND kind='cohost'").bind(id), env.DB.prepare("DELETE FROM shred WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM eng_key WHERE eid=?").bind(id), env.DB.prepare("DELETE FROM audit_pii WHERE eid=?").bind(id), // erasePersonal above wrote a fresh shred marker
    env.DB.prepare("DELETE FROM engagement WHERE id=?").bind(id),
  ]);
}

// ------------------------------------------------------------------------------------------------ the report
interface RptState { agg: Agg; inv: Record<number, number>; stage: "prep" | "send" | "done"; next: number; total: number; chunks: number; sentParts: number; tl: { callNo: number; atMs: number; present: number; late: number }[]; started: number }

const attach = (name: string, bytes: Uint8Array) => ({ filename: name, content: bytes });

/** One bounded step of the report. Returns true when the whole report has been sent. */
async function reportStep(env: LifeEnv, e: any, life: { end_ms: number }, now: number): Promise<boolean> {
  const eid = e.id as string, stKey = `rpt/${eid}`;
  const contact = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${eid}`).first<{ v: string }>();
  const email = contact ? (JSON.parse(contact.v).email as string) : null;
  if (!email) { await env.DB.prepare("UPDATE life SET report_state='no-email' WHERE eid=?").bind(eid).run(); return true; }
  const sch = await schedule(env, e);
  let st: RptState = JSON.parse((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(stKey).first<{ v: string }>())?.v ?? "null") ?? { stage: "prep", next: 0, total: (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())!.c, chunks: 0, sentParts: 0, started: now, tl: [], agg: emptyAgg(), inv: {} };
  const save = () => env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(stKey, JSON.stringify(st)).run();
  const ckey = (i: number) => `rptc/${eid}/${i}`;

  if (st.stage === "prep") {
    if (!st.tl.length) { // the call numbers at which we count people present
      const nums = [0, 8, 16, 24, 32, 40, 48, 56, 64, 74];
      for (const callNo of nums) st.tl.push({ callNo, atMs: (await callTimeMs(env, e, 1, callNo, sch)) ?? 0, present: 0, late: 0 });
    }
    if (st.next < st.total) {
      const rows = (await env.DB.prepare("SELECT p.pid AS pid, p.pii AS pii, p.joined_ms AS joined_ms, s.seq AS seq, COALESCE(s.jr,0) AS jr, s.role AS role, s.inv AS inv, s.dev AS dev, s.src AS src, pe.inviter AS via, pe.approved_by AS appr, pe.removed_ms AS rmv FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid LEFT JOIN person pe ON pe.eid=p.eid AND pe.ph=p.phone_hash WHERE p.eid=? ORDER BY COALESCE(s.seq, 1000000), p.pid LIMIT ? OFFSET ?").bind(eid, CHUNK, st.next).all<any>()).results ?? [];
      const people: ReportPerson[] = [];
      const keyLabels = new Map<string, string>(); // who is "Host Asha" / "Co-host Ravi" in the who-invited-whom tree
      for (const k of (await env.DB.prepare("SELECT substr(hash,1,7) AS h, kind, label FROM organizer_key WHERE org=? AND kind IN ('host','cohost')").bind(e.org).all<any>()).results ?? []) keyLabels.set((k.kind === "host" ? "h:" : "c:") + k.h, `${k.kind === "host" ? "Host" : "Co-host"}${k.label ? " " + k.label : ""}`);
      const labelOf = (id: string | null | undefined): string | null => (!id ? null : id === "o" ? "Organizer" : id.startsWith("s:") ? null : keyLabels.get(id) ?? (id.startsWith("h:") ? "Host" : "Co-host"));
      for (const r of rows) {
        const o = await openPii(env, r.pii);
        const joined = r.seq === null || r.dev !== null;
        people.push({ seat: r.seq ?? null, name: o?.name ?? null, phone: o?.phone ?? null, joinedMs: r.joined_ms ?? null, late: r.jr > 0, role: r.role ?? null, invitedBy: r.inv ?? null, onRoster: r.src === "roster" || r.src === "reuse" || r.src === "list", joined, via: labelOf(r.via), admittedBy: r.appr ? labelOf(r.appr) : null, removed: !!r.rmv });
        if (joined) for (const t of st.tl) if ((r.joined_ms ?? 0) <= t.atMs) { t.present++; if (r.jr > 0) t.late++; }
        const g = st.agg; // totals for the summary, kept as we go so a big game's summary needs no second look at the people
        if (joined) { g.joined++; if (r.jr > 0) g.late++; else { g.joinedInTime++; if (r.joined_ms && (g.firstJoinMs === null || r.joined_ms < g.firstJoinMs)) g.firstJoinMs = r.joined_ms; } }
        if (r.src === "roster" || r.src === "reuse") { g.onRoster++; if (!joined) g.notJoined++; }
        if (r.inv) { g.viaInvite++; st.inv[r.inv] = (st.inv[r.inv] ?? 0) + 1; }
        if (r.role) g.roles++;
      }
      await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(ckey(st.chunks), await sealText(env, JSON.stringify(people))).run();
      st.chunks++; st.next += rows.length;
      { const ks = Object.entries(st.inv); st.agg.inviters = ks.length; const top = ks.sort((x, y) => y[1] - x[1])[0]; st.agg.topInviter = top ? [Number(top[0]), top[1]] : null; }
      if (!rows.length) st.next = st.total; // the list shrank: nothing more to read
      await save();
      return false;
    }
    st.stage = "send"; await save();
  }

  if (st.stage === "send") {
    // The PDF is not made here: the e-mail carries a link, the organizer's own browser fetches the data in small pieces and lays the PDF out on their device.
    const cfg = sch.cfg, endMs = life.end_ms, first = roundMs(sch.start);
    const base = await baseData(env, e, cfg, sch, st, email, now, endMs, first);
    const link = await reportLink(env, eid);
    const ok = await sendReportMail(env, email, `Your Corporate Tic Tac Toe game report ${eid}: open it before ${istFull(reportLinkUntil(endMs), cfg.tz)}`, bodyFor(eid, base, link), []);
    if (!ok) return false; // try again at the next call
    st.stage = "done"; await save(); return true;
  }
  return st.stage === "done";
}

const bodyFor = (eid: string, d: ReportData, link: string) => [
  `Hello,`, ``,
  `Your game ${eid} has ended. Your complete report is ready: when the tournament started and ended, the format and the move clock, how many people took part, every prize and who won it, the invite tree, all statistics, and the name and mobile number of every participant.`, ``,
  `Open it here (the PDF is built on your own computer or phone, so this link is all we send):`,
  link, ``,
  `The link works until ${istFull(reportLinkUntil(d.endMs))}; the participants' details are permanently deleted at ${istFull(d.personalDeleteAtMs)}, as promised. Please open it and save the PDF before then: it is the only copy of this data once ours is deleted. You can share the link with your co-host; anyone who has it can read the report, so share it carefully.`, ``,
  `What happens to the data:`,
  `- By ${istFull(d.personalDeleteAtMs)} (within 24 hours of the game ending) we permanently delete every participant's name, mobile number, seat, join record and invite record from our systems.`,
  `- For 365 days we keep only: the organizer, host and co-host details, the log of what your AI assistant did, and the results (the final places as seat numbers and the match results by player code, without names or mobile numbers).`,
  `- Everything about this game is deleted at 00:00 hours IST on ${istDate(d.fullDeleteAtMs)} (the end of the 365th day). We keep billing data for audit and tax reasons.`,
  ``,
  `The winners were worked out by the software from the public numbers and accepted only when several different phones agreed. You cannot choose or change a winner or a number, and neither can we.`, ``,
  `You can ask us to delete everything sooner: press Erase in your console, ask your AI assistant to request it (you confirm in your console), or reply to this e-mail from your registered address.`, ``,
  `Corporate Tic Tac Toe is built to follow India's DPDP Act, the EU and UK GDPR and US privacy laws (including CCPA / CPRA): we collect only what is needed to run your game, protect it with encryption, keep it for the shortest time we can, never sell it, and honour every request to see, correct or delete data.`, ``,
  `Sent on ${istFull(d.sentAtMs)} to ${d.organizerEmail}.`,
].join("\n");

/** The report's link carries a key that only this engagement can have (derived from a server secret): whoever holds the link can open the report until the personal data is deleted. */
async function reportKey(env: LifeEnv, eid: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(`report|${env.DATA_KEY ?? env.ORGANIZER_SECRET ?? "unset"}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const salt = (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`rptsalt/${eid}`).first<{ v: string }>())?.v ?? ""; // the organizer can replace the link: a new salt makes every older link useless
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(salt ? `${eid}|${salt}` : eid))), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
export async function reportLink(env: LifeEnv, eid: string): Promise<string> {
  return `${((env as any).PUBLIC_ORIGIN ?? "https://tictactoe.corporatetambola.com").replace(/\/$/, "")}/report.html?e=${encodeURIComponent(eid)}&k=${await reportKey(env, eid)}`;
}
/** What the report page asks for: `base` (everything except the people) and `people` (250 at a time). Valid only with the engagement's key, and only while the personal data still exists. */
export async function reportApi(env: LifeEnv, eid: string, url: URL, now = Date.now()): Promise<Response> {
  if ((url.searchParams.get("k") ?? "") !== (await reportKey(env, eid))) return json({ error: "This report link is not valid." }, 403);
  const e = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(eid).first<any>();
  const life = await env.DB.prepare("SELECT * FROM life WHERE eid=?").bind(eid).first<any>();
  const st: RptState | null = JSON.parse((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`rpt/${eid}`).first<{ v: string }>())?.v ?? "null");
  if (!e || !life || !st || (st.stage !== "send" && st.stage !== "done") || now >= reportLinkUntil(life.end_ms)) return json({ error: "This report is not ready, or the link has closed and the participants' details are being or have been deleted (that happens within 24 hours of the game ending, as promised).", code: "gone" }, 404);
  await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`rptopen/${eid}`, String(now)).run();
  const part = url.searchParams.get("part");
  if (part === "people") {
    const i = Number(url.searchParams.get("i"));
    if (!Number.isInteger(i) || i < 0 || i >= st.chunks) return json({ people: [] });
    const t = await openText(env, (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`rptc/${eid}/${i}`).first<{ v: string }>())?.v);
    return json({ people: t ? (JSON.parse(t) as ReportPerson[]) : [] });
  }
  const sch = await schedule(env, e);
  const contact = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${eid}`).first<{ v: string }>();
  const email = contact ? (JSON.parse(contact.v).email as string) : "";
  const base = await baseData(env, e, sch.cfg, sch, st, email, now, life.end_ms, roundMs(sch.start));
  return json({ base, totalPeople: st.total, chunks: st.chunks, chunkSize: CHUNK, partSize: PART });
}

async function attachNames(_env: LifeEnv, _d: ReportData, _people: ReportPerson[]) { /* names are already inside the sealed chunks */ }

async function baseData(env: LifeEnv, e: any, cfg: EngagementCfg, sch: Awaited<ReturnType<typeof schedule>>, st: RptState, email: string, sentAt: number, endMs: number, first: number): Promise<ReportData> {
  const eid = e.id as string;
  const wrows = (await env.DB.prepare("SELECT round, pattern, ordinal, seat, idx, at_ms, src FROM winner WHERE eid=? ORDER BY round, pattern, ordinal, seat").bind(eid).all<any>()).results ?? [];
  const seatInfo = new Map<number, { name: string | null; phone: string | null; role: string | null }>();
  for (const sNo of new Set(wrows.map((w: any) => w.seat as number))) {
    const r = await env.DB.prepare("SELECT p.pii AS pii, s.role AS role FROM seat s JOIN participant p ON p.eid=s.eid AND p.pid=s.pid WHERE s.eid=? AND s.seq=?").bind(eid, sNo).first<{ pii: string | null; role: string | null }>();
    const o = await openPii(env, r?.pii); seatInfo.set(sNo, { name: o?.name ?? null, phone: o?.phone ?? null, role: r?.role ?? null });
  }
  const prow = new Map<string, any>();
  for (const r of (await env.DB.prepare("SELECT round, pattern, ordinal, seat, pii, orig, trail, confirmed_ms, given_ms FROM prize WHERE eid=?").bind(eid).all<any>()).results ?? []) prow.set(`${r.round}|${r.pattern}|${r.ordinal}|${r.seat}`, r);
  const pinfo = new Map<string, { name: string | null; phone: string | null; confirmed: boolean; changedFrom: string | null; given: string | null }>();
  for (const [k, r] of prow) {
    const cur = await openPii(env, r.pii), orig = await openPii(env, r.orig);
    let trail: any[] = []; try { trail = JSON.parse((await openText(env, r.trail)) ?? "[]"); } catch { /* none */ }
    pinfo.set(k, { name: cur?.name ?? null, phone: cur?.phone ?? null, confirmed: !!r.confirmed_ms, changedFrom: trail.length ? `joined as ${orig?.name || "?"}, ${orig?.phone || "?"}` : null, given: r.given_ms ? istDate(r.given_ms) : null });
  }
  const winnerOf = (w: any): ReportWinner => { const i = seatInfo.get(w.seat), pz = pinfo.get(`${w.round}|${w.pattern}|${w.ordinal}|${w.seat}`); return { seat: w.seat, name: pz?.name ?? i?.name ?? null, phone: pz?.phone ?? i?.phone ?? null, role: i?.role ?? null, verified: w.src === "console" || w.src === "phones" || w.src === "ttt", callNo: w.idx === null ? null : w.idx + 1, atMs: w.at_ms, confirmed: pz?.confirmed ?? false, changedFrom: pz?.changedFrom ?? null, given: pz?.given ?? null }; };
  const prizes: ReportPrize[] = [];
  for (let round = 1; round <= cfg.rounds; round++) for (const key of keysInPlay(cfg.rewards)) for (const line of linesFor(cfg.rewards, key)) prizes.push({ round, label: lineLabel(cfg, key, line.ordinal), text: line.text, winners: wrows.filter((w: any) => w.round === round && w.pattern === key && w.ordinal === line.ordinal).map(winnerOf) });
  const lucky = cfg.breaks.filter((b) => b.kind === "lucky").map((b, i) => ({ title: b.title, winners: wrows.filter((w: any) => w.pattern === "lucky" && w.ordinal === i + 1).map(winnerOf) }));
  const held = e.pack === 0;
  const early = !held && endMs < (await endBoundMs(env, e)) - 5 * 60_000;
  // the tournament itself: when the Organizer or a Host pressed Start, the format, the move clock, the bracket and the champion (the mailbox keeps these; nothing here is computed)
  let play: ReportData["play"]; let playStart: number | null = null, finished = false, started = false;
  try {
    const t = await env.DB.prepare("SELECT state, opts, rounds, players, started_ms, champion FROM ttt_t WHERE eid=?").bind(eid).first<{ state: string; opts: string | null; rounds: number | null; players: number | null; started_ms: number | null; champion: string | null }>();
    if (t && t.state !== "open") {
      started = true; finished = t.state === "done"; playStart = t.started_ms;
      const o = t.opts ? JSON.parse(t.opts) : {};
      const champ = t.champion ? (await env.DB.prepare("SELECT name FROM ttt_e WHERE eid=? AND id=?").bind(eid, t.champion).first<{ name: string }>())?.name ?? null : null;
      play = { format: o.format === "team" ? `Team against team (teams of ${o.teamSize})` : "One against one", rounds: t.rounds ?? 0, moveSecs: Math.round((o.moveMs ?? 0) / 1000), players: t.players ?? 0, champion: champ };
    }
  } catch { /* the report is still made without the tournament rows */ }
  return {
    engagementId: eid, organizerEmail: email, sentAtMs: sentAt, scheduledMs: roundMs(e.start_round), firstNumberMs: playStart ?? first, endMs, wasHeld: held,
    endReason: held ? "The game did not start." : finished ? "The tournament was played to the final and the places were agreed." : started ? "The tournament was closed before the final result was agreed." : "The Organizer did not start the tournament.",
    ...(play ? { play } : {}),
    rounds: cfg.rounds, callSeconds: e.call_seconds, ticketsPerPerson: cfg.tickets, cap: e.cap, inviteOnly: !!e.closed, numbersCalled: early ? Math.max(1, ...wrows.map((w: any) => (w.idx ?? 0) + 1)) : 75,
    agg: st.agg, people: [], prizes, lucky, timeline: st.tl, breaks: cfg.breaks.map((b) => ({ after: b.after, kind: b.kind, title: b.title })),
    personalDeleteAtMs: personalDeleteAt(endMs), fullDeleteAtMs: fullDeleteAt(endMs), tz: cfg.tz,
    ...(cfg.brand ? { brand: { name: cfg.brand.name, ...(cfg.brand.logo ? { logo: cfg.brand.logo } : {}) } } : {}),
  };
}

/** Six hours before the report link closes: if it has not been opened yet, one reminder. */
async function remindReport(env: LifeEnv, e: any, life: any, now: number) {
  const eid = e.id as string;
  if (await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k IN (?,?)").bind(`rptopen/${eid}`, `rptremind/${eid}`).first()) return;
  const contact = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${eid}`).first<{ v: string }>();
  const email = contact ? (JSON.parse(contact.v).email as string) : null;
  await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`rptremind/${eid}`, String(now)).run();
  if (!email) return;
  await sendReportMail(env, email, `Reminder: open your Corporate Tic Tac Toe report ${eid} before ${istFull(reportLinkUntil(life.end_ms), tzOfRow(e))}`, `Hello,\n\nYour game ${eid} report has not been opened yet. The link closes at ${istFull(reportLinkUntil(life.end_ms), tzOfRow(e))} and the participants' details are permanently deleted at ${istFull(personalDeleteAt(life.end_ms), tzOfRow(e))}, and the report cannot be made after that.\n\nOpen it here and save the PDF:\n${await reportLink(env, eid)}\n\nCorporate Tic Tac Toe`, []);
}

// ------------------------------------------------------------------------------------------------ games that did not start
/**
 * A game that was never paid for (so its first number was never called). Its guests' names and numbers, people lists, waiting requests, personal links and Co-host details are erased
 * 23 hours after its scheduled END (the same end estimate a played game uses), following the NEWEST schedule: a reschedule moves the clock. Organizer and Host data, payments and invoices stay.
 * A published game is then CLOSED (`unplayed_ms`): nobody can join or pay. Six hours before, the Organizer and Hosts get a heads-up (once per erasure time); right after, an "it did not start" mail.
 * A draft nobody published is erased the same way but is not "closed" (it is forgotten after 30 days as before). Safe to repeat.
 */
export async function unplayedPass(env: LifeEnv, now: number): Promise<number> {
  let purged = 0;
  const roundAtMs = (ms: number) => Math.floor((ms / 1000 - GENESIS) / 3) + 1;
  const rows = (await env.DB.prepare("SELECT e.* FROM engagement e LEFT JOIN life l ON l.eid=e.id WHERE e.pack IS 0 AND e.cancelled_ms IS NULL AND e.unplayed_ms IS NULL AND l.purged_ms IS NULL AND e.start_round <= ? ORDER BY e.start_round LIMIT 25").bind(roundAtMs(now - PURGE_AFTER_MS + UNPLAYED_WARN_MS)).all<any>()).results ?? [];
  for (const e of rows) {
    try {
      const erase = personalDeleteAt(await endBoundMs(env, e));
      const published = !!(await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`pub/${e.id}`).first());
      if (published && now >= erase - UNPLAYED_WARN_MS && now < erase) { // one heads-up per erasure time (a reschedule is a new time, so it is a new heads-up)
        const flag = `unplayed-warn/${e.id}`, seen = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(flag).first<{ v: string }>();
        if (seen?.v !== String(erase)) { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(flag, String(erase)).run(); await mailErasureHeadsUp(env as any, e, erase, now); }
      }
      if (now >= erase && !(await isHeld(env.DB, e.id))) {
        await erasePersonal(env, e.id, now, "unplayed");
        if (published) {
          await env.DB.prepare("UPDATE engagement SET unplayed_ms=? WHERE id=? AND unplayed_ms IS NULL AND pack=0").bind(now, e.id).run();
          if ((await env.DB.prepare("SELECT pack FROM engagement WHERE id=?").bind(e.id).first<{ pack: number }>())?.pack === 0) await restoreCreditUses(env.DB, e.id, now); // a game that never started and closed: credit applied to it comes back
          await env.DB.prepare("DELETE FROM kv WHERE k=? OR k=?").bind(`ann/${e.id}`, `unplayed-warn/${e.id}`).run();
          await mailDataDeleted(env as any, e, now, { didNotStart: true });
        }
        purged++;
      }
    } catch { /* this game is tried again at the next tick */ }
  }
  return purged;
}

// ------------------------------------------------------------------------------------------------ the scheduled tick
/** Runs the lifecycle for engagements that still hold personal data. Bounded: at most 25 engagements, one report step each. */
export async function lifecycleTick(env: LifeEnv, now: number): Promise<{ checked: number; reportSteps: number; reportsDone: number; purged: number }> {
  const out = { checked: 0, reportSteps: 0, reportsDone: 0, purged: 0 };
  // paid (or cancelled) games that still hold personal data: guests, people on a list, waiting requests. A game nobody paid for is the "did not start" pass below.
  // 25 games per call, taken round and round by start time (a cursor in kv): when more than 25 games hold personal data at once, no game waits behind the same 25 for ever
  const SEL = "SELECT e.*, (SELECT COUNT(*) FROM participant p WHERE p.eid=e.id) AS npart FROM engagement e LEFT JOIN life l ON l.eid=e.id WHERE l.purged_ms IS NULL AND (e.pack IS NOT 0 OR e.cancelled_ms IS NOT NULL) AND (EXISTS (SELECT 1 FROM participant p WHERE p.eid=e.id) OR EXISTS (SELECT 1 FROM person q WHERE q.eid=e.id) OR EXISTS (SELECT 1 FROM waiting w WHERE w.eid=e.id) OR EXISTS (SELECT 1 FROM ttt_p x WHERE x.eid=e.id))";
  const cv = String((await env.DB.prepare("SELECT v FROM kv WHERE k='life_cursor'").first<{ v: string }>())?.v ?? ""), cut = cv.indexOf("|"), cursorRound = cut > 0 ? Number(cv.slice(0, cut)) || 0 : Number(cv) || 0, cursorId = cut > 0 ? cv.slice(cut + 1) : ""; // where the last call stopped: (start round, game id), so games that start in the same round are all reached
  let rows: any[] = (await env.DB.prepare(SEL + " AND (e.start_round > ? OR (e.start_round = ? AND e.id > ?)) ORDER BY e.start_round, e.id LIMIT 25").bind(cursorRound, cursorRound, cursorId).all<any>()).results ?? [];
  if (rows.length < 25) rows = rows.concat((await env.DB.prepare(SEL + " AND (e.start_round < ? OR (e.start_round = ? AND e.id <= ?)) ORDER BY e.start_round, e.id LIMIT ?").bind(cursorRound, cursorRound, cursorId, 25 - rows.length).all<any>()).results ?? []);
  if (rows.length) await env.DB.prepare("INSERT INTO kv(k,v) VALUES('life_cursor',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(rows.length >= 25 ? `${rows[rows.length - 1].start_round}|${rows[rows.length - 1].id}` : "0").run();
  for (const e of rows) {
    out.checked++;
    await keepGameRecord(env.DB, e, now); // the game's settings, kept for ever without any personal data; refreshed at each pass so a later change of a rule is kept too
    try {
      if (e.cancelled_ms) { // a cancelled game: no report; the 23-hour clock runs from the cancel time
        await env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'cancel') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='cancel' WHERE life.purged_ms IS NULL").bind(e.id, e.cancelled_ms).run();
        if (now >= personalDeleteAt(e.cancelled_ms) && !(await isHeld(env.DB, e.id))) { await erasePersonal(env, e.id, now, "cancel"); out.purged++; await mailDataDeleted(env as any, e, now); }
        continue;
      }
      let life = await env.DB.prepare("SELECT * FROM life WHERE eid=?").bind(e.id).first<any>();
      if (!life || life.end_src !== "phones") { // until phones confirm the end, the scheduled end (with the organizer's pauses) is the end, and is re-read each time
        const end = await endBoundMs(env, e);
        await env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'schedule') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms WHERE life.end_src='schedule' AND life.purged_ms IS NULL").bind(e.id, end).run();
        life = await env.DB.prepare("SELECT * FROM life WHERE eid=?").bind(e.id).first<any>();
      }
      if (!life || now < life.end_ms + REPORT_AFTER_MS) continue; // still being played
      if (!e.npart) { // a game that was played with nobody joined (only a people list): no report to make; the list goes 23 hours after the end like everyone's data
        if (now >= personalDeleteAt(life.end_ms) && !(await isHeld(env.DB, e.id))) { await erasePersonal(env, e.id, now, "auto"); out.purged++; await mailDataDeleted(env as any, e, now); }
        continue;
      }
      if (!life.report_ms && life.report_state !== "no-email") {
        out.reportSteps++;
        if (await reportStep(env, e, life, now)) { await env.DB.prepare("UPDATE life SET report_ms=?, report_state=COALESCE(report_state,'sent') WHERE eid=?").bind(now, e.id).run(); out.reportsDone++; }
        else await env.DB.prepare("UPDATE life SET tries=tries+1 WHERE eid=?").bind(e.id).run();
      }
      if (life.report_ms && now >= reportLinkUntil(life.end_ms) - 6 * 3_600_000 && now < reportLinkUntil(life.end_ms)) await remindReport(env, e, life, now);
      if (now >= personalDeleteAt(life.end_ms) && !(await isHeld(env.DB, e.id))) { await erasePersonal(env, e.id, now, "auto"); out.purged++; await mailDataDeleted(env as any, e, now); } // an owner-set legal hold suspends this too
    } catch { /* this engagement is tried again at the next tick; the others still run */ }
  }
  // the permanent settings record (gamerecord.ts) also for the games the pass above does not look at (free and demo games), and for any game that has no record yet or whose ending is not in its record yet
  try {
    await ensureGameRecordTable(env.DB);
    const more = (await env.DB.prepare("SELECT e.*, (SELECT COUNT(*) FROM participant p WHERE p.eid=e.id) AS npart FROM engagement e LEFT JOIN game_record g ON g.eid=e.id LEFT JOIN life l ON l.eid=e.id WHERE e.pack IS NOT NULL AND (g.eid IS NULL OR (g.outcome IS NULL AND l.eid IS NOT NULL)) ORDER BY e.start_round DESC LIMIT 25").all<any>()).results ?? [];
    for (const e of more) await keepGameRecord(env.DB, e, now);
  } catch { /* tried again at the next tick */ }
  // games that did not start (nobody paid, or still a draft): guest data goes 23 hours after the game was MEANT to end; a published one is then closed ("This game did not start")
  try { out.purged += await unplayedPass(env, now); } catch { /* tried again at the next tick */ }
  try { const c = await creditTick(env as any, now); (out as any).creditLapsed = c.lapsed; (out as any).creditMails = c.mailed; } catch { /* tried again at the next tick */ }
  // a game's Co-hosts (name + mobile) go 23 hours after it ends even when nobody ever joined, so no participant erasure ever ran for it
  try {
    const open = (await env.DB.prepare("SELECT DISTINCT eid FROM organizer_key WHERE kind='cohost' AND revoked=0 AND eid IS NOT NULL LIMIT 25").all<{ eid: string }>()).results ?? [];
    for (const k of open) {
      const g = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(k.eid).first<any>();
      const l = await env.DB.prepare("SELECT end_ms, purged_ms FROM life WHERE eid=?").bind(k.eid).first<any>();
      const endMs = !g ? 0 : g.cancelled_ms ? g.cancelled_ms : l?.end_ms ?? (await endBoundMs(env, g));
      if ((!g || l?.purged_ms || now >= personalDeleteAt(endMs)) && !(await isHeld(env.DB, k.eid))) await env.DB.prepare(eraseCohostsSql).bind(k.eid).run();
    }
  } catch { /* tried again at the next tick */ }
  // engagements whose participant rows are already gone (organizer erased early, or a hold was lifted since) but whose participants' audit part is still sealed: shred it once the 23 hours are over
  try {
    const late = (await env.DB.prepare("SELECT DISTINCT p.eid AS eid FROM audit_pii p JOIN life l ON l.eid=p.eid WHERE l.end_ms + ? <= ? AND NOT EXISTS (SELECT 1 FROM legal_hold h WHERE h.eid=p.eid) LIMIT 25").bind(PURGE_AFTER_MS, now).all<{ eid: string }>()).results ?? [];
    for (const x of late) await shredParticipantAudit(env as any, x.eid, now);
  } catch { /* tried again at the next tick */ }
  // a paid game that was played with nobody in it (no guests, no people list, nobody waiting) has no personal data to erase, but it still gets its end record, so the 365-day clock has a start
  try {
    const bare = (await env.DB.prepare("SELECT e.* FROM engagement e LEFT JOIN life l ON l.eid=e.id WHERE l.eid IS NULL AND e.pack IS NOT 0 AND e.cancelled_ms IS NULL AND NOT EXISTS (SELECT 1 FROM participant p WHERE p.eid=e.id) AND NOT EXISTS (SELECT 1 FROM person q WHERE q.eid=e.id) AND NOT EXISTS (SELECT 1 FROM waiting w WHERE w.eid=e.id) AND NOT EXISTS (SELECT 1 FROM ttt_p x WHERE x.eid=e.id) ORDER BY e.start_round LIMIT 25").all<any>()).results ?? [];
    for (const e of bare) { const end = await endBoundMs(env, e); if (now >= end) await env.DB.prepare("INSERT OR IGNORE INTO life(eid,end_ms,end_src,purged_ms,report_state) VALUES(?,?,'schedule',?,'no-guests')").bind(e.id, end, now).run(); }
  } catch { /* tried again at the next tick */ }
  // the mail log (recipient address and subject of mail sent) keeps nothing older than 3 days: forgotten every hour from THIS clock, not only when an organizer happens to visit; unsent mail gets one more try a day
  try {
    const h = new Date(now).toISOString().slice(0, 13), lastH = await env.DB.prepare("SELECT v FROM kv WHERE k='outbox_sweep_hour'").first<{ v: string }>();
    if (lastH?.v !== h) { await env.DB.prepare("INSERT INTO kv(k,v) VALUES('outbox_sweep_hour',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(h).run(); (out as any).outboxDropped = await purgeOutbox(env.DB, now); }
    const d = h.slice(0, 10), lastD = await env.DB.prepare("SELECT v FROM kv WHERE k='outbox_retry_day'").first<{ v: string }>();
    if (lastD?.v !== d) { await env.DB.prepare("INSERT INTO kv(k,v) VALUES('outbox_retry_day',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(d).run(); (out as any).outboxRetried = (await retryOutbox(env as any, now)).retried; }
  } catch { /* tried again at the next tick */ }
  // public-page visit records older than 365 days: rolled into anonymous per-day totals, then deleted (once a day, a few days of catch-up at a time)
  try {
    const d = new Date(now).toISOString().slice(0, 10), last = await env.DB.prepare("SELECT v FROM kv WHERE k='visit_sweep_day'").first<{ v: string }>();
    if (last?.v !== d) { await env.DB.prepare("INSERT INTO kv(k,v) VALUES('visit_sweep_day',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(d).run(); await sweepVisits(env, now); }
  } catch { /* tried again at the next tick */ }
  return out;
}

export { INVITE_CATEGORIES };

/** When this game was paid: the first paid payment for it; a game paid with credit has no payment of its own, so the first time credit was applied; else the day it was made. */
export async function paidAtMs(db: D1, e: { id: string; created_ms: number }): Promise<number> {
  const p = await db.prepare("SELECT MIN(paid_ms) AS t FROM payment WHERE eid=? AND status='paid' AND paid_ms IS NOT NULL").bind(e.id).first<{ t: number | null }>();
  if (p?.t) return p.t;
  try { const c = await db.prepare("SELECT MIN(created_ms) AS t FROM credit_use WHERE eid=?").bind(e.id).first<{ t: number | null }>(); if (c?.t) return c.t; } catch { /* no credit table row */ }
  return e.created_ms;
}
/** The latest moment a game's start time may be set to: a draft (not paid): 30 days from now; a PAID game: 365 days from the day of payment. */
export async function latestStartMs(db: D1, e: { id: string; pack: number | null; created_ms: number }, now: number): Promise<number> {
  return e.pack === 0 || e.pack === null ? now + MAX_AHEAD_MS : (await paidAtMs(db, e)) + PAID_WINDOW_MS - 60_000;
}
