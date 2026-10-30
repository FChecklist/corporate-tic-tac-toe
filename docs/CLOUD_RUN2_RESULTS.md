# Cloud run 2 results

- Date: 2026-10-30
- Tested: branch `claude/site-tictactoe-f9dd93`, head `acef259` (employee-ID and e-mail cleaners added)
- Base for comparison: `045d629` (master, Tic Tac Toe 1.3.1). Base was re-run only for the failing test files that exist on base.
- Machine: cloud Linux, Bun 1.4.4. Nothing was fixed, nothing was deployed. Only this file was added.

## Summary

- **Branch now has 30 failures** (run 1: 36). `apps/edge` 14, `apps/web` 16. Other four folders pass.
- **Typecheck: 83 errors** (run 1: 82). One is NEW: `apps/edge/src/google.ts(69,49): Cannot find name 'cleanEmail'` (the file uses `cleanEmail` but does not import it from `./ids`). This is the likely cause of 10 of the 12 new edge failures (all the Google sign-in tests).
- **Fixed since run 1: 22.** Remaining from run 1: 13 of the 34 new ones. **New in run 2: 15.** (22 fixed + 13 remaining = 35 run-1 branch failures, minus 1 test counted in both lists below; see the tables for exact lists.)
- Pre-existing, still failing: 2 (`pages.test.ts`, "Create a new game like this one", "Rescheduling").
- Bun did not crash. No folder had to be split.

## Install, builds, typecheck

| Step | Result |
|---|---|
| `bun install` | OK, 17 packages |
| `build:control`, `build:report`, `build:ttt`, `build:zgame`, `pages:build` | all OK (exit 0) |
| `bun run typecheck` | **83 errors** (82 old + 1 new in `apps/edge/src/google.ts`) |

- The 82 old errors are unchanged: mostly test files (`param-people` 21, `param-config` 17, `join-gaps` 13, `demo-pass` 8, `param-life` 7, `beacon/test/config` 4, others 1-3, `beacon/src/game.ts` 1).
- The builds rewrote the 4 tracked files in `apps/web/public`. They were reverted. `bun.lock` is untracked and not committed.

## Test counts per folder (`bun test --isolate <folder>`)

| Folder | Pass | Fail | Skipped | Run 1 fail |
|---|---|---|---|---|
| `packages/ttt` | 105 | 0 | 0 | 0 |
| `packages/beacon` | 87 | 0 | 0 | 0 |
| `packages/billing` | 26 | 0 | 0 | 0 |
| `tools/control-worker` | 1 | 0 | 0 | 0 |
| `apps/edge` (74 files) | 1335 | **14** | 0 | 11 |
| `apps/web` (28 files) | 245 | **16** | 0 | 25 |
| **Total** | **1799** | **30** | 0 | 36 |

(`packages/shared` has no test files.)

## Failures: `apps/edge` (14, all NEW versus base; all pass on base 045d629)

### A. Still failing from run 1 (2), error text changed

| File | Test | First error |
|---|---|---|
| `branding.test.ts` | claims register: ... > structured data prices equal the real packs | Expected page to contain `"Festive offer: 50% off"`. (Run 1 failed on `lowPrice` 2399; that part now passes.) |
| `terms.test.ts` | the document pages > the home page and the legal page link the documents | Home page lacks `href="/organizer-guide.html"`. (Run 1: lacked `/terms.html`; fixed.) |

### B. New in run 2: Google sign-in (10), likely one cause

Cause: `cleanEmail` is not imported in `apps/edge/src/google.ts` (typecheck error above). The `catch` returns `why: "format"`, so the API answers 400 / `google-failed`.

- `google-signin.test.ts` (6): "a good token verifies, and returns the lower-cased e-mail only" (toEqual fails); "the signing keys are fetched once and kept" (expected true, got false); "sign up with a new e-mail makes the Organizer account" (expected 200, got 400); "an existing account signs in" (toMatchObject fails); "signing in with an e-mail that has no account is a calm 404" (expected 404, got 400); "the same limits as the e-mail sign-in" (expected 200, got 400).
- `host-setup.test.ts` (4), all "Google can satisfy the e-mail step (intent 'host')": "the Google e-mail must equal the e-mail the Host was added with" (expected 403, got 400); "a matching Google e-mail finishes the e-mail step" (toMatchObject); "a Host added with a mobile only may use any Google e-mail" (expected true, got undefined); "an expired, used, unknown or missing link key is refused" (expected `host-link-gone`, got `google-failed`).
- I did not change the code to confirm. The match with the typecheck error is strong but unverified.

