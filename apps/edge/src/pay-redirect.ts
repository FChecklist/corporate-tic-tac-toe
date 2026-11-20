// The old "Pay now" routes, kept behind the switch PAY_VIA_CONSOLE (go-live D3 of the console programme). Switch OFF (not "1"): this returns null and every old route behaves exactly as before.
// Switch ON: the routes that START a payment answer 302 to the console, which has the one Pay step. Nothing is deleted.
// NOT in the list on purpose: /api/payments/webhook and /api/payments/verify (money that is already paid must still be recorded) and /api/payments/status.
import { legacyPayRedirect } from "./console-bridge/bridge";

export const CONSOLE_HOME = "https://console.corporatetambola.com";
/** this game's own addresses that start a payment (the bridge's list already covers /pay.html, /paylink.html, /paytest.html and /api/z/<id>/paylink) */
export const PAY_ROUTES_EXTRA: RegExp[] = [
  /^\/api\/checkout$/,
  /^\/api\/payments\/(test|paytest)$/,
  /^\/api\/paylink\/[0-9a-f]{48}(\/checkout)?$/,
  /^\/api\/z\/[^/]+\/pay-with-credit$/,
];
export function payRedirect(req: Request, env: { PAY_VIA_CONSOLE?: string; CONSOLE_ORIGIN?: string }): Response | null {
  return legacyPayRedirect(req, { flag: env.PAY_VIA_CONSOLE, consoleOrigin: env.CONSOLE_ORIGIN || CONSOLE_HOME, extra: PAY_ROUTES_EXTRA });
}
