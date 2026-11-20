# Changelog - Corporate Tic Tac Toe

Newest first. Each entry: what changed, where, PR, audits, rollback id.

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
