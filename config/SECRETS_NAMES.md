# Secrets and settings of Corporate Tic Tac Toe (names only)

This file lists the NAME of every secret and setting that the website's Worker (`apps/edge`), the Pages functions (`pages/functions`) and the scheduled job (`apps/cron`) read, what each is for, and where it is set. **It never holds a value.** `apps/edge/test/secrets-list.test.ts` fails when the code reads a name that is not listed here, when a listed name is no longer read anywhere, and when a row looks like it holds a value.

Where things are set:

* **Pages secret**: Cloudflare dashboard, Workers & Pages, corporate-tic-tac-toe, Settings, Variables and Secrets (or `wrangler pages secret put NAME --project-name corporate-tic-tac-toe`). Never in git. The owner's own copy of the values is the git-ignored `config/live-secrets.txt`.
* **wrangler var**: written in `pages/wrangler.toml` under `[vars]` (not secret, public in git).
* **Binding**: a Cloudflare resource attached in `pages/wrangler.toml`.
* **Cron secret**: set on the scheduled job with `wrangler secret put CRON_KEY` (folder `apps/cron`).

| Name | What it is for | Where it is set | Kind |
|---|---|---|---|
| `DB` | The D1 database (all game, organizer and payment records) | Binding in `pages/wrangler.toml` | binding |
| `DATA_KEY` | Seals names and mobile numbers at rest (AES-256-GCM); never stored in the database | Pages secret | secret |
| `PHONE_SALT` | Salt for the one-way hash of mobile numbers | Pages secret | secret |
| `ORGANIZER_SECRET` | The platform (owner) key: opens every `/api/owner/*` address and the owner's tools | Pages secret | secret |
| `CRON_KEY` | The scheduled job's own key: it can call only `/api/lifecycle/tick` | Pages secret and Cron secret (same value) | secret |
| `INBOUND_SECRET` | Shared secret of the mail service's inbound webhook (e-mail to us asking for a deletion) | Pages secret | secret |
| `VISIT_KEY` | Key that hashes network addresses for first-party public-page visit counts | Pages secret | secret |
| `VISIT_DAILY_WRITES` | Most visit-count writes per day (a cap) | Optional Pages variable | setting |
| `REPORT_KEY` | Key to read the first-party error and speed reports (`/api/telemetry`) | Pages secret | secret |
| `RESEND_API_KEY` | Sends e-mail through the mail service (sign-in codes, invoices, reports, notes to the owner) | Pages secret | secret |
| `RESEND_WEBHOOK_SECRET` | Checks the signature of the mail service's bounce / complaint / delivery webhook (`POST /api/mail/events`); with no value that address answers 404 | Pages secret | secret |
| `RAZORPAY_KEY_ID` | Razorpay key id, when this site takes payments itself | Pages secret | secret |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret, when this site takes payments itself | Pages secret | secret |
| `RAZORPAY_WEBHOOK_SECRET` | Checks the signature of Razorpay's payment webhook | Pages secret | secret |
| `RAZORPAY_BASE_URL` | Razorpay API address (tests only; the live default is Razorpay's own) | Optional Pages variable | setting |
| `RAZORPAY_INTERNATIONAL` | "1" once international cards are enabled in Razorpay | Optional Pages variable | setting |
| `PAY_SERVICE_KEY` | Key for the central payment ledger service (orders and figures are reported there) | Pages secret | secret |
| `PAY_SERVICE_URL` | Address of the central payment ledger service | Optional Pages variable | setting |
| `PAY_SITE` | The name this site goes by in the central ledger | Optional Pages variable | setting |
| `PAY_HOP_URL` | The payment page on the website registered with Razorpay | wrangler var | setting |
| `PUBLIC_ORIGIN` | The public web address of this site (links in mails, payment return) | wrangler var | setting |
| `MAIL_FROM` | The sender name and address of every mail | wrangler var | setting |
| `MAIL_REPLY_TO` | Reply-to address of mails (optional) | Optional Pages variable | setting |
| `OWNER_EMAIL` | The owner's address on the TEST-mode allow-list | wrangler var | setting |
| `OWNER_NOTIFY_EMAIL` | Overrides the address that gets the note on each paid order and each data request | Optional Pages variable | setting |
| `TEST_MAIL_ALLOW` | Extra addresses TEST mode may mail (comma separated) | Optional Pages variable | setting |
| `COMPANY_JSON` | Company details shown on invoices and the contact page (public) | wrangler var | setting |
| `TEST_MODE` | "1" lets a local or test run show codes instead of mailing them; never set on the live site | Local and test runs only | setting |
| `FREE_LAUNCH` | "1" lets small games be made without payment | Optional Pages variable | setting |
| `PARTNER_COMMISSION_RATE` | Partner commission rate | Optional Pages variable | setting |
| `DAILY_WRITE_BUDGET` | Most database writes the Worker allows itself per day | wrangler var | setting |
| `STRICT_KEYS` | "1" on the live site: the Worker refuses every request unless the required secrets are set | Pages variable | setting |
| `JOIN_PER_IP_DAY` | Joins one network address may make per day (default in code) | Optional Pages variable | setting |
| `JOIN_PER_IP_MINUTE` | Joins one network address may make per minute (default in code) | Optional Pages variable | setting |
| `GOOGLE_CLIENT_ID` | Google sign-in client id (public, not a secret); without it the Google button is off | Optional Pages variable | setting |
| `CONTROL_R2` | Optional R2 bucket holding the static copy of the pause file | Optional binding | binding |
| `CONTROL_BASE` | Optional public address of that bucket | Optional Pages variable | setting |
| `ANALYZE_AI_URL` | Optional chat endpoint the owner's analyze route may send masked totals to | Optional Pages variable | setting |
| `ANALYZE_AI_KEY` | Key for that endpoint | Optional Pages secret | secret |
| `ANALYZE_AI_MODEL` | Model name for that endpoint | Optional Pages variable | setting |
| `TARGET` | The scheduled job: the web address it calls | `apps/cron/wrangler.toml` | setting |
