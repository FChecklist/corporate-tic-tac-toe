// The prototype screen: one match between two phones (or two browser tabs), moves sent straight from phone to phone.
// Open the page, type the same match code on both devices, press "Create" on one and "Join" on the other.
import { BOARD_SIZES, MOVE_SECONDS, emptyCells, explainSide, rulesText, scoreBoard, type Size } from "./engine";
import { HttpSignal, connectPeer, type Peer } from "./peer";
import { beaconTieBreak, sha256Hex, starters, timeoutCell } from "./random";
import { MatchState, newDeviceKeys, signMove, verifyTranscript, type DeviceKeys, type Player, type SignedMove } from "./transcript";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
const signal = new HttpSignal(location.origin);

interface Hooks { state: MatchState | null; me: Player | null; metrics: { openMs: number; posts: number; polls: number; candidates: string[] }; result: unknown; ready: Promise<void>; autoplay: boolean; log: string[] }
const hooks: Hooks = { state: null, me: null, metrics: { openMs: 0, posts: 0, polls: 0, candidates: [] }, result: null, ready: Promise.resolve(), autoplay: false, log: [] };
(window as unknown as { __ttt: Hooks }).__ttt = hooks;
const say = (s: string) => { hooks.log.push(s); $("status").textContent = s; };

let keys: DeviceKeys, peer: Peer, st: MatchState, me: Player, seed = "", code = "", timer: ReturnType<typeof setInterval> | null = null, deadline = 0, watchdog: ReturnType<typeof setTimeout> | null = null, finished = false;

function renderRules() { $("rules").innerHTML = rulesText().map((l) => `<li>${l}</li>`).join(""); }

function render() {
  const i = st.done ? BOARD_SIZES.length - 1 : st.boardIndex; const bd = st.boards[i]!; const n = bd.n;
  const iAmX = st.markOf(i, me) === 1;
  $("boardTitle").textContent = `Board ${i + 1} of 3: ${n} x ${n}` + (st.done ? " (finished)" : "");
  $("youAre").textContent = `You are ${iAmX ? "X (you move first)" : "O (you get the second-player bonus)"} on this board`;
  const grid = $("board"); grid.style.setProperty("--n", String(n)); grid.innerHTML = "";
  const last = st.moves[st.moves.length - 1]?.m;
  bd.cells.forEach((c, k) => {
    const b = document.createElement("button"); b.className = "cell" + (c === 1 ? " x" : c === 2 ? " o" : "") + (last && last.b === i && last.c === k ? " last" : "");
    b.textContent = c === 1 ? "X" : c === 2 ? "O" : ""; b.disabled = c !== 0 || st.mover !== me || st.done; b.dataset.cell = String(k); b.setAttribute("aria-label", `cell ${k + 1}`);
    b.onclick = () => void play(k); grid.appendChild(b);
  });
  const s = scoreBoard(bd.cells, n); const mine = iAmX ? s.x : s.o, theirs = iAmX ? s.o : s.x;
  $("mine").innerHTML = `<b>You: ${mine.total}</b><ul>${explainSide(mine).map((l) => `<li>${l}</li>`).join("") || "<li>no runs yet</li>"}</ul>`;
  $("theirs").innerHTML = `<b>Masked opponent: ${theirs.total}</b><ul>${explainSide(theirs).map((l) => `<li>${l}</li>`).join("") || "<li>no runs yet</li>"}</ul>`;
  const ms = st.score(); const mineTotal = me === "A" ? ms.a : ms.b, theirTotal = me === "A" ? ms.b : ms.a;
  $("total").textContent = `Match so far (boards played to now): you ${mineTotal}, opponent ${theirTotal}`;
  $("turn").textContent = st.done ? "" : st.mover === me ? "Your move" : "Opponent is thinking...";
}

function startTimer() {
  if (timer) clearInterval(timer); if (watchdog) clearTimeout(watchdog); if (st.done) { $("timer").textContent = ""; return; }
  if (st.mover === me) {
    deadline = Date.now() + MOVE_SECONDS * 1000; try { navigator.vibrate?.(60); } catch { /* not every device vibrates */ }
    timer = setInterval(() => { const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); $("timer").textContent = `${left}s`; if (left <= 0) { clearInterval(timer!); void timeoutMove(); } }, 200);
    if (hooks.autoplay) setTimeout(() => void autoMove(), 30);
  } else {
    $("timer").textContent = "";
    watchdog = setTimeout(() => say("The opponent has been silent for 30 seconds: in the product this ends the match by forfeit."), 30000);
  }
}

