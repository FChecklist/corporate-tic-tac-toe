# Roles and the single-page console: build spec (owner-approved mock, 2026-10-07)

**Status for Corporate Tic Tac Toe (checked 2026-10-13).** This spec was written for the sister product and is kept because its roles, API contract, people rules and payment rules are shared code that Tic Tac Toe uses as written. Three things differ. (1) The console steps "Set Prizes" and "Set Brand Moments" and their write-ups are the sister product's; a tournament has no prize patterns or brand moments, and the Tic Tac Toe step for running the event is the block "Run the tournament" in the console, which opens `host.html` (format, move clock, Start, Pause, Resume). (2) The mock file `docs/mock/console-mock-v5.html` is not in this repo. (3) Where the text below says "game", read "tournament"; "guest" and "participant" are "player". The console in `apps/web/public/zc.js` has not yet been changed to match; see "Not true yet" at the end.

Owner is non-technical. All on-screen words: plain, short sentences, soft tone, no dropdowns (use tap-to-choose chips), hints at most 2 sentences in small font.

## The three roles (per game)

| Role | Count | Key prefix / `organizer_key.kind` | Can | Cannot |
|---|---|---|---|---|
| Organizer | 1 | master (existing) | everything, plus account-level: close account, retire sign-in keys, change e-mail, manage the AI link; adds Hosts (max 5) and Co-hosts (unlimited); pays | |
| Host | up to 5 | `cbh_` / kind `host` (existing prefix, widened rights) | everything inside a tournament: change the tournament, the brand strip and the guest invite option, publish, run it (choose the format and the move clock, Start, Pause, Resume), the guest list, add Co-hosts, pay | account-level actions (keys, e-mail, AI link, close account); add Hosts |
| Co-host | unlimited | `cbc_` / kind `cohost` (NEW) | invite people with an own link (chain mark), see how many they brought, pay | change the game; see the guest list / names; add anyone |

Paying: Organizer, Host or Co-host can each pay. ONE payment is enough for the game. Status shown everywhere as `Paid` or `Payment pending`; once paid the pending notice disappears.

Player invites ("let each player invite family or colleagues"): the Organizer OR a Host switches it on (not a Co-host: a Co-host must ask them). Two levels only: a participant invites up to `per` (1-4); a guest invited by a participant plays but has no invite link (already built and tested). Organizer/Host/Co-host invite any number.

"Account" (plain words in product): the Organizer's sign-in e-mail, sign-in keys, AI assistant link, and their games and records. Only the Organizer changes these.

## API contract (server side builds this, console consumes it)

All calls keep the existing header auth (`x-organizer: <key>` or Bearer).

- `GET /api/whoami` -> `{ kind: "master"|"ai"|"host"|"cohost" }` (add `cohost`).
- `GET /api/org/team` (kinds master, ai, host) -> `{ maxHosts: 5, hosts: [{ id, label, createdMs }], cohosts: [{ id, label, createdMs, brought }] }`. `id` = first 10 hex of the key hash (same id the retire-key route already uses). Never returns keys. A cohost key may NOT call it (403).
- `POST /api/org/host {label?}` (master, ai only; max 5 active) -> existing result plus `{ id, label }`.
- `POST /api/org/cohost {label?}` (master, ai, host) -> `{ ok, cohostKey, link, id, label }`, `link` = `${origin}/zc.html?k=<cohostKey>` style sign-in link that opens the Co-host view (use whatever the existing co-host link mechanism does for `cbh_`; keep `/ai/<key>` manual out of the Co-host path: a Co-host has no AI link).
- `POST /api/org/team/retire {id}` -> master retires hosts or co-hosts; host retires co-hosts only.
- `organizer_key` needs a `label TEXT` column (new migration `0014_roles.sql`; must apply cleanly on the existing D1 and be added to the test DB setup).
- Host rights: every engagement-scoped route a master may call EXCEPT account/key/e-mail/AI-link/close-account/host-creation routes. Use a clear allow/deny design (one `HOST_DENIED` set or per-route check) and keep a Host's AI-link behaviour unchanged (a Host has no AI link of their own; routes with `x-cb-link` handling stay as they are).
- Co-host rights: ONLY (a) `GET /api/whoami`, (b) invite-link/mark info for their own chain, (c) payment routes for a game of their org, (d) read the minimal game header (name, date/time, price, cap, joined count, payment status) via a new `GET /api/z/{id}/cohost` -> `{ name, startMs, cap, joined, brought, price, payment, inviteLink }`. Everything else 403 with a friendly message.
- Payment status in `GET /api/z/{id}/summary` and in `/cohost`: `payment: { status: "paid"|"pending", paidBy?: "organizer"|"host"|"co-host", paidMs? }`. Record who paid (`paidBy`) when a payment is fulfilled (use the key kind of the caller that started checkout). Idempotent: a second payment attempt for an already-paid game is refused or credited back exactly like today.
- `POST /api/checkout` and the pay page must accept any of the three key kinds (org-matched), not only master.
- The guest-invite setting `PATCH /api/z/{id}/settings {invites}` must work for Host keys (it is part of Host game rights).

