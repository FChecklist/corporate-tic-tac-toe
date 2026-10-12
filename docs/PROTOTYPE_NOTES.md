# Corporate Tic Tac Toe: prototype notes (2026-10-12)

Separate product, like Corporate Tambola and Corporate Bingo: its own repository, nothing shared. Rule: the game uses no server. Moves go phone to phone (or laptop to laptop) over a direct WebRTC channel and everything is computed on the players' own devices.

## What this prototype contains
| File | What |
|---|---|
| `src/engine.ts` | The rules: three boards (3x3, 4x4, 5x5) played to a full board; runs scored by length and direction (table below); second-player bonus (KOMI); tie-breaks; the rules card text. |
| `src/random.ts` | Every random choice from a public beacon value: pairing of seats per round, byes, who has X on each board (board 1 coin, board 2 swapped, board 3 fresh coin), the move placed when time runs out, the last tie-break. Deterministic: same on every device, unpredictable before the beacon value exists. |
| `src/transcript.ts` | A match is a chain of signed moves (ECDSA P-256 device keys, each move carries the hash of the one before). Both phones apply the same moves; anyone can replay the chain and recompute the score. |
| `src/peer.ts` | WebRTC data channel. The only server is a meeting point where the two phones swap one short note each (offer, answer). |
| `server/signal.ts` | The meeting point for local tests (in-memory, 10-minute notes, serves the page). The product version is one small Cloudflare Worker. |
| `src/app.ts`, `web/index.html` | The screen: rules card, live score breakdown for both sides, move timer (8 s), final sheet with the move-record check. |
| `sim/komi.ts` | Simulation used to set the second-player bonus. |
| `test/*.test.ts` | 41 unit tests (`bun test test`). |

## The scoring (owner-approved defaults)
Run = unbroken stretch of one player's marks along a row, column or diagonal; only the longest unbroken run counts (a run of 4 is a 4, not also a 3 and a 2).

| Run | Horizontal | Vertical | Diagonal |
|---|---|---|---|
| 2 | 1 | 2 | 3 |
| 3 | 5 | 10 | 15 |
| 4 | 15 | 30 | 45 |
| 5 | 40 | 80 | 120 |

Most points over the three boards wins the match. Tie: most valuable single run, then points on the 5x5, then the random beacon.

Worked example (verified by a test): 3x3 board `X O X / X O O / X X O`. X = vertical 3 (10) + horizontal 2 (1) + diagonal 2 (3) = 14. O = vertical 2 + vertical 2 + horizontal 2 + diagonal 2 + diagonal 2 = 2+2+1+3+3 = 11 (plus the second-player bonus).

## Second-player bonus (KOMI), from `sim/komi.ts`
With no bonus the first player scored more on average (simple bots, 4,000 games per case): 3x3 about 7 to 9 points, 4x4 about 4 to 8, 5x5 about 17 to 27. Starting values are the averages: **3x3: 8, 4x4: 6, 5x5: 22**. The bots are simple (random and greedy); real players differ, so these numbers must be re-checked with real matches.

## What was proven in this session
- 41 unit tests pass: scoring (including the worked example), lines, tie-break order, deterministic randomness, pairing of 1,000 seats, byes, starters, signed chain (tamper, reorder, wrong signer, replay all refused).
- TypeScript strict check of `src` is clean.
- **Two browser tabs on this laptop played a full 50-move match over a direct WebRTC channel**: both ended with identical boards and scores, the 50 signed moves verified, and the score was re-computed from the chain on both sides.
- The meeting point carried 2 posts, 15 polls and 1,736 bytes for the whole match; no move went through it.

## What was NOT proven
1. **Two different devices on two different networks.** Both tabs ran on one laptop, so only local ("host") connections were used. Behaviour behind home routers (STUN) and behind strict office firewalls is untested. Strict firewalls will need a relay (TURN); the current free limits of any relay service are not verified.
2. **IP privacy.** A direct connection can show a player's public network address to the opponent. A relay-only setting hides it but needs a relay. Decide before launch.
3. Timeouts, forfeits, disconnect and reconnect are only partly implemented (the 8 s timeout move and a 30 s silence message exist; no forfeit report).
4. The tournament itself is NOT built: registration and payment, seat list, the beacon, rounds and pairings on a shared clock, survivors list, the collector for one signed result per match, prizes, report, deletion, website pages, refer and earn, ledger.
5. Mobile layout was not tested on a phone.

## Next steps
1. Test on two real devices on different networks (phone on mobile data and a laptop on Wi-Fi, then behind an office firewall); measure how often a relay is needed.
2. Decide the relay and IP-privacy approach.
3. Build the tournament layer and the product site, in the same way as Corporate Bingo (own repo, own Pages project and D1 database, central payment service with plans `tictactoe_pack_<N>`).
