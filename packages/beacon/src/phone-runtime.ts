// The whole phone-side engagement loop, with no UI, so it can be tested without a browser and then wrapped by a thin page.
// It talks to exactly two things: the public beacon (through BeaconOpts) and our one small store (through deps.api).
import { generateTicket, type Ticket } from "../../shared/src/ticket";
import { winningNumbers } from "./house-rules";
import { ALL_SAFETIES, ControlTracker, SAFETY_FAST, SAFETY_STANDARD, pausedAt, type ControlConfig } from "./control";
import { GRACE_ROUNDS, LATE_LAG_ROUNDS, defaultCfg, keysInPlay, linesFor, roundEid, validateCfg, votersFor, type BreakCfg, type EngagementCfg, type PatternKey } from "./config";
import { PrizeEngine, countFromOf } from "./prize-engine";
import { RoundStore, activeBreak, activeIntermission, callRoundR, completionIndexKey, luckyRound, luckyWinners, ticketsFor } from "./game";
import { seatOfPid } from "./unique-ticket";
import { NUMBERS, QUICKNET, fetchRound, pickNumber, roundAt, roundTimeMs, type BeaconOpts } from "./index";

export interface PhoneDeps {
  /** Calls our store. Must throw an Error with `.status` on HTTP errors, and a plain Error when offline. */
  api(method: string, path: string, body?: unknown): Promise<any>;
  beacon: BeaconOpts;
  /** A monotonic millisecond clock (performance.now in a browser). Never the wall clock. */
  mono(): number;
  store: { get(k: string): string | null; set(k: string, v: string): void };
  /** Optional: reads a public (CDN-cached) JSON file by absolute URL; used for the pause file when the engagement publishes one, so the Worker is not hit every few seconds. */
  getPublic?(url: string): Promise<any>;
  /** Test hook only: never end the engagement early because every prize was awarded (lets a test watch all 75 numbers). */
  noEarlyEnd?: boolean;
  /** Test hook only. */
  verify?: (x: { round: number; signature: string; randomness: string }) => boolean;
}

export type Phase = "boot" | "missing" | "join" | "play" | "ended";
export interface RuntimeView {
  phase: Phase; error: string | null; pid: string | null; ticket: Ticket | null; log: number[]; nowRound: number | null;
  locked: boolean;
  startRound: number; scheduledRound: number; callSeconds: number; mode: "live" | "hold" | "blind" | "none"; paused: boolean; stopped: boolean;
  claimed: PatternKey[]; unsent: number; results: { pattern: PatternKey | "lucky"; ordinal: number; idx: number; count: number; winners?: string[]; tied?: number; round?: number }[]; pendingChecks: number; discarded: number;
  nextCallInSec: number | null;
  tickets: Ticket[]; cfg: EngagementCfg;
  /** The brand break showing right now, with seconds left; null when none. */
  brk: { title: string; kind: BreakCfg["kind"]; mediaUrl?: string; secondsLeft: number; seconds: number; winners?: number } | null;
  /** My earliest completion (0-based call index) of each house in play so far, or -1. */
  myIdx: Partial<Record<PatternKey, number>>;
  /** Each lucky draw of this engagement: whether its winners are published yet and whether this phone is one of them. */
  lucky: { ordinal: number; title: string; winners: number; published: boolean; won: boolean; style: "draw" | "scratch" }[];
  /** The organizer's latest message to everyone (shown and spoken on phones), or null. */
  announcement: { id: string; text: string } | null;
  /** The round being played (or just finished) and how many there are. */
  round: number; rounds: number;
  /** Between two rounds: which round comes next and how long until its first number. */
  intermission: { round: number; secondsLeft: number } | null;
  /** For each earlier round, the reward lines this phone received (a line is received when this phone completed it at the call the organizer published). */
  past: { round: number; got: { pattern: PatternKey; ordinal: number }[] }[];
  /** Every reward line this phone won, in any round (a line is won when this phone completed it at the call the results name). `text` is what the organizer wrote for that line. */
  won: { round: number; pattern: PatternKey; ordinal: number; text: string; cells: number[]; idx: number }[];
  /** True when every reward line of the round being played has been awarded. */
  allAwarded: boolean;
  /** The engagement ended because every prize was awarded (not because all 75 numbers were called). */
  endedByPrizes: boolean;
  /** Joined after the first number: numbers called before `countFromRound` are gone for this phone. `secondsUntil` > 0 means the phone's own numbers have not started yet; `hidden` is how many numbers were called before it joined. */
  late: { countFromRound: number; secondsUntil: number; hidden: number } | null;
  /** The winners were worked out on this phone from the public seat list (true), or taken from the organizer's published results (false). */
  localWinners: boolean;
}

