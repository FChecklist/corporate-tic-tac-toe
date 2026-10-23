/* Corporate Tic Tac Toe, Refer & earn. A sales partner's reference code is a random 8-character code; their unique link is /?ref=<code>.
   Anyone may join (a participant from their card, or anyone from this page). Nothing is shown to anyone but the partner themselves. */
(function () {
  const $app = document.getElementById("app"), $dash = document.getElementById("dash");
  const q = new URLSearchParams(location.search);
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  const api = async (method, path, body, key) => {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-partner": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong."), { status: r.status });
    return j;
  };
  const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const S = { linkToken: (/^[0-9a-f]{48}$/.test(q.get("t") || "") ? q.get("t") : ""), note: "", err: "", me: null, fresh: null , f: { ph: "", em: "", nm: "", ok: false }};

  function shareBlock(code, link) {
    const text = "Corporate Tic Tac Toe makes your company engagement unforgettable. Take a look: " + link;
    return `<div class="zlink" id="mylink">${esc(link)}</div>
      <p class="zsmall">Your code: <b>${esc(code)}</b>. Anyone who buys through your link is counted for you.</p>
      <button class="zbtn s" id="copy">Copy my link</button> <button class="zbtn s alt" id="nshare" style="display:none">Share&hellip;</button>
      <a class="zbtn s alt" style="display:inline-flex;align-items:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Share on WhatsApp</a>`;
  }
  /** what was typed on the sign-up form: kept when a mistake redraws it, so the person never has to type it all again */
  const rememberForm = () => { const g = (id) => { const e = document.getElementById(id); return e ? e.value : undefined; }; const ok = document.getElementById("ok"); S.f = { ph: g("ph") ?? S.f.ph, em: g("em") ?? S.f.em, nm: g("nm") ?? S.f.nm, ok: ok ? ok.checked : S.f.ok }; };
  function enrollView() {
    const fromCard = q.get("from") === "card";
    return `<div class="zcard zform"><h2>${fromCard ? "Start earning: get your link" : "Get your link in 20 seconds"}</h2>
        <label for="ph">Your mobile number</label><input id="ph" inputmode="tel" autocomplete="tel" placeholder="98765 43210" value="${esc(S.f.ph)}">
        <label for="em">Your e-mail (we send you a code)</label><input id="em" type="email" inputmode="email" autocomplete="email" placeholder="your e-mail" value="${esc(S.f.em)}">
        <label for="nm">Your name (optional)</label><input id="nm" autocomplete="name" maxlength="60" value="${esc(S.f.nm)}">
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;color:var(--ink);font-size:14px"><input type="checkbox" id="ok" style="width:auto;min-height:0;margin-top:3px"${S.f.ok ? " checked" : ""}> <span>I would like to join Refer &amp; earn with this mobile number.</span></label>
        ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
        <button class="zbtn" id="join">Get my link and start earning</button>
        <p class="zsmall">Already joined? <a href="#" id="signin">Sign in with your e-mail</a></p></div>`;
  }
  function codeView() {
    return `<div class="zcard zform"><h2>Check your e-mail</h2><p class="zsmall" style="margin-top:0">We emailed <b>${esc(S.email)}</b>. Type the 6-digit code here. It works for 10 minutes.</p>
      <label for="cd">6-digit code</label><input id="cd" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
      ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
      <button class="zbtn" id="cdgo">Get my link</button>
      <p class="zsmall"><a href="#" id="back">Back</a></p></div>`;
  }
  const twoWays = `<div class="zbanner info" style="text-align:left"><b>Option 1.</b> Go to your e-mail, find the 6 numbers and type them here.<br><b>Option 2.</b> Go to your e-mail and tap the button <b>Sign me in</b>. You do not type anything.<br>Use only one. Both work for 10 minutes.</div>`;
  function signinView() {
    return `<div class="zcard zform"><h2>Sign in to see your sales</h2>
      <p class="zsmall" style="margin-top:0">Type your e-mail and press Continue. There is no password. We e-mail you two ways in; you use <b>one</b> of them.</p>
      <label for="se">Your e-mail</label><input id="se" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="your e-mail" value="${esc(S.email || "")}">
      ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
      <button class="zbtn" id="sgo">Continue</button>
      <p class="zsmall"><a href="#" id="back">Back</a></p></div>`;
  }
  function signinCodeView() {
    return `<div class="zcard zform"><h2>Now open your e-mail</h2><p class="zsmall" style="margin-top:0">We sent an e-mail to <b>${esc(S.email)}</b>. Pick <b>one</b> of these two ways.</p>${twoWays}
      ${S.dev ? `<div class="zbanner info">Local test mode: your code is <b>${esc(S.dev)}</b> <button class="zbtn s" id="suse" type="button">Use this code</button></div>` : ""}
      <label for="scd">Option 1: type your 6-digit code here</label><input id="scd" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
      ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}
      <button class="zbtn" id="scdgo">Submit</button> <button class="zbtn s alt" id="sresend" type="button">Send a new code</button>
      <p class="zsmall">Not there? Look in your spam or junk folder, or press Send a new code.</p><p class="zsmall"><a href="#" id="back2">Back</a></p></div>`;
  }
  function linkView() {
    return `<div class="zhead"><b>Corporate Games · Refer &amp; earn</b></div><div class="zcard zform"><h2>Press the button to sign in</h2><p class="zsmall" style="margin-top:0">This is Option 2 from your e-mail. It works once, for 10 minutes.</p>
      ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}<button class="zbtn" id="lgo">Sign me in</button><p class="zsmall">Something wrong? <a href="/partner.html">Ask for a new e-mail</a>.</p></div>`;
  }
  function dashView() {
    const m = S.me; const t = m.totals;
    const fresh = S.fresh ? `<div class="zbanner ok">You are in. You stay signed in on this phone or laptop. On another device, or if you ever sign out, just sign in with your e-mail again: nothing to remember.</div>` : "";
    const rows = m.sales.length ? `<table><tr><th>Date</th><th>Pack</th><th>Status</th><th>Commission</th></tr>${m.sales.map((s) => `<tr><td>${day(s.date)}</td><td>${s.pack ? "up to " + s.pack : "-"}</td><td>${statusText(s)}</td><td>${s.amount === null ? "to be announced" : inr(s.amount)}</td></tr>`).join("")}</table>` : `<p class="zsmall" style="margin:0">No sales yet. Share your link to get started.</p>`;
    return `<div class="zhead"><b>Corporate Tic Tac Toe · Refer &amp; earn</b><button class="zsnd" id="out">Sign out</button></div>${fresh}
      ${m.state !== "active" ? `<div class="zbanner warn">Your partner account is paused. Please contact us.</div>` : ""}
      <div class="zcard"><h2>Your link</h2>${shareBlock(m.code, m.link)}</div>
      <div class="zgrid"><div class="zcard"><h2>Sales</h2><div class="zstat">${t.sales}</div></div><div class="zcard"><h2>Earned so far</h2><div class="zstat">${inr(t.accruedInr + t.paidInr)}</div><p class="zsmall" style="margin:4px 0 0">${t.paidInr ? inr(t.paidInr) + " paid" : "None paid yet"}</p></div></div>
      ${!m.rateAnnounced && t.waitingForRate ? `<div class="zbanner info">${t.waitingForRate} sale${t.waitingForRate === 1 ? " is" : "s are"} counted for you. The commission will be announced soon and applied to them.</div>` : ""}
      <div class="zcard"><h2>Your sales</h2>${rows}<p class="zsmall">A person who opens your link counts for ${m.attributionDays} days. Buyers' details are never shown.</p></div>
      <p class="zsmall"><a href="#" id="pclose">Close my partner account</a></p>`;
  }
  const statusText = (s) => ({ pending_rate: "Counted", accrued: "Earned", paid: "Paid", blocked: "Not counted (own purchase)", void: "Cancelled" }[s.status] || s.status);

  function draw(v, dash) { document.body.classList.toggle("signed", !!dash); (dash ? $dash : $app).innerHTML = v; if (dash) $app.innerHTML = ""; bind(); }
  function bind() {
    const $ = (id) => document.getElementById(id);
    if ($("nshare") && navigator.share) { $("nshare").style.display = ""; $("nshare").onclick = () => navigator.share({ title: "Corporate Tic Tac Toe", text: "Corporate Tic Tac Toe makes your company engagement unforgettable. Take a look:", url: document.getElementById("mylink").textContent }).catch(() => {}); }
    if ($("copy")) $("copy").onclick = () => { try { navigator.clipboard.writeText(document.getElementById("mylink").textContent); $("copy").textContent = "Copied"; } catch {} };
    if ($("join")) $("join").onclick = async () => {
      S.err = ""; rememberForm();
      if (!$("ok") || !$("ok").checked) { S.err = "Please tick the box to join."; return draw(enrollView()); }
      $("join").disabled = true;
      try {
        S.email = $("em").value.trim();
        await api("POST", "/api/partner/enroll", { phone: $("ph").value, email: S.email, name: $("nm").value.trim(), consent: true, source: q.get("from") === "card" ? "card" : "direct" });
        draw(codeView());
      } catch (e) { S.err = e.message; draw(enrollView()); }
    };
    if ($("cdgo")) $("cdgo").onclick = async () => {
      S.err = ""; $("cdgo").disabled = true;
      try { const r = await api("POST", "/api/partner/enroll/verify", { email: S.email, code: $("cd").value }); ls.set("cbz-pkey", r.partnerKey); S.fresh = r.partnerKey; await load(); }
      catch (e) { S.err = e.message; draw(codeView()); }
    };
    if ($("signin")) $("signin").onclick = (e) => { e.preventDefault(); S.err = ""; draw(signinView()); };
    if ($("back")) $("back").onclick = (e) => { e.preventDefault(); S.err = ""; draw(enrollView()); };
    if ($("sgo")) $("sgo").onclick = async () => {
      S.err = ""; S.email = $("se").value.trim(); $("sgo").disabled = true;
      try { const r = await api("POST", "/api/partner/signin", { email: S.email }); S.dev = r.devCode || ""; draw(signinCodeView()); }
      catch (e) { S.err = e.message; draw(signinView()); }
    };
    const verifyCode = async () => { S.err = ""; try { const r = await api("POST", "/api/partner/signin/verify", { email: S.email, code: $("scd").value }); ls.set("cbz-pkey", r.partnerKey); S.fresh = null; S.dev = ""; await load(); } catch (e) { S.err = e.message; draw(signinCodeView()); } };
    if ($("scdgo")) $("scdgo").onclick = verifyCode;
    if ($("suse")) $("suse").onclick = () => { $("scd").value = S.dev; verifyCode(); };
    if ($("sresend")) $("sresend").onclick = async () => { try { const r = await api("POST", "/api/partner/signin", { email: S.email }); S.dev = r.devCode || ""; S.err = ""; draw(signinCodeView()); } catch (e) { S.err = e.message; draw(signinCodeView()); } };
    if ($("back2")) $("back2").onclick = (e) => { e.preventDefault(); S.err = ""; draw(signinView()); };
    if ($("lgo")) $("lgo").onclick = async () => {
      $("lgo").disabled = true;
      try { const r = await api("POST", "/api/partner/signin/link", { token: S.linkToken }); ls.set("cbz-pkey", r.partnerKey); history.replaceState(null, "", location.pathname); S.linkToken = ""; await load(); }
      catch (e) { S.err = e.message; draw(linkView()); }
    };
    if ($("pclose")) $("pclose").onclick = async (e) => { e.preventDefault(); if (!confirm("Close your partner account? Your details are deleted. We keep billing data for audit and tax reasons.")) return; try { await api("POST", "/api/partner/close", {}, ls.get("cbz-pkey")); } catch (er) { S.err = er.message; return; } ls.del("cbz-pkey"); S.me = null; S.fresh = null; $dash.innerHTML = ""; draw(enrollView()); };
    if ($("out")) $("out").onclick = () => { ls.del("cbz-pkey"); S.me = null; S.fresh = null; $dash.innerHTML = ""; draw(enrollView()); };
  }
  async function load() {
    if (S.linkToken) return draw(linkView());
    const k = ls.get("cbz-pkey");
    if (!k) return draw(enrollView());
    try { S.me = await api("GET", "/api/partner/me", undefined, k); draw(dashView(), true); }
    catch (e) { if (e.status === 403) { ls.del("cbz-pkey"); draw(enrollView()); } else { $app.innerHTML = `<p class="zmsg">${esc(e.message)}</p>`; } }
  }
  
  // ---------- earnings table and calculator (prices come from the same list the checkout uses) ----------
  const RATE = 0.5, packs = (window.TB && window.TB.PACKS) || [];
  const money = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const usd = (n) => "US$ " + Number(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const both = (p, f = 1) => money(p[1] * f) + " / " + usd(p[2] * f); // rupees and US dollars side by side
  const table = document.getElementById("earn-table");
  if (table && packs.length) {
    table.innerHTML = `<div class="rrow rh" role="row"><span>Pack</span><span>Software price</span><span>You earn, first purchase (50%)</span></div>` + packs.map((p, i) => `<div class="rrow${i === 2 ? " hot" : ""}" role="row"><span>Up to <b>${p[0].toLocaleString("en-IN")}</b> people</span><span>${both(p)}</span><span><b class="e">${both(p, RATE)}</b> per sale</span></div>`).join("");
    const top = document.getElementById("top-earn"); if (top) top.textContent = money(Math.floor(packs[packs.length - 1][1] * RATE)) + " / " + usd(Math.floor(packs[packs.length - 1][2] * RATE));
    const sel = document.getElementById("calc-pack"), n = document.getElementById("calc-n"), out = document.getElementById("calc-out"), nv = document.getElementById("calc-nv");
    sel.innerHTML = packs.map((p, i) => `<option value="${i}"${i === 2 ? " selected" : ""}>Up to ${p[0].toLocaleString("en-IN")} people (${both(p)})</option>`).join("");
    const calc = () => { nv.textContent = n.value; const k = Number(n.value) * RATE, pk = packs[Number(sel.value)]; out.textContent = money(k * pk[1]) + " / " + usd(k * pk[2]); };
    sel.onchange = calc; n.oninput = calc; calc();
  }
  // the sticky "get my link" bar steps aside while the form (or the last call to action) is on screen
  try {
    const bar = document.querySelector(".rsticky"), watch = [document.getElementById("join"), document.querySelector(".rfinal")].filter(Boolean), seen = new Set();
    if (bar && "IntersectionObserver" in window) { const io = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); bar.classList.toggle("off", seen.size > 0); }); watch.forEach((w) => io.observe(w)); }
  } catch {}
  load();
})();
