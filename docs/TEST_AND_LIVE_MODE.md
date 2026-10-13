# TEST and LIVE mode (as built, 2026-10-06, checked against Corporate Tic Tac Toe 2026-10-13)

One switch, kept in the database, lets the owner walk the whole product end to end (make a tournament, join, play, pay, get the report) without touching real people or real money. Code: `apps/edge/src/mode.ts`, `test-data.ts`; migration `0013_test_live_mode.sql`.

**LIVE is the default and changes nothing.** A database that has not had migration 0013 behaves as LIVE (the mode cannot be read), but the new code needs the migration's `is_test` columns, so apply it before deploying.

## What TEST does

| | In TEST |
|---|---|
| Records | Tournaments (engagements in the database), organizer accounts (and all their keys), partners and payments made meanwhile carry `is_test = 1`. A tournament made by a real account while TEST is on is a test tournament; every tournament of a test account is a test one. |
| E-mail | **Every** outbound mail (start, publish, reminders, reports, pay links, partner codes, sign-in codes) goes only to the owner's allow-list. Anything else is dropped and logged as `suppressed_test_mode` (table `mail_event`: a hash of the address, never the address). Allowed mails get `[TEST] ` in the subject. Mail queued before the switch is not retried while TEST is on. |
| Allow-list | Default: the owner's address from configuration (`OWNER_EMAIL`, else `TEST_MAIL_ALLOW`, else the company e-mail in `COMPANY_JSON`). The owner can replace it (table `test_mail_allow`); when it has entries it is used instead of the default. `owner+anything@domain` counts as `owner@domain`, so many test accounts can share one inbox. |
| Payments | No Razorpay order is made. `POST /api/payments/test` (and the normal checkout while TEST is on) marks the payment paid at once, flagged `is_test`, publishes the draft it was made for, and issues a **TEST invoice** (`TEST-<year>-n`, negative sequence, marked draft) that never uses a number of the real series. In LIVE `POST /api/payments/test` answers 403. |
| Reports | Visitor reports, funnels, commission figures and the owner's lists show LIVE data unless `?mode=test` is asked for. Test visits are stored with `is_test`, a private (GPC) test visit leaves no counter, test accounts never move the funnel or claim a real visitor's earlier visits, and the 365-day sweep forgets test visits without adding them to the anonymous totals. A test commission is invisible to the real partner. |
| Console | A calm "TEST MODE" notice at the top of the organizer console (`zc.html`) only. Never on public pages, the payment page, the player page (`z.html`), the big screen (`big.html`), the host page (`host.html`), the report page, or in an e-mail body. |
| Game | The sealed seed, the bracket, the move clocks, the winners and every rule in `docs/RULES.md` are exactly the same. A test tournament plays like a real one. |

## The owner's calls (platform key in `x-organizer`; never through an AI work link; anyone else gets the same 404 as an unknown address, and the try is on the access log)

* `GET /api/mode` is public and read-only: `{"mode":"TEST"}` or `{"mode":"LIVE"}`.
* `GET /api/owner/mode`, `POST /api/owner/mode {"mode":"TEST"|"LIVE","reason":"..."}`. Every switch is written to `audit_access` as `mode-switch` (`LIVE->TEST: reason`). The mode is read at most every 5 seconds per Worker instance; the instance that handled the switch sees it at once.
* `GET /api/owner/test-mail`, `POST /api/owner/test-mail {"add":"a@b.com"}` or `{"remove":"a@b.com"}`.
* `POST /api/owner/purge-test-data {"confirm":"purge test data"}` deletes every test tournament (with all its rows, sealed personal data and shred keys), test accounts and keys, test payments, invoices and entitlements, test partners and commissions, and test visits. It does **not** delete the append-only internal audit log (`audit_log`, `audit_stats`, `audit_cert`), the access log, or any real record. The purge is one line in the access log (`purge-test-data`). Safe to repeat. Switching to LIVE reminds the owner if test records are left.

## Running the local tools and tests against TEST

* Tests: `import { setMode } from "../src/mode"; await setMode(env, "TEST", "why", now)` (or call the owner endpoint with the platform key).
* Local server and the simulation (`tools/sim2`): `CB_MODE=TEST bun run apps/edge/src/local.ts`, or `startLocal({ mode: "TEST" })`. With no `CB_MODE` everything runs in LIVE. The tournament test (`apps/edge/test/tournament.test.ts`) and `tools/sim2/bracket-sim.ts` run against the real routes with a fake clock. Set `OWNER_EMAIL` (or add an address through the owner endpoint) to read the mails a TEST run sends; the rest are logged and dropped. In the local outbox (no mail key) allowed mails stay readable as before.
* The older `TEST_MODE=1` environment variable (local only; it fulfils payments without Razorpay and returns sign-in codes in the answer) is a separate switch and is unchanged. Do not set it on the live site.

## Not covered

* Anything that sends outside `sendMail` / `sendReportMail` (there is nothing else today); a new sender must use them.
* Visit numbering (`visit_no`) counts test and real sessions of the same browser together.
* The internal audit log keeps its rows for test tournaments until the normal 365-day rule removes them. The 23-hour deletion of players' names applies to a test tournament in the same way.
* There is no live site yet. LIVE is the default of the code, but nothing is deployed, so today every run is local.
