/* Corporate Tic Tac Toe: "Continue with Google" (docs/ROLES_AND_CONSOLE_SPEC_4.md, section C). One small helper shared by the home page, the sign-in page and (later) the Host's first screen.
   The button shows ONLY when the server has a Google client id (GET /api/auth/config -> {google: "<id>"|null}). Google's own button (Google Identity Services) gives us a signed token;
   we post it to /api/auth/google, which checks it and answers exactly like the e-mail-code sign-in does ({token}); then we continue exactly as that does. We ask for nothing but the e-mail.
   Nothing is loaded from Google unless a client id is configured. If Google refuses to load here (an in-app browser, an ad blocker), we say so calmly and the e-mail code stays the other way. */
(function () {
  const TB = window.TB || (window.TB = {});
  const WEBVIEW = /; wv\)|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|LinkedInApp|Snapchat|Twitter|GSA\//i; // browsers inside other apps, which Google refuses to sign in on
  const LINE = "Open this page in your browser, or use an e-mail code.";
  let cfg;
  async function config() {
    if (cfg !== undefined) return cfg;
    try {
      const r = await fetch("/api/auth/config", { headers: { accept: "application/json" } });
      const j = r.ok ? await r.json() : null;
      cfg = j && typeof j.google === "string" && /^[\w.-]{10,200}$/.test(j.google) ? j.google : null;
    } catch { cfg = null; }
    return cfg;
  }
  function loadGsi(ms) {
    return new Promise((ok, no) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return ok();
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      const t = setTimeout(() => no(new Error("slow")), ms || 8000);
      s.onload = () => { clearTimeout(t); window.google && window.google.accounts && window.google.accounts.id ? ok() : no(new Error("missing")); };
      s.onerror = () => { clearTimeout(t); no(new Error("blocked")); };
      document.head.appendChild(s);
    });
  }
  const note = (el, text) => { el.innerHTML = ""; const p = document.createElement("p"); p.className = "zsmall ggnote"; p.setAttribute("role", "status"); p.textContent = text; el.appendChild(p); el.hidden = false; };
  /**
   * Puts the Google button into `el` when Google sign-in is switched on; leaves `el` empty and hidden when it is not.
   * opt: { intent: "signup"|"signin"|"host", hostKey?, onDone(result), onError(message) }. Resolves true when the button (or the calm line) was shown.
   */
  async function mount(el, opt) {
    if (!el) return false;
    el.hidden = true; el.innerHTML = "";
    return false; // owner, 2026-10-23: there is ONE way in, the e-mail (a 6-digit code or one tap). The Google button stays off; the server route is kept but not offered.
    const id = await config();
    if (!id) return false;
    el.hidden = false;
    if (WEBVIEW.test((navigator && navigator.userAgent) || "")) { note(el, LINE); return true; }
    try { await loadGsi(); } catch { note(el, LINE); return true; }
    try {
      window.google.accounts.id.initialize({
        client_id: id, ux_mode: "popup", auto_select: false, cancel_on_tap_outside: true,
        callback: async (resp) => {
          const credential = resp && resp.credential;
          if (!credential) return;
          try {
            const terms = opt.getTerms ? opt.getTerms() : null; // the ticked consent boxes (K2 sign-up/sign-in, K5 Host); the server refuses without them
            if (opt.getTerms && !terms) throw new Error("Please tick the box first, then continue with Google.");
            const r = await fetch("/api/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential, intent: opt.intent || "signin", ...(terms ? { consent: terms } : {}), ...(opt.hostKey ? { hostKey: opt.hostKey } : {}) }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || "Google sign-in did not work. Please try again, or use an e-mail code.");
            opt.onDone && opt.onDone(j);
          } catch (e) { opt.onError && opt.onError(e && e.message ? e.message : "Google sign-in did not work. Please try again, or use an e-mail code."); }
        },
      });
      const box = document.createElement("div"); el.appendChild(box);
      window.google.accounts.id.renderButton(box, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left", width: Math.max(200, Math.min(320, (el.clientWidth || 300))) });
    } catch { note(el, LINE); }
    return true;
  }
  /** What the e-mail-code sign-in does after a good code: keep the key for this tab and go on to the console (or the page that sent the person here). */
  function finish(r) {
    try { CTK.set("cbz-org", r.token); } catch {}
    let nx = "/zc.html"; try { const n = sessionStorage.getItem("cbz-next"); if (n && /^\/(zc|pay)(\.html)?(\?e=[A-Za-z0-9_-]{4,40})?$/.test(n)) nx = n; sessionStorage.removeItem("cbz-next"); } catch {}
    location.href = nx;
  }
  TB.google = { config, mount, finish, LINE };
})();
