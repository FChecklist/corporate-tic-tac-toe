/* Back soon: while the owner has switched the site off, every address answers 503 {maintenance:true} (src/admin.ts). The first such answer a page gets puts a plain cover over it.
   Static pages are served by Cloudflare itself and never reach the Worker, so a page that makes no call keeps showing its own text. */
(function () {
  var f = window.fetch; if (!f) return;
  function cover() {
    if (document.getElementById("back-soon") || !document.body) return;
    var d = document.createElement("div"); d.id = "back-soon"; d.setAttribute("role", "alert");
    d.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#fff;color:#14213d;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:18px/1.5 system-ui,sans-serif";
    var b = document.createElement("div"), h = document.createElement("h1"), p = document.createElement("p");
    h.textContent = "Back soon"; h.style.cssText = "margin:0 0 8px;font-size:28px"; p.textContent = "We are making a small change. Please try again in a few minutes."; p.style.margin = "0";
    b.appendChild(h); b.appendChild(p); d.appendChild(b); document.body.appendChild(d);
  }
  window.fetch = function () {
    return f.apply(this, arguments).then(function (r) {
      if (r && r.status === 503) { try { r.clone().json().then(function (j) { if (j && j.maintenance === true) cover(); }, function () {}); } catch (e) {} }
      return r;
    });
  };
})();
/* Opening soon (TT-01): while the service is in its test period, the three pages a stranger reads before signing in (home, sign-in, pricing) say so in one calm line,
   so nobody waits for a sign-in code that is not e-mailed yet. Read-only call to /api/mode; no notice in LIVE, and none on the phone page, big screen or payment page. */
(function () {
  if (!/^\/(index\.html|signin(\.html)?|pricing(\.html)?)?$/.test(location.pathname) || !window.fetch) return;
  function show() {
    if (document.getElementById("opening-soon") || !document.body) return;
    var d = document.createElement("div"); d.id = "opening-soon"; d.setAttribute("role", "status");
    d.style.cssText = "background:#fff4d6;color:#4a3500;border-bottom:1px solid #e8c766;padding:10px 16px;text-align:center;font:15px/1.45 system-ui,sans-serif";
    d.textContent = "Opening soon. Corporate Tic Tac Toe is still being tested, so sign-in codes are not e-mailed to guests yet. Please come back when we open.";
    document.body.insertBefore(d, document.body.firstChild);
  }
  function check() { window.fetch("/api/mode", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (m) { if (m && m.mode === "TEST") show(); }, function () {}); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check); else check();
})();
/* Tiny first-party monitoring: page views, speed (Core Web Vitals), JavaScript errors, failed and slow API calls.
   No cookies, no IP address, no query string, no personal data. Sent to /api/telemetry on our own domain. */
(function () {
  if (!navigator.sendBeacon || !window.PerformanceObserver) return;
  var q = [], sent = 0, MAX = 30, lcp = 0, cls = 0, inp = 0, done = false;
  function push(k, n, v, d) { if (sent + q.length >= MAX) return; q.push({ k: k, p: location.pathname, n: n || "", v: v == null ? null : Math.round(v * 1000) / 1000, d: d ? String(d).slice(0, 200) : "" }); }
  function flush() { if (!q.length) return; var b = JSON.stringify({ e: q }); sent += q.length; q = []; try { navigator.sendBeacon("/api/telemetry", new Blob([b], { type: "application/json" })); } catch (e) {} }
  var ref = ""; try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
  push("pv", "", null, ref + "|" + (innerWidth < 700 ? "mobile" : innerWidth < 1100 ? "tablet" : "desktop"));
  function obs(type, cb, opt) { try { var o = new PerformanceObserver(function (l) { l.getEntries().forEach(cb); }); o.observe(Object.assign({ type: type, buffered: true }, opt || {})); } catch (e) {} }
  obs("largest-contentful-paint", function (e) { lcp = e.startTime; });
  obs("layout-shift", function (e) { if (!e.hadRecentInput) cls += e.value; });
  obs("event", function (e) { if (e.interactionId && e.duration > inp) inp = e.duration; }, { durationThreshold: 40 });
  function vitals() {
    if (done) return; done = true;
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav) { push("vital", "TTFB", nav.responseStart); push("vital", "LOAD", nav.loadEventEnd || nav.domComplete); }
    var fcp = performance.getEntriesByName("first-contentful-paint")[0]; if (fcp) push("vital", "FCP", fcp.startTime);
    if (lcp) push("vital", "LCP", lcp); push("vital", "CLS", cls); if (inp) push("vital", "INP", inp);
  }
  addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { vitals(); flush(); } });
  addEventListener("pagehide", function () { vitals(); flush(); });
  addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) push("res", "load-failed", null, (t.src || t.href).replace(location.origin, "").split("?")[0]);
    else push("err", "js", null, (e.message || "error") + " @" + String(e.filename || "").replace(location.origin, "") + ":" + (e.lineno || 0));
  }, true);
  addEventListener("unhandledrejection", function (e) { push("err", "promise", null, e.reason && (e.reason.message || e.reason)); });
  var f = window.fetch;
  if (f) window.fetch = function (input) {
    var url = typeof input === "string" ? input : (input && input.url) || "", path = url.replace(location.origin, "").split("?")[0], t0 = performance.now();
    var track = path.indexOf("/api/") === 0 && path.indexOf("/api/telemetry") !== 0;
    var p = f.apply(this, arguments);
    if (!track) return p;
    return p.then(function (r) { var ms = performance.now() - t0; if (r.status >= 500) push("api", path, ms, "http " + r.status); else if (ms > 8000) push("api", path, ms, "slow"); return r; },
      function (err) { var ms = performance.now() - t0; push("api", path, ms, err && err.name === "AbortError" ? "timeout" : "network"); throw err; });
  };
  setTimeout(function () { if (document.readyState === "complete") { vitals(); flush(); } }, 15000);
})();
