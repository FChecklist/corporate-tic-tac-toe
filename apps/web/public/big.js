/* Corporate Tic Tac Toe, the spectator view and big screen (big.html). No sign-in. It only reads what the mailbox stored (names, stored moves) and replays it on THIS screen with the rules (tttgame.js),
   never a seed before the start, never a device id. It never joins the game. Works on a projector, a laptop and a phone. */
(function () {
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const EID = (q.get("e") || "").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let skew = 0, view = null, err = "", page = null, info = null;
  const read = async (method, url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error("http " + r.status), { status: r.status, code: j.code }); } return r.json(); };
  const watcher = window.TTT ? new window.TTT.TttWatcher(read, EID) : null;
  const mark = (c) => (c === 1 ? "X" : c === 2 ? "O" : "");
  const mini = (b) => `<div class="mb ${b.done ? "done" : ""}" role="img" aria-label="${esc(b.aName)} versus ${esc(b.bName)}">
    <div class="who"><span>${esc(b.x)} <b>X</b></span><span>${esc(b.o)} <b>O</b></span></div>
    <div class="g">${b.cells.map((c) => `<i class="${c === 1 ? "x" : c === 2 ? "o" : ""}">${mark(c)}</i>`).join("")}</div>
    <div class="st">${b.done ? esc(b.winner ? b.winner + " won" : "done") : esc("Game " + b.gameNo + (b.turn ? ", " + b.turn + " to move" : ""))}</div></div>`;
  const matchCard = (m) => `<section class="mt"><h3>${esc(m.roundName)}: ${esc(m.a)} vs ${esc(m.b)} ${m.winner ? `<small>winner: ${esc(m.winner)}</small>` : ""}</h3><div class="mbs">${m.boards.map(mini).join("")}</div></section>`;
  const ranking = (r) => (r && r.length ? `<ol class="rk">${r.map((x) => `<li><b>${esc(x.name)}</b>${x.tie ? `<small>${esc(x.tie)}</small>` : ""}</li>`).join("")}</ol>` : "");
  function paint() {
    if (!view) { $app.innerHTML = `<p class="msg">${esc(err || "Loading...")}</p>`; return; }
    const v = view; let body = "";
    if (v.phase === "waiting") body = `<div class="big1"><div class="num">${esc(v.joined)}</div><p>players have joined</p><p class="meta">Waiting for the host to start. The draw is sealed: fingerprint <span class="mono">${esc((v.commit || "").slice(0, 16))}</span></p></div>`;
    else if (v.endedEarly) body = `<div class="big1"><p class="meta">Ended</p><div class="num">The organizer ended the tournament</div><p class="meta">Thank you for playing.</p></div>`;
    else if (v.champion) body = `<div class="big1"><p class="meta">Champion</p><div class="num champ">${esc(v.champion)}</div></div><h2>Results</h2>${ranking(v.ranking)}${v.final ? v.final.map(matchCard).join("") : ""}`;
    else {
      const pr = {}; (v.perRound || []).forEach((x) => { pr[x.round] = pr[x.round] || { live: 0, done: 0 }; pr[x.round][x.status === "live" ? "live" : "done"] += x.n; });
      body = `<p class="meta">${esc(v.players)} players &middot; ${esc(v.entrants)} ${v.format === "team" ? "teams" : "in the bracket"} &middot; ${esc(v.rounds)} ${Number(v.rounds) === 1 ? "round" : "rounds"} &middot; clock ${esc(v.moveSecs)} s${v.paused ? " &middot; <b>PAUSED</b>" : ""}</p>
        <div class="rounds">${(v.roundNames || []).map((n, i) => `<span class="${pr[i + 1] && pr[i + 1].live ? "on" : ""}">${esc(n)}: ${pr[i + 1] ? pr[i + 1].done + " done, " + pr[i + 1].live + " live" : "-"}</span>`).join("")}</div>
        <h2>Playing now</h2><div class="live">${(v.live || []).map(matchCard).join("") || "<p class='meta'>Starting...</p>"}</div>`;
    }
    const bd = info && info.brand && typeof info.brand === "object" ? info.brand : null, bLogo = bd && typeof bd.logo === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(bd.logo) ? bd.logo : ""; // the organizer's own logo and name, or ours in writing
    $app.innerHTML = `<header class="top"><span class="brand">${bLogo ? `<img class="blogo" alt="" src="${esc(bLogo)}"> ` : ""}${esc(bd && bd.name ? bd.name : "Corporate Tic Tac Toe")}</span><span class="meta">${v.state === "done" ? "Finished" : v.state === "running" ? "Live" : "Not started"}</span></header><main class="main1">${body}</main>
      <footer class="meta">Names only. Nothing else about you is shown. <a href="/legal.html#privacy">Privacy</a>${v.commit ? ` &middot; Draw fingerprint <span class="mono">${esc(v.commit.slice(0, 12))}</span>` : ""}</footer>`;
  }
  async function tick() {
    if (info === null) { try { info = await read("GET", `/api/z/${encodeURIComponent(EID)}/info`); } catch (e) { info = false; } } // the organizer's company name and logo (public)
    try { view = await watcher.view(); err = ""; skew = (view.serverNow || Date.now()) - Date.now(); }
    catch (e) { err = e.code === "cancelled" ? "This game was cancelled by the organizer." : e.code === "did-not-start" ? "This game did not start." : e.status === 402 ? "Waiting for the Organizer or Host to start the game." : e.status === 403 ? "This game is not open yet." : e.status === 404 ? "That game was not found." : "Connecting..."; }
    paint(); setTimeout(tick, view && view.state === "running" ? 2500 : 5000);
  }
  if (!EID) { $app.innerHTML = `<p class="msg">Open the link your organizer gave you.</p>`; return; }
  tick(); void page; void skew;
})();
