# Cloud run 1 results

- Date: 2026-10-30
- Tested: branch `claude/site-tictactoe-f9dd93`, head `0e9ea52` (Site 1.5.0, "file work, untested")
- Base for comparison: `045d629` (master, Tic Tac Toe 1.3.1)
- Machine: cloud Linux, 16 GB RAM, 4 CPU, Bun 1.4.4 (laptop baseline was Bun 1.3.1)
- Nothing was fixed, nothing was deployed. Only this file was added.

## Summary

- **Clean install fixes the laptop's missing `@noble` problem.** `bun install` took about 1 s. `@noble/curves` and `@noble/hashes` are installed under `packages/beacon/node_modules`. No install errors.
- **Bun did not crash.** Every folder ran in one go with `bun test --isolate`. No splitting was needed.
- **Branch: 36 failures in 2 folders** (`apps/edge` 11, `apps/web` 25). Every other folder passes.
- **Base 045d629: 3 failures**, all in `apps/web`.
- **34 failures are NEW from the branch** (11 edge, 23 web). 2 failures are pre-existing and still fail on the branch (both in `apps/web/test/pages.test.ts`). 1 more pre-existing failure (`join-retry.test.ts`) is fixed by the branch.
- Main suspect for most new failures: the new `apps/web/public/index.html` (home page). Details at the end.

## Install, builds, typecheck

| Step | Branch 0e9ea52 | Base 045d629 |
|---|---|---|
| `bun install` | OK, 17 packages | OK |
| `build:control`, `build:report`, `build:ttt`, `build:zgame` | all OK | all OK |
| `pages:build` | OK | OK |
| `bun run typecheck` (`tsc --noEmit`) | **82 errors** | **82 errors** (same list, line numbers ignored) |

- The 82 type errors are pre-existing and unchanged by the branch. They are almost all in test files: 75 are TS2345 (argument type), 4 are TS2300 (duplicate `handle` import in `ai-enablement.test.ts` and `privacy.test.ts`), 1 is TS2322, 2 are TS2367.
- Biggest files: `param-people.test.ts` 21, `param-config.test.ts` 17, `join-gaps.test.ts` 13, `demo-pass.test.ts` 8, `param-life.test.ts` 7, `beacon/test/config.test.ts` 4, `beacon/src/game.ts` 1 (`HouseId[]` vs `PatternId[]`).
- Running the build scripts rewrites 4 tracked files (`apps/web/public/control.js`, `reportgen.js`, `tttgame.js`, `zgame.js`). I reverted them. Nothing from the builds is in this commit.
- `bun install` also creates an untracked `bun.lock`. It is not committed.

## Test counts per folder (`bun test --isolate <folder>`)

| Folder | Branch pass | Branch fail | Skipped | Base pass | Base fail |
|---|---|---|---|---|---|
| `packages/ttt` | 105 | 0 | 0 | 103 | 0 |
| `packages/beacon` | 87 | 0 | 0 | 87 | 0 |
| `packages/billing` | 26 | 0 | 0 | 26 | 0 |
| `packages/shared` | no test files | - | - | - | - |
| `tools/control-worker` | 1 | 0 | 0 | 1 | 0 |
| `apps/edge` (73 files) | 1332 | **11** | 0 | 1334 | 0 |
| `apps/web` (28 files) | 229 | **25** | 0 | 222 | 3 |
| **Total** | **1780** | **36** | 0 | 1773 | 3 |

- There were no "errors" counted separately, only fails. Skipped and todo are 0 everywhere.
- `packages/shared` has no `*.test.*` files, so `bun test` exits 1 with "no tests found". Not a failure.
- Edge count went 1343 tests (branch) against 1334 (base). Web went 254 against 225. The branch added 8 test files.
- `apps/edge` base had 0 failures, so all 11 edge failures are new.

## Failures: `apps/edge` (all 11 NEW)

`apps/edge/test/branding.test.ts`
- `index.html: title names Corporate Tic Tac Toe exactly; favicon, touch icon, manifest and theme colour`
  - Expected theme colour `#0B5D5B`, page has `#0B3D91` (and `data-theme="blue"`).
- `structured data prices equal the real packs`
  - Expected `"lowPrice":"2399"` in the home page, not found.

`apps/edge/test/terms.test.ts`
- `the home page and the legal page link the documents (footer; ...)`
  - Home page does not contain `href="/terms.html"`.
- `the public website pages describe Bingo only: no words of the game this product was copied from, and the software-only line is on the key pages`
  - `toEqual` on the page list: `index.html` is in the diff.

`apps/edge/test/no-other-game-words.test.ts` (7 tests, same error: expected `null`, received `"tambola"`)
- `page file index.html`
- `page file refer.html`
- `page file game-completed.html`
- `page file brochure.html`
- `page file guide.html`
- `page file how-it-works.html`
- `page file thank-you.html`
- Cause: the new games bar footer links to `https://housie.corporatetambola.com/` with the label "Tambola". The test forbids that word on Tic Tac Toe pages. Two of these pages (`game-completed.html`, `thank-you.html`) are new in the branch.

## Failures: `apps/web` (25 total)

### Pre-existing (3): failing on base 045d629

