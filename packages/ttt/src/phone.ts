// The phone side of Corporate Tic Tac Toe: EVERYTHING that decides anything runs here, in the browser (and in the simulation, which runs this same code).
// The server is a mailbox (apps/edge/src/tournament.ts): it stores the sealed seed, the player list, the moves with its own clock stamp, the two players' reports and the Organizer's settlements, and hands them back. It never looks at a board.
//
// What a phone does, in order:
//   1. reads the public setup (seed, player list, move clock, pauses) and builds the bracket and every starter itself from the sealed seed (bracket.ts, unchanged);
//   2. finds its own match, reads the stored moves of that match and replays them with the rules (match.ts, unchanged) to know the board and the clocks;
//   3. plays: posts "my square" with the next number; when the opponent's clock has run out it posts an "opponent absent" claim, stamped by the server;
//      the clock-out, the forfeit and the winner are then computed by every phone from the stored, server-stamped events;
//   4. reports the winner of its board; the server keeps the result when both players' reports agree (or when nobody contradicts a single report), and lists it;
//   5. builds the next round's pairing from the listed results (feedersOf, parentOf) and registers the next match.
import { sha256Hex } from "./hash";
import { advanceBoard, applyMove, lastGame, moverOf, type BoardState } from "./match";
import { ctxOf, feedersOf, finalizeMatchP, midOf, openMatchP, parentOf, rankings, roundName, startTournament, tieLine, type Entrant, type MatchCtx, type MatchState, type PlayerIn, type Tournament } from "./bracket";

/** Square number of an "opponent absent" claim in the stored event list (a move has 0 to 8). */
export const ABSENT = -1;

export interface Opts { format: "solo" | "team"; teamSize: number; moveMs: number; readyMs: number }
export interface Setup {
  eid: string; state: "open" | "starting" | "running" | "done"; commit: string; secret?: string; seed?: string; roster?: PlayerIn[]; opts?: Opts;
  startedMs: number | null; endedMs?: number | null; pauses: [number, number | null][]; serverNow: number; planDigest?: string | null; joined?: number; rounds?: number; entrants?: number;
}
export interface EventRow { seq: number; pid: string; sq: number; ms: number; client?: number | null }
export interface ResultRec { winner: string | null; how: string; ms: number; flag?: boolean }
export interface BoardRec { j: number; a: string; b: string; events: EventRow[]; result: ResultRec | null; reports: { pid: string; winner: string }[] }
export interface MatchRec { mid: string; reg: { round: number; idx: number; a: string; b: string; bye: boolean; winner?: string | null; opened: number | null; ms: number | null } | null; complete: boolean; boards: BoardRec[]; t: { state: Setup["state"]; pauses: [number, number | null][]; serverNow: number } }
export type Api = (method: "GET" | "POST", path: string, body?: unknown) => Promise<any>;

// ---------------------------------------------------------------------------------------------------------------- time
/** The tournament clock: wall time minus every pause, so a pause costs nobody any time. */
export function effOf(pauses: readonly [number, number | null][], wall: number): number {
  let cut = 0; for (const [f, t] of pauses) if (wall > f) cut += Math.min(wall, t ?? Infinity) - f;
  return wall - cut;
}
/** Back from the tournament clock to wall time (for the countdown on the screen); a pause that is open now moves nothing here. */
export const wallOf = (pauses: readonly [number, number | null][], eff: number): number => eff + pauses.reduce((s, [f, t]) => s + (t === null ? 0 : t - f), 0);

