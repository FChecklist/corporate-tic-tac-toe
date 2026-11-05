# Go-live checklist: Corporate Tic Tac Toe (copied from handover 400, adapted 30 Oct 2026)
Rule: nothing goes live until EVERY row is ticked with evidence (test name, commit, screenshot path, deployment id). N/A only with a written reason from this game's own rules. TEST mode stays TEST until the owner says otherwise. Sections L (master console), M (campaign) and N (Lucky Draw) belong to other products and are not in this file.
Tic Tac Toe differences: no tickets, numbers, houses or prizes in the Tambola sense; it has a live bracket (one against one or team boards), a move clock (10/20/30/60 s), placings 1st to 5th and a top 10, 'Boards to settle' decided by a person, 20 h erase (lifetimes.ts), free demo for 10 people at /zc?demo=1.
Evidence column format: `[x] ... EVIDENCE: <test/commit/path>`; `[N/A: reason] ...`.

## A. Identity and lists
- [x] A1 EVIDENCE: apps/edge/test/ids.test.ts (7 pass, planted fault red), commit acef259/3b3641b; Employee ID cleaner: NFKC, uppercase, keep only A-Z 0-9 (1B-678, 1b-678, 1B/678, 1B 678 -> 1B678); 30-char cap after cleaning; empty refused with plain words.
- [ ] A2 Used on EVERY path: participant join/verify, organizer type, paste, upload, add-person, hash, duplicate check, invites, family, Host/Co-host, list viewer, exports, reports, console pass-through.
- [ ] A3 Email cleaner: NFKC, trim, remove inner spaces, lowercase (RAJAT1@DEMO.COM = Rajat1@Demo.com); never applies the ID cleaner to an email; typed email in an ID-criterion game is refused plainly.
- [ ] A4 Duplicates that appear only after cleaning are flagged in the list check ("same person after cleaning"), never silently dropped.
- [ ] A5 Hint text on screen: "The system will read this as ...".
- [ ] A6 Games created before the deploy instant keep old behaviour (EMP_CLEAN_FROM_MS / APPROVAL_RULES_FROM_MS set to the exact deploy instant).
- [ ] A7 Criterion choice: Employee ID or Email ID (one criterion), list decides; Email ID criterion exists in every game.
- [ ] A8 Test addresses only demoN@demo-test.invalid; fake mobiles; tags TEST-RUN.

## B. Organizer (5 steps + dashboard)
- [ ] B1 Step 1 date/time, occasion, time zone with players' local times, how the game starts, who calls the numbers.
- [ ] B2 Step 2 who is it for (people / families / extended), validation (system / by hand), criterion, list upload/paste/viewer for 600+ rows, optional list check.
- [N/A: no tickets or prizes: the game has bracket placings; size drop-down and price stay (TODO as part of step 2/3 adaptation)] B3 Step 3 tickets 1/2, size drop-down with price, prizes (tags, 1-5 wins, gift, worth up to), Full House 1st-5th, Super Bumper 1-10, Lucky Draw 1-3, A/B per ticket (where the game has it).
- [ ] B4 Step 4 Brand and Breaks (logo, up to 3/5 breaks, public link).
- [ ] B5 Step 5 check and publish with warning and read-back, Host/Co-host emails, payment, rehearsals at the end.
- [ ] B6 Game dashboard: Game ID always, 11 status pills with plain banners, share card, ready check, payment (Pay now / copy link), rehearsals, waiting table, board, prizes, feed, start-time-passed in red.
- [ ] B7 Previous-screens link both ways, remembered per browser; old-console-only links open the old console.
- [ ] B8 Existing games opened in the new console behave (draft resumes, manual/host-called/live games keep old console).

## C. Roles
- [ ] C1 Host: sign-in screens, same game link, limit 5, can change like organizer.
- [ ] C2 Co-host: sign-in, limit set by organizer/Host, invites, admits only own people, no payment.
- [ ] C3 Family Passes: 1+4, host card (5 passes), member needs no ID/passcode, approval, 15-minute cutoff, plays on the device clicked from.
- [ ] C4 Every role screen says who approves whom; role chips; "you were made Co-host by ...".
- [ ] C5 Authorization: nobody approves themselves; approver cannot act on another game; negative tests.

