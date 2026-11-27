# Corporate Tic Tac Toe: repository knowledge (27 Nov 2026)

Complements `KNOWLEDGE-MAP.md` (family index). Written during the 27 Nov 2026 versioning order; nothing here is a secret.

## What it is
Knockout tic-tac-toe tournaments for teams (one against one or team against team), up to 10,000 players; organizer shares one link, players join on phones. Domain: corporate events (company games run by an organizer for employees/teams). Sibling repositories (all under FChecklist): corporate-tambola, corporate-bingo, corporate-snakes-and-ladders, corporate-luck-by-chance, corporate-luckydraw, corporate-tic-tac-toe, corporate-game-core, corporate-console, corporate-home; the full list with what each is for is in `KNOWLEDGE-MAP.md`.

## Stack
Bun + TypeScript monorepo (`apps/edge` Cloudflare Worker with D1 database, `apps/web/public` static pages, `packages/*` game code, `pages/` Cloudflare Pages build and Functions, `apps/cron` scheduled jobs where present). Payments only via the one IT Services payee (see KNOWLEDGE-MAP rules).

## Current version
**1.3.1**. Where it is kept: `apps/edge/src/releases.json` (newest first) and mirrored in `CHANGELOG.md`. A running site reports it at `/version.json` as `{ version, commit, dirty, builtAt, game }`; `dirty` must be false for a release (a build from a dirty tree is not a recorded release). Footers of the static pages do not show the version (hand-copied footers; not changed).

## Build / test / deploy / rollback
- Install: `bun install`. Test: `bun test packages apps tools/control-worker` (`bun run test`); typecheck `bun run typecheck`; quick version check `bun test apps/web/test/version-stamp.test.ts`.
- Local: `bun run dev`. Pages build: `bun run pages:build` (writes `pages/public`, including `version.json`).
- Deploy (only when the owner says so): `bun run pages:deploy` (Cloudflare Pages project `corporate-tic-tac-toe`). Worker database changes are the numbered files in `apps/edge/migrations`. See `docs/DEPLOYS.md`.
- Rollback: Cloudflare dashboard, Workers and Pages, project `corporate-tic-tac-toe`, Deployments: roll back to an earlier deployment (record the previous deployment id before every deploy). Database migrations are not rolled back by this.

## Release rule (from 27 Nov 2026)
Nothing is released without a version: bump the number in `releases.json`, add the CHANGELOG entry, build from a clean tree, deploy, then check `/version.json` shows the new `version`, the commit, and `dirty:false`.
