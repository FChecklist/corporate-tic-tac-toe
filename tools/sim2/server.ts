// The simulation server (port 8801): the EXACT Worker code (apps/edge/src/worker.ts handle) + the Pages Function for telemetry, on a COPY of the live database,
// serving pages/public (built by pages/build.mjs) like Cloudflare Pages does. Local-only extras live under /__sim/*:
//   clock  GET|POST /__sim/clock  {set: ms|iso} {advance: ms} {freeze: true|false} {reset: true}
//   tick   POST /__sim/tick       {advance?: ms, step?: ms}  runs the cron Worker call (POST /api/lifecycle/tick) at the simulated time, stepping through the advance (default step 60 s)
//   mail   GET /__sim/mail (viewer)  GET /__sim/mail.json?to=&subject=&since=  DELETE /__sim/mail.json   every e-mail the Worker "sent" (nothing is ever really sent)
//   reset  POST /__sim/reset      fresh copy of sim/pristine.sqlite -> sim/run.sqlite, clock back to real time
//   mode   POST /__sim/mode {mode:"TEST"|"LIVE"}   sql  POST /__sim/sql {sql, params}  (SELECT only)   usage  GET /__sim/usage   google  GET /__sim/google-token?email=
// Safety: a global fetch guard refuses every request that is not to localhost, so the Worker can never reach Resend, Razorpay, Google, drand or the live site from here.
// Run: bun tools/sim2/server.ts   (env SIM_PORT=8801, SIM_BUILD=0 to skip rebuilding pages/public, SIM_GOOGLE=0 to leave Google sign-in off like live)
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handle, type Env } from "../../apps/edge/src/worker";
import { sentReports } from "../../apps/edge/src/pay";
import { onRequest as telemetry } from "../../pages/functions/api/telemetry";
import { makeIdp, trust, claims, CLIENT_ID } from "../../apps/edge/test/google-fake";
import { applySchemaIdempotent, d1Of, freshRunCopy } from "./db";
import { makePages } from "./pages";

const ROOT = join(import.meta.dir, "../..");
export const SIM_KEYS = { platform: "sim-platform-key-0123456789", cron: "sim-cron-key-0123456789", dataKey: "sim-data-key-0123456789abcdef0123456789", salt: "sim-phone-salt-0123456789", inbound: "sim-inbound-secret-0123456789" };

// --- safety net: nothing leaves this machine -----------------------------------------------------------------
const realFetch = globalThis.fetch.bind(globalThis);
export const blockedFetches: string[] = [];
(globalThis as any).fetch = (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = ""; try { host = new URL(url).hostname; } catch { /* relative */ }
  if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") { blockedFetches.push(url); return Promise.reject(new Error("sim: outbound request blocked: " + url)); }
  return realFetch(input, init);
};