## D. Join and approvals
- [ ] D1 Listed ID / email: no extra info (name optional). D2 Open join: Name, Mobile, Email, automatic referral ID, cap, duplicate returns same ticket.
- [ ] D3 Not on list: approval by Host/Organizer (own link) or Co-host/Host/Organizer (Co-host link); first decision wins; 30-minute wait limit; polite decline; re-ask works.
- [ ] D4 Consent (version safe, nobody locked out mid-game, stale page gets "reload"), check-in, rehearsal join.

## E. Before the game (participant)
- [ ] E1 Landing ("You are invited ..."), not-listed, waiting, ticket before start, family waiting/approved, rehearsal, reconnect/back online, "Check-in opens ..." text.
## F. During the game
- [N/A: no numbers are called; the equivalent is the move clock (TODO row F1t)] F1 Timer cadence (auto 12 s; manual with 5 s lock), no repeats 1..90, same numbers on every phone, last numbers, "X of 90 called".
- [N/A: no tickets or crossing; the 3x3 board is the only rich element (Retro/Modern TODO row F2t)] F2 Crossing numbers, cross mark, Ticket A/B switch (greyed other), Retro and Modern, phone/tablet/laptop.
- [ ] F3 Claims: gold CLAIM, bogey question, claim sent, checking, correct, wrong, late, prize taken, bystander banners, simultaneous claims, auto pause and resume, Full House 1st-5th, per-house results.
- [N/A: no Super Bumper, Super Ticket or lucky draw in this game] F4 Super Bumper and Super Ticket (6 lines, X of 30 crossed), Lucky Draw, game ends when all prizes are claimed.
## G. After the game
- [ ] G1 Thank-you (Share + WhatsApp, no rules), you won, Game completed (Game ID), 30-minute message, completed report email, copy, delete.
## H. Messages and language
- [ ] H1 Plain English, "the system" not "we", "close group" never "private", Corporate <Game> full names, 24 h promise wording, fairness wording true per game, guide entry for every refusal, no raw error codes.
## I. Look and feel
- [ ] I1 Same look as approved mock (Retro burgundy+gold, Modern night navy+neon), minimal, one rich element, brand-kit header/footer, version + release date/time IST on every page, Rules row only inside the game.
- [ ] I2 Side-by-side compare against the mock for every screen, gap report all SAME or justified.
## J. Payment and data
- [ ] J1 Payee only IT Services by Rajat Agarwal via Razorpay; TEST games take no live payment; pay later link works 7 days.
- [ ] J2 Personal data gone within 24 h (incl. email key, rate-limit keys), game log 365 days (ticket numbers, organizer, winners, Host, Co-host), consent text/version consistent in every page, privacy/terms/DPA/trust pages truthful.
## K. Tests (every release)
- [ ] K1 unit, logic, wire, smoke; K2 regression of all earlier features; K3 streamed scenario matrix >= 1,000,000 REAL distinct scenarios; K4 one deliberate break per new rule (red then green); K5 full suites per folder on the CLOUD (results branch read); K6 typecheck 0 errors; K7 one-Chrome browser check 360/768/1280 light+dark; K8 skeptic audit with no open confirmed problem; K9 live-game gate = 0 and no campaign window; K10 deploy with rollback id noted; K11 live smoke on the real site; K12 version.json = commit; K13 register 150 + checklist updated.

## Tic Tac Toe own rows (added)
- [ ] F1t Move clock 10/20/30/60 s works on every phone; two clock-outs in a row lose the board; pause stops clocks.
- [ ] F2t Retro and Modern themes with the board as the only rich element.
- [ ] F3t Bracket: draws replayed with marks swapped up to 3 games, then fate; no ties in the final ranking; Boards to settle shown with who decides.
- [ ] F5t Team format (teams of 3 or 5, one board per seat) and one-against-one format both play to a champion.
- [ ] M1t Site: brand kit checksum, six-item menu, no "private", canonical/og/sitemap (apps/web/test/brand-kit.test.ts, seo.test.ts).
- [ ] M2t Demo: /zc?demo=1 makes a free game for 10 people.
