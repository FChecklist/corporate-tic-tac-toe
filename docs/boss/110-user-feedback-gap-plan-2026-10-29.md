# 110 - What real users would say about Corporate Games: gap plan (29 Oct 2026)

Written by the judge/planner pass. Read-only work: no repo file was edited, nothing run in a browser, nothing deployed. Evidence below is as reported by the seven reviewers (file:line in each repo) plus the digest. I personally re-checked only one item: the Tambola "Present: undefined of undefined" bug (TA01) - `worker.ts:1642` answers `GET /presence` first with the "phones listening" data, so the check-in handler at `worker.ts:2073` never runs, and `zc.js:1132` prints `S.presence.present` / `.total`. Everything else is "as reported, not re-verified". Effort: S = under half a day, M = 1 to 2 days, L = 3 days or more.

## 1. Summary (5 lines)

1. Sneha's real words are barely recorded; the hard evidence is her second game (23 claims, only 9 awards, 14 "Prize already taken", 0 wrong claims, four prizes blank, published 9 minutes after the start). Most of what she hit is fixed and live in Tambola 1.6.7; claims, pace after Resume, blank prizes and "nobody reminded me" are not fully closed. First action: ask Sneha what in claims still felt weak (item A below).
2. 217 findings kept from 240 predictions (23 parked, merged or dropped, listed in section 6). 5 blockers: master console hand-over does not work yet (MC-01), Luck by Chance press button is cosmetic (LB-01), Luck and Tic Tac Toe are live in TEST mode so a stranger never gets a sign-in code (LB-02, TT-01), Snakes and Ladders default join sends every employee to a waiting room (SL-03).
3. Tambola (P1) is the safest to fix first: one visible bug (TA01), claim/late-press explanation, report rule text that contradicts the console, check-in not explained, control key lives in one browser, no draft or non-joiner reminder.
4. The other four games have almost none of the Tambola claim, timer, wording, log or rehearsal work; the master console and per-game consoles are built on paper but the game-side console pages (spec 100 wave 2) do not exist, so Create/Open/Pay end in the wrong place.
5. 19 work packages follow in owner-priority order (section 8); 8 owner questions (section 9) unblock the rulings that keep recurring (stop at last prize, full 12 s after Resume, last-number claims, Luck press rule, check-in, data retention, go-live of the TEST-mode games, price/GST honesty).

## 2. Sneha feedback and what we changed (status as of 29 Oct)

Status words: fixed-live, partly, open, fixed-not-live. "A" = ask Sneha: her specific words were never recorded.

| Id | What she / owner for her said | Category | What we changed | Status |
|---|---|---|---|---|
| S01 | Could not get past step 4 of the console (logo file redrew the form and killed Save; logo without name refused) | organizer set-up | 1.1.5/1.1.6, 26 Oct | fixed-live |
| S02 | Rs 0 / 250 link kept showing the payment screen; how can 100 become 250 by a link | payment | 1.3.5-1.3.8, clone action b894638 in 1.4.3, cap raise refused 402 | fixed-live |
| S03 | Numbers every 9 s felt too fast | timer | 12 s only for self-calling games (1.4.3), manual has no fixed gap (1.4.4) | fixed-live |
| S04 | Felt numbers were skipped (log shows all 90 at exactly 9 s) | trust / proof | counter "31 of 90 called", last 5, proof lines (organizer only). Players get no "numbers are public" line | partly |
| S05 | Said game closed before 90 numbers (log shows all 90) | status / ending | 1.4.1 plain ending sentences, keep-calling default, 1.4.4 duplicate banners removed. No ruling on one default | partly |
| S06 | After pause, number 36 came ~6 s after Resume, not a full gap | timer | none (Option C chosen, no release) | open |
| S07 | Start 10:30 but number 1 at 10:32, unexplained | wording / timer | console help says "2 minutes later"; board says "first number is coming". Not on her PDF | partly |
| S08 | Organizer could not find the number board | console steps | 1.4.1 big Number board button + "N of 90 called" strip | fixed-live |
| S09 | Was the game really started or were people waiting? | status | 1.4.3 one story sentence on every screen; console can say "game is on" from the clock before numbers are seen | partly |
| S10 | Claims confusing: 471 events, 146 denied, only 8 real claims, 5 prizes | claims | 1.4.3 alert, big Claim button, strict window; 1.5.0 gold buttons and claim timer | partly |
| S11 | Wants data, link and PDF e-mailed, then deleted, then a second e-mail | reports / e-mails | report e-mail with link; branded 1.6.1/1.6.3. No PDF attached (built in browser). Erasure not gated on report (not re-verified) | partly |
| S12 | Three short rules under the ticket (works like the real one, tap number to cross out, press Claim before next number) | wording | 1.4.3 | fixed-live |
| S13 | Replacement free game for 28 Oct 10:30, same prizes, 6 people | payment / invites | clone made 27 Oct, 24 read-back checks, she published and played | fixed-live |
| S14 | Published 10:39:38 for a 10:30 start; game began 10:40 | organizer set-up | nothing in code; an unpublished draft gets no reminder | open |
| S15 | Four prizes had no text (copied blank from game 1) | content blank | 1.5.0 Publish warning (does not block; clone still copies blanks) | partly |
| S16 | "UX better, smoother, claims better but can be improved" (which claim point is not recorded) | claims | 1.5.0-1.5.2. Not re-tested with her | A |
| S17 | 23 claims, 9 awards + Unlucky; 14 "Prize already taken", up to 11 numbers late; 0 wrong | claims | fast notice under 3 s, "Won by Ticket N" panel, report explains. Effect on real players not measured | partly |
| S18 | 5 of 6 invitees joined; sixth never did | invites | none, no reminder to non-joiners | open |
| S19 | Report promised ~3 min; actual 5 min sent, 13 min delivered; guest data deleted ~20 h | reports | working; tick-schedule limit | partly |
| S20 | Numbers 72 and 88 came 6.7 s and 10.9 s late (public beacon late) | speed | relay and mirror hedge since 1.2.0; cause external | open |
| S21 | Sign-in and Publish worked, free pack attached, mail delivered | sign-in | rehearsal 4.8; 5 codes/hour/e-mail remains | fixed-live |
| S22 | Report must be generated by the product in her model | reports | 1.6.1 branded e-mail and PDF; 1.6.3 logo | fixed-live |

Other user signals (condensed; full detail in the digest): O01 prospect "AI testing is not perfect" (partly: click-only live checks since 1.4.3); O02 quiet timer + stop at last prize (partly: quiet timer done, stop-vs-keep never ruled); O03 manual gap (fixed); O04 300-person Teams worry (fixed: live 100/250/500 games); O05 no 6-digit code, mail 500 (fixed: paid plan, not pinned by a test); O06 "never say ready without proof" (partly); O07 make 10 steps idiot-proof (partly; 3,933-scenario matrix not re-run since 1.2.1); O08 proof numbers are real (partly); O09 collect feedback after every game (rule written); O10 plain wording (partly: "engagement" still in z.js:187); O11 pop-ups reach everybody (fixed-live); O12 uniform navigation (built, not rolled out); A07 stop-vs-keep (open, owner); A09 full 12 s after Resume (open); A10 control delay by game size (partly); A13 winners at end and "Change winner" in log/report (not verified); A14 join form /who not wired (partly); A15 five player-page defects (open); A18 locked phone loses a claim (open by design); A20 board Pause above 2,000 (open: board.js:173); A22 game log save/caps (open: lifecycle.ts:196/238, worker.ts:102, gamelog.ts:52); A24 console 641-860 px (open, unverified); A25 reliability B1-B8 (unknown); A26 click-only tests per game (Tambola only); A27 other games copy Tambola (open); T01 last-number claims write no winner row (open); T02 sign-in/role wording (open); G01/G02 other games and bar rollout (open); X01 domain move side-effects (partly).

## 3. Patterns (what real users keep running into)

1. Claims and "act in a window": 14 of 23 claims were too late; fast notice exists, the phone's own "lost" text still blends two causes. Bingo has no claim; Luck's press is cosmetic.
2. Pace and time perception: 9 s too fast, 2-minute lead unexplained, 6 s after Resume, late beacon, Pause takes 40 s to reach phones, no game length shown (Snakes, Luck, TTT).
3. "What is happening now": unpaid, unstarted, manual-start games all look the same to a waiting player ("Waiting for the host").
4. Organizer set-up and gates: too many choices, step 4 logo, wrong sign-in e-mail, 5 codes/hour, publishing late, nobody reminds a draft, blank prizes copied.
5. Content left blank or incomplete: prizes, unnamed winners, invitees who never joined.
6. Trust and proof: numbers are public, log cannot be edited, "nobody can change a winner" next to a Settle / Change winner button.
7. Plain wording for non-native readers: "engagement", "private", "closed-group", Tambola words in other games, "decided by fate", "fingerprint".
8. Reports, e-mails and data lifecycle: 3 min promised, 5-13 min real; no PDF attached; 19 h / 20 h / 22 h / 24 h in different places; winners' names erased before gifts are handed over.
9. Device reality: redraw eats taps, screen lock, calls, in-app browsers (Teams/Outlook/WhatsApp) look like a second phone, sound in an open office, landscape console.
10. Scale: one office address, join storms, control delay grows with size, polling load (Luck 2 requests per phone per 0.9 s).
11. Testing honesty: "ready" before observed proof; Bingo, TTT, Snakes, Luck have no 10-player real-browser run with the result re-read from the database.
12. Money and vendor trust: fake-looking permanent "50% off", test-pay link in footers, one-person vendor, no GST, no quote/PO/vendor pack, pay link dies in 7 days, finance cannot get a link from the console.
13. Operations touching users: domain move, 4 h CDN cache, deploying during a live game, TEST mode left on, billing.
14. The same owner rulings recur: stop-at-last-prize vs keep-calling, full 12 s after Resume, equal-split meaning. One ruling must be recorded and copied to all games.

## 4. All kept findings, per product

Legend. Persona: Org = first-time HR organizer, Rep = repeat customer, Host = Host/Co-host, Emp = employee on a phone, Mgr = department manager with ~200 people, Fin = finance approver, IT = sceptical IT person. Severity: B blocker, M major, m minor, p polish. Parity = Sneha-class fix already in Tambola 1.6.7: missing / partial / n/a. Paths are relative to each repo (tambola = `C:\ct\test-sites\tambola`, console worktree = `console\.claude\worktrees\master-console-complete-882589`). "WP" = work package in section 8. Tambola ids were T01-T32 in the review; renamed TA to avoid clashing with Tic Tac Toe T-ids (TT).

