// Game pack: THE LIVE CONTROL BAR of Step 9 (Game day). The same in every game. It is drawn from what the game says it can do; it holds no game rules.
//   mountRunBar(host, game) -> { update(state), el }
// game.can      = { start, pause, resume, extend, end, announce, bigScreen, board, results, log, changes }  (booleans: a button exists ONLY if its flag is true)
// game.do       = { start(), pause(), resume(), extend(), end(), announce(text) }                         (async functions the game supplies)
// game.links    = { bigScreen, board, results, log, changes }                                              (addresses; used for the link buttons)
// state         = { phase: "waiting" | "running" | "paused" | "finished", story, joined, waiting, paused: { who, when, restarts }, prizes: [{ id, name, seat, given }] }
// game.givePrize(id, bool) is optional; the tick "Prize given" shows only when it exists.
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(root); else root.CTPack = Object.assign(root.CTPack || {}, factory(root)); })(typeof self !== "undefined" ? self : this, function (root) {
  var MESSAGES = ["Please take your seats. We start in a minute.", "We are taking a short break.", "Please check your screen.", "Thank you all for joining.", "The game will restart shortly.", "Please stay on this page."];
  var MAX_LINE = 160;

  function mountRunBar(host, game) {
    var doc = host.ownerDocument || document;
    var confirmPanel = (root.CTPack && root.CTPack.confirmPanel) || null;
    function h(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function btn(label, cls, onclick) { var b = h("button", "ctp-btn" + (cls ? " " + cls : ""), label); b.type = "button"; b.addEventListener("click", onclick); return b; }
    function link(label, href) { var a = h("a", "ctp-btn", label); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }
    var el = h("section", "ctp-runbar"); el.setAttribute("aria-label", "Game controls");
    host.append(el);
    var busy = false;
    async function run(fn) { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }

    function update(s) {
      var can = game.can || {}, dos = game.do || {}, links = game.links || {};
      while (el.firstChild) el.removeChild(el.firstChild);
      el.dataset.phase = s.phase;
      if (s.phase === "paused") {
        var ban = h("div", "ctp-paused"); ban.setAttribute("role", "status");
        var who = (s.paused && s.paused.who) ? " by " + s.paused.who : "", when = (s.paused && s.paused.when) ? " at " + s.paused.when : "";
        ban.append(h("b", "", "PAUSED"), h("span", "", "Game paused" + who + when + ". " + ((s.paused && s.paused.restarts) ? "It restarts " + s.paused.restarts + "." : "It restarts soon.")));
        el.append(ban);
      }
      el.append(h("p", "ctp-story", s.story || ""));
      // ONE primary button, chosen by the state
      var primary = null;
      if (s.phase === "waiting" && can.start) primary = ["Start", dos.start];
      else if (s.phase === "running" && can.pause) primary = ["Pause", dos.pause];
      else if (s.phase === "paused" && can.resume) primary = ["Resume", dos.resume];
      if (primary && primary[1]) el.append(btn(primary[0], "ctp-primary", function () { run(primary[1]); }));
      // small buttons: only those the game really has, and only while the game is not over
      var small = h("div", "ctp-small");
      if (s.phase !== "finished") {
        if (can.extend && dos.extend) small.append(btn("Add 30 more minutes", "", function () { run(dos.extend); }));
        if (can.end && dos.end) small.append(btn("End the game", "ctp-danger", function () { run(async function () { if (confirmPanel && !(await confirmPanel(el, "End the game now? This cannot be undone.", "Yes, end it", "No"))) return; await dos.end(); }); }));
        if (can.announce && dos.announce) small.append(btn("Message to everyone", "", function () { openMessage(); }));
      }
      if (can.bigScreen && links.bigScreen) small.append(link("Big screen", links.bigScreen));
      if (can.board && links.board) small.append(link("Board page", links.board));
      if (small.children.length) el.append(small);
      if (s.joined != null || s.waiting != null) el.append(h("p", "ctp-people", "Joined " + (s.joined || 0) + ", waiting " + (s.waiting || 0)));
      // prizes won
      if (Array.isArray(s.prizes) && s.prizes.length) {
        var ul = h("ul", "ctp-prizes");
        s.prizes.forEach(function (p) {
          var li = h("li", "", p.name + (p.seat != null ? " - seat " + p.seat : " - not won yet"));
          if (p.seat != null && game.givePrize) { var lab = h("label", "ctp-tick"), cb = doc.createElement("input"); cb.type = "checkbox"; cb.checked = !!p.given; cb.addEventListener("change", function () { run(function () { return game.givePrize(p.id, cb.checked); }); }); lab.append(cb, doc.createTextNode(" Prize given")); li.append(lab); }
          ul.append(li);
        });
        el.append(ul);
      }
      var foot = h("div", "ctp-small");
      if (can.results && links.results) foot.append(link("Download results (CSV)", links.results));
      if (can.changes && links.changes) foot.append(link("What changed", links.changes));
      if (can.log && links.log) foot.append(link("Game log", links.log));
      if (foot.children.length) el.append(foot);
    }

    function openMessage() {
      var old = el.querySelector(".ctp-message"); if (old) { old.remove(); return; }
      var box = h("div", "ctp-message");
      var row = h("div", "ctp-small");
      MESSAGES.forEach(function (m) { row.append(btn(m, "", function () { send(m); })); });
      var line = doc.createElement("input"); line.type = "text"; line.maxLength = MAX_LINE; line.setAttribute("aria-label", "Your own message (up to " + MAX_LINE + " letters)"); line.setAttribute("data-ct-skip", "1");
      var go = btn("Send", "ctp-primary", function () { var t = line.value.trim(); if (t) send(t.slice(0, MAX_LINE)); });
      function send(text) { run(async function () { await game.do.announce(text); box.remove(); }); }
      box.append(row, line, go); el.append(box);
    }
    return { update: update, el: el };
  }
  return { mountRunBar: mountRunBar, MESSAGES: MESSAGES, MAX_LINE: MAX_LINE };
});
