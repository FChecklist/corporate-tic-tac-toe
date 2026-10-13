# Glossary: words matter

This is a company event. We describe what it is: a **tournament** of **boards** between **players**. We never use words that make it sound like gambling or betting. Players never pay and never stake money; there are no cash prizes; adults (18+) only.

## Words we use

| Use | Meaning | Notes |
|---|---|---|
| **Tournament** | One event, from the link being shared to the champion | The database and the web addresses still say `engagement` and `/api/z/{id}` (the sister product's name). `{id}` is the tournament id. A page a customer reads should say tournament |
| **Organizer** | The person who makes the tournament and pays. One per account | Roles: Organizer (1), Host (up to 5), Co-host (no limit) |
| **Host** | Runs the tournament with the organizer: chooses the format and the move clock, presses Start, pauses | Opens `host.html` |
| **Co-host** | Invites people with a link; pays; changes nothing else | |
| **Player** | Someone who joined with a display name and plays | |
| **Spectator** | Someone who only watches (`big.html`), or a player who is out, or a left-over player in a team tournament (a "reserve") | Sees display names only |
| **Board** | One pair of players, played until there is one winner (a drawn game is replayed, up to three games, then fate) | |
| **Game** | One game of tic tac toe on a board | |
| **Match** | One pairing in the bracket. In a one-against-one tournament a match has one board; in a team tournament it has one board per seat | |
| **Round** | A column of the bracket: Round 1, Quarter-finals, Semi-finals, Final | |
| **Bracket** | The knockout chart | Order comes from the sealed seed, not from the order names were typed |
| **Bye** | An empty place in round 1; the player facing it goes through without playing | |
| **Move clock** | Seconds a player has for a move: 10, 20 (default), 30 or 60 | |
| **Clock-out** | The clock ran out; the software plays a square for the player. A second one in a row loses the board | |
| **Fate** | The last tie-break, a number made from the sealed seed. Shown on the results screen as "won by fate" | |
| **Sealed seed** | The secret that makes the draw. Its fingerprint is shown first; the secret is shown at the start so anybody can check | |
| **Champion** | The winner of the final | |
| **Results** | The strict ranking, with no ties | |
| **Gift** | Anything the organizer gives, outside this product | Never "prize money" |
| **Participant place** | One place in the pack the organizer buys: "Up to N players" | Plan ids are `tictactoe_pack_<N>` |

## Words we never use

bet, betting, wager, stake (except to say "no money is staked"), gamble, gambling, odds, jackpot, lottery, lucky draw, casino, house, cash prize, winnings, payout to players, buy-in, entry fee for players.

"Draw" means a drawn game (no three in a row), or the sealed draw that makes the bracket. Never "a draw" in the sense of a lottery.

## Words the sister product used that do not apply here

Ticket, card, number call, house, line, full house, lucky draw, brand moment, call speed, "the first number". If one of these still shows on a screen or in an e-mail, it is a leftover from Corporate Bingo and should be replaced.

## Rule for code and docs

- Pages and e-mails: tournament, player, board. Console wording still says "engagement" in places; that is to be changed.
- Code identifiers keep `engagement`, `participant`, `eid`, `pid` and `seat` (they name database tables shared with the sister product). Do not rename them for wording.
- All short texts on the player page live in `apps/web/public/ttt.js`.
