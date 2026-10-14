# What we keep, and for how long

Everything is kept in one Cloudflare D1 database (table `kv` holds small keyed records). The daily housekeeping (`purgeOld`, run from the one-minute job and from the first organizer request each UTC day) and the lifecycle job (`apps/edge/src/lifecycle.ts`) enforce this schedule. Tests: `apps/edge/test/retention.test.ts`, `apps/edge/test/privacy.test.ts`, and for the tournament tables `apps/edge/test/tournament.test.ts` (G18/D5). The full data map, field by field, is `docs/PRIVACY_AND_LIFECYCLE.md`.

"End" means the moment the final is decided (or 6 hours after the scheduled start if nobody finishes). The promise to players is "within 24 hours"; the job deletes at 23 hours.

| Data | Where | Kept | Then |
|---|---|---|---|
| Player names (sealed copy), seat, device hashes, consent record (Terms version, boxes and time), invite record, people lists, waiting requests, the names shown on the bracket and in the top-100 ranking, report working copies | `participant`, `seat`, `person`, `waiting`, `ttt_p`, `ttt_e`, `ttt_consent`, `ttt_t.ranking`, `kv seats-base/ rpt* seats-blk/` | 23 hours after the end | Deleted (`erasePersonal`). |
| The personal part of players' security-log rows (network address, browser string, device id, fields sent, network number) | `audit_pii`, key salt in `eng_key` | 23 hours after the end | Crypto-shredded: salt and blobs destroyed, the hash chain still verifies |
| Match record: the two sides (opaque ids), the moves of each game (square and time), clocks, results | `ttt_m` | Until 00:00 IST at the end of day 365 | Deleted with the tournament (`eraseEverything`) |
| Tournament settings, sealed seed and secret, counts, start and end times | `ttt_t` | Until the end of day 365 | Deleted |
| A player's request to see, correct or delete their data (card id, kind, short note, times: no name, no number) | `data_request` | 22 hours after the game ends, with the participants | Deleted (`erasePersonal`); again with the game at 365 days |
| Winners record: the opaque seat numbers of first to fifth place | `winner` | Until the end of day 365 | Deleted |
| Tournament, its settings, the end-of-game clock, organizer contact | `engagement`, `life`, `cbl_request`, `kv control/ contact/ pub/ ann/` | Until 00:00 IST at the end of day 365 after the end. An unpublished draft: 30 days | Deleted (`eraseEverything`) |
| Security log, non-personal core of players' rows; whole rows of organizers, hosts, co-hosts, AI keys | `audit_log` | 365 days (deleted with the tournament) | Deleted; an anonymous count (`audit_stats`) and a deletion certificate (`audit_cert`) stay |
| Organizer account: sign-in keys, e-mail hash, sealed e-mail for our mails, sealed lasting AI key, terms version accepted | `organizer_key`, `organizer_email`, `kv orgmail/ aikey/`, `organizer_terms` | While the account exists | Deleted by "Close my organizer account" in the console (with every tournament and the AI audit trail) |
| Host name, e-mail or mobile (sealed) | `organizer_key` | While the Host key exists | Retired Host keys: 90 days, then deleted by the sweep |
| Co-host name and mobile (sealed), key bound to one tournament | `organizer_key` | Until the tournament's personal data is erased (23 hours after the end) or it is cancelled | Deleted |
| E-mailed 24-hour AI keys | `organizer_key` (`expires_ms`) | Expire after 24 hours; row deleted 7 days later | Deleted by the sweep |
| Retired (revoked) keys | `organizer_key` | 90 days | Deleted by the sweep |
| Sign-in codes and one-click sign-in tokens (hash only) | `login_code` | 10 minutes; row deleted 1 day after it expires | Deleted by the sweep |
| Partner sign-up codes and e-mail deletion confirmation codes (hash only) | `kv penr/ delreq/` | 10 minutes (deletion codes 30 minutes); row deleted after 1 day | Deleted by the sweep |
| Report-link salt | `kv rptsalt/` | Until the tournament is deleted | Deleted with it |
| Network-address hashes for daily limits (sign-up count, bad sign-in tries, partner limits, join limits) | `kv start/ linkfail/ plim/ jlim/ jbm/` | 2 days | Deleted by the sweep |
| "New place" records for AI keys (country, network prefix, program family) and the alert clock | `kv seen/ alert/` | While their key is live | Deleted by the sweep when the key is retired or expired |
| AI audit trail (time, key id, call, status, network address, program, country) | `ai_audit` | 365 days | Deleted |
| Mail outbox | `outbox` | A mail that was sent keeps no body. An unsent mail without a key: 3 days. An unsent mail with a link: no body at all | Deleted |
| Monitoring from `rum.js` (page path without query, referrer site, device class, speed, script errors, failed or slow API calls with their path, country) | `telemetry` (`pages/functions/api/telemetry.ts`) | 90 days | Deleted by the clean-up that runs on about 1 write in 100 |
| Visits to the public website pages (source, landing page, device, language, country and city, sections seen, choices made, visitor id, shortened network address, keyed hash of the address; never names, numbers or e-mail addresses; never the game pages) | `visit_session`, `visit_event` | 365 days after the visit began | Rolled into anonymous per-day totals (`visit_agg`, kept), then deleted. With Global Privacy Control or Do Not Track only the totals are kept |
| Daily write counters | `usage` | 90 days | Deleted by the sweep |
| Payments, invoices, entitlements, the payment ledger | `payment`, `invoice`, `entitlement`, `payment_ledger` | For the legal period, as the law requires (product rule 2026-10-09), separate from game data | Never deleted by code (TEST-mode clean-up only removes test payments) |
| Organizer's invoice details (name, e-mail, mobile) and who paid (name, organisation, e-mail, mobile, country, GSTIN) | `legal_party` (a copy per paid tournament, written at payment and again just before the tournament is deleted), and the payment and invoice rows | Same | Never deleted by code |
| Partner account (name, random code, hashes of phone and e-mail, key hash) and commissions | `partner`, `commission` | While the partner is active; commissions as accounting records | Partner row deleted by "Close my partner account"; commission rows stay without any link to a person |
| Ideas from organizers' AI assistants (no names or numbers) | `suggestion`, `suggestion_vote` | Until we remove them | Not deleted by code |

## Tables this product never fills

The shared Worker still has the tables `claim`, `rvote`, `rcand`, `overvote` and `prize`. A tournament does not write to them (winners are decided by the server, and the podium goes to `winner` as seat numbers), so they hold nothing about players. `erasePersonal` still clears them, which does no harm.

## Open (decisions, not code)

- Partner commission records (kept as accounting records). Payments, invoices, organizer invoice details and payer details are kept by product rule.
- Whether the one-year log rule in DPDP Rule 6(1)(e) reaches any of the above. The owner decides.
- Whether the security log of players (23 hours) must be named in the short player notice. The owner decides.
