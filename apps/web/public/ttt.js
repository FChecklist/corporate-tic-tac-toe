/* Corporate Tic Tac Toe, the player's page (z.html). Phone first. Joins with a name only, then shows the waiting room, the board, the result.
   The browser sends only "my square". Everything else (who has X, the bracket, the clocks, the winner) is decided on the server from the sealed seed (docs/RULES.md). */
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
  let skew = 0, timer = null, last = null, joinMsg = "", INFO = null;
  const api = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "http " + r.status), { status: r.status, code: j.code, body: j });
    return j;
  };
  const head = () => `<div class="zhead"><b>Corporate Tic Tac Toe</b></div>`;
  const brand = () => (INFO && INFO.brand && INFO.brand.name ? `<div class="zbrand" data-bg="${esc(INFO.brand.color)}" data-fg="#ffffff"><b>${esc(INFO.brand.name)}</b></div>` : "");
  const paintBrand = () => document.querySelectorAll(".zbrand").forEach((el) => { el.style.background = el.dataset.bg; el.style.color = el.dataset.fg; });
  const set = (html) => { $app.innerHTML = html; paintBrand(); };
  const SQ = ["top left", "top middle", "top right", "middle left", "centre", "middle right", "bottom left", "bottom middle", "bottom right"];

  // ---------- joining: the boxes (K4, wording from the server) come BEFORE the name is asked; nothing is ticked in advance; the server refuses a join without both ticks ----------
  let tb = null;
  const joinView = () => {
    set(`${brand()}${head()}<div class="zcard zform"><h2>Join the tournament</h2>
      <p class="zsmall">Playing is free. No money is staked and there are no cash prizes. We ask your name only. Your organizer sees it and other players see it on the bracket.</p>
      <p class="spriv"><a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a> &middot; <a href="/terms.html" target="_blank" rel="noopener">Terms</a></p>
      <div id="tbslot"></div>
      <label for="nm">Your name</label><input id="nm" autocomplete="name" maxlength="40" disabled>
      ${joinMsg ? `<div class="zbanner bad" role="alert">${esc(joinMsg)}</div>` : ""}
      <button class="zbtn" id="go" disabled>Join</button>
      <p class="zsmall"><a href="#" id="watch">I only want to watch</a></p></div>`);
    const nm = document.getElementById("nm"), go = document.getElementById("go");
    const sync = () => { const ok = !!(tb && tb.ok()); nm.disabled = !ok; go.disabled = !ok || nm.value.trim().length < 2; go.setAttribute("aria-disabled", String(go.disabled)); };
    window.TermsBox.mount(document.getElementById("tbslot"), "K4", { base: BASE, onChange: sync }).then((t) => { tb = t; sync(); });
    nm.addEventListener("input", sync);
    document.getElementById("watch").addEventListener("click", (e) => { e.preventDefault(); location.href = "/big.html?e=" + encodeURIComponent(EID); });
    go.addEventListener("click", async () => {
      go.disabled = true; joinMsg = "";
      try {
        const r = await api("POST", `/api/z/${EID}/join`, { name: nm.value.trim(), device, consent: tb.terms(), ...(TOKEN ? { token: TOKEN } : {}), ...(FROM ? { from: FROM, ...(CAT ? { cat: CAT } : {}) } : {}) });
        pid = r.pid; ls.set(pidKey(), pid);
        start();
      } catch (e) {
        if (e.code === "waiting" && e.body && e.body.wid) { waitFor(e.body.wid, e.message); return; }
        if (e.code === "closed") { location.href = "/big.html?e=" + encodeURIComponent(EID); return; }
        joinMsg = e.message || "Could not join. Please try again."; joinView();
      }
    });
  };

  // ---------- the waiting room: a game by invitation lets a person in once the host approves; the page asks again by itself ----------
  const waitFor = (wid, note) => {
    set(`${brand()}${head()}<div class="zcard" role="status"><h2>Please wait a moment</h2><p>${esc(note || "The host has to let you in.")}</p><p class="zsmall">Keep this page open. It moves on by itself.</p></div>`);
    const again = async () => {
      try {
        const r = await api("GET", `/api/z/${EID}/me?wid=${encodeURIComponent(wid)}`);
        if (r.state === "admitted") { try { const j = await api("POST", `/api/z/${EID}/join`, { name: "", device, consent: tb ? tb.terms() : undefined }); pid = j.pid; ls.set(pidKey(), pid); start(); return; } catch (e) { joinMsg = e.message; joinView(); return; } }
        if (r.state === "declined" || r.state === "lapsed" || r.state === "removed") { set(`${head()}<div class="zcard" role="status"><h2>${r.state === "declined" ? "Your request was not accepted" : "This request is over"}</h2><p class="zsmall">Please ask whoever invited you.</p></div>`); return; }
      } catch (e) { /* the next look tries again */ }
      setTimeout(again, 5000);
    };
    setTimeout(again, 5000);
  };

  // ---------- the board ----------
  const secs = (ms) => Math.max(0, Math.ceil((ms - (Date.now() + skew)) / 1000));
  const boardHtml = (b, live) => {
    const mark = (c) => (c === 1 ? "X" : c === 2 ? "O" : "");
    const mine = b.yourMark; // "X" | "O"
    return `<div class="tboard" role="grid" aria-label="Tic tac toe board">${b.cells.map((c, i) => `<button class="tsq ${c === 1 ? "x" : c === 2 ? "o" : ""}" data-i="${i}" role="gridcell" aria-label="${SQ[i]}${c ? ", " + mark(c) : ", empty"}" ${live && c === 0 && b.yourTurn && !b.done ? "" : "disabled"}>${mark(c)}</button>`).join("")}</div><p class="zsmall tcen">You are <b>${mine || "-"}</b>. X moves first.</p>`;
  };
  const playing = (s) => {
    const b = s.board;
    if (!b) { set(`${brand()}${head()}<div class="zcard"><h2>${esc(s.roundName)}</h2><p>Your board is finished. Waiting for your team.</p></div>${others(s)}`); return; }
    const t = b.deadlineMs ? secs(b.deadlineMs) : null;
    const status = b.done ? (b.winner === s.you ? "You won this board." : "This board is over.") : b.yourTurn ? "Your turn" : "Waiting for " + esc(b.turn);
    set(`${brand()}${head()}<div class="zcard"><h2>${esc(s.roundName)}${s.team ? " &middot; " + esc(s.team) : ""}</h2>
      <p class="tvs"><b>${esc(s.you)}</b> vs <b>${esc(s.vs || (b.a === s.you ? b.b : b.a))}</b></p>
      <p class="tstat ${b.yourTurn ? "mine" : ""}" role="status">${status}${t !== null && !s.paused ? ` <span class="tclock" id="clk">${t}s</span>` : ""}${s.paused ? " (paused by the host)" : ""}</p>
      ${boardHtml(b, true)}
      <p class="zsmall tcen">Game ${b.gameNo}${b.games > 1 ? " (earlier games were drawn)" : ""}. A draw is replayed with the marks swapped, up to 3 games. If the clock runs out, the software plays a square for you. Twice in a row loses the board.</p></div>${others(s)}
      <p class="zsmall tcen"><a href="/big.html?e=${encodeURIComponent(EID)}" target="_blank" rel="noopener">Watch the whole bracket</a></p>`);
    document.querySelectorAll(".tsq").forEach((el) => el.addEventListener("click", () => play(Number(el.dataset.i), b.ply)));
  };
  const others = (s) => (s.boards && s.boards.length > 1 ? `<div class="zcard"><h2>Your team's boards</h2>${s.boards.map((x) => `<p class="zsmall">${esc(x.a)} vs ${esc(x.b)}: ${x.done ? (x.winner ? esc(x.winner) + " won" : "done") : "playing, game " + x.gameNo}</p>`).join("")}</div>` : "");
  const play = async (cell, ply) => {
    try { await api("POST", `/api/z/${EID}/ttt/move`, { pid, device, cell, ply }); } catch (e) { /* stale or too late: the next look shows the board as it is */ }
    tick();
  };
  const rankHtml = (r) => (r && r.length ? `<div class="zcard"><h2>Results</h2><ol class="trank">${r.map((x) => `<li><b>${esc(x.name)}</b>${x.tie ? `<small>${esc(x.tie)}</small>` : ""}</li>`).join("")}</ol></div>` : "");

  const render = (s) => {
    last = s; skew = (s.serverNow || Date.now()) - Date.now();
    if (s.phase === "waiting") set(`${brand()}${head()}<div class="zcard" role="status"><h2>You are in</h2><p>Waiting for the host to start the tournament. ${s.joined ? esc(s.joined) + " joined so far." : ""}</p><p class="zsmall">The draw is sealed before anyone joins. Its fingerprint: <span class="mono">${esc((s.commit || "").slice(0, 16))}</span>. After the start the host shows the secret, so anybody can check the draw.</p></div>`);
    else if (s.phase === "playing") playing(s);
    else if (s.phase === "champion") set(`${brand()}${head()}<div class="zcard" role="status"><h2>You are the champion</h2><p>Well played, ${esc(s.you)}.</p></div>${rankHtml(s.ranking)}`);
    else if (s.phase === "out") set(`${brand()}${head()}<div class="zcard" role="status"><h2>${esc(s.message)}</h2><p>You went out in the ${esc(s.roundName)}.${s.place ? " Your place: " + esc(s.place) + "." : ""}</p><p><a href="/big.html?e=${encodeURIComponent(EID)}">Watch the bracket</a></p></div>${rankHtml(s.ranking)}`);
    else if (s.phase === "next") set(`${brand()}${head()}<div class="zcard" role="status"><h2>${esc(s.message)}</h2><p class="zsmall">Keep this page open. It moves on by itself.</p></div>`);
    else set(`${brand()}${head()}<div class="zcard" role="status"><h2>${esc(s.message || "Watching")}</h2><p><a href="/big.html?e=${encodeURIComponent(EID)}">Watch the bracket</a></p></div>`);
  };
  const tick = async () => {
    clearTimeout(timer);
    try { render(await api("GET", `/api/z/${EID}/ttt/me?pid=${encodeURIComponent(pid)}&device=${encodeURIComponent(device)}`)); }
    catch (e) {
      if (e.status === 403 || e.status === 400) { ls.del(pidKey()); pid = ""; joinMsg = e.code === "other-phone" ? "This place is on another phone." : ""; joinView(); return; }
      if (e.code === "cancelled" || e.code === "did-not-start") { set(`${head()}<div class="zcard" role="status"><h2>${e.code === "cancelled" ? "This game was cancelled" : "This game did not start"}</h2><p class="zsmall">There is nothing to do on this page.</p></div>`); return; }
      set(`${head()}<div class="zcard" role="status"><h2>No connection</h2><p class="zsmall">Trying again in a moment.</p></div>`);
    }
    timer = setTimeout(tick, last && last.phase === "playing" ? 1200 : 3000);
  };
  setInterval(() => { const c = document.getElementById("clk"); if (c && last && last.board && last.board.deadlineMs) c.textContent = secs(last.board.deadlineMs) + "s"; }, 500);
  const start = () => { if (!pid) joinView(); else tick(); };
  if (!EID) { set(`${head()}<div class="zcard"><h2>Open your game link</h2><p class="zsmall">Ask your organizer for the link to this game.</p></div>`); return; }
  api("GET", `/api/z/${EID}/info`).then((i) => { INFO = i; if (i.cancelled) { set(`${head()}<div class="zcard" role="status"><h2>This game was cancelled</h2></div>`); return; } start(); }).catch((e) => { if (e.status === 403 || e.status === 404) set(`${head()}<div class="zcard" role="status"><h2>This game is not open yet</h2><p class="zsmall">Please try again later.</p></div>`); else start(); });
})();
