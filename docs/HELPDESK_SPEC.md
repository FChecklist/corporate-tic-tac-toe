# Help Desk layer (owner order 2026-10-19)

Anyone can become a **Help Desk person** (like Refer and earn), reach out to an Organizer, prepare the game for them, and the Organizer publishes it with one tap. Nothing in the game's own rules changes: this layer only uses the roles and routes the game already has.

## The story (plain words)
1. The helper registers with their own e-mail (this is Refer and earn enrolment: e-mail code, mobile, agreement) and turns on "Help Desk" on the same page.
2. The helper types the Organizer's e-mail. An e-mail goes to the Organizer: "<Helper> asks to prepare games for you. Nothing is published or paid without your OK."
3. The Organizer opens the link, signs in (their normal e-mail code), reads the short promise, taps **Allow**. They can stop it at any time.
4. The helper now creates the game in the Organizer's account (with the real console, through a key that can do everything except publish and pay: the game's existing AI-key rights).
5. When the game is ready the helper taps **Ask the Organizer to publish**. The Organizer gets an e-mail with a summary and a button. The button opens a page where the Organizer confirms their e-mail and mobile, ticks the Terms box (the same K1 box as today) and taps **Publish**. The game is published by the Organizer, through the game's own publish route.
6. After publishing, the helper becomes the **6th Host** (does not use one of the Organizer's 5 Host places) and gets the normal Host link by e-mail, so they can change the game like any Host.
7. Every paid game the helper prepared earns the helper Refer and earn commission (same rate, same repeat rule, same self-referral block).
8. The helper also gets an AI work link for each client (the Organizer's AI key made for the helper; after publishing also the Host AI link).

## Data model (migration 0027_helpdesk.sql, mirrored in the worker's SCHEMA exactly like the other migrations; test/migrations.test.ts enforces this)
- `helpdesk_helper(partner_code PK, email_sealed, joined_ms, state)` : sealed e-mail (sealText), must match the partner's email_hash at joining.
- `helpdesk_link(id PK, partner_code, org_email_sealed, org_email_hash, org, state 'invited'|'active'|'stopped', token_hash, ai_key_hash, ai_key_sealed, host_hash, consent_ms, consent_text_hash, created_ms, accepted_ms, stopped_ms)` : `org` is filled when the Organizer accepts.
- `helpdesk_game(eid PK, link_id, partner_code, created_ms)` : which games the helper created.
- `helpdesk_pub(token_hash PK, link_id, eid, org, created_ms, exp_ms, used_ms, tmp_key_hash)` : the one-tap publish approvals (7 days, single use).

## Routes (new file apps/edge/src/helpdesk.ts, wired into worker.ts with the smallest possible hooks)
Helper (header `x-partner` = partner key, same as Refer and earn):
- `POST /api/helpdesk/join {email}` -> turn Help Desk on (email must match the partner's enrolled e-mail hash).
- `GET /api/helpdesk/me` -> {joined, clients:[{id, orgEmailMasked, state, games:[{eid, title?, published}], consoleUrl (with the AI key, only when active), aiLink, hostLink status}]}.
- `POST /api/helpdesk/invite {email, name?}` -> creates an 'invited' link, mails the Organizer. Limits: 5 invites/hour per helper, 3 invites/day per Organizer e-mail across all helpers, no duplicate active/invited link for the same helper+e-mail, max 50 active clients per helper. Never say whether the Organizer already has an account.
- `POST /api/helpdesk/request-publish {linkId, eid}` -> only if the game belongs to that org, is a draft, and was created via this link; mails the Organizer the approval link (token, 7 days, one outstanding per game; re-sending replaces the old token). Re-sending is limited to once per 10 minutes.
Organizer:
- `GET /api/helpdesk/accept/info?t=` (public, token) -> {helperName, state}.
- `POST /api/helpdesk/accept {t}` (needs the Organizer's signed-in master key) -> state 'active', records consent (text version HD1 + hash + time), mints the helper's AI key for this org (kind 'ai', created_by 'd', label "Help desk", stored hashed in organizer_key and sealed in helpdesk_link so the helper can reopen their console), mails the helper "X allowed you".
- `POST /api/helpdesk/stop {t | master key, linkId}` -> state 'stopped': revokes the AI key and the desk Host key, mails the helper. Games already published stay as they are.
- `GET /api/helpdesk/mine` (master key) -> the Organizer's helpers (for the console "Your team" list and the accept page).
Publish approval (token in the e-mailed link, no sign-in needed because the e-mail is the proof, same trust as the sign-in link):
- `GET /api/helpdesk/approve/info?t=` -> {eid, helperName, summary of the game (title/time/size/prizes) read through the normal summary logic, state}.
- `POST /api/helpdesk/approve/start {t}` -> mints a 30-minute master key (organizer_key kind 'master', expires_ms, created_by 'dp') for that org and returns it. The page then calls the EXISTING `POST /api/z/:eid/publish` with the Organizer's confirmed e-mail/mobile and the K1 consent, exactly like the console does.
- `POST /api/helpdesk/approve/done {t}` -> verifies the game is now published, marks the token used, revokes the temporary key, creates the helper's desk Host key (see below), mails the helper the Host link and "published".
Hooks in existing code (keep minimal, each with a test):
1. Game creation (`POST /api/z`) by an AI key that belongs to a helpdesk link: insert `helpdesk_game`.
2. The Host-count check (MAX_HOSTS) and the team list: desk Host keys (`created_by='d'`) do not count toward the 5; they show in the team list labelled "Help desk: <name>".
3. `POST /api/org/ai/replace|revoke`: must not revoke the helper's key (`created_by='d'`).
4. Unfamiliar-use alert: skip keys with `created_by='d'` (the helper uses their own devices).
5. Checkout (pay.ts): if the game has a `helpdesk_game` row, the payment's `ref` is the helper's partner code (overrides a browser ref); commission then follows the existing partner code. Self-referral stays blocked.
6. The AI manual for a helper's key mentions: you prepare the game for the Organizer; never publish or pay; to publish call `POST /api/helpdesk/request-publish` (or tell the helper to tap the button).

## Web pages (apps/web/public; plain words, short sentences, bright, phone first; add to pages/build.mjs file list, sitemap rules and the uniform footer links where the site lists "Refer and earn")
- `helpdesk.html` + `helpdesk.js` : helper home. Not signed in: "Become a Help Desk person" (links to the Refer and earn enrolment, then Join). Signed in: add a client by e-mail, list of clients with state, per active client buttons **Open console**, **Copy my AI link**, **Ask the Organizer to publish** (per draft game), and the helper's earnings link to partner.html.
- `helpdesk-accept.html` + js : the Organizer's page (token in the URL): shows who asks, the promise (HD1 text), sign-in (reuse the existing sign-in widget), **Allow** and **Stop**.
- `helpdesk-approve.html` + js : shows the game summary, asks e-mail/mobile confirmation + the K1 box (reuse the console's consent widget/CBConsent/TermsBox of this repo), **Publish**.
- Add "Help Desk" next to "Refer and earn" in the footer and the partner page (and update the uniform-footer expectation only if the repo's footer tests require it; the footers are generated from C:\ct\startup-coach-site\tools\ufooter.py so DO NOT edit footers in this repo's pages by hand: leave footers as they are and link Help Desk from the partner page and the organizer guide).

## Not in scope / guardrails
- No change to game rules, draws, winners, ticket logic, pricing, payments, ledger code beyond the single `ref` override.
- The helper can never publish, pay, close the account, see sign-in keys or change e-mail. A stopped link ends all helper access at once.
- Personal data: the helper sees only what they enter and, after publishing, what a Host sees. Accept text says so.
- E-mails: short, plain, no internal notes, seller line as the other mails.
- Test mode / live mode flags follow `testFlag(env)` like partners.
