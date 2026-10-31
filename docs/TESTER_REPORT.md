# Tester report v3, Tic Tac Toe 1.4.1 (31 Oct 2026)

Test branch `tests/ttt-1.4.1-v3-2026-10-31` = product branch `fix/ttt-1.4.1-2026-10-30` (head 8c02dc8) + the test files of `tests/ttt-1.4.1-2026-10-30` (b0b0b98), + my new and corrected tests. Test author replacing the silent one. Bun 1.4.4.
**No product file was changed.** `git diff origin/fix/ttt-1.4.1-2026-10-30 -- apps/edge/src apps/web/public packages/*/src tools pages` is empty (checked after the break checks). The merge had no conflicts: the product moved only in src files and docs/TEST_HANDOFF.md, the test branch only in test files.

## Verdict
**NOT green. 13 tests are RED ON PURPOSE: each one is a PRODUCT DEFECT against the owner rules (below). I did not bend any of them.** Everything else is green. Typecheck 0 errors. Matrix 1,300,000 distinct inputs, 0 mismatches.

## Counts (last summary line of one run per folder, `bun test --isolate <folder>`)
| Folder | Pass | Fail | Todo | Files |
|---|---|---|---|---|
| packages/shared | - | - | - | no test files exist (bun: "filters did not match any test files") |
| packages/beacon | 87 | 0 | | 6 |
| packages/billing | 26 | 0 | | 1 |
| apps/edge | 1465 | **12** | | 84 |
| apps/web | 401 | **1** | 1 | 34 |
| tools/control-worker | 1 | 0 | | 1 |
| `bun run typecheck` | | **0 errors** | | |

The 13 red tests are exactly the "OWNER RULE" tests listed under PRODUCT DEFECTS (edge: 3 endedAtMs + 4 lock + 2 too-long + 3 account doors; web: 1 too-long hint). The `todo` is the earlier author's test.todo for the EMP_CLEAN_FROM_MS hint mismatch (D-6).
Note: `tsconfig.json` does not include `apps/web/test`, so the typecheck does not cover web tests. Raw logs: scratchpad only (not committed); counts above are from the last run, after all edits.

## PRODUCT DEFECTS (not fixed by me; tests stay red)
**D-1 ID lock answers the wrong status and code.** `apps/edge/src/worker.ts:2003`, PATCH `/api/z/:id/settings`.
- Input: game `verify: "id"`, one person listed with `empId: "1B-678"`; PATCH `{ "idKind": "email" }` (also `{verify:"both"}`, `{verify:"either"}`, `{verify:"mobile"}`, `{idKind,verify}`); same with a joined participant only; same Email ID -> `{idKind:"emp"}`.
- Expected: HTTP 409, `code: "id-kind-locked"`. Actual: HTTP 400, `code: "ids-locked"`.
- The sentences are right (kind sentence for an idKind change; "...different way of asking for IDs." for verify only) and nothing changes: those tests are green.
- Tests: `t41-owner-rules.test.ts` "OWNER RULE status and code: a LISTED person", "...a JOINED person", "an Email ID game locks the other way too". The previous author's tests encoded 400/ids-locked (they followed the product); I changed them to the rule.

**D-2 The lock counts every listed or joined person, not only people holding an ID hash.** `worker.ts:2003` counts all `person` + `participant` rows.
- Input: game `verify: "mobile"`, one person listed by mobile number only (no ID hash); PATCH `{ "idKind": "email" }`. Expected 200 (nobody holds an ID hash). Actual 400 `ids-locked`.
- Test: "OWNER RULE: only someone HOLDING AN ID HASH locks...". This one depends on reading "holding an ID hash" literally; if the owner means "anyone at all", drop this test, D-1 stays.

**D-3 The "too long" sentence does not exist.** `people.ts badIdMessage`, the join route, the list upload, and `apps/web/public/ttt.js`. The sentence `This ID is too long. An employee ID may be up to 30 characters once cleaned.` is in no file of the repo.
- Input: employee-ID game (created at/after EMP_CLEAN_FROM_MS), ID `"A"*31` (or `"a-"*31`). Expected that sentence. Actual (server, join and list upload): `An employee ID has letters and numbers only (up to 30).`; the join page shows nothing at all above 30.
- Tests: `t42-id-rules` "OWNER RULE too long" x2 (join; badIdMessage + list upload), `t42-join-texts` "OWNER RULE: over 30 characters once cleaned...".

