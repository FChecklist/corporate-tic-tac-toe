# Knowledge: Corporate Tic Tac Toe (corporate-tic-tac-toe)

Written 20 Nov 2026 for a future AI session that has never seen this repo (standard: marketing-ledger plans/VERSION-AND-KNOWLEDGE-STANDARD-2026-11-20.md). It describes the CURRENT state only, from the code and existing docs. Anything not found is marked "unknown". Do not publish this file on the website.

## 1. What this is
Knockout tic-tac-toe tournaments for teams, up to 10,000 players.
- Live site: https://tictactoe.corporatetambola.com (Cloudflare Pages project `corporate-tic-tac-toe`). Live version now (from `/version.json`, read 20 Nov 2026): **unknown (no version field in /version.json yet)**, commit `fa5ab0afa895`, built 2026-11-05 17:25 UTC.
- Other repos and what they are for: `KNOWLEDGE-MAP.md` in the repo root.

## 2. How it connects
Players and organizers reach the suite like this: home.corporatetambola.com (login gate) -> console.corporatetambola.com (set up, invite, pay) -> moneypenny.corporatetambola.com (credits; the single payment gate) -> IT Services by Rajat Agarwal -> Razorpay. Each game is its own website and takes settings from the console by API; a game calls ONLY Moneypenny for payment, never IT Services or Razorpay. The console-to-game contract is `docs/CONTRACT_V1.md` and `contract/` in corporate-console; the pay contract is `GAME_PAY_CONTRACT.md` (in the console pay-step branch: unknown on the default branch). Moneypenny chat: moneypennychat.corporatetambola.com.

## 3. Map of folders and the files that matter
apps/edge (pay.ts, paylink.ts, people.ts, lifecycle.ts, ledger.ts, ai-*.ts, migrations up to 0029_game_record.sql), apps/web/public, apps/cron, packages/ttt (the tic-tac-toe rules and browser bundle), packages/beacon, packages/billing, packages/shared, pages/, tools/ (control-worker, sim2, browser-tests), docs/, prototype/.

Files that matter: packages/ttt/src (game rules); apps/edge/src/pay.ts; apps/edge/src/people.ts; apps/edge/src/lifecycle.ts; pages/version.mjs; docs/DEPLOYS.md.

## 4. Rules in force
- Suite rules version 1.1 (20 Nov 2026): `docs/SUITE_RULES.md` (on branch docs/suite-rules-v1-1-2026-11-20 until merged); source in the ledger `plans/SUITE-RULES-VERSION-2026-11-20.md`.
- One login (home), one console, one credit/payment system (Moneypenny), one chatbot system; no game or console has its own login, payment or chat; pay only via Moneypenny.
- Invite by ID only: one alphanumeric ID field, no names or personal details; strip every non-alphanumeric and uppercase before matching; not-on-list people need organizer/host approval; optional family invites (default 4) with approval.
- Console voice = "you", polite, simple English; privacy line "designed to follow US privacy laws, EU GDPR and India's DPDP"; all participant information including IDs deleted within 24 hours after the game; billing line only "We keep billing data for audit and tax reasons."
- Fairness wording: "No one knows the next number: not the organizer, not the host, not even the software." Prices with the rupee sign. Prizes: "You (the company) give the prizes directly to the winners."
- Do not claim "100% secure", "most secure gateway", "played by major companies".

## 5. How to run the tests
`bun test packages apps tools/control-worker`; `tsc --noEmit -p tsconfig.json`. Heavy runs under the heavy lock.
RAM on the owner's laptop is tight: no full builds or browsers without the heavy lock (C:/ct/HEAVY_JOB_PROTOCOL.md).

## 6. Deploy and roll back
Cloudflare Pages project corporate-tic-tac-toe. Rollback in the Cloudflare dashboard; previous deploy id: unknown.
Nothing is deployed from a docs-only change. Cloudflare only, no Vercel. Every deploy needs a version bump and a CHANGELOG entry (standard section 1).

## 7. Known issues and open failures
unknown (no smoke failure map found). The default branch name is master, but a local folder may sit on another branch.

## 8. Owner-only steps still open
Secrets and keys are the owner's (names only in config/SECRETS_NAMES.md where present). Deploy, domain, payment live mode and the Rs 1 payment test are the owner's decisions via BOSS. Versioning work still to do in this repo: `docs/VERSIONING-TODO.md`.