### 4.1 Corporate Tambola (P1) - live 1.6.7 e6759a0

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| TA01 | Org/Host | "Game day card says Present: undefined of undefined; is it broken?" | M | zc.js:1132; worker.ts:1642 beats 2073 (re-checked by judge); checkin.ts:115-118 | Give the two routes different paths; show "Checked in 143 of 200"; add route test | S | missing | 01 |
| TA02 | Emp | "I must confirm name, number and type a code you already show me; nobody told me" | M | checkin.ts:13; z.js:891-912; no mention in index/guide/brochure/pricing; index.html:118 "no SMS or OTP" | One tap "I am here" with name read-only; disclose on landing, guide, invite text; option per game | M | partial | 04 |
| TA03 | Org | "Step 2 asks too much; I have 30 minutes" | M | zc.js:434-457, 450 (6 audience options) | Quick start (date, time, size, prize bundle) then Publish; rest under "More options" | M | partial | 04 |
| TA04 | Org/Host | "Pause key was on my office laptop; could not stop numbers from home" | M | control-browser.ts:65-68; phone-runtime.test.ts:303; zc.js:1113-1128 | Re-register key from signed-in second device (e-mail code); warn at Publish | M | missing | 04 |
| TA05 | Mgr | "Site says paste numbers; no paste box; Excel refused" | M | index.html how-it-works; zc.js:779-790, 788, 2311 | Show Paste chip first; accept .xlsx | S | missing | 04 |
| TA06 | Emp | "Opened in Teams, jumped to Chrome, 'one phone one ticket'" | M | z.js:178-190; worker.ts:1824 | Full-screen "Open in Chrome/Safari" step; returning number reclaims ticket | M | partial | 03 |
| TA07 | Emp/Mgr | "'This engagement is full' - who do I tell? Wife and I share a phone" | M | worker.ts:1778, 1824; zc.js:442 | Say "game", name organizer, warn organizer at 90 percent | S | partial | 01 |
| TA08 | Emp | "Screen went dark in the break, missed numbers" | M | z.js:954 lock released on pause; z.js:897 no lock in check-in wait; digest A15/A18 | Hold wake lock from check-in to end incl. pause; "keep screen on" line | S | missing | 03 |
| TA09 | Host | "Pressed Pause, 3 numbers still came; after Resume first number was early" | M | zc.js:1027, 1102, 1106, 1134 | Live "Pause confirmed on N percent of phones"; full gap after Resume (needs ruling) | M | missing | 02 |
| TA10 | Emp | "Claim lost - was I late or was someone first?" | M | z.js:802 merges two causes; clear text only in lifecycle.ts:325, report-layout.ts:129 | Show "Ticket 7 won Top Line at 65; your claim arrived at 67" on phone | S | partial | 01 |
| TA11 | Emp | "How do I know numbers are random and same for everyone?" | M | z.js has no public-source line; zc.js:1056/1063 organizer only | One line + last-5 strip + "How we keep it fair" page | S | missing | 03 |
| TA12 | Org | "Published with 4 prizes blank; copy kept the blanks" | M | zc.js:899, 405, 574, 996 | Block Publish until each prize has text or "No prize"; flag inherited blanks in clone | S | partial | 04 |
| TA13 | Org | "Forgot Publish; nobody reminded me" | M | worker.ts:509-515 only for published unpaid games; S14 | Mail + console banner at 24 h and 2 h before start if draft | S | missing | 04 |
| TA14 | Org/Mgr | "30 never joined; I had to click each WhatsApp" | m | zc.js:764; S18 | "Not joined yet (N)" with copy reminder text and CSV | M | missing | 04 |
| TA15 | Fin | "Forwarded Pay now says 'Please sign in first'; link ran out" | M | worker.ts:514-515; pay.js:31; paylink.js:29; worker.ts:1676 | "Copy finance link" in reminder; link valid until start; game name and amount in subject | S | missing | 06 |
| TA16 | Fin | "No PAN, GST letter, vendor form, PO route; no refund if cancelled" | M | pricing.html; common.js:167-170; refund-policy.html section 3/6 | One-page vendor pack; PO number box; state credit rule beside price | M | n/a | 06 |
| TA17 | Fin/IT | "Strike-through price and 'Test a payment (Rs 1)', 'Sales login' look invented" | m | site.js:35; index.html:165, 70; pricing.html:57 | One honest price or dated offer; remove footer links; Lucky Draw "Coming soon" | S | n/a | 06 |
| TA19 | Org/Rep | "Report says ties share the prize; game gave next prizes in order" | M | report-email.ts:55/74; report-layout.ts:103; gamelog.js:60 vs zc.js:481 | Generate rule line from the game's ties setting; test both | S | partial | 01 |
| TA20 | Org | "PDF is built in my browser; names deleted at 20 h; I was on leave" | M | report-email.ts; lifecycle.ts:418, 345-353; S19 | Do not erase until report opened or 72 h (owner/legal); say real timing | M | partial | 05 |
| TA21 | Emp | "Phone talked in the open office; voice clip 404" | m | z.js:81; audio.js; /audio/v1-en-in-f/01.m4a 404 live | Ask voice on/off, Off in office mode; record clips or drop "clear voice" | S | partial | 01 |
| TA22 | Emp | "Joined late, waited 90 s, nobody said before I joined" | m | z.js:524-527; report-layout.ts:96 | Say on the join page the game is running and what is still open | S | partial | 01 |
| TA23 | IT | "Which domains to allow? No questionnaire, no notice period" | M | subprocessors.html; dpa.html; trust.html dated 2026-10-07 | "For IT" page: domains, what phone contacts, region, breach hours; re-date trust page | M | n/a | 06 |
| TA25 | Host | "Host link works once; refusal screens confusing" | m | zc.js:1554-1559, 1451, 1454, 1694; mails.ts:107 | Reusable 24 h link; name the game; refusal shows signed-in e-mail | S | missing | 04 |
| TA26 | Host | "Pressed Next number; nothing for seconds" | m | zc.js:1089, 1102 | Show number on Host console when known + "about to arrive" | S | partial | 01 |
| TA27 | Emp/Org | "It says 'engagement' 18 times; I wanted a game" | m | index.html:61-62, 92; z.js:187; worker.ts:1676 | Replace with "game"; test that fails if word returns | S | partial | 15 |
| TA29 | Org/Emp | "3 people claimed on 90 and nobody won" | M | digest T01 (1.4.4 rehearsal); not re-verified on 1.6.7 | Owner rule; committed test that last-number claim writes a winner row | M | missing | 02 |
| TA30 | Host | "Console squeezed on tablet" | m | zc.css breakpoints 640/520/420 only (not verified in browser) | Collapse side panel under 900 px; layout test at 768/812 | S | missing | 04 |
| TA32 | Emp | "After I won it showed 'Earn 50 percent' and 'Refer and earn'" | m | z.js:452-456 | Remove from player screens; organizer switch for share buttons | S | n/a | 01 |

