# Test findings (test author to coder and Boss), Corporate Tic Tac Toe

Test author run of 30 Oct 2026 on branch `tests/ttt-2026-10-30` (built on `claude/site-tictactoe-f9dd93`, head 89e8a0d). No product file was changed by the test author.
Each finding has an exact repro. The tests that prove it are RED on purpose and live in `apps/edge/test/t30-findings.test.ts` and `apps/web/test/t30-findings.test.ts`, so the other new tests stay green and can be break-checked.
"Severity" is the test author's view; the Boss decides.

## Product findings (the product is wrong, or does not do what docs/TEST_HANDOFF.md or docs/GO_LIVE_CHECKLIST.md says)

### F-1 (Medium) Organizer sign-up and sign-in do not use the shared e-mail cleaner
- Rule broken: GO_LIVE_CHECKLIST A2/A3 ("used on EVERY path", "RAJAT1＠DEMO.COM = Rajat1@Demo.com"); the task's e-mail axis ("every case mix ... are one person").
- Where: `apps/edge/src/worker.ts`, `POST /api/start` (line about 852) and `POST /api/auth/email` (line about 865) do `b.email.trim().toLowerCase()` and then a regex. They never call `cleanEmail` (ids.ts). Google sign-in and Host setup do.
- Repro (any Worker, in-memory database is enough):
  1. `POST /api/start` with `{"email":"DEMO6＠DEMO-TEST.INVALID"}` (full-width ＠) gives **400** "Please enter a valid e-mail address." Expected 200, same person as `demo6@demo-test.invalid`.
  2. Same for `{"email":"demo6 @demo-test.invalid"}` and `{"email":"demo 6@demo-test.invalid"}` (inner space): 400. Expected 200.
  3. Create the account with `demo6@demo-test.invalid`, then `POST /api/auth/email` with `DEMO6＠DEMO-TEST.INVALID`: 400. Expected: finds the same account.
- What works: pure upper/lower case mixes are one account (test `t30-email-wire.test.ts`, passes). So the damage is a refused sign-up, not a duplicate account, but one person cannot sign in with a spelling that Google and Host setup accept.
- Same pattern (not tested, same code shape): `apps/edge/src/helpdesk.ts` `validEmail`, `apps/edge/src/worker.ts` line 1094 Host e-mail check.
- Red tests: `t30-findings.test.ts` "F-1: a full-width ＠ or an inner space ..." and "F-1: the same on the sign-in door".

### F-2 (Medium) All seven new public pages load `/blackbox.js` without `/guide.js` before it
- Rule broken: `apps/web/test/guide.test.ts` "the screens use it" (an existing rule: every page that loads the black box loads the error guide first). Passes on base 045d629, fails on the branch since the new pages were generated.
- Repro: `grep -L 'src="/guide.js"' apps/web/public/{index,how-it-works,guide,brochure,refer,thank-you,game-completed}.html` lists all seven; each contains `<script src="/blackbox.js" defer>`. Source: `tools/site/make-pages.mjs` line 39.
- Red tests: `t30-findings.test.ts` "F-2: ... guide.js before blackbox.js" (7 tests, one per page); also the existing `guide.test.ts` case.

### F-3 (Low) The join-page hint promises a reading for input the server refuses
- Rule: docs/TEST_HANDOFF.md says an e-mail typed in the ID box and an ID longer than 30 after cleaning are refused. The hint line "The system will read this as ..." is shown for both.
- Repro: open the join page of a game that asks for an employee ID; type `demo1@demo-test.invalid` in the ID box: the line says "The system will read this as DEMO1DEMOTESTINVALID". Joining then gives 400 `bad-id` ("An employee ID has letters and numbers only."). Type 35 letters A: the line says "... as AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", the server answers 400 `bad-id`.
- Where: `apps/web/public/ttt.js` line 84 (the `input` handler of `#emp`). Expected: no "will read this as" line (or a plain warning) when the text contains `@` after NFKC or the cleaned text is longer than 30.
- Red tests: `apps/web/test/t30-findings.test.ts` two "F-3" tests.

