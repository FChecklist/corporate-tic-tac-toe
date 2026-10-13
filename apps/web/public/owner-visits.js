// Owner-only page for the visit reports (GET /api/owner/visits/summary and /journey/<id>). Draws everything with textContent, so nothing a visitor sent can run here.
(() => {
  const $ = (id) => document.getElementById(id), out = $("out"), msg = $("msg");
  const el = (t, txt, cls) => { const e = document.createElement(t); if (txt != null) e.textContent = String(txt); if (cls) e.className = cls; return e; };
  const table = (head, rows) => { const w = el("div", null, "wrap"), t = el("table"), h = el("tr"); head.forEach((x) => h.append(el("th", x))); t.append(h); (rows.length ? rows : [["none yet"]]).forEach((r) => { const tr = el("tr"); r.forEach((c, i) => tr.append(el("td", c, typeof c === "number" ? "n" : ""))); t.append(tr); }); w.append(t); return w; };
  const block = (title, head, rows) => { out.append(el("h2", title), table(head, rows)); };
  const kn = (xs) => (xs || []).map((x) => [x.k, x.n]);
  const mins = (ms) => (ms >= 60000 ? Math.round(ms / 6000) / 10 + " min" : Math.round(ms / 1000) + " s");
  async function get(path) {
    const r = await fetch(path, { headers: { "x-organizer": $("key").value.trim() }, cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "Not found. Check the key." : "Something went wrong (" + r.status + ").");
    return r.json();
  }
  $("f").addEventListener("submit", async (e) => {
    e.preventDefault(); out.textContent = ""; msg.textContent = "Loading…";
    try {
      const q = new URLSearchParams(); if ($("from").value) q.set("from", $("from").value); if ($("to").value) q.set("to", $("to").value);
      const s = await get("/api/owner/visits/summary?" + q); msg.textContent = `From ${s.fromDay} to ${s.toDay}. ${s.note}`;
      const h = s.humans;
      block("People", ["", ""], [["Visitors", h.visitors], ["Visits", h.sessions], ["Returning visitors", h.returningVisitors], ["Returning network addresses", h.returningIps], ["Pages per visit", h.avgPagesPerSession], ["Crawler visits (not counted above)", s.bots.sessions]]);
      block("Funnel (visitors)", ["Step", "Visitors", "% of all", "% of previous step"], s.funnel.map((f) => [f.step, f.visitors, f.ofVisits == null ? "" : f.ofVisits + "%", f.ofPrevious == null ? "" : f.ofPrevious + "%"]));
      block("Sales by first source", ["Source", "Visitors", "Account", "Published", "Paid", "Paid %"], s.convertedBySource.map((c) => [c.src + (c.label ? " / " + c.label : ""), c.visitors, c.account, c.published, c.paid, c.paidRate == null ? "" : c.paidRate + "%"]));
      block("Where visitors come from", ["Source", "Visits"], kn(s.sources)); block("Landing pages", ["Page", "Visits"], kn(s.landing));
      block("Sections seen", ["Section", "Visits that saw it", "Average time"], s.sections.map((x) => [x.section, x.views, mins(x.avgDwellMs)]));
      block("Where visitors left", ["Page", "Visits"], kn(s.exits.pages)); block("Last section seen before leaving", ["Section", "Visits"], kn(s.exits.sections));
      block("Time and scroll at exit", ["", ""], [["Average time on the last page", mins(s.exits.avgTimeOnPageMs)], ["Average scroll depth", s.exits.avgScrollPct + "%"]]);
      block("Number of participants chosen", ["Up to", "Times chosen", "Price shown"], s.sizeChoice.map((x) => [x.size, x.n, x.shown.map((p) => p.price + " x" + p.n).join(", ")]));
      block("Actions", ["Action", "Times"], s.actions.map((x) => [x.name, x.n])); block("Currency switch", ["Currency", "Times"], s.currencyChoice.map((x) => [x.currency, x.n]));
      block("Devices", ["Device", "Visits"], kn(s.devices)); block("Languages", ["Language", "Visits"], kn(s.languages)); block("Countries", ["Country", "Visits"], kn(s.countries)); block("Cities", ["City", "Visits"], kn(s.cities));
      block("Crawlers (search engines and others)", ["Name", "Visits", "Pages"], s.bots.crawlers.map((b) => [b.name, b.sessions, b.pages.join(" ")]));
      block("Counted only (privacy signal on, or no visit on record)", ["Kind", "Item", "Count"], s.privateCounts.map((x) => [x.dim, x.k, x.n]));
      if (s.archived.length) block("Older than 365 days (anonymous totals)", ["Day", "Kind", "Item", "Count"], s.archived.map((x) => [x.day, x.dim, x.k, x.n]));
    } catch (x) { msg.textContent = x.message; }
  });
  $("jf").addEventListener("submit", async (e) => {
    e.preventDefault(); out.textContent = ""; msg.textContent = "Loading…";
    try {
      const j = await get("/api/owner/visits/journey/" + encodeURIComponent($("jid").value.trim())); msg.textContent = `${j.visits} visit(s), first seen ${j.firstSeenMs ? new Date(j.firstSeenMs).toISOString() : "?"}, found by ${j.by}.`;
      j.sessions.forEach((s) => block(`${new Date(s.first_ms).toISOString()} · ${s.src}${s.ref_host ? " / " + s.ref_host : ""} · ${s.device || "?"} · ${s.country || "?"} · furthest: ${s.stageName}`, ["When", "What", "Page", "Detail"],
        s.events.map((v) => [new Date(v.at_ms).toISOString().slice(11, 19), v.kind + (v.name ? " " + v.name : ""), v.path || "", [v.val, v.n != null ? v.n : ""].filter((x) => x !== "").join(" ")])));
    } catch (x) { msg.textContent = x.message; }
  });
})();