### 4.2 Master console (P2) - worktree HEAD c50a117, nothing deployed

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| MC-01 | Org | "Start took me to a page that did not show my new game" | B | core/api.js:119-126; bridge.ts:229; bingo-console zc.js no `_new_`/`new=1`/`to=` (0 hits); STATE.md item 4 | Each game page reads `e=_new_` and `to=`; one real-browser hand-over test per game; tile "Coming soon" until it passes | M | missing | 08 |
| MC-02 | Org | "Tapped Send twice, first code dead" | M | screens/signin.js:17, 26-35; auth-core.ts:126, 23 | Disable button, Send again after 30 s, "use newest e-mail", show minutes left | S | missing | 07 |
| MC-03 | Org | "Typed wrong e-mail; no Back, no Resend; link page dead end" | M | signin.js:19-24, 33; auth-core.ts:104; signin.html:15-19 | Add Change e-mail, Send new code, Back to sign in | S | missing | 07 |
| MC-04 | Org/Rep | "Right code, then silence for seconds" | M | signin.js:36-41; boot.js:58-63; api.js:7, 56-72 | Go Home at once; connect in background | S | partial | 07 |
| MC-05 | Org/Host | "'Could not open that game' - works on second try" | M | boot.js:82; session.js:1, 8-10; bridge.ts:13; api.js:111-112; ui.js:45-46 | handoff() reconnects that game once; separate text for no key / slow / off | S | partial | 07 |
| MC-06 | Host/Org | "My games says 'No games yet' but I have four" | M | mygames.js:56-58; api.js:77; errors.js:2-4; en.json:26, 29 | If all failed show "Could not reach your games" + Try again; signed out goes to sign-in | S | missing | 07 |
| MC-07 | Mgr | "6 s wait though 3 games answered at once" | m | mygames.js:61, home.js:31, billing.js:18; api.js:74-75 | Draw each game as it answers | S | partial | 07 |
| MC-08 | Org | "Every page says other games are slow, forever; Create says could not open" | M | bridge.ts:3; api.js:87; purge.ts:38; games.json ready:true x5; create.js:44-45 | Treat 404 as "not on console yet"; "Coming soon" tile from capabilities | S | missing | 07 |
| MC-09 | IT | "Close my account never finishes" | M | api.js:155-158; purge.ts:38; Luck has no bridge | Treat 404 like cron; finish slow games in background (up to 7 days); test with a dark game | S | missing | 07 |
| MC-10 | IT/Fin | "What does closing delete? My credit? My games?" | M | account.js:6 CLOSE_WORDS | List per game what happens; warn on paid future game or credit; download first | M | partial | 09 |
| MC-11 | Org/Fin | "Pay opened step 1 of ten, not payment" | M | billing.js:26, home.js:48; bridge.ts:215-217, 229 | Add `to=pay` / `to=publish` target | S | missing | 08 |
| MC-12 | Fin | "No link for my finance team" | M | billing.js:26, home.js:48; schemas.json paidBy | "Copy link for finance" + "Paid by" on Paid rows | M | partial | 09 |
| MC-13 | Fin | "From Rs 2,399 for what? Who is the seller? GST?" | M | prices.js:10-16; billing.js:7-8 | "for up to 100 people, one game"; Tax sentence; quotation; owner/CA on GST | M | missing | 09 |
| MC-14 | Org/Fin | "Credit shown but how do I use it?" | m | billing.js:41-43; merge.js:30 | One sentence + Use it button | S | missing | 09 |
| MC-15 | Fin | "Invoice opens another site; need one place" | m | billing.js:36 (not verified how GET is authorised) | Show invoice number; test in fresh browser; CSV export | M | partial | 09 |
| MC-16 | Org | "Game starts in 20 min and I forgot to publish; nobody told me" | M | merge.js:4; schemas.json nextAction; spec M2; S14 | Attention strip: draft starts soon, not paid, N waiting | M | missing | 08 |
| MC-17 | Host | "Invitation not shown; empty state says Create your first game" | M | mygames.js:58; bridge.ts:103, 154-157; home.js:47 | "Waiting for an invitation? you are signed in as X" help | S | missing | 07 |
| MC-18 | Host | "Why does it ask me to Pay? I am only a helper" | m | home.js:48; billing.js:23; routes.js:2 | Pay only to organizer; Create/Billing under More for helpers | S | missing | 07 |
| MC-19 | Mgr | "Card says up to 250; how many joined? my limit?" | m | mygames.js:49; schemas.json GameRow | Add joined and yourLimit | S | missing | 09 |
| MC-20 | Rep | "Who won last month? Report link dead" | m | mygames.js:38-53 | Results and Game log links on finished cards | M | partial | 09 |
| MC-21 | Org | "Winner is 'seat 12'; names gone Monday" | M | runbar.js:55; spec 100 line 197 | "Save winners list now - names erased in 20 h"; winners-only retention (lawyer) | M | partial | 05 |
| MC-22 | Org | "'See what players see' says it cannot yet" | M | playerview.js:21, 18; MASTER_CONSOLE_OWNER_ADDITIONS.md A | Helper line + Retro/Modern; every game answers features.preview | M | missing | 08 |
| MC-23 | IT | "Top says 100 percent deletion; small print says 1 year; 24 h vs 20 h" | M | en.json:18-22; purge.ts:1-16; spec line 197; Tambola zc.js:262, 1197 | One table of what is kept and how long; exact promise | S | partial | 09 |
| MC-24 | IT | "No Privacy/DPA after sign-in; Google Fonts called" | M | boot.js:33; account.js; index.html:12-13; build.mjs:21-22; spec line 125 | Self-host fonts; Legal block with own Terms/Privacy/DPA | S | partial | 09 |
| MC-25 | IT | "demo1@xyz.in code 123456 got me into live Snakes" | M | spec 100 lines 115/145 (recon, not re-checked); auth-core.ts:123 | Gate test logins to TEST mode with falsified test | S | missing | 17 |
| MC-26 | Org | "Code mail was in Spam; subject '[Console]'" | M | auth-core.ts:129, 93; O05 | Subject with code; HTML version; SPF/DKIM/DMARC check; real test to Gmail/Outlook | S | partial | 07 |
| MC-27 | Org/Host | "5 of us signed in at once: 'wait an hour' 30 min before the event" | M | auth-core.ts:23-24, 122 | Raise per-address limit; count failures only; show minutes; contact | S | missing | 07 |
| MC-28 | Org | "Only an e-mail address for help; event is today" | M | en.json:30-33; boot.js:53; spec line 125 | Response promise, EVENT DAY subject, WhatsApp/phone once owner decides | S | partial | 09 |
| MC-29 | Org | "Can I try free first? Tiles differ" | M | spec M4 line 67; prices.js:13-14; games.json freeCap 5 vs 10 | Settle free size 10 for all; "Try a free game" opens Step 2 | M | partial | 08 |
| MC-30 | Org | "Three boxes; what first? how long?" | m | home.js:24-29; spec M2 | One calm first-game line with "keep ready" list | S | missing | 09 |
| MC-31 | Rep | "Copy opened the original game" | m | mygames.js:31, 44 | If no new id, show error and open nothing; one phrase "Make a copy" | S | missing | 09 |
| MC-32 | Mgr | "Everything in IST" | m | ui.js:16-23; billing.js:9 | Show viewer's own time too | S | missing | 09 |
| MC-33 | Org | "Tic-Tac-Toe vs Tic Tac Toe; tab says Console" | p | games.json:28 vs gamesbar.js:14, 16; index.html:6; gamesbar.js:67 | One spelling per game; per-screen tab title; roll canonical bar | S | missing | 19 |
| MC-34 | Org | "Lucky Draw tile 'Not ready yet' with link" | p | create.js:34-35; spec decision 7 | Greyed tile, no button | S | partial | 09 |
| MC-35 | Host | "Half my small phone is bars" | m | app.css:43-51; en.json:18-20 | One privacy phrase on phones; run 10-width sweep | S | partial | 09 |
| MC-36 | Rep | "Yesterday's fix is missing; half broken after refresh" | m | sw.js:4-26 fixed cache name; index.html:18 no ?v= | Build number in cache name and module URLs | S | partial | 18 |
| MC-37 | Owner | "It looked fine in your tests; on my phone a button did nothing" | M | docs/102 section 5 sweep NOT RUN; spec 100 line 184 | Run X2 (10 widths) + click-only walk with outcome re-read from DB | M | missing | 10 |

### 4.3 Corporate Bingo (P3) - live bd66d3c 1.3.2 (repo `bingo`)

Bingo has no claim step by design (phones work out winners). Site worktree `claude/site-bingo-98e3f9` (uncommitted, not live) may already fix wording and navigation items.

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| B01 | Org | "Why cards, mark, gap, join type? I am scared of choosing wrong" | M | zc.js:273-290, 1038; OPTIONS_TABLES.md:22-30 | Hide Cards/Mark/Gap/Rounds/guest-type for new games; old games keep values | M | partial | 12 |
| B02 | Emp/Mgr | "Numbers too fast; speed differs between games" | M | zc.js:182, 254, 209; worker.ts:695, 1335; index.html:120; RULES_bingo.md:19 | 12 s only for new games and clones; fix copy; quiet timer | S | missing | 12 |
| B03 | Org | "Home promises a free AI assistant; console has none" | M | index.html:57, 114, 137; site.js:33; zc.js:868; wrangler AI_LINK_MAIL_AT_SIGNUP=0 | Remove promise everywhere (or restore link); test that fails if page mentions it while console hides it | S | n/a | 12 |
| B04 | Emp/Mgr | "'Decided by fate' sounds like a lottery; site says ties share" | M | z.js:569, 599; big.js; BINGO_GAME.md:45-49; index.html:93 | Plain sentence about two cards finishing together; fix home/guide; write one tie rule | S | partial | 12 |
| B05 | Host | "Pressed Pause, 3 numbers still came" | M | zc.js:785, 1589; control.ts:213-246 | Say it before the click; "Pause on its way, N s" state | M | partial | 02 |
| B06 | Host | "After Resume next number came at once" | m | control.ts:192; RULES_bingo.md:36 | Full gap after Resume (needs ruling) | M | missing | 02 |
| B07 | Mgr | "Bought 5,000 pack, no Pause; nobody said" | m | zc.js:785; control.ts:237-247; pricing.html:40-54 | State "no Pause above 2,000" on pricing and size chip | S | partial | 12 |
| B08 | Emp | "Paused text does not say my card is safe; own bad network looks like organizer" | m | z.js:627-629; RULES_bingo.md:68 | Approved paused sentence with time; separate "your connection is slow" | S | partial | 12 |
| B09 | Host | "Could not find the board on game day" | m | zc.js:965, 620-621, 784-788 | Big Number board button and big-screen link in step 9 | S | partial | 12 |
| B10 | Org | "Four prizes blank; winners got nothing" | M | zc.js:1034, 889, 676-682, 1425; clone.ts:3 | Publish read-back lists unnamed prizes with Name them now | S | missing | 12 |
| B11 | Org/Fin | "Paid at start time; room waited; no reminder" | M | lifecycle.ts:28-31, 312-327; z.js:626 | Mails at -24 h, -2 h, -30 min while draft or unpaid | M | missing | 12 |
| B12 | Mgr | "30 never joined; found out in the report" | m | reportgen.js:23; mails.ts | "N invited, not joined" with WhatsApp resend | M | missing | 12 |
| B14 | Mgr | "200 phones all speaking numbers in the hall" | M | z.js:63; audio.js; index.html:63-70 | Organizer choice "everyone in one room: phones silent, big screen speaks" | M | missing | 12 |
| B15 | Emp | "Call came, no welcome back, no Do Not Disturb tip" | m | z.js/z.html grep 0; RULES_bingo.md:39-42, 69-70 | Away line, DND tip, wake lock | S | missing | 12 |
| B16 | Emp | "'Engagement', 'Call board', 'decided by fate'" | p | z.js:626, 701, 222-240; report-layout.ts:47-61; pdf.ts:124 | Replace with "game"; scan test | S | partial | 15 |
| B17 | IT | "'Private by design' next to 'anyone with the link'" | M | index.html:63, 114, 139; site.js:90; zc.js:421-891; guide, trust, legal, partner; mails.ts:94-113 | Use site-bingo wording; failing-if-returns test | S | partial | 15 |
| B18 | Fin | "Daily 50 percent off with crossed-out price" | M | site.js:33-38; index.html:57 | Remove, or real dated offer on pricing too | S | n/a | 06 |
| B19 | Org/IT | "Guide says report link 22 h, link died at 19, names gone 20; page says 24" | M | organizer-guide.html:89; lifecycle.ts:27-28; zc.js:795; index FAQ | One sentence from the constants + test; one deletion timeline | S | partial | 05 |
| B20 | Org/Rep | "Gifts next week; report dead; winner only 'Card 214'" | M | z.js:354; BINGO_GAME.md:49; zc.js:795-797, 1599 | Save-winners-with-names prompt now; attach PDF; seat-only export 365 d | M | partial | 05 |
| B21 | Org/Mgr | "Staff asked to 'Earn 50 percent by sharing'" | M | z.js:649, 354-356, 63 | Remove Refer and earn and share buttons from paid-game player screens | S | missing | 01 |
| B22 | Fin | "One-person vendor, no GST, pages.dev pay address, no refunds" | M | pricing.html:54; index footer; pay.js:68; wrangler PAY_HOP_URL | "For finance and procurement" page; payee unchanged | S | missing | 06 |
| B23 | Fin | "Pay link 7 days, newer link kills older" | m | paylink.js; organizer-guide.html:100 | Expiry date in mail; ask-for-new-link button; game name/amount first line | S | missing | 06 |
| B24 | Fin | "'Test a payment (Rs 1)' - is site in test?" | m | index.html:149; paytest.html | Remove from public footer | S | missing | 06 |
| B25 | Org | "Want a dry run at real size, free" | M | demo.js:1-6; config.ts:116; no 'rehears' in apps | Port Tambola 3 rehearsals or a 3-minute "test with my phone" | L | missing | 16 |
| B26 | IT/Host | "No log of what number came when or who paused" | M | gamerecord.ts:1-6; reportgen.js; RULES_bingo.md:37; TTT has gamelog.ts | Copy shared game-log module; save at game end independent of e-mail | L | missing | 12 |
| B27 | Owner | "Bingo never had a real 10-phone live game" | M | handover 50:28; 99 of 1045 matrix cases stale; failing credit test | Click-only 10-phone live Rs 0 game, winner rows re-read in D1, 320/360/1280 screenshots | M | missing | 10 |
| B28 | Host | "'Claims received: 0 - all match' but nobody claims" | m | zc.js:777; worker.ts:93-95, 1744 | Rename or hide; never print "all match" when none stored | S | partial | 12 |
| B29 | Emp/IT | "How do I know numbers are public?" | m | z.js:610-620; zc.js:778 | One quiet proof line + Check link | S | missing | 03 |
| B31 | Org | "'At least 2 hours ahead' but I have 30 minutes" | m | zc.js:1037; worker.ts:1331-1345; pricing.html:54 | State real minimum; "start in 20 minutes" chip | S | missing | 12 |
| B32 | Emp/Org | "Top bar sends me to some old page; strapline differs" | m | gamesbar.js:14-16; handover 105 | Land site-bingo worktree; canonical games bar | M | partial | 19 |
| B33 | Emp | "Nothing for me to do, just watch" | m | z.js:610; zc.js:182; RULES_bingo.md:6-11 | Product decision with B34; three short rules under card | S | partial | 12 |
| B34 | Org/Owner | "Rules page says Claim button and 2 Bogeys; game has none" | m | RULES_bingo.md:26-33, 73-75; console spec decision 3 | Owner ruling (Q-pending); do not publish rules page until true; add true "How to win" page | S | n/a | 12 |

