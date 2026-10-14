# Corporate Tic Tac Toe: the rules (plain words)

Written 2026-10-13. Every rule below is one plain sentence and has at least one test. The test name starts with the rule number (for example `R13: ...`).
Code: `packages/ttt/src/` (`classic.ts` the game, `match.ts` a board and the clock, `bracket.ts` the tournament, `seal.ts` the sealed seed, `phone.ts` the phone that puts them together). All of it runs on the players' own phones and laptops (compiled for the browser as `tttgame.js`). Our server (`apps/edge/src/tournament.ts`) is only a mailbox; see section I.
Tests: `packages/ttt/test/` (run `bun test packages/ttt/test`) for the rules and the phone engine, `apps/edge/test/tournament.test.ts` for the mailbox and whole tournaments played by simulated phones.

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
- R12 When the clock runs out, a move is played for that player: a random empty square drawn from the sealed seed, the same wherever it is computed. The phones work out that the clock ran out from the server's time stamps (section I), not from their own clocks.
- R13 A second clock-out in a row, in the same game, loses the board (forfeit). A real move sets the count back to zero.
- R14 If both players stay away, the player who was due to start loses (this follows from R12 and R13). When both are away no phone is there to say so, so the Organizer's page (open on the organizer's laptop) does it for them, in the same way a third phone would; if that page is closed the Organizer can settle the board by hand.
- R15 What happens never depends on when somebody looks: clock-outs are replayed at the moment their clock ended; a stale tap (an old screen, a double tap) is not counted. The mailbox stores a move only if it carries the next number; the phones ignore a stored move that breaks a rule.

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
- R27 Nobody can change a draw: the bracket, who has X and the move put in for a late player are computed by every phone from the same public sealed seed, so a phone that computes something else is simply out of step with all the others. Only the two players of a board can write to that board, from their own phone, and the mailbox keeps a move only if it is the next number; a spectator, an outsider or a player who is not to move cannot change a board (a move out of turn is ignored by every phone).
- R28 The host can pause. While paused no clock runs; afterwards every clock has the same time left as before.
- R28b The Organizer or a Host can End the tournament. It is then over for everybody: no champion is named and nobody is ranked, any pause is closed, a move sent afterwards is refused, every phone and the big screen say so, and the deletion clock starts at that moment. The server only stores that it is over (tests: `apps/edge/test/end-game.test.ts`, `apps/web/test/host-end.test.ts`, `apps/web/test/ai-stop-request.test.ts`).
- R29 A player who loses the connection can open the link again and sees the board exactly as it is (the clock kept running).

## G. Spectators
- R30 The spectator view shows the bracket, the live boards and the results with display names only. It shows no seed before the start and no personal data.

## H. Product rules (wording and money)
- R31 Players never pay and never stake money. There are no cash prizes and no betting. Any gift is supplied by the organizer, outside this product. Adults (18+) only; a company event.
- R32 Display name only is asked of a player; a short privacy notice is shown before the name is asked.

## I. Who computes what
The product rule: in every use case the players' own phones and laptops do the computing. Our server only stores and relays data: sign-in, payment, saving, relaying moves, tallying agreed results, deletion after 24 hours and e-mail.

| What | Who does it | Where |
|---|---|---|
| The rules, a board, the replay of a game, the tie-break (fate), the ranking | every phone (and the big screen, and the Organizer's page) | `packages/ttt/src`, compiled to `tttgame.js` |
| The bracket and every starter | every phone, from the public sealed seed and the player list | `planOf` in `phone.ts` |
| The secret of the seed, its fingerprint, the player list, the move clock | stored by the server; it draws the secret and checks that the fingerprint is the hash of the secret | `seal.ts` (a hash), `tournament.ts` |
| A move | the phone posts `{mid, pid, seq, sq, client_ms}`; the server checks only that the pid is on that match and that `seq` is the next number, and stores it with ITS OWN clock stamp | `POST .../ttt/move` |
| The stored moves | handed back by the server with its stamps; each phone replays them with the rules | `GET .../ttt/m/{mid}` |
| Clock-outs and forfeits | the waiting phone posts an "opponent absent" claim with the server time it saw (the server stamps the claim with its own clock; a claim stamped before the clock ran out changes nothing); every phone then works out the clock-out, the square played for the late player and the forfeit from the stamps | `replayMatch` |
| The winner of a board | each of the two players posts `{mid, winner}`; the server keeps it as agreed when BOTH reports match; if they differ it flags the board for the Organizer; a single report that nobody contradicts for 30 seconds is kept too (the other phone is away or closed) | `POST .../ttt/result` |
| The next round's pairing | every phone, from the listed agreed results (`feedersOf`, `parentOf`); the players register the next match with the mailbox, naming the two finished matches it comes from | `POST .../ttt/open` |
| A board where both players are away | the Organizer's page claims their clock-outs and reports the board like a third phone; or the Organizer settles it by hand | `TttConsole.watch`, `POST .../ttt/settle` |
| The final ranking and the podium | computed by the phones that played the final (and the Organizer's page); the server keeps it when two different phones sent the same thing | `POST .../ttt/finish` |
| Sign-in, payment, deletion after 24 hours, e-mail | the server | `lifecycle.ts` and the rest of the Worker |

The server never looks at a board, never decides whose turn it is, never runs a clock, never builds a bracket and never ranks anybody. `apps/edge/test/server-does-no-game-work.test.ts` fails if a game rule is imported into the Worker, and lists the only things the Worker may take from the game package (the hash check of the sealed seed).

## Known limits (stated, not hidden)
- The server draws the secret, so the server is trusted to draw it fairly and not to look. Adding a public beacon number at the start removes even that; the code supports it (`seedOf(..., beacon)`), the organizer console does not add one yet.
- The server is a mailbox, so it can be handed a wrong thing (a move out of turn, a wrong report). It cannot make the phones believe it: every phone replays the stored moves with the rules and ignores a move that breaks them. A wrong result needs the other player to agree, or to be away; if the other player reports something else, the board is flagged and the Organizer settles it.
- A single report that nobody contradicts for 30 seconds is kept as the result. A player who reports a false win is caught only if the other player's phone is open (it will contradict) or if somebody looks at the stored moves, which anybody can replay.
- Two phones that send the same final ranking are enough to close the tournament. They must be phones of the final; the Organizer's page alone is enough too.
- The player list (names and ids) is read by every phone at the start, so with 10,000 players each phone downloads about 400 KB once.
- Moves go through the server (one small write per move), not phone to phone. This is simpler and works behind office firewalls; the cost is about 9 writes per game.
- Team format: players beyond a full team only watch. Nobody can substitute for a missing team member; an absent member forfeits their board.
