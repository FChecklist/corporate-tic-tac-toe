/* The payment kit: ONE set of parts for the three payment pages (paytest, paylink, pay), the same in all six games. Vanilla JS, no build. Loads after common.js and payfields.js.
   The flow (as decided on 2 Nov 2026): BEFORE paying the payer only checks the game and the price and, if needed, changes the country (it decides the currency: India pays in rupees with GST,
   every other country in US dollars). No name, e-mail, mobile, company or GST box. Razorpay asks for and checks the mobile and the e-mail itself. AFTER paying the page shows what Razorpay
   gave us and a short form "Add to your invoice (all optional)" with a Skip button; the tax invoice is issued when they press one of the two, or by itself 15 minutes after the payment.
   Kept for this browser tab (sessionStorage, gone when the tab closes, never in an address): the chosen country, the id of the payment already made, and whatever was typed in the
   after-payment form; put back after a failed call, a reload or an automatic page update. The per-game words are the BRAND lines below: the only lines that differ between the six games. */
(function () {
  const TB = window.TB, esc = TB.esc, F = window.PAYFIELDS || {};
  const PK = (window.PK = {});
  PK.BRAND = { name: "Corporate Tic Tac Toe", kind: "closed-group tic tac toe software", payee: "IT Services by Rajat Agarwal", payeeCaps: "IT SERVICES BY RAJAT AGARWAL" };
  const nf = (n) => Number(n).toLocaleString("en-IN");
  const money = (n, cur) => TB.money(n, cur || "INR");
  /** Every rule of the after-payment form is a constant here, so a later change is one line (the Worker has the same two in payfirst.ts). */
  PK.RULES = { taxIdNeedsCompany: true, invoiceMinutes: 15 };
  const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const GSTIN_MSG = "That GSTIN does not look right. It has 15 characters, like 27ABCDE1234F1Z5.", COMPANY_MSG = "Please add your company name. A GST invoice needs the business name.";

  const svg = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra || ""}>${d}</svg>`;
  const I = PK.icons = {
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    shield: svg('<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5L15.5 10"/>'),
    card: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>'),
    receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  };

  // ---- India time (the games run on India time; the page says so) ----
  const parts = (ms, o) => { const r = {}; for (const p of new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o }).formatToParts(new Date(ms))) r[p.type] = p.value; return r; };
  PK.istDate = (ms) => { const p = parts(ms, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); return `${p.weekday}, ${p.day} ${p.month} ${p.year}`; };
  PK.istTime = (ms) => { const p = parts(ms, { hour: "numeric", minute: "2-digit", hour12: true }); return `${p.hour}:${p.minute} ${String(p.dayPeriod || "").toUpperCase()} IST`; };
  /** A masked e-mail address (the Worker already sends it masked; this is for anything typed on the page) */
  PK.maskEmail = (e) => { const s = String(e || "").trim(), at = s.lastIndexOf("@"); return at < 1 || at === s.length - 1 ? "" : Array.from(s)[0] + "***" + s.slice(at); };

  // ---- the country: the only thing asked before paying ----
  const CODES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BM BN BO BQ BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR "
    + "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ "
    + "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");
  let dn = null, list = null;
  /** the English name of a country code (the browser knows them all; the short list in common.js is the fallback) */
  PK.countryName = (c) => {
    try { dn = dn || new Intl.DisplayNames(["en"], { type: "region" }); const n = dn.of(c); if (n && n !== c) return n; } catch (e) { /* use the short list */ }
    const t = (TB.COUNTRIES || []).find((x) => x[0] === c); return t ? t[1] : c;
  };
  PK.countries = () => list || (list = CODES.map((c) => [c, PK.countryName(c)]).sort((a, b) => a[1].localeCompare(b[1])));
  /** The country this payment is made from: the payer's own choice (S.pick) always wins over what the network says (S.auto, only a starting point). "" = not known yet. */
  PK.cty = (S) => S.pick || S.auto || "";
  /** "INR" for India, "USD" for everybody else, "" while the country is not known */
  PK.cur = (S) => { const c = PK.cty(S); return c === "IN" ? "INR" : c ? "USD" : ""; };
  /** Asks the Worker where the visitor is (Cloudflare knows). Sets S.auto ("" when it cannot be told), S.intl and S.whereDone. Never throws. */
  PK.where = async (S) => {
    try { const j = await Promise.race([TB.api("GET", "/api/payments/where"), new Promise((no, bad) => setTimeout(() => bad(new Error("slow")), 4000))]); S.auto = /^[A-Z]{2}$/.test((j && j.country) || "") ? j.country : ""; S.intl = !j || j.international !== false; }
    catch (e) { S.auto = ""; }
    S.whereDone = true;
  };
  /** One line: "Paying from India · ₹ · change". When the country is not known the searchable list is open instead. */
  PK.countryLine = (S) => {
    const c = PK.cty(S), cur = PK.cur(S), open = !c || !!S.ctyOpen;
    const line = c
      ? `<p class="pk-ctyline" id="pk-ctyline">Paying from <b>${esc(PK.countryName(c))}</b><span aria-hidden="true"> · </span><b>${cur === "INR" ? "₹" : "US$"}</b><span aria-hidden="true"> · </span><button type="button" class="pk-link" id="ctychange" aria-expanded="${open ? "true" : "false"}" aria-controls="ctybox">change</button></p>`
      : '<p class="pk-ctyline" id="pk-ctyline"><b>Where are you paying from?</b></p>';
    const items = PK.countries().map(([k, n]) => `<li><button type="button" class="pk-ctyopt${k === c ? " on" : ""}" data-cty="${k}" data-n="${esc(n.toLowerCase())}"${k === c ? ' aria-current="true"' : ""}>${esc(n)}</button></li>`).join("");
    return `<section class="pk-card pk-cty" id="pk-cty" aria-label="Country"><div class="pk-ctytop">${line}</div><div id="ctybox"${open ? "" : " hidden"}>
      <label class="pk-lab" for="ctyq">Search for your country</label><input class="pk-in" id="ctyq" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="For example India" aria-controls="ctylist">
      <ul class="pk-ctylist" id="ctylist">${items}</ul><p class="pk-hint" id="ctyno" hidden>No country matches that.</p>
      <p class="pk-hint">India pays in rupees (₹) with GST. Every other country pays in US dollars (US$).</p></div></section>`;
  };
  /** show / hide the list, search it, pick a country. `save` is the draft's save(); onPick(code) is told the new country (the page redraws). */
  PK.countryWire = (root, S, save, onPick) => {
    const box = root.querySelector("#ctybox"), q = root.querySelector("#ctyq"), ul = root.querySelector("#ctylist"), none = root.querySelector("#ctyno"), chg = root.querySelector("#ctychange");
    if (!box || !q || !ul) return;
    const pick = (code) => { S.pick = code; S.ctyOpen = false; save(); onPick(code); };
    const shut = () => { S.ctyOpen = false; box.hidden = true; if (chg) { chg.setAttribute("aria-expanded", "false"); chg.focus(); } };
    if (chg) chg.addEventListener("click", () => { S.ctyOpen = !S.ctyOpen; box.hidden = !S.ctyOpen; chg.setAttribute("aria-expanded", S.ctyOpen ? "true" : "false"); if (S.ctyOpen) q.focus(); });
    const filter = () => { const v = q.value.trim().toLowerCase(); let n = 0; ul.querySelectorAll("li").forEach((li) => { const b = li.firstElementChild, ok = !v || b.getAttribute("data-n").indexOf(v) >= 0 || b.getAttribute("data-cty").toLowerCase() === v; li.hidden = !ok; if (ok) n++; }); if (none) none.hidden = n > 0; };
    q.addEventListener("input", filter);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const f = Array.from(ul.querySelectorAll("li")).find((li) => !li.hidden); if (f) pick(f.firstElementChild.getAttribute("data-cty")); }
      else if (e.key === "Escape" && PK.cty(S)) shut();
    });
    ul.addEventListener("click", (e) => { const b = e.target && e.target.closest ? e.target.closest("[data-cty]") : null; if (b) pick(b.getAttribute("data-cty")); });
  };

  // ---- page parts ----
  PK.steps = (n, finished) => {
    const li = ["Review", "Pay", "Receipt"].map((t, i) => {
      const done = finished || i + 1 < n, now = !finished && i + 1 === n;
      return `<li class="${done ? "is-done" : now ? "is-now" : ""}"${now ? ' aria-current="step"' : ""}><span class="n" aria-hidden="true">${done ? I.check : i + 1}</span>${t}${done ? '<span class="pk-sr"> (done)</span>' : ""}</li>`;
    }).join("");
    return `<ol class="pk-steps" aria-label="Progress">${li}</ol>`;
  };
  /** title, optional tag, lead; the steps; then the form column and the aside (summary). DOM order = reading order: the summary comes first unless formFirst. */
  PK.layout = (o) => `<h1 class="pk-h1" id="pk-h1" tabindex="-1">${esc(o.title)}${o.tag ? `<span class="pk-tag">${esc(o.tag)}</span>` : ""}</h1>${o.lead ? `<p class="pk-lead${o.wait ? " w" + o.wait : ""}">${o.lead}</p>` : ""}${PK.steps(o.step, o.finished)}
    <div class="pk-grid${o.formFirst ? " ff" : ""}${o.wait ? " ld" : ""}">${o.formFirst ? `<div class="pk-col">${o.col}</div><div class="pk-aside">${o.aside}</div>` : `<div class="pk-aside">${o.aside}</div><div class="pk-col">${o.col}</div>`}</div>`;
  PK.row = (label, valueHtml, cls) => `<dt>${esc(label)}</dt><dd${cls ? ` class="${cls}"` : ""}>${valueHtml}</dd>`;

  /** The order summary. o.game = {id, name, startMs, participants, organizer:{name, email}} or null; o.price = {total, base, gst, currency} or null; o.test / o.paid add a badge. o.noPrice = the country is not chosen yet. */
  PK.summary = (o) => {
    const g = o.game, p = o.price, cur = (p && p.currency) || "INR", B = PK.BRAND;
    const badge = o.paid ? '<span class="pk-badge paid">Paid</span>' : o.test ? '<span class="pk-badge test">Test</span>' : "";
    let body;
    if (g) {
      const r = [];
      if (g.id) r.push(PK.row("Game ID", esc(g.id), "mono"));
      if (g.participants) r.push(PK.row("Participants", "Up to " + esc(nf(g.participants))));
      if (g.startMs) { r.push(PK.row("Game date", esc(PK.istDate(g.startMs)))); r.push(PK.row("Start time", esc(PK.istTime(g.startMs)))); }
      if (g.organizer && g.organizer.name) r.push(PK.row("Organizer", esc(g.organizer.name)));
      if (g.organizer && g.organizer.email) r.push(PK.row("Organizer e-mail", esc(g.organizer.email)));
      body = `<p class="pk-gname">${esc(g.name || g.id || "Your game")}</p><dl class="pk-dl">${r.join("")}</dl>`;
    } else body = `<p class="pk-gname">${esc(o.emptyTitle || "Your game")}</p>${o.emptyText ? `<p class="pk-empty">${esc(o.emptyText)}</p>` : ""}`;
    let price = "";
    if (o.noPrice) price = '<div class="pk-price"><p class="pk-nopr">Choose your country to see the price.</p></div>';
    else if (p) {
      const label = o.priceLabel || (g && g.participants ? `Game pack, up to ${nf(g.participants)} participants` : "Amount");
      const rows = [], list = o.listTotal != null ? o.listTotal : p.total;
      if (cur === "INR" && Number(p.gst) > 0 && o.listTotal == null) rows.push(`<div class="r"><span>${esc(label)} (before GST)</span><span>${money(p.base, cur)}</span></div><div class="r"><span>GST</span><span>${money(p.gst, cur)}</span></div>`);
      else if (o.priceLabel || (g && g.participants)) rows.push(`<div class="r"><span>${esc(label)}</span><span>${money(list, cur)}</span></div>`);
      if (o.creditUsed) rows.push(`<div class="r"><span>Your credit used</span><span>- ${money(o.creditUsed, cur)}</span></div>`);
      rows.push(`<div class="r t"><span>${esc(o.totalLabel || "Total to pay")}</span><span>${money(p.total, cur)}</span></div>`);
      price = `<div class="pk-price">${rows.join("")}</div>${cur === "INR" ? "" : '<p class="pk-note"><b>Charged in US$.</b> No Indian GST is added.</p>'}`;
    }
    return `<section class="pk-card" aria-labelledby="pk-sum-h"><div class="pk-sum-top"><h2 class="pk-kicker" id="pk-sum-h">Order summary</h2>${badge}</div>${body}${price}
      <p class="pk-owner">Software owned and made by<b>${esc(B.payeeCaps)}</b>Your payment is made to ${esc(B.payee)}.</p></section>`;
  };
  /** The same game block, as the loading frame: same size, so nothing jumps when the real answer comes. */
  PK.summarySkeleton = () => '<section class="pk-card" aria-busy="true" aria-label="Loading the game details"><div class="pk-sum-top"><p class="pk-kicker">Order summary</p></div><div class="pk-skel l1"></div><div class="pk-skel l2"></div><div class="pk-skel l2"></div><div class="pk-skel l2"></div><div class="pk-skel l3"></div></section>';
  PK.trust = () => `<section class="pk-card pk-trustcard" aria-label="Why this payment is safe"><ul class="pk-trust">
    <li>${I.lock}<div><b>Secure payment by Razorpay</b><span>Your card, UPI or bank details go to Razorpay only.</span></div></li>
    <li>${I.shield}<div><b>RBI-regulated payment gateway</b><span>Trusted by businesses across the world.</span></div></li>
    <li>${I.card}<div><b>Your card and UPI details are never seen by us</b><span>${esc(PK.BRAND.name)} never sees or stores them.</span></div></li>
    <li>${I.receipt}<div><b>Tax invoice by e-mail</b><span>Sent to the e-mail you give Razorpay.</span></div></li></ul>
    <p class="pk-fine">All data is handled as required by India's DPDP Act, US privacy laws and the EU GDPR.</p></section>`;

  // ---- fields (only the optional after-payment form has any) ----
  /** o: id, f (the state name), label, type, value, auto, opt, hint, ph, max, cls, mode */
  PK.field = (o) => `<div class="pk-f"><label for="${o.id}">${esc(o.label)}${o.opt ? ' <span class="opt">(optional)</span>' : ""}</label><input class="pk-in${o.cls ? " " + o.cls : ""}" id="${o.id}" data-f="${o.f}" type="${o.type || "text"}" value="${esc(o.value || "")}"${o.auto ? ` autocomplete="${o.auto}"` : ""}${o.ph ? ` placeholder="${esc(o.ph)}"` : ""}${o.max ? ` maxlength="${o.max}"` : ""}${o.mode ? ` inputmode="${o.mode}"` : ""} aria-describedby="${o.id}-h ${o.id}-e"><p class="pk-hint" id="${o.id}-h"${o.hint ? "" : " hidden"}>${o.hint ? esc(o.hint) : ""}</p><p class="pk-ferr" id="${o.id}-e" hidden></p></div>`;
  PK.errBox = () => `<div class="pk-msg bad" id="pk-err" role="alert" hidden>${I.alert}<span></span></div>`;
  PK.busyBox = (text) => `<div class="pk-msg info" id="pk-busy" role="status" hidden>${I.info}<span>${esc(text)}</span></div>`;
  PK.live = () => '<div id="pk-live" class="pk-sr" role="status" aria-live="polite"></div>';

  PK.clearErrors = (root) => {
    const b = root.querySelector("#pk-err"); if (b) { b.hidden = true; b.querySelector("span").textContent = ""; }
    root.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
    root.querySelectorAll(".pk-ferr").forEach((e) => { e.hidden = true; e.textContent = ""; });
  };
  /** Shows one message in the alert box; with a field id it also marks that field and moves the cursor there. */
  PK.setError = (root, msg, fieldId) => {
    PK.clearErrors(root);
    const b = root.querySelector("#pk-err"); if (b) { b.querySelector("span").textContent = msg; b.hidden = !msg; }
    if (!msg || !fieldId) return;
    const f = root.querySelector("#" + fieldId), e = root.querySelector("#" + fieldId + "-e");
    if (f) { f.setAttribute("aria-invalid", "true"); try { f.focus(); } catch (x) { /* fine */ } }
    if (e) { e.textContent = msg; e.hidden = false; }
  };
  PK.say = (root, text) => { const l = root.querySelector("#pk-live"); if (l) l.textContent = text || ""; };
  PK.busy = (root, on, btnId, labels) => {
    const b = root.querySelector("#" + btnId), box = root.querySelector("#pk-busy");
    if (b) { b.disabled = !!on; b.setAttribute("aria-disabled", on ? "true" : "false"); b.classList.toggle("is-busy", !!on); b.textContent = on ? labels.on : labels.off; }
    if (box) box.hidden = !on;
    PK.say(root, on ? labels.on : "");
  };
  /** words for what went wrong. kept = the message also says that what was typed is kept (the after-payment form) */
  PK.friendly = (e, kept) => {
    const tail = kept ? " What you typed is kept." : "";
    if (e && e.cancelled) return "The payment window was closed, so nothing was charged. Press the button to try again.";
    if (e && e.status === 0) return "We could not reach the service. Please check your internet connection and try again." + tail;
    if (e && e.status === 429) return String((e && e.message) || "").trim() || "Please try again later.";
    const m = String((e && e.message) || "").trim() || "Something went wrong.";
    return m + tail;
  };

  // ---- the draft: what is kept for this tab ----
  PK.draft = (page) => {
    const slot = "cbz-paydraft-" + page;
    return {
      load() { try { const v = JSON.parse(sessionStorage.getItem(slot) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } },
      save(o) { try { sessionStorage.setItem(slot, JSON.stringify(o)); } catch (e) { /* storage blocked: the page still works */ } },
      clear() { try { sessionStorage.removeItem(slot); } catch (e) { /* fine */ } },
    };
  };
  const TEXT_KEYS = ["name", "org", "tax", "gameId"];
  /** Puts the saved draft into S, then keeps it up to date on every keystroke and change (listeners on the root, which never changes, so a redraw loses nothing). Returns save().
      The keys: "pick" (the country the payer chose), "paid" (the id of the payment already made in this tab) and the typed text of the after-payment form. */
  PK.persist = (root, S, draft, keys) => {
    const saved = draft.load();
    for (const k of keys) if (typeof saved[k] === "string" && saved[k] !== "") { S[k] = saved[k].slice(0, 200); if (TEXT_KEYS.indexOf(k) >= 0) S.touched = true; } // typed earlier in this tab: the automatic page update waits for it too
    const save = () => { const o = {}; for (const k of keys) if (typeof S[k] === "string") o[k] = S[k]; draft.save(o); };
    const take = (e) => { const t = e.target, f = t && t.dataset ? t.dataset.f : ""; if (!f || keys.indexOf(f) < 0) return; S[f] = t.value; S.touched = true; if (t.classList) t.classList.remove("pk-fill"); save(); };
    root.addEventListener("input", take); root.addEventListener("change", take);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
    window.addEventListener("pageshow", (e) => { if (e.persisted) { const s2 = draft.load(); for (const k of keys) if (typeof s2[k] === "string") S[k] = s2[k]; PK.refill(root, S, keys); } });
    // the automatic page update (autoupdate.js) waits while typed details are not yet sent; the draft above covers the case where it does reload
    window.__ctDirty = () => (!S.done || !!S.done.invoicePending) && !!S.touched && TEXT_KEYS.some((k) => keys.indexOf(k) >= 0 && S[k]);
    return save;
  };
  /** Reads what is in the boxes into S (a browser fills boxes in ways that do not always fire an input event; the buttons call this first). */
  PK.sync = (root, S, keys) => { for (const k of keys) { const e = root.querySelector('[data-f="' + k + '"]'); if (e && typeof e.value === "string") S[k] = e.value; } };
  PK.refill = (root, S, keys) => { for (const k of keys) { const e = root.querySelector('[data-f="' + k + '"]'); if (e && typeof S[k] === "string" && e.value !== S[k]) e.value = S[k]; } };
  /** the remembered payer (this browser, after an earlier payment) in grey until the person types over it */
  PK.markFilled = (root) => { const v = TB.payer.load(); for (const [id, k] of [["nm", "name"], ["org", "org"], ["tax", "tax"]]) { const e = root.querySelector("#" + id); if (!e || !v[k] || e.value !== v[k]) continue; e.classList.add("pk-fill"); } };
  /** the remembered payer (name, company, tax number) of this browser, as state for the after-payment form */
  PK.payerState = () => { const v = TB.payer.load(); return { name: v.name || "", org: v.org || "", tax: v.tax || "" }; };
  /** What every order sends about the payer: only the country (it decides the currency). The Worker takes the e-mail and the mobile from Razorpay. */
  PK.orderBody = (S) => { const b = {}; b[F.country || "country"] = PK.cty(S); b.currency = PK.cur(S) || "INR"; return b; };

  // ---- the receipt, and the optional details for the invoice ----
  PK.invoice = (d, email) => !d || !d.invoiceUrl ? "" : `<div class="pk-inv"><h3>Your invoice ${esc(d.invoiceNumber || "")}</h3><div class="pk-invbody" id="invbody">Loading your invoice...</div>
    <div class="pk-btns"><a class="pk-btn alt" id="invpdf" href="${esc(d.invoiceUrl)}.pdf" download>Download PDF</a><a class="pk-btn alt" id="invprint" href="${esc(d.invoiceUrl)}" target="_blank" rel="noopener">Open / print</a><a class="pk-btn alt" id="invwa" href="#">Send by WhatsApp</a><button class="pk-btn alt" id="invcopy" type="button">Copy invoice link</button></div>
    <div class="pk-invto"><label for="invto">E-mail this invoice to</label><input class="pk-in" id="invto" type="email" autocomplete="email" value="${esc(email || "")}"><button class="pk-btn sm" id="invsend" type="button">E-mail it</button></div><p class="pk-note" id="invmsg" role="status"></p></div>`;
  /** "Add to your invoice (all optional)": name, company name, GST / Tax ID, and a Skip button. Shown while the invoice is still waiting for the payer. */
  PK.invoiceForm = (S, d) => {
    const to = d && d.payer && d.payer.email ? d.payer.email : "";
    return `<div class="pk-invform" id="pk-invform"><h3>Add to your invoice <span class="opt">(all optional)</span></h3>
      <p class="pk-sub">Your tax invoice is e-mailed${to ? ` to <b>${esc(to)}</b>` : ""} when you press a button below. If you do nothing, it is sent by itself in ${PK.RULES.invoiceMinutes} minutes.</p>
      ${PK.field({ id: "nm", f: "name", label: "Name", auto: "name", value: S.name, ph: "Full name" })}
      ${PK.field({ id: "org", f: "org", label: "Company name", auto: "organization", value: S.org, ph: "Company name" })}
      ${PK.field({ id: "tax", f: "tax", label: "GST / Tax ID", value: S.tax, max: 20, cls: "pk-up", ph: "For example 27ABCDE1234F1Z5" })}
      ${PK.errBox()}
      <div class="pk-btns"><button class="pk-btn" id="invadd" type="button">Add to my invoice</button><button class="pk-btn alt" id="invskip" type="button">Skip</button></div></div>`;
  };
  /** The first thing wrong with the optional details: {id, msg} or null (the Worker checks the same two rules again). */
  PK.validateInvoice = (S, country) => {
    const tax = (S.tax || "").trim().toUpperCase(), org = (S.org || "").trim();
    if (tax && (country || "IN") === "IN" && !GSTIN_RE.test(tax)) return { id: "tax", msg: GSTIN_MSG };
    if (tax && !org && PK.RULES.taxIdNeedsCompany) return { id: "org", msg: COMPANY_MSG };
    return null;
  };
  /** The two buttons of the form. o: paymentId, country, keys (the draft keys), save, onDone(receipt). Sends the details, or `skip`, once; the Worker issues the tax invoice and answers with the receipt. */
  PK.invoiceWire = (root, S, o) => {
    const add = root.querySelector("#invadd"), skip = root.querySelector("#invskip"); if (!add || !skip) return;
    const go = async (isSkip) => {
      PK.setError(root, "");
      PK.sync(root, S, ["name", "org", "tax"]);
      if (!isSkip) { const bad = PK.validateInvoice(S, o.country); if (bad) return PK.setError(root, bad.msg, bad.id); }
      add.disabled = skip.disabled = true; (isSkip ? skip : add).classList.add("is-busy");
      PK.say(root, "Sending…");
      try {
        const body = isSkip ? { skip: true } : { name: (S.name || "").trim(), org: (S.org || "").trim(), taxId: (S.tax || "").trim().toUpperCase() };
        const r = await TB.api("POST", `/api/payments/${o.paymentId}/invoice`, body);
        if (!isSkip) TB.payer.save({ ...TB.payer.load(), name: S.name, org: S.org, tax: S.tax });
        o.onDone(r);
      } catch (e) {
        add.disabled = skip.disabled = false; add.classList.remove("is-busy"); skip.classList.remove("is-busy"); PK.say(root, "");
        PK.setError(root, PK.friendly(e, true));
      }
    };
    add.addEventListener("click", () => go(false)); skip.addEventListener("click", () => go(true));
  };
  /** After a reload: the receipt of the payment this tab already made (S.paid), or null. Forgets an id the Worker does not know. */
  PK.loadReceipt = async (S) => {
    if (!/^pay_[0-9a-f]{16}$/.test(S.paid || "")) { S.paid = ""; return null; }
    try { const r = await TB.api("GET", `/api/payments/${S.paid}/receipt`); if (r && !r.confirming) return r; }
    catch (e) { if (e.status === 404) S.paid = ""; }
    return null;
  };
  /** o: title, lead, forLabel / forHtml (what it was for), email (the invoice goes here by default), rows (more [label, html] rows), after (html below the invoice), form (html of the optional-details form) */
  PK.receipt = (d, o) => {
    const B = PK.BRAND, r = [], py = d.payer || {};
    r.push(PK.row("For", o.forHtml || esc(o.forLabel || "")));
    if (d.total != null) r.push(PK.row("Amount paid", money(d.total, d.currency || "INR")));
    r.push(PK.row("Paid to", `${esc(B.payee)}<small>through Razorpay</small>`));
    if (py.method) { const det = py.methodDetail || "", how = det && det.toLowerCase().indexOf(String(py.method).toLowerCase()) === 0 ? det : det ? py.method + " · " + det : py.method; r.push(PK.row("Paid with", esc(how))); } // "UPI ID as***@okhdfc" already starts with the method; "Visa credit card ending 1111" does not
    if (py.email) r.push(PK.row("E-mail (from Razorpay)", esc(py.email)));
    if (py.phone) r.push(PK.row("Mobile (from Razorpay)", esc(py.phone)));
    r.push(PK.row("Razorpay transaction ID", esc(d.razorpayPaymentId || "being confirmed, see your e-mail"), "mono"));
    if (d.orderId) r.push(PK.row(`${B.name} payment confirmation ID`, esc(d.orderId), "mono"));
    if (d.invoiceNumber) r.push(PK.row("Invoice number", esc(d.invoiceNumber), "mono"));
    for (const x of o.rows || []) r.push(PK.row(x[0], x[1], x[2]));
    const mail = py.email || o.email || "";
    return `<section class="pk-card done" role="status"><div class="pk-done-head"><span class="tick">${I.check}</span><div><h2>${esc(o.title || "Payment received")}</h2><p>${o.lead || ""}</p></div></div><dl class="pk-dl">${r.join("")}</dl>${d.invoicePending ? (o.form || "") : ""}${PK.invoice(d, mail)}${d.invoiceUrl && py.email ? `<p class="pk-note">We e-mailed your tax invoice to <b>${esc(py.email)}</b>.</p>` : ""}${o.after || ""}</section>`;
  };
  /** the proforma invoice (not paid), folded away until asked for; same ids as before so TB.proformaWire still works */
  PK.proforma = () => '<details class="pk-pf"><summary>Proforma invoice (not paid)</summary><div class="in"><div class="pk-invbody" id="pfbody">Preparing your proforma invoice...</div><div class="pk-btns"><button class="pk-btn alt" id="pfpay" type="button">Pay now</button></div></div></details>';
  PK.page = (root, html, focus) => { root.innerHTML = html; if (focus) { const h = root.querySelector("#pk-h1"); if (h) try { h.focus({ preventScroll: false }); } catch (e) { /* fine */ } } };

  // older callers (and any page not yet moved to the kit) get the new look through the old names
  TB.payBrand = () => "";
  TB.payReceipt = (d, gameId) => PK.receipt(d, { forLabel: gameId || d.eid || "", lead: "" });
  TB.invoiceBox = PK.invoice;
  TB.proformaBox = PK.proforma;
})();
