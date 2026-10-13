/* Consent boxes for the pages that need one. The wording is never typed on a page: it comes from the server (GET /api/consent/text?kind=K4), which also checks the ticks.
   A box is NEVER ticked in advance. The button you pass in `btn` is disabled (and aria-disabled) until every box is ticked. Each box has a real label; the words Terms,
   Privacy and Refund inside it are links that open our own page in a new tab.
   Use:   const tb = await TermsBox.mount(slotElement, "K4", { base: BASE, btn: button, onChange: (ok) => {} });
          request body:  { ..., consent: tb.terms() }      tb.ok() is true when every box is ticked.   Classes only, no inline style attributes. */
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const link = (text) => esc(text)
    .replace(/Terms &amp; Conditions|Terms/, (m) => `<a href="/terms.html" target="_blank" rel="noopener">${m}</a>`)
    .replace(/Privacy Policy/, (m) => `<a href="/legal.html#privacy" target="_blank" rel="noopener">${m}</a>`)
    .replace(/Refund Policy/, (m) => `<a href="/refund-policy.html" target="_blank" rel="noopener">${m}</a>`);
  async function mount(el, kind, opts) {
    opts = opts || {};
    const base = (opts.base || "").replace(/\/$/, "");
    let data;
    try { data = await (await fetch(base + "/api/consent/text?kind=" + encodeURIComponent(kind), { cache: "no-store" })).json(); if (!data || !data.boxes) throw new Error("no text"); }
    catch (e) { el.innerHTML = '<p class="tb-err" role="alert">The terms could not be loaded. Please check your connection and try again.</p>'; return { ok: () => false, terms: () => ({ v: "", boxes: [] }), boxes: [] }; }
    const wrap = document.createElement("div"); wrap.className = "tb";
    wrap.innerHTML = data.boxes.map((b) => `<div class="tcheck tb-row"><input type="checkbox" id="tb-${esc(kind)}-${esc(b.id)}" data-box="${esc(b.id)}"><label for="tb-${esc(kind)}-${esc(b.id)}">${link(b.text)}</label></div>`).join("");
    el.innerHTML = ""; el.appendChild(wrap);
    const boxes = [...wrap.querySelectorAll("input[type=checkbox]")];
    const ok = () => boxes.every((c) => c.checked);
    const sync = () => { const good = ok(); if (opts.btn) { opts.btn.disabled = !good; opts.btn.setAttribute("aria-disabled", good ? "false" : "true"); } if (opts.onChange) opts.onChange(good); };
    boxes.forEach((c) => c.addEventListener("change", sync));
    sync();
    return { ok, terms: () => ({ v: data.version, boxes: boxes.filter((c) => c.checked).map((c) => c.dataset.box) }), version: data.version, boxes: data.boxes };
  }
  window.TermsBox = { mount };
})();
