# Corporate Tic Tac Toe

A company event game. An organizer makes a tournament, shares one link, and the players open it on their phones. It is a knockout of tic tac toe boards, one against one or team against team, up to 10,000 players. The game runs on the players' own phones and laptops: each phone works out the draw, who has X, the clocks and the winner from the same public sealed seed. Our server only stores and relays data (sign-in, payment, saving, moves, agreed results, deletion after 24 hours, e-mail). Players type a display name only. Players never pay and never stake money; there are no cash prizes. Adults (18+) only.

**The site is live** on Cloudflare Pages (project `corporate-tic-tac-toe`, database `corporate-tic-tac-toe`). What is live right now is in `/version.json` on the site (the commit and the build time); the last deploys are listed in `docs/DEPLOYS.md`. Whether payments are real follows the site's TEST / LIVE mode (`/api/mode`).

## Layout

| Folder | What is in it |
|---|---|
| `packages/ttt` | The game: the rules, the board and clock, the bracket, the sealed seed, and the phone that runs them (`phone.ts`, built for the browser as `tttgame.js`). Plain TypeScript. The server does not use any of it except the hash check of the sealed seed. |
| `apps/edge` | The Worker (Cloudflare Worker + D1 database): sign-in, payments, e-mail, deletion of personal data, and the tournament mailbox (`tournament.ts`: stores moves with its own time stamp, lists them, keeps results two reports agree on). Migrations in `apps/edge/migrations`. |
| `apps/web/public` | The pages: `z.html` (player), `big.html` (spectator and big screen), `host.html` (host), `zc.html` (organizer console), the public website. |
| `apps/cron` | The scheduled job that calls the clock-outs and the deletion job. |
| `tools/sim2` | The simulation: `bracket-sim.ts` plays whole tournaments with simulated phones (the real phone code) that talk to the mailbox routes on a fake clock. |
| `docs` | The documents. Start with `docs/README.md`. |

`packages/beacon`, `packages/billing` and `packages/shared` are shared code the Worker still imports (settings, money, helpers). `prototype/` is the earlier three-board prototype, kept for reference (`docs/PROTOTYPE_NOTES.md`).

## Run the tests

Bun is the runtime. One heavy command at a time: the laptop has little free memory.

```
bun test packages/ttt
bun test apps/edge/test/tournament.test.ts
```

More in `docs/RUNNING.md`. The rules are in `docs/RULES.md`; each rule has a test whose name starts with the rule number.

## The money and the data, in one paragraph

Payments go only through the central service "IT Services by Rajat Agarwal" (Razorpay). Players' names are deleted 23 hours after the tournament ends (the promise is 24 hours); the organizer's details and the winners record (seat numbers only) stay until 00:00 IST at the end of day 365, then everything goes. Invoices and the payment ledger are kept separately for the legal period. The data map is `docs/PRIVACY_AND_LIFECYCLE.md`.

Contact: rajatsiroffice@gmail.com, +91 96503 97480.


See [KNOWLEDGE-MAP.md](KNOWLEDGE-MAP.md) for what this repository is for and what the other repositories are for (updated 14 Nov 2026).

## Owner rules, 20 Nov 2026

The owner's decisions for every Corporate Games product. Full text: `plans/ID-INVITE-AND-ARCHITECTURE-RULES-2026-11-20.md` in the private `marketing-ledger` repository (FChecklist/marketing-ledger). If this README and that file disagree, that file wins.

- **One login.** home.corporatetambola.com is the only login gate. No game or page has its own login: if one exists it is hidden or redirects there. Players joining by game link are not "logged in".
- **One console for all games.** console.corporatetambola.com, for organizers and hosts only: set up, invite, pay, approve, monitor. Settings flow console to game by API; the game keeps no copy of the rules.
- **One credit and payment system, one chatbot.** Payment and credits through moneypenny.corporatetambola.com; chat through moneypennychat.corporatetambola.com. All systems are independent and joined by API. An AI helper uses only the limited AI key and never confirms an irreversible step itself.
- **Console and game are separate.** The console is for set-up and running; the game is for playing, each game with its own website and rules.
- **Invite by ID only.** The ID is ONE alphanumeric field (employee, associate, vendor or customer ID are the same thing, wording only), with no choice menu and no names or mobile numbers. The organizer pastes or uploads one ID per line; a person who opens the game link and enters a listed ID joins and plays; an unlisted ID waits for the organizer or host to approve or decline. "Anyone with the link" is not offered. Family invite is optional (each listed person may invite 1 to 10, default 4, with approval). Only the organizer and hosts see the list, the invite chain and the log of joins, approvals and declines.
- **ID normalisation and deletion.** Every character that is not a letter or digit is removed and the rest is upper case, so A-1101, A 1101 and A/1101 are all A1101, at upload, join, approval and matching. The list and all IDs are deleted within 24 hours after the game ends.
- **Console voice.** The organizer console speaks to the organizer as "you", never "I" or "my", in simple words. Start wording: "The game starts by itself" / "You start the game"; numbers (Tambola and Bingo only): "Numbers come by themselves" / "You call the numbers". Rules and examples: [docs/CONSOLE_VOICE.md](docs/CONSOLE_VOICE.md). Ledger notes: `plans/ID-INVITE-AND-ARCHITECTURE-RULES-2026-11-20.md` in the private `marketing-ledger` repo.
