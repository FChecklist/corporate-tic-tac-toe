/* First-party visit tracking for our PUBLIC pages only (home, legal pages, partner page, sign-in, payment entry). Read apps/edge/src/visits.ts for what the server keeps.
   Never runs in the game (play, z, zc, big, screen, report): the page list below is the whole list. No names, no mobile numbers, no page query string is ever sent.
   Global Privacy Control / Do Not Track: no visitor id is made or stored, and the server only adds to anonymous counters.
   Events are batched: sent every ~15 s, when the page is hidden, and straight away for the key actions; at most 20 per message. */
(function () {
  var path = (location.pathname || "/").toLowerCase().replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
  if (",/,/legal,/terms,/dpa,/subprocessors,/partner-terms,/organizer-guide,/partner,/signin,/pay,".indexOf("," + path + ",") < 0) return;
  if (window.TBV) return;
  var nav = navigator, doc = document, MAX_PAGE_EVENTS = 150, BATCH = 20;
  var gpc = nav.globalPrivacyControl === true || nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.msDoNotTrack === "1";
  function rnd(n) { var a = new Uint8Array(n); (window.crypto || crypto).getRandomValues(a); var s = ""; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16); return s; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  var vid = "", sid = "", fresh = true;
  if (!gpc) {
    var m = (doc.cookie || "").match(/(?:^|;\s*)cbv=([a-f0-9]{32})(?:;|$)/);
    vid = ls("cbv_id") || (m && m[1]) || "";
    if (!/^[a-f0-9]{32}$/.test(vid)) vid = rnd(16);
    ls("cbv_id", vid);
    try { doc.cookie = "cbv=" + vid + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) {}
    // one session = one browsing visit: it ends after 30 minutes of nothing
    var last = Number(ss("cbv_t") || 0), now0 = Date.now();
    sid = ss("cbv_sid") || "";
    if (/^[a-f0-9]{24}$/.test(sid) && now0 - last < 30 * 60000) fresh = ss("cbv_sent") !== "1"; else { sid = rnd(12); ss("cbv_sid", sid); ss("cbv_sent", ""); }
    ss("cbv_t", String(now0));
  } else sid = rnd(12);
  window.TBV = { vid: vid, sid: sid, gpc: gpc };

  var q = [], total = 0, sections = {}, inView = [], curSec = "", maxScroll = 0, visSince = Date.now(), visMs = 0, exits = 0;
  function push(e) { if (total >= MAX_PAGE_EVENTS) return; e.p = path; q.push(e); total++; if (q.length >= BATCH) flush(); }
  function send(body) {
    var t = JSON.stringify(body);
    try { if (nav.sendBeacon && nav.sendBeacon("/api/v/b", new Blob([t], { type: "text/plain" }))) return; } catch (e) {}
    try { fetch("/api/v/b", { method: "POST", body: t, keepalive: true, headers: { "content-type": "text/plain" } }).catch(function () {}); } catch (e) {}
  }
  function flush() {
    collect();
    while (q.length) {
      var b = { s: sid, g: gpc ? 1 : 0, dv: innerWidth < 700 ? "mobile" : innerWidth < 1100 ? "tablet" : "desktop", l: (nav.language || "").slice(0, 12), e: q.splice(0, BATCH) };
      if (!gpc) b.d = vid;
      if (fresh) { // what only the first message of a visit needs: where it came from
        b.lp = path; fresh = false; ss("cbv_sent", "1");
        try { b.r = doc.referrer ? new URL(doc.referrer).hostname : ""; } catch (e) { b.r = ""; }
        var sp = new URLSearchParams(location.search);
        b.u = { s: sp.get("utm_source") || "", m: sp.get("utm_medium") || "", c: sp.get("utm_campaign") || "" };
        var pc = sp.get("ref") || ""; if (/^[A-Za-z2-9]{8}$/.test(pc)) b.pc = pc;
      }
      send(b);
    }
  }
  // ---- sections: which parts of the page were really on screen, and for how long ----
  function nameOf(el) { return (el.getAttribute("data-sec") || el.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24); }
  function touch(name, on) {
    var s = sections[name] || (sections[name] = { since: 0, total: 0, sent: 0, told: false });
    var t = Date.now();
    if (on && !s.since) s.since = t; else if (!on && s.since) { s.total += t - s.since; s.since = 0; }
  }
  function collect() { // turns the running clocks into events (only what is new since the last message)
    var t = Date.now();
    Object.keys(sections).forEach(function (n) {
      var s = sections[n]; if (s.since) { s.total += t - s.since; s.since = t; }
      if (s.total > s.sent || (!s.told && s.viewed)) { push2({ k: "sec", n: n, m: s.total - s.sent }); s.sent = s.total; s.told = true; }
    });
  }
  function push2(e) { if (total >= MAX_PAGE_EVENTS) return; e.p = path; q.push(e); total++; }
  function start() {
    var els = doc.querySelectorAll("[data-sec], header[id], main section[id], section[id], footer[id]"), seen = {};
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var n = nameOf(en.target); if (!n) return;
          var big = en.rootBounds ? en.intersectionRect.height >= en.rootBounds.height * 0.4 : false;
          var on = en.isIntersecting && (en.intersectionRatio >= 0.35 || big);
          var s = sections[n] || (sections[n] = { since: 0, total: 0, sent: 0, told: false });
          if (on) { s.viewed = true; curSec = n; if (inView.indexOf(n) < 0) inView.push(n); } else { var i = inView.indexOf(n); if (i >= 0) inView.splice(i, 1); }
          if (document.visibilityState !== "hidden") touch(n, on); else if (!on) touch(n, false);
        });
      }, { threshold: [0, 0.2, 0.35, 0.5, 0.75, 1] });
      for (var i = 0; i < els.length; i++) { var n = nameOf(els[i]); if (n && !seen[n]) { seen[n] = 1; io.observe(els[i]); } }
    }
    push({ k: "pv" });
    var sc = function () { var h = Math.max(doc.documentElement.scrollHeight, 1), y = (window.scrollY || window.pageYOffset || 0) + innerHeight; maxScroll = Math.max(maxScroll, Math.min(100, Math.round((y / h) * 100))); };
    sc(); addEventListener("scroll", sc, { passive: true });
    setInterval(function () { if (doc.visibilityState !== "hidden") flush(); }, 15000);
  }
  function exitNow() {
    if (!visSince && exits > 0) { flush(); return; } // already counted when the page was hidden
    var t = Date.now(); if (visSince) { visMs += t - visSince; visSince = 0; }
    Object.keys(sections).forEach(function (n) { touch(n, false); });
    if (exits < 3) { exits++; push2({ k: "exit", n: inView.length ? inView[inView.length - 1] : curSec, m: visMs, x: maxScroll }); }
    flush();
  }
  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") exitNow();
    else { visSince = Date.now(); inView.forEach(function (n) { touch(n, true); }); }
  });
  addEventListener("pagehide", exitNow);

  // ---- actions: the choices a visitor makes (a handful of named ones; the server drops anything else) ----
  function shown() { var t = doc.querySelector(".pcard .tot"), m = t && t.textContent.replace(/,/g, "").match(/(₹|US\$)\s*([\d.]+)/); return m ? (m[1] === "₹" ? "INR " : "USD ") + m[2] : ""; }
  function act(n, size, v, now) { push({ k: "act", n: n, z: size, v: v }); if (now) flush(); }
  doc.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var c = t.closest("[data-buy]");
    if (c) return act("create", +c.getAttribute("data-buy") || 0, shown(), true);
    if (t.closest("#payBtn")) { var p = doc.getElementById("pack"); return act("create", p ? +p.value || 0 : 0, shown(), true); }
    var cu = t.closest("[data-c]"); if (cu) return act("cur", null, cu.getAttribute("data-c"), false);
    if (t.closest("#loginLink")) return act("signin_open", null, "", true);
    var a = t.closest("a[href]"); if (!a) return;
    var h = a.getAttribute("href") || "";
    if (h.indexOf("/partner") === 0) act("partner_click", null, "", false);
    else if (t.closest(".fl") && h.indexOf("/") === 0) act("legal_click", null, h.replace(/[?#].*$/, "").slice(0, 40), false);
  });
  doc.addEventListener("change", function (e) {
    var t = e.target; if (!t || (t.id !== "pack" && t.id !== "pack2")) return;
    var size = +t.value || 0;
    setTimeout(function () { act("pack", size, shown(), false); }, 0); // after the page has redrawn the price card
  });
  doc.addEventListener("submit", function (e) {
    var id = e.target && e.target.id;
    if (id === "frForm") act("start_submit", null, "", true); else if (id === "lgForm") act("signin_submit", null, "", true);
  }, true);

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
  window.TBV.flush = flush;
})();
