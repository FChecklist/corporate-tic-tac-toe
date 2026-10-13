// Serves pages/public the way Cloudflare Pages does: clean URLs ("/z.html" is a 308 to "/z", "/z" serves z.html, "/index.html" -> "/"), the _headers rules (several matching rules merge),
// _routes.json (/api/*, /ai/*, /j/* go to the Functions, the rest is static), and 404.html with status 404 for anything unknown.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8", xml: "application/xml", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", mp4: "video/mp4", pdf: "application/pdf", woff2: "font/woff2", woff: "font/woff", ico: "image/x-icon" };
const ext = (p: string) => p.split(".").pop()!.toLowerCase();
const globRe = (g: string) => new RegExp("^" + g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");

export function parseHeaders(text: string): { pattern: RegExp; raw: string; headers: [string, string][] }[] {
  const rules: { pattern: RegExp; raw: string; headers: [string, string][] }[] = [];
  let cur: (typeof rules)[number] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { const raw = line.trim(); cur = { raw, pattern: globRe(raw), headers: [] }; rules.push(cur); }
    else if (cur) { const i = line.indexOf(":"); cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
  return rules;
}

export function makePages(dir: string) {
  const root = resolve(dir);
  const rules = existsSync(join(root, "_headers")) ? parseHeaders(readFileSync(join(root, "_headers"), "utf8")) : [];
  const routes = existsSync(join(root, "_routes.json")) ? JSON.parse(readFileSync(join(root, "_routes.json"), "utf8")) : { include: ["/api/*", "/ai/*", "/j/*"], exclude: [] };
  const inc = (routes.include as string[]).map(globRe), exc = (routes.exclude as string[]).map(globRe);
  /** true when Cloudflare would run a Function (the Worker) for this path */
  const isFunction = (p: string) => inc.some((r) => r.test(p)) && !exc.some((r) => r.test(p));
  const headersFor = (p: string): Record<string, string> => {
    const h: Record<string, string> = {};
    for (const r of rules) if (r.pattern.test(p)) for (const [k, v] of r.headers) h[k] = h[k] ? h[k] + ", " + v : v; // Pages joins repeated headers
    return h;
  };
  const file = (rel: string): string | null => {
    const f = resolve(join(root, rel));
    if (!f.startsWith(root) || !existsSync(f)) return null;
    try { return statSync(f).isFile() ? f : null; } catch { return null; }
  };
  const notFound = () => { const f = file("404.html"); return new Response(f ? Bun.file(f) : "Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...headersFor("/404") } }); };
  const serve = (pathname: string, search = ""): Response => {
    const p = pathname;
    if (p.includes("..")) return new Response("Not found", { status: 404 });
    if (p === "/index.html") return new Response(null, { status: 308, headers: { location: "/" + search } });
    if (/\.html$/.test(p)) return new Response(null, { status: 308, headers: { location: p.slice(0, -5) + search } }); // "/z.html" -> "/z"
    if (p === "/_headers" || p === "/_routes.json") return notFound();
    let f: string | null = null;
    if (p === "/") f = file("index.html");
    else { f = file(p.replace(/^\//, "")); if (!f && !p.endsWith("/")) f = file(p.replace(/^\//, "") + ".html"); }
    if (!f) return notFound();
    return new Response(Bun.file(f), { headers: { "content-type": MIME[ext(f)] ?? "application/octet-stream", ...headersFor(p) } });
  };
  return { serve, isFunction, headersFor, root };
}
