// Cache safety for returning visitors (31 Oct 2026). Without this a browser that has an old script cached (Cloudflare Pages gives a plain asset 4 hours) runs it against new HTML after a release and the page breaks.
// 1. versionRefs: every local script and stylesheet reference in every shipped HTML page gets ?v=<commit>, so a new release means new addresses.
// Why the address and not a header: on the custom domain the zone setting Browser Cache TTL (4 hours) replaces a no-cache header, so only a new address is safe (verified 31 Oct 2026: *.pages.dev answered no-cache, the custom domain max-age=14400 for the same file).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const REF = /(<script\b[^>]*?\bsrc=|<link\b[^>]*?\bhref=)"(\/[^"?#]+\.(?:js|css))(\?[^"#]*)?"/g;

export function versionRefs(outDir, commit) {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("cache-bust: the commit is not a hex id: " + commit);
  let n = 0;
  for (const f of walk(outDir).filter((x) => x.endsWith(".html"))) {
    const s = readFileSync(f, "utf8");
    const t = s.replace(REF, (_m, pre, path, q) => {
      n++;
      const params = (q || "").replace(/^\?/, "").split("&").filter((p) => p && !/^v=/.test(p));
      params.push("v=" + commit);
      return `${pre}"${path}?${params.join("&")}"`;
    });
    if (t !== s) writeFileSync(f, t);
  }
  return n;
}
