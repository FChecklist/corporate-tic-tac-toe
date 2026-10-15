// The old *.pages.dev address answers a permanent redirect (301) to the real address, for page requests only.
// GET and HEAD only. The API paths (the payment service forwards webhooks there), the AI link paths, /__, /version.json and /.well-known/ are never redirected.
// "www." of the real address goes to the real address (same path and query). A request on the real address is never redirected.
export function domainRedirect(req: Request, publicOrigin: string): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const url = new URL(req.url), target = new URL(publicOrigin), host = url.hostname;
  if (host === target.hostname) return null;
  const isWww = host === "www." + target.hostname, isOld = host.endsWith(".pages.dev");
  if (!isWww && !isOld) return null;
  const p = url.pathname;
  if (isOld && (p.startsWith("/api/") || p === "/api" || /^\/a[i]\//.test(p) || p.startsWith("/__") || p === "/version.json" || p.startsWith("/.well-known/"))) return null;
  return new Response(null, { status: 301, headers: { location: target.origin + p + url.search } });
}
