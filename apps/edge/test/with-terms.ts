// Test helper: calls the real Worker, but first does what a person does on the page: ticks the consent boxes the action needs (consent.ts, Part D of the legal note).
// The server refuses every one of these actions without the ticks (consent.test.ts imports the REAL handle and proves it), so the older tests use this wrapper
// instead of repeating `consent: {...}` in hundreds of requests. A request that already carries `consent` is passed on untouched.
import { handle as realHandle, type Env } from "../src/worker";
import { CONSENT_VERSION, boxesOf, type Kind } from "../src/consent";

export const termsFor = (kind: Kind) => ({ v: CONSENT_VERSION, boxes: boxesOf(kind).map(([id]) => id) });

function groupFor(method: string, path: string, body: any): Kind | null {
  if (method !== "POST") return null;
  if (path === "/api/start" || path === "/api/auth/email") return "K2";
  if (path === "/api/auth/google") return body?.intent === "host" ? "K5" : "K2";
  if (path === "/api/checkout" || path === "/api/payments/paytest" || path === "/api/payments/test" || /^\/api\/paylink\/[0-9a-f]{48}\/checkout$/.test(path)) return "K3";
  if (path === "/api/host/setup/email") return "K5";
  if (path === "/api/org/role/accept") return "K5";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/publish$/.test(path)) return "K1";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/join$/.test(path)) return "K4";
  if (/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/(roster|people)$/.test(path)) return "K6";
  return null;
}

export async function handle(req: Request, env: Env, now?: number): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (req.method === "POST") {
    const text = await req.clone().text();
    let b: any = null; try { b = JSON.parse(text); } catch { b = null; }
    const g = groupFor(req.method, path, b);
    if (g && b && typeof b === "object" && !Array.isArray(b) && !b.consent) {
      const headers = new Headers(req.headers); headers.delete("content-length");
      return realHandle(new Request(req.url, { method: req.method, headers, body: JSON.stringify({ ...b, consent: termsFor(g) }) }), env, now);
    }
  }
  return realHandle(req, env, now);
}
