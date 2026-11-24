// Game pack: the printable Game log page. A plain list of TIME + one SENTENCE (+ a seat number where there is one). Nothing else is ever shown:
// a row's name, e-mail, mobile or any other field is never read, so it cannot appear. Everything is written with textContent (no markup from the game is ever interpreted).
// renderLog(host, rows, { title })  rows = [{ ts, text, seat? }]     -> returns the number of lines shown
// The game's own small script sets window.CTLogLoad = async () => rows ; this file then draws the page by itself.
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(root); else root.CTPack = Object.assign(root.CTPack || {}, factory(root)); })(typeof self !== "undefined" ? self : this, function (root) {
  var IST = { timeZone: "Asia/Kolkata" };
  function when(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString("en-GB", Object.assign({ day: "numeric", month: "short" }, IST)) + ", " + d.toLocaleTimeString("en-US", Object.assign({ hour: "numeric", minute: "2-digit", second: "2-digit" }, IST)) + " IST";
  }
  function renderLog(host, rows, opts) {
    var doc = host.ownerDocument || document;
    while (host.firstChild) host.removeChild(host.firstChild);
    var h1 = doc.createElement("h1"); h1.textContent = (opts && opts.title) || "Game log"; host.append(h1);
    var list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && typeof r.text === "string" && Number.isFinite(r.ts); }).sort(function (a, b) { return a.ts - b.ts; });
    if (!list.length) { var p = doc.createElement("p"); p.className = "ctp-none"; p.textContent = "Nothing has happened in this game yet."; host.append(p); return 0; }
    var ol = doc.createElement("ol"); ol.className = "ctp-log";
    list.forEach(function (r) {
      var li = doc.createElement("li"), t = doc.createElement("time"), s = doc.createElement("span");
      t.textContent = when(r.ts); s.textContent = r.text + (Number.isInteger(r.seat) ? " (seat " + r.seat + ")" : "");
      li.append(t, doc.createTextNode(" "), s); ol.append(li);
    });
    host.append(ol);
    return list.length;
  }
  function boot() {
    var doc = root.document; if (!doc || typeof root.CTLogLoad !== "function") return;
    var host = doc.getElementById("ctp-log-host"); if (!host) return;
    root.CTLogLoad().then(function (rows) {
      renderLog(host, rows);
      var b = doc.createElement("button"); b.type = "button"; b.className = "ctp-btn"; b.textContent = "Print or save"; b.addEventListener("click", function () { root.print(); }); host.append(b);
    }).catch(function () { host.textContent = "We could not load the game log. Please try again."; });
  }
  if (root.document && root.document.readyState !== "loading") setTimeout(boot, 0); else if (root.document) root.document.addEventListener("DOMContentLoaded", boot);
  return { renderLog: renderLog };
});
