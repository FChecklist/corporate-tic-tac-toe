# Corporate Tic Tac Toe: the rules (plain words, draft 1, 2026-10-27, for the owner to read before anything is built)

Model: the Corporate Tambola rules. Shown to a player under "Rules" on the game screen and to the organizer and Hosts in their console. Sections 1 to 9 are the text, 10 the table of messages, 11 is for the builder.

## 1. How to play
1. Tic Tac Toe is played as a knockout tournament. You play one board against one other player. Win your board to reach the next round. The last player standing is the champion.
2. A board has nine squares. One player is X and the other is O. X moves first.
3. On your turn, tap an empty square to put your mark.
4. Three of your marks in a row, in a column or on a diagonal win the board.

## 2. How you win
1. The first board with three in a row ends. The winner goes to the next round.
2. If the board is full with no line, it is a draw. A draw is played again at once with the marks swapped, up to three games. If all three are drawn, fate decides. Fate is a number anybody can re-check.
3. A player who has no opponent in round 1 (a "bye") goes through without playing.
4. The winner of the last match is the champion. The result list never has ties; the screen says in one line how a tie was decided.

## 3. The timer
1. Every move has 20 seconds. The first move of a match has 30 seconds so everybody can open the page.
2. The timer on your phone is small and quiet. The server's clock is the real timer.
3. The screen always shows how far the round is: "3 of 8 boards played · 5 left".

## 3b. Manual play has no fixed time
**Fixed time only when the software runs the game.** The move clock (20 seconds) exists because the software runs the game. If a host runs a board by hand, there is no fixed time between moves, no countdown is shown (the screen says "The host moves on"), and no total length is promised. A move still counts only before the next move is announced, decided by the server's clock.

## 4. Moving on time (the strict rule)
1. You may move only during your turn, and only before the next move is announced. The server's clock decides, not your phone's clock.
2. If you tap after your turn ended, nothing is recorded and you see: "Ohooo! 😊 Sorry, you moved after your turn ended. This move cannot be made."
3. If your 20 seconds run out, a random empty square is played for you, the same on every phone. A second time-out in a row in the same game loses the board. A real move starts the count again.
4. If both players stay away, the player who was due to start loses.
5. A tap on an old screen or a double tap is not counted.

## 5. Pause
1. The organizer or a Host can pause the tournament. While it is paused no clock runs and nobody can move.
2. When play restarts, every clock has the same time left as before the pause. Every pause and restart is in the game log.

## 6. If you go away or lose the connection
1. Open the same link again. You see your board exactly as it is. The clock kept running while you were away.
2. If you were away, a move may have been played for you. The page says so in one line.
3. Tip: switch on Do Not Disturb on your phone so calls and chats do not interrupt your game.

## 7. Fairness
1. The bracket, who has X and the random moves are worked out by every phone from one sealed seed. Nobody can change them. A phone that works out something else is simply out of step.
2. Only the two players of a board can move on that board, from their own phone.
3. Anybody can re-check the bracket after the game from the public seed.

## 8. What the organizer and a Host can and cannot do
Can: start, pause, restart, extend with a confirmation, end the tournament, see all boards live, the bracket, the count of players and the log.
Cannot: move for a player, choose who plays whom, change a result or the seed, see names or mobile numbers on the live board (only seat numbers).
If the organizer ends the tournament early, no champion is named and the screens say so.

## 9. Money and privacy
1. Players never pay and never stake money. No cash prize, no betting. Any gift comes from the organizer outside this product.
2. Adults (18+) only. We ask your name only, unless your organizer asked for an employee ID or mobile number.
3. Personal details are deleted within 20 hours after the game ends. The game log (seat numbers only) is kept for 365 days.

## 10. Every message in one table
| When | Text |
|---|---|
| Your turn | Your turn. Tap a square. |
| Opponent's turn | Waiting for Seat {n} to move. |
| Move too late | Ohooo! 😊 Sorry, you moved after your turn ended. This move cannot be made. |
| Time ran out | Your time ran out, so a square was played for you. |
| Second time-out | Your time ran out twice in a row. This board goes to your opponent. |
| Won board | You won this board. On to the next round. |
| Lost board | This board is over. Thank you for playing. |
| Draw | A draw. We play again with the marks swapped (game {n} of 3). |
| Paused | Game paused by the host at {time}. It restarts soon. Your board is safe. |
| Away note | Welcome back. You were away for {m} minutes and a move was played for you. |
| Do Not Disturb | Tip: switch on Do Not Disturb so calls and chats do not interrupt your game. |

## 11. For the builder
1. Rule 4 is decided by the server clock: a move is accepted only if the server time is before the move's deadline. The deadline of turn t is the time the turn opened + 20 s (fixed schedule from the board's start, no drift). The server answers a late move with HTTP 409 and code `late-move`, stores nothing, and the phone shows the message.
2. Tests (falsified): a move at the last millisecond counts; at the deadline it is refused; stale double tap; time-out plays the same square on all phones; pause keeps the time left.
3. Today's rules file `docs/RULES.md` (R01 to R32) stays the technical record; this page is the plain-words copy. Where they differ, RULES.md R11 (10/20/30/60 s) becomes 20 s only for new games (OPTIONS_TABLES.md).
