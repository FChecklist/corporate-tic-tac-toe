# Playbook: giving a Corporate Game the Tambola hardening (learned on Bingo, 2026-10-27)

Read first: `GAMES_AFTER_TAMBOLA.md` (the Bingo section says what was done and left out) and `C:\ct\test-sites\bingo` (the finished example; `git log` shows the two commits).
Owner rules: never spend money, no tokens or passwords in a repo, never deploy while a game is running, never switch a live site's mode (Tic Tac Toe, Snakes and Ladders, Luck by Chance are in TEST mode: leave them), do NOT touch tambola, DPDP, townhall. One heavy process at a time (laptop has about 1 GB free RAM): never run two `bun test` at once.

## 0. Traps on this laptop
* Bash `git` is a shim that cuts output to ~30 lines and corrupts `git show x > file`. Use `/mingw64/bin/git` (Bash) or the Windows path `C:/Program Files/Git/mingw64/bin/git.exe` (Python). Commit with `-F file` (no heredoc into git), name `-c user.name=FChecklist -c user.email=raajat.agarwal@gmail.com`, message ends with the Co-Authored-By line given by the system.
* Add bun to PATH: `export PATH="$PATH:/c/Users/Dell/AppData/Roaming/npm/node_modules/bun/node_modules/@oven/bun-windows-x64-baseline/bin"`.
* The snip filter can also cut long command output: write results to a file and read them with Python (`PYTHONIOENCODING=utf8`), not with `cat` of big files.
* A bash `sleep` over a few seconds is blocked: run long things in the background and watch with Monitor (`until grep -q FIN file; do sleep 5; done`).
* `bun test` of the whole repo takes about 10 minutes (`bun test packages apps --timeout 120000 > /tmp/x.txt 2>&1`). Run focused files while working.
* Windows CRLF: the repos have `core.autocrlf=true`; the merge scripts write LF, git normalises.

## 1. Where the game is
Each game is a copy of Tambola's platform with a different game package (`packages/beacon`, `packages/shared`) and different pages (`z.js` phone, `zc.js` console, `big.js` big screen). Live branch = `master` (origin FChecklist/corporate-<name>). The working branch `local/base-2026-10-24` is one commit ahead of master (`Local state before the port`); `origin/port/tambola-2026-10-24` has the first port. Build on `origin/port/tambola-2026-10-24` (as Bingo did): `git checkout -b rel/after-tambola origin/port/tambola-2026-10-24`. Check `git status` is clean first.

