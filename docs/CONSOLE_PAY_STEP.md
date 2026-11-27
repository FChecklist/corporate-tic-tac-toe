# Console Pay step in Corporate Tic Tac Toe (20 Nov 2026)

The console (console.corporatetambola.com) shows the one Pay step; this game only answers two questions and unlocks its own start. Contract: `docs/GAME_PAY_CONTRACT.md` in the console repository. **Nothing here is deployed and no switch is on.**

- `payInfo(eid, sub)` (read only, `apps/edge/src/console-adapter.ts`): `owner` is true only for the game's ORGANIZER (an organizer account of the game's own org; a Host, a Co-host or a stranger is not), `item` is the game's size as a string, `paid` is true when the game is paid.
- `markPaid(eid, sub, item, orderRef, nowMs)`: repeatable. Owner and size are checked again; a wrong owner, a wrong size, a closed game or the free size is refused with `{definite:true}` and nothing changes. A game that is already paid returns at once and changes nothing. "Paid" in this game means `engagement.pack <> 0`: while it is 0 a published game is held at its start time, so setting it is the only unlock. It is set to the smallest listed size that holds the game, in one batch with the records (`pub/`, `cpaid/` with the order reference, `paidby/`), so a half-done call leaves nothing half there. A game that was already past its start time begins 2 minutes after the payment (the same rule as the old checkout).
- Descriptor: `apps/web/public/zc-flow-game.js` (`payGame: "tictactoe"`, `consoleOrigin`). It is not in the Pages build list yet and the organizer page does not load the shared flow yet (that is the game's own console work, wave 2 of the console programme).
- `PAY_VIA_CONSOLE` (`apps/edge/src/pay-redirect.ts`, used by the Worker and by `pages/functions/_middleware.ts`): off or missing = the old Pay now works exactly as before. `"1"` = the routes that START a payment answer 302 to the console. `/api/payments/webhook`, `/api/payments/verify` and `/api/payments/status` are never redirected (money already paid must still be recorded).
- Security rules (`pages/build.mjs`): only the organizer page `/zc` gets `frame-src` for the payment window address (`payframeOrigins` in the console's `config/games.json`) and `connect-src` for the console. No wildcard.
- Not in this game: its own sign-in, payment page, chat or price number for this step. The pay-link, Razorpay pages and the credit code are the older own payment path; they stay behind the switch and are not deleted.
- Tests: `apps/edge/test/console-pay-step.test.ts`.

## Added in 1.6.5 (payment only through the console, 27 Nov 2026)
- With `PAY_VIA_CONSOLE` set to 1 the old pay pages answer 302 to the console; the pay routes of the API (`/api/checkout`, `/api/proforma`, `/api/payments/test|paytest|verify`, `/api/paylink/*`, `/api/org/credit`, `/api/z/<id>/paylink|credit|apply-credit|pay-with-credit`) answer **410** with `{code:"pay-in-console", console}`. `/api/payments/webhook` and `/api/payments/status` stay open.
- `placeOrder` throws before any central or Razorpay call; the credit-expiry and ledger C jobs are skipped. Switch off: unchanged.
- Not verified: a run against the real console and Moneypenny (its pay step needs `/v1/game_pay/*`, on an unmerged branch).
