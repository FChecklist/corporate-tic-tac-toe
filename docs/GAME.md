# The game: where to look

The rules of the game are in `docs/RULES.md` (one plain sentence per rule, R01 to R32, each with a test whose name starts with the rule number).
The earlier three-board prototype is described in `docs/PROTOTYPE_NOTES.md`. The product does not use it.

## Code map

| What | File |
|---|---|
| The game: nine squares, who moves, three in a row, draw | `packages/ttt/src/classic.ts` |
| One board between two players: replayed draws, fate, the move clock, forfeit | `packages/ttt/src/match.ts` |
| The tournament: bracket, byes, teams, rounds, points, the strict ranking | `packages/ttt/src/bracket.ts` |
| The sealed seed: commit, secret, seed, fate numbers | `packages/ttt/src/seal.ts` |
| The tournament mailbox on the server: stores the seed, the list, the moves with the server's stamp, the reports, the agreed results, the winners record (it runs no rule) | `apps/edge/src/tournament.ts` |
| The game on the phone: the bracket from the sealed seed, the replay of the stored moves, clocks, tie-break, ranking | `packages/ttt/src/phone.ts` (built as `apps/web/public/tttgame.js`) |
| When personal data is deleted | `apps/edge/src/lifecycle.ts` |
| How a name is sealed | `apps/edge/src/pii.ts` |

## Pages (`apps/web/public/`)

| Page | For | Script |
|---|---|---|
| `z.html` | the player (phone) | `ttt.js` |
| `big.html` | the spectator view and the big screen (no sign-in) | `big.js` |
| `host.html` | the host: choose the format and the move clock, start, pause, resume | `host.js` |

## Tests

- `bun test packages/ttt` (the game and the bracket).
- `bun test apps/edge/test/tournament.test.ts` (the tournament through the real Worker routes).
- One heavy command at a time on this laptop. See `docs/RUNNING.md`.
