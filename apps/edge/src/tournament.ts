// The mailbox for Corporate Tic Tac Toe tournaments. The game itself (rules, bracket, starters, clocks, tie-breaks, ranking) runs on the phones: packages/ttt/src/phone.ts, compiled for the browser.
//
// THE RULE THIS FILE KEEPS: our server only stores and relays data. It signs people in, keeps the sealed seed and the player list, stores each move with the server's own clock stamp,
// stores the two players' reports of a result and lists them, keeps the Organizer's settlements, tallies what two phones agree on, deletes the data after 24 hours and sends e-mail.
// It never looks at a board, never decides whose turn it is, never runs a clock, never builds a bracket and never ranks anybody. apps/edge/test/server-does-no-game-work.test.ts fails if a game rule is imported here.
//
// Routes (all under /api/z/{eid}/ttt/):
//   setup (public)          the sealed fingerprint; after the start also the secret, the seed, the player list, the move clock and the pauses
//   start / plan / pause / resume / settle / flags (Organizer or Host)
//   move (a player)         {mid, pid, device, seq, sq | absent, client_ms}: stored if the player is in that match and seq is the next number; the reply carries nothing but the number
//   m/{mid} (public)        the stored moves of a match with the SERVER's stamps, the two reports, the agreed result
//   result (a player)       {mid, pid, device, winner}: the report of one player; the mailbox keeps it as agreed when both reports match (or when nobody contradicts a single one for 30 seconds)
//   open (a player)         registers a later-round match: who plays on which board, and the two finished matches it came from
//   finish (a player or the Organizer)  the ranking two phones computed; kept when two different phones sent the same thing
//   view / all / rank (public), flag (a player), tick (scheduled job)
import { commitOf, newSecret, seedOf } from "../../../packages/ttt/src/seal";
import type { Env } from "./worker";

export const TTT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ttt_t (eid TEXT PRIMARY KEY, commit_hash TEXT NOT NULL, secret TEXT, state TEXT NOT NULL DEFAULT 'open', opts TEXT, seed TEXT, size INTEGER, rounds INTEGER, entrants INTEGER, players INTEGER, started_ms INTEGER, ended_ms INTEGER, pause_at INTEGER, pause_total INTEGER NOT NULL DEFAULT 0, champion TEXT, ranking TEXT)`,
  `CREATE TABLE IF NOT EXISTS ttt_e (eid TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, members TEXT NOT NULL, PRIMARY KEY (eid, id))`,
  `CREATE TABLE IF NOT EXISTS ttt_p (eid TEXT NOT NULL, pid TEXT NOT NULL, name TEXT NOT NULL, ent TEXT, PRIMARY KEY (eid, pid))`,
  `CREATE TABLE IF NOT EXISTS ttt_m (eid TEXT NOT NULL, mid TEXT NOT NULL, round INTEGER NOT NULL, idx INTEGER NOT NULL, a TEXT, b TEXT, status TEXT NOT NULL, bye INTEGER NOT NULL DEFAULT 0, deadline INTEGER, winner TEXT, loser TEXT, started_ms INTEGER, done_ms INTEGER, data TEXT, PRIMARY KEY (eid, mid))`,
  `CREATE INDEX IF NOT EXISTS ttt_m_live ON ttt_m (eid, status, deadline)`,
  `CREATE INDEX IF NOT EXISTS ttt_m_a ON ttt_m (eid, a)`,
  `CREATE INDEX IF NOT EXISTS ttt_m_b ON ttt_m (eid, b)`,
];
/** The mailbox tables (0023_mailbox.sql): moves, reports, agreed results, finish reports, notes for the Organizer, pauses. Only opaque ids, squares and stamps; no names. */
export const TTT_MAILBOX_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ttt_mv (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, seq INTEGER NOT NULL, pid TEXT NOT NULL, sq INTEGER NOT NULL, client_ms INTEGER, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j, seq))`,
  `CREATE TABLE IF NOT EXISTS ttt_r (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, pid TEXT NOT NULL, winner TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j, pid))`,
  `CREATE TABLE IF NOT EXISTS ttt_b (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, winner TEXT, how TEXT NOT NULL, flag INTEGER NOT NULL DEFAULT 0, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j))`,
  `CREATE TABLE IF NOT EXISTS ttt_f (eid TEXT NOT NULL, who TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, who))`,
  `CREATE TABLE IF NOT EXISTS ttt_x (eid TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, mid TEXT, who TEXT, note TEXT, at_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ttt_z (eid TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER, PRIMARY KEY (eid, from_ms))`,
];

export const TTT_MOVE_SECONDS = [10, 20, 30, 60] as const;
const MAX_MS = 6 * 3_600_000; // a tournament that has not finished this long after its scheduled start is closed for the data-deletion clock (lifecycle.ts)
const UNCONTESTED_MS = 30_000; // a single report that nobody contradicts for this long (server clock) is kept as the result
const PAGE = 100, LIVE_SAMPLE = 24, MAX_PLAN_MATCHES = 600;
const MAX_EVENTS_EACH = 60, MAX_NOTES_EACH = 20; // a player stores at most this many moves or claims on one board (a board needs at most 27 squares in all) and this many notes for the Organizer in one game
const OBJECTION = "-"; // a report "winner: -" says: my rules do not say this board is decided (packages/ttt/src/phone.ts, OBJECTION)
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

interface TRow { eid: string; commit_hash: string; secret: string | null; state: "open" | "starting" | "running" | "done"; opts: string | null; seed: string | null; size: number | null; rounds: number | null; entrants: number | null; players: number | null; started_ms: number | null; ended_ms: number | null; pause_at: number | null; pause_total: number; champion: string | null; ranking: string | null }
interface MRow { eid: string; mid: string; round: number; idx: number; a: string | null; b: string | null; status: "waiting" | "live" | "done"; bye: number; deadline: number | null; winner: string | null; started_ms: number | null; done_ms: number | null; data: string | null }
const optsOf = (t: TRow): Record<string, any> => JSON.parse(t.opts ?? "{}");

export async function ensureT(env: Env, eid: string): Promise<TRow> {
  const have = await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(eid).first<TRow>();
  if (have) return have;
  const secret = newSecret(), commit = await commitOf(secret);
  await env.DB.prepare("INSERT OR IGNORE INTO ttt_t(eid,commit_hash,secret) VALUES(?,?,?)").bind(eid, commit, secret).run();
  return (await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(eid).first<TRow>())!;
}
export const tournamentStarted = async (env: Env, eid: string): Promise<boolean> => !!(await env.DB.prepare("SELECT 1 AS x FROM ttt_t WHERE eid=? AND state<>'open'").bind(eid).first());
export function endBoundTtt(startMs: number, t: { ended_ms: number | null } | null): number { return t?.ended_ms ? t.ended_ms + 60_000 : startMs + MAX_MS; }