### F-4 (Medium, also on master) The join page shows no employee-ID box when the game is set to "mobile number or employee ID"
- Where: `apps/web/public/ttt.js` line 70 `askWhat()` knows only `verify === "id"` and `"both"`. The server (`people.ts verifyOf`, `worker.ts join`) accepts `"either"` and the console can save it. With `verify:"either"` the page falls back to "mobile" and the person cannot type an employee ID at all.
- Repro: create a game, `PATCH /api/z/<id>/settings {"verify":"either"}`, open `z.html?e=<id>`: no `#emp` box, no hint. (`/info` returns `verify:"either"`.) Same code on master 045d629.
- Red test: `t30-findings.test.ts` "F-4".

### F-5 (Medium) `storage-registry.json` does not list the two keys `theme-init.js` writes or reads
- Existing test `apps/web/test/storage-notice.test.ts` is red: missing `theme-init.js: localStorage ct-theme` and `theme-init.js: localStorage cg-theme`. This is the data the privacy and storage notice must name (checklist H1/J2: notices truthful). Not caused by a test fault; the script is the shared brand-kit file (byte-identical to the canonical copy, so the registry must change, not the script).

## Old tests that are red because the product moved (stale test or product regression: the coder or the Boss decides which)
These fail on the branch and pass on base 045d629. The test author did not change them (except where listed below). The exact first error lines are in docs/TESTER_REPORT.md.
- `visits-dom.test.ts` (7 tests): the rewritten home page has no `#pack`, `#pack2`, `.pcta`, `[data-c="INR"]` and its first watched section is not `top` (it is `trust`, `game-day`). Either the visit tracking of the price card is lost (product) or the tests need the new page (test). Needs a decision.
- `seo.test.ts` (2): the home page has no `<img src="/img/card.png" ... fetchpriority="high">`; `fonts.css` has no `font-display: swap` (the brand kit file must stay identical, so the swap rule must come from elsewhere or the test must change).
- `pages.test.ts` (3): console flow timeouts. Two are red on base too. One is new: "wording: no 'engagement' anywhere in the ten steps" stops at "Payment pending for this game".

## Tests the test author corrected (test faults, not product faults)
- `apps/web/test/brand-kit.test.ts` line 40: the regex had a literal BACKSPACE character (0x08) where `\b` was meant (`<a^H[^>]*>`), so it never matched an anchor and the menu always came out empty. Fixed to `<a\b`. With the fix the test passes: all seven pages DO have the six menu items in order. (Run 2 reported this as a product failure; it was not.)
- `apps/edge/test/verify.test.ts` "an ID is trimmed and upper-cased ...": it still expected `normEmp("a<b>")` to be refused. Owner rule 30 Oct 2026 removes symbols and refuses only an ID with nothing left, so the expected value is now `"AB"`, and `"<>"` is refused.

## Observations that are not failures
- `EMP_CLEAN_FROM_MS` is still the placeholder 2026-10-31 UTC (known; the handoff says it is set at deploy). The new tests take their "old game" and "new game" clocks from the constant, so moving it does not break them. GO_LIVE A6 stays open until it is the real deploy instant.
- The product erases personal data 20 h after a game ends; Terms say 23 h and the promise is 24 h (open question Q6 in PARITY_MAP). Tests pin 20 h (`PURGE_AFTER_MS`) and "never later than 24 h".
- `siteversion.js` header comment shows "30 Oct 2026, 14:05" with a comma; the code removes the comma, so the footer reads "30 Oct 2026 14:05 IST". The tests follow the code.
- The home page text shows no rupee amount at all (prices only in structured data). The handoff asks for "real prices" in structured data; that holds (AggregateOffer 2399 to 29499, 8 offers).
- A duplicate that appears only after cleaning (checklist A4) is reported in the people upload answer, not dropped: two spellings of one ID in one upload give one person and an "already" style message (`t30-join-wire.test.ts`).
