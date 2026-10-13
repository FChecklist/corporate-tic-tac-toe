# Spec 4 (owner-approved 2026-10-08): step write-ups, Phase 3, Phase 4 (Google sign-in and Host first open)

Same style rules as specs 1 to 3 (owner non-technical; plain words; short sentences; no dropdowns).

## A. "About this step" write-ups (console, Organizer and Host)

**Status for Corporate Tic Tac Toe (checked 2026-10-13).** The console (`zc.js`, `ABOUT`) still carries the sister product's wording for steps 1 to 4 and 9 (prizes such as Line and Four Corners, cards, brand moments, "the first number comes 2 minutes after the start"). Below is the wording that is true for a tournament; `zc.js` has to be changed to match (see "Not true yet"). Owner change 2026-10-09 kept: the console has TEN steps (7 Check and publish, 8 Pay, 9 Run the tournament, 10 After the tournament).

Show a small box under the talking line of each open step, 12 px, grey-brown text, a short title "About this step", at most 5 short lines, always visible.

1 Your tournament: "This is the basics. Pick the occasion, the day and the time. Times are in your own time zone. Players can join before the start. You press Start when you are ready. You can change all this until the tournament starts."

2 How it plays: "Pick the biggest crowd you expect, or type your own number. You see the price when you pay. Who can join: 'Only people on a list' keeps it private, and people not on a list wait for you to let them in. 'Anyone with the link' lets people in at once. Each player can invite family or colleagues if you switch it on."

3 Prizes: not used. A tournament has no prize patterns. Any gift comes from you, outside this product, and the software picks the winners from the rules; nobody can change them, not even us.

4 Brand moments: not used. The company name and colour you set show at the top of the player page.

5 Your team: "A Host runs the tournament with you. A Host needs a name, a mobile number and an e-mail. A Co-host invites people and can pay. A Co-host needs a name and a mobile number only. Players need only a display name. Send each private link to one person only."

6 Invite and share: "Add your people here, one by one, from your phone contacts, by pasting from Excel or by uploading a CSV. Each person gets their own WhatsApp link. Or share the one common link in a group. People who are not on your list wait under 'Waiting to come in'. You can let them in one by one or press 'Approve all'. The big screen link is for the laptop connected to the room screen. It shows the bracket, the live boards and the results."

7 Check and publish: "Look through your tournament and change what you need. Publishing is free. Players can join after you publish."

8 Pay: "Pay once, before the start time. The Organizer, a Host or a Co-host can pay. You can cancel before the start time: there is no refund, your payment stays as credit for your next tournament for 365 days."

9 Run the tournament: "Open the host page. Choose one against one or team against team, and how long a player has for a move. Press Start: the list of players closes. You can pause for everyone and resume. The software picks the bracket and the winners."

10 After the tournament: "A few minutes after the end, a report link is e-mailed to the Organizer. Players' names are erased within 24 hours of the end. We keep the winners as seat numbers and the Organizer's and Hosts' details for 365 days. You can erase players' data earlier."

Also: **Your account** section: "These are for the Organizer only: your AI link, sign-in keys and records. Closing your account deletes your tournaments." **Co-host steps** (My page): step 1 "You can see the tournament and what you may do."; step 2 "Add your people. Each gets their own WhatsApp link. You can bring up to your limit."; step 3 "One payment is enough. If someone has paid, you will see Paid." Check every line against the code before shipping; correct the line, not the code, if the code says something different, and tell the owner.

## B. Phase 3 (brand strip, preview, pay link anyone can open): items 11 to 13 of spec 2, with the notes there (no preview for a tournament yet).

## C. Phase 4: "Continue with Google" and the Host first open

Decisions: yes to all three. (1) The Organizer's mobile is asked at Publish, not at sign-up. (2) A Host's personal link is a one-time entry link; later sign-ins use e-mail code or Google. (3) The button says "Continue with Google".

1. **Google sign-in** (Organizer and Host; sign up and log in; also on the console sign-in). `GOOGLE_CLIENT_ID` env (public id). Browser: Google Identity Services button (`https://accounts.google.com/gsi/client`). Server: `POST /api/auth/google {credential}` verifies the ID token (signature against Google's keys at `https://www.googleapis.com/oauth2/v3/certs`, `iss`, `aud` = our client id, `exp`, `email_verified` true) and then does exactly what the e-mail-code sign-in does (same session/key minting, same rate limits). Sign-up with Google creates the Organizer account for that verified e-mail. For a Host the Google e-mail must equal the e-mail the Host was added with; on mismatch say "This link is for a***@acme.com". No Client ID configured: hide the button and answer 404. Request only the e-mail (openid email scope); store nothing else from Google. CSP: allow the Google script/frames/connect only on the pages that show the button. If the page is inside an embedded browser that Google refuses, show a calm line "Open this page in your browser, or use an e-mail code." Add Google to `subprocessors.html` and the privacy text. Tests use a fake signing key injected for tests (never call Google). Write `docs/GOOGLE_SIGNIN_SETUP.md` (plain words, the owner's 10 steps in Google Cloud Console; no secrets).
2. **Host first open.** `POST /api/org/host {label, email?, mobile?}`: at least one of e-mail or mobile; if e-mail given we e-mail the Host their link, if mobile given the console shows a WhatsApp button (wa.me with the Host's number). The link opens a "Finish setup" screen: verify an e-mail (Google or a 6-digit code to that e-mail; skipped if the Organizer's e-mail was already verified through the link e-mail? no: always verified once) and add a mobile number (typed, not verified) if missing. Then the console opens. Console work needs verified e-mail + mobile. The link expires after 7 days if unused and is one-time entry: once the e-mail is verified, later devices sign in by e-mail code or Google (add `host_login` mapping e-mail -> Host key row). The Organizer can send a new link (revokes the old). Logging in to the console always needs the e-mail (Organizer and Host).
3. Sign-in pages: `signin.html`, the home "Log in", console sign-in, and the Host finish-setup screen all show "Continue with Google" above "Sign in with an e-mail code".

## Not true yet (Tic Tac Toe)
- `zc.js` `ABOUT` lines 1 to 4, 9 and 10 are still the sister product's (cards, prizes, brand moments, "the first number comes 2 minutes after the start", "a few minutes after the game"). Lines 5 to 8 are shared with the sister product; the console already says there is no refund and that a cancelled paid game becomes credit.
- `docs/GOOGLE_SIGNIN_SETUP.md`, named in item C1, does not exist in this repo. "Continue with Google" appears only when `GOOGLE_CLIENT_ID` is set, so it is off.