const boardsOf = (m: Pick<MRow, "data">): [string, string][] => (m.data ? JSON.parse(m.data) : []);
const pausesOf = async (env: Env, eid: string): Promise<[number, number | null][]> => ((await env.DB.prepare("SELECT from_ms, to_ms FROM ttt_z WHERE eid=? ORDER BY from_ms").bind(eid).all<{ from_ms: number; to_ms: number | null }>()).results ?? []).map((x) => [x.from_ms, x.to_ms]);
/** The tournament clock: wall time minus every pause (the same sum packages/ttt/src/phone.ts effOf makes). Only used to turn the mailbox's own stamps into the clock the phones use. */
const effOf = (pauses: readonly [number, number | null][], wall: number): number => { let cut = 0; for (const [f, to] of pauses) if (wall > f) cut += Math.min(wall, to ?? Infinity) - f; return wall - cut; };
/** Who won a finished match and when it was over, by COUNTING the agreed board results the mailbox holds (a side wins with more boards); never by looking at a board. Null while the match is not finished. */
async function tally(env: Env, t: TRow, mid: string, pauses: readonly [number, number | null][]): Promise<{ winner: string; doneAt: number } | null> {
  const startAt = t.started_ms ?? 0;
  const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(t.eid, mid).first<MRow>();
  if (!m || m.status !== "done") return null;
  if (m.bye) return m.winner ? { winner: m.winner, doneAt: startAt } : null;
  const pairs = boardsOf(m);
  const rs = (await env.DB.prepare("SELECT j, winner, at_ms FROM ttt_b WHERE eid=? AND mid=? AND flag=0 AND winner IS NOT NULL").bind(t.eid, mid).all<{ j: number; winner: string; at_ms: number }>()).results ?? [];
  if (!m.a || !m.b || rs.length < pairs.length) return null;
  const winsA = rs.filter((r) => r.winner === pairs[r.j]?.[0]).length;
  return { winner: winsA * 2 > pairs.length ? m.a : m.b, doneAt: Math.max(m.round === 1 ? startAt : m.deadline ?? startAt, ...rs.map((r) => effOf(pauses, r.at_ms))) };
}
const membersOf = async (env: Env, eid: string, id: string): Promise<string[] | null> => { const r = await env.DB.prepare("SELECT members FROM ttt_e WHERE eid=? AND id=?").bind(eid, id).first<{ members: string }>(); return r ? (JSON.parse(r.members) as string[]) : null; };
/** What a later-round match must be, from the agreed results: its two sides are the winners of the two matches that feed it, its boards pair their members in order, and it opens when the later of the two was over (tournament clock). Null while either is unfinished. */
async function sidesOf(env: Env, t: TRow, feeders: readonly [string, string]): Promise<{ a: string; b: string; boards: [string, string][]; opened: number } | null> {
  const pauses = await pausesOf(env, t.eid), x = await tally(env, t, feeders[0], pauses), y = await tally(env, t, feeders[1], pauses); if (!x || !y) return null;
  const am = await membersOf(env, t.eid, x.winner), bm = await membersOf(env, t.eid, y.winner); if (!am || !bm || am.length !== bm.length) return null;
  return { a: x.winner, b: y.winner, boards: am.map((p, j) => [p, bm[j]!] as [string, string]), opened: Math.round(Math.max(t.started_ms ?? 0, x.doneAt, y.doneAt)) };
}

// ---------------------------------------------------------------------------------------------------------------- storing results (counting, never judging)
/** A match is "done" in the mailbox when every one of its boards has an agreed result. */
async function refreshMatch(env: Env, eid: string, mid: string, now: number): Promise<void> {
  const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, mid).first<MRow>(); if (!m || m.bye) return;
  const k = boardsOf(m).length;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_b WHERE eid=? AND mid=? AND flag=0 AND winner IS NOT NULL").bind(eid, mid).first<{ c: number }>())?.c ?? 0;
  const done = k > 0 && n >= k;
  await env.DB.prepare("UPDATE ttt_m SET status=?, done_ms=? WHERE eid=? AND mid=?").bind(done ? "done" : "live", done ? now : null, eid, mid).run();
}
/** Keeps a single report that nobody has contradicted for UNCONTESTED_MS as the result of that board. Only compares stamps. */
async function sweep(env: Env, eid: string, now: number, mid?: string): Promise<number> {
  const rows = await env.DB.prepare(`SELECT r.mid AS mid, r.j AS j, r.winner AS winner, r.at_ms AS at_ms FROM ttt_r r WHERE r.eid=?${mid ? " AND r.mid=?" : ""} AND NOT EXISTS (SELECT 1 FROM ttt_b b WHERE b.eid=r.eid AND b.mid=r.mid AND b.j=r.j) GROUP BY r.mid, r.j HAVING COUNT(*)=1 AND MIN(r.winner)<>'-' AND MAX(r.at_ms)<? LIMIT 300`)
    .bind(...(mid ? [eid, mid] : [eid]), now - UNCONTESTED_MS).all<{ mid: string; j: number; winner: string; at_ms: number }>();
  const touched = new Set<string>();
  for (const r of rows.results ?? []) {
    await env.DB.prepare("INSERT OR IGNORE INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,?,'uncontested',0,?)").bind(eid, r.mid, r.j, r.winner, r.at_ms + UNCONTESTED_MS).run(); touched.add(r.mid);
  }
  for (const x of touched) await refreshMatch(env, eid, x, now);
  return touched.size;
}
async function note(env: Env, eid: string, kind: string, mid: string | null, who: string | null, text: string, now: number): Promise<void> {
  await env.DB.prepare("INSERT INTO ttt_x(eid,kind,mid,who,note,at_ms) VALUES(?,?,?,?,?,?)").bind(eid, kind, mid, who, text.slice(0, 300), now).run();
}

/** The scheduled job (and any look at a match) keeps single reports nobody contradicted. Bounded work per call. */
export async function tttTick(env: Env, now: number): Promise<number> {
  let n = 0;
  const ts = await env.DB.prepare("SELECT eid FROM ttt_t WHERE state='running'").all<{ eid: string }>();
  for (const t of ts.results ?? []) n += await sweep(env, t.eid, now);
  return n;
}

