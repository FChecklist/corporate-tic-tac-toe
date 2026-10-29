# SPEC: New organizer / Host / Co-host console, merged on top of release 1.6.0 (boss, 29 Oct 2026 night)
Status: OWNER APPROVED DESIGN; BUILD IS LOCAL ONLY (branch wip/new-flow-2026-10-29 in wt-newflow, per game). Visual truth: handover\2026-10-27\mock-5step\index.html (organizer; ?role=host; ?role=cohost) and host.html (Host/Co-host sign-in). Owner words with dates: 180-*.md. What and why: 190-*.md. Language rules: 191-*.md. Build plan: 192-*.md. THIS FILE IS THE SINGLE MERGED RULE BOOK; if files disagree, this file wins.

## 0. Ground rules
1. New flow is a NEW OPTION behind a switch (?flow=new). The current /zc console, current games, links and tests stay unchanged.
2. Everything from 1.4.x to 1.6.x keeps working (section 12).
3. Local first. Nothing is pushed or deployed before the owner says.
4. Sonnet 5.5 LOW for all sessions; boss medium.
5. Every rule below gets a falsified test (break it, see red, restore).

## 1. Language (see 191)
"The system", never "we". Never "invite" or "private" (say close group). "Participants". "In any location". ₹ not Rs. Speak TO the HR organizer and reassure first. Tags: (Popular) before (Recommended). Claims must be TRUE in code.

## 2. Frame on every screen
- Green strip: "No personal details needed. All participant information is deleted within 24 hours of the game."
- Game ID bar: Game ID (unique for ever, created at first save, never reused) + status pill. No copy button on the ID.
- Step bar: five steps + a separate "Game dashboard" button (locked with a padlock until published; the mock allows free movement, the real build enforces the rules).
- Choosing an option never jumps to the top: the page glides to the next section to fill. Only a step change goes to the top.

## 3. Step 1 "When are you planning this online team engagement activity?"
Occasion chips + Other (60 chars). Day and date chips (Today, Thu 29 Oct ...) + Other date picker (shows "Fri 30 Oct 2026"). Time chips + Other time. TIME ZONE: IST default, Dubai, Singapore, UK, Europe, US East, US West, Australia, Other (full list); shows what time it is for people elsewhere; passed times disabled in the chosen zone. Unpaid game up to 30 days ahead, paid up to 365 days (existing).

## 4. Step 2 "Who are you creating this game for?"
Cards: (1) Your people: staff, associates, contract staff and everyone who works with you, in any location. (2) Your people and their families: in any location; everyone gets 1 own + 4 family tickets (fixed, no choice); EVERY TICKET HOLDER = ONE participant for size and price. (3) Extended family: your people, vendors, customers and friends of the company, wherever they are, whichever location; people in the game can bring a few more (4 each).
Size = drop-down of REAL pack sizes (cards 1 and 3: up to 10 demo / 100 / 250 / 500 / 1,000 / 2,500 / 5,000 / 10,000, default 250; card 2 counted in employees x5), price shown, "Pick the closest".
HOW to validate (exact button words): "System validates for you" (Recommended for cards 1-2) / "You validate yourself" (Recommended for card 3).
- System validates: criteria "Employee ID" or "Email ID" (one only), helper "Choose which one you want."; green box "No personal details (name, mobile) are taken from you. Only the [email IDs / employee IDs] you add are allowed to participate. The system sends no email to your participants. You share the game link yourself. All participant information is deleted within 24 hours of the game ending."; paste box ("Copy and paste the employee [email] IDs here, one on each line" + Excel tip) OR upload a file + "Download the file format". List check is OPTIONAL: on Next the system silently keeps valid unique rows (repeated/wrong rows left out, shown in the read-back); optional viewer for 600+ rows (search, show only problems, 50 per page, Remove them now, Done). Someone not on the list waits to be let in.
- You validate yourself: no list; everyone waits; organizer/Host/Co-host lets in. The invite chain exists only here.
Ticket number is sacred: unique, never changes, never reused, every log keyed by it; reissue = new link for the same ticket; cancel retires the number. Name is optional on the ticket (editable until the first number is called). First mobile at game time keeps the ticket; wrong tries limited per mobile and per row.

