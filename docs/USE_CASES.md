# Corporate Tic Tac Toe: use cases, exceptions and what can go wrong

Every row has an ID. A test that covers a row carries the same ID or rule number in its name (`R26: ...`, `G18/D5: ...`), so `grep "R26"` finds it. Rule numbers are in `docs/RULES.md`.
Tests for the game: `packages/ttt/test/` (`bun test packages/ttt`). Tests for the tournament through the real Worker routes: `apps/edge/test/tournament.test.ts`. The simulation `tools/sim2/bracket-sim.ts` plays whole tournaments on a fake clock. The money, roles, e-mail and deletion rows are shared with the sister product (Corporate Bingo): their tests (`usecases.test.ts`, `pay.test.ts`, `roles.test.ts`, `privacy.test.ts` and others in `apps/edge/test/`) were inherited and have not been re-run for Tic Tac Toe in this pass. Nothing is deployed, so no row has a "live" result.

## The business rule
Building and publishing are free. The organizer pays before the start time. If it is not paid by the start, the tournament does not begin. Players never pay and never stake money; there are no cash prizes; any gift comes from the organizer outside this product.

- **Case 1.** Published, organizer did not pay, tournament did not start: nothing was delivered, the organizer can make a new tournament; the unpaid one is forgotten after 30 days.
- **Case 2.** Published, organizer paid: the tournament runs; the organizer can make a new one next time ("create one like this").

## A. Organizer and host: getting in and building
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-1 | New e-mail, "Create" | Console opens at once, AI work link ready | `free-launch.test.ts` (shared) |
| UC-2 | E-mail that already has an account | Must use the e-mailed 6-digit code or one-click link | `usecases.test.ts` (shared) |
| UC-3 | Wrong, expired or reused sign-in code | Refused with a human message | shared |
| UC-4 | Build by hand or with the AI link | Saved as a draft; players cannot see or join it | shared |
| UC-5 | Bad input: bad id, size 0 or over the limit | 400 with a message, nothing saved | shared |
| UC-6 | A start time more than 30 days ahead | Refused | shared |
| UC-7 | Organizer A reads or changes organizer B's tournament | Refused | shared |
| UC-8 | The AI key tries to publish, pay, erase, start, pause or manage keys | Refused (403) or hand-over only | shared |

## B. Publish and pay
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-9 | Publish (free), pay before the start | Entitlement created, tournament begins on time | shared |
| UC-10 | Published, never paid, start time reached | Players see "waiting for the organizer"; organizer e-mailed once | shared |
| UC-11 | Pay after the start time passed | Players unlock; the host can then start | shared |
| UC-12 | Payment confirmed by the Razorpay webhook only (browser closed) | Same as paying in the browser | shared |
| UC-13 | Tampered amount, wrong signature, duplicate payment | Refused or kept as credit; nothing fulfilled twice | shared |
| UC-14 | Cancel a paid tournament before the start | No refund; the amount stays as credit for 365 days (`ROLES_AND_CONSOLE_SPEC_6.md`) | shared |
| UC-15 | Size bigger than any pack (over 10,000) | "Custom arrangement" message, no checkout | shared |

## C. Players join (phones)
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-16 | Join a draft | Refused ("not open yet") | shared |
| UC-17 | Join: the two boxes come first and must be ticked, then only a display name is asked | Join succeeds with a name of at least 2 characters; the page then sends the consent (notice version and time), which is stored in `ttt_consent` | no test yet (the page flow is `ttt.js` `joinView`; the route is `ttt/consent`) |
| UC-18 | Name with markup or too long | Cleaned (`<`, `>` and backticks removed), cut to 60 characters at join and to 40 when the bracket is made | no test yet |
| UC-19 | Same phone joins twice | One place only (`device-used` or the same player again) | shared |
| UC-20 | Tournament full, even with many joins at the same instant | Never more than the limit | shared |
| UC-21 | Invite-only tournament, person not on the list | Waits in the waiting room (the player page does not yet carry a personal-link token; see `PRIVACY_AND_LIFECYCLE.md` 2c) | shared; page gap |
| UC-22 | The list closes at Start | A new phone is refused and may only watch; a player who was in can open the link again | `tournament.test.ts` R32/D4 |
| UC-23 | Fewer than 2 players (or fewer than 2 full teams) when the host presses Start | Start refused with a clear message | `tournament.test.ts` G5/G6 |
| UC-24 | Someone who only wants to watch | Opens `big.html`; sees display names and boards only; is asked for nothing | `tournament.test.ts` R30 |

## D. The draw and the start
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-25 | Before the start, a player or spectator looks at the seal | Only the fingerprint (`commit`) is shown | `tournament.test.ts` R26 |
| UC-26 | Host presses Start | The roster closes; the seed is made from the secret, the id and the roster; the secret is revealed; anybody can re-compute the bracket | `tournament.test.ts` R26; `seal` tests |
| UC-27 | Bracket order | A shuffle from the seed; the order the names were typed in does not matter; byes only in round 1, never two empty places in a pair | `bracket.test.ts` R16 to R18 |
| UC-28 | Who has X | A coin from the seed; game 2 swaps; game 3 is a fresh coin; nobody can change it | `match.test.ts` R09; `tournament.test.ts` G8/R9 |
| UC-29 | Anyone but the Organizer or a Host presses Start | Refused (403) | `tournament.test.ts` G5/G6 |

