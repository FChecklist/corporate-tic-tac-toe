/* Corporate Tic Tac Toe: the page where an organizer pays to publish a draft engagement. Opens after they confirm their email and mobile number.
   The organizer key comes from this browser tab (set when the console was opened). The SERVER decides the pack and verifies the payment. */
(function () {
  const TB = window.TB, esc = TB.esc, $app = document.getElementById("app");
  const eid = TB.qs("e") || "";
  let secret = ""; try { secret = CTK.get("cbz-org") || ""; } catch {}
  const ss = (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } };
  const nf = (n) => Number(n).toLocaleString("en-IN");
  const S = { credited: 0, info: null, mode: "", cur: "INR", err: "", busy: false, done: null, ...(() => { const v = TB.payer.load(); return { email: ss("cbz-email") || v.email || "", phone: ss("cbz-phone") || v.phone || "", name: ss("cbz-name") || v.name || "", org: v.org || "", tax: v.tax || "" }; })(), pcode: "91", country: "IN" }; // India and +91 unless they change them: fewest taps to pay
  S.cur = S.country === "IN" ? "INR" : "USD";

  const call = async (method, path, body) => {
    const r = await fetch(path, { method, headers: { "content-type": "application/json", "x-organizer": secret }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = Object.assign(new Error(j.error || "Something went wrong. Please try again."), { status: r.status }); if (window.CTG) { CTG.wrap(err, { what: method + " " + path.split("?")[0].replace(/\/[0-9a-f]{16,}/gi, "/...") }); if (method !== "GET") { err.guided = true; CTG.watch(err, { retry: () => call(method, path, body) }); } } throw err; }
    return j;
  };
  const head = `<div class="zhead"><b>Corporate Tic Tac Toe · Publish game</b><a class="zsnd" href="/zc.html?e=${encodeURIComponent(eid)}" style="text-decoration:none">Back to my game</a></div>${TB.payBrand ? TB.payBrand() : ""}`;
  const packFor = (cap) => { const p = TB.PACKS.find((x) => x[0] >= cap); return p ? p[0] : null; };

  function view() {
    if (!secret) return `${head}<div class="zcard"><h2>Please sign in first</h2><p class="zsmall" style="margin-top:0">Open your console from the home page, or sign in with your e-mail: we send you a 6-digit code.</p><a class="zbtn" href="/#login" id="goLogin" style="text-decoration:none;display:inline-block">Sign in with email</a></div>`;
    if (S.done) {
      const d = S.done;
      return `${head}<div class="zcard" style="border:2px solid #2e7d4f"><h2>Payment received. Your game will begin on time.</h2>${TB.payReceipt ? TB.payReceipt(d, d.eid || eid) : ""}
        <p style="margin:0 0 10px">${d.paidFromCredit ? "Paid from your credit. " : ""}Thank you. Your game for up to <b>${nf(d.pack)}</b> participants is confirmed.${d.restartedAtMs ? ` It begins at <b>${esc(new Date(d.restartedAtMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</b>, for everyone already waiting.` : " Share the link with your participants from your console if you have not already."}</p>
        ${d.invoiceUrl ? `${TB.invoiceBox ? TB.invoiceBox(d, S.email) : ""}<p class="zsmall">We also emailed it to you and to the organizer.</p>` : ""}
        <a class="zbtn" href="/zc.html?e=${encodeURIComponent(d.eid || eid)}" style="text-decoration:none;display:inline-block">Open my game</a></div>`;
    }
    if (!S.info) return `${head}<p class="zmsg">${S.err ? esc(S.err) : "Loading…"}</p>`;
    const pack = packFor(S.info.cap);
    if (!S.info.draft && !S.info.unpaid) return `${head}<div class="zcard"><h2>This game is already paid and published</h2><a class="zbtn" href="/zc.html?e=${encodeURIComponent(eid)}" style="text-decoration:none;display:inline-block">Open my game</a></div>`;
    if (!pack) return `${head}<div class="zcard"><h2>A custom arrangement is needed</h2><p class="zsmall" style="margin-top:0">A game for more than 10,000 participants is arranged with us directly. Please write to us from the contact page.</p></div>`;
    const x = TB.price(pack, S.cur);
    const applied = S.cur === "INR" ? Math.max(Number(S.credited) || 0, Number(S.info.creditApplied) || 0) : 0; // credit already put on this game (by you, or by a Host); it comes off what you pay
    const toPay = Math.max(0, Math.round((x.total - applied) * 100) / 100);
    const avail = S.cur === "INR" && !applied && Number(S.info.credit) > 0 ? Number(S.info.credit) : 0;
    const until = S.info.creditExpiresMs ? new Date(S.info.creditExpiresMs - 1).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "";
    const sum = (S.cur === "INR"
      ? `<div class="zrow"><span><b>Total</b></span><em><b>${TB.money(x.total, "INR")}</b></em></div>`
      : `<div class="zrow"><span><b>Total</b></span><em><b>${TB.money(x.total, "USD")}</b></em></div><p class="zsmall">No tax added. Billed in US dollars.</p>`)
      + (applied ? `<div class="zrow"><span>Your credit used</span><em>- ${TB.money(applied, "INR")}</em></div><div class="zrow"><span><b>To pay now</b></span><em><b>${TB.money(toPay, "INR")}</b></em></div>` : "");
    const off = S.mode === "off";
    return `${head}
      ${off ? `<div class="zbanner info"><b>Online payment opens soon.</b> Your game is saved and nothing is lost. Come back to this page when payment is switched on. Until then it stays held at its start time.</div>` : ""}
      <div class="zcard"><h2>Payment</h2>
        <p class="pstmt">Payment is for Game ID <b class="mono">${esc(eid)}</b>; Amount <b>${TB.money(applied ? toPay : x.total, S.cur)}</b>;</p>
        <div class="pgame"><div class="zrow"><span><b>GAME ID</b></span><em><b class="mono">${esc(eid)}</b></em></div>${S.info.startMs ? `<div class="zrow"><span>Starts</span><em>${esc(new Date(S.info.startMs).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</em></div>` : ""}<div class="zrow"><span>Players</span><em>Up to ${nf(pack)}</em></div></div>
        ${sum}
        <p class="zsmall">Every player plays on their own phone. Players never pay: you give the rewards. We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365. The credit belongs to your organizer account.</p>${S.info.startMs ? `<p class="zsmall"><b>Payment pending.</b> The game does not begin until it is paid for. Starts ${esc(new Date(S.info.startMs).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}. You can pay at any time until the guest data is erased${S.info.erasureMs ? ` (${esc(new Date(S.info.erasureMs).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))})` : ""}.${S.info.locked ? " It is waiting for your payment now: pay and it starts 2 minutes after your payment is confirmed." : " If you pay after the start time, it starts 2 minutes after your payment is confirmed."}</p>` : ""}</div>
      ${avail ? `<div class="zcard" style="border:2px solid #2e7d4f"><h2>Use your credit</h2><p class="zsmall" style="margin-top:0">You have credit of <b>${TB.money(avail, "INR")}</b>${until ? ` (valid until ${esc(until)})` : ""}. Use it for this game.</p>${S.err && S.creditErr ? `<div class="zbanner bad">${esc(S.err)}</div>` : ""}<button class="zbtn" id="usecredit" ${S.busy ? "disabled" : ""}>Use my credit</button></div>` : ""}
      ${TB.proformaBox ? TB.proformaBox() : ""}
      <div class="zcard zform"><h2>Details</h2>
        <label for="nm">Name</label><input id="nm" data-need="1" autocomplete="name" value="${esc(S.name || "")}" placeholder="Full name">
        <label for="em">Email (your invoice comes here)</label><input id="em" data-need="1" type="email" autocomplete="email" value="${esc(S.email)}" placeholder="Email">
        <label for="ph">Mobile <span class="zsmall" style="display:inline">(optional)</span></label>
        <div style="display:flex;gap:8px"><select id="pcode" aria-label="Country code" style="flex:0 0 112px">${TB.COUNTRIES.map(([c, n, d]) => `<option value="${d}" ${String(d) === String(S.pcode) ? "selected" : ""}>${c} +${d}</option>`).join("")}</select><input id="ph" type="tel" autocomplete="tel-national" value="${esc(S.phone)}" placeholder="Mobile number" style="flex:1;min-width:0"></div>
        <label for="org">Company name <span class="zsmall" style="display:inline">(optional)</span></label><input id="org" autocomplete="organization" value="${esc(S.org || "")}" placeholder="Company name">
        <label for="cty">Country of your organization <span class="zsmall" style="display:inline">(optional)</span></label><select id="cty">${TB.countryOpts(S.country)}</select>
        <label for="tax">GST / Tax number <span class="zsmall" style="display:inline">(optional)</span></label><input id="tax" autocomplete="off" maxlength="30" value="${esc(S.tax || "")}" placeholder="GST / Tax number" style="text-transform:uppercase">
        ${S.err ? `<div class="zbanner bad">${esc(S.err)}</div>` : ""}${S.busy ? `<div class="zbanner info" role="status">Confirming your payment with Razorpay. Please keep this page open. Your game starts only after Razorpay confirms.</div>` : ""}
        <div id="tbSlot" class="tbslot"></div>
        <button class="zbtn" id="paygo" ${off || S.busy || !S.k3ok ? "disabled" : ""}>${S.busy ? "Confirming your payment…" : off ? "Payment opens soon" : "Pay " + TB.money(applied ? toPay : x.total, S.cur) + " securely with Razorpay"}</button>
        <p class="zsmall">Secure payment by Razorpay. Payment to <a href="https://itservices-rajat-agarwal.pages.dev/" rel="noopener" target="_blank">IT Services by Rajat Agarwal</a>. An invoice is emailed to you. See the <a href="/legal.html#privacy">privacy policy</a>.</p></div>`;
  }
  // The server answers 202 {confirming:true} while Razorpay still says the payment is only created or authorized. We ask every 4 seconds, for up to 5 minutes, until the game itself says Paid.
  async function waitForConfirm(first) {
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await new Promise((ok) => setTimeout(ok, 4000));
      let st = null;
      try { st = (await call("GET", `/api/z/${eid}/summary`)).payment; } catch { try { st = (await call("GET", `/api/z/${eid}/cohost`)).payment; } catch { /* keep asking */ } }
      if (st && st.status === "paid") return { ok: true, eid, pack: (S.info && packFor(S.info.cap)) || 0, total: 0, currency: S.cur };
    }
    throw new Error("We are still waiting for Razorpay to confirm your payment. Nothing is lost: your game starts as soon as it is confirmed. You can close this page and open your game to see the status.");
  }
  // The K3 consent box (termsbox.js): wording from the server, never pre-ticked, the pay button stays disabled until it is ticked. The page redraws often, so the tick is kept in S.k3 and put back.
  let TBK = null;
  function mountK3() {
    TBK = null; const slot = document.getElementById("tbSlot"); if (!slot || !window.TermsBox) return;
    const sync = () => { const g = document.getElementById("paygo"); if (g) g.disabled = !(TBK && TBK.ok()) || !!S.busy || S.mode === "off"; };
    window.TermsBox.mount(slot, "K3", { base: "" }).then((t) => {
      if (!slot.isConnected) return; TBK = t; const saved = S.k3 || [];
      slot.querySelectorAll("input[data-box]").forEach((c) => { if (saved.includes(c.dataset.box)) c.checked = true; c.addEventListener("change", () => { S.k3 = t.terms().boxes; S.k3ok = t.ok(); sync(); }); });
      S.k3ok = t.ok(); sync();
    }).catch(() => {});
  }
  function draw() { $app.innerHTML = view(); bind(); mountK3(); TB.payer.mark($app); if (S.done && TB.invoiceWire) TB.invoiceWire(S.done); else if (TB.proformaWire && S.info) TB.proformaWire(() => call("POST", "/api/proforma", { eid, currency: S.cur, name: S.name || "", email: S.email || "", phone: S.phone || "", org: S.org || "", taxId: S.tax || "", country: S.country })); }
  function keep() { const g = (id) => { const e = document.getElementById(id); return e ? e.value : undefined; }; const v = { name: g("nm"), org: g("org"), tax: g("tax"), email: g("em"), phone: g("ph"), pcode: g("pcode") }; for (const k in v) if (v[k] !== undefined) S[k] = v[k]; }

  function bind() {
    const $ = (id) => document.getElementById(id);
    if ($("cty")) $("cty").onchange = () => { keep(); S.country = $("cty").value; S.cur = S.country === "IN" ? "INR" : "USD"; draw(); };
    if ($("goLogin")) $("goLogin").onclick = () => { try { sessionStorage.setItem("cbz-next", "/pay.html?e=" + encodeURIComponent(eid)); } catch {} };
    if ($("usecredit")) $("usecredit").onclick = async () => {
      S.err = ""; S.creditErr = false; S.busy = true; draw();
      try {
        const r = await call("POST", `/api/z/${encodeURIComponent(eid)}/pay-with-credit`, {});
        S.credited = r.usedInr || 0;
        if (r.paid) S.done = { ok: true, eid, pack: packFor(S.info.cap) || 0, paidFromCredit: true, restartedAtMs: r.restartedAtMs || null };
        else S.info.creditApplied = r.usedInr; // the rest is paid below, in the usual way, for the same game
      } catch (e) { S.err = e.message; S.creditErr = true; }
      S.busy = false; draw();
    };
    if ($("paygo")) $("paygo").onclick = async () => {
      keep(); S.err = "";
      const nm = (S.name || "").trim(), org = (S.org || "").trim(), email = (S.email || "").trim().toLowerCase(), tax = (S.tax || "").trim().toUpperCase();
      if (nm.length < 2) { S.err = "Please enter your name."; return draw(); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { S.err = "Please enter a valid email."; return draw(); }
      if (S.country === "IN" && tax && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(tax)) { S.err = "Please enter a valid 15-character GSTIN, like 27ABCDE1234F1Z5."; return draw(); }
      const terms = TBK && TBK.ok() ? TBK.terms() : null; if (!terms) { S.err = "Please tick the box to continue."; return draw(); }
      TB.payer.save(S);
      S.busy = true; draw();
      try {
        let ref = ""; try { const v = JSON.parse(localStorage.getItem("cbz-ref") || "null"); if (v && Date.now() - v.at < 30 * 86400000) ref = v.code; } catch {}
        let r = await call("POST", "/api/checkout", { consent: terms, eid, name: nm, org, email, country: S.country, taxId: tax, currency: S.cur, phone: S.phone, phoneCode: S.pcode, ref });
        if (r.mode === "razorpay") r = await TB.pay(r.razorpay, r.paymentId, r.hop); // opens Razorpay Checkout; the server verifies the payment
        else if (r.result) r = r.result; // local test mode answers with the finished order
        try { CTK.set("cbz-email", email); sessionStorage.setItem("cbz-name", nm); } catch {}
        if (r && r.confirming) r = await waitForConfirm(r); // Razorpay has not confirmed yet: keep asking, never mark it paid early
        S.done = r;
      } catch (e) { S.err = e.cancelled ? e.message : e.message; }
      S.busy = false; draw();
    };
  }

  (async () => {
    if (!secret) return draw();
    if (!eid) { S.err = "No game was chosen."; return draw(); }
    try {
      const st = await fetch("/api/payments/status").then((r) => r.json()); S.mode = st.mode;
      const h = await call("GET", `/api/z/${eid}/cohost`); // only the Organizer, a Host or a Co-host of THIS game's account passes; anyone else gets a 403 and a calm message
      try { S.info = await call("GET", `/api/z/${eid}/info`); }
      catch (e0) { // a Co-host may pay but cannot read the game: use the small game header they are allowed
        if (e0.status !== 403) throw e0;
        S.info = { cap: h.cap, startMs: h.startMs, draft: !h.inviteLink, unpaid: !h.payment || h.payment.status !== "paid", credit: h.credit, creditExpiresMs: h.creditExpiresMs, creditApplied: h.creditApplied, erasureMs: h.erasureMs };
      }
    } catch (e) { S.err = e.status === 403 || e.status === 404 ? "We could not open this game with your sign-in. Open it from your console." : e.message; }
    draw();
  })();
})();