### C. New in run 2: new employee-ID cleaner against old tests (2)

- `verify.test.ts` > employee ID > "an ID is trimmed and upper-cased; rubbish is refused; blank is blank": `normEmp("a<b>")` expected `null`, got `"AB"`. The new cleaner removes symbols instead of refusing. Test and cleaner disagree; the laptop session decides which is right.
- `verify.test.ts` > employees only, ID alone > "a listed employee joins with the ID only; ...": toMatchObject fails (same cause family; the ID is now stored in cleaned form).

## Failures: `apps/web` (16)

### Pre-existing (2): fail on base 045d629 too

- `pages.test.ts` > "Create a new game like this one: ..." : timed out waiting; page says "Draft · not published yet ...".
- `pages.test.ts` > "Rescheduling: a date more than 30 days ahead is refused politely ...": same kind of timeout.

### Still failing from run 1 (11), NEW versus base

- `visits-dom.test.ts` (7), all about the home page: "it tells the page view first" (sections should contain `"top"`, got `["trust","game-day"]`); "section views carry the time ..." (`el.getAttribute` on null); "choosing a size in the price card (#pack2) ..." (`pack2` is null); "pressing Create sends at once ..." (no element `.pcta`); "when the page is hidden an exit message ..." (null element); "messages hold at most 20 events" (no element `[data-c="INR"]`); privacy signal "with Global Privacy Control on, ..." (null element). Run 1's 8th test in this file ("none of the game pages loads the script") is now fixed.
- `seo.test.ts` (2): "every image has alt text and a size, and the picture at the top loads early" (no `<img src="/img/card.png" ... fetchpriority="high">`); "quick loading: fonts are self-hosted and swap in ..." (`f.match(/font-display: swap/g)` is null).
- `storage-notice.test.ts` (1): "every key the scripts keep on a device is listed in storage-registry.json". Missing keys: `theme-init.js: localStorage ct-theme` and `theme-init.js: localStorage cg-theme`.
- `pages.test.ts` (1): console phase 2 > "wording: no 'engagement' anywhere in the ten steps ...": timed out waiting in the console flow (page shows "Payment pending for this game"). Repeatable in run 1 as well.

### New in run 2 (3)

- `pages.test.ts` > console phase 2 > "Who is this game for: a tick for employees only ...": toMatchObject fails, expected `empId: "E-101"`, got `"E101"`. The new ID cleaner strips the dash; test not updated.
- `guide.test.ts` > "the screens use it > the console, the pay page, the pay link, the player screen and the shared helper all give their errors a guide": a page lacks `src="/guide.js"`. Passes on base.
- `brand-kit.test.ts` > "every new public page has the six-item menu, the logo, the bar, canonical and share tags, and never the banned word": the six-item menu list for `index` comes out empty (expected How it works, Free demo game, Guide, Brochure, Refer & earn, Log in). New test file, not on base.

## Run 1 versus run 2

Fixed since run 1 (22):
- `apps/edge`: all 7 `no-other-game-words` tests; `branding` theme colour test; `terms` "public website pages describe Bingo only" test. (The two others in this area are listed above as still failing with a different error.)
- `apps/web`: both `copy-honest` tests; both `gamesbar` tests; `blackbox` (1); `server-copy` (1); `seo` sitemap, `index.html` title/lang, `brochure.html` canonical and structured data (4); `pages` Refer & Earn partner link (1); `visits-dom` "none of the game pages loads the script" (1); `storage-notice` is NOT fixed (see above). `join-retry` (pre-existing in run 1) still passes.

Remaining from run 1: 2 edge + 11 web = 13 (listed above).

New in run 2: 12 edge (10 Google, 2 employee ID) + 3 web (1 employee ID, `guide`, `brand-kit`) = 15. The two employee-ID web/edge changes and the Google import come from the last commit `acef259`.

Counting check: run 1 branch failures 36 = 2 pre-existing + 34 new. Run 2 branch failures 30 = 2 pre-existing + 13 remaining + 15 new.

## Reproduce

```bash
git checkout claude/site-tictactoe-f9dd93
bun install
bun run build:control && bun run build:report && bun run build:ttt && bun run build:zgame && bun run pages:build
git checkout -- apps/web/public
bun run typecheck
bun test --isolate apps/edge
bun test --isolate apps/web
```