### 4.4 Corporate Tic Tac Toe (P3) - live 045d629 1.3.1 in TEST mode; unreleased 1.4.0 bb111a3 on `rel/after-tambola-ui-untested` (repo `tictactoe`)

1.4.0 has never been run (Run A, B, C open), so 1.4.0 rows are predictions from code. Ids renamed TT-xx (review used T-xx).

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| TT-01 | Org/Fin | "Code never came; payment said paid but no real invoice" | B | /api/mode = TEST (29 Oct); TEST_AND_LIVE_MODE.md; live home has no notice; live rules.html 404 | "Opening soon" banner until go-live; go live only after TE0 + 10-player live check; retest sign-in with stranger's address | S | n/a | 13 |
| TT-02 | Org | "Site says game starts by itself; I had to press Start" | M | zc.js:686, 643, 737; organizer-guide.html:100; tournament.ts:143-165 | Rewrite four texts: "You press Start"; payment before start | S | missing | 13 |
| TT-03 | Host/Mgr | "Pressed Start, switched tabs; phones stuck on 'Getting the draw ready'" | M | tournament.ts:143-195; phone.ts:138; host.js:3-4, 83, 88; handover 100 line 180 | Keep-open bar + wake lock; players see message after 20 s; let first phone post plan | M | partial | 13 |
| TT-04 | Emp | "Screen dark in waiting room; lost before I played" | M | no wakeLock in ttt.js; ttt.js:222; tournament.ts:160; match.ts:12-13, 79 | Wake lock; 10 s Get ready countdown; ready meter; owner: 60 s first move | M | missing | 13 |
| TT-05 | Emp | "A square filled by itself, marks swapped, no explanation" | M | RULES_tictactoe.md section 10 vs ttt.js; phone.ts:105 lastAuto unused; ttt.js:149-151 | Show auto-move, first-strike and draw/new game banners | S | partial | 13 |
| TT-06 | Emp | "Tap did nothing; no message when move failed" | M | ttt.js:38, 213/222 (full redraw ~1.2 s); phone.ts:286-291; ttt.js:184; z.html:7 aria-live | Redraw only on change and never while pointer down; instant mark with rollback; aria-live on status only | M | missing | 13 |
| TT-07 | Emp | "Could not see the timer; my time ran out" | M | ttt.css:91-93 | Quiet until 10 s then bold/coloured; confirm with owner | S | partial | 13 |
| TT-08 | Emp | "Two minutes late, thrown to a bracket page with no reason" | M | ttt.js:225-227, 99; worker.ts:1650; phone.ts:141 | Card before form: "list closed; watch or practise"; owner: late entry as bye | S | partial | 13 |
| TT-09 | Emp | "Opened in Teams then Chrome: 'place on another phone'" | M | ttt.js:13, 217, 99; tournament.ts:111; worker.ts:1649-1650 | Reclaim seat by name after 60 s; say "open in same browser" | M | partial | 13 |
| TT-10 | Mgr/Emp | "How long will this take? 'Waiting for next opponent' with no number" | M | zc.js:644; tournament.ts:41; phone.ts:198-200; bracket.ts:49; ttt.js:157, 167, 198-199 | Duration hint; "Round 3 of 8"; ETA for host | M | partial | 13 |
| TT-11 | Mgr/Host | "'0 of 1 boards played' while 40 are playing" | M | tournament.ts:382-388; phone.ts:168-175; host.js:33 | Totals from plan; oldest unfinished round; test with overlapping rounds | S | missing | 13 |
| TT-13 | Host | "Pressed End; nobody ranked; gift winners vanished" | M | tournament.ts:208-214; host.js:78; rules.html:57-58 | "Stop and rank by round reached" vs "End without ranking"; optional time limit | M | n/a | 13 |
| TT-14 | IT/Host | "Page says nobody can change a result; host page has 'Alice won'" | M | rules.html:57; index.html:118; report-layout.ts:111; host.js:66; tournament.ts:316-327 | Reword: settlement shown in log and report; mark settled boards | S | partial | 13 |
| TT-16 | IT/Org | "Guide says link 22 h, data 24 h; link dead at 20" | M | lifecycle.ts:28-29; organizer-guide.html:93; zc.js stepAfter; rules.html:63 | One promise everywhere; copy-lint test | S | missing | 05 |
| TT-17 | Owner/Org | "'Private by design' / 'private game'" | M | index.html:63, 113, 141; legal.html:123; organizer-guide.html:54, 56; zc.js:904/916 | Replace; port failing-test guard | S | missing | 15 |
| TT-18 | Org | "Guide says choose clock 10/20/30/60; I cannot find it" | M | host.js:59; zc.js:302, 795, 908; organizer-guide.html:76; ai-functions.ts:31 | Update all to "20 s (30 first move)"; grep test | S | partial | 15 |
| TT-19 | Org/Host | "Step 9 says 'Message your guests' - where?" | M | zc.js:103, 742, 752, 766, 789-797 (blocks defined, never called) | Wire announce banner, Prize-given tick; or rename hint | M | missing | 13 |
| TT-20 | Org/IT | "Report has 'Check no. 0, 8, 16'; no bracket; no deletion e-mail" | M | lifecycle.ts:189, 315, 224, 333; report-layout.ts:88-90 | Tic Tac Toe report; "guests' data erased" mail; say why PDF is a link | M | partial | 05 |
| TT-21 | IT | "demo1@xyz.in / 123456 opens an organizer account" | M | testlogins.ts:4-5; handover 100 task SE | Test logins only in TEST mode; LIVE-mode test | S | partial | 17 |
| TT-22 | IT | "Anyone with the link reads all names; report link shows mobiles" | m | tournament.ts:127-135, 382; big.js:1-3; lifecycle.ts:~229 | Say so plainly on join page/privacy; first name + initial on big screen | M | n/a | 13 |
| TT-23 | Fin | "No quotation, PO, bank transfer; TDS" | M | pricing.html:54; pay.js:62, 92; pay.ts:364 | Downloadable pro-forma; PO box; TDS sentence; bank transfer is owner decision | M | missing | 06 |
| TT-24 | Fin/Emp | "Paid 3 minutes late; players told 'waiting for host'" | m | worker.ts:251, 1535, 1558; ttt.js:219; host.js:74 | Show "waiting for payment"; red Unpaid strip for host | S | partial | 13 |
| TT-26 | Emp | "Two Rahuls; told I won when the other won" | M | ttt.js:148, 158; phone.ts:99-107; tournament.ts:102 | Compare ids not names; show seat for equal names | S | n/a | 13 |
| TT-27 | Emp | "'The draw is sealed' - draw means a tied game; 'bye', 'fate'" | m | ttt.js:195; rules.html:15-16; phone.ts:198 | Plain waiting-room line; "free pass" | S | partial | 13 |
| TT-28 | Org/Host | "Forgot Start; 6 never joined, no one told me" | m | lifecycle.ts/mails.ts none; phone.ts:138; host.js:33 | Nudge at planned time; "Invited but not joined (6)" | S | missing | 13 |
| TT-30 | Host | "New tab says 'Sign in first'" | m | host.js:11-13, 87; keep.js:6-18; zc.js:795 | host.js reads same CTK store | S | n/a | 13 |
| TT-31 | Host/Emp | "After Resume my clock had 3 s left" | m | phone.ts:34; RULES_tictactoe.md section 5 | Ruling: 5-second restart and min 10 s clock | S | partial | 02 |
| TT-32 | Org | "Forgot champion's prize; page let me publish" | m | zc.js readBack ~410, 150 | Name each empty place and ask once; "Gift: to be announced" | S | partial | 13 |
| TT-35 | Emp | "My company event shows 'run a game of your own' and Refer and earn" | p | z.html:9-10; old footers | Hide when brand set / during board; roll canonical bar | S | partial | 19 |
| TT-36 | Owner | "You said ready; 1.4.0 never run" | M | handover 50 s4.4, s5; ui-ttt.mjs only on 1.3.1 | TE0 runs A/B/C + 10-player live check re-read from DB; falsify each fix | M | missing | 10 |