## 4b. Step 3 "Tickets and prizes"
- Tickets per player: 1 or 2.
- Prizes listed directly with tick boxes and tags. "This prize can be won 1 to 5 times". "The prize" drop-down (Decide later default, Gift voucher, Hamper, Phone, Watch, Earbuds, Tablet or laptop, Holiday, Dinner, Movie tickets, Extra day off, Other (write it); NEVER cash). "Worth up to (optional)" with currency (₹ default; a currency chosen on one prize becomes the default for the others until changed).
- Recommended list: Early Five (Popular, Recommended), Top, Middle, Bottom Line, Four Corners (Popular), 1st to 5th Full House (1st and 2nd Popular), LUCKY DRAW (Recommended), UNLUCKY (Recommended). "More prizes": Early Seven/Ten, Two Lines, Star, Plus, Frame, Top and Bottom, Middle and Corners, Odd/Even/Low/High Five. Pre-ticked: Early Five, the 3 lines, 1st and 2nd Full House.
- 2-ticket game: pictures of Ticket A and B; "Each ticket plays on its own. For every prize you can choose a separate prize for Ticket A and for Ticket B..."; per prize two checkboxes "Prize for Ticket A / Prize for Ticket B" each with its own prize and worth; "Prizes for both tickets together" = Super Bumper House 1 to 10 (1 ticked; 6 to 10 folded).
- LUCKY DRAW (new rule): the organizer chooses 1, 2 or 3 lucky draws, each with its own prize and value. Timing: 1 draw = at the end; 2 draws = one in the middle, one at the end; 3 draws = at 1/3, at 2/3 and at the end of the game. The LOWEST-value lucky draw is drawn FIRST and the HIGHEST-value LAST (the system orders by the values entered; equal or blank values keep the entered order). Organizer, Host and Co-host are never drawn. Labels Lucky Draw 1/2/3.

## 5. Step 4 "Brand & Breaks" (optional)
Company name; optional logo (made small automatically, existing 30 KB rule); message breaks: 1-ticket game max 3, 2-ticket game max 5; each break = one public https link (YouTube best); "If a link is missing or not available, that message will not play."; inline check "Looks good" or "The link must start with https:// and be public...".

## 6. Step 5 "Check and publish" (last step)
- Publish WARNING: start within 30 minutes = amber "Your game starts in N minutes. Publish and pay now, so it can start on time."; time passed = red "The start time has passed. Change the date and time before you publish."
- Read-back with Change buttons (when, who, your people count and how many repeated or wrong rows were left out, size, tickets and prizes, brand).
- "What your participants will see": Mobile view (phone frame) and Laptop view (browser window) with company name/logo, Game ID, last number, the ticket(s), "Your name (optional)", ticked prizes with Claim, the retro board on laptop; build from the REAL player components.
- Add Hosts and Co-hosts: Host email IDs (max 5; "right hand on game day, can make any change like the organizer, helps run the game and let people in") and Co-host email IDs (unlimited; "helps bring people to the game, e.g. one per team or location; cannot make any change"). ONE same game link for everyone; a Host/Co-host opens it, types their email, gets a 6-digit passcode by email (10 minutes, 5 wrong tries, "Send a new passcode"), enters it; not on the list = plain message.
- REHEARSALS at the END of step 5: "Practice before the real game", cards REHEARSAL GAME 1 to 3 showing "Opens after you publish and pay".
- Publish button.

## 7. Game dashboard (not a step), order
1. "Share this game link with your participants." Game ID + game link + Copy game link + Copy a message to share + Share on WhatsApp; "Hosts and Co-hosts use this same link."
2. Status banner (section 8).
3. READY CHECK (link shared, payment, prizes chosen; optional: Hosts added, rehearsal done).
4. PAYMENT with a pill Pending / Done / Free: Pay now + Copy payment link; small print: "The payment is small, so many organizers pay it themselves and claim (reimburse) it back (recommended). You can also copy the payment link and share it with the person who will pay. The payment link works for 7 days."
5. REHEARSALS (after payment): three cards locked until paid; clicking before payment says "Payment is pending. Your rehearsals open as soon as the payment is done." with Pay now; after payment the sequence is enforced, each has its own link and Game ID <real>-R1..R3 labelled REHEARSAL GAME n, "Close rehearsal" when done, the 20-person limit never shown, rehearsal e-mails only to organizer/Hosts with subject "REHEARSAL GAME n (practice only)".
6. WAITING FOR YOU TO LET THEM IN THE GAME: table Ticket number + optional Name, Employee ID, Email ID, Mobile, Referred by (email whose link was used); Let in / Not now (a Not now list keeps Let in for any time; colours amber / grey / green); Let everyone in.
7. Tickets claimed + Online now.
8. GAME BOARD and prizes won/left (section 9).
9. What is happening (live feed).
10. Report reminder.
Co-host page: share card, waiting table, tickets claimed, board and prizes read-only; NO steps, payment, cancel or controls.

