// Owner desk (owner-visits.html): the site switch, organizer lookup, data requests, mail events and error counts (src/admin.ts). Owner only: it uses the platform key typed into the page,
// which stays in the page and is never saved. Everything is drawn with textContent, so nothing a visitor or a player sent can run here.
(() => {
  const $ = (id) => document.getElementById(id), out = $("deskout"), msg = $("deskmsg");
  const el = (t, txt, cls) => { const e = document.createElement(t); if (txt != null) e.textContent = String(txt); if (cls) e.className = cls; return e; };
  const table = (head, rows) => { const w = el("div", null, "wrap"), t = el("table"), h = el("tr"); head.forEach((x) => h.append(el("th", x))); t.append(h); (rows.length ? rows : [["none"]]).forEach((r) => { const tr = el("tr"); r.forEach((c) => { tr.append(c instanceof Node ? (() => { const td = el("td"); td.append(c); return td; })() : el("td", c)); }); t.append(tr); }); w.append(t); return w; };
  const show = (title, node) => { out.textContent = ""; out.append(el("h2", title), node); };
  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: { "x-organizer": $("key").value.trim(), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    if (!r.ok) { let m = ""; try { m = (await r.json()).error || ""; } catch (e) { /* no body */ } throw new Error(r.status === 404 ? "Not found. Check the key." : m || "Something went wrong (" + r.status + ")."); }
    return r.json();
  }
  const run = (fn) => async (e) => { if (e && e.preventDefault) e.preventDefault(); msg.textContent = "Loading…"; try { await fn(); } catch (x) { msg.textContent = x.message; } };
  const when = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "");

  async function site() {
    const s = await api("GET", "/api/owner/site");
    msg.textContent = s.off ? "The site is OFF" + (s.since ? " since " + when(s.since) : "") + (s.note ? " (" + s.note + ")" : "") + ". Visitors see Back soon." : "The site is ON.";
    const b = el("button", s.off ? "Switch the site ON" : "Switch the site OFF"); b.type = "button";
    b.addEventListener("click", run(async () => { if (!s.off && !confirm("Switch the site off? Every page and address will say Back soon until you switch it on again.")) { msg.textContent = ""; return; } await api("POST", "/api/owner/site", { off: !s.off, note: $("deskNote").value.trim() || undefined }); await site(); }));
    show("Site switch", b);
  }
  async function requests() {
    const st = $("deskStatus").value, d = await api("GET", "/api/owner/data-requests?status=" + encodeURIComponent(st));
    msg.textContent = d.requests.length + " request(s).";
    show("Data requests (" + st + ")", table(["Received", "Due", "Game", "Card", "What", "Note", "Status", ""], d.requests.map((r) => {
      let cell = r.status === "open" ? el("button", "Close") : r.closed ? when(r.closed) : "";
      if (cell instanceof Node) { cell.type = "button"; cell.addEventListener("click", run(async () => { await api("POST", "/api/owner/data-requests", { id: r.id, action: "close" }); await requests(); })); }
      return [when(r.received), when(r.due) + (r.overdue ? " (late)" : ""), r.game, r.card, r.kind, r.note || "", r.status, cell];
    })));
  }
  async function mailEvents() {
    const d = await api("GET", "/api/owner/mail-events?event=" + encodeURIComponent($("deskEvent").value));
    msg.textContent = "Webhook " + d.webhook + ". Counts: " + (Object.entries(d.counts).map(([k, v]) => k + " " + v).join(", ") || "none yet") + ". Kept " + d.keptDays + " days.";
    show("Mail events", table(["When", "What", "To", "Subject", "Kind", "Detail"], d.events.map((e) => [when(e.at), e.event, e.to, e.subject || "", e.kind || "", e.detail || ""])));
  }
  async function errors() {
    const d = await api("GET", "/api/owner/errors");
    msg.textContent = d.lastHour + " error answer(s) in the last hour (the check fails above " + d.threshold + ").";
    show("Error answers by hour", table(["Hour", "Errors"], d.hours.map((h) => [when(h.hour), h.errors])));
  }
  async function organizer() {
    const d = await api("GET", "/api/owner/organizer?email=" + encodeURIComponent($("deskMail").value.trim()));
    msg.textContent = d.found ? "Found. Mail problems on record: " + d.mailProblems + "." : "No organizer with that e-mail address." + (d.mailProblems ? " Mail problems on record: " + d.mailProblems + "." : "");
    show("Games of " + d.email, table(["Game", "State", "Starts", "Paid", "Created"], d.games.map((g) => [g.id, g.state, when(g.start), g.paid ? "yes" : "no", when(g.created)])));
  }
  $("deskSite").addEventListener("click", run(site)); $("deskReq").addEventListener("click", run(requests)); $("deskMailEv").addEventListener("click", run(mailEvents)); $("deskErr").addEventListener("click", run(errors));
  $("deskOrg").addEventListener("submit", run(organizer));
})();