export interface SimOpts { port?: number; pristine?: string; runFile?: string; build?: boolean; google?: boolean }
export async function startSim(o: SimOpts = {}) {
  const port = o.port ?? Number(process.env.SIM_PORT ?? 8801);
  const pristine = o.pristine ?? join(ROOT, "sim/pristine.sqlite"), runFile = o.runFile ?? join(ROOT, "sim/run.sqlite");
  if (o.build ?? process.env.SIM_BUILD !== "0") { const r = spawnSync(process.execPath, [join(ROOT, "pages/build.mjs")], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) throw new Error("pages/build.mjs failed: " + r.stderr); }
  const pages = makePages(join(ROOT, "pages/public"));
  const toml = readFileSync(join(ROOT, "pages/wrangler.toml"), "utf8");
  const tomlVar = (k: string) => new RegExp(`^${k}\\s*=\\s*(?:"([^"\\n]*)"|'([^'\\n]*)')`, "m").exec(toml)?.slice(1).find((x) => x !== undefined);

  let raw!: Database, env!: Env & Record<string, any>;
  const clock = { offset: 0, frozen: null as number | null };
  const now = () => (clock.frozen ?? Date.now() + clock.offset);
  const open = (mode?: string) => {
    if (raw) { try { raw.close(); } catch { /* already closed */ } }
    freshRunCopy(pristine, runFile);
    raw = new Database(runFile); raw.run("PRAGMA journal_mode=WAL");
    const sch = applySchemaIdempotent(raw);
    env = {
      DB: d1Of(raw) as any, ORGANIZER_SECRET: SIM_KEYS.platform, DATA_KEY: SIM_KEYS.dataKey, PHONE_SALT: SIM_KEYS.salt, CRON_KEY: SIM_KEYS.cron, INBOUND_SECRET: SIM_KEYS.inbound, STRICT_KEYS: "1",
      DAILY_WRITE_BUDGET: tomlVar("DAILY_WRITE_BUDGET") ?? "80000", PUBLIC_ORIGIN: `http://localhost:${port}`, MAIL_FROM: tomlVar("MAIL_FROM") ?? "", COMPANY_JSON: tomlVar("COMPANY_JSON") ?? "",
      OWNER_EMAIL: "sim@example.com", // TEST mode mails only the owner allow-list; plus-addresses (sim+anything@example.com) count as the owner, so every sim user is captured
      TEST_MODE: "1", // test payments and echoed sign-in codes; no RAZORPAY_* / RESEND_API_KEY on purpose
      ...((o.google ?? process.env.SIM_GOOGLE !== "0") ? { GOOGLE_CLIENT_ID: CLIENT_ID } : {}),
    } as any;
    clock.offset = 0; clock.frozen = null;
    sentReports.length = 0;
    const m = (mode ?? process.env.SIM_MODE ?? "TEST").toUpperCase(); // payments need the site in TEST mode; "LIVE" keeps the mode of the exported live database
    if (m === "TEST" || m === "LIVE") raw.run("UPDATE mode SET mode=?, changed_ms=?, reason='sim start' WHERE id=1", [m, Date.now()]);
    return sch;
  };
  const idp = await makeIdp(); trust(idp);
  const schema = open();

  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const clockInfo = () => ({ now: now(), iso: new Date(now()).toISOString(), offsetMs: clock.offset, frozen: clock.frozen !== null });
  const mails = (q: URLSearchParams) => {
    const rows = (raw.query("SELECT id, to_addr, subject, body, at_ms, sent FROM outbox ORDER BY id").all() as any[]).map((r) => ({ id: "o" + r.id, to: r.to_addr as string, subject: r.subject as string, text: r.body as string, at: r.at_ms as number, sent: !!r.sent, attachments: [] as string[] }));
    sentReports.forEach((r, i) => rows.push({ id: "r" + i, to: r.to, subject: r.subject, text: r.text, at: 0, sent: true, attachments: r.attachments.map((a) => a.filename) }));
    const to = q.get("to")?.toLowerCase(), sub = q.get("subject")?.toLowerCase(), since = Number(q.get("since") ?? 0);
    return rows.filter((m) => (!to || m.to.toLowerCase() === to) && (!sub || m.subject.toLowerCase().includes(sub)) && (!since || m.at >= since));
  };
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const mailPage = (list: ReturnType<typeof mails>) => new Response(`<!doctype html><meta charset=utf-8><title>Sim mail</title><style>body{font:14px system-ui;margin:20px}article{border:1px solid #ccc;border-radius:8px;margin:10px 0;padding:10px}pre{white-space:pre-wrap}</style><h1>Captured e-mail (${list.length})</h1><p>Nothing here was really sent. <a href="/__sim/mail.json">json</a></p>${list.slice().reverse().map((m) => `<article><b>${esc(m.subject)}</b><br>to <code>${esc(m.to)}</code> at ${new Date(m.at).toISOString()}${m.attachments.length ? " attachments: " + esc(m.attachments.join(", ")) : ""}<pre>${esc(m.text)}</pre></article>`).join("")}`, { headers: { "content-type": "text/html; charset=utf-8" } });

  const callWorker = (req: Request, t = now()) => handle(req, env as any, t, (p) => { p.catch(() => {}); });
  const tickOnce = async (t: number) => { const r = await callWorker(new Request("http://x/api/lifecycle/tick", { method: "POST", headers: { "x-cron-key": SIM_KEYS.cron, "content-type": "application/json" }, body: "{}" }), t); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const bump = (d: number) => { if (clock.frozen !== null) clock.frozen += d; else clock.offset += d; };

  const server = Bun.serve({
    port, idleTimeout: 60,
    async fetch(req, srv) {
      const u = new URL(req.url), p = u.pathname;
      if (p.startsWith("/__sim/")) {
        const b = req.method === "POST" ? (await req.json().catch(() => ({}))) as any : {};
        if (p === "/__sim/health") return json({ ok: true, port, db: runFile, ...clockInfo(), blockedFetches });
        if (p === "/__sim/clock") {
          if (req.method === "POST") {
            if (b.reset) { clock.offset = 0; clock.frozen = null; }
            if (b.set !== undefined) { const t = typeof b.set === "number" ? b.set : Date.parse(b.set); if (!Number.isFinite(t)) return json({ error: "bad set" }, 400); if (clock.frozen !== null) clock.frozen = t; else clock.offset = t - Date.now(); }
            if (b.advance) bump(Number(b.advance));
            if (b.freeze === true && clock.frozen === null) clock.frozen = now();
            if (b.freeze === false && clock.frozen !== null) { clock.offset = clock.frozen - Date.now(); clock.frozen = null; }
          }
          return json(clockInfo());
        }
        if (p === "/__sim/tick") {
          const total = Number(b.advance ?? 0), step = Number(b.step ?? 60_000); let n = 0, last: any;
          if (!total) { last = await tickOnce(now()); n = 1; }
          else for (let done = 0; done < total; done += step) { bump(Math.min(step, total - done)); last = await tickOnce(now()); n++; }
          return json({ ticks: n, last, ...clockInfo() });
        }
        if (p === "/__sim/mail.json") { if (req.method === "DELETE") { raw.run("DELETE FROM outbox"); sentReports.length = 0; return json({ ok: true }); } return json(mails(u.searchParams)); }
        if (p === "/__sim/mail") return mailPage(mails(u.searchParams));
        if (p === "/__sim/reset") { const s = open(b.mode); return json({ ok: true, schemaAdded: s.applied, ...clockInfo() }); }
        if (p === "/__sim/mode") { if (b.mode !== "TEST" && b.mode !== "LIVE") return json({ error: "mode" }, 400); const r = await callWorker(new Request("http://x/api/owner/mode", { method: "POST", headers: { "x-organizer": SIM_KEYS.platform, "content-type": "application/json" }, body: JSON.stringify({ mode: b.mode, reason: "sim" }) })); return json({ status: r.status, ...(await r.json().catch(() => ({}))) }, r.status); }
        if (p === "/__sim/sql") { const q = String(b.sql ?? ""); if (!/^\s*select\b/i.test(q) || /;\s*\S/.test(q)) return json({ error: "SELECT only" }, 400); return json({ rows: raw.query(q).all(...((b.params ?? []) as any[])) }); }
        if (p === "/__sim/usage") return json({ usage: raw.query("SELECT * FROM usage ORDER BY day").all() });
        if (p === "/__sim/google-token") { const email = u.searchParams.get("email") ?? "g@example.com"; return json({ credential: await idp.sign(claims(email, now(), u.searchParams.get("sub") ? { sub: u.searchParams.get("sub") } : {})), clientId: CLIENT_ID }); }
        return json({ error: "unknown sim route" }, 404);
      }
      if (p === "/api/telemetry") return (telemetry as any)({ request: req, env });
      if (pages.isFunction(p)) {
        const h = new Headers(req.headers);
        const ip = h.get("x-sim-ip") ?? srv.requestIP(req)?.address ?? "127.0.0.1"; // one address per simulated phone when the client sets x-sim-ip
        if (!h.get("cf-connecting-ip")) h.set("cf-connecting-ip", ip);
        const r2 = new Request(req.url, { method: req.method, headers: h, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer() });
        return callWorker(r2);
      }
      return pages.serve(p, u.search); // Cloudflare keeps the query string on its clean-URL redirects
    },
  });
  return { server, url: `http://localhost:${port}`, port, get raw() { return raw; }, get env() { return env; }, clock, now, schemaAdded: schema.applied, stop: () => { server.stop(true); raw.close(); } };
}

if (import.meta.main) {
  const s = await startSim();
  console.log(`SIM READY ${s.url}  (db ${s.raw.filename}; platform key ${SIM_KEYS.platform}; mail viewer ${s.url}/__sim/mail; clock ${s.url}/__sim/clock)`);
}
