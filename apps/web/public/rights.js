/* A player's own rights, on the player page (gates U5, U6, D7): "Leave this game" and "What do you hold about me / delete me".
   Needs no account: it proves who the player is with the card id and this phone's own device id (the server checks both, rights.ts).
   It sits OUTSIDE the game's own screen, so the game redrawing itself every second never wipes it, and it shows only once the player has a card. */
(function () {
  "use strict";
  /*WHO-START*/
  const GAME_NAME = "Corporate Tic Tac Toe";
  const EXTRA_KEYS = ["ttt:device", "ttt:last"]; // other things this phone keeps for the game
  const GAME_PREFIX = (eid) => "ttt:" + eid + ":";
  const WHO = () => {
    try {
      const q = new URLSearchParams(location.search);
      const eid = (q.get("e") || localStorage.getItem("ttt:last") || "").trim();
      const pid = eid ? localStorage.getItem("ttt:" + eid + ":pid") || "" : "";
      const device = localStorage.getItem("ttt:device") || "";
      return eid && pid && device ? { eid, pid, device } : null;
    } catch (e) { return null; }
  };
  /*WHO-END*/
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = async (eid, action, body) => {
    let r;
    try { r = await fetch("/api/z/" + encodeURIComponent(eid) + "/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error("No connection right now. Please try again when you are online."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
    return j;
  };
  const day = (ms) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const css = document.createElement("style");
  css.textContent = ".rt-bar{max-width:520px;margin:0 auto;padding:6px 16px 32px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:center;font:15px/1.4 system-ui,sans-serif}" +
    ".rt-bar a,.rt-link{color:#0B5D5B;text-decoration:underline;background:none;border:0;padding:10px 4px;min-height:44px;font:inherit;cursor:pointer}" +
    ".rt-bar a:focus-visible,.rt-link:focus-visible,.rt-dlg button:focus-visible,.rt-dlg input:focus-visible,.rt-dlg textarea:focus-visible{outline:3px solid #1D4ED8;outline-offset:2px}" +
    ".rt-dlg{border:1px solid #9AB;border-radius:14px;padding:18px;max-width:min(92vw,460px);width:100%;color:#14302F;background:#fff;font:16px/1.45 system-ui,sans-serif}" +
    ".rt-dlg::backdrop{background:rgba(0,0,0,.5)}.rt-dlg h2{margin:0 0 8px;font-size:20px;color:#0B5D5B}.rt-dlg p{margin:8px 0}" +
    ".rt-dlg fieldset{border:0;padding:0;margin:10px 0}.rt-dlg legend{font-weight:700;padding:0;margin-bottom:4px}" +
    ".rt-dlg label{display:flex;gap:10px;align-items:flex-start;padding:8px 0;min-height:44px}.rt-dlg input[type=radio]{width:22px;height:22px;margin-top:1px;flex:0 0 22px}" +
    ".rt-dlg textarea{width:100%;box-sizing:border-box;min-height:80px;font:inherit;border:1px solid #6B7F7D;border-radius:8px;padding:8px}" +
    ".rt-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.rt-dlg button.rt-b{min-height:44px;padding:8px 16px;border-radius:10px;border:2px solid #0B5D5B;background:#0B5D5B;color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer}" +
    ".rt-dlg button.rt-b.alt{background:#fff;color:#0B5D5B}.rt-dlg button.rt-b.bad{background:#B42318;border-color:#B42318}" +
    ".rt-dlg .rt-err{color:#B42318;font-weight:700}.rt-dlg dl{margin:8px 0;padding:0}.rt-dlg dt{font-weight:700;margin-top:8px}.rt-dlg dd{margin:0}.rt-over{position:fixed;inset:0;z-index:2147483000;background:#fff;max-width:none;overflow:auto}.rt-done{max-width:520px;margin:0 auto;padding:30vh 16px 0;text-align:center;font:18px/1.5 system-ui,sans-serif;color:#14302F}.rt-done a{color:#0B5D5B}";
  document.head.appendChild(css);

  let bar = null, dlg = null, left = false, timer = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog"); dlg.className = "rt-dlg"; dlg.setAttribute("aria-labelledby", "rt-title");
    dlg.addEventListener("cancel", () => { dlg.close(); });
    document.body.appendChild(dlg);
    return dlg;
  }
  const open = (html) => { const d = ensureDialog(); d.innerHTML = html; if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); } const f = d.querySelector("[autofocus],button,input,textarea"); if (f) f.focus(); return d; };
  const close = () => { if (dlg && dlg.open) dlg.close(); };

  function forgetThisPhone(who) {
    try { const pre = GAME_PREFIX(who.eid); for (const k of Object.keys(localStorage)) if (k.indexOf(pre) === 0) localStorage.removeItem(k); for (const k of EXTRA_KEYS) localStorage.removeItem(k); } catch (e) { /* nothing more to forget */ }
  }
  function finished(message) {
    close(); left = true; clearInterval(timer);
    if (bar) { bar.remove(); bar = null; }
    for (const el of Array.from(document.body.children)) el.setAttribute("inert", ""); // the game underneath stays as it is, but nothing in it can be used any more
    const o = document.createElement("main"); o.className = "rt-done rt-over"; o.setAttribute("role", "status");
    o.innerHTML = "<p>" + esc(message) + '</p><p><a href="/">Back to the home page</a></p>';
    document.body.appendChild(o);
  }

  function leaveDialog() {
    const who = WHO(); if (!who) return;
    const d = open('<h2 id="rt-title">Leave this game?</h2><p>Your name and your place are deleted from our system now. You cannot undo this.</p><p class="rt-err" id="rt-err" role="alert"></p>' +
      '<div class="rt-row"><button class="rt-b bad" id="rt-yes" type="button">Yes, leave the game</button><button class="rt-b alt" id="rt-no" type="button" autofocus>No, stay</button></div>');
    d.querySelector("#rt-no").onclick = close;
    d.querySelector("#rt-yes").onclick = async () => {
      const b = d.querySelector("#rt-yes"); b.disabled = true;
      try { const r = await post(who.eid, "leave", { pid: who.pid, device: who.device }); forgetThisPhone(who); finished(r.message || "You have left the game. Your name and your place were deleted."); }
      catch (e) { b.disabled = false; d.querySelector("#rt-err").textContent = e.message; }
    };
  }

  function heldHtml(held) { return "<dl>" + held.map((h) => "<dt>" + esc(h.what) + "</dt><dd>" + esc(h.value) + "</dd>").join("") + "</dl>"; }

  async function requestDialog() {
    const who = WHO(); if (!who) return;
    let promise = "within 7 days", mine = [];
    try { const s = await post(who.eid, "datareq", { pid: who.pid, device: who.device, kind: "status" }); promise = s.promise || promise; mine = s.requests || []; } catch (e) { /* the form still opens */ }
    const prev = mine.length ? "<p>Your earlier requests: " + mine.map((m) => esc(m.kind) + " (" + (m.status === "done" ? "done" : "answer by " + day(m.answerByMs)) + ")").join(", ") + ".</p>" : "";
    const d = open('<h2 id="rt-title">What do we hold about you?</h2><p>The organizer of this game holds your name for the game. Ask us to show it, to correct it, or to delete it. You get your answer <b>' + esc(promise) + '</b>.</p>' + prev +
      '<form id="rt-form"><fieldset><legend>What do you want?</legend>' +
      '<label><input type="radio" name="rt-kind" value="access" checked> Show me what you hold about me</label>' +
      '<label><input type="radio" name="rt-kind" value="correction"> Correct my details</label>' +
      '<label><input type="radio" name="rt-kind" value="erasure"> Delete me from this game now</label>' +
      '<label><input type="radio" name="rt-kind" value="nomination"> Name another person who can use these rights for me</label></fieldset>' +
      '<div id="rt-notebox" hidden><label for="rt-note" id="rt-notelabel" style="display:block;padding:0">What should be corrected?</label><textarea id="rt-note" maxlength="300"></textarea></div>' +
      '<p id="rt-nom" hidden>To name the person, write to <a href="mailto:rajatsiroffice@gmail.com">rajatsiroffice@gmail.com</a> with their name and how to reach them. Press Send so that we and the organizer know you did.</p>' +
      '<p id="rt-warn" hidden><b>Deleting removes your name and your place now. You cannot undo this.</b></p>' +
      '<p class="rt-err" id="rt-err" role="alert"></p><div class="rt-row"><button class="rt-b" id="rt-send" type="submit">Send</button><button class="rt-b alt" id="rt-cancel" type="button">Close</button></div></form><div id="rt-result" aria-live="polite"></div>');
    const form = d.querySelector("#rt-form"); let chosen = "access"; const kindOf = () => chosen;
    const sync = () => { const k = kindOf(); d.querySelector("#rt-notebox").hidden = k !== "correction"; d.querySelector("#rt-warn").hidden = k !== "erasure"; d.querySelector("#rt-nom").hidden = k !== "nomination"; d.querySelector("#rt-send").textContent = k === "erasure" ? "Delete me now" : "Send"; };
    form.addEventListener("change", (ev) => { if (ev.target && ev.target.name === "rt-kind") chosen = ev.target.value; sync(); }); sync();
    d.querySelector("#rt-cancel").onclick = close;
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const kind = kindOf(), btn = d.querySelector("#rt-send"), err = d.querySelector("#rt-err"); err.textContent = ""; btn.disabled = true;
      try {
        const r = await post(who.eid, "datareq", { pid: who.pid, device: who.device, kind, note: d.querySelector("#rt-note").value });
        if (r.erased) { forgetThisPhone(who); finished(r.message); return; }
        form.hidden = true;
        d.querySelector("#rt-result").innerHTML = "<p><b>" + esc(r.message) + "</b></p>" + (r.held ? "<p>This is what we hold about you now:</p>" + heldHtml(r.held) : "") + '<div class="rt-row"><button class="rt-b" id="rt-ok" type="button">Close</button></div>';
        d.querySelector("#rt-ok").onclick = close; d.querySelector("#rt-ok").focus();
      } catch (e) { btn.disabled = false; err.textContent = e.message; }
    };
  }

  function paint() {
    if (left) return;
    const who = WHO();
    if (!who) { if (bar) { bar.remove(); bar = null; } return; }
    if (bar) return;
    bar = document.createElement("nav"); bar.className = "rt-bar"; bar.setAttribute("aria-label", "Your rights as a player");
    bar.innerHTML = '<button type="button" class="rt-link" id="rt-hold">What do you hold about me / delete me</button><button type="button" class="rt-link" id="rt-leave">Leave this game</button>';
    document.body.appendChild(bar);
    bar.querySelector("#rt-hold").onclick = requestDialog; bar.querySelector("#rt-leave").onclick = leaveDialog;
  }
  paint(); timer = setInterval(paint, 1000);
  window.__rights = { open: requestDialog, leave: leaveDialog, gameName: GAME_NAME };
})();
