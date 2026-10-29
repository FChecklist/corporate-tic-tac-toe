# DECISION LOG AND RECHECK of all specs (boss, 29 Oct 2026 night)
Purpose (owner): know WHY we did, WHAT we did, WHAT we discussed and WHY, WHAT we changed and WHY, so the Host and Co-host experience and all game consoles can be made better. Sources rechecked: 100 (console spec), 110 (feedback gap plan), 130 (test playbook), 180 (owner words), 190 (changelog), 191 (language), 192 (build plan), 200 (merged spec), the mock (index.html, host.html), the 1.4.x-1.6.x release notes (10c, 10d, 10e) and the engine config (packages/beacon/src/config.ts).

## A. WHY we started (context)
1. The organizer is usually an HR person, afraid to give details, who must never be confused. Evidence: Sneha's second game (23 claims, 9 awards, 14 "Prize already taken", four blank prizes, published 9 minutes after the start, "nobody reminded me"). So the console must be short, plain, honest about data and always show ONE clear status.
2. The live console had ten steps and technical words (size, "Only my employees", mobile/employee ID, guest invites). Organizers had to think. Goal: select and publish.
3. Owner priorities: corporate games first (P1-P5), all consoles consistent, local first, nothing live before the owner says.
4. Privacy and trust are the sales point: "No personal details needed", deletion in 24 hours, no email to participants.

## B. DECISION LOG (what we discussed, why, what changed, why)
| # | Topic | What we discussed / decided | Why | Changed from |
|---|---|---|---|---|
| 1 | Steps | Ten steps became FIVE steps + a Game dashboard that is NOT a step | Fewer decisions; dashboard is "run the game", not "set up" | Ten steps 1-10 |
| 2 | Who is it for | Three cards (Your people / and their families / Extended family) | Organizer thinks "who", not "settings"; maps old "Who can join" + "Only my employees" | Size + radios + tick |
| 3 | Validation | Two buttons: System validates for you / You validate yourself | Most HR choose system; others approve by hand; replaces 9 options (common link, personal links, ID check, approval, 5 e-mail variants) | 9 options |
| 4 | Criteria | ONE criterion: Employee ID or Email ID (no "both"); list decides, no domain rule | Multi-domain companies; simpler; no Google/Microsoft dependency | Both fields, domain check, Google sign-in |
| 5 | We send no email | Organizer shares ONE general link from own mail; no mail merge; no passcode for participants | Zero email cost, less data, less fear | We e-mailed unique links / codes |
| 6 | List check | Optional; silent clean; viewer for 600+ rows | Owner "I forgot myself many times"; never block HR | Compulsory confirm |
| 7 | Family | Fixed 1 + 4 tickets, each ticket = one participant (size and price) | Simplicity; price follows participants | 1-10 per person |
| 8 | Ticket number | Sacred: unique, never reused, all logs keyed by it, name optional | Tracking, audit, support | Name/mobile as identity |
| 9 | Size | Drop-down of real pack sizes, pre-selected, price shown | "Nobody should think" | Free number box |
| 10 | Step 1 | Occasion/day+date/time each with Other; TIME ZONE with players' local times | Online game, people in any location | Single time, no zone |
| 11 | Step 3 | Prizes listed directly, tags Popular/Recommended, "can be won 1-5 times", gift drop-down (no cash), worth up to (₹ sticky), Full House 1st-5th, Super Bumper 1-10, A/B per-ticket prizes in 2-ticket games | Idiot-proof; owner wants control per prize | Classic/Simple/Rich cards |
| 12 | Lucky Draw | Recommended; 1-3 draws; timing end / middle+end / 1/3,2/3,end; lowest value first, highest last | Excitement builds; fairness of order | Hidden in "More prizes" |
| 13 | Step 4 | Brand & Breaks: logo, breaks max 3 (1 ticket) / 5 (2 tickets), each break = a public link | Simple explanation; limit by game length | Text messages |
| 14 | Step 5 | Publish with warning, read-back, participant preview (mobile + laptop), Host/Co-host emails, rehearsals at the end | Last look, avoid late publish (Sneha), builds confidence | Hosts as separate step |
| 15 | Host / Co-host | Same game link for all; email + 6-digit passcode; Host = any change like organizer (max 5); Co-host = brings people, cannot change the game (unlimited) | One link to remember; roles explained in plain words | Host link one-time + Co-host name+mobile |
| 16 | Payment | Separate: Pay now or Copy payment link to share, small print "claim (reimburse) it back", works 7 days | Amount is small; finance person may pay | Pay step 8 |
| 17 | Statuses | Game ID shown always + 11 status pills with plain banners (unpaid "Don't worry..."; paid "Congratulations..."; start time passed in red) | Organizer must never be confused | Draft/paid words only |
| 18 | Dashboard | Share card first, ready check, payment, rehearsals, waiting table, tickets claimed, board, prizes, feed | Do the next thing first | "Do these next" list |
| 19 | Waiting table | Ticket number + optional Name/Emp ID/Email/Mobile/Referred by; Let in, Not now (later still possible) | Organizer sees who is asking | Admit/Decline only |
| 20 | Board | Retro Housie board; timer (auto, 12 s) or Press to Roll Out the Next Number (manual, 5 s lock, green/grey), Pause in all modes | Familiar look; stop mistakes | Plain grid |
| 21 | Claims | "Ticket N has claimed X, the system is checking" -> "Congratulations, correct" -> "X is gone"; AUTO pauses and resumes by itself; manual says "Press the button..." | Everyone sees fairness; nobody rushes | Silent claims |
| 22 | Winners | Winner ticket + all held details visible to Organizer/Host/Co-host only; "Prize handed over" tick | HR must hand over prizes | Report only |
| 23 | Rehearsals (1.6.0) | Three free rehearsals after payment, own link and Game ID R1-R3, shown at end of step 5 and on dashboard | Keep 1.6.0 feature; confidence before the real game | Not in first mock |
| 24 | Retention | Personal information deleted in 24 h; game log (ticket numbers), organizer, winners, Host, Co-host records kept 365 days | Resolves conflict between trust promise and audit | "Everything deleted" |
| 25 | Language | "The system" not "we"; no "invite"/"private"; "participants"; ₹; Cialdini used honestly | HR audience, brand rules | Earlier copy |
| 26 | Payments policy | Only IT Services by Rajat Agarwal through Razorpay | Owner rule for all products | - |

