// The tournament store and routes for Corporate Tic Tac Toe. The game itself (rules, clocks, bracket, ranking) is packages/ttt; this file only keeps its state in D1 and answers the phones.
//
// One row per match (never one big blob), so a move writes one small row and a crowd of 10,000 does not make every request read 10,000 rows.
// The server decides everything: the browser sends only "my square" with its own random device id. The seed is sealed (packages/ttt/src/seal.ts): the fingerprint is public from the first look,
// the secret is revealed at the start, and anybody can check the bracket and every starter afterwards (GET .../ttt/reveal).
//
// Routes (all under /api/z/{eid}/ttt/):  view (public)  me (a player)  move (a player)  start / pause / resume (Organizer or Host)  rank (public)  reveal (public after the start)  tick (platform key / scheduled job)
import {
  advanceMatchP, feedersOf, midOf, newSecret, commitOf, openMatchP, parentOf, rankings, roundName, seedOf, startTournament, tieLine, applyMove, boardInMatch, moverOf, lastGame,
  type BoardState, type Entrant, type MatchCtx, type MatchState, type Tournament,
} from "../../../packages/ttt/src/index";
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

export const TTT_MOVE_SECONDS = [10, 20, 30, 60] as const;
const MAX_MS = 6 * 3_600_000; // a tournament that has not finished this long after its scheduled start is closed for the data-deletion clock (lifecycle.ts)
const PAGE = 50, LIVE_SAMPLE = 24;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

interface TRow { eid: string; commit_hash: string; secret: string | null; state: "open" | "running" | "done"; opts: string | null; seed: string | null; size: number | null; rounds: number | null; entrants: number | null; players: number | null; started_ms: number | null; ended_ms: number | null; pause_at: number | null; pause_total: number; champion: string | null; ranking: string | null }
interface MRow { eid: string; mid: string; round: number; idx: number; a: string | null; b: string | null; status: "waiting" | "live" | "done"; bye: number; deadline: number | null; winner: string | null; loser: string | null; started_ms: number | null; done_ms: number | null; data: string | null }
type Opts = { format: "solo" | "team"; teamSize: number; moveMs: number; readyMs: number };

/** The tournament clock: wall time minus every pause, so a pause costs nobody any time. */
const effNow = (t: TRow, now: number) => now - t.pause_total - (t.pause_at ? now - t.pause_at : 0);
const optsOf = (t: TRow): Opts => JSON.parse(t.opts ?? "{}");

export async function ensureT(env: Env, eid: string): Promise<TRow> {
  const have = await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(eid).first<TRow>();
  if (have) return have;
  const secret = newSecret(), commit = await commitOf(secret);
  await env.DB.prepare("INSERT OR IGNORE INTO ttt_t(eid,commit_hash,secret) VALUES(?,?,?)").bind(eid, commit, secret).run();
  return (await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(eid).first<TRow>())!;
}
export const tournamentStarted = async (env: Env, eid: string): Promise<boolean> => !!(await env.DB.prepare("SELECT 1 AS x FROM ttt_t WHERE eid=? AND state<>'open'").bind(eid).first());

const rowToMatch = (r: MRow): MatchState => ({ mid: r.mid, round: r.round, idx: r.idx, a: r.a, b: r.b, status: r.status, ...(r.bye ? { bye: true as const } : {}), ...(r.winner ? { winner: r.winner } : {}), ...(r.loser ? { loser: r.loser } : {}), ...(r.started_ms !== null ? { startedAt: r.started_ms } : {}), ...(r.done_ms !== null ? { doneAt: r.done_ms } : {}), boards: r.data ? JSON.parse(r.data) : [] });
const deadlineOf = (m: MatchState): number | null => { const d = m.boards.filter((b) => !b.done).map((b) => lastGame(b).deadline); return m.status === "live" && d.length ? Math.min(...d) : null; };
const saveStmt = (env: Env, eid: string, m: MatchState) => env.DB.prepare(
  "INSERT INTO ttt_m(eid,mid,round,idx,a,b,status,bye,deadline,winner,loser,started_ms,done_ms,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(eid,mid) DO UPDATE SET a=excluded.a,b=excluded.b,status=excluded.status,bye=excluded.bye,deadline=excluded.deadline,winner=excluded.winner,loser=excluded.loser,started_ms=excluded.started_ms,done_ms=excluded.done_ms,data=excluded.data",
).bind(eid, m.mid, m.round, m.idx, m.a, m.b, m.status, m.bye ? 1 : 0, deadlineOf(m), m.winner ?? null, m.loser ?? null, m.startedAt ?? null, m.doneAt ?? null, JSON.stringify(m.boards));
const getMatch = async (env: Env, eid: string, mid: string): Promise<MatchState | null> => { const r = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND mid=?").bind(eid, mid).first<MRow>(); return r ? rowToMatch(r) : null; };

async function entrantsByIds(env: Env, eid: string, ids: (string | null)[]): Promise<Map<string, Entrant>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))]; const out = new Map<string, Entrant>();
  for (let i = 0; i < want.length; i += 80) {
    const part = want.slice(i, i + 80);
    const r = await env.DB.prepare(`SELECT id,name,members FROM ttt_e WHERE eid=? AND id IN (${part.map(() => "?").join(",")})`).bind(eid, ...part).all<{ id: string; name: string; members: string }>();
    for (const x of r.results ?? []) out.set(x.id, { id: x.id, name: x.name, members: JSON.parse(x.members) });
  }
  return out;
}
const ctxFor = (t: TRow, ents: Map<string, Entrant>): MatchCtx => {
  const o = optsOf(t);
  return { cfg: { seed: t.seed!, moveMs: o.moveMs, readyMs: o.readyMs }, rounds: t.rounds!, size: t.size!, startAt: t.started_ms ?? 0, entrant: (id) => ents.get(id)! };
};

