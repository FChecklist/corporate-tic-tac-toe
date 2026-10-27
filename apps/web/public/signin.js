// The page the sign-in e-mail's buttons open. Opening it (a GET, which mail scanners do too) changes nothing: it only shows a button. Pressing the button POSTs the single-use token,
// which starts the session (the same kind of key the 6-digit code gives) and goes to the AI-link page or the console.
(() => {
  const app = document.getElementById("app");
  const q = new URLSearchParams(location.search), hs = (() => { try { return history.state || {}; } catch { return {}; } })(), t = q.get("t") || hs.t || "", go = (q.get("go") || hs.go) === "ai" ? "/ai-link.html" : "/zc.html";
  try { history.replaceState({ t, go: go === "/ai-link.html" ? "ai" : "" }, "", location.pathname); } catch {} // the token leaves the address bar at once
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const draw = (msg) => {
    app.innerHTML = `<div class="zhead"><b>Corporate Tic Tac Toe</b></div><div class="zcard zform"><h2>${t ? "Press the button to sign in" : "This sign-in page needs its link"}</h2>
      ${t ? `<p class="zsmall" style="margin-top:0">This is Option 2 from your e-mail. It works once, for 10 minutes.</p>` : ""}
      ${msg ? `<div class="zbanner bad" role="alert">${esc(msg)}</div>` : ""}
      ${t ? `<button class="zbtn" id="go">Sign me in</button>` : `<div class="zbanner bad" role="alert">This page lost your sign-in link, which can happen when it is reloaded or opened in another app. Open your e-mail and tap the button again, or type the 6-digit code from the same e-mail on the sign-in page. Both still work for 10 minutes.</div>`}
      <p id="gOr" class="gor" hidden>or</p><div id="tbSlot" class="tbslot" hidden></div><div id="gWrap" class="gwrap" hidden></div>
      <p class="zsmall">Something wrong? <a href="/#login">Go back to the sign-in page</a> and ask for a new e-mail.</p></div>`;
    const gw = document.getElementById("gWrap"); // "Continue with Google" shows only when the server has a Google client id; it signs in exactly like the e-mail does
    let tbx = null; // K2 consent box, shown only when the Google button is (the server refuses a Google sign-in without the tick)
    if (gw && window.TB && TB.google) TB.google.mount(gw, { intent: "signin", getTerms: () => (tbx && tbx.ok() ? tbx.terms() : null), onDone: (j) => { try { CTK.set("cbz-org", j.token); } catch {} location.replace(go); }, onError: (m) => draw(m) }).then((shown) => { const o = document.getElementById("gOr"); if (o && shown) o.hidden = false; const s = document.getElementById("tbSlot"); if (s && shown && window.TermsBox) { s.hidden = false; window.TermsBox.mount(s, "K2", { base: "" }).then((x) => { tbx = x; }).catch(() => {}); } }).catch(() => {});
    const b = document.getElementById("go");
    if (b) b.onclick = async () => {
      b.disabled = true; b.textContent = "Signing you in...";
      try {
        const r = await fetch("/api/auth/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
        try { CTK.set("cbz-org", j.token); } catch {}
        location.replace(go);
      } catch (e) { draw(e && e.name === "TypeError" ? "We could not reach the service. Please check your internet and try again." : e && e.message ? e.message : "Something went wrong. Please try again."); }
    };
  };
  draw("");
})();
