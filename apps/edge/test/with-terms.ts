// Test helper: calls the real Worker, but first does what a person does on the page: ticks the boxes the action needs (consent.ts).
// The server refuses every one of these actions without the ticks (consent.test.ts uses the REAL handle and proves it), so the older tests use this wrapper
// instead of repeating `consent: {...}` in hundreds of requests. A request that already carries `consent` is passed on untouched.
// A Co-host key also has to have accepted the role before it can do anything; the wrapper records that tick the first time such a key is used.
import { handle as realHandle, type Env } from "../src/worker";
import { CONSENT_VERSION, boxesOf, recordConsent, type Kind as ConsentKind } from "../src/consent";

export const termsFor = (kind: ConsentKind) => consentFor(kind);
export const consentFor = (kind: ConsentKind) => ({ v: CONSENT_VERSION, boxes: boxesOf(kind).map(([id]) => id) });

function kindFor(method: string, path: string, body: any): ConsentKind | null {
  if (method !== "POST") return null;
  if (path === "/api/start" || path === "/api/auth/email") return "K2";
  if (path === "/api/auth/google") return body?.intent === "host" ? "K5" : "K2";
  if (path === "/api/checkout" || path === "/api/payments/test" || path === "/api/payments/paytest" || /^\/api\/paylink\/[0-9a-f]{48}\/checkout$/.test(path)) return "K3";
  if (path === "/api/host/setup/email" || path === "/api/org/role/accept") return "K5";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/publish$/.test(path)) return "K1";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/join$/.test(path)) return "K4";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/(roster|people)$/.test(path)) return "K6";
  return null;
}
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

export async function handle(req: Request, env: Env, now?: number): Promise<Response> {
  const path = new URL(req.url).pathname;
  const key = req.headers.get("x-organizer");
  if (key && env.DB) { // a Co-host who has "accepted" before using the console
    const kh = await sha("key|" + key);
    const row = await env.DB.prepare("SELECT kind FROM organizer_key WHERE hash=? AND revoked=0").bind(kh).first<{ kind: string }>().catch(() => null);
    if (row?.kind === "cohost") {
      const subject = "c:" + kh.slice(0, 16);
      if (!(await env.DB.prepare("SELECT 1 AS x FROM consent_log WHERE subject=? AND kind='K5' AND version=?").bind(subject, CONSENT_VERSION).first())) await recordConsent(env.DB, { subject, kind: "K5", ref: null, now: now ?? Date.now() });
    }
  }
  if (req.method === "POST") {
    const text = await req.clone().text();
    let b: any = null; try { b = JSON.parse(text); } catch { b = null; }
    const k = kindFor(req.method, path, b);
    if (k && b && typeof b === "object" && !Array.isArray(b) && !b.consent) {
      const headers = new Headers(req.headers); headers.delete("content-length");
      return realHandle(new Request(req.url, { method: req.method, headers, body: JSON.stringify({ ...b, consent: consentFor(k) }) }), env, now);
    }
  }
  return realHandle(req, env, now);
}