export class PhoneRuntime {
  phase: Phase = "boot";
  error: string | null = null;
  pid: string | null = null;
  ticket: Ticket | null = null;
  tickets: Ticket[] = [];
  cfg: EngagementCfg = defaultCfg();
  startRound = 0;
  /** The time the organizer gave. The first number is GRACE_ROUNDS later (startRound above already includes it). */
  scheduledRound = 0;
  callSeconds = 0;
  trackClaims = true;
  controlUrl: string | null = null;
  /** The engagement was not paid for by its start time: nothing is shown until it is. */
  locked = false;
  announcement: { id: string; text: string } | null = null;
  store: RoundStore;
  tracker: ControlTracker | null = null;
  results: RuntimeView["results"] = [];
  /** Claims already sent (or not needed), as "round:house". */
  private claimedAll = new Set<string>();
  private cur = 1;
  private logs: number[][] = [[]];
  private ticketMemo = new Map<number, Ticket[]>();
  private offsetMs: number | null = null; // utc - mono
  private offsetSamples: number[] = []; // the last few clock answers (the largest is used)
  private syncedAtMono = -Infinity;
  private lastControlPoll = -Infinity;
  private lastResultPoll = -Infinity;
  private get logCache(): number[] { return this.logs[this.cur - 1] ?? (this.logs[this.cur - 1] = []); }
  private controlFast = false;
  private pollBaseMs = 9_000; private pollJitterMs = 3_000;
  /** The engagement can be held for non-payment (the server says so), so a phone near its start keeps asking. */
  private gated = false;
  /** unknown: have not yet heard whether this engagement can be paused. none: the store says no pause key exists. known: we hold a verified control file. */
  private controlState: "unknown" | "none" | "known" = "unknown";
  private unknownSince: number | null = null;

  constructor(readonly eid: string, readonly deps: PhoneDeps) {
    this.store = new RoundStore(deps.beacon, deps.verify);
  }

  private key = (s: string) => `cbz:${this.eid}:${s}`;
  private get stride() { return this.callSeconds / QUICKNET.periodSec; }

  /** UTC now from the beacon's own schedule: one verified "latest" answer, then our monotonic clock carries it. Re-synced every minute. */
  async syncClock(): Promise<boolean> {
    const m = this.deps.mono();
    if (this.offsetMs !== null && m - this.syncedAtMono < 60_000) return true;
    const x = await fetchRound("latest", { ...this.deps.beacon, ...(this.deps.verify ? { verify: this.deps.verify as any } : {}) }, 0);
    if (!x) return this.offsetMs !== null;
    // One answer of "latest" can be a round or two old (a cached mirror) and then makes the clock run SLOW. A stale answer is never too new, so of the last 5 answers the NEWEST estimate
    // (the largest) is the most accurate. An answer more than 15 s below the best one (a changed clock) starts the list again.
    const sample = roundTimeMs(x.round) + (QUICKNET.periodSec * 1000) / 2 - m;
    if (this.offsetSamples.length && Math.max(...this.offsetSamples) - sample > 15_000) this.offsetSamples = [];
    this.offsetSamples.push(sample); if (this.offsetSamples.length > 5) this.offsetSamples.shift();
    this.offsetMs = Math.max(...this.offsetSamples);
    this.syncedAtMono = m;
    return true;
  }
  get nowRound(): number | null { return this.offsetMs === null ? null : roundAt(this.deps.mono() + this.offsetMs); }

  async boot(): Promise<void> {
    try {
      const info = await this.deps.api("GET", `/api/z/${this.eid}/info`);
      this.cap = Number(info.cap) || 0; this.scheduledRound = info.startRound; this.startRound = info.startRound + GRACE_ROUNDS; this.callSeconds = info.callSeconds; this.trackClaims = info.trackClaims !== false; this.controlUrl = typeof info.controlUrl === "string" ? info.controlUrl : null; this.locked = !!info.locked; this.gated = info.locked !== undefined; this.readCfg(info);
    } catch (e: any) {
      const st = e?.status; // the real reason: a wrong link, a game that is not open, or the connection / the service
      this.phase = st === 404 || st === 403 || st === 410 ? "missing" : "boot";
      this.error = st === 404 ? "This engagement link is not valid." : st === 403 || st === 410 ? String(e?.message || "This engagement is not open yet.") : st && st >= 500 ? "The game could not be opened just now. Please try again in a minute." : "Could not reach the engagement. Check your connection.";
      return;
    }
    const pid = this.deps.store.get(this.key("pid"));
    this.myJr = Number(this.deps.store.get(this.key("jr")) ?? 0) || 0;
    try { for (const p of JSON.parse(this.deps.store.get(this.key("claimed")) ?? "[]")) this.claimedAll.add(String(p).includes(":") ? String(p) : `1:${p}`); } catch { /* fresh start */ }
    if (pid) this.adopt(pid); else this.phase = "join";
    this.error = null;
  }

