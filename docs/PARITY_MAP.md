# Parity map: Corporate Tambola (1.7.0 to 1.8.5) vs Corporate Tic Tac Toe

Source of truth: handover notes 300 (sections numbered below), 200, 210; Tambola code at wt-player18 (live 1.8.3) and wt-newflow (feat/tambola-1.8.5-empid). Status words: ADOPTED, ADAPTED (how), NOT APPLICABLE (why), TODO. Keep current; one row per feature. Tic Tac Toe stays in TEST mode. Last updated 30 Oct 2026 (site 1.5.0 work, commit after acef259).

| # | Tambola feature (note 300 section) | Tic Tac Toe status | Notes |
|---|---|---|---|
| 1 | Brand kit look, header six items, footer, logo (36) | ADOPTED | kit vendored, bar v3, checksum test (apps/web/test/brand-kit.test.ts) |
| 2 | Version + release date/time IST in footer | ADOPTED | siteversion.js reads /version.json (needs a deployed build to show the time) |
| 3 | Thank-you and Game completed pages with Share + WhatsApp | ADOPTED (static) | thank-you.html, game-completed.html; not yet linked from the game end screen (TODO) |
| 4 | Uniform employee ID (A-Z 0-9) | ADOPTED | apps/edge/src/ids.ts, uses engagement created_ms; ids.test.ts |
| 5 | Email ID case-insensitive cleaner | ADOPTED | cleanEmail used by organizer/host sign-in paths |
| 6 | Email ID as a list criterion (Employee ID or Email ID, list decides) | TODO (M3) | copy from empid.ts/people.ts of 1.8.5 |
| 7 | Browser hint "The system will read this as ..." | ADAPTED | player join page (ttt.js) done; organizer console input TODO |
| 8 | Step 1 date, time, how the game runs (3, 22) | ADAPT/TODO (M5) | TTT: tournament shape + move clock instead of rounds/call speed |
| 9 | Step 2 who is it for, open join (Name, Mobile, Email), approvals by role (4, 28, 29) | TODO (M5) | engine has verify modes mobile/id/either/both |
| 10 | Step 3 tickets and prizes (5) | NOT APPLICABLE | no tickets or prizes; replaced by bracket and placings (1st to 5th, top 10) |
| 11 | Step 4 Brand and Breaks (6) | ADAPT/TODO | brand moments exist in the live console |
| 12 | Step 5 check and publish (7) | TODO (M5) | |
| 13 | Game dashboard organizer/Host (8) | TODO (M5) | live bracket instead of a housie board |
| 14 | Family Passes (9, 29) | TODO | only where TTT rules allow; decide with owner |
| 15 | Host and Co-host screens, sign-in by e-mail passcode (10) | TODO (M5) | hostsetup.ts exists; new screens not built |
| 16 | Game board retro housie (11) | ADAPT | the 3x3 board is the only rich element; Retro/Modern themes TODO |
| 17 | Hidden items the engine cannot do (13) | ADAPT | hide, never "coming soon" |
| 18 | Participant journey, first-time screens, crossed numbers, claims UI (17-27) | ADAPT | claims = results/boards to settle; numbers/crossing NOT APPLICABLE |
| 19 | Rules row only inside the game (28) | TODO | |
| 20 | Consent version safe, Co-host consent under any version (1.8.3) | TODO | compare consent.ts |
| 21 | Game log 365 days | TODO | compare gamerecord.ts |
| 22 | 24 h erase (TTT: 20 h by lifetimes.ts) | ADOPTED | wording fixed in gap wave 1; keep 20 h, Terms say 23 (open question Q6) |
| 23 | Payment lifecycle, payment pending banner | ADOPTED (existing) | TTT has its own pay flow; banners TODO |
| 24 | Rehearsal | TODO | check if TTT has one |
| 25 | Super Bumper rules (31) | NOT APPLICABLE | Tambola-only |
| 26 | Demo cap 10, free demo path /zc?demo=1 | ADOPTED | unchanged |
| 27 | Previous-screens link (?flow=old) (1.8.2) | TODO (M5) | |