/** Brings one match up to time `eff`: plays the clock-outs that are due; when it ends, moves the winner up and opens the next match (which may itself already be due). Saves everything it changed. */
async function settleFrom(env: Env, t: TRow, first: MatchState, eff: number): Promise<void> {
  const queue: MatchState[] = [first]; const eid = t.eid;
  while (queue.length) {
    const m = queue.shift()!;
    const ents = await entrantsByIds(env, eid, [m.a, m.b]); const c = ctxFor(t, ents);
    const wasLive = m.status === "live";
    const finished = wasLive ? await advanceMatchP(c, m, eff) : false;
    await saveStmt(env, eid, m).run();
    if (!finished) continue;
    const p = parentOf(c, m);
    if (!p) { await finishTournament(env, t, m, eff); continue; }
    let pm = await getMatch(env, eid, p.mid);
    if (!pm) { const [r, i] = [m.round + 1, m.idx >> 1]; pm = { mid: p.mid, round: r, idx: i, a: null, b: null, boards: [], status: "waiting" }; }
    pm[p.side] = m.winner!;
    if (pm.a && pm.b && pm.status === "waiting") {
      const fs = feedersOf(pm)!; const sib = await getMatch(env, eid, fs[0] === m.mid ? fs[1] : fs[0]);
      const pents = await entrantsByIds(env, eid, [pm.a, pm.b]);
      await openMatchP(ctxFor(t, pents), pm, Math.max(c.startAt, m.doneAt ?? 0, sib?.doneAt ?? 0));
      queue.push(pm); // it may already be due
    } else await saveStmt(env, eid, pm).run();
  }
}

