/* Corporate Tic Tac Toe, the organizer console: ONE page with numbered, colourful steps that talk you through the game (see docs/ROLES_AND_CONSOLE_SPEC.md).
   Organizer and Host see ten steps; a Co-host sees three. It works on the owner's own machine; the game itself runs on the phones.
   The page holds the sign-in key only in this tab's session. Choices are tap chips, never drop-down lists. */
(function () {
  const ZG = window.ZG;
  const $app = document.getElementById("app");
  const q = new URLSearchParams(location.search);
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let secret = ss.get("cbz-org") || "";
  { const m = location.hash.match(/^#(?:host|cohost)=(cb[hc]_[0-9a-f]{48})$/); if (m) { secret = m[1]; ss.set("cbz-org", secret); history.replaceState(null, "", location.pathname + location.search); } } // a Host or Co-host link: the key leaves the address bar at once
  { const k = q.get("k"); if (k && /^cb[hca]_[0-9a-f]{48}$/.test(k)) { secret = k; ss.set("cbz-org", secret); q.delete("k"); const rest = q.toString(); history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "")); } }
  let eid = q.get("e") || "";
  const ACT = (q.get("do") || "").toLowerCase(); // a hand-over link from the AI assistant: opens the exact card; the organizer presses the button
  const QUICK = q.get("quick") === "1";
  // A browser AI may open this page in a new tab, and a tab holds the key only for itself: another open tab of the same browser can hand it over (same site, same browser, never stored).
  const bc = typeof BroadcastChannel === "function" ? new BroadcastChannel("cbz-org-key") : null;
  const OLD_HOUSES = []; // the shared table (ZG.PRIZE_HOUSES) is the only source of the houses
  const HOUSES = ZG && Array.isArray(ZG.PRIZE_HOUSES) && ZG.PRIZE_HOUSES.length ? ZG.PRIZE_HOUSES : OLD_HOUSES;
  const NAMES = Object.fromEntries(HOUSES.map((h) => [h.id, h.label]));
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-organizer": secret }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 403 && j.code === "consent-required" && !S.k5need) { S.k5need = true; setTimeout(redraw, 0); } // 403 + consent-required is the K5 role gate (a Co-host or Host who has not yet ticked the box): the console shows that box first
      throw Object.assign(new Error(j.error || "http " + r.status), { code: j.code, group: j.group, status: r.status, needPack: j.needPack, payments: j.payments });
    }
    return j;
  };
  // ---- consent boxes (termsbox.js, product rule 2026-10-13): wording comes from the server, a box is never pre-ticked, the button stays disabled until every box is ticked, the ticks travel as consent: {version,boxes}.
  // The console redraws often, so a slot is only a placeholder in the HTML (tbSlot); mountTerms() draws the boxes after each redraw and puts the ticks back from TK.
  const TK = {}; // key -> { ok, consent: terms }
  const tbSlot = (key, group, btns) => `<div class="tbslot" data-tbk="${key}" data-tbg="${group}" data-tbbtn="${btns || ""}"></div>`;
  const tbOk = (key) => !!(TK[key] && TK[key].ok);
  const tbTerms = (key) => (TK[key] && TK[key].ok ? TK[key].terms : undefined);
  const tbDis = (key) => (tbOk(key) ? "" : "disabled");
  function mountTerms() {
    if (!window.TermsBox) return;
    $app.querySelectorAll("[data-tbk]").forEach((slot) => {
      const key = slot.dataset.tbk, saved = (TK[key] && TK[key].terms && TK[key].terms.boxes) || [];
      const sync = (ok) => String(slot.dataset.tbbtn || "").split(",").filter(Boolean).forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = !ok; });
      window.TermsBox.mount(slot, slot.dataset.tbg, { base: BASE }).then((t) => {
        if (!slot.isConnected) return;
        const upd = () => { TK[key] = { ok: t.ok(), terms: t.terms() }; sync(t.ok()); };
        slot.querySelectorAll("input[data-box]").forEach((c) => { if (saved.includes(c.dataset.box)) c.checked = true; c.addEventListener("change", upd); });
        upd();
      }).catch(() => {});
    });
  }
  const S = { kind: "", annNote: "", aiMsg: ss.get("cbz-aimsg") || "", contact: { email: ss.get("cbz-email") || "", phone: ss.get("cbz-phone") || "" }, info: null, people: [], claims: [], control: null, results: [], store: null, log: [], note: "", history: null, busy: false,
    open: 0, sheet: false, q: -1, f: null, sum: null, team: null, teamNote: "", teamLinks: {}, teamWa: {}, myId: "", coh: null, cohErr: "", done: {}, mode: "type", recent: [], acct: false, hostN: 0 };
  const role = () => (S.kind === "cohost" ? "cohost" : S.kind === "host" ? "host" : /^(partner|refer|sales)/.test(S.kind) ? "partner" : "organizer");
  const isOrg = () => role() === "organizer";
  const canRun = () => role() === "organizer" || role() === "host"; // the full game console
  const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const pad2 = (n) => String(n).padStart(2, "0");
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
  /** How far the organizer's time zone is ahead of UTC at the instant ms (daylight saving included). */
  const tzOffsetMs = (ms) => { try { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)); const g = (k) => Number(p.find((x) => x.type === k).value); return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000; } catch { return 0; } };
  /** The UTC instant of a wall-clock time in the organizer's time zone. */
  const localToUtc = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h, mi); return guess - tzOffsetMs(guess - tzOffsetMs(guess)); };
  const tzName = () => TZ.replace(/_/g, " ");
  const istNow = () => new Date(Date.now() + tzOffsetMs(Date.now())); // a date whose UTC fields read as the organizer's wall clock
  const istDateStr = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const dmy = (ms) => new Date(ms).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const money = (n) => "Rs " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inIndia = () => /^Asia\/(Kolkata|Calcutta)$/.test(TZ);
  /** The price in both currencies, the one the organizer is likelier to pay in first. */
  const priceText = (s) => (s.priceUsd ? (inIndia() ? money(s.priceInr) + " or " + usd(s.priceUsd) : usd(s.priceUsd) + " or " + money(s.priceInr)) : money(s.priceInr));
  const usd = (n) => "US$ " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const randId = () => "E" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  async function latestRound() { const x = await ZG.fetchRound("latest"); return x ? x.round : null; }

  // ---------- the steps ----------
  // [number, title, colour, short hint (shown when the step is open or has nothing to summarise), what the console says when you open it]
  const FULL = [
    [1, "Date and time of the game", "blue", "Pick the occasion, day and time.", "Hello. Let us start with the basics."],
    [2, "Number of participants", "aqua", "How many players, and who can join.", "Good. Now, how many players, and who can join?"],
    [3, "Set Prizes", "violet", "Tick the places you give a prize for. Pick what each one is.", "Now the fun part: prizes for the top places."],
    [4, "Your brand", "magenta", "Add your company name, colour and logo.", "Want your brand on the page?"],
    [5, "Make hosts and co-hosts", "green", "Add Hosts and Co-hosts. Send each link to one person.", "Who is helping you?"],
    [6, "Invite and Share links", "yellow", "Share the link. Add your people.", "Time to bring people in."],
    [7, "Check and publish", "orange", "Check everything. Then publish, free.", "Almost there. One last look."],
    [8, "Pay", "lime", "Pay once, before the start time.", "Last thing: payment."],
    [9, "Game day", "violet", "Run the game. Message your guests.", "It is game day."],
    [10, "After the game", "red", "Get your report. Erase data if you want.", "That was fun. Here is what is left."],
  ];
  const COH = [
    [1, "Today's game", "blue", "See the game and its payment.", "Hi. Here is the game."],
    [2, "Invite people", "green", "Send your link to your people.", "Bring your people in."],
    [3, "Payment", "orange", "Anyone can pay. Then the game is on.", "One more thing: payment."],
  ];
  const ROLE_NOTE = { organizer: "You made this game. You can do everything.", host: "You have the Organizer's rights for this game. Not the account.", cohost: "You can invite people and pay. Nothing else.", partner: "This is your partner area." };
  const steps = () => (role() === "cohost" ? COH : FULL);
  const doneKey = () => "cbz-prog-" + eid + "-" + role();
  const loadDone = () => { try { S.done = JSON.parse(ls.get(doneKey()) || "{}") || {}; } catch { S.done = {}; } };
  const saveDone = () => ls.set(doneKey(), JSON.stringify(S.done));
  const markDone = (n) => { S.done[n] = 1; saveDone(); };
  /** A step is done when the owner said so, or when the game itself proves it. */
  const isDone = (n) => !!S.done[n] || (role() !== "cohost" && n === 7 && !!S.info && !S.draft) || (role() !== "cohost" && n === 8 && !!S.info && !S.draft && payState().paid) || (role() === "cohost" && n === 3 && payState().paid);
  const nextStep = () => steps().find((s) => !isDone(s[0])) || null;

  // ---------- who paid ----------
  /** One payment is enough for the game. The server says who paid; until it does, the old signals (published and not unpaid) stand in. */
  function payState() {
    const p = (S.sum && S.sum.payment && typeof S.sum.payment === "object" ? S.sum.payment : null) || (S.coh && S.coh.payment && typeof S.coh.payment === "object" ? S.coh.payment : null);
    if (p && p.status) return { paid: p.status === "paid", confirming: p.status === "confirming", paidBy: p.paidBy || "", paidMs: p.paidMs || 0 };
    if (S.coh && typeof S.coh.payment === "string") return { paid: S.coh.payment === "paid", confirming: S.coh.payment === "confirming", paidBy: "", paidMs: 0 };
    return { paid: !!S.info && !S.draft && !S.unpaid, paidBy: "", paidMs: 0 };
  }
  const payLabel = (p) => (p.paid ? "Paid" : p.confirming ? "Confirming your payment..." : "Payment pending for this game");
  const isCancelled = () => !!(S.cancelDone || (S.sum && (S.sum.cancelled || S.sum.status === "cancelled")) || (S.coh && S.coh.cancelled) || (S.info && S.info.cancelled));
  const WHO = { organizer: "Organizer", host: "Host", "co-host": "Co-host", cohost: "Co-host" };

  // ---------- the choices (the form state: it lives here, so a refresh never loses what you are typing) ----------
  const OCC = ["Team event", "Holiday party", "All-hands opener", "New-hire welcome", "Customer event", "Friday team break", "Family day", "Diwali party", "Other"];
  const TIMES = [["09:00", "9 am"], ["10:00", "10 am"], ["12:00", "12 pm"], ["13:00", "1 pm"], ["15:00", "3 pm"], ["16:00", "4 pm"], ["18:00", "6 pm"], ["19:00", "7 pm"], ["other", "Other time"]];
  const HS = HOUSES.map((h) => [h.id, h.label, h.how, h.max]); // [id, label, how to win, most winners]
  const maxOf = (k) => (HS.find((h) => h[0] === k) || [0, 0, 0, 5])[3];
  const BUNDLES = { Classic: { first: 1, second: 1, third: 1 }, Simple: { first: 1 }, Rich: { first: 1, second: 1, third: 1, fourth: 1, fifth: 1 } }; // the places a tournament names: the keys stay (the AI and saved games use them), the words on the buttons are in BUNDLE_WORDS
  const BUNDLE_WORDS = { Classic: "Top 3 places", Simple: "Champion only", Rich: "Top 5 places", "Choose myself": "Choose myself" };
  // [key, label, currency prefix, what to ask]. "Decide later" saves an empty prize; "No prize" saves the words No prize, so the card shows them.
  const PT = [["voucher", "Gift card", "", "Amount, for example $25 or Rs 1000"], ["hamper", "Gift hamper", "", "What is in it? (optional)"], ["phone", "Smartphone", "", "Which one? (optional)"], ["watch", "Smart watch", "", "Which one? (optional)"], ["earbuds", "Earbuds or headphones", "", "Which one? (optional)"], ["tablet", "Tablet or laptop", "", "Which one? (optional)"], ["holiday", "Holiday or weekend stay", "", "Where?"], ["dinner", "Restaurant gift card", "", "Amount, for example $50"], ["movie", "Movie tickets", "", "How many tickets?"], ["dayoff", "Extra day off", "", ""], ["other", "Something else", "", "Type the prize"], ["later", "I will decide later", "", ""], ["none", "No prize", "", ""]];
  const KINDS = [["msg", "Type a message"], ["yt", "YouTube link"], ["vid", "Paste video file link"], ["aud", "Paste audio file link"]];
  const SERVER_KIND = { msg: "speech", yt: "youtube", vid: "file", aud: "file", slides: "slides" };
  const DEFAULT_TITLE = "A message from your organizer";
  const ptOf = (k) => PT.find((p) => p[0] === k);
  /** The words a prize choice becomes on the card. */
  function prizeText(pt, pd) {
    const p = ptOf(pt), d = String(pd || "").trim();
    if (!p || pt === "later") return "";
    if (pt === "none") return "No prize";
    if (pt === "other") return d || "Something else";
    return p[1] + (d ? (p[2] ? ": Rs " + d.replace(/^Rs\.?\s*/i, "") : ": " + d) : "");
  }
  /** The other way round: a saved prize text becomes a choice again. */
  function prizeFrom(text) {
    const t = String(text || "").trim();
    if (!t) return { pt: "later", pd: "" };
    if (t === "No prize") return { pt: "none", pd: "" };
    for (const p of PT.filter((x) => !["later", "none", "other"].includes(x[0]))) {
      if (t === p[1]) return { pt: p[0], pd: "" };
      if (t.startsWith(p[1] + ": ")) return { pt: p[0], pd: t.slice(p[1].length + 2).replace(/^Rs\s*/, "") };
    }
    return { pt: "other", pd: t };
  }
  const ptext = (pt, pd) => (pt === "later" ? "Decide later" : pt === "none" ? "No prize" : prizeText(pt, pd) || "Not chosen");
  const mediaKind = (u) => (/\.(mp3|m4a|aac|wav|ogg|oga)([?#]|$)/i.test(u) ? "aud" : "vid");
  /** A saved brand moment becomes a row of the form. */
  function momentFrom(b) {
    if (!b) return { k: "msg", v: "", t: "", s: "" };
    const url = b.mediaUrl || "";
    const k = b.kind === "slides" ? "slides" : b.kind === "youtube" ? "yt" : b.kind === "file" ? mediaKind(url) : url ? (/youtu/i.test(url) ? "yt" : mediaKind(url)) : "msg";
    return { k, v: url, t: b.title || "", s: b.seconds ? String(b.seconds) : "", ...(b.after && !b.auto ? { after: b.after } : {}) };
  }
  const momentEmpty = (m) => !(m.t || "").trim() && !(m.v || "").trim();
  /** A row of the form becomes what the server saves. Rows with nothing in them are left out. */
  function momentOut(m, withAfter) {
    if (momentEmpty(m)) return null;
    const kind = SERVER_KIND[m.k] || "speech";
    const b = { kind, title: (m.t || "").trim() || DEFAULT_TITLE };
    if (m.k !== "msg" && (m.v || "").trim()) b.mediaUrl = m.v.trim();
    if (String(m.s || "").trim()) b.seconds = Number(m.s);
    if (withAfter && m.after) b.after = m.after;
    return b;
  }
  const dayOpts = () => { const base = istNow(), out = []; for (let i = 0; i < 5; i++) { const d = new Date(base.getTime() + i * 86400000); out.push([istDateStr(d), i === 0 ? "Today" : i === 1 ? "Tomorrow" : DOW[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()]]); } return out; };
  const whoNow = () => { const w = (S.sum && S.sum.whoCanJoin) || S.whoCanJoin; return w === "anyone" ? "anyone" : "list"; };
  const maxFor = (t) => ({ op: t, mid: 3 * t, cl: t });

  /** Builds the form from what the server holds. */
  function formFromServer() {
    const c = S.cfg || ZG.defaultCfg(), t = c.tickets === 2 ? 2 : 1, inf = S.info || {};
    const blank = S.cloneNew === eid && S.cloneDated !== eid; // a game made like another: the date and time are picked again
    const start = inf.startMs ? new Date(inf.startMs + tzOffsetMs(inf.startMs)) : new Date(Date.now() + 86400000 + tzOffsetMs(Date.now() + 86400000));
    const date = istDateStr(start), time = pad2(start.getUTCHours()) + ":" + pad2(start.getUTCMinutes());
    const nm = (c.name || "").trim();
    const f = { occ: nm ? (OCC.includes(nm) && nm !== "Other" ? nm : "Other") : "Team event", oname: nm && !OCC.includes(nm) ? nm : "", day: blank ? "" : dayOpts().some((d) => d[0] === date) ? date : "other", dayo: blank ? "" : date, time: blank ? "" : TIMES.some((x) => x[0] === time) ? time : "other", timeo: blank ? "" : time,
      cap: String(inf.cap || 250), tix: String(t), mk: c.mark === "tap" ? "tap" : "auto", gj: c.join === "phone" ? "phone" : "name", spd: String(inf.callSeconds || 9), rnd: String(c.rounds || 1), who: whoNow(),
      inv: !!(c.invites && c.invites.on), per: String((c.invites && c.invites.per) || 4), cats: ((c.invites && c.invites.cats) || ["family", "colleagues"]).slice(), bundle: "", hs: {}, ph: "" };
    for (const [k] of HS) f.hs[k] = { on: false, n: 1, pt: "later", pd: "", orig: [] };
    for (const l of c.rewards || []) { const k = l.pattern, h = f.hs[k]; if (!h) continue; h.on = true; h.n = Math.max(h.n, l.ordinal); h.orig[l.ordinal - 1] = l.text || ""; }
    for (const [k] of HS) { const h = f.hs[k]; if (h.on) { const a = prizeFrom(h.orig[0]); h.pt = a.pt; h.pd = a.pd; h.same = h.orig.every((x) => (x || "") === (h.orig[0] || "")); h.diff = !h.same; if (h.diff) h.per = Array.from({ length: h.n }, (_, i) => prizeFrom(h.orig[i])); } }
    f.ph = (HS.find(([k]) => f.hs[k].on) || ["blackout"])[0];
    const pad = (arr, n) => { const o = arr.slice(0, n); while (o.length < n) o.push({ k: "msg", v: "", t: "", s: "" }); return o; };
    const lk = (c.breaks || []).filter((b) => b.kind === "lucky"), mk = (c.breaks || []).filter((b) => b.kind !== "lucky");
    f.brand = Object.assign({ name: "", color: "", logo: "" }, inf.brand || (S.sum && S.sum.brand) || {}); f.opN = (c.opening || []).length; f.op = pad((c.opening || []).map(momentFrom), 2);
    f.midN = mk.length; f.mid = pad(mk.map(momentFrom), 6);
    f.clN = (c.closing || []).length; f.cl = pad((c.closing || []).map(momentFrom), 2);
    f.lucky = lk.map((b) => { const a = prizeFrom(b.title === "Lucky draw" ? "" : b.title); return { win: String(b.winners || 3), style: b.style === "scratch" ? "scratch" : "draw", pt: a.pt, pd: a.pd, ...(b.after && !b.auto ? { after: b.after } : {}) }; });
    return f;
  }
  const getP = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), S.f);
  const setP = (path, v) => { const ks = path.split("."), last = ks.pop(); const o = ks.reduce((x, k) => x[k], S.f); o[last] = v; };
  const usedMoments = () => { const f = S.f, t = Number(f.tix) || 1, lim = maxFor(t); const n = (rows, N, cap) => rows.slice(0, Math.min(N, cap)).filter((m) => !momentEmpty(m)).length; return n(f.op, f.opN, lim.op) + n(f.mid, f.midN, lim.mid) + f.lucky.length + n(f.cl, f.clN, lim.cl); };

  // ---------- small pieces ----------
  const lbl = (id, t) => `<label class="zc-lbl" for="${id}">${t}</label>`;
  const fid = (path) => "f-" + path.replace(/\./g, "-");
  const inp = (path, o = {}) => `<input id="${fid(path)}" class="zc-in" data-fi="${path}"${o.type ? ` type="${o.type}"` : ""}${o.ph ? ` placeholder="${esc(o.ph)}"` : ""}${o.max ? ` maxlength="${o.max}"` : ""}${o.attrs ? " " + o.attrs : ""} value="${esc(getP(path))}">`;
  const chip = (path, v, l, multi) => { const cur = getP(path); const on = multi ? (cur || []).includes(v) : String(cur) === String(v); return `<button type="button" class="zc-chip${on ? " on" : ""}" data-ck="${path}" data-v="${esc(v)}"${multi ? ' data-multi="1"' : ""} aria-pressed="${on}">${esc(l)}</button>`; };
  const gid = (path) => "gl-" + path.replace(/\./g, "-");
  const grp = (path, label, opts, multi) => `<span class="zc-lbl" id="${gid(path)}">${label}</span><div class="zc-chips" role="group" aria-labelledby="${gid(path)}">${opts.map(([v, l]) => chip(path, v, l, multi)).join("")}</div>`;
  const bchip = (path, label) => { const on = !!getP(path); return `<button type="button" class="zc-chip${on ? " on" : ""}" data-bool="${path}" aria-pressed="${on}">${esc(label)}</button>`; };
  const cont = (n, label) => `<div class="zc-foot"><button class="zc-btn" type="button" data-save="${n}">${label || "Continue"}</button></div>`;
  const save = (n, label) => `<div class="zc-foot"><button class="zc-btn" type="button" data-save="${n}">${label || "Save and continue"}</button></div>`;
  const small = (t, extra) => `<p class="zc-small"${extra ? " " + extra : ""}>${t}</p>`;
  const rowl = (left, right) => `<div class="zc-rowl"><span>${left}</span>${right || ""}</div>`;
  const lockedGame = () => !!S.started && !S.draft && !S.unpaid;
  const lockedNote = () => small("The game has started, so this can no longer be changed.");
  const when = (ms) => dmy(ms).replace(/,/g, "");
  const ist = (ms) => dmy(ms); // a friendly date and time, for example 11 Jan 2027, 3:16 pm
  const dayIst = (ms) => new Date(ms).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
  const pl = (n, one, many) => n + " " + (n === 1 ? one : many);

  /** Prize choice: chips for the ten popular prizes, "I will decide later" and "No prize", with the input beside the chosen one. */
  function prizePick(ptPath, pdPath) {
    const pt = getP(ptPath), p = ptOf(pt);
    let h = `<div class="zc-chips" role="group" aria-label="What is the prize?">${PT.map((x) => chip(ptPath, x[0], x[1])).join("")}</div>`;
    if (p && p[3]) h += `<div class="zc-inline">${p[2] ? `<span>${p[2]}</span>` : ""}<label class="zc-sr" for="${fid(pdPath)}">${esc(p[3])}</label>${inp(pdPath, { ph: p[3], max: 70 })}</div>`;
    if (pt === "later") h += small("Fine. We will remind you before you publish.");
    if (pt === "none") h += small("The results show \"No prize\" for this place. The winner is still announced.");
    return h;
  }

  // ---------- step 1: your game ----------
  function stepGame() {
    if (!S.f) return small("Loading…");
    if (lockedGame()) return lockedNote() + readBack();
    const f = S.f, min = istDateStr(istNow()), max = istDateStr(new Date(istNow().getTime() + 30 * 86400000));
    return (S.cloneNew === eid && S.cloneDated !== eid ? `<div class="zc-box" id="newgameread"><b class="zc-bt">This is a new game. Nothing is paid or published yet.</b>${readBack()}</div>` : "") + grp("occ", "What is the occasion?", OCC.map((o) => [o, o]))
      + (f.occ === "Other" ? `<div class="zc-gap">${lbl("f-oname", "Name your game")}${inp("oname", { max: 60, ph: "Name your game" })}</div>` : "")
      + grp("day", `Which day? (your time, ${tzName()})`, dayOpts().concat([["other", "Pick another date"]]))
      + (f.day === "other" ? `<div class="zc-gap">${lbl("f-dayo", "Pick the date")}${inp("dayo", { type: "date", attrs: `min="${min}" max="${max}"` })}</div>` : "")
      + grp("time", "What time does it start?", TIMES)
      + (f.time === "other" ? `<div class="zc-gap">${lbl("f-timeo", "Pick the time")}${inp("timeo", { type: "time", attrs: 'step="300"' })}</div>` : "")
      + small("Players can join before. You press Start on the tournament page when everybody is in.") + save(1);
  }

  // ---------- step 2: how it plays ----------
  // the gap between two numbers: 9 or 12 seconds (an older game that uses 6 or 15 keeps its own value so it never disappears)
  const spdOpts = (cur) => { const o = [["9", "9 seconds"], ["12", "12 seconds"]]; const c = String(cur || ""); if (c && c !== "9" && c !== "12") { o.push([c, c + " seconds"]); o.sort((a, b) => Number(a[0]) - Number(b[0])); } return o; };
  const capOptions = () => {
    const packs = (S.packs || []).map((k) => ({ n: k.upTo, price: k.inr })), cur = Number(S.f.cap);
    const list = packs.length ? packs : [100, 250, 500, 1000].map((n) => ({ n, price: 0 }));
    if (cur && !list.some((p) => p.n === cur)) list.push({ n: cur, price: 0 }), list.sort((a, b) => a.n - b.n);
    return list;
  };
  function stepPlay() {
    if (!S.f) return small("Loading…");
    if (lockedGame()) return lockedNote() + readBack();
    const f = S.f, cats = ZG.INVITE_CATEGORIES || [];
    const caps = capOptions().map((p) => `<button type="button" class="zc-chip${String(f.cap) === String(p.n) ? " on" : ""}" data-ck="cap" data-v="${p.n}" aria-pressed="${String(f.cap) === String(p.n)}"><span>Up to ${p.n} people</span></button>`).join("");
    const own = `<div class="zc-gap">${lbl("f-cap", "Or type your own number of players")}${inp("cap", { type: "number", ph: "For example 180", attrs: 'inputmode="numeric" min="1" max="10000" step="1"' })}</div>`;
    return `<span class="zc-lbl zc-sec zc-sub">How many players</span><span class="zc-lbl" id="gl-cap">How many people at most?</span><div class="zc-chips" role="group" aria-labelledby="gl-cap">${caps}</div>` + own + small("Invited guests count too. The price is shown when you pay.")
      + `<span class="zc-lbl zc-sec zc-sub">How the tournament runs</span>` + small("It is a knockout: players meet one against one (or in teams of 3 or 5), the winner moves up, and there is one champion. A drawn game is played again with the marks swapped, up to three games, and then fate decides. You choose the format and the move clock (10, 20, 30 or 60 seconds) on the day, on the tournament page, just before you press Start.")
      + `<span class="zc-lbl zc-sec zc-sub">Who can join</span>` + grp("who", "Who can join?", [["list", "Only people on a list"], ["anyone", "Anyone with the link"]])
      + small("Players type only their name. The common link works in Slack, Teams or Zoom chat. Personal links from a list still work.")
      + small(f.who === "list" ? "Only people you have added can join straight away. Anyone else who clicks your link has to wait until you or a Host says yes." : "Anyone who clicks your link joins straight away. You can change this until the tournament starts.")
      + save(2);
  }

  // ---------- step 3: prizes ----------
  /** Make sure the per-winner prizes list has one entry for each winner (new ones start as a copy of the first). */
  function perFill(h) { h.per = h.per || []; const n = Number(h.n) || 1; while (h.per.length < n) h.per.push({ pt: h.pt, pd: h.pd }); return h.per; }
  function houseBox([k, name, how, max0]) {
    const f = S.f, h = f.hs[k], act = f.ph === k && h.on, max = Math.max(Number(max0) || 1, Number(h.n) || 1);
    const sumry = `${h.n} winner${Number(h.n) === 1 ? "" : "s"} · ${esc(h.diff ? "a prize for each" : ptext(h.pt, h.pd))}`;
    let body = "";
    if (act) {
      body += max > 1 ? grp(`hs.${k}.n`, "How many winners?", Array.from({ length: max }, (_, i) => [String(i + 1), String(i + 1)])) : small("One winner.");
      if (Number(h.n) > 1) body += `<div class="zc-chips zc-gap">${bchip(`hs.${k}.diff`, "A different prize for each winner")}</div>`;
      if (h.diff && Number(h.n) > 1) { const per = perFill(h); body += per.slice(0, Number(h.n)).map((_, i) => `<span class="zc-lbl">Prize for winner ${i + 1}</span>${prizePick(`hs.${k}.per.${i}.pt`, `hs.${k}.per.${i}.pd`)}`).join(""); }
      else body += `<span class="zc-lbl">What is the prize?</span>${prizePick(`hs.${k}.pt`, `hs.${k}.pd`)}`;
    }
    return `<div class="zc-box" data-house="${k}"><div class="zc-split"><label class="zc-check"><input type="checkbox" data-hc="${k}" ${h.on ? "checked" : ""}> ${esc(name)}</label>${h.on && !act ? `<span class="zc-split"><span class="zc-small zc-nomargin">${sumry}</span><button type="button" class="zc-mini" data-ph="${k}" aria-label="Change ${esc(name)}">Change</button></span>` : ""}</div><p class="zc-small zc-how">${esc(how || "")}</p>${body}</div>`;
  }
  function stepPrizes() {
    if (!S.f) return small("Loading…");
    if (lockedGame()) return lockedNote() + readBack();
    return grp("bundle", "Start from", ["Classic", "Simple", "Rich", "Choose myself"].map((b) => [b, BUNDLE_WORDS[b]]))
      + `<span class="zc-lbl">Tick the prizes. Each one says how to win.</span>` + HS.map(houseBox).join("")
      + small("You give the prizes. We provide the software.") + save(3);
  }

  // ---------- brand strip on the guest's card (Phase 3): company name, accent colour, a small logo ----------
  const BRAND_COLORS = [["#0B3D91", "Navy"], ["#1B7F5C", "Green"], ["#B3261E", "Red"], ["#6A1B9A", "Purple"], ["#C26A00", "Saffron"], ["#00798C", "Teal"], ["#37474F", "Charcoal"], ["#AD1457", "Pink"]]; // the eight colours the server accepts
  const previewUrl = () => "/preview.html#w=player&e=" + encodeURIComponent(eid);
  const previewButton = () => (canRun() && eid ? `<div class="zc-chips zc-gap"><a class="zc-chip" id="seeguests" href="${esc(previewUrl())}" target="_blank" rel="noopener">See what players see</a></div>${small("A sample player page, marked PREVIEW. Nothing is sent to anyone.")}` : "");
  function brandBox() {
    const b = S.f.brand;
    return `<div class="zc-block" id="brandbox"><h3>Your brand on the page</h3>${small("Shown at the top of every player's page. All of it is optional.")}${lbl("f-brand-name", "Company name")}${inp("brand.name", { max: 40, ph: "Company name" })}
      <span class="zc-lbl" id="gl-brandcolor">Accent colour</span><div class="zc-chips" role="group" aria-labelledby="gl-brandcolor">${BRAND_COLORS.map(([v, l]) => `<button type="button" class="zc-chip${b.color === v ? " on" : ""}" data-ck="brand.color" data-v="${v}" aria-pressed="${b.color === v}"><span class="zc-sw" style="background:${v}" aria-hidden="true"></span>${l}</button>`).join("")}</div>
      ${lbl("brandlogo", "Small logo (optional)")}<input id="brandlogo" class="zc-in" type="file" accept="image/png,image/jpeg,image/webp">${small(LOGO_RULES)}${b.logo ? `<div class="zc-logo"><img src="${esc(b.logo)}" alt="Your logo" width="48" height="48"><button type="button" class="zc-mini zc-danger" id="logorm">Remove logo</button></div>` : ""}${S.logoNote ? `<p class="zc-small zc-warnt" id="logonote" role="status">${esc(S.logoNote)}</p>` : small("We make it small for you, under 30 KB.")}
      ${previewButton()}</div>`;
  }
  // The logo rules (the same numbers as packages/beacon/src/config.ts, which the server enforces)
  const LOGO_RULES = "PNG, JPEG or WebP, up to 5 MB, at least 64 x 64 pixels, square or wide (at most 4 times wider than tall). Best: a square 256 x 256 picture with a white or see-through background. We shrink it to fit (30 KB, 192 pixels) and show it 30 pixels high on every page, in the browser and in the installed app.";
  /** Shrinks the chosen picture in the browser to a PNG or JPEG data URL of at most 30 KB. Nothing is sent anywhere else. */
  async function fitLogo(file) {
    // read as a data: URL (the page's security policy allows data: images, not blob: ones)
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("bad")); r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad")); i.src = url; });
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height; if (!w0 || !h0) throw new Error("bad");
    if (Math.min(w0, h0) < 64) throw new Error("small");
    if (Math.max(w0, h0) > 4 * Math.min(w0, h0)) throw new Error("thin");
    const bytes = (d) => Math.ceil((d.length - d.indexOf(",") - 1) * 3 / 4);
    for (const side of [192, 144, 112, 80, 56]) {
      const k = Math.min(1, side / Math.max(w0, h0)), W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
      for (const [type, q, white] of [["image/png", undefined, false], ["image/jpeg", 0.85, true], ["image/jpeg", 0.6, true]]) {
        const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); if (white) { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); } g.drawImage(img, 0, 0, W, H);
        const d = c.toDataURL(type, q); if (d.startsWith("data:" + type) && bytes(d) <= 30720) return d;
      }
    }
    throw new Error("big");
  }
  // ---------- a payment link anyone can open ----------
  function payLinkBlock() {
    if (S.draft || isCancelled() || didNotStart() || payState().paid || payState().confirming) return "";
    return `<div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="copypaylink">${S.payUrl ? "Copy payment link again" : "Copy payment link"}</button></div>${S.payLinkNote ? `<p class="zc-small" id="paylinknote" role="status">${esc(S.payLinkNote)}</p>` : ""}${S.payUrl && !S.payCopied ? `<div class="zlink" id="paylinkurl">${esc(S.payUrl)}</div>` : ""}`;
  }
  // ---------- step 4: brand moments ----------
  const ytC = (u) => /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/.test(u);
  function linkInfo(u) {
    if (!u) return { ok: true, text: "" };
    if (!/^https:\/\/[^\s<>"'`]+$/i.test(u)) return { ok: false, text: "The link must start with https:// and have no spaces." };
    if (ytC(u)) return { ok: true, text: "YouTube link: plays inside the game. If its owner has switched off showing it elsewhere, it will not play, so press Test it." };
    if (/\.(mp4|webm|m4v|mov|ogv)([?#]|$)/i.test(u)) return { ok: true, text: "Video file: plays inside the game." };
    if (/\.(mp3|m4a|aac|wav|ogg|oga)([?#]|$)/i.test(u)) return { ok: true, text: "Audio file: plays inside the game." };
    return { ok: false, text: "This link opens a new tab and takes guests out of the game. Use a YouTube link or a direct link to a video (.mp4) or audio (.mp3) file." };
  }
  const noteHtml = (path) => { const m = getP(path); if (!m || m.k === "msg") return ""; const r = linkInfo((m.v || "").trim()); return r.text ? `<span class="${r.ok ? "zc-okt" : "zc-badt"}">${esc(r.text)}</span>` : ""; };
  /** One brand moment: what it is (four kinds), the message or link, a title, and a Test it button that shows it exactly as a guest sees it. */
  function momentBox(g, i, title) {
    const m = S.f[g][i], p = `${g}.${i}`;
    const kinds = KINDS.concat(m.k === "slides" ? [["slides", "Slides (set earlier)"]] : []);
    const inputs = m.k === "msg"
      ? `<div class="zc-inline">${`<label class="zc-sr" for="${fid(p + ".t")}">Your message (up to 80 characters)</label>`}${inp(p + ".t", { ph: "Type your message (up to 80 characters)", max: 80 })}</div>`
      : `<div class="zc-inline"><label class="zc-sr" for="${fid(p + ".v")}">${m.k === "yt" ? "The YouTube link" : m.k === "aud" ? "The audio file link" : m.k === "slides" ? "The slides link" : "The video file link"}</label>${inp(p + ".v", { ph: m.k === "yt" ? "Paste the YouTube link" : m.k === "aud" ? "Paste the audio file link" : "Paste the video file link", max: 300 })}<button type="button" class="zc-mini" data-test="${p}">Test it</button></div>
         <p class="zc-small" data-lk="${p}">${noteHtml(p)}</p>${lbl(fid(p + ".t"), "Title guests see")}${inp(p + ".t", { ph: "Title", max: 80 })}`;
    const secs = g === "cl" ? "" : `${lbl(fid(p + ".s"), "How long (seconds, optional)")}${inp(p + ".s", { type: "number", attrs: `min="15" max="${g === "op" ? 120 : 600}" step="3"`, ph: "60" })}`;
    return `<div class="zc-box"><b class="zc-bt">${esc(title)}</b>${grp(p + ".k", "What is it?", kinds)}${inputs}${secs}${m.after ? small("Set earlier to play after number " + m.after + ".") : ""}</div>`;
  }
  const countChips = (path, max) => grp(path, "How many?", Array.from({ length: max + 1 }, (_, n) => [String(n), String(n)]));
  function stepBrand() {
    if (!S.f) return small("Loading…");
    if (lockedGame()) return lockedNote() + readBack();
    // a tournament has no breaks to fill: the brand is the company name, the colour and the small logo at the top of every player's page and on the big screen
    return brandBox() + small("Players see this strip above the board. The big screen shows your name and logo too. Everything here is optional.") + save(4);
  }

  /** One line for the brand: the company name (or our own) and whether a logo is set. */
  const brandNow = () => { const b = (S.info && S.info.brand) || (S.sum && S.sum.brand) || (S.f && S.f.brand) || {}; return (b.name ? b.name : "Corporate Tic Tac Toe") + (b.logo ? ", with a logo" : ", no logo"); };
  /** The read-back of steps 1 to 4: what is saved, with a Change button for each. */
  function readBack() {
    const f = S.f, c = S.cfg, inf = S.info; if (!f || !c || !inf) return "";
    const name = c.name || (f.occ === "Other" ? f.oname || "Your game" : f.occ);
    const prizes = (c.rewards || []).length, wait = (c.rewards || []).filter((r) => !r.text).length;
    const blankDate = S.cloneNew === eid && S.cloneDated !== eid;
    const rows = [["Game", blankDate ? `${name}, date and time still to pick` : `${name}, ${when(inf.startMs)}`, 1], ["People", `Up to ${inf.cap} players, ${whoNow() === "anyone" ? "anyone with the link" : "only people on a list"}`, 2], ["Prizes", `${prizes} prize${prizes === 1 ? "" : "s"}${wait ? ` (${wait} to decide)` : ""}`, 3], ["Brand", brandNow(), 4]];
    return rows.map((r) => `<div class="zc-rowl"><span><span class="zc-small zc-nomargin">${r[0]}</span><br>${esc(r[1])}</span>${lockedGame() ? "" : `<button type="button" class="zc-mini" data-open="${r[2]}" aria-label="Change ${esc(r[0])}">Change</button>`}</div>`).join("")
      + (wait ? `<p class="zc-small zc-warnt">${wait} prize${wait === 1 ? " says" : "s say"} "decide later". You can still publish.</p>` : "");
  }

  // ---------- step 5: your team ----------
  const friendly = (e) => (e && e.status === 404 ? "This is not switched on yet. Please try again a little later." : e && e.status === 403 ? "You are not allowed to do that." : (e && e.message) || "Something went wrong. Please try again.");
  function roleCards(only) {
    const li = (ok, t) => `<li class="${ok ? "zc-yes" : "zc-no"}"><span aria-hidden="true">${ok ? "&#10003;" : "&#10007;"}</span> <span class="zc-sr">${ok ? "Can: " : "Cannot: "}</span>${t}</li>`;
    const card = (c, name, items) => `<div class="zc-role" style="background:var(--bg-tint-${c});color:var(--text-tint-${c})"><b>${name}</b><ul>${items.join("")}</ul></div>`;
    const all = { organizer: card("blue", "Organizer", [li(1, "Everything in the game"), li(1, "Sign-in keys, e-mail, AI link, close account"), li(1, "Add Hosts and Co-hosts"), li(1, "Pay")]),
      host: card("aqua", "Host", [li(1, "Change the game, prizes and brand moments"), li(1, "Publish and run the game day"), li(1, "See the guest list"), li(1, "Add Co-hosts"), li(1, "Pay"), li(0, "The account: keys, e-mail, AI link, close account"), li(0, "Add Hosts")]),
      cohost: card("green", "Co-host", [li(1, "Invite people with their own link"), li(1, "See how many they brought"), li(1, "Pay"), li(0, "Change the game"), li(0, "See the guest list or any names"), li(0, "Add anyone")])};
    return `<div class="zc-roles">${only ? all[only] : all.organizer + all.host + all.cohost}</div>`;
  }
  const coLimit = () => Number((S.sum && S.sum.coHostLimit) || 100);
  const EMAIL_RULE = "Guests and Co-hosts need only a name and a mobile number. No e-mail is needed. Only the Organizer and Hosts have an e-mail.";
  const maskPhone = (v) => { const t = String(v || ""); if (/[^0-9\s+\-]/.test(t)) return t; const d = t.replace(/\D/g, ""); return d.length > 4 ? "XXXXXX" + d.slice(-4) : t; };
  function teamRow(p, kind) {
    const link = S.teamLinks[p.id], canRetire = kind === "host" ? isOrg() : canRun();
    const SETUP = { ready: "Ready", "needs-mobile": "Still to add a mobile number", "waiting-for-host": "Waiting for them to open the link", "link-expired": "Their link has expired" };
    const setupLine = kind === "host" && p.setup && SETUP[p.setup] ? `<div class="zc-small zc-nomargin" data-setup="${esc(p.setup)}">${SETUP[p.setup]}</div>` : "";
    const newLink = kind === "host" && isOrg() && p.emailConfirmed === false && (p.setup === "waiting-for-host" || p.setup === "link-expired") ? `<div class="zc-chips zc-gap"><button type="button" class="zc-mini" data-newlink="${esc(p.id)}" data-label="${esc(p.label || "")}">Send a new link</button></div>` : "";
    return `<div class="zc-person"><div class="zc-split"><span><b>${esc(p.label || (kind === "host" ? "Host" : "Co-host"))}</b>${kind === "cohost" && p.brought !== undefined ? ` <span class="zc-small zc-nomargin">brought ${Number(p.brought) || 0}</span>` : ""}${kind === "host" && p.email ? ` <span class="zc-small zc-nomargin">${esc(p.email)}</span>` : ""}${kind === "host" && (p.phoneMasked || p.phone_masked || p.phone || p.mobile) ? ` <span class="zc-small zc-nomargin">mobile ${esc(maskPhone(p.phoneMasked || p.phone_masked || p.phone || p.mobile))}</span>` : ""}${kind === "cohost" && (p.phoneMasked || p.phone_masked || p.phone || p.mobile) ? ` <span class="zc-small zc-nomargin">mobile ${esc(maskPhone(p.phoneMasked || p.phone_masked || p.phone || p.mobile))}</span>` : ""}</span>${canRetire ? `<button type="button" class="zc-mini zc-danger" data-retire="${esc(p.id)}" data-kind="${kind}" aria-label="Remove ${esc(p.label || kind)}">Remove</button>` : ""}</div>
      ${setupLine}${newLink}${link ? `<div class="zc-linkrow"><span class="zlink">${esc(link)}</span><button type="button" class="zc-mini" data-copyteam="${esc(p.id)}">Copy link</button>${S.teamWa[p.id] ? `<a class="zc-mini" data-hostwa="${esc(p.id)}" href="${esc("https://wa.me/" + S.teamWa[p.id].d + "?text=" + encodeURIComponent("Hi " + S.teamWa[p.id].name + ", you are a Host for Corporate Tic Tac Toe" + (S.cfg && S.cfg.name ? ": " + S.cfg.name : "") + ". Your private link: " + link))}" target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>` : ""}</div>` : small("The private link is shown only when the person is added. Remove and add again to get a new one.")}</div>`;
  }
  function stepTeam() {
    const T = S.team, max = (T && T.maxHosts) || 5, hosts = (T && T.hosts) || [], co = (T && T.cohosts) || [];
    let h = roleCards() + (S.teamNote ? `<div class="zc-toast" role="status">${esc(S.teamNote)}</div>` : "");
    if (!T && S.teamErr) h += `<p class="zc-small zc-warnt" role="status">${esc(S.teamErr)}</p>`;
    h += `<span class="zc-lbl zc-sec">Your Hosts: ${hosts.length} of ${max}</span>` + hosts.map((p) => teamRow(p, "host")).join("");
    if (isOrg()) h += `<div class="zc-inline"><label class="zc-sr" for="hostlabel">Name of the new Host</label><input id="hostlabel" value="${esc((S.tv || {}).hostlabel || "")}" class="zc-in" maxlength="40" placeholder="Name" autocomplete="off" required><label class="zc-sr" for="hostphone">Mobile number of the new Host</label><input id="hostphone" value="${esc((S.tv || {}).hostphone || "")}" class="zc-in" inputmode="tel" placeholder="Mobile number, 415 555 0132" autocomplete="off"><label class="zc-sr" for="hostemail">E-mail of the new Host</label><input id="hostemail" value="${esc((S.tv || {}).hostemail || "")}" class="zc-in" type="email" maxlength="120" placeholder="E-mail (their link is sent here)" autocomplete="off"><button type="button" class="zc-btn zc-btn-s" id="hostadd"${hosts.length >= max ? " disabled" : ""}>Add a Host</button></div>${hosts.length >= max ? small(`You have the most Hosts allowed (${max}). Remove one to add another.`) : small("A Host needs a name and a mobile number or an e-mail, or both. With an e-mail we send their private link there. With only a mobile number, you send it on WhatsApp.")}`;
    else h += small("Only the Organizer adds Hosts.");
    h += `<span class="zc-lbl zc-sec">Your Co-hosts: ${co.length} (no limit)</span>` + co.map((p) => teamRow(p, "cohost")).join("");
    h += `<div class="zc-inline"><label class="zc-sr" for="cohostlabel">Name of the new Co-host</label><input id="cohostlabel" value="${esc((S.tv || {}).cohostlabel || "")}" class="zc-in" maxlength="40" placeholder="Name" autocomplete="off" required><label class="zc-sr" for="cohostphone">Mobile number of the new Co-host</label><input id="cohostphone" value="${esc((S.tv || {}).cohostphone || "")}" class="zc-in" inputmode="tel" placeholder="Mobile number, 415 555 0132" autocomplete="off" required><button type="button" class="zc-btn zc-btn-s" id="cohostadd">Add a Co-host</button></div>`;
    if (isOrg()) h += `<span class="zc-lbl" id="gl-cohl">Each Co-host can add up to</span><div class="zc-chips" role="group" aria-labelledby="gl-cohl">${[10, 50, 100, 250, 500, 1000].map((n) => `<button type="button" class="zc-chip${coLimit() === n ? " on" : ""}" data-cohl="${n}" aria-pressed="${coLimit() === n}">${n} people</button>`).join("")}</div>${small("This is for each Co-host. You can change it any time.")}`;
    h += `<p class="zc-small" id="emailrule">${EMAIL_RULE}</p>`;
    return h + small("Send it to that one person only.") + cont(5);
  }

  // ---------- step 6: invite and share ----------
  const guestLink = () => location.origin + "/z.html?e=" + encodeURIComponent(eid) + (BASE ? "&api=" + encodeURIComponent(BASE) : "");
  const bigLink = () => location.origin + "/big.html?e=" + encodeURIComponent(eid);
  const inviteText = () => `You are invited to play Corporate Tic Tac Toe${S.cfg && S.cfg.name ? ": " + S.cfg.name : ""}. Join here: ${guestLink()}`;
  const waUrl = (num) => "https://wa.me/" + (num || "") + "?text=" + encodeURIComponent(inviteText());
  const waNumber = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? "91" + d : d; };
  // ---------- My people (docs/ROLES_AND_CONSOLE_SPEC_3.md): one list per inviter ----------
  // A typed number is matched to a list, not proven. The personal link is the strong proof. The server keeps the numbers sealed; this page shows them masked.
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  /** One typed number becomes digits with a country code, or null when it looks wrong. A number typed without a country code is read as Indian (91) or American (1), whichever the organizer picked for the list. */
  const CC = { v: ls.get("cbz-cc") === "91" ? "91" : ls.get("cbz-cc") === "1" ? "1" : (inIndia() ? "91" : "1") };
  function cleanPhone(raw) {
    const cc0 = CC.v;
    if (cc0 === "1") { const t0 = String(raw == null ? "" : raw).trim(); if (!/^(\+|00)/.test(t0)) { let d0 = t0.replace(/\D/g, ""); if (/^1[2-9]\d{9}$/.test(d0)) return d0; if (/^[2-9]\d{9}$/.test(d0)) return "1" + d0; } }
    const t = String(raw == null ? "" : raw).trim(), intl = /^\+/.test(t) || /^00/.test(t);
    let d = t.replace(/\D/g, ""); if (/^00/.test(t)) d = d.slice(2);
    if (intl) return /^91/.test(d) ? (/^91[6-9]\d{9}$/.test(d) ? d : null) : /^[1-9]\d{7,14}$/.test(d) ? d : null;
    if (/^0\d{10}$/.test(d)) d = d.slice(1);
    if (/^[6-9]\d{9}$/.test(d)) return "91" + d;
    if (/^91\d{10}$/.test(d)) return /^91[6-9]\d{9}$/.test(d) ? d : null;
    return /^[1-9]\d{10,14}$/.test(d) ? d : null;
  }
  /** A short number is a card number (a guest who joined with a name has no mobile number); a long one is a mobile number. */
  const whoBody = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length > 0 && d.length <= 6 && !/^\+/.test(String(v).trim()) ? { seat: Number(d) } : { phone: v }; };
  function cleanBatch(rows) {
    const seen = new Set(), good = [], wrong = []; let dups = 0;
    for (const r of rows) {
      const d = cleanPhone(r.phone);
      if (!d) { wrong.push({ name: String(r.name || "").trim(), raw: String(r.phone || "") }); continue; }
      if (seen.has(d)) { dups++; continue; }
      seen.add(d); good.push({ name: String(r.name || "").trim(), phone: d });
    }
    return { good, dups, wrong };
  }
  const stLabel = (s2) => ({ invited: "Invited", joined: "Joined", waiting: "Waiting", removed: "Removed" }[String(s2 || "invited").toLowerCase()] || "Invited");
  const startedNow = () => (role() === "cohost" ? !!(S.coh && S.coh.startMs && S.coh.startMs <= Date.now()) : !!S.started);
  const canRemove = () => canRun() || !startedNow();
  const commonLink = () => S.pp.common || (role() === "cohost" ? cohInvite() : guestLink());
  const digitsOf = (p) => { const d = String(p.phone || "").replace(/\D/g, ""); if (d.length >= 10) return d.length === 10 ? "91" + d : d; const m = String(p.waLink || "").match(/wa\.me\/(\d{8,15})/); return m ? m[1] : ""; };
  const waText = (p) => `Hi ${firstName(p.name) || "there"}, you are invited to play Corporate Tic Tac Toe${S.cfg && S.cfg.name ? ": " + S.cfg.name : S.coh && S.coh.name ? ": " + S.coh.name : ""}. Your personal link: ${p.link || commonLink()}`;
  const waHref = (p) => p.waLink || ""; // the server builds it: wa.me/<number>?text=<short message with the personal link>
  const sentKey = () => "cbz-sent-" + eid;
  const markSent = (id) => { S.pp.sent[id] = 1; ls.set(sentKey(), JSON.stringify(S.pp.sent)); };
  const last4Of = (w) => w.last4 || String(w.maskedPhone || w.masked || "").replace(/\D/g, "").slice(-4);
  const canContacts = () => { try { return !!(navigator.contacts && typeof navigator.contacts.select === "function"); } catch { return false; } };
  async function loadPeople() {
    if (S.shield || !eid || !(canRun() || role() === "cohost")) return;
    const P = S.pp; if (P.sentFor !== eid) { P.sentFor = eid; P.me = null; P.meNeed = false; try { P.sent = JSON.parse(ls.get(sentKey()) || "{}") || {}; } catch { P.sent = {}; } }
    try {
      const r = await call("GET", `/api/z/${eid}/people`), all = (r.people || []).slice();
      while (all.length < (Number(r.total) || 0)) { const more = await call("GET", `/api/z/${eid}/people?offset=${all.length}`); if (!(more.people || []).length) break; all.push(...more.people); } // a long list arrives in pages
      P.list = all; P.limit = role() === "cohost" ? Number(r.limit) || 100 : 0; P.used = typeof r.used === "number" ? r.used : null; P.common = r.commonLink || ""; P.canExport = !!r.canExport; P.err = "";
    } catch (e) { P.list = null; P.err = e.status === 404 || e.status === 405 ? "My people list is not switched on yet. Please try again a little later." : friendly(e); }
    try { const w = await call("GET", `/api/z/${eid}/waiting`); P.waiting = w.waiting || []; P.approved = w.approved || []; } catch { P.waiting = null; }
  }
  /** The caller's own play seat (POST /people/me), made only when they ask for it. */
  async function ensureMe(typed) {
    const P = S.pp; if (P.me && !typed) return P.me;
    const r = await call("POST", `/api/z/${eid}/people/me`, typed ? { phone: typed } : {}); P.me = r.person || null; P.meNeed = false; return P.me;
  }
  const needPeople = () => S.open === 6 && canRun() && !S.shield;
  async function addPeople(raw, keep) {
    const P = S.pp;
    if (!raw.length) { P.sum = "Add a name and a number first."; return redraw(); }
    const terms = tbTerms("ppl" + eid); if (!terms) { P.sum = "Please tick the box above first."; return redraw(); }
    const { good, dups, wrong } = cleanBatch(raw); let added = good.length, serverDup = 0, got = 0, counted = false; const bad = wrong.slice();
    try {
      for (let i = 0; i < good.length; i += 200) {
        const r = await call("POST", `/api/z/${eid}/people`, { people: good.slice(i, i + 200).map((p) => ({ name: p.name, phone: "+" + p.phone })), consent: terms });
        serverDup += Number(r.duplicates) || 0; if (typeof r.added === "number") { got += r.added; counted = true; }
        for (const x of r.invalid || []) { const q = parseList(String(typeof x === "string" ? x : x.raw || ""))[0] || { name: "", phone: "" }; bad.push({ name: q.name, raw: q.phone, why: typeof x === "string" ? "" : x.why || "" }); }
      }
      if (counted) added = got;
      const d = dups + serverDup;
      P.sum = `${added} good, ${d === 1 ? "1 duplicate" : d + " duplicates"} removed, ${bad.length === 1 ? "1 looks wrong" : bad.length + " look wrong"}`;
      P.wrong = keep ? P.wrong.concat(bad) : bad;
    } catch (e) { P.sum = friendly(e); }
    await loadPeople(); redraw();
  }
  function removeBox(p) {
    const nm = esc(p.name || "this person");
    return `<div class="zc-box zc-gap" role="group" aria-label="Remove ${nm}"><p class="zc-small zc-nomargin">${startedNow() ? `Take your time. Their phone will stop. If ${nm} already won, the win stands and the prize is marked not given.` : `${nm} loses their place and their link stops. You can add them again later.`}</p><div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s zc-btn-bad" data-rm="${esc(p.id)}" data-with="0">Only this person</button><button type="button" class="zc-btn zc-btn-s zc-btn-bad" data-rm="${esc(p.id)}" data-with="1">This person and everyone they invited</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" data-rmno="1">Keep them</button></div></div>`;
  }
  function personRow(p) {
    const id = esc(p.id), st = stLabel(p.status), gone = st === "Removed", sent = !!S.pp.sent[p.id], href = waHref(p);
    const extra = [p.role ? "This is your own seat (" + (WHO[p.role] || p.role) + ")" : "", p.inviter && canRun() && !p.role ? "Invited through " + p.inviter : "", p.approvedBy ? "Let in by " + p.approvedBy : "", sent && !gone ? "Sent on WhatsApp" : ""].filter(Boolean).map(esc).join(" &middot; ");
    let btns = "";
    if (!gone) {
      btns += sent ? `<button type="button" class="zc-mini" data-resend="${id}">Send again</button>` : href ? `<a class="zc-mini" data-wa="${id}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>` : "";
      if (canRemove() && !p.role) btns += `<button type="button" class="zc-mini zc-danger" data-rmask="${id}" aria-label="Remove ${esc(p.name || "this person")}">Remove</button>`;
    }
    return `<div class="zc-prow" data-pid="${id}"><div class="zc-split"><span><b>${esc(p.name || "No name")}</b> <span class="zc-small zc-nomargin">${esc(p.maskedPhone || "")}</span></span><span class="zc-stt zc-stt-${st.toLowerCase()}">${st}</span></div>${extra ? `<div class="zc-small zc-nomargin">${extra}</div>` : ""}${btns ? `<div class="zc-chips zc-gap">${btns}</div>` : ""}${S.pp.confirm === p.id && !gone ? removeBox(p) : ""}</div>`;
  }
  function waitingPanel() {
    const P = S.pp, W = P.waiting; if (!W) return "";
    const rows = W.map((w) => `<div class="zc-prow" data-wid="${esc(w.id)}"><div class="zc-split"><span><b>${esc(firstName(w.firstName || w.name))}</b> <span class="zc-small zc-nomargin">&middot;&middot;&middot;&middot; ${esc(last4Of(w))}</span></span></div><div class="zc-small zc-nomargin">Asking through ${esc(w.via || w.inviter || w.throughName || "the common link")}</div><div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s" data-wid="${esc(w.id)}" data-decide="admit">Admit</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" data-wid="${esc(w.id)}" data-decide="decline">Decline</button></div></div>`).join("");
    const done = P.decided.concat((P.approved || []).map((a) => ({ name: firstName(a.firstName || a.name), last4: last4Of(a), decision: a.decision || "admit", by: a.by || a.approvedBy || "", ms: a.ms || a.approvedMs || 0 }))).slice(0, 8)
      .map((d) => `<div class="zc-small zc-nomargin">${esc(d.name)} &middot;&middot;&middot;&middot; ${esc(d.last4)}: ${d.decision === "decline" ? "declined" : "let in"} by ${esc(d.by || "someone")}${d.ms ? ", " + esc(dmy(d.ms)) : ""}</div>`).join("");
    const bulk = P.bulk ? `<div class="zc-box" id="bulkask" role="group" aria-label="Please confirm"><p><b>${P.bulk === "admit" ? `Let all ${W.length} ${W.length === 1 ? "person" : "people"} in?` : `Decline all ${W.length} ${W.length === 1 ? "person" : "people"}?`}</b></p>${small(P.bulk === "admit" ? "Everyone waiting is let in, one after the other, until the game is full." : "They are told you could not take them this time.")}<div class="zc-chips"><button type="button" class="zc-btn zc-btn-s${P.bulk === "decline" ? " zc-btn-bad" : ""}" id="bulkyes">${P.bulk === "admit" ? "Yes, let them in" : "Yes, decline them"}</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="bulkno">No, wait</button></div></div>`
      : W.length ? `<div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s" id="admitall">Approve all (${W.length})</button><button type="button" class="zc-mini" id="declineall">Decline all</button></div>` : "";
    return `<div class="zc-box" id="waitpanel"><b class="zc-bt">Waiting to come in${W.length ? ": " + W.length : ""}</b>${bulk}${rows || small("Nobody is waiting right now.")}${P.still ? `<p class="zc-small zc-warnt" id="stillwaiting">${esc(P.still)}</p>` : ""}${done ? `<div class="zc-gap">${done}</div>` : ""}</div>`;
  }
  function addBox() {
    const modes = (canContacts() ? [["contacts", "From my contacts"]] : []).concat([["type", "Add a name and number"], ["paste", "Paste from Excel"], ["file", "Upload a CSV"]]);
    const m = modes.some((x) => x[0] === S.mode) ? S.mode : "type";
    const chips = modes.map(([k, l]) => `<button type="button" class="zc-chip${m === k ? " on" : ""}" data-mode="${k}" aria-pressed="${m === k}">${l}</button>`).join("");
    const form = m === "contacts" ? `<div class="zc-inline"><button type="button" class="zc-btn zc-btn-s" id="gcontacts" ${tbDis("ppl" + eid)}>Pick from my contacts</button></div>`
      : m === "type" ? `<div class="zc-inline"><label class="zc-sr" for="gname">Name</label><input id="gname" class="zc-in" placeholder="Name" autocomplete="off"><label class="zc-sr" for="gphone">Mobile number</label><input id="gphone" class="zc-in" inputmode="tel" placeholder="415 555 0132" autocomplete="off"><button type="button" class="zc-btn zc-btn-s" id="gadd" ${tbDis("ppl" + eid)}>Add</button></div>`
      : m === "paste" ? `${lbl("rosterTxt", "Paste one person per line: name, mobile number")}<textarea id="rosterTxt" class="zc-in zc-ta" rows="5" placeholder="Asha, 415 555 0132" autocomplete="off"></textarea><div class="zc-foot"><button type="button" class="zc-btn zc-btn-s" id="rosterGo" ${tbDis("ppl" + eid)}>Add them</button></div>`
      : `${lbl("gfile", "Choose a CSV file: name, then mobile number")}<input id="gfile" class="zc-in" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" ${tbDis("ppl" + eid)}>${small("In Excel, choose Save as CSV first.")}`;
    const ccRow = `<span class="zc-lbl">Numbers typed without a country code are from</span><div class="zc-chips" role="group" aria-label="Country of numbers typed without a country code">${[["91", "India (+91)"], ["1", "United States (+1)"]].map(([v, l]) => `<button type="button" class="zc-chip${CC.v === v ? " on" : ""}" data-cc="${v}" aria-pressed="${CC.v === v}">${l}</button>`).join("")}</div>`;
    return `<div class="zc-chips" role="group" aria-label="How to add people">${chips}</div>${ccRow}${tbSlot("ppl" + eid, "K6", "gadd,rosterGo,gcontacts,gfile")}${form}${small("Invite only people who would like to play. Guests who join the common link with just a name do not need to be listed.")}`;
  }
  const guestTools = () => (!canRun() ? "" : `<h4>A guest's own data</h4>${small("A player asks to see or delete their data? Enter their mobile number, or their seat number if they joined with a name. Only you can do this.")}<div class="zc-inline"><label class="zc-sr" for="pdph">Their mobile number or seat number</label><input id="pdph" class="zc-in" inputmode="tel" autocomplete="off" placeholder="415 555 0132"><button type="button" class="zc-mini" id="pdsee">Show what we hold</button><button type="button" class="zc-mini zc-danger" id="pddel">Delete their data</button></div>
      <h4>Change of phone</h4>${small("A seat plays on one phone only. If someone lost or changed their phone, enter their mobile number (or their seat number): the next phone they join with keeps their seat.")}<div class="zc-inline"><label class="zc-sr" for="ubph">Their mobile number or seat number</label><input id="ubph" class="zc-in" inputmode="tel" autocomplete="off" placeholder="415 555 0132"><button type="button" class="zc-mini" id="unbind">Let them move to a new phone</button></div>`);
  function peopleBlock() {
    if (S.shield) return `<div class="zc-block" id="shieldnote"><h3>Guest names and numbers are hidden</h3>${small("AI helper mode is on, so this page does not show or take any guest's name or mobile number: the people list, looking up a guest, moving a seat to a new phone and the report. Switch off \"My AI works in my web browser\" (in the AI Assistant box) to use them yourself.")}</div>`;
    const P = S.pp, list = P.list;
    let h = `<div class="zc-block" id="mypeople"><h3>My people</h3>`;
    if (list === null) return h + (P.err ? `<p class="zc-small zc-warnt" id="ppnote" role="status">${esc(P.err)}</p>` : small("Loading…")) + `<p class="zc-small" id="emailrule2">${EMAIL_RULE}</p>${guestTools()}</div>`;
    const live = list.filter((p) => stLabel(p.status) !== "Removed"), full = !!P.limit && live.length >= P.limit;
    h += `<p class="zc-small"><b id="gcount">${live.length}</b> ${live.length === 1 ? "person is" : "people are"} on my list${P.limit ? ` (up to ${P.limit})` : ""}.</p>`;
    if (canRun()) h += small(`Who can join: <b>${whoNow() === "anyone" ? "Anyone with the link" : "Only people on a list"}</b>. You can change this in step 2 until the game starts.`);
    h += waitingPanel();
    h += full ? small(`You have reached your limit of ${P.limit} people. Remove someone to add another.`) : addBox();
    if (P.sum) h += `<p class="zc-small" id="cleansum" role="status"><b>${esc(P.sum)}</b></p>`;
    if (P.wrong.length) h += `<div class="zc-box" id="wronglist"><b class="zc-bt">These look wrong. Fix the number and add them.</b>${P.wrong.map((w, i) => `<div class="zc-inline"><span>${esc(w.name || "No name")}${w.why ? ` <span class="zc-small zc-nomargin">${esc(w.why)}</span>` : ""}</span><label class="zc-sr" for="fixin${i}">Mobile number for ${esc(w.name || "this person")}</label><input id="fixin${i}" class="zc-in" inputmode="tel" value="${esc(w.raw)}"><button type="button" class="zc-mini" data-fix="${i}">Fix and add</button></div>`).join("")}</div>`;
    h += list.map(personRow).join("") + (list.length ? "" : small("Nobody yet. Add your first person above."));
    h += `<div class="zc-chips zc-gap"><button type="button" class="zc-mini" id="copycommon">Copy common link</button>${P.canExport ? `<button type="button" class="zc-mini" id="dlpeople">Download my list</button>` : ""}</div>`;
    h += small("The common link is for groups. The person types their own mobile number. A personal link is made for one person only.");
    h += `${small("Names and numbers stay here: your AI never sees them.")}<p class="zc-small" id="emailrule2">${EMAIL_RULE}</p>`;
    h += guestTools();
    return h + `</div>`;
  }
  const localCsv = () => ["Name,Mobile,Personal link,WhatsApp link,Status"].concat((S.pp.list || []).map((p) => [p.name, p.maskedPhone, p.link, waHref(p), stLabel(p.status)].map((x) => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"').join(","))).join("\n");
  /** Organizer and Host play through their own personal link too: their seat is marked for them (POST /people/me), made when they ask. */
  function playBlock() {
    if (S.shield || !canRun()) return "";
    const ph = S.myPhone !== undefined ? S.myPhone : isOrg() ? S.contact.phone || "" : "";
    return `<div class="zc-block" id="playalong"><h3>Play along</h3>${small("You can play too. Your seat is marked for you. Nobody has an advantage.")}
      <div class="zc-chips zc-gap"><button type="button" class="zc-chip" id="playnow">Play now</button></div>
      ${S.pp.meNeed ? `${lbl("myph", "Your own mobile number")}<input id="myph" class="zc-in" inputmode="tel" placeholder="415 555 0132" autocomplete="off" value="${esc(ph)}">` : ""}
      <div class="zc-foot"><button type="button" class="zc-btn zc-btn-s" id="sendmine">Send my play link to my WhatsApp</button></div>${S.pp.mineNote ? `<p class="zc-small" id="minenote" role="status">${esc(S.pp.mineNote)}</p>` : ""}</div>`;
  }
  function stepShare() {
    const link = guestLink();
    return `<div class="zc-block"><h3>Guest link</h3><div class="zc-linkrow"><span class="zlink">${esc(link)}</span><button type="button" class="zc-mini" id="copy">Copy link</button></div>
        <div class="zc-chips zc-gap"><a class="zc-chip" href="${esc(waUrl(""))}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></div>${S.draft ? small("Guests can join once you publish.") : ""}</div>
      <div class="zc-block"><h3>Big screen</h3><div class="zc-linkrow"><span class="zlink" id="biglink">${esc(bigLink())}</span><button type="button" class="zc-mini" id="copybig">Copy the link</button></div>
        <a class="zc-chip zc-gap" href="${esc(bigLink())}" target="_blank" rel="noopener">Open the big screen</a>${small("Open it on a laptop or phone connected to the big screen. It shows the bracket, the live boards and the results, with names only.")}</div>
      <div class="zc-block"><h3>Run the tournament</h3><a class="zc-chip zc-gap" href="/host.html?e=${encodeURIComponent(eid)}">Open the tournament page</a>${small("Choose one against one or teams, set the move clock, start, pause and resume. Starting closes the list of players.")}</div>
      ${peopleBlock()}${playBlock()}
      ${cont(6)}`;
  }

  // ---------- step 7: check and publish; step 8: pay ----------
  /** Published but not paid: the one thing that matters now. The link went to everyone, so the game must start. */
  function payDueCard() {
    if (!S.unpaid || S.draft || !S.info || isCancelled() || didNotStart() || payState().confirming) return "";
    const at = S.info.startMs, left = Math.round((at - Date.now()) / 1000);
    const whenS = new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const waiting = S.people.length;
    const fmtLeft = (s) => (s >= 86400 ? Math.floor(s / 86400) + " d " + Math.floor((s % 86400) / 3600) + " h" : s >= 3600 ? Math.floor(s / 3600) + " h " + Math.floor((s % 3600) / 60) + " min" : Math.max(0, Math.floor(s / 60)) + " min");
    const people = waiting ? `<b>${waiting} ${waiting === 1 ? "person has" : "people have"} already joined your link.</b> ` : "Your link is live. ";
    if (S.locked || left <= 0) return `<div class="zc-alert zc-alert-bad"><h3>Your game could not begin: payment is due</h3><p>${people}They are waiting, and nothing will start until it is paid. <b>Pay now and the game starts 2 minutes after your payment, for everyone already waiting.</b> One payment is enough, from the Organizer, a Host or a Co-host.</p><a class="zc-btn zc-btn-bad" href="/pay.html?e=${encodeURIComponent(eid)}">Pay now and start</a></div>`;
    return `<div class="zc-alert"><h3>Last step: pay before the start</h3><p>${people}Your game starts <b>${esc(whenS)}</b> (in ${fmtLeft(left)}).</p><p><b>If payment is not made before then, the game will not begin</b> and everyone you invited will be left waiting. It takes about 2 minutes.</p><a class="zc-btn" href="/pay.html?e=${encodeURIComponent(eid)}">Pay now</a></div>`;
  }
  const paidRow = () => { const p = payState(); return `<div class="zc-rowl zc-paid"><span><b>Paid</b><br><span class="zc-small zc-nomargin">${p.paidBy ? "Paid by the " + esc(WHO[p.paidBy] || p.paidBy) : "Paid"}${p.paidMs ? " on " + esc(dmy(p.paidMs)) : ""}. The game is on.</span></span><span aria-hidden="true">&#10003;</span></div>`; };
  // ---------- cancel the game (Organizer and Host): three taps, each more serious; the server wants confirmations: 3 ----------
  const CANCEL_NO = "This game cannot be cancelled now.";
  /** "Your credit: Rs 2,358.82, valid until 14 Jun 2027." (no refund: a paid game that is cancelled becomes credit for 365 days) */
  const creditText = (c) => (c ? `Your credit: ${money(c.amountInr)}, valid until ${dayIst(c.expiresMs)}.` : "");
  const cloneButton = () => (canRun() && eid ? `<div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" data-clonebtn="1">Create a new game like this one</button></div>` : "");
  /** A cancelled PAID game can be moved to a new date for 30 days after the cancel (the payment stays with the game). */
  function moveBlock() {
    const I = Object.assign({}, S.info, S.sum), M = S.move || {};
    if (!I.rescheduleUntilMs) return "";
    if (M.done) return `<p class="zc-small" id="movedone" role="status"><b>Your game is moved.</b> Send your guests the link again: they need to join again.</p>`;
    const until = esc(dayIst(I.rescheduleUntilMs));
    if (I.canReschedule === false) return `<p class="zc-small" id="movecant">This game can no longer be moved. Your payment stays as credit for a new game.</p>`;
    return `<div id="moveblock"><p class="zc-small"><b>You can move this game to a new date until ${until}.</b> Your payment then stays with this game and nothing more is due. If you use the credit for another game first, this game can no longer be moved.</p><div class="zc-chips"><input type="datetime-local" id="movedt" aria-label="New date and time"> <button type="button" class="zc-btn zc-btn-s" id="movego"${M.busy ? " disabled" : ""}>Move my game to this date</button></div>${M.err ? `<p class="zc-small zc-warnt" role="status" id="moveerr">${esc(M.err)}</p>` : ""}</div>`;
  }
  function cancelBlock() {
    if (!canRun() || !S.info || S.draft) return "";
    const C = S.cancel || { stage: 0 }, name = (S.cfg && S.cfg.name) || (S.info && S.info.name) || "this game";
    if (isCancelled()) return `<div class="zc-block" id="cancelled"><h3>This game was cancelled</h3>${small("Guests see that the game was cancelled. Nothing more is needed from you.")}${C.credit ? `<p class="zc-small" id="creditnote"><b>Your payment of ${esc(money(C.credit.amountInr))} stays as credit until ${esc(dayIst(C.credit.expiresMs))}.</b> Use it for your next game.</p>` : small("If you had paid, your payment stays as credit for your next game. You can see it in Your account.")}${moveBlock()}${cloneButton()}</div>`;
    let b = "";
    if (C.stage === 0) b = small("You can cancel before the game starts. Guests will be told.") + `<div class="zc-chips"><button type="button" class="zc-btn zc-btn-s zc-btn-bad" id="cancelopen">Cancel this game</button></div>`;
    else if (C.err) b = `<p class="zc-small zc-warnt" role="status">${esc(C.err)}</p><div class="zc-chips"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cancelback">Close</button></div>`;
    else if (C.stage === 1 && !C.preview) b = small("One moment...");
    else if (C.stage === 1 && !C.preview.canCancel) b = `<p class="zc-small zc-warnt" id="cancelreason" role="status">${esc(C.preview.reason || CANCEL_NO)}</p><div class="zc-chips"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cancelback">Close</button></div>`;
    else {
      // three confirmations, each a red warning panel with the same plain warning, a progress line and its own heading; nothing is sent before the last button
      const n = C.stage, head = ["", "1st confirmation", "2nd confirmation", "Final confirmation"][n];
      const warn = `<p class="zc-cw-warn"><b>You are cancelling the game.</b> You need to confirm 3 times before the game is cancelled.</p>`;
      let inner;
      if (n === 1) inner = `<p><b>Do you want to cancel ${esc(name)}?</b></p>${C.preview && C.preview.paid ? `<p class="zc-small" id="norefund">There is no refund. Your payment stays as credit for your next game, for 365 days.</p>` : ""}<div class="zc-chips"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cancelback">No, keep my game</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cancelresched">Change the date instead</button><button type="button" class="zc-btn zc-btn-s zc-btn-bad" id="cancel1">Yes, go to the 2nd confirmation</button></div>`;
      else if (n === 2) inner = `<p><b>This is what happens.</b></p><p class="zc-small" id="cancelwhat">${C.preview && C.preview.credit ? esc(creditText(C.preview.credit)) + " " : ""}Guests will be told. Their names and numbers will be erased. You cannot undo this.</p><label class="zc-check" for="cancelagree"><input type="checkbox" id="cancelagree"${C.agree ? " checked" : ""}> I understand that cancelling cannot be undone</label><div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cancelprev">Go back</button><button type="button" class="zc-btn zc-btn-s zc-btn-bad" id="cancel2"${C.agree ? "" : " disabled"}>Submit</button></div>`;
      else inner = `<p><b>This will cancel ${esc(name)} for good.</b></p><div class="zc-chips"><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cancelback">No, keep my game</button><button type="button" class="zc-btn zc-btn-s zc-btn-bad" id="cancel3"${C.busy ? " disabled" : ""}>Yes, ${esc(name)} is cancelled</button></div>`;
      b = `<div class="zc-cwarn" id="cancelpanel" role="alertdialog" aria-labelledby="cancelhead" aria-describedby="cancelwarn"><div class="zc-small zc-nomargin" id="cancelprog">Step ${n} of 3</div><h4 id="cancelhead">${head}</h4><div id="cancelwarn">${warn}</div>${inner}</div>`;
    }
    return `<div class="zc-block" id="cancelblock"><h3>Cancel this game</h3>${b}</div>`;
  }
  function stepPublish() {
    if (!S.f) return small("Loading…");
    let h = `<span class="zc-lbl">Check your game</span>` + readBack();
    if (S.draft) {
      h += `<div class="zc-block"><h3>Publish (free)</h3>${small("Set it up first (by hand or with your AI). Participants cannot see or join a draft. Publishing is free: you confirm your details, get your link and send it to everyone. You pay before the start time, and it begins the moment you have.")}`
        + (S.pubOpen ? `${lbl("pubEmail", "Your e-mail (for the invoice)")}<input id="pubEmail" class="zc-in" type="email" value="${S.shield ? "" : esc(S.contact.email)}" autocomplete="email">${lbl("pubPhone", "Your mobile number")}<input id="pubPhone" class="zc-in" type="tel" value="${S.shield ? "" : esc(S.contact.phone)}" autocomplete="tel" placeholder="415 555 0132">${tbSlot("pub" + eid, "K1", "pubgo")}<div class="zc-foot"><button class="zc-btn" type="button" id="pubgo" ${tbDis("pub" + eid)}>Confirm and publish</button> <button class="zc-btn zc-btn-alt" type="button" id="pubcancel">Back</button></div>`
          : `<div class="zc-foot"><button class="zc-btn" type="button" id="publishopen">Publish my game, free</button></div>`)
        + (S.pubNote ? `<p class="zc-small"><b>${esc(S.pubNote)}</b></p>` : "") + `</div>`;
    } else {
      h += rowl(`<b>Published</b><br><span class="zc-small zc-nomargin">Your link is live.</span>`, `<span aria-hidden="true">&#10003;</span>`);
      h += isCancelled() ? "" : small("Next: pay in step 8. One payment is enough.");
    }
    return h + (S.cloneNew === eid && S.draft ? `<div class="zc-box" id="newgamenote2">This is a new game. Nothing is paid or published yet.</div>` : "") + previewButton() + cancelBlock() + (S.draft || isCancelled() ? "" : cloneButton()) + cont(7);
  }
  // ---------- credit (no refunds): the account's active credit can pay for a game ----------
  const creditTotal = () => Number((S.sum && S.sum.credit) || 0) || 0;
  const creditExpiry = () => (S.creditInfo && S.creditInfo.nextExpiryMs) || 0;
  function creditOffer() {
    const st = payState(); if (st.paid || st.confirming || S.draft || isCancelled()) return "";
    if (S.creditMsg) return `<div class="zc-box" id="creditoffer"><p id="creditmsg" role="status"><b>${esc(S.creditMsg)}</b></p></div>`;
    const t = creditTotal(); if (!(t > 0)) return "";
    return `<div class="zc-box" id="creditoffer"><p>You have credit of <b>${esc(money(t))}</b>${creditExpiry() ? ` (valid until ${esc(dayIst(creditExpiry()))})` : ""}. Use it for this game.</p><div class="zc-chips"><button type="button" class="zc-btn zc-btn-s" id="usecredit">Use my credit</button></div>${S.creditErr ? `<p class="zc-small zc-warnt" role="status">${esc(S.creditErr)}</p>` : ""}</div>`;
  }
  function creditsBlock() {
    const C = S.credits; if (!C || !Array.isArray(C.credits)) return "";
    const row = (c) => {
      const st = c.status === "used" ? "Used" : c.status === "expired" ? "Lapsed" : "Active";
      const when2 = c.status === "expired" ? `lapsed on ${dayIst(c.expiresMs)}` : c.status === "used" ? `used ${(c.uses || []).map((u) => dayIst(u.atMs) + (u.game ? " for " + u.game : "")).join(", ") || ""}` : `valid until ${dayIst(c.expiresMs)}`;
      return rowl(`${esc(money(c.status === "active" ? c.remainingInr : c.amountInr))}${c.status === "active" && c.remainingInr !== c.amountInr ? ` of ${esc(money(c.amountInr))}` : ""}<br><span class="zc-small zc-nomargin">${esc(when2)}${c.sourceGame ? " · from " + esc(c.sourceGame) : ""} · made ${esc(dayIst(c.createdMs))}</span>`, `<span class="zc-stt zc-stt-${st === "Active" ? "joined" : st === "Used" ? "invited" : "removed"}">${st}</span>`);
    };
    return `<div class="zc-block" id="creditsblock"><h3>Your credit</h3>${C.credits.length ? C.credits.map(row).join("") : small("You have no credit.")}${small("We do not give refunds. If you cancel a paid game before it starts, your payment stays in the Organizer's account as credit for the next game, for 365 days. Unused credit lapses at the end of day 365.")}</div>`;
  }
  async function loadCredits() { try { S.credits = await call("GET", "/api/org/credit"); } catch { S.credits = null; } }
  // ---------- games that wait for a payment, or did not start ----------
  const didNotStart = () => !!((S.info && S.info.didNotStart) || (S.sum && S.sum.didNotStart) || (S.coh && S.coh.didNotStart));
  const erasureMsOf = () => Number((S.sum && S.sum.erasureMs) || (S.info && S.info.erasureMs) || (S.coh && S.coh.erasureMs) || 0);
  const erasureLine = () => { const m = erasureMsOf(); return m && !didNotStart() && !payState().paid && !isCancelled() ? `<p class="zc-small" id="erasureline">Guest data will be erased on ${esc(dmy(m))} if the game does not start.</p>` : ""; };
  const didNotStartBlock = () => `<div class="zc-alert" id="didnotstart" role="status"><h3>This game did not start.</h3><p>Guest details have been erased.</p>${cloneButton()}</div>`;
  /** "Create a new game like this one": the panel (one place at the top) and what it does. */
  function clonePanel() {
    const K = S.clone; if (!K) return "";
    return `<div class="zc-alert" id="clonepanel" role="group" aria-label="Create a new game like this one"><h3>Create a new game like this one</h3>${small("The settings, prizes and brand are copied. The date, the payment, the guests and the Co-hosts are not.")}${K.hasPeople ? `<label class="zc-check" for="clonepeople"><input type="checkbox" id="clonepeople"${K.withPeople ? " checked" : ""}> Also bring my people list from the old game</label>` : small("The old guest list has been erased, so add your people again.")}${K.err ? `<p class="zc-small zc-warnt" role="status">${esc(K.err)}</p>` : ""}<div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s" id="clonego"${K.busy ? " disabled" : ""}>Create the new game</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="cloneno">Not now</button></div></div>`;
  }
  const hasOldPeople = () => !(S.life && S.life.purged) && (((S.people || []).length > 0) || ((S.pp.list || []).length > 0));
  /** Step 8: the only place a price is shown (and the Co-host's own Payment step, and the pay pages). */
  function stepPay() {
    if (!S.f) return small("Loading…");
    if (S.draft) return `<div class="zc-block" id="paynotpub"><h3>Publish first</h3>${small("You pay after you publish. Publishing is free. Check your game in step 7 and publish it. Then come back here.")}<div class="zc-chips"><button type="button" class="zc-mini" data-open="7">Go to step 7</button></div></div>`;
    if (isCancelled()) return small("This game was cancelled, so there is nothing to pay.");
    const price = S.sum && S.sum.priceInr ? `<div class="zc-rowl" id="pricerow"><span>Price for your game</span><b>${esc(priceText(S.sum))}</b></div>` : "";
    if (didNotStart()) return didNotStartBlock();
    const st = payState();
    const cr = creditOffer();
    const body = st.paid ? paidRow() : st.confirming ? rowl(`<b>Confirming your payment...</b><br><span class="zc-small zc-nomargin">The game starts only after the bank says yes. Nothing more to do.</span>`, "") : (payDueCard() || rowl("<b>Pay</b><br>Waiting for the payment.", `<a class="zc-btn zc-btn-s" href="/pay.html?e=${encodeURIComponent(eid)}">Pay</a>`));
    return price + cr + body + payLinkBlock() + erasureLine() + small("Paid late? The game starts 2 minutes after your payment is confirmed.");
  }

  // ---------- step 9: game day ----------
  const MSGS = ["Welcome! The game starts soon.", "Please take your seats", "Dinner is served", "Rewards at the stage in 10 minutes", "We start in 5 minutes", "Thank you for joining"];
  function announceBlock() {
    const avail = !!S.cf;
    return `<div class="zc-block"><h3>Message to everyone</h3>${small(avail ? "Shown and spoken on every phone and on the big screen. It reaches phones within about a minute." : (S.info && S.info.cap > 2000 ? "Messages are available for games of up to 2,000 people." : "Messages become available once this game is set up."))}
      <div class="zc-chips">${MSGS.map((c) => `<button type="button" class="zc-chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      ${lbl("annText", "Or write your own")}<textarea id="annText" class="zc-in zc-ta" rows="2" maxlength="160" placeholder="Write a short message"></textarea>
      <div class="zc-foot"><button class="zc-btn zc-btn-s" type="button" id="annSend"${avail ? "" : " disabled"}>Send to everyone</button> <button class="zc-btn zc-btn-s zc-btn-alt" type="button" id="annClear"${avail ? "" : " disabled"}>Clear message</button></div>${S.annNote ? `<p class="zc-small"><b>${esc(S.annNote)}</b></p>` : ""}</div>`;
  }
  const lineLabel = (s) => { const lines = (S.cfg && S.cfg.rewards || []).filter((l) => l.pattern === s.pattern), line = lines.find((l) => l.ordinal === s.ordinal); return ((S.cfg && S.cfg.rounds > 1) ? "Round " + (s.round || 1) + " · " : "") + (lines.length > 1 ? ["", "1st", "2nd", "3rd"][s.ordinal] || s.ordinal + "th" : "") + (lines.length > 1 ? " " : "") + NAMES[s.pattern] + (line && line.text ? " (" + line.text + ")" : ""); };
  const PNAME = NAMES;
  const prizeName = (p) => { const l = (S.cfg && S.cfg.rewards || []).find((x) => x.pattern === p.pattern && x.ordinal === p.ordinal); return p.pattern === "lucky" ? "Lucky draw " + p.ordinal : (PNAME[p.pattern] || p.pattern) + (p.ordinal > 1 ? " (" + p.ordinal + ")" : "") + (l && l.text ? " · " + l.text : ""); };
  function prizeBlock() {
    const P = S.prizes || [];
    if (!S.started || S.draft) return "";
    const rows = P.map((p, i) => `<div class="zc-rowl zc-top"><span><b>${S.shield ? "Seat " + esc(String(p.seat)) : esc(p.name || "Participant")}</b>${S.shield ? "" : " &middot; " + esc(p.phone || "")}<br><small class="zc-small zc-nomargin">${esc(prizeName(p))}${p.round > 1 ? " · round " + p.round : ""}${p.confirmed ? " · confirmed by the winner " + esc(dmy(p.confirmedMs)) : " · not confirmed by the winner yet"}</small>${p.changed && !S.shield ? `<br><small class="zc-badt"><b>Changed after the game.</b> Joined as ${esc(p.joinedWithName || "?")} · ${esc(p.joinedWithPhone || "?")}${(p.trail || []).map((t) => "; on " + esc(dmy(t.at)) + " changed to " + esc(t.name) + " · " + esc(t.phone)).join("")}</small>` : ""}</span>
      <label class="zc-check"><input type="checkbox" data-given="${i}" ${p.given ? "checked" : ""}> Prize given${p.given ? " " + esc(dmy(p.givenMs)) + (p.givenBy ? " by " + esc(p.givenBy) : "") : ""}</label></div>`).join("");
    const rankHtml = (() => { // BG-19: 1st, 2nd, 3rd ... and the top 10, in prize order, then call number, then fate; a tie decided by fate is explained
      const sett = (S.settledPreview || []).filter((x) => x.pids && x.pids.length).map((x) => ({ pattern: x.pattern, ordinal: x.ordinal, idx: x.idx, pids: x.pids.slice(0, 1), round: 1, tied: x.tied }));
      if (!sett.length || !S.cfg) return "";
      const rows = ZG.rankWinners(ZG.roundEid(eid, 1), S.cfg, sett, 10);
      const who = (r) => { const w = P.find((q) => q.pattern === r.pattern && q.ordinal === r.ordinal && (q.round || 1) === 1); return w ? (S.shield ? "Seat " + esc(String(w.seat)) : esc(w.name || "Participant")) : "Seat " + esc(String((/^(\d+)x/.exec(r.pid) || [0, "?"])[1])); };
      return `<h4>Ranking: top winners</h4><ol class="zc-rank" id="rankList">${rows.map((r) => `<li><b>${esc(ZG.rankName(r.rank))}</b> ${esc(NAMES[r.pattern] || r.pattern)}${r.text ? " (" + esc(r.text) + ")" : ""}: ${who(r)}${r.note ? `<br><small class="zc-small zc-nomargin">${esc(r.note)}</small>` : ""}</li>`).join("")}</ol>`;
    })();
    return `<div class="zc-block"><h3>Prizes handed over</h3>${rankHtml}${rows || small("No winner is confirmed yet.")}${small("After the game each winner confirms their name and mobile number on their own phone. Anything they change is shown here together with what they joined with. Tick \"Prize given\" when you hand the prize over: the date is kept. The winners record and your details as Organizer and Host are kept for 365 days. Co-host details are erased with the guests.")}</div>`;
  }
  function statsBlock() {
    if (!S.started || S.draft) return "";
    const ps = S.people, late = ps.filter((p) => p.jr > 0).length, viaInv = ps.filter((p) => p.inv).length, roles = ps.filter((p) => p.role).length;
    const byCat = {}; for (const p of ps) if (p.inv && p.cat) byCat[p.cat] = (byCat[p.cat] || 0) + 1;
    const label = (id) => ((ZG.INVITE_CATEGORIES || []).find((k) => k.id === id) || { label: id }).label;
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="zc-rowl"><span>${esc(label(k))}</span><b>${n}</b></div>`).join("");
    return `<div class="zc-block"><h3>The game has begun</h3><div class="zc-stats"><div><div class="zc-stat">${ps.length}</div><div class="zc-small zc-nomargin">people in the game</div></div><div><div class="zc-stat">${late}</div><div class="zc-small zc-nomargin">joined after the start</div></div><div><div class="zc-stat">${viaInv}</div><div class="zc-small zc-nomargin">came through an invitation</div></div><div><div class="zc-stat">${S.settledPreview.length}</div><div class="zc-small zc-nomargin">prizes won so far</div></div></div>
      ${cats ? `<h4>Invitations by kind of guest</h4>${cats}` : ""}${roles ? small(roles + " Organizer / Host / Co-host " + (roles === 1 ? "seat" : "seats") + " playing along.") : ""}
      ${small("When the game ends we e-mail you the complete report as a PDF: when it started, how many people at each stage, every prize and winner, who invited whom, all statistics, and every name and mobile number.")}</div>`;
  }
  function luckyBlock() {
    const L = (S.cfg && S.cfg.breaks || []).filter((b) => b.kind === "lucky");
    if (!L.length) return "";
    return `<div class="zc-block"><h3>Lucky draws</h3>${L.map((b, i) => { const d = S.lucky && S.lucky[i]; const done = (S.published || []).some((r) => r.pattern === "lucky" && r.ordinal === i + 1); return rowl(`${esc(b.title)} · ${b.winners || 3} ${(b.winners || 3) === 1 ? "person" : "people"}`, done ? `<b>Decided</b>` : d ? `<b>Being confirmed by the phones</b>` : `<span class="zc-small zc-nomargin">after the break ends</span>`); }).join("")}
      ${small("The software picks the winners from everyone who joined, using public random numbers. You and we cannot choose them. A winner is confirmed when several phones agree.")}</div>`;
  }
  function rewardsBlock() {
    const bad = S.checked ? S.checked.bad.length : 0;
    return `<div class="zc-block"><h3>Rewards, from the public number log</h3>${S.settledPreview.length ? S.settledPreview.map((s) => rowl(`${esc(lineLabel(s))} · call ${s.idx + 1}`, `<b>${s.pids.length} participant${s.pids.length === 1 ? "" : "s"}${s.names ? " · " + esc(s.names) : ""}</b>`)).join("") : small("No place has been decided yet.")}
      ${small(`Claims received: ${S.claims.length}. ${bad ? `<b>${bad} not valid</b> (they do not match the public log and are ignored).` : "All claims so far match the public log."}`)}
      ${small(`Numbers come from a public random beacon. Winners are confirmed when several phones agree. You and we cannot choose or change them in the software. Confirmed so far: ${(S.published || []).filter((r) => r.pattern !== "lucky").length}.`)}
      <button type="button" class="zc-mini" id="csv"${S.settledPreview.length && !S.shield ? "" : " disabled"}>Download report</button></div>`;
  }
  function stepDay() {
    if (S.draft) return small("This opens when your game is published. Then you run the tournament from here.") + cont(9);
    const v = S.ttt || {}, eu = encodeURIComponent(eid);
    const state = v.state === "done" ? (v.endedEarly ? "Ended" : "Finished") : v.state === "running" ? (v.paused ? "Paused" : "Running") : v.state === "starting" ? "Starting" : "Not started yet";
    const ranking = v.state === "done" && (v.ranking || []).length ? `<div class="zc-block"><h3>Results</h3><ol class="zc-rank" id="rankList">${v.ranking.slice(0, 5).map((r) => `<li><b>${esc(r.name)}</b>${r.tie ? `<br><small class="zc-small zc-nomargin">${esc(r.tie)}</small>` : ""}</li>`).join("")}</ol>${small("The first five places are named here. Any gift for them is yours to hand over: this tool gives and takes no money and no prizes.")}</div>` : "";
    return `<div class="zc-block"><h3>Run the tournament</h3>${rowl("Tournament", `<b id="tstate">${state}</b>`)}${rowl("Players who joined", `<b>${Number(v.joined != null ? v.joined : S.people.length) || 0}</b>`)}
        <a class="zc-btn zc-gap" id="runt" href="/host.html?e=${eu}">Open the tournament page</a>${small("There you choose one against one or teams and the move clock, press Start, and pause or resume. Keep that page open while the tournament runs: it sends the draw and looks after boards where both players are away.")}</div>
      <div class="zc-block"><h3>Big screen</h3><a class="zc-chip" id="bigopen" href="${esc(bigLink())}" target="_blank" rel="noopener">Open the big screen</a>${small("For the laptop on the room screen or a shared video call. It shows the bracket, the live boards and the results, with names only.")}</div>`
      + ranking + playBlock() + cont(9);
  }

  // ---------- step 10: after the game ----------
  const afterClone = () => (didNotStart() || isCancelled() || (S.life && (S.life.purged || S.life.reportSent)) ? cloneButton() : "");
  function stepAfter() {
    const l = S.life;
    const when2 = l ? `${rowl("Names, mobile numbers, seats and invitations of participants and Co-hosts", `<b>deleted by ${esc(ist(l.personalDeleteAtMs))}${l.purged ? " (done)" : ""}</b>`)}
      ${rowl("Complete report: a link is e-mailed to you, and the PDF is built on your own device", `<b>${l.reportSent ? "link sent" : l.purged ? "not sent" : "after the game ends"}</b>`)}
      ${rowl("Your details as Organizer and Host, and the winners record", `<b>kept until ${esc(dayIst(l.fullDeleteAtMs))}</b>`)}` : "";
    const rpt = !S.shield && S.life && S.life.reportSent && !S.life.purged ? `<div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s" id="rptopen">Open the report now</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="rptnew">New report link</button></div>` : "";
    return small("Within 24 hours of the game ending we send you the report, then delete every participant's name and number. Your details as Organizer and Host, and the winners record, are kept for 365 days. Co-host details are erased with the guests.") + when2 + rpt
      + `<div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s zc-btn-bad" id="erase">Delete all participant data now</button></div>`
      + small("You tap once to confirm. You can also e-mail us from your registered address, or ask your AI assistant to request the deletion and then confirm it here. The report is e-mailed first when the game has already ended.")
      + afterClone() + cont(10, "All done");
  }

  // ---------- the co-host's three steps ----------
  const cohInvite = () => (S.coh && S.coh.inviteLink) || guestLink();
  function cohStep(n) {
    const c = S.coh;
    if (!c) return `<p class="zc-small zc-warnt" role="status">${esc(S.cohErr || "Loading your game…")}</p>`;
    if (n === 1) return rowl(`<b>${esc(c.name || "Your game")}</b>, ${esc(c.startMs ? when(c.startMs) : "")}`, `<span class="zc-small zc-nomargin">read only</span>`) + rowl(`${Number(c.joined) || 0} ${Number(c.joined) === 1 ? "person" : "people"} joined of ${Number(c.cap) || 0}`, "") + small("You cannot change the game.") + `<span class="zc-lbl">What you can do</span>` + roleCards("cohost") + `${cont(1)}`;
    if (n === 2) return `<span class="zc-lbl">Your own invite link</span>` + (c.inviteLink ? `<div class="zc-linkrow"><span class="zlink">${esc(cohInvite())}</span><button type="button" class="zc-mini" id="copy">Copy link</button></div>
      <div class="zc-chips zc-gap"><a class="zc-chip" href="${esc("https://wa.me/?text=" + encodeURIComponent("You are invited to play Corporate Tic Tac Toe. Join here: " + cohInvite()))}" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></div>` : small("Your link appears once the game is published."))
      + `
      ${rowl("People you brought", `<b>${Number(c.brought) || 0}</b>`)}${small("You can invite as many people as you like.")}
      ${peopleBlock()}${small("Want your guests to invite their own friends? Ask the Organizer or a Host to switch it on. You cannot switch it on yourself.")}${cont(2)}`;
    const p = payState();
    return `<p class="zc-small">Status: <b>${payLabel(p)}</b></p>` + (p.paid ? paidRow() : p.confirming ? rowl(`<b>Confirming your payment...</b><br><span class="zc-small zc-nomargin">The game starts only after the bank says yes.</span>`, "") : rowl(`<b>Pay</b>${c.startMs ? " before " + esc(when(c.startMs)) : ""}<br><span class="zc-small zc-nomargin">${c.price ? esc(typeof c.price === "number" ? money(c.price) : String(c.price)) + ". " : ""}Pay once, from any one of you.</span>`, `<a class="zc-btn zc-btn-s" href="/pay.html?e=${encodeURIComponent(eid)}">Pay</a>`)) + payLinkBlock() + cont(3, "All done");
  }

  // ---------- the page: top bar, strips, progress, steps, help ----------
  const HELP = [
    ["How do I start?", "Open step 1 and tap your choices. Your game saves as you go."],
    ["Can the AI do this for me?", "Yes. Copy your AI link at the top and paste it in any AI chat."],
    ["Who pays?", "Any one of the Organizer, a Host or a Co-host. Only one payment is needed. Guests pay nothing."],
    ["What if nobody pays?", "The game does not begin. Nothing is charged. Once one payment is made, the game is on."],
    ["Can I change things later?", "Yes, until the tournament starts. Open the step and change it."],
    ["How do I add my logo?", "Open step 4, type your company name, pick a colour and add a small logo. Tap See what players see to check it."],
    ["What do players see?", "A tic tac toe board on their phone. No app to install, and they type only a name."],
    ["Is my guests' data safe?", "It is encrypted. Names and numbers are erased within 24 hours after the game."],
    ["How is the champion chosen?", "Players meet one against one and the winner moves up. A drawn game is replayed with the marks swapped, up to three games, and then fate decides. There is always one champion."],
    ["How do I pause the tournament?", "Open Game day, open the tournament page and tap Pause. The Organizer and Hosts can do this."],
    ["Who can do what?", "The Organizer can do everything, including the account (keys, e-mail, AI link). A Host can do everything in the game except the account and adding Hosts. A Co-host invites people and can pay. Open step 5 to see it."],
    ["What is the big screen link?", "A page for a projector or TV. It shows the bracket, the live boards and the results, with names only and never a number. Copy it in step 6 and open it on the laptop connected to the screen."],
    ["Can I get a refund?", "We do not give refunds. If you cancel a paid game before it starts, your payment stays in the Organizer's account as credit for the next game, for 365 days. Unused credit lapses at the end of day 365."],
    ["Who do I contact?", "Write to our Grievance Officer. We reply within 30 days."],
  ];
  const ROLE_LABEL = { organizer: "Organizer", host: "Host", cohost: "Co-host", partner: "Partner" };
  function rolePill() {
    const r = role();
    if (r === "partner") return /^refer/.test(S.kind) ? "Refer and Earn Partner" : /^sales/.test(S.kind) ? "Sales Partner" : "Partner";
    if (r === "host" && S.hostN) return `Host ${S.hostN} of ${(S.team && S.team.maxHosts) || 5}`;
    return ROLE_LABEL[r];
  }
  const inGame = () => !!eid && S.screen !== "quick" && (role() === "cohost" ? !!S.coh || !!S.cohErr : !!S.cfg);
  function gameLabel() {
    if (!inGame()) return "";
    if (role() === "cohost") return S.coh ? `${S.coh.name || "Your game"} · ${S.coh.startMs ? when(S.coh.startMs) : ""}` : "";
    return `${(S.cfg && S.cfg.name) || "Your game"} · ${S.info ? when(S.info.startMs) : ""}`;
  }
  function barHtml() {
    const g = inGame() && role() !== "partner", p = payState();
    return `<header class="zc-bar"><span class="zc-brand"><img src="/icon-192.png" alt="" width="22" height="22"> <b>Corporate Tic Tac Toe</b></span><span class="zc-pill zc-pill-role" id="rolepill" title="Your role">${esc(rolePill())}</span>`
      + (g ? `<span class="zc-pill ${p.paid ? "zc-pill-paid" : "zc-pill-pend"}" id="paypill" title="Payment status">${payLabel(p)}</span>` : "")
      + `<span class="zc-where">${esc(gameLabel())}</span>${isOrg() && eid ? `<button type="button" class="zc-mini" id="back">All games</button>` : ""}</header>`;
  }
  function payNote() {
    if (!inGame() || role() === "partner" || payState().paid || isCancelled() || didNotStart()) return "";
    if (payState().confirming) return `<div class="zc-paynote" id="paynote" role="note"><b>Confirming your payment...</b> This takes a moment. The game starts only after the bank says yes. Nothing more to do.</div>`;
    return `<div class="zc-paynote" id="paynote" role="note"><b>A payment is pending for this game.</b> Just one of you needs to make it: the Organizer, a Host or a Co-host. Guests pay nothing. It is for this one game only, with no commitment and no repeat charges.${erasureMsOf() && role() !== "cohost" ? ` <span id="erasurestrip">Guest data will be erased on ${esc(dmy(erasureMsOf()))} if the game does not start.</span>` : ""}</div>`;
  }
  function aiStrip() {
    if (!isOrg()) return "";
    return `<div class="zc-ai" id="aistrip"><div class="zc-split"><b>Your AI assistant work link</b>${S.aiMsg ? `<button type="button" class="zc-mini" id="aistripcopy">Copy</button>` : `<button type="button" class="zc-mini" id="aistripmake">Get my AI work link</button>`}</div>
      <div class="zc-small zc-nomargin">Copy and paste it in any AI chat, like ChatGPT, Gemini, Claude, Grok, DeepSeek, z.ai and others. Copy it as many times as you like.</div>${shieldSwitch()}</div>`;
  }
  function progHtml() {
    const st = steps(), d = st.filter((s) => isDone(s[0])).length, p = Math.round(d * 100 / st.length);
    return `<div class="zc-prog"><div class="zc-split"><span>Your progress · saved</span><span><b>${d} of ${st.length} done</b> · ${p}%</span></div><div class="zc-track" role="progressbar" aria-label="Your progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><div class="zc-fill" id="progfill" style="width:${p}%"></div></div>
      <div class="zc-jump"><span>Jump to</span>${st.map((s) => `<button type="button" class="zc-dot" data-open="${s[0]}" aria-label="Step ${s[0]}: ${esc(s[1])}" style="background:var(--bg-tint-${s[2]});color:var(--text-tint-${s[2]})${S.open === s[0] ? `;outline:2px solid var(--text-tint-${s[2]})` : ""}">${s[0]}</button>`).join("")}<button type="button" class="zc-pillbtn" data-act="help">Help</button></div></div>`;
  }
  function sum(n) {
    if (role() === "cohost") { const c = S.coh; if (!c) return ""; return [c.startMs ? when(c.startMs) : "", `${Number(c.brought) || 0} ${Number(c.brought) === 1 ? "person" : "people"} brought`, payState().paid ? "Paid" : "Payment pending for this game"][n - 1] || ""; }
    const c = S.cfg, inf = S.info; if (!c || !inf) return "";
    const T = S.team;
    return [`${c.name || "Your game"}, ${when(inf.startMs)}`, `Up to ${inf.cap} players`, `${(c.rewards || []).length} prizes`, brandNow(),
      T ? `${pl((T.hosts || []).length, "Host", "Hosts")}, ${pl((T.cohosts || []).length, "Co-host", "Co-hosts")}` : "", S.draft ? "Guest link ready after publishing" : "Guest link ready", S.draft ? "Not published yet" : "Published", S.draft ? "Publish first" : isCancelled() ? "Cancelled" : payState().paid ? "Paid. The game is on" : payState().confirming ? "Confirming your payment..." : "Payment pending", S.ttt && S.ttt.state === "done" ? "Finished" : S.ttt && S.ttt.state && S.ttt.state !== "open" ? "The tournament is on" : "Opens when you press Start", "Your report, then erasing data"][n - 1] || "";
  }
  // "About this step": a short, always-visible write-up under each talking line (docs/ROLES_AND_CONSOLE_SPEC_4.md, A). At most 5 short lines each.
  const ABOUT = {
    1: ["This is the basics. Pick the occasion, the day and the time.", "Times are in your own time zone, as your device shows it.", "Players can join before the start. You press Start on the tournament page when everybody is in.", "You can change all this until the tournament starts."],
    2: ["Pick the biggest crowd you expect. Or type your own number. You see the price when you pay.", "Who can join: \"Only people on a list\" keeps it private, and people not on a list wait for you to let them in.", "\"Anyone with the link\" lets people in at once.", "Players type just their name to join. It is a knockout with one champion; you choose the format and the move clock on the day."],
    3: ["Tick the places you will give a gift for: Champion, Runner-up, 3rd, 4th and 5th place. Say what each gift is.", "\"I will decide later\" is fine. You can still publish and choose before the tournament starts.", "\"No prize\" shows as \"No prize\" in the results.", "You give the gifts, outside this tool. Players never pay and nothing is staked.", "The places come from the games themselves. Nobody can change them, not even us."],
    4: ["Add your company name, a colour and a small logo for the top of every player's page and the big screen.", "Press \"See what players see\" to check it before you publish."],
    5: ["A Host runs the tournament with you. A Host needs a name, a mobile number and an e-mail.", "A Co-host invites people and can pay. A Co-host needs a name and a mobile number only.", "Players need a name only.", "Send each private link to one person only.", "Each Co-host can add up to 100 people unless you change it below."],
    6: ["Add your people here, one by one, from your phone contacts (where your phone allows it), by pasting from Excel or by uploading a CSV.", "Each person gets their own link to send by WhatsApp or e-mail. Or share the one common link in Slack, Teams, Zoom chat or any group.", "With \"Only people on a list\", people who are not on your list wait under \"Waiting to come in\". You can let them in one by one or press \"Approve all\".", "The big screen link is for the laptop connected to the room screen or shared in your video call. It shows the bracket, the live boards and the results, names only."],
    7: ["Look through your game and change what you need.", "Publishing is free. Players can join after you publish.", "You can cancel before the start time. We do not give refunds: a paid game becomes credit for your next game for 365 days. Or change the date instead.", "Press \"See what players see\" to look at a sample player page."],
    8: ["Pay once, before the start time. You see the price here.", "The Organizer, a Host or a Co-host can pay.", "Paid late? The game opens 2 minutes after your payment is confirmed.", "A paid game cannot be cancelled after the start time. Before it, your payment stays as credit for 365 days.", "\"Copy payment link\" makes a link anyone can open to pay for this game."],
    9: ["Open the tournament page, choose the format and the move clock, and press Start.", "Keep that page open while it runs: it sends the draw and looks after boards where both players are away.", "Pause and Resume are on that page. Only the Organizer and a Host can start, pause or settle a board.", "Only the Organizer and Host can remove a person."],
    10: ["Within a day after the tournament, the participant data is erased and a report link is e-mailed to the Organizer.", "Player names are erased within 24 hours.", "We keep the winners record and the Organizer's and Hosts' details for 365 days.", "You can erase player data earlier."],
  };
  const ABOUT_COH = { 1: ["You can see the game and what you may do."], 2: ["Add your people. Each gets their own WhatsApp link. You can bring up to your limit."], 3: ["One payment is enough. If someone has paid, you will see Paid.", "\"Copy payment link\" makes a link anyone can open to pay for this game."] };
  const aboutBox = (n) => { const L = (role() === "cohost" ? ABOUT_COH : ABOUT)[n]; return L ? `<div class="zc-about" id="about${n}"><b>About this step</b>${L.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""; };
  const badge = (s) => `<span class="zc-num" style="background:var(--text-tint-${s[2]})">${s[0]}</span>`;
  function synHtml() {
    return steps().map((s) => { const d = isDone(s[0]); return `<button type="button" class="zc-syn${S.open === s[0] ? " act" : ""}" data-open="${s[0]}">${badge(s)}<span class="zc-syntx"><b>${esc(s[1])}</b><br><span class="zc-muted">${esc(sum(s[0]) || (d ? "Done" : "To do"))}</span></span><span class="zc-st${d ? " ok" : ""}" aria-label="${d ? "Done" : "To do"}">${d ? "&#10003;" : "&#9675;"}</span></button>`; }).join("");
  }
  const stepBody = (n) => (role() === "cohost" ? cohStep(n) : [stepGame, stepPlay, stepPrizes, stepBrand, stepTeam, stepShare, stepPublish, stepPay, stepDay, stepAfter][n - 1]());
  function secHtml(s) {
    const n = s[0], isOpen = S.open === n, d = isDone(n), c = s[2], sm = sum(n);
    return `<section class="zc-card${isOpen ? " open" : ""}" id="sec${n}" style="${isOpen ? `border-color:var(--text-tint-${c})` : ""}"><button type="button" class="zc-sech" data-open="${n}" aria-expanded="${isOpen}" aria-controls="secb${n}" style="background:var(--bg-tint-${c});color:var(--text-tint-${c})">${badge(s)}<span class="zc-syntx"><b>${esc(s[1])}</b><br><span class="zc-hint">${esc(isOpen || !sm ? s[3] : sm)}</span></span><span class="zc-st">${d ? "&#10003;<span class=\"zc-sr\"> Done</span>" : isOpen ? "&#9650;" : "&#9660;"}</span></button>`
      + (isOpen ? `<div class="zc-secb" id="secb${n}"><div class="zc-say" style="background:var(--bg-tint-${c});color:var(--text-tint-${c})">${d ? "Saved. You can change it any time." : esc(s[4])}</div>${aboutBox(n)}${S.toast ? `<div class="zc-toast" role="status">${esc(S.toast)}</div>` : ""}${stepBody(n)}</div>` : "") + `</section>`;
  }
  function nextHtml() {
    const n = nextStep();
    if (!n) return `<div class="zc-next zc-next-ok"><span><b>All done.</b> Nothing else to do.</span></div>`;
    return `<div class="zc-next"><span><b>Next:</b> ${esc(n[1])}. ${esc(n[4])}</span><button type="button" class="zc-mini" data-open="${n[0]}">Go</button></div>`;
  }
  function helpHtml() {
    return `<section class="zc-card zc-help" id="help"><div class="zc-sech zc-sech-static"><span class="zc-num zc-num-dark">?</span><span class="zc-syntx"><b>Help</b><br><span class="zc-hint">Tap a question. The answer is short.</span></span></div><div class="zc-secb">${HELP.map((x, i) => `<div class="zc-q"><button type="button" class="zc-qh" data-q="${i}" aria-expanded="${S.q === i}"><span>${esc(x[0])}</span><span aria-hidden="true">${S.q === i ? "&#9650;" : "&#9660;"}</span></button>${S.q === i ? `<div class="zc-qa">${esc(x[1])}</div>` : ""}</div>`).join("")}
      <div class="zc-chips zc-gap"><button type="button" class="zc-mini" data-act="steps">Back to your steps</button><button type="button" class="zc-mini" data-act="top">Back to top</button></div></div></section>`;
  }
  // ---------- the account: only the Organizer's ----------
  const AIOPEN = [["ChatGPT", "https://chatgpt.com/?q="], ["Grok", "https://grok.com/?q="], ["Claude", "https://claude.ai/new?q="]];
  const AICOPY = [["Gemini", "https://gemini.google.com/app?q="], ["DeepSeek", "https://chat.deepseek.com/"], ["z.ai", "https://chat.z.ai/"]];
  const aiOptions = (paste) => `<div class="zc-small"><b>Open your AI with this already filled in</b></div><div class="zc-chips">${AIOPEN.map(([n, u]) => `<a class="zc-chip" data-ai="${n}" href="${u}${encodeURIComponent(paste)}" target="_blank" rel="noopener noreferrer">${n}</a>`).join("")}</div>
    <div class="zc-small"><b>Copy it and open your AI, then press Ctrl+V and Send</b></div><div class="zc-chips">${AICOPY.map(([n, u]) => `<button class="zc-chip" type="button" data-aicopy="${n}" data-url="${u}${n === "Gemini" ? encodeURIComponent(paste) : ""}">${n}</button>`).join("")}</div><div class="zc-small zc-okt" id="aicopied" role="status"></div>`;
  const wireAiOptions = (root, paste) => root.querySelectorAll("[data-aicopy]").forEach((b) => (b.onclick = async () => {
    let ok = false; try { await navigator.clipboard.writeText(paste); ok = true; } catch {}
    const m = root.querySelector("#aicopied"); if (m) m.textContent = ok ? "Copied. Press Ctrl+V, then Send" : "Could not copy here: select the box above, copy it, then open " + b.dataset.aicopy + " and paste.";
    try { window.open(b.dataset.url, "_blank", "noopener,noreferrer"); } catch {}
  }));
  function aiBlock() {
    const ai = S.aiMsg
      ? `<textarea class="zc-in zc-ta zlink" id="aimsg" rows="4" readonly aria-label="Your AI work link">${esc(S.aiMsg)}</textarea><div class="zc-chips zc-gap"><button type="button" class="zc-btn zc-btn-s" id="aicopy">Copy my AI work link</button></div>${aiOptions(S.aiMsg)}<div class="zc-chips zc-gap"><button type="button" class="zc-mini" id="aifresh">Get a fresh AI link</button><button type="button" class="zc-mini" id="aireplace">Replace my AI link</button><button type="button" class="zc-mini zc-danger" id="airevoke">Stop this link</button></div><p class="zc-small"><b>Fresh link</b>: e-mailed, works 24 hours. <b>Replace</b>: stops every old link.</p>`
      : `<button type="button" class="zc-btn zc-btn-s" id="aimake">Get my AI work link</button>`;
    return `<div class="zc-block"><h3>Let your free AI assistant do the work</h3><p class="zc-small">Copy your AI work link and paste it into <b>ChatGPT, Gemini, Grok, Claude, DeepSeek, Z.ai</b> or any AI chat. It sets everything up. You keep four things: payment, Publish, erasing data, pause or stop.</p>${ai}
      <h4>An AI in your web browser, or do it yourself</h4>${small("Use an AI that works in your web browser (Claude in Chrome, Gemini in Chrome, ChatGPT Atlas, Perplexity Comet): tick <b>My AI works in my web browser</b> in the AI Assistant box, so it never sees a guest's name or number, then ask it to open this page and set up your game with the Quick setup form. It stops at Publish, erase, pause and stop, and it never pays.")}
      <div class="zc-chips"><a class="zc-chip" href="/zc.html?quick=1">Quick setup form (date and time pickers)</a><a class="zc-chip" href="/demo.html" target="_blank" rel="noopener">Try the free 70-second demo</a></div></div>`;
  }
  function acctHtml() {
    if (!isOrg()) return "";
    const open = S.acctOpen === null ? !eid : S.acctOpen;
    const credits = creditsBlock();
    const keys = (S.keys || []).length ? `<div class="zc-block"><h3>Your sign-in keys</h3>${S.keys.map((k) => `<div class="zc-rowl"><span>${k.kind === "ai" ? "AI assistant link" : k.kind === "host" ? "Host key" : k.kind === "cohost" ? "Co-host key" : "Organizer key"} · made ${new Date(k.created_ms).toLocaleDateString()}${k.thisOne ? " · in use now" : ""}</span>${k.revoked ? `<i>retired</i>` : k.thisOne ? `<i>active</i>` : `<button type="button" class="zc-mini" data-retirekey="${esc(k.id)}">Retire</button>`}</div>`).join("")}${small("If you ever lose a key or think someone has it, sign in with another one and retire it here.")}</div>` : "";
    const sugs = (S.sugs || []).length ? `<div class="zc-block"><h3>Ideas to improve Corporate Tic Tac Toe</h3>${small("Suggested by organizers' AI assistants. We review them all.")}${S.sugs.map((x) => rowl(esc(x.title) + (x.yours ? " · yours" : ""), `<i>${x.votes} · ${esc(x.status.replace("_", " "))}</i>`)).join("")}</div>` : "";
    const T = S.aiTrail;
    const audit = `<div class="zc-block"><h3>What your AI assistant did</h3>${T ? (T.length ? T.slice(0, 40).map((t) => `<div class="zc-rowl"><span>${esc(dmy(t.at_ms))}<br><small class="zc-small zc-nomargin">${esc(t.method)} ${esc(t.path)} → ${esc(String(t.status))} · from ${esc(t.ip || "?")} ${esc(t.country || "")} · ${esc((t.ua || "").slice(0, 60))} · key ${esc(t.key_id || "")}</small></span></div>`).join("") : small("Your AI assistant has not made any call yet.")) : `<button type="button" class="zc-mini" id="aiaudit">Show the AI activity log</button>`}${small("Every call your AI assistant makes is recorded with the time, the key used and where it came from. It is kept for 365 days.")}</div>`;
    const close = `<div class="zc-block"><h3>Close my account</h3>${small("This deletes your account and all your games. It cannot be undone. We keep billing data for audit and tax reasons.")}<button type="button" class="zc-mini zc-danger" id="closeacct">Close my account</button></div>`;
    return `<section class="zc-card zc-acct" id="acct"><button type="button" class="zc-sech" data-acct="1" aria-expanded="${open}" style="background:var(--surface-1)"><span class="zc-num zc-num-dark">A</span><span class="zc-syntx"><b>Your account</b><br><span class="zc-hint">These are for the Organizer only: your AI link, sign-in keys and records. Closing your account deletes your games.</span></span><span class="zc-st">${open ? "&#9650;" : "&#9660;"}</span></button>${open ? `<div class="zc-secb">${aiBlock()}${credits}${keys}${sugs}${audit}${close}</div>` : ""}</section>`;
  }
  // ---------- notes above the steps ----------
  const ACTTEXT = { publish: "Publishing is free. Check your e-mail and mobile number, then press \"Confirm and publish\" yourself.", erase: "Press \"Delete all participant data now\" only if you want every guest's name and number erased. It cannot be undone.", pause: "Open the tournament page below and press \"Pause for everyone\" there. The clocks stop for every player until you press Resume.", stop: "To end the tournament now, open the tournament page below and press \"End the tournament\" there. Nobody is ranked. To stop it for a while, press \"Pause for everyone\" instead." };
  const actBanner = () => (ACT && ACTTEXT[ACT] && eid && canRun() ? `<div class="zc-toast" role="status" id="actbanner"><b>Your AI assistant brought you here.</b> ${ACTTEXT[ACT]} Nobody but you can press it.</div>` : "");
  const ACTSTEP = { publish: 7, erase: 10, pause: 9, stop: 9 };
  /** The AI helper switch: one small line inside the AI Assistant box (Organizer only). Off by default. The shield behaviour itself is unchanged. */
  const shieldSwitch = () => `<div class="zc-shield"><label class="zc-check" for="shield"><input type="checkbox" id="shield" ${S.shield ? "checked" : ""}> My AI works in my web browser: hide guest names and numbers</label>${S.shield ? `<div class="zc-small zc-nomargin">On. This page shows no guest name or mobile number. Switch it off to load your guest list or look up a guest.</div>` : ""}</div>`;
  function alertZone() {
    let h = actBanner() + clonePanel();
    if (S.cloneNew === eid && S.draft && canRun()) h += `<div class="zc-toast" role="status" id="newgamenote">This is a new game. Nothing is paid or published yet.</div>`;
    if (didNotStart() && inGame() && canRun()) h += didNotStartBlock();
    if (isCancelled() && inGame()) h += `<div class="zc-toast" role="status" id="cancelnote">This game was cancelled. Guests can see this. Nothing more is needed.</div>`;
    if (S.note) h += `<div class="zc-toast" role="status" id="zcnote">${esc(S.note)}</div>`;
    if (canRun()) {
      if (S.locked && !S.draft) h += payDueCard();
      if ((S.reqs || []).length) h += `<div class="zc-alert"><h3>Your AI assistant is asking</h3>${S.reqs.map((r) => rowl(esc(r.action) + (r.note ? " · " + esc(r.note) : ""))).join("")}<div class="zc-chips"><button type="button" class="zc-btn zc-btn-s${S.reqs[0].action === "erase" ? " zc-btn-bad" : ""}" id="reqok">${S.reqs[0].action === "erase" ? "Confirm: delete all participant data" : "Approve (" + esc(S.reqs[0].action) + ")"}</button><button type="button" class="zc-btn zc-btn-s zc-btn-alt" id="reqno">Dismiss</button></div></div>`;
      if (!S.draft && S.cfg) h += `<div class="zc-live" id="zclive"><b>${S.people.length}</b> ${S.people.length === 1 ? "person" : "people"}${S.ttt && S.ttt.state ? " · tournament " + ({ open: "not started yet", starting: "starting", running: "running", done: "finished" }[S.ttt.state] || "") : ""}</div>`;
    }
    return h;
  }
  function mainHtml() {
    const r = role();
    return `<div id="zc-top"></div>${alertZone()}<div class="zc-small zc-rolenote">${esc(ROLE_NOTE[r])}</div>${nextHtml()}${steps().map(secHtml).join("")}${helpHtml()}${acctHtml()}`;
  }
  function tabsHtml() {
    const n = nextStep();
    return `<nav class="zc-tabs" aria-label="Steps">${[["sheet", "Steps"], [n ? "next" : "top", "Next"], ["help", "Help"], ["top", "Top"]].map(([a, l]) => a === "next" ? `<button type="button" class="zc-tab" data-open="${n[0]}">${l}</button>` : `<button type="button" class="zc-tab" data-act="${a}">${l}</button>`).join("")}</nav>`;
  }
  function frame(inner, withNav) {
    return `<div class="zc-frame">${barHtml()}${withNav ? payNote() : ""}${aiStrip()}${withNav ? progHtml() : ""}${withNav && S.sheet ? `<div class="zc-sheet"><div class="zc-small zc-nomargin">Your game at a glance</div>${synHtml()}</div>` : ""}${inner}${withNav ? tabsHtml() : ""}</div>`;
  }
  function engView() {
    const r = role();
    const side = `<aside class="zc-side"><div class="zc-me"><span class="zc-num zc-num-dark">${esc(ROLE_LABEL[r].charAt(0))}</span><span><span class="zc-muted">You are</span><br><b>${esc(rolePill())}</b></span></div><div class="zc-small zc-nomargin">Your game at a glance</div>${synHtml()}<div class="zc-small">Payment: <b>${payState().paid ? "Paid" : payState().confirming ? "Confirming..." : "Pending"}</b></div></aside>`;
    return frame(`<div class="zc-body">${side}<div class="zc-main">${mainHtml()}</div></div>`, true);
  }
  function cohostView() {
    const side = `<aside class="zc-side"><div class="zc-me"><span class="zc-num zc-num-dark">C</span><span><span class="zc-muted">You are</span><br><b>Co-host</b></span></div><div class="zc-small zc-nomargin">Your game at a glance</div>${synHtml()}</aside>`;
    return frame(`<div class="zc-body">${side}<div class="zc-main"><div id="zc-top"></div>${S.note ? `<div class="zc-toast" role="status">${esc(S.note)}</div>` : ""}${S.cohErr && !S.coh ? `<div class="zc-toast" role="status">${esc(S.cohErr)}</div>` : ""}<div class="zc-small zc-rolenote">${esc(ROLE_NOTE.cohost)}</div>${S.coh && S.coh.waitingFor && !didNotStart() ? `<div class="zc-toast" role="status" id="cohwaiting">Waiting for the Organizer or Host to start the game.</div>` : ""}${S.coh && didNotStart() ? `<div class="zc-alert" id="didnotstart" role="status"><h3>This game did not start.</h3><p>Guest details have been erased.</p></div>` : ""}${nextHtml()}${steps().map(secHtml).join("")}${helpHtml()}</div></div>`, true);
  }
  const loadingView = () => frame(`<div class="zc-body"><div class="zc-main"><div class="zc-toast" role="status">${esc(S.note || "Loading…")}</div>${eid && isOrg() ? "" : ""}</div></div>`, false);
  const waitLinkView = () => { const gs = role() === "host" && S.history && S.history.engagements ? S.history.engagements : []; if (gs.length) return frame(`<div class="zc-body"><div class="zc-main"><div class="zc-block"><h3>Your games</h3>${small("Pick the game you are helping with.")}${gs.map((e) => `<div class="zc-rowl"><span>${esc(e.id)}${e.draft ? " · draft" : ""}</span><span><button type="button" class="zc-mini" data-open-game="${esc(e.id)}">Open</button> <button type="button" class="zc-mini" data-clonebtn="1" data-from="${esc(e.id)}" data-people="${e.participants > 0 && !e.erased ? 1 : 0}">Create a new game like this one</button></span></div>`).join("")}</div></div></div>`, false); return waitLinkView0(); };
  const waitLinkView0 = () => frame(`<div class="zc-body"><div class="zc-main"><div class="zc-block"><p style="margin:0">Open the link your ${role() === "cohost" ? "Organizer or Host" : "Organizer"} sent you. It opens the game directly.</p></div>${S.note ? `<div class="zc-toast" role="status">${esc(S.note)}</div>` : ""}</div></div>`, false);
  const partnerView = () => frame(`<div class="zc-body"><div class="zc-main"><div class="zc-block"><h3>Your partner area</h3><p>Your partner screens are on their own page.</p><a class="zc-btn zc-btn-s" href="/partner.html">Open my partner area</a></div></div></div>`, false);
  function loginView(msg) {
    return `<div class="zc-frame zc-login"><header class="zc-bar"><span class="zc-brand"><img src="/icon-192.png" alt="" width="22" height="22"> <b>Corporate Tic Tac Toe</b></span></header><div class="zc-main"><div class="zc-block"><h3>Sign in</h3>
      <label class="zc-lbl" for="sec">Your sign-in key</label><input id="sec" class="zc-in" type="password" autocomplete="off" value="${esc(secret)}">
      ${msg ? `<div class="zc-toast" role="status">${esc(msg)}</div>` : ""}<div class="zc-foot"><button class="zc-btn" id="in" type="button">Continue</button></div></div><div class="zc-block"><h3>Coming back?</h3>${googleBlock(true)}${small("Or sign in with your work e-mail: we send you a 6-digit code, no password.")}<a class="zc-chip" href="/#login" id="goLogin">Sign in with an e-mail code</a></div></div></div>`;
  }
  /** A Co-host (or Host) who has not yet ticked the K5 box: the console shows only that box and a Continue button; once it is posted the console opens as usual. */
  const k5View = () => `<div class="zc-frame zc-login"><header class="zc-bar"><span class="zc-brand"><img src="/icon-192.png" alt="" width="22" height="22"> <b>Corporate Tic Tac Toe</b></span></header><div class="zc-main"><div class="zc-block" id="k5gate"><h3>One more step</h3>${small("Please read and tick the box. You only do this once.")}${tbSlot("k5", "K5", "k5go")}${S.k5msg ? `<div class="zc-toast" role="status">${esc(S.k5msg)}</div>` : ""}<div class="zc-foot"><button class="zc-btn" id="k5go" type="button" ${tbDis("k5")}>Continue</button></div></div></div></div>`;
  // ---------- home (no game open yet) ----------
  function homeView() {
    const h = S.history, last = h && h.engagements[0];
    const bar = last ? `<div class="zc-lastbar"><span>Your last game was on <b>${fmtDay(last.created_ms)}</b> · ${last.participants} participants</span><span><button type="button" class="zc-mini" data-reuse="${esc(last.id)}">Reuse the data</button> <button type="button" class="zc-mini" data-hist="1">History</button></span></div>` : "";
    const main0 = clonePanel();
    const hist = S.showHist && h ? `<div class="zc-block"><h3>History · kept ${h.retentionDays} days</h3>${h.engagements.map((e) => `<div class="zc-rowl"><span>${esc(e.id)} · ${fmtDay(e.created_ms)} · ${e.participants} people${e.draft ? " · draft" : ""}</span><span><button type="button" class="zc-mini" data-open-game="${esc(e.id)}">Open</button> <button type="button" class="zc-mini" data-reuse="${esc(e.id)}">Reuse</button> <button type="button" class="zc-mini" data-clonebtn="1" data-from="${esc(e.id)}" data-people="${e.participants > 0 && !e.erased ? 1 : 0}">Create a new game like this one</button></span></div>`).join("")}</div>` : "";
    const main = `${S.note ? `<div class="zc-toast" role="status">${esc(S.note)}</div>` : ""}${main0}<div class="zc-small zc-rolenote">${esc(ROLE_NOTE.organizer)}</div>
      <div class="zc-block"><h3>Start a new game</h3>${small("You build it first, at no cost. You pay only when you publish. Players can join before the start time; you press Start on the tournament page when everybody is in.")}<div class="zc-chips"><button type="button" class="zc-btn zc-btn-s" id="mk">Start a new game</button><a class="zc-chip" href="/zc.html?quick=1">Quick setup form</a></div></div>${bar}${hist}${acctHtml()}`;
    return frame(`<div class="zc-body"><div class="zc-main">${main}</div></div>`, false);
  }
  // ---------- Quick setup: the first three steps as one form, with a real date and time picker (the AI route and the browser-AI route use it) ----------
  function quickDefault() {
    const t = new Date(istNow().getTime() + 86400000);
    const f = { occ: "Team event", oname: "", day: "other", dayo: istDateStr(t), time: "other", timeo: "16:00", cap: "250", tix: "1", mk: "auto", gj: "name", spd: "9", rnd: "1", join: "list", inv: false, per: "4", cats: ["family", "colleagues"], bundle: "Classic", hs: {}, ph: "" };
    for (const [k] of HS) f.hs[k] = { on: false, n: 1, pt: "later", pd: "", orig: [] };
    applyBundleTo(f, "Classic");
    return f;
  }
  function applyBundleTo(f, b) { const set = BUNDLES[b]; if (!set) return; for (const [k] of HS) { const h = f.hs[k]; h.on = !!set[k]; if (set[k]) h.n = set[k]; } f.ph = (HS.find(([k]) => f.hs[k].on) || ["first"])[0]; }
  function quickView() {
    const f = S.f;
    const caps = capOptions().map((p) => `<button type="button" class="zc-chip${String(f.cap) === String(p.n) ? " on" : ""}" data-ck="cap" data-v="${p.n}" aria-pressed="${String(f.cap) === String(p.n)}"><span>Up to ${p.n} people</span></button>`).join("");
    const houses = HS.map(([k, n, how, mx]) => `<div class="zc-box"><label class="zc-check" for="qk-h-${k}"><input type="checkbox" id="qk-h-${k}" data-hc="${k}" ${f.hs[k].on ? "checked" : ""}> ${n}</label><p class="zc-small zc-how">${esc(how || "")}</p>${mx > 1 ? grp(`hs.${k}.n`, "Winners", Array.from({ length: mx }, (_, i) => [String(i + 1), String(i + 1)])) : ""}${lbl("qk-t-" + k, "What is the prize? (up to 80 characters; you can fill this in later)")}<input id="qk-t-${k}" class="zc-in" data-qkprize="${k}" maxlength="80" value="${esc(f.hs[k].pt === "later" ? "" : prizeText(f.hs[k].pt, f.hs[k].pd))}"></div>`).join("");
    const main = `<div class="zc-block"><h3>1. Which game?</h3>${lbl("qk-name", "Name of the game (optional)")}<input id="qk-name" class="zc-in" data-fi="oname" maxlength="60" placeholder="Team event" value="${esc(f.oname)}">
        ${grp("occ", "Occasion", OCC.map((o) => [o, o]))}${lbl("qk-date", `Day (your time, ${tzName()})`)}<input id="qk-date" class="zc-in" type="date" data-fi="dayo" value="${esc(f.dayo)}" min="${istDateStr(istNow())}">${lbl("qk-time", `Start time (your time, ${tzName()})`)}<input id="qk-time" class="zc-in" type="time" data-fi="timeo" step="300" value="${esc(f.timeo)}">
        ${small("Players can join before. You press Start on the tournament page when everybody is in. Choose a time at least 2 hours ahead.")}</div>
      <div class="zc-block"><h3>2. How many players?</h3><span class="zc-lbl" id="gl-cap">How many people at most? (people invited by your guests count too)</span><div role="group" aria-labelledby="gl-cap">${caps}</div>${grp("join", "Who can join?", [["list", "Only people on a list"], ["anyone", "Anyone with the link"]])}${small("It is a knockout with one champion. You choose the format and the move clock on the day.")}</div>
      <div class="zc-block"><h3>3. Prizes for the top places</h3>${grp("bundle", "Start from", ["Classic", "Simple", "Rich"].map((b) => [b, BUNDLE_WORDS[b]]))}${houses}${small("You give the prizes; we only provide the software. Your company name and logo are added on the next page.")}</div>
      <div class="zc-block"><h3>4. Check and save</h3><div id="qk-summary" class="zc-small" aria-live="polite"></div><div id="qk-err" class="zc-toast zc-badt" role="alert" style="display:none"></div><div class="zc-foot"><button class="zc-btn" id="qk-save" type="button">Yes, save my draft</button></div>${small("Nothing is charged. Nobody else can see a draft. Next you publish it (free) and pay before the start time.")}</div>`;
    return frame(`<div class="zc-body"><div class="zc-main">${main}</div></div>`, false);
  }
  function quickRead() {
    const f = S.f, [y, mo, d] = (f.dayo || "").split("-").map(Number), [h, mi] = (f.timeo || "16:00").split(":").map(Number);
    const startMs = localToUtc(y, mo, d, h, mi), rewards = [];
    for (const [k] of HS) { const hh = f.hs[k]; if (!hh.on) continue; const t = prizeText(hh.pt, hh.pd).slice(0, 80); for (let o = 1; o <= (Number(hh.n) || 1); o++) rewards.push({ pattern: k, ordinal: o, text: t }); }
    const name = (f.oname || "").trim() || (f.occ !== "Other" ? f.occ : "");
    return { name, occ: f.occ === "Other" ? "EVENT" : f.occ.toUpperCase().replace(/[^A-Z0-9]+/g, "-"), startMs, cap: Number(f.cap), tickets: Number(f.tix) || 1, mark: f.mk === "tap" ? "tap" : "auto", join: f.gj === "phone" ? "phone" : "name", tz: TZ, speed: Number(f.spd), rounds: Number(f.rnd), who: f.join === "anyone" ? "anyone" : "list", invite: !!f.inv, rewards };
  }

  // ---------- Phase 4: "Continue with Google" and the Host's Finish setup (docs/ROLES_AND_CONSOLE_SPEC_4.md, C) ----------
  async function loadAuthConfig() { try { const r = await fetch(BASE + "/api/auth/config").then((x) => (x.ok ? x.json() : null)); S.gcid = (r && (r.google || r.clientId)) || ""; } catch { S.gcid = ""; } if (S.gcid) redraw(); }
  /** Draws Google's own button into #gbtn. The Google script is loaded only on a screen that shows the button. */
  function mountGoogle(intent) {
    const holder = document.getElementById("gbtn"); if (!holder || !S.gcid || holder.dataset.done === S.gcid + intent) return;
    holder.dataset.done = S.gcid + intent;
    const draw2 = () => { try { window.google.accounts.id.initialize({ client_id: S.gcid, callback: (resp) => googleDone(resp, intent) }); window.google.accounts.id.renderButton(holder, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular" }); } catch { holder.innerHTML = `<p class="zc-small">Open this page in your browser, or use an e-mail code.</p>`; } };
    if (window.google && window.google.accounts) return draw2();
    const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.async = true; sc.onload = draw2; sc.onerror = () => { holder.innerHTML = `<p class="zc-small">Open this page in your browser, or use an e-mail code.</p>`; };
    document.head.appendChild(sc);
  }
  async function googleDone(resp, intent) {
    try {
      const terms = tbTerms(intent === "host" ? "setup" : "login"); // K5 for a Host, K2 for sign-in
      if (!terms) { const m = "Please tick the box first, then continue with Google."; S.loginMsg = m; S.setupMsg = m; return redraw(); }
      const r = await call("POST", "/api/auth/google", { credential: resp && resp.credential, intent, consent: terms, ...(intent === "host" ? { hostKey: secret } : {}) });
      const k = r.token || r.key || r.organizerKey || r.hostKey; if (k) { secret = k; ss.set("cbz-org", k); }
      S.loginMsg = ""; S.setupMsg = ""; S.setup = null; bootstrap();
    } catch (e) { S.loginMsg = e.message; S.setupMsg = e.message; redraw(); }
  }
  const googleBlock = (withK2) => (S.gcid ? `${withK2 ? tbSlot("login", "K2", "") : ""}<div class="zc-block zc-gblock"><div id="gbtn" aria-label="Continue with Google"></div></div>` : "");
  function setupView() {
    const T = S.setup || {}, m = S.setupMsg;
    const email = T.needEmail ? `<h4>1. Your e-mail</h4>${small(T.emailMasked ? "Use the e-mail your Organizer gave us: " + esc(T.emailMasked) + "." : "Type your e-mail.")}${tbSlot("setup", "K5", "setupsend")}${googleBlock()}
        ${S.setupSent ? `${lbl("setupcode", "The 6-digit code we sent you")}<input id="setupcode" class="zc-in" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456"><div class="zc-foot"><button type="button" class="zc-btn zc-btn-s" id="setupverify">Check the code</button></div>`
          : `${lbl("setupemail", "Your e-mail")}<input id="setupemail" class="zc-in" type="email" autocomplete="email" placeholder="you@company.com"><div class="zc-foot"><button type="button" class="zc-btn zc-btn-s" id="setupsend" ${tbDis("setup")}>Send me a code</button></div>`}`
      : `<p class="zc-small">Your e-mail is checked${T.emailMasked ? ": " + esc(T.emailMasked) : ""}.</p>`;
    const mobile = T.needMobile ? `<h4>${T.needEmail ? "2" : "1"}. Your mobile number</h4>${small("Typed once. We do not send a code to it.")}${lbl("setupmobile", "Your mobile number")}<input id="setupmobile" class="zc-in" inputmode="tel" autocomplete="tel" placeholder="415 555 0132"><div class="zc-foot"><button type="button" class="zc-btn zc-btn-s" id="setupmobilego">Save my number</button></div>` : "";
    return `<div class="zc-frame zc-login"><header class="zc-bar"><span class="zc-brand"><img src="/icon-192.png" alt="" width="22" height="22"> <b>Corporate Tic Tac Toe</b></span><span class="zc-pill zc-pill-role">Host</span></header><div class="zc-main"><div class="zc-block" id="finishsetup"><h3>Finish setup</h3>${small("Two quick things, then your game opens. This link works once.")}${m ? `<div class="zc-toast" role="status">${esc(m)}</div>` : ""}${email}${mobile}</div></div></div>`;
  }
  async function setupStep(path, body, okSent) {
    try { const r = await call("POST", path, body); if (r && r.token) { secret = r.token; ss.set("cbz-org", secret); } /* the e-mail is confirmed: this device gets its own key */ S.setupMsg = ""; if (okSent) S.setupSent = true; S.setup = await call("GET", "/api/host/setup"); if (S.setup && S.setup.ready !== false) { S.setup = null; S.setupSent = false; return bootstrap(); } }
    catch (e) { S.setupMsg = friendly(e); }
    redraw();
  }
  // ---------- what the console loads ----------
  async function namesFor(ids) {
    if (S.shield) return; // AI helper mode: names are never fetched
    const nm = S.nameCache || (S.nameCache = new Map()), want = ids.filter((p) => !nm.has(p));
    for (let i = 0; i < want.length; i += 50) { try { const r = await call("GET", `/api/z/${eid}/names?pids=${want.slice(i, i + 50).join(",")}`); for (const [k, v] of Object.entries(r.names || {})) nm.set(k, v); } catch { /* shown as Participant */ } }
  }
  async function computeLucky(now) {
    const L = (S.cfg.breaks || []).filter((b) => b.kind === "lucky"); const out = [];
    const st = S.st || null; const stride = S.info.callSeconds / 3;
    for (let i = 0; i < L.length; i++) {
      const round = ZG.luckyRound(st, S.info.startRound + ZG.GRACE_ROUNDS, stride, S.cfg.breaks, L[i]);
      if (round === null || now === null || round > now) { out.push(null); continue; }
      const x = S.luckyRand && S.luckyRand[round] ? S.luckyRand[round] : await ZG.fetchRound(round);
      if (!x) { out.push(null); continue; }
      (S.luckyRand = S.luckyRand || {})[round] = x;
      const winners = ZG.luckyWinners(eid, L[i].after, x.randomness, S.people.filter((p) => !(p.jr > 0) || ZG.countFromOf(p.jr) <= round).map((p) => p.pid), L[i].winners || 3); // only people whose numbers counted by then
      out.push({ winners, published: (S.published || []).some((r) => r.pattern === "lucky" && r.ordinal === i + 1) });
    }
    return out;
  }
  S.pp = { list: null, err: "", limit: 0, common: "", me: null, waiting: null, approved: [], decided: [], confirm: "", sent: {}, sentFor: "", sum: "", wrong: [] };
  S.shield = ss.get("cbz-shield") === "1"; S.acctOpen = null; S.mkrole = "organizer"; S.screen = "";
  const GROUPS = { 1: ["occ", "oname", "day", "dayo", "time", "timeo"], 2: ["cap", "tix", "spd", "rnd", "who", "inv", "per", "cats"], 3: ["hs", "ph", "bundle"], 4: ["opN", "op", "midN", "mid", "clN", "cl", "lucky", "brand"] };
  /** Brings the form in line with what the server holds, step by step, but never over a step the person has started changing (an AI may be changing the draft at the same time). */
  function syncForm() {
    const fresh = formFromServer();
    if (!S.f || S.fFor !== eid) { S.f = fresh; S.fBase = JSON.parse(JSON.stringify(fresh)); S.fFor = eid; return; }
    for (const n of [1, 2, 3, 4]) { if (GROUPS[n].every((k) => JSON.stringify(S.f[k]) === JSON.stringify(S.fBase[k]))) GROUPS[n].forEach((k) => (S.f[k] = fresh[k])); }
    S.fBase = JSON.parse(JSON.stringify(fresh));
  }
  async function loadPacks() { try { S.packs = (await fetch(BASE + "/api/z/ai-manifest").then((r) => r.json())).packs || []; } catch { S.packs = []; } }

  async function refreshHome() {
    S.screen = "home";
    try { S.keys = (await call("GET", "/api/org/keys")).keys; } catch { S.keys = []; }
    try { S.sugs = (await call("GET", "/api/z/suggestions")).suggestions.slice(0, 6); } catch { S.sugs = []; }
    await loadCredits();
    try { S.history = await call("GET", "/api/history"); } catch (e) { if (e.status === 403) { secret = ""; S.loginMsg = "That sign-in key or link was not accepted. A link you were sent may have expired, been replaced, or the game may have been cancelled: please ask the Organizer."; } }
    redraw();
  }
  async function loadAccount() { try { S.keys = (await call("GET", "/api/org/keys")).keys; } catch { S.keys = []; } await loadCredits(); redraw(); }
  async function refreshTeam() {
    if (!canRun() || !secret) return;
    try { S.team = await call("GET", "/api/org/team" + (eid ? "?e=" + encodeURIComponent(eid) : "")); S.teamErr = ""; } catch (e) { S.team = null; S.teamErr = e.status === 404 || e.status === 405 ? "The team list is not switched on yet. You can add people as soon as it is." : friendly(e); }
    S.hostN = 0;
    if (S.team && role() === "host") { try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("key|" + secret)); const id = Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 10); S.hostN = ((S.team.hosts || []).findIndex((h) => h.id === id) + 1) || 0; } catch { /* the label stays plain */ } }
    redraw();
  }
  function initOpen() {
    if (S.openInit === eid) return; S.openInit = eid; loadDone();
    const nx = nextStep();
    if (S.cloneNew === eid && S.cloneDated !== eid && canRun()) { S.open = 1; return; } // a game made like another opens on the date and time
    S.open = ACTSTEP[ACT] && canRun() ? ACTSTEP[ACT] : role() !== "cohost" && S.started && !S.draft && !S.unpaid ? 9 : role() !== "cohost" && !S.draft && !payState().paid ? 8 : nx ? nx[0] : 1;
  }
  async function refreshCohost() {
    try { S.coh = await call("GET", `/api/z/${eid}/cohost`); S.cohErr = ""; } catch (e) { S.cohErr = e.status === 404 || e.status === 405 ? "Your game page is not switched on yet. Please try again a little later." : friendly(e); }
    initOpen(); if (S.open === 2 && !S.shield) await loadPeople(); redraw();
  }
  async function refreshEng() {
    if (role() === "cohost") return refreshCohost();
    S.screen = "eng";
    try {
      S.info = await call("GET", `/api/z/${eid}/info`); S.draft = !!S.info.draft; S.unpaid = !!S.info.unpaid; S.locked = !!S.info.locked;
      if (ACT === "publish" && S.draft && !S.actOpened) { S.pubOpen = true; S.actOpened = true; } // the AI's hand-over link: the publish card is open and waiting for the organizer's own tap
      let pr = await call("GET", `/api/z/${eid}/participants`); S.people = pr.participants; S.closed = pr.closed; S.whoCanJoin = pr.whoCanJoin || S.whoCanJoin;
      while (S.people.length < pr.total) { const more = await call("GET", `/api/z/${eid}/participants?offset=${S.people.length}`); if (!more.participants.length) break; S.people.push(...more.participants); } // a long list arrives in pages
      S.cfg = { name: pr.name, tickets: pr.tickets, rewards: pr.rewards, breaks: pr.breaks, opening: pr.opening || [], closing: pr.closing || [], rounds: pr.rounds || 1, invites: pr.invites };
      try { S.sum = await call("GET", `/api/z/${eid}/summary`); } catch { S.sum = S.sum || null; }
      try { S.ttt = await fetch(BASE + `/api/z/${eid}/ttt/view`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)); } catch { S.ttt = null; } // the tournament as everybody sees it (state, champion, results)
      if (canRun() && Number(S.sum && S.sum.credit) > 0) { try { S.creditInfo = await call("GET", "/api/org/credit"); } catch { S.creditInfo = null; } } else S.creditInfo = null;
      try { S.claims = (await call("GET", `/api/z/${eid}/claims`)).claims; } catch (e) { if (isOrg()) throw e; S.claims = []; }
      try { S.reqs = (await call("GET", `/api/z/${eid}/control/request`)).requests; } catch { S.reqs = []; }
      if (!S.started && !S.draft) { try { const k = await TBControl.ensureKey(eid, { token: secret, base: BASE, prefix: "/api/z" }); if (!k.ok && !S.ctlNote) S.ctlNote = k.reason || ""; } catch { /* the pause is optional; the engagement does not depend on it */ } } // an engagement made by the AI has no pause key until the organizer opens it here
      const cf0 = await fetch(BASE + `/api/z/${eid}/control`).then((r) => (r.ok ? r.json() : null)); const cf = cf0 && cf0.pubKey ? cf0 : null; // a held (unpaid) engagement answers {locked:true} with no signing key: that is not a pause file
      S.control = null; S.cf = cf;
      const now = await latestRound();
      let st = null;
      if (cf) { st = ZG.resolveControl(ZG.cfgOf(cf), cf.messages); S.st = st; S.control = { pausedNow: now !== null && st.intervals.some((i) => now >= i.start && now < i.end) }; } else S.st = null;
      const stride = S.info.callSeconds / 3;
      const schedOf = (r) => Array.from({ length: 75 }, (_, k) => ZG.callRoundR(st, S.info.startRound + ZG.GRACE_ROUNDS, stride, S.cfg.breaks, r, k));
      S.started = now !== null && now >= S.info.startRound + ZG.GRACE_ROUNDS;
      try { S.published = (await fetch(BASE + `/api/z/${eid}/results`).then((r) => r.json())).results || []; } catch { S.published = S.published || []; }
      if (!S.store) S.store = new ZG.RoundStore({});
      S.logs = {}; let budget = 60; // catch up quickly when the console is opened late
      for (let r = 1; r <= S.cfg.rounds; r++) {
        const sched = schedOf(r);
        const upto = sched.filter((x) => x !== null && now !== null && !S.locked && x <= now); // held for non-payment: nothing is shown to anyone, the organizer included
        const need = upto.filter((x) => !S.store.rounds.has(x)).slice(0, budget); budget -= need.length;
        await Promise.all(need.map((x, i) => (now - x <= 2 ? S.store.fetchLive(x, i) : S.store.fetchBackfill(x, i))));
        S.logs[r] = ZG.logFrom(ZG.roundEid(eid, r), sched.filter((x) => x !== null), S.store, upto.length);
      }
      S.store.verifySome(3);
      S.round = Math.max(1, ...Object.keys(S.logs).filter((r) => S.logs[r].length > 0).map(Number));
      S.log = S.logs[S.round] || [];
      const pids = S.people.map((p) => p.pid);
      const cfOf = new Map(S.people.filter((p) => p.jr > 0).map((p) => [p.pid, ZG.countFromOf(p.jr)])); // people who joined after the first number count from 90 s after joining
      const callRoundsOf = {}; for (let r = 1; r <= S.cfg.rounds; r++) callRoundsOf[r] = schedOf(r).filter((x) => x !== null);
      const late = { countFrom: cfOf, callRounds: callRoundsOf };
      S.checked = ZG.checkClaims(eid, S.claims.map((c) => ({ pid: c.pid, pattern: c.pattern, idx: c.idx, round: c.round })), S.logs, S.cfg, late);
      const nm = S.nameCache || (S.nameCache = new Map()); // names are sealed on our side: the console asks for the few it shows (winners), 50 at a time
      const settled = [];
      for (let r = 1; r <= S.cfg.rounds; r++) if (S.logs[r].length) settled.push(...ZG.settleAll(eid, pids, S.logs[r], S.cfg, r, { countFrom: cfOf, callRounds: callRoundsOf[r] }));
      await namesFor([...new Set(settled.filter((x) => x.pids.length <= 3).flatMap((x) => x.pids))]);
      S.settledPreview = settled.map((x) => ({ ...x, names: x.pids.length <= 3 && !S.shield ? x.pids.map((p) => nm.get(p) || "Participant").join(", ") : "" }));
      S.lucky = await computeLucky(now);
      try { S.life = await call("GET", `/api/z/${eid}/life`); } catch { S.life = null; }
      if (S.started && !S.draft) { try { S.prizes = (await call("GET", `/api/z/${eid}/prizes`)).prizes || []; } catch { S.prizes = S.prizes || []; } try { S.published = (await fetch(BASE + `/api/z/${eid}/results`).then((r) => r.json())).results || []; } catch { /* shown next time */ } } // the software decides the winners; this page only watches
      syncForm(); initOpen(); if (needPeople()) await loadPeople();
    } catch (e) { S.note = e.status === 404 ? "That game was not found." : e.status === 403 ? (S.deadLink = true, "Your sign-in has expired or does not belong to this game. Open the home page and sign in again.") : "Could not refresh. Retrying…"; }
    redraw();
  }

  // ---------- drawing ----------
  /** A link that no longer opens the game (cancelled, retired, replaced): a plain page, with none of the Organizer's controls. */
  const deadLinkView = () => frame(`<div class="zc-body"><div class="zc-main"><div class="zc-block" id="deadlink"><h3>This link no longer opens the game</h3><p style="margin:0">The game may have been cancelled, or the Organizer replaced your link with a new one. Please ask the Organizer.</p></div></div></div>`, false);
  let lastHtml = "";
  function view() {
    if (!secret) return loginView(S.loginMsg || "");
    if (S.k5need) return k5View();
    if (S.deadLink && /^cb[hc]_/.test(secret)) return deadLinkView(); // a Host or Co-host key (cbh_ / cbc_) that the server no longer accepts
    if (role() === "host" && S.setup && S.setup.ready === false) return setupView();
    const r = role();
    if (r === "partner") return partnerView();
    if (!eid) { if (S.screen === "quick" && canRun()) return quickView(); return r === "organizer" ? homeView() : waitLinkView(); }
    if (r === "cohost") return cohostView();
    if (!S.cfg || !S.info || !S.f) return loadingView();
    return engView();
  }
  const redraw = () => draw(view());
  /** Redraws only when something really changed: an AI (or a person) working on the page keeps the same elements instead of having them replaced every few seconds. */
  function draw(v) { if (v === lastHtml && $app.firstChild) return; lastHtml = v; $app.innerHTML = v; bind(); mountTerms(); a11y(); markAct(); }
  /** Every field gets a label that is really linked to it, every note is announced, every button has a name: an AI (or a screen reader) reads the page by these. */
  function a11y() {
    $app.querySelectorAll("label").forEach((l) => {
      if (l.getAttribute("for") || l.querySelector("input,select,textarea")) return;
      const t = l.nextElementSibling; const ctl = t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) ? t : t.querySelector && t.querySelector("input,select,textarea"));
      if (ctl && ctl.id) l.setAttribute("for", ctl.id);
    });
    $app.querySelectorAll("input,select,textarea").forEach((c) => { if (!c.getAttribute("aria-label") && !(c.id && $app.querySelector(`label[for="${c.id}"]`)) && !c.closest("label")) { const ph = c.getAttribute("placeholder"); if (ph) c.setAttribute("aria-label", ph); } });
    $app.querySelectorAll("button:not([aria-label])").forEach((b) => { if (!b.textContent.trim() && b.title) b.setAttribute("aria-label", b.title); });
  }
  function markAct() { // the one button the AI asked about is outlined and scrolled into view; it is never pressed for you
    if (!ACT || !eid || S.actMarked === eid + ACT) return;
    const el = ACT === "publish" ? document.getElementById("pubgo") || document.getElementById("publishopen") : ACT === "erase" ? document.getElementById("erase") : document.getElementById("runt"); // pause and stop live on the tournament page: the link to it is the button to press here
    if (!el) return; S.actMarked = eid + ACT; el.style.outline = "4px solid #E4572E"; el.style.outlineOffset = "3px"; try { el.scrollIntoView({ block: "center" }); } catch { /* not every browser */ }
  }
  const go = (id) => { const e = document.getElementById(id); if (e && e.scrollIntoView) { try { e.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* not every browser */ } } };
  function openStep(n) { S.open = n; S.sheet = false; S.toast = ""; S.note = ""; if (n === 5) refreshTeam(); redraw(); go("sec" + n); if ((n === 6 && canRun()) || (n === 2 && role() === "cohost")) loadPeople().then(redraw); }
  function advance(n) { const nx = steps().find((s) => s[0] > n && !isDone(s[0])) || nextStep(); S.open = nx ? nx[0] : n; S.sheet = false; redraw(); go("sec" + S.open); }

  // ---------- saving a step ----------
  const MSG_PAST = "Please choose a start time in the future (at least 2 hours ahead is best).";
  function startOf(f) {
    const date = f.day === "other" ? f.dayo : f.day, time = f.time === "other" ? f.timeo : f.time;
    if (!date || !time) throw new Error("Pick the day and the time.");
    const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
    return localToUtc(y, mo, d, h, mi);
  }
  function rewardsOut(f) {
    const rewards = [];
    for (const [k] of HS) {
      const h = f.hs[k]; if (!h.on) continue;
      for (let o = 1; o <= (Number(h.n) || 1); o++) rewards.push({ pattern: k, scope: "ticket", ordinal: o, text: h.diff && Number(h.n) > 1 ? prizeText(perFill(h)[o - 1].pt, perFill(h)[o - 1].pd) : !h.dirty && h.orig[o - 1] !== undefined ? h.orig[o - 1] : prizeText(h.pt, h.pd) });
    }
    return rewards;
  }
  function momentsOut(f) {
    const t = Number(f.tix) || 1, lim = maxFor(t);
    const rows = (g, N, cap, after) => f[g].slice(0, Math.min(Number(N) || 0, cap)).map((m) => momentOut(m, after)).filter(Boolean);
    const lucky = f.lucky.map((l) => ({ kind: "lucky", title: prizeText(l.pt, l.pd) || "Lucky draw", winners: Number(l.win) || 3, ...(l.style === "scratch" ? { style: "scratch" } : {}), ...(l.after ? { after: l.after, seconds: l.sec || 60 } : {}) }));
    return { tickets: t, opening: rows("op", f.opN, lim.op, false), breaks: [...rows("mid", f.midN, lim.mid, true), ...lucky], closing: rows("cl", f.clN, lim.cl, false) };
  }
  async function saveStep(n) {
    S.toast = "";
    try {
      const f = S.f;
      if (role() === "cohost") { markDone(n); return advance(n); }
      if (n === 1) { const name = f.occ === "Other" ? (f.oname || "").trim() : f.occ, ms = startOf(f); if (!(ms > Date.now())) throw new Error(MSG_PAST); if (ms > Date.now() + 30 * 86400000) throw new Error("A game can start at most 30 days from today. Please pick a closer date."); await call("PATCH", `/api/z/${eid}/settings`, { name, startRound: ZG.roundAt(ms), tz: TZ }); }
      else if (n === 2) { { const c = Number(f.cap); if (!Number.isInteger(c) || c < 1) throw new Error("Please give the number of players, for example 180."); if (c > 10000) throw new Error("For more than 10,000 players, please write to us and we will arrange it."); } if (f.inv && !f.cats.length) throw new Error("Pick at least one kind of guest."); await call("PATCH", `/api/z/${eid}/settings`, { cap: Number(f.cap), callSeconds: Number(f.spd), tickets: Number(f.tix), mark: f.mk === "tap" ? "tap" : "auto", join: f.gj === "phone" ? "phone" : "name", rounds: Number(f.rnd), whoCanJoin: f.who === "anyone" ? "anyone" : "list", invites: { on: !!f.inv, per: Number(f.per) || 4, cats: f.cats } }); }
      else if (n === 3) { const rewards = rewardsOut(f); if (!rewards.length) throw new Error("Tick at least one prize."); await call("PATCH", `/api/z/${eid}/settings`, { tickets: Number(f.tix), rewards }); }
      else if (n === 4) {
        const bn = (f.brand.name || "").trim(), bc = f.brand.color || "", bl = f.brand.logo || "", brandChanged = JSON.stringify(f.brand) !== JSON.stringify((S.fBase || {}).brand);
        if (brandChanged && (bn || bc || bl) && !bn) throw new Error("Add your company name for the top of the page, or clear the colour and logo.");
        if (brandChanged && (bn || bl) && !bc) throw new Error("Pick an accent colour for your company strip.");
        await call("PATCH", `/api/z/${eid}/settings`, { ...momentsOut(f), ...(brandChanged ? { brand: bn ? { name: bn, color: bc, ...(bl ? { logo: bl } : {}) } : {} } : {}) });
      }
      if (n === 1 && S.cloneNew === eid) S.cloneDated = eid;
      if (n <= 4) { markDone(n); S.note = "Saved."; await refreshEng(); return advance(n); }
      markDone(n); advance(n);
    } catch (e) { S.toast = friendly(e); redraw(); go("sec" + n); }
  }

  // ---------- quick setup: make the draft ----------
  async function makeDraft(r, id, hasName) {
    const res = await call("POST", "/api/z", { id, ...(r.name ? { name: r.name } : {}), startRound: ZG.roundAt(r.startMs), callSeconds: r.speed, cap: r.cap, tickets: r.tickets, mark: r.mark, join: r.join, tz: r.tz, rounds: r.rounds, rewards: r.rewards, whoCanJoin: r.who });
    return res;
  }
  async function afterCreate(id, r) {
    if (r && r.invite) await call("PATCH", `/api/z/${id}/settings`, { invites: { on: true, per: 4, cats: ["family", "colleagues"] } });
    let k = { ok: false, reason: "" }; try { k = await TBControl.ensureKey(id, { token: secret, base: BASE, prefix: "/api/z" }); } catch { /* the pause key is optional: the game does not depend on it */ }
    eid = id; history.replaceState(null, "", "?e=" + id + (BASE ? "&api=" + encodeURIComponent(BASE) : "")); S.store = null; S.f = null; S.fFor = ""; S.openInit = ""; S.cfg = null; S.info = null; S.sum = null; S.screen = "eng";
    return k;
  }
  function quickSummary() {
    const el = document.getElementById("qk-summary"); if (!el) return;
    try { const r = quickRead(); const when2 = new Date(r.startMs + tzOffsetMs(r.startMs)).toISOString(), ok = r.startMs > Date.now();
      el.textContent = `${r.name || "Your game"}: ${when2.slice(0, 10)} at ${when2.slice(11, 16)} (${tzName()} time)${ok ? "" : " (that time has passed: choose a later one)"}; up to ${r.cap} people; ${r.who === "list" ? "only people on a list" : "anyone with the link"}; ${r.rewards.length} prize${r.rewards.length === 1 ? "" : "s"}.`; } catch { el.textContent = ""; }
  }
  async function quickSave() {
    const err = document.getElementById("qk-err"); err.style.display = "none";
    try {
      const r = quickRead(); if (!(r.startMs > Date.now())) throw new Error(MSG_PAST);
      if (!r.rewards.length) throw new Error("Tick at least one prize.");
      const md = new Date(r.startMs + tzOffsetMs(r.startMs)), base = `${(r.name ? r.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) : "") || r.occ}-${pad2(md.getUTCMonth() + 1)}${pad2(md.getUTCDate())}`.slice(0, 36);
      let id = base, made = null;
      for (let i = 1; i <= 9 && !made; i++) { id = i === 1 ? base : `${base}-${i}`; const res = await makeDraft(r, id); if (!res.existed) made = res; }
      if (!made) throw new Error("Could not find a free game code. Try a different name.");
      const k = await afterCreate(id, r);
      S.note = "Your draft is saved. Add your company name, colour and logo below if you want, then publish it (free)." + (k.ok || !k.reason ? "" : " Pause control is unavailable: " + k.reason);
      refreshEng();
    } catch (e) { err.textContent = e.message; err.style.display = ""; }
  }
  async function startNew() {
    const saved = S.f; S.f = quickDefault(); const rr = quickRead(); S.f = saved;
    const id = randId();
    await makeDraft({ ...rr, name: "" }, id);
    const k = await afterCreate(id, rr);
    S.note = "Your draft is saved. Open each step and tap your choices." + (k.ok || !k.reason ? "" : " Pause control is unavailable: " + k.reason);
    refreshEng();
  }

  // ---------- buttons and fields ----------
  const parseList = (text) => String(text).split(/\r?\n/).filter((l, i) => !(i === 0 && /name/i.test(l) && /(mobile|phone|number)/i.test(l))).map((l) => l.replace(/"/g, "").trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)[,;\t ]+([+()\d][\d ()+-]{4,})$/) || l.match(/^()([+()\d][\d ()+-]{8,})$/); return m ? { name: m[1].trim(), phone: m[2].trim() } : { name: l, phone: "" }; });
  function applyBundle(b) { applyBundleTo(S.f, b); }
  function onField(el) {
    const path = el.dataset.fi;
    setP(path, el.value);
    if (/^hs\.[a-z0-9]+\.(pd|per\.\d+\.pd)$/.test(path)) S.f.hs[path.split(".")[1]].dirty = true;
    const lk = document.querySelector(`[data-lk="${path.replace(/\.(v|t|s)$/, "")}"]`);
    if (lk && /\.v$/.test(path)) lk.innerHTML = noteHtml(path.replace(/\.v$/, ""));
    const bm = document.getElementById("bmcount"); if (bm && S.f) bm.textContent = `${usedMoments()} of ${5 * (Number(S.f.tix) || 1)}`;
    if (document.getElementById("qk-summary")) quickSummary();
  }
  function chipClick(b) {
    const path = b.dataset.ck, v = b.dataset.v;
    if (b.dataset.multi) { const a = (getP(path) || []).slice(), i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); setP(path, a); }
    else { setP(path, v); if (path === "bundle") applyBundle(v); }
    if (/^hs\.[a-z0-9]+\.(n|pt|pd|per\.\d+\.(pt|pd))$/.test(path)) S.f.hs[path.split(".")[1]].dirty = true;
    redraw(); if (document.getElementById("qk-summary")) quickSummary();
  }
  function bind() {
    const $ = (id) => document.getElementById(id);
    const all = (sel, fn) => $app.querySelectorAll(sel).forEach(fn);
    const noteAndDraw = (t) => { S.note = t; redraw(); };
    if ($("shield")) $("shield").onchange = () => { S.shield = $("shield").checked; ss.set("cbz-shield", S.shield ? "1" : "0"); S.nameCache = null; lastHtml = ""; if (!eid) return redraw(); if (role() === "cohost") return redraw(); refreshEng(); };
    if ($("goLogin")) $("goLogin").onclick = () => { try { sessionStorage.setItem("cbz-next", location.pathname + location.search); } catch {} };
    if ($("in")) $("in").onclick = () => { secret = $("sec").value.trim(); ss.set("cbz-org", secret); S.loginMsg = ""; bootstrap(); };
    if ($("back")) $("back").onclick = () => { eid = ""; S.cfg = null; S.info = null; S.f = null; S.fFor = ""; S.openInit = ""; S.note = ""; S.sum = null; history.replaceState(null, "", location.pathname + (BASE ? "?api=" + encodeURIComponent(BASE) : "")); refreshHome(); };
    if ($("mk")) $("mk").onclick = async () => { $("mk").disabled = true; try { await startNew(); } catch (e) { noteAndDraw(friendly(e)); } };
    // moving around
    all("[data-open]", (b) => (b.onclick = () => openStep(Number(b.dataset.open))));
    all("[data-acct]", (b) => (b.onclick = () => { S.acctOpen = !(S.acctOpen === null ? !eid : S.acctOpen); redraw(); if (S.acctOpen) { go("acct"); if (!Array.isArray(S.keys)) loadAccount(); } }));
    all("[data-q]", (b) => (b.onclick = () => { const i = Number(b.dataset.q); S.q = S.q === i ? -1 : i; redraw(); }));
    all("[data-act]", (b) => (b.onclick = () => {
      const a = b.dataset.act; S.toast = "";
      if (a === "help") { S.q = S.q < 0 ? 0 : S.q; S.sheet = false; redraw(); return go("help"); }
      if (a === "top") { S.sheet = false; redraw(); return go("zc-top"); }
      if (a === "steps") { redraw(); return go("sec" + S.open); }
      if (a === "sheet") { S.sheet = !S.sheet; redraw(); }
    }));
    all("[data-save]", (b) => (b.onclick = () => saveStep(Number(b.dataset.save))));
    // the choices
    all("[data-ck]", (b) => (b.onclick = () => chipClick(b)));
    all("[data-bool]", (b) => (b.onclick = () => { setP(b.dataset.bool, !getP(b.dataset.bool)); if (/^hs\.[a-z0-9]+\.diff$/.test(b.dataset.bool)) { const h = S.f.hs[b.dataset.bool.split(".")[1]]; h.dirty = true; if (h.diff) perFill(h); } redraw(); if ($("qk-summary")) quickSummary(); }));
    all("[data-fi]", (el) => (el.oninput = () => onField(el)));
    all("[data-qkprize]", (el) => (el.oninput = () => { const h = S.f.hs[el.dataset.qkprize]; h.pt = el.value.trim() ? "other" : "later"; h.pd = el.value; quickSummary(); }));
    all("[data-hc]", (c) => (c.onchange = () => { const h = S.f.hs[c.dataset.hc]; h.on = c.checked; if (c.checked) S.f.ph = c.dataset.hc; h.dirty = true; redraw(); if ($("qk-summary")) quickSummary(); }));
    all("[data-ph]", (b) => (b.onclick = () => { S.f.ph = b.dataset.ph; redraw(); }));
    all("[data-luckyadd]", (b) => (b.onclick = () => { S.f.lucky.push({ win: "3", style: "draw", pt: "phone", pd: "" }); redraw(); }));
    all("[data-luckydel]", (b) => (b.onclick = () => { S.f.lucky.splice(Number(b.dataset.luckydel), 1); redraw(); }));
    all("[data-test]", (btn) => (btn.onclick = () => {
      const [g, i] = btn.dataset.test.split("."), m = S.f[g][Number(i)], w = { op: "opening", mid: "break", cl: "closing" }[g];
      const h = new URLSearchParams({ w, k: SERVER_KIND[m.k] || "speech", t: (m.t || "").trim() || "Your message", u: (m.v || "").trim(), ...(m.s ? { s: m.s } : {}) });
      window.open("/preview.html#" + h.toString(), "_blank", "noopener");
    }));
    // publish and pay
    if ($("k5go")) $("k5go").onclick = async () => {
      const terms = tbTerms("k5"); if (!terms) { S.k5msg = "Please tick the box to continue."; return redraw(); }
      $("k5go").disabled = true;
      try { await call("POST", "/api/org/role/accept", { consent: terms }); S.k5need = false; S.k5msg = ""; bootstrap(); } catch (e) { S.k5msg = e.message; redraw(); }
    };
    if ($("publishopen")) $("publishopen").onclick = () => { S.pubOpen = true; S.pubNote = ""; redraw(); };
    if ($("pubcancel")) $("pubcancel").onclick = () => { S.pubOpen = false; redraw(); };
    if ($("pubEmail")) $("pubEmail").oninput = (e) => { S.contact.email = e.target.value; };
    if ($("pubPhone")) $("pubPhone").oninput = (e) => { S.contact.phone = e.target.value; };
    if ($("pubgo")) $("pubgo").onclick = async () => {
      const terms = tbTerms("pub" + eid); if (!terms) { S.pubNote = "Please tick both boxes to continue."; return redraw(); }
      $("pubgo").disabled = true;
      try { const pr = await call("POST", `/api/z/${eid}/publish`, { email: S.contact.email.trim(), phone: S.contact.phone, consent: terms }); ss.set("cbz-email", S.contact.email.trim()); ss.set("cbz-phone", S.contact.phone); S.pubOpen = false; S.note = pr && pr.needsOrganizer ? "Not published. Only the Organizer publishes, with one tap. If you are a Help Desk helper, ask the Organizer from the Help Desk page." : "Published. Send the link in step 6 to your participants. Then pay in step 8 before the start time, or the game will not begin."; }
      catch (e) { ss.set("cbz-email", S.contact.email.trim()); ss.set("cbz-phone", S.contact.phone); S.pubNote = e.message + (e.needPack ? " (a pack for up to " + e.needPack + " participants)" : ""); }
      refreshEng();
    };
    // cancel the game
    if ($("cancelopen")) $("cancelopen").onclick = async () => {
      S.cancel = { stage: 1, preview: null, err: "" }; redraw();
      try { S.cancel.preview = await call("GET", `/api/z/${eid}/cancel-preview`); } catch (e) { S.cancel.err = e.status === 404 ? "Cancelling is not switched on yet. Please try again a little later." : friendly(e); }
      redraw();
    };
    if ($("movego")) $("movego").onclick = async () => {
      const v = (($("movedt") || {}).value || ""), ms = v ? new Date(v).getTime() : NaN;
      if (!(ms > Date.now())) { S.move = { err: "Please pick a new date and time in the future." }; return redraw(); }
      S.move = { busy: true }; redraw();
      try { await call("POST", `/api/z/${eid}/reopen`, { startRound: ZG.roundAt(ms) }); S.move = { done: true }; S.cancelDone = false; S.note = "Your game was moved to the new date."; }
      catch (e) { S.move = { err: friendly(e) }; }
      refreshEng();
    };
    if ($("cancelback")) $("cancelback").onclick = () => { S.cancel = { stage: 0 }; redraw(); };
    if ($("cancel1")) $("cancel1").onclick = () => { S.cancel.stage = 2; redraw(); };
    if ($("cancelagree")) $("cancelagree").onchange = () => { S.cancel.agree = $("cancelagree").checked; redraw(); };
    if ($("cancelresched")) $("cancelresched").onclick = () => { S.cancel = { stage: 0 }; openStep(1); };
    if ($("cancelprev")) $("cancelprev").onclick = () => { S.cancel.stage = 1; S.cancel.agree = false; redraw(); };
    if ($("cancel2")) $("cancel2").onclick = () => { if (!S.cancel.agree) return; S.cancel.stage = 3; redraw(); };
    if ($("cancel3")) $("cancel3").onclick = async () => {
      S.cancel.busy = true; $("cancel3").disabled = true;
      try { const r = await call("POST", `/api/z/${eid}/cancel`, { confirmations: 3 }); S.cancelDone = true; S.cancel = { stage: 0, credit: r.credit || (S.cancel.preview && S.cancel.preview.credit) || null }; S.note = "The game was cancelled."; }
      catch (e) { S.cancel = { stage: 1, preview: null, err: e.status === 404 ? "Cancelling is not switched on yet. Please try again a little later." : friendly(e) }; }
      refreshEng();
    };
    // the team
    const person = async (kind) => {
      const val = (id) => (($(id) || {}).value || "").trim(), name = val(kind + "label");
      S.tv = { [kind + "label"]: name, [kind + "phone"]: val(kind + "phone"), ...(kind === "host" ? { hostemail: val("hostemail") } : {}) }; // what was typed stays on the screen if something needs a correction
      let body;
      if (kind === "host") {
        const email = val("hostemail"), hp = val("hostphone");
        if (!name) { S.teamNote = "Please type the Host's name."; return redraw(); }
        if (!email && !hp) { S.teamNote = "Please type the Host's mobile number or e-mail."; return redraw(); }
        if (hp && hp.replace(/\D/g, "").length < 10) { S.teamNote = "Please check the Host's mobile number."; return redraw(); }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.teamNote = "Please check the Host's e-mail."; return redraw(); }
        body = { label: name, ...(eid ? { e: eid } : {}), ...(hp ? { mobile: hp } : {}), ...(email ? { email } : {}) }; S.lastHostWa = !email && hp ? cleanPhone(hp) : null;
      }
      else { const phone = val("cohostphone"); if (!name) { S.teamNote = "Please type the Co-host's name."; return redraw(); } if (phone.replace(/\D/g, "").length < 10) { S.teamNote = "Please type the Co-host's mobile number."; return redraw(); } body = { label: name, phone, eid, e: eid }; }
      const path = kind === "host" ? "/api/org/host" : "/api/org/cohost";
      try {
        const r = await call("POST", path, body);
        const key = r.hostKey || r.cohostKey || "", id = r.id || (key ? key.slice(0, 10) : ""), hash = kind === "host" ? "host" : "cohost";
        S.teamLinks[id] = key ? `${location.origin}/zc.html?e=${encodeURIComponent(eid)}#${hash}=${key}` : r.link || ""; if (kind === "host" && S.lastHostWa) S.teamWa[id] = { d: S.lastHostWa, name: name };
        S.teamNote = kind === "host" ? (S.lastHostWa ? "Host added. Send their link on WhatsApp, to that one person only." : "Host added. We sent their link to their e-mail.") : "Co-host added. Send the link to that one person only."; S.tv = {}; await refreshTeam();
      } catch (e) { S.teamNote = friendly(e); redraw(); }
    };
    if ($("hostadd")) $("hostadd").onclick = () => person("host");
    if ($("cohostadd")) $("cohostadd").onclick = () => person("cohost");
    all("[data-cohl]", (b) => (b.onclick = async () => { try { await call("PATCH", `/api/z/${eid}/settings`, { coHostLimit: Number(b.dataset.cohl) }); S.teamNote = "Saved."; S.sum = Object.assign({}, S.sum, { coHostLimit: Number(b.dataset.cohl) }); } catch (e) { S.teamNote = friendly(e); } redraw(); }));
    all("[data-retire]", (b) => (b.onclick = async () => {
      if (!confirm("Remove this " + (b.dataset.kind === "host" ? "Host" : "Co-host") + "? Their link stops working at once.")) return;
      try { await call("POST", "/api/org/team/retire", { id: b.dataset.retire }); delete S.teamLinks[b.dataset.retire]; S.teamNote = "Removed. Their link has stopped."; await refreshTeam(); } catch (e) { S.teamNote = friendly(e); redraw(); }
    }));
    all("[data-newlink]", (b) => (b.onclick = async () => {
      try {
        const r = await call("POST", "/api/org/host/link", { id: b.dataset.newlink, ...(eid ? { e: eid } : {}) }), nid = r.id || b.dataset.newlink, key = r.hostKey || "";
        S.teamLinks[nid] = key ? `${location.origin}/zc.html?e=${encodeURIComponent(eid)}#host=${key}` : r.link || ""; // the old link has stopped
        const m = String(r.waLink || "").match(/wa\.me\/(\d{8,15})/); if (m) S.teamWa[nid] = { d: m[1], name: r.label || b.dataset.label || "" }; else delete S.teamWa[nid];
        S.teamNote = r.emailed ? "A new link is on its way to their e-mail. The old one has stopped." : "A new link is ready. The old one has stopped. Send it to that one person only.";
        await refreshTeam();
      } catch (e) { S.teamNote = e.code === "host-active" ? "This Host has already finished setup, so they sign in with their e-mail now. " + (e.message || "") : friendly(e); redraw(); }
    }));
    all("[data-copyteam]", (b) => (b.onclick = async () => { const ok = await copyText(S.teamLinks[b.dataset.copyteam] || ""); b.textContent = ok ? "Copied" : "Select and copy it"; }));
    // sharing and the guest list
    all("[data-mode]", (b) => (b.onclick = () => { S.mode = b.dataset.mode; redraw(); }));
    all("[data-cc]", (b) => (b.onclick = () => { CC.v = b.dataset.cc; ls.set("cbz-cc", CC.v); redraw(); }));
    if ($("copy")) $("copy").onclick = async () => { const ok = await copyText(role() === "cohost" ? cohInvite() : guestLink()); $("copy").textContent = ok ? "Copied" : "Select and copy it"; };
    if ($("copybig")) $("copybig").onclick = async () => { const ok = await copyText(bigLink()); $("copybig").textContent = ok ? "Copied" : "Select and copy it"; };
    if ($("gadd")) $("gadd").onclick = () => { const n = $("gname").value.trim(), p = $("gphone").value.trim(); addPeople(p || n ? [{ name: n, phone: p }] : []); };
    if ($("rosterGo")) $("rosterGo").onclick = () => addPeople(parseList($("rosterTxt").value));
    if ($("gfile")) $("gfile").onchange = async () => { const f = $("gfile").files && $("gfile").files[0]; if (!f) return; let t = ""; try { t = await f.text(); } catch { S.pp.sum = "Could not read that file. Try pasting the list instead."; return redraw(); } addPeople(parseList(t)); };
    if ($("gcontacts")) $("gcontacts").onclick = async () => { try { const got = await navigator.contacts.select(["name", "tel"], { multiple: true }); addPeople((got || []).map((c) => ({ name: (c.name || [])[0] || "", phone: (c.tel || [])[0] || "" }))); } catch { S.pp.sum = "Could not open your contacts. Please type or paste instead."; redraw(); } };
    all("[data-fix]", (b) => (b.onclick = () => { const i = Number(b.dataset.fix), w = S.pp.wrong[i], v = ($("fixin" + i) || {}).value; if (!w) return; if (!cleanPhone(v)) { w.raw = v; S.pp.sum = "That number still looks wrong. Check the digits."; return redraw(); } S.pp.wrong.splice(i, 1); addPeople([{ name: w.name, phone: v }], true); }));
    all("[data-wa]", (a) => (a.onclick = () => { markSent(a.dataset.wa); setTimeout(redraw, 0); }));
    all("[data-resend]", (b) => (b.onclick = async () => {
      const id = b.dataset.resend, p = (S.pp.list || []).find((x) => String(x.id) === id);
      try { const r = await call("POST", `/api/z/${eid}/people/${encodeURIComponent(id)}/resend`, {}); if (p) { if (r.link) p.link = r.link; if (r.waLink) p.waLink = r.waLink; const h = waHref(p); if (h) { try { window.open(h, "_blank", "noopener,noreferrer"); } catch { /* the link is also in the row */ } } } markSent(id); S.pp.sum = "Sent again."; } catch (e) { S.pp.sum = friendly(e); }
      await loadPeople(); redraw();
    }));
    all("[data-rmask]", (b) => (b.onclick = () => { S.pp.confirm = b.dataset.rmask; redraw(); }));
    all("[data-rmno]", (b) => (b.onclick = () => { S.pp.confirm = ""; redraw(); }));
    all("[data-rm]", (b) => (b.onclick = async () => {
      try { await call("POST", `/api/z/${eid}/people/${encodeURIComponent(b.dataset.rm)}/remove`, { withTheirPeople: b.dataset.with === "1" }); S.pp.sum = "Removed."; } catch (e) { S.pp.sum = friendly(e); }
      S.pp.confirm = ""; await loadPeople(); redraw();
    }));
    all("[data-decide]", (b) => (b.onclick = async () => {
      const id = b.dataset.wid, d = b.dataset.decide, w = (S.pp.waiting || []).find((x) => String(x.id) === id);
      try { await call("POST", `/api/z/${eid}/waiting/${encodeURIComponent(id)}`, { decision: d }); if (w) S.pp.decided.unshift({ name: firstName(w.firstName || w.name), last4: last4Of(w), decision: d, by: "you", ms: Date.now() }); S.pp.sum = d === "admit" ? "Let in." : "Declined."; } catch (e) { S.pp.sum = friendly(e); }
      await loadPeople(); redraw();
    }));
    if ($("brandlogo")) $("brandlogo").onchange = async () => {
      const f = $("brandlogo").files && $("brandlogo").files[0]; if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type || "")) { S.logoNote = "Please choose a PNG, JPEG or WebP picture."; return redraw(); }
      if (f.size > 5 * 1024 * 1024) { S.logoNote = "That picture is bigger than 5 MB. Please choose a smaller one."; return redraw(); }
      try { S.f.brand.logo = await fitLogo(f); S.logoNote = ""; } catch (e) { S.logoNote = e && e.message === "small" ? "That picture is too small. It must be at least 64 x 64 pixels." : e && e.message === "thin" ? "That picture is too long and thin. It may be at most 4 times wider than tall." : "We could not use that picture. Try a smaller or simpler one."; }
      redraw();
    };
    if ($("logorm")) $("logorm").onclick = () => { S.f.brand.logo = ""; S.logoNote = ""; redraw(); };
    if ($("copypaylink")) $("copypaylink").onclick = async () => {
      try { const r = await call("POST", `/api/z/${eid}/paylink`, {}); S.payUrl = r.url || ""; S.payLinkNote = "Anyone with this link can pay for this game. It works until the game is paid or for 7 days."; S.payCopied = S.payUrl ? await copyText(S.payUrl) : false; }
      catch (e) { S.payUrl = ""; S.payLinkNote = friendly(e); }
      redraw();
    };
    if ($("admitall")) $("admitall").onclick = () => { S.pp.bulk = "admit"; redraw(); };
    if ($("declineall")) $("declineall").onclick = () => { S.pp.bulk = "decline"; redraw(); };
    if ($("bulkno")) $("bulkno").onclick = () => { S.pp.bulk = ""; redraw(); };
    if ($("bulkyes")) $("bulkyes").onclick = async () => {
      const d = S.pp.bulk; S.pp.bulk = ""; $("bulkyes").disabled = true; S.pp.still = "";
      try {
        const r = await call("POST", `/api/z/${eid}/waiting/all`, { decision: d }), n = Number(d === "admit" ? r.admitted : r.declined) || 0, st = Number(r.stillWaiting) || 0;
        S.pp.sum = d === "admit" ? `${n} ${n === 1 ? "person" : "people"} let in.` : `${n} declined.`;
        if (st) S.pp.still = r.message || `${st} still waiting: the game is full. Remove someone or ask for a bigger pack, then let them in.`;
      } catch (e) { S.pp.sum = friendly(e); }
      await loadPeople(); redraw();
    };
    if ($("copycommon")) $("copycommon").onclick = async () => { const ok = await copyText(commonLink()); $("copycommon").textContent = ok ? "Copied" : "Select and copy it"; };
    if ($("dlpeople")) $("dlpeople").onclick = async () => {
      let text = ""; try { const r = await fetch(BASE + `/api/z/${eid}/people/export`, { headers: { "x-organizer": secret } }); if (!r.ok) throw new Error("no export"); text = await r.text(); } catch { text = localCsv(); }
      try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = eid + "-my-people.csv"; a.click(); } catch { /* the browser could not save it */ }
    };
    if ($("myph")) $("myph").oninput = () => { S.myPhone = $("myph").value; };
    const mineErr = (e) => { if (e.status === 400 && (e.code === "need-phone" || /mobile/i.test(e.message))) { S.pp.meNeed = true; S.pp.mineNote = "Type your own mobile number, then press the button again."; } else S.pp.mineNote = friendly(e); };
    const typedMine = () => { const t = $("myph") ? $("myph").value.trim() : ""; if (t) S.myPhone = t; return t; };
    if ($("playnow")) $("playnow").onclick = async () => {
      let w = null; try { w = window.open("", "_blank"); if (w) w.opener = null; } catch { /* the pop-up was blocked */ }
      S.pp.mineNote = "";
      try { const t = typedMine(); if (t && !cleanPhone(t)) throw Object.assign(new Error("That number looks wrong. Please check it."), { status: 0 }); const me = await ensureMe(t); if (w) w.location.href = me.link; else window.open(me.link, "_blank", "noopener"); }
      catch (e) { if (w) { try { w.close(); } catch { /* fine */ } } mineErr(e); }
      redraw();
    };
    if ($("sendmine")) $("sendmine").onclick = async () => {
      S.pp.mineNote = "";
      try { const t = typedMine(); if (t && !cleanPhone(t)) throw Object.assign(new Error("That number looks wrong. Please check it."), { status: 0 }); const me = await ensureMe(t); if (me && me.waLink) { try { window.open(me.waLink, "_blank", "noopener,noreferrer"); } catch { /* blocked */ } S.pp.mineNote = "Your play link is on its way to your WhatsApp."; } else { S.pp.meNeed = true; S.pp.mineNote = "Type your own mobile number, then press the button again."; } }
      catch (e) { mineErr(e); }
      redraw();
    };
    if ($("pdsee")) $("pdsee").onclick = async () => { try { const r = await call("POST", `/api/z/${eid}/person`, whoBody($("pdph").value)); S.note = `Seat ${r.seat}${r.name ? ", " + r.name : ""}${r.role ? ", " + r.role : ""}. We hold only their name and number.`; } catch (e) { S.note = e.message; } refreshEng(); };
    if ($("pddel")) $("pddel").onclick = async () => { if (!confirm("Delete this player's name and number now? This cannot be undone.")) return; try { await call("POST", `/api/z/${eid}/forget`, { phone: $("pdph").value }); S.note = "Done. Their data is deleted."; } catch (e) { S.note = e.message; } refreshEng(); };
    if ($("unbind")) $("unbind").onclick = async () => { try { await call("POST", `/api/z/${eid}/unbind`, whoBody($("ubph").value)); S.note = "Done. The next phone they join with keeps their seat."; } catch (e) { S.note = e.message; } refreshEng(); };
    // game day
    all("[data-chip]", (b) => (b.onclick = () => { const t = $("annText"); if (t) { t.value = b.dataset.chip; t.focus(); } }));
    if ($("annSend")) $("annSend").onclick = async () => {
      const t = ($("annText").value || "").trim(); if (!t) { S.annNote = "Write a message first."; return redraw(); }
      try { await call("POST", `/api/z/${eid}/announce`, { text: t }); S.annNote = "Sent. Phones show and speak it within about a minute."; } catch (e) { S.annNote = e.message; }
      refreshEng();
    };
    if ($("annClear")) $("annClear").onclick = async () => { try { await call("POST", `/api/z/${eid}/announce`, { text: "" }); S.annNote = "Message cleared."; } catch (e) { S.annNote = e.message; } refreshEng(); };
    all("[data-given]", (c) => (c.onchange = async () => {
      const p = (S.prizes || [])[Number(c.dataset.given)]; if (!p) return;
      try { await call("POST", `/api/z/${eid}/prizegiven`, { round: p.round, pattern: p.pattern, ordinal: p.ordinal, seat: p.seat, given: c.checked }); S.note = c.checked ? "Marked as given." : "Tick removed."; } catch (e) { S.note = e.message; }
      refreshEng();
    }));
    if ($("csv")) $("csv").onclick = async () => {
      await namesFor([...new Set(S.settledPreview.flatMap((x) => x.pids))]); const nm = S.nameCache;
      const rows = [["Reward", "Call number", "Participant"]];
      for (const s of S.settledPreview) for (const p of s.pids) rows.push([lineLabel(s), s.idx + 1, nm.get(p) || p]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\n")], { type: "text/csv" })); a.download = eid + "-rewards.csv"; a.click();
    };
    all("[data-mkrole]", (b) => (b.onclick = () => { S.mkrole = b.dataset.mkrole; redraw(); }));
    if ($("mark")) $("mark").onclick = async () => { try { await call("POST", `/api/z/${eid}/mark`, { phone: $("mkph").value, role: S.mkrole }); S.note = "Marked."; } catch (e) { S.note = e.message; } refreshEng(); };
    // after the game
    if ($("rptnew")) $("rptnew").onclick = async () => { if (!confirm("Make a new report link? The old link, including the one in your e-mail, stops working at once.")) return; try { const r = await call("POST", `/api/z/${eid}/reportlink`, {}); if (r.url) window.open(r.url, "_blank", "noopener"); S.note = "New report link made. The old one has stopped."; } catch (e) { S.note = e.message; } refreshEng(); };
    if ($("rptopen")) $("rptopen").onclick = async () => { try { const r = await call("GET", `/api/z/${eid}/reportlink`); if (r.url) window.open(r.url, "_blank", "noopener"); else S.note = "The report is not ready yet."; } catch (e) { S.note = e.message; } redraw(); };
    if ($("erase")) $("erase").onclick = async () => { if (!confirm("Delete every participant's name and mobile number now? This cannot be undone. The winners record stays.")) return; try { const r = await call("POST", `/api/z/${eid}/erase`, {}); S.note = r.erased + " participants erased."; } catch (e) { S.note = e.message; } refreshEng(); };
    if ($("reqok")) $("reqok").onclick = async () => {
      const r = S.reqs[0];
      if (r.action === "erase") { // your confirmation is what deletes, not the AI's request
        if (!confirm("Delete every participant's name and mobile number now? This cannot be undone. The winners record stays.")) return;
        try { const x = await call("POST", `/api/z/${eid}/erase`, {}); S.note = x.erased + " participants erased."; await call("POST", `/api/z/${eid}/control/request/clear`, {}); } catch (e) { S.note = e.message; }
        return refreshEng();
      }
      // your press is what pauses, resumes or ends the tournament, not the AI's request: the tournament's own addresses (the same ones the run page uses)
      if (r.action === "stop" && !confirm("End the tournament for everybody now? Nobody is ranked and this cannot be undone.")) return;
      const route = { pause: "pause", resume: "resume", stop: "end" }[r.action];
      try { if (!route) throw new Error("This request cannot be carried out here."); await call("POST", `/api/z/${eid}/ttt/${route}`, {}); S.note = r.action === "stop" ? "The tournament was ended." : r.action === "pause" ? "Paused for everyone." : "Resumed."; await call("POST", `/api/z/${eid}/control/request/clear`, {}); } catch (e) { S.note = e.message; }
      refreshEng();
    };
    if ($("reqno")) $("reqno").onclick = async () => { try { await call("POST", `/api/z/${eid}/control/request/clear`, {}); } catch {} refreshEng(); };
    // history and the account
    all("[data-hist]", (b) => (b.onclick = () => { S.showHist = !S.showHist; redraw(); }));
    all("[data-clonebtn]", (b) => (b.onclick = async () => { if (b.dataset.people === undefined && !S.pp.list && !(S.people || []).length) { try { await loadPeople(); } catch { /* the panel then asks the old way */ } } const from = b.dataset.from || eid; S.clone = { from, hasPeople: b.dataset.people !== undefined ? b.dataset.people === "1" : hasOldPeople(), withPeople: false, err: "" }; redraw(); go("clonepanel"); }));
    if ($("clonepeople")) $("clonepeople").onchange = () => { S.clone.withPeople = $("clonepeople").checked; redraw(); };
    if ($("cloneno")) $("cloneno").onclick = () => { S.clone = null; redraw(); };
    if ($("clonego")) $("clonego").onclick = async () => {
      const K = S.clone; K.busy = true; K.err = ""; redraw();
      try {
        const r = await call("POST", `/api/z/${K.from}/clone`, { ...(K.hasPeople && K.withPeople ? { withPeople: true } : {}) });
        eid = r.id; history.replaceState(null, "", "?e=" + encodeURIComponent(r.id) + (BASE ? "&api=" + encodeURIComponent(BASE) : ""));
        S.store = null; S.f = null; S.fFor = ""; S.openInit = ""; S.cfg = null; S.info = null; S.sum = null; S.life = null; S.people = []; S.pp.list = null; S.pp.sentFor = ""; S.cancel = null; S.cancelDone = false; S.creditMsg = ""; S.screen = "eng";
        S.clone = null; S.cloneNew = r.id; S.cloneDated = ""; S.note = "Your new game is ready to check. Pick the date and time, then publish.";
        refreshTeam(); refreshEng();
      } catch (e) { K.busy = false; K.err = e.status === 404 ? "This is not switched on yet. Please try again a little later." : friendly(e); redraw(); }
    };
    if ($("usecredit")) $("usecredit").onclick = async () => {
      S.creditErr = ""; $("usecredit").disabled = true;
      try { const r = await call("POST", `/api/z/${eid}/pay-with-credit`, {}); S.creditMsg = r.paid ? `Paid with your credit: ${money(r.usedInr)}. The game is on.` : `${money(r.usedInr)} of your credit is used for this game. Pay the rest: ${money(r.toPayInr)}`; }
      catch (e) { S.creditErr = friendly(e); }
      refreshEng();
    };
    all("[data-open-game]", (b) => (b.onclick = () => { eid = b.dataset.openGame; S.store = null; S.f = null; S.fFor = ""; S.openInit = ""; S.cfg = null; S.info = null; refreshTeam(); refreshEng(); }));
    all("[data-reuse]", (b) => (b.onclick = async () => {
      try { // a new game that starts with the earlier roster already on it
        const now = await latestRound(); const id = randId();
        const old = S.history.engagements.find((e) => e.id === b.dataset.reuse);
        await call("POST", "/api/z", { id, startRound: now + 20 * 20, callSeconds: old.call_seconds, cap: Math.max(old.participants + 50, 500) });
        const r = await call("POST", `/api/z/${id}/reuse`, { from: b.dataset.reuse });
        await TBControl.ensureKey(id, { token: secret, base: BASE, prefix: "/api/z" });
        eid = id; history.replaceState(null, "", "?e=" + id); S.store = null; S.f = null; S.fFor = ""; S.openInit = ""; S.cfg = null; S.info = null; S.screen = "eng";
        S.note = `Created with ${r.copied} participants from the earlier game. It starts in 20 minutes; participants use the new link.`; refreshEng();
      } catch (e) { noteAndDraw(e.message); }
    }));
    all("[data-retirekey]", (b) => (b.onclick = async () => { if (!confirm("Retire this key? It will stop working at once.")) return; try { await call("POST", "/api/org/keys/revoke", { id: b.dataset.retirekey }); S.note = "Key retired."; } catch (e) { S.note = e.message; } eid ? loadAccount() : refreshHome(); }));
    if ($("aiaudit")) $("aiaudit").onclick = async () => { try { S.aiTrail = (await call("GET", "/api/org/ai/audit")).trail || []; } catch (e) { S.note = e.message; } redraw(); };
    if ($("closeacct")) $("closeacct").onclick = async () => {
      if (!confirm("Close your account? Your account and all your games are deleted now. This cannot be undone.")) return;
      try { await call("POST", "/api/org/close", { confirm: true }); try { sessionStorage.clear(); } catch {} location.href = "/"; } catch (e) { noteAndDraw(e.message); }
    };
    const newLink = async (path, ask) => {
      if (ask && !confirm(ask)) return;
      try { const r = await call("POST", path, {}); S.aiMsg = r.aiMessage; ss.set("cbz-aimsg", r.aiMessage); S.note = r.mailed ? "Your new AI work link is ready. The old links have stopped. A fresh 24-hour link is on its way to your e-mail." : "Your new AI work link is ready and the old one has stopped. Copy it from the box in your account (we have no e-mail address on file to send it to)."; } catch (e) { S.note = e.message; }
      S.acctOpen = true; redraw();
    };
    if ($("aimake")) $("aimake").onclick = () => newLink("/api/org/ai/replace");
    if ($("aistripmake")) $("aistripmake").onclick = () => newLink("/api/org/ai/replace");
    if ($("aifresh")) $("aifresh").onclick = async () => { try { const r = await call("POST", "/api/org/ai/fresh", {}); S.note = r.mailed ? "A fresh 24-hour AI link is on its way to your e-mail. Never forward that e-mail." : "We have no e-mail address to send it to. Use the link in the box in your account."; } catch (e) { S.note = e.message; } redraw(); };
    if ($("aireplace")) $("aireplace").onclick = () => newLink("/api/org/ai/replace", "Replace your AI work link? The old link stops working at once, even if an AI is using it right now.");
    if (S.aiMsg) wireAiOptions(document, S.aiMsg);
    if ($("aicopy")) $("aicopy").onclick = async () => { if (await copyText(S.aiMsg)) $("aicopy").textContent = "Copied. Now paste it into your AI chat"; };
    if ($("aistripcopy")) $("aistripcopy").onclick = async () => { if (await copyText(S.aiMsg)) $("aistripcopy").textContent = "Copied. Paste it into your AI chat"; };
    if ($("airevoke")) $("airevoke").onclick = async () => { try { await call("POST", "/api/org/ai/revoke", {}); S.aiMsg = ""; ss.set("cbz-aimsg", ""); S.note = "Your AI work link has been stopped."; } catch (e) { S.note = e.message; } redraw(); };
    if ($("qk-save")) { $("qk-save").onclick = quickSave; quickSummary(); }
    if ($("setupsend")) $("setupsend").onclick = () => { const v = $("setupemail").value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { S.setupMsg = "Please type your e-mail."; return redraw(); } const terms = tbTerms("setup"); if (!terms) { S.setupMsg = "Please tick the box to continue."; return redraw(); } setupStep("/api/host/setup/email", { email: v, consent: terms }, true); };
    if ($("setupverify")) $("setupverify").onclick = () => { const v = $("setupcode").value.trim(); if (!/^\d{6}$/.test(v)) { S.setupMsg = "The code has 6 digits."; return redraw(); } setupStep("/api/host/setup/email/verify", { code: v }); };
    if ($("setupmobilego")) $("setupmobilego").onclick = () => { const v = $("setupmobile").value.trim(); if (!cleanPhone(v)) { S.setupMsg = "Please check your mobile number."; return redraw(); } setupStep("/api/host/setup/mobile", { mobile: v }); };
    if ($("gbtn")) mountGoogle(secret ? "host" : "signin");
  }

  // TEST mode (owner-controlled, see docs/TEST_AND_LIVE_MODE.md): a calm notice in the organizer console ONLY. Public pages, participant phones and e-mails never carry it.
  (async () => { try { const m = await (await fetch(BASE + "/api/mode", { cache: "no-store" })).json(); if (m && m.mode === "TEST" && !document.getElementById("testmode")) { const b = document.createElement("div"); b.id = "testmode"; b.className = "ztest"; b.setAttribute("role", "status"); b.textContent = "TEST MODE: nothing here is real. No one outside the owner’s test list is e-mailed, and nothing is charged."; const app = document.getElementById("app"); app.parentNode.insertBefore(b, app); } } catch (e) { /* no banner when the mode cannot be read */ } })();
  let inited = false;
  async function bootstrap() {
    inited = true;
    if (secret) { try { S.kind = (await call("GET", "/api/whoami")).kind || ""; } catch { /* an old or wrong key is handled by the screens below */ } if (!isOrg()) S.shield = false; } // only the Organizer has the AI helper switch
    loadPacks(); loadAuthConfig();
    if (!secret) return redraw();
    const r = role();
    if (r === "host") { try { S.setup = await call("GET", "/api/host/setup"); } catch { S.setup = null; } if (S.setup && S.setup.ready === false) return redraw(); } // an older server has no Finish setup: the Host goes straight in
    if (r === "partner") return redraw();
    if (r === "cohost") { if (eid) return refreshCohost(); return redraw(); }
    if (r === "host" && !eid) { try { S.history = await call("GET", "/api/history"); } catch { S.history = null; } const gs = (S.history && S.history.engagements) || []; if (gs.length === 1) { eid = gs[0].id; refreshTeam(); return refreshEng(); } return redraw(); } // a Host with one game goes straight in; with several they pick
    refreshTeam();
    if (eid) refreshEng();
    else if (QUICK) { S.screen = "quick"; S.f = quickDefault(); await loadPacks(); redraw(); }
    else refreshHome();
  }
  if (bc) bc.onmessage = async (e) => { // another tab offers its key: use it only if it really works (an old or foreign key is ignored)
    const d = e.data || {};
    if (d.ask && secret && (S.kind === "" || S.kind === "master" || S.kind === "ai")) bc.postMessage({ key: secret });
    else if (d.key && !secret && !inited) { try { const r = await fetch(BASE + "/api/whoami", { headers: { "x-organizer": String(d.key) } }); if (r.ok && !secret && !inited) { secret = String(d.key); ss.set("cbz-org", secret); bootstrap(); } } catch { /* offline: ignore */ } }
  };
  (async () => { if (!secret && bc) { bc.postMessage({ ask: true }); await new Promise((r) => setTimeout(r, 350)); } if (!inited) bootstrap(); })();
  setInterval(() => { const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; /* never wipe what the organizer is typing */ if (!secret || document.hidden) return; if (eid) refreshEng(); else if (QUICK || S.screen === "quick") return; else if (isOrg()) refreshHome(); }, 5000);
  window.__zc = S;
})();
