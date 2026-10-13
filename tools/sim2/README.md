# tools/sim2: the simulation environment

product rule and safety rules: `the rules at the top of this file`. This folder is plan items 1 to 6 plus the harness library scenarios are written with. **Nothing here touches the live site** except `parity.mjs` (plain GETs of public files). Never run `tests/e2e/run-live.mjs`, never `wrangler deploy/secret/write`. Ports: sim server **8801**, WhatsApp simulator **8890** (never 8799). Laptop rule: at most 6 Chrome contexts at once (`opener` refuses more), crowds go through `crowd.ts` (no browser).

## Commands (from `C:\ct\bingo`)

| What | Command |
|---|---|
| Parity report (schema, every built file vs live, git/hashes) -> `docs/SIM_PARITY_REPORT.md` | `node tools/sim2/parity.mjs` |
| Build the live copy once (`data-backup/live-export.sql` -> `sim/live-copy.sqlite`, pristine, never written by a run) | `bun tools/sim2/import-live.ts` |
| Sim server alone (rebuilds `pages/public` first; `SIM_BUILD=0` skips) | `bun tools/sim2/server.ts` |
| WhatsApp simulator alone | `bun tools/sim2/whatsapp/server.ts` |
| Whole smoke suite (about 1.5 minutes, 35 checks, screenshots in `sim/shots/`, results in `sim/smoke-result.json`) | `node tools/sim2/smoke.mjs` |
| A phone crowd against a running sim server (virtual time) | `bun tools/sim2/crowd.ts '{"eid":"...","startRound":N,"phones":30,"seed":"x"}'` |

Everything under `sim/` is git-ignored (`.gitignore`). `sim/run.sqlite` is the working copy of the database; `/__sim/reset` (or `stack.reset()`) makes a new one from `sim/live-copy.sqlite`.

If the server does not start with an import error, another agent is probably in the middle of an edit of `apps/edge/src` or `packages/*`: wait a minute and start again (the sim runs the working tree on purpose, so it sees what would be deployed).

## What the server does (`server.ts`)

- Runs the exact `handle()` from `apps/edge/src/worker.ts` plus the `pages/functions/api/telemetry.ts` function, on a copy of the live database, `STRICT_KEYS=1` with all five secrets set (sim values), `TEST_MODE=1`, **no** RESEND / RAZORPAY credentials, `OWNER_EMAIL=sim@example.com`, `PUBLIC_ORIGIN=http://localhost:8801`, `GOOGLE_CLIENT_ID` = the fake key set (`apps/edge/test/google-fake.ts`; `SIM_GOOGLE=0` turns it off like live). Site mode is TEST after every reset (`SIM_MODE=LIVE` or `POST /__sim/reset {"mode":"LIVE"}` keeps the live row); payments need TEST.
- Serves `pages/public` (output of `pages/build.mjs`, so you test what would deploy) like Cloudflare Pages: clean URLs (`/z.html` is a 308 to `/z`, query string kept), `_headers` rules (the real CSPs), `_routes.json` (`/api/*`, `/ai/*`, `/j/*` go to the Worker, incl. the `/j/<token>` Pages Function), `404.html`.
- The database: `db.ts` applies `SCHEMA` statement by statement and skips an `ALTER TABLE ... ADD COLUMN` whose column exists (the `duplicate column name: jr` restart problem of `apps/edge/src/local.ts`, fixed in the sim runner only). The statements that really changed the copy are returned (`schemaAdded`): that is "what the new code adds to live data", i.e. a migration rehearsal.
- **Mail**: no key means the Worker keeps every mail in the `outbox` table; the sink reads it. In TEST mode the owner allow-list applies, so use plus-addresses `sim+anything@example.com` (they count as `sim@example.com`) for every simulated user or the mail is suppressed and logged in `mail_event`.
- **Safety net**: a global `fetch` guard in the server process refuses any non-localhost request (`health.blockedFetches` must stay empty; the smoke asserts it).
- Per-phone addresses: send `x-sim-ip: 10.1.2.3` and the Worker sees that as `cf-connecting-ip` (per-address join caps behave per phone, not per laptop).

`/__sim/*` (local only):

| Route | Use |
|---|---|
| `GET /__sim/health` | ok, clock, blocked outbound fetches |
| `GET\|POST /__sim/clock` `{set: ms\|iso}` `{advance: ms}` `{freeze: true\|false}` `{reset: true}` | the Worker's `now` is `Date.now() + offset` (or the frozen value) |
| `POST /__sim/tick` `{}` or `{advance: ms, step: ms}` | runs the cron call `POST /api/lifecycle/tick` (with the cron key) at the simulated time; with `advance` it steps through the time (default step 60 s) |
| `GET /__sim/mail` (viewer), `GET /__sim/mail.json?to=&subject=&since=`, `DELETE /__sim/mail.json` | captured e-mail |
| `POST /__sim/reset` `{mode?}` | new run copy, clock back to real time |
| `POST /__sim/mode` `{mode}` | TEST / LIVE through the owner route (cache-correct) |
| `POST /__sim/sql` `{sql, params}` | SELECT only, for invariants |
| `GET /__sim/usage` , `GET /__sim/google-token?email=` | D1 write counters; a Google ID token signed by the fake key |

