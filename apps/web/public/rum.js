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