## Console (single page, `zc.html`/`zc.js`/`zc.css`)

Visual/interaction spec = the approved mock `docs/mock/console-mock-v5.html` (an HTML fragment that uses the chat widget's CSS variables such as `--bg-tint-blue`, `--text-tint-blue`, `--surface-2`; read the code, it holds every word, colour and behaviour) PLUS these approved deltas from v5 (v5 has 8 sections; the approved version has 9):

- New section 5 "Your team" (green), before "Invite and share" (now 6, yellow); Check/publish/pay is 7 (orange), Game day 8 (violet), After the game 9 (red).
- Your team shows three role cards (Organizer blue, Host aqua, Co-host green) with ticks/crosses, "Your Hosts: n of 5" (add/remove, Organizer only adds Hosts), "Your Co-hosts: n (no limit)" (Organizer or Host adds), each person a private copy-link row, "Send it to that one person only."
- Invite and share = three boxed blocks: Player link (copy, WhatsApp, e-mail), Big screen (copy the link, open it on a laptop or phone connected to the room screen; shows the bracket, the live boards and the results, with display names only), Your guest list (modes: Type one by one / Paste from Excel / Upload a file; count; Send invites by WhatsApp or E-mail; privacy line).
- Host label "Host 1 of 5"; Co-host step 1 shows their own rights card; Co-host step 2 has the note: "Want your guests to invite their own friends? Ask the Organizer or a Host to switch it on. You cannot switch it on yourself."
- Step 2 invite option hint: "Guests they invite can play, but cannot invite more people." with the three levels (Organizer/Host/Co-host any number; Guest up to 4; invited by a guest: plays, no invite link).
- Help adds "Who can do what?" and "What is the big screen link?".

Port it to the real console: same sections, same wording, same colours, same behaviour, wired to the real API. Key points:

- Role pill in the top bar: Organizer / Host (`n of 5`) / Co-host / Refer and Earn Partner / Sales Partner. Payment status pill `Paid` / `Payment pending`; soft one-payment notice strip (11px) for Organizer/Host/Co-host while pending; disappears when paid.
- Pinned strip with the AI assistant work link (Organizer only): title + Copy + one short line, nothing else.
- Left synopsis (laptop) / bottom tabs + step sheet (phone/PWA), progress bar with jump dots, "Next" card, numbered colourful sections, one open at a time, "Save and continue".
- Organizer/Host sections (10, owner change 2026-10-09): 1 Date and time of the tournament, 2 Number of players, 3 Set Prizes (sister product; no meaning for a tournament), 4 Set Brand Moments (sister product; no meaning for a tournament), 5 Make hosts and co-hosts, 6 Invite and Share links (Player link / Big screen / My people), 7 Check and publish, 8 Pay (the only place the price is shown), 9 Run the tournament (opens `host.html`), 10 After the tournament. Co-host (3): Today's game, Invite people, Payment. Partner roles keep their existing real screens, reachable by the same sign-in as today.
- Choices are tap chips, never `<select>`. Prizes and brand-moment kinds belong to the sister product's console (10 prize options, "I will decide later", "No prize"; brand moments as a message, a YouTube link or a media link, with Test it). A tournament does not use them.
- Your team: the three role cards (what each can and cannot do), Hosts n of 5, Co-hosts (no limit), add/remove, copy private link.
- Help section at the bottom (pre-answered questions), Back to top / back to steps, short hints.
- Keep working: AI helper mode (shield hides guest names/numbers), `?quick=1`, hand-over links `?e=ID&do=publish|erase|pause|stop`, BroadcastChannel sign-in sharing, the existing a11y labelling, existing control/pause signing, reports. Do not regress anything the existing console tests cover; update those tests to the new wording/structure.
- Words: the product says Organizer, Host, Co-host everywhere (the old UI called the watch-only key "co-host"; that key is now the Host).

## Not true yet (Tic Tac Toe)
- `zc.js` still shows the sister product's steps 3 and 4 and their "About this step" lines (prizes such as Line, Four Corners, X and Blackout; cards; brand moments), and says "engagement" in places. The Tic Tac Toe block is "Run the tournament" (link to `host.html`) and "Open the big screen".
- The player page does not show a brand strip logo, only the company name on the accent colour.
