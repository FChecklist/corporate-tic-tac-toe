/* Corporate Tic Tac Toe, Help Desk. A Refer & earn partner prepares games for an Organizer; the Organizer publishes with one tap (docs/HELPDESK_SPEC.md).
   The page uses the partner key of Refer & earn (kept on this device, like on the Refer & earn page). The helper's own console and AI link come from the server and only for an active client. */
(function () {
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  const api = async (method, path, body) => {
    const key = ls.get("cbz-pkey") || "";
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-partner": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status });
    return j;
  };
  const S = { me: null, err: "", note: "" };
  const STATE = { invited: "Waiting for the Organizer to allow", active: "Active", stopped: "Stopped" };
  const HOST = { none: "You become a Host when the Organizer publishes a game.", "waiting-for-setup": "Your Host link was e-mailed to you. Open it to finish your setup.", ready: "You are a Host.", ended: "" };

  const signInView = () => `<div class="zcard zform"><h2>Become a Help Desk person</h2>
    <p class="zsmall" style="margin-top:0">Help Desk is a switch on your Refer &amp; earn account.</p>
    <p><a class="zbtn" style="display:inline-flex;align-items:center;text-decoration:none" href="/partner.html#joinbox">Join Refer &amp; earn first</a></p>
    <label for="pk">Already joined? Your partner key</label><input id="pk" type="password" autocomplete="off" placeholder="cbp_…">
    ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
    <button class="zbtn" id="go">Continue</button></div>`;
  const joinView = () => `<div class="zcard zform"><h2>Turn on Help Desk</h2>
    <label for="em">The e-mail you joined Refer &amp; earn with</label><input id="em" type="email" inputmode="email" autocomplete="email" placeholder="your e-mail">
    ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
    <button class="zbtn" id="on">Turn on Help Desk</button>
    <p class="zsmall"><a href="#" class="hdl" id="out">Sign out</a></p></div>`;
  const gameRow = (c, g) => `<div class="zsmall" style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:6px 0"><span><b>${esc(g.title || g.eid)}</b> <span style="color:#5b6577">${g.published ? "Published" : "Not published yet"}</span></span>
    ${g.published ? "" : `<button class="zbtn s" data-ask="${esc(g.eid)}" data-link="${esc(c.id)}">Ask the Organizer to publish</button>`}</div>`;
  const clientCard = (c) => `<div class="zcard" data-client="${esc(c.id)}"><div class="zsmall" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(c.orgEmailMasked)}</b><span>${esc(STATE[c.state] || c.state)}</span></div>
    ${c.state === "active" ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"><a class="zbtn s" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="${esc(c.consoleUrl)}">Open console</a><button class="zbtn s alt" data-copy="${esc(c.aiLink)}">Copy my AI link</button></div>
      ${c.games.length ? c.games.map((g) => gameRow(c, g)).join("") : `<p class="zsmall">No game yet. Open the console to create one.</p>`}
      ${HOST[c.hostLink] ? `<p class="zsmall">${esc(HOST[c.hostLink])}</p>` : ""}` : ""}
    ${c.state === "stopped" && c.games.length ? c.games.map((g) => `<p class="zsmall" style="margin:4px 0">${esc(g.title || g.eid)}: ${g.published ? "Published" : "Not published"}</p>`).join("") : ""}
    ${c.state !== "stopped" ? `<p class="zsmall" style="margin:8px 0 0"><a href="#" class="hdl" data-stop="${esc(c.id)}">${c.state === "invited" ? "Cancel this invitation" : "End this for me"}</a></p>` : ""}</div>`;
  const dashView = () => {
    const m = S.me;
    return `<p class="zsmall" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 6px"><b>Corporate Tic Tac Toe · Help Desk</b><a href="#" class="hdl" id="out">Sign out</a></p>
      ${S.note ? `<div class="zbanner ok" role="status">${esc(S.note)}</div>` : ""}${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
      <div class="zcard zform"><h2>Add an Organizer</h2><p class="zsmall" style="margin-top:0">We e-mail them a short note. Nothing is published or paid without their OK.</p>
        <label for="oe">Their e-mail</label><input id="oe" type="email" inputmode="email" autocomplete="off" placeholder="the organizer's e-mail">
        <label for="on">Their name (optional)</label><input id="on" maxlength="60" autocomplete="off">
        <button class="zbtn" id="inv">Send the invitation</button></div>
      ${m.clients.length ? m.clients.map(clientCard).join("") : `<div class="zcard"><p class="zsmall" style="margin:0">No clients yet. Add an Organizer above.</p></div>`}
      <p class="zsmall"><a class="hdl" href="/partner.html">See my earnings</a></p>`;
  };
  function draw(v) { $app.innerHTML = v; bind(); }
  function bind() {
    const $ = (id) => document.getElementById(id);
    const run = async (btn, fn) => { if (btn) btn.disabled = true; S.err = ""; S.note = ""; try { await fn(); } catch (e) { S.err = e.message; } await load(); };
    if ($("go")) $("go").onclick = async () => { const k = $("pk").value.trim(); try { ls.set("cbz-pkey", k); await api("GET", "/api/partner/me"); S.err = ""; await load(); } catch (e) { ls.del("cbz-pkey"); S.err = e.status === 403 ? "That key was not recognised." : e.message; draw(signInView()); } };
    if ($("on")) $("on").onclick = () => run($("on"), async () => { await api("POST", "/api/helpdesk/join", { email: $("em").value.trim() }); S.note = "Help Desk is on."; });
    if ($("out")) $("out").onclick = (e) => { e.preventDefault(); ls.del("cbz-pkey"); S.me = null; S.err = ""; S.note = ""; draw(signInView()); };
    if ($("inv")) $("inv").onclick = () => run($("inv"), async () => { await api("POST", "/api/helpdesk/invite", { email: $("oe").value.trim(), name: $("on").value.trim() }); S.note = "The invitation is on its way."; });
    $app.querySelectorAll("[data-ask]").forEach((b) => (b.onclick = () => run(b, async () => { await api("POST", "/api/helpdesk/request-publish", { linkId: b.dataset.link, eid: b.dataset.ask }); S.note = "We e-mailed the Organizer. They publish with one tap."; })));
    $app.querySelectorAll("[data-stop]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (!confirm("End this? Your access to this Organizer's account stops at once.")) return; run(null, async () => { await api("POST", "/api/helpdesk/stop", { linkId: a.dataset.stop }); S.note = "Done."; }); }));
    $app.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch { b.textContent = "Select and copy it from the console"; } }));
  }
  async function load() {
    if (!ls.get("cbz-pkey")) return draw(signInView());
    try {
      S.me = await api("GET", "/api/helpdesk/me");
      draw(S.me.joined ? dashView() : joinView());
    } catch (e) {
      if (e.status === 403) { ls.del("cbz-pkey"); S.me = null; draw(signInView()); } else { $app.innerHTML = `<p class="zmsg">${esc(e.message)}</p>`; }
    }
  }
  load();
})();
