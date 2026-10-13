// "Show my AI work link": the page the e-mail's button opens. It works only for the signed-in organizer (the same sign-in as the console: a 6-digit code sent to
// their own e-mail address). A forwarded e-mail is useless to anyone else. It shows the lasting AI link, with Copy, Get a fresh 24-hour link (e-mailed) and Replace.
(() => {
  const app = document.getElementById("app");
  const ss = { get: (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const WARN = "DO NOT FORWARD: this page shows your personal AI work link";
  let token = ss.get("cbz-org"), note = "";
  async function api(method, path, body, tk) {
    const r = await fetch(path, { method, headers: { "content-type": "application/json", "x-organizer": tk || token }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || "Something went wrong. Please try again."); e.status = r.status; throw e; }
    return j;
  }
  const shell = (inner) => { app.innerHTML = `<div class="zhead"><b>Corporate Tic Tac Toe · Your AI work link</b></div><div class="zbanner bad" role="alert" style="font-weight:700;text-align:center">${esc(WARN)}</div>${inner}<div class="zbanner bad" role="alert" style="font-weight:700;text-align:center">${esc(WARN)}</div>`; };
  // Seven ways to hand the paste to an AI: three open the AI with the paste pre-filled (a web address), three copy it and open the site (Ctrl+V, Send), one plain copy.
  const AIOPEN = [["ChatGPT", "https://chatgpt.com/?q="], ["Grok", "https://grok.com/?q="], ["Claude", "https://claude.ai/new?q="]];
  const AICOPY = [["Gemini", "https://gemini.google.com/app?q="], ["DeepSeek", "https://chat.deepseek.com/"], ["z.ai", "https://chat.z.ai/"]];
  const aiOptions = (paste) => `<div class="zsmall" style="font-weight:700;margin:12px 0 6px">Open your AI with this already filled in</div><div style="display:flex;flex-wrap:wrap;gap:8px">${AIOPEN.map(([n, u]) => `<a class="zbtn s" data-ai="${n}" href="${u}${encodeURIComponent(paste)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block">${n}</a>`).join("")}</div>
    <div class="zsmall" style="font-weight:700;margin:12px 0 6px">Copy it, open your AI, press Ctrl+V and Send</div><div style="display:flex;flex-wrap:wrap;gap:8px">${AICOPY.map(([n, u]) => `<button class="zbtn s alt" type="button" data-aicopy="${n}" data-url="${u}${n === "Gemini" ? encodeURIComponent(paste) : ""}">${n}</button>`).join("")}</div><div class="zsmall" id="aicopied" role="status" style="margin-top:6px;font-weight:700;color:#0b6b3a"></div>`;
  const wireAiOptions = (root, paste) => root.querySelectorAll("[data-aicopy]").forEach((b) => (b.onclick = async () => {
    let ok = false; try { await navigator.clipboard.writeText(paste); ok = true; } catch {}
    const m = root.querySelector("#aicopied"); if (m) m.textContent = ok ? "Copied. Press Ctrl+V, then Send" : "Could not copy here: select the box above, copy it, then open " + b.dataset.aicopy + " and paste.";
    try { window.open(b.dataset.url, "_blank", "noopener,noreferrer"); } catch {}
  }));
  const bannerNote = () => (note ? `<div class="zbanner info">${esc(note)}</div>` : "");

  function signIn(msg, email, codeStep) {
    shell(`<div class="zcard zform"><h2>Sign in as the organizer</h2><p class="zsmall" style="margin-top:0">Sign in to see your AI work link. We e-mail you a 6-digit code.</p>
      ${msg ? `<div class="zbanner bad">${esc(msg)}</div>` : ""}
      ${codeStep ? `<label for="cd">6-digit passcode sent to ${esc(email)}</label><input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="8"><button class="zbtn" id="go">Show my AI work link</button>`
        : `<label for="em">Your work e-mail</label><input id="em" type="email" autocomplete="email" value="${esc(email || "")}" placeholder="you@company.com"><div id="tbSlot" class="tbslot"></div><button class="zbtn" id="go" disabled>E-mail me a code</button>`}</div>`);
    const go = document.getElementById("go");
    let tb = null; // K2 consent box (termsbox.js): never pre-ticked, the button waits for the tick
    if (!codeStep && window.TermsBox) window.TermsBox.mount(document.getElementById("tbSlot"), "K2", { base: "", onChange: (ok) => { go.disabled = !ok; } }).then((t) => { tb = t; }).catch(() => {});
    go.onclick = async () => {
      go.disabled = true;
      try {
        if (!codeStep) {
          const e = document.getElementById("em").value.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { go.disabled = false; return signIn("Please enter a valid work e-mail.", e, false); }
          if (!tb || !tb.ok()) { go.disabled = true; return signIn("Please tick the box to continue.", e, false); }
          await api("POST", "/api/auth/email", { email: e, consent: tb.terms() }, "-");
          return signIn("", e, true);
        }
        const r = await api("POST", "/api/auth/verify", { email, code: document.getElementById("cd").value }, "-");
        token = r.token; ss.set("cbz-org", token); show();
      } catch (e) { signIn(e.message, email, codeStep); }
    };
  }

  async function show() {
    let r;
    try { r = await api("GET", "/api/org/ai/link"); } catch (e) { token = ""; ss.set("cbz-org", ""); return signIn(e.status === 403 ? "" : e.message, "", false); }
    shell(`${bannerNote()}<div class="zcard" style="border:2px solid #FFC93C;background:#FBFFFE"><div class="zsmall" style="font-weight:700;letter-spacing:.06em;color:#8a6a1a">YOUR AI WORK LINK</div>
      ${r.aiMessage
        ? `<p style="margin:8px 0">Copy the box. Paste it into any AI chat. It does the work.</p><textarea class="zlink" id="msg" rows="5" readonly style="width:100%;box-sizing:border-box">${esc(r.aiMessage)}</textarea><button class="zbtn" id="cp" style="margin-top:8px">Copy my AI work link</button>${aiOptions(r.aiMessage)}`
        : `<p style="margin:8px 0">You have no AI work link at the moment.</p><button class="zbtn" id="mk">Make my AI work link</button>`}
      <hr style="border:0;border-top:1px solid #D5E3E1;margin:16px 0">
      <p class="zsmall" style="margin:0 0 8px">Fresh link: we e-mail you one that works 24 hours.</p><button class="zbtn s alt" id="fr">Get a fresh AI link</button>
      <p class="zsmall" style="margin:14px 0 8px">Lost it? Replace stops every AI link at once.</p><button class="zbtn s alt" id="rp">Replace my AI link</button></div>
      <p class="zsmall"><a href="/zc.html">Open my console</a></p>`);
    if (r.aiMessage) wireAiOptions(app, r.aiMessage);
    const on = (id, f) => { const b = document.getElementById(id); if (b) b.onclick = f; };
    on("cp", () => { try { navigator.clipboard.writeText(r.aiMessage); document.getElementById("cp").textContent = "Copied. Now paste it into your AI chat"; } catch {} });
    on("mk", async () => { try { await api("POST", "/api/org/ai/replace"); note = "Your AI work link is ready. We also e-mailed you a 24-hour link."; } catch (e) { note = e.message; } show(); });
    on("fr", async () => { try { const x = await api("POST", "/api/org/ai/fresh"); note = x.mailed ? "A fresh 24-hour link is on its way to your e-mail." : "We have no e-mail address to send it to. Use the link shown above."; } catch (e) { note = e.message; } show(); });
    on("rp", async () => { if (!confirm("Replace your AI work link? Every AI link stops working at once, even if an AI is using it right now.")) return; try { await api("POST", "/api/org/ai/replace"); note = "Replaced. The old links have stopped. A new 24-hour link is on its way to your e-mail."; } catch (e) { note = e.message; } show(); });
  }
  if (token) show(); else signIn("", "", false);
})();