## C. RECHECK FINDINGS (conflicts and gaps between specs, mock and the engine). Each needs an owner answer or a boss default.
1. CO-HOST RIGHTS. New spec: Co-host lets people in and cannot change the game, no payment. Engine today: Co-host = invite + pay only; admitting people is for Organizer/Host/link owner. Boss default: Co-host may admit only people they brought ("Referred by" them); needs engine change. OWNER: confirm.
2. HOST/CO-HOST LOGIN. Engine today: Host one-time link (7 days) then e-mail code or Google; Co-host name + mobile. New: both by e-mail passcode. Phase B; the current games keep their login. OWNER: OK to ask Co-hosts for an email (instead of name+mobile)?
3. WINNER AND WAITING-TABLE DETAILS vs "no personal details" (Name, Mobile columns). Resolution used: they appear only if the participant volunteered them; personal details still vanish in 24 h. OWNER: which game types may ask name/mobile at all?
4. "DELETE ALL PARTICIPANT DATA" grey until 24 h after the game. But personal data is auto-deleted within 24 h, so the button would delete nothing after 24 h. Boss reading: the button deletes the remaining organizer-visible participant records (log extras) on request. OWNER: what should the button delete?
5. WINNERS' DATA for 365 days. Boss reading: ticket number, prize, time only. OWNER: confirm no names/emails of winners are kept 365 days.
6. OLD STEP 4 had opening, break and closing messages and lucky draws (Tambola only). New Step 4 has breaks only. OWNER: keep opening and closing messages as optional lines?
7. PER-TICKET A/B PRIZES and Super Bumper 1-10 need engine ordinals/slots (engine has one full2 house with winner ordinals). New option only.
8. MANUAL MODE minimum 5 s: engine has "no fixed gap" (1.4.4). Server lock is a change; needs owner OK (it is in the spec).
9. CO-HOST ATTRIBUTION vs "same link for everyone". "Referred by" needs a tag. Boss default: the SAME game link, with an automatic hidden tag when a Co-host or participant copies the link from their own page; tag shows as email ID. OWNER: OK?
10. LUCKY DRAW exists in the engine as a prize ("lucky draw in prizes", 1.4.x). Its current timing/count must be read before building 1-3 draws at 1/3, 2/3, end. Engine check pending.
11. PRICE LADDER: the drop-down uses 10/100/250/500/1000/2500/5000/10000; confirm against /api/z/ai-manifest. Free demo 10 only for 10 participants.
12. RETRO BOARD is Tambola-specific. Bingo, Tic Tac Toe, Snakes and Ladders, Luck by Chance need their own board/play area in the same retro style (see D).
13. MOCK-ONLY items to remove in the real build: Demo status box, Simulate a claim, "24 h passed" checkbox, free browsing, sample names, passcode shown on screen, WhatsApp share stub.
14. RAM/usage fine so far (weekly 25%).

