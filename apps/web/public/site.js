/* Corporate Tic Tac Toe public website: pricing, checkout, organizer login. Vanilla JS; needs common.js (window.TB). */
(function () {
  const $ = TB.$, esc = TB.esc, ic = TB.ic;
  const nf = (n) => Number(n).toLocaleString("en-IN");
  const S = { cur: TB.guessCurrency(), pack: 1000 };
  const FREE = { on: true, cap: 1e9 }; // the process: sign in, build the engagement, pay only when publishing
  let ORDER = null;

  // ---------- price display ----------
  function breakdown(pack, cur) {
    const x = TB.price(pack, cur);
    return cur === "INR"
      ? `<span>Total <b>${TB.money(x.total, "INR")}</b></span>`
      : `<span>Total <b>${TB.money(x.total, "USD")}</b></span><span>No tax added · billed in US dollars</span>`;
  }
  function renderPrices() {
    document.querySelectorAll("[data-cur]").forEach((el) => {
      el.innerHTML = ["INR", "USD"].map((k) => `<button type="button" class="${S.cur === k ? "on" : ""}" aria-pressed="${S.cur === k}" data-c="${k}">${k === "INR" ? "₹ INR" : "US$"}</button>`).join("");
    });
    $("pack").innerHTML = TB.PACKS.map(([n]) => `<option value="${n}" ${n === S.pack ? "selected" : ""}>Up to ${nf(n)} players</option>`).join("");
    if ($("heroBrk")) $("heroBrk").innerHTML = breakdown(S.pack, S.cur);
    { // one price card: the organizer picks the size, then sees the festive price (never a list of every pack)
      const n = S.pack, x = TB.price(n, S.cur), shown = S.cur === "INR" ? x.base : x.total, was = S.cur === "INR" ? shown * 2 + 1 : shown * 2; // "was" is the regular price that applies after the festive offer
      const opts = TB.PACKS.map(([k]) => `<option value="${k}" ${k === n ? "selected" : ""}>Up to ${nf(k)} players</option>`).join("");
      const perks = ["All features included", "Free AI assistant to build your game", "Bingo for your whole team, wherever they are", "Your message, video or audio between numbers", "Build it free, pay just before the game starts", "No fee to create or edit your game", "Guest names erased within 24 hours of the game", "One payment per game, no yearly plan"];
      $("packs").innerHTML = `<div class="pcard"><div class="pwho"><label for="pack2">How many players?</label><div class="selwrap"><select id="pack2" aria-label="Number of players">${opts}</select><svg class="ic chev"><use href="#i-chev"/></svg></div></div>` +
        `<div class="pmain"><div class="pburst" title="Festive offer: 50% off"><b>50% OFF</b><span>Festive offer</span><span class="sr">Festive offer: 50% off</span></div>` +
        `<div class="pamt"><span class="was" title="Regular price after the festive offer"><span class="sr">Regular price after the festive offer </span>${TB.money(was, S.cur)}</span>` +
        `<span class="tot"><small>Festive price</small> ${TB.money(shown, S.cur)}</span></div>` +
        `<button type="button" class="btn pcta" data-buy="${n}" aria-label="Create a game for up to ${nf(n)} players">Create your game ${ic("arrow")}</button></div>` +
        `<ul class="pperks">${perks.map((t) => `<li><span class="tick" aria-hidden="true">&#10003;</span>${t}</li>`).join("")}</ul></div>`;
    }
    if (FREE.on) { $("priceNote").textContent = "You build and publish your game for free. It does not begin until it is paid for. A late payment starts the first number 2 minutes after the payment is confirmed. " + (S.cur === "INR" ? "Prices in Indian rupees." : "Prices in US dollars."); return; }
    $("priceNote").textContent = S.cur === "INR" ? "Prices in Indian rupees. Billed in India." : "Prices in US dollars. Billed outside India.";
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]"); if (c) { S.cur = c.dataset.c; renderPrices(); if ($("ordSum")) sumRefresh(); return; }
    const b = e.target.closest("[data-buy]"); if (b) { S.pack = +b.dataset.buy; renderPrices(); openCheckout(S.pack); return; }
    if (e.target.closest("[data-close]")) TB.closeSheet();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") TB.closeSheet(); });
  $("pack").addEventListener("change", (e) => { S.pack = +e.target.value; renderPrices(); });
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "pack2") { S.pack = +e.target.value; renderPrices(); const f = $("pack2"); if (f) f.focus(); } });
  $("payBtn").addEventListener("click", () => openCheckout(S.pack));
  $("loginLink").addEventListener("click", (e) => { e.preventDefault(); openLogin(""); });

  // ---------- helpers ----------
  const xbtn = `<button type="button" class="xbtn" data-close aria-label="Close">${ic("x")}</button>`;
  const err = (t) => `<div class="err" role="alert">${ic("alert")}<span>${esc(t)}</span></div>`;
  const setErr = (t) => { $("fErr").innerHTML = t ? err(t) : ""; };
  const focusFirst = (id) => setTimeout(() => { const el = $(id); if (el) el.focus(); }, 60);
  // "Continue with Google": shown above the e-mail way only when the server has a Google client id (google.js); the e-mail code stays the other way
  const gBox = `<div id="gWrap" class="gwrap" hidden></div><p id="gOr" class="gor" hidden>or</p>`;
  const mountGoogle = (intent) => { const w = $("gWrap"); if (!w || !TB.google) return; TB.google.mount(w, { intent, getTerms: () => termsNow() || null, onDone: TB.google.finish, onError: (m) => { const f = $("fErr"); if (f) f.innerHTML = err(m); } }).then((shown) => { const o = $("gOr"); if (o && shown) o.hidden = false; }).catch(() => {}); };
  // Consent boxes (termsbox.js): the wording comes from the server, a box is never pre-ticked, the button stays disabled until every box is ticked, the ticks travel as consent: {version,boxes}.
  let TBX = null; // the boxes of the pop-up that is open now (K2 on the sign-in pop-ups, K3 on the checkout)
  const mountTerms = (group, slotId, btnId) => { TBX = null; const slot = $(slotId); if (!slot || !window.TermsBox) return; window.TermsBox.mount(slot, group, { base: "", onChange: (ok) => { const b = $(btnId); if (b) b.disabled = !ok; } }).then((t) => { TBX = t; }).catch(() => {}); };
  const termsNow = () => (TBX && TBX.ok() ? TBX.terms() : undefined);
  const termsLinks = `<p class="spriv accept"><a href="/terms.html" target="_blank" rel="noopener">Terms</a> · <a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy &amp; Data Policy</a></p>`;
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.dataset.l = btn.dataset.l || btn.innerHTML; btn.innerHTML = on ? label : btn.dataset.l || btn.innerHTML; }

  // ---------- checkout ----------
  function sumHTML(pack, cur) {
    const x = TB.price(pack, cur);
    return cur === "INR"
      ? `<div class="kv t"><span>Total</span><b>${TB.money(x.total, cur)}</b></div>`
      : `<div class="kv"><span>Price of Software</span><b>${TB.money(x.base, cur)}</b></div><div class="kv"><span>Tax</span><b>None added</b></div><div class="kv t"><span>Total</span><b>${TB.money(x.total, cur)}</b></div><p class="tiny muted" style="margin:0 0 10px">No tax added · billed in US dollars</p>`;
  }
  function sumRefresh() { $("ordSum").innerHTML = sumHTML(ORDER.pack, S.cur); }
  function taxField() {
    const c = $("oCty").value, india = c === "IN";
    $("taxBox").innerHTML = india
      ? `<input type="hidden" id="oGst" value="">`
      : `<label class="lb" for="oGst">Company tax / VAT number (optional)</label><input class="inp" id="oGst" maxlength="30" autocomplete="off" placeholder="Shown on your invoice">`;
    S.cur = india ? "INR" : "USD"; renderPrices(); sumRefresh();
  }
  function openCheckout(pack) {
    if (FREE.on) return openFree();
    ORDER = { pack };
    const def = TB.guessCountry();
    TB.sheet(`${xbtn}<div class="eyebrow">Your order</div><h2>Up to ${nf(pack)} players</h2>
      <ul class="facts"><li>${ic("ticket")}Every guest gets their own bingo card on their phone</li><li>${ic("phone")}Name only. No app to download, no password for guests</li><li>${ic("users")}A private game for your closed group, in any country</li><li>${ic("gift")}Players never pay. You give the prizes</li></ul>
      <div class="sum" id="ordSum"></div>
      <form id="coForm" novalidate>
        <label class="lb" for="oName">Organization name</label><input class="inp" id="oName" autocomplete="organization" placeholder="e.g. Acme Industries">
        <label class="lb" for="oMail">Your work email (invoice and login)</label><input class="inp" id="oMail" type="email" autocomplete="email" placeholder="you@company.com">
        <label class="lb" for="oPh">Your mobile number (optional)</label><input class="inp" id="oPh" type="tel" autocomplete="tel" placeholder="98765 43210">
        <label class="lb" for="oCty">Country of your organization</label><select class="inp" id="oCty">${TB.countryOpts(def)}</select>
        <div id="taxBox"></div><div id="fErr"></div><div id="tbSlot" class="tbslot"></div>
        <button class="btn block" style="margin-top:16px" type="submit" id="payGo" disabled>${ic("lock")} ${PAYMODE === "razorpay" ? "Pay securely with Razorpay" : PAYMODE === "off" ? "Payments are not switched on yet" : "Pay (local test payment)"}</button>
      </form>
      <p class="proto">${PAYMODE === "razorpay" ? "Secure payment by Razorpay. We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365. The organizer keeps the credit in their account. Once it has started, a paid game cannot be cancelled. Payment to <a href='https://itservices-rajat-agarwal.pages.dev/' rel='noopener' target='_blank'>IT Services by Rajat Agarwal</a>. An invoice is emailed to you." : "Local test payment: no real money is taken. Unused places are not credited."}</p>`);
    $("oCty").addEventListener("change", taxField);
    $("coForm").addEventListener("submit", (e) => { e.preventDefault(); pay(); });
    mountTerms("K3", "tbSlot", "payGo");
    taxField(); focusFirst("oName");
  }
  // ---------- refer & earn: remember who sent this visitor for 30 days (kept in this browser only) ----------
  const REF = (() => {
    try {
      const p = new URLSearchParams(location.search).get("ref"); const d = p && /^[A-Za-z2-9]{8}$/.test(p.trim()) ? p.trim().toUpperCase() : "";
      if (d) localStorage.setItem("cbz-ref", JSON.stringify({ code: d, at: Date.now() }));
      const v = JSON.parse(localStorage.getItem("cbz-ref") || "null");
      if (v && Date.now() - v.at < 30 * 86400000) return v.code;
      localStorage.removeItem("cbz-ref");
    } catch {}
    return "";
  })();
  if (REF) TB.api("GET", "/api/partner/check?code=" + REF).then((r) => { if (!r.valid) { try { localStorage.removeItem("cbz-ref"); } catch {} } }).catch(() => {});
  let PAYMODE = "test"; // razorpay | test | off, from the server
  TB.api("GET", "/api/payments/status").then((s) => { PAYMODE = s.mode; }).catch(() => {});
  // ---------- free launch: create an organizer account with a work email; the key arrives only through the e-mailed code ----------
  function openFree() {
    TB.sheet(`${xbtn}<div class="openfree" role="group" aria-labelledby="ofTitle">
      <div class="sheethead"><span class="rolepill">For the organizer or host</span><span class="sbrand" role="img" aria-label="Corporate Tic Tac Toe"><span class="mark"><svg class="ic" aria-hidden="true"><use href="#i-ticket"/></svg></span><span class="word">Corporate Tic Tac Toe<i>.</i></span></span></div>
      <div class="eyebrow ofeye">Build it and publish it free.</div><h2 id="ofTitle">Create your game</h2>
      <ul class="bgrid"><li><span class="bico">${ic("play")}</span><span>Add a message, video or lucky draw between calls</span></li><li><span class="bico">${ic("trophy")}</span><span>Pick your prizes: Line, Four Corners, X, Blackout</span></li><li><span class="bico">${ic("users")}</span><span>A closed-group Bingo for your company</span></li><li><span class="bico">${ic("ticket")}</span><span>Every card is unique: no two can ever match</span></li><li><span class="bico">${ic("phone")}</span><span>Each guest gets their own card on their phone</span></li><li><span class="bico">${ic("star")}</span><span>A free AI assistant sets it up for you</span></li><li><span class="bico">${ic("gift")}</span><span>Players never pay. You provide the prizes</span></li><li><span class="bico">${ic("trash")}</span><span>Guest names are erased within 24 hours of the game ending</span></li><li><span class="bico">${ic("shield")}</span><span>Designed to follow DPDP Act, GDPR and CCPA</span></li></ul>
      ${gBox}<form id="frForm" novalidate><label class="lb" for="fMail">Your email</label><input class="inp big" id="fMail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" aria-describedby="fErr"><div id="fErr" role="alert"></div>
      <div id="tbSlot" class="tbslot"></div>
      <button class="btn block big" style="margin-top:14px" type="submit" id="frGo" disabled>Create my game ${ic("arrow")}</button></form>
      <p class="trust">${ic("shield")}Free to build and publish. No password.</p>
      <p class="proto">Your console opens at once. We use your email for your invoice and to sign you in later.</p><p class="proto"><a href="/demo.html">Want to see it first? Try the free 70-second demo.</a></p>
      ${termsLinks}</div>`);
    mountTerms("K2", "tbSlot", "frGo");
    $("frForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const m = $("fMail").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) return setErr("Please enter a valid work email.");
      const t = termsNow(); if (!t) return setErr("Please tick the box to continue.");
      const b = $("frGo"); b.disabled = true; setErr("");
      try {
        const r = await TB.api("POST", "/api/start", { email: m, consent: t });
        if (r.exists) { TB.toast("You already have an account, so we are emailing you a code to confirm it is you"); return askCode(m, b); }
        try { sessionStorage.setItem("cbz-org", r.token); sessionStorage.setItem("cbz-aimsg", r.aiMessage); sessionStorage.setItem("cbz-email", m); } catch {}
        location.href = "/zc.html";
      } catch (x) { b.disabled = !(TBX && TBX.ok()); setErr(x.message); }
    });
    mountGoogle("signup");
    if (matchMedia("(min-width:700px)").matches) focusFirst("fMail"); else { const sh = document.getElementById("sheet"); if (sh) { sh.setAttribute("tabindex", "-1"); sh.focus({ preventScroll: true }); sh.scrollTop = 0; } } // on a phone the top of the pop-up stays in view; the keypad opens when the field is tapped
  }
  async function pay() {
    const org = $("oName").value.trim(), email = $("oMail").value.trim().toLowerCase(), country = $("oCty").value, taxId = $("oGst").value.trim().toUpperCase();
    if (org.length < 2) return setErr("Please enter your organization name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setErr("Please enter a valid work email.");
    setErr("");
    const terms = termsNow(); if (!terms) return setErr("Please tick the box to continue.");
    const btn = $("payGo"); btn.disabled = true; const keep = btn.innerHTML; btn.textContent = "Processing…";
    try {
      let r = await TB.api("POST", "/api/checkout", { consent: terms, org, email, country, taxId, pack: ORDER.pack, currency: S.cur, ref: (() => { try { const v = JSON.parse(localStorage.getItem("cbz-ref") || "null"); return v && Date.now() - v.at < 30 * 86400000 ? v.code : ""; } catch { return ""; } })(), phone: ($("oPh") ? $("oPh").value.trim() : "") });
      if (r.mode === "razorpay") r = await TB.pay(r.razorpay, r.paymentId, r.hop); // opens Razorpay Checkout; the server verifies the payment
      else if (r.result) r = Object.assign({ mode: r.mode }, r.result); // local test mode answers with the finished order
      ORDER = Object.assign(ORDER, { org, email, mode: r.mode }, r);
      done();
    } catch (e) { setErr(e.message); btn.disabled = false; btn.innerHTML = keep; }
  }
  function done() {
    const o = ORDER;
    TB.sheet(`${xbtn}<div class="res ok">${ic("check")}</div><h2 class="center">Your game is ready</h2>
      <div class="sum"><div class="kv"><span>Order</span><b class="mono">${esc(o.orderId)}</b></div><div class="kv"><span>Organization</span><b>${esc(o.org)}</b></div><div class="kv"><span>Players</span><b>Up to ${nf(o.pack)}</b></div><div class="kv t"><span>${o.mode === "test" ? "Paid (test)" : "Paid"}</span><b>${TB.money(o.total, o.currency)}</b></div>${o.invoiceNumber ? `<div class="kv"><span>Invoice</span><b class="mono"><a href="${esc(o.invoiceUrl)}" target="_blank" rel="noopener">${esc(o.invoiceNumber)}</a></b></div>` : ""}</div>
      ${o.organizerKey ? `<div class="note info" role="note"><b>Your organizer key</b> (shown only once, and we have emailed it to you):<div class="mono" id="orgKey" style="word-break:break-all;margin:6px 0">${esc(o.organizerKey)}</div><button class="btn sm" type="button" id="cpKey">Copy key</button></div>` : `<p class="small muted center">You already have an organizer key. Sign in with your work email to continue.</p>`}
      <p class="small muted center">Next step: open your console to set the date, pick your prizes and share the link. We sent the details and your invoice to <b>${esc(o.email)}</b>.</p>
      <div id="fErr"></div>
      <button class="btn block" id="toLogin" type="button">Open my console ${ic("arrow")}</button>`);
    const cp = $("cpKey"); if (cp) cp.addEventListener("click", () => { try { navigator.clipboard.writeText(o.organizerKey); TB.toast("Key copied"); } catch {} });
    $("toLogin").addEventListener("click", () => { if (o.organizerKey) { try { sessionStorage.setItem("cbz-org", o.organizerKey); } catch {} location.href = "/zc.html"; } else openLogin(o.email); });
  }

  // ---------- login ----------
  function openLogin(email) {
    TB.sheet(`${xbtn}<div class="eyebrow">Organizer login</div><h2>Sign in with your work email</h2><p class="muted small">Players never log in here. They join with your link. We email you a 6-digit code: no password.</p>
      ${gBox}<form id="lgForm" novalidate><label class="lb" for="lMail">Work email</label><input class="inp" id="lMail" type="email" autocomplete="email" placeholder="you@company.com" value="${esc(email || "")}"><div id="fErr"></div>
      <div id="tbSlot" class="tbslot"></div>
      <button class="btn block" style="margin-top:14px" type="submit" id="lgGo" disabled>Email me a code ${ic("arrow")}</button></form>
      ${termsLinks}`);
    mountTerms("K2", "tbSlot", "lgGo");
    $("lgForm").addEventListener("submit", (e) => { e.preventDefault(); const m = $("lMail").value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) return setErr("Please enter a valid work email."); if (!termsNow()) return setErr("Please tick the box to continue."); askCode(m, $("lgGo")); });
    mountGoogle("signin"); focusFirst("lMail");
  }
  async function askCode(email, btn) {
    if (btn) { btn.disabled = true; }
    try {
      const r = await TB.api("POST", "/api/auth/email", { email, consent: termsNow() });
      codeView(email, r.devCode);
    } catch (e) { if (btn) btn.disabled = !!(TBX && !TBX.ok()); const f = $("fErr"); if (f) f.innerHTML = err(e.message); else TB.toast(esc(e.message)); }
  }
  function codeView(email, devCode) {
    TB.sheet(`${xbtn}<div class="sheethead"><div class="eyebrow">Check your inbox</div><span class="sbrand" role="img" aria-label="Corporate Tic Tac Toe"><span class="mark"><svg class="ic" aria-hidden="true"><use href="#i-ticket"/></svg></span><span class="word">Corporate Tic Tac Toe<i>.</i></span></span></div>
      <h2 id="cdTitle">Check your email</h2>
      <p class="sheetbody">We emailed <b class="sendto">${esc(email)}</b>. Tap a button in the email, or type the 6-digit passcode here. It works for 10 minutes. Check spam too.</p>
      ${devCode ? `<div class="note info devcode" role="note"><span>Local test mode: your passcode is <b>${esc(devCode)}</b></span><button type="button" class="btn sm" id="useCode">Use this passcode</button></div>` : ""}
      <form id="cdForm" novalidate><label class="lb" for="lCode">6-digit passcode</label><input class="inp mono codein" id="lCode" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-describedby="fErr cdHelp" autocapitalize="off" spellcheck="false"><div id="fErr" role="alert"></div>
      <button class="btn block big" style="margin-top:14px" type="submit" id="cdGo">Sign in</button></form>
      <button class="btn line block big" style="margin-top:8px" type="button" id="resend">Send me a new code</button>
      <p class="sheethelp" id="cdHelp" role="status" aria-live="polite">Not there yet? Check spam, or send a new code.</p>`);
    const verify = async () => {
      const code = $("lCode").value.replace(/\D/g, "");
      if (code.length !== 6) return setErr("Enter the 6-digit passcode.");
      const b = $("cdGo"); b.disabled = true; setErr("");
      try {
        const r = await TB.api("POST", "/api/auth/verify", { email, code });
        try { sessionStorage.setItem("cbz-org", r.token); } catch {} let nx = "/zc.html"; try { const n = sessionStorage.getItem("cbz-next"); if (n && /^\/(zc|pay)(\.html)?(\?e=[A-Za-z0-9_-]{4,40})?$/.test(n)) nx = n; sessionStorage.removeItem("cbz-next"); } catch {} location.href = nx;
      } catch (e) { b.disabled = false; setErr(e.message); }
    };
    $("cdForm").addEventListener("submit", (e) => { e.preventDefault(); verify(); });
    $("resend").addEventListener("click", async () => { await askCode(email, $("resend")); TB.toast("A new code was sent"); });
    const u = $("useCode"); if (u) u.addEventListener("click", () => { $("lCode").value = devCode; verify(); });
    focusFirst("lCode");
  }

  // ---------- init ----------
  renderPrices();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let wi = 0; const tick = () => { const L = document.querySelectorAll("#whoL li"); L.forEach((l, i) => l.classList.toggle("on", i === wi % L.length)); wi++; };
    tick(); setInterval(tick, 1300);
    let bb = 0; setInterval(() => { bb = (bb + 2) % 102; const e = $("bbp"); if (e) e.style.setProperty("--p", bb + "%"); }, 200);
  }
  const hashLogin = () => { if (location.hash === "#login") openLogin(""); };
  window.addEventListener("hashchange", hashLogin); hashLogin();
})();