## 2. Merge Tambola's changes (script)
`python C:\ct\test-sites\docs-games\tools\port_game.py <game> "<Display name>" <dash-name>` merges Tambola 00d69f7..a87dad5 (about 110 files) into the game after translating names (ctz- to cbz-, ctk_ to cbk_, x-ct-link to x-cb-link, Tambola to the game). The games already use the `cb` prefixes. It prints the conflicting files. Tools in the same folder: `show.py file` (all conflicts), `wd.py file [width]` (word-level difference, much easier to read), `res.py file o,t,b,r,...` (pick per hunk: o ours, t theirs, b ours then theirs, r theirs then ours).
Decisions that worked on Bingo (apply the same unless the game really has the feature):
* Server platform files (worker.ts, people.ts, pay.ts, winners.ts, lifecycle.ts, report-layout.ts, checkin.ts, phonekit.ts, gamerecord.ts, testlogins.ts, admin.ts, ...): take Tambola's hunks (`t`), keep the game's own bits (time zone `tz`, its own houses/rules). Then fix names: table `cbl_request` (Tambola `ctl_request`), key prefixes `cbk_` `cba_` `cbh_`, header `x-cb-link`.
* Game engine files (`packages/beacon/src/game.ts`, `prize-engine.ts`, `phone-runtime.ts`, `config.ts` rules, `control-browser.ts`, `unique-ticket.ts`): KEEP THE GAME'S OWN (`o`) and `git checkout HEAD -- file` for files that got clean merged hunks calling Tambola-only methods. Only add platform pieces (VerifyMode `either`, `defaultMirrors` import in game.ts, beacon mirror skipping).
* Tambola-only rules to leave out: Bogey/claims/claim window, host-called manual mode (callMode, addHostKey, hostGameOf), ties question, check-in (make `checkinRequired` always false in checkin.ts), demo game conversion (`isDemoCfg`, "Make this a real game"), 90-number logic, prize-house names (full, early5...). Delete the ported tests of those features (hostcalls*, claims-page, claim-deadline, backfill-blocked, check-in tests, idiotproof-*, simpler-console, ctphone-parse, demo-pages).
* Pages (`zc.js`, `z.js`, `big.js`, css, html): do NOT merge wholesale (Tambola's console was rewritten and shares almost nothing). `git checkout HEAD -- apps/web/public/zc.js z.js ...` and port by hand only the points below. Generated bundles (`control.js`, `reportgen.js`, `zgame.js`) are rebuilt with `bun run build:control`, `build:report`, `build:zgame` AFTER the sources are final (zgame.js carries phone-runtime!).
* Marketing/legal pages (index.html, legal.html, terms.html, organizer-guide.html, pricing): keep the game's own.
* `pages/build.mjs`: take Tambola's version-stamp lines but delete from `FILES` every file that does not exist in the game's `apps/web/public` (the build says `missing x`); drop routes for pages the game lacks.
* `pages/wrangler.toml`: KEEP `DAILY_WRITE_BUDGET = "80000"` (free plan) and the game's own database id/name; take Tambola's JOIN_PER_IP_*, `AI_LINK_MAIL_AT_SIGNUP`, smart placement. Update `config/SECRETS_NAMES.md` rows so the secrets-names test passes (a var set in wrangler.toml must be listed as `wrangler var`).
* `apps/web/storage-registry.json`: add new keys (`cbz-pass`, `cbz-cap`) to existing items; do not add items (the privacy page would need regenerating).
* `apps/edge/src/releases.json` is NEW for the game: write the game's own history (see Bingo's), top entry = this release.
* Deletion clock: PURGE_AFTER_MS 20 h, REPORT_LINK_MS 19 h, OVERDUE_GRACE_MS 3 h (the lazy tick covers a late scheduler); update the older tests that say 23/22 hours.
* `DEMO_PASSES` in worker.ts: leave EMPTY (Tambola's prospect hashes are not for other games). Keep the mechanism (`POST /api/pass`, zc.js `?pass=`).

## 3. Page changes to do by hand (each with a test that you FALSIFY: disable the fix, see the test fail, restore)
1. `z.js` doJoin: a join that gets no answer is asked again by itself like a busy answer (see Bingo `z.js`, `BUSY_TRIES`, `J.mode === "busy"`, test `apps/web/test/join-retry.test.ts`).
2. `z.js`: `miQ` carries `&device=` (people calls), the `/over` call carries `device: myDevice()`; `phone-runtime.ts` vote carries `device: this.device()`. The server (`lifecycle.ts` over, `winners.ts` vote) always requires the device: forged votes/game-over answer 403 (test `join-gaps.test.ts`). Test helpers: `apps/edge/test/device.ts` SEEN_DEVICES, `settle.ts`, `privacy.test.ts overAs`, `packages/beacon/test/phone-runtime.test.ts ALLPHONES` (copy from Bingo).
3. `zc.js`: hide (never disable) the rarely used choice that does not apply (Bingo: the rounds group wrapped in `<div class="zc-hide" data-hidden="1">`; `.zc-hide{display:none !important}` in zc.css). Decide per game what is "advanced" (rounds fixed to 1, no tie question, prize counts above 5 hidden). Test in `apps/web/test/pages.test.ts` (copy the Bingo "simpler console" describe).
4. `zc.js`: demo-link redeem (`redeemPass`, `?pass=` capture, call in `refreshHome` and in `bootstrap` when the console opens straight into a game). Copy from Bingo zc.js (search `cbz-pass`); test is in Bingo pages.test.ts.
5. `big.js`: connection-lost bar (`lostBar`) if the game has a big screen.
6. `guide.js`: keep both the game's and Tambola's catalog entries (`b`), so every server message has a "what, where, how to fix" entry (`guide.test.ts` enforces it). Add entries for any message you add.
7. Messages: any new refusal needs what happened, where, how to fix.

## 4. Fix the tests (in this order, focused runs)
`bun x tsc --noEmit -p tsconfig.json` (only src errors matter; test type errors are noise), then per area: `bun test apps/edge`, `bun test packages`, `bun test apps/web`. Typical fallout seen on Bingo: ported tests expecting Tambola houses/90 numbers/cta_ prefixes; `param-harness.ts`; join writes cost ~8 units; `phone` format `91xxxxxxxxxx`; name-only join must still work if the game has it (keep the block in worker.ts join); a winner may leave the mobile empty if guests join by name; `trust.html`/`llms.txt` regenerate with `bun tools/make-trust.ts`; the old `sim2` permutation matrix may already be stale (compare with `git archive HEAD` copy before blaming yourself: make `bingo-base`-style baseline dir with junctions for `node_modules`, `packages/*/node_modules`).
Compare any failing test against the baseline (the code before your changes) before deciding it is yours.

## 5. 10-player Rs 0 demo + smoke
Add `apps/edge/test/demo10.test.ts` (copy Bingo's: 10 join, 11th refused, same phone same card). Live smoke: `node C:\ct\test-sites\tools\live-smoke-api.mjs https://<game>.corporatetambola.com` (test account demo1@xyz.in code 123456; it needs the game's join to work by name; adapt if the game joins differently). It leaves small SMK-* games that the deletion removes.

## 6. Commit, push, deploy
* Release note entry on top of `apps/edge/src/releases.json` (version, date, commit, title, plain changes), `git add -A`, commit with `-F`, `git checkout master`, `git merge --ff-only rel/after-tambola`, `git push origin master`.
* Check no game is running: `python -I -X utf8 C:\ct\test-sites\tools\live_games_now_game.py <D1 database_id from pages\wrangler.toml> 6` (must print 0 games).
* Deploy: `powershell -File C:\ct\test-sites\tools\deploy_game_live.ps1 -Game <dir> -Project <pages project name>`; the D1 token may report 'no permission' for CREATE TABLE of migrations 0026/0028; the Worker creates those tables itself at run time (check the live site works).
* Verify `https://<game>.corporatetambola.com/version.json` shows the new commit, mode unchanged (`/api/mode`), run the live smoke, then put the real commit hash in releases.json, commit, push, deploy once more.
* Update `GAMES_AFTER_TAMBOLA.md` (what changed, test counts, URL, version, left out, known gaps) and report to the boss session (`mcp__ccd_session_mgmt__send_message`, session_id `local_ce1ad2fd-541a-48dc-86d0-97d86457a006`).
