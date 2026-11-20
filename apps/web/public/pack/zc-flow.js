/* The NEW organizer flow, shared by every game (option only: open /zc.html?flow=new). Five steps and a Game dashboard.
   The current console (zc.js) is not touched: it stands aside when flow=new is in the address. Words follow docs 191 (language guide).
   Pure rules live in window.ZFLOW (tested); the page code below only draws them.
   The pack holds no game rules: each game says what it has in its own small zc-flow-game.js (window.ZFLOW_GAME). */
(function () {
  "use strict";
  /** What this game says about itself (zc-flow-game.js). Nothing here is a game rule: the prize list comes from the game's own table (ZG.PRIZE_HOUSES). */
  const G = Object.assign({ brand: "Corporate Games", tickets: [1, 2], bumper: false, boardMax: 90, boardCols: 10, boardTitle: "GAME", sample: true, board: true, claims: true, handover: true, presence: false, feed: false, rehearsal: false, control: false, lucky: false, idKind: false, callSeconds: 12, popular: [], recommended: [], payGame: "", consoleOrigin: "" }, (typeof window !== "undefined" && window.ZFLOW_GAME) || {});
  const COPY = {
    top: "No personal details needed. All participant information is deleted within 24 hours of the game.",
    dash: "Game dashboard",
    dashLocked: "Opens after you publish",
    next: "Next",
  };
  const STEPS = [
    { n: 1, id: "when", name: "Date and time" },
    { n: 2, id: "who", name: "Who is this game for" },
    { n: 3, id: "prizes", name: "Tickets and prizes" },
    { n: 4, id: "brand", name: "Brand & Breaks", optional: true },
    { n: 5, id: "publish", name: "Check and publish" },
    { n: 6, id: "pay", name: "Pay" },
  ];
  /** A step can be opened when every earlier required step is done. Brand & Breaks is optional, so it never blocks step 5. */
  function canOpen(n, done) {
    for (const s of STEPS) { if (s.n >= n) break; if (!s.optional && !done[s.n]) return false; }
    return true;
  }
  /** The next step to scroll to after a step is saved (the first step not yet done, after n). */
  function nextAfter(n, done) {
    for (const s of STEPS) if (s.n > n && !done[s.n]) return s.n;
    return 0;
  }
  /** The Game dashboard stays locked until the game is published. */
  const dashboardOpen = (info) => !!info && info.published === true;
  /** Words banned by the language guide in anything the organizer reads. */
  const BANNED = [/\binvit/i, new RegExp("\\bpriv" + "ate\\b", "i"), /\bwe\b/i, /\bRs\.?\s?\d/, /\bseats?\b/i, /\bplaces\b/i, /in the office/i, /\bcash\b/i];
  const badWords = (text) => BANNED.filter((r) => r.test(text)).map(String);
  /* ---- Step 1: date, time and zone (pure) ---- */
  const OCC = ["Diwali party", "Dealer meet", "Annual day", "Team party", "Customer event", "Family day", "Weekend Fun", "Christmas Party", "Eid Party", "Holi Party", "Other"];
  const ZONES = [
    { id: "Asia/Kolkata", label: "India (IST)" }, { id: "Asia/Dubai", label: "Dubai" }, { id: "Asia/Singapore", label: "Singapore" },
    { id: "Europe/London", label: "London" }, { id: "America/New_York", label: "New York" }, { id: "America/Los_Angeles", label: "Los Angeles" }, { id: "Australia/Sydney", label: "Sydney" },
  ];
  const OTHER_ZONE = "other";
  const validZone = (z) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };
  /** What a clock in `zone` reads at `ms`, as numbers. */
  function partsIn(ms, zone) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
  }
  /** The moment (ms) when the wall clock in `zone` reads dateStr (YYYY-MM-DD) and timeStr (HH:MM). */
  function wallToMs(dateStr, timeStr, zone) {
    const [y, mo, d] = dateStr.split("-").map(Number), [h, mi] = timeStr.split(":").map(Number);
    const want = Date.UTC(y, mo - 1, d, h, mi);
    let ms = want;
    for (let i = 0; i < 3; i++) { const p = partsIn(ms, zone); ms += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); }
    return ms;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const todayIn = (now, zone) => { const p = partsIn(now, zone); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); };
  /** Times offered every 15 minutes; one that has already passed in the chosen zone is disabled. */
  function timeOptions(dateStr, zone, now) {
    const out = [];
    for (let m = 0; m < 24 * 60; m += 15) { const t = pad(Math.floor(m / 60)) + ":" + pad(m % 60); out.push({ t, passed: !(wallToMs(dateStr, t, zone) > now) }); }
    return out;
  }
  const clockIn = (ms, zone) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  /** "For people elsewhere": the same moment on the clocks of the other popular zones. */
  const elsewhere = (ms, zone) => ZONES.filter((z) => z.id !== zone).slice(0, 4).map((z) => z.label + ": " + clockIn(ms, z.id));
  const gameName = (occ, other) => (occ === "Other" ? String(other || "").replace(/\s+/g, " ").trim() : occ);
  /** Everything wrong with step 1, in plain words (empty list = fine). */
  function whenProblems(f, now) {
    const bad = [];
    if (!gameName(f.occ, f.oname)) bad.push("Please type a name for your game.");
    if (!f.date || !f.time) { bad.push("Please choose a day and a time."); return bad; }
    const zone = f.zone === OTHER_ZONE ? f.zoneOther : f.zone;
    if (!zone || !validZone(zone)) { bad.push("Please choose a time zone from the list."); return bad; }
    const ms = wallToMs(f.date, f.time, zone);
    if (!(ms > now)) bad.push("That time has already passed. Please choose a later time.");
    else if (ms > now + 30 * 86400000) bad.push("A game can start at most 30 days from today.");
    return bad;
  }
  /* ---- Step 2: who is this game for (pure) ---- */
  const CARDS = [
    { id: "people", name: "Your people", line: "Everyone who works with you.", invites: false, cats: [] },
    { id: "family", name: "Your people and their families", line: "Each person can bring up to 4 family members. Every ticket is one participant.", invites: true, cats: ["family"] },
    { id: "extended", name: "Extended family", line: "Your people, their families and friends, wherever they are.", invites: true, cats: ["family", "colleagues"] },
  ];
  const FALLBACK_PACKS = [{ upTo: 100, inr: 2399 }, { upTo: 250, inr: 3499 }, { upTo: 500, inr: 4699 }, { upTo: 1000, inr: 7099 }];
  const money = (n) => "₹" + Number(n).toLocaleString("en-IN");
  /** The size choices, from the game's real pack ladder (smallest first). */
  const packChoices = (packs) => (Array.isArray(packs) && packs.length ? packs : FALLBACK_PACKS).filter((k) => Number(k.upTo) > 0).map((k) => ({ upTo: Number(k.upTo), inr: Number(k.inr) || 0, label: "Up to " + k.upTo + " participants" + (k.inr ? " · " + money(k.inr) : "") })).sort((a, b) => a.upTo - b.upTo);
  /** What the system saves for a card: only people the organizer lets in take part; family cards allow 4 more people each. */
  function audienceSettings(cardId, upTo, idKind) {
    const c = CARDS.find((x) => x.id === cardId) || CARDS[0];
    const out = { cap: Number(upTo), whoCanJoin: "list", callMode: "auto", demo: false, invites: { on: c.invites, per: 4, cats: c.cats } };
    if (idKind !== undefined) out.idKind = idKindOf(idKind);
    return out;
  }
  /* ---- Which ID? (owner rule): the game setting idKind is "emp" (Employee ID, the default) or "email" (Email ID). Shown only when the game declares idKind in its descriptor. ---- */
  const idKindOf = (v) => (v === "email" ? "email" : "emp");
  const ID_WORDS = {
    emp: { choice: "Employee ID", label: "Employee ID", column: "Employee ID", add: "Employee ID of the person", join: "Your Employee ID", hint: "The system will read this as capital letters and numbers only, for example 1b-678 becomes 1B678." },
    email: { choice: "Email ID", label: "Email ID", column: "Email ID", add: "Email ID of the person", join: "Your Email ID", hint: "The system will read this in small letters with no spaces, for example Raj@Demo.com becomes raj@demo.com." },
  };
  const idWords = (kind) => ID_WORDS[idKindOf(kind)];
  function whoProblems(f, choices) {
    if (!CARDS.some((c) => c.id === f.card)) return ["Please choose who the game is for."];
    if (!choices.some((k) => k.upTo === Number(f.upTo))) return ["Please choose the size of your game."];
    return [];
  }
  /* ---- Step 3: tickets and prizes (pure) ---- */
  /** The houses the game itself offers (window.ZG.PRIZE_HOUSES). Super Bumper House has its own part of the screen. */
  const housesOf = (zg) => (zg && Array.isArray(zg.PRIZE_HOUSES) ? zg.PRIZE_HOUSES : []).filter((h) => h.id !== "full2");
  const POPULAR = G.popular, RECOMMENDED = G.recommended; // the boss's picks, not data: each game lists its own
  /** Tags always read (Popular) before (Recommended). */
  const tagsOf = (id) => [POPULAR.includes(id) ? "(Popular)" : "", RECOMMENDED.includes(id) ? "(Recommended)" : ""].filter(Boolean);
  const GIFTS = ["Gift voucher", "Gift hamper", "Smartphone", "Smart watch", "Earbuds or headphones", "Tablet or laptop", "Holiday or weekend stay", "Dinner or restaurant voucher", "Movie tickets", "Extra day off"]; // no cash, ever
  const OTHER_GIFT = "Other";
  const CURRENCIES = [["INR", "₹", "en-IN"], ["USD", "$", "en-US"], ["EUR", "€", "en-US"], ["GBP", "£", "en-GB"], ["AED", "AED ", "en-US"], ["SGD", "S$", "en-US"]];
  const symbolOf = (cur) => (CURRENCIES.find((c) => c[0] === cur) || CURRENCIES[0])[1];
  /** The words saved for one prize: the gift, and "worth up to" when the organizer gave an amount. */
  function prizeLine(gift, other, worth, cur) {
    const g = gift === OTHER_GIFT ? String(other || "").replace(/\s+/g, " ").trim() : gift;
    const w = String(worth || "").replace(/[^0-9.]/g, "");
    if (!g) return "";
    if (!w || !(Number(w) > 0)) return g;
    const c = CURRENCIES.find((x) => x[0] === cur) || CURRENCIES[0];
    return g + " (worth up to " + c[1] + Number(w).toLocaleString(c[2]) + ")";
  }
  const defaultPrizes = (houses) => Object.fromEntries(houses.map((h) => [h.id, { on: RECOMMENDED.length ? RECOMMENDED.includes(h.id) : !!h.dflt, n: 1, gift: GIFTS[0], other: "", worth: "" }]));
  const defaultBumper = () => ({ on: false, n: 1, gift: GIFTS[0], other: "", worth: "" });
  /** The prizes as the game stores them: a line per winner place (1st, 2nd, ...). Super Bumper House only with 2 tickets. */
  function buildRewards(sel, bumper, tix, cur) {
    const out = [];
    for (const [id, h] of Object.entries(sel)) {
      if (!h.on) continue;
      for (let o = 1; o <= Number(h.n); o++) out.push({ pattern: id, scope: "ticket", ordinal: o, text: prizeLine(h.gift, h.other, h.worth, cur) });
    }
    if (G.bumper && Number(tix) === 2 && bumper && bumper.on) for (let o = 1; o <= Number(bumper.n); o++) out.push({ pattern: "full", scope: "two_ticket", ordinal: o, text: prizeLine(bumper.gift, bumper.other, bumper.worth, cur) });
    return out;
  }
  function prizeProblems(sel, bumper, tix, houses) {
    const rows = Object.entries(sel).filter(([, h]) => h.on);
    const bump = G.bumper && Number(tix) === 2 && bumper && bumper.on;
    if (!rows.length && !bump) return ["Tick at least one prize."];
    for (const [id, h] of rows) { const name = (houses.find((x) => x.id === id) || {}).label || id; if (!prizeLine(h.gift, h.other, h.worth, "INR")) return ["Please write the prize for " + name + "."]; }
    if (bump && !prizeLine(bumper.gift, bumper.other, bumper.worth, "INR")) return ["Please write the prize for Super Bumper House."];
    return [];
  }
  /* ---- Step 4: Brand & Breaks (pure) ---- */
  const BREAK_MAX = { 1: 3, 2: 5 }; // message breaks: a 1-ticket game, a 2-ticket game
  const breakMax = (tix, luckyOn) => BREAK_MAX[Number(tix) === 2 ? 2 : 1] - (luckyOn ? 1 : 0); // a lucky draw takes one of the game's break places
  const BRAND_COLORS = ["#0B3D91", "#1A7A46", "#B3261E", "#7A3EB1", "#C75B00", "#0F6E7A"];
  /** A ticket cannot show & or quote marks: the company name is made safe, and the organizer is told (same rule as the current console). */
  const brandNameClean = (s) => String(s || "").replace(/\s*&\s*/g, " and ").replace(/'/g, "\u2019").replace(/[<>`"\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  const fixUrl = (u) => (/^(www\.|youtu\.be\/|(m\.|music\.)?youtube\.com\/)/i.test(u) ? "https:" + "//" + u : u);
  const YT = /^https:\/\/((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/|embed\/|live\/)|youtu\.be\/)/i;
  const MEDIA = /^https:\/\/[^\s]+\.(mp4|webm|m4v|mov|ogv|mp3|m4a|aac|wav|ogg|oga)([?#]\S*)?$/i;
  /** What a pasted link is: a YouTube link (best), a link straight to a video or audio file, or neither. */
  function linkKind(raw) {
    const u = fixUrl(String(raw || "").trim());
    return YT.test(u) ? "youtube" : MEDIA.test(u) ? "file" : null;
  }
  function brandProblems(b) {
    const out = [];
    if (b.logo && !brandNameClean(b.name)) out.push("Your logo needs a company name. Please type the name, or remove the logo.");
    return out;
  }
  function breakProblems(breaks, tix, luckyOn) {
    if (breaks.length > breakMax(tix, luckyOn)) return ["You can add up to " + breakMax(tix, luckyOn) + " message breaks for a " + (Number(tix) === 2 ? "2-ticket" : "1-ticket") + " game."];
    for (let i = 0; i < breaks.length; i++) if (!linkKind(breaks[i].link)) return ["Message break " + (i + 1) + ": please paste a public link. A YouTube link is best."];
    return [];
  }
  /** What the game stores: the company strip and the message breaks (the opening and closing moments are left empty in this flow). */
  function buildBrandPatch(form, tix) {
    const name = brandNameClean(form.brand.name);
    const brand = name ? { name, color: form.brand.color || BRAND_COLORS[0], ...(form.brand.logo ? { logo: form.brand.logo } : {}) } : {};
    const breaks = form.breaks.map((b) => { const u = fixUrl(String(b.link).trim()); return { kind: linkKind(u), title: String(b.title || "").trim() || "A message from your organizer", mediaUrl: u }; });
    return { tickets: Number(tix), opening: [], breaks, closing: [], brand };
  }
  /* ---- Step 5: check and publish (pure) ---- */
  const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
  /** The organizer's own contact, needed to publish (the invoice and the game report go there). */
  function contactProblems(email, phone) {
    if (!EMAIL.test(String(email || "").trim())) return ["Please type your email ID, for example name@company.com."];
    const d = String(phone || "").replace(/\D/g, "");
    if (d.length < 10 || d.length > 15) return ["Please type your mobile number, with 10 digits."];
    return [];
  }
  /** Everything chosen in steps 1 to 4, in plain words, to read back before publishing. */
  function readBack(s) {
    const lines = [];
    if (s.when) lines.push(["Game", s.name + " · " + clockIn(s.when.ms, s.when.zone) + " (" + ((ZONES.find((z) => z.id === s.when.zone) || {}).label || s.when.zone.replace(/_/g, " ")) + ")"]);
    const card = CARDS.find((c) => c.id === s.card);
    const size = (s.choices || []).find((k) => k.upTo === Number(s.upTo));
    if (card) lines.push(["For", card.name + (size ? " · " + size.label : "")]);
    lines.push(["Tickets", s.tix + (Number(s.tix) === 1 ? " ticket" : " tickets") + " for each participant"]);
    const rw = s.rewards || [];
    const names = {};
    for (const r of rw) { const k = r.pattern + "|" + r.scope; (names[k] = names[k] || { r, n: 0 }).n++; }
    for (const { r, n } of Object.values(names)) lines.push([r.scope === "two_ticket" ? "Super Bumper House" : (s.houses.find((h) => h.id === r.pattern) || {}).label || r.pattern, r.text + (n > 1 ? " · won " + n + " times" : "")]);
    lines.push(["Company", s.brand && s.brand.name ? s.brand.name : "Not added"]);
    lines.push(["Message breaks", String((s.breaks || []).length)]);
    return lines;
  }
  /* ---- Game dashboard (pure) ---- */
  const BANNER_UNPAID = "Published, payment is pending. Don’t worry. The game will not start until the payment is done, and you can cancel it at any time.";
  /** One status banner: unpaid or paid, in the words of the style guide. `startText` is the start time as the organizer read it in step 1. */
  const bannerOf = (info, startText) => (!info || !info.published ? null : info.paid
    ? { kind: "paid", text: "Congratulations, your game is on! It will begin at " + startText + ". You can postpone or change it up to 5 minutes before the game begins." }
    : { kind: "unpaid", text: BANNER_UNPAID });
  const gameLink = (origin, eid) => origin + "/z.html?e=" + eid;
  const boardLink = (origin, eid) => origin + "/board.html?e=" + eid;
  const shareMessage = (name, link, eid) => "You are welcome to join our " + name + " game." + (eid ? " Game ID: " + eid + "." : "") + " Open this game link on your phone: " + link;
  const PAY_PRINT = "The payment is small, so many organizers pay it themselves and claim it back (recommended). You can also copy the payment link and share it with the person who will pay. The money goes into your own credits for this game.";
  /* ---- Step 6: Pay (pure). Every number is given by the console from Moneypenny; nothing here knows a price. ---- */
  const PAY = {
    title: "Game only starts when you pay",
    notes: "You don't have to buy software or a subscription or download anything. You only pay per game. Simple and easy.",
    privacy: "No personal details needed. All participant information is deleted within 24 hours of the game. Our games are designed to follow US privacy laws, the EU GDPR and India's DPDP.",
    close: "Close",
    frame: "Secure payment",
    again: "Open the payment window again",
    checking: "Checking your payment. This page updates by itself.",
    notDone: "The payment did not go through. Nothing has been taken. You can try again.",
    busy: "Credits are refreshing. Nothing has been taken from you. Please try again in a few minutes.",
    link: "Payment link copied. The person who pays adds credits to your account for this game, and your game is marked paid by itself.",
    waiting: "Waiting for your payment. This page updates by itself when it arrives. You do not need to do anything else.",
    paid: "Thank you. Your game is paid and ready.",
  };
  const fmtN = (n) => Number(n).toLocaleString("en-US");
  const fmtInr = (minor) => { const r = Number(minor) / 100; return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  const worthText = (w) => "(= US$ " + w.usd + " / " + fmtInr(w.inrMinor) + ")";
  const creditsText = (w, label) => fmtN(w.credits) + " " + (label || "Moneypenny") + " credits " + worthText(w);
  /** The lines of the pay screen from the console's quote ({price, balance, short, enough, label}). The first button is 'Pay with your credits' when the credits already cover the game. */
  function payLines(q) {
    const out = { cost: "Cost of this game: " + creditsText(q.price, q.label), have: "Your existing credits: " + creditsText(q.balance, q.label), need: "", primary: q.enough ? "Pay with your credits" : "Buy now" };
    if (!q.enough) out.need = "You only need to buy " + fmtN(q.short.credits) + " credits " + worthText(q.short) + " to start the game";
    return out;
  }
  /** The console's address for the pay step: the real one, or (only on this computer) the ?console= address of a local test. */
  function consoleBase(g, search, host) {
    const o = String((g && g.consoleOrigin) || "").replace(/\/$/, "");
    const local = host === "localhost" || host === "127.0.0.1";
    const over = local ? new URLSearchParams(search || "").get("console") : null;
    return (over && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(over)) ? over : o;
  }
  /** The size the game was made for, as Moneypenny's price list names it (the size's 'up to' number). */
  const payItem = (upTo, raw) => String(Number(upTo) || Number(raw && raw.cap) || "");
  /* employee ID: the same function as employee-id.js (a test keeps the two identical). An employee ID is always shown in this one cleaned form. */
  function cleanEmployeeId(raw) { return String(raw == null ? "" : raw).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  /** The waiting table: Ticket number always; Name, Employee ID, Email ID, Mobile and Referred by only when somebody gave them. */
  function waitColumns(rows) {
    const all = [
      { label: "Ticket number", get: (w) => (w.ticket != null ? String(w.ticket) : ""), always: true },
      { label: "Name", get: (w) => String(w.name || w.firstName || "") },
      { label: "Employee ID", get: (w) => cleanEmployeeId(w.empId || w.employeeId) },
      { label: "Email ID", get: (w) => String(w.email || "") },
      { label: "Mobile", get: (w) => (w.mobile ? String(w.mobile) : w.last4 ? "ends " + w.last4 : "") },
      { label: "Referred by", get: (w) => String(w.via || w.referredBy || "") },
    ];
    return all.filter((c) => c.always || rows.some((w) => c.get(w)));
  }
  const waitLabel = (w) => [w.ticket != null ? "Ticket " + w.ticket : "", w.name || w.firstName || "", cleanEmployeeId(w.empId || w.employeeId), w.email || "", w.last4 ? "ends " + w.last4 : ""].filter(Boolean).join(" \u00b7 ") || "A participant";
  /** Tickets claimed: real claims only (practice rows are left out). */
  const claimedCount = (claims) => (Array.isArray(claims) ? claims.filter((c) => !c.bogey).length : 0);
  const REPORT_NOTE = "After the game, download your game report within 24 hours. All personal information of participants is deleted within 24 hours of the game. The game log (by ticket number only) and the records of the organizer, winners, Host and Co-host are kept 365 days.";
  /* ---- Game ID and the eleven statuses (pure) ---- */
  const STATUSES = {
    draft: { label: "Draft", tone: "grey" },
    pending: { label: "Published, payment pending", tone: "amber" },
    paid: { label: "Published and paid", tone: "green" },
    free: { label: "Published, free game", tone: "green" },
    overdue: { label: "Payment pending, start time passed", tone: "red" },
    live: { label: "Live now", tone: "red" },
    paused: { label: "Paused", tone: "amber" },
    completed: { label: "Completed", tone: "blue" },
    cancelled: { label: "Cancelled", tone: "grey" },
    refund: { label: "Cancelled, refund requested", tone: "amber" },
    deleted: { label: "Data deleted", tone: "grey" },
  };
  /** The one status of a game, from what the game's own info answer says (`raw`), plus facts from elsewhere (paused, refund, report sent, data deleted). */
  function statusOf(raw, facts, now) {
    const f = facts || {};
    if (f.deleted) return "deleted";
    if (raw && raw.cancelled) return f.refund ? "refund" : "cancelled";
    if (!raw || raw.draft) return "draft";
    const start = Number(raw.startMs) || 0, end = start + (Number(raw.gameMinutes) || 60) * 60000 + 600000;
    if (raw.unpaid === true) return raw.locked || (start && now >= start) ? "overdue" : "pending";
    if (f.completed || (start && now > end)) return "completed";
    if (f.paused) return "paused";
    if (start && now >= start) return "live";
    return raw.demo ? "free" : "paid";
  }
  const STATUS_WORDS = {
    draft: "Saved as a draft. Nobody can join yet. Finish the steps and press Publish.",
    overdue: "Payment is pending and the start time has passed, so the game has not started. Pay now, change the date, or cancel it.",
    live: "Your game is live now. Your participants are playing.",
    paused: "Your game is paused. It continues when it is resumed.",
    completed: "Thank you for playing! The report was also sent to your email. Download it within 24 hours.",
    cancelled: "This game was cancelled. Nothing is charged. You can make a copy of it any time.",
    refund: "This game was cancelled and a refund was requested. Please keep the Game ID for any question.",
    deleted: "The information of this game has been deleted. Only the Game ID and the payment record remain.",
  };
  const BANNER_KIND = { draft: "off", pending: "unpaid", paid: "paid", free: "paid", overdue: "overdue", live: "live", paused: "paused", completed: "done", cancelled: "off", refund: "paused", deleted: "off" };
  /** The one banner of a status. Pending and paid keep the owner's exact words (bannerOf); a free game reads like a paid one. */
  function statusBanner(status, startText) {
    const kind = BANNER_KIND[status] || "off";
    if (status === "pending") return { kind, text: BANNER_UNPAID };
    if (status === "paid") return { kind, text: bannerOf({ published: true, paid: true }, startText).text };
    if (status === "free") return { kind, text: "Congratulations, your game is on! It is a free game. It will begin at " + startText + ". You can postpone or change it up to 5 minutes before the game begins." };
    return { kind, text: STATUS_WORDS[status] || "" };
  }

  /* ---- Ready check, publish warning, prizes handed over, what is happening (pure) ---- */
  const LIVE_OR_DONE = ["paid", "free", "live", "paused", "completed"];
  /** The Ready check: what must be true before the game starts (and two optional extras). `x` = { shared, status, prizesOk, rehearsals } */
  function readyItems(x) {
    const items = [
      { id: "link", label: "Game link shared with your participants", done: !!x.shared },
      { id: "pay", label: "Payment", done: LIVE_OR_DONE.includes(x.status) },
      { id: "prizes", label: "Prizes chosen", done: !!x.prizesOk },
    ];
    if (Array.isArray(x.rehearsals)) items.push({ id: "reh", label: "Rehearsal done", optional: true, done: x.rehearsals.some((c) => c.state === "done") });
    return items;
  }
  const readyAll = (items) => items.filter((i) => !i.optional).every((i) => i.done);
  /** Every prize line the game has a name for (a prize with no words would give the winner nothing). */
  const prizesNamed = (rewards) => Array.isArray(rewards) && rewards.length > 0 && rewards.every((r) => String(r.text || "").trim());
  /** Step 5 warning: a game that starts soon gives participants no time to join (the "published nine minutes late" lesson). */
  function startWarning(ms, now) {
    const min = Math.floor((ms - now) / 60000);
    if (!(ms > 0)) return "";
    if (min < 0) return "The start time has passed. Please go back to step 1 and choose a later time.";
    if (min < 30) return "Your game starts in " + min + (min === 1 ? " minute" : " minutes") + ". Your participants need time to join. Please send the game link right after you publish, or go back to step 1 and choose a later time.";
    return "";
  }
  /** What the winner of a prize is shown with: the ticket number first, then only the details that are held. */
  function winnerDetails(p) {
    const parts = [["Name", p.name], ["Employee ID", cleanEmployeeId(p.empId || p.employeeId)], ["Email ID", p.email], ["Mobile", p.phone || p.mobile], ["Referred by", p.via || p.referredBy]].filter(([, v]) => v && String(v).trim());
    return parts.length ? parts.map(([k, v]) => k + ": " + v).join(" · ") : "No other details were given";
  }
  const prizeKey = (p) => [p.round || 1, p.pattern, p.ordinal || 1, p.seat].join("|");
  /** "Prizes: 3 won, 4 left" and the number handed over. */
  function prizeCounts(prizes, rewards) {
    const won = Array.isArray(prizes) ? prizes.length : 0, total = Array.isArray(rewards) ? rewards.length : 0;
    return { won, left: Math.max(0, total - won), given: (prizes || []).filter((p) => p.given).length };
  }
  /** "What is happening", in plain lines, from the game's own log. */
  function feedLines(g) {
    if (!g) return [];
    const out = [];
    if (g.people) out.push(g.people.joined + " joined" + (g.people.waiting ? ", " + g.people.waiting + " waiting for you" : "") + ".");
    for (const p of g.prizes || []) out.push((p.prize || "A prize") + " won by Ticket number " + p.ticket + ".");
    for (const l of g.lucky || []) out.push("Lucky draw " + (l.drawn ? "drawn: Ticket number" + (l.tickets.length === 1 ? " " : "s ") + l.tickets.join(", ") + "." : "not drawn yet."));
    for (const p of g.pauses || []) out.push("Paused by " + String(p.by).replace(/^The /, "the ").replace(/^A /, "a ") + (p.toMs ? "." : ", not resumed yet."));
    for (const w of g.warnings || []) out.push(String(w));
    return out;
  }
  const CLAIM_OK_MS = 15000;
  /** After a claim settles: first "Congratulations! The claim is correct.", then "<PRIZE> is gone. It has been won by Ticket N." (newest prize; `seenAt` is when this screen first saw it, 0 = already there when the page opened). */
  function claimLine(prize, label, seenAt, now) {
    if (!prize) return "";
    if (seenAt && now - seenAt < CLAIM_OK_MS) return "Congratulations! The claim is correct.";
    return label + " is gone. It has been won by Ticket " + prize.seat + ".";
  }
  const NEXT_LOCK_MS = 5000; // a second press inside 5 seconds counts as one
  const NEXT_TOAST = "Already called. Please wait a few seconds before the next number.";
  /** What the next-number control says: the timer words in Auto mode, the button in Manual mode, the wait while locked. */
  function nextControlText(mode, lockLeftMs) {
    if (mode !== "manual") return "Numbers are called automatically";
    return lockLeftMs > 0 ? "Wait " + Math.ceil(lockLeftMs / 1000) + " s" : "Press to Roll Out the Next Number";
  }
  /** Free practice runs: only a PAID game has them; a rehearsal never shows the people limit of the real game. */
  const REHEARSAL_LOCKED = "First publish your game and pay. This unlocks your 3 rehearsals.";
  function rehearsalCards(api) {
    const cards = api && Array.isArray(api.cards) ? api.cards : [1, 2, 3].map((n) => ({ n, state: "locked", reason: REHEARSAL_LOCKED }));
    return cards.map((c) => ({ n: c.n, state: c.state, id: c.id || "", reason: c.state === "locked" ? c.reason || REHEARSAL_LOCKED : "", dateMs: c.dateMs || 0 }));
  }
  const COMPLETED_NOTE = "All personal information of participants is deleted within 24 hours of the game. The game log (by ticket number only) and the records of the organizer, winners, Host and Co-host are kept 365 days.";
  /** The Lucky draw as the game stores it: one break of kind "lucky" (it takes a break place and never picks the organizer, Hosts or Co-hosts). */
  const luckyBreaks = () => (G.lucky && prizes.lucky.on ? [{ kind: "lucky", title: prizeLine(prizes.lucky.gift, prizes.lucky.other, prizes.lucky.worth, prizes.cur) || "Lucky draw", winners: Number(prizes.lucky.n) || 1 }] : []);
  const registry = {}; // step number -> function(el, ctx) that draws the step body (each step adds its own)

  const api = { COPY, STEPS, canOpen, nextAfter, dashboardOpen, badWords, registry, OCC, ZONES, wallToMs, todayIn, timeOptions, elsewhere, gameName, whenProblems, clockIn, CARDS, money, packChoices, audienceSettings, idKindOf, idWords, whoProblems, housesOf, tagsOf, GIFTS, prizeLine, defaultPrizes, defaultBumper, buildRewards, prizeProblems, breakMax, brandNameClean, linkKind, brandProblems, breakProblems, buildBrandPatch, contactProblems, readBack, readyItems, readyAll, prizesNamed, startWarning, winnerDetails, prizeKey, prizeCounts, feedLines, nextControlText, rehearsalCards, NEXT_LOCK_MS, NEXT_TOAST, REHEARSAL_LOCKED, luckyBreaks, bannerOf, gameLink, boardLink, PAY, payLines, creditsText, worthText, fmtInr, consoleBase, payItem, shareMessage, claimedCount, BANNER_UNPAID, PAY_PRINT, waitColumns, waitLabel, STATUSES, statusOf, statusBanner, claimLine, CLAIM_OK_MS, sampleTickets };
  if (typeof window !== "undefined") window.ZFLOW = api;
  if (typeof module !== "undefined") module.exports = api;
  if (typeof document === "undefined") return;
  const q = new URLSearchParams(location.search);
  if (q.get("flow") !== "new") return;

  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };
  const state = { done: {}, open: 1, info: null };
  const app = document.getElementById("app");
  function scrollTo(id) { const t = document.getElementById(id); if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth", block: "start" }); }

  function draw() {
    app.replaceChildren();
    app.append(el("p", { class: "zf-top", role: "note", text: COPY.top }));
    if (state.eid) app.append(idBar());
    const bar = el("ol", { class: "zf-bar", "aria-label": "Steps" });
    for (const s of STEPS) {
      const ok = canOpen(s.n, state.done), cur = state.open === s.n;
      bar.append(el("li", {}, el("button", { type: "button", class: "zf-pill" + (cur ? " cur" : "") + (state.done[s.n] ? " done" : ""), "data-step": String(s.n), ...(ok ? {} : { disabled: "" }), ...(cur ? { "aria-current": "step" } : {}), onclick: () => { state.view = "steps"; state.open = s.n; draw(); scrollTo("zf-sec" + s.n); } }, el("b", { text: String(s.n) }), " ", s.name, s.optional ? el("i", { text: " (optional)" }) : null)));
    }
    const open = dashboardOpen(state.info);
    bar.append(el("li", {}, el("button", { type: "button", class: "zf-pill zf-dash" + (state.view === "dash" ? " cur" : ""), id: "zf-dash", ...(open ? { onclick: () => { state.view = "dash"; draw(); refreshDash(); } } : { disabled: "", title: COPY.dashLocked }) }, COPY.dash, open ? null : el("i", { text: " · " + COPY.dashLocked }))));
    app.append(bar);
    if (state.view === "dash" && dashboardOpen(state.info)) { app.append(dashboard()); return; }
    for (const s of STEPS) {
      const sec = el("section", { class: "zf-sec" + (state.open === s.n ? " open" : ""), id: "zf-sec" + s.n, "aria-labelledby": "zf-h" + s.n });
      sec.append(el("h2", { id: "zf-h" + s.n, text: s.n + ". " + s.name }));
      if (state.open === s.n) {
        const body = el("div", { class: "zf-body" });
        if (registry[s.n]) registry[s.n](body, { state, done, redraw: draw }); else body.append(el("p", { class: "zf-soon", text: COPY.soon }));
        sec.append(body);
      }
      app.append(sec);
    }
  }
  /** Called by a step when it has saved: mark it done and move on to the next step, scrolling to it. */
  function done(n) {
    state.done[n] = true;
    if (n === 5 && dashboardOpen(state.info) && state.info.paid) { state.view = "dash"; draw(); refreshDash(); return; } // a free or paid game goes to the dashboard; an unpaid one goes on to Pay
    if (n === 6) { state.view = "dash"; draw(); refreshDash(); return; }
    const nx = nextAfter(n, state.done);
    if (nx) state.open = nx;
    draw();
    if (nx) scrollTo("zf-sec" + nx);
  }
  /* ---- talking to the game service (same sign-in key as the current console) ---- */
  const BASE = (q.get("api") || "").replace(/\/$/, "");
  const secret = () => { try { return (window.CTK ? window.CTK.get("ctz-org") : sessionStorage.getItem("ctz-org")) || ""; } catch { return ""; } };
  { const k = q.get("k"); if (k && /^ct[hcak]_[0-9a-f]{48}$/.test(k)) { try { if (window.CTK) window.CTK.set("ctz-org", k); else sessionStorage.setItem("ctz-org", k); q.delete("k"); const rest = q.toString(); window.history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "")); } catch { /* the page then asks for the link again */ } } } // a sign-in link from the current console (?k=...) works here too
  state.eid = q.get("e") || "";
  async function call(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-organizer": secret() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Could not do that. Please try again."), { status: r.status });
    return j;
  }
  const randId = () => "E" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  api.call = call;

  /* ---- Step 1 ---- */
  const form = { occ: "Team party", oname: "", date: "", time: "", zone: "Asia/Kolkata", zoneOther: "" };
  api.form = form;
  registry[1] = (box) => {
    const now = Date.now(), zone = form.zone === OTHER_ZONE ? form.zoneOther : form.zone, okZone = !!zone && validZone(zone);
    const msg = el("p", { class: "zf-msg", role: "status", id: "zf-msg1" });
    const redo = () => { const keep = document.activeElement && document.activeElement.id; draw(); if (keep) { const k = document.getElementById(keep); if (k) k.focus(); } };
    box.append(el("p", { class: "zf-lead", text: "Choose when your game begins. People can join from any location." }));
    const occ = el("div", { class: "zf-chips", role: "radiogroup", "aria-label": "Occasion" });
    for (const o of OCC) occ.append(el("button", { type: "button", role: "radio", class: "zf-chip" + (form.occ === o ? " on" : ""), "aria-checked": String(form.occ === o), "data-occ": o, onclick: () => { form.occ = o; redo(); } }, o));
    box.append(el("h3", { text: "What is the occasion?" }), occ);
    if (form.occ === "Other") box.append(el("label", { for: "zf-oname", text: "Write the occasion (it becomes the name of your game)" }), el("input", { id: "zf-oname", type: "text", maxlength: "40", value: form.oname, oninput: (e) => { form.oname = e.target.value; } }));
    if (!okZone) { box.append(el("p", { class: "zf-msg", text: "Choose a time zone to see the times." })); }
    const zsel = el("select", { id: "zf-zone", "aria-label": "Time zone", onchange: (e) => { form.zone = e.target.value; form.time = ""; redo(); } });
    for (const z of ZONES) zsel.append(el("option", { value: z.id, ...(form.zone === z.id ? { selected: "" } : {}) }, z.label));
    zsel.append(el("option", { value: OTHER_ZONE, ...(form.zone === OTHER_ZONE ? { selected: "" } : {}) }, "Other"));
    const day = el("input", { id: "zf-date", type: "date", value: form.date, ...(okZone ? { min: todayIn(now, zone) } : {}), onchange: (e) => { form.date = e.target.value; form.time = ""; redo(); } });
    const tsel = el("select", { id: "zf-time", "aria-label": "Time", onchange: (e) => { form.time = e.target.value; redo(); } }, el("option", { value: "" }, "Choose a time"));
    if (okZone && form.date) for (const t of timeOptions(form.date, zone, now)) tsel.append(el("option", { value: t.t, ...(t.passed ? { disabled: "" } : {}), ...(form.time === t.t ? { selected: "" } : {}) }, t.t));
    box.append(el("h3", { text: "Which day and time?" }), el("label", { for: "zf-date", text: "Day" }), day, el("label", { for: "zf-time", text: "Time" }), tsel, el("label", { for: "zf-zone", text: "Time zone" }), zsel);
    if (form.zone === OTHER_ZONE) box.append(el("label", { for: "zf-zone2", text: "Time zone name, for example Asia/Tokyo" }), el("input", { id: "zf-zone2", type: "text", value: form.zoneOther, onchange: (e) => { form.zoneOther = e.target.value.trim(); redo(); } }));
    if (okZone && form.date && form.time) {
      const ms = wallToMs(form.date, form.time, zone);
      box.append(el("div", { class: "zf-else", id: "zf-else" }, el("b", { text: "What time it is for people elsewhere" }), el("ul", {}, elsewhere(ms, zone).map((x) => el("li", { text: x })))));
    }
    const go = el("button", { type: "button", class: "zf-go", id: "zf-save1", onclick: async () => {
      const bad = whenProblems(form, Date.now());
      if (bad.length) { msg.textContent = bad[0]; return; }
      go.disabled = true; msg.textContent = "Saving…";
      try {
        const z = form.zone === OTHER_ZONE ? form.zoneOther : form.zone, ms = wallToMs(form.date, form.time, z), name = gameName(form.occ, form.oname);
        const startRound = window.ZG.roundAt(ms);
        if (state.eid) await call("PATCH", `/api/z/${state.eid}/settings`, { name, startRound });
        else { const id = randId(); await call("POST", "/api/z", { id, name, startRound, callSeconds: G.callSeconds, cap: 10 }); state.eid = id; try { window.history.replaceState(null, "", location.pathname + "?flow=new&e=" + id); } catch {} }
        state.when = { ms, zone: z };
        done(1);
      } catch (e) { go.disabled = false; msg.textContent = e.message; }
    } }, "Save and continue");
    box.append(msg, go);
  };

  /* ---- Step 2 ---- */
  const who = { card: "people", upTo: 0, how: "self", idKind: "emp" };
  api.who = who;
  registry[2] = (box) => {
    if (!state.packs) { fetch(BASE + "/api/z/ai-manifest").then((r) => r.json()).then((j) => { state.packs = j.packs || []; draw(); }).catch(() => { state.packs = []; draw(); }); box.append(el("p", { text: "Loading the sizes…" })); return; }
    const choices = packChoices(state.packs);
    if (!who.upTo) who.upTo = choices[0].upTo; // the smallest size is already chosen for you
    if (G.idKind && state.raw && state.raw.idKind) who.idKind = idKindOf(state.raw.idKind); // what is saved wins
    const msg = el("p", { class: "zf-msg", role: "status", id: "zf-msg2" });
    box.append(el("p", { class: "zf-lead", text: "You choose who the game is for. The system takes care of the rest." }));
    const cards = el("div", { class: "zf-cards", role: "radiogroup", "aria-label": "Who is this game for" });
    for (const c of CARDS) cards.append(el("button", { type: "button", role: "radio", class: "zf-card" + (who.card === c.id ? " on" : ""), "aria-checked": String(who.card === c.id), "data-card": c.id, onclick: () => { who.card = c.id; draw(); } }, el("b", { text: c.name }), el("span", { text: c.line })));
    box.append(cards);
    box.append(el("p", { class: "zf-small", id: "zf-how", text: "Everybody waits for you. You let each person in from the Game dashboard." }));
    box.append(el("h3", { text: "How big is your game?" }));
    const sel = el("select", { id: "zf-size", "aria-label": "Size of your game", onchange: (e) => { who.upTo = Number(e.target.value); draw(); } });
    for (const k of choices) sel.append(el("option", { value: String(k.upTo), ...(who.upTo === k.upTo ? { selected: "" } : {}) }, k.label));
    box.append(sel);
    if (G.idKind) {
      box.append(el("h3", { text: "Which ID?" }), el("p", { class: "zf-small", text: "Your people are known to the system by one ID. Choose the one your list has." }));
      const ids = el("div", { class: "zf-chips", role: "radiogroup", "aria-label": "Which ID", id: "zf-idkind" });
      for (const k of ["emp", "email"]) ids.append(el("button", { type: "button", role: "radio", class: "zf-chip" + (who.idKind === k ? " on" : ""), "aria-checked": String(who.idKind === k), "data-idkind": k, onclick: () => { who.idKind = k; draw(); } }, ID_WORDS[k].choice));
      box.append(ids, el("p", { class: "zf-small", id: "zf-idhint", text: ID_WORDS[who.idKind].hint }));
    }
    const go = el("button", { type: "button", class: "zf-go", id: "zf-save2", onclick: async () => {
      const bad = whoProblems(who, choices);
      if (bad.length) { msg.textContent = bad[0]; return; }
      if (!state.eid) { msg.textContent = "Please save step 1 first."; return; }
      go.disabled = true; msg.textContent = "Saving…";
      try { await call("PATCH", `/api/z/${state.eid}/settings`, audienceSettings(who.card, who.upTo, G.idKind ? who.idKind : undefined)); done(2); }
      catch (e) { go.disabled = false; msg.textContent = e.message; }
    } }, "Save and continue");
    box.append(msg, go);
  };

  /* ---- Step 3 ---- */
  const prizes = { tix: 1, cur: "INR", sel: null, bumper: defaultBumper(), lucky: defaultBumper() };
  api.prizes = prizes;
  registry[3] = (box) => {
    const houses = housesOf(window.ZG);
    if (!prizes.sel) prizes.sel = defaultPrizes(houses); // the usual prizes are already ticked for you
    const msg = el("p", { class: "zf-msg", role: "status", id: "zf-msg3" });
    box.append(el("p", { class: "zf-lead", text: "Tick the prizes you want to give. Prizes are gifts." }));
    if (G.tickets.length > 1) box.append(el("h3", { text: "How many tickets does each participant get?" }));
    const tx = el("div", { class: "zf-chips", role: "radiogroup", "aria-label": "Tickets per participant" });
    for (const n of G.tickets) tx.append(el("button", { type: "button", role: "radio", class: "zf-chip" + (prizes.tix === n ? " on" : ""), "aria-checked": String(prizes.tix === n), "data-tix": String(n), onclick: () => { prizes.tix = n; draw(); } }, n + (n === 1 ? " ticket" : " tickets")));
    if (G.tickets.length > 1) box.append(tx);
    box.append(el("label", { for: "zf-cur", text: "Currency for “Worth up to” (it stays for every prize)" }));
    const cs = el("select", { id: "zf-cur", onchange: (e) => { prizes.cur = e.target.value; draw(); } });
    for (const c of CURRENCIES) cs.append(el("option", { value: c[0], ...(prizes.cur === c[0] ? { selected: "" } : {}) }, c[1].trim() + " " + c[0]));
    box.append(cs);
    const rowFor = (key, title, how, h, extra, maxN) => {
      const row = el("div", { class: "zf-prize" + (h.on ? " on" : ""), "data-house": key });
      const tags = extra ? [] : tagsOf(key);
      row.append(el("label", { class: "zf-tick" }, el("input", { type: "checkbox", id: "zf-tick-" + key, ...(h.on ? { checked: "" } : {}), onchange: (e) => { h.on = e.target.checked; draw(); } }), " ", el("b", { text: title }), tags.length ? el("span", { class: "zf-tag", text: " " + tags.join(" ") }) : null, el("small", { text: how })));
      if (h.on) {
        const nsel = el("select", { id: "zf-n-" + key, "aria-label": "How many times " + title + " can be won", onchange: (e) => { h.n = Number(e.target.value); draw(); } });
        for (let i = 1; i <= (extra ? 10 : maxN || 5); i++) nsel.append(el("option", { value: String(i), ...(h.n === i ? { selected: "" } : {}) }, String(i)));
        const gsel = el("select", { id: "zf-g-" + key, "aria-label": "The prize for " + title, onchange: (e) => { h.gift = e.target.value; draw(); } });
        for (const g of [...GIFTS, OTHER_GIFT]) gsel.append(el("option", { value: g, ...(h.gift === g ? { selected: "" } : {}) }, g));
        row.append(el("div", { class: "zf-fields" }, el("label", { for: "zf-n-" + key, text: "This prize can be won (times)" }), nsel, el("label", { for: "zf-g-" + key, text: "The prize" }), gsel,
          h.gift === OTHER_GIFT ? el("input", { type: "text", id: "zf-o-" + key, maxlength: "60", "aria-label": "Write the prize", value: h.other, oninput: (e) => { h.other = e.target.value; } }) : null,
          el("label", { for: "zf-w-" + key, text: "Worth up to (optional)" }), el("span", { class: "zf-money" }, symbolOf(prizes.cur) + " ", el("input", { type: "text", inputmode: "numeric", id: "zf-w-" + key, value: h.worth, oninput: (e) => { h.worth = e.target.value; } }))));
      }
      return row;
    };
    if (!houses.length) box.append(el("p", { class: "zf-small", text: "This game has no prizes to choose." }));
    const rowOfHouse = (h) => rowFor(h.id, h.label, h.how, prizes.sel[h.id] || (prizes.sel[h.id] = { on: false, n: 1, gift: GIFTS[0], other: "", worth: "" }), false, Math.min(5, Number(h.max) || 5));
    const moreHouses = houses.filter((h) => h.id === "unlucky");
    for (const h of houses.filter((x) => x.id !== "unlucky")) box.append(rowOfHouse(h));
    if (moreHouses.length || G.lucky) {
      box.append(el("h3", { text: "More prizes" }));
      for (const h of moreHouses) box.append(rowOfHouse(h));
      if (G.lucky) box.append(rowFor("lucky", "Lucky draw", "One or more tickets are picked at random. The organizer, Hosts and Co-hosts are never picked.", prizes.lucky, false, 5));
    }
    if (G.bumper && prizes.tix === 2) {
      box.append(el("h3", { text: "Two-ticket prizes" }));
      box.append(rowFor("bumper", "Super Bumper House", "Mark all 30 numbers of your two tickets together. Up to 10 winners.", prizes.bumper, true));
    }
    const go = el("button", { type: "button", class: "zf-go", id: "zf-save3", onclick: async () => {
      const bad = prizeProblems(prizes.sel, prizes.bumper, prizes.tix, houses);
      if (!bad.length && G.lucky && prizes.lucky.on && !prizeLine(prizes.lucky.gift, prizes.lucky.other, prizes.lucky.worth, "INR")) bad.push("Please write the prize for the Lucky draw.");
      if (bad.length) { msg.textContent = bad[0]; return; }
      if (!state.eid) { msg.textContent = "Please save step 1 first."; return; }
      go.disabled = true; msg.textContent = "Saving…";
      try { await call("PATCH", `/api/z/${state.eid}/settings`, { tickets: prizes.tix, rewards: buildRewards(prizes.sel, prizes.bumper, prizes.tix, prizes.cur), ...(G.lucky ? { breaks: buildBrandPatch(brandForm, prizes.tix).breaks.concat(luckyBreaks()) } : {}) }); done(3); }
      catch (e) { go.disabled = false; msg.textContent = e.message; }
    } }, "Save and continue");
    box.append(msg, go);
  };

  /* ---- Step 4 ---- */
  const brandForm = { brand: { name: "", color: "", logo: "" }, breaks: [] };
  api.brandForm = brandForm;
  /** Shrinks the chosen picture in the browser to at most 30 KB (same numbers as the current console and the game's own limits). */
  async function fitLogo(file) {
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("bad")); r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad")); i.src = url; });
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error("bad");
    if (Math.min(w0, h0) < 64) throw new Error("small");
    if (Math.max(w0, h0) > 4 * Math.min(w0, h0)) throw new Error("thin");
    const bytes = (d) => Math.ceil((d.length - d.indexOf(",") - 1) * 3 / 4);
    for (const side of [192, 144, 112, 80, 56]) {
      const k = Math.min(1, side / Math.max(w0, h0)), W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
      for (const [type, qual, white] of [["image/png", undefined, false], ["image/jpeg", 0.85, true], ["image/jpeg", 0.6, true]]) {
        const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); if (white) { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); } g.drawImage(img, 0, 0, W, H);
        const d = c.toDataURL(type, qual); if (d.startsWith("data:" + type) && bytes(d) <= 30720) return d;
      }
    }
    throw new Error("big");
  }
  const LOGO_WORDS = { small: "That picture is too small. Please use one at least 64 x 64 pixels.", thin: "That picture is too wide or too tall. Please use a square or slightly wide one.", big: "We could not make that picture small enough. Please try another one.", bad: "We could not read that picture. Please use a PNG, JPEG or WebP." };
  registry[4] = (box) => {
    const tix = prizes.tix, luckyOn = G.lucky && prizes.lucky.on, max = breakMax(tix, luckyOn), b = brandForm.brand;
    const msg = el("p", { class: "zf-msg", role: "status", id: "zf-msg4" });
    box.append(el("p", { class: "zf-lead", text: "This step is optional. Add your company name and message breaks, or skip it." }));
    box.append(el("h3", { text: "Your company" }));
    box.append(el("label", { for: "zf-bname", text: "Company name (optional)" }), el("input", { type: "text", id: "zf-bname", maxlength: "40", value: b.name, oninput: (e) => { b.name = e.target.value; } }));
    box.append(el("p", { class: "zf-small", text: "It appears on every ticket." }));
    const sw = el("div", { class: "zf-chips", role: "radiogroup", "aria-label": "Colour" });
    for (const c of BRAND_COLORS) sw.append(el("button", { type: "button", role: "radio", class: "zf-swatch" + (b.color === c ? " on" : ""), "aria-checked": String(b.color === c), "aria-label": "Colour " + c, style: "background:" + c, "data-color": c, onclick: () => { b.color = c; draw(); } }));
    box.append(el("label", { text: "Colour" }), sw);
    box.append(el("label", { for: "zf-blogo", text: "Small logo (optional)" }), el("input", { type: "file", id: "zf-blogo", accept: "image/png,image/jpeg,image/webp", onchange: async (e) => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      try { b.logo = await fitLogo(file); msg.textContent = "Logo added."; } catch (err) { b.logo = ""; msg.textContent = LOGO_WORDS[err.message] || LOGO_WORDS.bad; }
    } }));
    box.append(el("p", { class: "zf-small", text: "PNG, JPEG or WebP, at least 64 x 64 pixels. The system makes it small to fit." }));
    box.append(el("h3", { text: "Message breaks" }));
    box.append(el("p", { class: "zf-lead", text: "Show a message during the game. Paste one public link for each break. A YouTube link is best. You can add up to " + max + "." }));
    brandForm.breaks.length = Math.min(brandForm.breaks.length, max);
    brandForm.breaks.forEach((m, i) => {
      box.append(el("div", { class: "zf-break", "data-break": String(i) },
        el("label", { for: "zf-bt" + i, text: "Message break " + (i + 1) + " title (optional)" }), el("input", { type: "text", id: "zf-bt" + i, maxlength: "60", value: m.title, oninput: (e) => { m.title = e.target.value; } }),
        el("label", { for: "zf-bl" + i, text: "Public link" }), el("input", { type: "text", id: "zf-bl" + i, inputmode: "url", value: m.link, oninput: (e) => { m.link = e.target.value; } }),
        el("button", { type: "button", class: "zf-link", id: "zf-brm" + i, onclick: () => { brandForm.breaks.splice(i, 1); draw(); } }, "Remove")));
    });
    if (brandForm.breaks.length < max) box.append(el("button", { type: "button", class: "zf-add", id: "zf-badd", onclick: () => { brandForm.breaks.push({ title: "", link: "" }); draw(); } }, "Add a message break"));
    else box.append(el("p", { class: "zf-small", text: "That is the most you can add for a " + (tix === 2 ? "2-ticket" : "1-ticket") + " game." }));
    const save = async (skip) => {
      const bad = skip ? [] : [...brandProblems(b), ...breakProblems(brandForm.breaks, tix, luckyOn)];
      if (bad.length) { msg.textContent = bad[0]; return; }
      if (!state.eid) { msg.textContent = "Please save step 1 first."; return; }
      const cleaned = brandNameClean(b.name);
      msg.textContent = "Saving…";
      try {
        if (!skip) { const patch = buildBrandPatch(brandForm, tix); patch.breaks = patch.breaks.concat(luckyBreaks()); await call("PATCH", `/api/z/${state.eid}/settings`, patch); }
        if (!skip && cleaned !== String(b.name).trim()) b.name = cleaned;
        done(4);
      } catch (e) { msg.textContent = e.message; }
    };
    box.append(msg, el("button", { type: "button", class: "zf-go", id: "zf-save4", onclick: () => save(false) }, "Save and continue"), " ", el("button", { type: "button", class: "zf-link", id: "zf-skip4", onclick: () => save(true) }, "Skip this step"));
  };

  /* ---- Step 5: what your participants will see (the game's own ticket maker and the player page's own look, with sample numbers) ---- */
  const pv = { view: "mobile" };
  api.pv = pv;
  /** Sample tickets from the game's real ticket maker (ZG.ticketsFor). null if the game files are not loaded. */
  function sampleTickets(eid, tix) {
    try { const t = window.ZG && window.ZG.ticketsFor ? window.ZG.ticketsFor(eid || "SAMPLE", "sample-player", Number(tix) === 2 ? 2 : 1) : null; return Array.isArray(t) && t.length ? t : null; } catch { return null; }
  }
  function previewNode() {
    const tix = prizes.tix, tickets = sampleTickets(state.eid, tix), laptop = pv.view === "laptop";
    const box = el("div", { class: "zf-preview", id: "zf-preview" });
    const seg = el("div", { class: "zf-chips", role: "radiogroup", "aria-label": "Preview view" });
    for (const [v, t] of [["mobile", "Mobile view"], ["laptop", "Laptop view"]]) seg.append(el("button", { type: "button", role: "radio", class: "zf-chip" + (pv.view === v ? " on" : ""), "aria-checked": String(pv.view === v), "data-pv": v, onclick: () => { pv.view = v; draw(); } }, t));
    box.append(seg, el("p", { class: "zf-small", id: "zf-pvnote", text: "These are sample numbers. Your participants see their own tickets." }));
    const frame = el("div", { class: "zf-frame " + (laptop ? "laptop" : "mobile"), id: "zf-frame", "aria-label": "Preview of the participant page" });
    const b = brandForm.brand;
    frame.append(el("div", { class: "zf-pvhead" }, b.logo ? el("img", { src: b.logo, alt: "", height: "30" }) : null, el("b", { text: brandNameClean(b.name) || "Your company name" }), el("span", { text: "Game ID " + (state.eid || "") })));
    frame.append(el("p", { class: "zf-pvlast", text: "Last number: 47" }), el("p", { class: "zf-small", id: "zf-pvlast5", text: "Last 5 (newest first): 47, 21, 88, 5, 63" }));
    if (!tickets) frame.append(el("p", { class: "zf-small", text: "The sample tickets could not be made here." }));
    else tickets.forEach((t, i) => {
      const label = tix === 2 ? (i === 0 ? "Ticket A" : "Ticket B") : "Your ticket";
      const marked = new Set(t.flat().filter((v) => v !== null).slice(0, 4));
      const grid = el("div", { class: "zticket zf-pvticket", "aria-label": label, style: "grid-template-columns: repeat(" + (t[0] ? t[0].length : 9) + ", 1fr)" });
      for (const v of t.flat()) grid.append(v === null ? el("div", { class: "e" }) : el("div", { class: marked.has(v) ? "m" : "", text: String(v) }));
      frame.append(el("p", { class: "zf-pvlabel" }, el("b", { text: label }), " · Ticket number " + (101 + i) + " (sample)"), grid);
    });
    if (G.idKind) { const w = idWords(who.idKind); frame.append(el("label", { class: "zf-small", for: "zf-pvid", id: "zf-pvidlabel", text: w.join }), el("input", { type: "text", id: "zf-pvid", disabled: "" }), el("p", { class: "zf-small", id: "zf-pvidhint", text: w.hint })); }
    frame.append(el("label", { class: "zf-small", for: "zf-pvname", text: "Your name (optional)" }), el("input", { type: "text", id: "zf-pvname", disabled: "" }));
    const houses = housesOf(window.ZG), shown = buildRewards(prizes.sel || {}, prizes.bumper, tix, prizes.cur);
    const seen = new Set();
    const ul = el("ul", { class: "zf-pvprizes", id: "zf-pvprizes" });
    for (const r of shown) { const k = r.pattern + "|" + r.scope; if (seen.has(k)) continue; seen.add(k); ul.append(el("li", {}, el("span", { text: (r.scope === "two_ticket" ? "Super Bumper House" : (houses.find((h) => h.id === r.pattern) || {}).label || r.pattern) + ": " + r.text }), " ", el("button", { type: "button", class: "zf-add", disabled: "" }, "Claim"))); }
    frame.append(ul);
    if (laptop && G.board) frame.append(retroBoard([7, 14, 21, 28, 47])); // sample stamps
    box.append(frame);
    return box;
  }
  /* ---- Step 5 ---- */
  const pub = { email: "", phone: "" };
  try { pub.email = (window.CTK ? window.CTK.get("ctz-email") : sessionStorage.getItem("ctz-email")) || ""; } catch { /* the box starts empty */ }
  /** The terms boxes: three games draw them three ways (CBConsent.wire, CBConsent.load/bind, or the TermsBox). One adapter: draws kind K1 into `box`, keeps `btn` disabled until every box is ticked, and says what to send. */
  function mountConsent(box, btn) {
    const C = window.CBConsent;
    if (C && typeof C.load === "function") {
      const st = {}; let info = null;
      btn.disabled = true;
      C.load("K1", (p) => fetch(BASE + p).then((r) => r.json())).then((i) => { info = i; box.innerHTML = C.html(i, st); C.bind(box, i, st, btn); }).catch(() => { box.textContent = "The terms could not be loaded. Please try again."; });
      return { payload: () => (info ? C.payload(info, st) : null) };
    }
    if (C && typeof C.wire === "function") { box.innerHTML = C.html("K1"); C.wire(box, "K1", {}, btn); return { payload: () => C.payload(box, "K1") }; }
    if (window.TermsBox) { let tb = null; btn.disabled = true; window.TermsBox.mount(box, "K1", { base: BASE, btn }).then((x) => { tb = x; }); return { payload: () => (tb ? tb.terms() : null) }; }
    return { payload: () => null };
  }
  registry[5] = (box) => {
    const houses = housesOf(window.ZG), msg = el("p", { class: "zf-msg", role: "status", id: "zf-msg5" });
    const rewards = buildRewards(prizes.sel || {}, prizes.bumper, prizes.tix, prizes.cur);
    box.append(el("p", { class: "zf-lead", text: "Please check everything. You can go back to any step to change it." }));
    const list = el("dl", { class: "zf-read", id: "zf-read" });
    for (const [k, v] of readBack({ name: gameName(form.occ, form.oname), when: state.when, card: who.card, upTo: who.upTo, choices: packChoices(state.packs), tix: prizes.tix, rewards, houses, brand: brandForm.brand, breaks: brandForm.breaks })) list.append(el("dt", { text: k }), el("dd", { text: v }));
    box.append(list);
    { const w = startWarning(state.when ? state.when.ms : 0, Date.now()); if (w) box.append(el("div", { class: "zf-warn", id: "zf-startwarn" }, w)); }
    if (G.sample) box.append(el("h3", { text: "What your participants will see" }), previewNode());
    box.append(el("h3", { text: "Your contact" }));
    box.append(el("p", { class: "zf-small", text: "Only you see these. They are never shown to participants." }));
    box.append(el("label", { for: "zf-pemail", text: "Your email ID" }), el("input", { type: "email", id: "zf-pemail", autocomplete: "email", value: pub.email, oninput: (e) => { pub.email = e.target.value; } }));
    box.append(el("label", { for: "zf-pphone", text: "Your mobile number" }), el("input", { type: "tel", id: "zf-pphone", autocomplete: "tel", placeholder: "98765 43210", value: pub.phone, oninput: (e) => { pub.phone = e.target.value; } }));
    if (G.rehearsal) box.append(rehearsalPreview());
    const consent = el("div", { id: "zf-consent" });
    let ctl = null; // the terms ticks, whichever way this game draws them (see mountConsent)
    box.append(consent);
    const go = el("button", { type: "button", class: "zf-go", id: "zf-publish", "data-needs": "K1", onclick: async () => {
      const bad = contactProblems(pub.email, pub.phone);
      if (bad.length) { msg.textContent = bad[0]; return; }
      if (!state.eid) { msg.textContent = "Please save step 1 first."; return; }
      go.disabled = true; msg.textContent = "Publishing…";
      try {
        const pr = await call("POST", `/api/z/${state.eid}/publish`, { email: pub.email.trim(), phone: pub.phone, consent: ctl ? ctl.payload() || undefined : undefined });
        try { if (window.CTK) window.CTK.set("ctz-email", pub.email.trim()); else sessionStorage.setItem("ctz-email", pub.email.trim()); } catch { /* optional */ }
        state.info = { published: true, paid: !!(pr && pr.paid), payPage: pr && pr.payPage, shareUrl: pr && pr.shareUrl };
        done(5);
      } catch (e) { go.disabled = false; msg.textContent = e.message; }
    } }, "Publish");
    box.append(msg, go);
    ctl = mountConsent(consent, go); // Publish waits for the ticks
  };

  /* ---- Step 6: Pay. The page asks the console; the console asks Moneypenny. This page never talks to a payment company. ---- */
  const pay = { closed: false, q: null, loading: false, loaded: false, err: "", signIn: "", note: "", waiting: false, frame: null, link: "", busyBtn: "", timer: null };
  api.pay = pay;
  const payBase = () => consoleBase(G, location.search, location.hostname);
  async function payCall(method, path, body) {
    try {
      const r = await fetch(payBase() + path, { method, credentials: "include", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, j: (await r.json().catch(() => ({}))) || {} };
    } catch { return { status: 503, j: { ok: false, error: "busy", message: PAY.busy } }; }
  }
  const payAsk = () => ({ game: G.payGame, eid: state.eid, item: payItem(who.upTo, state.raw), ...(pay.q && pay.q.price && pay.q.price.credits ? { price: pay.q.price.credits } : {}) }); // price = what this screen showed: if the list moved, nothing is charged
  const payRedraw = () => { if (state.view === "steps" && state.open === 6) draw(); };
  async function payLoad() {
    if (pay.loading) return;
    pay.loading = true; pay.err = ""; pay.signIn = "";
    const a = payAsk();
    const r = await payCall("GET", "/pay/quote?game=" + encodeURIComponent(a.game) + "&eid=" + encodeURIComponent(a.eid) + "&item=" + encodeURIComponent(a.item));
    pay.loading = false; pay.loaded = true;
    pay.closed = r.j && r.j.error === "not_open"; // the console has not opened paying yet: the game's own pay link stays
    if (r.status === 200 && r.j.ok) { pay.q = r.j; if (r.j.paid) return payPaid(); if (r.j.waiting && !pay.waiting) payWatch(); } else { pay.q = null; pay.err = r.j.message || PAY.busy; pay.signIn = r.status === 401 ? (r.j.signIn || payBase()) : ""; }
    payRedraw();
  }
  /** The secure payment window opens ON TOP of this page (a frame), so nobody leaves the console. `frame` is the console's answer ({url, origin, opts, orderId}). The window says when it is ready, we hand it the order, and it hands back what happened. */
  let payListener = null;
  function payOverlay(frame) {
    payOverlayClose();
    if (!frame || !frame.url) return;
    pay.frame = frame;
    const iframe = el("iframe", { id: "zf-payiframe", title: PAY.frame, src: frame.url, allow: "payment" });
    const box = el("div", { id: "zf-payoverlay", class: "zf-payoverlay", role: "dialog", "aria-modal": "true", "aria-label": PAY.frame },
      el("div", { class: "zf-payframe" }, el("button", { type: "button", class: "zf-add", id: "zf-payclose", onclick: payOverlayClose }, PAY.close), iframe));
    document.body.append(box);
    let sent = false;
    payListener = async (ev) => {
      if (ev.source !== iframe.contentWindow || ev.origin !== frame.origin || !ev.data) return;
      const t = ev.data.t;
      if (t === "ready" && !sent) { sent = true; iframe.contentWindow.postMessage({ t: "open", opts: frame.opts }, frame.origin); }
      else if (t === "paid") { payOverlayClose(); pay.note = PAY.checking; payRedraw(); const a = payAsk(); const r = await payCall("POST", "/pay/confirm", { ...a, orderId: frame.orderId, resp: ev.data.resp }); if (r.j && r.j.paid) return payPaid(); pay.note = r.j.message || PAY.busy; payWatch(); payRedraw(); }
      else if (t === "failed") { payOverlayClose(); pay.note = PAY.notDone; payRedraw(); }
      else if (t === "dismissed") { payOverlayClose(); payRedraw(); }
    };
    window.addEventListener("message", payListener);
  }
  function payOverlayClose() { const o = document.getElementById("zf-payoverlay"); if (o) o.remove(); if (payListener) { window.removeEventListener("message", payListener); payListener = null; } }
  api.payOverlay = payOverlay;
  function payStop() { if (pay.timer) { clearInterval(pay.timer); pay.timer = null; } pay.waiting = false; }
  /** After Buy now: look at the game every 5 seconds (and ask the console every 15) until it is paid. */
  function payWatch() {
    payStop(); pay.waiting = true; let n = 0;
    pay.timer = setInterval(async () => {
      if (++n > 240) { payStop(); payRedraw(); return; }
      try { const i = await call("GET", `/api/z/${state.eid}/info`); if (i && i.unpaid === false) return payPaid(); } catch { /* the next look tries again */ }
      if (n % 3 === 0) { const r = await payCall("POST", "/pay/check", payAsk()); if (r.j && r.j.paid) return payPaid(); }
    }, 5000);
  }
  async function payPaid() { payStop(); payOverlayClose(); await refreshDash(); state.info = { ...(state.info || {}), published: true, paid: true }; state.done[6] = true; state.view = "steps"; state.open = 6; draw(); }
  async function payClick(which) {
    if (pay.busyBtn) return;
    pay.busyBtn = which; pay.note = ""; payRedraw();
    const a = payAsk();
    const r = await payCall("POST", which === "pay" ? "/pay/pay" : which === "buy" ? "/pay/buy" : "/pay/link", a);
    pay.busyBtn = "";
    if (which === "pay") {
      if (r.j && r.j.paid) return payPaid();
      pay.note = r.j.message || PAY.busy;
      if (r.j && r.j.pending) payWatch();
      if (r.status === 402) pay.loaded = false;
    } else if (which === "buy") {
      if (r.j && r.j.paid) return payPaid();
      if (r.j && r.j.ok && r.j.frame) { payOverlay(r.j.frame); payWatch(); }
      else pay.note = r.j.message || PAY.busy;
    } else {
      if (r.j && r.j.ok && r.j.url) { pay.link = r.j.url; const until = r.j.expiresMs ? " It works until " + new Date(r.j.expiresMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) + "." : ""; try { await navigator.clipboard.writeText(r.j.url); pay.note = PAY.link + until; } catch { pay.note = "Please copy the payment link by hand."; } }
      else pay.note = r.j.message || PAY.busy;
    }
    payRedraw();
  }
  registry[6] = (box) => {
    box.append(el("h3", { id: "zf-payh", text: PAY.title }));
    if (!G.payGame) { box.append(el("p", { class: "zf-msg", id: "zf-paynone", text: "Payment is not set up for this game yet." })); return; }
    const foot = () => box.append(el("p", { class: "zf-small", id: "zf-paynotes", text: PAY.notes }), el("p", { class: "zf-small", id: "zf-payprivacy", text: PAY.privacy }));
    if (state.info && state.info.paid) {
      box.append(el("div", { class: "zf-banner paid", id: "zf-paid", role: "status" }, PAY.paid), el("p", {}, el("button", { type: "button", class: "zf-go", id: "zf-paydash", onclick: () => done(6) }, "Open your Game dashboard")));
      foot(); return;
    }
    if (!pay.loaded && !pay.loading) payLoad();
    if (!pay.q) {
      if (pay.closed) { // flag off: the game's older pay link keeps working, and nothing here promises more
        const old = (state.info && state.info.payPage) || (state.raw && state.raw.payPage) || "";
        box.append(el("p", { class: "zf-msg", id: "zf-payclosed", role: "status", text: pay.err }));
        if (old) box.append(el("p", {}, el("a", { class: "zf-go", id: "zf-payold", href: old }, "Pay now")));
        box.append(el("p", {}, el("button", { type: "button", class: "zf-add", id: "zf-paydash", onclick: () => done(6) }, "Open your Game dashboard")));
        return;
      }
      if (pay.err) {
        box.append(el("div", { class: "zf-warn", id: "zf-payerr", role: "status" }, pay.err));
        const row = el("p", { class: "zf-btnrow" });
        if (pay.signIn) row.append(el("a", { class: "zf-go", id: "zf-paysignin", href: pay.signIn }, "Sign in to your console"), " ");
        row.append(el("button", { type: "button", class: "zf-add", id: "zf-payagain", onclick: () => { pay.loaded = false; pay.err = ""; draw(); } }, "Check again"));
        box.append(row);
      } else box.append(el("p", { class: "zf-small", id: "zf-payload", role: "status", text: "Checking your credits…" }));
      foot(); return;
    }
    const L = payLines(pay.q);
    box.append(el("dl", { class: "zf-read", id: "zf-payfigures" }, el("dt", { text: "Cost of this game" }), el("dd", { id: "zf-paycost", text: L.cost.replace("Cost of this game: ", "") }), el("dt", { text: "Your existing credits" }), el("dd", { id: "zf-payhave", text: L.have.replace("Your existing credits: ", "") })));
    if (L.need) box.append(el("p", { class: "zf-lead", id: "zf-payneed", text: L.need }));
    const row = el("p", { class: "zf-btnrow" });
    const dis = pay.busyBtn || pay.waiting ? { disabled: "" } : {};
    if (pay.q.enough) row.append(el("button", { type: "button", class: "zf-go", id: "zf-payprimary", ...dis, onclick: () => payClick("pay") }, L.primary));
    else row.append(el("button", { type: "button", class: "zf-go", id: "zf-buynow", ...dis, onclick: () => payClick("buy") }, L.primary), " ", el("button", { type: "button", class: "zf-add", id: "zf-copypay", ...(pay.busyBtn ? { disabled: "" } : {}), onclick: () => payClick("link") }, "Copy payment link"));
    box.append(row);
    if (pay.waiting) box.append(el("div", { class: "zf-warn", id: "zf-paywait", role: "status" }, PAY.waiting, pay.frame ? [" ", el("button", { type: "button", class: "zf-add", id: "zf-payopen", onclick: () => payOverlay(pay.frame) }, PAY.again)] : null));
    if (pay.link) box.append(el("label", { for: "zf-paylink", text: "Payment link" }), el("input", { type: "text", readonly: "", id: "zf-paylink", value: pay.link }));
    box.append(el("p", { class: "zf-msg", id: "zf-paynote", role: "status", text: pay.note }));
    if (!pay.q.enough) box.append(el("p", { class: "zf-small", id: "zf-payprint", text: PAY_PRINT }));
    foot();
  };

  /* ---- Game dashboard, Game ID bar, Host / Co-host pages ---- */
  const dash = { waiting: [], claims: [], note: "", loaded: false, facts: {}, notNow: [], inGame: [], called: [], prizes: [], seen: {}, pres: null, glog: null, reh: null, lockUntil: 0 };
  api.dash = dash;
  const originOf = () => (BASE || location.origin);
  const statusNow = () => statusOf(state.raw, dash.facts, Date.now());
  async function refreshDash() {
    if (!state.eid) return;
    try { const i = await call("GET", `/api/z/${state.eid}/info`); state.raw = i; state.info = { ...(state.info || {}), published: !i.draft, paid: !i.unpaid, startMs: i.startMs }; } catch { /* the last answer stays */ }
    try { dash.waiting = (await call("GET", `/api/z/${state.eid}/waiting`)).waiting || []; } catch { /* the last list stays */ }
    try { dash.claims = (await call("GET", `/api/z/${state.eid}/claims`)).claims || []; } catch { /* the last count stays */ }
    try { const l = await call("GET", `/api/z/${state.eid}/life`); dash.facts = { ...dash.facts, deleted: !!(l && l.purged), completed: !!(l && l.reportSent) }; } catch { /* no life answer: the time decides */ }
    if (G.handover) { try { dash.prizes = (await call("GET", `/api/z/${state.eid}/prizes`)).prizes || []; for (const p of dash.prizes) if (!(prizeKey(p) in dash.seen)) dash.seen[prizeKey(p)] = dash.loaded ? Date.now() : 0; } catch { /* the last list stays */ } }
    if (G.presence) { try { dash.pres = await call("GET", `/api/z/${state.eid}/presence`); } catch { /* the last count stays */ } }
    if (G.feed) { try { dash.glog = await call("GET", `/api/z/${state.eid}/gamelog`); } catch { /* the last log stays */ } }
    if (G.rehearsal) { try { dash.reh = await call("GET", `/api/z/${state.eid}/rehearsals`); } catch { /* the last cards stay */ } }
    dash.loaded = true;
    if (state.view === "dash") draw();
  }
  async function decide(w, decision) {
    try {
      await call("POST", `/api/z/${state.eid}/waiting/${encodeURIComponent(w.id)}`, { decision });
      dash.notNow = dash.notNow.filter((x) => x.id !== w.id); dash.inGame = dash.inGame.filter((x) => x.id !== w.id);
      if (decision === "admit") dash.inGame.push(w); else dash.notNow.push(w);
      dash.note = decision === "admit" ? "Let in." : "Not now. You can let them in later.";
    } catch (e) { dash.note = e.message; }
    await refreshDash();
  }
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); dash.note = what + " copied."; } catch { dash.note = "Please copy it by hand: " + text; }
    draw();
  }
  /** The bar at the top of every screen once the game exists: its Game ID (with Copy) and its status. */
  function idBar() {
    const st = statusNow(), S = STATUSES[st];
    const bar = el("div", { class: "zf-idbar", id: "zf-idbar" }, el("span", { class: "zf-idlabel", text: "Game ID" }), " ", el("b", { id: "zf-gameid", text: state.eid }), " ",
el("span", { class: "zf-pillstatus " + S.tone, id: "zf-status", "data-status": st, text: S.label }));
    return bar;
  }
  /* ---- Ready check, prizes handed over, feed, next-number controls, rehearsals, completed buttons ---- */
  const sharedKey = () => "zf-shared-" + state.eid;
  const isShared = () => { try { return localStorage.getItem(sharedKey()) === "1"; } catch { return !!dash.sharedLocal; } };
  function setShared(v) { dash.sharedLocal = v; try { localStorage.setItem(sharedKey(), v ? "1" : ""); } catch { /* kept for this visit */ } draw(); }
  function readyCard(st) {
    const items = readyItems({ shared: isShared(), status: st, prizesOk: prizesNamed(state.raw && state.raw.rewards), rehearsals: G.rehearsal ? (dash.reh && dash.reh.cards) || [] : null });
    const ok = readyAll(items);
    const card = el("section", { class: "zf-ready " + (ok ? "ok" : "todo"), id: "zf-ready", "aria-labelledby": "zf-rdh" }, el("h3", { id: "zf-rdh", text: ok ? "Ready: everything is in place." : "Ready check" }));
    const ul = el("ul", { class: "zf-readylist" });
    for (const i of items) {
      const li = el("li", { "data-ready": i.id, class: i.done ? "done" : "" });
      if (i.id === "link") li.append(el("label", {}, el("input", { type: "checkbox", id: "zf-shared", ...(i.done ? { checked: "" } : {}), onchange: (e) => setShared(e.target.checked) }), " ", i.label));
      else li.append(el("span", { class: "zf-tickmark", text: i.done ? "✓ " : "○ " }), i.label, ...(i.optional ? [el("i", { text: " (optional)" })] : []));
      ul.append(li);
    }
    card.append(ul);
    return card;
  }
  /** Prizes won, who won them (the ticket number, and the details that are held), and the "Prize handed over" tick. Organizer, Host and Co-host only. */
  function prizesBlock() {
    const rewards = (state.raw && state.raw.rewards) || [], c = prizeCounts(dash.prizes, rewards), houses = housesOf(window.ZG);
    const sec = el("section", { class: "zf-prizes", id: "zf-prizes" }, el("h3", { text: "Prizes" }), el("p", { id: "zf-prizecount", text: c.won + " won, " + c.left + " left" + (c.won ? " · " + c.given + " handed over" : "") }));
    if (!dash.prizes.length) { sec.append(el("p", { class: "zf-small", text: "No prize has been won yet." })); return sec; }
    const ul = el("ul", { class: "zf-prizelist" });
    for (const p of dash.prizes) {
      const label = (houses.find((h) => h.id === p.pattern) || {}).label || String(p.pattern);
      const li = el("li", { "data-prize": prizeKey(p) }, el("b", { text: label + (p.ordinal > 1 ? " (" + p.ordinal + ")" : "") }), " · Ticket number " + p.seat, el("div", { class: "zf-small", text: winnerDetails(p) }));
      li.append(el("label", { class: "zf-given" }, el("input", { type: "checkbox", ...(p.given ? { checked: "" } : {}), onchange: (e) => handOver(p, e.target.checked) }), " Prize handed over"));
      ul.append(li);
    }
    sec.append(ul);
    return sec;
  }
  async function handOver(p, given) {
    try { await call("POST", `/api/z/${state.eid}/prizegiven`, { round: p.round, pattern: p.pattern, ordinal: p.ordinal, seat: p.seat, given }); p.given = given; dash.note = given ? "Marked as handed over." : "Marked as not handed over."; }
    catch (e) { dash.note = e.message; }
    draw();
  }
  function feedBlock() {
    const lines = feedLines(dash.glog), sec = el("section", { class: "zf-feed", id: "zf-feed" }, el("h3", { text: "What is happening" }));
    if (!lines.length) sec.append(el("p", { class: "zf-small", text: "Nothing yet." }));
    else sec.append(el("ul", {}, lines.map((l) => el("li", { text: l }))));
    if (G.presence && dash.pres && dash.pres.listening != null) sec.append(el("p", { id: "zf-online", text: "Online now: about " + dash.pres.listening }));
    return sec;
  }
  /** Next number: the same control in TWO places (next to Last number called, and in the bottom row). Auto mode shows how numbers come; Manual mode shows the button. One press starts a 5-second lock on both. */
  function nextControl(where) {
    const manual = !!(state.raw && state.raw.callMode === "host"), left = Math.max(0, (dash.lockUntil || 0) - Date.now()), txt = nextControlText(manual ? "manual" : "auto", left);
    if (!manual) return el("span", { class: "zf-timer", id: "zf-next-" + where, text: txt });
    return el("button", { type: "button", class: "zf-go zf-nextnum" + (left > 0 ? " wait" : " ready"), id: "zf-next-" + where, ...(left > 0 ? { disabled: "" } : {}), onclick: () => pressNext() }, txt);
  }
  async function pressNext() {
    if (Date.now() < (dash.lockUntil || 0)) { dash.note = NEXT_TOAST; return draw(); }
    dash.lockUntil = Date.now() + NEXT_LOCK_MS; dash.note = ""; draw();
    const tick = () => { if (Date.now() < dash.lockUntil) setTimeout(() => { draw(); tick(); }, 1000); else draw(); };
    tick();
    try {
      const r = await window.TBControl.publish(state.eid, { token: secret(), base: BASE, prefix: "/api/z" }, "next");
      if (r && r.status !== 200) dash.note = (r.data && r.data.error) || "The next number could not be called. Please try again.";
    } catch (e) { dash.note = "The next number could not be called. Please try again."; }
    draw();
  }
  const REH_PENDING = "Payment is pending. Your rehearsals open as soon as the payment is done.";
  /** Step 5: the three rehearsal cards, shut until the game is published and paid. */
  function rehearsalPreview() {
    const sec = el("section", { class: "zf-reh", id: "zf-rehpreview", "aria-labelledby": "zf-rehph" }, el("h3", { id: "zf-rehph", text: "Practice before the real game" }));
    for (const n of [1, 2, 3]) sec.append(el("div", { class: "zf-rehcard grey", "data-reh": String(n) }, el("b", { text: "REHEARSAL GAME " + n }), el("p", { class: "zf-small", text: "Opens after you publish and pay" })));
    return sec;
  }
  function rehearsalBlock(st) {
    const cards = rehearsalCards(dash.reh), paid = LIVE_OR_DONE.includes(st), o = originOf();
    const sec = el("section", { class: "zf-reh", id: "zf-reh", "aria-labelledby": "zf-rehh" }, el("h3", { id: "zf-rehh", text: "Practice before the real game" }));
    for (const c of cards) {
      const card = el("div", { class: "zf-rehcard" + (c.state === "locked" || !paid ? " grey" : ""), "data-reh": String(c.n) }, el("b", { text: "REHEARSAL GAME " + c.n }));
      if (!paid) card.append(el("button", { type: "button", class: "zf-link", "data-reh-pending": String(c.n), onclick: () => { dash.rehPay = true; draw(); } }, "Opens after you publish and pay"));
      else if (c.state === "locked") card.append(el("p", { class: "zf-small", text: c.reason || REHEARSAL_LOCKED }));
      else if (c.state === "ready") card.append(el("p", { class: "zf-small", text: "A practice run of your game. Nothing here changes your real game." }), dash.rehAsk === c.n
        ? el("span", {}, el("button", { type: "button", class: "zf-go", "data-reh-go": String(c.n), onclick: () => startReh(c.n) }, "Yes, start the rehearsal"), " ", el("button", { type: "button", class: "zf-link", onclick: () => { dash.rehAsk = 0; draw(); } }, "No, not now"))
        : el("button", { type: "button", class: "zf-add", "data-reh-start": String(c.n), onclick: () => { dash.rehAsk = c.n; draw(); } }, "Start this rehearsal"));
      else if (c.state === "running") card.append(el("p", { class: "zf-small", text: "Rehearsal " + c.n + " is on." }), el("a", { class: "zf-add", href: "/zc.html?e=" + encodeURIComponent(c.id) }, "Open it"), " ", el("button", { type: "button", class: "zf-link", "data-reh-close": c.id, onclick: () => closeReh(c.id) }, "Close rehearsal"));
      else card.append(el("p", { class: "zf-small", text: "Done" }), el("a", { class: "zf-link", href: "/zc.html?e=" + encodeURIComponent(c.id) }, "See what happened"));
      card.append(el("p", { class: "zf-small", text: "Practice only, not your real game" }));
      sec.append(card);
    }
    if (!paid && dash.rehPay) sec.append(el("div", { class: "zf-warn", id: "zf-rehpay" }, REH_PENDING, " ", el("button", { type: "button", class: "zf-go", id: "zf-rehpaynow", onclick: () => openPay() }, "Pay now")));
    return sec;
  }
  async function startReh(n) {
    dash.rehAsk = 0;
    try { await call("POST", `/api/z/${state.eid}/rehearsal`, { people: "published" }); dash.note = "Rehearsal " + n + " started."; } catch (e) { dash.note = e.message; }
    await refreshDash();
  }
  async function closeReh(id) {
    try { await call("POST", `/api/z/${id}/rehearsalclose`, {}); } catch (e) { dash.note = e.message; }
    await refreshDash();
  }
  /** Make a copy: a new draft with this game's size, prizes and pace, opened on step 1 so the organizer picks the new date. */
  async function makeCopy() {
    const i = state.raw || {}, id = randId();
    try {
      await call("POST", "/api/z", { id, name: i.name, startRound: window.ZG.roundAt(Date.now() + 2 * 3600000), callSeconds: i.callSeconds || G.callSeconds, cap: i.cap || 10, tickets: i.tickets || 1, rewards: i.rewards || [] });
    } catch (e) { dash.note = e.message; return draw(); }
    state.eid = id; state.raw = null; state.info = null; state.done = {}; state.open = 1; state.view = "steps"; state.when = null; dash.waiting = []; dash.claims = []; dash.prizes = []; dash.facts = {};
    try { window.history.replaceState(null, "", location.pathname + "?flow=new&e=" + id); } catch { /* the address stays */ }
    draw();
  }
  function completedBlock() {
    const sec = el("section", { class: "zf-completed", id: "zf-completed" }, el("h3", { text: "Your game is complete" }), el("p", { class: "zf-small", id: "zf-keepnote", text: COMPLETED_NOTE }));
    sec.append(el("p", {}, el("button", { type: "button", class: "zf-add", id: "zf-copygame", onclick: () => makeCopy() }, "Make a copy")));
    return sec;
  }
  /** The share card: Game ID, game link and the ways to send it. Hosts and Co-hosts use this same link. */
  function shareCard(o, eid, name) {
    const link = gameLink(o, eid), msg = shareMessage(name, link, eid);
    const wa = ["https:", "", "wa.me", ""].join("/") + "?text=" + encodeURIComponent(msg); // opened by the person's own tap
    return el("section", { class: "zf-sharecard", id: "zf-sharecard", "aria-labelledby": "zf-sh" },
      el("h2", { id: "zf-sh", text: "Share this game link with your participants." }),
      el("p", {}, el("span", { class: "zf-idlabel", text: "Game ID " }), el("b", { id: "zf-shareid", text: eid })),
      el("label", { for: "zf-link", text: "Game link for participants" }), el("input", { type: "text", readonly: "", id: "zf-link", value: link }),
      el("p", { class: "zf-btnrow" }, el("button", { type: "button", class: "zf-go", id: "zf-copylink", onclick: () => copy(link, "Game link") }, "Copy game link"), " ",
        el("button", { type: "button", class: "zf-add", id: "zf-copymsg", onclick: () => copy(msg, "Message") }, "Copy a message to share"), " ",
        el("a", { class: "zf-add", id: "zf-whatsapp", href: wa, target: "_blank", rel: "noopener" }, "Share on WhatsApp")),
      el("p", { class: "zf-msgbox", id: "zf-sharemsg", text: msg }),
      el("p", { class: "zf-small", text: "Hosts and Co-hosts use this same link." }));
  }
  /** "Pay now" on the dashboard opens step 6 (the one pay step of every game). */
  function openPay() { pay.loaded = false; pay.q = null; state.view = "steps"; state.open = 6; draw(); scrollTo("zf-sec6"); }
  /** Payment: a pill (Pending amber, Done green, Free game green), the buttons while it is pending, and the small print. */
  function paymentBlock(st, o, eid) {
    const pill = st === "free" ? ["Free game", "green"] : st === "pending" || st === "overdue" ? ["Pending", "amber"] : ["Done", "green"];
    const sec = el("section", { class: "zf-pay", id: "zf-pay" }, el("h3", {}, "Payment ", el("span", { class: "zf-pillstatus " + pill[1], id: "zf-paypill", text: pill[0] })));
    if (st === "pending" || st === "overdue") {
      sec.append(el("button", { type: "button", class: "zf-go", id: "zf-paynow", onclick: () => openPay() }, "Pay now"), el("p", { class: "zf-small", id: "zf-payprint", text: PAY_PRINT }));
      if (st === "overdue") sec.append(el("p", {}, el("a", { class: "zf-add", id: "zf-changedate", href: "/zc.html?e=" + encodeURIComponent(eid) }, "Change the date"), " ", el("a", { class: "zf-add", id: "zf-cancelgame", href: "/zc.html?e=" + encodeURIComponent(eid) }, "Cancel this game")));
    }
    return sec;
  }
  /** Waiting for you: one table, a column only when a participant gave that detail; Let in / Not now; then the grey Not now list and the green list. */
  function waitingBlock() {
    const sec = el("section", { class: "zf-waitsec", id: "zf-waitsec" }, el("h3", { text: "Waiting for you to let them in the game" }));
    const rows = dash.waiting;
    if (!rows.length) sec.append(el("p", { id: "zf-nowait", text: "Nobody is waiting right now." }));
    else {
      const cols = waitColumns(rows), wrap = el("div", { class: "zf-tablewrap" }), table = el("table", { class: "zf-table amber", id: "zf-wait" });
      table.append(el("thead", {}, el("tr", {}, cols.map((c) => el("th", { scope: "col", text: c.label })), el("th", { scope: "col", text: "" }))));
      const tb = el("tbody");
      for (const w of rows) tb.append(el("tr", { "data-wid": String(w.id) }, cols.map((c) => el("td", { "data-label": c.label, text: c.get(w) || "—" })), el("td", {}, el("button", { type: "button", class: "zf-add", "data-decide": "admit", onclick: () => decide(w, "admit") }, "Let in"), " ", el("button", { type: "button", class: "zf-link", "data-decide": "decline", onclick: () => decide(w, "decline") }, "Not now"))));
      table.append(tb); wrap.append(table); sec.append(wrap);
      sec.append(el("button", { type: "button", class: "zf-add", id: "zf-letall", onclick: async () => { try { await call("POST", `/api/z/${state.eid}/waiting/all`, { decision: "admit" }); for (const w of rows) dash.inGame.push(w); dash.note = "Everybody was let in."; } catch (e) { dash.note = e.message; } await refreshDash(); } }, "Let everyone in"));
    }
    if (dash.notNow.length) {
      sec.append(el("h3", { text: "Not now" }));
      const ul = el("ul", { class: "zf-list grey", id: "zf-notnow" });
      for (const w of dash.notNow) ul.append(el("li", { "data-wid": String(w.id) }, el("span", { text: waitLabel(w) }), " ", el("button", { type: "button", class: "zf-add", "data-decide": "admit", onclick: () => decide(w, "admit") }, "Let in")));
      sec.append(ul);
    }
    if (dash.inGame.length) {
      sec.append(el("h3", { text: "In the game" }));
      const ul = el("ul", { class: "zf-list green", id: "zf-ingame" });
      for (const w of dash.inGame) ul.append(el("li", { "data-wid": String(w.id), text: waitLabel(w) }));
      sec.append(ul);
    }
    return sec;
  }
  /** The retro game board: a cream card with a double red border, round numbered discs, called numbers stamped red, a gold ball for the last number. */
  function retroBoard(called, opts) {
    const board = el("section", { class: "zf-retro", id: "zf-retro", "aria-label": "Game board" });
    board.append(el("h3", { class: "zf-retro-title", text: "★ " + G.boardTitle + " ★" }), el("p", { class: "zf-small", text: "close group online corporate " + G.boardTitle.toLowerCase() }));
    const got = new Set(called), last = called.length ? called[called.length - 1] : 0;
    const ctl = opts && opts.control ? nextControl("top") : null;
    if (ctl) board.append(el("div", { class: "zf-lastline" }, el("span", { text: "Last number called" }), ctl));
    board.append(el("div", { class: "zf-ball", id: "zf-ball", text: last ? String(last) : "–" }));
    const grid = el("div", { class: "zf-discs", id: "zf-discs", style: "grid-template-columns: repeat(" + G.boardCols + ", 1fr)" });
    for (let n = 1; n <= G.boardMax; n++) grid.append(el("span", { class: "zf-disc" + (got.has(n) ? " called" : ""), "data-n": String(n), text: String(n) }));
    board.append(grid, el("p", { class: "zf-small", id: "zf-calledcount", text: called.length ? called.length + " numbers called" : "No number called yet." }));
    return board;
  }
  /** The Game dashboard (organizer and Host); a Co-host sees the Co-host page: the same share card, waiting table, tickets claimed and board, and cannot change anything. */
  function dashboard() {
    const o = originOf(), eid = state.eid, name = gameName(form.occ, form.oname), st = statusNow();
    const startText = state.when ? clockIn(state.when.ms, state.when.zone) : (state.info && state.info.startMs ? clockIn(state.info.startMs, "Asia/Kolkata") + " India time" : "the start time");
    const sec = el("section", { class: "zf-sec open zf-dashboard", id: "zf-dashboard", "aria-labelledby": "zf-hd" }, el("h2", { id: "zf-hd", text: COPY.dash }));
    const bn = statusBanner(st, startText);
    const gone = st === "cancelled" || st === "refund" || st === "deleted" || st === "draft";
    if (!gone) sec.append(shareCard(o, eid, name)); // 1 the share card, at the very top
    sec.append(el("div", { class: "zf-banner " + bn.kind, id: "zf-banner", "aria-live": "polite" }, bn.text)); // 2 the status banner
    if (st === "cancelled") sec.append(el("p", {}, el("button", { type: "button", class: "zf-add", id: "zf-copygame", onclick: () => makeCopy() }, "Make a copy")));
    if (gone) { sec.append(el("p", { class: "zf-msg", role: "status", id: "zf-dashnote", text: st === "deleted" ? "" : dash.note })); return sec; }
    sec.append(readyCard(st)); // 3 the Ready check
    sec.append(paymentBlock(st, o, eid)); // 4 payment
    if (G.rehearsal) sec.append(rehearsalBlock(st)); // 5 rehearsals
    sec.append(waitingBlock()); // 6 waiting for you
    if (G.claims) sec.append(el("h3", { text: "Tickets claimed" }), el("p", { id: "zf-claimed", text: String(claimedCount(dash.claims)) })); // 7 tickets claimed
    if (G.presence && dash.pres && dash.pres.listening != null) sec.append(el("p", { id: "zf-online", text: "Online now: about " + dash.pres.listening }));
    const playing = st === "live" || st === "paused", withControl = G.control && playing;
    const last = dash.prizes.length ? dash.prizes[dash.prizes.length - 1] : null;
    if (G.handover && last) { const houses = housesOf(window.ZG), label = (houses.find((h) => h.id === last.pattern) || {}).label || String(last.pattern); sec.append(el("div", { class: "zf-claimline", id: "zf-claim", "aria-live": "polite" }, claimLine(last, label, dash.seen[prizeKey(last)], Date.now()))); }
    if (G.board) sec.append(retroBoard(dash.called || [], { control: withControl })); // 8 the retro board
    const row = el("div", { class: "zf-bottomrow", id: "zf-bottomrow" });
    if (withControl) row.append(nextControl("bottom"), " ");
    row.append(el("a", { class: "zf-add", id: "zf-board", href: boardLink(o, eid), target: "_blank", rel: "noopener" }, "Big screen"));
    if (st === "paid" || st === "free" || st === "live" || st === "paused") row.append(" ", el("a", { class: "zf-add", id: "zf-play", href: gameLink(o, eid), target: "_blank", rel: "noopener" }, "Play the game")); // the organizer and Hosts can play too
    sec.append(row);
    if (G.handover) sec.append(prizesBlock());
    if (G.feed) sec.append(feedBlock()); // 9 what is happening
    if (st === "completed") sec.append(completedBlock());
    sec.append(el("p", { class: "zf-small", id: "zf-report", text: REPORT_NOTE })); // 10 report reminder
    sec.append(el("p", { class: "zf-msg", role: "status", id: "zf-dashnote", text: dash.note }));
    return sec;
  }

  api.pressNext = pressNext;
  api.state = state; api.draw = draw; api.done = done; api.el = el;
  document.title = "Organizer console | " + G.brand;
  draw();
  if (state.eid && secret()) { call("GET", `/api/z/${state.eid}/info`).then((i) => { if (i && !i.draft && i.startMs) { state.raw = i; state.info = { published: true, paid: !i.unpaid, startMs: i.startMs }; for (const s of STEPS) state.done[s.n] = true; state.view = "dash"; draw(); refreshDash(); } }).catch(() => {}); }
})();