// ---------------------------------------------------------------------------------------------------------------- the bracket, from the sealed seed
export interface Plan { t: Tournament; opts: Opts; entOfPid: Map<string, string>; r1: Map<string, string>; digest: string; names: Record<string, string>; /** the entrants by id, made once */ E: Map<string, Entrant> }
const ents = (t: Tournament) => new Map(t.entrants.map((e) => [e.id, e]));
/** The bracket and every starter, computed from the public seed and the player list. Anybody gets the same answer. */
export async function planOf(s: Setup): Promise<Plan> {
  if (!s.seed || !s.roster || !s.opts) throw new Error("The tournament has not started.");
  const t = await startTournament({ eid: s.eid, seed: s.seed, players: s.roster, format: s.opts.format, teamSize: s.opts.teamSize, moveMs: s.opts.moveMs, readyMs: s.opts.readyMs, startAt: s.startedMs ?? 0 });
  const entOfPid = new Map<string, string>(), r1 = new Map<string, string>();
  for (const e of t.entrants) for (const m of e.members) entOfPid.set(m, e.id);
  for (const m of Object.values(t.matches)) if (m.round === 1) { if (m.a) r1.set(m.a, m.mid); if (m.b) r1.set(m.b, m.mid); }
  const pairs = Object.values(t.matches).filter((m) => m.round === 1).sort((x, y) => x.idx - y.idx).map((m) => `${m.mid}:${m.a ?? "-"}:${m.b ?? "-"}`).join(",");
  const names: Record<string, string> = {}; for (const p of s.roster) names[p.pid] = p.name;
  return { t, opts: s.opts, entOfPid, r1, digest: await sha256Hex(`TTT-PLAN|${s.eid}|${t.rounds}|${pairs}`), names, E: ents(t) };
}
/** What the Organizer's page stores in the mailbox so the mailbox knows who may write to which match (it is only a list; every phone re-computes it and objects if it differs). */
export function planPayload(p: Plan): { rounds: number; size: number; entrants: Entrant[]; digest: string; matches: { mid: string; round: number; idx: number; a: string | null; b: string | null; bye: boolean; winner: string | null; boards: [string, string][] }[] } {
  const matches = Object.values(p.t.matches).filter((m) => m.round === 1).sort((x, y) => x.idx - y.idx).map((m) => ({
    mid: m.mid, round: 1, idx: m.idx, a: m.a, b: m.b, bye: !!m.bye, winner: m.bye ? m.winner! : null,
    boards: m.bye ? [] : m.boards.map((b) => [b.a, b.b] as [string, string]),
  }));
  return { rounds: p.t.rounds, size: p.t.size, entrants: p.t.entrants, digest: p.digest, matches };
}

// ---------------------------------------------------------------------------------------------------------------- one match, replayed from what the mailbox stored
const ctxAt = (p: Plan, startAt: number): MatchCtx => ({ ...ctxOf(p.t), startAt, entrant: (id) => p.E.get(id)! });

/** Marks a board as won by `winner` (a result the two players agreed, or the Organizer settled). The points of an agreed result that the replay did not reach are the forfeit rule's: 2 for the winner. */
function force(b: BoardState, winner: string): void {
  if (b.done && b.winner === winner) return;
  if (!b.done) b.points[winner] = (b.points[winner] ?? 0) + 2;
  b.done = true; b.winner = winner; b.via = b.via ?? "forfeit";
}

export interface Replayed { m: MatchState; complete: boolean; /** tournament-clock time at which the last board's result was agreed */ doneAt: number; due: boolean[] }
/** Opens the match at `openedAt` (tournament clock) and replays every stored event of every board with the rules. `nowEff` (optional) is used to see whether a clock-out is due that nobody has claimed yet. */
export async function replayMatch(p: Plan, startAt: number, m: MatchState, rec: MatchRec | null, openedAt: number, pauses: readonly [number, number | null][], nowEff?: number): Promise<Replayed> {
  const c = ctxAt(p, startAt);
  await openMatchP(c, m, openedAt);
  const due: boolean[] = m.boards.map(() => false);
  let doneAt = openedAt;
  for (const br of rec?.boards ?? []) {
    const b = m.boards[br.j]; if (!b) continue;
    for (const e of [...br.events].sort((x, y) => x.seq - y.seq)) {
      if (b.done) break;
      const at = effOf(pauses, e.ms);
      if (e.sq === ABSENT) await advanceBoard(c.cfg, m.mid, b, at); else await applyMove(c.cfg, m.mid, b, e.pid, e.sq, at);
    }
    if (nowEff !== undefined && !b.done) {
      const probe = structuredClone(b); await advanceBoard(c.cfg, m.mid, probe, nowEff);
      due[br.j] = probe.done !== b.done || lastGame(probe).moves.length !== lastGame(b).moves.length || probe.games.length !== b.games.length;
    }
    if (br.result && !br.result.flag && br.result.winner) { force(b, br.result.winner); doneAt = Math.max(doneAt, effOf(pauses, br.result.ms)); }
  }
  const complete = !!rec?.complete && m.boards.every((b) => b.done);
  if (complete) { finalizeMatchP(c, m); m.doneAt = doneAt; }
  return { m, complete, doneAt, due };
}

