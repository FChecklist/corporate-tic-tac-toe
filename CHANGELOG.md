# Changelog - Corporate Tic Tac Toe

Newest first. Each entry: what changed, where, PR, audits, rollback id.

## 1.6.0 - 2026-11-23
The owner's invite rule is built. Nothing is deployed and no payment switch is on.
### Changed
- **One way in for every guest.** Everyone uses the same game link. A guest types their ID. If it is on your list, they come straight in and you need do nothing.
- **No ID, or an ID that is not on your list.** The guest gives their name, mobile number and e-mail. The request goes to you or a Host, who says yes or no. Only you and your Hosts see these details (a Co-host sees only the first name and the last four digits). A mobile number on your list is no longer a way in by itself; a personal link still is.
- **The ID is one field.** The choice between mobile number, ID, either and both is gone, in the console and on the server (the server refuses the old choices; a game saved earlier is read as the one rule). The console no longer shows the four choices.
- **One reading of every ID, in every game.** Letters and numbers only, capitals: `A-1101`, `A 1101` and `A/1101` are the same ID when you upload your list, when a guest joins, when you say yes and when the game matches. This no longer waits for a release date.
- **Lists made before this change keep working.** A list that holds `E-101` is found by `E 101`, `E/101` and `e101` too. Nobody on the list is changed, and a second upload sees them as already listed.
- **A game that anyone with the link may join** keeps asking only for a name (it has no list to check an ID against). The console does not offer it by default but the choice is still there; see the knowledge file for the decision this leaves to the owner.
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
- PR: [PR 9](https://github.com/FChecklist/corporate-tic-tac-toe/pull/9). Audits: pending (two required before merge). Deploy: not done. Rollback id: none (not deployed).

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
