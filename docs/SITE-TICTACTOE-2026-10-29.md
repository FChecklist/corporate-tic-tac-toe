# Website of Corporate Tic Tac Toe in the Corporate Games look (2026-10-29)

Owner order, 29 Oct 2026: every public page of the game looks and feels like Corporate Tambola's site (housie.corporatetambola.com). Branch `site/tictactoe-cloud-2026-10-29`, cut from `origin/boss/docs-2026-10-29` (= live commit 045d629, 1.3.1, plus the boss documents and the brand kit). Nothing is deployed, merged or sent anywhere; no version number and no release note was changed.

## 1. What changed (plain English)

- **One look on every public page.** Head, games bar, header, footer and fonts come from the Corporate Games brand kit (`docs/boss/brand-kit`) and the shared games bar (`docs/boss/games-bar`). The kit files were copied with `python -I docs/boss/brand-kit/vendor.py tictactoe apps/web/public --apply --console --no-manifest`; the games bar was copied as it is. Every copy is pinned by a SHA-256 test (`apps/web/test/brandkit-checksum.test.ts`): css, js, both fonts, the Tic Tac Toe icons, favicons and the share card, and the two games bar files. The site's own manifest is kept (its start page is the player page), with the kit's colours (`#FFFAF2` and `#0B3D91`).
- **Header menu: exactly six items, in this order**: How it works | Free demo game | Guide | Brochure | Refer & earn | Log in. Same on all 21 public pages and on the two console pages. No AI assistant, Video, Pricing or WhatsApp in the header.
- **Landing page** (`index.html`) is new: the owner's question ("This week, which teams will you engage with a close group online Tic Tac Toe?"), the free-game button, the "Choose a game for your close group" row, "What you can count on", "How a game day feels" (the kit's three drawings; the middle one now shows a 3 by 3 board instead of a Tambola ticket), nine reasons, a short "How it works", an AI-assistant band, the price card, the questions, and the buy box. Pricing, the sign-in sheet and checkout (`site.js`) work as before.
- **New page: How it works** (`how-it-works.html`): five steps and the plain rules, with Tic Tac Toe's own facts (one against one, or teams of 3 or 5; 20-second clock; X moves first; a draw is replayed with the marks swapped up to 3 games, then fate decides).
- **Brochure and guide as pages and as PDFs.** `brochure.html` is the A4 sheet inside the site look, with a "Download the PDF" button; `brochure.pdf` (1 page) and `organizer-guide.pdf` (3 pages, new) are made by `node tools/make-brochure.mjs` (headless Chrome, served from a small local web server so the style sheets load). Both PDFs carry the badge and name the payee.
- **Refer & earn, Help Desk, legal pages, privacy, terms, sub-processors, data processing, refund policy, partner terms, about, contact, price list, trust page, 404, offline and sign-in** all use the same chrome. `signin.html` and `zc.html` keep their scripts and logic.
- **Organizer console and tournament page (`zc.html`, `host.html`): visual shell only.** They got the kit's tokens, header, logo, fonts, status chips and spacing (`console-skin.css`, plus the kit's `console.css`). No change to console logic, steps, options or routes. They stay in light colours (see open gaps).
- **Report PDF, e-mails and invoice** carry the new brand: the Tic Tac Toe badge drawn in the PDF band (vector, no image file), e-mail header with the badge and the small CORPORATE line above "Tic Tac Toe" on studio blue, footer "A product of IT Services by Rajat Agarwal", invoice header with the badge. `reportgen.js` was rebuilt (`bun run build:report`).
- **Payee.** Every page has the footer sentence "All payments are taken only by IT Services by Rajat Agarwal, through Razorpay." The landing, the brochure and the invoice (text and HTML, page 2 terms) say it in their own text. The payment e-mail carries the invoice text, which now ends with the same sentence. A test fails if a page names another gateway, or names Razorpay without the payee.
- **Wording.** "Close group" on the landing, how-it-works and brochure pages. The banned word was removed from pages, scripts, e-mails and the AI facts (Tambola 1.6.7's replacements were reused: "protected", "close group game", "personal link"); a test scans them. Legal documents keep "closed group" (Tambola did the same); no contract text changed, so the Terms version stays 2026-10-15.
- **Old logo removed.** `logo.svg`, `logo-mark.svg`, `logo-512.png`, `logo-1024.png`, `img/card.png`, `site.css` and `theme.js` are deleted (nothing used them any more). Share tags now point at the kit's 1200 x 630 `og-card.png`.
- **Cache.** Kit files are linked with `?v=1` (icons `?v=3`); the service worker is `ttt-game-v10` (was v9), saves the new files, and now also drops an older saved set (it only dropped `cb-game-*` sets before, so `ttt-game-*` sets piled up). The Pages build writes `no-cache` for every `.css`, `.js` and the manifest.

## 2. How to rebuild what is generated (order matters)

1. `bun run tools/make-trust.ts` (trust page + llms.txt; it applies the chrome itself)
2. `node tools/make-storage-notice.mjs` (the "what your device keeps" list on legal.html)
3. `node tools/make-site-chrome.mjs` (head, games bar, header, footer of every page; `--check` only reports). Safe to run again.
4. `bun tools/make-sitemap.mjs`, `bun run build:report` (after a change in the PDF or brand code)
5. `node tools/make-brochure.mjs` (brochure.pdf and organizer-guide.pdf)
6. Looking at the result: `node tools/browser-tests/site-shots.mjs --out <folder> --axe` (screenshots at 360, 390, 768, 1280, 1920 in light and dark, no sideways scroll, no script error, keyboard Tab through the menu, axe colour contrast).

**Do not run `tools/make-legal-pages.mjs`.** It is out of date for terms, dpa, subprocessors and the organizer guide (I checked: its output differs from the committed pages, which were edited by hand later). Only partner-terms and legal match it. Tambola also switched it off in 1.6.7. It is left as it was.

## 3. Numbers

Baseline (clean branch, `bun test --isolate` in each folder, before any change):

| Folder | Pass | Fail | Notes |
|---|---|---|---|
| packages/beacon | 87 | 0 | 6 files |
| packages/billing | 26 | 0 | 1 file |
| packages/ttt | 103 | 0 | 7 files |
| tools/control-worker | 1 | 0 | |
| apps/edge | 1334 | 0 | 73 files |
| apps/web | 223 | 2 | 225 tests, 23 files |
| packages/shared, apps/cron, tools/errorlog | no test files | | |

Stale at baseline (both in `apps/web/test/pages.test.ts`, they use a game dated 1 Oct 2026 against the real clock of 29 Oct): "Create a new game like this one ..." and "Rescheduling: a date more than 30 days ahead ...". Not touched.

Final (same command, after the work):

| Folder | Pass | Fail |
|---|---|---|
| packages/beacon | 87 | 0 |
| packages/billing | 27 | 0 |
| packages/ttt | 103 | 0 |
| tools/control-worker | 1 | 0 |
| apps/edge | 1340 | 0 (74 files) |
| apps/web | 326 | 2 (328 tests, 25 files): the same two stale tests as at baseline |


`bun run typecheck` was already failing before this work (about 80 errors in tests and beacon code); none of them is in a file of this work (I added `tools/make-site-chrome.d.mts` and fixed my own test data to keep it that way).

New or changed tests: `brandkit-checksum.test.ts` (6 tests), `gamesbar.test.ts` (rewritten for games bar v2), `site-pages.test.ts` (98 tests), `apps/edge/test/brand-kit.test.ts` (3), 1 test added to `billing.test.ts`, 1 assertion added to `pay.test.ts`; updated for the new chrome: `seo.test.ts`, `pages.test.ts`, `helpdesk-pages.test.ts`, `terms.test.ts`, `no-other-game-words.test.ts`, `ai-enablement.test.ts`, `branding.test.ts`, `storage-registry.json` (the colour choice now lists `ct-theme` and `cg-theme`).

### Plant and see red

Each fault below was planted in a copy of the real file, the named test run, the test went RED, and the file was restored with `git checkout`. 41 of 41 went red. One went green at first (the free-game button check matched the second button on the page); the test was tightened and the plant was run again: red.

| # | Fault planted | Red in |
|---|---|---|
| 0-2 | Refer & earn renamed Pricing; a seventh item (Video); Guide and Brochure swapped | site-pages: header menu |
| 3-6 | one space in tokens.css; components.css edited; one byte in icon-192.png; gamesbar.js edited | brandkit-checksum |
| 7 | a page without its games bar tag | gamesbar |
| 8-10 | the banned word in the landing, in zc.js, in mails.ts | site-pages: words |
| 11-13 | wrong canonical; old og:image; page missing from the sitemap | site-pages: share tags |
| 14-16 | misspelled link; missing #anchor; page left out of the Pages build list | site-pages: links |
| 17-18 | link to console.corporatetambola.com in a page and in an e-mail text | site-pages: links |
| 19-23 | service worker back to v9; ?v= removed; two pages with different ?v=; icons back to ?v=2; tictactoe.css not saved by the service worker | site-pages: cache |
| 24-25 | css or js back to a one-hour cache in the Pages build | site-pages: headers |
| 26-28 | footer payee sentence changed; PayU named on a page; text invoice loses the payee line | site-pages: words; billing |
| 29-30 | old logo file referenced; CORPORATE line dropped from a header | site-pages: kit look |
| 31-32 | hero free-game button goes to the plain console; FREE_GAME_CAP 10 changed to 25 | site-pages: free demo |
| 33-35 | brochure.pdf replaced by a two-page file; hero question reworded; console page loses console-light.js | site-pages |
| 36-39 | badge call removed from the report PDF; e-mail header back to teal; e-mail footer line removed; invoice badge removed | brand-kit, billing |
| 40 | a trust fact changed without regenerating trust.html | ai-enablement |

## 4. The free demo game (checked, it works)

"Free demo game" goes to `/zc.html?demo=1`. The console already had this path (`NEWDEMO` in `zc.js`): it is the Rs 0 game for up to `FREE_GAME_CAP` = 10 people, a real game with nothing marked as a demo. I walked it in real Chrome against the local Worker (`bun run apps/edge/src/local.ts`, test mode): header button, "Start your demo game", e-mail, terms tick, 6-digit code, console opens, the new game says "Up to 10 players", step 7 says "Publish (free). A game for 10 people or fewer costs Rs 0", Confirm and publish, the pill reads "Rs 0 · nothing to pay", step 7 "Published", step 8 "Paid. The game is on". Server side the same path is proved by `apps/edge/test/rs0-game.test.ts` (publishes with no payment; a bigger game must be paid for) and in the console by the "Rs 0 game" test in `pages.test.ts`. The sandbox cannot reach the public randomness beacon (drand), so the browser run used the same stand-in the test harness uses for it. I did not click 10 players through the join page (needs the consent ticks and the beacon); the join cap is covered by the edge tests.

## 5. Looking at it

`site-shots.mjs`: 160 screenshots (16 pages x 5 widths x light and dark), no sideways scroll at any width, no script or style error, axe colour contrast with no violation on any page at 1280 in light and dark. Keyboard: Tab goes Skip link, games bar, brand, then (phone: Menu, Enter opens) How it works, Free demo game, Guide, Brochure, Refer & earn, Log in; Escape closes the phone menu. Before/after of the console sign-in screen was compared against the baseline at 390 and 1280. The brochure PDF, the guide PDF, a sample report PDF (made with `layoutReport`) and an e-mail made from the real template were all opened and looked at (pdftoppm for the PDFs, Chrome for the e-mail): the badge, the small CORPORATE line, the kit's blue and gold show; the brochure fits one A4 page with its footer text.

## 6. Decisions I made (change them if you disagree)

- **20-second clock** is written on the landing, how-it-works and brochure pages, because the owner's rules and options table say 20 s only. The shipped console still lets the organizer pick 10, 20, 30 or 60, and the Rules page, the Trust page and the console help still say so. I did not change console options.
- **GitHub sentence kept** in the privacy notice and sub-processors (reworded "protected" instead of the banned word). Tambola removed it on owner order (commit e6759a0); here GitHub really runs the deletion timer, so I left the disclosure as it was until the owner says.
- **Navigation targets**: How it works `/how-it-works.html`, Free demo game `/zc.html?demo=1`, Guide `/organizer-guide.html`, Brochure `/brochure.html`, Refer & earn `/partner.html`, Log in `/zc.html` (on the landing page the same link opens the sign-in sheet).
- The page "Try it" (`demo.html`, one board against the computer) is no longer in any menu; it is still reachable from the console and the sign-in sheet.
- The old footer link "Test a payment (Rs 1)" is gone from the footer (the kit footer has no such link); `/paytest.html` still exists.
- Small things fixed on the way: a broken sentence in `partner.html` (`$1</summary>` instead of the question "Is there a catch?"); a dead anchor `/terms.html#payment` in `legal.html`; the share-tag text that described a Bingo card in the old generator (`make-legal-pages.mjs` was not edited).

## 7. Open gaps

1. **Move clock text** (see above): the organizer console, the Rules page and the Trust page still say 10, 20, 30 or 60 seconds.
2. **Console and tournament page stay light.** Their old style sheets (`app.css`, `z.css`, `zc.css`, `ttt.css`) use fixed light colours; the pages force the light look (`console-light.js`). Dark mode for them needs those sheets rewritten on the kit's tokens. The player page, big screen, payment pages, report page and AI-link page keep their own look (they only got the new theme colour and icons).
3. **Free game banner**: after publishing a Rs 0 game the green banner still says "Then pay in step 8 before the start time, or the game will not begin" while step 8 says "Paid. The game is on". Console text, not changed.
4. **Sign-in sheet text** says "Try the free 70-second demo" and links to `demo.html`, which is a short game against the computer, not 70 seconds (in `site.js` and `zc.js`). Not changed.
5. `tools/make-legal-pages.mjs` is stale (see section 2).
6. The mobile "Notify me" button (`pwa.js`) floats over the hero on phones, as it did before.
7. The live site was not reachable from this sandbox, so no comparison against the live housie site was possible; the reference was the kit and the Tambola repository (`wip/join-redesign`, 1.6.7).
8. Not deployed: Cloudflare Pages must be rebuilt from this branch; `/brochure.pdf` and `/organizer-guide.pdf` are in the build list.
