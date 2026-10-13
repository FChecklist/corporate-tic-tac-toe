# Corporate Tic Tac Toe: the rules (plain words)

Written 2026-10-13. Every rule below is one plain sentence and has at least one test. The test name starts with the rule number (for example `R13: ...`).
Code: `packages/ttt/src/` (`classic.ts` the game, `match.ts` a board and the clock, `bracket.ts` the tournament, `seal.ts` the sealed seed).
Tests: `packages/ttt/test/` (run `bun test packages/ttt/test`).

The earlier prototype with three boards and run scoring (`packages/ttt/src/engine.ts`, `docs/PROTOTYPE_NOTES.md`) is kept for reference. The product does not use it, because it is not the game people mean by tic tac toe and the checklist asks for three in a row, draws and a timeout rule.

## A. The game
- R01 The board has nine squares in three rows of three.
- R02 Two players take turns; X moves first, O second.
- R03 A move puts your mark on an empty square; a taken square, or a square that is not on the board, is refused.
- R04 Three of your marks in a row, in a column or on a diagonal wins the game.
- R05 A full board with no three in a row is a draw.
- R06 You can only move when it is your turn.

## B. A board (two players, one winner)
A "board" is one pair of players. It always ends with exactly one winner.
- R07 The first game that has a winner ends the board.
- R08 A drawn game is replayed at once with the marks swapped, up to three games in all.
- R09 Who has X in game 1 is a coin from the sealed seed; game 2 swaps it; game 3 is a fresh coin. Nobody can change it.
- R10 If all three games are drawn, fate decides: each player has a fate number made from the sealed seed, the board and their id, and the lower number wins. Anybody can re-check it.

**Decision on draws (2026-10-13):** a draw is common in tic tac toe, and a knockout needs a winner. So a draw is replayed with the marks swapped (this is fair, both players get the first move), at most three games, and only then fate. We chose a replay first because it lets skill decide almost always; fate is the last step and is shown on the results screen as "won by fate".

## C. The clock
- R11 Every move has a clock. The organizer picks 10, 20 (default), 30 or 60 seconds. The first move of a match has 30 seconds so players can open the page.
- R12 When the clock runs out, the software plays a move for that player: a random empty square drawn from the sealed seed, the same wherever it is computed.
- R13 A second clock-out in a row, in the same game, loses the board (forfeit). A real move sets the count back to zero.
- R14 If both players stay away, the player who was due to start loses (this follows from R12 and R13).
- R15 What happens never depends on when somebody looks: clock-outs are replayed at the moment their clock ended; a stale tap (an old screen, a double tap) is refused.

## D. Formats
- R16 One-against-one knockout: every player is an entrant; the bracket order is a shuffle from the sealed seed (the order the organizer typed the names in does not matter).
- R17 The bracket has the next power of two of places; the empty places are byes. At most one place in a pair is empty, so two byes never meet; a bye wins its match without playing; byes exist only in round 1.
- R18 Winners move up; the winner of the last match is the champion.
- R19 Team format: teams of 3 or 5 players, cut from a seeded shuffle of the players. Players left over (fewer than a full team) are reserve and only watch.
- R20 A team match has one board per seat (1st of one team against 1st of the other, and so on), all played at the same time. The team that wins more boards wins the match. Teams are odd in size, so there is never a tie.
- R21 A crowd is one knockout. The plan size is the limit (up to 10,000 players); a crowd of N needs about log2(N) rounds. Tested with 1,000.
- R22 A match in a later round starts the moment both of its earlier matches are finished; nobody waits for other matches.

## E. Results, no ties
- R23 Points: 2 for each game won, 1 for each game drawn. A forfeited game counts as a win for the other player. A team's points are the points of all its players.
- R24 The ranking has no ties. Order: (1) the round reached (champion, runner-up, then the semi-finalists, quarter-finalists ...), (2) total points over all matches, (3) points in the last match played, (4) fate (a number from the sealed seed; the lower wins). Every rank is unique; 1st to 5th are named and the top 10 are listed.
- R25 The results screen says in one line how each tie was decided.

## F. Fair play
- R26 One sealed seed. When the tournament is made, only its fingerprint is shown. At the start the roster is closed, the seed is made from the secret, the tournament id and the closed roster (and, if the organizer's console adds one, a public beacon number), and the secret is revealed so anybody can re-compute the bracket, every starter and every fate number.
- R27 The browser cannot change a draw: it sends only "my square". Everything else (bracket, who has X, clocks, results) is decided on the server from the sealed seed. A spectator, an outsider or a player who is not to move cannot move.
- R28 The host can pause. While paused no clock runs; afterwards every clock has the same time left as before.
- R29 A player who loses the connection can open the link again and sees the board exactly as it is (the clock kept running).

## G. Spectators
- R30 The spectator view shows the bracket, the live boards and the results with display names only. It shows no seed before the start and no personal data.

## H. Product rules (wording and money)
- R31 Players never pay and never stake money. There are no cash prizes and no betting. Any gift is supplied by the organizer, outside this product. Adults (18+) only; a company event.
- R32 Display name only is asked of a player; a short privacy notice is shown before the name is asked.

## Known limits (stated, not hidden)
- The server draws the secret, so the server is trusted to draw it fairly and not to look. Adding a public beacon number at the start removes even that; the code supports it (`seedOf(..., beacon)`), the organizer console does not add one yet.
- Moves go through the server (one small write per move), not phone to phone. This is simpler and works behind office firewalls; the cost is about 9 writes per game.
- Team format: players beyond a full team only watch. Nobody can substitute for a missing team member; an absent member forfeits their board.