## D. THE SIX CONSOLES (Tambola, Bingo, Tic Tac Toe, Snakes and Ladders, Luck by Chance, master console)
Shared (same everywhere): frame, 5 steps, Game ID + status, who is it for + validation, brand & breaks, step 5 publish + Host/Co-host + rehearsals, dashboard order, claim/winner/auto-pause rules where the game has prizes, language, retention words.
Per game (each session fills the exact mapping in its own note):
- Tambola: all of 200 (tickets 1/2, houses, lucky draw, retro Housie board).
- Bingo: card patterns instead of houses; one card per player (no A/B); board = called-number sheet; breaks and lucky draw only if the game supports them; TEST/live status as today; demo cap 10.
- Tic Tac Toe (TEST mode stays TEST): no prizes/tickets in the Tambola sense: rounds/winners per match; board = live bracket; no Super Bumper/A-B; keep the "TEST" label.
- Snakes and Ladders (TEST): dice rounds; board = the snakes board; pause in all modes; manual roll = "Press to Roll Out the Next Number" for the dice; prizes per finisher position.
- Luck by Chance (TEST): press window (10 s, 10 rounds for new games per console spec), per-round gifts; board = round wheel; claim rule per round.
- Master console: shows each game's Game ID/status pill, "Create" opens the game's own step 1; M1-M8 unchanged; Host/Co-host role chip only.
Rule for builders: where a Tambola idea has no meaning in a game, the control is NOT shown (never disabled-with-explanation for a feature the game can never have); where it needs the engine, show "coming soon".

## E. HOW THIS MAKES HOST AND CO-HOST BETTER (proposals, not yet approved)
Host: sign in once with email + passcode, sees the full dashboard with a role bar; add: "Next action for you" line (e.g. "2 people are waiting"), quick Let in all, claim alerts with sound/vibration on phone, pause in one tap, read-only audit of changes ("Host Priya changed the prize at 7:02 pm") so the organizer trusts delegation.
Co-host: a small page (share, waiting, count) plus: a personal counter "People you brought: 34", a one-tap "Copy message for my team", the game start time in their own time zone, and no ability to change anything (already). Show "Referred by" tag results to them.
Both: language "You are a Host" explanations, a short 3-line "What happens on game day" card, and the Reconnecting banner.

## F. NEXT ACTIONS (boss)
1. Owner answers for C1-C6, C9 (short list).
2. master-console session finishes browser runs for TTT, Snakes, Luck and applies spec 200 items (queued).
3. A rationale file per game (what differs) written by the builder into 193.
4. After the owner reviews, Phase B engine items one by one with owner OK.
5. Tambola 1.6.8 release (after the live-game window) is separate and first; the new flow is merged later behind the switch.