### 4.5 Corporate Snakes and Ladders (P3) - live d2a3ebd 1.3.0, TEST mode (repo `snakesladders`)

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| SL-01 | Emp | "I typed a nickname; screen says Player 17" | M | z.js:69, 416; big.js:14, 114, 121; index.html:89; SPEC 18.8 | Show nickname for the 24 h life of game; at least "You are Player 17" | M | missing | 14 |
| SL-02 | Org/Emp | "Site says tap to throw; nothing to press" | M | index.html:62, 119, 131; demo.js:77; zc.js:214; z.js:377, 484 | Rewrite copy for automatic throws; auto-roll demo | S | missing | 14 |
| SL-03 | Org/Mgr | "Everyone got 'wait for organizer to approve'" | B | zc.js:202, 1334, 341; worker.ts:1679; z.js:127 | Default "Anyone with the link" when no list; warn at Publish if list mode and list empty | S | missing | 14 |
| SL-04 | Emp | "Link at 10:01 says 'Sign-up closed, game running' but nothing running" | M | worker.ts:1623; zc.js:279; z.js:125; guide.js:128 | Say real rule; read-only Watch view; consider 1-minute grace | M | partial | 14 |
| SL-05 | Fin/Emp | "Finance paid 10 min late; newcomers told 'game running'" | M | worker.ts:1623-1624; pay.ts:231; z.js:800 | Check "locked" first; keep sign-up open until payment | S | missing | 14 |
| SL-06 | Org | "Step 2 has 17-19 choices" | M | zc.js:291-362; OPTIONS_TABLES.md:39-52; 50-games:59 | Hide team race, table, board size, snakes/ladders counts, finish rule, etc.; ~6 visible | M | missing | 14 |
| SL-07 | Org/Mgr | "How long will it take? Ended while half the team on square 40" | M | no duration text; schedule.ts:11-18; config.ts GRACE_ROUNDS; zc.js:305; SPEC 7 | Duration estimate in Step 2 and home; say game ends when 5 are home | M | missing | 14 |
| SL-08 | Emp | "'Turn 14 of 60' but game ended at turn ~14" | m | z.js:392, 587-593, 811; big.js:151 | "Turn 14. Ends when 5 players are home"; show distance and place | S | partial | 14 |
| SL-09 | Emp/Host | "Pressed Roll, nothing; screen flickers" | M | z.js:857, 901, 839; Tambola 1.4.4 | No rebuild while pointer down; or update text nodes in place | M | missing | 14 |
| SL-10 | Emp | "Pressed with 2 s left: 'Ohooo'; Wi-Fi dropped, froze" | m | throws.ts:21-22; z.js:393, 850; big.js:25 | Reconnecting strip; start countdown 2 s early | S | partial | 14 |
| SL-11 | Emp | "Phone dark, then all phones talking" | M | grep wakeLock 0; z.js:528, 877, 65; audio.js:26-41 | Wake lock; sound off by default; DND tip | S | partial | 14 |
| SL-12 | Emp | "Teams then Chrome: 'ask your organizer to move your board'" | M | worker.ts:1607-1610, 1624-1650; zc.js:649, 1626 | "Stay in this app" line; one-tap request to organizer | M | partial | 14 |
| SL-13 | Org | "Milestone and prizes had no gift text" | M | config.ts:15-20; zc.js:463, 270 | Publish list "These prizes have no gift"; do not copy blanks | S | partial | 14 |
| SL-14 | Org | "Want to try with two colleagues before paying" | M | demo.js:1-3; handover 50:112; Tambola 1.6.0 | Free 5-person rehearsal + 3 paid rehearsals | L | missing | 16 |
| SL-15 | Org | "Forgot to publish; who has not joined?" | m | worker.ts:435-441; report-layout.ts:126; worker.ts:1377 | Mail at -24 h/-2 h; "x of y joined" with WhatsApp nudge | M | missing | 14 |
| SL-16 | Host | "Cannot see where the game is; '0 joined after first turn'" | M | zc.js:819-826, 124 COH; RULES_snakesladders.md section 8 | Live race card at top of step 9; Co-host can open big screen | M | missing | 14 |
| SL-17 | Host | "Pause: game kept running a minute; Resume opened a turn at once" | m | zc.js:846; control.ts:192-196, 239-246; z.js:811 | Real delay on button; 10 s restart countdown | M | partial | 02 |
| SL-19 | Mgr/Emp | "Winner pop-up says 'Player 52'; prize proof only saved on phone" | M | big.js:121; z.js:557, 581; zc.js:808-815; config.ts:115 | Nicknames; organizer ticks winners without waiting; Download prize slip | M | partial | 14 |
| SL-21 | Emp | "Could not find rules once game started; /rules.html 404" | p | z.js:474-490; RULES_snakesladders.md | "Rules in five lines" fold + rules page | S | missing | 14 |
| SL-22 | Org/Emp | "Error says 'ticket' and 'number called'; report has Rounds, Boards per person" | m | guide.js:95-195; keep.js:1; ai-functions.ts:47; report-layout.ts:15, 79-127; z.js:592 | One wording pass + game rows in report; scan test | M | partial | 15 |
| SL-23 | IT | "'Private by design' / 'private work link'" | p | index.html:63, 113, 138; guide; zc.js:485-952 | Replace; guard test | S | missing | 15 |
| SL-24 | Fin | "Crossed-out price; 'Test a payment' in footer; is it live?" | M | site.js:23; index.html:144, 148; pricing.html | One honest price; remove Rs 1 link; flip LIVE only after page check | S | n/a | 06 |
| SL-25 | Fin | "Pay page shows Game ID, not game name; no PO" | m | pay.js:62, 73-75; paylink.js:51-52 | Game name and date; optional PO number; vendor details | M | partial | 06 |
| SL-26 | Fin | "No refund; credit only for organizer account" | m | zc.js:710-725; pay.js:68; refund-policy.html | One bold line before payment; offer 30-day move first | S | partial | 06 |
| SL-27 | IT | "Where hosted? sub-processors? AI link policy? marketing on employee page" | m | ai-functions.ts:36-47; subprocessors.html; z.html:9; z.js:596 | IT review pack; switch to hide marketing | M | partial | 06 |
| SL-29 | Rep | "Cannot copy until report sent; blanks copied" | m | zc.js:855, 223; report-layout.ts:68 | Clone as soon as game started/ended; drop empty prize text | S | partial | 14 |
| SL-31 | Emp/Org | "Top bar 'Corporate Tambola' goes to games home; 'All games' old hub" | m | gamesbar.js:5, 14; index.html:148; handover G02 | Roll out canonical games bar | S | missing | 19 |
| SL-32 | Mgr | "200 clicked at 10:00; some refused; join in flight lost at start" | m | z.js:126, BUSY_TRIES; throws.ts:29; worker.ts:1651, 1668 | Let a join begun before start finish (60 s); read throws per range; 200-phone storm sim | M | partial | 18 |
| SL-33 | Emp/Mgr | "Projector shows a link nobody can type; no QR" | m | big.js:131, 145 | QR (generated in page) + short code | M | missing | 14 |
| SL-34 | Host | "Co-host sees nothing; wrong sign-in wording" | p | zc.js:124-135, 891-900 | Read-only live card; show which e-mail is signed in | S | partial | 14 |

### 4.6 Corporate Luck by Chance (P3) - live 752ff60 (22 Oct), TEST mode (repo `luckbychance`; port worktree `rel-after-tambola-090fe4` 961189f unfinished)

Claims do not apply; the press is their equivalent.

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| LB-01 | Emp/IT/tester | "I did not press and the dice still rolled and scored; late press gave no message" | B | luck.js:127, 136; engine.ts:107-110; luck.ts:1-12 no press route; docs/RULES.md:7 "Presence not part of product"; RULES_luckbychance.md:26-30, 71; demo.js:39-41 differs | Owner ruling first. A: say it honestly everywhere (dice rolls by itself). B: real press route with server clock, 409 late-press "Ohooo", no press scores 0 | L | missing | 11 |
| LB-02 | Org | "Typed my e-mail three times, no code" | B | /api/mode = TEST (29 Oct); mode.ts:5-8; testmode-banner.test.ts:1 (banner only in console) | Switch LIVE after smoke or show "Not open for real games yet" on home and sign-in; release check: /api/mode must be LIVE | S | partial | 11 |
| LB-03 | Host/Mgr | "CEO walked in and I could not pause" | M | docs/RULES.md:77 (R51); host.js:31-38; luck.ts:161; timeline.ts:10-12 | Pause/Resume shifting due times; full press window after Resume; log pauses | L | missing | 11 |
| LB-04 | Emp | "Link opened a big screen; nobody told me I could not play" | M | worker.ts:1399; luck.js:53, 186; host.js:68 | Show server sentence + Watch button; Start confirm says "N joined, M not" | S | partial | 11 |
| LB-05 | Host | "I only see Round 3 of 10; no target, countdown or top 10" | M | host.js:24-30, 57-60, 20 | Live host panel using luck-run.js; Open big screen button; winners when done | M | partial | 11 |
| LB-06 | Org/Rep | "Typed prizes in step 3, host page blank, typed again; report shows wrong ones" | M | zc.js:304-308; host.js:12; luck.ts:141; lifecycle.ts:289 | Prefill host page from saved prizes; single source; warn on unnamed prizes | M | partial | 11 |
| LB-07 | Host/Emp | "Ticked 'one prize per player'; same person got two gifts" | M | host.js:49; engine.ts assignPrizes never called; host.js:62-66 | Call assignPrizes in phone/big/report or remove checkbox; show total gifts needed | S | missing | 11 |
| LB-08 | Org/Mgr | "No idea it takes 26 minutes; rounds chosen only at Start" | M | host.js:43-50; zc.js:278; docs/SPEC.md:73-74; timeline.ts:13 | Show "About 26 minutes"; pre-set rounds in console | S | missing | 11 |
| LB-09 | Emp/Host | "10:30 passed, 'waiting for the host'; no time; host forgot Start" | M | luck.js:176, 188; luck.ts:141; zc.js:259; big.js:26 | Show planned start; auto-start default with 20 s countdown; mail organizer 15 min before | M | missing | 11 |
| LB-10 | Org/Mgr | "No link or QR on the big screen" | M | big.js:26; index.html promise | Join link large + QR (no outside call) | M | missing | 11 |
| LB-11 | IT | "Page says 'not even us' can know; your server draws the secret" | M | index.html:91; luck.ts:20, 61-62; docs/RULES.md:80-81; reveal route raw JSON; luck.js:176 | Reword to what is true; "Check this game" page; wire public beacon later | M | partial | 11 |
| LB-12 | Org | "Home promises message or video; step 4 has only name, colour, logo" | M | index.html:72, 93; zc.js:35, 376, 398; worker.ts:193; luck-end.test.ts R52 | Rename step to "Your brand"; remove video/message promise | S | missing | 11 |
| LB-13 | Owner | "'Private by design' / 'private link'" | m | index.html:63, FAQ; organizer-guide.html:54; zc.js:411; trust.html | Replace; add guard test | S | missing | 15 |
| LB-14 | Host | "Why three windows? 6 s was too short" | m | host.js:46; settings.ts:4; index.html:119; ai-link.ts:186; OPTIONS_TABLES.md:55 | Keep only 10 s for new games; quiet timer wording | S | missing | 11 |
| LB-15 | Host | "Reopened game page: 'Sign in first'" | M | host.js:10, 73-74; keep.js:12-16 | Load keep.js, read key via CTK | S | missing | 11 |
| LB-16 | Emp | "Join button stayed grey; 'Failed to fetch'" | M | luck.js:17-22, 48-58; Tambola 1.1.7/1.3.3 | 40 s timeout, one auto-retry, always re-enable button | S | missing | 11 |
| LB-17 | Mgr/IT | "With 200 on office Wi-Fi numbers came late" | M | luck.js:191 poll 900 ms; luck-run.js:33-40; luck.ts:~210-241 (~6 reads per /me); README "does almost nothing" | Phones sleep to next due time; edge-cached 1 s file; measure at 100/250/500 | M | missing | 18 |
| LB-18 | Org/Host | "Rude nickname on projector; three Amits" | M | luck.ts cleanName; luck.js:32-37; luck.ts:148-150 | Show name + seat; bad-word check; Host hides a nickname; explain grey Join | M | missing | 11 |
| LB-19 | Org/Emp | "Winner is 'RockStar77'; report says winners confirmed but nobody was asked" | M | report-layout.ts:107; luck.js:~143-150; winners.ts; worker.ts:1672-1673; luck.ts:80-110 | Winner confirm step; write prize rows; "ask organizer for gift" | M | partial | 11 |
| LB-20 | Org/Owner | "Report has Tambola 'Check no.' and lists 5 places; no round results or log" | M | report-layout.ts:70-120; lifecycle.ts:289; RULES_luckbychance.md:50-53 | Results by round, top 10, compact log; remove sections that cannot apply | M | partial | 11 |
| LB-21 | Mgr | "Four of us; phones could not agree, no winner" | M | luck.ts quorumFor ~76; luck.js; lifecycle.ts:312 | After 10 min accept most common vote or quorum 1 for up to 5 players | S | n/a | 11 |
| LB-22 | Emp | "Screen dark twice; no DND tip" | m | no wake lock in luck.js, luck-run.js; RULES_luckbychance.md:36-39, 68 | Wake lock, DND tip, welcome-back line | S | missing | 11 |
| LB-23 | Emp | "Round vs dice round vs fingerprint" | m | luck.js:111, 176; luck-dice.js; guide.js:109 | "Round 3 of 10, Throw 4 of 10"; fingerprint behind Check this game | S | partial | 11 |
| LB-26 | Org | "Forgot to publish; 6 invited, 1 never joined; unpaid game text" | M | lifecycle.ts:316-324; worker.ts:1347; luck.js:188 | Mail at -2 h and -15 min if draft/unpaid; invited-not-joined list; "waiting for payment" text | M | missing | 11 |
| LB-27 | Org | "Demo is me pressing five times; not like the real game" | M | demo.js:39-41, 18; no rehearsal in apps | Port 3 rehearsals; align demo once LB-01 decided | L | partial | 16 |
| LB-28 | Fin | "Price says no GST; pay page asks GST number; need quote and PO" | m | pricing.html:54 vs pay.js:60; paylink.js:50; pay.js:64 | Say how tax is treated; quote before payment; owner-controlled payee link | S | partial | 06 |
| LB-29 | Owner | "Did anyone play this with ten real phones?" | M | GAMES_AFTER_TAMBOLA.md:57 "not started"; luck-sim.ts in-process | Committed Chrome+WebKit 360 px 10-player + host + big screen run, results re-read from D1 | M | missing | 10 |
| LB-30 | Org/Emp | "Top bar goes to old hub; Refer and earn on player screen; new site pages 404" | m | gamesbar.js:5; z.html:9-10; live /how-it-plays 404 | Roll out canonical bar; hide referral; publish rebuilt site (claude/site-luck-e2589b daa27b6) | M | partial | 19 |
| LB-31 | Host/Emp | "Round break shows top 10 but not who gets which gift" | m | big.js break/final; host.js:57-58; zc.js:733; audit #14 | Show round gift next to round winner; final five on host page | S | partial | 11 |

