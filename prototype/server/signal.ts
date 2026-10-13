// The meeting point, for local testing: a tiny in-memory mailbox so two phones can swap the notes they need to open a direct channel.
// It also serves the prototype page. In the product this is one small Cloudflare Worker with a short-lived key-value entry per match.
// It never sees a move, a name or a score. Notes are kept 10 minutes and then forgotten.
// Run: bun server/signal.ts [port]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3300);
const WEB = join(import.meta.dir, "..", "web");
type Note = { type: "offer" | "answer"; sdp: string };
const boxes = new Map<string, { A: Note[]; B: Note[]; at: number }>();
const stats = { posts: 0, polls: 0, bytesIn: 0 };
const TTL = 10 * 60_000;
setInterval(() => { const now = Date.now(); for (const [k, v] of boxes) if (now - v.at > TTL) boxes.delete(k); }, 60_000).unref?.();

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

Bun.serve({
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url); const m = /^\/sig\/([^/]{1,80})\/([AB])$/.exec(u.pathname);
    if (m) {
      const [, match, who] = m as unknown as [string, string, "A" | "B"]; const box = boxes.get(match) ?? { A: [], B: [], at: Date.now() }; boxes.set(match, box); box.at = Date.now();
      const other = who === "A" ? "B" : "A";
      if (req.method === "POST") {
        const t = await req.text(); if (t.length > 20_000) return json({ error: "too large" }, 413);
        let n: Note; try { n = JSON.parse(t); } catch { return json({ error: "bad" }, 400); }
        if ((n.type !== "offer" && n.type !== "answer") || typeof n.sdp !== "string") return json({ error: "bad" }, 400);
        stats.posts++; stats.bytesIn += t.length; box[other].push(n); return json({ ok: true });
      }
      if (req.method === "GET") { stats.polls++; const after = Number(u.searchParams.get("after") ?? 0) || 0; return json({ msgs: box[who].slice(after), next: box[who].length }); }
    }
    if (u.pathname === "/stats") return json({ ...stats, matches: boxes.size });
    if (u.pathname === "/stats/reset") { stats.posts = stats.polls = stats.bytesIn = 0; boxes.clear(); return json({ ok: true }); }
    const path = u.pathname === "/" ? "/index.html" : u.pathname; const file = join(WEB, path);
    if (!file.startsWith(WEB) || !existsSync(file)) return new Response("Not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(readFileSync(file), { headers: { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": "no-store" } });
  },
});
console.log(`meeting point and prototype page on http://localhost:${PORT}`);
