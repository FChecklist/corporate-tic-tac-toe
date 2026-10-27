// Owner-only page for the version number and release history (GET /api/owner/releases). Draws everything with textContent.
(() => {
  const $ = (id) => document.getElementById(id), out = $("out"), msg = $("msg");
  const el = (t, txt, cls) => { const e = document.createElement(t); if (txt != null) e.textContent = String(txt); if (cls) e.className = cls; return e; };
  $("f").addEventListener("submit", async (e) => {
    e.preventDefault(); out.textContent = ""; msg.textContent = "Loading…";
    try {
      const r = await fetch("/api/owner/releases", { headers: { "x-organizer": $("key").value.trim() }, cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Not found. Check the key." : "Something went wrong (" + r.status + ").");
      const j = await r.json(); msg.textContent = "Current version: " + j.current.version + " (" + j.current.date + ")";
      for (const x of j.releases) { out.append(el("h2", "v" + x.version + " · " + x.date + " · " + x.title + (x.commit ? " · " + x.commit : ""))); const ul = el("ul"); for (const c of x.changes || []) ul.append(el("li", c)); out.append(ul); }
    } catch (err) { msg.textContent = String(err.message || err); }
  });
})();
