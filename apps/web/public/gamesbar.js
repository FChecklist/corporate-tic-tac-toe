/* Corporate Games bar: the slim strip at the top of every public page. Plain links only; nothing is sent anywhere. */
(function () {
  if (document.querySelector(".cg-bar")) return;
  var GAMES = [
    ["Corporate Tambola", "https://corporatetambola.com/"],
    ["Corporate Bingo", "https://bingo.corporatetambola.com/"],
    ["Corporate Tic Tac Toe", "https://tictactoe.corporatetambola.com/", true],
    ["Corporate Snakes & Ladders", "https://snakes.corporatetambola.com/"],
    ["Corporate Luck by Chance", "https://luck.corporatetambola.com/"]
  ];
  var css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/gamesbar.css"; document.head.appendChild(css);
  var bar = document.createElement("div"); bar.className = "cg-bar";
  var wrap = document.createElement("div"); wrap.className = "cg-wrap"; bar.appendChild(wrap);
  var home = document.createElement("a"); home.className = "cg-home"; home.href = "https://games.corporatetambola.com/?from=tictactoe"; home.textContent = "Corporate Games"; wrap.appendChild(home);
  var line = document.createElement("span"); line.className = "cg-line"; line.textContent = "closed group, online engagement"; wrap.appendChild(line);
  var nav = document.createElement("nav"); nav.setAttribute("aria-label", "Corporate Games"); wrap.appendChild(nav);
  GAMES.forEach(function (g) { var a = document.createElement("a"); a.href = g[1]; a.textContent = g[0]; if (g[2]) a.setAttribute("aria-current", "true"); nav.appendChild(a); });
  document.body.insertBefore(bar, document.body.firstChild);
})();