const PODIUM = ["first", "second", "third", "fourth", "fifth"] as const;
/** The tournament is over: the strict ranking is made once and stored; the podium goes into the winners record (opaque seat numbers, never names). */
async function finishTournament(env: Env, t: TRow, fin: MatchState, eff: number): Promise<void> {
  const eid = t.eid;
  const ents = new Map<string, Entrant>(); const er = await env.DB.prepare("SELECT id,name,members FROM ttt_e WHERE eid=?").bind(eid).all<{ id: string; name: string; members: string }>();
  for (const x of er.results ?? []) ents.set(x.id, { id: x.id, name: x.name, members: JSON.parse(x.members) });
  const mr = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=?").bind(eid).all<MRow>();
  const matches: Record<string, MatchState> = {}; for (const r of mr.results ?? []) matches[r.mid] = rowToMatch(r);
  matches[fin.mid] = fin;
  const o = optsOf(t);
  const tour: Tournament = { v: 1, eid, format: o.format, teamSize: o.teamSize, moveMs: o.moveMs, readyMs: o.readyMs, seed: t.seed!, entrants: [...ents.values()], reserve: [], size: t.size!, rounds: t.rounds!, startAt: t.started_ms ?? 0, matches, done: true, champion: fin.winner!, names: {} };
  const rk = await rankings(tour);
  const top = rk.slice(0, 100).map((r, i) => ({ rank: r.rank, id: r.id, name: r.name, roundReached: r.roundReached, points: r.points, decidedBy: r.decidedBy, tie: i ? tieLine(r, rk[i - 1]!.name) : "" }));
  const endMs = eff + t.pause_total;
  const stmts = [env.DB.prepare("UPDATE ttt_t SET state='done', ended_ms=?, champion=?, ranking=? WHERE eid=?").bind(endMs, fin.winner, JSON.stringify(top), eid)];
  PODIUM.forEach((place, i) => {
    const r = rk[i]; if (!r) return;
    const members = ents.get(r.id)?.members ?? [r.id];
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settled(eid,pattern,ordinal,round,idx,pids) VALUES(?,?,?,?,?,?)").bind(eid, place, 1, 1, 0, JSON.stringify(members)));
    for (const pid of members) { const seat = parseInt(pid, 10); if (Number.isFinite(seat)) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO winner(eid,round,pattern,ordinal,seat,idx,at_ms,src) VALUES(?,?,?,?,?,?,?,?)").bind(eid, 1, place, 1, seat, 0, endMs, "ttt")); }
  });
  stmts.push(env.DB.prepare("INSERT INTO life(eid,end_ms,end_src) VALUES(?,?,'phones') ON CONFLICT(eid) DO UPDATE SET end_ms=excluded.end_ms, end_src='phones' WHERE life.purged_ms IS NULL").bind(eid, endMs));
  await env.DB.batch(stmts);
  t.state = "done";
}

/** Runs every clock-out that is due, for the running tournaments (the scheduled job, and any look at the tournament, call it). Bounded work per call. */
export async function tttTick(env: Env, now: number, perTournament = 100): Promise<number> {
  let n = 0;
  const ts = await env.DB.prepare("SELECT * FROM ttt_t WHERE state='running' AND pause_at IS NULL").all<TRow>();
  for (const t of ts.results ?? []) {
    const eff = effNow(t, now);
    const due = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND status='live' AND deadline<? ORDER BY deadline LIMIT ?").bind(t.eid, eff, perTournament).all<MRow>();
    for (const r of due.results ?? []) { await settleFrom(env, t, rowToMatch(r), eff); n++; }
  }
  return n;
}
async function dueFor(env: Env, t: TRow, now: number): Promise<TRow> {
  if (t.state !== "running" || t.pause_at) return t;
  const eff = effNow(t, now);
  const due = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND status='live' AND deadline<? ORDER BY deadline LIMIT 20").bind(t.eid, eff).all<MRow>();
  for (const r of due.results ?? []) await settleFrom(env, t, rowToMatch(r), eff);
  return (await env.DB.prepare("SELECT * FROM ttt_t WHERE eid=?").bind(t.eid).first<TRow>())!;
}

export function endBoundTtt(startMs: number, t: { ended_ms: number | null } | null): number { return t?.ended_ms ? t.ended_ms + 60_000 : startMs + MAX_MS; }

// ---------------------------------------------------------------------------------------------------------------- routes
export interface TttCtx {
  env: Env; req: Request; now: number; eid: string; e: any; sub: string; url: URL;
  body: (req: Request, max?: number) => Promise<any | null>; spend: (env: Env, now: number, n?: number) => Promise<boolean>;
  allowed: boolean; /** Organizer or Host (not the AI) */ openName: (pii: string | null) => Promise<string | null>; gate: Response | null; BUSY: () => Response;
}

const cleanName = (n: unknown) => String(n ?? "").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "Player";

async function playerOf(c: TttCtx, pid: unknown, device: unknown): Promise<{ pid: string } | Response> {
  if (typeof pid !== "string" || typeof device !== "string" || !/^[0-9a-f]{16,64}$/.test(device)) return json({ error: "Open the game link on your own phone." }, 400);
  const seat = await c.env.DB.prepare("SELECT s.dev AS dev, s.blocked AS blocked FROM seat s WHERE s.eid=? AND s.pid=?").bind(c.eid, pid).first<{ dev: string | null; blocked: number | null }>();
  if (!seat) return json({ error: "You are not in this game." }, 403);
  if (seat.blocked) return json({ error: "You were removed from this game by the organizer.", code: "removed" }, 403);
  if (!seat.dev || seat.dev !== (await sha(`dev|${c.eid}|${device}`)).slice(0, 32)) return json({ error: "This place is on another phone.", code: "other-phone" }, 403);
  return { pid };
}

export async function tttRoute(c: TttCtx): Promise<Response> {
  const { env, req, now, eid, sub } = c;
  if (c.gate) return c.gate; // cancelled, did not start, draft, locked: the same answers as every other route
  const method = req.method;
  let t = await ensureT(env, eid);
  t = await dueFor(env, t, now);
  const eff = effNow(t, now), wall = (d: number) => d + t.pause_total;

  if (sub === "tick" && method === "POST") { if (!c.allowed) return json({ error: "Not allowed." }, 403); return json({ ok: true, processed: await tttTick(env, now) }); }

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
    if (!(await c.spend(env, now, players.length * 2 + 8))) return c.BUSY();
    const seed = await seedOf(t.secret!, eid, players.map((p) => p.pid), beacon);
    let tour: Tournament;
    try { tour = await startTournament({ eid, seed, players, format, teamSize, moveMs: moveSecs * 1000, readyMs: 30_000, startAt: now }); } catch (err) { return json({ error: String((err as Error).message) }, 400); }
    const o: Opts = { format, teamSize, moveMs: moveSecs * 1000, readyMs: 30_000 };
    const names = new Map(players.map((p) => [p.pid, p.name])); const entOf = new Map<string, string>(); for (const e of tour.entrants) for (const m of e.members) entOf.set(m, e.id);
    const stmts: any[] = [env.DB.prepare("UPDATE ttt_t SET state='running', opts=?, seed=?, size=?, rounds=?, entrants=?, players=?, started_ms=? WHERE eid=?").bind(JSON.stringify(o), seed, tour.size, tour.rounds, tour.entrants.length, players.length, now, eid)];
    for (const e of tour.entrants) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_e(eid,id,name,members) VALUES(?,?,?,?)").bind(eid, e.id, e.name, JSON.stringify(e.members)));
    for (const p of players) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ttt_p(eid,pid,name,ent) VALUES(?,?,?,?)").bind(eid, p.pid, names.get(p.pid)!, entOf.get(p.pid) ?? null));
    for (const m of Object.values(tour.matches)) if (m.status !== "waiting" || m.a || m.b) stmts.push(saveStmt(env, eid, m));
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    return json({ ok: true, players: players.length, entrants: tour.entrants.length, reserve: tour.reserve.length, rounds: tour.rounds, commit: t.commit_hash, secretShownAt: "reveal" });
  }

  if ((sub === "pause" || sub === "resume") && method === "POST") {
    if (!c.allowed) return json({ error: "Only the Organizer or a Host can pause." }, 403);
    if (t.state !== "running") return json({ error: "The tournament is not running." }, 409);
    if (sub === "pause" && !t.pause_at) await env.DB.prepare("UPDATE ttt_t SET pause_at=? WHERE eid=?").bind(now, eid).run();
    if (sub === "resume" && t.pause_at) await env.DB.prepare("UPDATE ttt_t SET pause_total=pause_total+?, pause_at=NULL WHERE eid=?").bind(now - t.pause_at, eid).run();
    return json({ ok: true, paused: sub === "pause" });
  }

  if (sub === "reveal" && method === "GET") {
    if (t.state === "open") return json({ commit: t.commit_hash, revealed: false, note: "The secret is shown when the host starts. This fingerprint cannot be changed after that." });
    return json({ commit: t.commit_hash, revealed: true, secret: t.secret, seed: t.seed, eid, how: "commit = sha256('TTT-COMMIT|' + secret); seed = sha256('TTT-SEED|' + secret + '|' + eid + '|' + sha256('TTT-ROSTER|' + sorted player ids joined by comma) + '|' + beacon). The code is packages/ttt/src/seal.ts." });
  }

  if (sub === "move" && method === "POST") {
    const b = await c.body(req, 512);
    if (!b) return json({ error: "Bad move." }, 400);
    const who = await playerOf(c, b.pid, b.device); if (who instanceof Response) return who;
    if (t.state !== "running") return json({ error: t.state === "done" ? "The tournament is over." : "The tournament has not started.", code: t.state }, 409);
    if (t.pause_at) return json({ error: "The host paused the game. Your clock waits.", code: "paused" }, 409);
    const p = await env.DB.prepare("SELECT ent FROM ttt_p WHERE eid=? AND pid=?").bind(eid, who.pid).first<{ ent: string | null }>();
    if (!p?.ent) return json({ error: "You are watching this tournament." , code: "watching" }, 409);
    const r = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND status='live' AND (a=? OR b=?)").bind(eid, p.ent, p.ent).first<MRow>();
    if (!r) return json({ error: "You have no game to play right now.", code: "no-board" }, 409);
    const m = rowToMatch(r); const ents = await entrantsByIds(env, eid, [m.a, m.b]); const cx = ctxFor(t, ents);
    const board = boardInMatch(m, who.pid);
    if (!board) return json({ error: "You have no game to play right now.", code: "no-board" }, 409);
    const res = await applyMove(cx.cfg, m.mid, board, who.pid, Number(b.cell), eff, Number.isInteger(b.ply) ? b.ply : undefined);
    if (!res.ok) { await settleFrom(env, t, m, eff); return json({ error: moveError(res.error), code: res.error }, res.error === "stale" || res.error === "not-your-turn" ? 409 : 400); }
    await settleFrom(env, t, m, eff);
    return json({ ok: true });
  }

  if (sub === "me" && method === "GET") return me(c, t, eff, wall);
  if (sub === "rank" && method === "GET") return json({ done: t.state === "done", ranking: t.ranking ? JSON.parse(t.ranking).slice(0, Math.min(100, Number(c.url.searchParams.get("n") ?? 10) || 10)) : [], podium: t.state === "done" ? PODIUM.slice(0, 5) : [] });
  if (sub === "view" && method === "GET") return view(c, t, eff, wall);
  return json({ error: "Not found" }, 404);
}