### 4.7 All Corporate Games websites (P5) - home (branch `home-bar-qa`, HEAD cdf70c1) and the five game sites

| Id | Persona | A user would say | Sev | Evidence | Proposed fix | Eff | Parity | WP |
|---|---|---|---|---|---|---|---|---|
| W01 | Org/Rep | "Wanted Bingo; Sign in put me in the Tambola console" | M | home/index.html:25, 32, 113, 123; games/how-it-works/for-hr; commit 79a507c (console. not existing) | Label "Sign in to Corporate Tambola"; per-game sign-in links until master console exists | S | missing | 19 |
| W02 | Owner/Org | "Every site has a different crowd of buttons; I asked for six" | M | tambola index.html:56 (~10 links); bingo 9; others 8; corporate-brand-kit README; no tokens.css/brandkit.js in any site | Run brand-kit vendor.py per product (Tambola first); checksum test; record one menu ruling | L | missing | 19 |
| W03 | IT/Org | "'All games' opens an older site saying 'opening soon' and 'private'" | M | live games.corporatetambola.com; 14 Tambola pages; gamesbar.js line 14 | Redirect games. to home.; change all footers/bar links | S | missing | 19 |
| W04 | Emp/Org | "Corporate Tambola link from Bingo lands on company home or pages.dev" | M | bingo..luck gamesbar.js:5; bingo/ttt footers corporate-tambola.pages.dev | Tambola -> housie.corporatetambola.com everywhere; ship canonical bar | S | missing | 19 |
| W05 | Emp/Org | "Site said the software finds every winner; I never pressed Claim" | M | home index.html:72, games.html:30, tambola index.html:121 vs organizer-guide Claim rule; S10/S17 | Tambola copy: "press Claim before next number"; keep "finds every winner" for Bingo only; FAQ line | S | partial | 19 |
| W06 | Org | "Free game asked for sign-in; 'Video' turned out to be a game" | M | home index.html:32; site.js startDemo; demo.html:4 title "Video"; labels differ per site | No-sign-in 1-minute demo first button; rename Video; brand-kit label "Free demo game" | S | missing | 19 |
| W07 | Org | "Nothing says I can test first" | M | 'rehears' only in big/board/gamelog/z/zc.js, no public page | Add three free rehearsals to benefits, pricing, brochure, guide; "1 day / 1 hour before" box | S | missing | 19 |
| W08 | Org | "2 minutes / 15 minutes / 5 screens / 10 steps / 3 steps; published late" | M | tambola og:description, index lead, brochure.html:50, organizer-guide, home how-it-works; S14/S07 | One honest time and step count; "publish and pay a day before; first number 2 min after start" box; draft reminder (WP-04) | M | partial | 19 |
| W09 | Mgr/Fin | "No price anywhere on Corporate Games home" | M | home index.html:79, how-it-works.html:26, games.html; HOME_SITE_DESIGN.md s7 | Owner confirms price list; show "from" price or quote mailto | S | missing | 06 |
| W10 | Fin/IT | "50 percent off never ends; crossed-out price made up" | M | tambola site.js:33; index.html:161 on all five sites | Remove computed was-price and badge, or real dated offer | S | missing | 06 |
| W11 | Fin | "One-person seller, no GST, no sample invoice, no payment link on site" | M | pricing.html; contact.html; paylink.js; 0 mentions in index/pricing/guide/brochure | "For your finance team" block + sample invoice; no new payment method | M | missing | 06 |
| W12 | Fin/IT | "'Test a payment (Rs 1)' and 'Sales login' in footer" | m | tambola index.html:165, pricing, terms, refund-policy; all game sites | Remove test link; rename Sales login to Partner login under Refer and earn | S | missing | 06 |
| W13 | Fin | "Pricing says no refunds; refund policy gives refunds for faults" | m | pricing.html, organizer-guide vs refund-policy.html s7/s8; brochure; bingo index | "No refund once paid except double/wrong charge or our fault" everywhere | S | missing | 15 |
| W14 | Rep | "Credit and sign-in are per game; Bingo does not know me" | m | bingo/ttt refund-policy s5; separate sites | State "one account and credit per game today"; offer Create-like-this elsewhere | M | partial | 19 |
| W15 | IT | "Where is the data? certificates? trust page not linked" | M | tambola trust.html linked from nowhere (llms.txt/robots only); dated 2026-10-07; home/privacy.html | Link Trust from footer/home privacy; Security answers for IT; refresh dates | M | missing | 06 |
| W16 | IT | "'Only invited people can join' vs 'anyone with the link'" | M | home index.html:58; tambola trust list; bingo FAQ; HOME_SITE_DESIGN.md s7 | "You decide: invite-only or a link you share" on all sites | S | missing | 19 |
| W17 | Owner | "'Private' is still on four game sites" | M | bingo/ttt/snakes/luck index.html:63, 114, 139 and 10+ pages | 1.6.7 wording pass + guard test on four sites | S | partial | 15 |
| W18 | Org | "Game, engagement, closed-group - what do I buy?" | m | tambola index.html:74, 143, FAQ, pricing, header line; z.js:187 | "game" in buttons/steps/prices/player page; "close group" not "closed-group" | S | partial | 15 |
| W19 | Org | "Home says engage teams; Bingo says remote and hybrid teams - different company" | M | home hero vs bingo/ttt/snakes/luck heroes; owner order | Brand-kit hero snippets per game | M | missing | 19 |
| W20 | Emp/Org | "Top of page is a pile of coloured buttons on my phone" | m | site.css:166, 12, 82, 122, 193, 209; app.css:157 (not verified in browser) | Menu button with six items via brand-kit | M | missing | 19 |
| W21 | Emp | "Landed on a page selling to HR; where do I join, what are the rules?" | m | tambola index.html no player entry; rules only legal.html#rules; ttt rules.html only on branch | "Playing today? Open the link your organizer sent" strip + 3 rules + support e-mail; rules pages for other games | M | missing | 19 |
| W22 | Host | "Never told Host vs Co-host vs Organizer; no game-day help hours" | M | brochure.html; organizer-guide.html; contact.html no hours | Roles table; game-day help with hours and WhatsApp | M | missing | 19 |
| W23 | Mgr | "Worried about 200 on one office Wi-Fi; Teams steps buried" | m | tambola index.html:149 meetbox; worker.ts:432-435; C01/C05 | One proof line; move Teams/Meet section up | S | partial | 19 |
| W25 | Org | "WhatsApp preview shows no picture" | m | 0 og:image in home pages; Tambola/Bingo have it | Add og:image and twitter card to home | S | partial | 19 |
| W26 | Org | "Mailto has no subject; no WhatsApp on home; e-mail obfuscation needs a script" | m | home contact.html, index.html; Cloudflare email-protection (not verified in browser) | Prefilled subjects; WhatsApp link; switch off obfuscation | S | partial | 19 |
| W27 | Org/IT | "'Six games your people already know' but the sixth is not built" | m | home index.html:70; LUCKY_DRAW_PLAN.md | "Five games, and Lucky Draw coming" | S | n/a | 19 |
| W28 | Org | "Report in a few minutes with PDF; real 5-13 min and no PDF; names gone next morning" | m | bingo index; digest S11/S19; organizer-guide | "Within about 15 minutes"; PDF-before-erasure warning; reminder at 12 h | S | partial | 05 |
| W29 | Fin/IT | "Footer advertises Startup Coach and DPDP; company site is pages.dev" | m | game footers; contact.html | Remove unrelated products; proper domain or drop Website line | S | missing | 06 |
| W30 | Owner | "Is the new home with bar checked in a real browser?" | M | home cdf70c1 "browser cases NOT yet run"; tests/last-run.json 28 Oct; four different gamesbar.js md5s | Run 14 home cases + falsify; checksum test per site; record live SHA | M | partial | 10 |
| W31 | Org | "Demo on Tic Tac Toe/Snakes/Luck is play-against-computer, not what I run" | m | ttt/snakes/luck demo.js; organizer demo only Tambola and Bingo | Label "Try the game"; organizer walk-through before promoting on home | M | missing | 16 |
| W32 | Emp/Org | "Bingo page: speeds 6/9/12/15; ends when every prize is won" | m | bingo index FAQ; S03/S05/A07; OPTIONS_TABLES.md | Copy speeds and ending from the owner rulings | S | partial | 15 |