  /** Tickets, rewards and brand breaks come from the engagement's public settings; anything malformed falls back to the plain engagement. */
  private readCfg(info: any) {
    const v = validateCfg({ mark: info?.mark, tickets: info?.tickets, rewards: info?.rewards, breaks: info?.breaks, rounds: info?.rounds, invites: info?.invites, opening: info?.opening, closing: info?.closing }, undefined, { stored: true });
    this.cfg = v.ok ? v.cfg : defaultCfg();
  }
  private adopt(pid: string) {
    this.pid = pid; this.ticketMemo.clear(); this.setCurrent(1); this.phase = "play";
  }
  private ticketsOf(round: number): Ticket[] {
    let t = this.ticketMemo.get(round);
    if (!t && this.pid) { t = ticketsFor(roundEid(this.eid, round), this.pid, this.cfg.tickets); this.ticketMemo.set(round, t); }
    return t ?? [];
  }
  /** Makes `round` the one shown: its tickets and its log. */
  private setCurrent(round: number) {
    this.cur = round; this.tickets = this.ticketsOf(round); this.ticket = this.tickets[0] ?? null;
    while (this.logs.length < round) this.logs.push([]);
  }

  /** This device's own random id (made once, kept on the device). A ticket belongs to the one device that joined with it; the store only keeps a hash. */
  private device(): string {
    let d = this.deps.store.get("cbz:device");
    if (!d || !/^[0-9a-f]{32}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""); this.deps.store.set("cbz:device", d); }
    return d;
  }

  /** Joins with a mobile number. The same number again returns the same participant (and the same ticket). */
  async join(phone: string, name?: string, invite?: { from?: number; cat?: string }): Promise<boolean> {
    try {
      const r = await this.deps.api("POST", `/api/z/${this.eid}/join`, { phone, name, device: this.device(), ...(invite && Number.isInteger(invite.from) ? { from: invite.from, cat: invite.cat } : {}) });
      this.scheduledRound = r.startRound; this.startRound = r.startRound + GRACE_ROUNDS; this.callSeconds = r.callSeconds; this.trackClaims = r.trackClaims !== false;
      if (r.tickets !== undefined || r.rewards !== undefined || r.breaks !== undefined || r.rounds !== undefined || r.opening !== undefined || r.closing !== undefined) this.readCfg(r);
      this.deps.store.set(this.key("pid"), r.pid);
      this.myJr = Number(r.jr) > 0 ? Number(r.jr) : 0; this.deps.store.set(this.key("jr"), String(this.myJr));
      this.adopt(r.pid); this.error = null;
      return true;
    } catch (e: any) {
      this.error = e?.status === 423 || e?.code === "invite-full" ? String(e.message || "This ticket is already on another phone.") : e?.status === 409 ? "This engagement is full." : e?.status === 400 ? "Enter a valid mobile number." : e?.status === 503 ? "It is a busy day. Please try again in a few minutes." : "Could not join. Check your connection and try again.";
      return false;
    }
  }

  private async pollControl(now: number) {
    const m = this.deps.mono();
    if (this.controlState === "none" && !this.locked) {
      // nothing can be paused here (no key was registered, and none can be after the start), so there is almost nothing to ask:
      // once the start has passed a hold can no longer begin, and before it we ask rarely, or every few seconds close to the start if it can be held
      const toStart = this.scheduledRound - now; // a hold can only begin around the time the organizer gave
      if (toStart < -20) return;
      if (m - this.lastControlPoll < (this.gated && toStart < 40 ? 9_000 : 60_000) + (Math.floor(m) % 3000)) return;
    } else if (m - this.lastControlPoll < this.pollBaseMs + (Math.floor(m) % this.pollJitterMs)) return; // the profile's interval plus a little jitter so phones do not all poll together
    this.lastControlPoll = m;
    let body: any = null;
    try { body = this.controlUrl && this.deps.getPublic ? await this.deps.getPublic(this.controlUrl) : await this.deps.api("GET", `/api/z/${this.eid}/control`); } catch (e: any) {
      if (e?.status === 404) { if (this.locked) { this.locked = false; await this.reloadSchedule(); } this.tracker = null; this.controlState = "none"; return; } // no key registered: this engagement cannot be paused
      this.tracker?.failed(now); return;
    }
    this.announcement = body && body.ann && typeof body.ann.id === "string" && typeof body.ann.text === "string" ? { id: body.ann.id, text: body.ann.text.slice(0, 200) } : null;
    const wasLocked = this.locked; this.locked = !!body?.locked;
    if (wasLocked && !this.locked) await this.reloadSchedule(); // paid at last: the start time has moved, read it again
    if (!body?.pubKey) { this.tracker?.failed(now); return; }
    if (!this.tracker) {
      const cfg: ControlConfig = { pubKey: body.pubKey, maxPauseRounds: body.maxPauseRounds, leadRounds: body.leadRounds };
      this.controlFast = body.leadRounds === SAFETY_FAST.leadRounds;
      const safety = ALL_SAFETIES.find((s) => s.leadRounds === body.leadRounds) ?? SAFETY_STANDARD;
      if (safety !== SAFETY_FAST && safety !== SAFETY_STANDARD) { this.pollBaseMs = Math.round(safety.pollMaxSec * 750); this.pollJitterMs = Math.round(safety.pollMaxSec * 250); }
      else { this.pollBaseMs = this.controlFast ? 6_000 : 9_000; this.pollJitterMs = 3_000; }
      this.tracker = new ControlTracker(cfg, this.eid, safety, now);
    }
    if (await this.tracker.ingest(now, body)) this.controlState = "known";
  }

  private async reloadSchedule() {
    try { const info = await this.deps.api("GET", `/api/z/${this.eid}/info`); this.scheduledRound = info.startRound; this.startRound = info.startRound + GRACE_ROUNDS; this.callSeconds = info.callSeconds; this.gated = info.locked !== undefined; this.readCfg(info); } catch { /* the next poll tries again */ }
  }
  private modeAt(now: number): RuntimeView["mode"] {
    if (this.locked) return "hold";
    if (this.controlState === "none") return "none";
    if (this.controlState === "unknown") return this.unknownSince !== null && now - this.unknownSince >= SAFETY_STANDARD.giveUpRounds ? "blind" : "hold";
    return this.tracker!.mode(now);
  }
  private roundFor(k: number, round = this.cur): number | null {
    return callRoundR(this.tracker ? this.tracker.state : null, this.startRound, this.stride, this.cfg.breaks, round, k);
  }
  /** The latest round whose first number is due. Rounds before it are played out (or being caught up). */
  private startedRounds(now: number): number {
    let n = 0;
    for (let r = 1; r <= this.cfg.rounds; r++) { const f = this.roundFor(0, r); if (f === null || f > now) break; n = r; }
    return n;
  }

  /** One pass of the loop. Call about once a second. Safe to call while offline (it simply makes no progress). */
  async tick(): Promise<RuntimeView> {
    if (this.phase === "ended") { await this.autoClaim(); await this.pollResults(); await this.castVotes(); return this.view(); } // a claim that failed to send keeps being retried after the last call // the engagement is over, but the outcome is still worth fetching
    if (this.phase !== "play") return this.view();
    if (!(await this.syncClock())) { this.error = "Waiting for the clock. Check your connection."; return this.view(); }
    this.error = null;
    const now = this.nowRound!;
    await this.pollControl(now);
    if (this.controlState === "unknown" && this.unknownSince === null) this.unknownSince = now;
    const m = this.modeAt(now);
    const live = m === "live" || m === "none" || m === "blind"; // blind = we have been unable to ask for a long time: play on, visibly flagged
    const started = this.startedRounds(now);
    // beacon rounds we are entitled to reveal: their scheduled round has been published
    const want: number[] = [];
    for (let r = 1; r <= started && want.length < 8; r++) {
      if ((this.logs[r - 1]?.length ?? 0) >= NUMBERS) continue;
      for (let k = 0; k < NUMBERS && want.length < 8; k++) {
        const br = this.roundFor(k, r);
        if (br === null || br > now) break;
        if (!this.store.rounds.has(br)) want.push(br);
      }
    }
    await Promise.all(want.map((br, i) => (now - br <= 2 ? this.store.fetchLive(br, i) : this.store.fetchBackfill(br, i))));
    this.store.verifySome(2);
    if (live) for (let r = 1; r <= Math.max(1, started); r++) this.buildLog(now, r); // on hold we keep showing what we had, and reveal nothing new
    this.setCurrent(Math.max(1, started));
    if (m !== "blind") await this.autoClaim(); // never claim from a log that might be missing a pause we could not hear about
    await this.pollSeats(now);
    this.syncEngines(Math.max(1, started));
    await this.pollResults();
    await this.castVotes();
    const stopped = this.tracker?.state.stopRound != null && now >= this.tracker.state.stopRound;
    const byPrizes = !this.deps.noEarlyEnd && this.cur >= this.cfg.rounds && this.prizesAwarded(this.cur) && this.breaksPlayed(now);
    if (byPrizes) this.prizesEnded = true;
    if ((this.cur >= this.cfg.rounds && (this.logs[this.cur - 1]?.length ?? 0) >= NUMBERS) || stopped || byPrizes) this.phase = "ended";
    return this.view();
  }

  private get myCountFrom() { return countFromOf(this.myJr); }
  /** Round `round`'s calls as this phone may count them: numbers called before it could count become 0, so call positions stay the same for everyone. */
  private maskedLog(round: number): number[] {
    const log = this.logs[round - 1] ?? [], cf = this.myCountFrom;
    if (!cf) return log;
    return log.map((n, k) => ((this.roundFor(k, round) ?? Infinity) >= cf ? n : 0));
  }
  private builtDiscards = 0;
  private builtMsgs = 0;
  /** Extends a round's call log with newly available rounds instead of recomputing all 75 calls every second. Rebuilds from scratch only if a provisional round was thrown away or an organizer message arrived. */
  private buildLog(now: number, round: number): number[] {
    const msgs = this.tracker?.log.length ?? 0;
    if (this.store.discarded !== this.builtDiscards || msgs !== this.builtMsgs) { this.logs = this.logs.map(() => []); this.logResets++; this.builtDiscards = this.store.discarded; this.builtMsgs = msgs; } // a new organizer message can move later calls: re-derive
    while (this.logs.length < round) this.logs.push([]);
    const out = this.logs[round - 1]!;
    const id = roundEid(this.eid, round);
    for (let k = out.length; k < NUMBERS; k++) {
      const r = this.roundFor(k, round);
      if (r === null || r > now) break;
      const x = this.store.rounds.get(r);
      if (!x) break;
      out.push(pickNumber(id, k, x.randomness, out));
    }
    return out;
  }

  private unsent = 0;
  /** Set once the last prize of the last round was awarded and every break has been played. */
  private prizesEnded = false;
  /** The beacon round this phone joined in when that was after the game began (0: in time). */
  private myJr = 0;
  private cap = 0;
  // every phone works out the winners itself from the public seat list
  private seatList: { pid: string; countFrom: number; ex?: boolean; blk?: boolean }[] = [];
  private blkVer = 0; // changes when the list of removed seats changes
  private engineBlk = new Map<number, number>();
  private seatUpto = 0;
  private seatsFetched = false;
  private lastSeatPoll = -Infinity;
  /** The beacon round the newest seat list was asked for in: a lucky draw is only worked out from a list at least that fresh. */
  private seatsFreshRound = 0;
  private wantSeats = false;
  // ---- winners are settled by phones, never by a person: this phone reports what it worked out, and the store accepts a result once enough different phones agree
  private voted = new Set<string>();
  private firstSeen = new Map<string, number>();
  private lastVote = -Infinity;
  private luckyLocal: { ordinal: number; idx: number; round: number; winners: string[] }[] = [];
  private luckyBusy = false;
  private engines = new Map<number, PrizeEngine>();
  private engineCursor = new Map<number, number>();
  private engineReset = new Map<number, number>();
  private logResets = 0;
  private serverResults: NonNullable<RuntimeView["results"]> = [];
  private claimLens: number[] = [];
  private async autoClaim() {
    if (!this.pid) return;
    const lens = this.logs.map((l) => l.length);
    if (lens.length === this.claimLens.length && lens.every((n, i) => n === this.claimLens[i]) && this.unsent === 0) return; // nothing new has been called and nothing is waiting to be sent
    this.claimLens = lens;
    this.unsent = 0;
    for (let r = 1; r <= this.logs.length; r++) {
      const tk = this.ticketsOf(r), log = this.maskedLog(r);
      if (!tk.length || !log.length) continue;
      for (const p of keysInPlay(this.cfg.rewards)) {
        const id = `${r}:${p}`;
        if (this.claimedAll.has(id)) continue;
        const idx = completionIndexKey(tk, p, log);
        if (idx < 0) continue;
        try {
          if (this.trackClaims) await this.deps.api("POST", `/api/z/${this.eid}/claims`, { pid: this.pid, claims: [{ pattern: p, idx, ...(r > 1 ? { round: r } : {}) }] });
          this.claimedAll.add(id);
          this.deps.store.set(this.key("claimed"), JSON.stringify([...this.claimedAll]));
        } catch { this.unsent++; /* kept: the next tick sends it again; a claim is never lost because nothing is marked sent until it was */ }
      }
    }
  }

  private allResults: NonNullable<RuntimeView["results"]> = [];
  /** Every reward line of `round` has a published result. A house that fewer people complete than it has lines never gets here, and the engagement then runs to its last number as before. */
  private prizesAwarded(round: number): boolean {
    const keys = keysInPlay(this.cfg.rewards);
    if (!keys.length) return false;
    return keys.every((k) => linesFor(this.cfg.rewards, k).every((l) => this.allResults.some((x) => x.pattern === k && x.ordinal === l.ordinal && (x.round ?? 1) === round)));
  }
  /** Round 1 holds the brand breaks: the engagement does not end before the last one has been played. */
  private breaksPlayed(now: number): boolean {
    if (this.cur > 1 || !this.cfg.breaks.length) return true;
    return this.cfg.breaks.every((b) => this.logCache.length >= b.after) && this.currentBreak(now) === null;
  }
  /** This phone completed a house but its result is not out yet: ask often so the winner hears quickly. */
  private waitingForResult(): boolean {
    if (!this.tickets.length) return false;
    return keysInPlay(this.cfg.rewards).some((k) => completionIndexKey(this.tickets, k, this.maskedLog(this.cur)) >= 0 && !this.allResults.some((x) => x.pattern === k && (x.round ?? 1) === this.cur));
  }
  /** Seat list polling: how often depends on the engagement's size so the free plan is never stretched, and always stays well inside the late-joiner lag. */
  private seatEveryMs(): number { const c = this.cap; return c <= 250 ? 15_000 : c <= 1000 ? 25_000 : c <= 2500 ? 40_000 : 50_000; }
  private async pollSeats(now: number) {
    const m = this.deps.mono();
    if (now < this.startRound || (!this.wantSeats && m - this.lastSeatPoll < (this.seatsFetched ? this.seatEveryMs() : 5_000) + (Math.floor(m) % 2000))) return;
    this.lastSeatPoll = m; this.wantSeats = false;
    const askedAt = this.nowRound ?? 0;
    try {
      const r = await this.deps.api("GET", `/api/z/${this.eid}/seats?after=${this.seatUpto}`);
      if (!r || !r.ready || !Array.isArray(r.seats)) return;
      const known = new Set(this.seatList.map((x) => x.pid));
      const blk = new Set<string>(Array.isArray(r.blk) ? r.blk.filter((x: unknown): x is string => typeof x === "string") : []); // removed seats: still listed
      for (const [, pid, jr, ex] of r.seats as [number, string, number, number?][]) if (!known.has(pid)) { known.add(pid); this.seatList.push({ pid, countFrom: countFromOf(jr), ex: ex === 1, blk: blk.has(pid) }); }
      if (Array.isArray(r.blk)) { let changed = false; for (const s of this.seatList) { const b = blk.has(s.pid); if (!!s.blk !== b) { s.blk = b; changed = true; } } if (changed) this.blkVer++; }
      this.seatUpto = Math.max(this.seatUpto, Number(r.upto) || 0);
      this.seatsFetched = true; this.seatsFreshRound = Math.max(this.seatsFreshRound, askedAt);
    } catch { /* the next poll tries again; until then the organizer's published results (if any) are used */ }
  }
  /** Brings each round's engine up to date with the seats and numbers this phone knows. Tickets are made in small slices so the screen never freezes. */
  private syncEngines(started: number) {
    if (!this.seatsFetched) return;
    for (let r = 1; r <= started; r++) {
      let e = this.engines.get(r);
      if (!e) { e = new PrizeEngine(this.eid, this.cfg, r); this.engines.set(r, e); this.engineCursor.set(r, 0); this.engineReset.set(r, this.logResets); }
      if (this.engineReset.get(r) !== this.logResets) { e.resetCalls(); this.engineReset.set(r, this.logResets); }
      const cur = this.engineCursor.get(r)!;
      if (cur < this.seatList.length) { e.addSeats(this.seatList.slice(cur)); this.engineCursor.set(r, this.seatList.length); }
      e.work(25);
      const log = this.logs[r - 1] ?? [];
      for (let k = e.calls; k < log.length; k++) { const br = this.roundFor(k, r); if (br === null) break; e.feed(log[k]!, br); }
    }
  }
  private get localOk(): boolean { return this.seatsFetched && this.engines.size > 0 && [...this.engines.values()].every((e) => e.pending === 0); }
  private async pollResults() {
    const m = this.deps.mono();
    const nowR = this.nowRound;
    if (nowR !== null) await this.computeLucky(nowR);
    const local = this.localOk;
    if (local) {
      const mine: NonNullable<RuntimeView["results"]> = [];
      for (const [r, e] of this.engines) for (const x of e.results()) mine.push({ pattern: x.pattern, ordinal: x.ordinal, idx: x.idx, count: x.pids.length, round: r, winners: x.pids, ...(x.tied ? { tied: x.tied } : {}) });
      this.allResults = [...mine, ...this.luckyResults(), ...this.serverResults.filter((x) => x.pattern === "lucky" && !this.luckyLocal.some((l) => l.ordinal === x.ordinal))];
    }
    // the organizer's published results: the fallback while the seat list is not here yet, and the only source for lucky draws
    // (lucky draws: only once a draw's break has been reached and its winners are not out yet, and then every 10 s)
    const luckyDue = this.cur === 1 && this.luckyView().some((l, i) => !l.published && this.logCache.length >= (this.cfg.breaks.filter((b) => b.kind === "lucky")[i]?.after ?? Infinity));
    const needServer = !local || luckyDue;
    if (!needServer || m - this.lastResultPoll < (local ? 10_000 : this.waitingForResult() ? 4_000 : 15_000) || !this.logs.some((l) => l.length > 0)) return;
    this.lastResultPoll = m;
    try {
      this.serverResults = (await this.deps.api("GET", `/api/z/${this.eid}/results`)).results ?? this.serverResults;
      this.allResults = this.localOk ? [...this.allResults.filter((x) => x.pattern !== "lucky"), ...this.luckyResults(), ...this.serverResults.filter((x) => x.pattern === "lucky" && !this.luckyLocal.some((l) => l.ordinal === x.ordinal))] : this.serverResults;
    } catch { /* shown next time */ }
  }
  private luckyResults(): NonNullable<RuntimeView["results"]> { return this.luckyLocal.map((l) => ({ pattern: "lucky" as const, ordinal: l.ordinal, idx: l.idx, count: l.winners.length, round: 1, winners: l.winners })); }
  /** A lucky draw is worked out here, from the public randomness of the round that ends its break and the public seat list: the same on every phone, and nobody can steer it. */
  private async computeLucky(now: number) {
    if (this.luckyBusy || !this.seatsFetched) return;
    const L = this.cfg.breaks.filter((b) => b.kind === "lucky");
    if (!L.length) return;
    this.luckyBusy = true;
    try {
      for (let i = 0; i < L.length; i++) {
        if (this.luckyLocal.some((x) => x.ordinal === i + 1)) continue;
        const round = luckyRound(this.tracker ? this.tracker.state : null, this.startRound, this.stride, this.cfg.breaks, L[i]!);
        if (round === null || round > now) continue;
        if (this.seatsFreshRound < round) { this.wantSeats = true; continue; } // the seat list must be at least as new as the draw
        const x = this.store.rounds.get(round) ?? (await fetchRound(round, { ...this.deps.beacon, ...(this.deps.verify ? { verify: this.deps.verify as any } : {}) }, 0));
        if (!x) continue;
        const pids = this.seatList.filter((s) => s.countFrom <= round && !s.ex).map((s) => s.pid); // the Organizer, Hosts and Co-hosts (flagged before the game) stay out of lucky draws
        this.luckyLocal.push({ ordinal: i + 1, idx: L[i]!.after, round, winners: luckyWinners(this.eid, L[i]!.after, x.randomness, pids, L[i]!.winners || 3) });
      }
    } catch { /* tried again on the next pass */ } finally { this.luckyBusy = false; }
  }
  private sampled(seat: number, key: string, p: number): boolean {
    if (p >= 1) return true;
    let h = 2166136261; const s = seat + "|" + key;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h / 4294967296 < p;
  }
  /** Reports this phone's own result for every prize to the store. Only a share of the phones speak up at first (so a big game stays inside the free request allowance); the rest join in, wave by wave, if no result appears. */
  private async castVotes() {
    const m = this.deps.mono();
    if (!this.pid || !this.localOk || m - this.lastVote < 4_000) return;
    const seat = seatOfPid(this.pid);
    if (seat === null) return;
    this.lastVote = m;
    const people = Math.max(1, this.seatList.length), p0 = votersFor(people) / people;
    const items: { key: string; body: object }[] = [];
    for (const [r, e] of this.engines) for (const x of e.results()) items.push({ key: `${r}:${x.pattern}:${x.ordinal}`, body: { pattern: x.pattern, ordinal: x.ordinal, round: r, idx: x.idx, pids: [...x.pids].sort() } });
    for (const l of this.luckyLocal) items.push({ key: `1:lucky:${l.ordinal}`, body: { pattern: "lucky", ordinal: l.ordinal, round: 1, idx: l.idx, pids: [...l.winners].sort() } });
    const send: { key: string; body: object }[] = [];
    for (const it of items) {
      if (this.voted.has(it.key)) continue;
      const first = this.firstSeen.get(it.key) ?? (this.firstSeen.set(it.key, m), m);
      const wave = Math.min(12, Math.floor((m - first) / 30_000));
      if (this.sampled(seat, it.key, Math.min(1, p0 * 2 ** wave))) send.push(it);
    }
    for (let i = 0; i < send.length; i += 3) {
      const part = send.slice(i, i + 3);
      try { await this.deps.api("POST", `/api/z/${this.eid}/vote`, { pid: this.pid, results: part.map((x) => x.body) }); for (const x of part) this.voted.add(x.key); }
      catch { break; /* kept: the next pass reports it again */ }
    }
  }

  private currentBreak(now: number | null): RuntimeView["brk"] {
    if (now === null || this.phase !== "play" || !this.cfg.breaks.length || this.cur > 1) return null; // brand breaks belong to round 1
    const a = activeBreak(this.tracker ? this.tracker.state : null, this.startRound, this.stride, this.cfg.breaks, now);
    if (!a || this.offsetMs === null) return null;
    return { title: a.brk.title, kind: a.brk.kind, ...(a.brk.mediaUrl ? { mediaUrl: a.brk.mediaUrl } : {}), ...(a.brk.winners ? { winners: a.brk.winners } : {}), seconds: a.brk.seconds, secondsLeft: Math.max(0, Math.round((roundTimeMs(a.endsAtRound) - (this.deps.mono() + this.offsetMs)) / 1000)) };
  }
  private luckyView(): RuntimeView["lucky"] {
    const out: RuntimeView["lucky"] = []; let n = 0;
    for (const b of this.cfg.breaks) {
      if (b.kind !== "lucky") continue;
      n++;
      const r = this.allResults.find((x) => x.pattern === "lucky" && x.ordinal === n);
      out.push({ ordinal: n, title: b.title, winners: b.winners ?? 3, style: b.style === "scratch" ? "scratch" : "draw", published: !!r, won: !!r && !!this.pid && (r.winners ?? []).includes(this.pid) });
    }
    return out;
  }
  private myIdx(): Partial<Record<PatternKey, number>> {
    const o: Partial<Record<PatternKey, number>> = {};
    if (this.tickets.length) { const ml = this.maskedLog(this.cur); for (const k of keysInPlay(this.cfg.rewards)) o[k] = completionIndexKey(this.tickets, k, ml); }
    return o;
  }
  private pastView(): RuntimeView["past"] {
    const out: RuntimeView["past"] = [];
    for (let r = 1; r < this.cur; r++) {
      const tk = this.ticketsOf(r), log = this.maskedLog(r);
      const got: { pattern: PatternKey; ordinal: number }[] = [];
      for (const x of this.allResults) {
        if ((x.round ?? 1) !== r || x.pattern === "lucky") continue;
        if (this.isWinner(x, tk, log)) got.push({ pattern: x.pattern as PatternKey, ordinal: x.ordinal });
      }
      out.push({ round: r, got });
    }
    return out;
  }

  private isWinner(x: { pattern: string; idx: number; winners?: string[] }, tk: readonly Ticket[], log: readonly number[]): boolean {
    if (Array.isArray(x.winners) && x.winners.length) return !!this.pid && x.winners.includes(this.pid);
    return completionIndexKey(tk, x.pattern as PatternKey, log) === x.idx; // an older store that names no winner: the call decides
  }
  private wonView(): RuntimeView["won"] {
    const out: RuntimeView["won"] = [];
    if (!this.pid) return out;
    for (const x of this.allResults) {
      if (x.pattern === "lucky") continue;
      const r = x.round ?? 1, key = x.pattern as PatternKey, tk = this.ticketsOf(r), log = this.maskedLog(r);
      if (!tk.length) continue;
      if (!this.isWinner(x, tk, log)) continue;
      const line = linesFor(this.cfg.rewards, key).find((l) => l.ordinal === x.ordinal);
      out.push({ round: r, pattern: key, ordinal: x.ordinal, text: line?.text ?? "", cells: winCells(tk, key, log, x.idx), idx: x.idx });
    }
    return out;
  }

  private visibleLog(): number[] { const cf = this.myCountFrom; return cf ? this.maskedLog(this.cur).filter((n) => n > 0) : this.logCache; }
  private lateView(now: number | null): RuntimeView["late"] {
    const cf = this.myCountFrom;
    if (!cf) return null;
    const hidden = this.maskedLog(this.cur).filter((n) => n === 0).length;
    const secondsUntil = now === null || this.offsetMs === null ? LATE_LAG_ROUNDS * 3 : // clock not synced yet: assume the full wait rather than telling them their numbers have started
       Math.max(0, Math.round((roundTimeMs(cf) - (this.deps.mono() + this.offsetMs)) / 1000));
    return { countFromRound: cf, secondsUntil, hidden };
  }

  view(): RuntimeView {
    const now = this.nowRound;
    const st = this.tracker?.state;
    const done = this.logCache.length >= NUMBERS;
    const nextInRound = !done ? this.roundFor(this.logCache.length) : null;
    const nextRoundFirst = done && this.cur < this.cfg.rounds ? this.roundFor(0, this.cur + 1) : null;
    const nextRound = nextInRound ?? nextRoundFirst;
    const secsTo = (br: number) => (this.offsetMs === null ? null : Math.max(0, Math.round((roundTimeMs(br) - (this.deps.mono() + this.offsetMs)) / 1000)));
    const inter = now !== null && this.cur < this.cfg.rounds ? activeIntermission(st ?? null, this.startRound, this.stride, this.cfg.breaks, this.cur + 1, now) : null;
    const claimedNow = keysInPlay(this.cfg.rewards).filter((k) => this.claimedAll.has(`${this.cur}:${k}`));
    return {
      phase: this.phase, error: this.error, pid: this.pid, ticket: this.ticket, log: this.visibleLog(), nowRound: now, startRound: this.startRound, scheduledRound: this.scheduledRound, callSeconds: this.callSeconds,
      locked: this.locked, announcement: this.announcement,
      mode: now === null ? (this.controlState === "none" ? "none" : "hold") : this.modeAt(now), paused: !!st && now !== null && pausedAt(st, now), stopped: !!st && now !== null && st.stopRound !== null && now >= st.stopRound,
      claimed: claimedNow, unsent: this.unsent, results: this.allResults.filter((x) => (x.round ?? 1) === this.cur), pendingChecks: this.store.pending(), discarded: this.store.discarded,
      nextCallInSec: nextRound !== null && now !== null ? secsTo(nextRound) : null,
      tickets: this.tickets, cfg: this.cfg, brk: this.currentBreak(now), myIdx: this.myIdx(), lucky: this.luckyView(),
      round: this.cur, rounds: this.cfg.rounds, intermission: inter ? { round: this.cur + 1, secondsLeft: secsTo(inter.endsAtRound) ?? 0 } : null, past: this.pastView(),
      won: this.wonView(), allAwarded: this.prizesAwarded(this.cur), endedByPrizes: this.prizesEnded, late: this.lateView(now), localWinners: this.localOk,
    };
  }
}

/** The numbers on the ticket(s) that made the winning pattern, to light them up (see `winningNumbers`). Empty when it cannot be told. */
function winCells(tickets: readonly Ticket[], key: PatternKey, log: readonly number[], idx: number): number[] {
  for (const t of tickets) if (completionIndexKey([t], key, log) === idx) return winningNumbers(t, key, log, idx);
  return [];
}

export { generateTicket };
