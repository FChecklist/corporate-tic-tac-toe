/* The flight recorder. It runs on the visitor's own phone or laptop, in that device's memory, and costs our server nothing until something goes wrong.
   It keeps the last 40 things that happened (a tap on a control, a page change, a call to our API and how it ended, going offline, the game moving from one stage to the next).
   When an error happens it builds ONE complete report on the device (what failed, where, on which game and stage, what kind of device, the trail of the last actions)
   and sends it once, in the background, to /api/blackbox. If the phone is offline the report waits on the device and goes the next time the page opens.
   NEVER recorded: typed text, names, phone numbers, e-mail addresses, the text on any button, query strings, keys or tokens. Anything that looks like one is replaced by a label before it is kept. */
(function () {
  if (window.__bb || !window.addEventListener) return;
  const QKEY = "ctz-bbq"; // the one thing this script may keep on the device: reports waiting for the phone to be online (listed in apps/web/storage-registry.json and on the Privacy page)
  var MAX_TRAIL = 40, MAX_REPORTS = 6, MAX_BYTES = 14000, SLOW_MS = 8000;
  var trail = [], seen = {}, made = 0, errorsInGame = 0, offlineSince = 0, offlineMs = 0, T0 = Date.now(), PHASE = "", GAME = "", releaseP = null, gameEnded = false;
  var rf = window.fetch, hasStore = (function () { try { return typeof localStorage.length === "number"; } catch (e) { return false; } })();

  /** Takes anything that could identify a person or open a door out of a piece of text. */
  function scrub(s, n) {
    s = String(s == null ? "" : s);
    s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
      .replace(/([?&#;](?:t|token|key|k|code|me|pid|hk|ck|auth|sig)=)[^&\s#;"')]*/gi, "$1[x]")
      .replace(/\b[0-9a-f]{20,}\b/gi, "[key]")
      .replace(/\b[A-Za-z0-9_-]{30,}\b/g, "[key]")
      .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
    return s.slice(0, n || 300);
  }
  function path(u) { try { u = String(u).split("#")[0].split("?")[0].replace(location.origin, ""); } catch (e) { u = ""; } return scrub(u.replace(/\/[0-9a-f]{16,}/gi, "/[id]").replace(/\/j\/[^/]+/, "/j/[id]"), 120); }
  function add(t, d) { trail.push({ s: Math.round((Date.now() - T0) / 100) / 10, t: t, d: d }); if (trail.length > MAX_TRAIL) trail.shift(); }

  var qs = (function () { try { return new URLSearchParams(location.search); } catch (e) { return null; } })();
  var P = location.pathname.replace(/\.html$/, "").replace(/^\//, "") || "home";
  var ROLE = { z: "player", zc: "console", big: "big screen", pay: "pay page", paylink: "pay link", signin: "sign in", demo: "demo", preview: "preview", home: "home" }[P] || "page";
  if (P === "z" || P === "zc" || P === "big") { var g = (qs && qs.get("e")) || location.hash.replace(/^#/, ""); if (/^[A-Za-z0-9_-]{4,40}$/.test(g || "")) GAME = g; }

  // ---- the trail: only the kind of thing that was touched, never what was typed or written on it
  function who(el) {
    try {
      while (el && el !== document.body && !(el.id || (el.getAttribute && (el.getAttribute("data-ck") || el.getAttribute("data-save") || el.getAttribute("data-act") || el.getAttribute("data-buy") || el.tagName === "A" || el.tagName === "BUTTON")))) el = el.parentNode;
      if (!el || !el.tagName) return "";
      var a = function (n) { return el.getAttribute(n); }, bits = [el.tagName.toLowerCase()];
      if (el.id) bits.push("#" + scrub(el.id, 40));
      ["data-ck", "data-v", "data-save", "data-act", "data-buy"].forEach(function (n) { if (a(n) != null && !/^\d{6,}$/.test(a(n))) bits.push(n.slice(5) + "=" + scrub(a(n), 30)); });
      if (el.tagName === "A" && a("href")) bits.push("->" + path(a("href")));
      return bits.join(" ");
    } catch (e) { return ""; }
  }
  document.addEventListener("click", function (e) { var w = who(e.target); if (w) add("tap", w); }, true);
  document.addEventListener("change", function (e) { var w = who(e.target); if (w) add("change", w); }, true); // which control changed, never its value
  addEventListener("online", function () { if (offlineSince) { offlineMs += Date.now() - offlineSince; offlineSince = 0; } add("net", "online"); flushQueue(); });
  addEventListener("offline", function () { offlineSince = Date.now(); add("net", "offline"); });
  document.addEventListener("visibilitychange", function () { add("page", document.visibilityState); });
  addEventListener("pagehide", function () { add("page", "closed"); });
  if (!navigator.onLine) offlineSince = Date.now();
  add("page", "opened " + (P === "home" ? "/" : "/" + P) + (GAME ? " game " + GAME : ""));

  // ---- the game stage, handed over by the game screens (z.js calls this each time it paints)
  var lastKey = "";
  window.ctzView = function (v) {
    try {
      if (!v) return;
      var ph = String(v.phase || ""), key = [ph, v.locked ? "L" : "", v.paused ? "P" : "", v.stopped ? "S" : "", v.brk ? "B" : "", v.late ? "late" : ""].join("|");
      PHASE = ph + (v.paused ? " (paused)" : v.locked ? " (waiting to start)" : v.brk ? " (brand break)" : "");
      if (key !== lastKey) { lastKey = key; add("stage", PHASE + (v.log ? ", calls so far " + (v.log.length || 0) : "")); }
      if (ph === "ended" && !gameEnded) { gameEnded = true; endSummary(v); }
    } catch (e) { /* the recorder must never disturb the game */ }
  };
  window.ctzMark = function (name, data) { try { var d = ""; if (data && typeof data === "object") d = Object.keys(data).slice(0, 4).map(function (k) { var x = data[k]; return k + "=" + (typeof x === "number" || typeof x === "boolean" ? x : scrub(x, 30)); }).join(" "); add("mark", scrub(name, 40) + (d ? " " + d : "")); } catch (e) {} };

  // ---- the device (reduced: browser family, system family, sizes; never the full user-agent string)
  function device() {
    var ua = navigator.userAgent || "", m, b = "other", o = "other";
    if ((m = /(Edg|OPR|SamsungBrowser|Firefox|CriOS|FxiOS)\/(\d+)/.exec(ua))) b = ({ Edg: "Edge", OPR: "Opera", SamsungBrowser: "Samsung Internet", Firefox: "Firefox", CriOS: "Chrome iOS", FxiOS: "Firefox iOS" })[m[1]] + " " + m[2];
    else if ((m = /Chrome\/(\d+)/.exec(ua))) b = "Chrome " + m[1]; else if ((m = /Version\/(\d+).*Safari/.exec(ua))) b = "Safari " + m[1];
    if (/Android (\d+)/.test(ua)) o = "Android " + RegExp.$1; else if (/(iPhone|iPad).*OS (\d+)/.test(ua)) o = "iOS " + RegExp.$2; else if (/Windows NT/.test(ua)) o = "Windows"; else if (/Mac OS X/.test(ua)) o = "macOS"; else if (/Linux/.test(ua)) o = "Linux";
    var c = navigator.connection || {};
    return { browser: b, os: o, view: innerWidth + "x" + innerHeight, dpr: window.devicePixelRatio || 1, lang: String(navigator.language || "").slice(0, 10), tz: new Date().getTimezoneOffset(), online: navigator.onLine, net: c.effectiveType || "", saveData: !!c.saveData, mem: navigator.deviceMemory || null, cores: navigator.hardwareConcurrency || null,
      app: !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches), worker: !!(navigator.serviceWorker && navigator.serviceWorker.controller), visible: document.visibilityState };
  }
  function release() { if (!releaseP) releaseP = rf ? rf.call(window, "/version.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { return String((j && j.commit) || "").slice(0, 12); }, function () { return ""; }) : Promise.resolve(""); return releaseP; }
  function hash(s) { var h = 5381, i; for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  // ---- making and sending a report
  function report(kind, sev, msg, stack, extra) {
    try {
      msg = scrub(msg, 300); stack = scrub(stack, 1800);
      var frame = (/(?:at |@)\s*\(?([^\s()]+:\d+)/.exec(stack) || [])[1] || "", fp = hash(kind + "|" + P + "|" + msg.replace(/\d+/g, "N").slice(0, 90) + "|" + String(frame).replace(/\d+$/, ""));
      if (seen[fp] || made >= MAX_REPORTS) return; seen[fp] = 1; made++;
      if (sev === "error") errorsInGame++;
      var r = { v: 1, id: hash(String(Math.random()) + Date.now()) + hash(fp + Date.now()), fp: fp, ts: Date.now(), after: Math.round((Date.now() - T0) / 1000), kind: kind, sev: sev, msg: msg, stack: stack, page: "/" + (P === "home" ? "" : P), role: ROLE, game: GAME, stage: PHASE, dev: device(), trail: trail.slice(), x: extra || null, rel: "" };
      release().then(function (rel) { r.rel = rel; send(r); });
    } catch (e) { /* never break the page */ }
  }
  function send(r) {
    var body = JSON.stringify(r);
    while (body.length > MAX_BYTES && r.trail.length > 5) { r.trail.shift(); body = JSON.stringify(r); }
    if (body.length > MAX_BYTES) { r.stack = r.stack.slice(0, 600); body = JSON.stringify(r); }
    if (!navigator.onLine) return queue(body);
    var ok = false;
    try { ok = navigator.sendBeacon && navigator.sendBeacon("/api/blackbox", new Blob([body], { type: "application/json" })); } catch (e) {}
    if (!ok) queue(body);
  }
  function queue(body) { if (!hasStore) return; try { var q = JSON.parse(localStorage.getItem(QKEY) || "[]"); q.push(body); localStorage.setItem(QKEY, JSON.stringify(q.slice(-8))); } catch (e) {} }
  function flushQueue() {
    if (!hasStore || !navigator.onLine) return;
    try { var q = JSON.parse(localStorage.getItem(QKEY) || "[]"); if (!q.length) return; localStorage.removeItem(QKEY); q.forEach(function (b) { var ok = false; try { ok = navigator.sendBeacon && navigator.sendBeacon("/api/blackbox", new Blob([b], { type: "application/json" })); } catch (e) {} if (!ok) queue(b); }); } catch (e) {}
  }
  function endSummary(v) { // a device that had errors during this game, and one device in twenty that had none, tells how the game went from its own side
    if (!errorsInGame && Math.random() > 0.05) return;
    report("game-end", errorsInGame ? "warn" : "info", "game ended on this device: " + errorsInGame + " error(s)", "", { calls: v && v.log ? v.log.length : 0, offlineSec: Math.round((offlineMs + (offlineSince ? Date.now() - offlineSince : 0)) / 1000), openSec: Math.round((Date.now() - T0) / 1000) });
  }

  // ---- what counts as an error
  addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) { add("fail", "file " + path(t.src || t.href)); report("file", "error", "a file did not load: " + path(t.src || t.href), ""); }
    else { add("fail", "script error"); report("script", "error", e.message || "error", (e.error && e.error.stack) || ((e.filename || "") + ":" + (e.lineno || 0) + ":" + (e.colno || 0))); }
  }, true);
  addEventListener("unhandledrejection", function (e) { var r = e.reason; add("fail", "unhandled promise"); report("promise", "error", (r && (r.message || r)) || "promise rejected", r && r.stack); });
  var ce = console.error;
  console.error = function () { try { var m = Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === "object" ? "[object]" : String(a); }).join(" "); add("console", scrub(m, 100)); report("console", "error", m, ""); } catch (e) {} return ce.apply(console, arguments); };
  if (rf) window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "", p = path(url), m = String((init && init.method) || (input && input.method) || "GET").toUpperCase(), t0 = Date.now(), mine = p.indexOf("/api/blackbox") === 0 || p.indexOf("/api/telemetry") === 0 || p.indexOf("/version.json") === 0;
    var pr = rf.apply(this, arguments);
    if (mine) return pr;
    return pr.then(function (r) {
      var ms = Date.now() - t0; add("call", m + " " + p + " " + r.status + " " + ms + "ms");
      if (r.status >= 500) { try { r.clone().json().then(function (j) { report("server", "error", "server error " + r.status + " on " + m + " " + p + (j && j.code ? " (" + j.code + ")" : ""), "", { code: j && j.code, message: j && scrub(j.error, 160), ms: ms }); }, function () { report("server", "error", "server error " + r.status + " on " + m + " " + p, "", { ms: ms }); }); } catch (e) {} }
      else if (r.status === 403 && m === "GET" && /^\/api\/z\/[^/]+\/info/.test(p)) { /* a game that is not published yet: an expected answer, the screen says so in words */ }
      else if (r.status >= 400 && r.status !== 404 && r.status !== 409) report("refused", "warn", "refused " + r.status + " on " + m + " " + p, "", { ms: ms });
      else if (ms > SLOW_MS) report("slow", "warn", "slow call (" + Math.round(ms / 1000) + " s) " + m + " " + p, "", { ms: ms });
      return r;
    }, function (err) { var ms = Date.now() - t0; add("call", m + " " + p + " FAILED " + ms + "ms"); report("network", navigator.onLine ? "error" : "warn", (err && err.name === "AbortError" ? "call timed out " : "call did not reach the server ") + m + " " + p, err && err.stack, { ms: ms, online: navigator.onLine }); throw err; });
  };

  window.__bb = { scrub: scrub, trail: function () { return trail.slice(); }, report: report, flushQueue: flushQueue };
  setTimeout(flushQueue, 4000);
})();
