// Game pack: ONE Yes / No panel used instead of the browser's own confirm() box. Built without innerHTML. No game rules in here.
// confirmPanel(host, text, yes?, no?) shows the panel inside `host` and resolves true on Yes, false on No (or on Escape).
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CTPack = Object.assign(root.CTPack || {}, factory()); })(typeof self !== "undefined" ? self : this, function () {
  function confirmPanel(host, text, yes, no) {
    var doc = host.ownerDocument || document;
    return new Promise(function (done) {
      var panel = doc.createElement("div"); panel.className = "ctp-confirm"; panel.setAttribute("role", "alertdialog"); panel.setAttribute("aria-label", text);
      var p = doc.createElement("p"); p.textContent = text;
      var row = doc.createElement("div"); row.className = "ctp-btns";
      var n = doc.createElement("button"); n.type = "button"; n.className = "ctp-btn"; n.textContent = no || "No";
      var y = doc.createElement("button"); y.type = "button"; y.className = "ctp-btn ctp-danger"; y.textContent = yes || "Yes";
      function close(v) { panel.remove(); done(v); }
      n.addEventListener("click", function () { close(false); }); y.addEventListener("click", function () { close(true); });
      panel.addEventListener("keydown", function (e) { if (e.key === "Escape") close(false); });
      row.append(n, y); panel.append(p, row); host.append(panel); n.focus();
    });
  }
  return { confirmPanel: confirmPanel };
});
