/* Corporate Tic Tac Toe: "notify me when this game begins" on the page a player opens from the game link (z.html). SHIPPED DARK.
   It adds the shared notify block of the corporate-push service (push-optin.js and push-optin.css, copied unchanged) under the game, and nothing else.

   THE ONE SETTING is PUSH_API below: the https address of the push service. It is EMPTY today. While it is empty this file does nothing at all:
   no block is drawn, push-optin.js and push-optin.css are not loaded, and no request of any kind is made. To go live a person sets it to the service's
   address (an origin only, for example https://push.example.com) AND adds the same address to connect-src of the /z.html rules in _headers (pages/build.mjs
   does that by itself from this value); apps/web/test/push-game.test.ts fails if the two are not in step.

   What the block does (the shared file, see docs/KNOWLEDGE.md "Game-start notification"): the browser's own permission question opens ONLY after the
   player taps the button, never on load. The service saves a browser address (not a name, e-mail or phone) for this game and deletes it with the game. A Stop
   button is always on screen. After the game the block offers "Keep notifying me about new games". */
(function () {
  "use strict";
  var PUSH_API = "";
  if (!/^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?$/.test(PUSH_API)) return; // dark: not a real https address, so nothing is drawn, loaded or sent

  // The game is named in the link (?e=); an installed copy that was opened without it uses the game that was open last (the same rule as ttt.js).
  var id = new URLSearchParams(location.search).get("e") || "";
  if (!id) { try { id = localStorage.getItem("ttt:last") || ""; } catch (e) { id = ""; } }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return; // no game, no block

  // push-optin.js and push-optin.css carry the same ?v= as this file, so a new release never meets an old copy kept by the browser (pages/cache-bust.mjs)
  var own = document.currentScript && document.currentScript.src ? /[?&](v=[0-9a-f]{7,40})(?:&|$)/.exec(document.currentScript.src) : null;
  var ver = own ? "?" + own[1] : "";

  var root = document.createElement("div");
  root.setAttribute("data-push-optin", "");
  root.setAttribute("data-push-api", PUSH_API);
  root.setAttribute("data-push-site", "game");
  root.setAttribute("data-push-game-id", id);
  root.setAttribute("data-push-privacy", "/privacy.html");
  root.setAttribute("data-push-sw", "/zsw.js"); // the one service worker of this site (pwa.js registers it); used only if it is not registered yet
  root.setAttribute("data-push-ended", "false");
  var below = document.querySelector(".mkown"); // under the game and above "Create your own game"
  if (below && below.parentNode) below.parentNode.insertBefore(root, below); else document.body.appendChild(root);

  // ttt.js and tttstage.js tell the page when the game is over for this player: the block then offers "Keep notifying me about new games"
  document.addEventListener("ttt:game-over", function () {
    root.setAttribute("data-push-ended", "true");
    root.dispatchEvent(new Event("corporatepush:game-ended"));
  });

  var css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "/push-optin.css" + ver;
  document.head.appendChild(css);
  var js = document.createElement("script");
  js.src = "/push-optin.js" + ver;
  document.body.appendChild(js);
})();
