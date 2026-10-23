/* Corporate Tic Tac Toe: always the newest version. Every 45 seconds (and whenever the page comes back to the front) the page asks /version.json what is live.
   When it has changed since this page loaded, the page clears its saved copy and reloads itself, so nobody keeps working on old code. It never reloads
   while a person is typing in a box (it waits until the box is empty or left), and never more than once for the same version, so it cannot loop. */
(function () {
  if (window.__ctAuto) return;
  window.__ctAuto = true;
  var EVERY = 45000, loaded = null, timer = 0;
  function sig(j) { return j ? [j.commit, j.builtAt, j.rev].join("|") : ""; }
  function get() { return fetch("/version.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(sig).catch(function () { return ""; }); }
  function typing() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || "").toLowerCase();
    if (tag === "textarea" || a.isContentEditable) return !!(a.value || a.textContent);
    return tag === "input" && /^(text|email|tel|search|url|number|password|)$/i.test(a.type || "") && !!a.value;
  }
  function clear() {
    if (!window.caches) return Promise.resolve();
    return caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return /^(ct-game-|tb-app-)/.test(k); }).map(function (k) { return caches.delete(k); })); }).catch(function () {});
  }
  // A phone or number screen in the middle of a running game is never reloaded (a reload could cost a prize claim): it updates when the game is over, before it starts, or when the page is in the background.
  function inRunningGame() {
    if (!/^\/(z|big|board|screen)(\.html)?$/.test(location.pathname) || document.hidden) return false;
    try { if (window.__rt && window.__rt.view) return window.__rt.view().phase === "play" && window.__rt.view().log.length > 0; } catch (e) { return true; }
    try { if (window.__big) return (window.__big.logs && (window.__big.logs[window.__big.round] || []).length > 0) && !window.__big.dns; } catch (e) { return true; }
    return false;
  }
  function check() {
    get().then(function (now) {
      if (!now) return;
      if (loaded === null) { loaded = now; return; }
      if (now === loaded || typing() || inRunningGame()) return;
      var done = ""; try { done = sessionStorage.getItem("ct-auto-done") || ""; } catch (e) {}
      if (done === now) return;
      try { sessionStorage.setItem("ct-auto-done", now); } catch (e) {}
      clear().then(function () { location.reload(); });
    });
  }
  function start() { check(); timer = setInterval(check, EVERY); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  window.__ctAutoCheck = check; // for tests
  start();
})();
