/* The agreement notice for the pages that need one. No tick-boxes anywhere: going ahead (sign-in, publishing, joining, paying) is the act, and one small gentle line with three
   links sits where the boxes used to be. The words come from this game's own server (GET /api/consent/text?kind=K4: the Terms version and the ids of the points), never typed on a page.
   The request still carries the version, so the server keeps its proof of what was shown (consent.ts: version, sha256 of the notice line, time; nothing personal).
   Use (the same call as before):   const tb = await TermsBox.mount(slotElement, "K4", { base: BASE, btn: button, onChange: (ok) => {} });
          request body:  { ..., consent: tb.terms() }      tb.ok() is true once the version has loaded; no box is ever held back.   Classes only, no inline style attributes.
   A button passed in `btn` is never held back by a box; a button marked data-hold="1" stays disabled for another reason. */
(function () {
  const DOC = "https://home.corporatetambola.com/terms";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /** The notice, as HTML: one small line with three links. Nothing to tick. */
  const noticeHtml = () => `<p class="tb-note" role="note">By continuing, you agree to the <a href="${DOC}#terms" target="_blank" rel="noopener">Terms and Conditions</a>, <a href="${DOC}#privacy" target="_blank" rel="noopener">Privacy and Data</a>, and <a href="${DOC}#game-rules" target="_blank" rel="noopener">Game rules</a>.</p>`;
  async function mount(el, kind, opts) {
    opts = opts || {};
    const base = (opts.base || "").replace(/\/$/, "");
    let data;
    try { data = await (await fetch(base + "/api/consent/text?kind=" + encodeURIComponent(kind), { cache: "no-store" })).json(); if (!data || !data.boxes) throw new Error("no text"); }
    catch (e) { el.innerHTML = '<p class="tb-err" role="alert">The terms could not be loaded. Please check your connection and try again.</p>'; return { ok: () => false, terms: () => ({ v: "", boxes: [] }), boxes: [] }; }
    const wrap = document.createElement("div"); wrap.className = "tb"; wrap.setAttribute("data-tb", esc(kind));
    wrap.innerHTML = noticeHtml();
    el.innerHTML = ""; el.appendChild(wrap);
    const sync = () => { if (opts.btn) { const off = opts.btn.dataset && opts.btn.dataset.hold === "1"; opts.btn.disabled = off; opts.btn.setAttribute("aria-disabled", off ? "true" : "false"); } if (opts.onChange) opts.onChange(true); };
    sync();
    return { ok: () => true, terms: () => ({ v: data.version, boxes: data.boxes.map((b) => b.id), notice: true }), version: data.version, boxes: data.boxes };
  }
  window.TermsBox = { mount };
})();
