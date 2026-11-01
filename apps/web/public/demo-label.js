/* Demo label: when a game is a free Demo game, every screen of it (the console, the player page, the big screen) shows a "Demo" bar at the top. The game reports it as demo:true; nothing is stored. */
(function () {
  const e = new URLSearchParams(location.search).get("e"); if (!e || !/^[A-Za-z0-9_-]{3,40}$/.test(e)) return;
  fetch("/api/z/" + encodeURIComponent(e) + "/info").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || d.demo !== true || document.getElementById("demoBar")) return;
    const b = document.createElement("div"); b.id = "demoBar"; b.setAttribute("role", "note");
    b.style.cssText = "position:sticky;top:0;z-index:9999;background:#F5820A;color:#fff;font:700 14px/1.3 system-ui,sans-serif;text-align:center;padding:6px 10px";
    b.textContent = "DEMO · a free practice game for up to 10 people. Same rules as a real game.";
    document.body.insertBefore(b, document.body.firstChild);
  }).catch(() => {});
})();
