// Clock helpers. The server clock is `Date.now() + offset` (or frozen); browsers follow through Playwright's page.clock (see browser.mjs syncBrowserClock).
import { SIM } from "./env.mjs";
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const post = async (path, body = {}) => (await fetch(SIM + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
export const clock = {
  /** { now, iso, offsetMs, frozen } */
  get: async () => (await fetch(SIM + "/__sim/clock")).json(),
  now: async () => (await clock.get()).now,
  set: (msOrIso) => post("/__sim/clock", { set: msOrIso }),
  advance: (ms) => post("/__sim/clock", { advance: ms }),
  freeze: () => post("/__sim/clock", { freeze: true }),
  unfreeze: () => post("/__sim/clock", { freeze: false }),
  reset: () => post("/__sim/clock", { reset: true }),
  /** One lifecycle tick (the cron Worker call) at the simulated time. */
  tick: () => post("/__sim/tick", {}),
  /** Advance `ms` of simulated time, ticking every `step` ms (default one simulated minute): exactly what the real cron does. */
  advanceWithTicks: (ms, step = MIN) => post("/__sim/tick", { advance: ms, step }),
};