## Fake beacon (`lib/beacon.mjs`)

Real BLS signatures cannot be forged, so: data = deterministic `{round, signature, randomness = sha256(signature)}` per round and seed; trust = browsers get **patched copies** of the shipped bundles (`zgame.js`; the BLS `shortSignatures.verify` call replaced by true, served through a Playwright route, files on disk untouched) and the drand mirrors are answered by the route; bun phones get `verify: fakeVerify(seed)` and `fetcher: fakeFetcher(nowFn, seed)`. The simulated UTC decides which rounds exist ("latest"), so game time follows `/__sim/clock`.

## Harness library (`lib/index.mjs`)

```js
import * as H from "./tools/sim2/lib/index.mjs";
const stack = await H.startStack({ build: false });   // spawns sim server + WhatsApp simulator (reuses running ones); stack.reset(); stack.stop()
await stack.reset();                                  // fresh copy of the live DB, TEST mode, empty inboxes
const org = await H.Organizer.signUp("sim+a@example.com");   // or Organizer.signIn(email) via the mailed code
const g = await org.createGame({ leadMs: 3 * H.HOUR });      // {id, startRound, startMs}
await org.publish(g.id); await org.pay(g.id);                // test payment
const host = await org.inviteHost({ label: "Hema", mobile: "9812345678" });  // {hostKey, link, waLink}
await new H.Host(host.hostKey).firstOpen({ email: "sim+h@example.com", mobile: "9812345678" });
const guest = new H.Guest(H.SIM, g.id, "9876500001", "Asha"); await guest.join();
await H.clock.advanceWithTicks(2 * H.DAY, 5 * H.MIN);        // time travel with the cron's tick every simulated 5 minutes
```

| Module | Content |
|---|---|
| `env.mjs` | ports, paths, Playwright loader (junction in `node_modules` or `C:\ct\ct\node_modules`) |
| `stack.mjs` | `startStack`, `reset`, `stop` |
| `clock.mjs` | `clock.get/now/set/advance/freeze/unfreeze/reset/tick/advanceWithTicks`, `MIN/HOUR/DAY` |
| `api.mjs` | `call` (real HTTP), `Organizer`, `Host` (first-open flow), `Guest`, `Partner`, `platform`, `mailbox` (list/waitFor/code/links/clear), `sql`, `setSiteMode`, `googleToken`, `joinByToken`, `deviceOf`, `phoneOf` |
| `beacon.mjs` | fake beacon: `fakeRound`, `fakeVerify`, `fakeFetcher`, `patchBundle`, `routeBeacon` |
| `whatsapp.mjs` | `routeWhatsApp` (redirects wa.me / api.whatsapp.com to :8890), `pressSend`, `clickToWhatsApp`, `wa.inbox/waitFor/send/all/clear`, `openLinkAsRecipient` (new mobile context for the person who got the message) |
| `browser.mjs` | `launchChrome` (real Chrome), `trackClock`, `opener(browser, {track})` -> `open({device: mobile\|laptop\|wide\|tablet, ip, token, sender})` (internet blocked, fake beacon, WhatsApp redirect, role sign-in through `sessionStorage["cbz-org"]`, `page.clock` installed at the simulated time), `monitor` (JS/console errors, 5xx), `advanceBrowsers`, `playBrowserGame` (whole game in Chrome in seconds), `shot`, `measure` (overflow, text under 12 px) |
| `invariants.mjs` | `identicalWinners`, `perHouseMaxima`, `oneTicketPerPhone`, `noPersonalDataAfterErasure`, `emailOnlyToTeam`, `nobodyPaidTwice`, `writeBudget` -> `{name, ok, detail}` |

Moving time: `H.clock.advance(ms)` then `await track.refresh()` (beacon route) and, for open pages, `H.advanceBrowsers([ctx...], ms)`. New contexts install `page.clock` at the current simulated time automatically.

## WhatsApp simulator (`whatsapp/server.ts`, :8890)

Chat page `/chat?to=<digits>&text=<msg>&as=<sender>` with a SEND button (nothing is sent until pressed), inbox API `GET /api/inbox/<number>[?after=id]` (matches on the last 10 digits), `GET /api/all`, `DELETE /api/all`, `POST /api/send`, and a recipient "phone" page `/inbox/<number>` with tappable links.

## Phone crowds (`crowd.ts`)

N real `PhoneRuntime` instances over HTTP to the sim server in virtual time (server clock frozen and moved with the phones, 3 s per step): joins spread over the first minutes, 30% late joiners, 5% going offline, per-phone addresses. Winners come from the phones' own votes (the Worker accepts no organizer settlement). Output: one JSON line with log equality against the reference derived from the fake beacon, winner groups, failures. 30 phones finish in about 5 to 10 s.

## Known limits

- Cloudflare-side behaviour (HTTP caching, Pages edge, Web Analytics injection) is not simulated; static serving re-implements the documented rules.
- Sealed personal data in the live copy cannot be opened (live `DATA_KEY` is not here).
- The sim runs the working tree, so it fails to start while another agent leaves a module half-edited.
- `crowd.ts` does not model failing mirrors or liars ; it models offline phones and late joiners.
