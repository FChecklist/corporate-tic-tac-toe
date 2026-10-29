# Cloud sessions waiting to be started (boss session, 29 Oct 2026)

Why waiting: while the owner works over Remote Control, the boss session may NOT start cloud sessions (tool refuses: "only on a message typed in the desktop app"). Start these as soon as the owner types anything in the desktop app (or "start cloud sessions").

Already running in the cloud (started earlier): QA Tambola (qa/tambola-cloud-2026-10-29), QA Bingo, QA Snakes and Ladders, QA Tic Tac Toe, QA Luck by Chance (each on its own qa/<game>-cloud-2026-10-29 branch); website cloud sessions requested for Luck (site/luck-cloud-2026-10-29), Tic Tac Toe (site/tictactoe-cloud-2026-10-29), Snakes (site/snakes-cloud-2026-10-29).

## 1. CLOUD TEST: Tambola header/logo/PDF branch full suite (repo FChecklist/corporate-tambola)
Branch origin/claude/housie-header-logo-71da56 commit be837d8 (based on live 1.6.7 e6759a0). Run full suite (bun test --isolate for packages, apps, tools/control-worker) + typecheck on it AND on origin/wip/join-redesign for a baseline; report new failures with root causes; verify six-item header on every public page, no 'private', payee only IT Services by Rajat Agarwal via Razorpay, no console.corporatetambola.com link, logo = brand kit; push only qa/header-logo-verify-2026-10-29 with docs/VERIFY-HEADER-LOGO-2026-10-29.md. Do not modify the branch under test.

## 2. CLOUD SITE: Corporate Bingo website (repo FChecklist/corporate-bingo)
Start from origin/site/bingo-2026-10-29 (commit c4ea72e, WIP pushed from the local session: 88 files, brand kit vendored, tests not run). New branch site/bingo-cloud-2026-10-29. Same brief as the Luck/TTT/Snakes website sessions: housie look and feel, six-item header (How it works | Free demo game | Guide | Brochure | Refer & earn | Log in), brand kit + games bar vendored with pinned checksums, 'close group' never 'private', payments only IT Services by Rajat Agarwal via Razorpay, console pages visual shell only, real free 10-person demo link (Bingo DEMO_CAP 10), no console.corporatetambola.com links, PDFs regenerated, tests falsified, report docs/SITE-BINGO-2026-10-29.md.

## 3. After the user-feedback gap review workflow finishes
Plan file: handover/2026-10-27/110-user-feedback-gap-plan-2026-10-29.md -> one cloud session per work package group (P1 Tambola first).

## 4. After master-console reports (C2/C3 done; console repo has no GitHub remote yet)
Per-game console packages BE/BW, TE/TW, SE/SW, LK1/LE/LW, TB0 per handover/2026-10-27/100-console-spec-2026-10-29.md; vendor tools/vendor-bridge.mjs and tools/vendor-pack.mjs from the console worktree claude/master-console-complete-882589.

## 5. RIGOR cloud sessions per game (start after each game's qa/<game>-cloud branch reports; effort medium, mechanical steps low)
Per game (bingo, tictactoe, snakesladders, luckbychance): checkout origin/boss/docs-2026-10-29 (has docs/boss/130-test-playbook-2026-10-29.md), merge/inspect the game's qa/ and gap/ branches, then apply playbook layers L1 (suites), L2 (rule steps at 1,000,000 checks with independent oracles: port tools/sigma-steps.mjs from the public repo FChecklist/corporate-tambola branch wip/join-redesign), L3 (sim2 life/matrix scenarios), L4 (100-case node-phone campaign: tools/campaign.mjs + nodephone.mjs), L7 (10,000-phone in-process load), L8 (axe, widths); audit with 2 skeptics; fix gaps with falsified tests; commit on new branch rigor/<game>-2026-10-29; report. Laptop-only layers (L5 click-only browsers, L6 live-site games with D1 re-read) are run by local sessions under GRANT.
Also: DPDP rigor (dpdp-app e2e acceptance-70 + role specs) and Townhall rigor (aoa-rwa scripts mutate.ts, sim-engine.ts) after plan 120.
