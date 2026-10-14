# Privacy and the life of a tournament's data (the data map, as built, 2026-10-15)

This is the data map for gates D1 and D2. It is written from the code, not from memory: `apps/edge/src/tournament.ts` (tables `ttt_t`, `ttt_e`, `ttt_p`, `ttt_m` and the mailbox tables `ttt_mv`, `ttt_r`, `ttt_b`, `ttt_f`, `ttt_x`, `ttt_z`), `apps/edge/src/consent.ts` (table `consent_log`), `apps/edge/src/worker.ts` (join, schema), `apps/edge/src/lifecycle.ts` (deletion), `apps/edge/src/pii.ts` (sealing), `apps/edge/src/audit.ts` (security log). If you change one of those, change this page in the same step.

Short version: a player gives a display name and nothing else. The organizer is the controller of that name; we are the processor. All players' names are deleted 23 hours after the tournament ends (the promise is "within 24 hours"). The winners record (seat numbers only) and the organizer's details stay until 00:00 IST at the end of day 365, then everything goes. We keep billing data for audit and tax reasons, apart from the game data.

## 1. The player notice (the two boxes shown before the name is asked)

The wording is in `apps/edge/src/consent-text.json` (point K4); the page fetches it from `GET /api/consent/text?kind=K4`. Two boxes, never ticked in advance, both before any name field works:

- A: the name is used for this game only and deleted within 24 hours after it ends; who invited the player is recorded until then; the results are kept for 365 days without names; billing data is kept for audit and tax reasons (that is the organizer's, not the player's); the notice is available in Hindi on request.
- B: the player is 18 or older. Nothing else: there is no "or on a parent's device" alternative (adults only, Terms clause 12).

The Join button stays disabled until both are ticked, and the server refuses a join without them. The server stores one row per acceptance in `consent_log` (table below): the seat id, the point (K4), the game id, the Terms version, the boxes, a hash of the exact wording, and the time. It holds no name, number, address or device. When the Terms version changes (it is `TERMS_VERSION` in `apps/edge/src/brand.ts`, today 2026-10-15; the wording file `consent-text.json` carries the same value), the next join asks again.

The full notice is the stand-alone Privacy page (`apps/web/public/privacy.html`): who is responsible, what is collected and why, how long, who receives it, rights (including naming another person), adults only, cookies and the Grievance Officer by name.

<!-- notice:start -->
asked_from_player: name
asked_if_organizer_switches_on: none
<!-- notice:end -->

The block above is read by `apps/edge/test/data-map.test.ts`: it fails when the join notice mentions a field this list does not have, when this list has a field the notice leaves out, or when the player page asks for a field that is not listed.

## 2. The data map

"Who" means who holds or processes the data. **CF** = Cloudflare (Workers, D1 database, Pages: hosting and storage). The database is one D1 database kept in Cloudflare's Asia-Pacific region; the website is served from Cloudflare's global network. We do not run a backup process of our own.

### 2a. Players (and spectators)

