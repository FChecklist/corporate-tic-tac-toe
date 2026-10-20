// Server-side errors in the error box: when the Worker itself throws or answers 5xx, the full error (not just a count) is stored in the same
// tables the browsers' reports go to (pages/functions/api/blackbox.ts), so the owner's AI sees both sides of a failure.
// Kept: the route (ids replaced by a label), the method, the status, the error's name, message and stack with anything that could identify a person taken out.
// Never kept: the request body, headers, cookies, keys, tokens, or the visitor's address. Best effort: it can never make an error worse.
import type { D1 } from "./worker";

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
export function scrubText(s: unknown, n = 300): string {
  return clip(String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/([?&#;](?:t|token|key|k|code|me|pid|hk|ck|auth|sig)=)[^&\s#;"')]*/gi, "$1[x]")
    .replace(/\b[0-9a-f]{20,}\b/gi, "[key]")
    .replace(/\b[A-Za-z0-9_-]{30,}\b/g, "[key]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]"), n);
}
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
/** The route as a label: query and fragment gone, long ids replaced. */
export function routeLabel(u: string): string {
  let p = ""; try { p = new URL(u).pathname; } catch { p = String(u).split("?")[0]!; }
  return scrubText(p.replace(/\/[0-9a-f]{16,}/gi, "/[id]").replace(/\/j\/[^/]+/, "/j/[id]").replace(/\/(?:api\/(?:report|host|cohost|paylink|invite))\/[^/]+/, (m) => m.split("/").slice(0, 3).join("/") + "/[id]"), 120);
}
const ready = new WeakSet<object>(); // per database: each database is prepared once
async function init(db: D1) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS error_group (fp TEXT PRIMARY KEY, kind TEXT, sev TEXT, page TEXT, role TEXT, msg TEXT, first_ts INTEGER, last_ts INTEGER, n INTEGER DEFAULT 1, games INTEGER DEFAULT 0, status TEXT DEFAULT 'new', rel_first TEXT, rel_last TEXT, fixed_ts INTEGER, fix_files TEXT, fix_note TEXT, fix_commit TEXT, today_day TEXT, today_n INTEGER DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS error_report (id TEXT PRIMARY KEY, fp TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS error_report_fp ON error_report (fp, ts)"),
    db.prepare("CREATE INDEX IF NOT EXISTS error_group_status ON error_group (status, last_ts)"),
  ]);
  ready.add(db);
}
const PER_GROUP_DAILY = 40, SAMPLES = 4;
/** Stores one server-side error. `err` is the caught exception (or undefined for a plain 5xx answer); `status` the answer sent. */
export async function recordServerError(db: D1, req: Request, err: unknown, status: number, now: number, release = ""): Promise<void> {
  try {
    await init(db);
    const route = routeLabel(req.url), method = clip(req.method, 8), name = clip((err as any)?.name ?? "HTTP", 40);
    const msg = scrubText(`${name}: ${(err as any)?.message ?? "answered " + status} (${method} ${route} -> ${status})`, 300);
    const stack = scrubText((err as any)?.stack ?? "", 1800);
    const frame = (/(?:at |@)\s*\(?([^\s()]+:\d+)/.exec(stack) ?? [])[1] ?? "";
    const fp = hash(`worker|${method} ${route}|${name}|${msg.replace(/\d+/g, "N").slice(0, 90)}|${frame.replace(/\d+$/, "")}`);
    const day = new Date(now).toISOString().slice(0, 10);
    const rep = { v: 1, id: fp + now.toString(36), fp, ts: now, after: 0, kind: "worker", sev: "error", msg, stack, page: route, role: "server", game: (/\/api\/z\/([A-Za-z0-9_-]{4,40})/.exec(route) ?? [])[1] ?? "", stage: "", rel: clip(release, 12),
      dev: { browser: "", os: "server", view: "", dpr: 1, lang: "", tz: 0, online: true, net: "", saveData: false, mem: null, cores: null, app: false, worker: false, visible: "" }, trail: [], x: { status, method } };
    const g = await db.prepare("SELECT status, today_day, today_n, fixed_ts, rel_last FROM error_group WHERE fp=?").bind(fp).first<any>();
    if (!g) {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO error_group (fp,kind,sev,page,role,msg,first_ts,last_ts,n,games,status,rel_first,rel_last,today_day,today_n) VALUES (?,?,?,?,?,?,?,?,1,?,'new',?,?,?,1)").bind(fp, "worker", "error", route, "server", msg, now, now, rep.game ? 1 : 0, rep.rel, rep.rel, day),
        db.prepare("INSERT OR IGNORE INTO error_report (id,fp,ts,body) VALUES (?,?,?,?)").bind(rep.id, fp, now, JSON.stringify(rep)),
      ]);
      return;
    }
    const todayN = g.today_day === day ? g.today_n : 0, reopen = g.status === "fixed" && now > (g.fixed_ts ?? 0) + 15 * 60_000;
    await db.prepare("UPDATE error_group SET n=n+1, games=games+?, last_ts=?, rel_last=?, status=CASE WHEN ?=1 THEN 'reopened' ELSE status END, today_day=?, today_n=? WHERE fp=?").bind(rep.game ? 1 : 0, now, rep.rel || g.rel_last, reopen ? 1 : 0, day, todayN + 1, fp).run();
    if (todayN < PER_GROUP_DAILY) {
      const k = (await db.prepare("SELECT COUNT(*) c FROM error_report WHERE fp=?").bind(fp).first<{ c: number }>())?.c ?? 0;
      if (k < SAMPLES) await db.prepare("INSERT OR IGNORE INTO error_report (id,fp,ts,body) VALUES (?,?,?,?)").bind(rep.id, fp, now, JSON.stringify(rep)).run();
    }
  } catch { /* best effort */ }
}
