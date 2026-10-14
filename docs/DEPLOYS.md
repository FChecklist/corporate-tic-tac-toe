# Deploys

What is live, and how to know.

* Open `/version.json` on the site. It holds `commit` (the git commit the pages were built from), `dirty` (true if files differed from that commit), `builtAt` (UTC) and `game`. It holds nothing else.
* A deploy is made with `bun run pages:deploy`: it builds `pages/public` (which writes `version.json`), then uploads it to the Cloudflare Pages project `corporate-tic-tac-toe`. The Worker's database changes are the numbered files in `apps/edge/migrations`.
* TEST or LIVE mode (whether real payments are taken) is separate from a deploy: `GET /api/mode`.

## Last deploys of `corporate-tic-tac-toe`

Read from Cloudflare Pages on 2026-10-14 01:41 UTC. Refresh this table with `node tools/list-deploys.mjs` (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment).

| Time (UTC) | Environment | Branch | Commit | Result | Deployment |
|---|---|---|---|---|---|
| 2026-10-13 22:29 | production | main | 1f89e71 | ok | https://07f735a9.corporate-tic-tac-toe.pages.dev |
| 2026-10-13 19:38 | production | main | 97c38c9 | ok | https://12d9f5b3.corporate-tic-tac-toe.pages.dev |
| 2026-10-13 12:37 | production | main | 12b694d | ok | https://53d617b2.corporate-tic-tac-toe.pages.dev |
| 2026-10-13 10:50 | production | main | 1c72fbb | ok | https://3c5127ab.corporate-tic-tac-toe.pages.dev |
| 2026-10-13 10:43 | production | main | f803e25 | ok | https://5cb68294.corporate-tic-tac-toe.pages.dev |
