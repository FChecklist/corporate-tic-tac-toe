/* Corporate Tic Tac Toe: the page behind a "payment link" (docs/ROLES_AND_CONSOLE_SPEC_2.md, item 13). Anyone who holds the link can open it, with no sign-in: it shows only the game's name,
   its date and the price, asks only for a name and an e-mail, and pays for THAT game and no other. The server decides the price and verifies the payment; nothing here writes anything else. */
(function () {
  const TB = window.TB, esc = TB.esc, $app = document.getElementById("app");
  let token = (TB.qs("t") || "").trim();
  if (token) { try { sessionStorage.setItem("cbz-pl", token); } catch {} } else { try { token = sessionStorage.getItem("cbz-pl") || ""; } catch {} } // a refresh of this tab still works
  if (!/^[0-9a-f]{48}$/.test(token)) token = ""; // anything else is not one of our links (and never goes into an address)
  try { history.replaceState(null, "", location.pathname); } catch {} // the secret leaves the address bar at once
  const S = { k3: {}, info: null, err: "", busy: false, done: null, gone: false, ...(() => { const v = TB.payer.load(); return { name: v.name || "", email: v.email || "", phone: v.phone || "", org: v.org || "", tax: v.tax || "" }; })(), pcode: "91", country: "IN", more: true };
  const call = async (method, path, body) => {
    let r;
    try { r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { const err = Object.assign(new Error("We could not reach the service. Please check your internet and try again."), { status: 0 }); if (window.CTG) { CTG.wrap(err, { what: method + " " + path.split("?")[0] }); if (method !== "GET") { err.guided = true; CTG.watch(err, { retry: () => call(method, path, body) }); } } throw err; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status, body: j }); if (window.CTG) { CTG.wrap(err, { what: method + " " + path.split("?")[0].replace(/\/[0-9a-f]{16,}/gi, "/...") }); if (method !== "GET") { err.guided = true; CTG.watch(err, { retry: () => call(method, path, body) }); } } throw err; }
    return j;
  };
  const head = `<div class="zhead"><b>Corporate Tic Tac Toe · Payment</b></div>${TB.payBrand ? TB.payBrand() : ""}`;
  const when = (ms) => { try { return new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const calm = (title, text) => `${head}<div class="zcard" role="status"><h2>${esc(title)}</h2><p class="zsmall" style="margin:0">${text}</p></div>`;

  function view() {
    if (!token || S.gone) return calm("This payment link is not working", "It may be incomplete or it may have been replaced. Please ask the person who sent it for a new link.");
    if (S.done) return `${head}<div class="zcard" role="status" style="border:2px solid #2e7d4f"><h2>Payment received. Thank you.</h2>${TB.payReceipt ? TB.payReceipt(S.done) : ""}<p class="zsmall" style="margin:0">The game is paid for. You can close this page.</p>${S.done.invoiceUrl ? `${TB.invoiceBox ? TB.invoiceBox(S.done, S.email) : ""}<p class="zsmall">We also e-mailed it to you and to the organizer.</p>` : `<p class="zsmall">We e-mail the invoice to the address you gave.</p>`}</div>`;
    if (!S.info) return `${head}<p class="zmsg">${S.err ? esc(S.err) : "Loading…"}</p>`;
    const i = S.info, st = i.status;
    if (st === "paid") return calm("This game is already paid for", "Nothing more is needed. You can close this page.");
    if (st === "expired") return calm("This payment link has run out", "A payment link works for 7 days. Please ask the person who sent it to make a new one.");
    if (st === "cancelled") return calm("This game was cancelled", "There is nothing to pay. Please speak to the organizer.");
    if (st === "closed") return calm("This game did not start", "This game did not start and is closed. There is nothing to pay. Please speak to the organizer.");
    if (st === "confirming" && !S.busy) return calm("Confirming a payment", "A payment for this game is being confirmed. Please wait a few minutes. If it goes through, this page will say the game is paid.");
    if (!i.price) return calm("A custom arrangement is needed", "A game this big is arranged with us directly. Please write to us from the contact page.");
    const p = i.price, cur = p.currency || "INR";
    const sum = cur === "INR"
      ? `<div class="zrow"><span><b>Total</b></span><em><b>${TB.money(p.total, "INR")}</b></em></div>`
      : `<div class="zrow"><span><b>Total</b></span><em><b>${TB.money(p.total, cur)}</b></em></div><p class="zsmall">No tax added.</p>`;
    return `${head}
      <div class="zcard"><h2>Payment</h2>
        <p class="pstmt">Payment is for Game <b>${esc(i.game && i.game.name ? i.game.name : "Your game")}</b>; Amount <b>${TB.money(p.total, cur)}</b>;</p>
        <div class="pgame"><div class="zrow"><span>Game</span><em><b>${esc(i.game && i.game.name ? i.game.name : "Your game")}</b></em></div>${i.game && i.game.id ? `<div class="zrow"><span><b>GAME ID</b></span><em><b class="mono">${esc(i.game.id)}</b></em></div>` : ""}${i.game && i.game.participants ? `<div class="zrow"><span>Players</span><em>Up to ${esc(String(i.game.participants))}</em></div>` : ""}</div>
        ${i.game && i.game.startMs ? `<div class="zrow"><span>Date</span><em>${esc(when(i.game.startMs))}</em></div>` : ""}${sum}
        <p class="zsmall">You are paying for this one game only. Players never pay.</p></div>
      ${TB.proformaBox ? TB.proformaBox() : ""}
      <div class="zcard zform"><h2>Details</h2>
        <label for="nm">Name</label><input id="nm" data-need="1" autocomplete="name" value="${esc(S.name)}" placeholder="Full name">
        <label for="em">E-mail (the invoice comes here)</label><input id="em" data-need="1" type="email" autocomplete="email" value="${esc(S.email)}" placeholder="Email">
        ${S.more ? `<label for="ph">Mobile <span class="zsmall" style="display:inline">(optional)</span></label>
        <div style="display:flex;gap:8px"><select id="pcode" aria-label="Country code" style="flex:0 0 112px">${TB.COUNTRIES.map(([c, n, d]) => `<option value="${d}" ${String(d) === String(S.pcode) ? "selected" : ""}>${c} +${d}</option>`).join("")}</select><input id="ph" type="tel" autocomplete="tel-national" value="${esc(S.phone)}" placeholder="Mobile number" style="flex:1;min-width:0"></div>
        <label for="org">Company name <span class="zsmall" style="display:inline">(optional)</span></label><input id="org" autocomplete="organization" value="${esc(S.org)}" placeholder="Company name">
        <label for="tax">GST / Tax number <span class="zsmall" style="display:inline">(optional)</span></label><input id="tax" autocomplete="off" maxlength="30" value="${esc(S.tax || "")}" placeholder="GST / Tax number" style="text-transform:uppercase">
` : `<button class="zsnd" id="more" type="button" style="margin-top:8px">Add a mobile number or organization (optional)</button>`}
        ${S.err ? `<div class="zbanner bad" role="alert">${esc(S.err)}</div>` : ""}${S.busy ? `<div class="zbanner info" role="status">Confirming your payment with Razorpay. Please keep this page open.</div>` : ""}
        <div id="tbSlot" class="tbslot"></div>
        <button class="zbtn" id="paygo" ${S.busy || !S.k3ok ? "disabled" : ""}>${S.busy ? "Confirming your payment…" : "Pay " + TB.money(p.total, cur) + " securely with Razorpay"}</button>
        <p class="zsmall">Secure payment by Razorpay. Payment to <a href="https://itservices-rajat-agarwal.pages.dev/" rel="noopener" target="_blank">IT Services by Rajat Agarwal</a>. An invoice is e-mailed to you. See the <a href="/legal.html#privacy">privacy policy</a>.</p></div>`;
  }
  function keep() { const g = (id) => { const e = document.getElementById(id); return e ? e.value : undefined; }; const v = { name: g("nm"), email: g("em"), phone: g("ph"), pcode: g("pcode"), org: g("org"), tax: g("tax") }; for (const k in v) if (v[k] !== undefined) S[k] = v[k]; }
  // The K3 consent box (termsbox.js): wording from the server, never pre-ticked, the pay button stays disabled until it is ticked. The page redraws often, so the tick is kept in S.k3 and put back.
  let TBK = null;
  function mountK3() {
    TBK = null; const slot = document.getElementById("tbSlot"); if (!slot || !window.TermsBox) return;
    const sync = () => { const g = document.getElementById("paygo"); if (g) g.disabled = !(TBK && TBK.ok()) || !!S.busy; };
    window.TermsBox.mount(slot, "K3", { base: "" }).then((t) => {
      if (!slot.isConnected) return; TBK = t; const saved = S.k3 || [];
      slot.querySelectorAll("input[data-box]").forEach((c) => { if (saved.includes(c.dataset.box)) c.checked = true; c.addEventListener("change", () => { S.k3 = t.terms().boxes; S.k3ok = t.ok(); sync(); }); });
      S.k3ok = t.ok(); sync();
    }).catch(() => {});
  }
  function draw() { $app.innerHTML = view(); bind(); mountK3(); TB.payer.mark($app); if (S.done && TB.invoiceWire) TB.invoiceWire(S.done); else if (TB.proformaWire && S.info && S.info.price) TB.proformaWire(() => call("POST", "/api/proforma", { link: token, currency: (S.info.price.currency || "INR"), name: S.name || "", email: S.email || "", phone: S.phone || "", org: S.org || "", taxId: S.tax || "", country: S.country })); }

  // Razorpay may say the payment is only created for a while: ask this link every 4 seconds, for up to 5 minutes, until the server says paid. Never mark it paid early.
  async function waitForConfirm() {
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await new Promise((ok) => setTimeout(ok, 4000));
      try { const j = await call("GET", `/api/paylink/${token}`); if (j.status === "paid") return { ok: true }; } catch { /* keep asking */ }
    }
    throw new Error("We are still waiting for Razorpay to confirm your payment. Nothing is lost: the game is marked paid as soon as it is confirmed. You can close this page and open the link again later to see the status.");
  }
  function bind() {
    const $ = (id) => document.getElementById(id);
    if ($("more")) $("more").onclick = () => { keep(); S.more = true; draw(); };
    if ($("paygo")) $("paygo").onclick = async () => {
      keep(); S.err = "";
      const nm = (S.name || "").trim(), email = (S.email || "").trim().toLowerCase(), tax = (S.tax || "").trim().toUpperCase();
      if (nm.length < 2) { S.err = "Please enter your name."; return draw(); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { S.err = "Please enter a valid e-mail."; return draw(); }
      if (tax && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(tax)) { S.err = "Please enter a valid 15-character GSTIN, like 27ABCDE1234F1Z5."; return draw(); }
      const terms = TBK && TBK.ok() ? TBK.terms() : null; if (!terms) { S.err = "Please tick the box to continue."; return draw(); }
      TB.payer.save(S);
      S.busy = true; draw();
      try {
        const body = { name: nm, email, country: S.country, consent: terms };
        if ((S.phone || "").trim()) { body.phone = S.phone.trim(); body.phoneCode = S.pcode; }
        if ((S.org || "").trim()) body.org = S.org.trim();
        if (tax) body.taxId = tax;
        let r = await call("POST", `/api/paylink/${token}/checkout`, body);
        if (r.mode === "razorpay") r = await TB.pay(r.razorpay, r.paymentId, r.hop); // opens Razorpay Checkout; the SERVER verifies the payment
        else if (r.result) r = r.result; // local test mode answers with the finished order
        if (r && r.confirming) r = await waitForConfirm();
        S.done = r || { ok: true };
      } catch (e) {
        if (e && e.status === 409 && e.body && e.body.status) { try { S.info = await call("GET", `/api/paylink/${token}`); S.err = ""; } catch { S.err = e.message; } } // already paid, expired or cancelled meanwhile: show that calm screen
        else S.err = e.message;
      }
      S.busy = false; draw();
    };
  }
  (async () => {
    if (!token) return draw();
    try { S.info = await call("GET", `/api/paylink/${token}`); }
    catch (e) { if (e.status === 404) S.gone = true; else S.err = e.message; }
    draw();
  })();
})();
