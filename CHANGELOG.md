# Changelog - Corporate Tic Tac Toe

Newest first. Each entry: what changed, where, PR, audits, rollback id.

## 1.4.1 - 2026-11-22
Fixes found before the first audit of PR 9. Nothing is deployed and no payment switch is on.
### Fixed
- The full test suite now passes except two page tests that also fail on `master` (they use calendar dates that have passed: "Create a new game like this one" and "Rescheduling") and one owner-test-account test that fails on `master` because its end date (8 Nov 2026) has passed. The five tests this PR had broken are fixed: a migration file for the console payment table (`apps/edge/migrations/0031_console_paid.sql`), the new setting name in `config/SECRETS_NAMES.md`, a help entry for "This sign-in is for one game only", the AI-link test list, and the "no internal notes" test (the vendored `pack/` folder is skipped; its CSS class `todo` is not a note).
- Security: a console sign-in made for one game could make the Worker throw an error by opening an address with a broken `%` escape (`scopedKeyMayCall`). It is now simply refused. Test: `apps/edge/test/console-security.test.ts`. The same test file keeps the money switches (`PAY_VIA_CONSOLE`, `CONSOLE_PUBKEYS`) off in every shipped config.
### Changed (owner rules v1.1)
- Employee IDs: one way to read them everywhere (letters and numbers only, capitals, up to 30): `A-1101`, `A 1101`, `A/1101` and `a1101` are one person - `apps/edge/src/people.ts`. **Heads-up for games made before this version:** an ID stored with a dash, dot or slash was hashed with the old reading and no longer matches what a person types; ask those organizers to add the list again.
- Organizer and host screens speak to "you": no I, me, my, we, us, our - `apps/web/public/zc.js`, `signin.js`. Kept by `apps/web/test/owner-rules.test.ts`.
- Money is written with the rupee sign.
- One privacy line and one fairness sentence on the organizer screen, each with one wording. The fairness sentence is proved by a test (the fingerprint is published first, the seed is checkable, the same seed gives the same draw).
- No forbidden claims on those screens (checked by the same test).
- Version 1.4.1: `version.json`, `package.json`, `apps/edge/src/releases.json`, `docs/KNOWLEDGE.md`.
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: pending (two required before merge). Deploy: not done. Rollback id: none (not deployed).

## 1.4.0 - 2026-11-20
### Added
- The console's Pay step: `payInfo` (read only) and a repeatable `markPaid` (owner and size re-checked, definite refusal when wrong, no-op when already paid, unlock and records in one batch) - `apps/edge/src/console-adapter.ts`. The only unlock of the start for a console payment. Switched off until the owner turns on the console's payment.
- Descriptor `payGame: "tictactoe"` and `consoleOrigin` - `apps/web/public/zc-flow-game.js` (not loaded by any page yet).
- `PAY_VIA_CONSOLE`: off = the old Pay now exactly as before; `"1"` = routes that start a payment answer 302 to the console (webhook, verify, status never) - `apps/edge/src/pay-redirect.ts`, `apps/edge/src/worker.ts`, `pages/functions/_middleware.ts`.
- Security rules: the organizer page `/zc` may frame the payment window and connect to the console, no wildcard - `pages/build.mjs`.
- Tests: `apps/edge/test/console-pay-step.test.ts`. Doc: `docs/CONSOLE_PAY_STEP.md`.
### Changed
- Bridge, contract kit and game pack re-vendored byte for byte from the console repo (`apps/edge/src/console-bridge/`, `apps/edge/test/console-contract/`, `apps/web/public/pack/`). This branch also carries the earlier, never-merged console bridge work (5 commits from the local branch `console/bridge`: the adapter, migration 0030, hand-off page).
- The console's game list shows a game paid through the console as paid (`cpaid/` record).
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: pending (two required before merge). Deploy: not done. Rollback id: none (not deployed).
