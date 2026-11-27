# Changelog: Corporate Tic Tac Toe

Newest first. Release entries below are taken from `apps/edge/src/releases.json` (the source of truth, served to the owner at `/api/owner/releases`); this file mirrors them. The number a running site reports is `version` in `/version.json`.

## 1.3.2 - 2026-11-27 (not deployed)
Decision of 27 Nov 2026: hide the public pages of this game without deleting anything. Based on the live code (fa5ab0a), standalone: it does not depend on the pay-via-console branches. Nothing is deployed and the switch is OFF by default.
### Added
- `SITE_HIDDEN` switch (`apps/edge/src/site-hidden.ts`, called from `pages/functions/_middleware.ts`). With SITE_HIDDEN set to 1 (a Cloudflare Pages variable, no rebuild) the landing page and the sales pages (/, /index, /about, /brochure, /pricing, /trust, /organizer-guide and the how-it-works pages) show a short 'This game is coming soon' page with a link to home.corporatetambola.com, send noindex (meta tag and X-Robots-Tag), and /llms.txt and /sitemap.xml answer 404; that page has no schema, no Open Graph and no agree buttons. Join links (/j/...), the player page, the host and organizer pages, sign-in, payment return, the legal pages, /api and the console links are NOT touched, so people who already have a link or a game still play. Switch off or unset: nothing changes. Nothing is deleted.
- Test `apps/edge/test/site-hidden.test.ts` (switch off = unchanged, switch on = coming soon, join/host/api untouched).
### Changed
- `pages/build.mjs`: `/llms.txt` and `/sitemap.xml` are served through the function so the switch can answer them (off: they are served exactly as before).
### Rollback
- Unset `SITE_HIDDEN` in Cloudflare Pages (instant, no deploy), or redeploy the previous version (1.3.1).

## Unreleased (27 Nov 2026, versioning order)
Added
- `/version.json` now also carries `version` (the newest release number in `releases.json`), next to `commit`, `dirty`, `builtAt`, `game`. Where: `pages/version.mjs`, `apps/web/test/version-stamp.test.ts`, `docs/DEPLOYS.md`.
- This CHANGELOG.md and `docs/REPO-KNOWLEDGE.md`.
No game, edge or page behaviour changes. No version bump: the current release stays 1.3.1. Not deployed.

## 1.3.1 - 2026-10-27 (commit f64da69)
Bigger daily write guard
- The daily database-write guard is raised to 2,000,000 (a runaway guard only), because the account is on the paid Workers plan

## 1.3.0 - 2026-10-27 (commit c00e029)
Same hardening as Corporate Tambola 1.3.3: joining, permissions, messages, simpler console
- Joining: an employee ID or mobile number is checked against the organizer's list (or either of them), a stranger waits for the organizer's yes, one phone cannot play as another (device proof on every place action), the same person joining twice gets the same place
- A join that gets no answer (slow link, busy moment) is asked again by itself, safe because the same person always gets the same place
- Permissions: a Co-host who has not accepted the terms cannot pay or use credit, an erase is refused while the tournament is being played, a forged vote or game-over report is refused
- A game published but not paid never blocks a new game: only never-published drafts count towards the ten
- Simpler console: radio buttons and check boxes, a plain sentence under the main options, a live line with the choice so far, what not to do and why on every step; the rarely used 'What must a person give to get in?' choice is hidden, never disabled, until staff-only is ticked
- A demo link (zc.html?pass=) is used once, also when the console opens straight into a game
- Players' data is deleted 20 hours after the end (the promise stays 24 hours) and a lazy tick runs the housekeeping when the scheduled job is late
- Every refusal now says what happened, where, and how to fix it (guide catalog)
- Big screen shows 'Connection lost' when the server does not answer for 15 seconds
- The public random beacon can be reached through our own server when a company firewall blocks it

## 1.2.0 - 2026-10-23 (commit c7b2006)
One-door sign-in, protected pages, step state in the console
- One sign-in door for Organizers and Hosts with a six-box code screen, e-mail first on the console card
- Shipped scripts are minified, AI crawlers are told not to read the product, Terms 2.4
- The console keeps the state of each step

## 1.1.0 - 2026-10-14 (commit 7180609)
Owner desk, rights, colour, installable app
- Owner desk: site switch, organizer lookup, data requests, error signal
- Players can leave and ask for their data
- Vivid colours, short animations, installable app
- Ledger C: every payment attempt posted to the central service

## 1.0.0 - 2026-10-13 (commit f803e25)
Corporate Tic Tac Toe goes up
- Knockout tournament of tic tac toe boards, played one against one or in teams; the phones play and the server is only a mailbox
- A sealed draw anyone can check, a champion and final places with no ties
- Payment through the central payment service, report by e-mail
