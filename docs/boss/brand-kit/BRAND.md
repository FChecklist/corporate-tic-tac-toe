# Corporate Games: brand in plain English

Owner order, 29 Oct 2026: "complete websites, console of all products; use the logo you created and used on home.corporatetambola.com; look and feel like housie.corporatetambola.com for all games' individual websites; all consoles super simple; keep branding uniform."

This page is for people, not programmers. The files that carry out these rules are in this folder; a test checks the rules that a machine can check.

## 1. What we are

**Corporate Games**: online games for company events, for the people you invite. We work closely with HR teams.

- Say **close group**. Never use the word the owner banned (it starts with the letters p-r-i and ends with v-a-t-e). A test fails if it appears in any file.
- Say **Online games for company events** as the one-line strapline everywhere (footers, social cards, the home page).
- Games are **online**. Players never pay, nothing to install, only invited people can join.
- **English only.**
- Short sentences. A person who has never played should understand every button.

## 2. The six products and their names

Every product is called **Corporate** plus its proper name. The word **Corporate** is always a small line above the name, in small capitals; the name is large.

| Site | Written as | Colour of its badge |
|---|---|---|
| housie.corporatetambola.com | Corporate **Tambola** (also called Housie) | red-rose ticket |
| bingo.corporatetambola.com | Corporate **Bingo** | blue card |
| tictactoe.corporatetambola.com | Corporate **Tic Tac Toe** | green board |
| snakes.corporatetambola.com | Corporate **Snakes and Ladders** | brown-orange board |
| luck.corporatetambola.com | Corporate **Luck by Chance** | violet dice |
| (not built yet) | Corporate **Lucky Draw** | teal draw |
| home.corporatetambola.com | **Corporate Games** | indigo ring of coloured dots |

In running text we may drop the word Corporate after the first mention ("Tambola"). In headers, footers, titles, social cards and the games bar we always show both lines.

## 3. Colours

Warm and festive. Deep blue for actions, marigold and saffron for warmth, teal and rose for the soft washes, warm white for paper. The exact values are in `tokens.css`; never type a colour into a page, use the token.

| Name | Light | Dark | Used for |
|---|---|---|---|
| Paper (page) | #FFFAF2 | #130F2E | page background |
| Card | #FFFFFF | #1D1845 | cards, panels |
| Ink | #1B1442 | #F6F3FF | all text |
| Quiet text | #4D4870 | #C9C3EA | hints, small text |
| Studio blue (action) | #0B3D91 | gold #FFC34D | buttons and links |
| Accent brown | #9E3C00 | #FFB86B | small kicker headings |
| Marigold | #FFC93C | same | highlights, the "Free demo game" button |
| Saffron | #F08C00 | same | dashed borders, details |

**Header colour theme.** The top bar and the buttons follow one of three colours, chosen with the three dots in the header: **Studio blue (the default for every game)**, Maroon, Emerald. The home site uses its own Indigo. Light and dark follow the device; the Dark / Light button in the footer overrides it.

**Game colours.** Each game keeps the colour of its own ticket or board (see the table above) for its badge, the stripe on its card and its soft background wash.

**The ten console steps** keep their colours: 1 blue, 2 aqua, 3 violet, 4 magenta, 5 green, 6 yellow, 7 orange, 8 lime, 9 violet, 10 red. **Status words** are never shown by colour alone: Draft, Waiting for payment, Ready, Playing now, Finished, Cancelled, Did not start.

All text colours meet WCAG AA contrast (4.5 to 1; 3 to 1 for large parts). The test lists every pair.

## 4. Fonts

- **Fraunces** (bold) for headings, names and numbers. Warm and friendly.
- **Inter** for everything else.
- Both files are copied into the site (`/fonts/`). Never load fonts from Google or any other site.
- Smallest text anywhere: 12.5 px (only the small CORPORATE line and tiny labels). Body text 17.5 px on websites, 16 px in consoles.

## 5. The logo

- The **badge** of each game is a small picture of its ticket or board on a coloured rounded square. These six badges and the Corporate Games mark are the logos. They were drawn once for the home site and are copied, not redrawn.
- The **lockup** is the badge, the small word CORPORATE, and the proper name. Light version for light backgrounds, dark version for dark backgrounds.
- The **social card** (1200 by 630) shows the badge, CORPORATE small above the large name, and the strapline.

Do:
- Use the files in `logos/` exactly as they are.
- Leave clear space around a logo equal to a quarter of its height.
- Use the badge alone only when the name is written next to it or the page is already about that game.
- Use the dark lockup on dark backgrounds.

Don't:
- Do not redraw, recolour, stretch, rotate, outline, shadow or put the badge on a busy picture.
- Do not write the name in another font or put the word Corporate in the same size as the name.
- Do not put the badge of one game on another game's site header.
- Do not add words like "Pro" or "AI" to a name.

## 6. The header and the menu

Every website header has the **same six items, in this order**: How it works | Free demo game | Guide | Brochure | Refer & earn | Log in. On a laptop they sit in one row with the three colour dots; on a phone they open from one Menu button. No AI assistant, no Video, no Pricing, no WhatsApp in the header (those can live lower on the page). The page's own link address may differ from site to site; the words and the order never do.

## 7. Consoles

A console is the page where the organizer sets up and runs a game. It must feel like the websites: same fonts, same rounded corners, same spacing, same buttons. It is super simple: one thing at a time, one big button, plain sentences, a short hint under each step. The ten steps keep their names, colours and order.

## 8. Where the rules live

- Colours, type, spacing, radius, shadows: `tokens.css`
- Website parts: `components.css` (all classes start with `ck-`)
- Console parts: `console.css` (all classes start with `cs-`)
- Logos, icons, social cards: `logos/`; manifests: `manifest/`; page parts to paste: `snippets/`
- How a site takes the kit: `README.md`
