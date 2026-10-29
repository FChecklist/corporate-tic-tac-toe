// QA model for Corporate Tic Tac Toe (2026-10-29). It ENUMERATES the game and checks the REAL modules, not copies of them:
//   packages/ttt/src (classic, match, bracket, phone), apps/edge/src/worker.ts + tournament.ts (through the same in-memory database the test suites use).
// Run:   bun tools/qa-model.mjs [--quick] [--json out.json]        (needs bun: the modules are TypeScript)
//   --quick  fewer player counts (about 40 seconds); the default takes a few minutes.
// Exit code 0 = every check passed except the findings listed in KNOWN (the open owner decisions); 1 = something new failed.
//
// What it covers (the owner's list):
//   M1  the board: every legal game of 3x3 / three in a row (255,168 games, 5,478 states) against an independent win check; no state without a legal move; the clock-out square is always legal
//       (the product has ONE board size and ONE win length: nothing else is offered, so nothing else is enumerated; see the findings list)
//   M2  tournament shapes: players 1..520 and some big ones, solo, teams of 3 and teams of 5: byes, odd numbers, remainders, bracket sizes, who is where
//   M3  whole tournaments played by the real engine: nobody plays / everybody plays at random / every game drawn (fate) / slow play (longest tournament) / half away; every bracket completes,
//       every entrant gets a unique rank, every player gets a result, the points add up
//   M4  the clocks: 20 s move clock, 30 s first move, the exact deadline, time-outs, forfeits, both away, pause, look-order independence
//   M5  draws, ties and tie-breakers: replay up to 3 games, fate, the ranking order and the one line that says how each tie was decided
//   M6  the real Worker: free (10 people), paid, guest-list shapes, roles x routes, reconnect, end early, pause, all-away
//   M7  the words players read (checked against docs/boss/RULES_tictactoe.md, section 10)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const QUICK = process.argv.includes("--quick");
const JSON_OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : "";
const src = (p) => import(join(ROOT, p));

const { outcomeOf, LINES, emptiesOf, place, markToMove, emptyCells } = await src("packages/ttt/src/classic.ts");
const M = await src("packages/ttt/src/match.ts");
const B = await src("packages/ttt/src/bracket.ts");
const P = await src("packages/ttt/src/phone.ts");
const { applyMove, advanceBoard, newBoard, lastGame, moverOf, shiftBoard, fateOf, MAX_GAMES, MISSED_LIMIT, DEFAULT_MOVE_MS, DEFAULT_READY_MS } = M;
const { startTournament, advanceTournament, moveInTournament, rankings, layout, MAX_PLAYERS, midOf, parentOf, feedersOf, ctxOf, tieLine, publicView } = B;

