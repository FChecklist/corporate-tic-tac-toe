# The error log: how every error is caught, saved and fixed

Written 2026-10-20 for the owner. No technical knowledge is needed to read this page.

## What it does, in one minute

1. **Every error in the real working is caught automatically.** A small recorder (`apps/web/public/blackbox.js`) runs inside each visitor's own phone or laptop, in that device's memory. It watches the page, the game and every call the page makes to our service. Our server does no watching.
2. **When something goes wrong, the device writes one complete error report and sends it.** The report says what failed and where, which game and which stage of the game it happened in, what kind of phone or laptop it was, and the last 40 actions on that device (what was tapped, which page opened, which calls were made and how each one ended). If the phone is offline, the report waits on the phone and is sent when it is back online.
3. **The reports are saved and grouped.** The same error from a hundred phones becomes one entry that says "seen 100 times", with up to four full samples. They are kept in the same free database the site already uses. There is no new server and no extra cost.
4. **Errors on our own side are saved too.** If the service itself fails (a payment notice, the housekeeping job, any route), the real error is saved, not just a count.
5. **When you want, your AI fixes them.** You open your own AI (Claude Code) and tell it: *"Read docs/ERROR_FIX_PLAYBOOK.md and fix every open error."* It pulls the open errors, fixes and tests each one, and records **which files it changed and what it did**. The fix history is in `errors/FIXED.md`. Nothing in the product calls an AI. The AI is only what you use.
6. **If a fixed error comes back, it is reopened.** If the same error appears again after the fix has had time to reach people's phones (15 minutes), the entry shows as **reopened**, with the earlier fix still on record.

## What is watched

| You asked for | How it is done |
|---|---|
| Every error in the real working | Script errors, files that failed to load, promise failures, console errors, server errors (HTTP 500 and above), calls that never reached the server, calls that were refused or slower than 8 seconds. |
| Every game from start to end | Every report carries the game and its stage (waiting to start, play, paused, brand break, ended). The player screen tells the recorder each time the stage changes. When a game ends, a device that had errors sends a short end-of-game summary (calls seen, time offline, errors). One device in twenty that had no errors sends one too, to show how a healthy game looked. |
| Every action | The trail of the last 40 actions on the device is attached to every report: taps (which control, never its words), changes (which control, never its value), page opened, page hidden or closed, going offline or online, the game stage, and each call with its result and time. |
| Done on the user's device, not our server | The recording, the trail, the report and the repeat-checking all happen on the visitor's device. Our server only receives a small finished report and stores it. |
| Every log kept | All error entries stay until fixed, then 90 days after the last time they were seen. Up to four full reports are kept per entry, for 90 days. |
| AI fixes it and says what it did | `tools/errorlog/resolve.mjs` records the file paths and the fix, and writes it to `errors/FIXED.md`. |
| AI is not part of the product | Correct. The product never calls an AI. |

## What is never recorded

Typed text, names, phone numbers, e-mail addresses, the words written on buttons, query strings, keys and tokens, cookies, and the visitor's IP address. Anything that looks like a phone number, an e-mail address, a key or a token is replaced by a label such as `[number]` on the device, and again on the server. The tests prove this: `apps/web/test/blackbox.test.ts`.

The one thing the recorder may keep on a phone is a waiting report while it is offline (key `ctz-bbq`). It is listed on the Privacy page under "what your device keeps".

## For the owner: the three things you ever do

1. **See what is open:** `node tools/errorlog/pull.mjs`. It prints a short list and writes one plain report per error into `errors/inbox/`.
2. **Have it fixed:** tell your AI: *"Read docs/ERROR_FIX_PLAYBOOK.md and fix every open error."*
3. **Check what was done:** open `errors/FIXED.md`. Every fix names the files and says what changed.

To make step 2 happen on a schedule, ask your AI to create a scheduled task that runs that sentence (for example every morning). That is your choice and your AI; the product does not do it.

## Where things are

| What | Where |
|---|---|
| The recorder on the device | `apps/web/public/blackbox.js` (loaded on every page that has the speed monitor, plus the demo and preview) |
| The box that stores the reports | `pages/functions/api/blackbox.ts` (tables `error_group`, `error_report`, created on first use) |
| Server-side errors | `apps/edge/src/errorbox.ts`, called from the front door in `apps/edge/src/worker.ts` |
| Pull open errors | `tools/errorlog/pull.mjs` |
| Mark an error fixed | `tools/errorlog/resolve.mjs` |
| What the AI does | `docs/ERROR_FIX_PLAYBOOK.md` |
| Fix history | `errors/FIXED.md` |
| The key to read the box | `config/telemetry-report-key.txt` (kept off GitHub) |
| Tests | `apps/web/test/blackbox.test.ts` |

## Honest limits

- **It sees only what happens on devices and in our service.** If a person's phone is switched off, or the page never loads at all, there is no recorder to speak. The existing uptime check (every 15 minutes) covers a site that is down.
- **It cannot invent a fix.** It saves the evidence. The fix is made by your AI, and tested before it is marked fixed.
- **A fix reaches phones slowly.** Pages are cached for up to 4 hours, so an old error can keep appearing for a while after the fix is live. That is why "reopened" waits 15 minutes and why the fix note says the commit.
- **Capacity.** The free database holds about 5 GB. At most 3,000 reports are stored per day and at most 40 per error per day, so a flood cannot fill it. The counts still go up.
- **Other games.** This is built into Corporate Tic Tac Toe. Bingo, Tic Tac Toe, Snakes and Ladders and Luck by Chance have their own sites and need the same files copied in (the recorder, the box, the two tools); the plan is in `docs/ERROR_FIX_PLAYBOOK.md`.
