// The permanent record of a game's SETTINGS (owner order 2026-10-25): for every game, the settings it was played with are kept with the game ID, for ever,
// and they hold NO personal data of any player (no name, no mobile number, no employee ID, no e-mail, no seat or card of a person, no guest list).
// What is kept: the game ID; when it was made; the start time, speed, size, tickets per person, tie rule, rounds, who calls the numbers, who may join and how they are checked
// (the kinds only, never a list); the prizes (house, winner position, prize text); the brand moments (kind, place, length, title, lucky-draw size and style, never a media address);
// the company name and colours; the pack bought; and, once the game has run, only COUNTS: how many people joined, checked in, how many winner positions were given, how it ended.
// It is written again at every lifecycle pass (so a later change of a rule is kept) and one last time just before the game's own rows are deleted. Nothing deletes it.
import type { D1 } from "./worker";

export const GAME_RECORD_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS game_record (eid TEXT PRIMARY KEY, org TEXT, created_ms INTEGER, start_round INTEGER, settings TEXT NOT NULL, outcome TEXT, first_kept_ms INTEGER NOT NULL, kept_ms INTEGER NOT NULL)`,
];

/** Makes the table when the live database does not have it yet (the code is deployed before the owner's database update is applied; the statement is harmless to repeat). */
export async function ensureGameRecordTable(db: D1): Promise<void> { for (const s of GAME_RECORD_SCHEMA) await db.prepare(s).run(); }

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[<>`]/g, "").slice(0, max) : null);

/** The settings of a game with every personal item left out. Only fields named here are ever copied (a whitelist), so a future field cannot leak in by accident. */
export function settingsOf(e: { closed?: number | null; id: string; start_round: number; call_seconds: number; cap: number; tickets: number; pack: number | null; config: string | null; cancelled_ms?: number | null }): Record<string, unknown> {
  let c: any = {}; try { c = e.config ? JSON.parse(e.config) : {}; } catch { c = {}; }
  const brandSlots = (a: unknown) => (Array.isArray(a) ? a : []).slice(0, 20).map((b: any) => ({ kind: text(b?.kind, 20), seconds: num(b?.seconds), title: text(b?.title, 80), ...(b?.winners !== undefined ? { winners: num(b.winners) } : {}), ...(b?.style ? { style: text(b.style, 12) } : {}) }));
  return {
    gameId: e.id, startRound: e.start_round, callSeconds: e.call_seconds, cap: e.cap, ticketsPerPerson: e.tickets, pack: e.pack, demo: c.demo === true, cancelled: !!e.cancelled_ms,
    tieRule: c.ties === "share" ? "share" : "next", rounds: num(c.rounds) ?? 1, callMode: c.callMode === "host" ? "host" : "auto",
    whoCanJoin: e.closed ? "list" : "anyone", verify: c.verify === "id" || c.verify === "either" || c.verify === "both" ? c.verify : "mobile", employeesOnly: c.employeesOnly === true,
    invites: c.invites && typeof c.invites === "object" ? { on: c.invites.on === true, per: num(c.invites.per), categories: Array.isArray(c.invites.cats) ? c.invites.cats.slice(0, 10).map((x: unknown) => text(x, 20)) : [] } : null,
    prizes: (Array.isArray(c.rewards) ? c.rewards : []).slice(0, 300).map((r: any) => ({ house: text(r?.pattern, 20), scope: r?.scope === "two_ticket" ? "two_ticket" : "card", position: num(r?.ordinal), prize: text(r?.text, 80) })),
    breaks: brandSlots(c.breaks), opening: brandSlots(c.opening), closing: brandSlots(c.closing),
    brand: c.brand && typeof c.brand === "object" ? { company: text(c.brand.name, 80), colour: text(c.brand.color, 12) } : null, // the logo picture is not part of the record
    gameName: text(c.name, 120),
  };
}

/** Writes (or refreshes) the permanent settings record of one game. `e` is the engagement row. Safe to repeat; never throws into the caller's work. */
export async function keepGameRecord(db: D1, e: any, now: number): Promise<void> {
  try { await keepGameRecordOnce(db, e, now); } catch { try { await ensureGameRecordTable(db); await keepGameRecordOnce(db, e, now); } catch { /* best effort: the next pass writes it again, and the last write happens before deletion */ } }
}
async function keepGameRecordOnce(db: D1, e: any, now: number): Promise<void> {
  {
    const settings = JSON.stringify(settingsOf(e));
    let outcome: Record<string, unknown> | null = null;
    const life = await db.prepare("SELECT end_ms, end_src, report_state FROM life WHERE eid=?").bind(e.id).first<{ end_ms: number; end_src: string; report_state: string | null }>();
    if (life) {
      const wins = await db.prepare("SELECT COUNT(*) AS n FROM winner WHERE eid=?").bind(e.id).first<{ n: number }>();
      const joined = e.npart ?? (await db.prepare("SELECT COUNT(*) AS n FROM participant WHERE eid=?").bind(e.id).first<{ n: number }>())?.n ?? null;
      const seen = await db.prepare("SELECT outcome FROM game_record WHERE eid=?").bind(e.id).first<{ outcome: string | null }>();
      let before: any = {}; try { before = seen?.outcome ? JSON.parse(seen.outcome) : {}; } catch { before = {}; }
      // counts only; once the participants are gone a later pass must not overwrite the real count with zero
      outcome = { endMs: life.end_ms, endedBy: life.end_src, report: life.report_state ?? before.report ?? null, winnerPositions: Math.max(wins?.n ?? 0, before.winnerPositions ?? 0), joined: Math.max(num(joined) ?? 0, before.joined ?? 0) };
    }
    await db.prepare("INSERT INTO game_record(eid,org,created_ms,start_round,settings,outcome,first_kept_ms,kept_ms) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(eid) DO UPDATE SET settings=excluded.settings, outcome=COALESCE(excluded.outcome, game_record.outcome), kept_ms=excluded.kept_ms")
      .bind(e.id, e.org ?? null, e.created_ms ?? null, e.start_round, settings, outcome ? JSON.stringify(outcome) : null, now, now).run();
  }
}

/** The owner's read of the permanent records (platform key only). `eid` for one game; otherwise the newest `limit`. */
export async function readGameRecords(db: D1, eid: string | null, limit = 200): Promise<unknown[]> {
  const rows = eid
    ? (await db.prepare("SELECT * FROM game_record WHERE eid=?").bind(eid).all<any>()).results ?? []
    : (await db.prepare("SELECT * FROM game_record ORDER BY created_ms DESC LIMIT ?").bind(Math.max(1, Math.min(1000, limit))).all<any>()).results ?? [];
  return rows.map((r: any) => ({ gameId: r.eid, org: r.org, createdMs: r.created_ms, keptMs: r.kept_ms, settings: JSON.parse(r.settings), outcome: r.outcome ? JSON.parse(r.outcome) : null }));
}