**D-4 ACCOUNT e-mails accept invisible characters.** The shape check `/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/` has no invisible-character class at: `worker.ts:853` (`/api/start`), `worker.ts:866` (`/api/auth/email`), `worker.ts:1847` (publish contact e-mail, used for the receipt). `google.ts`, `helpdesk.ts`, `hostsetup.ts` do have the class; `/api/auth/verify` is correct (green).
- Input: `{ "email": "a​b@x.com" }` (also U+200C, U+200D, U+2060, U+FEFF, U+0085, U+2028, U+2029, at the start, inside, or at the end). Expected 400 and no account. Actual: 200 and an account is made. Of the 28 spellings tried at `/api/start`, 21 returned 200 and 16 distinct accounts were made (spellings that clean to the same address share one account); the 7 refused are inner spaces, the full-width @ and the characters the shape check already treats as white space. `cleanAccountEmail` itself is right; the doors do not use it.
- Same regex without the class, NOT driven by me (suspects for the coder): `mode.ts:92`, `admin.ts:173`, `pay.ts:50`, `partners.ts:97`, `worker.ts:1054` and `:1091` (become-organizer / host e-mail).
- Tests: `t42-id-rules` "OWNER RULE: the sign-up door", "...the sign-in e-mail door", "...the organizer's contact e-mail at publish time".

**D-5 `endedAtMs` does not exist.** No file under `apps/edge/src` returns it. The public tournament view has `endedMs` (and `endedEarly`); `life.end_ms` is internal only.
- Input: Organizer ends a running game (`POST /ttt/end`); tournament marked done by the phones; a game that ran past its end bound; read `/ttt/view` and the Organizer `/summary`. Expected `endedAtMs` = the end instant (organizer / phones: whatever the clock; scheduled: only once now >= `endBoundMs`; never moves). Actual: field absent everywhere.
- Tests (red): `t42-ended-at` Organizer end, phones end, scheduled end.
- Tests that are **green only because the field is absent, i.e. they prove nothing yet**: "absent while the game can be live", "erasing is not an end", "cancelling is not an end". They will start to bite when the field exists.
- Related, not testable through the API: erase writes `life(end_ms=now, end_src='organizer')` (worker erase, `lifecycle.ts:142`), so the data layer treats an erase as an end (it drives the report and deletion clocks). The rule says erase is not an end; the coder should make sure `endedAtMs` does not read that row.

**D-6 (carried over, open release gate) `EMP_CLEAN_FROM_MS` is the 2099 placeholder.** Until the release session sets it, every game keeps the OLD employee-ID rule on the server (`1b-678` -> `1B-678`, dashes kept) while the join page already says "The system will read this as 1B678". Against the rule "keep A-Z0-9" this is wrong for every game today. The handoff (docs/TEST_HANDOFF.md) calls it intended, so the owner-rules test pins the placeholder and my matrix and the new tests use a created time at/after the constant. `test.todo` kept. Release must set the constant.

Smaller, for judgment: (a) people in the `waiting` table do not lock the ID kind; (b) the visit funnel steps 1-3 in v.js can never fire (no pricing/pack/Create controls on any public page); (c) footer says "Version 1.5.0" while the branch says 1.4.1.
Resolved since the last report (fix passes 2 and 3): guide.js card for the lock sentences (checked, green), the `game.ts` typecheck error, NEL / U+2028 / U+2029 in `cleanEmail` and the page hint, `cleanAccountEmail` refusing invisible characters (helper only, see D-4).

