/* Corporate Tic Tac Toe, "See what players see" (preview.html#w=player&e=<game>). A sample of the player's page for the Organizer or a Host: the company strip (name, colour, logo) above a sample board.
   It is marked PREVIEW on every screen, joins nobody and sends nothing; the only request is the public game information (and the organizer's key, so a draft game can be previewed too). */
(function () {
  const $app = document.getElementById("app");
  const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const EID = (h.get("e") || "").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let key = ""; try { key = sessionStorage.getItem("cbz-org") || ""; } catch (e) { key = ""; }
  const paint = () => document.querySelectorAll(".zbrand").forEach((el) => { el.style.background = el.dataset.bg; el.style.color = el.dataset.fg; });
  const strip = (b) => (!b || (!b.name && !b.logo)
    ? `<div class="zbrand" data-bg="#0B5D5B" data-fg="#ffffff"><b>CORPORATE TIC TAC TOE</b></div>`
    : `<div class="zbrand" id="pvbrand" data-bg="${esc(b.color)}" data-fg="${esc(b.fg || "#ffffff")}">${b.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo) ? `<img class="zblogo" alt="" src="${esc(b.logo)}">` : ""}${b.name ? `<b>${esc(b.name)}</b>` : ""}</div>`);
  const cells = ["X", "", "O", "", "X", "", "O", "", ""];
  const board = `<div class="tboard" role="img" aria-label="A sample tic tac toe board">${cells.map((c) => `<button type="button" class="tsq ${c === "X" ? "x" : c === "O" ? "o" : ""}" tabindex="-1" disabled>${c}</button>`).join("")}</div>`;
  const draw = (info) => {
    $app.innerHTML = `<div class="zcard" role="note"><b>PREVIEW</b> This is a sample of what players see. Nothing is sent to anyone and nobody joins.</div>${strip(info && info.brand)}
      <div class="zhead"><b>Corporate Tic Tac Toe</b></div>
      <div class="zcard"><h2>Join the tournament</h2><p class="zsmall">Playing is free. No money is staked and there are no cash prizes. We ask your name only.</p><p class="zsmall">A sample board follows.</p></div>
      <div class="zcard"><h2>Semi-final</h2><p class="tvs"><b>Asha</b> vs <b>Ben</b></p><p class="tstat mine">Your turn <span class="tclock">12s</span></p>${board}<p class="zsmall tcen">You are <b>X</b>. X moves first.</p></div>`;
    paint();
  };
  if (!EID) { draw(null); return; }
  fetch(`/api/z/${encodeURIComponent(EID)}/info`, { headers: key ? { "x-organizer": key } : {}, cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(draw).catch(() => draw(null));
})();