// ---------------------------------------------------------------------------------------------------------------- routes
export interface TttCtx {
  env: Env; req: Request; now: number; eid: string; e: any; sub: string; url: URL;
  body: (req: Request, max?: number) => Promise<any | null>; spend: (env: Env, now: number, n?: number) => Promise<boolean>;
  allowed: boolean; /** Organizer or Host (not the AI) */ openName: (pii: string | null) => Promise<string | null>; gate: Response | null; BUSY: () => Response;
}

const cleanName = (n: unknown) => String(n ?? "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "Player";
const MID = /^r[0-9]{1,2}m[0-9]{1,5}$/;
const PID = /^[A-Za-z0-9_-]{4,40}$/;

async function playerOf(c: TttCtx, pid: unknown, device: unknown): Promise<{ pid: string } | Response> {
  if (typeof pid !== "string" || typeof device !== "string" || !/^[0-9a-f]{16,64}$/.test(device)) return json({ error: "Open the game link on your own phone." }, 400);
  const seat = await c.env.DB.prepare("SELECT s.dev AS dev, s.blocked AS blocked FROM seat s WHERE s.eid=? AND s.pid=?").bind(c.eid, pid).first<{ dev: string | null; blocked: number | null }>();
  if (!seat) return json({ error: "You are not in this game." }, 403);
  if (seat.blocked) return json({ error: "You were removed from this game by the organizer.", code: "removed" }, 403);
  if (!seat.dev || seat.dev !== (await sha(`dev|${c.eid}|${device}`)).slice(0, 32)) return json({ error: "This place is on another phone.", code: "other-phone" }, 403);
  return { pid };
}
/** Which board of the match is this player on? Only a lookup in the list the mailbox was given. */
function boardOfPid(m: MRow, pid: string): number { return boardsOf(m).findIndex(([x, y]) => x === pid || y === pid); }

export async function tttRoute(c: TttCtx): Promise<Response> {
  const { env, req, now, eid, sub } = c;
  if (c.gate) return c.gate; // cancelled, did not start, draft, locked: the same answers as every other route
  const method = req.method;
  const t = await ensureT(env, eid);
  const mailRead = sub.startsWith("m/") ? sub.slice(2) : null;

  if (sub === "tick" && method === "POST") { if (!c.allowed) return json({ error: "Not allowed." }, 403); return json({ ok: true, processed: await tttTick(env, now) }); }

  // ------------------------------------------------------------------ setup: everything a phone needs to compute the game, and nothing it should not see before the start
  if (sub === "setup" && method === "GET") {
    const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
    const head = { eid, state: t.state, commit: t.commit_hash, serverNow: now, joined, startedMs: t.started_ms, endedMs: t.ended_ms, endedEarly: endedEarly(t), pauses: await pausesOf(env, eid) };
    if (t.state === "open") return json({ ...head, pauses: [] });
    if (t.state === "starting" && !c.allowed) return json(head); // the seed and the list are shown to everybody when the clocks start (the Organizer's page needs them one moment earlier to send the draw)
    const roster = ((await env.DB.prepare("SELECT pid, name FROM ttt_p WHERE eid=? ORDER BY pid").bind(eid).all<{ pid: string; name: string }>()).results ?? []);
    const o = optsOf(t);
    return json({ ...head, secret: t.secret, seed: t.seed, roster, opts: { format: o.format, teamSize: o.teamSize, moveMs: o.moveMs, readyMs: o.readyMs }, planDigest: o.planDigest ?? null, rounds: t.rounds, entrants: t.entrants });
  }

  if (sub === "reveal" && method === "GET") {
    if (t.state === "open" || (t.state === "starting" && !c.allowed)) return json({ commit: t.commit_hash, revealed: false, note: "The secret is shown when the host starts. This fingerprint cannot be changed after that." });
    return json({ commit: t.commit_hash, revealed: true, secret: t.secret, seed: t.seed, eid, how: "commit = sha256('TTT-COMMIT|' + secret); seed = sha256('TTT-SEED|' + secret + '|' + eid + '|' + sha256('TTT-ROSTER|' + sorted player ids joined by comma) + '|' + beacon). The bracket and every starter are computed on each phone from the seed (packages/ttt/src/phone.ts, bracket.ts, match.ts)." });
  }

  // ------------------------------------------------------------------ start: close the list, seal the seed, hand out the setup. The bracket is computed by the Organizer's phone and every other phone.
  if (sub === "start" && method === "POST") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can start the tournament." }, 403);
    if (t.state !== "open") return json({ error: "The tournament has already started.", code: "started" }, 409);
    const b = (await c.body(req, 1024)) ?? {};
    const format = b.format === "team" ? "team" : "solo", teamSize = format === "team" ? Number(b.teamSize ?? 3) : 1;
    const moveSecs = Number(b.moveSecs ?? 20);
    if (!(TTT_MOVE_SECONDS as readonly number[]).includes(moveSecs)) return json({ error: "A move clock is 10, 20, 30 or 60 seconds." }, 400);
    if (format === "team" && ![3, 5].includes(teamSize)) return json({ error: "A team has 3 or 5 players." }, 400);
    const beacon = typeof b.beacon === "string" ? b.beacon.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 128) : "";
    const rows = await env.DB.prepare("SELECT p.pid AS pid, p.pii AS pii, s.blocked AS blocked FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=?").bind(eid).all<{ pid: string; pii: string | null; blocked: number | null }>();
    const players: { pid: string; name: string }[] = [];
    for (const r of rows.results ?? []) { if (r.blocked) continue; players.push({ pid: r.pid, name: cleanName(await c.openName(r.pii)) }); }
    const need = format === "team" ? 2 * teamSize : 2;
    if (players.length < need) return json({ error: format === "team" ? `A team tournament needs at least two full teams (${need} players). ${players.length} joined.` : `A tournament needs at least 2 players. ${players.length} joined.`, code: "too-few", joined: players.length }, 409);
    if (players.length > 10_000) return json({ error: "Too many players." }, 400);
    if (!(await c.spend(env, now, players.length * 2 + 8))) return c.BUSY();
    const seed = await seedOf(t.secret!, eid, players.map((p) => p.pid), beacon);
    const o = { format, teamSize, moveMs: moveSecs * 1000, readyMs: 30_000 };
    const stmts: any[] = [env.DB.prepare("UPDATE ttt_t SET state='starting', opts=?, seed=?, players=? WHERE eid=? AND state='open'").bind(JSON.stringify(o), seed, players.length, eid)];
    for (const p of players) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_p(eid,pid,name,ent) VALUES(?,?,?,NULL)").bind(eid, p.pid, p.name));
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    return json({ ok: true, players: players.length, commit: t.commit_hash, state: "starting", next: "The Organizer's page computes the bracket from the seed and sends it to the mailbox (plan)." });
  }

  // ------------------------------------------------------------------ plan: the list of round-1 matches the Organizer's page computed. The mailbox only keeps it, so it knows who may write to which match; every phone re-computes it and objects if it differs.
  if (sub === "plan" && method === "POST") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can send the draw." }, 403);
    if (t.state !== "starting") return json({ error: t.state === "open" ? "The tournament has not started." : "The draw is already in place.", code: t.state }, 409);
    const b = await c.body(req, 400_000);
    if (!b || !Array.isArray(b.matches) || b.matches.length > MAX_PLAN_MATCHES || !Array.isArray(b.entrants || [])) return json({ error: "Bad draw." }, 400);
    const roster = new Set(((await env.DB.prepare("SELECT pid FROM ttt_p WHERE eid=?").bind(eid).all<{ pid: string }>()).results ?? []).map((x) => x.pid));
    const stmts: any[] = [];
    for (const e of b.entrants ?? []) {
      if (typeof e?.id !== "string" || !Array.isArray(e.members) || !e.members.every((p: unknown) => typeof p === "string" && roster.has(p))) return json({ error: "A team lists someone who did not join." }, 400);
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_e(eid,id,name,members) VALUES(?,?,?,?)").bind(eid, String(e.id).slice(0, 40), cleanName(e.name), JSON.stringify(e.members)));
    }
    for (const m of b.matches) {
      if (typeof m?.mid !== "string" || !MID.test(m.mid) || !Number.isInteger(m.round) || !Number.isInteger(m.idx) || !Array.isArray(m.boards)) return json({ error: "Bad match in the draw." }, 400);
      for (const bd of m.boards) if (!Array.isArray(bd) || bd.length !== 2 || !bd.every((p: unknown) => typeof p === "string" && roster.has(p))) return json({ error: "A board lists someone who did not join." }, 400);
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_m(eid,mid,round,idx,a,b,status,bye,winner,started_ms,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(eid, m.mid, m.round, m.idx, m.a ?? null, m.b ?? null, m.bye ? "done" : "live", m.bye ? 1 : 0, m.bye && typeof m.winner === "string" ? m.winner : null, now, JSON.stringify(m.boards)));
    }
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    if (b.last === true) {
      const rounds = Number(b.rounds), size = Number(b.size), entrants = Number(b.entrantCount ?? 0);
      if (!Number.isInteger(rounds) || rounds < 0 || rounds > 14 || !Number.isInteger(size) || typeof b.digest !== "string" || !/^[0-9a-f]{64}$/.test(b.digest)) return json({ error: "The draw is not complete." }, 400);
      const o = { ...optsOf(t), planDigest: b.digest };
      await env.DB.prepare("UPDATE ttt_t SET state='running', started_ms=?, rounds=?, size=?, entrants=?, opts=? WHERE eid=? AND state='starting'").bind(now, rounds, size, entrants || null, JSON.stringify(o), eid).run();
      return json({ ok: true, state: "running", startedMs: now });
    }
    return json({ ok: true, state: "starting", stored: b.matches.length });
  }

  if ((sub === "pause" || sub === "resume") && method === "POST") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can pause." }, 403);
    if (t.state !== "running") return json({ error: "The tournament is not running." }, 409);
    if (sub === "pause" && !t.pause_at) await env.DB.batch([env.DB.prepare("UPDATE ttt_t SET pause_at=? WHERE eid=?").bind(now, eid), env.DB.prepare("INSERT OR IGNORE INTO ttt_z(eid,from_ms,to_ms) VALUES(?,?,NULL)").bind(eid, now)]);
    if (sub === "resume" && t.pause_at) await env.DB.batch([env.DB.prepare("UPDATE ttt_t SET pause_total=pause_total+?, pause_at=NULL WHERE eid=?").bind(now - t.pause_at, eid), env.DB.prepare("UPDATE ttt_z SET to_ms=? WHERE eid=? AND to_ms IS NULL").bind(now, eid)]);
    return json({ ok: true, paused: sub === "pause" });
  }

  // ------------------------------------------------------------------ end: the Organizer or a Host ends the tournament now (O7). The server only stores that it is over and starts the deletion clock;
  // the phones read "ended" and stop. Nobody is ranked and no champion is named: a tournament that was ended early has no result.
  if (sub === "end" && method === "POST") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can end the tournament." }, 403);
    if (t.state === "done") return json({ ok: true, ended: true, again: true });
    if (t.state !== "running" && t.state !== "starting") return json({ error: "The tournament has not started.", code: t.state }, 409);
    await endEarly(env, t, now);
    return json({ ok: true, ended: true });
  }

  // ------------------------------------------------------------------ open: a later-round match is registered by its own players, naming the two finished matches it comes from
  if (sub === "open" && method === "POST") {
    const b = await c.body(req, 4096); if (!b) return json({ error: "Bad request." }, 400);
    const orgOpen = typeof b.pid !== "string" && c.allowed; // the Organizer's page registers a match whose two players are both away, from the same finished matches
    const who = orgOpen ? { pid: "organizer" } : await playerOf(c, b.pid, b.device); if (who instanceof Response) return who;
    if (t.state !== "running") return json({ error: "The tournament is not running.", code: t.state }, 409);
    const boards = b.boards, from = b.from;
    if (typeof b.mid !== "string" || !MID.test(b.mid) || !Number.isInteger(b.round) || b.round < 2 || !Number.isInteger(b.idx) || !Array.isArray(boards) || boards.length < 1 || boards.length > 5 || !boards.every((x: unknown) => Array.isArray(x) && x.length === 2 && (x as unknown[]).every((p) => typeof p === "string" && PID.test(p as string)))) return json({ error: "Bad match." }, 400);
    if (!Array.isArray(from) || from.length !== 2 || from[0] === from[1] || !from.every((x: unknown) => typeof x === "string" && MID.test(x))) return json({ error: "A match needs the two matches it comes from.", code: "needs-feeders" }, 400);
    if (!orgOpen && !boards.some(([x, y]: [string, string]) => x === who.pid || y === who.pid)) return json({ error: "You are not in this match.", code: "not-in-match" }, 403);
    // The registration is checked against the agreed results the mailbox holds (counting, never judging a board). A later match sits right above the two matches it comes from, its sides are the
    // winners of those two, its boards pair their members in order, and the moment it opens is worked out here from the stamps of those results, not taken from the caller.
    const [, rr, ii] = /^r(\d+)m(\d+)$/.exec(b.mid)!; const round = Number(rr), idx = Number(ii);
    if (b.round !== round || b.idx !== idx || round < 2 || round > (t.rounds ?? 0)) return json({ error: "Bad match." }, 400);
    if (from[0] !== `r${round - 1}m${2 * idx}` || from[1] !== `r${round - 1}m${2 * idx + 1}`) return json({ error: "A match needs the two matches it comes from.", code: "needs-feeders" }, 400);
    const sides = await sidesOf(env, t, [from[0], from[1]]);
    if (!sides) return json({ error: "The two earlier matches are not finished yet.", code: "feeders-not-done" }, 409);
    if (b.a !== sides.a || b.b !== sides.b || JSON.stringify(boards) !== JSON.stringify(sides.boards)) { await note(env, eid, "pairing", b.mid, who.pid, "A pairing was sent that the results do not give.", now); return json({ error: "That is not the pairing the results give. The Organizer was told.", code: "conflict" }, 409); }
    const have = await env.DB.prepare("SELECT 1 AS x FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first();
    if (have) return json({ ok: true, again: true });
    await env.DB.prepare("INSERT OR IGNORE INTO ttt_m(eid,mid,round,idx,a,b,status,bye,started_ms,deadline,data) VALUES(?,?,?,?,?,?,'live',0,?,?,?)").bind(eid, b.mid, round, idx, sides.a, sides.b, now, sides.opened, JSON.stringify(sides.boards)).run();
    return json({ ok: true });
  }

  // ------------------------------------------------------------------ move: the mailbox stores {mid, pid, seq, sq, client_ms} with its own clock stamp. It checks who may write and that seq is the next number. Nothing else.
  if (sub === "move" && method === "POST") {
    const b = await c.body(req, 512); if (!b) return json({ error: "Bad move." }, 400);
    const orgClaim = typeof b.pid !== "string" && c.allowed && b.absent === true; // the Organizer's page may post an "absent" claim for a board where nobody is present (it can never place a square)
    const who = orgClaim ? { pid: "organizer" } : await playerOf(c, b.pid, b.device); if (who instanceof Response) return who;
    if (t.state !== "running") return json({ error: t.state === "done" ? "The tournament is over." : "The tournament has not started.", code: t.state }, 409);
    if (t.pause_at) return json({ error: "The host paused the game. Your clock waits.", code: "paused" }, 409);
    if (typeof b.mid !== "string" || !MID.test(b.mid) || !Number.isInteger(b.seq) || b.seq < 0) return json({ error: "Bad move." }, 400);
    const absent = b.absent === true, sq = absent ? -1 : b.sq;
    if (!absent && (!Number.isInteger(sq) || sq < 0 || sq > 8)) return json({ error: "Pick a square on the board.", code: "bad-square" }, 400);
    const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first<MRow>();
    if (!m) return json({ error: "That match is not open yet.", code: "no-match" }, 404);
    const j = orgClaim ? (Number.isInteger(b.j) && b.j >= 0 && b.j < boardsOf(m).length ? b.j : -1) : boardOfPid(m, who.pid); if (j < 0) return json({ error: orgClaim ? "No such board." : "You are not in this match.", code: "not-in-match" }, orgClaim ? 404 : 403);
    if (await env.DB.prepare("SELECT 1 AS x FROM ttt_b WHERE eid=? AND mid=? AND j=? AND flag=0").bind(eid, b.mid, j).first()) return json({ error: "This board is finished.", code: "board-over" }, 409); // a disputed board (flag 1) is not finished: it is played on until the rules decide it
    const next = (await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_mv WHERE eid=? AND mid=? AND j=?").bind(eid, b.mid, j).first<{ c: number }>())?.c ?? 0;
    if (b.seq !== next) return json({ error: "The board changed. Look again.", code: "seq", next }, 409);
    if (((await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_mv WHERE eid=? AND mid=? AND j=? AND pid=?").bind(eid, b.mid, j, who.pid).first<{ c: number }>())?.c ?? 0) >= MAX_EVENTS_EACH) return json({ error: "Too many moves from you on this board.", code: "too-many" }, 429);
    try { await env.DB.prepare("INSERT INTO ttt_mv(eid,mid,j,seq,pid,sq,client_ms,at_ms) VALUES(?,?,?,?,?,?,?,?)").bind(eid, b.mid, j, b.seq, who.pid, sq, Number.isFinite(b.client_ms) ? Math.trunc(b.client_ms) : null, now).run(); }
    catch { return json({ error: "The board changed. Look again.", code: "seq", next: next + 1 }, 409); }
    return json({ ok: true, seq: b.seq, at: now });
  }

  // ------------------------------------------------------------------ the stored match, as it is: moves with the server's stamps, reports, the agreed result
  if (mailRead !== null && method === "GET") {
    if (t.state === "open") return json({ error: "The tournament has not started.", code: "open" }, 409);
    if (!MID.test(mailRead)) return json({ error: "Not found" }, 404);
    await sweep(env, eid, now, mailRead);
    const recs = await matchRecs(env, eid, [mailRead]);
    return json({ ...(recs[0] ?? { mid: mailRead, reg: null, complete: false, boards: [] }), t: { state: t.state, endedEarly: endedEarly(t), pauses: await pausesOf(env, eid), serverNow: now } });
  }

  // ------------------------------------------------------------------ result: one player's report. Two matching reports (or a single one nobody contradicts) are kept as the agreed result; different reports are flagged for the Organizer.
  if (sub === "result" && method === "POST") {
    const b = await c.body(req, 512); if (!b) return json({ error: "Bad result." }, 400);
    const orgReport = typeof b.pid !== "string" && c.allowed; // the Organizer's page reports a board where both players are away, like a third phone; it is kept only if nobody contradicts it
    const who = orgReport ? { pid: "organizer" } : await playerOf(c, b.pid, b.device); if (who instanceof Response) return who;
    if (t.state !== "running") return json({ error: "The tournament is not running.", code: t.state }, 409);
    if (typeof b.mid !== "string" || !MID.test(b.mid) || typeof b.winner !== "string") return json({ error: "Bad result." }, 400);
    const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first<MRow>();
    if (!m) return json({ error: "That match is not open yet.", code: "no-match" }, 404);
    const j = orgReport ? (Number.isInteger(b.j) && b.j >= 0 && b.j < boardsOf(m).length ? b.j : -1) : boardOfPid(m, who.pid); if (j < 0) return json({ error: "You are not in this match.", code: "not-in-match" }, 403);
    const pair = boardsOf(m)[j]!; if (b.winner !== OBJECTION && !pair.includes(b.winner)) return json({ error: "The winner must be one of the two players on the board.", code: "bad-winner" }, 400);
    const have = await env.DB.prepare("SELECT winner, flag, how FROM ttt_b WHERE eid=? AND mid=? AND j=?").bind(eid, b.mid, j).first<{ winner: string | null; flag: number; how: string }>();
    if (have && have.how === "organizer") return json({ ok: true, agreed: true }); // settled by the Organizer: nothing a player says changes it
    // A report can be corrected (an objection becomes the real winner) until a result is accepted; an accepted result can no longer be flipped by its reporter.
    await env.DB.prepare(have && !have.flag ? "INSERT OR IGNORE INTO ttt_r(eid,mid,j,pid,winner,at_ms) VALUES(?,?,?,?,?,?)" : "INSERT INTO ttt_r(eid,mid,j,pid,winner,at_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(eid,mid,j,pid) DO UPDATE SET winner=excluded.winner, at_ms=excluded.at_ms").bind(eid, b.mid, j, who.pid, b.winner, now).run();
    const said = ((await env.DB.prepare("SELECT winner FROM ttt_r WHERE eid=? AND mid=? AND j=?").bind(eid, b.mid, j).all<{ winner: string }>()).results ?? []).map((r) => r.winner);
    if (new Set(said).size > 1) { // two reports that differ (an objection counts): the Organizer's page settles it by the stored moves, or the Organizer does
      await env.DB.prepare("INSERT INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,NULL,'mismatch',1,?) ON CONFLICT(eid,mid,j) DO UPDATE SET winner=NULL, how='mismatch', flag=1, at_ms=excluded.at_ms").bind(eid, b.mid, j, now).run();
      if (!have || !have.flag) await note(env, eid, "mismatch", b.mid, who.pid, `Board ${j + 1}: the two reports do not match. Settle it in the console.`, now);
      await refreshMatch(env, eid, b.mid, now);
      return json({ ok: true, agreed: false, flagged: true });
    }
    if (said.length >= 2 && said[0] !== OBJECTION && (!have || have.flag)) { // two players name the same winner
      await env.DB.prepare("INSERT INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,?,'both',0,?) ON CONFLICT(eid,mid,j) DO UPDATE SET winner=excluded.winner, how='both', flag=0, at_ms=excluded.at_ms").bind(eid, b.mid, j, said[0]!, now).run();
      await refreshMatch(env, eid, b.mid, now);
      return json({ ok: true, agreed: true });
    }
    return json({ ok: true, agreed: !!have && !have.flag });
  }

  if (sub === "flag" && method === "POST") {
    const b = await c.body(req, 512); if (!b) return json({ error: "Bad request." }, 400);
    const who = await playerOf(c, b.pid, b.device); if (who instanceof Response) return who;
    if (((await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_x WHERE eid=? AND who=?").bind(eid, who.pid).first<{ c: number }>())?.c ?? 0) >= MAX_NOTES_EACH) return json({ ok: true, kept: false }); // enough notes from this player; the Organizer has them
    await note(env, eid, String(b.kind ?? "note").slice(0, 20), typeof b.mid === "string" && MID.test(b.mid) ? b.mid : null, who.pid, String(b.note ?? ""), now);
    return json({ ok: true });
  }
  if (sub === "flags" && method === "GET") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can see this." }, 403);
    const rows = (await env.DB.prepare("SELECT kind, mid, who, note, at_ms FROM ttt_x WHERE eid=? ORDER BY id DESC LIMIT 100").bind(eid).all()).results ?? [];
    const open = (await env.DB.prepare("SELECT mid, j FROM ttt_b WHERE eid=? AND flag=1 ORDER BY mid, j LIMIT 200").bind(eid).all<{ mid: string; j: number }>()).results ?? [];
    return json({ flags: rows, disputed: open });
  }

  // ------------------------------------------------------------------ settle: the Organizer decides a disputed or stuck board; this is the one place a person (not a phone) says who won
  if (sub === "settle" && method === "POST") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can settle a game." }, 403);
    const b = await c.body(req, 512); if (!b || typeof b.mid !== "string" || !MID.test(b.mid) || !Number.isInteger(b.j) || typeof b.winner !== "string") return json({ error: "Bad request." }, 400);
    if (t.state !== "running") return json({ error: "The tournament is not running." }, 409);
    const m = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, b.mid).first<MRow>();
    const pair = m ? boardsOf(m)[b.j] : null;
    if (!m || !pair) return json({ error: "No such board.", code: "no-match" }, 404);
    if (!pair.includes(b.winner)) return json({ error: "The winner must be one of the two players on the board.", code: "bad-winner" }, 400);
    await env.DB.prepare("INSERT INTO ttt_b(eid,mid,j,winner,how,flag,at_ms) VALUES(?,?,?,?,'organizer',0,?) ON CONFLICT(eid,mid,j) DO UPDATE SET winner=excluded.winner, how='organizer', flag=0, at_ms=excluded.at_ms").bind(eid, b.mid, b.j, b.winner, now).run();
    await refreshMatch(env, eid, b.mid, now);
    return json({ ok: true });
  }

  // ------------------------------------------------------------------ finish: the ranking that two different phones computed (or the Organizer's page alone); kept as sent
  if (sub === "finish" && method === "POST") {
    const b = await c.body(req, 40_000); if (!b) return json({ error: "Bad request." }, 400);
    if (t.state === "done") return json({ ok: true, done: true });
    if (t.state !== "running") return json({ error: "The tournament is not running.", code: t.state }, 409);
    let who: string, byOrganizer = false;
    if (typeof b.pid === "string") { const p = await playerOf(c, b.pid, b.device); if (p instanceof Response) return p; who = p.pid; }
    else if (c.allowed) { who = "organizer"; byOrganizer = true; }
    else return json({ error: "Not allowed." }, 403);
    const finalMid = `r${t.rounds ?? 0}m0`;
    const fm = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, finalMid).first<MRow>();
    if (!fm || fm.status !== "done") return json({ error: "The final is not finished.", code: "final-open" }, 409);
    if (!byOrganizer && boardOfPid(fm, who) < 0) return json({ error: "Only the finalists' phones or the Organizer's page can send the result.", code: "not-in-final" }, 403);
    const podium = b.podium, ranking = b.ranking;
    { // the champion and the first two places must be what the agreed results of the final give (two phones that agree on a made-up result are not enough)
      const won = await tally(env, t, finalMid, await pausesOf(env, eid)), cm = won ? await membersOf(env, eid, won.winner) : null;
      const same = (x: unknown, y: string[] | null) => Array.isArray(x) && !!y && x.length === y.length && x.every((p) => y.includes(p as string));
      if (!won || b.champion !== won.winner || !Array.isArray(podium) || !same(podium[0], cm)) return json({ error: "That is not the result the boards give.", code: "bad-result" }, 409);
      const everyone = [...new Set((podium as unknown[]).flat().filter((p): p is string => typeof p === "string"))];
      if (everyone.length > 25 || (everyone.length && ((await env.DB.prepare(`SELECT COUNT(*) AS c FROM ttt_p WHERE eid=? AND pid IN (${everyone.map(() => "?").join(",")})`).bind(eid, ...everyone).first<{ c: number }>())?.c ?? 0) !== everyone.length)) return json({ error: "That is not the result the boards give.", code: "bad-result" }, 409);
    }
    if (typeof b.champion !== "string" || b.finalMid !== finalMid || !Array.isArray(podium) || podium.length < 1 || podium.length > 5 || !podium.every((x: unknown) => Array.isArray(x) && x.length >= 1 && x.length <= 5 && (x as unknown[]).every((p) => typeof p === "string" && PID.test(p as string)))
      || !Array.isArray(ranking) || ranking.length < 1 || ranking.length > 100) return json({ error: "Bad result." }, 400);
    const clean = { champion: b.champion, rounds: t.rounds, finalMid, podium, ranking: ranking.map((r: any) => ({ rank: Number(r.rank), id: String(r.id).slice(0, 40), name: cleanName(r.name), roundReached: Number(r.roundReached), points: Number(r.points), decidedBy: String(r.decidedBy ?? "").slice(0, 40), tie: String(r.tie ?? "").slice(0, 200) })) };
    const payload = JSON.stringify(clean), digest = await sha(payload);
    await env.DB.prepare("INSERT OR REPLACE INTO ttt_f(eid,who,digest,payload,at_ms) VALUES(?,?,?,?,?)").bind(eid, who, digest, payload, now).run();
    const all = (await env.DB.prepare("SELECT who, digest FROM ttt_f WHERE eid=?").bind(eid).all<{ who: string; digest: string }>()).results ?? [];
    const same = all.filter((x) => x.digest === digest);
    if (all.some((x) => x.digest !== digest)) await note(env, eid, "finish-mismatch", finalMid, who, "Two phones computed a different ranking. The Organizer's page decides.", now);
    if (!(byOrganizer || same.length >= 2)) return json({ ok: true, done: false, waitingFor: "a second phone" });
    await finishWith(env, t, clean, now);
    return json({ ok: true, done: true });
  }

  if (sub === "rank" && method === "GET") return json({ done: t.state === "done", ranking: t.ranking ? JSON.parse(t.ranking).slice(0, Math.min(100, Number(c.url.searchParams.get("n") ?? 10) || 10)) : [], podium: t.state === "done" ? PODIUM.slice(0, 5) : [] });

  // ------------------------------------------------------------------ lists (public): counts for the big screen and the Organizer's page; matches page by page
  // a light list of the registered matches of a round: who is registered, whether the match is finished, the agreed winner of each board and when it was agreed (no moves). The Organizer's page uses it to see which later matches are ready to be registered.
  if (sub === "brief" && method === "GET") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can see this." }, 403);
    const q = c.url.searchParams; const round = Number(q.get("round") ?? 1) || 1, page = Math.max(0, Number(q.get("page") ?? 0) || 0);
    const ms = (await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND round=? ORDER BY idx LIMIT 300 OFFSET ?").bind(eid, round, page * 300).all<MRow>()).results ?? [];
    const bs = ms.length ? (await env.DB.prepare(`SELECT mid, j, winner, flag, at_ms FROM ttt_b WHERE eid=? AND mid IN (${ms.map(() => "?").join(",")})`).bind(eid, ...ms.map((m) => m.mid)).all<{ mid: string; j: number; winner: string | null; flag: number; at_ms: number }>()).results ?? [] : [];
    return json({ serverNow: now, pauses: await pausesOf(env, eid), matches: ms.map((m) => ({ mid: m.mid, a: m.a, b: m.b, bye: !!m.bye, winner: m.winner, opened: m.deadline, complete: m.status === "done", boards: boardsOf(m).map((_, j) => { const r = bs.find((x) => x.mid === m.mid && x.j === j); return { j, winner: r && !r.flag ? r.winner : null, ms: r?.at_ms ?? null }; }) })) });
  }
  // matches where nothing has been stored for a while (a pair of players who are both away): the Organizer's page looks at these and posts "absent" claims and the report, like any phone
  if (sub === "stuck" && method === "GET") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can see this." }, 403);
    const ms = Math.max(30_000, Number(c.url.searchParams.get("ms") ?? 90_000) || 90_000);
    const rows = (await env.DB.prepare("SELECT m.mid AS mid FROM ttt_m m WHERE m.eid=? AND m.status='live' AND m.bye=0 AND COALESCE((SELECT MAX(v.at_ms) FROM ttt_mv v WHERE v.eid=m.eid AND v.mid=m.mid), m.started_ms) < ? ORDER BY m.round DESC, m.idx LIMIT 200 OFFSET ?").bind(eid, now - ms, Math.max(0, Number(c.url.searchParams.get("page") ?? 0) || 0) * 200).all<{ mid: string }>()).results ?? [];
    return json({ serverNow: now, matches: await matchRecs(env, eid, rows.map((r) => r.mid)), pauses: await pausesOf(env, eid) });
  }
  if (sub === "view" && method === "GET") {
    await sweep(env, eid, now);
    const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
    const o = optsOf(t);
    const head = { serverNow: now, state: t.state, commit: t.commit_hash, paused: !!t.pause_at, joined, startedMs: t.started_ms, endedMs: t.ended_ms, endedEarly: endedEarly(t) };
    if (t.state === "open") return json({ ...head, phase: "waiting" });
    const counts = (await env.DB.prepare("SELECT round, status, COUNT(*) AS n FROM ttt_m WHERE eid=? AND bye=0 GROUP BY round, status").bind(eid).all<{ round: number; status: string; n: number }>()).results ?? [];
    const flags = (await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_b WHERE eid=? AND flag=1").bind(eid).first<{ c: number }>())?.c ?? 0;
    return json({ ...head, phase: t.state, format: o.format, teamSize: o.teamSize, moveSecs: (o.moveMs ?? 0) / 1000, players: t.players, entrants: t.entrants, rounds: t.rounds, perRound: counts.map((x) => ({ round: x.round, status: x.status, n: x.n })), disputed: flags, champion: t.champion ? ((await env.DB.prepare("SELECT name FROM ttt_e WHERE eid=? AND id=?").bind(eid, t.champion).first<{ name: string }>())?.name ?? null) : null, ranking: t.ranking ? JSON.parse(t.ranking).slice(0, 10) : [] });
  }
  if (sub === "all" && method === "GET") {
    if (t.state === "open") return json({ matches: [] });
    const q = c.url.searchParams; const round = Number(q.get("round") ?? 0), page = Math.max(0, Number(q.get("page") ?? 0)); const live = q.get("status") === "live";
    const rows = live
      ? (await env.DB.prepare("SELECT mid FROM ttt_m WHERE eid=? AND status='live' AND bye=0 ORDER BY round DESC, started_ms LIMIT ?").bind(eid, Math.min(LIVE_SAMPLE, Number(q.get("n") ?? LIVE_SAMPLE) || LIVE_SAMPLE)).all<{ mid: string }>()).results ?? []
      : (await env.DB.prepare("SELECT mid FROM ttt_m WHERE eid=? AND round=? ORDER BY idx LIMIT ? OFFSET ?").bind(eid, round, PAGE, page * PAGE).all<{ mid: string }>()).results ?? [];
    return json({ serverNow: now, matches: await matchRecs(env, eid, rows.map((r) => r.mid)), pauses: await pausesOf(env, eid) });
  }
  return json({ error: "Not found" }, 404);
}

const PODIUM = ["first", "second", "third", "fourth", "fifth"] as const;
/** Over, but not because the final was played: no champion and no ranking. */
const endedEarly = (t: Pick<TRow, "state" | "champion">): boolean => t.state === "done" && !t.champion;
/** The Organizer or a Host ended the tournament: it is over for everybody now, any pause is closed, the deletion clock starts (the same clock a finished tournament has). */
async function endEarly(env: Env, t: TRow, now: number): Promise<void> {
  const eid = t.eid;
  await env.DB.batch([
    env.DB.prepare("UPDATE ttt_t SET state='done', ended_ms=?, pause_at=NULL WHERE eid=? AND state<>'done'").bind(now, eid),
    env.DB.prepare("UPDATE ttt_z SET to_ms=? WHERE eid=? AND to_ms IS NULL").bind(now, eid),
    env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(eid, now),
  ]);
  t.state = "done";
}
/** The tournament is over because two phones (or the Organizer's page) sent the same ranking: store it, put the podium into the winners record (opaque seat numbers, never names), start the deletion clock. */
async function finishWith(env: Env, t: TRow, r: { champion: string; podium: string[][]; ranking: unknown[] }, now: number): Promise<void> {
  const eid = t.eid;
  const o = optsOf(t); void o;
  const endMs = now;
  const stmts = [env.DB.prepare("UPDATE ttt_t SET state='done', ended_ms=?, champion=?, ranking=? WHERE eid=?").bind(endMs, r.champion, JSON.stringify(r.ranking), eid)];
  r.podium.forEach((members, i) => {
    const place = PODIUM[i]; if (!place) return;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settled(eid,pattern,ordinal,round,idx,pids) VALUES(?,?,?,?,?,?)").bind(eid, place, 1, 1, 0, JSON.stringify(members)));
    for (const pid of members) { const seat = parseInt(pid, 10); if (Number.isFinite(seat)) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO winner(eid,round,pattern,ordinal,seat,idx,at_ms,src) VALUES(?,?,?,?,?,?,?,?)").bind(eid, 1, place, 1, seat, 0, endMs, "ttt")); }
  });
  stmts.push(env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(eid, endMs));
  await env.DB.batch(stmts);
  t.state = "done";
}

/** Matches as stored: who is registered on which board, every stored event of each board with the server's stamp, the reports and the agreed result. No board is evaluated. */
async function matchRecs(env: Env, eid: string, mids: string[]): Promise<any[]> {
  if (!mids.length) return [];
  const ph = mids.map(() => "?").join(",");
  const ms = (await env.DB.prepare(`SELECT * FROM ttt_m WHERE eid=? AND mid IN (${ph})`).bind(eid, ...mids).all<MRow>()).results ?? [];
  const rp = (await env.DB.prepare(`SELECT mid, j, pid, winner FROM ttt_r WHERE eid=? AND mid IN (${ph})`).bind(eid, ...mids).all<{ mid: string; j: number; pid: string; winner: string }>()).results ?? [];
  const bs = (await env.DB.prepare(`SELECT mid, j, winner, how, flag, at_ms FROM ttt_b WHERE eid=? AND mid IN (${ph})`).bind(eid, ...mids).all<{ mid: string; j: number; winner: string | null; how: string; flag: number; at_ms: number }>()).results ?? [];
  // the stored moves are read LAST: a report is only sent after the moves that decide the board are stored, so a reader that sees a report also sees those moves (read the other way round, a phone could see a report without its moves and wrongly object)
  const ev = (await env.DB.prepare(`SELECT mid, j, seq, pid, sq, client_ms, at_ms FROM ttt_mv WHERE eid=? AND mid IN (${ph}) ORDER BY mid, j, seq`).bind(eid, ...mids).all<{ mid: string; j: number; seq: number; pid: string; sq: number; client_ms: number | null; at_ms: number }>()).results ?? [];
  return ms.map((m) => ({
    mid: m.mid, complete: m.status === "done", reg: { round: m.round, idx: m.idx, a: m.a, b: m.b, bye: !!m.bye, winner: m.winner, opened: m.deadline, ms: m.started_ms },
    boards: boardsOf(m).map(([a, b], j) => ({
      j, a, b,
      events: ev.filter((e) => e.mid === m.mid && e.j === j).map((e) => ({ seq: e.seq, pid: e.pid, sq: e.sq, ms: e.at_ms, client: e.client_ms })),
      reports: rp.filter((r) => r.mid === m.mid && r.j === j).map((r) => ({ pid: r.pid, winner: r.winner })),
      result: ((x) => (x ? { winner: x.winner, how: x.how, ms: x.at_ms, ...(x.flag ? { flag: true } : {}) } : null))(bs.find((y) => y.mid === m.mid && y.j === j)),
    })),
  }));
}
