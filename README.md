# Corporate Tic Tac Toe

A company event game. An organizer makes a tournament, shares one link, and the players open it on their phones. It is a knockout of tic tac toe boards, one against one or team against team, up to 10,000 players. The game runs on the players' own phones and laptops: each phone works out the draw, who has X, the clocks and the winner from the same public sealed seed. Our server only stores and relays data (sign-in, payment, saving, moves, agreed results, deletion after 24 hours, e-mail). Players type a display name only. Players never pay and never stake money; there are no cash prizes. Adults (18+) only.

**Everything is local. Nothing is deployed.** There is no live site, no live database and no live payment. The names `corporate-tic-tac-toe.pages.dev` and the Cloudflare ids in the config files are placeholders for the day the owner says go.

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