async function send(sm: SignedMove) { peer.send({ t: "move", sm }); }
async function play(cell: number) {
  if (st.mover !== me || st.done) return;
  const sm = await signMove(keys, st.nextMove(me, cell)); const bad = await st.apply(sm); if (bad) { say(`Move refused: ${bad}`); return; }
  await send(sm); await after();
}
async function timeoutMove() {
  if (st.mover !== me || st.done) return; const bi = st.boardIndex; const cell = await timeoutCell(seed, code, bi, st.seq, emptyCells(st.boards[bi]!.cells));
  say("Time ran out: a move was placed for you at random."); await play(cell);
}
/** Test helper: the same greedy choice the simulation uses. */
async function autoMove() {
  if (st.mover !== me || st.done) return; const bi = st.boardIndex, bd = st.boards[bi]!; const mark = st.markOf(bi, me); let best = -Infinity, pick: number[] = [];
  for (const c of emptyCells(bd.cells)) { bd.cells[c] = mark; const s = scoreBoard(bd.cells, bd.n); const d = mark === 1 ? s.x.total - s.o.total : s.o.total - s.x.total; bd.cells[c] = 0; if (d > best) { best = d; pick = [c]; } else if (d === best) pick.push(c); }
  await play(pick[Math.floor(Math.random() * pick.length)]!);
}

async function after() {
  render();
  if (st.done) return void (await finish());
  startTimer();
}

async function finish() {
  if (finished) return; finished = true; if (timer) clearInterval(timer); if (watchdog) clearTimeout(watchdog);
  const ms = st.score(); let winner = ms.winner, rule = ms.tieBreak;
  if (!winner) { winner = (await beaconTieBreak(seed, code)) ? "A" : "B"; rule = "random beacon"; }
  const v = await verifyTranscript(code, st.boards.map((b) => b.xIsA), pubOf("A"), pubOf("B"), st.moves);
  const youWin = winner === me;
  $("final").hidden = false;
  $("final").innerHTML = `<h2>${youWin ? "You win the match" : "The masked opponent wins the match"}</h2>` +
    `<p>You ${me === "A" ? ms.a : ms.b} points, opponent ${me === "A" ? ms.b : ms.a} points${rule ? ` (decided by: ${rule})` : ""}.</p>` +
    `<ul>${ms.boards.map((b) => `<li>${b.n}x${b.n}: you ${me === "A" ? b.a : b.b}, opponent ${me === "A" ? b.b : b.a}</li>`).join("")}</ul>` +
    `<p>Move record check: ${v.ok ? "all 50 signed moves verified and the score re-computed" : "FAILED: " + (v as { reason: string }).reason}</p>`;
  hooks.result = { winner, rule: rule ?? null, a: ms.a, b: ms.b, boards: ms.boards, verified: v.ok, moves: st.moves.length, finalScoreVerified: v.ok ? v.score : null };
  say("Match finished.");
}
let pubs: { A?: JsonWebKey; B?: JsonWebKey } = {};
const pubOf = (p: Player): JsonWebKey => pubs[p]!;

async function start(role: Player) {
  me = role; hooks.me = role; code = ($("code") as HTMLInputElement).value.trim() || "demo"; seed = await sha256Hex("prototype-beacon|" + code);
  $("lobby").hidden = true; $("game").hidden = false; renderRules(); say("Connecting to the other player...");
  keys = await newDeviceKeys(); pubs[me] = keys.pubJwk;
  try { peer = await connectPeer({ match: code, role: me, signal }); } catch (e) { say(`Could not connect: ${(e as Error).message}`); return; }
  hooks.metrics = { openMs: peer.openMs, posts: signal.posts, polls: signal.polls, candidates: peer.candidateTypes };
  say("Connected directly to the other player. Exchanging keys...");
  // one listener from the first moment: hellos resolve the key exchange, moves that arrive early are kept until the match exists
  const inbox: SignedMove[] = []; let ready = false; let gotHello: (k: JsonWebKey) => void = () => {}; const hello = new Promise<JsonWebKey>((res) => { gotHello = res; });
  const onMove = async (sm: SignedMove) => { const bad = await st.apply(sm); if (bad) { say(`The opponent's move was refused: ${bad}`); return; } await after(); };
  peer.onMessage((m) => { if (m?.t === "hello") gotHello(m.pub as JsonWebKey); else if (m?.t === "move") { if (ready) void onMove(m.sm as SignedMove); else inbox.push(m.sm as SignedMove); } });
  peer.send({ t: "hello", pub: keys.pubJwk }); const theirPub = await hello; pubs[me === "A" ? "B" : "A"] = theirPub;
  const xa = await starters(seed, 1, 1, 2); st = new MatchState(code, xa, pubOf("A"), pubOf("B")); hooks.state = st; ready = true;
  for (const sm of inbox.splice(0)) await onMove(sm);
  peer.onClose(() => { if (!st.done) say("The other player left."); });
  peer.send({ t: "hello", pub: keys.pubJwk }); // a second hello covers a side that attached its listener late
  await after(); say("Match started.");
}

$("create").onclick = () => void start("A"); $("join").onclick = () => void start("B");
$("showRules").onclick = () => { const r = $("rules"); r.hidden = !r.hidden; };
renderRules();
if (q.get("code")) { ($("code") as HTMLInputElement).value = q.get("code")!; if (q.get("autoplay")) hooks.autoplay = true; const role = q.get("role"); if (role === "A" || role === "B") hooks.ready = start(role); }
void (BOARD_SIZES as readonly Size[]);
