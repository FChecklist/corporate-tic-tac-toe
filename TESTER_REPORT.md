# Tester report, Tic Tac Toe 1.4.1 (30 Oct 2026)

Branch `tests/ttt-1.4.1-2026-10-30`, cut from `origin/fix/ttt-1.4.1-2026-10-30` (0ecf682). The fix branch was already cut from the tests branch (02f4381), so all earlier tests were already in it; nothing had to be merged.
**No product file was changed.** `git diff origin/fix/ttt-1.4.1-2026-10-30 -- apps/edge/src apps/web/public packages tools pages` is empty. (The older `docs/TESTER_REPORT.md` is the 30 Oct first-run report and is left as it was.)

## Counts (last summary line of each run, one run per folder, `bun test --isolate <folder>`)
| Folder | Pass | Fail | Notes |
|---|---|---|---|
| packages/beacon | 87 | 0 | |
| packages/billing | 26 | 0 | |
| packages/shared | - | - | no test files exist (bun: "filters did not match any test files") |
| apps/edge | 1447 | 0 | 82 files; was 1417 pass / 15 fail at the start |
| apps/web | 395 | 1 | plus 1 `todo`; was 359 pass / 16 fail at the start. The 1 fail is product finding P-1 |
| tools/control-worker | 1 | 0 | |
| `bun run typecheck` | | **1 error** | `packages/beacon/src/game.ts(12,14)`, a PRODUCT file (P-3). Was 82 errors; the 81 in test files are fixed |

I could not get the typecheck to 0 without editing product code, so it is not 0. I did not hide the error (no tsconfig change).

## What I changed in the old tests (test code only)
Owner rule: account / sign-in / host / Google e-mails REFUSE inner spaces and full-width at-signs (only trimmed and lower-cased). Only a participant's Email ID removes inner spaces.
- `t30-findings` F-1 x2: now expect 400 and no account made. `ids.test.ts` normMail line: now `rajat1＠demo.com` (not repaired). Same rule fixed in `t30-email.test` (normMail x3, host e-mail hash) and `t30-email-wire.test` (Google token with inner space / full-width: refused; upper case still one account). I found these myself: they were red for the same reason and were not on the coder's list.
- `seo.test`: fonts regex `font-display:\s*swap`. Also two more stale lines I found: the home page now loads `theme-init.js` in the head on purpose (687 bytes, allowed, size and place asserted) and its script tail is the new deferred list (guide.js before blackbox.js).
- `visits-dom` x7: the home page has no buy block. Sections are now `top`, `trust`, `game-day` (exactly those three are asserted). Test added that the buy controls are absent. The pack / Create / currency / Log in tests still cover v.js by adding those controls to the real page before pressing them (v.js is unchanged and still reads them).
- `big-lost`, `join-retry`, `t30-joinpage`: no fixed sleeps decide any result any more (`until(condition)` polls every 2 ms, 4 s limit). Run 3 times in a row: green each time. One sleep stays on purpose (150 ms) to prove that NO retry follows a refusal.
- `pages.test` and `harness.ts`: the test clock `T` was 1 Oct 2026, now the real hour; dates are relative (`istDate(n)`, `friendlyDay`). Also a stale text: step 10 now says "names and numbers are deleted at 20 hours (we promise within 24)".
- `t30-join-wire`: join refusals now have the coder's new sentences (e-mail sentence; "(up to 30)").
- `verify.test`: changing `verify` after someone joined is now locked (400 `ids-locked`); the test asserts that, and the 'both' case runs in a game made with 'both'.
- `t30-join-hint`: the hint is not shown above 30 characters left, and not when cleaning changes nothing visible; oracle updated.
- Typecheck: header types in param-harness, consent.test `draft`, duplicate imports, `"blackout"` casts, a dead `"full2"` comparison.

## New tests
- `apps/edge/test/t41-owner-rules.test.ts` (11): isTestLogin refuses 16 spellings incl. `demo 1＠xyz.in`; cleanAccountEmail only trims and lower-cases; the sign-in door answers 400 and makes nothing; `ids-locked` (exact sentence, code, nothing changes) tested with PERSON rows only and PARTICIPANT rows only (person rows deleted first so the participant row alone must lock), email-to-employee direction, unchanged value allowed, other settings still save; EMP_CLEAN_FROM_MS >= 1 Jan 2099 and behaviour on both sides of it (a game created today keeps the old rule on the cleaner, `normId`, the wire and `badIdMessage`; created at the constant gets the new rule).
- `apps/web/test/t41-join-rules.test.ts` (20 + 1 todo): hint only where the server cleans; never for an e-mail in an employee-ID box (plain, full-width, small `﹫`, spaces; modes id / both / either); not above 30; Email ID hint; `either` shows the ID box (both kinds); guide.js before blackbox.js on the seven new pages; regex backslashes by behaviour and in the file text.
- `apps/edge/test/t41-id-matrix.test.ts` + oracle `t41-id-oracle.ts` (3): see below.

### The matrix
**1,300,000 distinct inputs, exact** (counted by a Set; the test asserts it equals the number checked and is at least 1,000,000). Built from 92 hand-answered tokens (ASCII, full-width, `ß` and `ẞ`, dashes of 5 kinds, Devanagari digits, compatibility letters `ﬁ ℌ Ⅷ ² ① K ſ ǅ`, Turkish i, other scripts, emoji, 9 kinds of space, zero-width marks, soft hyphen, `@` in 3 forms, pieces of real addresses, runs of 29 to 255 characters, empty): every sequence of 0 to 3 tokens, then seeded random sequences of 4 to 8. Each input goes through 8 rules (cleanEmpId, empHint, cleanEmail, normEmpFor new, normId emp, normId email, normEmpFor old, cleanAccountEmail) = 10,400,000 checks, against an oracle that carries the expected answer on each token (written from the Unicode chart, never asked from ids.ts). Outcomes exercised: employee ID accepted 564,284 / refused 734,588; Email ID accepted 70,722 / refused 1,226,251. No mismatch. A 150-input sample per kind also goes through the real join endpoint (accepted waits, empty = need-id, refused = bad-id).
The product matched the oracle on the first run, so the matrix found no product bug. Its strength is shown by the break checks below (every mutation that I made to a cleaner turned it red).

