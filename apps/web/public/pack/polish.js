// Game pack: small safety nets every game console page shares. No game rules in here.
//  - markDirty / window.__ctDirty: set while the person has typed something that is not saved yet. A page's auto-update must not reload while it is true,
//    and leaving the page asks first (only when it is true).
//  - TIMEOUT_SENTENCE and withTimeout(): a request that gets no answer in 40 seconds ends with one plain sentence, not a stuck screen.
//  - showEmail(): the signed-in e-mail at the top of the page (text only).
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CTPack = Object.assign(root.CTPack || {}, factory()); })(typeof self !== "undefined" ? self : this, function () {
  var TIMEOUT_MS = 40000;
  var TIMEOUT_SENTENCE = "We could not reach the service. Please check your internet and try again.";

  /** call once per page: from now on typing in any field marks the page as having unsaved work; saved() clears it */
  function watchUnsaved(win) {
    win = win || window; var doc = win.document;
    win.__ctDirty = false;
    ["input", "change"].forEach(function (ev) { doc.addEventListener(ev, function (e) { var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.hasAttribute("data-ct-skip")) win.__ctDirty = true; }, true); });
    win.addEventListener("beforeunload", function (e) { if (win.__ctDirty) { e.preventDefault(); e.returnValue = ""; return ""; } });
    return { saved: function () { win.__ctDirty = false; }, dirty: function () { return !!win.__ctDirty; } };
  }

  /** fetchFn(url, init) with a 40 second limit; on silence it rejects with Error(TIMEOUT_SENTENCE) */
  function withTimeout(fetchFn, ms) {
    ms = ms || TIMEOUT_MS;
    return function (url, init) {
      var ctl = typeof AbortController === "function" ? new AbortController() : null, timer;
      var limit = new Promise(function (_, rej) { timer = setTimeout(function () { if (ctl) ctl.abort(); rej(new Error(TIMEOUT_SENTENCE)); }, ms); });
      var call = Promise.resolve(fetchFn(url, Object.assign({}, init || {}, ctl ? { signal: ctl.signal } : {}))).catch(function (e) { throw e && e.name === "AbortError" ? new Error(TIMEOUT_SENTENCE) : e; });
      return Promise.race([call, limit]).finally(function () { clearTimeout(timer); });
    };
  }

  function showEmail(host, email) {
    var doc = host.ownerDocument || document;
    var old = host.querySelector(".ctp-email"); if (old) old.remove();
    if (!email) return null;
    var s = doc.createElement("span"); s.className = "ctp-email"; s.textContent = String(email); host.append(s); return s;
  }
  return { watchUnsaved: watchUnsaved, withTimeout: withTimeout, showEmail: showEmail, TIMEOUT_SENTENCE: TIMEOUT_SENTENCE, TIMEOUT_MS: TIMEOUT_MS };
});
