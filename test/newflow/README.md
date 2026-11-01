# New-flow tests (independent, written from the rules and the owner numbers only)

Run: `bun install`, then `bun test test/newflow` (about 65 s; the 2000-player game is about 40 s of it).
The root `bun run test` script covers `packages apps tools/control-worker`, so this folder is run on its own.
No product file is changed. Test names start with the rule id below.

The "rules book" file `docs/TICTACTOE_RULES_BOOK.md` named in the vendored core code is NOT in this repository; the rules used are the owner numbers of 31 Oct 2026 and `docs/RULES.md`.

| Rule | What | File: tests |
|---|---|---|
| S1 | waiting room 120 s, 3 stages x 300 s, 3 slots x 100 s, game 90 s + 10 s pause, move clock 10 s, sudden death 5 s, win 2 / draw 1 / bye 1 | schedule: S1, S1b, S1c |
| S2 | the clock to the exact second (waiting room, every slot, stage ends, done at 1020 s) | schedule: S2 to S2f |
| S3 | pause freezes every clock, shift by the exact paused time | schedule: S3, S3b, S3c |
| S4 / S5 | move deadline arithmetic, missed move gives the turn away, both miss = draw | schedule: S4, S4b, S4c, S5, S5b, S5c |
| P1 | pairing by nearby points, seeded sha256(game id, stage, slot, player) tie-break | phone: P1, P1b, P1c |
| P2 | never the same opponent as the last slot (also over a whole 200-player game) | phone: P2, P2b |
| P3 | odd one sits out, 1 point, once per stage | phone: P3, P3b, P3c |
| P4 | win 2 / draw 1, no result or running game at slot end = draw, results of unmade pairs ignored | phone: P4 to P4d |
| P5 | two-sided results (both players must write the same word), any arrival order | phone: P5, P5b |
| P6 | cuts: bottom half after stage 1, half of survivors after stage 2, top five after stage 3 | phone: P6, P6b, P6c |
| P7 | order points, wins, last-stage points, fate; never tied | phone: P7, P7b, P7c |
| P8 | what one phone sees (place, cut line, opponent) | phone: P8 |
| P9 to P11 | same log twice, shuffled, other list order, duplicates, conflicting duplicates, late phone, paused game: identical result | phone: P9 to P9e, P10, P11 |
| F | flag OFF: new routes absent (404/409), old routes and database unchanged, flag only before the start by Organizer/Host, page loads new flow only on request | relay: F1 to F6 |
| R1 | keys required, wrong game's key refused, wrong game's player refused, removed player refused | relay: R1 to R1d |
| R2 to R6 | immutable entries, server stamp, 200 bytes, shape limits, 5 writes/s/player, 250,000 entries, only while running | relay: R2 to R6 |
| R7 | public read, no names, paging, one game never shows another's entries | relay: R7 to R7d |
| R8 / R9 | start rules, cap 2000 (join and start) | relay: R8, R8b, R9, R9b |
| R10 | pause/resume stamps handed to every phone; no writes while paused | relay: R10, R10b |
| R11 / R12 | log erased with participant data; no names in the log | relay: R11, R12 |
| G | server does no game work: existing guard test passes, no stage rule or vendor game module in the Worker | guard: G1 to G4 |
| X1 / X2 | at most 15 reactions per 10 minutes of game time, gaps | reactions: X1 to X1d, X2 |
| X3 | 2 to 3 s each, short English phrases | reactions: X3, X3b |
| X4 | none while paused | reactions: X4 to X4d |
| X5 | the hooks: ids the pages offer exist, fitting events, personal vs shared, mode off | reactions: X5 to X5d |
| W1 | no "private" | wording: W1 to W1f |
| W2 | English only | wording: W2, W2b |
| W3 | retention line exactly "No personal details needed. All participant information is deleted within 24 hours of the game." | wording: W3 to W3d |
| L1 | 200-player game through the Worker routes (moves and results), 100 / 50 / five winners | sim: L1, L1b |
| L2 | 2000-player game through the Worker routes (results), 1000 / 500 / five winners; odd 1999 | sim: L2, L2b |
| N1 to N4 | Snakes board: 100 squares, 30/15/10/10, different lengths, 99 to 9, 31 to 80, last square reachable, boustrophedon numbering | snakes: N1 to N4b |
| N5 to N9 | reward = 2 extra throws, penalty cuts next throw, own dice, missed throw lost, 10 s window and 10 s gap, pause | snakes: N5 to N9 |
| N10 to N12 | waiting room 120 s, 7 or 8 minutes, ahead/behind and players per square, winner and full ranking | snakes: N10 to N12b |