const moveError = (e: string) => ({ "not-your-turn": "It is not your turn.", "square-taken": "That square is taken.", "bad-square": "Pick a square on the board.", "match-over": "This game is over.", stale: "The board changed. Look again.", "not-in-board": "You are not in this game." } as Record<string, string>)[e] ?? "Move refused.";

async function nameOf(env: Env, eid: string, ent: string | null): Promise<string> { if (!ent) return "-"; return (await env.DB.prepare("SELECT name FROM ttt_e WHERE eid=? AND id=?").bind(eid, ent).first<{ name: string }>())?.name ?? "-"; }
async function pnames(env: Env, eid: string, pids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}; const want = [...new Set(pids)];
  for (let i = 0; i < want.length; i += 80) { const part = want.slice(i, i + 80); const r = await env.DB.prepare(`SELECT pid,name FROM ttt_p WHERE eid=? AND pid IN (${part.map(() => "?").join(",")})`).bind(eid, ...part).all<{ pid: string; name: string }>(); for (const x of r.results ?? []) out[x.pid] = x.name; }
  return out;
}

const boardJson = (b: BoardState, names: Record<string, string>, wall: (d: number) => number, paused: boolean, me?: string) => {
  const g = b.games[b.games.length - 1]!; const mover = b.done ? null : moverOf(g);
  return { j: b.j, a: names[b.a] ?? "?", b: names[b.b] ?? "?", cells: [...g.cells], x: names[g.x] ?? "?", o: names[g.o] ?? "?", gameNo: g.no, games: b.games.length, turn: mover ? names[mover] ?? "?" : null, deadlineMs: b.done || paused ? null : wall(g.deadline), done: b.done, winner: b.winner ? names[b.winner] ?? "?" : null, via: b.via ?? null, ply: g.moves.length, lastAuto: g.moves.length ? !!g.moves[g.moves.length - 1]!.auto : false, ...(me ? { yourMark: g.x === me ? "X" : g.o === me ? "O" : null, yourTurn: mover === me } : {}) };
};

