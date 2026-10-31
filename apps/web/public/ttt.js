/* Corporate Tic Tac Toe, the player's page (z.html). Phone first. Joins with a name only, then shows the waiting room, the board, the result.
   THIS PHONE RUNS THE GAME: tttgame.js (window.TTT, built from packages/ttt) builds the bracket and every starter from the sealed seed, replays the stored moves with the rules, computes the clocks and the winner,
   and reports the result. Our server only stores and relays (docs/RULES.md, "Who computes what"). This file only draws what TTT.TttPhone returns and passes on a tap. */
(function () {
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  let EID = q.get("e") || "";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: the page still works until it is closed */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* nothing to remove */ } } };
  if (!EID) EID = ls.get("ttt:last") || ""; else ls.set("ttt:last", EID);
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
  let device = ls.get("ttt:device"); if (!/^[0-9a-f]{32}$/.test(device || "")) { device = hex(16); ls.set("ttt:device", device); }
  const pidKey = () => "ttt:" + EID + ":pid";
  let pid = ls.get(pidKey()) || "";
  const TOKEN = (q.get("t") || "").trim().slice(0, 80), FROM = Number(q.get("from")) || 0, CAT = (q.get("c") || "").slice(0, 20);
  let skew = 0, timer = null, last = null, joinMsg = "", INFO = null, phone = null;
  const thePhone = () => (phone && phone.deps.pid === pid ? phone : (phone = new window.TTT.TttPhone({ api, eid: EID, pid, device, now: () => Date.now() })));
  const api = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "http " + r.status), { status: r.status, code: j.code, body: j });
    return j;
  };
  const head = () => `<div class="zhead"><b>Corporate Tic Tac Toe</b></div>`;
  // the planned start, in the player's own time zone (the host still presses Start when everybody is in)
  const planned = () => { const ms = INFO && Number(INFO.startMs); if (!ms) return ""; let w = ""; try { w = new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { w = ""; } return w ? `<p class="zsmall" id="planned">Planned start: <b>${esc(w)}</b>. The host starts the tournament when everybody is in.</p>` : ""; };
  // the strip at the top: the organizer's company name, colour and small logo; with none set, the page carries our own name in writing
  // the strip, and under it our product line - but when no company brand is set the strip already says our name, so it stands alone
  const hasBrand = () => { const b = INFO && INFO.brand; return !!(b && (b.name || b.logo)); };
  const top = () => brand() + (hasBrand() ? head() : "");
  const brand = () => {
    const b = INFO && INFO.brand;
    if (!b || (!b.name && !b.logo)) return `<div class="zbrand zdef" data-bg="#0B5D5B" data-fg="#ffffff"><b>CORPORATE TIC TAC TOE</b></div>`;
    return `<div class="zbrand" data-bg="${esc(b.color)}" data-fg="${esc(b.fg || "#ffffff")}">${b.logo ? `<img class="zblogo" alt="" src="${esc(b.logo)}">` : ""}${b.name ? `<b>${esc(b.name)}</b>` : ""}</div>`;
  };
  const paintBrand = () => document.querySelectorAll(".zbrand").forEach((el) => { if (!el.classList.contains("zdef")) el.style.background = el.dataset.bg; el.style.color = el.dataset.fg; });
  const set = (html) => { $app.innerHTML = html; paintBrand(); };
  const SQ = ["top left", "top middle", "top right", "middle left", "centre", "middle right", "bottom left", "bottom middle", "bottom right"];
  // ---------- short, friendly movement (200 to 400 ms; none with "reduce motion"). Each animation plays once, when the thing it shows first appears: the page redraws itself every second or so, so a class is only given on that one redraw. ----------
  const MOTION = () => { try { return !matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winLine = (cells) => { for (const l of LINES) { const m = cells[l[0]]; if (m && m === cells[l[1]] && m === cells[l[2]]) return l; } return null; }; // which three squares made the line (drawn only, the rules live in tttgame.js)
  const SEEN = { cells: {}, won: new Set(), turn: {}, first: true };
  const OPEN = new Set(); // which fold-away blocks are open (kept over redraws)
  const fold = (key, title, inner) => `<details class="tfold" data-fold="${key}"${OPEN.has(key) ? " open" : ""}><summary>${title}</summary>${inner}</details>`;
  const bindFolds = () => document.querySelectorAll("details[data-fold]").forEach((d) => { d.ontoggle = () => { if (d.open) OPEN.add(d.dataset.fold); else OPEN.delete(d.dataset.fold); }; });
  /** a short burst of confetti (about 1.4 s) for a won board or the title */
  const celebrate = () => {
    if (!MOTION()) return;
    const cv = document.createElement("canvas"); cv.className = "tconf"; cv.setAttribute("aria-hidden", "true"); document.body.appendChild(cv);
    const ctx = cv.getContext("2d"); if (!ctx) { cv.remove(); return; }
    const W = (cv.width = innerWidth), H = (cv.height = innerHeight), cols = ["#D61F3A", "#1565D8", "#FFB703", "#0B8F6B", "#7B3FE4", "#FF7A1A"];
    const ps = Array.from({ length: 90 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .5, y: H * .35, vx: (Math.random() - .5) * 9, vy: -4 - Math.random() * 7, r: 4 + Math.random() * 5, c: cols[(Math.random() * cols.length) | 0], a: Math.random() * 6, va: (Math.random() - .5) * .4 }));
    const t0 = performance.now();
    (function f(t) { ctx.clearRect(0, 0, W, H); for (const p of ps) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.5); ctx.restore(); } if (t - t0 < 1400 && cv.isConnected) requestAnimationFrame(f); else cv.remove(); })(t0);
  };
  /** a number that counts up to its new value in about 0.35 s */
  const COUNTS = {};
  const countUps = () => document.querySelectorAll("[data-count]").forEach((el) => {
    const key = el.dataset.ck || el.id || "c", to = Number(el.dataset.count), from = COUNTS[key] === undefined ? to : COUNTS[key]; COUNTS[key] = to;
    if (from === to || !MOTION()) { el.textContent = String(to); return; }
    const t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / 350); el.textContent = String(Math.round(from + (to - from) * k)); if (k < 1 && el.isConnected) requestAnimationFrame(f); })(t0);
  });

  // ---------- joining: the boxes (K4, wording from the server) come BEFORE the name is asked; nothing is ticked in advance; the server refuses a join without both ticks ----------
  let tb = null, typedName = "", typedPhone = "", typedEmp = "";
  const JOIN_RETRY_MS = (n) => (window.__joinRetryMs ? window.__joinRetryMs : (4 + Math.min(26, n * 2)) * 1000); // a test sets window.__joinRetryMs to wait less
  // What the organizer asked people to give (INFO.verify): a mobile number, an employee ID or both. The default is the name alone.
  const idKind = () => (INFO && INFO.idKind === "email" ? "email" : "emp"), idName = () => (idKind() === "email" ? "Email ID" : "employee ID");
  const askWhat = () => { if (TOKEN) return { emp: false, mob: false, only: false, v: "mobile" }; /* a personal link already says who this is */ const v = INFO && (INFO.verify === "id" || INFO.verify === "either" || INFO.verify === "both") ? INFO.verify : "mobile", only = !!(INFO && INFO.employeesOnly), ph = !!(INFO && INFO.joinPhone); return { emp: v !== "mobile", mob: v !== "mobile" || ph, only, v }; };
  const joinView = () => {
    set(`${top()}<div class="zcard zform tjoin"><h2>Join the tournament</h2>
      <ol class="zsteps" aria-label="How to join"><li><b>1</b><span>Tick the boxes</span></li><li><b>2</b><span>Type your name</span></li><li><b>3</b><span>Press Join</span></li></ol>
      <p class="tlead">Win your board to reach the next round. The last player standing is the champion.</p>
      <p class="zsmall">Playing is free. No money is staked and there are no cash prizes. We ask your name only. Your organizer sees it and other players see it on the bracket.</p>${planned()}
      <p class="spriv"><a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a> &middot; <a href="/terms.html" target="_blank" rel="noopener">Terms</a></p>
      <div id="tbslot"></div>
      <label for="nm">Your name</label><input id="nm" autocomplete="name" maxlength="40" disabled>
      ${(() => { const a = askWhat(); return (a.emp ? `<label for="emp">Your ${idName()}${a.only ? "" : " (if you work here)"}</label><input id="emp" autocomplete="off" ${idKind() === "email" ? 'inputmode="email" autocapitalize="none" maxlength="254"' : 'maxlength="60"'} value="${esc(typedEmp)}" disabled><p class="zsmall" id="emphint" aria-live="polite"></p>` : "") + (a.mob ? `<label for="mob">Your mobile number${a.v === "id" && !a.only ? " (if you have no employee ID)" : ""}</label><input id="mob" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(typedPhone)}" disabled>` : "") + (a.emp ? `<p class="zsmall">${a.only ? "This game is for the employees on the organizer's list." : "People who do not work here give their mobile number."}</p>` : ""); })()}
      ${joinMsg ? `<div class="zbanner bad" role="alert">${esc(joinMsg)}</div>` : ""}
      <button class="zbtn" id="go" disabled>Join</button>
      <p class="zsmall"><a href="#" id="watch">I only want to watch</a></p></div>`);
    const nm = document.getElementById("nm"), go = document.getElementById("go");
    const emp = document.getElementById("emp"), mob = document.getElementById("mob"), ask = askWhat(); if (emp) { const hint = document.getElementById("emphint"); emp.addEventListener("input", () => { const c = idKind() === "email" ? String(emp.value || "").normalize("NFKC").replace(/[\s\u0085\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase() : String(emp.value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, ""); const em = idKind() === "email", ok = em ? /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(c) : !!c && c.length <= 30 && !String(emp.value || "").normalize("NFKC").includes("@"); if (hint) hint.textContent = !em && c.length > 30 && !String(emp.value || "").normalize("NFKC").includes("@") ? "This ID is too long. An employee ID may be up to 30 characters once cleaned." : ok && c !== String(emp.value).trim() ? "The system will read this as " + c : ""; }); } // same cleaning as the server (apps/edge/src/ids.ts)
    const given = () => { const e = emp ? emp.value.trim() : "", m = mob ? mob.value.replace(/\D/g, "").length >= 8 : false; return ask.only ? (ask.v === "both" ? !!e && m : !!e) : ask.v === "mobile" ? (mob ? m : true) : ask.v === "id" ? !!e || m : m; };
    const sync = () => { const ok = !!(tb && tb.ok()); nm.disabled = !ok; if (emp) emp.disabled = !ok; if (mob) mob.disabled = !ok; go.disabled = !ok || nm.value.trim().length < 2 || !given(); go.setAttribute("aria-disabled", String(go.disabled)); };
    window.TermsBox.mount(document.getElementById("tbslot"), "K4", { base: BASE, onChange: sync }).then((t) => { tb = t; sync(); });
    nm.addEventListener("input", sync); if (emp) emp.addEventListener("input", sync); if (mob) mob.addEventListener("input", sync);
    document.getElementById("watch").addEventListener("click", (e) => { e.preventDefault(); location.href = "/big.html?e=" + encodeURIComponent(EID); });
    const BUSY_TRIES = 15; let busyTries = 0, retryTimer = 0;
    const busyView = () => set(`${top()}<div class="zcard" role="status"><h2>Many people are joining right now</h2><p>Your request is safe. We are trying again for you every few seconds. Keep this page open.</p><p class="zsmall">Try ${busyTries} of ${BUSY_TRIES}.</p></div>`);
    const attempt = async () => {
      try {
        const r = await api("POST", `/api/z/${EID}/join`, { name: typedName, ...(typedEmp ? { empId: typedEmp } : {}), ...(typedPhone ? { phone: typedPhone } : {}), device, consent: tb.terms(), ...(TOKEN ? { token: TOKEN } : {}), ...(FROM ? { from: FROM, ...(CAT ? { cat: CAT } : {}) } : {}) });
        pid = r.pid; ls.set(pidKey(), pid);
        start();
      } catch (e) {
        if (e.code === "waiting" && e.body && e.body.wid) { waitFor(e.body.wid, e.message); return; }
        if (e.code === "closed") { set(`${top()}<div class="zcard" role="status"><h2>The list of players is closed</h2><p class="tlead">The tournament has already started, so new players cannot join now.</p><p class="zsmall">You can still watch the bracket.</p><a class="zbtn" href="/big.html?e=${encodeURIComponent(EID)}">Watch the bracket</a></div>`); return; } // TT-08: say why, instead of sending the person to another page without a word
        // a join that timed out or lost its connection (no answer at all) is asked again by itself like a busy answer: joining is safe to repeat, the same phone gets the same place
        if ((e.code === "busy" || (!e.status && !e.code)) && busyTries < BUSY_TRIES) { busyTries++; busyView(); clearTimeout(retryTimer); retryTimer = setTimeout(attempt, Math.round((JOIN_RETRY_MS(busyTries)) * (0.7 + Math.random() * 0.6))); return; }
        joinMsg = e.message || "Could not join. Please try again."; joinView();
      }
    };
    go.addEventListener("click", () => {
      go.disabled = true; joinMsg = ""; typedName = nm.value.trim(); typedEmp = emp ? emp.value.trim() : ""; typedPhone = mob ? mob.value.trim() : "";
      attempt();
    });
  };

  // ---------- the waiting room: a game by invitation lets a person in once the host approves; the page asks again by itself ----------
  const waitFor = (wid, note) => {
    set(`${top()}<div class="zcard" role="status"><h2>Please wait a moment</h2><p>${esc(note || "The host has to let you in.")}</p><p class="zsmall">Keep this page open. It moves on by itself.</p></div>`);
    const again = async () => {
      try {
        const r = await api("GET", `/api/z/${EID}/me?wid=${encodeURIComponent(wid)}`);
        if (r.state === "admitted") { try { const j = await api("POST", `/api/z/${EID}/join`, { name: typedName, ...(typedEmp ? { empId: typedEmp } : {}), ...(typedPhone ? { phone: typedPhone } : {}), device, consent: tb ? tb.terms() : undefined }); pid = j.pid; ls.set(pidKey(), pid); start(); return; } catch (e) { joinMsg = e.message; joinView(); return; } }
        if (r.state === "declined" || r.state === "lapsed" || r.state === "removed") { set(`${head()}<div class="zcard" role="status"><h2>${r.state === "declined" ? "Your request was not accepted" : "This request is over"}</h2><p class="zsmall">Please ask whoever invited you.</p></div>`); return; }
      } catch (e) { /* the next look tries again */ }
      setTimeout(again, 5000);
    };
    setTimeout(again, 5000);
  };

  // ---------- the board ----------
  const secs = (ms) => Math.max(0, Math.ceil((ms - (Date.now() + skew)) / 1000));
  const boardKey = (s, b) => (s.roundName || "") + "|" + b.gameNo + "|" + (s.you || "") + "|" + (s.vs || "");
  const boardHtml = (b, live, key) => {
    const mark = (c) => (c === 1 ? "X" : c === 2 ? "O" : "");
    const mine = b.yourMark; // "X" | "O"
    const prev = SEEN.cells[key], wl = b.done ? winLine(b.cells) : null, fresh = !!wl && !SEEN.won.has(key + "|" + b.cells.join(""));
    return `<div class="tboard" role="group" aria-label="Tic tac toe board">${b.cells.map((c, i) => `<button class="tsq ${c === 1 ? "x" : c === 2 ? "o" : ""}${c && prev && !prev[i] && MOTION() ? " pop" : ""}${wl && wl.includes(i) ? " win" + (fresh ? " winnew" : "") : ""}" data-i="${i}" aria-label="${SQ[i]}${c ? ", " + mark(c) : ", empty"}" ${live && c === 0 && b.yourTurn && !b.done ? "" : "disabled"}>${mark(c)}</button>`).join("")}</div><p class="zsmall tcen">You are <b>${mine || "-"}</b>. X moves first.</p>`;
  };
  const playing = (s) => {
    const b = s.board;
    if (!b) { set(`${top()}<div class="zcard"><h2>${esc(s.roundName)}</h2><p>Your board is finished. Waiting for your team.</p></div>${others(s)}`); return; }
    const t = b.deadlineMs ? secs(b.deadlineMs) : null, key = boardKey(s, b);
    const won = b.done && (b.youWon !== undefined ? b.youWon : b.winner === s.you), opp = s.vs || (b.a === s.you ? b.b : b.a) /* TT-26: who won comes from ids (youWon), never from comparing names */, mine = b.yourMark, theirs = mine === "X" ? "O" : "X";
    // TT-05: say why the board changed on its own: a new game with the marks swapped after a draw, or a square played because a clock ran out
    const note = b.done ? "" : b.ply === 0 && b.gameNo > 1 ? `The last game was a draw, so this game starts with the marks swapped. You now play ${mine}.` : b.lastAuto ? (b.yourTurn ? `Time ran out for ${esc(opp)}, so a square was played for them.` : "Your time ran out, so a square was played for you.") : "";
    const status = b.done ? (won ? "You won this board." : "This board is over.") : b.yourTurn ? "Your turn" : "Waiting for " + esc(b.turn === s.you ? b.turn + " (the other player)" : b.turn);
    const tone = b.done ? (won ? "won" : "over") : s.paused ? "pause" : b.yourTurn ? "go" : "wait";
    const instr = b.done ? (won ? "Well played! Keep this page open." : "This board is finished. Keep this page open.") : s.paused ? "The host paused the game. It carries on shortly." : b.yourTurn ? `Tap a square to place your ${mine}.` : `${esc(opp)} is choosing a square.`;
    const flash = !SEEN.first && SEEN.turn[key] !== undefined && SEEN.turn[key] !== !!b.yourTurn && MOTION() ? " flash" : "";
    const fresh = b.done && winLine(b.cells) && !SEEN.won.has(key + "|" + b.cells.join(""));
    const turnName = b.turn;
    set(`${top()}<div class="zcard tplay"><h2>${esc(s.roundName)}${s.team ? " &middot; " + esc(s.team) : ""}</h2>
      <div class="tplayers" role="group" aria-label="Players"><span class="tpl ${mine === "X" ? "x" : "o"}${!b.done && b.yourTurn ? " on" : ""}"><i>${mine}</i><b>${esc(s.you)}</b> <em>(you)</em></span><span class="tvsw">vs</span><span class="tpl ${theirs === "X" ? "x" : "o"}${!b.done && !b.yourTurn ? " on" : ""}"><i>${theirs}</i><b>${esc(opp)}</b></span></div>
      ${s.flagged ? `<div class="zbanner warn" role="alert">The two reports of this board are different. The organizer will settle it.</div>` : ""}
      <div class="tbanner ${tone}${flash}"><p class="tstat ${b.yourTurn ? "mine" : ""}" role="status"><span class="tstxt">${status}</span>${t !== null && !s.paused && !b.done ? ` <span class="tclock${t <= 5 ? " low" : t <= 10 ? " mid" : ""}" id="clk">${t}s</span>` : ""}${s.paused ? " (paused by the host)" : ""}</p><p class="tinstr">${instr}</p>${note ? `<p class="tnote" role="status">${note}</p>` : ""}</div>
      ${boardHtml(b, true, key)}
      ${b.done ? "" : `<p class="tgoal">Win this board to move on.</p>`}
      ${fold("rules", "How this board works", `<p class="zsmall">Game ${b.gameNo}${b.games > 1 ? " (earlier games were drawn)" : ""}. A draw is replayed with the marks swapped, up to 3 games. If the clock runs out, a square is played for you. Twice in a row loses the board.</p>`)}</div>${others(s)}
      <p class="zsmall tcen"><a href="/big.html?e=${encodeURIComponent(EID)}" target="_blank" rel="noopener">Watch the whole bracket</a></p>`);
    document.querySelectorAll(".tsq").forEach((el) => el.addEventListener("click", () => play(Number(el.dataset.i))));
    bindFolds();
    // remember what was drawn, so the next redraw knows what is new
    SEEN.cells[key] = b.cells.slice(); SEEN.turn[key] = !!b.yourTurn; SEEN.first = false;
    if (fresh) { SEEN.won.add(key + "|" + b.cells.join("")); if (won) celebrate(); }
  };
  const others = (s) => (s.boards && s.boards.length > 1 ? `<div class="zcard"><h2>Your team's boards</h2>${s.boards.map((x) => `<p class="zsmall">${esc(x.a)} vs ${esc(x.b)}: ${x.done ? (x.winner ? esc(x.winner) + " won" : "done") : "playing, game " + x.gameNo}</p>`).join("")}</div>` : "");
  const play = async (cell) => {
    try { await thePhone().play(cell); } catch (e) { /* stale or too late: the next look shows the board as it is */ }
    tick();
  };
  const rankHtml = (r) => (r && r.length ? `<div class="zcard"><h2>Results</h2><ol class="trank">${r.map((x) => `<li><b>${esc(x.name)}</b>${x.tie ? `<small>${esc(x.tie)}</small>` : ""}</li>`).join("")}</ol></div>` : "");

  const render = (s) => { try { render0(s); } finally { countUps(); } };
  // The common engine's text reactions: only on the new flow (?flow=new or ct-flow=new on this device); the live game is unchanged without it.
  const engineOn = (() => { try { return /[?&]flow=new\b/.test(location.search) || localStorage.getItem("ct-flow") === "new"; } catch { return /[?&]flow=new\b/.test(location.search); } })();
  let stage = null;
  if (engineOn) { const sg = document.createElement("script"); sg.src = "/tttstage.js?v=1"; sg.async = true; document.head.appendChild(sg); }
  if (engineOn) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/reactions.css?v=1"; document.head.appendChild(l); const sc = document.createElement("script"); sc.src = "/tttengine.js?v=1"; sc.async = true; document.head.appendChild(sc); }
  let rxPrev = null, rxPaused = false;
  // The core reaction scheduler decides what shows (2 to 3 s, gaps, at most 15 in 10 minutes); the top strip never covers the board.
  let rxs = null;
  const rx = (id, high) => { try { const R = window.TTTENG; if (!R) return; if (!rxs) rxs = R.createReactions(pid || null); rxs.react(id, { now: Date.now(), priority: high ? "high" : "normal", game: "tictactoe" }); } catch (e) {} };
  // Stage clock (new flow only): the waiting room, then three stages. Pure functions of the start time; every phone shows the same.
  const stagePanel = () => {
    if (!engineOn) return;
    let box = document.getElementById("tstage");
    if (!box) { box = document.createElement("div"); box.id = "tstage"; box.className = "zcard"; box.setAttribute("role", "status"); box.hidden = true; $app.parentNode.insertBefore(box, $app); }
    let info = null, got = 0;
    const load = async () => { try { const j = await api("GET", `/api/z/${EID}/ttt/setup`); info = { startedMs: j.startedMs, pauses: j.pauses || [], skew: (j.serverNow || Date.now()) - Date.now() }; } catch (e) {} got = Date.now(); };
    const mmss = (n) => Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
    const paint = () => {
      const R = window.TTTENG;
      if (!R || !info || !info.startedMs) { box.hidden = true; return; }
      const now = Date.now() + info.skew; let paused = 0; for (const [a, b] of info.pauses) paused += Math.max(0, Math.min(b == null ? now : b, now) - a);
      const c = R.clockAt(info.startedMs, now, paused), stillPaused = info.pauses.some(([, b]) => b == null);
      box.hidden = false;
      box.textContent = stillPaused ? "Paused" : c.phase === "waiting" ? "Waiting room. The first stage starts in " + mmss(c.secondsToStart) : c.phase === "done" ? "The stages are over." : "Stage " + c.stage + " of " + R.STAGES + ", slot " + c.slot + " of " + R.SLOTS_PER_STAGE + ". " + mmss(c.secondsLeftInStage) + " left in this stage.";
    };
    load(); setInterval(() => { if (Date.now() - got > 20000) load(); paint(); }, 1000);
  };
  stagePanel();
  const reactTo = (s) => {
    const R = window.TTTENG; if (!engineOn || !R) { rxPrev = s.phase; return; }
    const paused = !!s.paused, ph = s.phase;
    if (paused !== rxPaused) { rx(paused ? "pause" : "resume"); rxPaused = paused; }
    else if (rxPrev !== null && ph !== rxPrev) {
      if (ph === "champion") rx("win", true); else if (ph === "out") rx("out", true);
      else if (ph === "next") rx("round_end"); else if (ph === "playing" && rxPrev !== "playing") rx(rxPrev === "waiting" ? "go" : "round_start");
    }
    rxPrev = ph;
  };
  const render0 = (s) => {
    try { reactTo(s); } catch {}
    if (window.ctzView) window.ctzView({ phase: s.phase === "champion" || s.phase === "out" ? "ended" : String(s.phase || "") }); // the flight recorder (blackbox.js) learns the stage
    last = s; skew = (s.serverNow || Date.now()) - Date.now();
    if (s.phase === "waiting") set(`${top()}<div class="zcard twait" role="status"><h2>You are in</h2><div class="tbig" aria-hidden="true"><span class="tmk x">X</span><span class="tmk o">O</span></div><p class="tlead">Waiting for the host to start the tournament.</p><p class="tjoined"><b id="tjn" data-count="${Number(s.joined) || 0}" data-ck="joined">${Number(s.joined) || 0}</b> ${Number(s.joined) === 1 ? "player has" : "players have"} joined so far</p><div class="tdo"><b>What to do:</b> nothing yet. Keep this page open. When the host starts, your board appears here.</div>${planned()}<p class="zsmall">Who plays whom is fixed before anyone joins, so nobody can change it. Its fingerprint: <span class="mono">${esc((s.commit || "").slice(0, 16))}</span>. After the start the host shows the secret, so anybody can check it.</p></div>`);
    else if (s.phase === "playing") playing(s);
    else if (s.phase === "champion") { set(`${top()}<div class="zcard tchamp" role="status"><h2>You are the champion</h2><div class="ttrophy" aria-hidden="true">&#127942;</div><p class="tlead">Well played, ${esc(s.you)}.</p><p class="zsmall">Every board you played was won. Thank you for taking part.</p></div>${rankHtml(s.ranking)}`); if (!SEEN.champ) { SEEN.champ = true; celebrate(); } }
    else if (s.phase === "out") set(`${top()}<div class="zcard tout" role="status"><h2>${esc(s.message)}</h2><div class="ttrophy" aria-hidden="true">&#128079;</div><p class="tlead">You went out in the ${esc(s.roundName)}.${s.place ? " Your place: <b>" + esc(s.place) + "</b>." : ""}</p><p class="zsmall">Good game! You can still watch the bracket.</p><a class="zbtn alt" href="/big.html?e=${encodeURIComponent(EID)}">Watch the bracket</a></div>${rankHtml(s.ranking)}`);
    else if (s.phase === "next") set(`${top()}<div class="zcard tnext" role="status"><h2>${esc(s.message)}</h2><div class="tbig" aria-hidden="true"><span class="tmk x">X</span><span class="tmk o">O</span></div><p class="zsmall">Keep this page open. Your next board appears here by itself.</p></div>`);
    else set(`${top()}<div class="zcard" role="status"><h2>${esc(s.message || "Watching")}</h2><p><a href="/big.html?e=${encodeURIComponent(EID)}">Watch the bracket</a></p></div>`);
  };
  // a person the organizer removed is told so, in words, and does not get the join form again (the seat stays in the list; the phone just stops)
  const removedView = () => set(`${top()}<div class="zcard" role="status"><h2>You were removed from this game</h2><p class="zsmall">The organizer took your place away. Please ask the organizer if you think this is a mistake.</p><p><a href="/big.html?e=${encodeURIComponent(EID)}">Watch the bracket</a></p></div>`);
  let rmLook = 0;
  // removed = the seat is marked removed, or (before the start) the seat is gone from the list altogether: the organizer took it away before the game began
  const isRemoved = async (open) => { try { return !!(await api("GET", `/api/z/${EID}/invites?pid=${encodeURIComponent(pid)}`)).removed; } catch (e) { return e.code === "removed" || (!!open && e.status === 403); } };
  const tick = async () => {
    clearTimeout(timer);
    try {
      if (engineOn && window.TTTSTAGE && window.TTTENG) {
        if (!stage) stage = window.TTTSTAGE({ api, EID, pid: () => pid, device: () => device, rx });
        const html = await stage.look();
        if (html) { set(`${top()}${html}`); timer = setTimeout(tick, 1000); return; }
      }
      const s = await thePhone().tick();
      if ((s.phase === "waiting" || s.phase === "watching" || ((s.phase === "playing" || s.phase === "next") && rmLook++ % 2 === 0)) && (await isRemoved(s.state === "open" || s.state === "starting"))) { removedView(); return; }
      render(s);
    }
    catch (e) {
      if (e.code === "removed") { removedView(); return; }
      if (e.status === 403) { ls.del(pidKey()); pid = ""; joinMsg = e.code === "other-phone" ? "This place is on another phone." : ""; joinView(); return; }
      if (e.code === "cancelled" || e.code === "did-not-start") { set(`${head()}<div class="zcard" role="status"><h2>${e.code === "cancelled" ? "This game was cancelled by the organizer" : "This game did not start"}</h2><p class="zsmall">There is nothing to do on this page.</p></div>`); return; }
      if (e.code === "payment-due" || e.status === 402) { set(`${top()}<div class="zcard" role="status"><h2>Waiting for the Organizer or Host to start the game.</h2><p class="zsmall">Keep this page open. It moves on by itself.</p></div>`); timer = setTimeout(tick, 5000); return; }
      set(`${head()}<div class="zcard" role="status"><h2>No connection</h2><p class="zsmall">Trying again in a moment.</p></div>`);
    }
    timer = setTimeout(tick, last && last.phase === "playing" ? 1200 : 3000);
  };
  setInterval(() => { const c = document.getElementById("clk"); if (c && last && last.board && last.board.deadlineMs) { const n = secs(last.board.deadlineMs); c.textContent = n + "s"; c.classList.toggle("low", n <= 5); c.classList.toggle("mid", n > 5 && n <= 10); } }, 500);
  const start = () => { if (!pid) joinView(); else tick(); };
  if (!EID) { set(`${head()}<div class="zcard"><h2>Open your game link</h2><p class="zsmall">Ask your organizer for the link to this game.</p></div>`); return; }
  api("GET", `/api/z/${EID}/info`).then((i) => { INFO = i; if (i.cancelled) { set(`${head()}<div class="zcard" role="status"><h2>This game was cancelled by the organizer</h2><p class="zsmall">There is nothing to do on this page.</p></div>`); return; } start(); }).catch((e) => { if (e.status === 404) set(`${head()}<div class="zcard" role="status"><h2>We could not find this game</h2><p class="zsmall">Please check the link, or ask your organizer to send it again.</p></div>`); else if (e.status === 403) set(`${head()}<div class="zcard" role="status"><h2>This game is not open yet</h2><p class="zsmall">Please try again later.</p></div>`); else start(); });
})();
