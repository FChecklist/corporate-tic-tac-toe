# Changelog - Corporate Tic Tac Toe

Newest first. Each entry: what changed, where, PR, audits, rollback id.

## 1.6.3 - 2026-11-24
Code commit `2424af0` (made 2026-11-24 06:51 UTC = 2026-11-24 12:21 IST). The head of the PR is the record-only commit that follows it: a commit cannot name its own hash, so `version.json` and `releases.json` name the code commit. Nothing is deployed and no payment switch is on (`PAY_VIA_CONSOLE` is not set, `CONSOLE_PUBKEYS` is empty; `console-security.test.ts` passes). Payments go only through IT Services by Rajat Agarwal and Razorpay.
Fixes for the failed security audit of `4fe14715` (PR 9, 24 Nov 2026, 04:10 UTC: three Medium findings and the cheap Low ones). The two decisions the audit asked for were taken by BOSS on 24 Nov 2026 and are written down here and in `docs/KNOWLEDGE.md`.
### Fixed (security audit)
- **M-1: one address could shut every listed guest out of ID entry.** The join counted every try with an ID against the game's allowance before it looked the ID up, so one address sending made-up IDs used up the allowance (600 in ten minutes) and then even a right ID was refused. Now only a WRONG ID is counted, per network (30 in ten minutes, as before) and for the whole game (600, or 3 for every place in a game over 200 places). A network that is over its own 30 is refused first, so it cannot use up the game's allowance. A right ID is never refused because of other people's tries, and "Is this you?" counts the same way. Test: one address sends 700 wrong IDs, a listed guest from another address still gets in (200); a crowd uses up the game's allowance, a listed ID still gets in and a new wrong ID is refused.
- **M-2 (a): at most 60 NEW requests to join in ten minutes for a whole game**, from all networks together. A person who already asked is answered again and is not counted. The guest is told to try again in a few minutes or to ask the organizer.
- **M-2 (b): one tap to stop new requests and to clear the list.** In the waiting panel the Organizer and every Host get "Stop new requests and clear the list", "Clear the list" and (while stopped) "Allow new requests again" (`POST /api/z/{id}/waiting/room`: close, open, clear, close-clear). Clearing deletes the waiting requests with their names, e-mails and numbers; people already let in or declined stay. A Co-host and a Host of another game cannot use it. While the room is stopped, a new request gets 403 `waiting-closed` and the words "ask your organizer to add you to the list".
- **M-2 (c): a small proof of work on the request path.** Before a new request (no ID, or an ID that is not on the list) is taken, the guest's phone has to find a number so that the SHA-256 of `pow1|<game>|<phone id>|<ten-minute window>|<number>` starts with 16 zero bits (about 65 thousand tries, about a second; 18 bits while the game is getting 30 or more new requests in ten minutes). The Worker checks it with one hash. No outside service, no paid service and no key. The Worker answers 428 `need-pow` and counts nothing until the proof is right; the page (`ttt.js`) solves it by itself and asks again. It is a speed bump for scripts, not a wall: the limits of (a) and the 500 cap are what stop a flood.
- **The waiting list says when it is full.** The cap is still 500 waiting requests. A guest now gets "The waiting list of this game is full (500 requests) ... ask your organizer to add you to the list, or to clear the waiting list", and the organizer's panel says the list is full.
- **M-3 (a): a Host belongs to one game (BOSS decision).** `POST /api/org/host` without a game of the account is refused (400 `host-needs-game`). A Host with no game on the key (made before 1.6.2 or through the API without a game) has NO access to any game until the Organizer removes them and adds them again from inside a game: every game route, the team list, pay links and paying answer 403 `host-no-game`; the Organizer's team list marks such a Host. "Send a new link" is refused for such a Host. The Help Desk helper's Host is now made for the game that was published (one desk Host per game; the one of the earlier game stops). The 24-hour AI-link Host key is not a person's Host and is as before.
- **M-3 (b): `/api/org/*` keeps a Host in their game.** A Host added inside a game sees only that game's Co-hosts and the Hosts of that game in `GET /api/org/team` (the audit's probe: `?e=AP-2` is 403), can retire Co-hosts of their own game only (403 for another game; the Co-host was revoked before), and cannot make a pay link, pay with credit, or start a payment for another game. `GET /api/history` shows a Host their own game only.
- **Low 1: one player cannot fill a board.** One player (or the Organizer's page) holds at most 40 entries on one board; the board's own cap of 120 stays as a last guard.
- **Low 3: the flaky `ai-privacy.test.ts`.** Its short needle is now the last seven digits of a planted number, which a random AI key cannot contain by chance (it was four digits and failed once in a while).
### Not changed, and why
- **ID guessing is limited, not stopped (audit Low 2, the owner's own rule 2: the ID is the secret).** After this version: 30 wrong IDs per network and per game in ten minutes (an IPv6 visitor counts by its /64), and 600 wrong IDs per game in ten minutes (3 for every place over 200 places). Right IDs are not counted. Once the game's 600 are used, a wrong ID is refused and a right ID still gets in, so a guesser with many networks can still test about 30 IDs per network in ten minutes and learns which ones were right. The proof of work is also asked on a wrong-ID request, which only slows it. A code sent to the person would be the real fix and is an owner decision.
- Open as before (audit Lows 4 to 8, not Medium): stage-game players can write moves for later turns or a taken square (the phones ignore them); `POST /details` has no per-player limit; the limit counters read and then write, so parallel calls can pass by a few; the device proof in `setup`, `rank` and `view` sits in the address (`Referrer-Policy: no-referrer`); "Staff only" still refuses a guest with no ID; erasing error reports and mail by text match (Low 5); the go-live lines A2.1 to A2.3 in `docs/GO_LIVE_CHECKLIST.md` (minute job, `STRICT_KEYS`) are not checked; audit redaction is a list of key names; `bun.lock` pins `@types/bun` to `latest`; the frame origin of the console still needs the owner's yes; the signed `paid` notice does not cover the order number or the size. The 365-day "who played" chain and the organizer tick boxes are as in 1.6.1.
- The Host key that reaches the whole account is closed for Hosts made inside a game and for old Hosts (they have no access at all). The Organizer's own key, the Organizer's AI key and the 24-hour AI-link Host key are account-wide, as before.
### Changed
- The player page and the organizer console changed, so the offline cache name of the game files moved to `ttt-game-v14`. The help catalog has entries for the new answers (list full, many requests, requests stopped, a Host belongs to one game, a board full for one player).
- The test helper `apps/edge/test/with-terms.ts` now finds the proof of work by itself when the Worker asks for it (as a phone does), with a fast native solver in `apps/edge/test/pow-solve.ts`. Tests that make a Host now make the game first and give the Host that game.
### Tests
- New: `apps/edge/test/audit-round-6.test.ts` (26 tests) and `apps/web/test/waiting-pow.test.ts` (3); one new test in `apps/web/test/pages.test.ts` (the one-tap buttons). The old M-D tests of `audit-round-5.test.ts` were replaced by the M-1 tests (the old rule counted right IDs too), its board-flood test now stops at 40. Changed to the new rules: Host tests that made a Host with no game, `helpdesk.test.ts` (one desk Host per game), `hostlink.test.ts`, `people.test.ts` (500-request test), `audit2-privacy.test.ts`, `pages.test.ts` (a Host sees their own game only).
- Every new test was run with its fix removed (37 single removals, each put back and checked byte for byte): 34 went red at the first try. Two did not at first (a proof with eight zero bits too few; the defence in `gameFits` behind the route gate); those tests were made stricter and went red. The removal of the 500 cap was added afterwards and went red.
- Result of the full run, every test file as its own process (189 files, three at a time): **2725 pass, 1 todo, 0 fail** (`packages` 278, `apps` 2298 with 1 todo, `tools/control-worker` 1, root `test/` 148). `bun run typecheck`: exit 0. `apps/web/test/pages.test.ts` failed on a different test in three runs where six test files ran at once on a 4-core box (the page was read before it was drawn); it passed alone 3 of 3 times and in the final run of three at a time. It is a timing weakness of that file under load; it is not changed here.
- Not run: no browser click test and no real phones (the page tests run in a simulated browser); how long the proof of work takes on a real phone is not measured; real concurrency of the limit counters; the live site, `/version.json` and a deploy; the `tools/sim2` scenarios (`inviteHost` there now adds the Host inside a game, untested); `docs/GAME_PAY_CONTRACT.md` (console repo).

## 1.6.2 - 2026-11-24
Code commit `0a9966b` (made 2026-11-24 03:31 UTC = 2026-11-24 09:01 IST). The head of the PR is the record-only commit that follows it: a commit cannot name its own hash, so `version.json` and `releases.json` name the code commit.
Fixes for the two failed audits of `776e5ee6` (PR 9, 23 Nov 2026, 20:25 and 20:34 UTC). Nothing is deployed and no payment switch is on (`PAY_VIA_CONSOLE` and `CONSOLE_PUBKEYS` are untouched). The retention rules for winners, organizers, the chain, the payer, e-mail and invoices are not changed (BOSS comment of 23 Nov, item 6).
### Fixed (security audit)
- **A Host works in one game only.** A Host you add from inside a game belongs to that game. Before, that Host key could read the waiting list (names, mobile numbers, e-mails) and the cancel screen of every other game of your account. Now the other games answer 403. The game goes with every key the Host gets later, for example when they sign in with their e-mail on a new phone. A Host of one game cannot add a Co-host to another game.
- **A board cannot be won by reporting alone.** Before, if the other player had written nothing, one player could report "I won" and 30 seconds later the board was decided. Now a single report is kept after 30 seconds only when the board shows the other player is away: they played at least once, or a "clock-out" claim is stored. A claim from a player is stored only after the clock has really run out (the 30 seconds of ready time for the first move, the move clock after that), counted from the server's own stamp. One player can write at most 5 times a second to one board, and a board holds at most 120 entries.
- **The bracket and the podium cannot be forged.** A later match can only be registered with the winners of the two matches it comes from, in the right order, and its round and place must fit its name. A first-round loser cannot register a place in the next round. The final result must name the real winner of the final as champion, the other finalist as runner-up, the real players on the podium, and third and fourth place must be people who reached the semi-finals.
- **The ID allowance now covers the join.** Every try with an ID on the join step (right or wrong) counts against the same allowance of the game as "Is this you?": 600 in ten minutes, or three for every place in a bigger game. After the allowance is used up, a right ID is refused like a wrong one, so a guesser learns nothing.
- **Full names only for people who may see them.** The final ranking, the champion and the live view show a first name and an initial to anybody who only has the link. Players (with their own phone), the organizer and Hosts see full names. A team name stays as it is. The organizer's pages now send the key so you still see full names.
### Fixed (correctness audit)
- **Stage game: nobody can take the first move.** The second player could write a "missed move" at number 0 right at the start and so move first. Now a missed first move is stored only after the 10-second clock of that slot has run out. The server knows when a slot begins from the published start (and any pause).
- **Your setup screen tells the join rule.** It still said that a guest with no ID gives name, mobile number and e-mail. Now it says: only their name is needed; ID, department or team, region, mobile number and e-mail are optional; only you and your Hosts see what they give.
### Not changed, and why (decisions for the owner or BOSS, not guessed)
- **Hosts made before this version, or made with no game (through the API), are not tied to a game.** They still reach every game of the account. Binding them needs a choice: refuse to make a Host without a game, and retire and re-add the old ones inside their game. Nothing was guessed.
- **ID guessing is limited, not stopped.** Anybody who knows or guesses a listed ID can still get in at a rate of about 600 tries in ten minutes per game. That is how the owner's rule works (the ID is typed, not proven). A bot check, a code sent to the person, or a proof of work would be a product decision.
- **A flood of requests from many networks** can still fill the waiting room (500). Only the per-network limit and the cap exist. A bot check is the same decision as above.
- Not done, and not Medium: a player can still write moves for later turns or a taken square into a stage game (the game replay ignores them); the details panel has no limit per player other than the daily budget; the counters read and write in two steps, so parallel tries can pass the limit by a few; deletion of error reports and mail that name a game is by matching text; `STRICT_KEYS` is a go-live line; the audit redaction is still a deny list; "Staff only" refuses a guest with no ID where the owner rule sends them to the waiting room (needs the owner's word).
- **The 365-day "who played" chain, the organizer tick boxes** are as before (see 1.6.1).
- The offline cache name of the game files moved to `ttt-game-v13` (the player page changed). The help catalog has entries for the new answers (a Host of another game, too many ID tries, the refused results).
- The workspace packages (`packages/*`, `apps/edge`) now carry the product version 1.6.2 too (they were 0.1.0); `bun.lock` follows.
### Tests
- New: `apps/edge/test/audit-round-5.test.ts` (20 tests), `test/newflow/audit3.test.ts` (6), `apps/web/test/organizer-join-rule.test.ts` (5). Changed to the new rules: `tournament.test.ts` (a single report now needs a stored claim; names are read with a key; later matches carry their real sides) and one line of `test/newflow/relay.test.ts`. Each fix was removed one at a time and its test failed.

## 1.6.1 - 2026-11-23
Code commit `8bf8c5d` (made 2026-11-23 19:15 UTC = 2026-11-24 00:45 IST). The head of the PR is this record-only commit that follows it: a commit cannot name its own hash, so `version.json` and `releases.json` name the code commit.
Fixes for the two failed audits of `da3e485a` (PR 9, 23 Nov 2026, 09:33 and 09:34 UTC), built on the owner's join rule of 07:16 UTC. Nothing is deployed and no payment switch is on (`PAY_VIA_CONSOLE` and `CONSOLE_PUBKEYS` are untouched).
### Changed (the join rule, audit 1: H-1, H-2, H-3, L-2)
- **Only the name is needed.** A guest who is not on your list (no ID, or an ID that is not on the list) gives a name. The ID, department or team, region, mobile number and e-mail are optional. The server refuses only a missing name (`need-name`); a wrong optional e-mail or mobile number is refused with a plain sentence, because it can be left empty. Before this, the server and the page demanded a mobile number and an e-mail.
- **A mobile number is no longer a key.** A guest who is not on the list is known by their own phone (a hash of this game and the phone's random id). A typed number is only extra contact for you. An approved place can therefore not be taken by typing the approved person's number on another phone (audit 2, M2). People you added by mobile number reach their place with their personal link, as before.
- **The two sentences, word for word, on both screens:** "Above details are optional. You can play without giving these details also." and "All the details will be deleted and erased from the system within 24 hours after the game is over." They are on the ask-to-join screen and in the new panel. The older line "No personal details needed. ..." stays on the name-only screen of a game anyone may join.
- **A small closed panel after entry** (all optional): name, department or team, region, mobile number, e-mail. It sits outside the part of the page that redraws, so nothing typed is lost; Save goes to `POST /api/z/{id}/details` (the card id and the phone's own proof are needed). Department or team and region are kept sealed like the other details, shown in full to the Organizer and Hosts only (never to a Co-host), and deleted with everything else.
- The waiting list in the console now says that what a person typed is not checked (audit 2, M4).
- Waiting people no longer get in because the organizer later listed their number: a person who asked is decided by the organizer or a Host.
### Fixed (audit 2)
- **H1 stage log:** only the two players named in a slot may write to it (403 `not-in-slot`); a missed move ("-") is stored only after the 10 s move clock has run out, counted from the server's own stamp of the entry before it (409 `too-early`); only a square 0 to 8, "-", or "a" / "b" / "draw" is kept. A third player could burn the turns of a game that was not theirs, or end it as a draw.
- **Missed move froze the board (found while testing H1):** after "X plays, O misses, X plays again" the board refused X's second move, because the mark was taken from the count of marks on the board. The mark now belongs to the player. The phones' file `tttengine.js` is rebuilt (only this file; the other built bundles are unchanged).
- **H2 classic tournament:** a single report of a result is no longer kept after 30 s while the other player is still writing to that board. It is kept once that player has written nothing for 150 s (they are away). Two matching reports are kept at once, as before. The mailbox still does not look at boards: an illegal move is stored as sent and every phone ignores it when it replays (kept by test M3, by design).
- **H3 classic tournament:** a later-round match can be opened only with players who played in the two matches it comes from (400 `not-from-feeders`); a final result that names somebody who did not play (champion, podium, ranking) is refused (400 `not-in-game`).
- **M1:** the full player list (`setup`) goes to a seated player (with the phone's proof) and to the Organizer and Hosts; anybody else with the link sees a first name and an initial. The draw is the same for everybody.
- **M3:** every "Is this you?" look-up counts, a right ID too: 60 per network and 600 per game in ten minutes.
- **M4:** one network may leave 60 open requests per game (429 `waiting-net-full`).
- **M7:** erasing a game's participant data (20 hours after its end) now also deletes the error reports and error groups that name the game, and the mail outbox rows that name it. A participant's audit row no longer keeps a country or a request id.
- **L1:** the platform key and the inbound mail secret are compared in constant time (`safeEq`). **L4:** ten wrong deletion codes lock that deletion request until it expires. Audit counters `idmiss/` and `idlook/` are swept after two days.
- **M-2 (audit 1):** the public `/version.json` now also holds `releasedAtIST` (UTC + 5:30 with its offset). `version.json` and `releases.json` named the commit before (`2fbafc7`), and `builtAt` was an invented time five hours ahead; both are now the real commit and time.
- The offline cache name of the game files moved to `ttt-game-v12` (the player page and the engine changed).
### Not changed, and why (decisions for the owner or BOSS, not guessed)
- **M-1 / M6, the "who played" chain for 365 days:** the 07:16 brief, item 6, says the retention rules of the chain, winners, payer and invoices stay as they are in this version. Nothing was built. Today `erasePersonal` deletes the person, the seat, the invite record and the waiting room (with the approver) at end + 20 hours; only seat, prize, round and time of winners stay. A new table with five fields cleared on day 365 is the way if the owner wants it.
- **M-3, tick boxes on the organizer console** (`cancelagree` and four more in `zc.js`): they are on the live commit too. The guest side has none. Needs one written line from the owner.
- **M5, a Host key covers the organizer's whole account:** that is the role as the spec describes it (`docs/ROLES_AND_CONSOLE_SPEC.md`: up to 5 Hosts, everything inside a tournament). Binding a Host to one game is a product change.
- **H2, illegal moves in the classic mailbox:** stored as sent on purpose (the mailbox "never looks at a board"); every phone ignores them when it replays.
- **L2:** `STRICT_KEYS=1` is not set in any config, because it makes the Worker answer 503 if one secret is missing; it is now a line in `docs/GO_LIVE_CHECKLIST.md` for whoever deploys. **L3** (audit redaction as an allow-list), **L-1** (wording of the join notice) are left as they were; no route leaks guest names into the audit today.
- The first move of a stage game (`seq` 0) has no earlier entry to count the clock from, so a "-" at `seq` 0 is limited only to the two players of the slot.
### Tests
- New: `apps/edge/test/audit2-privacy.test.ts` (M3, M4, M7, L1, L4), `test/newflow/audit2.test.ts` (H1, the missed-move freeze, the built engine), `apps/web/test/ttt-details-panel.test.ts` (the panel, both sentences, Save reaches the server), and more tests in `invite-rule` (name only, optional answers, a number is no key, `/details`), `tournament` (H2, H3, M1, M9), `ttt-page`, `version-stamp`, `guide`.
- Changed to the new rule: `join-matrix`, `t30-join-wire`, `nameonly`, `verify`, `people`, `abuse`, `relay` and `sim` (newflow).
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: pending (two required before merge). Deploy: not done. Rollback id: none (not deployed).

## 1.6.0 - 2026-11-23
The owner's invite rule is built. Nothing is deployed and no payment switch is on.
### Changed
- **One way in for every guest.** Everyone uses the same game link. A guest types their ID. If it is on your list, they come straight in and you need do nothing.
- **No ID, or an ID that is not on your list.** The guest gives their name, mobile number and e-mail. The request goes to you or a Host, who says yes or no. Only you and your Hosts see these details (a Co-host sees only the first name and the last four digits). A mobile number on your list is no longer a way in by itself; a personal link still is.
- **The ID is one field.** The choice between mobile number, ID, either and both is gone, in the console and on the server (the server refuses the old choices; a game saved earlier is read as the one rule). The console no longer shows the four choices.
- **One reading of every ID, in every game.** Letters and numbers only, capitals: `A-1101`, `A 1101` and `A/1101` are the same ID when you upload your list, when a guest joins, when you say yes and when the game matches. This no longer waits for a release date.
- **Lists made before this change keep working.** A list that holds `E-101` is found by `E 101`, `E/101` and `e101` too. Nobody on the list is changed, and a second upload sees them as already listed.
- **A game that anyone with the link may join** keeps asking only for a name (it has no list to check an ID against). The console does not offer it by default but the choice is still there; see the knowledge file for the decision this leaves to the owner. (1.6.0 also asked a guest with no ID for a mobile number and an e-mail; 1.6.1 corrects this to the name only, as the owner's 07:16 brief says.)
- **The join notice now names the e-mail** (shown only to your organizer and hosts, deleted with everything else). The Terms version date was not changed: the owner or the lawyer decides whether it should be.
- The Employee ID / Email ID kind now locks as soon as anyone is listed, also a person listed by mobile number only.
### Fixed
- **The page beacon limit now counts an IPv6 visitor by their /64** like every other limit (`funnel.ts`).
- **The help line "Opening a game from your console signs you out of any other sign-in saved on this device" now has a test of its own** (it had none).
### Checked and kept true
- **Everything about the guests is deleted within 24 hours after the game ends**: the list, the IDs, the requests (with their e-mails), the places and the pointers to IDs. The delete falls due 20 hours after the end. The new migration note is deleted with them.
- The live commit `fa5ab0afa895` is still inside this branch (0 behind).
### Tests added
- `apps/edge/test/invite-rule.test.ts` (16 tests): the four older choices are refused and read as the one rule; a listed ID gets in in any spelling with no waiting; no ID or an unknown ID is asked for name, mobile number and e-mail, waits, and is shown in full to the Organizer and a Host and not to a Co-host; a mobile number alone is no way in; upload stores one form; a list made before this version is found in every spelling and not added twice; deleting removes people, requests, places, pointers and the migration note; a game anyone may join keeps its name-only join.
- `apps/edge/test/funnel-unit.test.ts`: a flood from one IPv6 /64 is slowed down.
- `apps/web/test/guide.test.ts`: the console sign-in help line, and the help for a guest who has no ID.
- `apps/web/test/ttt-page.test.ts`: the join page for a game by invitation (ID, or mobile number and e-mail) and for an open game.
- Many older tests that joined with a number or a name alone, or that tested "mobile / either / both", were changed to the new rule (`verify`, `people`, `join-matrix`, `t30-join-wire`, `t41-owner-rules`, `pages` and others).
### Notes for the owner and the auditors
- `bun.lock` is tracked in this PR (new on `master`; `@types/bun` is `latest` in it).
- The first two Low items from the audits of `50efacd8` / `2fbafc79` that are fixed here: the help line test and `funnel.ts`. The frame address `https://itservices-rajat-agarwal.pages.dev` still needs the owner's confirmation; `pack/` is still not loaded by any page.
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: failed twice at `da3e485a` (two AUDIT: FAIL comments, 23 Nov 2026, 09:33 and 09:34 UTC); the findings are fixed in 1.6.1. Deploy: not done. Rollback id: none (not deployed).

## 1.5.1 - 2026-11-23
Fixes after the third round of audits of PR 9. Nothing is deployed and no payment switch is on.
### Fixed
- **Wrong-ID guessing is limited per IPv6 network, not per single address.** The limit of 30 wrong employee IDs in 10 minutes counted every IPv6 address on its own, so one person could change address and start again. Now all addresses inside one IPv6 home or phone network count as one. The same goes for the other per-address limits (sign-in link failures, test sign-in, demo, game starts, joins, payment-link tries, partner and pay-first tries). IPv4 works exactly as before.
- **Deleting a game now deletes its console helpers too.** The Host and Co-host roles made through the console (with the sealed e-mail address), the console sign-ins of that game and any unopened console link are deleted at the same time as the other people's data, so the "everything is deleted" promise stays true once the console is on. This is dark today because the console is off.
- **Help tells you what opening a console game does.** One line: opening a game from your console signs you out of any other sign-in saved on this device.
- **The unreliable tests are named correctly.** The tests that fail now and then only when the whole suite runs together, and pass alone, are `join-retry.test.ts`, `ttt-same-name.test.ts` and `big-lost.test.ts`.
### Tests added
- `apps/edge/test/netkey.test.ts`: IPv4 as it is; two addresses in one /64 give one key; another /64 does not.
- `apps/edge/test/ipv6-guess-limit.test.ts`: 30 wrong IDs from 30 addresses in one /64 close the door for that /64 ("Join" and "Is this you?"); another /64 and IPv4 are not affected.
- `apps/edge/test/stage-log-erase.test.ts`: erasing a game removes its role, hand-off link and console key and leaves another game's alone; a database without the bridge tables still erases.
### Not done (needs a decision written by the owner or the BOSS on PR 9)
- "Invite by employee ID only" is still open. An organizer can still choose mobile number, employee ID, either or both. Making the server refuse every other choice would change how live games work today, so it is not done without a decision in writing.
- The tidy-up of the `cpaid/<game>` order note when a game is deleted is not done on purpose: it holds the order reference of a payment, which the law keeps.
- Unchanged and accepted: the signed payment notice does not cover order number and size; the frame address `https://itservices-rajat-agarwal.pages.dev` needs the owner's confirmation; `pack/` still has first-person words (fix in the console repo).
- The live site's `/version.json` could not be read from this build box (network block), so the live commit is taken from the earlier merge note (`fa5ab0afa895`, deployed 5 Nov 2026). It is inside this branch.
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: pending (two required before merge). Deploy: not done. Rollback id: none (not deployed).

## 1.5.0 - 2026-11-22
The live game code is merged into this branch. Nothing is deployed and no payment switch is on.
### Why
- This branch was built before the live game was last updated. It had missed 108 changes that are running live right now (live commit `fa5ab0afa895`, deployed 5 Nov 2026). Deploying it as it was would have quietly removed live fixes and database changes. The live commit is now inside this branch.
### Merged by hand (both sides kept)
- **Employee IDs.** Live decides how an ID is read by the date the game was made (`ids.ts`). That rule is kept for every game. This branch's fix for lists made before 1.4.1 is kept too, and now follows the same rule. An e-mail typed where an employee ID is asked is refused, as live does.
- **Wording.** Where live and this branch changed the same sentence, the live meaning is kept and the words are made to follow the owner rules v1.1 (speak to "you", rupee sign, one privacy line, one fairness sentence). Live facts kept: a game is for at most 2,000 people; credit is valid for 365 days; the report link works for 19 hours and names and numbers are deleted at 20 hours (promised within 24); "personal link".
- **Database files.** Live already uses 0030 (stage log) and 0031 (price adjust). The two files this branch adds are now `0032_game_role.sql` and `0033_console_paid.sql`. They are still optional and harmless. The migration test lists all of them.
- **One small test fix.** `ttt-start-resume.test.ts` (live) was missing its test import, which made the type check fail. The import is added.
### Not changed
- Money switches stay OFF. No secrets. Not merged, not deployed.

## 1.4.2 - 2026-11-22
Fixes after the two audits of PR 9 failed. Nothing is deployed and no payment switch is on.
### Fixed
- **A sign-in for one game now stays in its own browser tab.** When the console opens a game for you, that sign-in is kept in that tab only. Before, it could be copied onto the device for 16 hours, and a sign-in saved earlier could win over it, so the game opened as the wrong account. Now the one-game sign-in always wins in its tab, is never saved on the device, and any older saved sign-in is removed. It is not shared with other tabs.
- **Sign out in that tab now ends the sign-in at once**, on the service as well as in the tab.
- **A second payment for a game that is already paid is refused.** Before, a different order for a game that was already paid (for example by the old payment page) was accepted as fine. Now only a repeat of the same order is accepted. If another payment path unlocks the game a moment earlier, nothing is overwritten and no console payment record is left on it.
- **Employee lists made before 1.4.1 still work.** A person who is on such a list and types the ID the way the list holds it (for example `E-101`) is found again, and adding the same list again does not create a second person. Known limit: a person on an old list who types the ID with the dash left out (`E101`) is not matched to the old entry. They wait for you to let them in, or you add the list again.
- **Help for organizers speaks to you everywhere.** The whole help file now says "you" and "support" instead of "we" and "us". A test keeps it that way.
- **Help says what an employee ID can and cannot do.** An employee ID is checked against your list. It does not prove who typed it. A personal link is the strong proof. This is the owner's accepted decision, written in `docs/KNOWLEDGE.md`. There is no limit per address on right IDs.
- A type error in the console bridge test is fixed.
### Tests added
- The one-game sign-in stays in the tab, wins over a saved one, and Sign out ends it (`apps/web/test/console-handoff.test.ts`).
- A different order on a paid game is refused; a repeat of the same order still works after the game closed; a game unlocked by another path just before the write is left alone (`apps/edge/test/console-pay-step.test.ts`). Each of the two guards is tested on its own.
- Old employee lists still work (`apps/edge/test/verify.test.ts`).
- The help file has no first-person words, and the employee ID help is honest (`apps/web/test/owner-rules.test.ts`).
### Not done
- "Invite by employee ID only" is still open. An organizer can still choose mobile number, employee ID, either or both. This needs the owner's decision in writing.
- The vendored `pack/` folder still has first-person wording and has to be fixed in the console repo.
- The signed payment notice is tied to the game and the person, not to the order number or size. Safe while the console calls the game directly; add both to the signature if a browser ever passes the notice on.
- Tests: three tests fail on `master` too (two page tests and one owner test account test that use dates that have passed). One more test fails now and then when the whole suite runs together and passes alone (a timing test: `join-retry.test.ts`; since 1.5.0 also `ttt-same-name.test.ts` and `big-lost.test.ts`).
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: pending (two required before merge). Deploy: not done. Rollback id: none (not deployed).

## 1.4.1 - 2026-11-22
Fixes found before the first audit of PR 9. Nothing is deployed and no payment switch is on.
### Fixed
- Five tests that this PR had broken now pass again: the database change for console payments was added, the new payment setting was listed, a help entry was added for "This sign-in is for one game only", and two test lists were updated.
- A console sign-in made for one game could cause an error by opening an address with a broken `%` in it. It is now simply refused. A test also keeps the console payment switches off in every shipped setting.
### Changed (owner rules v1.1)
- Employee IDs are read one way: letters and numbers only, in capitals, up to 30. `A-1101`, `A 1101`, `A/1101` and `a1101` are the same person. Games made before this version may hold IDs written the old way; see 1.4.2.
- Organizer and host screens speak to "you". Money is written with the rupee sign. There is one privacy line and one fairness sentence, and the fairness sentence is proved by a test. No claims the game cannot keep.
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: failed, see 1.4.2. Deploy: not done. Rollback id: none (not deployed).

## 1.4.0 - 2026-11-20
### Added
- The console's Pay step: the console can ask who owns a game and what it costs (read only), and tell the game that it is paid. The game then unlocks its start. It can be repeated safely. It is switched off until the owner turns it on.
- A setting `PAY_VIA_CONSOLE`: off means the old Pay now page works exactly as before; on means the pages that start a payment send people to the console. Payment confirmations are never redirected.
- The organizer page may show the console's payment window; no other site is allowed.
- Tests and a short document (`docs/CONSOLE_PAY_STEP.md`).
### Changed
- The console connection files and the game pack were copied again, unchanged, from the console repo. This branch also carries earlier console connection work that was never merged.
- The console's game list shows a game paid through the console as paid.
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: failed, see 1.4.2. Deploy: not done. Rollback id: none (not deployed).
