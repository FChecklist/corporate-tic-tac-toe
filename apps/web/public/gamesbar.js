/* Corporate Games bar: puts the slim bar at the top of a public page. Plain links only; nothing is sent anywhere. */
(function () {
  if (document.querySelector(".cg-bar")) return;
  var GAMES = [
    ["Tambola", "https://corporate-tambola.pages.dev/"],
    ["Bingo", "https://corporate-bingo.pages.dev/"],
    ["Tic Tac Toe", "https://corporate-tic-tac-toe.pages.dev/", true],
    ["Snakes and Ladders", "https://corporate-snakes-and-ladders.pages.dev/"],
    ["Luck by Chance", "https://corporate-luck-by-chance.pages.dev/"]
  ];
  var css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/gamesbar.css"; document.head.appendChild(css);
  var bar = document.createElement("div"); bar.className = "cg-bar";
  var wrap = document.createElement("div"); wrap.className = "cg-wrap"; bar.appendChild(wrap);
  var home = document.createElement("a"); home.className = "cg-home"; home.href = "https://corporate-games.pages.dev/?from=tic-tac-toe"; home.textContent = "Corporate Games"; wrap.appendChild(home);
  var line = document.createElement("span"); line.className = "cg-line"; line.textContent = "close group, online engagement"; wrap.appendChild(line);
  var nav = document.createElement("nav"); nav.setAttribute("aria-label", "Corporate Games"); wrap.appendChild(nav);
  GAMES.forEach(function (g) { var a = document.createElement("a"); a.href = g[1]; a.textContent = g[0]; if (g[2]) a.setAttribute("aria-current", "true"); nav.appendChild(a); });
  document.body.insertBefore(bar, document.body.firstChild);
})();
