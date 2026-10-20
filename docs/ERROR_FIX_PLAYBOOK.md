# Playbook for the owner's AI: fix every open error

The owner says: **"Read docs/ERROR_FIX_PLAYBOOK.md and fix every open error."** This page is the whole job. The product never calls an AI; the owner starts this. Read `docs/ERROR_LOG.md` first for how the error box works.

## Rules that never bend

1. **No personal data.** Reports are cleaned, but if you ever see a name, phone number, e-mail address, key or token in a report, do not copy it anywhere (commit, test, note). Tell the owner and fix the cleaning in `apps/web/public/blackbox.js`, `pages/functions/api/blackbox.ts` and `apps/edge/src/errorbox.ts` (they must stay in step).
2. **Fix the cause, not the symptom.** An error that is only hidden will come back as "reopened".
3. **Every fix gets a test** that fails without the fix (run it once with the fix removed to see it fail, then restore). Put it next to the code it protects.
4. **Run the checks before you record anything:** `bun test apps packages --timeout 120000` must show 0 failures. If a test fails that you did not touch, say so; do not hide it.
5. **Do not deploy and do not push without the owner's yes.** Commit locally with the error id in the message. The owner decides when it goes live (`docs/DEPLOYS.md`).
6. **Do not change payments, prices, the 24-hour deletion promise or the privacy text** to make an error go away. If an error points there, stop and ask the owner.
7. **RAM:** this laptop has 8 GB shared with other sessions. Run one test command at a time.

## The job, step by step

1. `node tools/errorlog/pull.mjs` prints the open errors (new or reopened) and writes one plain report each into `errors/inbox/<id>.md`. If it says "No open errors", tell the owner and stop.
2. For each file in `errors/inbox/`, newest first and `error` before `warn`:
   1. Read the whole report: what failed, the game and its stage, the device, and the trail of the last actions (oldest first). The trail is the story of how the person got there.
   2. Find the cause in the code. Browser errors: `apps/web/public/*.js`. Server errors (kind `worker` or `server`): `apps/edge/src/*.ts`; the route is in the report.
   3. Reproduce it with a test (the page test harness `apps/web/test/harness.ts`, or an edge test with `newWorld`). If you cannot reproduce it, say so in the note and add the most likely guard plus a log line the next report will show; do not mark it fixed on a guess.
   4. Fix it. Then run the test, then the whole suite.
   5. Commit locally: `git add <files>` then a message that starts with `Fix <error id>: ...`.
   6. Record it: `node tools/errorlog/resolve.mjs <error id> --files "path1,path2" --note "what was wrong and what you changed" --commit <short sha>`. This marks it fixed and writes `errors/FIXED.md` (the files and the fix). Use real repo paths.
3. Warnings (`sev` warn: refused calls, slow calls) and end-of-game summaries (`kind` game-end) are not always faults. Decide with evidence: if a refusal is the normal behaviour (for example a wrong code), say so in the note and resolve it as "expected, no code change", naming the file that proves it.
4. When all are done, tell the owner in plain words: how many errors were open, how many were fixed, what each fix was (file paths and one sentence), what was not fixed and why, and that nothing is live until the owner says deploy.

## What "fixed" means

An error is fixed only when: a test fails without the change and passes with it, the whole suite passes, the commit exists, and `resolve.mjs` accepted the record. If the same error returns after the fix is live, the box shows it as **reopened**; read the earlier fix (it is in the report) before trying again, because the first guess was not enough.
