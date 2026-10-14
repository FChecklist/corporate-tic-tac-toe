# The owner's desk (Corporate Tic Tac Toe)

Everything here is for the owner only. It uses the platform key (`ORGANIZER_SECRET`), sent as the header `x-organizer`. Anyone else, and any AI work link, gets the same "Not found" (404) as for an address that does not exist, and the try is written to the access log. The page `owner-visits.html` has an "Owner desk" part with a button for each.

| What | Address | Test |
|---|---|---|
| Site switch (A5) | `GET /api/owner/site`, `POST /api/owner/site {"off": true, "note": "..."}` (false switches it on) | `apps/edge/test/admin.test.ts` "A5" |
| Organizer lookup (A3) | `GET /api/owner/organizer?email=name@company.com` - their games: id, state, start, paid, created | "A3" |
| Data requests (A6) | `GET /api/owner/data-requests?status=open\|done\|all`, `POST /api/owner/data-requests {"id": "...", "action": "close"}` | "A6" |
| Errors (A7) | `GET /api/owner/errors` (by hour), and the public `GET /api/status/health` -> `{ok, errors_last_hour, threshold, overdue_purge, overdue_hours, maintenance}` | "A7", "A7b" |
| Mail events (E12) | `GET /api/owner/mail-events?event=bounced` | "E12" |

## The site switch

While it is ON every page and address that reaches the Worker answers a plain 503 "Back soon" (a page for a browser, JSON for anything else). These keep working: `/api/mode`, `/api/owner/*`, `/api/status/health`, `/api/lifecycle/tick` (the 24-hour deletion), the payment webhook, the mail webhook and the inbound-mail webhook. A page that makes a call to the Worker gets a "Back soon" cover from `rum.js`. Files Cloudflare serves by itself (for example the Terms page) do not go through the Worker and keep showing. If the switch cannot be read from the database the site stays up.

## Error signal

Every 5xx answer is counted in a 10-minute bucket in the `kv` table (`err/...`). `GET /api/status/health` reports the last 60 minutes. The scheduler's uptime check (`FChecklist/scheduler`, `.github/workflows/uptime.yml`, every 15 minutes) calls it for each game and fails above 20 errors in an hour; GitHub then e-mails the owner. Old counters are removed by the tick after 48 hours.

## The 24-hour deletion alarm (A7b)

The health read also counts `overdue_purge`: tournaments that are more than 30 minutes past their 23-hour deletion and still hold players' details (a tournament under a legal hold is left out; a tournament the tick has never looked at is found from its scheduled start). When it is above 0, `ok` is `false` and `overdue_hours` says how long the oldest has waited; the same uptime check fails on `ok: false` and GitHub e-mails the owner. Look at the `game-ticks` schedule first (`cron.job_run_details`), then run `POST /api/lifecycle/tick` by hand with the platform key. The same tick forgets mail-log rows older than 3 days every hour.

## Mail bounce log - owner steps

The address `POST /api/mail/events` answers 404 until the owner has done both:

1. In Resend, Webhooks, add `https://<this site>/api/mail/events` for the events `email.bounced`, `email.complained`, `email.delivered` (and `email.delivery_delayed`, `email.failed` if wanted). Copy the signing secret (it starts with `whsec_`).
2. Set it on this site as the Pages secret `RESEND_WEBHOOK_SECRET` (Cloudflare dashboard, Workers & Pages, this project, Settings, Variables and Secrets).

Each event is checked against its signature (Svix style, five minutes of tolerance) and stored once in `mail_bounce` with the address hashed and masked (`j***@example.com`). Rows are deleted after 90 days.

## Names of secrets

`config/SECRETS_NAMES.md` lists every secret and setting by name. `apps/edge/test/secrets-list.test.ts` fails when the code reads a name that is not listed.
