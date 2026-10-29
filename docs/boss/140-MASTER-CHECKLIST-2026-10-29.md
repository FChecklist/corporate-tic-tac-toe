# MASTER CHECKLIST (boss session, 29 Oct 2026). Cycle per item: build, test, audit, gaps, fix, retest, re-audit, commit, release, go live. Rules: Sonnet 5.5, effort low (mechanical) / medium (default); RAM ask-before-use; no deploy within 3 h of a live game; payments only IT Services by Rajat Agarwal via Razorpay; Projexa/compliance/facilities = least priority, separate low-effort sessions, discuss Projexa with owner first.

Status legend: [ ] todo  [~] running  [x] done

## P1 Corporate Tambola (live 1.6.7 e6759a0)
[~] header six items + logo + PDFs: branch claude/housie-header-logo-71da56 be837d8 (local session housie-header-logo); full suite JOB B running locally folder by folder
[~] gap wave 1 (TA01.. WP-01..06): branch gap/tambola-wave1-2026-10-29 in C:\ct\test-sites\wt-gap\tambola (workflow wxa6uts35)
[~] cloud QA (model, audit): qa/tambola-cloud-2026-10-29 (cloud)
[ ] integrate the three branches into one release branch, full suite, falsification, skeptic audit
[ ] release 1.6.8: deploy only when live_games_now.py 3 = 0 (game Epjsbj3 pending), version.json check, live 10-player check with claim rows re-read from D1, push GitHub, rollback ready
[ ] playbook 130 layers re-run on 1.6.8 (concerns check, matrix, load)

## P2 Master console (branch claude/master-console-complete-882589, session master-console)
[x] C1-C6 built; sweeps 1-2 on real Chrome (495/498, 1 real fix)
[x] brand-kit committed 7d46cc5 (70 screenshots pass); Bingo local site run crashed on RAM, rely on cloud site session
[x] WP-07, WP-08 console side, WP-09 done; falsify 104/104 console, 277 tests pass (head after 4d22fe3, not pushed)
[ ] MC-01 and game bridge re-vendor (node tools/vendor-bridge.mjs --game ...) ; 3 tiles stay Opening soon
[ ] falsification rerun (waits RAM > 700 MB, heavy2.lock)
[x] console repo created: FChecklist/corporate-console (private), branch claude/master-console-complete-882589 pushed 29 Oct
[ ] go-live later per runbook order Bingo, TTT, Snakes, Luck, Tambola (owner-gated pages.dev first)

## P3 All games (cloud QA branches qa/<game>-cloud-2026-10-29 running for Bingo, Snakes, TTT, Luck; Tambola above)
[~] wave-1 fixes: bingo/tictactoe/snakes worktrees C:\ct\test-sites\wt-gap\*
[~] Luck: port branch luck/rel-after-tambola-2026-10-29 ed740fb pushed; cloud build+test session cloud-luck-port started
[ ] per game: integrate qa + gap branches, full suite, 10-person demo proof, 10-player live check, release (TEST games stay TEST)
[ ] playbook 130 applied per game

## P4 Consoles of all games (spec 100 wave 2; needs master C2/C3 vendor tools)
[ ] BE/BW bingo, TE/TW tictactoe, SE/SW snakes, LK1/LE/LW luck, TB0 tambola bridge (dark)

## P5 Game websites (cloud site sessions running: Luck, Tic Tac Toe, Snakes, Bingo; home site branch home-bar-qa cdf70c1)
[~] four cloud site branches site/<game>-cloud-2026-10-29
[ ] home: 15 test cases green, games bar v2 deploy
[ ] merge site + gap + qa branches per game, deploy per game when no live game

## P6 DPDP (dpdp.veridian-aios.com) : recon+plan running (workflow wqftnkiq8, plan file 120)
[x] plan written: 120-p6-p9-plan (15:01 IST); Projexa brief 121 ready for owner discussion
[ ] DPDP: merge unmerged branch (migrations 0760-0763), hide school option, dpdp. canonical, Razorpay Rs1 test, then extraction (P9)

## Lower priority
P7 Townhall: [ ] plan in 120; P8 startup.rajatsir.com [ ] ; CA/CS ca-cs.veridian-aios.com [ ] ; P9 demerger/extraction [ ] (compliance-and-audit, facilities and building; low effort separate sessions); Projexa [HOLD: discuss with owner, brief in 121]; P10 [HOLD]

## Housekeeping
[~] RAM control (kill background web views; max 3-4 local sessions), lock C:\ct\heavy.lock + heavy2.lock
[~] pending cloud starts file: data\boss\pending-cloud-sessions-2026-10-29.md
[ ] test playbook 130 (workflow wdbpiax45) then apply to all games, DPDP, Townhall
