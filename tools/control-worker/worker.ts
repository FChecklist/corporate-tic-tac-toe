// Cloudflare Worker (free tier) that WRITES the signed control file to an R2 bucket. NOT deployed; local tests only.
//
// Phones never touch this Worker. They read  https://<control-domain>/control/<engagementId>.json  straight from R2 through a
// Cloudflare custom domain with a Cache Rule (edge TTL 3 s). Cached reads do not invoke any Worker and are not billed, so the number
// of phones does not matter. This Worker runs only when the organizer's console publishes a message: a handful of requests per engagement.
//
//   POST /control/<id>        body {"message": <signed control message>}   open: the organizer's signature is the authorisation
//   PUT  /control/<id>/key    body {"publicKey": "<hex>", "profile": "standard"|"fast"}   needs header x-register-secret (our backend relays it)
//
// Same publishControl/registerKey code as the local server, so behaviour cannot drift.
import { SAFETY_FAST, SAFETY_STANDARD, publishControl, registerKey, type KV } from "../../packages/beacon/src/control";

export interface R2Like { get(key: string): Promise<{ text(): Promise<string> } | null>; put(key: string, value: string, opts?: unknown): Promise<unknown> }
export interface Env { BUCKET: R2Like; REGISTER_SECRET?: string }

const kvOf = (b: R2Like): KV => ({
  get: async (k) => (await b.get(k))?.text() ?? null,
  put: async (k, v) => { await b.put(k, v, { httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=0, s-maxage=3" } }); },
});
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, PUT, OPTIONS", "access-control-allow-headers": "content-type, x-register-secret" };
const j = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const m = new URL(req.url).pathname.match(/^\/control\/([A-Za-z0-9_-]{3,40})(\/key)?$/);
    if (!m) return j({ error: "Not found." }, 404);
    if (req.method !== (m[2] ? "PUT" : "POST")) return j({ error: m[2] ? "Use PUT." : "Use POST." }, 405);
    const text = await req.text();
    if (text.length > 2048) return j({ error: "Too large." }, 413);
    let body: any; try { body = JSON.parse(text); } catch { return j({ error: "Bad JSON." }, 400); }
    const kv = kvOf(env.BUCKET);
    if (m[2]) {
      if (req.method !== "PUT") return j({ error: "Use PUT." }, 405);
      if (!env.REGISTER_SECRET || req.headers.get("x-register-secret") !== env.REGISTER_SECRET) return j({ error: "Not allowed." }, 403);
      const r = await registerKey(kv, m[1]!, String(body.publicKey ?? ""), body.profile === "fast" ? SAFETY_FAST : SAFETY_STANDARD);
      return r.ok ? j({ ok: true }) : j({ error: r.error }, 409);
    }
    if (req.method !== "POST") return j({ error: "Use POST." }, 405);
    const r = await publishControl(kv, m[1]!, body.message);
    return r.ok ? j(r) : j({ error: r.error }, r.status);
  },
};