## 5. Same root problem across products (how the findings were merged)

| Root problem | Where it shows up | Package |
|---|---|---|
| Wording: "engagement", "private", "closed-group", Tambola words in other games, stale "10/20/30/60 s" and "6/9/12/15 s", "decided by fate", "fingerprint" | TA27, B16, B17, TT-17, TT-18, SL-22, SL-23, LB-13, LB-23, W13, W17, W18, W32 | 15 |
| Blank prizes published and cloned | TA12, B10, SL-13, TT-32, LB-06 | 04 (Tambola), 12-14 |
| No reminder for draft/unpaid game; no nudge for invitees who never joined | TA13, TA14, B11, B12, SL-15, TT-28, LB-26, MC-16 | 04, 08, 12-14, 11 |
| Resume must restart a full gap; Pause takes ~40 s to reach phones | TA09, B05, B06, SL-17, TT-31, LB-03 | 02 |
| Wake lock, away/DND tip, in-app browser looks like second phone, sound in office | TA06, TA08, TA21, B14, B15, SL-09, SL-11, SL-12, TT-04, TT-06, TT-09, LB-22 | 03, 12-14, 11 |
| Report/e-mail timing, retention numbers, PDF not attached, winners' names erased before gifts handed out | TA20, B19, B20, MC-21, TT-16, TT-20, W28, LB-19, LB-20 | 05 |
| Finance/IT trust: fake strike-through price, Rs 1 test link, one-person vendor, no PO/quote, pay link 7 days, IT security page | TA15-TA17, TA23, B18, B22-B24, TT-23, SL-24..27, LB-28, W09-W12, W15, W29, MC-12, MC-13 | 06 |
| Game log (365 days, uneditable, sealed) and proof lines for players | B26, B29, TA11, A22, A23, LB-11, LB-20 | 02, 03, 12 |
| Games bar, header, links to old hub, Tambola address | W02-W04, B32, SL-31, TT-35, LB-30, MC-33, G02 | 19 |
| Rehearsals / honest demo | B25, SL-14, LB-27, W07, W31, TA (digest T28 parked) | 16 |
| Honest testing with observed proof | MC-37, B27, TT-36, LB-29, W30, A26, O01, O06 | 10 |
| Test logins and TEST mode left on | MC-25, TT-21, TT-01, LB-02 | 17, 13, 11 |
| Scale/ops: polling load, one-address joins, stale service-worker cache, deploy during live game | LB-17, SL-32, MC-36, C04, C06, A04, X01 | 18 |

## 6. Parked, merged or dropped (not in the tables above)

Parked (real but a product decision or a feature request, not a fix; revisit after the packages):
TA18 (company video upload; only YouTube/mp4 links work), TA24 (keep employee list for next game; needs lawyer), TA28 (rehearsal before paying; partly WP-16), TA31 (time zones and Hindi; English only is an owner decision), B13 (late joiner gets last numbers marked; anti-cheat reason), B30 (clone panel "last CSV from this computer"), TT-12 (organizer-chosen teams), TT-15 (verify page; the part worth doing now is rewording "tested with 1,000 players" to "simulated with 1,000 players" - add to WP-15), TT-25 (practise against the computer while out), TT-29 (names on host live board), TT-33 (re-run of free demo), TT-34 (clone remembers format), SL-18 (department standings), SL-20 (default reach-or-pass finish; owner), SL-28 (fairness fold; folded into WP-03 pattern), SL-30 (90-day booking), LB-25 (team table), LB-32 (clone prefill of host-page choices), W24 (real screenshots on landing pages).
Merged: B35 into B19; W34 into W06.
Dropped as speculation without evidence: LB-24 (long runs of "not this time" boring the player), W33 (AI-crawler policy difference; polish with no user effect).

## 7. How the order was chosen

Owner priority first (P1 Tambola, P2 master console, P3 all games, P4 consoles of all games, P5 websites), then blockers, then cost. Each "S" blocker is pulled to the front of its priority because it is cheap and visible. Rulings that recur (section 9) are asked once and copied to all games; WP-02 carries them. Package numbers below are the numbers used in the tables above.

Cloud vs laptop rule used in the packages: CLOUD = code and tests on a branch, in-process or happy-dom tests, copy and page edits, opening a PR. LAPTOP = deploy (`deploy_one.ps1` / supabase-go), anything that needs the live D1, Resend, Cloudflare or Razorpay tokens in `.env.local`, live 10-player checks (one at a time under `heavy.lock`; the laptop has very little free RAM), and the owner decisions in Cloudflare/Resend. Keep the no-deploy-near-a-live-game rule (`live_games_now.py` first, bump `?v=N` and the service-worker version).

Spec 100 packages named C2/C3 and the wave-2 game console pages (BW/TW/SW/LW/TB0): I did not re-open spec 100; dependencies below name what the reviewers cited (wave 2 pages, SE test-login gate, X2/X3 sweeps). Check the exact letters before dispatching.

## 8. Work packages in order

### P1 - Corporate Tambola

**WP-01 Tambola quick correctness and wording fixes** - P1 - Tambola (B21 same fix in Bingo) - Effort M
Items: TA01 (Present: undefined), TA07 (game is full text), TA10 (lost-claim two-line explanation), TA19 (report tie rule from the real setting), TA21 (voice off in office, record clips or drop claim), TA22 (late-joiner notice before joining), TA26 (Host sees number early), TA27 (word "engagement"), TA32 (no Refer and earn on player screens), B21. Also the action: send Sneha the three questions about claims (S16/S17): which moment felt weak, was "Prize already taken" understood, did the 3 s notice reach her.
Cloud: yes for code + tests (route-level test for TA01, report-rule test for TA19). Laptop: deploy, live 10-player check with claim rows re-read from D1.
Depends on: nothing. Owner decisions: none (TA21 voice default - recommend Off in office mode).

**WP-02 Pace, pause and claim rules - one ruling, copied to all games** - P1 first, then P3 - Tambola, Bingo, TTT, Snakes, Luck - Effort L
Items: S06/A09/TA09 (full 12 s after Resume, "Pause confirmed on N percent" meter), A07 (stop at last prize vs keep calling), TA29/T01 (last-number claims write a winner row), A12 (equal split meaning), A13 (winners announced at end; "Change winner" in log and report; terms text), A20 (board hides Pause/Resume/Add 30 min above 2,000: board.js:173), A22/A23 (log saved at game end independent of the e-mail, no silent caps at 200 late claims / 2,000 joins, "and N more"), S17/S20/A10 (re-measure claim time and late beacon after 1.5.x), then copies: B05, B06, TT-31, SL-17, LB-03 (Luck gets Pause in WP-11).
Cloud: code + falsified tests. Laptop: live timing run and deploy.
Depends on: owner questions Q1, Q2, Q3. Owner decisions: yes.

**WP-03 Tambola player device reality and proof** - P1 - Tambola (B29 same line in Bingo) - Effort M
Items: TA06 (Teams/Outlook full-screen "open in Chrome" step, returning number reclaims ticket), TA08 + A15 (wake lock held through pause and check-in; Bogey POST double store; "Type it again" dead end; check-in red text not cleared; /who not wired), A18 (DND tip and welcome-back line), TA11/S04/O08 (public-numbers line, last-5 strip, "How we keep it fair" page), C03 (employee ID with a space, not verified).
Cloud: yes. Laptop: real phone-size browser run (Chrome and WebKit at 320/360), deploy.
Depends on: nothing.

