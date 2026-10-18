# The short AI work link: `https://<site>/ai/<key>`

Owner requirement (2026-10-05): the external AI link must be SHORT and take the AI to the bigger instructions by itself; the AI reads them, understands the work, the APIs and the workflow, and works as its role. It cannot code. It can make a tournament, set the options, go up to publishing, and do what an organizer or host can do by logging in, except payments and the acts listed under "What the AI cannot do" (a human does those).

Background: in a sister project a very long pasted prompt failed in ChatGPT, Gemini, z.ai and DeepSeek. Those chat tools can usually open a web address (GET) but often cannot set headers or send POST. So the link works with plain GET too (`_method`, `_body`, below).

Nothing is deployed. The address `corporate-tic-tac-toe.pages.dev` below is the planned site; today the link works only on a local server (`docs/RUNNING.md`).

## What the organizer pastes

Two short lines and the link (shown as Option 1 in the console and e-mailed in its own dedicated mail, see "Where the link may travel"):

```
This is the API documentation and instructions for MY OWN Corporate Tic Tac Toe account. I am the owner, and I am asking you to read it and help me with it.
Please open it now (a plain GET request) and follow it: https://corporate-tic-tac-toe.pages.dev/ai/cba_<48 hex>
```

Wording (from sister-project testing): "open this link and follow it" was refused as prompt injection about one time in three by a careful AI; presenting the link as the owner's own API documentation worked every time. The key appears only inside the link. The paste is built by `aiPaste` in `apps/edge/src/ai-link.ts`.

## Where the link may travel (owner rule, 2026-10-05)

Three layers together:

- **A. The e-mail's button.** The dedicated mail (`apps/edge/src/mails.ts`, `aiLinkMail`; subject "Your personal AI work link - Corporate Tic Tac Toe"; HTML + plain text; red do-not-forward warning top and bottom; numbered steps) has a button "Show my AI work link" to `/ai-link.html` (`apps/web/public/ai-link.html|js`). The address holds no secret. The page asks the organizer to sign in with the existing 6-digit e-mailed code (or uses the console's own session), then shows the lasting two-line paste in a box with Copy, seven ways to hand it to an AI (below), "Get a fresh AI link" and "Replace my AI link". A forwarded copy of the mail is useless to anyone else. The lasting key is kept sealed (`aikey/<org>` in `kv`), so the signed-in organizer can read it again (`GET /api/org/ai/link`, organizer key only; AI, co-host, mailed and platform keys get 403). It is never e-mailed.
- **B. The mail's own box uses a separate 24-hour key.** The plain-text paste box in the mail (never a hyperlink) carries a key minted only for the mail, valid 24 hours (`organizer_key.expires_ms`; after expiry it is the same plain 404 as an unknown key). "Get a fresh AI link" (`POST /api/org/ai/fresh`, organizer key only, at most 5 live) mints and mails another 24-hour key without touching the lasting key. A Host key gets its own 24-hour key in a separate mail; a Co-host (`cbc_`) has no AI link.
- **C. Unfamiliar-use alert.** When an AI or Host key is used from a country, network prefix (IPv4 /24, IPv6 /48) or program family not seen before for that key, the organizer gets ONE plain e-mail (no link, no key), at most once per key per 24 hours. The first use only sets the baseline.

No other mail carries an AI link: the publish mail (share and pay links) is safe to forward; reminders, "could not begin", invoices, report-link and partner mails never carry one; no report page, PDF or player page does. Honest limit: a mail app may turn the plain-text address in the box into a tappable link on its own, and a mail scanner may then open it; that is why the mailed key lasts only 24 hours and the alert exists.

### The seven ways to use the paste (sign-in page and console Option 1 box; not in e-mails)

Opens the AI with the paste pre-filled (`target=_blank rel="noopener noreferrer"`): ChatGPT `https://chatgpt.com/?q=`, Grok `https://grok.com/?q=`, Claude `https://claude.ai/new?q=`. Copies the paste and opens the site, with the line "Copied. Press Ctrl+V, then Send": Gemini, DeepSeek `https://chat.deepseek.com/`, z.ai `https://chat.z.ai/`. Seventh: plain Copy.

### Replace and fresh links

`POST /api/org/ai/replace` revokes every AI key (lasting and 24-hour), mints a new lasting key (shown in the console and the sign-in page), mails a new 24-hour key, and is audited. `POST /api/org/ai/fresh` is the "Get a fresh AI link" button. Both are for the signed-in organizer only; an AI key, a co-host key, the platform key or a stranger gets 403, also through an AI link. Opening the manual (`GET`/`HEAD /ai/<key>`) changes nothing except its audit line and the alert baseline.

## What the link serves

