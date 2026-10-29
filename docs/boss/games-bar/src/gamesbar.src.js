/*! Corporate Games bar v__V__ - one shared navigation for every Corporate Games site. Canonical copy: C:\ct\test-sites\corporate-games-bar (do not edit a site's copy; edit here and copy). */
/* What it does: puts a slim bar at the very top of the page with every Corporate game, each shown by its own badge (ticket or board art)
   and its proper name under a small CORPORATE line. The game of the current site is marked (aria-current="page").
   Laptop (900px and wider): one row, everything visible, no scrollbar. Phone: the Corporate Games mark, the current game, and an
   "All games" button that opens a sheet with big badges. Plain links only: nothing is sent anywhere, no outside file is loaded,
   no inline script or style is used (CSP-safe). Which game is current: the script tag's data-game attribute if present
   (tambola, bingo, tictactoe, snakes, luck, draw, home), otherwise the web address. */
(function () {
  "use strict";
  if (document.querySelector(".cgb")) return;
  var VERSION = "__V__";
  var HOME = "https://home.corporatetambola.com/";
  var GAMES = [
    { id: "tambola", name: "Tambola", url: "https://housie.corporatetambola.com/", badge: "cgb-tambola" },
    { id: "bingo", name: "Bingo", url: "https://bingo.corporatetambola.com/", badge: "cgb-bingo" },
    { id: "tictactoe", name: "Tic Tac Toe", url: "https://tictactoe.corporatetambola.com/", badge: "cgb-ttt" },
    { id: "snakes", name: "Snakes and Ladders", url: "https://snakes.corporatetambola.com/", badge: "cgb-snakes" },
    { id: "luck", name: "Luck by Chance", url: "https://luck.corporatetambola.com/", badge: "cgb-luck" },
    { id: "draw", name: "Lucky Draw", url: "https://home.corporatetambola.com/contact", badge: "cgb-draw", note: "Tell us you want it" }
  ];
  var HOSTS = { housie: "tambola", "corporate-tambola": "tambola", bingo: "bingo", "corporate-bingo": "bingo", tictactoe: "tictactoe", "corporate-tic-tac-toe": "tictactoe",
    snakes: "snakes", "corporate-snakes-and-ladders": "snakes", luck: "luck", "corporate-luck-by-chance": "luck", luckydraw: "draw", home: "home", corporatetambola: "home" };
  var SPRITE = __SPRITE__;
  var NS = "http://www.w3.org/2000/svg";

  var me = document.currentScript;
  function currentGame() {
    var g = me && me.getAttribute("data-game");
    if (g) return g;
    var first = String(location.hostname || "").split(".")[0];
    return HOSTS[first] || "";
  }
  var CUR = currentGame();
  // aria-current="page" belongs to the link whose address is the page you are on; on the other pages of the same site the game/home
  // link says aria-current="true" (current item in the set), so a page's own menu can mark its own page without two "page" marks.
  var PATH = String(location.pathname || "/").replace(/index\.html$/, "");
  function here(url) { try { return new URL(url).pathname === PATH; } catch (e) { return false; } }
  function markCurrent(a, url) { a.setAttribute("aria-current", here(url) ? "page" : "true"); }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function badge(id, cls) {
    var s = document.createElementNS(NS, "svg"); s.setAttribute("class", cls || "cgb-badge"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    var u = document.createElementNS(NS, "use"); u.setAttribute("href", "#" + id); s.appendChild(u); return s;
  }
  function name(text, sub) { // the small CORPORATE line above the proper name; screen readers hear "Corporate Bingo"
    var n = el("span", "cgb-name"); n.appendChild(el("span", "cgb-corp", "Corporate ")); n.appendChild(document.createTextNode(text));
    if (sub) n.appendChild(el("span", "cgb-note", sub));
    return n;
  }
  function gameLink(g, cls) {
    var a = el("a", cls); a.href = g.url; a.setAttribute("data-game", g.id);
    if (g.id === CUR) markCurrent(a, g.url);
    if (g.note) a.setAttribute("aria-label", "Corporate " + g.name + ": " + g.note.toLowerCase());
    a.appendChild(badge(g.badge)); a.appendChild(name(g.name, cls === "cgb-tile" ? g.note : null)); return a;
  }

  // the badges, drawn on the page once (ids start with cgb- so they never clash with a page's own drawings)
  var holder = el("div"); holder.innerHTML = SPRITE; var sprite = holder.firstElementChild;

  if (!document.querySelector('link[href^="/gamesbar.css"]')) { var css = el("link"); css.rel = "stylesheet"; css.href = "/gamesbar.css?v=" + VERSION; document.head.appendChild(css); }

  var bar = el("div", "cgb"); bar.setAttribute("data-cgb-version", VERSION);
  var nav = el("nav", "cgb-in"); nav.setAttribute("aria-label", "Corporate Games"); bar.appendChild(nav);

  var home = el("a", "cgb-home"); home.href = HOME; home.setAttribute("aria-label", "Corporate Games, home"); if (CUR === "home") markCurrent(home, HOME);
  home.appendChild(badge("cgb-home", "cgb-mark")); home.appendChild(name("Games")); nav.appendChild(home);
  nav.appendChild(el("span", "cgb-line", "Close group online engagement"));

  // laptop: every game in one row
  var row = el("ul", "cgb-row");
  GAMES.forEach(function (g) { var li = el("li"); li.appendChild(gameLink(g, "cgb-game")); row.appendChild(li); });
  nav.appendChild(row);

  // phone: the current game, and one button that opens the sheet
  var cur = null; GAMES.forEach(function (g) { if (g.id === CUR) cur = g; });
  if (cur) { nav.appendChild(gameLink(cur, "cgb-cur")); bar.classList.add("cgb-has-cur"); }
  var btn = el("button", "cgb-all"); btn.type = "button"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "cgb-sheet");
  btn.appendChild(el("span", "cgb-dots")); btn.appendChild(document.createTextNode("All games")); nav.appendChild(btn);

  var sheet = el("div", "cgb-sheet"); sheet.id = "cgb-sheet"; sheet.hidden = true;
  var sh = el("p", "cgb-sheet-title", "Choose a game for your close group"); sheet.appendChild(sh);
  var grid = el("ul", "cgb-grid");
  GAMES.forEach(function (g) { var li = el("li"); li.appendChild(gameLink(g, "cgb-tile")); grid.appendChild(li); });
  var hli = el("li"); var ha = el("a", "cgb-tile cgb-tile-home"); ha.href = HOME; if (CUR === "home") markCurrent(ha, HOME); ha.appendChild(badge("cgb-home")); ha.appendChild(name("Games", "All games, home page")); hli.appendChild(ha); grid.appendChild(hli);
  sheet.appendChild(grid);
  var close = el("button", "cgb-close", "Close"); close.type = "button"; sheet.appendChild(close);
  bar.appendChild(sheet);

  function open(on) {
    sheet.hidden = !on; btn.setAttribute("aria-expanded", String(on)); bar.classList.toggle("cgb-open", on);
    if (on) { var f = sheet.querySelector("a"); if (f) f.focus(); } else btn.focus();
  }
  btn.addEventListener("click", function () { open(sheet.hidden); });
  close.addEventListener("click", function () { open(false); });
  document.addEventListener("keydown", function (e) { if ((e.key === "Escape" || e.key === "Esc") && !sheet.hidden) { e.preventDefault(); open(false); } });
  document.addEventListener("click", function (e) { if (!sheet.hidden && !bar.contains(e.target)) { sheet.hidden = true; btn.setAttribute("aria-expanded", "false"); bar.classList.remove("cgb-open"); } });

  // A "Skip to the content" link must be the very first Tab stop, so the bar goes right after it (the first link of the page whose address
  // is a #target and which is called skip), not before it. Pages without a skip link get the bar at the very top.
  function skipLink() {
    var k = document.body.children;
    for (var i = 0; i < k.length && i < 8; i++) {
      var e = k[i];
      if (e.tagName === "A" && (e.getAttribute("href") || "").charAt(0) === "#" && (/(^|\s)skip/i.test(e.className) || /^skip/i.test((e.textContent || "").trim()))) return e;
    }
    return null;
  }
  function mount() {
    if (document.querySelector(".cgb")) return;
    var skip = skipLink();
    if (skip) { skip.insertAdjacentElement("afterend", bar); if (sprite) skip.insertAdjacentElement("afterend", sprite); return; }
    if (sprite) document.body.insertBefore(sprite, document.body.firstChild);
    document.body.insertBefore(bar, sprite ? sprite.nextSibling : document.body.firstChild);
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