// ---------- small sticky bar: appears after scrolling; the brand returns to the top, the button jumps to the price card ----------
(function () {
  if (document.getElementById("topbar")) return;
  var bar = document.createElement("div");
  bar.id = "topbar"; bar.setAttribute("role", "navigation"); bar.setAttribute("aria-label", "Quick links"); bar.hidden = true;
  bar.innerHTML = '<button type="button" class="tb-brand" id="tbTop" aria-label="Back to the top"><span class="tb-mark" aria-hidden="true">&#9733;</span><b>Corporate Tic Tac Toe</b><span class="tb-up" aria-hidden="true">&#8593; Top</span></button>' +
    '<a class="tb-cta" id="tbBuy" href="#pricing">Create your game</a>';
  document.body.appendChild(bar);
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches, shown = false, tick = 0;
  function onScroll() {
    if (tick) return; tick = requestAnimationFrame(function () {
      tick = 0; var show = (window.scrollY || document.documentElement.scrollTop || 0) > 360;
      if (show !== shown) { shown = show; bar.hidden = !show; bar.classList.toggle("on", show); }
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  document.getElementById("tbTop").addEventListener("click", function () { window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });
  document.getElementById("tbBuy").addEventListener("click", function (e) {
    var t = document.getElementById("pricing"); if (!t) return; e.preventDefault();
    t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  });
})();
