/* Corporate Tic Tac Toe: works silently, nothing is shown to anyone. It keeps the whole game on this device (service worker) and, if the browser's own
   notification permission has been given, shows our news as notifications. We store nothing about the visitor: the notices are one public list the
   browser reads itself (/api/notices), and which ones it has already shown is remembered on the device, not with us. */
(function () {
  if (window.__cbPwa) return;
  window.__cbPwa = true;
  window.addEventListener("beforeinstallprompt", (e) => e.preventDefault()); // no install prompt of ours (the browser's own menu still offers it)
  if (!("serviceWorker" in navigator) || !window.caches) return;

  const seen = async (id) => { try { return !!(await (await caches.open("cb-seen")).match("/__seen/" + id)); } catch { return false; } };
  const mark = async (id) => { try { await (await caches.open("cb-seen")).put("/__seen/" + id, new Response("1")); } catch { /* shown again next time */ } };
  async function news(reg) {
    try {
      if (!("Notification" in window) || Notification.permission !== "granted") return; // nothing is shown without the browser's own permission
      const r = await fetch("/api/notices", { cache: "no-store" });
      if (!r.ok) return;
      for (const n of ((await r.json()).notices || []).slice(0, 5)) {
        if (!n || typeof n.id !== "string" || (await seen(n.id))) continue;
        await reg.showNotification(String(n.title || "Corporate Tic Tac Toe").slice(0, 80), { body: String(n.body || "").slice(0, 200), icon: "/icon-192.png", badge: "/icon-192.png", tag: n.id, data: { url: typeof n.url === "string" && n.url.startsWith("/") ? n.url : "/" } });
        await mark(n.id);
      }
    } catch { /* never in the way of anything */ }
  }
  // The browser's own permission question is asked ONLY after the visitor taps a clear "Notify me" button (never on the first tap of the page).
  const KEY = "cb-asked";
  function notifyButton() {
    try {
      if (!("Notification" in window) || Notification.permission !== "default" || localStorage.getItem(KEY)) return;
      const b = document.createElement("button"); b.type = "button"; b.id = "cb-notify"; b.textContent = "Notify me"; b.setAttribute("aria-label", "Notify me about news from Corporate Tic Tac Toe");
      b.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:50;min-height:36px;padding:0 14px;border-radius:999px;border:1px solid #D5E3E1;background:#fff;color:#0B5D5B;font:600 12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.12);cursor:pointer";
      b.onclick = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } b.remove(); Notification.requestPermission().then(() => navigator.serviceWorker.getRegistration().then((r) => r && news(r))).catch(() => {}); };
      document.body.appendChild(b);
    } catch { /* never in the way of anything */ }
  }

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/zsw.js");
      await navigator.serviceWorker.ready;
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* ignore */ }
      try { if (reg.periodicSync) await reg.periodicSync.register("cb-news", { minInterval: 12 * 3600 * 1000 }); } catch { /* not available here */ }
      if (reg.active) reg.active.postMessage({ type: "status" });
      news(reg); notifyButton();
    } catch { /* ignore */ }
  });
})();
