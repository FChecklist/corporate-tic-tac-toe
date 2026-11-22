# Knowledge: Corporate Tic Tac Toe (updated 22 Nov 2026, version 1.4.2)

What a new session must know before touching this game. No secrets and no business figures here.

## State
- Version 1.4.2 on PR 9 (branch `feat/ttt-console-pay-step-2026-11-20`). Not merged, not deployed. The first version (1.4.1, head f1d18faf) failed both audits; 1.4.2 fixes them. Two independent `AUDIT: PASS` on the exact new commit are required before the owner deploys.
- Money switches are OFF: `PAY_VIA_CONSOLE` is not set anywhere and `CONSOLE_PUBKEYS` is empty in every shipped config (kept by `apps/edge/test/console-security.test.ts`).

## The console Pay step (see `docs/CONSOLE_PAY_STEP.md`)
- The contract itself lives in the console repository (`docs/GAME_PAY_CONTRACT.md`); it is not copied here. What is here: the vendored bridge and contract kit (`apps/edge/src/console-bridge/`, `apps/edge/test/console-contract/`) and the game's side (`apps/edge/src/console-adapter.ts`).
- `payInfo`: read only, `owner` is true only for an organizer account of the game's own org. `markPaid`: repeatable by the SAME order (a different order on an already paid game is a definite refusal; records are written only when this call did the unlock, via `changes()`); owner and size checked again; a wrong owner, wrong size, closed game or the free size is a definite refusal; an already paid game changes nothing; unlock (`engagement.pack`) and records land in one batch.
- A game is marked paid only through the console's signed notice (`/api/console/paid`): the signed assertion is single use (`console_jti`), lives at most 60 seconds, is tied to the game, and each order id is taken once (`console_paid`, migration 0031).
- Known limit, for the console side: the signed assertion is bound to the game and the person, not to the order id or size; those travel in the request body. Only the console can sign, so this is not exploitable from outside, but the console may want to bind them.

## One-game console key (version 1.4.2)
- The key the console hands over for one game lives in `sessionStorage` under its OWN name, `cbz-game-key`, in that tab only. It is never written under `cbz-org` (keep.js copies that name into `localStorage`, and prefers what is already there). `zc.js` reads it from `sessionStorage` only, removes any lasting `cbz-org` / `cbz-alt` on the device, and neither offers nor takes a key through the other-tab channel. Sign out calls `POST /api/console/signout`, then clears the tab. Tests: `apps/web/test/console-handoff.test.ts`.
- Other pages opened from there in a new tab (`pay.js`, `preview.js`) read the lasting store, which is now empty: they ask for a sign-in. Accepted for now.

## "ID matched, not proven" (owner decision, accepted)
- An employee ID (and a typed mobile number) is MATCHED to the organizer's list. It is not proven: anyone who knows a listed ID can type it. The personal link (and the e-mail code for organizers) is the strong proof. The owner accepted this and decided there are NO per-address limits on right IDs (wrong IDs are still limited per address). The help in `zc.js` says so (`ver:id`, `ver:both`); a test keeps it. `docs/SUITE_RULES.md` (the suite's rules file) is not in this repo.
- Old lists: before 1.4.1 an ID was kept with its dashes (`E-101`). `personByEmp` in `people.ts` tries today's reading, then the old reading of the same typed text. A person on an old list who types `E101` instead of `E-101` is not found (the old hash cannot be reversed): they wait for the organizer, or the organizer adds the list again.

## Owner rules v1.1 for organizer and host screens
- Speak to "you": no I, me, my, we, us, our in any text a person reads (`zc.html`, `zc.js`, `host.*`, `signin.*`). Kept by `apps/web/test/owner-rules.test.ts`.
- The rupee sign (`₹`), never `Rs`.
- One privacy line (`PRIVACY` in `zc.js`) and one fairness sentence (`FAIRNESS` in `zc.js`); the test proves the fairness sentence against `packages/ttt/src/seal.ts` and `bracket.ts`. If the draw ever changes, change the sentence and the proof together.
- No forbidden claims (guarantee, 100%, bank-grade, certified, and similar): checked by the same test.
- Employee IDs: `normEmp` in `apps/edge/src/people.ts` is the one reading (NFKC, capitals, letters and numbers only, max 30). `A-1101`, `A 1101`, `A/1101` are one person.
- NOT done, needs an owner decision: "invite by employee ID only". Today an organizer can still choose mobile number, employee ID, either or both (`verify` setting), and guests can be invited by link. Making employee ID the only way is a product change, not a wording fix.
- `apps/web/public/pack/` is copied byte for byte from the console repo and still contains first-person words and "Rs"; it is not loaded by any page yet. Fix it in the console repo, then re-vendor, before a page loads it.
- `guide.js` (the help popups) speaks to you everywhere since 1.4.2. The text a server error is matched against (the `m:` lists) is left as the server writes it and is not shown to anyone. Kept by `owner-rules.test.ts`.

## Tests
- `bun install`, then `bun test packages apps tools/control-worker`. Three failures are known and also fail on `master` (a fourth, "big screen: connection lost", fails now and then only when everything runs together and passes alone): two page tests that use calendar dates that have passed ("Create a new game like this one", "Rescheduling") and `owner-test-free.test.ts` (the test account's end date, 8 Nov 2026, has passed; extending it is the owner's decision).