| Field | Why | Where stored | Who | How long |
|---|---|---|---|---|
| Display name, typed by the player (2 to 40 characters, markup removed) | To show the player on the bracket and the results; so the organizer knows who took part | **Sealed** (AES-256-GCM) in `participant.pii` at join | CF | Deleted 23 h after the tournament ends |
| The same name, in the clear, written when the host presses Start | The bracket, the board and the results must show it, and a sealed name cannot be shown to thousands of phones cheaply | `ttt_p.name`, and for a one-against-one tournament also `ttt_e.name` | CF | Deleted 23 h after the end |
| The same name inside the stored top-100 ranking (and each entrant's name) | The results screen | `ttt_t.ranking` (JSON, up to 100 places); team names in `ttt_e.name` | CF | Ranking set to empty and `ttt_e` deleted 23 h after the end |
| Seat number, player id (`pid`, made of the seat number and a hash) | To tell players apart without a name; the winners record uses the seat | `seat`, `participant.pid`, `ttt_p.pid`, the seat list `kv seats-base/<id>` | CF | Seat, participant and the seat list deleted 23 h after the end |
| A hash of the phone's random device id (first 32 characters of `sha256("dev" + tournament id + device id)`) | One place per phone; the moves of a place come only from the phone that joined | `seat.dev` | CF | 23 h after the end |
| A second hash of the same device id, used as the lookup key for "the same person again" | Same | `participant.phone_hash`, `seat.ph` | CF | 23 h after the end |
| Join time; a round number if the player joined after the scheduled start time | Report; late-join marker | `participant.joined_ms`, `seat.jr` | CF | 23 h after the end |
| How the player joined (direct, or through an invite link), who invited them, invite category, role flag (organizer, host, co-host), "removed by the organizer" flag | Invite counts; the organizer can remove a person | `seat.src`, `seat.inv`, `seat.cat`, `seat.role`, `seat.blocked` and a row in `person` (name sealed, hashed key, inviter, status) | CF | 23 h after the end |
| Consent record: seat id, point, game id, Terms version, boxes, hash of the wording, time | To show the boxes were ticked | `consent_log` | CF | K4 rows: 23 h after the end. Organizer rows stay with the account |
| A request the player made to see, correct or delete their data, or to name another person who may use these rights for them (DPDP Act s14; kind `nomination`; the person is named by e-mail to the Grievance Officer): player id, kind, a short note, three times | To answer within the promised time (7 days) | `data_request` (no name, no number) | CF; the organizer and the owner are told by e-mail (Resend) | 23 h after the tournament ends |
| The moves: which square, at what time, by whom (opaque player id), the clocks, who had X, the result of each game and board | The server stores every move as it is sent and stamps it with its own clock, so a phone can reload and anybody can replay the match; the server does not check a move against the rules | `ttt_mv` (moves), `ttt_r` and `ttt_b` (reports and agreed results), `ttt_f` and `ttt_x` (finish reports, notes for the Organizer), `ttt_m.data` (who plays on which board), `ttt_z` (pause times). **Player ids only, no names.** The moves, reports, finish reports and notes are deleted with the names 23 hours after the end; the agreed results, the pause times and the winners record stay | CF | Moves and reports 23 hours after the end; the rest until 00:00 IST at the end of day 365 |
| Tournament settings and the seal: format, team size, move clock, the sealed seed and secret, number of players, start and end times, the champion's entrant id | The draw can be checked by anybody after the start | `ttt_t` (the names in it are in the ranking column above) | CF | Until the end of day 365 |
| Winners record: the opaque seat numbers of first to fifth place | Proof of who won, with no name | `winner` (and `settled`, which is deleted at 23 h) | CF | Until the end of day 365 |
| Mobile number | **Not asked from players.** The player page has no phone field. The Worker can still take one if the organizer's setting `join` is `phone`, but this page would then fail to join, so the setting is not used. A number appears only if an organizer puts one in a people list (2c). | `participant.pii` (sealed) if ever given | CF | 23 h after the end |

### 2b. What a player's phone keeps (on the phone, not on our servers)

The full list is `apps/web/storage-registry.json`, and the same sentences are on the Privacy page (`legal.html`). `apps/web/test/storage-notice.test.ts` fails when a script uses a key that is not listed.

| Field | Why | Where | How long |
|---|---|---|---|
| Random device id (32 hex characters) | To prove "this is the same phone" | Browser storage `ttt:device` | Until the player clears the browser data |
| The player's `pid` for each tournament, and the last tournament id opened | To reopen the game after a reload | `ttt:<id>:pid`, `ttt:last` | Same |
| Saved page files (service worker cache) | The pages open fast | Browser cache | Same |

### 2c. Lists the organizer types or pastes (people lists, waiting room)

| Field | Why | Where | Who | How long |
|---|---|---|---|---|
| Name and mobile number of each invited person | To send a personal invite link | `person.pii` (sealed), `person.ph` (hash of the number), `person.tok_hash`/`tok_sealed` (the personal link), inviter, status, who approved | CF | 23 h after the end |
| Name and mobile number of a person waiting to be let in | The waiting room | `waiting.pii` (sealed), `waiting.ph` | CF | 23 h after the end |

Honest note: the shipped player page (`ttt.js`) does not send a personal-link token or an invite code, so a player who opens a personal link joins as a direct player. The lists and the waiting room exist in the Worker and the organizer console; whether they fit a tournament is not settled (see section 8).

### 2d. Security log (kept for security, disputes and the law; read only by the owner)

Every action that writes something (join, consent, each move, start, pause, console edits) adds one row to `audit_log` (`apps/edge/src/audit.ts`). Plain reads (the board view, the big screen) add nothing.

| Field | Why | Where | Who | How long |
|---|---|---|---|---|
| For a **player's** action, the personal part: full network address, browser string, browser and system name, network number, the raw device id and its hash, the time and zone the phone says it has, the fields sent (for a join: the name; for a move: `pid`, `cell`, `ply`; passwords, codes, keys and card words are replaced by "[redacted]") | Security, disputes, fair play | `audit_pii.sealed`, sealed under a **per-tournament key** whose salt is in `eng_key` | CF | **Destroyed 23 h after the end** (crypto-shredding: the salt and the blobs are deleted, so the key can never be made again) |
| For a player's action, the non-personal core: event type, server time, country, status, request reference, a hash of the personal part | Counts, hash chain | `audit_log` | CF | Until the end of day 365 |
| For the **organizer, host, co-host or an AI key**: the same fields, whole, sealed with the platform key | Security, disputes | `audit_log.sealed` | CF | Until the end of day 365 |
| For an **anonymous visitor** (no tournament and no organizer: a refused request, a failed payment, a wrong key): the same fields, whole, sealed with the platform key, but the network address is first cut to its first part (IPv4 /24, IPv6 /48, `truncateIp` in `audit.ts`). These rows live in their own chain, `anon` | Security, disputes | `audit_log.sealed`, chain `anon` | CF | **90 days** (`sweepAudit`), not 365 |
| Owner access log: when the owner read or downloaded a log | Accountability | `audit_access` (no personal data) | CF | Kept |
| Deletion certificate and anonymous statistics (counts by event, country, AI vendor) | Proof that deletion happened | `audit_cert`, `audit_stats` (no personal data) | CF | Kept |

### 2e. Network-address hashes for limits, and public-page records

| Field | Why | Where | Who | How long |
|---|---|---|---|---|
| A short hash of the network address (16 characters) used as a counter key for "too many joins per minute and per day from one address" | Free-plan protection | `kv jbm/...`, `kv jlim/...` | CF | 2 days  |
| Monitoring from `rum.js` on the pages, including `z.html`, `big.html`, `host.html`: page path (no query string, so no tournament id), referrer site name, device class (mobile, tablet, desktop), speed figures, script errors, and for a failed or slow API call the API path (which contains the tournament id) and the time it took. No cookie, no network address, no name. Country comes from Cloudflare. | To see crashes and slowness | D1 table `telemetry` (`pages/functions/api/telemetry.ts`) | CF | 90 days (the clean-up runs on about 1 write in 100)  |
| Visits to the **public website pages only** (home, legal, pricing, sign-in, payment entry; never `z`, `big`, `host`, `zc`, `report`): visitor id, shortened network address and a keyed hash of it, source, landing page, device, country, city, sections seen, choices made. With Global Privacy Control or Do Not Track, only anonymous daily counters. | To see how companies find the site | `visit_session`, `visit_event` (`apps/edge/src/visits.ts`, `v.js`) | CF | 365 days, then rolled into anonymous daily totals (`visit_agg`)  |

### 2f. Organizers, hosts, co-hosts, partners

| Field | Why | Where | Who | How long |
|---|---|---|---|---|
| Organizer e-mail (sealed, plus a hash for sign-in), sign-in keys, terms version accepted, the lasting AI key (sealed) | Sign-in, invoices, mail | `organizer_key`, `organizer_email`, `kv orgmail/ aikey/`, `organizer_terms` | CF; Resend sends the mail; optionally Google if "Continue with Google" is switched on | While the account exists (the organizer can close it) |
| Organizer's e-mail and mobile number, confirmed at Publish | Contact for the tournament and the report e-mail | `kv contact/<id>` | CF | End of day 365 |
| Tournament settings the organizer chose: occasion name, scheduled start, size limit, invite-only, invitation policy, time zone, brand name, accent colour and small logo (not personal) | To run the tournament | `engagement` (`config` column) | CF | End of day 365 (a draft nobody published: 30 days) |
| Host name, e-mail or mobile (sealed), label | A Host runs the tournament | `organizer_key` (`email_sealed`, `pii`, `label`) | CF, Resend | Host: while the key lives. A Co-host's name and mobile are deleted with the players' data (23 h after the end) |
| Sign-in codes and links (hash only) | Sign-in | `login_code` | CF | 10 minutes; row deleted 1 day after expiry |
| Mail outbox | A mail that failed is retried | `outbox` | CF | A sent mail keeps no body; every row goes after 3 days. `purgeOutbox` runs from the 5-minute tick every hour |
| Mail delivery events from the mail service (bounced, complained, delivered): a one-way hash of the address, the address with its middle hidden (j***@example.com), the subject line, the kind, the time | So the owner can see which mails did not arrive and tell the organizer | `mail_bounce` (no name, no full address) | CF; the mail service (Resend) sends the event | 90 days |
| AI work link: log of each call (time, key id, call, status, network address, program, country) | The organizer can see what their AI did | `ai_audit` | CF | 365 days |
| Partner (refer and earn): name, random code, hashes of phone and e-mail | Commission | `partner`, `commission` | CF | While active; commissions kept as accounting records without a link to a person |

### 2g. Money

| Field | Why | Where | Who | How long |
|---|---|---|---|---|
| Payer name, organisation, e-mail, mobile, country, GSTIN; amount, tax, pack, Razorpay order and payment ids | Invoice, tax, accounting | `payment`, `invoice`, `entitlement`; a copy of the organizer's invoice details and who paid in `legal_party`, written at payment and again just before the tournament is deleted | CF; **Razorpay** takes the payment, only through the central service "IT Services by Rajat Agarwal" (site `corporate-tic-tac-toe.pages.dev`, product `corporate_tic_tac_toe`, plan `tictactoe_pack_<N>`) | We keep billing data for audit and tax reasons, separate from game data; not deleted by code |
| Payment ledger and webhook log (one ledger for every product) | Reconciliation | `payment_ledger` view, webhook log | CF, Razorpay | Same |

No card or bank details are ever stored or logged. Players never pay. Price table: the same packs as Corporate Bingo.

## 3. Who processes data for us

| Processor | For what | Which data |
|---|---|---|
| Cloudflare | Hosting (Pages), the Worker, the D1 database | Everything stored above |
| Resend | Sending e-mail | Organizer and host e-mail addresses and the mail text. Never players: players give no e-mail |
| Razorpay (through IT Services by Rajat Agarwal) | Taking payment from the organizer | Payer details and amount |
| Google (optional) | "Continue with Google" for organizers and hosts, switched off until a client id is set | The e-mail address the person signs in with |
| IT Services payment service (`itservices-rajat-agarwal.pages.dev`) | Starts the Razorpay payment and records each payment for the organizer's invoice and our accounts (never players) | Payer details and amount |
| GitHub | Runs the scheduled jobs (the 5-minute deletion timer) and keeps a private copy of the payment records (organizers' payments only, never players) | Payment records; no player data |

**Supabase is not used by this product.** There are no third-party trackers: the only monitoring is our own (`rum.js`, `v.js`). The pages `subprocessors.html` and `legal.html` also name drand (a public random beacon) and YouTube; they apply only if an organizer adds a public beacon number or a video moment, which the Tic Tac Toe console does not do (see section 8).

## 3a. Where the data is, and what we do not claim

* The database is a Cloudflare D1 database in the **Asia-Pacific region** (read with `wrangler d1 info`, 2026-10-14: `running_in_region: APAC`, no jurisdiction pinned, no read replicas). That names a region, not a country.
* The website and the Worker run on Cloudflare's global network, so a request is handled in the data centre closest to the person. Data is stored only in the database above.
* We run **no backup of our own** and do not promise any backup period. Deletion is from our live database within 24 hours after the end. (A later step may add a backup process; this page and the legal pages will say so when it exists.)
* Resend, Razorpay and Google process what is listed above in their own countries.

## 4. The clock

1. The tournament ends when the final is decided (`finishTournament`: the strict ranking is made once, the podium goes to the winners record, the end time is written to `life`). If nobody finishes it, it counts as ended 6 hours after its scheduled start (`endBoundTtt`).
2. Minutes after the end the organizer gets one e-mail with a link to a report page. The organizer's own browser builds the report. The link works until 22 hours after the end (a reminder goes about 6 hours before it closes, if it was never opened).
3. **23 hours after the end** (`PURGE_AFTER_MS`), whether or not the report was opened, `erasePersonal` deletes: `participant`, `seat`, `person`, `waiting`, `ttt_p`, `ttt_e`, `ttt_mv`, `ttt_r`, `ttt_f`, `ttt_x`, the K4 rows of `consent_log`, `data_request`, the ranking JSON in `ttt_t`, the seat list and the report working copies (`kv seats-base/ rpt/ rptopen/ rptremind/ rptc/ seats-blk/`), the tournament's Co-host details (name, mobile number, key), and the personal part of the security log (crypto-shredded). An owner-set legal hold suspends this.
4. What stays: `ttt_t` (without the ranking), `ttt_m` and `ttt_b` (opaque ids), `ttt_z` (pause times), `winner` (opaque seat numbers), `life`, the organizer's details, the security log's non-personal core, payments and invoices.
5. **00:00 IST at the end of day 365** after the end (`fullDeleteAt`): `eraseEverything` deletes the rest of the tournament (`ttt_t`, `ttt_m`, `ttt_b`, `ttt_z`, `winner`, `life`, the engagement, the Co-hosts, the security log and its keys). Before that, the organizer's invoice details are copied into `legal_party` (see 2g).
6. A tournament nobody paid for and that never started is treated the same way: its people's data is erased 23 hours after it was meant to end, and the game is closed (`unplayedPass`). A cancelled tournament erases 23 hours after the cancel.
7. The caller is the scheduled job: `POST /api/lifecycle/tick` every 5 minutes (Supabase `pg_cron`, and GitHub Actions in the `scheduler` repository). Any organizer request also nudges it as a safety net. The tick also forgets mail-log rows older than 3 days (every hour) and the health address `GET /api/status/health` raises `ok: false` with `overdue_purge` when a tournament is more than 30 minutes past its 23-hour deletion and still holds players (its clear-text names in `ttt_p` included).

Earlier deletion: the organizer can press Erase in the console; an AI assistant can only ask (the organizer confirms); the organizer can reply "delete" from the registered e-mail address (needs a confirmation code).

**A player can do it too**: "Leave this game" (`POST /api/z/<id>/leave`) and "What do you hold about me / delete me" (`POST /api/z/<id>/datareq`, `apps/edge/src/rights.ts`). The player proves who they are with the player id and the phone's own device id. Before the Organizer starts the tournament the seat and the details are deleted. After the start the player stays in the draw by id (the plan lists ids), blocked, with the name replaced by "Left player" in `ttt_p` and in a one-player `ttt_e` row and nothing personal left; a name already printed in the final ranking (`ttt_t.ranking`) stays there until the 23-hour deletion. The request is stored, the organizer and the owner are told by e-mail, the player is shown the promised answer time (`PROMISE_DAYS = 7`), and an erasure is carried out at once.

## 5. Test of the claim

`apps/edge/test/tournament.test.ts`, test "G18/D5": 24 hours after the end every name is gone (players, entrants, ranking); the opaque match record and the podium seats remain until the retention date. `apps/edge/test/privacy.test.ts`, `shred.test.ts` and `retention.test.ts` cover the shared deletion code.

## 6. Security log and crypto-shredding (how it works)

- Rows can only be added; each row carries the hash of the one before, so a removed or edited row is detected (`GET /api/owner/audit/<id>/verify`).
- A **player's** row is split. The non-personal core stays in `audit_log` with a hash (`pdig`) of the sealed personal blob; the blob lives in `audit_pii`, sealed under HKDF(`DATA_KEY`, a random 32-byte salt kept in `eng_key`, "participant/<id>"). Deleting the salt and the blobs makes the key impossible to make again, even for someone who holds `DATA_KEY`. The hash chain still verifies afterwards.
- Only the owner (platform key) can read or download the log, and every such use is written to `audit_access`. An AI vendor never receives network addresses or device ids.
- A legal hold set by the owner stops the 23-hour shredding and the 365-day deletion until it is lifted.

## 7. Wording for the privacy page

> **Security log.** To keep the tournament fair and to protect you and us, we keep a security log of what is done in each tournament: the action, who did it, the time, the network address, country, browser and device identifier. We never log passwords, one-time codes or card or bank details. It is encrypted and read only by us. The personal part of a player's rows is destroyed 23 hours after the tournament ends; the rest is deleted 365 days after it ends.

## 8. Known gaps (found while writing this page)

- The short player notice (box A) says what is kept and for how long; it does not name the security log of section 2d (network address, browser, device id, destroyed at 23 hours). The stand-alone Privacy page does.
- The shipped player page sends no personal-link token and no invite code (see 2c), so personal links, the waiting room and "who invited whom" do not reach players from this page.
- `subprocessors.html`/`legal.html` name drand and YouTube; this product uses neither unless an organizer adds a beacon number or a video.
- Names in non-Latin scripts print as `?` in the PDF report (standard fonts).
- Deletion is from our live systems within 24 hours of the end.
