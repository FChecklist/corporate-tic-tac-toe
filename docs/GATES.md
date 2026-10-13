# Gates for Corporate Tic Tac Toe

Format: ID | true/false | proof | note. A gate is true only with a passing test or a direct file check. OWNER means only the owner can do it.

ID | status | proof | note
---|---|---|---
G1 | true | apps/edge/test/tournament.test.ts (lobby), apps/web/public/host.js | Organizer creates the game (POST /api/z) and the Host chooses format and move clock at the start. Pages not driven in a real browser.
G2 | true | apps/edge/test/tournament.test.ts G12 (view shows format, move clock, players) | What the host chose is read back.
G3 | true | apps/edge/test/people.test.ts (common link and personal links) | Join link is z.html?e=ID.
G4 | true | apps/web/test/ttt-page.test.ts (390 px window, no account), apps/web/test/ttt-play-page.test.ts (the page plays a move through the real routes) | Simulated phone browser, not a real phone.
G5 | true | apps/edge/test/tournament.test.ts (view.joined) and ttt.js waiting screen | 
G6 | true | apps/edge/test/tournament.test.ts: refused with fewer than 2 players, only Organizer or Host | 
G7 | true | packages/ttt/test/classic.test.ts, match.test.ts, bracket.test.ts (rules R01-R30 in docs/RULES.md, one test each) | 
G8 | true | packages/ttt/test/phone.test.ts (bracket and starters from the seed), match.test.ts R9; apps/edge/test/tournament.test.ts R26 | Every phone computes the bracket and every starter from the public sealed seed. The server draws and stores the secret and checks the fingerprint (documented limit).
G9 | true | packages/ttt/test/classic.test.ts R4; phone.test.ts R4, R15; apps/edge/test/tournament.test.ts M3 | Three in a row is detected by the engine on the phone. A move out of turn, on a taken square or twice in a row is stored by the mailbox (it does not judge) and ignored by every phone that replays it. There is no separate claim step in this game.
G10 | true | apps/edge/test/tournament.test.ts M7; packages/ttt/test/phone.test.ts R28 | Pause stops all clocks (the mailbox stores nothing while paused; the phones subtract the pauses); resume keeps the time left.
G11 | true | packages/ttt/test/bracket.test.ts R29; apps/edge/test/tournament.test.ts G11 | A brand-new phone for the same player shows the board as it is; the clock kept running (it runs from the stored move).
G12 | true | apps/edge/test/tournament.test.ts G12 (8 simulated phones: strict ranking, podium, deletion clock) | The ranking is computed on the phones of the final and stored when two phones (or the Organizer's page) send the same. Results screen markup is in big.js; not viewed in a real browser.
G13 | false |  | A new game from the same settings is the existing 'clone' feature; not exercised for a finished tournament in a test.
G14 | n/a |  | This product has no lucky draw.
G15 | false |  | Brand name and colour show on the player screen; scheduled brand breaks between rounds are NOT built for the tournament.
G16 | true | apps/edge/test/tournament.test.ts G16 (team, 14 simulated phones) and G12 (8 players) | 
G17 | true | tools/sim2/bracket-sim.ts (simulated phones), apps/edge/test/tournament.test.ts G17 and R14, packages/ttt/test/bracket.test.ts R21 (1,000 engine-level) | Sim result: 1,000 players (100 never show up), 999 of 999 matches, 0 stuck; 300 players in teams of 5, 59 of 59, 0 stuck. Numbers below.
G18 | true | apps/edge/test/tournament.test.ts G18; consent.test.ts (K4 rows) | Deletion verified by running the scheduled tick 25 hours later: names, entrants, ranking, stored moves and reports are gone. The scheduled job itself is not deployed (D5).
S1 | true | apps/edge/test/server-does-no-game-work.test.ts | The product rule: the players' phones do the computing, our server only stores and relays. The test lists every module the Worker may take from the packages folder and fails on any other game-logic import (it was shown to fail with a planted rule import, which was then removed). The only thing taken from the game package is the sealed-seed hash check.
S2 | true | apps/edge/test/tournament.test.ts M1-M10 | The mailbox: stores a move with the server's own stamp only if the pid is on that match and seq is the next number; keeps a result only when both reports match (or one is uncontested for 30 s); flags a mismatch for the Organizer; never evaluates a board; the Organizer can settle.
P1 | true | apps/web/public/index.html, site/index.html | Short plain sentences; not read by the owner yet.
P2 | true | apps/edge/test/pay.test.ts (price table), apps/web/public/pricing.html | Price table is copied from Corporate Bingo: OWNER to confirm.
P3 | true | apps/edge/test/free-launch.test.ts | 
P4 | false |  | Phone, tablet and laptop widths not checked in a real browser.
P5 | true | apps/web/test/pwa.test.ts | Service worker and manifest present; the offline screen was not tried on a device.
P6 | false |  | Contrast check not run.
P7 | true | apps/web/test/seo.test.ts | 
P8 | true | apps/edge/test/visits.test.ts; apps/web/test/visits-dom.test.ts | First-party only.
P9 | false |  | OWNER confirms the contact details.
P10 | false | apps/web/test/gamesbar.test.ts (links listed) | Links not resolved (local only).
P11 | true | apps/web/public/404.html, site/404.html | 
P12 | true | git log | Commit recorded locally.
O1 | true | apps/edge/test/account.test.ts, ai-signin.test.ts | E-mail code, no password.
O2 | true | apps/edge/test/pay.test.ts | 
O3 | true | apps/edge/test/pay.test.ts (order, verify, fulfil) | Mock Razorpay stand-in.
O4 | false | apps/edge/test/pay.test.ts (invoice and mail queued) | Mail is queued in a local outbox; inbox delivery not tested.
O5 | false | apps/edge/test/branding.test.ts | Name, colour and logo on the player screen yes; logo upload not re-tested for this product.
O6 | true | apps/edge/test/roles.test.ts, consent.test.ts (K5) | 
O7 | false | apps/edge/test/people.test.ts (see and remove) | Remove works; 'end a game' is not built.
O8 | false |  | The organizer report is still the Bingo report layout; no results section for the tournament.
O9 | true | apps/edge/test/cancel.test.ts, reopen.test.ts, reschedule-window.test.ts, credit.test.ts | No refund; credit and 365-day move window.
O10 | true | apps/edge/test/privacy.test.ts (erase), tournament.test.ts G18 | 
O11 | false | apps/web/public/contact.html | Contact page works (mail link); no auto-reply.
U1 | true | apps/web/test/ttt-page.test.ts | Boxes come before the name field.
U2 | true | apps/edge/test/consent.test.ts (K4) | Version, wording hash and time are stored.
U3 | true | apps/edge/test/nameonly.test.ts; apps/web/test/ttt-page.test.ts | Display name only.
U4 | true | apps/edge/test/tournament.test.ts M2 | There is no private card in this game; a player can write only to their own match, from their own phone.
U5 | false |  | No leave button on the player page; closing the page is leaving.
U6 | false |  | The organizer can find and erase a person (console), but the player page has no request button.
U7 | true | apps/web/public/terms.html (Grievance Officer clause) | 
U8 | true | apps/edge/test/consent.test.ts (K4 box B); terms clause 12 | 
A1 | true | apps/edge/test/pay.test.ts, legal.test.ts (ledger) | 
A2 | false | apps/edge/test/pay.test.ts (webhook) | Webhook handling tested with a stand-in; not the live log.
A3 | false |  | Not built for this product.
A4 | n/a |  | There are no refunds.
A5 | false |  | Only the TEST/LIVE switch exists.
A6 | false |  | Not verified.
A7 | false |  | Not built.
A8 | false |  | Not done.
A9 | false |  | Not written.
E1 | false | apps/edge/test/account.test.ts | Queued in the local outbox; not received in a real inbox.
E2 | false | apps/edge/test/pay.test.ts | Same.
E3 | false | apps/edge/test/people.test.ts | Same.
E4 | false |  | No reminder mail for the tournament.
E5 | false |  | No results mail (report is the Bingo report).
E6 | n/a |  | No refunds; a credit mail exists (credit.test.ts).
E7 | false | apps/edge/test/unplayed.test.ts | Same outbox limit.
E8 | false |  | No auto-reply.
E9 | false |  | Not verified.
E10 | false |  | No DNS lookup (local only).
E11 | n/a |  | No marketing mail.
E12 | false |  | Not built.
E13 | false |  | Links not resolved.
D1 | true | docs/PRIVACY_AND_LIFECYCLE.md | Data map.
D2 | false | docs/PRIVACY_AND_LIFECYCLE.md | Notice text is now the Terms boxes (K4); the data map has not been re-checked line by line against them.
D3 | true | apps/edge/test/consent.test.ts | 
D4 | true | apps/edge/test/nameonly.test.ts | 
D5 | false | apps/edge/test/tournament.test.ts G18 | Deletion code works; the scheduled job is NOT deployed.
D6 | true | apps/edge/test/legal.test.ts | 
D7 | false |  | No player-facing request form.
D8 | true | apps/web/public/terms.html | 
D9 | true | docs/BREACH_RUNBOOK.md | 
D10 | true | apps/web/public/subprocessors.html | 
D11 | false |  | Not stated for this product.
D12 | true | apps/edge/test/audit.test.ts | 
D13 | true | apps/edge/test/tournament.test.ts (another game's rows) | 
R1 | true | apps/web/public/terms.html; docs/RULES.md R31; apps/edge/test/consent.test.ts (no payment code on player routes) | Home page and Terms; other pages not audited one by one.
R2 | n/a |  | No lucky draw.
R3 | true | apps/web/public/terms.html clause 1 | 
R4 | true | apps/edge/test/terms.test.ts (footer links) | Link from the Razorpay window not tested.
R5 | false |  | Pricing page wording vs Terms clause 4.2 not compared.
R6 | false | apps/edge/test/legal.test.ts | Invoice fields not re-checked for this product.
R7 | false |  | Not audited.
R8 | n/a |  | No coaching offer here.
R9 | false |  | No local-storage notice written for the player page.
R10 | false |  | Not done.
R11 | true | apps/edge/test/reschedule-window.test.ts, cancel.test.ts, credit.test.ts | Policy page equals code: pay per game, no refund, move within 365 days of payment, credit on cancel.
R12 | false |  | OWNER.
Y1 | false |  | OWNER / central service.
Y2 | true | apps/edge/test/pay.test.ts | Price is computed on the server.
Y3 | false |  | Needs the live host.
Y4 | false |  | OWNER.
Y5 | true | apps/edge/test/pay.test.ts | Signature check, ledger row.
Y6 | false |  | OWNER.
Y7 | true | apps/edge/test/pay.test.ts | 
Y8 | true | apps/edge/test/pay.test.ts | 
Y9 | n/a |  | No refunds.
Y10 | false |  | OWNER.
K1 | true | apps/edge/test/consent.test.ts | Publish: boxes A and B. Server refuses without them.
K2 | true | apps/edge/test/consent.test.ts | Sign-up and sign-in.
K3 | true | apps/edge/test/consent.test.ts | Before paying (screen and pay link).
K4 | true | apps/edge/test/consent.test.ts; apps/web/test/ttt-page.test.ts | Join: boxes A and B before the name.
K5 | true | apps/edge/test/consent.test.ts | Host setup and Co-host.
K6 | true | apps/edge/test/consent.test.ts | Invite list and people entry.
K9 | n/a |  | This product has no contact, grievance or data-request form (mail links only).
LR-1 | true | apps/edge/test/consent.test.ts (nothing is ever taken from a player) | No payment code on player routes, no fee setting, payment table stays empty.
LR-6 | true | apps/edge/test/consent.test.ts (K4 notice and 24-hour erasure) | Invite chain is in the box A wording and is erased with the person.
X1 | true | packages/ttt/test/classic.test.ts, match.test.ts | 3 in a row, draw, who starts, move clock.
X2 | true | packages/ttt/test/bracket.test.ts; apps/edge/test/tournament.test.ts | 1-v-1, team-v-team, knockout for a crowd, spectator view.
X3 | false |  | Shell cloned and renamed; the organizer console and organizer report are still Bingo-shaped in places (see the list below).
X4 | false |  | See the false gates in this table.
X5 | true | tools/sim2/bracket-sim.ts | Sim result: 1,000 players (100 never show up), 999 of 999 matches, 0 stuck; 300 players in teams of 5, 59 of 59, 0 stuck (also with 30 of the 300 away). Numbers below.

## Simulation result (tools/sim2/bracket-sim.ts, simulated phones running packages/ttt/src/phone.ts against the mailbox routes, fake clock)

| Run | Matches finished | Stuck | Flagged | How results were kept | Moves stored | Virtual time |
|---|---|---|---|---|---|---|
| 1,000 players, 100 never show up (`bun tools/sim2/bracket-sim.ts 1000 10 7 0`) | 999 of 999 | 0 | 0 | 899 both players agreed, 100 single report uncontested | 8,099 | 5 minutes |
| 300 players in teams of 5 (`bun tools/sim2/bracket-sim.ts 300 0 7 5`) | 59 of 59 | 0 | 0 | 295 boards, both players agreed | 2,629 | 2 minutes |
| 300 players in teams of 5, 30 of them away (`bun tools/sim2/bracket-sim.ts 300 10 7 5`) | 59 of 59 | 0 | 0 | 254 both, 41 uncontested | 2,331 | 7 minutes |

In the 1,000-player run the simulated phones made 44,663 reads and 10,429 writes (squares, clock-out claims, reports, registrations of later matches). The Organizer's page made the rest: the draw in two parts, a look every 12 seconds, the final ranking. The server took no decision: every square, clock-out claim, report and the final ranking was posted by a phone.
