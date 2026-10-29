# RELEASE REGISTER (boss). One row per product: version, release date and time (IST), commit, where. Update at EVERY release.

RULE (owner, 29 Oct 2026): every product shows its version and release date and time. For each release: (1) version in releases.json (semantic: MAJOR.MINOR.PATCH); (2) version.json gains "version" and "releasedAt" (ISO UTC, plus "releasedAtIST"); (3) the site footer / About / console footer prints "Version X.Y.Z, released DD Mon YYYY, HH:MM IST"; (4) a row is added here; (5) git tag <product>-vX.Y.Z on the released commit.

| Product | Live version | Released (IST) | Commit | Address | Next |
|---|---|---|---|---|---|
| Corporate Tambola | 1.6.7 | 29 Oct 2026 10:02 | e6759a0 | housie.corporatetambola.com | 1.6.8 (header+logo+PDFs, gap wave 1) |
| Corporate Bingo | 1.3.2 | 27 Oct 2026 11:56 | bd66d3c | bingo.corporatetambola.com | 1.4.0 (site + fixes) |
| Corporate Tic Tac Toe (TEST mode) | 1.3.1 | 27 Oct 2026 12:58 | 045d629 | tictactoe.corporatetambola.com | 1.3.2 (notice, fixes) |
| Corporate Snakes and Ladders (TEST mode) | 1.3.0 | 27 Oct 2026 16:43 | d2a3ebd | snakes.corporatetambola.com | 1.3.1 (join fix, copy) |
| Corporate Luck by Chance (TEST mode) | pre-port (752ff60) | 23 Oct 2026 03:31 | 752ff60 | luck.corporatetambola.com | 1.4.0 (Tambola hardening port) |
| Home site | no version.json yet | n/a | cdf70c1 (branch home-bar-qa, not live) | home.corporatetambola.com | 1.0.0 (add version.json) |
| Master console | not live | n/a | 3b3d6d3 (pushed, FChecklist/corporate-console) | console (pages.dev first) | 0.1.0 |
| DPDP | to be read from plan 120 | | | dpdp.veridian-aios.com | |
| Townhall | to be read from plan 120 | | | townhall.veridian-aios.com | |