## Failing tests I fixed because the TEST was wrong (old behaviour)
- `t41-join-rules` "the file text has the backslashes...": the coder added `\u0085` to the page's cleaning class; expectation now lists U+0085 first.
- `t41-id-oracle` `oracleAccount` + matrix: an account e-mail with an invisible character is now REFUSED (""), per the rule; the old oracle kept it. Added oracle tokens U+0085, U+2028, U+2029.
- `t41-join-rules`: "hint not shown above 30" now says the "will read this as" hint is not shown (it no longer pins an empty line, because the rule puts the too-long sentence there; see D-3).
- `ttt-same-name`: a race, not a product bug. It failed once in the full web run (the winner's page had already moved on to "You are the champion"); alone 3/3 green. The text is now read at the moment the wait finishes. The two full web runs after the change were green on that test.
- `t41-owner-rules` lock block: rewritten from the owner rule (D-1, D-2), splitting sentence checks (green) from status/code checks (red) so one defect does not hide the other.

## New tests (gaps)
- `apps/edge/test/t42-id-rules.test.ts` (21): employee-ID cleaning (12 spellings), empty refused, cap 30 after cleaning (30 ok, 31 refused, 60 typed that clean to 30 ok), hint text, e-mail in an employee-ID game gets the plain sentence and no letters of the address, duplicates after cleaning flagged (also across uploads, with `duplicateRows`), participant Email ID (every invisible character, anywhere; examples; shape; join and list in an Email ID game), account e-mail refusal (`cleanAccountEmail` for 8 invisible characters x 3 places; 4 doors).
- `apps/edge/test/t42-ended-at.test.ts` (6): the `endedAtMs` rule, see D-5.
- `apps/web/test/t42-join-texts.test.ts` (6): hint wording, too-long sentence, no hint/letters for an e-mail in an ID box, Email ID hint, guide.js lock cards.
- All invisible characters in these files are written as `\uXXXX` escapes (re-read after writing; my first write had turned 13 of them into raw characters, now converted back, the tests give the same result).

## The matrix
`apps/edge/test/t41-id-matrix.test.ts` + oracle `t41-id-oracle.ts` (written by hand from the rules, never asked from ids.ts).
- **1,300,000 distinct inputs**, counted by a Set; the test asserts the count equals the number checked, is >= 1,000,000, and equals the generator's own count.
- **Skipped repeats: 27,596** (inputs that came up twice in the random stage; checked once).
- 8 rules per input = 10,400,000 checks (cleanEmpId, empHint, cleanEmail, normEmpFor new, normId emp, normId email, normEmpFor old, cleanAccountEmail). Employee ID accepted 575,990 / refused 722,517; Email ID accepted 66,642 / refused 1,228,866; old rule accepted 30,870. 95 tokens (ASCII, full-width, `ß`, dashes, Devanagari digits, compatibility letters, Turkish i, other scripts, emoji, 9 kinds of space, all invisible characters of the owner's list, `@` in 3 forms, address pieces, runs of 29 to 255 characters).
- Result: 0 mismatches. A sample of 150 per kind also goes through the real join endpoint.

## Deliberate-break checks (product line changed, tests run, line restored with `git checkout`, tests run again)
"Restored" is the baseline of those files, which includes the known red OWNER RULE tests.
| # | Product rule broken | Tests run | Broken | Restored |
|---|---|---|---|---|
| B1 | `ids.ts` cleanEmpId loses `.toUpperCase()` | t41-id-matrix, t42-id-rules | 13 pass / **11 fail** | 19 / 5 |
| B2 | `ids.ts` cleanEmail stops removing U+0085 and the zero-width marks | t41-id-matrix, t42-id-rules | 14 pass / **10 fail** | 19 / 5 |
| B3 | `worker.ts:2003` ID lock switched off (`> 0` -> `> 1e9`) | t41-owner-rules, verify | 29 pass / **6 fail** | 31 / 4 |
| B4 | `ids.ts` cleanAccountEmail stops refusing invisible characters | t41-id-matrix, t42-id-rules, t41-owner-rules | 27 pass / **11 fail** | 29 / 9 |
Counts are the last "pass / fail" lines of each run. Every break went red (more failures than baseline) and went back to baseline after the revert. First tries of B2 and B4 did not apply (my command text had turned `​` into a raw character, so the pattern did not match; reported by the script, nothing was changed); redone with a script that builds the pattern. After the last break `git diff origin/fix/ttt-1.4.1-2026-10-30` over every non-test path is empty.

## Not done
- No browser click tests (`tools/browser-tests`), no `tools/sim2`, no `tools/breakchecks`.
- `bun.lock` made by `bun install` is not committed.
- The scheduled-end test uses the product's own `endBoundMs` as the bound (the "+60 s" in the rule is read as the tournament-end grace in `endBoundTtt`); if the owner means another bound, adjust that one test.

---

# Earlier report (30 Oct 2026, first run, kept for history)

# Tester report, Corporate Tic Tac Toe (test author, 30 Oct 2026)

- Branch under test: `claude/site-tictactoe-f9dd93`, head 89e8a0d. Test branch: `tests/ttt-2026-10-30` (only test directories, test helpers, tools/sim2/scenarios, tools/breakchecks, docs/TESTER_REPORT.md and docs/TEST_FINDINGS.md were added or changed; no product file).
- Runner: `tools/breakchecks/run-folders.sh` (one folder at a time, `bun test --isolate <folder>`), Bun 1.4.4, builds first (`build:control`, `build:report`, `build:ttt`, `build:zgame`, `pages:build`), the four rewritten tracked build outputs were reverted afterwards.
- Raw logs: `results/baseline/*.log` (coder branch only, before my tests), `results/final/*.log` (branch with my tests), `results/matrix/`, `results/breakchecks/`, `results/typecheck-final.log`, `results/builds-*.log`.

## Verdict

**NOT all green. Folder suites: 26 failing tests of 2081. Matrix: 0 failing scenarios of 1274576.**

Failing tests are of three kinds, all listed below with their first 8 error lines: (a) tests of mine that are RED ON PURPOSE because they prove a product bug (docs/TEST_FINDINGS.md F-1 to F-4: 2 in edge, 10 in web); (b) old tests that fail because the product moved (stale test or regression, Boss decides); (c) a flaky timing test (`join-retry.test.ts`).

## 1. Raw counts per folder

Before my tests (coder branch, `results/baseline`):

| Folder | Pass | Fail | Ran (tests, files, time) | exit |
|---|---|---|---|---|
| packages/ttt | 105 | 0 | 105, 8, 7.59s | 0 |
| packages/beacon | 87 | 0 | 87, 6, 5.83s | 0 |
| packages/billing | 26 | 0 | 26, 1, 136.00ms | 0 |
| tools/control-worker | 1 | 0 | 1, 1, 61.00ms | 0 |
| apps/edge | 1349 | 1 | 1350, 74, 52.71s | 1 |
| apps/web | 246 | 15 | 261, 28, 91.30s | 1 |

Total: 1814 pass, 16 fail.

With my tests (`results/final`):

| Folder | Pass | Fail | Ran (tests, files, time) | exit |
|---|---|---|---|---|
| packages/ttt | 160 | 0 | 160, 9, 6.48s | 0 |
| packages/beacon | 87 | 0 | 87, 6, 4.67s | 0 |
| packages/billing | 26 | 0 | 26, 1, 33.00ms | 0 |
| tools/control-worker | 1 | 0 | 1, 1, 55.00ms | 0 |
| apps/edge | 1430 | 2 | 1432, 80, 45.97s | 1 |
| apps/web | 351 | 24 | 375, 32, 78.84s | 1 |

Total: 2055 pass, 26 fail.

Typecheck (`bun run typecheck`, `results/typecheck-final.log`): 82 errors. The same 82 old errors as the coder branch had; my files add 0. (K6 "0 errors" is NOT met by the branch.)

## 2. Tests added (file, what it proves)

| File | Result (alone) | What it proves |
|---|---|---|
| `apps/edge/test/t30-ids.test.ts` | 25 pass / 0 fail | Employee-ID cleaner: the 5 typings -> 1B678, full-width, emoji, zero-width, accents, other scripts, empty, symbols only, 30/31 limit, 10,000-character input, e-mail in the ID box, old-game rule and its exact boundary instant, hint words, people.normEmp = normEmpFor, idempotent. |
| `apps/edge/test/t30-email.test.ts` | 14 pass / 0 fail | E-mail cleaner: every case mix (256 and 524,288 built), spaces/tab/zero-width/NBSP, full-width ＠ and letters, +tag dropped by normMail only, Host e-mail hash equal for every spelling, ID cleaner never applied to an e-mail. |
| `apps/edge/test/t30-email-wire.test.ts` | 7 pass / 0 fail | Real Worker: Google sign-in reads the e-mail in one form (same account for another spelling), Host setup by Google, organizer sign-up case mixes. |
| `apps/edge/test/t30-join-wire.test.ts` | 15 pass / 0 fail | Real Worker: list upload and join clean an ID the same way (5 spellings = one person), unlisted ID waits, duplicate spellings in one upload, refusals with plain words and codes, old game keeps old rule on the wire, one card one device (id-used 423, device-used 409), approvals (admit, first decision wins, outsiders and another Organizer's key refused), 'who is this'. |
| `apps/edge/test/t30-regress.test.ts` | 19 pass / 0 fail | Regression through the real Worker: join (phone formats, consent, draft, device), check-in (5 minutes, ticket id, 10,000-code permutation, code), results (6 phones play to a champion, ranks 1..6, winners record), pause (403 for players, 409 paused, pause list), move clock and team size refusals, 24-hour erase with the 20 h boundary (19 h 59 min still there, 20 h gone), game log (365 days, counts only, never overwritten with zero), consent version safe. |
| `apps/edge/test/t30-findings.test.ts` | 0 pass / 2 fail | RED ON PURPOSE: product finding F-1 (organizer sign-up/sign-in do not clean the e-mail). |
| `apps/edge/test/t30-kit.ts` | - | Helper (not a test): one in-memory Worker world with a chosen clock. |
| `apps/web/test/t30-pages.test.ts` | 87 pass / 0 fail | The 7 new pages x (six menu items in order, demo link, logo #i-ttt, bar v3, canonical, og-card, no 'private', no style attributes, no inline script/handlers, no Bingo/Tambola outside the footer, complete page, indexability); home page structured data = real prices, FAQ, festive line, links; sitemap, robots; headers from a real pages/build.mjs run (noindex only for thank-you and game-completed, both spellings). |
| `apps/web/test/t30-footer.test.ts` | 10 pass / 0 fail | Footer: IST date/time from /version.json, no-store fetch, UTC evening rolls to next IST day, all footers updated, plain 'Version 1.5.0' on 404/network error/no fetch/bad JSON/no builtAt/unreadable date, no element -> no fetch, version equals every page footer. |
| `apps/web/test/t30-join-hint.test.ts` | 7 pass / 0 fail | Join page: ID box + hint line (aria-live), exact hint words, clearing, symbols, 60 typed characters, mobile box 20, and 40 probes where the page's cleaning equals ids.ts. |
| `apps/web/test/t30-findings.test.ts` | 0 pass / 10 fail | RED ON PURPOSE: F-2 (guide.js before blackbox.js on 7 pages), F-3 (hint promises a reading the server refuses, 2 tests), F-4 (no ID box for 'mobile number or employee ID'). |
| `apps/web/test/t30-joinpage.ts` | - | Helper (not a test): opens the join page in a simulated phone. |
| `packages/ttt/test/t30-formats.test.ts` | 55 pass / 0 fail | Go-live rows F1t/F3t/F5t: solo (2..21), teams of 3 and 5 (with reserve) x move clocks 10/20/30/60 each play to one champion with ranks 1..N; draws replayed with swapped marks, max 3 games, fate only after three draws and recomputable; no ties 2..40 players; move clock auto-move, two clock-outs lose the board; pause moves every clock by the pause length. |
| `tools/sim2/scenarios/matrix/ttt-stream.ts` | - | Streamed scenario matrix generator and runner (see Matrix section). |
| `tools/breakchecks/*` | - | 69 planted-break scripts + library (see Break checks). |
| `EDITED: verify.test.ts and brand-kit.test.ts (names, not run alone)` | - | EDITED (test faults): see docs/TEST_FINDINGS.md 'Tests the test author corrected'. |

## 3. Scenario matrix (streamed)

Command: `bun tools/sim2/scenarios/matrix/ttt-stream.ts --tier all`. Raw: `results/matrix/matrix-all.log`, `results/matrix/summary-all.json`.
Each scenario is decoded from its number by mixed radix (a bijection; the run checks `encode(decode(i)) == i` on every scenario), asserted at once, then forgotten: nothing is kept in memory.

**Total: 1274576 real distinct scenarios, 1274576 pass, 0 fail, 9309212 individual checks, 95 s.**

| Tier | Scenarios | Pass | Fail | Checks | What a scenario is |
|---|---|---|---|---|---|
| pure | 1263360 | 1263360 | 0 | 9227040 | idFormat 47 x idBase 2 x gameEra 2 x verifyConfig 8 x emailCase 8 x emailNoise 7 x emailPath 3 x linkType 5 = 1263360. Real product functions in-process: employee-ID cleaner (47 typings x 2 bases x old/new game), verify config read-back, e-mail cleaners on 3 paths (organizer sign-in, Google, Host hash) x 8 case styles x 7 noises (spaces, full-width ＠, zero-width, tab/new line, +tag), link codes of 5 link types (Organizer, Host, Co-host, guest seat, personal token). |
| pure-pay | 288 | 288 | 0 | 864 | TEST_MODE x FREE_LAUNCH x Razorpay keys x 8 packs x INR/USD: payment mode, free launch, exact price list. |
| pure-theme | 48 | 48 | 0 | 96 | the real theme-init.js with 6 colour themes x 4 light/dark values x storage ok/blocked. |
| wire | 2816 | 2816 | 0 | 8636 | the real Worker + in-memory database: old/new game x verify mobile/id/either/both x access anyone/list/employees only x 8 ID typings x on the list or not x payment state (paid, unpaid early, unpaid after the lock, draft) x same phone / another phone; every waiting outcome is then decided by one of 5 approvers (Organizer admits, Organizer declines, another Organizer's key, unknown key, no key). |
| bracket | 8064 | 8064 | 0 | 72576 | whole tournaments played to the end: 112 shapes (solo 2-40, teams of 3 with 6-42 players, teams of 5 with 10-45 players) x 4 move clocks x 6 seeds x 0/10/30 % of players who never move: one champion, rounds = ceil(log2 entrants), unique ranks, N-1 matches, at most 3 games, fate only after 3 draws, swapped marks after a draw. |

Honest limits of the matrix (read before trusting the headline number):
- The 1.26 million are the `pure` tier. They call the real product functions, but not through HTTP; the dimensions are independent (each feeds its own assertion), they are not an interaction test. The interaction tests are the wire (2816) and bracket (8064) tiers.
- Counted only because each can fail (proved by planted breaks bc59-bc69 below): ID typing, game age, verify mode, e-mail case and noise, e-mail path (role), link type, payment environment, pack and currency, theme, access, list membership, payment state, device, approver, tournament shape, clock, seed, absentees.
- Not counted because nothing asserts on them in this run: browser/device sizes (360/768/1280), light/dark rendering (only the theme *choice* is asserted), Host and Co-host as join approvers (only Organizer, another Organizer, unknown/no key), rounds/matches as a separate option (they follow from the number of players).
- The wire oracle was written from the join rules; when it disagreed with the product I read the code before changing either (two oracle mistakes were mine: an ID not on the list always waits for the organizer, and a name-only guest on a second phone is a second guest; one was JavaScript counting U+FEFF as white space). The matrix found no product bug.

## 4. Planted-break checks (red then green)

Each `tools/breakchecks/bcNN-*.mjs` copies the working tree to a scratch folder, runs the test GREEN, plants one break in a product file of the COPY, runs it again (must be RED), restores the text and runs a third time (GREEN). The branch file's hash is printed before and after (unchanged in every log). Raw: `results/breakchecks/<id>.log`; run all with `tools/breakchecks/run-all.sh`.

OK: 69  NOT OK: 0  TOTAL: 69

| Break | Green (exit, pass/fail) | RED | Restored |
|---|---|---|---|
| bc01-id-keeps-dashes  | exit0 25p/0f | exit1 16p/9f | exit0 25p/0f |
| bc02-id-no-nfkc  | exit0 25p/0f | exit1 23p/2f | exit0 25p/0f |
| bc03-id-no-uppercase  | exit0 25p/0f | exit1 19p/6f | exit0 25p/0f |
| bc04-id-length-cap  | exit0 25p/0f | exit1 24p/1f | exit0 25p/0f |
| bc05-id-accepts-email  | exit0 25p/0f | exit1 23p/2f | exit0 25p/0f |
| bc06-id-old-rule-lost  | exit0 25p/0f | exit1 21p/4f | exit0 25p/0f |
| bc07-id-empty-refused  | exit0 25p/0f | exit1 24p/1f | exit0 25p/0f |
| bc08-id-symbols-accepted  | exit0 25p/0f | exit1 24p/1f | exit0 25p/0f |
| bc09-id-hint-words  | exit0 25p/0f | exit1 24p/1f | exit0 25p/0f |
| bc10-mail-keeps-case  | exit0 14p/0f | exit1 7p/7f | exit0 14p/0f |
| bc11-mail-no-nfkc  | exit0 14p/0f | exit1 9p/5f | exit0 14p/0f |
| bc12-mail-keeps-spaces  | exit0 14p/0f | exit1 12p/2f | exit0 14p/0f |
| bc13-mail-tag-kept  | exit0 14p/0f | exit1 12p/2f | exit0 14p/0f |
| bc14-mail-id-cleaner  | exit0 14p/0f | exit1 10p/4f | exit0 14p/0f |
| bc15-host-hash-raw  | exit0 14p/0f | exit1 13p/1f | exit0 14p/0f |
| bc16-google-raw  | exit0 7p/0f | exit1 5p/2f | exit0 7p/0f |
| bc17-join-ignores-era  | exit0 15p/0f | exit1 14p/1f | exit0 15p/0f |
| bc18-join-badid-code  | exit0 15p/0f | exit1 9p/6f | exit0 15p/0f |
| bc19-join-id-used  | exit0 15p/0f | exit1 14p/1f | exit0 15p/0f |
| bc20-list-upload-raw  | exit0 15p/0f | exit1 12p/3f | exit0 15p/0f |
| bc21-who-initial  | exit0 15p/0f | exit1 14p/1f | exit0 15p/0f |
| bc22-approve-other-org  | exit0 15p/0f | exit1 14p/1f | exit0 15p/0f |
| bc23-menu-item-missing  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc24-private-word  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc25-thankyou-indexable  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc26-sitemap-entry  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc27-header-noindex  | exit0 87p/0f | exit1 85p/2f | exit0 87p/0f |
| bc28-festive-line  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc29-ld-price  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc30-style-attribute  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc31-bar-version  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc32-logo-symbol  | exit0 87p/0f | exit1 85p/2f | exit0 87p/0f |
| bc33-other-game-word  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc34-robots-allow  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc35-demo-link  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc36-canonical  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc37-inline-script  | exit0 87p/0f | exit1 86p/1f | exit0 87p/0f |
| bc38-footer-utc  | exit0 10p/0f | exit1 7p/3f | exit0 10p/0f |
| bc39-footer-cache  | exit0 10p/0f | exit1 9p/1f | exit0 10p/0f |
| bc40-footer-words  | exit0 10p/0f | exit1 7p/3f | exit0 10p/0f |
| bc41-box-maxlength  | exit0 7p/0f | exit1 6p/1f | exit0 7p/0f |
| bc42-hint-words  | exit0 7p/0f | exit1 4p/3f | exit0 7p/0f |
| bc43-hint-cleaner  | exit0 7p/0f | exit1 3p/4f | exit0 7p/0f |
| bc44-erase-30h  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc45-report-link-late  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc46-consent-any-version  | exit0 19p/0f | exit1 17p/2f | exit0 19p/0f |
| bc47-consent-anyversion-flag  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc48-checkin-opens  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc49-checkin-perm  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc50-gamelog-zero  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc51-gamelog-days  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc52-pause-anyone  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc53-move-clock-5s  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc54-team-of-4  | exit0 19p/0f | exit1 18p/1f | exit0 19p/0f |
| bc55-missed-limit  | exit0 55p/0f | exit1 54p/1f | exit0 55p/0f |
| bc56-max-games  | exit0 55p/0f | exit1 54p/1f | exit0 55p/0f |
| bc57-rank-ties  | exit0 55p/0f | exit1 10p/45f | exit0 55p/0f |
| bc58-pause-shift  | exit0 55p/0f | exit1 54p/1f | exit0 55p/0f |
| bc59-matrix-id  | exit0 30336p/0f | exit1 27780p/2556f | exit0 30336p/0f |
| bc60-matrix-mail  | exit0 30336p/0f | exit1 28908p/1428f | exit0 30336p/0f |
| bc61-matrix-link  | exit0 30336p/0f | exit1 24338p/5998f | exit0 30336p/0f |
| bc62-matrix-pay  | exit0 400336p/0f | exit1 400288p/48f | exit0 400336p/0f |
| bc63-matrix-theme  | exit0 400336p/0f | exit1 400332p/4f | exit0 400336p/0f |
| bc64-matrix-verify  | exit0 3336p/0f | exit1 2586p/750f | exit0 3336p/0f |
| bc65-matrix-price  | exit0 400336p/0f | exit1 400318p/18f | exit0 400336p/0f |
| bc66-matrix-wire-era  | exit0 366p/0f | exit1 345p/21f | exit0 366p/0f |
| bc67-matrix-wire-device  | exit0 366p/0f | exit1 355p/11f | exit0 366p/0f |
| bc68-matrix-wire-locked  | exit0 550p/0f | exit1 503p/47f | exit0 550p/0f |
| bc69-matrix-bracket  | exit0 300p/0f | exit1 244p/56f | exit0 300p/0f |

What each break is: see `tools/breakchecks/specs.mjs` (file, exact text, replacement, test command). Two breaks first survived and showed real test gaps that I closed: the "MAX_GAMES" tests imported the constant they were meant to guard (so they moved with it; now the number 3 is written out), and the approver test used a nonsense key (now also another Organizer's key); the matrix break checks needed `--sample` because the first N scenarios never reach the slow-moving dimensions.

## 5. Failing tests (first 8 error lines each)

### apps/edge (final log)

- **the Organizer's own sign-up and sign-in e-mail (/api/start, /api/auth/email) > F-1: a full-width ＠ or an inner space is read as the same address as the plain one (checklist A3), not refused**  
  file: `apps/edge/test/t30-findings.test.ts`

  ```
  error: expect(received).toEqual(expected)
    {
  -   "DEMO6＠DEMO-TEST.INVALID": 200,
  -   "demo 6@demo-test.invalid": 200,
  -   "demo6 @demo-test.invalid": 200,
  +   "DEMO6＠DEMO-TEST.INVALID": 400,
  +   "demo 6@demo-test.invalid": 400,
  +   "demo6 @demo-test.invalid": 400,
  ```

- **the Organizer's own sign-up and sign-in e-mail (/api/start, /api/auth/email) > F-1: the same on the sign-in door /api/auth/email (an existing account is found by the full-width spelling)**  
  file: `apps/edge/test/t30-findings.test.ts`

  ```
  error: expect(received).not.toBe(expected)
  Expected: not 400
  ```



### apps/web (final log)

- **v.js on the home page > it tells the page view first, with where the visit came from and the device, and watches the home page's sections**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "top"
  Received: [ "trust", "game-day" ]
  ```

- **v.js on the home page > section views carry the time each section was on screen, and only what is new in each message**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  TypeError: null is not an object (evaluating 'el.getAttribute')
  ```

- **v.js on the home page > choosing a size in the price card (#pack2) and in the home drop-down (#pack) each tell the size and the price shown**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  TypeError: null is not an object (evaluating 'pack2.value = "2500"')
  ```

- **v.js on the home page > pressing Create sends at once, with the size and the price; switching currency and opening Log in are actions too**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  error: no element .pcta
  ```

- **v.js on the home page > when the page is hidden an exit message goes with the last section seen, the time on the page and how far it was scrolled**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  TypeError: null is not an object (evaluating 'el.getAttribute')
  ```

- **v.js on the home page > messages hold at most 20 events**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  error: no element [data-c="INR"]
  ```

- **privacy signal > with Global Privacy Control on, no visitor id is made, nothing is stored in the browser, no id header goes out, and the server keeps counts only**  
  file: `apps/web/test/visits-dom.test.ts`

  ```
  TypeError: null is not an object (evaluating 'el.getAttribute')
  ```

- **each indexable page > every image has alt text and a size, and the picture at the top loads early**  
  file: `apps/web/test/seo.test.ts`

  ```
  error: expect(received).toMatch(expected)
  Expected substring or pattern: /<img src="\/img\/card\.png"[^>]*fetchpriority="high"/
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Corporate Tic Tac Toe |
  ```

- **each indexable page > quick loading: fonts are self-hosted and swap in, the two main fonts are preloaded, scripts do not block the page, nothing third-party is loaded on the home page**  
  file: `apps/web/test/seo.test.ts`

  ```
  TypeError: null is not an object (evaluating 'f.match(/font-display: swap/g).length')
  ```

- **R9: the storage notice matches the code > every key the scripts keep on a device is listed in storage-registry.json**  
  file: `apps/web/test/storage-notice.test.ts`

  ```
  error: expect(received).toEqual(expected)
  - []
  + [
  +   "theme-init.js: localStorage ct-theme",
  +   "theme-init.js: localStorage cg-theme",
  + ]
  - Expected  - 1
  + Received  + 4
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > index.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Corporate Tic Tac Toe |
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > how-it-works.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>How it works | Corporat
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > guide.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Guide for organizers | 
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > brochure.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Brochure | Corporate Ti
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > refer.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Refer and earn | Corpor
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > thank-you.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Thank you | Corporate T
  ```

- **F-2: pages that load the black box also load the guide first (guide.test.ts rule, applies to the new pages) > game-completed.html: guide.js before blackbox.js**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Game completed | Corpor
  ```

- **the employee ID box and its hint line > F-4: a game set to 'mobile number or employee ID' (verify=either) shows the employee-ID box and its hint line**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).toBe(expected)
  Expected: true
  Received: false
  ```

- **the employee ID box and its hint line > F-3: an e-mail typed in the ID box does not get a 'will read this as' promise (the server refuses it with bad-id)**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).not.toMatch(expected)
  Expected substring or pattern: not /will read this as/
  Received: "The system will read this as DEMO1DEMOTESTINVALID"
  ```

- **the employee ID box and its hint line > F-3: an ID that is longer than 30 after cleaning does not get a 'will read this as' promise (the server refuses it)**  
  file: `apps/web/test/t30-findings.test.ts`

  ```
  error: expect(received).not.toMatch(expected)
  Expected substring or pattern: not /will read this as/
  Received: "The system will read this as AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  ```

- **console phase 2: wording fixes, My people, waiting room, remove, play now (real Worker) > wording: no 'engagement' anywhere in the ten steps, singular and plural right, friendly dates, 365-day line says who is kept, step 9 line does not repeat its title**  
  file: `apps/web/test/pages.test.ts`

  ```
  error: timed out waiting; page says: Corporate Tic Tac ToeSigned in as OrganizerPayment pending for this gameYour game · 1 Oct 2026 4:30 pmAll gamesSign outA payment is pending for this game. Just one
  ```

- **console: no refunds (credit), games that wait or did not start, 'Create a new game like this one', rescheduling > Create a new game like this one: on the game page and in the games list (not for a Co-host); the people tick box only when the old list exists; the new game opens on step 1 with the date and time empty and the read-back with Change buttons**  
  file: `apps/web/test/pages.test.ts`

  ```
  error: timed out waiting; page says: Corporate Tic Tac ToeSigned in as OrganizerDraft · not published yetCopied game · 1 Oct 2026 4:30 pmAll gamesSign outYour progress · saved0 of 10 done · 0% Jump to
  ```

- **console: no refunds (credit), games that wait or did not start, 'Create a new game like this one', rescheduling > Rescheduling: a date more than 30 days ahead is refused politely before anything is sent; the server's own message (a game that has started) is shown as it is**  
  file: `apps/web/test/pages.test.ts`

  ```
  error: timed out waiting; page says: Corporate Tic Tac ToeSigned in as OrganizerDraft · not published yetYour game · 1 Oct 2026 4:30 pmAll gamesSign outYour progress · saved0 of 10 done · 0% Jump to12
  ```

- **the screens use it > the console, the pay page, the pay link, the player screen and the shared helper all give their errors a guide**  
  file: `apps/web/test/guide.test.ts`

  ```
  error: expect(received).toContain(expected)
  Expected to contain: "src=\"/guide.js\""
  Received: "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>Corporate Tic Tac Toe |
  ```



## 6. Which red is which

| Test(s) | Kind | Where it is explained |
|---|---|---|
| `t30-findings.test.ts` (edge, 2) | RED ON PURPOSE: product bug F-1 | docs/TEST_FINDINGS.md |
| `t30-findings.test.ts` (web, 10) | RED ON PURPOSE: F-2 (7), F-3 (2), F-4 (1) | docs/TEST_FINDINGS.md |
| `guide.test.ts` (1) | same product bug as F-2, existing test | docs/TEST_FINDINGS.md F-2 |
| `storage-notice.test.ts` (1) | product bug F-5 (registry lacks theme keys) | docs/TEST_FINDINGS.md F-5 |
| `visits-dom.test.ts` (7), `seo.test.ts` (2), `pages.test.ts` (3) | old test vs moved product: Boss decides | docs/TEST_FINDINGS.md "Old tests that are red" |
| `join-retry.test.ts` (1 in the final run) | FLAKY: timing test, red 2 of 10 runs on the untouched coder branch and 5 of 10 runs alone on the test branch | not a product or test-author change |

## 7. What was not done

- No browser check (K7, 360/768/1280, light and dark): needs a one-Chrome session; the matrix does not replace it.
- Host and Co-host roles as approvers were not driven through the Worker (hostsetup flows are covered only by the existing host-setup tests and the e-mail wire test).
- Checklist rows A2 (every path), A4, A6, A7, B*, C*, D3, E*, F3, G*, H*, I*, J*, K7-K13 stay open; this run does not tick any of them. Evidence for rows it supports: A1, A3 (not met: F-1), A5 (partly: F-3, F-4), M1t (brand-kit.test.ts, seo.test.ts, t30-pages), M2t (index nav test), F1t/F3t/F5t (t30-formats), D4 (t30-regress consent).
