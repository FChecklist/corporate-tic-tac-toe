// The error box: complete error reports built on the visitor's own device (apps/web/public/blackbox.js) are stored here, grouped, and kept until the owner's AI has fixed them.
// POST /api/blackbox                     a report from a device (no sign-in; size, rate and daily limits below; no IP address, no cookie, no typed text)
// GET  /api/blackbox?status=open         Authorization: Bearer <REPORT_KEY>  -> the groups still to fix (new or reopened), as JSON
// GET  /api/blackbox?fp=<id>&format=md   the same bearer key -> ONE group as a complete plain report for the owner's AI (what, where, which game and stage, devices, the trail of actions, samples)
// POST /api/blackbox  {resolve:{fp,files,note,commit}}  bearer key -> marks a group fixed and keeps what was changed (file paths and the fix)
// Kept in the same free D1 as the monitoring; the tables are created on first use. Nothing here calls an AI: the owner decides when an AI works on these.
interface Env { DB: any; REPORT_KEY?: string }
const DAILY_CAP = 3000, PER_GROUP_DAILY = 40, SAMPLES = 4, KEEP_DAYS = 90, MAX_BODY = 20000;
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const ready = new WeakSet<object>(); // per database: each database is prepared once

/** The same cleaning the device does, done again here so an old or hand-made report can never store personal data. */
export function scrub(s: unknown, n = 300): string {
  return clip(String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/([?&#;](?:t|token|key|k|code|me|pid|hk|ck|auth|sig)=)[^&\s#;"')]*/gi, "$1[x]")
    .replace(/\b[0-9a-f]{20,}\b/gi, "[key]")
    .replace(/\b[A-Za-z0-9_-]{30,}\b/g, "[key]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]"), n);
}
async function init(db: any) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS error_group (fp TEXT PRIMARY KEY, kind TEXT, sev TEXT, page TEXT, role TEXT, msg TEXT, first_ts INTEGER, last_ts INTEGER, n INTEGER DEFAULT 1, games INTEGER DEFAULT 0, status TEXT DEFAULT 'new', rel_first TEXT, rel_last TEXT, fixed_ts INTEGER, fix_files TEXT, fix_note TEXT, fix_commit TEXT, today_day TEXT, today_n INTEGER DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS error_report (id TEXT PRIMARY KEY, fp TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS error_report_fp ON error_report (fp, ts)"),
    db.prepare("CREATE INDEX IF NOT EXISTS error_group_status ON error_group (status, last_ts)"),
  ]);
  ready.add(db);
}
const authed = (req: Request, env: Env) => !!env.REPORT_KEY && req.headers.get("authorization") === `Bearer ${env.REPORT_KEY.trim()}`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** Cleans one incoming report into exactly the shape that is stored; anything unexpected is dropped. */
export function clean(b: any) {
  if (!b || b.v !== 1 || typeof b.fp !== "string") return null;
  const d = b.dev ?? {};
  const trail = (Array.isArray(b.trail) ? b.trail : []).slice(-40).map((x: any) => ({ s: Number(x?.s) || 0, t: clip(x?.t, 12), d: scrub(x?.d, 160) }));
  return {
    v: 1, id: clip(b.id, 40).replace(/[^\w-]/g, ""), fp: clip(b.fp, 16).replace(/[^\w]/g, ""), ts: Date.now(), after: Number(b.after) || 0,
    kind: clip(b.kind, 16), sev: ["error", "warn", "info"].includes(b.sev) ? b.sev : "error", msg: scrub(b.msg, 300), stack: scrub(b.stack, 1800),
    page: scrub(b.page, 60), role: clip(b.role, 20), game: /^[A-Za-z0-9_-]{4,40}$/.test(String(b.game ?? "")) ? String(b.game) : "", stage: scrub(b.stage, 60), rel: clip(b.rel, 12).replace(/[^\w]/g, ""),
    dev: { browser: clip(d.browser, 30), os: clip(d.os, 20), view: clip(d.view, 12), dpr: Number(d.dpr) || 1, lang: clip(d.lang, 10), tz: Number(d.tz) || 0, online: !!d.online, net: clip(d.net, 8), saveData: !!d.saveData, mem: Number(d.mem) || null, cores: Number(d.cores) || null, app: !!d.app, worker: !!d.worker, visible: clip(d.visible, 8) },
    trail, x: b.x && typeof b.x === "object" ? Object.fromEntries(Object.entries(b.x).slice(0, 8).map(([k, v]) => [clip(k, 20), typeof v === "number" || typeof v === "boolean" ? v : scrub(v, 160)])) : null,
  };
}

/** One group as a complete plain report an AI (or a person) can act on. */
export function toMarkdown(g: any, samples: any[]): string {
  const L: string[] = [];
  L.push(`# Error ${g.fp}: ${g.msg}`, "", `- Status: **${g.status}**${g.fixed_ts ? ` (fixed ${new Date(g.fixed_ts).toISOString().slice(0, 16)}Z)` : ""}`,
    `- Kind: ${g.kind} (${g.sev}), seen ${g.n} time(s) on about ${g.games || 1} game(s)/visit(s)`, `- First seen ${new Date(g.first_ts).toISOString().slice(0, 16)}Z, last seen ${new Date(g.last_ts).toISOString().slice(0, 16)}Z`,
    `- Page: ${g.page}, shown to: ${g.role}`, `- Release first seen: ${g.rel_first || "?"}, last seen: ${g.rel_last || "?"}`, "");
  samples.forEach((s, i) => {
    L.push(`## Sample ${i + 1} of ${samples.length}  (report ${s.id})`, "", `- When: ${new Date(s.ts).toISOString().slice(0, 19)}Z, ${s.after}s after the page opened`, `- Game: ${s.game || "none"}, stage: ${s.stage || "unknown"}`,
      `- Device: ${s.dev.browser} on ${s.dev.os}, screen ${s.dev.view} (x${s.dev.dpr}), language ${s.dev.lang}, ${s.dev.online ? "online" : "OFFLINE"}${s.dev.net ? ", network " + s.dev.net : ""}${s.dev.app ? ", installed app" : ""}${s.dev.mem ? ", memory " + s.dev.mem + " GB" : ""}`, "",
      "What failed:", "```", s.msg, ...(s.stack ? [s.stack] : []), "```", ...(s.x ? ["", "Extra: " + JSON.stringify(s.x)] : []), "", "The last actions on that device, oldest first (seconds since the page opened):", "```", ...s.trail.map((t: any) => `${String(t.s).padStart(6)}s  ${t.t.padEnd(7)} ${t.d}`), "```", "");
  });
  if (g.status === "fixed" || g.fix_note) L.push("## Earlier fix", "", `Files: ${g.fix_files || "?"}`, `Commit: ${g.fix_commit || "?"}`, `What was done: ${g.fix_note || "?"}`, "");
  return L.join("\n");
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  if (request.method === "POST") {
    let text = ""; try { text = await request.text(); } catch { return new Response(null, { status: 204 }); }
    if (text.length > MAX_BODY) return new Response(null, { status: 204 });
    let body: any; try { body = JSON.parse(text); } catch { return new Response(null, { status: 204 }); }
    try {
      await init(env.DB);
      if (body?.resolve) { // owner only
        if (!authed(request, env)) return new Response("Not found", { status: 404 });
        const r = body.resolve, fp = clip(r?.fp, 16).replace(/[^\w]/g, "");
        if (!fp) return json({ error: "fp needed" }, 400);
        const files = (Array.isArray(r.files) ? r.files : [r.files]).filter(Boolean).map((f: unknown) => clip(f, 200)).slice(0, 20).join(", ");
        if (!files || !clip(r.note, 4000)) return json({ error: "say which files changed (paths) and what was done" }, 400);
        const res = await env.DB.prepare("UPDATE error_group SET status='fixed', fixed_ts=?, fix_files=?, fix_note=?, fix_commit=? WHERE fp=?").bind(Date.now(), files, clip(r.note, 4000), clip(r.commit, 40), fp).run();
        return json({ ok: true, fp, changed: res?.meta?.changes ?? null });
      }
      const rep = clean(body); if (!rep) return new Response(null, { status: 204 });
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
      const total = (await env.DB.prepare("SELECT COUNT(*) c FROM error_report WHERE ts > ?").bind(now - 86400000).first())?.c ?? 0;
      const g = await env.DB.prepare("SELECT * FROM error_group WHERE fp=?").bind(rep.fp).first();
      const todayN = g && g.today_day === day ? g.today_n : 0;
      if (!g) {
        if (total >= DAILY_CAP) return new Response(null, { status: 204 });
        await env.DB.batch([
          env.DB.prepare("INSERT INTO error_group (fp,kind,sev,page,role,msg,first_ts,last_ts,n,games,status,rel_first,rel_last,today_day,today_n) VALUES (?,?,?,?,?,?,?,?,1,1,'new',?,?,?,1)").bind(rep.fp, rep.kind, rep.sev, rep.page, rep.role, rep.msg, now, now, rep.rel, rep.rel, day),
          env.DB.prepare("INSERT OR IGNORE INTO error_report (id,fp,ts,body) VALUES (?,?,?,?)").bind(rep.id || rep.fp + now, rep.fp, now, JSON.stringify(rep)),
        ]);
      } else {
        const reopen = g.status === "fixed" && now > (g.fixed_ts ?? 0) + 15 * 60_000; // a fix needs a few minutes to reach every device's cached copy
        await env.DB.prepare("UPDATE error_group SET n=n+1, games=games+?, last_ts=?, rel_last=?, status=CASE WHEN ?=1 THEN 'reopened' ELSE status END, today_day=?, today_n=? WHERE fp=?")
          .bind(rep.game ? 1 : 0, now, rep.rel || g.rel_last, reopen ? 1 : 0, day, todayN + 1, rep.fp).run();
        if (total < DAILY_CAP && todayN < PER_GROUP_DAILY) {
          const k = (await env.DB.prepare("SELECT COUNT(*) c FROM error_report WHERE fp=?").bind(rep.fp).first())?.c ?? 0;
          if (k < SAMPLES) await env.DB.prepare("INSERT OR IGNORE INTO error_report (id,fp,ts,body) VALUES (?,?,?,?)").bind(rep.id || rep.fp + now, rep.fp, now, JSON.stringify(rep)).run();
          else if (Math.random() < 0.1) await env.DB.prepare("UPDATE error_report SET id=?, ts=?, body=? WHERE rowid=(SELECT rowid FROM error_report WHERE fp=? ORDER BY ts DESC LIMIT 1)").bind(rep.id || rep.fp + now, now, JSON.stringify(rep), rep.fp).run(); // the newest sample stays fresh
        }
      }
      if (Math.random() < 0.01) { // housekeeping: reports older than the keep time, and fixed groups that stayed quiet that long
        await env.DB.batch([env.DB.prepare("DELETE FROM error_report WHERE ts < ?").bind(now - KEEP_DAYS * 86400000),
          env.DB.prepare("DELETE FROM error_group WHERE status='fixed' AND last_ts < ? AND fixed_ts < ?").bind(now - KEEP_DAYS * 86400000, now - KEEP_DAYS * 86400000)]);
      }
    } catch { /* the error box must never break a page */ }
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET") {
    if (!authed(request, env)) return new Response("Not found", { status: 404 });
    await init(env.DB);
    const fp = clip(url.searchParams.get("fp"), 16).replace(/[^\w]/g, "");
    if (fp) {
      const g = await env.DB.prepare("SELECT * FROM error_group WHERE fp=?").bind(fp).first();
      if (!g) return new Response("Not found", { status: 404 });
      const samples = ((await env.DB.prepare("SELECT body FROM error_report WHERE fp=? ORDER BY ts DESC LIMIT ?").bind(fp, SAMPLES).all()).results as any[]).map((r) => JSON.parse(r.body));
      return url.searchParams.get("format") === "md" ? new Response(toMarkdown(g, samples), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }) : json({ group: g, samples });
    }
    const status = url.searchParams.get("status") ?? "open";
    const where = status === "all" ? "1=1" : status === "fixed" ? "status='fixed'" : "status IN ('new','reopened')";
    const rows = (await env.DB.prepare(`SELECT fp,kind,sev,page,role,msg,first_ts,last_ts,n,games,status,rel_first,rel_last,fixed_ts,fix_files,fix_note,fix_commit FROM error_group WHERE ${where} ORDER BY CASE sev WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, last_ts DESC LIMIT 200`).all()).results;
    return json({ count: (rows as any[]).length, groups: rows });
  }
  return new Response("Method not allowed", { status: 405 });
};
