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
G13 | true | apps/edge/test/tournament.test.ts ("G13: a replay is a new game with the same people (clone) and a fresh sealed seed") | Corrected: this row said false; the test exists and passes.
G14 | n/a |  | This product has no lucky draw.
G15 | false |  | Brand name and colour show on the player screen; scheduled brand breaks between rounds are NOT built for the tournament.
G16 | true | apps/edge/test/tournament.test.ts G16 (team, 14 simulated phones) and G12 (8 players) | 
G17 | true | tools/sim2/bracket-sim.ts (simulated phones), apps/edge/test/tournament.test.ts G17 and R14, packages/ttt/test/bracket.test.ts R21 (1,000 engine-level) | Sim result: 1,000 players (100 never show up), 999 of 999 matches, 0 stuck; 300 players in teams of 5, 59 of 59, 0 stuck. Numbers below.
G18 | true | apps/edge/test/tournament.test.ts G18; consent.test.ts (K4 rows) | Deletion verified by running the scheduled tick 25 hours later: names, entrants, ranking, stored moves and reports are gone. The scheduled job itself is not deployed (D5).
S1 | true | apps/edge/test/server-does-no-game-work.test.ts | The product rule: the players' phones do the computing, our server only stores and relays. The test lists every module the Worker may take from the packages folder and fails on any other game-logic import (it was shown to fail with a planted rule import, which was then removed). The only thing taken from the game package is the sealed-seed hash check.
S2 | true | apps/edge/test/tournament.test.ts M1-M10 | The mailbox: stores a move with the server's own stamp only if the pid is on that match and seq is the next number; keeps a result only when both reports match (or one is uncontested for 30 s); flags a mismatch for the Organizer; never evaluates a board; the Organizer can settle.
P1 | true | apps/web/public/index.html | Short plain sentences; not read by the owner yet.
P2 | true | apps/edge/test/pay.test.ts (price table), apps/web/public/pricing.html | Price table is copied from Corporate Bingo: OWNER to confirm.
P3 | true | apps/edge/test/free-launch.test.ts | 
P4 | false |  | Phone, tablet and laptop widths not checked in a real browser.
P5 | true | apps/web/test/pwa.test.ts | Service worker and manifest present; the offline screen was not tried on a device.
P6 | true | sim S10-01 and S10-02 (axe-core colour-contrast and basic WCAG 2 A/AA rules on home, pricing, host sign-in, player page, big screen) | Found and fixed: heading colour --accd (3.73:1) darkened to #8A5A00; two links whose spoken name did not contain the visible text. run on 2026-10-14
P7 | true | apps/web/test/seo.test.ts | 
P8 | true | apps/edge/test/visits.test.ts; apps/web/test/visits-dom.test.ts | First-party only.
P9 | false |  | OWNER confirms the contact details.
P10 | false | apps/web/test/gamesbar.test.ts (links listed) | Links not resolved (local only).
P11 | true | apps/web/public/404.html | 
P12 | true | apps/web/test/version-stamp.test.ts; pages/version.mjs; docs/DEPLOYS.md | pages/build.mjs writes pages/public/version.json {commit, dirty, builtAt, game} (served uncached at /version.json); docs/DEPLOYS.md lists the last deploys read from Cloudflare Pages (node tools/list-deploys.mjs refreshes it). README no longer says nothing is deployed.
O1 | true | apps/edge/test/account.test.ts, ai-signin.test.ts | E-mail code, no password.
O2 | true | apps/edge/test/pay.test.ts | 
O3 | true | apps/edge/test/pay.test.ts (order, verify, fulfil) | Mock Razorpay stand-in.
O4 | false | apps/edge/test/pay.test.ts (invoice and mail queued) | Mail is queued in a local outbox; inbox delivery not tested.
O5 | false | apps/edge/test/branding.test.ts | Name, colour and logo on the player screen yes; logo upload not re-tested for this product.
O6 | true | apps/edge/test/roles.test.ts, consent.test.ts (K5) | 
O7 | true | apps/edge/test/people.test.ts (see and remove); apps/edge/test/end-game.test.ts ("O7: End the tournament": the Organizer ends a running tournament and every phone says it is over, with no champion and no ranking; a move after the end is refused and the deletion clock starts at the end; ending while paused closes the pause; a stranger, a player, the AI key and a wrong key are refused; nothing to end before the start; twice changes nothing); apps/web/test/host-end.test.ts (the End button on the run page: asks first, sends one request with the organizer's key, shows Ended) | POST /api/z/{id}/ttt/end. The server only stores that it is over; the phones read it and stop. A tournament that was ended has no champion and no ranking.
O8 | true | apps/edge/test/no-other-game-words.test.ts | The organizer report now shows the tournament: when it started, the format, the bracket rounds, the move clock, the players, the champion and the final places. Still plain: no bracket drawing.
O9 | true | apps/edge/test/cancel.test.ts, reopen.test.ts, reschedule-window.test.ts, credit.test.ts | No refund; credit and 365-day move window.
O10 | true | apps/edge/test/privacy.test.ts (erase), tournament.test.ts G18 | 
O11 | N/A | same | Same reason: no contact routing exists, so there is no auto-reply to prove; the page makes no such promise.
U1 | true | apps/web/test/ttt-page.test.ts | Boxes come before the name field.
U2 | true | apps/edge/test/consent.test.ts (K4) | Version, wording hash and time are stored.
U3 | true | apps/edge/test/nameonly.test.ts; apps/web/test/ttt-page.test.ts | Display name only.
U4 | true | apps/edge/test/tournament.test.ts M2 | There is no private card in this game; a player can write only to their own match, from their own phone.
U5 | true | apps/edge/test/rights.test.ts ("U5: a player can leave at any time": before the start, after the start, only the player's own phone, a cancelled game); apps/web/test/rights-pages.test.ts ("Leave: asks first, then removes the seat and the name"); sim S04-15 (real Chrome) | Leave button and POST /api/z/{id}/leave, proved by the card id AND the phone's own device id. Before the start the seat and details are deleted; once the game has begun the seat stays as an anonymous id (every phone must work out identical results) and loses everything personal. The page says so in plain words. run on 2026-10-14
U6 | true | apps/edge/test/rights.test.ts ("U6 / D7: what do you hold about me, correct it, delete me": access shows what is held, correction, erasure, same request twice, TEST mode); apps/web/test/rights-pages.test.ts ("What do you hold about me"); sim S04-16 | Link on the player page 'What do you hold about me / delete me'. The page shows the promised answer time before sending; the answer comes back on the page (what is held) and the organizer and the owner (raajat.agarwal@gmail.com) are told by e-mail. PROMISE_DAYS = 7 is one constant (apps/edge/src/rights.ts). The 'answer' to an access request is immediate; the 7 days cover anything further. run on 2026-10-14
U7 | true | apps/web/public/terms.html (Grievance Officer clause) | 
U8 | true | apps/edge/test/consent.test.ts (K4 box B); terms clause 12 | 
A1 | true | apps/edge/test/pay.test.ts, legal.test.ts (ledger) | 
A2 | false | apps/edge/test/pay.test.ts (webhook) | Webhook handling tested with a stand-in; not the live log.
A3 | true | apps/edge/test/admin.test.ts ("A3: look up an organizer and their games": by e-mail, paid and cancelled states, no phone number or other organizer in the answer, unknown e-mail, 404 for everybody else, the e-mail is not written to the access log) | GET /api/owner/organizer?email=...
A4 | n/a |  | There are no refunds.
A5 | true | apps/edge/test/admin.test.ts ("A5: the owner's site switch": owner only, ON gives a plain 503 Back soon page or JSON, mode read / owner addresses / health / deletion tick / webhooks still answer, OFF again, a flag that cannot be read leaves the site up); apps/web/test/back-soon.test.ts (the cover over a page); apps/web/test/owner-desk.test.ts | POST /api/owner/site {off, note}. Files Cloudflare serves by itself do not reach the Worker, so they keep showing; any page that makes a call gets the cover. Owner page: owner-visits.html "Owner desk".
A6 | true | apps/edge/test/admin.test.ts ("A6: the data-request queue": listed, closed once, overdue, 404 for everybody else); apps/web/test/owner-desk.test.ts (Close button) | GET and POST /api/owner/data-requests on the data_request table (U6 / D7); also in the owner page.
A7 | true | apps/edge/test/admin.test.ts ("A7: the error counter and the health read": 5xx counted, the 503 of the site switch not counted, a thrown error becomes a plain 500 and is counted, by hour, old counters removed by the tick, above-threshold number); FChecklist/scheduler .github/workflows/uptime.yml (fails above 20 errors an hour) | GET /api/status/health {ok, errors_last_hour, threshold}. The check warns, not fails, for a game that is not deployed with it yet. Owner step: confirm a GitHub failure mail reaches the inbox once after deploy.
A8 | false |  | Not done.
A9 | true | apps/edge/test/secrets-list.test.ts (every name the code reads or declares is in config/SECRETS_NAMES.md; no row holds a value; no dead names) | config/SECRETS_NAMES.md: name, what it is for, where it is set. Names only.
E1 | false | apps/edge/test/account.test.ts | Queued in the local outbox; not received in a real inbox.
E2 | false | apps/edge/test/pay.test.ts | Same.
E3 | false | apps/edge/test/people.test.ts | Same.
E4 | false |  | No reminder mail for the tournament.
E5 | false |  | No separate results mail; the report mail at the end of the game carries the tournament report.
E6 | n/a |  | No refunds; a credit mail exists (credit.test.ts).
E7 | false | apps/edge/test/unplayed.test.ts | Same outbox limit.
E8 | N/A | apps/web/test/contact-honest.test.ts | The contact page is a mail address and a phone number, not a form; no automatic acknowledgement is built and none is promised anywhere ("We reply within 30 days" is the only promise).
E9 | true | apps/edge/test/owner-mail.test.ts ("E9: the owner is told of each paid order": once per payment whichever of the webhook and the verify call comes first, three at the same instant, TEST mode) | Mail to raajat.agarwal@gmail.com: game, plan, amount, transaction id, organizer name and e-mail. The once-only claim is one kv row per payment. Not tested against a real inbox.
E10 | false |  | No DNS lookup (local only).
E11 | n/a |  | No marketing mail.
E12 | true | apps/edge/test/admin.test.ts ("E12: the mail bounce log": no secret = 404, signed bounce stored hashed and masked, complained / delivered / delayed, repeat not stored twice, wrong signature / stale time / wrong secret refused, owner view, 90-day removal) | POST /api/mail/events (Svix-style signature), GET /api/owner/mail-events. Owner step (docs/OWNER_DESK.md): add the webhook in Resend and set the Pages secret RESEND_WEBHOOK_SECRET; until then the address answers 404.
E13 | false |  | Links not resolved.
D1 | true | docs/PRIVACY_AND_LIFECYCLE.md (sections 2 and 3); apps/edge/test/data-map.test.ts ("D1: the data map": every row has field, why, where stored, who) | Field, why, where stored, who processes, how long. Section 3a says where the data is and that no backup of our own exists.
D2 | true | apps/edge/test/data-map.test.ts ("D2: the notice and the data map agree": notice fields = data map fields = fields the player page asks for) | Join box A: the name only; the notice, the data map and the player page (ttt.js: no phone field) all agree.
D3 | true | apps/edge/test/consent.test.ts | 
D4 | true | apps/edge/test/nameonly.test.ts | 
D5 | false | apps/edge/test/tournament.test.ts G18 | Deletion code works; the scheduled job is NOT deployed.
D6 | true | apps/edge/test/legal.test.ts | 
D7 | true | apps/edge/test/rights.test.ts ("a request cannot be made for another player", "the request rows do not outlive the game", "asking the same thing twice ..."); sim S04-16; migration 0023 (data_request) | Access / correction / erasure request, end to end: stored (kind, note, received, answer-by), mailed to organizer and owner, closed at once for erasure. Request rows are deleted with the game's other participant data (23 h) and again with the game (365 days). Closing an open access / correction request is done by the organizer by hand; there is no console button for it (the row ages out with the game).
D8 | true | apps/web/public/terms.html | 
D9 | true | docs/BREACH_RUNBOOK.md | 
D10 | true | apps/web/public/subprocessors.html | 
D11 | true | apps/edge/test/data-map.test.ts ("D11: where the data is, and no backup claim"); apps/web/public/subprocessors.html, legal.html; docs/PRIVACY_AND_LIFECYCLE.md section 3a | Read with wrangler d1 info on 2026-10-14: the D1 database runs in Cloudflare's Asia-Pacific region (APAC), no jurisdiction pinned, no read replicas. The pages say: website on Cloudflare's global network, database in its Asia-Pacific region. The '7 days backup roll-off' claim is gone everywhere (no backup process exists).
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
R9 | true | apps/web/test/storage-notice.test.ts (every key a script keeps on a device is in apps/web/storage-registry.json; listed keys are still used; the cookies are exactly the ones listed; the Privacy page carries every sentence; a planted new key / cookie / computed key is noticed) | The only cookie is the first-party visitor cookie on the public pages. Page: legal.html section 'What your device keeps' (written by node tools/make-storage-notice.mjs from the registry).
R10 | true | sim S10-01..S10-04 (tools/sim2/scenarios/ui/s10-accessibility.mjs); legal.html section 'Accessibility' | Accessibility statement (short, plain) with a way to report a problem. axe-core 4.14 (dev dependency of the simulation only) finds no WCAG 2 A/AA violation on the five main pages at phone and laptop width. run on 2026-10-14
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
X3 | true | apps/edge/test/no-other-game-words.test.ts, apps/edge/test/ai-enablement.test.ts, tools/sim2/scenarios/ui (scan for words of other games) | The words of the old game are gone from what a person can read: the console, the player pages, the pay page (Razorpay description too), the home page, the AI helper manual, prompt files and guided path, the organizer report, the e-mails and the legal wording now speak of players, a tournament, seats and the top places. What still carries the old names is inside the code only: file names, comments, the database table `engagement`, route and field names, and the unused card engine in the built bundles.
X4 | false |  | See the false gates in this table.
X6 | true | tools/sim2/scenarios/ui (run: `node tools/sim2/scenarios/ui/run.mjs`) | Chrome simulation of the whole organizer-to-player journey, 103 scenarios (sign-up and log-in, the ten console steps, Host and Co-host, joining by name with the Terms boxes, payment, cancel / move / clone, whole tournaments played on Chrome phones, 360 / 768 / 1280 / 1920 px sweeps, a scan for internal notes and words of other games). See docs/RUNNING.md.
X5 | true | tools/sim2/bracket-sim.ts | Sim result: 1,000 players (100 never show up), 999 of 999 matches, 0 stuck; 300 players in teams of 5, 59 of 59, 0 stuck (also with 30 of the 300 away). Numbers below.

## Simulation result (tools/sim2/bracket-sim.ts, simulated phones running packages/ttt/src/phone.ts against the mailbox routes, fake clock)

| Run | Matches finished | Stuck | Flagged | How results were kept | Moves stored | Virtual time |
|---|---|---|---|---|---|---|
| 1,000 players, 100 never show up (`bun tools/sim2/bracket-sim.ts 1000 10 7 0`) | 999 of 999 | 0 | 0 | 899 both players agreed, 100 single report uncontested | 8,240 | 5 minutes |
| 300 players in teams of 5 (`bun tools/sim2/bracket-sim.ts 300 0 7 5`) | 59 of 59 | 0 | 0 | 295 boards, both players agreed | 2,623 | 2 minutes |
| 300 players in teams of 5, 30 of them away (`bun tools/sim2/bracket-sim.ts 300 10 7 5`) | 59 of 59 | 0 | 0 | 252 both, 43 uncontested | 2,373 | 6 minutes |

In the 1,000-player run the simulated phones made 45,014 reads and 10,595 writes (squares, clock-out claims, reports, registrations of later matches). The Organizer's page made the rest: the draw in two parts, a look every 12 seconds, the final ranking. The server took no decision: every square, clock-out claim, report and the final ranking was posted by a phone.
K13 | true | sim S10-03 (Tab reaches every control of the five main pages, in page order, with a visible focus ring); apps/edge/test/consent.test.ts (every box has a label) | Keyboard proved in real Chrome. A screen reader itself was not run; axe checks names, labels and roles.
X-7 | true | apps/edge/test/data-map.test.ts ("D2"); apps/edge/src/consent-text.json; apps/web/test/consent-pages.test.ts | Box A said name and mobile number although the game asks for a name only. Now: the name only. Terms version 2026-10-14.
