# Winners are decided by the software (as built, checked against the code 2026-10-13)

Owner rule: the organizer builds the tournament and chooses the format and the move clock. The Organizer, a Host, a Co-host, the AI assistant and we **cannot choose, change or remove a draw, a starter, a move or a winner**. The software does all of it. The rules are in `docs/RULES.md`; the code is in `packages/ttt/src/` and `apps/edge/src/tournament.ts`.

## How a winner is decided

1. **The phones decide; the server stores.** A phone posts "my square" (`POST /api/z/{id}/ttt/move` with the player id, the random device id, the move number `seq`, the square 0 to 8 and its own clock reading). The server stores it with the server's own time stamp if the player is on that match and `seq` is the next number. Who has X, the bracket, the clocks, clock-out moves, the winner of a board, the next round and the ranking are all computed by every phone from the sealed seed and the stored moves (R27, docs/RULES.md section I). A result is kept by the server when both players report the same winner; reports that differ are flagged for the Organizer.
2. **The seed is sealed** (`packages/ttt/src/seal.ts`, R26). When the tournament is made, only its fingerprint (`commit = sha256("TTT-COMMIT|" + secret)`) is shown, on every phone. When the host presses Start, the roster is closed, the seed is made from the secret, the tournament id and the closed roster (and a public beacon number, if one is passed in), and the secret is revealed at `GET /api/z/{id}/ttt/reveal`. Anybody can then re-compute the bracket order, every starter, every automatic move and every fate number.
3. **A board always ends with one winner** (R07 to R10): the first game with a winner; a drawn game replayed with the marks swapped, up to three games; then fate, a number made from the seed, the board and the player id (the lower number wins).
4. **The clock** (R11 to R15): when a move clock runs out, a random empty square drawn from the seed is played for that player (every phone works this out from the server's time stamps); a second clock-out in a row in the same game loses the board. Pausing stops every clock and gives every clock back the same time afterwards (R28).
5. **The result has no ties** (R24): the round reached, then total points, then points in the last match, then fate. The strict ranking is made on the phones of the final (and the Organizer's page) when the final ends, and the server stores it when two different phones sent the same thing (`POST .../ttt/finish`); the top 100 places are kept for the results screen and the big screen, and each place says in one line how a tie was decided (R25).
6. **The winners record** keeps the first to fifth place as **opaque seat numbers** (table `winner`, source `ttt`), never a name. It stays until 00:00 IST at the end of day 365. The names on the results screen live in the ranking JSON and are deleted 23 hours after the end (`docs/PRIVACY_AND_LIFECYCLE.md`).

## What the Organizer, a Host and the AI can and cannot do

- Organizer or Host: start (choose the format and the move clock), pause, resume. They cannot pick a bracket place, a starter, a move or a winner. A Co-host or a player who is not to move cannot move. The AI cannot start, pause or resume the tournament (the tournament routes refuse an AI key).
- `POST /api/z/{id}/settle` refuses everybody. A phone's own claim of a win is ignored.
- **One honest power:** an Organizer or Host can remove a person from the list. After the start a removed person can no longer move (the server refuses a removed seat), so they lose their board by the clock. This is the only way a human can change who plays; it is visible in the security log.

## One place per phone

A phone gets one place per tournament: the server keeps a hash of the phone's random device id (`seat.dev`) and refuses a second place for the same device (`device-used`). Only the phone that joined can move that place (`playerOf`, `other-phone`). The list closes when the host presses Start (R32/D4, test in `tournament.test.ts`); a player who was in can open the link again and sees the board exactly as it is (R29).

## Gifts

Any gift is supplied by the organizer, outside this product (R31). We do not collect winners' contact details for it. The shared Worker still has the sister product's prize hand-over routes (`confirm`, `prizegiven`, `prizes`) and table (`prize`). A tournament never writes to that table, so `confirm` answers "No reward recorded for this card." (404) and nothing about a prize is stored.

## The report

One e-mail with a link, a few minutes after the end. `/report.html` fetches `GET /api/report/{id}?k=...&part=base|people` and lays the PDF out in the organizer's browser (their memory, not our server). Valid until 22 hours after the end, when the players' names are about to be deleted. See `docs/PRIVACY_AND_LIFECYCLE.md`.

## Audit trail of the external AI

Every call made with an AI key is written to `ai_audit` (time, key id, method and path, status, network address, program, country). The organizer reads it in the console; we can read all of it (`GET /api/org/ai/audit`). Kept 365 days. The short work link (`/ai/<key>`, see `docs/AI_LINK.md`) goes through the same trail.

## Internal audit log

Beside the per-AI trail, `audit_log` (`apps/edge/src/audit.ts`) is the internal, sealed, hash-chained log of every write: join, consent, each move, start, pause, resume, console edits, sign-in. It is owner-only (platform key): `GET /api/owner/audit/<id>[?format=csv]`, `/verify`, `POST /analyze`, `POST /hold`, `GET /api/owner/audit/access`. A player's personal part (network address, browser, device id, the square sent) is destroyed 23 hours after the end. Full description: `docs/PRIVACY_AND_LIFECYCLE.md`, sections 2d and 6.

## Honest limits

- The server draws the secret, so the server is trusted to draw it fairly and not to look. A public beacon number at the start would remove even that: the code supports it (`seedOf(..., beacon)`, and `/ttt/start` accepts a `beacon` field), but the organizer console does not add one yet.
- Moves go through the server (about 9 small writes per game), not phone to phone. Simpler, works behind office firewalls.
- A player types any name; names are not checked. A person who clears the browser data gets a new device id and could take a second place before the start, under another name. The organizer sees the names.
- Team format: players beyond a full team only watch; nobody can stand in for a missing team member (an absent member forfeits their board).
- Nothing in a browser can be made uncopyable. Copying is deterred by law (terms and copyright), not by code.

## Not true yet

- The Worker still has the sister product's winner routes: `POST /api/z/{id}/vote`, `/claims`, `/won`, `/over`, and the tables `rvote`, `rcand`, `claim`, `overvote`. The Tic Tac Toe pages never call them and the tournament's champion and ranking do not depend on them. But a group of players that sent matching `vote` results could still add rows to the winners record under the sister product's house names. They should be switched off before launch.
- The organizer console (`zc.js`) still has the sister product's steps for prizes, brand moments and "Game day" (numbers, lucky draw). The Tic Tac Toe step is the block "Run the tournament", which opens `host.html`.