## E. Playing a board
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-30 | A move on a taken square, off the board, or out of turn | Refused; the board does not change | `classic.test.ts` R03; `match.test.ts` R06, R15 |
| UC-31 | Three in a row; a full board | Win; draw | `classic.test.ts` R04 R05 |
| UC-32 | A drawn game | Replayed at once with the marks swapped, up to 3 games | `match.test.ts` R08 |
| UC-33 | Three drawn games | Fate decides (a number from the seed, the board and the player id); the results screen says "won by fate" | `match.test.ts` R10; `bracket.test.ts` R25 |
| UC-34 | The move clock runs out | The software plays a random empty square drawn from the seed | `match.test.ts` R12 |
| UC-35 | A second clock-out in a row in the same game | The board is lost (forfeit) | `match.test.ts` R13 |
| UC-36 | Both players stay away | The player who was due to start loses | `match.test.ts` R14 |
| UC-37 | An old screen or a double tap | The stale tap is refused; nothing depends on when somebody looks | `match.test.ts` R15 |
| UC-38 | Only the player to move, and only from their own phone, can move; a spectator or a wrong device cannot | Refused | `tournament.test.ts` R27 |
| UC-39 | A player reloads the page or loses the connection | Sees the board exactly as it is; the clock kept running | `tournament.test.ts` G11/R29 |
| UC-40 | The host pauses | No clock runs, nobody can move; after Resume every clock has the same time left | `tournament.test.ts` G10/R28 |

## F. Formats and size
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-41 | One-against-one, 2 to 40 players | One champion; the bracket finishes | `bracket.test.ts` R16 R18 |
| UC-42 | Team format: teams of 3 or 5 | Cut from a seeded shuffle; left-over players only watch; one board per seat; the team that wins more boards wins the match | `bracket.test.ts` R19 R20; `tournament.test.ts` G16/R20 |
| UC-43 | A team whose members are all away | Loses its boards by forfeit | `bracket.test.ts` R20 |
| UC-44 | A crowd of 1,000 (and 150 through the routes) | One knockout, about log2(N) rounds, no stuck match, even if a tenth never show up | `bracket.test.ts` R21; `tournament.test.ts` G17/X5; `bracket-sim.ts` |
| UC-45 | A later match | Starts the moment both of its earlier matches are finished | `bracket.test.ts` R22 |

## G. Results
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-46 | The final ends | The strict ranking is made once and stored; the champion is rank 1; the podium (first to fifth) goes into the winners record as seat numbers; the 23-hour clock starts | `tournament.test.ts` G12/R24 |
| UC-47 | Points and ties | 2 per game won, 1 per game drawn; order: round reached, total points, points in the last match, fate; every rank unique | `bracket.test.ts` R23 R24 |
| UC-48 | Replay with the same people | A new tournament (clone) with a fresh sealed seed | `tournament.test.ts` G13 |

## H. Data and deletion
| ID | Scenario | Expected | Test |
|---|---|---|---|
| UC-49 | 23 hours after the end | Every name is gone (participant, seat, `ttt_p`, `ttt_e`, consent, ranking); the opaque match record and the podium seat numbers remain | `tournament.test.ts` G18/D5 |
| UC-50 | One tournament's data and another's | Never mixed | `tournament.test.ts` U5/D13 |
| UC-51 | Organizer presses Erase early; the AI asks | Done on the organizer's confirmation | shared |
| UC-52 | 365 days after the end | Everything about the tournament is deleted at 00:00 IST; invoice details are kept | shared |
| UC-53 | Spectator view | Names and boards only; never a seed before the start, never a device id | `tournament.test.ts` R30 |

## I. Exceptions: what can go wrong
| ID | Scenario | Expected |
|---|---|---|
| UC-54 | Mail service down | The request still succeeds; the mail is kept and retried |
| UC-55 | Daily write budget reached | A polite "busy" answer, no half-saved state |
| UC-56 | Oversized body, malformed JSON | Refused cleanly |
| UC-57 | The host closes the tab while a tournament runs | The scheduled job plays due clock-outs (`apps/cron`, every minute); any look at the tournament also settles them |
| UC-58 | The host never presses Start | The tournament counts as ended 6 hours after the scheduled start; players' data is erased 23 hours after that |
| UC-59 | An organizer removes a player during the tournament | The player can no longer move and loses by the clock (the one human power over who plays; see `WINNERS_AND_AUDIT.md`) |

## Known limits
- The player page does not yet carry a personal-link token or an invite code, so rows about personal links and "who invited whom" work on the server but not from `z.html`.
- The page scripts are tested in a DOM, not in a real browser engine, for the shared pages; `ttt.js`, `big.js` and `host.js` have no page test yet.
- Online payment is not testable end to end until Razorpay keys exist. Everything around it is tested with a stand-in gateway (shared tests).
