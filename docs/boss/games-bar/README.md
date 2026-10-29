# Corporate Games bar (the one shared navigation bar)

The slim bar at the very top of every Corporate Games website. This folder is the ONE canonical copy; every site carries an
identical copy of `gamesbar.js` and `gamesbar.css` in its public folder, and each site has a checksum test that fails if its copy differs.

## What it shows
- Laptop (900px and wider): one row, everything visible, no scrollbar:
  Corporate Games mark (to https://home.corporatetambola.com/) - strapline "Close group online engagement" (1440px and wider; the home mark shows without its words below 1280px) -
  Corporate Tambola - Corporate Bingo - Corporate Tic Tac Toe - Corporate Snakes and Ladders - Corporate Luck by Chance - Corporate Lucky Draw.
- Phone and tablet (below 900px): the mark, the current game, and an "All games" button that opens a sheet with big badges
  ("Choose a game for your close group"). Escape, the Close button or a tap outside closes it; focus returns to the button.
- Each game: its badge (the ticket/board art of the home site, drawn in the page, no outside file) with a small CORPORATE line above its proper name.
- The current site's game has `aria-current` (marigold ring): `page` on the link's own page (the site's front page), `true` on the site's other pages, so a page's own menu can mark its own page without two `page` marks.
- A page's "Skip to the content" link (first `<a href="#...">` at the top of `<body>`, class or text "skip") stays the very first Tab stop: the bar mounts right after it. The bar has no z-index of its own (only its phone sheet), so a focused skip link shows above the bar.
- The small CORPORATE line is 12.5px (the readable minimum our tests enforce), not smaller. Lucky Draw goes to https://home.corporatetambola.com/contact ("tell us you want it").
- Never the word "private"; never the old hub games.corporatetambola.com.

## How a site uses it
1. Copy `gamesbar.js` and `gamesbar.css` unchanged into the site's public folder (and the build's file list, if it has one).
2. In each public page's `<head>` link `<link rel="stylesheet" href="/gamesbar.css?v=2">` (optional but avoids a flash of unstyled bar; the script adds it itself when missing), and on each public page: `<script src="/gamesbar.js?v=2" defer></script>` (raise `?v=` whenever the files change).
   The current game is found from the web address (housie., bingo., tictactoe., snakes., luck., home., and the *.pages.dev names);
   a page may say it outright with `data-game="bingo"` (tambola, bingo, tictactoe, snakes, luck, draw, home).
3. Serve `/gamesbar.js` and `/gamesbar.css` with `Cache-Control: no-cache` (Cloudflare Pages otherwise keeps them for 4 hours).
4. Content Security Policy: works with `script-src 'self'; style-src 'self'` (no inline script or style); the badges are inline SVG.
5. Add the checksum test (see `checksum.test.ts.example`) so a site's copy can never drift from this folder.

## Changing it
Edit `src/gamesbar.src.js`, `src/badges.svg` or `gamesbar.css`, raise `VERSION` in `src/build.py`, then `python -I src/build.py`
(it writes `gamesbar.js` and prints both SHA-256 values). Check it: serve this folder (`python -m http.server 8890`) and run
`node src/shots.mjs` (screenshots at 360, 390, 768, 900, 1024, 1280, 1920 in light and dark, keyboard and aria checks, into
C:\ct\test-sites\data\ui\games-bar\). Then copy the two files to every site and update each site's checksum test.
