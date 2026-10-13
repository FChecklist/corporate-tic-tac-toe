/* Corporate Tic Tac Toe, try it (demo.html): one board against the computer, on this page only. Nothing is sent anywhere and nothing is stored.
   It shows the real rules in a few clicks: three in a row wins; a drawn game is replayed with the marks swapped, up to 3 games; then fate decides (here a coin).
   The tournament itself runs on the phones (tttgame.js), from a sealed seed; the server only stores and relays (docs/RULES.md). */
(function () {
  const $app = document.getElementById("app");
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winner = (c) => { for (const l of LINES) { const m = c[l[0]]; if (m && m === c[l[1]] && m === c[l[2]]) return m; } return 0; };
  const free = (c) => c.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  // the computer plays well but not perfectly: it takes a win, blocks a loss, else a random square (so a draw is likely, a win is possible)
  const pick = (c, me) => {
    const you = me === 1 ? 2 : 1, f = free(c);
    for (const who of [me, you]) for (const i of f) { const t = c.slice(); t[i] = who; if (winner(t) === who) return i; }
    if (!c[4] && Math.random() < 0.8) return 4;
    return f[Math.floor(Math.random() * f.length)];
  };
  let games = 0, you = Math.random() < 0.5 ? 1 : 2, cells, turn, over, msg = "", history = [];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mark = (v) => (v === 1 ? "X" : v === 2 ? "O" : "");
  function fresh() { games++; cells = Array(9).fill(0); turn = 1; over = false; msg = ""; if (turn !== you) computer(); }
  function computer() { if (over || turn === you) return; const i = pick(cells, turn); cells[i] = turn; settle(); }
  function settle() {
    const w = winner(cells);
    if (w) { over = true; msg = w === you ? "You win this match." : "The computer wins this match."; history.push(msg); return; }
    if (!free(cells).length) {
      history.push("Game " + games + " was a draw.");
      if (games < 3) { you = you === 1 ? 2 : 1; msg = "A draw. The next game starts at once, with the marks swapped."; over = "next"; return; }
      over = true; const fate = Math.random() < 0.5; msg = "Three draws. Fate decides: " + (fate ? "you win by fate." : "the computer wins by fate."); history.push(msg); return;
    }
    turn = turn === 1 ? 2 : 1;
  }
  function paint() {
    $app.innerHTML = `<div class="zhead"><b>Corporate Tic Tac Toe</b></div><div class="zcard"><h2>Try it: you against the computer</h2>
      <p class="tstat" role="status">${over === true ? esc(msg) : over === "next" ? esc(msg) : turn === you ? "Your turn. You are " + mark(you) + "." : "The computer is thinking..."}</p>
      <div class="tboard" role="grid" aria-label="Tic tac toe board">${cells.map((c, i) => `<button class="tsq ${c === 1 ? "x" : c === 2 ? "o" : ""}" data-i="${i}" role="gridcell" aria-label="Square ${i + 1}${c ? ", " + mark(c) : ", empty"}" ${c || over || turn !== you ? "disabled" : ""}>${mark(c)}</button>`).join("")}</div>
      <p class="zsmall tcen">Game ${games} of up to 3. X moves first.</p>
      ${over === "next" ? `<button class="zbtn" id="nx">Start game ${games + 1}</button>` : over ? `<button class="zbtn" id="again">Play again</button>` : ""}
      ${history.length ? `<ul class="zlist">${history.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      <p class="zsmall">In a real tournament the starter, the bracket and the tie-breaks come from a sealed random seed that nobody can change, and a move clock plays for a player who is away. Nobody pays to play. <a href="/">Back to the home page</a>.</p></div>`;
    document.querySelectorAll(".tsq").forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.i); if (cells[i] || over || turn !== you) return; cells[i] = you; settle(); paint(); if (!over && turn !== you) setTimeout(() => { computer(); paint(); }, 450); }));
    const nx = document.getElementById("nx"); if (nx) nx.addEventListener("click", () => { fresh(); paint(); if (turn !== you) setTimeout(() => { computer(); paint(); }, 450); });
    const ag = document.getElementById("again"); if (ag) ag.addEventListener("click", () => { games = 0; history = []; you = Math.random() < 0.5 ? 1 : 2; fresh(); paint(); });
  }
  fresh(); paint();
})();