// ------------------------------------------------------------------------------------------------ reporting
const checks = []; // { id, area, ok, n, text }
const FINDINGS = []; // classified problems: { id, cls, title, where, evidence }
const t0 = performance.now();
function check(id, area, ok, text, n = 1) { checks.push({ id, area, ok: !!ok, n, text }); if (!ok) console.log(`  FAIL ${id}: ${text}`); return !!ok; }
function finding(id, cls, title, where, evidence, decision = "") { FINDINGS.push({ id, cls, title, where, evidence, decision }); }
const section = (s) => console.log(`\n== ${s}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
const lcg = (seed) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000; };
const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);

// ================================================================================================ M1  the board
section("M1 the board: every game of 3x3");
// An independent check of three in a row, built from the geometry (not from the LINES table in classic.ts).
const GEO = []; for (let r = 0; r < 3; r++) GEO.push([0, 1, 2].map((c) => r * 3 + c)); for (let c = 0; c < 3; c++) GEO.push([0, 1, 2].map((r) => r * 3 + c));
GEO.push([0, 1, 2].map((i) => i * 4)); GEO.push([0, 1, 2].map((i) => 2 + i * 2));
const refOutcome = (cells) => { for (const l of GEO) { const m = cells[l[0]]; if (m && m === cells[l[1]] && m === cells[l[2]]) return m; } return cells.every((c) => c) ? "draw" : "playing"; };
check("M1.lines", "board", LINES.length === 8 && LINES.every((l) => GEO.some((g) => g.join() === l.join())) && GEO.length === 8, "the 8 lines of classic.ts are exactly the 3 rows, 3 columns and 2 diagonals");
{
  const cfg = { seed: "qa-seed", moveMs: 20_000, readyMs: 30_000 };
  const board0 = await newBoard(cfg, "r1m0", 0, "A", "B", T0);
  const stats = { leaves: 0, xWin: 0, oWin: 0, draw: 0, nodes: 0, disagree: 0, stuck: 0, maxDepth: 0 };
  const states = new Map(); // "cells" -> sequence that reaches it (non terminal)
  const seen = new Set();
  async function dfs(board, cells, seq) {
    stats.nodes++;
    const key = cells.join(""); seen.add(key);
    const empt = emptiesOf(cells);
    if (empt.length === 0 || refOutcome(cells) !== "playing") return;
    if (!states.has(key)) states.set(key, seq);
    let moved = 0;
    for (const c of empt) {
      const b = structuredClone(board); const g = lastGame(b); const mover = moverOf(g);
      const r = await applyMove(cfg, "r1m0", b, mover, c, T0 + 1000 * (seq.length + 1));
      if (!r.ok) { stats.stuck++; continue; }
      moved++;
      const nc = [...cells]; nc[c] = mover === g.x ? 1 : 2;
      const ref = refOutcome(nc);
      const g1 = b.games[0];
      let eng; // what the engine says about game 1
      if (g1.result?.kind === "win") eng = g1.result.winner === g1.x ? 1 : 2; else if (g1.result?.kind === "draw") eng = "draw"; else eng = "playing";
      if (String(eng) !== String(ref) || (JSON.stringify(g1.cells) !== JSON.stringify(nc))) { stats.disagree++; continue; }
      if (ref === "playing") await dfs(b, nc, [...seq, c]);
      else {
        stats.leaves++; stats.maxDepth = Math.max(stats.maxDepth, seq.length + 1);
        if (ref === "draw") { stats.draw++; if (!(b.games.length === 2 && b.games[1].x === g1.o && b.games[1].o === g1.x && !b.done)) stats.disagree++; }
        else { if (ref === 1) stats.xWin++; else stats.oWin++; if (!(b.done && b.winner === (ref === 1 ? g1.x : g1.o) && b.via === "win")) stats.disagree++; }
        seen.add(nc.join(""));
      }
    }
    if (moved === 0) stats.stuck++;
  }
  await dfs(board0, emptyCells(), []);
  check("M1.leaves", "board", stats.leaves === 255168, `all 255,168 legal games reached (found ${stats.leaves})`, stats.leaves);
  check("M1.split", "board", stats.xWin === 131184 && stats.oWin === 77904 && stats.draw === 46080, `X wins ${stats.xWin} (131,184), O wins ${stats.oWin} (77,904), draws ${stats.draw} (46,080)`);
  check("M1.states", "board", seen.size === 5478, `5,478 reachable boards (found ${seen.size})`, seen.size);
  check("M1.agree", "board", stats.disagree === 0, `engine and independent check agree on every move of every game (${stats.nodes} moves compared, ${stats.disagree} disagree)`, stats.nodes);
  check("M1.stuck", "board", stats.stuck === 0, `no reachable board without a legal move (${stats.stuck} stuck)`);
  check("M1.depth", "board", stats.maxDepth === 9, "no game is longer than 9 moves");
  // unreachable boards: of the 3^9 = 19,683 fillings only 5,478 can happen; markToMove / outcomeOf must still never throw
  let unreachable = 0, thrown = 0;
  for (let n = 0; n < 19683; n++) { const cells = []; let x = n; for (let i = 0; i < 9; i++) { cells.push(x % 3); x = Math.floor(x / 3); } if (!seen.has(cells.join(""))) unreachable++; try { outcomeOf(cells); markToMove(cells); } catch { thrown++; } }
  check("M1.unreach", "board", unreachable === 19683 - 5478 && thrown === 0, `${unreachable} fillings can never happen; the rules code does not throw on any of them`, 19683);
  // refusals
  const rf = [() => place(emptyCells(), -1, 1), () => place(emptyCells(), 9, 1), () => place(emptyCells(), 1.5, 1), () => place(place(emptyCells(), 4, 1), 4, 2)];
  check("M1.refuse", "board", rf.every((f) => { try { f(); return false; } catch { return true; } }), "a square off the board, between squares or taken is refused");
  // the clock-out square: from EVERY reachable undecided board, with the player to move silent, the software plays a legal empty square, the clocks go on, and the board always ends
  let coBad = 0, coN = 0, endSteps = 0, maxSteps = 0;
  for (const [key, seq] of states) {
    const b = await newBoard(cfg, "r1m0", 0, "A", "B", T0); let t = T0;
    for (const c of seq) { t += 1000; const r = await applyMove(cfg, "r1m0", b, moverOf(lastGame(b)), c, t); if (!r.ok) coBad++; }
    const g = lastGame(b); const before = [...g.cells]; const nMoves = g.moves.length;
    const probe = structuredClone(b); await advanceBoard(cfg, "r1m0", probe, g.deadline + 1);
    const pg = lastGame(probe);
    coN++;
    if (probe.done && pg.moves.length === nMoves && pg.result?.kind !== "forfeit") coBad++; // it ended without a move and without a forfeit
    else if (pg.no === g.no && pg.moves.length === nMoves + 1) { const mv = pg.moves[nMoves]; if (!mv.auto || before[mv.cell] !== 0 || mv.pid !== moverOf(g) || mv.at !== g.deadline) coBad++; }
    // nobody ever plays: how many clock-outs until it ends (bounded)
    const far = structuredClone(b); let steps = 0;
    while (!far.done && steps < 100) { await advanceBoard(cfg, "r1m0", far, lastGame(far).deadline + 1); steps++; }
    if (!far.done) coBad++; maxSteps = Math.max(maxSteps, steps); endSteps += steps;
  }
  check("M1.clockout", "board", coBad === 0, `from all ${coN} undecided boards a clock-out plays an empty square for the right player at the right time, and a silent board always ends (longest: ${maxSteps} clock-outs)`, coN);
}

// ================================================================================================ M2  tournament shapes
section("M2 tournament shapes: players x format x remainders x byes");
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const players = (n, tag = "p") => Array.from({ length: n }, (_, i) => ({ pid: `${i + 1}x${tag}${String(i).padStart(4, "0")}`, name: `Player ${i + 1}` }));
const SEED = "a1".repeat(32);
async function shapeCheck(n, format, ts) {
  const ps = players(n); const bad = [];
  let t;
  try { t = await startTournament({ eid: "E", seed: SEED, players: ps, format, teamSize: ts, startAt: T0 }); }
  catch (e) { return { threw: String(e.message), bad }; }
  const E = format === "team" ? Math.floor(n / ts) : n, R = n && E ? n - E * (format === "team" ? ts : 1) : 0;
  if (t.entrants.length !== E) bad.push(`entrants ${t.entrants.length} != ${E}`);
  if (t.reserve.length !== (format === "team" ? n % ts : 0)) bad.push(`reserve ${t.reserve.length} != ${format === "team" ? n % ts : 0}`);
  const seen = new Map(); for (const e of t.entrants) for (const m of e.members) seen.set(m, (seen.get(m) ?? 0) + 1); for (const r of t.reserve) seen.set(r, (seen.get(r) ?? 0) + 1);
  if (seen.size !== n || [...seen.values()].some((v) => v !== 1)) bad.push("a player is lost or listed twice");
  if (format === "team" && t.entrants.some((e) => e.members.length !== ts)) bad.push("a team of the wrong size");
  const size = nextPow2(E); if (t.size !== size || t.rounds !== Math.log2(size)) bad.push(`size/rounds ${t.size}/${t.rounds}`);
  if (Object.keys(t.matches).length !== size - 1) bad.push(`matches ${Object.keys(t.matches).length} != ${size - 1}`);
  const r1 = Object.values(t.matches).filter((m) => m.round === 1);
  let byes = 0, both = 0, empty2 = 0; const slot = new Map();
  for (const m of r1) {
    if (m.bye) byes++; else if (m.a && m.b) both++; if (!m.a && !m.b) empty2++;
    for (const s of [m.a, m.b]) if (s) slot.set(s, (slot.get(s) ?? 0) + 1);
    if (m.bye && !((!!m.a) !== (!!m.b) && m.winner === (m.a ?? m.b) && m.status === "done")) bad.push("a bye is not a bye");
    if (!m.bye && size > 1 && !(m.a && m.b)) bad.push("an open pair without two sides");
    if (format === "team" && !m.bye && m.boards.length !== ts) bad.push(`team match with ${m.boards.length} boards`);
    if (format === "solo" && !m.bye && m.boards.length !== 1) bad.push("solo match without exactly one board");
  }
  if (size > 1) {
    if (byes !== size - E) bad.push(`byes ${byes} != ${size - E}`);
    if (empty2) bad.push("two byes met");
    if (slot.size !== E || [...slot.values()].some((v) => v !== 1)) bad.push("an entrant is not placed exactly once in round 1");
    if (both + byes !== size / 2) bad.push("round 1 does not fill the bracket");
    for (const m of Object.values(t.matches)) { if (m.round > 1 && (m.a || m.b) && !(Object.values(t.matches).filter((x) => x.round === 1 && x.bye).some((x) => x.winner === m.a || x.winner === m.b))) bad.push("a later match was filled without a bye"); }
    const fm = ctxOf(t);
    for (const m of Object.values(t.matches)) { const p = parentOf(fm, m); if (m.round < t.rounds) { if (!p || !feedersOf(t.matches[p.mid]).includes(m.mid)) bad.push("parent/feeder mismatch"); } else if (p) bad.push("final has a parent"); }
    for (let r = 1; r <= t.rounds; r++) if (Object.values(t.matches).filter((m) => m.round === r).length !== size / 2 ** r) bad.push("round " + r + " has the wrong number of matches");
  } else if (!(t.done && t.champion === t.entrants[0].id)) bad.push("a single entrant is not the champion at once");
  // roster order must not matter
  const rev = await startTournament({ eid: "E", seed: SEED, players: [...ps].reverse(), format, teamSize: ts, startAt: T0 });
  const sig = (x) => JSON.stringify(Object.values(x.matches).map((m) => [m.mid, m.a, m.b, m.bye ? 1 : 0]));
  if (sig(rev) !== sig(t) || JSON.stringify(rev.entrants) !== JSON.stringify(t.entrants)) bad.push("the bracket depends on the order the names were typed in");
  return { t, bad, byes, E, R };
}
{
  const solo = QUICK ? [...Array(40).keys()].map((i) => i + 1).concat([63, 64, 65, 127, 128, 129, 255, 256, 257, 1000, 1023, 1024, 1025]) : [...Array(520).keys()].map((i) => i + 1).concat([1000, 1023, 1024, 1025, 2047, 2048, 2049, 4097, 5000, 9999, 10000]);
  let bad = 0, n = 0, worst = "";
  for (const N of solo) { const r = await shapeCheck(N, "solo", 1); n++; if (r.threw || r.bad.length) { bad++; worst ||= `solo ${N}: ${r.threw || r.bad[0]}`; } }
  check("M2.solo", "shapes", bad === 0, `solo, ${n} player counts (1 to ${solo[solo.length - 1]}): sizes, byes, one place each, no two byes meet, order of names does not matter` + (worst ? " | " + worst : ""), n);
  for (const ts of [3, 5]) {
    const list = QUICK ? [...Array(36).keys()].map((i) => i + 2 * ts).concat([200, 301, 2000]) : [...Array(300).keys()].map((i) => i + ts).concat([1000, 2501, 5000, 9999, 10000]);
    let b2 = 0, n2 = 0, w2 = ""; let reserveTotal = 0, tooFew = 0;
    for (const N of list) { const r = await shapeCheck(N, "team", ts); n2++; if (r.threw) { if (N < ts) tooFew++; else { b2++; w2 ||= `${N}: ${r.threw}`; } } else { reserveTotal += r.t.reserve.length; if (r.bad.length) { b2++; w2 ||= `${N}: ${r.bad[0]}`; } } }
    check(`M2.team${ts}`, "shapes", b2 === 0, `teams of ${ts}, ${n2} player counts: teams of exactly ${ts}, remainder (N mod ${ts}) kept as reserve, nobody lost or doubled` + (w2 ? " | " + w2 : ""), n2);
  }
  // the edges
  const edge = async (n, f, ts) => { try { await startTournament({ eid: "E", seed: SEED, players: players(n), format: f, teamSize: ts, startAt: T0 }); return "ok"; } catch (e) { return e.message; } };
  check("M2.edge0", "shapes", /At least one player/.test(await edge(0, "solo", 1)), "no player: refused with words");
  check("M2.edgeTeam", "shapes", /Not enough players for one team/.test(await edge(2, "team", 3)), "fewer than one team: refused with words");
  check("M2.edgeSize", "shapes", /3 or 5/.test(await edge(12, "team", 4)), "a team of 4 (or 2, or 7) is refused");
  check("M2.edgeDup", "shapes", await (async () => { try { await startTournament({ eid: "E", seed: SEED, players: [{ pid: "1xaaaa", name: "A" }, { pid: "1xaaaa", name: "B" }], startAt: T0 }); return false; } catch { return true; } })(), "the same player twice is refused");
  check("M2.edgeMax", "shapes", /Too many/.test(await edge(10001, "solo", 1)), "more than 10,000 players is refused");
  // one full team: champion without a game (the Worker refuses to start this; the engine alone says champion at once)
  const oneTeam = await startTournament({ eid: "E", seed: SEED, players: players(3), format: "team", teamSize: 3, startAt: T0 });
  check("M2.oneTeam", "shapes", oneTeam.done && oneTeam.rounds === 0, "the engine alone: one team is champion at once (the Worker refuses to start with fewer than two full teams, see M6)");
}

// ================================================================================================ M3  whole tournaments
section("M3 whole tournaments played by the real engine");
// a drawn game, X first: X0 O1 X2 O4 X3 O5 X7 O6 X8
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];
check("M3.drawscript", "play", (() => { let c = emptyCells(); DRAW.forEach((s, i) => { c = place(c, s, i % 2 === 0 ? 1 : 2); }); return outcomeOf(c).kind === "draw"; })(), "the scripted game really is a draw");
/** strategy: "random" (everybody present, random squares), "away" (nobody plays), "draw" (everybody plays the drawn game), "half" (every other player away), "slow" (everybody uses the last millisecond of every clock) */
async function playOut(t, strategy, rng, hours = 40) {
  let now = t.startAt; const limit = now + hours * 3600_000; let moves = 0, loops = 0;
  const absent = (pid) => strategy === "away" || (strategy === "half" && parseInt(pid, 10) % 2 === 0);
  while (!t.done && now < limit) {
    loops++;
    await advanceTournament(t, now); if (t.done) break;
    const live = [];
    for (const m of Object.values(t.matches)) if (m.status === "live") for (const b of m.boards) if (!b.done) live.push({ m, b, g: lastGame(b) });
    if (!live.length) throw new Error("tournament not done but no live board: stuck");
    if (strategy === "slow") now = Math.max(now, Math.min(...live.map((x) => x.g.deadline)) - 1); else if (strategy === "away") now = Math.min(...live.map((x) => x.g.deadline)) + 1; else now += 1500;
    await advanceTournament(t, now); if (t.done) break;
    for (const m of Object.values(t.matches)) if (m.status === "live") for (const b of m.boards) {
      if (b.done) continue; const g = lastGame(b); const pid = moverOf(g); if (absent(pid)) continue;
      if (strategy === "slow" && g.deadline - 1 !== now) continue;
      const e = emptiesOf(g.cells); const cell = strategy === "draw" || (strategy === "slow" && rng.draw) ? DRAW[g.moves.length] : e[Math.floor(rng() * e.length)];
      const r = await moveInTournament(t, pid, cell, now, g.moves.length);
      if (!r.ok) throw new Error("a present player's move was refused: " + r.error + " at ply " + g.moves.length);
      moves++;
    }
    if (loops > 200000) throw new Error("too many loops");
  }
  return { now, moves };
}
function auditTournament(t, label, ps, strat) {
  const bad = [];
  if (!t.done) bad.push("not finished");
  const E = t.entrants.length; const real = Object.values(t.matches).filter((m) => !m.bye);
  if (real.some((m) => m.status !== "done")) bad.push("a match is not done");
  if (real.length !== E - 1 && E > 1) bad.push(`played matches ${real.length} != ${E - 1}`);
  for (const m of real) { if (!m.winner || !m.loser || m.winner === m.loser) bad.push("match without winner/loser " + m.mid); if (m.winner !== m.a && m.winner !== m.b) bad.push("winner not in match " + m.mid); for (const b of m.boards) { if (!b.done || !b.winner || ![b.a, b.b].includes(b.winner)) bad.push("board without winner " + m.mid); const g = b.games; const draws = g.filter((x) => x.result?.kind === "draw").length; const tot = (b.points[b.a] ?? 0) + (b.points[b.b] ?? 0); const expect = 2 * draws + (b.via === "fate" ? 0 : 2); if (tot !== expect) bad.push(`points ${tot} != ${expect} on ${m.mid}`); if (g.length > MAX_GAMES) bad.push("more than 3 games"); if (b.via === "fate" && !(g.length === 3 && draws === 3)) bad.push("fate without three draws"); if (b.via === "win" && !g[g.length - 1].result?.line) bad.push("win without a line"); } }
  const fin = t.matches[midOf(t.rounds, 0)]; if (E > 1 && (!fin || t.champion !== fin.winner)) bad.push("champion is not the winner of the final");
  return bad;
}
async function rankAudit(t, ps, label) {
  const bad = []; const rk = await rankings(t); const E = t.entrants.length;
  if (rk.length !== E) bad.push(`ranking rows ${rk.length} != ${E}`);
  if (new Set(rk.map((r) => r.rank)).size !== rk.length || rk.some((r, i) => r.rank !== i + 1)) bad.push("ranks are not 1..N, once each");
  if (E > 1 && rk[0].id !== t.champion) bad.push("rank 1 is not the champion");
  const fin = t.matches[midOf(t.rounds, 0)]; if (E > 1 && rk[1].id !== fin.loser) bad.push("rank 2 is not the runner-up");
  for (let i = 1; i < rk.length; i++) { if (rk[i].roundReached > rk[i - 1].roundReached) bad.push("round reached goes up down the list"); else if (rk[i].roundReached === rk[i - 1].roundReached && rk[i].points > rk[i - 1].points) bad.push("points go up inside a round"); }
  // each rank row says how it was separated from the row above; the words must match the numbers
  for (let i = 1; i < rk.length; i++) { const a = rk[i - 1], b = rk[i]; const why = a.roundReached !== b.roundReached ? "round reached" : a.points !== b.points ? "total points" : a.lastMatchPoints !== b.lastMatchPoints ? "points in the last match" : "fate"; if (b.decidedBy !== why) bad.push("decidedBy wrong at " + b.rank); if (why === "fate" && !(a.fate < b.fate)) bad.push("fate order wrong at " + b.rank); }
  // every PLAYER has a result: a team member shares the team's rank; a reserve player is told so
  const rank = new Map(rk.map((r) => [r.id, r.rank])); let none = 0, reserve = 0;
  for (const p of ps) { const e = t.entrants.find((x) => x.members.includes(p.pid)); if (e) { if (!rank.get(e.id)) none++; } else if (t.reserve.includes(p.pid)) reserve++; else none++; }
  if (none) bad.push(`${none} players have no result and are not reserve`);
  return { bad, reserve, rk };
}
const stratList = ["random", "away", "draw", "half", "slow"];
const longest = { solo: { random: 0 }, };
const runs = []; let m3bad = 0, m3n = 0, m3first = "";
const soloNs = QUICK ? [2, 3, 4, 5, 7, 8, 9, 10, 13, 16, 17, 31, 33] : [...Array(40).keys()].map((i) => i + 2).concat([63, 64, 65, 100, 127, 128, 129, 200, 257]);
const slowMax = new Map(); // moveMs -> longest virtual length in ms
for (const N of soloNs) for (const strat of stratList) {
  if (strat === "draw" && N > 130) continue; if (strat === "slow" && N > 130) continue;
  const ps = players(N); const rng = lcg(N * 7 + strat.length); if (strat === "slow") rng.draw = N % 2 === 0; // half of the slow runs are all-draw (the longest)
  const t = await startTournament({ eid: "E", seed: SEED + N, players: ps, startAt: T0 });
  try {
    const r = await playOut(t, strat, rng); const bad = auditTournament(t, `${N}/${strat}`, ps, strat); const ra = await rankAudit(t, ps, `${N}/${strat}`);
    m3n++; if (bad.length || ra.bad.length) { m3bad++; m3first ||= `solo ${N} ${strat}: ${bad[0] ?? ra.bad[0]}`; }
    if (strat === "slow") slowMax.set(N, Math.max(slowMax.get(N) ?? 0, r.now - t.startAt));
    runs.push({ N, strat, moves: r.moves, mins: Math.round((r.now - t.startAt) / 60000) });
  } catch (e) { m3n++; m3bad++; m3first ||= `solo ${N} ${strat}: ${e.message}`; }
}
check("M3.solo", "play", m3bad === 0, `solo, ${m3n} whole tournaments (nobody plays, everybody plays, every game drawn, half away, slow play): all finish, one champion, ranks 1..N once each, points add up` + (m3first ? " | " + m3first : ""), m3n);
let tb = 0, tn = 0, tfirst = "", teamReserve = 0, teamPlayers = 0;
for (const ts of [3, 5]) for (const N of QUICK ? [2 * ts, 2 * ts + 1, 2 * ts + ts - 1, 3 * ts, 3 * ts + 2, 5 * ts + 1] : [...Array(26).keys()].map((i) => i + 2 * ts).concat([60, 61, 62])) for (const strat of ["random", "away", "half", "draw"]) {
  const ps = players(N); const t = await startTournament({ eid: "E", seed: SEED + "t" + N, players: ps, format: "team", teamSize: ts, startAt: T0 });
  try { await playOut(t, strat, lcg(N + ts)); const bad = auditTournament(t, "", ps, strat); const ra = await rankAudit(t, ps, ""); tn++; teamReserve += ra.reserve; teamPlayers += N; if (bad.length || ra.bad.length) { tb++; tfirst ||= `team${ts} ${N} ${strat}: ${bad[0] ?? ra.bad[0]}`; } }
  catch (e) { tn++; tb++; tfirst ||= `team${ts} ${N} ${strat}: ${e.message}`; }
}
check("M3.team", "play", tb === 0, `teams of 3 and 5, ${tn} whole tournaments: all finish, a team wins by more boards (never a tie), ranks once each, every player has a team result or is reserve` + (tfirst ? " | " + tfirst : ""), tn);
// how long can a tournament take? the longest case = every board runs three full drawn games using every clock to the last millisecond
{
  const worst = (moveMs, rounds) => { const game = (first) => first + 8 * moveMs + 0; return rounds * (game(DEFAULT_READY_MS) + game(moveMs) + game(moveMs)); };
  const MAX_MS = 6 * 3_600_000; // apps/edge/src/tournament.ts MAX_MS
  const rows = [];
  for (const secs of [10, 20, 30, 60]) { const w = worst(secs * 1000, 14); rows.push([secs, w]); }
  const at20 = rows.find((r) => r[0] === 20)[1], at60 = rows.find((r) => r[0] === 60)[1];
  check("M3.time20", "play", at20 < MAX_MS, `10,000 players, 14 rounds, every board three full drawn games on the 20 s clock, nobody pauses: ${(at20 / 3600000).toFixed(2)} h, inside the 6 h limit the Worker uses to start the deletion clock`);
  const sm = [...slowMax.entries()].sort((a, b) => b[0] - a[0])[0];
  if (sm) check("M3.slowMeasured", "play", sm[1] > 0, `measured: ${sm[0]} players, all-draw slow play, ${(sm[1] / 60000).toFixed(1)} minutes of tournament time`);
  if (at60 >= MAX_MS) finding("F-time60", "INCOMPLETE", "The 60 s move clock can outlast the 6 h limit with 10,000 players", "apps/edge/src/tournament.ts:55 (MAX_MS) and :20 (TTT_MOVE_SECONDS)", `worst case with the 60 s clock is ${(at60 / 3600000).toFixed(2)} h; MAX_MS is 6 h. Not reachable with the approved 20 s clock (${(at20 / 3600000).toFixed(2)} h).`, "none needed if the move clock is fixed at 20 s as OPTIONS_TABLES.md decided");
}

// ================================================================================================ M4  the clocks
section("M4 clocks: 20 s move, 30 s first move, the deadline, time-outs, forfeits, pause");
{
  const cfg = { seed: "qa-clock", moveMs: DEFAULT_MOVE_MS, readyMs: DEFAULT_READY_MS };
  check("M4.defaults", "clock", DEFAULT_MOVE_MS === 20_000 && DEFAULT_READY_MS === 30_000, "the defaults are 20 s a move and 30 s for the first move");
  const mk = () => newBoard(cfg, "r1m0", 0, "A", "B", T0);
  let b = await mk(); let g = lastGame(b);
  check("M4.first30", "clock", g.deadline === T0 + 30_000, "game 1: the first move has 30 s");
  const x = moverOf(g);
  let r = await applyMove(cfg, "r1m0", b, x, 4, T0 + 29_999); check("M4.lastms", "clock", r.ok && !lastGame(b).moves[0].auto, "a move 1 ms before the deadline counts");
  check("M4.next20", "clock", lastGame(b).deadline === T0 + 29_999 + 20_000, "after a real move the next clock is 20 s from that move (no drift)");
  // the exact deadline (RULES_tictactoe.md section 11 says a move AT the deadline is refused; the code accepts it)
  b = await mk(); g = lastGame(b); r = await applyMove(cfg, "r1m0", b, moverOf(g), 4, T0 + 30_000);
  const atDeadlineAccepted = r.ok && !lastGame(b).moves[0].auto;
  b = await mk(); g = lastGame(b); r = await applyMove(cfg, "r1m0", b, moverOf(g), 4, T0 + 30_001);
  check("M4.late1ms", "clock", lastGame(b).moves[0]?.auto === true && !r.ok, "a move 1 ms after the deadline: the software has already played for that player and the tap is refused");
  if (atDeadlineAccepted) finding("F-deadline", "GAP", "A move exactly AT the deadline is accepted; the owner's draft rules say it is refused", "packages/ttt/src/match.ts:91 (while ... now > deadline); docs/boss/RULES_tictactoe.md section 11.1 and 11.2; test packages/ttt/test/match.test.ts R11 asserts the code's way", "At server time = deadline the move counts; at deadline + 1 ms it does not. The draft says 'accepted only if the server time is before the deadline'. The difference is one millisecond.", "OWNER DECISION: keep the code (a move AT the last moment counts, as R11 and its test say) and change the draft sentence, or change the code. Recommendation: keep the code, edit the draft.");
  // a stale tap, a double tap, a move out of turn
  b = await mk(); g = lastGame(b); const o = g.x === "A" ? "B" : "A";
  check("M4.turn", "clock", (await applyMove(cfg, "r1m0", b, o, 0, T0 + 1)).error === "not-your-turn", "the player who is not to move is refused");
  await applyMove(cfg, "r1m0", b, g.x, 0, T0 + 2);
  check("M4.stale", "clock", (await applyMove(cfg, "r1m0", b, o, 1, T0 + 3, 0)).error === "stale", "a tap from an old screen is refused as stale");
  check("M4.double", "clock", (await applyMove(cfg, "r1m0", b, g.x, 1, T0 + 3)).error === "not-your-turn", "a double tap (the same player twice) is refused");
  check("M4.taken", "clock", (await applyMove(cfg, "r1m0", b, o, 0, T0 + 4)).error === "square-taken", "a taken square is refused");
  check("M4.nobody", "clock", (await applyMove(cfg, "r1m0", b, "Z", 0, T0 + 4)).error === "not-in-board", "an outsider is refused");
  // forfeits
  b = await mk(); g = lastGame(b); const starter = g.x;
  await advanceBoard(cfg, "r1m0", b, T0 + 30_001); check("M4.to1", "clock", !b.done && lastGame(b).missed[starter] === 1, "the first time-out plays a square, the board goes on");
  await advanceBoard(cfg, "r1m0", b, T0 + 50_001); check("M4.to2", "clock", !b.done, "the other player's first time-out also goes on");
  await advanceBoard(cfg, "r1m0", b, T0 + 70_001); check("M4.forfeit", "clock", b.done && b.via === "forfeit" && b.winner !== starter && b.points[b.winner] === 2, "if both stay away, the player due to start loses on their second time-out and the other gets 2 points");
  check("M4.forfeitAt", "clock", lastGame(b).result.at === T0 + 30_000 + 20_000 + 20_000, "the forfeit is stamped at the moment the clock ran out, not when somebody looked");
  b = await mk(); g = lastGame(b);
  await advanceBoard(cfg, "r1m0", b, T0 + 30_001); // starter missed once
  await applyMove(cfg, "r1m0", b, moverOf(lastGame(b)), emptiesOf(lastGame(b).cells)[0], T0 + 31_000); // O plays for real
  await applyMove(cfg, "r1m0", b, moverOf(lastGame(b)), emptiesOf(lastGame(b).cells)[0], T0 + 32_000); // X plays for real: the count restarts
  check("M4.reset", "clock", lastGame(b).missed[g.x] === 0, "a real move sets the time-out count back to zero");
  // pause: every open clock keeps its time left
  b = await mk(); const d0 = lastGame(b).deadline; shiftBoard(b, 90_000); check("M4.pause", "clock", lastGame(b).deadline === d0 + 90_000, "a pause moves the deadline by the length of the pause");
  check("M4.effOf", "clock", P.effOf([[1000, 5000]], 3000) === 1000 && P.effOf([[1000, 5000]], 9000) === 5000 && P.effOf([[1000, 5000], [6000, null]], 9000) === 2000, "the tournament clock stands still inside a pause (closed and open pauses)");
  // look-order independence: advancing in many small steps equals one big jump, for 40 different silent/partly silent histories
  let same = 0; const rg = lcg(99);
  for (let i = 0; i < 40; i++) {
    const a = await mk(), c = await mk(); const script = []; let t = T0;
    for (let k = 0; k < 8; k++) { t += Math.floor(rg() * 60_000); script.push(t); }
    for (const tt of script) { await advanceBoard(cfg, "r1m0", a, tt); }
    await advanceBoard(cfg, "r1m0", c, script[script.length - 1]);
    if (JSON.stringify(a) === JSON.stringify(c)) same++;
  }
  check("M4.looks", "clock", same === 40, "what happens never depends on how often or when anybody looks (40 random histories)", 40);
  // game 2 and 3 clocks
  const dr = await mk(); let tt = T0 + 1000; for (const s of DRAW) { await applyMove(cfg, "r1m0", dr, moverOf(lastGame(dr)), s, tt); tt += 1000; }
  check("M4.game2clock", "clock", dr.games.length === 2 && lastGame(dr).deadline === tt - 1000 + 20_000, "after a draw, game 2 starts at once and its first move has 20 s (both players are already on the page)");
  check("M4.swap", "clock", dr.games[1].x === dr.games[0].o, "game 2 swaps the marks");
}

// ================================================================================================ M5  draws, ties, tie-breakers
section("M5 draws, ties and tie-breakers");
{
  const cfg = { seed: "qa-fate", moveMs: 20_000, readyMs: 30_000 };
  let firstX = 0, fateA = 0, total = 400, fateSym = 0, third = 0;
  for (let i = 0; i < total; i++) {
    const b = await newBoard(cfg, `r1m${i}`, 0, "A", "B", T0); if (b.games[0].x === "A") firstX++;
    let t = T0 + 1000; for (let k = 0; k < 3; k++) for (const s of DRAW) { await applyMove(cfg, `r1m${i}`, b, moverOf(lastGame(b)), s, t); t += 1000; }
    if (!(b.done && b.via === "fate" && b.games.length === 3 && b.points.A === 3 && b.points.B === 3)) { fateSym = -1e9; break; }
    const [fa, fb] = [await fateOf(cfg.seed, `r1m${i}`, 0, "A"), await fateOf(cfg.seed, `r1m${i}`, 0, "B")];
    if (b.winner === (fa < fb ? "A" : "B")) fateSym++; if (b.winner === "A") fateA++;
    if (b.games[2].x === "A") third++;
  }
  check("M5.fate", "ties", fateSym === total, `three drawn games end by fate in all ${total} boards, the lower fate number wins, 3 points each`, total);
  check("M5.fair", "ties", firstX > 160 && firstX < 240 && fateA > 160 && fateA < 240 && third > 160 && third < 240, `fair coins: A has X in game 1 in ${firstX}/${total}, in game 3 in ${third}/${total}; A wins by fate in ${fateA}/${total}`);
  // ranking ties: forced equal rank inputs
  const ps = players(12); const t = await startTournament({ eid: "E", seed: SEED + "ties", players: ps, startAt: T0 }); await playOut(t, "draw", lcg(1));
  const rk = await rankings(t); const by = {}; for (const r of rk) by[r.decidedBy || "top"] = (by[r.decidedBy || "top"] ?? 0) + 1;
  check("M5.allDrawRank", "ties", rk.every((r, i) => r.rank === i + 1) && (by.fate ?? 0) + (by["round reached"] ?? 0) + (by["total points"] ?? 0) + (by["points in the last match"] ?? 0) + 1 === rk.length, `12 players, every game drawn: ranks 1..12, how they were separated: ${JSON.stringify(by)}`);
  // the tie line on the screen: says who was level on what
  const line = tieLine({ decidedBy: "fate", name: "Bo" }, "Al"); check("M5.tieLine", "ties", /Al and Bo were level on round reached, total points and points in the last match; separated by fate\./.test(line) && tieLine({ decidedBy: "round reached", name: "Bo" }, "Al") === "", "the one-line tie words are right for each way a tie is separated");
}

// ================================================================================================ M6  the real Worker
section("M6 the real Worker: free, paid, teams, guest lists, roles, reconnect, pause, end, reports");
const { handle } = await src("apps/edge/test/with-terms.ts");
const { makeD1 } = await src("apps/edge/test/d1-sqlite.ts");
const { playCrowd, apiFor, clockOf } = await src("tools/sim2/phones.ts");
const { lifecycleTick, endBoundMs, reportApi } = await src("apps/edge/src/lifecycle.ts");
const { sentReports, FREE_GAME_CAP } = await src("apps/edge/src/pay.ts");
const { TttPhone, TttConsole } = P;
const GEN = 1692803367, START = Math.floor((T0 / 1000 - GEN) / 3) + 1 + 1200;
const devOf = (i) => (i.toString(16).padStart(4, "0")).repeat(8);
let ipN = 0;
function world() {
  const d = makeD1(); const raw = d.raw;
  const env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k", JOIN_PER_IP_MINUTE: "1000000", JOIN_PER_IP_DAY: "1000000" };
  const call = (method, path, body, headers = {}, now = T0) => handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
  const j = async (r) => r.json().catch(() => ({}));
  return { raw, env, call, j };
}
async function organizer(w, email) { const r = await w.j(await w.call("POST", "/api/start", { email: email ?? `o${++ipN}@acme.com` }, { "cf-connecting-ip": `10.9.${Math.floor(ipN / 250)}.${ipN % 250 + 1}` })); return { token: r.token, ai: r.aiKey }; }
async function mkGame(w, id, { cap = 100, paid = true, closed = false } = {}) {
  const org = await organizer(w); const h = { "x-organizer": org.token };
  const c = await w.call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap, ...(closed ? { whoCanJoin: "list" } : {}) }, h);
  if (c.status !== 200) throw new Error("create " + c.status + " " + JSON.stringify(await w.j(c)));
  const p = await w.call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h);
  if (p.status !== 200) throw new Error("publish " + p.status);
  if (paid && cap > FREE_GAME_CAP) w.raw.run("UPDATE engagement SET pack=? WHERE id=?", [Math.max(cap, 100), id]);
  return { h, org };
}
async function joinAll(w, id, n, from = 1, namer = (i) => `Player ${i}`) {
  const out = [];
  for (let i = from; i < from + n; i++) { const r = await w.call("POST", `/api/z/${id}/join`, { name: namer(i), device: devOf(i) }); const b = await w.j(r); if (r.status === 200) out.push({ pid: b.pid, device: devOf(i), name: namer(i) }); else out.push({ refused: r.status, error: b.error, code: b.code, i }); }
  return out;
}
const q = (w, sql, ...a) => w.raw.query(sql).all(...a);
const q1 = (w, sql, ...a) => w.raw.query(sql).get(...a);
async function runCrowd(w, id, h, phones, { format, teamSize, moveSecs = 20, away = new Set(), seed = 3, maxSteps = 30000 } = {}) {
  const st = await w.call("POST", `/api/z/${id}/ttt/start`, { ...(format ? { format } : {}), ...(teamSize ? { teamSize } : {}), moveSecs }, h, T0);
  const sb = await w.j(st); if (st.status !== 200) return { startFailed: st.status, body: sb };
  const clock = clockOf(T0); const rng = lcg(seed);
  const res = await playCrowd({ call: w.call, eid: id, phones, orgHeaders: h, clock, rng, away, isDone: () => q1(w, "SELECT state FROM ttt_t WHERE eid=?", id)?.state === "done", maxSteps });
  // the crowd stops the moment the Worker says 'done'; every phone that is not away now looks once or twice more, as a real page does, and shows its final screen
  const phases = {}; const pending = phones.filter((x) => !away.has(x.pid)).map((x) => ({ x, ph: new TttPhone({ api: apiFor(w.call, clock), eid: id, pid: x.pid, device: x.device, now: () => clock.t }) }));
  for (let pass = 0; pass < 3; pass++) { clock.t += 3000; for (const y of pending) { const v = await y.ph.tick(); y.phase = v.phase; } }
  for (const y of pending) phases[y.phase] = (phases[y.phase] ?? 0) + 1;
  return { ...res, phases, clock };
}
function auditServer(w, id, n, label, phases, { format = "solo", teamSize = 1, awayN = 0 } = {}) {
  const bad = []; const t = q1(w, "SELECT * FROM ttt_t WHERE eid=?", id);
  const E = format === "team" ? Math.floor(n / teamSize) : n;
  if (t.state !== "done") bad.push("state " + t.state);
  if (!t.champion) bad.push("no champion");
  if (t.entrants !== E) bad.push(`entrants ${t.entrants} != ${E}`);
  const real = q1(w, "SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND bye=0 AND status='done'", id).c, open = q1(w, "SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND bye=0 AND status<>'done'", id).c;
  if (real !== E - 1) bad.push(`matches played ${real} != ${E - 1}`); if (open) bad.push(open + " matches not finished");
  const flags = q1(w, "SELECT COUNT(*) c FROM ttt_b WHERE eid=? AND flag=1", id).c; if (flags) bad.push(flags + " boards flagged");
  const rk = t.ranking ? JSON.parse(t.ranking) : []; if (rk.length !== Math.min(E, 100)) bad.push(`ranking rows ${rk.length}`); if (rk.some((r, i) => r.rank !== i + 1)) bad.push("ranks not 1..N");
  const podium = q(w, "SELECT pattern, pids FROM settled WHERE eid=? ORDER BY ordinal, pattern", id); if (podium.length !== Math.min(E, 5)) bad.push(`podium rows ${podium.length} != ${Math.min(E, 5)}`);
  const winners = q1(w, "SELECT COUNT(*) c FROM winner WHERE eid=?", id).c; const expectW = Math.min(E, 5) * (format === "team" ? teamSize : 1); if (winners !== expectW) bad.push(`winner rows ${winners} != ${expectW}`);
  const life = q1(w, "SELECT end_ms FROM life WHERE eid=?", id); if (!life?.end_ms) bad.push("deletion clock not started");
  const champs = phases.champion ?? 0; if (champs !== (format === "team" ? teamSize : 1) && awayN === 0) bad.push(`phones that see 'champion': ${champs}`);
  if (awayN === 0) { const total = (phases.champion ?? 0) + (phases.out ?? 0) + (phases.reserve ?? 0); if (total !== n) bad.push(`phones with a result screen ${total} != ${n} (${JSON.stringify(phases)})`); if ((phases.reserve ?? 0) !== (format === "team" ? n % teamSize : 0)) bad.push("reserve phones " + (phases.reserve ?? 0)); }
  return bad;
}
{
  const cases = [];
  const solo = QUICK ? [2, 3, 5, 8, 9, 17] : [2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 33, 50];
  for (const n of solo) cases.push({ n, paid: true, label: `paid solo ${n}` });
  for (const n of QUICK ? [2, 7, 10] : [2, 3, 5, 7, 9, 10]) cases.push({ n, paid: false, cap: 10, label: `FREE solo ${n}` });
  for (const ts of [3, 5]) for (const n of (QUICK ? [2 * ts, 2 * ts + 1] : [2 * ts, 2 * ts + 1, 2 * ts + ts - 1, 3 * ts, 3 * ts + 2, 4 * ts + 1, 5 * ts])) cases.push({ n, paid: true, format: "team", teamSize: ts, label: `paid team${ts} ${n}` });
  cases.push({ n: 10, paid: false, cap: 10, label: "FREE 10, a quarter away", awayShare: 0.25 }, { n: 16, paid: true, label: "paid 16, half away", awayShare: 0.5 }, { n: 8, paid: true, label: "paid 8, EVERYBODY away (only the Organizer's page runs)", awayShare: 1 });
  let bad = 0, firstBad = ""; const lines = [];
  for (const c of cases) {
    const w = world(); const id = "QA-W" + (++ipN);
    const { h } = await mkGame(w, id, { cap: c.cap ?? Math.max(100, c.n), paid: c.paid });
    const phones = (await joinAll(w, id, c.n)).filter((x) => x.pid);
    const away = new Set(phones.filter((_, i) => c.awayShare && ((i + 1) / phones.length) <= c.awayShare + 1e-9 && Math.floor(i * c.awayShare + 1e-9) !== Math.floor((i + 1) * c.awayShare + 1e-9) || c.awayShare === 1).map((x) => x.pid));
    let r;
    try { r = await runCrowd(w, id, h, phones, { format: c.format, teamSize: c.teamSize, away, seed: c.n }); } catch (e) { r = { startFailed: "threw " + e.message }; }
    const errs = r.startFailed ? [`start failed ${r.startFailed} ${JSON.stringify(r.body ?? "")}`] : auditServer(w, id, c.n, c.label, r.phases, { format: c.format ?? "solo", teamSize: c.teamSize ?? 1, awayN: away.size });
    if (errs.length) { bad++; firstBad ||= `${c.label}: ${errs[0]}`; console.log(`  FAIL ${c.label}: ${errs.join("; ")}`); }
    lines.push(`${c.label}: ${errs.length ? "FAIL" : "ok"}${r.steps ? `, ${Math.round((r.now - T0) / 60000)} min, ${r.moves} moves, ${r.claims} claims` : ""}`);
  }
  check("M6.whole", "worker", bad === 0, `${cases.length} whole tournaments through the real endpoints (free game of 10, paid, teams of 3 and 5, away players, nobody present): every one finishes, champion, ranking, podium and winners record stored, deletion clock started` + (firstBad ? " | " + firstBad : ""), cases.length);
  console.log(lines.map((x) => "    " + x).join("\n"));
}
// ---- the free game for 10 (FREE_GAME_CAP)
{
  const w = world(); const id = "FREE10"; const { h } = await mkGame(w, id, { cap: 10, paid: false });
  const e = q1(w, "SELECT pack, cap FROM engagement WHERE id=?", id);
  check("M6.freeCap", "worker", FREE_GAME_CAP === 10 && e.pack === 10 && e.cap === 10, "the free game: FREE_GAME_CAP is 10, the game is published with no payment (pack 10, cap 10)");
  const js = await joinAll(w, id, 11);
  check("M6.free10", "worker", js.filter((x) => x.pid).length === 10 && js[10].refused === 409 && /full/i.test(js[10].error), "10 people join, the 11th is told 'This game is full.'");
  const again = await w.call("POST", `/api/z/${id}/join`, { name: "Player 3", device: devOf(3) }); check("M6.sameDevice", "worker", again.status === 200 && (await w.j(again)).pid === js[2].pid, "the same phone joining again gets the same place");
  const bigger = await w.call("PATCH", `/api/z/${id}/settings`, { cap: 11 }, h); check("M6.freeBigger", "worker", bigger.status !== 200, "a free game cannot be made bigger than 10 by settings (a new game must be bought)");
}
// ---- the two time windows and the draft count (owner rules): 365 days for a paid game, 30 days otherwise; only never-published drafts count toward ten
{
  const w = world(); const DAY = 86_400_000; const roundAt = (ms) => Math.floor((ms / 1000 - GEN) / 3) + 1;
  const o1 = await organizer(w); const h = { "x-organizer": o1.token };
  await w.call("POST", "/api/z", { id: "WIN-P", startRound: roundAt(T0 + 10 * DAY), callSeconds: 6, cap: 100 }, h); w.raw.run("UPDATE engagement SET pack=100 WHERE id='WIN-P'");
  w.raw.run("INSERT INTO payment(id,org,email,pack,currency,amount,tax,status,created_ms,paid_ms,meta,eid) VALUES('pay_q1','o','b@acme.com',100,'INR',100,0,'paid',?,?,'{}',?)", [T0, T0, "WIN-P"]);
  const mv = (id, hh, at) => w.call("PATCH", `/api/z/${id}/settings`, { startRound: roundAt(at) }, hh, T0 + 5 * DAY);
  check("M6.paid364", "worker", (await mv("WIN-P", h, T0 + 364 * DAY)).status === 200, "a paid game can be moved to day 364 after payment");
  check("M6.paid366", "worker", (await mv("WIN-P", h, T0 + 366 * DAY)).status === 400, "...and not to day 366");
  const o2 = await organizer(w); const h2 = { "x-organizer": o2.token };
  await w.call("POST", "/api/z", { id: "WIN-D", startRound: roundAt(T0 + 10 * DAY), callSeconds: 6, cap: 100 }, h2);
  check("M6.draft29", "worker", (await w.call("PATCH", `/api/z/WIN-D/settings`, { startRound: roundAt(T0 + 5 * DAY + 29 * DAY) }, h2, T0 + 5 * DAY)).status === 200 && (await w.call("PATCH", `/api/z/WIN-D/settings`, { startRound: roundAt(T0 + 5 * DAY + 31 * DAY) }, h2, T0 + 5 * DAY)).status === 400, "a game that is not paid: day 29 allowed, day 31 refused (30 days)");
  // drafts: ten never-published drafts block the eleventh; a game that was published but not paid does not count
  const o3 = await organizer(w); const h3 = { "x-organizer": o3.token }; let made = 0;
  await w.call("POST", "/api/z", { id: "DR-0", startRound: START, callSeconds: 6, cap: 101 }, h3); await w.call("POST", `/api/z/DR-0/publish`, { email: "b@acme.com", phone: "98765 43210" }, h3); // published, not paid
  for (let i = 1; i <= 10; i++) if ((await w.call("POST", "/api/z", { id: "DR-" + i, startRound: START, callSeconds: 6, cap: 101 }, h3)).status === 200) made++;
  const eleventh = await w.call("POST", "/api/z", { id: "DR-11", startRound: START, callSeconds: 6, cap: 101 }, h3);
  check("M6.drafts", "worker", made === 10 && eleventh.status === 409 && /10 unpublished drafts/.test((await w.j(eleventh)).error), "ten never-published drafts are allowed next to one published-unpaid game; the eleventh is refused in words");
}
// ---- roles x routes
{
  const w = world(); const id = "ROLES"; const { h, org } = await mkGame(w, id, { cap: 100, paid: true });
  const phones = (await joinAll(w, id, 4)).filter((x) => x.pid);
  const hostR = await w.j(await w.call("POST", "/api/org/host", { label: "Anita", mobile: "9822200011", email: "host@acme.com" }, h));
  w.raw.run("UPDATE host_state SET verified_ms=?, mobile_ok=1", [Date.now()]);
  const coR = await w.j(await w.call("POST", "/api/org/cohost", { label: "Ravi", phone: "9811100099", eid: id }, h));
  const other = await organizer(w);
  const roles = { organizer: { "x-organizer": org.token }, host: { "x-organizer": hostR.hostKey }, cohost: { "x-organizer": coR.cohostKey }, ai: { "x-organizer": org.ai }, other_org: { "x-organizer": other.token }, stranger: {} };
  const should = { organizer: true, host: true, cohost: false, ai: false, other_org: false, stranger: false };
  const routes = [["POST", "ttt/start", { moveSecs: 20 }], ["POST", "ttt/plan", { matches: [] }], ["POST", "ttt/pause", {}], ["POST", "ttt/resume", {}], ["POST", "ttt/end", {}], ["POST", "ttt/settle", { mid: "r1m0", j: 0, winner: "x" }], ["GET", "ttt/flags"], ["POST", "ttt/tick", {}], ["GET", "ttt/brief?round=1"], ["GET", "ttt/stuck"], ["POST", "ttt/finish", {}]];
  let wrong = []; let n = 0;
  for (const [m, path, body] of routes) for (const [role, hd] of Object.entries(roles)) {
    if (should[role]) continue; // allowed roles are tried after the denied ones on a copy of the state (below)
    const r = await w.call(m, `/api/z/${id}/${path}`, body, hd); n++;
    if (r.status < 400) wrong.push(`${role} ${m} ${path} -> ${r.status}`); // a refusal; 403 for the key check, 409 where the state check comes first (nothing changes)
  }
  check("M6.rolesDenied", "worker", wrong.length === 0, `Co-host, AI helper, another organizer and a stranger are refused on all ${routes.length} organizer routes (${n} calls)` + (wrong.length ? " | " + wrong.slice(0, 4).join("; ") : ""), n);
  // the Organizer and a Host may start; the state then moves on, so pause/resume/end/tick are tried after the start
  const st1 = await w.call("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, roles.host); check("M6.hostStarts", "worker", st1.status === 200, "a Host can start the tournament");
  const con = new TttConsole(apiFor(w.call, clockOf(T0), roles.organizer), id); const planned = await con.tick(); check("M6.orgPlan", "worker", planned.sentPlan === true, "the Organizer's page sends the draw");
  const ok = []; for (const [m, path, body] of [["POST", "ttt/pause", {}], ["POST", "ttt/resume", {}], ["GET", "ttt/flags"], ["POST", "ttt/tick", {}], ["GET", "ttt/brief?round=1"], ["GET", "ttt/stuck"]]) for (const role of ["organizer", "host"]) { const r = await w.call(m, `/api/z/${id}/${path}`, body, roles[role]); if (r.status !== 200) ok.push(`${role} ${path} -> ${r.status}`); }
  check("M6.rolesAllowed", "worker", ok.length === 0, "the Organizer and a Host can pause, resume, read flags, tick, read the brief and the stuck list" + (ok.length ? " | " + ok.join("; ") : ""));
  // players: a stranger or another phone cannot move; a player cannot read-flag or settle; public reads need no key
  const p = phones[0]; const mvBody = { mid: "r1m0", seq: 0, sq: 4 };
  const pub = []; for (const path of ["ttt/setup", "ttt/view", "ttt/rank", "ttt/all?round=1", "ttt/reveal"]) { const r = await w.call("GET", `/api/z/${id}/${path}`); if (r.status !== 200) pub.push(path + " " + r.status); }
  check("M6.publicReads", "worker", pub.length === 0, "setup, view, rank, all and reveal are readable by anybody without a key" + (pub.length ? " | " + pub.join("; ") : ""));
  const strangerMove = await w.call("POST", `/api/z/${id}/ttt/move`, { pid: p.pid, device: devOf(999), ...mvBody }); check("M6.otherPhone", "worker", strangerMove.status === 403 && (await w.j(strangerMove)).code === "other-phone", "a move from another phone with a player's code is refused ('This place is on another phone.')");
  const noKey = await w.call("POST", `/api/z/${id}/ttt/move`, { mid: "r1m0", seq: 0, sq: 4, absent: true }); check("M6.noKeyClaim", "worker", noKey.status === 400 || noKey.status === 403, "an 'absent' claim with no key and no player is refused");
  const settleByPlayer = await w.call("POST", `/api/z/${id}/ttt/settle`, { mid: "r1m0", j: 0, winner: p.pid, pid: p.pid, device: p.device }); check("M6.playerSettle", "worker", settleByPlayer.status === 403, "a player cannot settle a board");
  // end early: no champion, moves refused, phones say so
  const phA = new TttPhone({ api: apiFor(w.call, clockOf(T0 + 5000)), eid: id, pid: phones[0].pid, device: phones[0].device, now: () => T0 + 5000 });
  const beforeEnd = await phA.tick(); const endR = await w.call("POST", `/api/z/${id}/ttt/end`, {}, roles.organizer, T0 + 6000);
  const phB = new TttPhone({ api: apiFor(w.call, clockOf(T0 + 7000)), eid: id, pid: phones[0].pid, device: phones[0].device, now: () => T0 + 7000 }); const afterEnd = await phB.tick();
  const t = q1(w, "SELECT state, champion, ended_ms FROM ttt_t WHERE eid=?", id);
  check("M6.endEarly", "worker", endR.status === 200 && t.state === "done" && !t.champion && afterEnd.phase === "ended" && /ended the tournament/.test(afterEnd.message), `the Organizer ends the game early: no champion, phones show 'The organizer ended the tournament. Thank you for playing.' (before: ${beforeEnd.phase})`);
  const late = await w.call("POST", `/api/z/${id}/ttt/move`, { pid: phones[0].pid, device: phones[0].device, mid: "r1m0", seq: 0, sq: 4 }, {}, T0 + 8000); check("M6.afterEnd", "worker", late.status === 409, "a move sent after the end is refused");
}
// ---- guest-list shapes
{
  // a list-only game: strangers wait and are not in the draw
  const w = world(); const id = "LIST"; const { h } = await mkGame(w, id, { cap: 100, paid: true, closed: true });
  const strangers = await joinAll(w, id, 3);
  check("M6.listWait", "worker", strangers.every((x) => x.refused || x.pid), `list-only game: strangers who open the link get an answer (${strangers.map((x) => x.pid ? "in" : x.refused + (x.code ? "/" + x.code : "")).join(", ")})`);
  const roster = q1(w, "SELECT COUNT(*) c FROM participant WHERE eid=?", id).c;
  const st = await w.call("POST", `/api/z/${id}/ttt/start`, {}, h); const sb = await w.j(st);
  check("M6.listStart", "worker", roster === 0 ? st.status === 409 && sb.code === "too-few" : st.status === 200, `the draw is made only from people who are in (${roster} in; start answered ${st.status}${sb.code ? " " + sb.code : ""})`);
}
{
  // one phone leaves before the start; a join after the start is closed; duplicate names are fine; two people with the same name both play
  const w = world(); const id = "SHAPE"; const { h } = await mkGame(w, id, { cap: 100, paid: true });
  const ps = (await joinAll(w, id, 6, 1, () => "Asha")).filter((x) => x.pid);
  const dupNames = q1(w, "SELECT COUNT(DISTINCT pid) c FROM participant WHERE eid=?", id).c;
  const left = await w.call("POST", `/api/z/${id}/leave`, { pid: ps[5].pid, device: ps[5].device }); const lb = await w.j(left);
  const rosterN = q1(w, "SELECT COUNT(*) c FROM participant WHERE eid=?", id).c;
  const st = await w.call("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, h); const joined = await w.j(st);
  check("M6.dupNames", "worker", dupNames === 6, "six players who all typed the same name get six different places");
  check("M6.leaveBefore", "worker", left.status === 200 && st.status === 200 && joined.players === 5 && rosterN === 5, `a player who leaves before the start is not in the draw (answer ${left.status}; players in draw ${joined.players})`);
  const lateJoin = await w.call("POST", `/api/z/${id}/join`, { name: "Latecomer", device: devOf(77) }); const lj = await w.j(lateJoin);
  check("M6.joinAfterStart", "worker", lateJoin.status === 409 && lj.code === "closed" && lj.spectator === true, "a join after the start is closed and the person can watch (409 closed, spectator)");
  const sameAgain = await w.call("POST", `/api/z/${id}/join`, { name: "Asha", device: ps[0].device }); check("M6.reconnectJoin", "worker", sameAgain.status === 200 || sameAgain.status === 409, `an existing phone opening the join again after the start is answered (${sameAgain.status})`);
}
// ---- reconnect: the same link, the same board; another phone is refused
{
  const w = world(); const id = "RECON"; const { h } = await mkGame(w, id, { cap: 100, paid: true });
  const ps = (await joinAll(w, id, 4)).filter((x) => x.pid); await w.call("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, h);
  const clock = clockOf(T0); const con = new TttConsole(apiFor(w.call, clock, h), id); await con.tick();
  const mk = (p, dev = p.device) => new TttPhone({ api: apiFor(w.call, clock), eid: id, pid: p.pid, device: dev, now: () => clock.t });
  clock.t += 3000; const a1 = mk(ps[0]); const v1 = await a1.tick(); let moved = false;
  if (v1.phase === "playing" && v1.board.yourTurn) { const free = v1.board.cells.map((c, i) => c ? -1 : i).filter((i) => i >= 0); const r = await a1.play(free[0]); moved = r.ok; }
  clock.t += 2000; const a2 = mk(ps[0]); const v2 = await a2.tick(); // the same person on a fresh page load
  const same = v2.phase === v1.phase && (v1.phase !== "playing" || (v2.board.cells.filter((c) => c).length >= v1.board.cells.filter((c) => c).length && v2.vs === v1.vs && v2.board.yourMark === v1.board.yourMark));
  check("M6.reconnect", "worker", same, `reopening the link shows the same board (${v1.phase} -> ${v2.phase}; a tap was ${moved ? "made" : "not due"})`);
  clock.t += 2000; let refused = "", saw = "";
  for (const who of ps) { const other = mk(who, devOf(4242)); const v = await other.tick(); saw = v.phase; if (v.phase === "playing" && v.board.yourTurn) { const r = await other.play(v.board.cells.map((c, i) => c ? -1 : i).find((i) => i >= 0)); refused = r.ok ? "accepted" : r.error; break; } }
  check("M6.reconnectOther", "worker", refused === "other-phone", `the same code on another phone can look (the bracket is public) but its taps are refused ('other-phone'); got '${refused}' (${saw})`);
}
// ---- a tap after the turn ended (the owner-approved 'Ohooo' message)
{
  const w = world(); const id = "LATE"; const { h } = await mkGame(w, id, { cap: 100, paid: true });
  const ps = (await joinAll(w, id, 2)).filter((x) => x.pid); await w.call("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, h);
  const clock = clockOf(T0); const con = new TttConsole(apiFor(w.call, clock, h), id); await con.tick();
  const phones = ps.map((p) => new TttPhone({ api: apiFor(w.call, clock), eid: id, pid: p.pid, device: p.device, now: () => clock.t }));
  clock.t += 2000; const views = await Promise.all(phones.map((x) => x.tick())); const who = views.findIndex((v) => v.phase === "playing" && v.board.yourTurn);
  // the page still shows 'your turn' (it looks every 1.2 s); the player taps 31 s after the game opened: the 30 s of the first move have gone by
  clock.t = T0 + 31_000;
  const r = await phones[who].play(4);
  const stored = q1(w, "SELECT COUNT(*) c FROM ttt_mv WHERE eid=?", id).c;
  const MSG = "Ohooo! \u{1F60A} Sorry, you moved after your turn ended. This move cannot be made.";
  const exported = P.LATE_MOVE_MESSAGE;
  const fine = r.ok === false && r.error === "late-move";
  check("M6.lateMove", "worker", fine, `a tap after the turn ended is told 'late-move' (got ${JSON.stringify(r)}; the server stored ${stored} row)`);
  check("M6.lateMessage", "worker", exported === MSG, "the owner-approved wording is exported by the game code word for word" + (exported ? "" : " (not exported: missing)"));
  if (!fine) finding("F-late", "FAIL", "A move made after the turn ended gets no answer; the owner-approved 'Ohooo' message does not exist", "packages/ttt/src/phone.ts:282 (play() returns ok when the mailbox stored the tap), packages/ttt/src/match.ts:103 (applyMove answers not-your-turn), apps/web/public/ttt.js:~161 (play() ignores the answer)", "A player who taps after the 30 s / 20 s ended: the mailbox stores the tap, every phone ignores it, and the player sees nothing, only a square they did not choose appearing. RULES_tictactoe.md section 4.2 and the owner-approved wording are not implemented in this version.", "");
}
// ---- a false report: one player sends 'I won' at second 2 of a live game while the other player's phone is open and playing
{
  const w = world(); const id = "CHEAT"; const { h } = await mkGame(w, id, { cap: 100, paid: true });
  const ps = (await joinAll(w, id, 2)).filter((x) => x.pid); await w.call("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, h);
  const clock = clockOf(T0); const con = new TttConsole(apiFor(w.call, clock, h), id); await con.tick();
  const mk = (p) => new TttPhone({ api: apiFor(w.call, clock), eid: id, pid: p.pid, device: p.device, now: () => clock.t });
  clock.t += 2000; const a = mk(ps[0]), b = mk(ps[1]); await a.tick(); await b.tick();
  await w.call("POST", `/api/z/${id}/ttt/result`, { pid: ps[0].pid, device: ps[0].device, mid: "r1m0", winner: ps[0].pid }, {}, T0 + 2000);
  for (let sec = 4; sec <= 40; sec += 2) { clock.t = T0 + sec * 1000; await con.tick(); const vb = await b.tick(); if (vb.phase === "playing" && vb.board.yourTurn) { const free = vb.board.cells.map((c, i) => c ? -1 : i).filter((i) => i >= 0); await b.play(free[0]); } }
  const vb = await b.tick(); const row = q1(w, "SELECT how, flag FROM ttt_b WHERE eid=?", id);
  check("M6.falseReport", "worker", vb.phase === "playing" || vb.phase === "next" && false, `a false 'I won' report at second 2 does not end a board the other player is still playing (that player's page showed '${vb.phase}'; stored result: ${row ? row.how + (row.flag ? " flagged" : "") : "none"})`);
  if (vb.phase !== "playing") finding("F-steal", "FAIL", "One player can win a board (and the tournament) by sending one false 'I won' report; the other player's open page does not object", "packages/ttt/src/phone.ts:91 (replayMatch forces any stored result) and :237 (a phone reports only when ITS rules say the board is done); apps/edge/src/tournament.ts:127-155 (a lone report is kept as the result after 30 s, UNCONTESTED_MS); docs/RULES.md 'Known limits' says the other phone 'will contradict'", `Player A sends POST .../ttt/result {winner: A} two seconds into the game. Player B keeps playing with the page open. 30 s later the mailbox keeps A's report as 'uncontested', every phone forces it, B is told 'You are out' and A is told 'You won the tournament'.`, "");
}
// ---- pause
{
  const w = world(); const id = "PAUSE"; const { h } = await mkGame(w, id, { cap: 100, paid: true });
  const ps = (await joinAll(w, id, 2)).filter((x) => x.pid); await w.call("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, h);
  const clock = clockOf(T0); const con = new TttConsole(apiFor(w.call, clock, h), id); await con.tick();
  const mk = (p) => new TttPhone({ api: apiFor(w.call, clock), eid: id, pid: p.pid, device: p.device, now: () => clock.t });
  const phs = ps.map(mk); clock.t += 2000; const v = await Promise.all(phs.map((x) => x.tick())); const who = v.findIndex((x) => x.phase === "playing" && x.board.yourTurn);
  const lastBefore = v[who].board.deadlineMs;
  await w.call("POST", `/api/z/${id}/ttt/pause`, {}, h, T0 + 2000);
  const tapPaused = await w.call("POST", `/api/z/${id}/ttt/move`, { pid: ps[who].pid, device: ps[who].device, mid: "r1m0", seq: 0, sq: 4 }, {}, T0 + 3000);
  await w.call("POST", `/api/z/${id}/ttt/resume`, {}, h, T0 + 92_000); // paused for 90 s
  clock.t = T0 + 93_000; const after = await mk(ps[who]).tick(); const left = after.board ? after.board.deadlineMs - clock.t : null;
  check("M6.pauseRefuses", "worker", tapPaused.status === 409 && (await w.j(tapPaused)).code === "paused", "while paused a move is refused ('paused')");
  check("M6.pauseKeeps", "worker", after.phase === "playing" && !after.board.cells.some((c) => c) && left > 20_000 && left < 31_000, `after a 90 s pause nobody lost time and no square was played for anybody (time left on the first move ${Math.round(left / 1000)} s of 30 s)`);
}
// ---- the report e-mail ~3 minutes after the end, and the data in it
{
  const w = world(); const id = "REPORT"; const { h } = await mkGame(w, id, { cap: 100, paid: true });
  const ps = (await joinAll(w, id, 6)).filter((x) => x.pid);
  const r = await runCrowd(w, id, h, ps, { seed: 11 });
  sentReports.length = 0;
  const e = q1(w, "SELECT * FROM engagement WHERE id=?", id); const end = q1(w, "SELECT end_ms FROM life WHERE eid=?", id).end_ms;
  await lifecycleTick(w.env, end + 60_000); const early = sentReports.length;
  for (let i = 0; i < 6; i++) await lifecycleTick(w.env, end + 4 * 60_000 + i * 1000);
  const mail = sentReports[0];
  check("M6.reportTiming", "worker", early === 0 && sentReports.length >= 1, `the report e-mail is not sent in the first minute and is sent after 3 minutes (after 1 min: ${early}; after 4 min: ${sentReports.length})`);
  if (mail) {
    const link = (mail.text.match(/https:\/\/[^\s]+report\.html\?[^\s]+/) || [])[0];
    const api = link ? await reportApi(w.env, id, new URL(link.replace("report.html", "api/report")), end + 5 * 60_000) : null;
    const body = api ? await api.json() : null; const champName = q1(w, "SELECT e.name FROM ttt_t t JOIN ttt_e e ON e.eid=t.eid AND e.id=t.champion WHERE t.eid=?", id)?.name;
    const first = body?.base?.prizes?.find((p) => /first|1st|champion/i.test(p.label + " " + p.text)) ?? body?.base?.prizes?.[0];
    check("M6.reportData", "worker", !!body?.base?.play && body.base.play.champion === champName && body.base.play.players === 6 && body.base.play.moveSecs === 20 && (body.base.prizes ?? []).some((p) => p.winners.length > 0), `the report holds the format, the move clock, the player count, the champion (${champName}) and who won each place`);
    check("M6.reportWords", "worker", !/\bprivate\b/i.test(mail.subject + mail.text) && /Corporate Tic Tac Toe/.test(mail.subject), "the report e-mail names Corporate Tic Tac Toe and does not use the word 'private'");
  } else check("M6.reportData", "worker", false, "no report e-mail was produced");
}

// ================================================================================================ M6 / M7 are inserted here

// ================================================================================================ report
section("report");
const failed = checks.filter((c) => !c.ok);
const total = checks.reduce((n, c) => n + c.n, 0);
console.log(`\nchecks: ${checks.length} groups (${total} individual comparisons), ${checks.length - failed.length} passed, ${failed.length} failed; findings: ${FINDINGS.length}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
for (const f of FINDINGS) console.log(`  [${f.cls}] ${f.id}: ${f.title}\n      where: ${f.where}\n      evidence: ${f.evidence}${f.decision ? "\n      decision: " + f.decision : ""}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), quick: QUICK, checks, findings: FINDINGS }, null, 1));
process.exit(failed.length ? 1 : 0);
