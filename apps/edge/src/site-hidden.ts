// SITE_HIDDEN (K3, 27 Nov 2026, owner decision): this game is "coming soon" to the public. Switch OFF (anything but "1"): siteHidden() returns null and every address behaves exactly as before.
// Switch ON: only the PUBLIC marketing pages (the landing page and its sales pages) answer with a short friendly "coming soon" page (noindex in the meta tag and in X-Robots-Tag, no schema, no Open Graph),
// and /llms.txt and /sitemap.xml answer 404. NOTHING else is touched: /j/<link>, the player page, the host pages, sign-in, the console links, /api/*, payment return and the legal pages all go on as before.
// Nothing is deleted. Turn it on/off with the Pages variable SITE_HIDDEN = "1" (Cloudflare Pages > Settings > Variables, no rebuild); remove the variable to bring the site back.
export const HOME_URL = "https://home.corporatetambola.com/";
/** marketing pages, clean spelling (".html", a trailing "/" and upper case are folded away before the lookup) */
export const HIDDEN_PAGES = new Set(["/", "/index", "/about", "/brochure", "/how-it-works", "/how-it-plays", "/refer", "/pricing", "/trust", "/organizer-guide", "/organizers"]);
/** files that list the site for search engines and AI assistants */
export const HIDDEN_FILES = new Set(["/llms.txt", "/sitemap.xml"]);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const BASE_HEADERS: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow, noai, noimageai",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};
export function comingSoonHtml(game: string): string {
  const g = esc(game);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${g} | Coming soon</title><style>body{margin:0;font:18px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f4ef;color:#1d2b2a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}main{max-width:32rem;text-align:center}h1{font-size:1.7rem;margin:0 0 .6rem}p{margin:.6rem 0}a.b{display:inline-block;margin-top:1rem;padding:.7rem 1.3rem;border-radius:10px;background:#0b5d5b;color:#fff;text-decoration:none;font-weight:600}small{display:block;margin-top:1.4rem;color:#5b6a69}</style></head><body><main><h1>This game is coming soon</h1><p>${g} is taking a short break while we get it ready. Thank you for your interest.</p><p>You can find our other games for company events on our home page.</p><a class="b" href="${HOME_URL}">Go to the home page</a><small>Already have a game link or code from your organizer? Please open that link as usual; it still works.</small></main></body></html>`;
}
/** Tidy a request path before the lookup (K5, 27 Nov 2026): safe percent-decode (a bad escape leaves the text as it is), repeated slashes become one, a trailing slash goes, lower case. So "//about", "/%61bout" and "//sitemap.xml" are seen as "/about" and "/sitemap.xml". */
export function normalisePath(pathname: string): string {
  let p = pathname;
  try { p = decodeURIComponent(p); } catch { /* a bad % escape: keep the text as sent */ }
  p = p.toLowerCase().replace(/\/{2,}/g, "/");
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : "/";
}
export function siteHidden(req: Request, env: { SITE_HIDDEN?: string } | undefined, game: string): Response | null {
  if (!env || env.SITE_HIDDEN !== "1") return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const raw = normalisePath(new URL(req.url).pathname);
  if (HIDDEN_FILES.has(raw)) return new Response(req.method === "HEAD" ? null : "Not found\n", { status: 404, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  const p = raw === "/" ? "/" : raw.replace(/\.html$/, "") || "/";
  if (!HIDDEN_PAGES.has(p)) return null;
  return new Response(req.method === "HEAD" ? null : comingSoonHtml(game), { status: 200, headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
}