| File | Test | Status |
|---|---|---|
| `pages.test.ts` | `Create a new game like this one: on the game page and in the games list ...` | Fails on base and branch: "timed out waiting; page says: ... Draft · not published yet ..." |
| `pages.test.ts` | `Rescheduling: a date more than 30 days ahead is refused politely ...` | Fails on base and branch: same kind of timeout |
| `join-retry.test.ts` | `a 'busy' answer shows 'Many people are joining right now' and is asked again` | Fails on base only. **Passes on the branch** (fixed). |

So 2 of the 25 branch failures are pre-existing. I ran `pages.test.ts` alone on both: base has exactly those 2, branch has those 2 plus the 2 new ones below.

### NEW from the branch (23)

25 branch failures = 2 pre-existing + 23 new. Total new across both folders = 11 + 23 = 34.

`visits-dom.test.ts` (8)
- `it tells the page view first, with where the visit came from and the device, ...` : expected sections to contain `"top"`, got `["trust","game-day"]`.
- `section views carry the time each section was on screen, ...` : `null is not an object (evaluating 'el.getAttribute')` at `harness.ts:54`.
- `choosing a size in the price card (#pack2) and in the home drop-down (#pack) ...` : `null is not an object (evaluating 'pack2.value = "2500"')`.
- `pressing Create sends at once, with the size and the price; ...` : `no element .pcta`.
- `when the page is hidden an exit message goes with the last section seen, ...` : `el.getAttribute` null error.
- `messages hold at most 20 events` : `no element [data-c="INR"]`.
- `with Global Privacy Control on, no visitor id is made, ...` : `el.getAttribute` null error.
- `none of the game pages loads the script, and the public pages do` : page list diff, `index.html` in the diff.

`copy-honest.test.ts` (2)
- `no page says 'tested with 1,000 players'; ...` : home page lacks `/1,000 simulated players/`. The page text received starts with a Bingo card ("B I N G O 7 21 38 ...").
- `home page, legal page and trust page no longer say no person can change a result, ...` : lacks `/picks the winner of that one board/`.

`seo.test.ts` (6)
- `every indexable page is listed once, ...` (sitemap) : `dpa.html` and other lines differ from the sitemap.
- `index.html: unique title and description, canonical, ...` : expected `<html lang="en">`, page has `<html lang="en" data-theme="blue">`.
- `brochure.html: ...` : canonical is `https://tictactoe.corporatetambola.com/brochure`, expected `.../brochure.html`.
- `the home page's structured data parses and its prices equal the real packs` : `JSON Parse error: Unexpected EOF` (no structured data block).
- `every image has alt text and a size, and the picture at the top loads early` : expected `<img src="/img/card.png" ... fetchpriority="high">`.
- `quick loading: fonts are self-hosted and swap in, ...` : `f.match(/font-display: swap/g)` is null.

`storage-notice.test.ts` (1)
- `every key the scripts keep on a device is listed in storage-registry.json` : `toEqual([])` fails, some keys are not listed (new scripts or pages keep keys not in the registry).

`blackbox.test.ts` (1)
- `every built page that reports page speed also runs the recorder, ...` : a built page lacks `src="/blackbox.js"`.

`gamesbar.test.ts` (2)
- `every public page loads it, no play / console / pay page does, ...` : `index` does not contain `src="/gamesbar.js"`.
- `the bar has exactly the six links, Tic Tac Toe is current, ...` : `d.body.firstElementChild` should be the bar `.cg-bar`, but it is an `SVGSVGElement` (something is placed before the bar). The first run of this test also timed out after 45 s.

`pages.test.ts` (2 new, plus the 2 pre-existing above)
- `Refer & Earn page > the page is linked from the home page and listed for search engines, ...` : home page lacks `href="/partner.html"`.
- `console phase 2: wording fixes, ... > wording: no 'engagement' anywhere in the ten steps, ...` : "timed out waiting" in the console flow. Passes on base. Failed in both my runs of the branch (full run and single file), so it is repeatable, not a one-off.

`server-copy.test.ts` (1)
- `the trust page, the home page and the AI facts say it the right way round: ...` : page list diff, `index.html` in the diff.

## Reading the new failures

- **Most of the 34 new failures point to one file: `apps/web/public/index.html`.** Checks fail for it on theme colour (`#0B3D91`, `data-theme="blue"`), no `gamesbar.js`, no `terms.html`, `partner.html` or `blackbox.js`, no structured data, no `#pack`, `#pack2`, `.pcta` or `[data-c="INR"]`, no "simulated players" copy. The page text also contains a Bingo card ("B I N G O ..."). This looks like a landing page that came from another game's template and is not yet adapted to Tic Tac Toe. The laptop session should confirm this.
- **The word "Tambola"** appears in the games bar footer link in `index.html` and the other pages, which is why all of `no-other-game-words` fails. Either the test allow-list needs the sister-site link, or the bar's label has to change. That is for the owner and the laptop session to decide.
- `brochure.html` canonical points to `/brochure` (no `.html`), against the test.
- `storage-notice`, `blackbox` and the `wording` console test are separate causes and need their own look.

## How to reproduce

```bash
git checkout claude/site-tictactoe-f9dd93
bun install
bun run build:control && bun run build:report && bun run build:ttt && bun run build:zgame && bun run pages:build
bun run typecheck
bun test --isolate apps/edge
bun test --isolate apps/web
bun test --isolate packages/ttt packages/beacon packages/billing tools/control-worker
```

- The builds change 4 tracked files in `apps/web/public`. Run `git checkout -- apps/web/public` afterwards.
- `apps/web` takes about 130 s, `apps/edge` about 52 s.
