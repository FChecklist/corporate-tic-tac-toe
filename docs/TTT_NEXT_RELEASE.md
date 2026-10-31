# Tic Tac Toe on the common engine: what is still missing (31 Oct 2026)
Engine: game-core 0.3.0 (e71f258), vendored in vendor/game-core. Everything below is OFF unless a person opens the new flow (?flow=new, or ct-flow=new on that device). The live game is unchanged.

## Done (coded, not tested)
- Engine vendored and pinned; rules module and Reaction pack come from the copy.
- Text reactions on the player page (ttt.js, new flow only): "You won!" on becoming champion, "Out!" on being knocked out, "Round over" between rounds, "Round starts!"/"Go!" on a new board, "Paused"/"Back on!" when the Organizer or Host pauses or resumes. Built into apps/web/public/tttengine.js (bun run build:engine) with reactions.css.
- Already live and kept: knockout rounds run by software, Pause/Resume by Organizer or Host key, results with no Organizer final say, the golden "You won" card for the champion.

## Missing
1. Draw rule: the engine replays a draw ONCE, then the first mover of the replay is out. Live replays up to 3 games and then uses the fate number (packages/ttt/src/match.ts MAX_GAMES=3, classic.ts). Needs a per-game switch (the Cfg already has maxGames) plus the first-mover rule, and the same rule on phones and server. Not changed: it alters live results.
2. Reactions for draw, replay, missed move and countdown: the player page does not get those events yet (needs the match view to say "drawn, replaying" and a countdown tick). The pause reaction relies on the player state carrying `paused`; not verified.
3. Cap 2000 on the new flow: the server still allows up to 100000 (worker.ts ~1359 and ~2008). Needs a per-game flag stored with the game.
4. Pause logged by role (Organizer or Host): not checked in the game log.
5. Create from an earlier game, rehearsal of 10, late-join window, Auto/Manual prizes through the core planner, six-step organizer flow, winners' names erased at 24 h (live keeps the winners record to day 365), the 20 h erase wording, the Organizer's key storage bridge for the shared screens, the Organizer's reaction setting (full/reduced/off): none started.
6. Independent tests for all of it.

## Owner-approved rules of 31 Oct (core branch feat/ttt-owner-rules-2026-10-31, 1c23494; vendored here)
Rules written in the core book and module (pairing with one bye, 3-game matches or 1, 2/1 points, 10 s and 5 s clocks, missed move, tie-breakers, ranking, cap, pause). NOT yet in the site adapter: the live phone engine (packages/ttt/src/match.ts, bracket.ts, classic.ts, phone.ts) still runs the old rules (fixed bracket, up to 3 games with a draw replay, 20 s default clock, 2 clock-outs lose). Porting needs: per-game rules switch stored with the game, 3-game match with swapping marks and points, tie-breaker games at 5 s, missed-move turn loss, random re-pairing each round with one bye, cap 2000 check, and the same chain check on the server. Reactions for draw, missed move and tie-breaker wait for those events.

## SUPERSEDED: stage rules of 31 Oct (core branch feat/ttt-stages-2026-10-31, b1a8981; vendored here as 0.5.0)
These replace the match rules listed above. In the core now (book first): 2:00 waiting room + 3 x 5:00 stages, 1-game Swiss matches, odd-count bye of 1 point once per stage, 10 s / 5 s clocks, missed move, cuts 50% then half of the survivors, top five win, ranking by points, wins, last-stage points, fate; standing (place, places to the cut line); reaction gate (2.5 s, one per 22 s, max 15).
NOT in the site yet (the live phone engine still runs the bracket rules): the stage clock and waiting room on the server, continuous pairing of free players, per-game rules switch stored with the game, live place and cut line and countdown on the player page, standing for players who are out, reaction hooks for draw and cut-line moves (win, out, pause reactions exist and need the reaction gate), cap 2000 check, the chain check on the server for the new rules.

## Stage rules, site half (boss decision: phones compute, server only relays) - status
Core branch feat/ttt-slots-2026-10-31 (1818f97, merged into core 0.7.0 as the stage rules, slots added after): pure `clockAt`, `pairSlot`, `settleStages`, `viewFor` (3 slots of 100 s per stage, seeded sha256 tie-break, never the same opponent twice running, odd one out gets 1 point, running or unreported game = draw, cuts and top five from the log). Vendored here; bundled into tttengine.js (new flow only).
Done in the site (flag ?flow=new): waiting-room and stage countdown strip on the player page, Pause shown, reactions through the core scheduler (win and out high priority, round end, round start, go, pause, resume).
BLOCKERS / not done:
1. Playing the slot games: the phone engine (TttPhone) and the mailbox relay are built for the bracket (match ids rNmM registered in ttt_m, later rounds opened by feeders). Stage games need the relay to accept slot match ids and the phones to open a board for the pair that `pairSlot` gives them. This is relay and phone work, not rules.
2. Live place and cut line on the page: needs the public log of agreed results (a read-only relay endpoint returning agreed results of stage matches). Without a log every pair would read as a draw, so the strip shows only the clock and no place.
3. Players who are out: standing and final result screens (needs 2).
4. Reactions for draw and cut-line moved (need 2). Cap 2000 check on the server. Re-vendor core 0.7.0 main once it contains slots.
