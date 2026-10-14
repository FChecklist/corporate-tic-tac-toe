/* Corporate Tic Tac Toe, run the tournament (host.html). For the Organizer or a Host: see who joined, choose the format and the move clock, start, pause, resume, and open the big screen.
   The page holds the sign-in key only in this tab's session (it comes from the console: zc.html?e=...). Nothing here changes a draw: the host cannot pick a bracket, a starter or a winner.
   While this page is open it does the Organizer's part of the computing (tttgame.js): it computes the draw from the sealed seed and sends it to the mailbox, looks after boards where both players are away,
   and sends the final ranking. A board whose two reports differ is listed here for the Organizer to settle. */
(function () {
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const EID = (q.get("e") || "").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } } };
  let key = ss.get("cbz-org") || "";
  { const k = q.get("k"); if (k && /^cb[a-z]_[0-9a-f]{48}$/.test(k)) { key = k; ss.set("cbz-org", k); history.replaceState(null, "", location.pathname + "?e=" + encodeURIComponent(EID)); } }
  const S = { format: "solo", teamSize: 3, moveSecs: 20, msg: "", view: null, disputed: [] };
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-organizer": key }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "http " + r.status), { status: r.status, code: j.code });
    return j;
  };
  const con = window.TTT ? new window.TTT.TttConsole((m, p, b) => call(m, p, b), EID) : null;
  const chips = (name, opts, cur) => `<div class="hchips" role="group" aria-label="${name}">${opts.map((o) => `<button class="hchip" data-k="${name}" data-v="${o[0]}" aria-pressed="${String(cur) === String(o[0])}">${esc(o[1])}</button>`).join("")}</div>`;
  const links = () => { const o = location.origin; return `<p class="zsmall">Player link: <span class="mono">${esc(o)}/z.html?e=${esc(EID)}</span><br>Big screen: <a href="/big.html?e=${encodeURIComponent(EID)}" target="_blank" rel="noopener">${esc(o)}/big.html?e=${esc(EID)}</a></p>`; };
  function paint() {
    const v = S.view; if (!v) { $app.innerHTML = `<p class="zmsg">${esc(S.msg || "Loading...")}</p>`; return; }
    let body = "";
    if (v.state === "open") {
      body = `<div class="zcard"><h2>Before the start</h2><p><b>${esc(v.joined)}</b> players have joined. Share the player link; the list closes when you press Start.</p>${links()}</div>
        <div class="zcard"><h2>Format</h2>${chips("format", [["solo", "One against one"], ["team", "Team against team"]], S.format)}
        ${S.format === "team" ? `<p class="zsmall">A team has 3 or 5 players. Players left over (fewer than a full team) only watch.</p>${chips("teamSize", [[3, "Teams of 3"], [5, "Teams of 5"]], S.teamSize)}` : ""}
        <h2>Move clock</h2>${chips("moveSecs", [[10, "10 s"], [20, "20 s"], [30, "30 s"], [60, "60 s"]], S.moveSecs)}
        <p class="zsmall">If a player's clock runs out, a square is played for them. Two clock-outs in a row lose the board. A drawn game is replayed with the marks swapped, up to 3 games, then fate decides.</p>
        <button class="zbtn" id="start">Start the tournament</button></div>`;
    } else {
      body = `<div class="zcard"><h2>${v.state === "done" ? (v.endedEarly ? "Ended" : "Finished") : v.paused ? "Paused" : "Running"}</h2><p>${esc(v.players || v.joined)} players &middot; ${esc(v.rounds || "")} ${Number(v.rounds) === 1 ? "round" : "rounds"}</p>${v.champion ? `<p>Champion: <b>${esc(v.champion)}</b></p>` : ""}${links()}
        ${v.state === "running" ? `<div class="hrow">${v.paused ? `<button class="zbtn" id="resume">Resume</button>` : `<button class="zbtn" id="pause">Pause for everyone</button>`}</div><p class="zsmall">While paused no clock runs and nobody can move. After Resume every clock has the same time left.</p><div class="hrow"><button class="zbtn" id="end">End the tournament</button></div><p class="zsmall">Ends it for everybody now. Nobody is ranked and this cannot be undone.</p>` : ""}</div>
        ${S.disputed.length ? `<div class="zcard"><h2>Boards to settle</h2><p class="zsmall">These boards are waiting for you: the two players reported different winners, or nobody has played them for a long time. Pick the winner.</p>${S.disputed.map((d) => `<p>${esc(d.a.name)} vs ${esc(d.b.name)} <button class="hchip" data-settle="${esc(d.mid)}|${d.j}|${esc(d.a.pid)}">${esc(d.a.name)} won</button> <button class="hchip" data-settle="${esc(d.mid)}|${d.j}|${esc(d.b.pid)}">${esc(d.b.name)} won</button></p>`).join("")}</div>` : ""}
        <div class="zcard"><h2>Check the draw</h2><p class="zsmall">Fingerprint (shown before anybody joined): <span class="mono">${esc((v.commit || "").slice(0, 32))}</span></p><p class="zsmall"><a href="${esc(BASE)}/api/z/${esc(EID)}/ttt/reveal" target="_blank" rel="noopener">Show the secret and the seed</a>. The code that re-computes the bracket is open to an auditor.</p></div>`;
    }
    $app.innerHTML = `<div class="zhead"><b>Corporate Tic Tac Toe</b><span class="zsmall">${esc(EID)}</span></div>${S.msg ? `<div class="zbanner warn" role="alert">${esc(S.msg)}</div>` : ""}${body}`;
    document.querySelectorAll(".hchip").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.k, val = b.dataset.v; S[k] = k === "format" ? val : Number(val); paint(); }));
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    on("start", async () => { if (!confirm("Start now? The list of players closes and cannot be changed.")) return; try { await call("POST", `/api/z/${EID}/ttt/start`, { format: S.format, teamSize: S.teamSize, moveSecs: S.moveSecs }); S.msg = ""; } catch (e) { S.msg = e.message; } load(); });
    document.querySelectorAll("[data-settle]").forEach((b) => b.addEventListener("click", async () => { const [mid, j, winner] = b.dataset.settle.split("|"); try { await call("POST", `/api/z/${EID}/ttt/settle`, { mid, j: Number(j), winner }); S.msg = ""; } catch (e) { S.msg = e.message; } load(); }));
    on("pause", async () => { try { await call("POST", `/api/z/${EID}/ttt/pause`, {}); S.msg = ""; } catch (e) { S.msg = e.message; } load(); });
    on("resume", async () => { try { await call("POST", `/api/z/${EID}/ttt/resume`, {}); S.msg = ""; } catch (e) { S.msg = e.message; } load(); });
    on("end", async () => { if (!confirm("End the tournament for everybody now? Nobody is ranked and this cannot be undone.")) return; try { await call("POST", `/api/z/${EID}/ttt/end`, {}); S.msg = ""; } catch (e) { S.msg = e.message; } load(); });
  }
  async function load() {
    try { S.view = await (await fetch(BASE + `/api/z/${EID}/ttt/view`, { cache: "no-store" })).json(); } catch (e) { S.msg = "Connecting..."; }
    try { if (con && S.view && S.view.state !== "open" && S.view.state !== "done") { await con.tick(); S.n = (S.n || 0) + 1; if (S.n % 5 === 1) S.disputed = [...(S.view.disputed ? await con.disputed() : []), ...(await con.waiting())]; } } catch (e) { /* the next look tries again */ }
    paint();
  }
  if (!EID) { $app.innerHTML = `<p class="zmsg">Open this page from your console.</p>`; return; }
  if (!key) { $app.innerHTML = `<div class="zcard"><h2>Sign in first</h2><p>Open your console, then choose "Run the tournament".</p><a class="zbtn" href="/zc.html?e=${encodeURIComponent(EID)}">Open the console</a></div>`; return; }
  load(); setInterval(load, 4000);
})();