## 8. Game ID and statuses
Draft | Published, payment pending | Published and paid | Published, free game | Payment pending, start time passed (red: Pay now / Change date and time / Cancel) | Live now | Paused | Completed | Cancelled | Cancelled, refund requested | Data deleted.
- UNPAID: "Published, payment is pending. Don't worry. The game will not start until the payment is done, and you can cancel it at any time."
- PAID: "Congratulations, your game is on! It will begin at <day, time, zone>. Don't worry if you want to postpone or change anything: you can do it up to 5 minutes before the game begins."
- COMPLETED: "Thank you for playing! The report was also sent to your email. Download it within 24 hours." + Make a copy + "Delete all participant data" (GREY and disabled until 24 hours after the game, then GREEN).

## 9. Game board (retro Housie)
- Title "★ HOUSIE ★ CORPORATE TAMBOLA", small line "close group online corporate housie", gold ball with the last number and "N of 90 numbers called", 90 round discs (called = red), Game ID at the foot.
- AUTO: pace 12 seconds (new games 12 s only). The timer shows top right on the "Last number called" line AND on the bottom row next to Pause / Big screen.
- MANUAL: the button "Press to Roll Out the Next Number" in both places: GREEN when ready; after a press BOTH turn GREY with a visible countdown (5, 4, 3, 2, 1, 0 seconds) and turn GREEN again at 0. Minimum 5 seconds between two manual rolls, enforced on the SERVER (a second press inside 5 s counts as one, also across Hosts).
- PAUSE game / Resume in both modes and all games. Co-host sees the board but no buttons.
- CLAIMS: when a ticket claims a prize, the BOARD and the organizer/Host/Co-host consoles show "Ticket N has claimed <PRIZE>. The system is checking...", then "Congratulations! The claim is correct.", then "<PRIZE> is gone. It has been won by Ticket N." DURING THE CLAIM the game is AUTO-PAUSED; when the claim is settled AUTO RESUMES by itself (timer back to 12). In MANUAL mode, after the claim the board says "Press the button to roll out the next number." and the roll button is disabled ("Claim in progress") while a claim is open. The existing claim rule (refused after the next number is announced, server clock), gold claim buttons, claim pop-ups and "Prize already taken" all stay.
- "Prizes: X won, Y left": each ticked prize with status (Won by Ticket N / n of m won / Not won yet), the gift, a "Prize handed over" tick, and for each winning ticket every detail held (Name, Employee ID, Email ID, Mobile, Referred by; only those that exist). Visible to Organizer, Host, Co-host only, never to players.

## 10. Data and retention (owner ruling 29 Oct, resolves the conflict)
- DELETED within 24 hours of the game: ALL PERSONAL INFORMATION of participants (the list of email IDs/employee IDs, names, mobiles, referred-by, anything typed).
- KEPT 365 days: the game log (by ticket number only) and the records of the organizer, winners, Host and Co-host.
- TO CONFIRM with the owner: winners' record = ticket number, prize and time (personal details gone after 24 h); organizer/Host/Co-host record = their email and role. Invoices and payment ledgers stay as per the 14 Oct retention decision.
- The green strip and every privacy text must say exactly this. Remove Bingo B26's extra 365-day log if it duplicates the game log.

## 11. Engine/server work needed (Phase B; new option only; owner OK per item)
List matching + general-link claim + first-mobile marking + wrong-try limits + per-row lock; Host/Co-host 6-digit passcode by email; per-ticket A/B prizes; Super Bumper House 1-10 as winner ordinals; Lucky Draw 1-3 scheduled at 1/3, 2/3 and the end and value-ordered; time zone stored with the game; 24-hour auto-delete of personal data and the delete button unlocking after 24 h; size from the list; message-break links (3 / 5); claim auto-pause and auto-resume; manual 5-second server lock; rehearsal Game IDs <real>-R1..R3 (exist in 1.6.0).

## 12. Keep from 1.4.x-1.6.x (do not hide or break)
Claim rule and pop-ups; gold claim buttons and timer; "Prize already taken"; manual play with no fixed gap (now minimum 5 s); 12 s only; the game log; Do Not Disturb tip and away line on the phone; Reconnecting banner; message dictionary and guided errors; branded report e-mail/PDF with customer logo and colour; language button (English only); presence count; three free rehearsals with the exact REHEARSAL wording; cancel with three confirmations and refund request; copy game.
