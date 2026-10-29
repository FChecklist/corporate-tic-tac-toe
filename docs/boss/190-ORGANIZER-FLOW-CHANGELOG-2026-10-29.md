# New organizer console flow: what changed and why (boss, 29 Oct 2026). Mock: handover/2026-10-27/mock-5step/index.html (run: python3 -m http.server in that folder). Source of every wording: 180-society-rwa-tambola-idea-2026-10-29.md (owner words, dated).

## Why we changed it
Owner and HR feedback: the organizer is usually an HR person, is afraid to give details, and must never be confused. Sneha (second game): published 9 minutes after the start, nobody reminded her, claims felt weak. So: fewer steps, plain words, one clear status, no personal data.

## Structure: ten steps -> FIVE steps + a GAME DASHBOARD (not a step)
| New | Old (live /zc ten steps) | Why |
|---|---|---|
| 1 Date and time | 1 | Added Other for occasion, day+date, time, TIME ZONE (IST default, popular zones, Other) and what time it is for people elsewhere; passed times disabled in the chosen zone. Why: online game, people in any location. |
| 2 Who is this game for | 2 Number of participants + 6 Invite and share | Three cards: Your people / Your people and their families / Extended family. Then ONE question "System validates for you" or "You validate yourself". Size = a drop-down of real pack sizes, pre-selected, price shown. Why: organizer decides WHO, system decides the rest. |
| 3 Tickets and prizes | 3 Set Prizes | No Classic/Simple/Rich cards: prizes listed directly with tick boxes, tags (Popular)(Recommended), "This prize can be won 1-5 times", "The prize" drop-down (no cash) + Other (write it), "Worth up to (optional)" with a currency that carries over (default ₹), Full House 1st-5th, 1 or 2 tickets per player; 2-ticket: Ticket A / Ticket B prizes and Super Bumper House 1-10. Why: nothing to learn, everything visible. |
| 4 Brand & Breaks (optional) | 4 Your brand | Company name, optional logo, message breaks (1-ticket game max 3, 2-ticket max 5), each break = one public link (YouTube best). Why: simple and explained. |
| 5 Check and publish | 5 Hosts + 7 Check and publish | Host/Co-host email IDs added here (Host max 5 with any change rights; Co-host unlimited, cannot change the game), ONE same link for everyone, each opens it, types email, 6-digit passcode by email, becomes Host/Co-host. |
| Game dashboard (button, locked until published) | 8 Pay, 9 Game day, 10 After the game | ONE status banner: unpaid "Published, payment is pending. Don't worry. The game will not start until the payment is done, and you can cancel it at any time." / paid "Congratulations, your game is on! It will begin at ... you can postpone or change up to 5 minutes before the game begins." Payment section (Pay now or Copy payment link), game link + message, Waiting for you (Let in / Not now / Let everyone in), Tickets claimed, Game board, 24-hour report reminder. Why: Sneha lesson, never confused. |

## Validation (step 2)
"System validates for you": organizer pastes (or uploads CSV) employee IDs OR email IDs (one criterion, chosen), sends ONE game link from own mail; person types their ID/email; system matches and gives their tickets; people not on the list wait to be let in. List check is OPTIONAL (silent clean: repeated/wrong rows left out, count shown); viewer for 600+ rows has search, problems-only, 50 per page. "You validate yourself": no list; everyone waits; organizer/Host lets in. Defaults: system for Cards 1-2, you for Card 3. Family card: every person = 1 + 4 tickets, each ticket = one participant (size and price). Ticket number is sacred (never changes, never reused, all logs by ticket number); name optional on the ticket (editable until first number is called).

## Privacy promises (must stay TRUE in code)
Top strip: "No personal details needed. All game and participant information is deleted within 24 hours of the game." Green box: "No personal details (name, mobile) are taken from you. Only the email IDs/employee IDs you add are allowed to participate. The system sends no email to your participants. You share the game link yourself. All information is deleted within 24 hours of the game ending." Exception: the system emails a 6-digit passcode to Host/Co-host emails only. Invoices/payment records are kept (retention rule) and are outside the promise.

## What needs ENGINE / SERVER work (not just screens), each needs owner OK because "do not change the current game"
1 List matching + general link claim + first-mobile marking + wrong-try limits. 2 Host/Co-host passcode login (6 digits by email). 3 Per-ticket (A/B) prizes. 4 Ten Super Bumper House rows (ordinals). 5 Time zone stored with the game. 6 Auto-delete of lists 24 h after game end. 7 Size from list. 8 Message breaks as links (max 3/5). Existing games keep working unchanged: new flow is a new option for new games.

## Open items for owner
Exact Host/Co-host rights (Co-host cannot change the game), "Most organizers pick this" claim only with real data, Popular/Recommended tags are boss picks, family tickets 1+4 fixed, ₹ everywhere.
