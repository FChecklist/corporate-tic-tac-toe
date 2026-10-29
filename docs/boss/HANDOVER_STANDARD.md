# Handover standard: VERY DESCRIPTIVE (owner rule, 2026-10-27)

Why: information is lost when handover notes are short. A person or a new session that has seen nothing must be able to continue from your file alone, with no questions.

Every handover file MUST contain, in plain English, in this order:
1. WHO and WHEN: session name, date, laptop time of the last update.
2. GOAL: what the owner asked, in his own words where possible, and why it matters.
3. DECISIONS made (owner's and ours): each with date, who decided, reason, and what it replaces.
4. DONE: every item with commit id, branch, folder path, test files run and the exact numbers (pass/fail), what was falsified and how, and the live proof (URL, version, D1 row counts) if deployed.
5. NOT DONE / OPEN: every item, why it is open, who must act (owner / which session), and the exact next step.
6. FILES AND PLACES: every folder, repo, branch, worktree, script, log, data file, artifact link, and Cloudflare/GitHub object touched or needed, with full paths.
7. HOW TO RESUME: step-by-step commands and checks (what to run first, what lock/RAM rules apply, what NOT to do).
8. RISKS AND TRAPS found: mistakes made, wrong turns, tool bugs (e.g. stale element handles), things that looked fine but were not.
9. FACTS WORTH KEEPING: ids, numbers, times, names of settings, wording the owner approved (exact text of messages).
10. QUESTIONS for the owner, with our recommendation.

Rules: no secrets or tokens ever; no real people's names/mobiles; write the file in the first 10 minutes of work and update after every milestone, not only at the end; never delete old content, append dated sections; if you were told something in chat that is not in a repo, it goes here.
