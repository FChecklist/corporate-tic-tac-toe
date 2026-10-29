# Owner rule 2026-10-28: every rule and fix made in Corporate Tambola must be solved in ALL games (Bingo, Tic-Tac-Toe, Snakes & Ladders, Luck by Chance, Lucky Draw), including claims and the whole lifecycle.
## What carries over (checklist per game; each row = built + tested + falsified, or marked 'not applicable because...')
LIFECYCLE: draft -> publish/pay -> invite/links -> check-in/waiting room -> start (auto/manual) -> play (auto/manual) -> pause/resume -> end -> results -> report e-mail ~3 min after end -> game log kept 365 days -> guest personal data erased on schedule -> rehearsals (3 per bought game, later).
RULES: one speed for auto play (game-specific, from OPTIONS_TABLES.md); manual play has no fixed gap/countdown; server clock decides (late claim/move refused with the kind 'Ohooo' wording specific to the game); 'next action' window = until the next event is announced; claim/move shown exactly once; no contradictory end banners; counters ('31 of 90 called'); quiet countdown (auto only).
CLAIMS: gold claim buttons (top, bottom, side) + claim timer + grey side buttons with Bogey warning where the game has claims; fast tiny-signal notice to all players; proof-line log with IST times; organizer/host live claims list.
SAFETY: no screen redraw while a finger is down; taps counted once; away-and-return message; locked-phone limits stated honestly.
OPS: tiny-signal heartbeat (static edge file), cost per game-hour measured; link reuse/rehearsal isolation (new game code per run); 12 s-style single-speed rules via ONLY_* variables.
## How
1. Build the shared parts ONCE as a vendored 'game core' (claim/lifecycle state machine, heartbeat, log, report, erase) and have each game use it; game-specific parts only: rules text, claim types, board.
2. Per game a map file docs-games/MAP_<game>.md: each Tambola rule -> this game's equivalent, 'not applicable', or open gap.
3. Same test pattern per game: code tests, local full game with real Chrome phones, live smoke with 10 players, claims/winners validated against the DB, notifications timed; falsify each.
4. Order: Tambola next release (claim buttons, timer, heartbeat) -> Bingo (closest, also claim-based) -> Lucky Draw / Luck by Chance -> Tic-Tac-Toe / Snakes & Ladders (moves instead of claims).
5. Master console shows one lifecycle and one log format for every game.
Not before Sneha's game. Games work was paused by owner until Tambola is finished; this note is the standing requirement for when it resumes.

## Owner lesson 2026-10-28 (Sneha feedback): UI/UX makes a huge difference; same product, better UX = very different experience.
Standing practice for EVERY game and release: (1) test like a real person (real Chrome, real taps, real timing, screenshots at 320/360/1280), not only code tests; (2) after every real customer game collect short feedback (what felt better/worse, claims, timing, wording) and record it in the handover; (3) plain English wording reviewed for non-native readers.

## WORDING RULE (owner 2026-10-28): the games are ONLINE and CLOSE GROUP. Never use the word "private" anywhere (site, e-mails, reports, WhatsApp texts, store copy). Say "close group online engagement of employees and associates" / "close group Housie".

## WORDING LEVELS (owner 2026-10-28): organizers/HR readers are educated English users -> marketing pages, hero lines, organizer e-mails and reports may use fuller English (questions, Cialdini-style commitment lines). PLAYER screens (ticket, claim buttons, warnings, start/call options, guest links) stay short and plain for all literacy levels.
Hero lines: home = 'Which game will you use to engage your various teams this week?'; Housie site = 'This week, which teams will you engage with a close group online Housie?'
