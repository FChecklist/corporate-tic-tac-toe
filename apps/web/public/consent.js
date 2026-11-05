/* The agreement notice (vanilla JS, no build). No tick-boxes anywhere. Going ahead (sign-in, publishing, joining) is the act; one small gentle line with three links
   sits where the boxes used to be, and the request still carries the version so the server keeps its proof (apps/edge/src/consent.ts: version, sha256 of the shown line, time; nothing personal). */
(function () {
  const C = (window.CBConsent = {});
  C.version = "2026-11-01";
  C.text = {
    K1: {
      A: "I have read and agree to the Terms & Conditions, the Privacy Policy and the Refund Policy.",
      B: "I confirm: players pay nothing to play. I provide and hand over any prize. This game is allowed in my State. I am allowed to invite these guests.",
    },
    K2: { A: "I have read and agree to the Terms & Conditions and the Privacy Policy." },
    K3: { A: "I agree to the Terms and the Refund Policy. I understand there is no refund; my payment stays as credit." },
    K4: {
      A: "I agree that my name is used for this game only and deleted within 24 hours after it ends. If this game asks for my mobile number or my employee ID, it is used for this game only too and deleted at the same time. I know who invited me is recorded until then. The results are kept for 365 days, without names. Billing data is kept for audit and tax reasons. This notice is available in Hindi on request.",
      B: "I am 18 or older.",
    },
    K5: { A: "I will not charge any player. I will hand over prizes as the organizer decides. I follow the Terms." },
    K6: { A: "I am allowed to use these names and numbers for this game. The people have been told." },
  };
  const DOC = "https://home.corporatetambola.com/terms";
  C.notice = "By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules.";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const style = () => {
    if (document.getElementById("cbc-style")) return;
    const s = document.createElement("style"); s.id = "cbc-style";
    s.textContent = ".cbc{margin:10px 0;text-align:left}.cbc-note{margin:0;font-size:12px;line-height:1.45;color:#5b6b73}.cbc-note a{color:inherit;text-decoration:underline}";
    document.head.appendChild(s);
  };
  /** The notice, as HTML: one small line with three links. Nothing to tick. */
  C.html = (kind) => {
    style();
    return `<div class="cbc" data-cbc="${esc(kind)}" role="note"><p class="cbc-note">By continuing, you agree to the <a href="${DOC}#terms" target="_blank" rel="noopener">Terms and Conditions</a>, <a href="${DOC}#privacy" target="_blank" rel="noopener">Privacy and Data</a>, and <a href="${DOC}#game-rules" target="_blank" rel="noopener">Game rules</a>.</p></div>`;
  };
  /** Going ahead is the agreement: every point counts as agreed. */
  C.ticked = (root, kind) => Object.keys(C.text[kind] || {});
  C.all = () => true;
  /** What to send with the request (the version, and the points the notice covers). */
  C.payload = (root, kind) => ({ v: C.version, boxes: C.ticked(root, kind), notice: true });
  /** Buttons of the point are never held back by a box; a button marked data-hold="1" stays disabled for another reason. Returns refresh(). */
  C.wire = (root, kind, store, btn) => {
    const targets = () => Array.from(root.querySelectorAll(`[data-needs="${kind}"]`)).concat(btn ? [btn] : []);
    const refresh = () => { targets().forEach((b) => { const off = b.dataset.hold === "1"; b.disabled = off; b.setAttribute("aria-disabled", off ? "true" : "false"); }); return true; };
    refresh();
    return refresh;
  };
  C.gate = (root, kind, btn, keep) => C.wire(root, kind, keep, btn);
})();
