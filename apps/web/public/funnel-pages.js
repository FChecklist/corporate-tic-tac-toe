/* Sales funnel on the public pages (home, pricing, how it works, brochure, payment entry). Reports four steps to our own server (/api/f) through the common reporter (tttfunnel.js):
   viewed, size_chosen, signup_started, payment_page_opened. Only a step name, a random id made for this page load and, for a size, the number of players. No name, no mobile number,
   no e-mail, no ID, nothing stored on the device. Global Privacy Control and Do Not Track: nothing is sent. The server drops everything unless the owner has switched the funnel on. */
(function () {
  var nav = navigator, path = (location.pathname || "/").toLowerCase().replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
  if (",/,/pricing,/how-it-works,/brochure,/pay,".indexOf("," + path + ",") < 0) return;
  if (nav.globalPrivacyControl === true || nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.msDoNotTrack === "1") return;
  var F = window.TTTFUN; if (!F || !F.makeReporter || window.TTTFUNNEL) return;
  var rep = F.makeReporter({ endpoint: "/api/f", game: "tictactoe" });
  window.TTTFUNNEL = rep;
  rep.report("viewed");
  if (path === "/pay") rep.report("payment_page_opened");
  var size = function (v) { var n = Math.floor(Number(v)); return n > 0 && n <= 1000000 ? n : 0; };
  document.addEventListener("change", function (e) { var t = e.target; if (t && (t.id === "pack" || t.id === "pack2")) { var n = size(t.value); if (n) rep.report("size_chosen", { size: n }); } });
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-buy], a[href]") : null; if (!t) return;
    if (t.hasAttribute("data-buy")) { var n = size(t.getAttribute("data-buy")); if (n) rep.report("size_chosen", { size: n }); return; }
    var h = t.getAttribute("href") || ""; if (/^\/zc(\?|#|$)|^\/#login$|^\/signin(\?|#|$)/.test(h)) rep.report("signup_started");
  });
})();