async function me(c: TttCtx, t: TRow, eff: number, wall: (d: number) => number): Promise<Response> {
  const { env, eid } = c; const q = c.url.searchParams;
  const who = await playerOf(c, q.get("pid"), q.get("device")); if (who instanceof Response) return who;
  const base = { serverNow: c.now, state: t.state, commit: t.commit_hash, paused: !!t.pause_at };
  if (t.state === "open") return json({ ...base, phase: "waiting", joined: (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0, message: "You are in. Waiting for the host to start." });
  const p = await env.DB.prepare("SELECT name, ent FROM ttt_p WHERE eid=? AND pid=?").bind(eid, who.pid).first<{ name: string; ent: string | null }>();
  if (!p) return json({ ...base, phase: "watching", message: "The list closed before you joined. You can watch." });
  if (!p.ent) return json({ ...base, phase: "reserve", you: p.name, message: "There were not enough players for a full team for you. You can watch the games." });
  const live = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND status='live' AND (a=? OR b=?)").bind(eid, p.ent, p.ent).first<MRow>();
  if (live) {
    const m = rowToMatch(live); const oppEnt = m.a === p.ent ? m.b : m.a; const ents = await entrantsByIds(env, eid, [m.a, m.b]);
    const names = await pnames(env, eid, m.boards.flatMap((b) => [b.a, b.b]));
    const mine = boardInMatch(m, who.pid);
    return json({ ...base, phase: "playing", you: p.name, round: m.round, roundName: roundName({ rounds: t.rounds! } as any, m.round), team: ents.get(p.ent)?.name, vs: ents.get(oppEnt!)?.name, board: mine ? boardJson(mine, names, wall, !!t.pause_at, who.pid) : null, boards: m.boards.map((b) => boardJson(b, names, wall, !!t.pause_at)) });
  }
  const last = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND (a=? OR b=?) AND status='done' AND bye=0 ORDER BY round DESC LIMIT 1").bind(eid, p.ent, p.ent).first<MRow>();
  const lm = last ? rowToMatch(last) : null;
  if (t.state === "done" && t.champion === p.ent) return json({ ...base, phase: "champion", you: p.name, message: "You won the tournament.", ranking: t.ranking ? JSON.parse(t.ranking).slice(0, 10) : [] });
  if (lm && lm.loser === p.ent) return json({ ...base, phase: "out", you: p.name, roundName: roundName({ rounds: t.rounds! } as any, lm.round), message: t.state === "done" ? "The tournament is over." : "You are out. You can watch the rest.", place: (t.ranking ? (JSON.parse(t.ranking) as any[]).find((r) => r.id === p.ent)?.rank : null) ?? null, ranking: t.ranking ? JSON.parse(t.ranking).slice(0, 10) : [] });
  return json({ ...base, phase: "next", you: p.name, message: lm ? "You won. Waiting for your next opponent." : "You have a free pass this round. Waiting for your opponent." });
}

async function view(c: TttCtx, t: TRow, eff: number, wall: (d: number) => number): Promise<Response> {
  const { env, eid } = c; const q = c.url.searchParams;
  const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
  const head = { serverNow: c.now, state: t.state, commit: t.commit_hash, paused: !!t.pause_at, joined, startedMs: t.started_ms, endedMs: t.ended_ms };
  if (t.state === "open") return json({ ...head, phase: "waiting" });
  const o = optsOf(t); const roundWords = (r: number) => roundName({ rounds: t.rounds! } as any, r);
  const round = Number(q.get("round") ?? 0), page = Math.max(0, Number(q.get("page") ?? 0));
  const names = async (ms: MatchState[]) => pnames(env, eid, ms.flatMap((m) => m.boards.flatMap((b) => [b.a, b.b])));
  const show = async (rows: MRow[]) => {
    const ms = rows.map(rowToMatch); const pn = await names(ms); const en = await entrantsByIds(env, eid, ms.flatMap((m) => [m.a, m.b]));
    return ms.map((m) => ({ mid: m.mid, round: m.round, roundName: roundWords(m.round), a: en.get(m.a ?? "")?.name ?? "-", b: en.get(m.b ?? "")?.name ?? "-", status: m.status, bye: !!m.bye, winner: m.winner ? en.get(m.winner)?.name ?? null : null, boards: m.boards.map((b) => boardJson(b, pn, wall, !!t.pause_at)) }));
  };
  if (round > 0) { const r = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND round=? ORDER BY idx LIMIT ? OFFSET ?").bind(eid, round, PAGE, page * PAGE).all<MRow>(); return json({ ...head, phase: t.state, round, page, pageSize: PAGE, matches: await show(r.results ?? []) }); }
  const counts = await env.DB.prepare("SELECT round, status, COUNT(*) AS n FROM ttt_m WHERE eid=? AND bye=0 GROUP BY round, status").bind(eid).all<{ round: number; status: string; n: number }>();
  const liveRows = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND status='live' ORDER BY round DESC, deadline LIMIT ?").bind(eid, LIVE_SAMPLE).all<MRow>();
  const finalRow = await env.DB.prepare("SELECT * FROM ttt_m WHERE eid=? AND round=?").bind(eid, t.rounds!).all<MRow>();
  return json({ ...head, phase: t.state, format: o.format, teamSize: o.teamSize, moveSecs: o.moveMs / 1000, players: t.players, entrants: t.entrants, rounds: t.rounds, roundNames: Array.from({ length: t.rounds! }, (_, i) => roundWords(i + 1)),
    perRound: (counts.results ?? []).map((x) => ({ round: x.round, status: x.status, n: x.n })), live: await show(liveRows.results ?? []), final: await show(finalRow.results ?? []),
    champion: t.champion ? await nameOf(env, eid, t.champion) : null, ranking: t.ranking ? JSON.parse(t.ranking).slice(0, 10) : [] });
}
