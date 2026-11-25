// The one setting of the "notify me when this game begins" block, and what it does to the page's security rules.
// The setting is PUSH_API in apps/web/public/push-game.js (empty = dark). The build reads it from there, so there is no second copy to forget.
// While it is empty the game page's rules are exactly what they were: no push address anywhere. When it is a real https origin, ONLY connect-src of that page gets it,
// because the shared block (push-optin.js) asks the service for the public key and sends the browser's address with fetch. script-src stays 'self' and nothing else is widened.
const ORIGIN = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?$/;

/** The push address written in push-game.js ("" when it is empty, missing or not a real https origin). */
export function pushApiOf(source) {
  const m = /\bvar PUSH_API = "([^"]*)";/.exec(String(source));
  return m && ORIGIN.test(m[1]) ? m[1] : "";
}

/** The page's rules with the push address added to connect-src, or unchanged while the address is empty. */
export function withPushConnect(csp, api) {
  if (!ORIGIN.test(api || "")) return csp;
  if (!/connect-src [^;]*/.test(csp)) throw new Error("push-csp: the rules have no connect-src to add the push address to");
  return csp.replace(/connect-src ([^;]*)/, (_m, v) => `connect-src ${v} ${api}`);
}
