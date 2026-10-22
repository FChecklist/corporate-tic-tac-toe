/*
 * Corporate Tic Tac Toe service worker for the live (zero-server) pages.
 * The whole game (screens, game logic, voice player, fonts, icons) is saved on the phone or laptop the first time
 * the link is opened, and the game then runs from that copy. This is a static file: it costs us no server work and
 * uses the participant's own storage and memory.
 *  - /api/* and every other web address (the randomness beacon) are never touched: always live.
 *  - Pages: network first (new versions arrive when online), the saved copy when offline.
 *  - Other files: the saved copy at once, refreshed quietly in the background.
 */
const CACHE = "ttt-game-v8"; // bump when the game files change shape, so every phone saves a matching set
const FILES = ["/offline.html", "/offline.js", "/z.html", "/blackbox.js", "/guide.js", "/zc.html", "/big.html", "/host.html", "/ttt.js", "/rights.js", "/tttgame.js", "/termsbox.js", "/zc.js", "/big.js", "/host.js", "/zgame.js", "/control.js", "/common.js",
  "/app.css", "/z.css", "/ttt.css", "/big.css", "/fonts.css", "/pwa.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/logo-mark.svg",
  "/fonts/Fraunces-italic-500.woff2", "/fonts/Fraunces-normal-500-700.woff2", "/fonts/IBMPlexMono-normal-500.woff2", "/fonts/Inter-normal-400.woff2"];

// A saved copy must be a plain answer (not a redirect) or the browser refuses to show it from the saved set.
async function clean(res) { return new Response(await res.blob(), { status: 200, headers: { "content-type": res.headers.get("content-type") || "application/octet-stream" } }); }
// The host may show /z.html as /z; both mean the same saved page.
function keyOf(pathname) { if (FILES.includes(pathname)) return pathname; const h = pathname.replace(/\/$/, "") + ".html"; return FILES.includes(h) ? h : null; }

async function tell(m) { for (const c of await self.clients.matchAll()) c.postMessage({ type: "cb-sw", ...m }); }

async function saveAll() {
  const cache = await caches.open(CACHE);
  let done = 0;
  await Promise.all(FILES.map(async (f) => {
    const res = await fetch(f, { cache: "reload" });
    if (!res.ok) throw new Error("save " + f);
    await cache.put(f, await clean(res));
    done++;
    tell({ state: "saving", done, total: FILES.length });
  }));
  tell({ state: "ready", done: FILES.length, total: FILES.length });
}

self.addEventListener("install", (e) => e.waitUntil(saveAll().then(() => self.skipWaiting(), () => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("cb-game-")) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "status") return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let have = 0;
    for (const f of FILES) if (await cache.match(f)) have++;
    if (have < FILES.length) { try { await saveAll(); return; } catch {} }
    tell({ state: have === FILES.length ? "ready" : "partial", done: have, total: FILES.length });
  })());
});

// ---- news: the browser asks our public list now and then (Chrome's periodic sync on an installed app) and shows what it has not shown yet, only if the visitor allowed notifications.
// Nothing about the visitor is stored with us; what has been shown is remembered here, on the device.
async function showNews() {
  try {
    if (!self.Notification || Notification.permission !== "granted") return;
    const r = await fetch("/api/notices", { cache: "no-store" });
    if (!r.ok) return;
    const seen = await caches.open("cb-seen");
    for (const n of ((await r.json()).notices || []).slice(0, 5)) {
      if (!n || typeof n.id !== "string" || (await seen.match("/__seen/" + n.id))) continue;
      await self.registration.showNotification(String(n.title || "Corporate Tic Tac Toe").slice(0, 80), { body: String(n.body || "").slice(0, 200), icon: "/icon-192.png", badge: "/icon-192.png", tag: n.id, data: { url: typeof n.url === "string" && n.url.startsWith("/") ? n.url : "/" } });
      await seen.put("/__seen/" + n.id, new Response("1"));
    }
  } catch { /* try again at the next sync */ }
}
self.addEventListener("periodicsync", (e) => { if (e.tag === "cb-news") e.waitUntil(showNews()); });
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => { for (const c of cs) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } return self.clients.openWindow(url); }));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/zsw.js") return;
  const key = keyOf(url.pathname);
  if (!key) { // the home page, pricing, legal pages: always live; with no connection a page we do not keep shows the friendly offline page instead of the browser's error
    if (req.mode === "navigate") e.respondWith(fetch(req).catch(async () => (await (await caches.open(CACHE)).match("/offline.html")) || Response.error()));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === "navigate") {
      try { const res = await fetch(key, { cache: "no-store" }); if (res.ok) { const c = await clean(res); cache.put(key, c.clone()); return c; } }
      catch {}
      return (await cache.match(key)) || Response.error();
    }
    const hit = await cache.match(key);
    const refresh = fetch(key).then(async (res) => { if (res.ok) { const c = await clean(res); cache.put(key, c.clone()); return c; } return res; }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return hit; }
    return (await refresh) || Response.error();
  })());
});
