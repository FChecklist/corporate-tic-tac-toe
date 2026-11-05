// Funnel events: the one shared way every game site reports where people get to, for the internal statistics store.
// First-party only (same-origin path), no personal details (a fixed list of fields, values checked), Global Privacy Control respected, nothing stored on the device.
export const FUNNEL_EVENTS = ["viewed", "size_chosen", "signup_started", "game_created", "game_published", "payment_page_reached", "payment_page_opened", "payment_link_copied", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
/** The only fields an event may carry. Anything else is dropped. */
export interface FunnelProps { game?: string; size?: number; mode?: "auto" | "manual"; reason?: "declined" | "cancelled" | "error" | "timeout" }
export interface FunnelPayload extends FunnelProps { event: FunnelEvent; at: number; visit: string }
const WORD = /^[a-z0-9_-]{1,24}$/;
const PERSONAL = /@|\d{6,}/; // an e-mail or a long run of digits (a mobile or an ID) never leaves the device
/** Keep only the allowed fields with safe values. */
export function cleanProps(p: Record<string, unknown> = {}): FunnelProps {
  const o: FunnelProps = {};
  if (typeof p.game === "string" && WORD.test(p.game) && !PERSONAL.test(p.game)) o.game = p.game;
  if (typeof p.size === "number" && Number.isFinite(p.size) && p.size >= 0 && p.size <= 1_000_000) o.size = Math.floor(p.size);
  if (p.mode === "auto" || p.mode === "manual") o.mode = p.mode;
  if (p.reason === "declined" || p.reason === "cancelled" || p.reason === "error" || p.reason === "timeout") o.reason = p.reason;
  return o;
}
/** Global Privacy Control: when the browser says so, no navigation data is collected. */
export const gpcOn = (nav?: { globalPrivacyControl?: boolean }): boolean => nav?.globalPrivacyControl === true;
/** The endpoint must be a path on the same site (first-party): "/stats/e", not another host. */
export const firstPartyEndpoint = (e: string): boolean => /^\/(?!\/)[\w./-]*$/.test(e);
export interface ReporterOptions {
  endpoint: string;                       // same-origin path
  game: string;                           // game id, added to every event
  nav?: { globalPrivacyControl?: boolean; sendBeacon?: (url: string, data: string) => boolean };
  send?: (endpoint: string, body: string) => void; // default: sendBeacon, else fetch without cookies
  now?: () => number;
}
/**
 * `report("viewed")`, `report("size_chosen", { size: 200 })`. Returns false when nothing was sent (GPC on, bad endpoint, unknown event).
 * `visit` is a random id kept only in memory for this page load, so steps of one visit can be joined; it is never stored and says nothing about a person.
 */
export function makeReporter(o: ReporterOptions): { report(event: FunnelEvent, props?: Record<string, unknown>): boolean; visit: string } {
  const visit = Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  const nav = o.nav ?? (typeof navigator !== "undefined" ? (navigator as unknown as ReporterOptions["nav"]) : undefined);
  const send = o.send ?? ((url: string, body: string): void => {
    if (nav?.sendBeacon) { nav.sendBeacon.call(nav, url, body); return; }
    void fetch(url, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "content-type": "application/json" } });
  });
  return {
    visit,
    report(event, props) {
      if (gpcOn(nav) || !firstPartyEndpoint(o.endpoint) || !(FUNNEL_EVENTS as readonly string[]).includes(event)) return false;
      const payload: FunnelPayload = { event, at: (o.now ?? Date.now)(), visit, ...cleanProps({ game: o.game, ...props }) };
      send(o.endpoint, JSON.stringify(payload));
      return true;
    },
  };
}
