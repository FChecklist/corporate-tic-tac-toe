/* The Organizer's page for a Help Desk invitation (docs/HELPDESK_SPEC.md). The token is in the address of the e-mailed link and leaves the address bar at once.
   It shows who asks and the promise, asks the Organizer to sign in with the e-mail the invitation went to (the usual e-mail code), and then Allow or Stop. Nothing is allowed by opening the link. */
(() => {
  const app = document.getElementById("app");
  const q = new URLSearchParams(location.search), t = q.get("t") || "";
  try { history.replaceState(null, "", location.pathname); } catch {}
  const ss = { get: (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let token = ss.get("cbz-org"), info = null;
  const state = { email: "", codeStep: false, newAcct: false, msg: "", done: "" };
  async function api(method, path, body, key) {
    const k = key === undefined ? token : key;
    const r = await fetch(path, { method, headers: { "content-type": "application/json", ...(k ? { "x-organizer": k } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || "Something went wrong. Please try again."); e.status = r.status; e.code = j.code; throw e; }
    return j;
  }
  const shell = (inner) => { app.innerHTML = `<div class="zhead"><h1 class="hdh"><b>Corporate Tic Tac Toe · Help Desk</b></h1></div>${inner}`; };
  const promise = () => `<ol class="zsmall" style="padding-left:20px;line-height:1.5">${info.promise.map((l) => `<li style="margin:6px 0">${esc(l)}</li>`).join("")}</ol>`;
  const bad = (m) => (m ? `<div class="zbanner bad" role="alert">${esc(m)}</div>` : "");

  function closed(text) { shell(`<div class="zcard"><h2>Help Desk</h2><p>${esc(text)}</p><p class="zsmall"><a class="hdl" href="/">Corporate Tic Tac Toe home</a></p></div>`); }
  function signIn() {
    const TB = window.TermsBox, needBox = !(state.codeStep && !state.newAcct); // the Terms box (K2) belongs to asking for a code and to making an account (the server checks it); entering the code needs none
    shell(`<div class="zcard zform"><h2>${esc(info.helperName)} asks to prepare games for you</h2>
      <p class="zsmall" style="margin-top:0">Nothing is published or paid without your OK. First sign in with the e-mail this was sent to (${esc(info.forEmailMasked)}).</p>${promise()}
      ${bad(state.msg)}
      ${state.codeStep && !state.newAcct ? `<label for="cd">6-digit code sent to ${esc(state.email)}</label><input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="8"><button class="zbtn" id="go">Sign in</button>
        <p class="zsmall"><a href="#" class="hdl" id="mk">No account yet? Make one</a></p>`
        : state.newAcct ? `<label for="em">Your e-mail</label><input id="em" type="email" autocomplete="email" value="${esc(state.email)}"><div class="tbslot" id="hdtb"></div><button class="zbtn" id="go" disabled>Make my account</button>`
        : `<label for="em">Your e-mail</label><input id="em" type="email" autocomplete="email" value="${esc(state.email)}" placeholder="your e-mail"><div class="tbslot" id="hdtb"></div><button class="zbtn" id="go" disabled>E-mail me a code</button>
        <p class="zsmall"><a href="#" class="hdl" id="mk">No account yet? Make one</a></p>`}
      <p class="zsmall"><a href="#" class="hdl" id="stop">I do not want this</a></p></div>`);
    const go = document.getElementById("go");
    let tb = null; if (needBox && TB) TB.mount(document.getElementById("hdtb"), "K2", { base: "", btn: go }).then((t) => { tb = t; });
    const terms = () => (tb && tb.ok() ? tb.terms() : undefined);
    const mk = document.getElementById("mk"); if (mk) mk.onclick = (e) => { e.preventDefault(); state.newAcct = true; state.codeStep = false; state.msg = ""; state.email = (document.getElementById("em") || {}).value || state.email; signIn(); };
    document.getElementById("stop").onclick = (e) => { e.preventDefault(); stop(); };
    go.onclick = async () => {
      go.disabled = true;
      try {
        if (state.newAcct) {
          const em = document.getElementById("em").value.trim().toLowerCase(); state.email = em;
          const r = await api("POST", "/api/start", { email: em, consent: terms() }, "");
          if (r.exists) { state.newAcct = false; state.codeStep = false; state.msg = "That address already has an account. Use the code we send."; return signIn(); }
          token = r.token; ss.set("cbz-org", token); return allow();
        }
        if (!state.codeStep) {
          const em = document.getElementById("em").value.trim().toLowerCase(); state.email = em;
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { state.msg = "Please enter a valid e-mail."; return signIn(); }
          await api("POST", "/api/auth/email", { email: em, consent: terms() }, ""); state.codeStep = true; state.msg = ""; return signIn();
        }
        const r = await api("POST", "/api/auth/verify", { email: state.email, code: document.getElementById("cd").value }, "");
        token = r.token; ss.set("cbz-org", token); state.msg = ""; allow();
      } catch (e) { state.msg = e.message; signIn(); }
    };
  }
  function allow() {
    shell(`<div class="zcard zform"><h2>${esc(info.helperName)} asks to prepare games for you</h2>${promise()}
      <p class="zsmall">By tapping Allow you agree to the five points above.</p>${bad(state.msg)}
      <button class="zbtn" id="ok">Allow</button> <button class="zbtn alt" id="no">Not now</button>
      <p class="zsmall"><a href="#" class="hdl" id="out">Use a different e-mail</a></p></div>`);
    document.getElementById("ok").onclick = async (ev) => {
      ev.target.disabled = true;
      try { await api("POST", "/api/helpdesk/accept", { t, consent: true }); info.state = "active"; active(); }
      catch (e) { if (e.status === 403 && e.code === "wrong-account") { token = ""; ss.set("cbz-org", ""); state.codeStep = false; state.newAcct = false; state.msg = e.message; return signIn(); } if (e.status === 403) { token = ""; ss.set("cbz-org", ""); state.msg = "Please sign in again."; return signIn(); } state.msg = e.message; allow(); }
    };
    document.getElementById("no").onclick = () => stop();
    document.getElementById("out").onclick = (e) => { e.preventDefault(); token = ""; ss.set("cbz-org", ""); state.codeStep = false; state.msg = ""; signIn(); };
  }
  function active() {
    shell(`<div class="zcard"><h2>Done</h2><p>${esc(info.helperName)} can now prepare games for you. You publish each one with one tap, and you can stop this at any time.</p>${bad(state.msg)}
      <button class="zbtn alt" id="stop">Stop Help Desk</button><p class="zsmall"><a class="hdl" href="/zc.html">Open my console</a></p></div>`);
    document.getElementById("stop").onclick = () => stop();
  }
  async function stop() {
    if (info.state === "active" && !confirm("Stop? Their access to your account ends at once. Games already published stay as they are.")) return;
    try { await api("POST", "/api/helpdesk/stop", { t }, ""); closed("Stopped. " + info.helperName + " has no access to your account."); }
    catch (e) { state.msg = e.message; info.state === "active" ? active() : signIn(); }
  }
  (async () => {
    if (!/^[0-9a-f]{48}$/.test(t)) return closed("This link is incomplete. Please open the link from the e-mail again.");
    try { info = await api("GET", "/api/helpdesk/accept/info?t=" + t, undefined, ""); } catch (e) { return closed(e.status === 404 ? "This link is not valid." : e.message); }
    if (info.state === "expired") return closed("This invitation has expired. Ask " + info.helperName + " to send a new one.");
    if (info.state === "stopped") return closed("This has been stopped.");
    if (info.state === "active") return active();
    if (token) { try { await api("GET", "/api/helpdesk/mine"); return allow(); } catch { token = ""; ss.set("cbz-org", ""); } }
    signIn();
  })();
})();
