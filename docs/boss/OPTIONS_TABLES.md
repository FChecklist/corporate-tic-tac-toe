# Limited options: what the organizer can change today, and what I propose to keep (draft 1, 2026-10-27, for the owner's approval)

Rule: at most about 5 visible choices in the whole console, radio buttons / check boxes, a default always selected, one plain sentence per option. Everything hidden keeps one sensible default, is removed from the console, guide, price text and tests, and a game that is already published keeps working. Read from each game's console code (`zc.js` GROUPS and groups) on 2026-10-27; items marked (?) I could not read exactly and will confirm in the code before building.

## Common to all games (steps 1, 2, 5)
| Option | Today's choices | Keep | Hide (default) |
|---|---|---|---|
| Occasion / name of game | 10 occasion names + typed name | nothing | Occasion = "Team event"; a name box under "Name your game (optional)" |
| Day | Today / tomorrow / another date | **Day** (3 radio) | - |
| Time | list of times / another time | **Time** (radio list + other) | - |
| How many people | 100/250/500/750/1000/2500/5000/10000 + typed number + demo (Bingo 10) | **Size** (radio, demo first) | typed size under "My crowd is a different size" |
| Who can join | Only people on a list / Anyone with the link | **Who can join** (2 radio, default Anyone) | - |
| Only my employees | check box (needs ID or mobile choice) | **check box** (default off) | "What must a person give" (mobile/ID/both) shown only when the check box is on |
| Guests invite others | on/off, 1-10 each, which kinds of guest | nothing | off (default) |
| Prize set | 4 presets (Classic, Simple, Rich, Choose myself) + each prize line and its number of winners | **Prize set** (3 radio: Classic, Simple, Rich) | prize lines and winner counts under "Change prizes" |
| Brand moments | opening / middle breaks / closing slots, lucky-draw break, brand colour and logo | nothing | all under "Extras (optional)" |
| Hosts / Co-hosts | add people in step 5 | stays (optional card) | - |
| Pay / publish | pay only if money is due | stays | - |

Visible count for the common part: Day, Time, Size, Who can join, Prize set = 5 (+ the employees-only check box).

## Bingo (today also: cards per person, how the card marks, gap between numbers, rounds)
| Option | Today | Keep | Hide (default) |
|---|---|---|---|
| Cards for each person | 1 / 2 | - | 1 |
| How the card marks | automatic / tap-to-dab | - | automatic |
| Gap between numbers | 6 / 9 / 12 / 15 s | - | **12 s only** (owner 2026-10-27, same as Tambola) |
| Rounds | 1-5 | - (already hidden) | 1 |
| What guests type to join | name only / name + mobile | - | name only |
Game-specific visible choices: none (only the common 5).

## Tic Tac Toe (today: format and move clock chosen on the day on the tournament page; all the common choices)
| Option | Today | Keep | Hide (default) |
|---|---|---|---|
| Move clock | 10 / 20 / 30 / 60 s | - | **20 s only** (?) |
| Format (1 against 1 or teams) (?) | chosen on the day | **keep as one radio on the tournament page** (default 1 against 1) (?) | other format details |
| Cards/rounds/tickets fields from the platform | tix, spd, rnd (?) | - | defaults |

## Snakes and Ladders (the game with the most choices today: 12 own settings)
| Option | Today | Keep | Hide (default) |
|---|---|---|---|
| Game type | Race / Team race / Table (2-20 share one board) | **Race only** (default) | Team race, Table (teams count 2-10) |
| Throws | automatic (fate) / players throw | - | automatic |
| Board size | 100 / 144 / 225 squares | - | 100 |
| Snakes / Ladders | 6-12 each | - | fixed (default of the game) |
| How a player finishes | exact throw / reach or pass | - | exact throw (?) |
| Game ends when N players are home | 1-5 | - | 1 (?) |
| Look of the board | Jungle / Career | - | Jungle (Retro/Modern look is a player choice, not an organizer one) |
| Turn window | 15 / 20 / 25 / 30 s | - | **20 s only** (?) |
| One prize per person | check box | **keep, default on** | - |
| What guests type to join | name only / name + mobile | - | name only |

## Luck by Chance (today: rounds, press window, prizes)
| Option | Today | Keep | Hide (default) |
|---|---|---|---|
| Press window | 6 / 10 / 15 s | - | **10 s only** (owner decision; published games with 6/15 keep working) |
| Rounds | 1-20, default 10 | - | 10 (R01/R02 stay: 10 dice rounds each) |
| Everything else | the common choices | common 5 | - |

## Lucky Draw (new, not built yet: choices proposed from the start)
| Option | Choices | Keep | Hide (default) |
|---|---|---|---|
| Draw control | Manual (press Draw) / Auto | **2 radio** (default Manual) | the gap between auto draws: fixed 20 s |
| Prizes | list of prize name + number of winners | **prize list** (default 1 prize, 1 winner) | - |
| One person can win more than one prize | check box | **check box** (default off) | - |
| Retro / Modern reveal | player choice on the phone | player-side, not organizer | - |

## Totals if approved
Bingo 5 visible choices, Tic Tac Toe 6, Snakes and Ladders 6, Luck by Chance 5, Lucky Draw 4 (+ the common day/time/size/who). Hidden ones stay in the code as defaults for games already published.


## Approval log
2026-10-27 owner approved all tables with one change: Bingo gap = 12 s only. Lucky Draw auto gap = 20 s only. Items marked (?) are to be confirmed in code before building each game.

2026-10-27 owner rule (all games): a fixed gap or timer exists ONLY when the software runs the game. In manual play (an organizer or Host moves things on by hand) there is no countdown, no 'Next in N s' and no promised total length; screens say 'Waiting for the host'. The claim/late rule still holds in manual play (valid only before the next move or number is announced, server clock). Lucky Draw: the 20 s gap belongs to Auto only.