- `GET /ai/<key>` returns the complete manual for that key's role as `text/plain; charset=utf-8` (`?format=json` returns the same as data). Organizer-AI key (`cba_`) gets the full manual; a Host key (`cbh_`) a narrower one.
- `GET|POST|PATCH /ai/<key>/<api path>` behaves exactly like `/api/<api path>` with the key in `x-organizer` (`/ai/<key>/z/{id}/summary` = `/api/z/{id}/summary`). The rewritten request goes through the normal route, so the audit trail records it with the `/api` path and the real method, never the key. Only `cba_` and `cbh_` keys are accepted here: the organizer's own sign-in key (`cbk_`) and the platform key are never accepted in an address.
- Browse-only fallback, only under `/ai/<key>/`: `GET ...?_method=POST|PATCH&_body=<URL-encoded JSON>`. The decoded body is capped at 6,144 characters; a body that is not JSON gets a plain 400 explaining URL-encoding; any other `_method` is a 400; the normal `/api` routes ignore `_method` and `_body`.
- Every answer carries `x-robots-tag: noindex, nofollow`, `referrer-policy: no-referrer`, `cache-control: no-store`.
- Unknown, mistyped, revoked or wrong-kind keys all get the identical `404 Not found.` plain text and nothing is recorded. Error bodies never echo the key.
- `/api/z/ai-manifest` and the `x-organizer` header path still work for tool-capable AIs.

Files: `apps/edge/src/ai-link.ts` (the words), `apps/edge/src/ai-facts.ts` (the 10 facts), `apps/edge/src/worker.ts` (`aiLink()` routing, `canAi`, manifest), `pages/functions/ai/[[path]].ts` (Pages Function), `apps/edge/test/ai-link.test.ts`.

## Roles: Organizer, Host, Co-host

Words in the product: **Organizer** (1), **Host** (up to 5), **Co-host** (no limit). Full spec: `ROLES_AND_CONSOLE_SPEC.md`.

- **Organizer** (master key): everything, including the account (sign-in keys, e-mail, AI link, close account), adds Hosts and Co-hosts, pays.
- **Host** (`cbh_`, `organizer_key.kind = 'host'`): everything inside a tournament (settings, publish, run it, start, pause, resume), adds Co-hosts, pays. Cannot touch the account or add a Host. Through an AI work link (`x-cb-link`) a Host keeps only the narrow set of actions in `HOST_ACTIONS` (read the summary, info, participants, results, life, the report link; announce).
- **Co-host** (`cbc_`, kind `cohost`): invites people with an own link and sees how many they brought, pays. Everything else answers 403. No AI link.

## What the organizer's AI can and cannot do for a tournament

| Action | Organizer AI (`cba_`) | Host through an AI link (`cbh_`) |
|---|---|---|
| Create a tournament (a free draft nobody else can see), change it before the start: the start time (`startRound`, at most 30 days ahead), the size limit (`cap`), invite-only (`closed`), the invitation policy (`invites`), the time zone (`tz`) | yes | no |
| Read back the summary, info, participants (player ids only), results, life (when data is deleted), history | yes | summary, info, participants, results, life |
| Publish | hand-over only: the organizer confirms their e-mail and mobile and presses Publish | no |
| Pay, make a pay link | never | never |
| Start, pause or resume the tournament, choose the format or the move clock | **no** (the tournament routes refuse an AI key) | no |
| Choose, change or remove a draw, a starter, a move or a winner | nobody | nobody |
| Names and mobile numbers, people lists, the waiting room, removing people | **no**: every such call gets 403 | no |
| Erase players' data | ask only (`control/request`, the organizer confirms) | no |
| Create a Host key, cancel a tournament, close the account | no | no |
| Read the AI audit trail | yes (own) | no |

## Not true yet

- The manual text the link serves (`manualText()` in `apps/edge/src/ai-link.ts`) and the 10 facts (`apps/edge/src/ai-facts.ts`) still describe the sister product: "75-ball bingo", cards, call speed 6/9/12/15 seconds, prize patterns (Line, Four Corners, X, Blackout), brand moments, lucky draws, rounds. An AI that follows them would set options that have no effect on a tournament and would tell the organizer things that are not true. They must be rewritten from this page before the link is used.
- The settings call also accepts the sister product's `join: phone`. With it the Worker asks for a mobile number that the Tic Tac Toe player page cannot send, so nobody could join. Leave `join` alone (the default is name only).
- `announce` (a message to every phone) exists in the Worker, but the Tic Tac Toe player page and big screen do not show announcements.
- The "start and pause" requests an AI may make (`control/request`) belong to the sister product's pause file. For a tournament the host presses Pause in `host.html`.
- Simulated AI sessions and live checks that the sister product ran are not repeated here. Nothing about the AI link has been run live for Tic Tac Toe, because nothing is deployed.

## Help Desk helper keys (2026-10-19)

An AI key that belongs to a Help Desk helper (`created_by 'd'`) gets one more paragraph at the end of its manual (`GET /ai/<key>`, and `helpDesk` in `?format=json`): the AI prepares the game for the Organizer, never publishes or pays, and asks the Organizer to publish with `POST /api/helpdesk/request-publish {"eid": "<id>"}` (the key knows its own client). The unfamiliar-use alert skips these keys, and the Organizer's own `replace` and `revoke` of the AI link leave them alone. See `apps/edge/src/helpdesk.ts` and `docs/HELPDESK_SPEC.md`.
