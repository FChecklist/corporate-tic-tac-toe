// First-party, free, privacy-safe monitoring (Cloudflare Pages Function + a free D1 database).
// POST /api/telemetry  : accepts small batches from /rum.js (page views, speed, JS errors, failed/slow API calls). No cookies, no IP, no query strings.
// GET  /api/telemetry?days=7 with  Authorization: Bearer <REPORT_KEY>  : a plain-text report (traffic, speed, crashes, slow/failed calls, timeouts).
// A specific file, so it wins over any catch-all function. The table is created on first use (kept out of the product migration on purpose).
interface Env { DB: any; REPORT_KEY?: string }
const DAILY_CAP = 5000;
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
let ready = false;
async function init(db: any) {
  if (ready) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT, name TEXT, value REAL, detail TEXT, device TEXT, country TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry (ts, kind)"),
  ]);
  ready = true;
}
const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
const GOOD: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  if (request.method === "POST") {
    let body: any;
    try { body = await request.json(); } catch { return new Response(null, { status: 204 }); }
    const ev = Array.isArray(body?.e) ? body.e.slice(0, 30) : [];
    if (!ev.length) return new Response(null, { status: 204 });
    try {
      await init(env.DB);
      const now = Date.now();
      const n = (await env.DB.prepare("SELECT COUNT(*) c FROM telemetry WHERE ts > ?").bind(now - 86400000).first())?.c ?? 0;
      if (n >= DAILY_CAP) return new Response(null, { status: 204 });
      const country = clip((request as any).cf?.country, 2);
      const stmts = ev.filter((x: any) => ["pv", "vital", "err", "api", "res"].includes(x?.k)).map((x: any) => {
        let detail = clip(x.d, 200), device = "";
        if (x.k === "pv") { const [ref, dev] = detail.split("|"); detail = clip(ref, 80); device = clip(dev, 10); }
        return env.DB.prepare("INSERT INTO telemetry (ts,kind,path,name,value,detail,device,country) VALUES (?,?,?,?,?,?,?,?)")
          .bind(now, x.k, clip(x.p, 120), clip(x.n, 80), typeof x.v === "number" && isFinite(x.v) ? x.v : null, detail, device, country);
      });
      if (stmts.length) await env.DB.batch(stmts);
      if (Math.random() < 0.01) await env.DB.prepare("DELETE FROM telemetry WHERE ts < ?").bind(now - 90 * 86400000).run();
    } catch { /* monitoring must never break the page */ }
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET") {
    if (!env.REPORT_KEY || request.headers.get("authorization") !== `Bearer ${env.REPORT_KEY.trim()}`) return new Response("Not found", { status: 404 });
    await init(env.DB);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7)), since = Date.now() - days * 86400000;
    const all = async (sql: string) => (await env.DB.prepare(sql).bind(since).all()).results as any[];
    const L: string[] = [`Monitoring report, last ${days} day(s)`, ""];
    const pv = await all("SELECT date(ts/1000,'unixepoch') d, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY d ORDER BY d");
    L.push("PAGE VIEWS PER DAY", ...(pv.length ? pv.map((r) => `  ${r.d}  ${r.c}`) : ["  none yet"]), "");
    L.push("TOP PAGES", ...(await all("SELECT path, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY path ORDER BY c DESC LIMIT 10")).map((r) => `  ${r.c}  ${r.path}`), "");
    L.push("WHERE VISITORS COME FROM (referrer site)", ...(await all("SELECT COALESCE(NULLIF(detail,''),'(direct)') r, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY r ORDER BY c DESC LIMIT 10")).map((r) => `  ${r.c}  ${r.r}`), "");
    L.push("COUNTRIES", ...(await all("SELECT COALESCE(NULLIF(country,''),'?') r, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY r ORDER BY c DESC LIMIT 10")).map((r) => `  ${r.c}  ${r.r}`), "");
    L.push("DEVICES", ...(await all("SELECT device r, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY r ORDER BY c DESC")).map((r) => `  ${r.c}  ${r.r || "?"}`), "");
    const vit = await all("SELECT name, value FROM telemetry WHERE kind='vital' AND value IS NOT NULL AND ts>?");
    const by: Record<string, number[]> = {};
    vit.forEach((r) => (by[r.name] ||= []).push(r.value));
    L.push("SPEED (75th percentile; limits in brackets are good / poor)");
    for (const k of Object.keys(by)) {
      const v = pct(by[k]!, 0.75), g = GOOD[k];
      L.push(`  ${k.padEnd(5)} ${k === "CLS" ? v.toFixed(3) : Math.round(v) + " ms"}  (${by[k]!.length} samples)${g ? `  [${g[0]} / ${g[1]}]  ${v <= g[0] ? "GOOD" : v <= g[1] ? "NEEDS WORK" : "POOR"}` : ""}`);
    }
    if (!Object.keys(by).length) L.push("  none yet");
    const errs = await all("SELECT path, detail, COUNT(*) c FROM telemetry WHERE kind='err' AND ts>? GROUP BY path, detail ORDER BY c DESC LIMIT 15");
    L.push("", "JAVASCRIPT ERRORS (crash reports)", ...(errs.length ? errs.map((r) => `  ${r.c}x  ${r.path}  ${r.detail}`) : ["  none"]));
    const res = await all("SELECT detail, COUNT(*) c FROM telemetry WHERE kind='res' AND ts>? GROUP BY detail ORDER BY c DESC LIMIT 10");
    L.push("", "FILES THAT FAILED TO LOAD", ...(res.length ? res.map((r) => `  ${r.c}x  ${r.detail}`) : ["  none"]));
    const api = await all("SELECT name, detail, COUNT(*) c, ROUND(AVG(value)) avg_ms, ROUND(MAX(value)) max_ms FROM telemetry WHERE kind='api' AND ts>? GROUP BY name, detail ORDER BY c DESC LIMIT 20");
    L.push("", "API PROBLEMS (server errors, timeouts, calls slower than 8 s, network failures)", ...(api.length ? api.map((r) => `  ${r.c}x  ${r.name}  ${r.detail}  avg ${r.avg_ms} ms, max ${r.max_ms} ms`) : ["  none"]));
    return new Response(L.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return new Response("Method not allowed", { status: 405 });
};
