// Owner-only page for the sales funnel (GET /api/owner/funnel, ?format=csv). Draws everything with textContent.
(() => {
  const $ = (id) => document.getElementById(id), out = $("out"), msg = $("msg");
  const el = (t, txt, cls) => { const e = document.createElement(t); if (txt != null) e.textContent = String(txt); if (cls) e.className = cls; return e; };
  const q = () => { const p = new URLSearchParams(); if ($("from").value) p.set("from", $("from").value); if ($("to").value) p.set("to", $("to").value); return p; };
  const get = async (p) => { const r = await fetch("/api/owner/funnel?" + p.toString(), { headers: { "x-organizer": $("key").value.trim() }, cache: "no-store" }); if (!r.ok) throw new Error(r.status === 404 ? "Not found. Check the key." : "Something went wrong (" + r.status + ")."); return r; };
  const pc = (v) => (v == null ? "" : v + "%");
  const stepTable = (title, rows) => { out.append(el("h2", title)); const w = el("div", null, "wrap"), t = el("table"), h = el("tr"); ["Step", "Count", "Of previous", "Of first"].forEach((x) => h.append(el("th", x))); t.append(h); for (const r of rows) { const tr = el("tr"); tr.append(el("td", r.label), el("td", r.count, "n"), el("td", pc(r.ofPrevious), "n"), el("td", pc(r.ofFirst), "n")); t.append(tr); } w.append(t); out.append(w); };
  $("f").addEventListener("submit", async (e) => {
    e.preventDefault(); out.textContent = ""; msg.textContent = "Loading...";
    try { const r = await (await get(q())).json(); msg.textContent = r.note; stepTable("Total", r.total); for (const w of r.weeks) stepTable("Week of " + w.period, w.rows); for (const d of r.days) stepTable("Day " + d.period, d.rows); }
    catch (x) { msg.textContent = x.message; }
  });
  $("csv").addEventListener("click", async () => {
    try { const p = q(); p.set("format", "csv"); const b = await (await get(p)).blob(), a = el("a"); a.href = URL.createObjectURL(b); a.download = "sales-funnel.csv"; a.click(); URL.revokeObjectURL(a.href); msg.textContent = ""; }
    catch (x) { msg.textContent = x.message; }
  });
})();
