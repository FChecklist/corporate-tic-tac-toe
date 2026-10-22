/* The one-tap publish page for a game a Help Desk helper prepared (docs/HELPDESK_SPEC.md). The token is in the address of the e-mailed link and leaves the address bar at once.
   The e-mail is the proof (same trust as the sign-in link). The Organizer reads the summary, confirms their e-mail and mobile number, ticks the Terms boxes (the same K1 boxes as the console) and taps Publish.
   The page then publishes through the game's own publish route with a key that works for 30 minutes, and tells the server it is done. */
(() => {
  const app = document.getElementById("app");
  const q = new URLSearchParams(location.search), t = q.get("t") || "";
  try { history.replaceState(null, "", location.pathname); } catch {}
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TB = window.TermsBox;
  let info = null, msg = "", form = { email: "", phone: "" };
  async function api(method, path, body, key) {
    const r = await fetch(path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || "Something went wrong. Please try again."); e.status = r.status; e.code = j.code; throw e; }
    return j;
  }
  const shell = (inner) => { app.innerHTML = `<div class="zhead"><h1 class="hdh"><b>Corporate Tic Tac Toe · Publish your game</b></h1></div>${inner}`; };
  const closed = (text) => shell(`<div class="zcard"><h2>Publish your game</h2><p>${esc(text)}</p><p class="zsmall"><a class="hdl" href="/">Corporate Tic Tac Toe home</a></p></div>`);
  const prizeLine = (r) => `<li>${esc(r.label || r.pattern || "Prize")}${r.ordinal > 1 ? " (" + esc(r.ordinal) + ")" : ""}${r.text ? ": " + esc(r.text) : ""}</li>`;
  function summaryCard() {
    const s = info.summary;
    if (!s) return `<p class="zsmall">Game ${esc(info.eid)}</p>`;
    const rewards = Array.isArray(s.rewards) ? s.rewards.filter((r) => r && (r.label || r.pattern || r.text)) : [];
    return `<div class="zsmall" style="line-height:1.6"><b>${esc(s.name || info.eid)}</b><br>Starts: ${esc(s.startsAtIST || "")}<br>Up to ${esc(s.limit)} people${s.tickets ? ", " + esc(s.tickets) + " ticket" + (s.tickets === 1 ? "" : "s") + " each" : ""}${s.rounds ? ", " + esc(s.rounds) + " round" + (s.rounds === 1 ? "" : "s") : ""}${s.gameMinutes ? ", about " + esc(s.gameMinutes) + " minutes" : ""}<br>Who can join: ${s.whoCanJoin === "list" ? "only people on your list" : "anyone with the link"}${s.breaks ? "<br>Brand moments: " + esc(s.breaks) : ""}${s.priceInr ? "<br>Price when you pay: Rs " + esc(s.priceInr) : ""}</div>
      ${rewards.length ? `<div class="zsmall" style="margin-top:8px"><b>Prizes</b></div><ul class="zsmall" style="margin:4px 0 0;padding-left:20px">${rewards.map(prizeLine).join("")}</ul>` : ""}`;
  }
  function view() {
    shell(`<div class="zcard zform"><h2>${esc(info.helperName)} asks you to publish this game</h2>${summaryCard()}
      <p class="zsmall">Publishing is free. After that the game does not begin until it is paid for. Only you publish and pay.</p>
      <label for="em">Confirm your e-mail</label><input id="em" type="email" autocomplete="email" value="${esc(form.email)}" placeholder="your e-mail">
      <label for="ph">Confirm your mobile number</label><input id="ph" inputmode="tel" autocomplete="tel" value="${esc(form.phone)}" placeholder="98765 43210">
      <div class="tbslot" id="hdtb"></div>${msg ? `<div class="zbanner bad" role="alert">${esc(msg)}</div>` : ""}
      <button class="zbtn" id="pub" disabled>Publish</button></div>`);
    let tb = null; if (TB) TB.mount(document.getElementById("hdtb"), "K1", { base: "", btn: document.getElementById("pub") }).then((t) => { tb = t; });
    document.getElementById("pub").onclick = async (ev) => {
      const b = ev.target; form = { email: document.getElementById("em").value.trim(), phone: document.getElementById("ph").value.trim() };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) { msg = "Please enter a valid e-mail."; return view(); }
      if (form.phone.replace(/\D/g, "").length < 10) { msg = "Please enter your mobile number."; return view(); }
      b.disabled = true; msg = "";
      const consent = tb && tb.ok() ? tb.terms() : undefined;
      try {
        const s = await api("POST", "/api/helpdesk/approve/start", { t });
        const pub = await api("POST", `/api/z/${encodeURIComponent(info.eid)}/publish`, { email: form.email, phone: form.phone, consent }, s.key);
        await api("POST", "/api/helpdesk/approve/done", { t });
        published(pub);
      } catch (e) { msg = e.status === 410 ? "This link has already been used or has expired." : e.message; view(); }
    };
  }
  function published(pub) {
    shell(`<div class="zcard"><h2>Published</h2><p>Your game is live. ${esc(info.helperName)} is now a Host of it and can change it like any Host.</p>
      ${pub && pub.shareUrl ? `<p class="zsmall">Share link for guests:</p><div class="zlink">${esc(pub.shareUrl)}</div>` : ""}
      ${pub && pub.payUrl && pub.paid === false ? `<p class="zsmall">The game begins once it is paid for. <a class="hdl" href="${esc(pub.payUrl)}">Pay now</a></p>` : ""}
      <p class="zsmall"><a class="hdl" href="/zc.html">Open my console</a></p></div>`);
  }
  (async () => {
    if (!/^[0-9a-f]{48}$/.test(t)) return closed("This link is incomplete. Please open the link from the e-mail again.");
    try { info = await api("GET", "/api/helpdesk/approve/info?t=" + t); }
    catch (e) { return closed(e.status === 404 ? "This link is not valid." : e.status === 410 ? "This link has already been used, has expired, or has been stopped." : e.message); }
    if (info.state === "published") { try { await api("POST", "/api/helpdesk/approve/done", { t }); } catch { /* already finished */ } return published(null); }
    view();
  })();
})();
