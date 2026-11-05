# Sales funnel statistics (owner order 1 Nov 2026)

Switch: `FUNNEL_EVENTS=on` (a Worker variable). Anything else, or not set, is OFF: the page route answers 204 and drops the event, the server steps write nothing and no table is made. It stays OFF until the owner has audited it.

Events (the owner's list, core `makeReporter` names): viewed, size_chosen, signup_started, game_created, game_published, payment_page_reached, payment_page_opened, payment_link_copied, payment_started, payment_succeeded, payment_failed, game_started, game_completed.

| Event | Written by |
|---|---|
| viewed, size_chosen, signup_started, payment_page_opened | the public pages: `funnel-pages.js` with the common reporter `tttfunnel.js` (pages: home, pricing, how it works, brochure, payment entry) to `POST /api/f` |
| game_created, game_published, payment_page_reached, payment_link_copied, payment_started, payment_succeeded, payment_failed | the Worker (`worker.ts`, `pay.ts`), through `recordFun` |
| game_started, game_completed | the lifecycle tick (`lifecycle.ts`): a paid game that has started, and one that has ended with at least one player |

Privacy: a row is `(k, ev, at_ms, size, mode, reason)`. `k` is a random 12-character id made for one page load, or the first 12 hex characters of a salted hash of a game or payment id. `size` is a number of players. No name, mobile number, e-mail, ID, address or user agent is read, and nothing is stored on the device. Do Not Track and Global Privacy Control: the page sends nothing and the route drops anything that arrives. TEST mode and test accounts are not counted. Rows older than 400 days are deleted by the daily sweep.

Table: `ttt_fun`, created by `CREATE TABLE IF NOT EXISTS` the first time it is needed, so there is no migration to apply before switching on, and a missing table never breaks a game or a payment.

Owner report: `GET /api/owner/funnel?from=YYYY-MM-DD&to=YYYY-MM-DD` (platform key in `x-organizer`, 404 for anyone else; each read is written to the access log), `&format=csv` for the CSV. Page: `/owner-funnel` (noindex). Total, by week and by day, with the percent of the previous step and of the first.

Counting: a page step is once per page load (the reporter keeps nothing between pages, so a visit that opens two pages counts as two); a server step is once per game or payment.

Tests: `apps/edge/test/funnel-unit.test.ts` (no Worker needed), `apps/edge/test/funnel-routes.test.ts` (every event from the real routes, owner route, off switch, no personal data), `apps/web/test/funnel-pages.test.ts` (the real page scripts).