// ---------------------------------------------------------------------------------------------------------------- what a screen shows
export interface BoardShown { j: number; a: string; b: string; aName: string; bName: string; cells: number[]; x: string; o: string; gameNo: number; games: number; turn: string | null; deadlineMs: number | null; done: boolean; winner: string | null; via: string | null; ply: number; lastAuto: boolean; yourMark?: "X" | "O" | null; yourTurn?: boolean }
export function boardView(b: BoardState, names: Record<string, string>, pauses: readonly [number, number | null][], paused: boolean, me?: string): BoardShown {
  const g = b.games[b.games.length - 1]!; const mover = b.done ? null : moverOf(g); const n = (id: string) => names[id] ?? "?";
  return {
    j: b.j, a: n(b.a), b: n(b.b), aName: n(b.a), bName: n(b.b), cells: [...g.cells], x: n(g.x), o: n(g.o), gameNo: g.no, games: b.games.length, turn: mover ? n(mover) : null,
    deadlineMs: b.done || paused ? null : wallOf(pauses, g.deadline), done: b.done, winner: b.winner ? n(b.winner) : null, via: b.via ?? null, ply: g.moves.length,
    lastAuto: g.moves.length ? !!g.moves[g.moves.length - 1]!.auto : false,
    ...(me ? { yourMark: (g.x === me ? "X" : g.o === me ? "O" : null) as "X" | "O" | null, yourTurn: mover === me } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------- the phone
export interface PhoneDeps { api: Api; eid: string; pid: string; device: string; /** this phone's own clock, in ms */ now: () => number; /** plays the square for a bot; the real page leaves this out and calls play() from a tap */ log?: (s: string) => void }
export interface Counters { gets: number; posts: number; replays: number; claims: number; results: number; opens: number; moves: number }

export class TttPhone {
  setup: Setup | null = null; plan: Plan | null = null; skew = 0; planOk: boolean | null = null; last: any = null;
  readonly counters: Counters = { gets: 0, posts: 0, replays: 0, claims: 0, results: 0, opens: 0, moves: 0 };
  private done = new Map<string, Replayed>(); private reported = new Set<string>(); private claimedAt = new Map<string, number>(); private opened = new Set<string>();
  private cur: { mid: string; j: number; seq: number; mine: boolean; yourTurn: boolean; ply: number } | null = null;
  constructor(public deps: PhoneDeps) {}
  private get = async (path: string) => { this.counters.gets++; return this.deps.api("GET", `/api/z/${this.deps.eid}/ttt/${path}`); };
  private post = async (path: string, body: unknown) => { this.counters.posts++; return this.deps.api("POST", `/api/z/${this.deps.eid}/ttt/${path}`, body); };
  private id = () => ({ pid: this.deps.pid, device: this.deps.device });
  /** The server's clock as far as this phone can tell. */
  serverNow = (): number => this.deps.now() + this.skew;
  private sync(t: { serverNow?: number } | undefined) { if (t?.serverNow) this.skew = t.serverNow - this.deps.now(); }

  async loadSetup(): Promise<Setup> {
    if (this.plan && this.setup) return this.setup; // the list and the seed never change; state and pauses are refreshed by every match we read
    const s: Setup = await this.get("setup"); this.sync(s);
    if ((s.state === "running" || s.state === "done") && s.seed) { if (!this.plan) { this.setup = s; this.plan = await planOf(s); this.planOk = !s.planDigest || s.planDigest === this.plan.digest; if (!this.planOk) await this.post("flag", { ...this.id(), kind: "plan", note: "The bracket I computed is not the one the Organizer's page stored." }).catch(() => {}); } this.setup = s; }
    else this.setup = s;
    return s;
  }

  /** Looks at the mailbox, works out where this player stands, does whatever is due (open the match, claim a clock-out, report a result) and returns what the screen should show. */
  async tick(): Promise<any> {
    const s = await this.loadSetup(); const base = { serverNow: this.serverNow(), state: s.state, commit: s.commit, paused: false };
    if (s.state === "open" || s.state === "starting") return (this.last = { ...base, phase: "waiting", joined: s.joined ?? 0, message: s.state === "open" ? "You are in. Waiting for the host to start." : "The host has started the game. Getting the draw ready." });
    const p = this.plan!; const me = this.deps.pid; const name = p.names[me];
    if (!name) return (this.last = { ...base, phase: "watching", message: "The list closed before you joined. You can watch." });
    const ent = p.entOfPid.get(me);
    if (!ent) return (this.last = { ...base, phase: "reserve", you: name, message: "There were not enough players for a full team for you. You can watch the games." });
    const v = await this.walk(ent); return (this.last = { ...base, ...v });
  }

  private async fetchMatch(mid: string): Promise<MatchRec> {
    const r: MatchRec = await this.get(`m/${mid}`); this.sync(r.t); if (r.t) this.setup = { ...this.setup!, state: r.t.state, pauses: r.t.pauses }; return r;
  }
  private pausesNow = () => this.setup?.pauses ?? [];
  private isPaused = () => this.pausesNow().some(([, t]) => t === null);

  /** The chain of matches this player's entrant is in: round 1, then each next one that the listed results open. */
  private async walk(ent: string): Promise<any> {
    const E = this.plan!.E;
    const p = this.plan!, s = this.setup!, me = this.deps.pid, t = p.t, startAt = s.startedMs ?? 0, pr = this.pausesNow();
    const roundWords = (r: number) => roundName(t, r);
    let mid = p.r1.get(ent)!; let side: { a: string | null; b: string | null } | null = null; let openedAt = startAt;
    for (let guard = 0; guard < 40; guard++) {
      const base = structuredClone(t.matches[mid]!) as MatchState;
      if (side) { base.a = side.a; base.b = side.b; }
      let rep = this.done.get(mid) ?? null; let rec: MatchRec | null = null;
      if (base.bye) rep = rep ?? { m: Object.assign(base, { status: "done" as const, doneAt: startAt }), complete: true, doneAt: startAt, due: [] };
      else if (!rep) {
        rec = await this.fetchMatch(mid);
        if (!rec.reg && base.round > 1 && !this.opened.has(mid)) { // the match is not in the mailbox yet: tell it who plays (both players do this; the mailbox keeps the first and checks the rest)
          const fs = feedersOf(base)!; const A = E.get(base.a!)!, B = E.get(base.b!)!;
          const boards = A.members.map((x, j) => [x, B.members[j]!]);
          if (boards.some(([x, y]) => x === me || y === me)) {
            this.counters.opens++;
            try { await this.post("open", { ...this.id(), mid, round: base.round, idx: base.idx, a: base.a, b: base.b, boards, from: fs, opened: Math.round(openedAt) }); this.opened.add(mid); rec = await this.fetchMatch(mid); } catch (e: any) { if (e?.status !== 409) throw e; }
          }
        }
        if (rec.reg && base.round > 1 && (rec.reg.a !== base.a || rec.reg.b !== base.b) && !this.opened.has("x" + mid)) { this.opened.add("x" + mid); await this.post("flag", { ...this.id(), kind: "pairing", mid, note: "The pairing stored for this match is not the one the results give." }).catch(() => {}); }
        this.counters.replays++;
        const nowEff = effOf(pr, this.serverNow());
        rep = await replayMatch(p, startAt, base, rec, openedAt, pr, this.isPaused() ? undefined : nowEff);
        if (rep.complete) this.done.set(mid, rep);
      }
      const m = rep.m;
      if (!rep.complete) return this.playingView(m, rec, rep, E, roundWords);
      // finished: where does the winner go?
      const lost = m.loser === ent && !m.bye;
      const par = parentOf(ctxAt(p, startAt), m);
      if (lost) return this.outView(m, ent, roundWords);
      if (!par) return this.championView(ent);
      // the sibling feeder decides who the opponent is and when the next match opens
      const fs = feedersOf({ round: m.round + 1, idx: m.idx >> 1 })!; const sibMid = fs[0] === m.mid ? fs[1] : fs[0];
      let sib = this.done.get(sibMid) ?? null;
      if (!sib) {
        const sb = structuredClone(t.matches[sibMid]!) as MatchState;
        if (sb.bye) { sib = { m: Object.assign(sb, { status: "done" as const, doneAt: startAt }), complete: true, doneAt: startAt, due: [] }; this.done.set(sibMid, sib); }
        else if (sb.round === 1) { const sr = await this.fetchMatch(sibMid); sib = await replayMatch(p, startAt, sb, sr, startAt, pr); if (sib.complete) this.done.set(sibMid, sib); }
        else { sib = (await this.resolveUpper(sibMid, E)) ; }
      }
      if (!sib || !sib.complete) return { phase: "next", you: p.names[me], message: m.bye ? "You have a free pass this round. Waiting for your opponent." : "You won. Waiting for your next opponent." };
      const sa = par.side === "a" ? m.winner! : sib.m.winner!, sbb = par.side === "a" ? sib.m.winner! : m.winner!;
      side = { a: sa, b: sbb }; openedAt = Math.max(startAt, m.doneAt ?? 0, sib.m.doneAt ?? 0); mid = par.mid;
    }
    return { phase: "next", you: p.names[me], message: "Waiting for your next opponent." };
  }

  /** A match above round 1 that is not this player's own: resolved the same way from the listed results (used only to learn who won it). */
  private async resolveUpper(mid: string, E: Map<string, Entrant>): Promise<Replayed | null> {
    const p = this.plan!, startAt = this.setup!.startedMs ?? 0, pr = this.pausesNow();
    const cached = this.done.get(mid); if (cached) return cached;
    const base = structuredClone(p.t.matches[mid]!) as MatchState; const fs = feedersOf(base);
    if (!fs) return null;
    const rs: Replayed[] = [];
    for (const f of fs) {
      let r = this.done.get(f) ?? null;
      if (!r) { const fb = structuredClone(p.t.matches[f]!) as MatchState; if (fb.bye) r = { m: Object.assign(fb, { status: "done" as const, doneAt: startAt }), complete: true, doneAt: startAt, due: [] }; else if (fb.round === 1) r = await replayMatch(p, startAt, fb, await this.fetchMatch(f), startAt, pr); else r = await this.resolveUpper(f, E); if (r?.complete) this.done.set(f, r); }
      if (!r || !r.complete) return null; rs.push(r);
    }
    base.a = rs[0]!.m.winner!; base.b = rs[1]!.m.winner!;
    const rec = await this.fetchMatch(mid); const r = await replayMatch(p, startAt, base, rec, Math.max(startAt, rs[0]!.m.doneAt ?? 0, rs[1]!.m.doneAt ?? 0), pr);
    if (r.complete) this.done.set(mid, r); return r;
  }

  private async playingView(m: MatchState, rec: MatchRec | null, rep: Replayed, E: Map<string, Entrant>, roundWords: (r: number) => string): Promise<any> {
    const p = this.plan!, me = this.deps.pid, pr = this.pausesNow(), paused = this.isPaused();
    const mine = m.boards.find((b) => b.a === me || b.b === me) ?? null;
    this.cur = null;
    if (mine && rec) {
      const br = rec.boards[mine.j]!;
      const nextSeq = br.events.length;
      // 1. a clock-out that is due and not yet claimed: claim it (the mailbox stamps the claim with its own clock; every phone then computes the clock-out from that stamp)
      if (!paused && rep.due[mine.j] && !mine.done && this.claimedAt.get(`${m.mid}:${mine.j}`) !== nextSeq) {
        this.claimedAt.set(`${m.mid}:${mine.j}`, nextSeq); this.counters.claims++;
        try { await this.post("move", { ...this.id(), mid: m.mid, seq: nextSeq, absent: true, client_ms: this.deps.now() }); } catch (e: any) { if (e?.status !== 409) throw e; }
        return this.refresh(m.mid);
      }
      // 2. my board is decided (by the rules): report the winner once
      const key = `${m.mid}:${mine.j}`;
      if (mine.done && mine.winner && !br.result && !this.reported.has(key) && !br.reports.some((r) => r.pid === me)) {
        this.reported.add(key); this.counters.results++;
        try { await this.post("result", { ...this.id(), mid: m.mid, winner: mine.winner }); } catch (e: any) { if (e?.status !== 409) throw e; }
      }
      const g = lastGame(mine);
      this.cur = { mid: m.mid, j: mine.j, seq: nextSeq, mine: true, yourTurn: !mine.done && moverOf(g) === me, ply: g.moves.length };
    }
    const names = p.names; const bv = (b: BoardState, withMe?: string) => boardView(b, names, pr, paused, withMe);
    const A = E.get(m.a!)!, B = E.get(m.b!)!; const myEnt = A.members.includes(me) ? A : B; const oppEnt = myEnt === A ? B : A;
    const flagged = rec?.boards.some((b) => b.result?.flag) ?? false;
    return {
      phase: "playing", you: names[me], round: m.round, roundName: roundWords(m.round), team: myEnt.name, vs: oppEnt.name, paused, ...(flagged ? { flagged: true } : {}),
      board: mine ? bv(mine, me) : null, boards: m.boards.map((b) => bv(b)),
    };
  }
  private async refresh(mid: string) { void mid; return this.tick(); }

  private rankAt = 0; private ranked: any[] = [];
  /** The stored ranking once the tournament is over; until then a phone that is out looks (lightly) every 10 seconds whether it is. */
  private async rankOnce(): Promise<any[]> {
    if (this.ranked.length) return this.ranked;
    const now = this.deps.now(); if (now - this.rankAt < 10_000 && this.rankAt) return [];
    this.rankAt = now;
    try { const r = await this.get("rank?n=10"); if (r.done) { this.ranked = r.ranking; if (this.setup) this.setup = { ...this.setup, state: "done" }; } return this.ranked; } catch { return []; }
  }
  private async outView(m: MatchState, ent: string, roundWords: (r: number) => string) {
    await this.finishIfFinal(m); const ranking = await this.rankOnce(); const done = this.setup?.state === "done";
    return { phase: "out", you: this.plan!.names[this.deps.pid], roundName: roundWords(m.round), message: done ? "The tournament is over." : "You are out. You can watch the rest.", place: ranking.find((r: any) => r.id === ent)?.rank ?? null, ranking };
  }
  private async championView(ent: string) {
    void ent; const fin = this.plan!.t.matches[midOf(this.plan!.t.rounds, 0)]!; await this.finishIfFinal(fin); const ranking = await this.rankOnce();
    return { phase: "champion", you: this.plan!.names[this.deps.pid], message: "You won the tournament.", ranking };
  }

  private finished = false;
  /** The last match is over and this phone was in it: compute the ranking from everything the mailbox lists and send it. The mailbox keeps it when a second phone (or the Organizer's page) sends the same. */
  private async finishIfFinal(m: Pick<MatchState, "round">): Promise<void> {
    if (this.finished || m.round !== this.plan!.t.rounds || this.setup?.state === "done") return;
    this.finished = true;
    try {
      const t = await replayAll(this.setup!, this.plan!, async (r, pg) => (await this.get(`all?round=${r}&page=${pg}`)).matches);
      await this.post("finish", { ...this.id(), ...(await finishPayload(t)) });
    } catch { this.finished = false; }
  }
  /** The player taps a square. Returns whether the mailbox took the move. */
  async play(cell: number): Promise<{ ok: boolean; error?: string }> {
    const c = this.cur; if (!c || !c.yourTurn) return { ok: false, error: "not-your-turn" };
    this.counters.moves++;
    try { await this.post("move", { ...this.id(), mid: c.mid, seq: c.seq, sq: cell, client_ms: this.deps.now() }); c.yourTurn = false; return { ok: true }; }
    catch (e: any) { return { ok: false, error: e?.code ?? "refused" }; }
  }
  /** For the page: the board I am on right now (so the tap handler needs nothing else). */
  get myBoard(): { mid: string; j: number; seq: number; yourTurn: boolean; ply: number } | null { return this.cur; }
}

// ---------------------------------------------------------------------------------------------------------------- the Organizer's page and the end of the tournament
/** The whole tournament as the phones see it, replayed from the mailbox (used for the final ranking and by the Organizer's page). Needs every match; reads them page by page. */
export async function replayAll(setup: Setup, plan: Plan, fetchRound: (round: number, page: number) => Promise<MatchRec[]>): Promise<Tournament> {
  const t: Tournament = structuredClone(plan.t); const startAt = setup.startedMs ?? 0, pr = setup.pauses;
  const recs = new Map<string, MatchRec>();
  for (let r = 1; r <= t.rounds; r++) for (let pg = 0; ; pg++) { const rows = await fetchRound(r, pg); for (const x of rows) recs.set(x.mid, x); if (rows.length < 100) break; }
  for (let r = 1; r <= t.rounds; r++) for (let i = 0; i < t.size / 2 ** r; i++) {
    const mid = midOf(r, i); const m = t.matches[mid]!;
    if (r > 1) { const fs = feedersOf(m)!; const f0 = t.matches[fs[0]]!, f1 = t.matches[fs[1]]!; if (f0.status !== "done" || f1.status !== "done") continue; m.a = f0.winner!; m.b = f1.winner!; }
    if (m.bye) { m.status = "done"; m.doneAt = startAt; continue; }
    if (!m.a || !m.b) continue;
    const opened = r === 1 ? startAt : Math.max(startAt, t.matches[feedersOf(m)![0]]!.doneAt ?? 0, t.matches[feedersOf(m)![1]]!.doneAt ?? 0);
    const rep = await replayMatch(plan, startAt, m, recs.get(mid) ?? null, opened, pr);
    t.matches[mid] = rep.m;
  }
  const fin = t.matches[midOf(t.rounds, 0)]; if (fin?.status === "done") { t.done = true; t.champion = fin.winner!; }
  return t;
}
export interface FinishPayload { champion: string; rounds: number; finalMid: string; podium: string[][]; ranking: { rank: number; id: string; name: string; roundReached: number; points: number; decidedBy: string; tie: string }[] }
/** The ranking and the podium, computed here from the replayed tournament. Two phones that compute the same thing is what the mailbox waits for. */
export async function finishPayload(t: Tournament): Promise<FinishPayload> {
  const rk = await rankings(t); const E = ents(t);
  return {
    champion: t.champion!, rounds: t.rounds, finalMid: midOf(t.rounds, 0), podium: rk.slice(0, 5).map((r) => E.get(r.id)?.members ?? [r.id]),
    ranking: rk.slice(0, 100).map((r, i) => ({ rank: r.rank, id: r.id, name: r.name, roundReached: r.roundReached, points: r.points, decidedBy: r.decidedBy, tie: i ? tieLine(r, rk[i - 1]!.name) : "" })),
  };
}

/** The Organizer's page: sends the draw it computed when the host starts; looks after boards where both players are away (like a third phone: it claims their clock-outs and reports the board); sends the ranking when the final is over.
 *  Everything it does is the same computing a phone does, from the same stored data; it cannot place a square and cannot choose a winner (the settle button in the console is a person, not this code). */
export class TttConsole {
  planSent = false; finishSent = false; full: Plan | null = null; setup: Setup | null = null; private n = 0; private reported = new Set<string>();
  constructor(public api: Api, public eid: string, public opts: { stuckMs?: number; watchEvery?: number } = {}) {}
  private get = (path: string) => this.api("GET", `/api/z/${this.eid}/ttt/${path}`);
  private post = (path: string, body: unknown) => this.api("POST", `/api/z/${this.eid}/ttt/${path}`, body);
  async tick(): Promise<{ state: Setup["state"]; sentPlan?: boolean; finished?: boolean; claims?: number; reports?: number; opened?: number }> {
    const v = await this.get("view"); const state: Setup["state"] = v.state; this.n++;
    if (state === "starting" && !this.planSent) {
      const s: Setup = await this.get("setup"); const plan = await planOf({ ...s, startedMs: s.serverNow }); const pl = planPayload(plan);
      for (let i = 0; i < pl.matches.length || i === 0; i += 400) {
        const last = i + 400 >= pl.matches.length;
        await this.post("plan", { matches: pl.matches.slice(i, i + 400), ...(i === 0 ? { entrants: pl.entrants } : {}), ...(last ? { last: true, rounds: pl.rounds, size: pl.size, digest: pl.digest, entrantCount: pl.entrants.length } : {}) });
      }
      this.planSent = true; return { state: "running", sentPlan: true };
    }
    if (state !== "running") return { state };
    const out: { state: Setup["state"]; finished?: boolean; claims?: number; reports?: number; opened?: number } = { state };
    if (!v.paused && this.n % (this.opts.watchEvery ?? 6) === 0) { const opened = await this.register(); Object.assign(out, await this.watch(), { opened }); }
    const rounds: number = v.rounds ?? 0;
    if (rounds && !this.finishSent && (v.perRound ?? []).some((x: any) => x.round === rounds && x.status === "done")) {
      const { plan, setup } = await this.loaded();
      const t = await replayAll(setup, plan, async (r, pg) => (await this.get(`all?round=${r}&page=${pg}`)).matches);
      await this.post("finish", await finishPayload(t)); this.finishSent = true; return { ...out, state: "done", finished: true };
    }
    return out;
  }
  private async loaded(): Promise<{ plan: Plan; setup: Setup }> {
    if (!this.full) { this.setup = await this.get("setup"); this.full = await planOf(this.setup!); }
    return { plan: this.full, setup: this.setup! };
  }
  /** Later matches whose two earlier matches are finished but which nobody registered (both players are away): the page registers them, from the same listed results a phone would use. */
  async register(): Promise<number> {
    const { plan, setup } = await this.loaded(); const t = plan.t, startAt = setup.startedMs ?? 0; let opens = 0;
    type Brief = { mid: string; a: string | null; b: string | null; bye: boolean; winner: string | null; opened: number | null; complete: boolean; boards: { j: number; winner: string | null; ms: number | null }[] };
    const briefs = new Map<string, Brief>(); let pr: [number, number | null][] = setup.pauses;
    for (let r = 1; r <= t.rounds; r++) for (let pg = 0; ; pg++) { const x = await this.get(`brief?round=${r}&page=${pg}`); pr = x.pauses ?? pr; for (const m of x.matches as Brief[]) briefs.set(m.mid, m); if (x.matches.length < 300) break; }
    const E = plan.E; const won = new Map<string, { winner: string; doneAt: number }>();
    for (let r = 1; r <= t.rounds; r++) for (let i = 0; i < t.size / 2 ** r; i++) {
      const mid = midOf(r, i); const tm = t.matches[mid]!;
      if (r === 1 && tm.bye) { won.set(mid, { winner: tm.winner!, doneAt: startAt }); continue; }
      if (r > 1) {
        const fs = feedersOf(tm)!; const w0 = won.get(fs[0]), w1 = won.get(fs[1]);
        if (w0 && w1 && !briefs.has(mid)) {
          const A = E.get(w0.winner)!, B = E.get(w1.winner)!; const opened = Math.max(startAt, w0.doneAt, w1.doneAt);
          try { await this.post("open", { mid, round: r, idx: i, a: A.id, b: B.id, boards: A.members.map((x, j) => [x, B.members[j]!]), from: fs, opened: Math.round(opened) }); opens++; } catch { /* a phone registered it first */ }
          continue;
        }
      }
      const b = briefs.get(mid); if (!b || !b.complete || b.a === null || b.b === null) continue;
      const A = E.get(b.a)!; const wins = b.boards.filter((x) => x.winner === A.members[x.j]).length;
      const doneAt = Math.max(b.opened ?? startAt, ...b.boards.map((x) => effOf(pr, x.ms ?? 0)));
      won.set(mid, { winner: wins * 2 > b.boards.length ? b.a : b.b, doneAt });
    }
    return opens;
  }
  /** Boards nobody has touched for a while: replay them, claim the clock-outs that are due, report the board once the rules have decided it. */
  async watch(): Promise<{ claims: number; reports: number }> {
    let claims = 0, reports = 0;
    for (let pg = 0; ; pg++) {
      const r = await this.get(`stuck?ms=${this.opts.stuckMs ?? 90_000}&page=${pg}`); const recs: MatchRec[] = r.matches;
      if (!recs.length) break;
      const { plan, setup } = await this.loaded(); const startAt = setup.startedMs ?? 0, pr: [number, number | null][] = r.pauses ?? setup.pauses;
      for (const rec0 of recs) {
        if (!rec0.reg || rec0.reg.bye) continue;
        let rec = rec0;
        for (let pass = 0; pass < 2; pass++) {
          const base = structuredClone(plan.t.matches[rec.mid]!) as MatchState; base.a = rec.reg!.a; base.b = rec.reg!.b;
          const rep = await replayMatch(plan, startAt, base, rec, rec.reg!.opened ?? startAt, pr, effOf(pr, r.serverNow));
          let claimed = false;
          for (const b of rep.m.boards) {
            const br = rec.boards[b.j]!; if (br.result) continue;
            if (!b.done && rep.due[b.j]) { try { await this.post("move", { mid: rec.mid, j: b.j, seq: br.events.length, absent: true }); claims++; claimed = true; } catch { /* a phone got there first */ } }
            else if (b.done && b.winner && !this.reported.has(`${rec.mid}:${b.j}`)) { this.reported.add(`${rec.mid}:${b.j}`); try { await this.post("result", { mid: rec.mid, j: b.j, winner: b.winner }); reports++; } catch { /* already decided */ } }
          }
          if (!claimed) break;
          rec = { ...(await this.get(`m/${rec.mid}`)) }; // the claim is stored: replay again to see whether the board is now decided
        }
      }
      if (recs.length < 200) break;
    }
    return { claims, reports };
  }
  flags = () => this.get("flags");
  /** Boards whose two reports differ: who is on them, by name, for the Organizer to settle. */
  async disputed(): Promise<{ mid: string; j: number; a: { pid: string; name: string }; b: { pid: string; name: string } }[]> {
    const f = await this.flags(); const { plan } = await this.loaded(); const out = [];
    for (const d of f.disputed as { mid: string; j: number }[]) { const rec: MatchRec = await this.get(`m/${d.mid}`); const br = rec.boards[d.j]; if (br) out.push({ mid: d.mid, j: d.j, a: { pid: br.a, name: plan.names[br.a] ?? "?" }, b: { pid: br.b, name: plan.names[br.b] ?? "?" } }); }
    return out;
  }
}

/** The big screen and the spectator page: the same computing, read-only. Shows names and boards; the matches it draws are replayed from the stored moves. */
export class TttWatcher {
  setup: Setup | null = null; plan: Plan | null = null;
  constructor(public api: Api, public eid: string) {}
  private get = (path: string) => this.api("GET", `/api/z/${this.eid}/ttt/${path}`);
  private async card(rec: MatchRec, pauses: [number, number | null][], paused: boolean): Promise<any | null> {
    const p = this.plan!, startAt = this.setup!.startedMs ?? 0; if (!rec.reg) return null;
    const base = structuredClone(p.t.matches[rec.mid]!) as MatchState; base.a = rec.reg.a; base.b = rec.reg.b;
    if (rec.reg.bye) return { mid: rec.mid, round: base.round, roundName: roundName(p.t, base.round), a: p.E.get(rec.reg.a ?? rec.reg.b)?.name ?? "-", b: "-", status: "done", bye: true, winner: p.E.get(rec.reg.winner ?? "")?.name ?? null, boards: [] };
    const rep = await replayMatch(p, startAt, base, rec, rec.reg.opened ?? startAt, pauses);
    const E = p.E;
    return { mid: rec.mid, round: base.round, roundName: roundName(p.t, base.round), a: E.get(base.a!)?.name ?? "-", b: E.get(base.b!)?.name ?? "-", status: rec.complete ? "done" : "live", bye: false, winner: rep.m.winner ? E.get(rep.m.winner)?.name ?? null : null, boards: rep.m.boards.map((b) => boardView(b, p.names, pauses, paused)) };
  }
  /** What the big screen shows now (the same fields the page has always read). */
  async view(): Promise<any> {
    const v = await this.get("view");
    if (v.state === "open" || v.state === "starting") return { ...v, phase: v.state === "open" ? "waiting" : "starting" };
    if (!this.plan) { this.setup = await this.get("setup"); if (this.setup!.state === "starting") return { ...v, phase: "starting" }; this.plan = await planOf(this.setup!); }
    const t = this.plan.t; const pauses = this.setup!.pauses; const paused = !!v.paused;
    const live = await this.get("all?status=live&n=24"); const liveCards: any[] = [];
    for (const r of live.matches as MatchRec[]) { const c = await this.card(r, live.pauses ?? pauses, paused); if (c) liveCards.push(c); }
    const fin: MatchRec = await this.get(`m/${midOf(t.rounds, 0)}`); const finalCard = fin.reg ? await this.card(fin, pauses, paused) : null;
    return { ...v, roundNames: Array.from({ length: t.rounds }, (_, i) => roundName(t, i + 1)), live: liveCards, final: finalCard ? [finalCard] : [] };
  }
}