**WP-04 Tambola organizer set-up, gates and game-day control** - P1 - Tambola (Hosts, Co-hosts) - Effort L
Items: TA02 (check-in: one tap, disclosed on landing/guide/invite), TA03 (Quick start), TA04 (control key from a second device), TA05 (Paste chip, .xlsx), TA12/S15 (block Publish on blank prizes), TA13/S14 (draft reminders at 24 h and 2 h), TA14/S18 (not-joined list and reminder text), TA25/T02 (Host link reusable, refusal screens say who you are), TA30/A24 (console at 641-860 px and phone landscape), A25 (WebKit stall at 19 numbers, open phones not re-reading changed start time, account pre-open with another's e-mail - re-verify), O07 (re-run the 3,933-scenario organizer matrix), T03 (5 codes/hour, "Loading..." ~4 s).
Cloud: code + tests for everything except real-browser runs. Laptop: matrix re-run (heavy), deploy, mail/cron changes on Cloudflare.
Depends on: Q5 (check-in). Owner decisions: Q5.

**WP-05 Reports, e-mails and data lifecycle (Tambola first, then all games)** - P1 then P3 - Effort L
Items: TA20, S11/A06 (do not erase until report opened or 72 h; optional PDF attachment, ticket numbers only), S19/W28 (say real timing, 5-13 min), MC-21/B20 (save-winners-with-names now; names erased before gifts are handed out), B19/TT-16 (one deletion timeline generated from the lifecycle constants, copy-lint test for "22/23/24 hours"), TT-20 (Tic Tac Toe report, "data erased" mail), LB-20 (Luck report and log), A22 log.
Cloud: yes for code. Laptop: deploy, one real report mail and PDF checked in Gmail/Outlook.
Depends on: Q6 (retention rule, lawyer). 

**WP-06 Finance and IT trust pack, price honesty** - P1 (Tambola) then P3/P5 - all sites - Effort M
Items: TA15 (finance link in reminder, valid until start), TA16/B22/W11 (vendor pack page, sample invoice, PAN/GST status), TA17/B18/W10/SL-24 (remove computed was-price and permanent badge), B24/W12 (remove "Test a payment (Rs 1)", Sales login), TA23/W15/SL-27 (For IT page: domains, region, breach hours, link Trust page), TT-23 (quotation, PO box, TDS sentence), B23, SL-25, SL-26, LB-28, W09 (home price), W29 (unrelated products in footer), MC-13 (console price line and tax sentence).
Cloud: yes (pages and copy). Laptop: nothing except deploy.
Depends on: Q8. Payee stays IT Services by Rajat Agarwal via Razorpay only (owner rule); bank transfer is an owner decision.

### P2 - Master console

**WP-07 Master console: sign-in, errors, empty states** - P2 - console worktree c50a117 - Effort M
Items: MC-02, MC-03, MC-04, MC-05, MC-06, MC-07, MC-08, MC-09, MC-17, MC-18, MC-26, MC-27.
Cloud: yes (happy-dom tests, falsify each). Laptop: Resend SPF/DKIM/DMARC check and real test to Gmail, Outlook, a company mailbox; deploy.
Depends on: nothing. Do before any go-live.

**WP-08 Master console hand-over and game console pages** - P2/P4 - console + game repos (Bingo first per runbook order) - Effort L
Items: MC-01 (blocker), MC-11 (`to=pay` / `to=publish`), MC-16 (attention strip), MC-22 (player's screen view helper line, Retro/Modern, every game answers features.preview), MC-29 (free size 10 for all, Try a free game).
Cloud: yes for game-side pages + contract tests. Laptop: real-browser hand-over test per game (console -> game, new and existing), deploy.
Depends on: spec 100 wave-2 game console pages (BW/TW/SW/LW/TB0) and its C2/C3 packages (not re-read by me), WP-17 (test-login gate) before Snakes is shown, Q7 for which tiles show.

**WP-09 Master console: money, privacy, polish** - P2 - Effort M
Items: MC-10, MC-12, MC-13 (with WP-06), MC-14, MC-15, MC-19, MC-20, MC-23, MC-24 (self-host fonts, Legal block), MC-28, MC-30, MC-31, MC-32, MC-34, MC-35.
Cloud: yes. Laptop: deploy. Depends on: Q6, Q8.

### P3 - All games

**WP-10 Honest testing: observed proof per game** - P3 (also P1/P2/P5) - Effort M per game
Items: B27, TT-36 (TE0 Run A, B, C), LB-29, MC-37 (X2 10-width sweep + click-only walk), W30 (14 home cases + falsify), A26 (10 real-player tests per game), O01/O06 (live checks must show claim rows in D1; zero claims = FAIL), A25.
Rule for every game: real browser, click only, result re-read from D1, break each fix once to see the test fail, screenshots at 320/360/1280.
Cloud: only the in-process parts. Laptop: live runs, one at a time. Depends on: the game's own package (WP-11..14) being done first.

**WP-11 Luck by Chance** - P3 - Effort L
Items: LB-02 (first, S), LB-01 (decision Q4 then build), LB-03, LB-04, LB-05, LB-06, LB-07, LB-08, LB-09, LB-10, LB-11, LB-12, LB-14, LB-15, LB-16, LB-18, LB-19, LB-21, LB-22, LB-23, LB-26, LB-31.
Cloud: yes (engine and pages). Laptop: deploy, 10-player live run. Depends on: Q4 for LB-01; WP-15 guard tests; port worktree 961189f decision (finish or abandon).

**WP-12 Bingo catch-up** - P3 - Effort L
Items: B01, B02, B03, B04, B07, B08, B09, B10, B11, B12, B14, B15, B26 (game log), B28, B31, B33, B34 (ruling), plus B05/B06 via WP-02 and B25 via WP-16.
Cloud: yes. Laptop: deploy, live run. Depends on: Q1-Q3 for ending/pace text; site-bingo worktree (handover 105) may already cover wording.

**WP-13 Tic Tac Toe: finish 1.4.0 and go live** - P3 - Effort L
Items: TT-01 (notice now, S), TT-02, TT-03, TT-04, TT-05, TT-06, TT-07, TT-08, TT-09, TT-10, TT-11, TT-13, TT-14, TT-19, TT-22, TT-24, TT-26, TT-27, TT-28, TT-30, TT-32; run TE0 A/B/C (WP-10) before anything else is called ready.
Cloud: yes. Laptop: TE0 runs, deploy, switch to LIVE (owner only). Depends on: Q7.

**WP-14 Snakes and Ladders catch-up** - P3 - Effort L
Items: SL-03 (first, S), SL-05, SL-02, SL-04, SL-06, SL-07, SL-01 (nicknames, same 24 h retention), SL-08, SL-09, SL-10, SL-11, SL-12, SL-13, SL-15, SL-16, SL-19, SL-21, SL-29, SL-33, SL-34.
Cloud: yes. Laptop: deploy, live run. Depends on: WP-17 (test logins), Q7. SL-01 needs a privacy OK (recommend yes: same 24 h life as other join data).

**WP-15 Wording sweep with guard tests, all games** - P3 - Effort M
Items: TA27, B16, B17, TT-17, TT-18, SL-22, SL-23, LB-13, LB-23, W13, W17, W18, W32, plus TT-15 reword ("simulated with 1,000 players"). Port the Tambola 1.6.7 failing-if-it-returns test for "private", add "engagement", "closed-group", "ticket" outside Tambola, "decided by fate", stale clock/speed lists, "22/23/24 hours".
Cloud: yes entirely. Laptop: deploy. Depends on: Q1 (speed/ending copy).

**WP-16 Rehearsals and honest demos for the other games** - P3 - Effort L
Items: B25, SL-14, LB-27, W07, W31. Reuse Tambola 1.6.0 mechanism. Cloud: yes. Laptop: deploy. Depends on: WP-12..14 stable.

**WP-17 Security hygiene: test logins and TEST mode** - P3/P2 - Effort S
Items: MC-25 (Snakes demo1/2/3 code 123456 on live), TT-21 (testlogins.ts), same check in Bingo and Luck, LIVE-mode falsified test. Cloud: yes. Laptop: deploy. Depends on: nothing. Do before go-live of any TEST-mode game.

**WP-18 Scale and operations** - P3/P4 - Effort M
Items: LB-17 (Luck polling), SL-32 (join in flight at start, throws read range, 200-phone storm), C04/C06 (control delay by size, claim write batching, join storm), MC-36 (service-worker cache name and ?v=), A04 (deploy guard script), X01 (Pages 4 h cache, per-origin storage on domain move), uptime alarm PR #2188 merge.
Cloud: code. Laptop: load runs and deploy. Depends on: nothing.

### P4 and P5 - Consoles of all games, websites

P4 (per-game consoles) is carried by WP-04 (Tambola), WP-08 (hand-over and wave-2 pages), and the organizer items inside WP-11..14. No separate package.

**WP-19 Websites and the games bar** - P5 - Effort L
Items: W01 (sign-in label), W02 (six-item header via brand kit, Tambola first), W03 (redirect games. to home.), W04, B32, SL-31, TT-35, LB-30, MC-33 (canonical bar), W05, W06, W07, W08, W14, W16, W19, W20, W21, W22, W23, W25, W26, W27.
Cloud: yes for pages. Laptop: deploy, run the 14 home cases first (WP-10 W30), uptime alarm. Depends on: Q8 (W09), owner decision on old hub (HOME_SITE_DESIGN decision 3) and Lucky Draw tile (decision 7), site-bingo and site-luck worktrees merged or dropped first.

Suggested order of starting: (1) the S blockers and quick wins together: TA01, SL-03, TT-01 and LB-02 notices, WP-17; (2) WP-01 and WP-07; (3) ask Q1-Q4 and start WP-02 and WP-04; (4) WP-05/WP-06; (5) WP-08 and WP-11..14 in parallel cloud sessions; (6) WP-10 live runs one game at a time; (7) WP-15, WP-16, WP-18, WP-19.

## 9. Owner questions (at most 8, each with a recommendation)

1. Stop at the last prize or keep calling (A07 / S05 / O02)? Recommend: stop when every prize is awarded (your 23 Oct order) for new games in all games, end sentence says "All prizes were awarded after N numbers", and an organizer box "Keep calling all numbers" off by default.
2. After Pause then Resume, restart a full gap (12 s) before the next number, with a 5-second "restarts in" count on phones (S06/A09)? Recommend: yes, all games, and no claim pause (Option C stays).
3. A claim made on the very last number (90) - does it win (T01/TA29)? Recommend: yes, a claim that arrives while that number is the latest wins; test required.
4. Luck by Chance: real press window with a 409 late-press, or honest "dice rolls by itself" (LB-01)? Recommend: wording fix this week so no prospect is misled (option A), real press window (option B, your own rules in RULES_luckbychance.md) before the first paid sale; do not ship the demo until one is chosen.
5. Check-in (TA02): keep mandatory for prize eligibility? Recommend: keep, but one tap "I am here" with the name shown, say it on the landing, guide and invite text, and let the organizer switch it off per game.
6. Data lifecycle (TA20/B20/MC-21): erase only after the report is opened or 72 hours, and keep winners' names for the organizer alone for 7 days so gifts can be handed over? Recommend: yes, with the lawyer's answer on the 20 h / 24 h wording before it is published.
7. Tic Tac Toe, Snakes and Ladders, Luck by Chance are in TEST mode: stay hidden and show "Opening soon", or flip LIVE? Recommend: stay in TEST with a plain notice and do not send prospects until each has passed its 10-player live check; Bingo goes first on the console. Also decide the free demo size (10 for all) and keep Lucky Draw as a greyed "coming soon" tile.
8. Price and vendor honesty (W09/W10/B18/SL-24, TA16): one price list on home, drop the computed "was" price and permanent 50 percent badge, add a vendor pack (name, PAN, "GST not charged" explanation, sample invoice)? Recommend: yes; show one honest price; bank transfer against a pro-forma only for packs of 500 and above if your accountant agrees.

## 10. Not verified by this pass

Only TA01 was re-checked by the judge. No browser, test run or live write was done. Reviewer caveats that stay open: layout at 641-860 px (TA30, A24), the Teams/Outlook flow (TA06), screen-lock behaviour (TA08, TT-04, LB-22), 1.4.0 Tic Tac Toe behaviour (all TT rows), which home commit is live (W30), the Luck port worktree state, whether erasure waits for the report in 1.6.7 (TA20), the console invoice GET authorisation (MC-15), and what the Snakes and Luck Create tiles do once their bridges are live. Spec 100 package letters (C2/C3) were not re-read.