## Deliberate-break checks (product line changed, test run, line restored with `git checkout`, test run again)
| Break | Red | Green again |
|---|---|---|
| ttt.js: hint allowed for an e-mail in an ID box | 1 fail | 20/0 |
| ttt.js: `either` removed from askWhat | 4 fail | 20/0 |
| ttt.js: `\s` / `\.` backslashes lost in the e-mail regex | 3 fail | 20/0 |
| ttt.js: hint shown above 30 | 1 fail | 20/0 |
| thank-you.html: guide.js moved after blackbox.js | 1 fail | 20/0 |
| worker.ts: lock ignores person rows | 2 fail | 11/0 |
| worker.ts: lock ignores participant rows | 1 fail | 11/0 |
| worker.ts: lock sentence changed | 2 fail | 11/0 |
| testlogins.ts: isTestLogin repairs full-width / spaces | 1 fail | 11/0 |
| ids.ts: cleanAccountEmail repairs (NFKC + spaces) | 5 fail (ids, t30-email, t41) | 27/0 |
| ids.ts: EMP_CLEAN_FROM_MS set to 2026 | 1 fail | 11/0 |
| matrix: cleanEmpId loses upper case | 1 fail | 1/0 |
| matrix: cleanEmpId keeps dashes | 1 fail | 1/0 |
| matrix: cleanEmail keeps zero-width marks | 1 fail | 1/0 |
| matrix: cleanEmail loses NFKC | 1 fail | 1/0 |
| matrix: employee ID accepts an e-mail | 1 fail | 1/0 |
| matrix: employee ID limit 31 | 1 fail | 1/0 |
| matrix: Email ID local part 65 (people.ts) | 1 fail | 1/0 |
| matrix: old rule allows `~` | 1 fail | 1/0 |
| matrix: account e-mail trims inner spaces | 1 fail | 1/0 |
| matrix: people.ts regex loses `\s` | 1 fail | 1/0 |
| matrix: people.ts regex loses `\.` | 1 fail | 1/0 |
First attempts that did not count: two mutations did not apply (my command text changed `​`; redone with code), one survived (`~` in the old rule) until I added `~ ! : , %` to the vocabulary, and the first two worker lock mutations broke the SQL itself (not a clean break); redone with `0 *`. The five ttt.js rows were read from the run output, not from the log file. After the last check, `git status` shows no product file changed.
Regexes the coder wrote (diff 02f4381..HEAD): all have real backslashes (ids.ts, people.ts, ttt.js, checked in the file and by behaviour). The zero-width class in ttt.js holds the marks as literal invisible characters, not `\u` escapes; it works, but it is easy to damage in an editor.

## Anything that looks like a PRODUCT bug (not fixed)
- **P-1 guide.js has no entry for the new lock message.** `apps/web/test/guide.test.ts:40` fails: `worker.ts:2003 [400] You already have people listed. Start a new game to use a different kind of ID.` is a message a person sees in the console, but `guide.js` has no catalog entry (what happened, what to do). I did not add it to the "no person ever sees" list, because that would hide a real gap. Needs a guide.js entry.
- **P-2 The page hint and the server disagree today.** EMP_CLEAN_FROM_MS is 2099, so every game keeps the OLD employee-ID rule: the server keeps `1b-678` as `1B-678`. But ttt.js already says "The system will read this as 1B678". The hint is wrong for every game until the release session sets the constant. Evidence: `t41-owner-rules` (server side, today's date) and `t41-join-rules` (hint). Recorded as a `test.todo`. Release must set the constant, and the order of release matters.
- **P-3 Typecheck error in product code**, `packages/beacon/src/game.ts:12`: `ALL_PATTERNS: readonly PatternId[] = PATTERN_ORDER`, but `PATTERN_ORDER` is `HouseId[]` (`config.ts:7`, "first".."fifth"). It comes from the 1.3.0 merge (c00e029), not from this fix pass. Typecheck cannot be 0 until the type is fixed.
- P-4 (smaller, for your judgment): the lock counts `person` and `participant` rows only. People in the waiting room (`waiting` table) do not lock, so the kind of ID can still be changed while people wait with IDs of the old kind. The owner rule says "listed or joined", so this may be intended.
- P-5 (observation): no page in `apps/web/public` has `#pack`, `data-buy`, `#loginLink` or a "pricing" section, so the visit funnel steps 1 to 3 (pricing seen, size chosen, Create pressed) can never be reached on the live site; that part of v.js is dead code and the owner's funnel will show zero there.
- P-6 (minor): the hint is hidden when only an invisible byte-order mark differs, because `.trim()` removes it before the compare. Harmless.
- Footer and tests say "Version 1.5.0" while the branch and handoff say 1.4.1. Not a defect I can judge; check the release number.

## Honest notes
- Midway I ran a stray `git checkout` that put the work tree on the old tests commit for a few minutes (no data lost; the branch was restored, and every test file I had run in that window was run again on the real head before the final counts).
- Not run: browser click tests (`tools/browser-tests`), `tools/sim2`, `tools/breakchecks`. The 'both sides' of EMP_CLEAN_FROM_MS is read as: before the constant (every game today) and at/after it; there is no web-side copy of the constant.
- `bun.lock` made by `bun install` is not committed.
