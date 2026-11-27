// The old "Pay now" routes, kept behind the switch PAY_VIA_CONSOLE (go-live D3 of the console programme). Switch OFF (not "1"): this returns null and every old route behaves exactly as before.
// Switch ON: the pay pages answer 302 to the console, which has the one Pay step; the pay routes of the API answer 410 (gone) with the console's address. Nothing is deleted.
// NOT in the list on purpose: /api/payments/webhook (money that is already paid must still be recorded) and /api/payments/status.
import { legacyPayRedirect } from "./console-bridge/bridge";

export const CONSOLE_HOME = "https://console.corporatetambola.com";
/** this game's own addresses that start a payment (the bridge's list already covers /pay.html, /paylink.html, /paytest.html and /api/z/<id>/paylink) */
export const PAY_ROUTES_EXTRA: RegExp[] = [
  /^\/api\/(checkout|proforma)$/,
  /^\/api\/payments\/(test|paytest|verify)(\/|$)/,
  /^\/api\/paylink\/[0-9a-f]{48}(\/checkout)?$/,
  /^\/api\/z\/[^/]+\/(paylink|credit|apply-credit|pay-with-credit)(\/|$)/,
  /^\/api\/org\/credit(\/|$)/,
];
/** A page goes to the console (302). A program (/api/...) gets 410 (gone) and the console's address: this game takes no payment itself while the switch is on (1.6.5). */
export function payRedirect(req: Request, env: { PAY_VIA_CONSOLE?: string; CONSOLE_ORIGIN?: string }): Response | null {
  const origin = env.CONSOLE_ORIGIN || CONSOLE_HOME;
  const r = legacyPayRedirect(req, { flag: env.PAY_VIA_CONSOLE, consoleOrigin: origin, extra: PAY_ROUTES_EXTRA });
  if (!r) return null;
  if (!new URL(req.url).pathname.startsWith("/api/")) return r;
  return new Response(JSON.stringify({ error: "Payment is made in your console now. Please open your console and press Pay.", code: "pay-in-console", console: origin.replace(/\/$/, "") + "/" }), { status: 410, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
