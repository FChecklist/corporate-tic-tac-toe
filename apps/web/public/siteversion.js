/* Footer line "Version 1.5.0 | released 30 Oct 2026, 14:05 IST": reads the small /version.json that the build writes. Without it the page keeps the plain "Version" text. */
(function () {
  var VERSION = "1.5.0", els = [].slice.call(document.querySelectorAll("[data-version]"));
  if (!els.length || !window.fetch) return;
  fetch("/version.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
    if (!v || !v.builtAt) return;
    var t = new Date(v.builtAt); if (isNaN(t)) return;
    var s = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(t).replace(",", "");
    els.forEach(function (e) { e.textContent = "Version " + VERSION + " | released " + s + " IST"; });
  }).catch(function () { /* keep the plain text */ });
})();
