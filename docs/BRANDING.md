# Branding: Corporate Tic Tac Toe, the same everywhere

The name is spelled exactly **Corporate Tic Tac Toe**: never in capitals, never shortened to "TTT" in anything a customer reads. The tagline in `apps/edge/src/brand.ts` is "Live engagements for companies" (inherited; the owner may want "A tic tac toe tournament for your company").

Palette (the site's, from `apps/edge/src/brand.ts` and the manifest): teal `#0B5D5B` (theme colour, headers), gold `#FFC93C` and light gold `#FFE08A`, ivory `#F7FBFA`, line `#D5E3E1`; the manifest background is `#FFFDF9`. One support address, the one the legal page publishes: `rajatsiroffice@gmail.com`; phone +91 96503 97480. One legal link: `/legal.html`.

## E-mail

Single source: `apps/edge/src/brand.ts` (`BRAND`, `headerHtml`, `footerHtml`, `footerText`, `pageHtml`, `plainToHtml`, `withFooter`). Every e-mail goes through `sendMail` / `sendReportMail` (`apps/edge/src/pay.ts`), which add the footer to the text part and wrap a plain mail in the branded HTML, so a mail without the brand cannot go out. The builders in `apps/edge/src/mails.ts` (AI-link mail, Host and Co-host link mails, new-use alert, sign-in mail) use the same header and footer rows.

Guard: `apps/edge/test/branding.test.ts` fails if an exported `*Mail` builder lacks the header or footer (in HTML and text), if a new builder has no sample in the test, if a mail of a full lifecycle lacks the footer, if the mail service is called from anywhere but `pay.ts`, or if a page loses its title pattern, icons, manifest or theme colour. This test was inherited from the sister product and has not been re-run for Tic Tac Toe in this pass.

Who gets e-mail: only the Organizer and Hosts. Players give a display name only, so no mail ever goes to a player.

## Pages

- Title pattern: `<Page> | Corporate Tic Tac Toe`. Examples: `Play | Corporate Tic Tac Toe` (`z.html`), `Big screen | ...` (`big.html`), `Run the tournament | ...` (`host.html`), `Organizer console | ...` (`zc.html`).
- Every shipped page has a favicon, a touch icon, the manifest and the theme colour `#0B5D5B`.
- The player page (`z.html`) is an installable web page (manifest `short_name`: Corporate Tic Tac Toe, start URL `/z.html`).
- A branded `404.html` with a way home.
- The organizer can add a brand strip (company name, accent colour, small logo up to 30 KB, resized in the browser and stored with the tournament settings, no outside request). The player page (`ttt.js`) shows the company name on its accent colour at the top (not the logo yet). The big screen does not show the strip; its header says "Corporate Tic Tac Toe". There is no "Powered by" line yet.

## Copy rules (the brevity rule, owner, 2026-10-05, kept)

- Short plain sentences, one idea each, for a non-technical owner. Nothing that explains instead of helping the next click. Legal text lives on the legal pages.
- Soft claims we can prove. We say "built for DPDP, GDPR and US privacy laws", not "compliant", until it is confirmed.
- No gambling or betting words (see `docs/GLOSSARY.md`). Players never pay and never stake money; there are no cash prizes; adults (18+) only; it is a company event.
- The join page shows the short notice first and one clear tick box (`docs/PRIVACY_AND_LIFECYCLE.md`, section 1), with a "Privacy Policy" link (`/legal.html#privacy`, opens in a new tab) and a Terms link under it.
- The do-not-forward warning in AI-link mails is one sentence: "DO NOT FORWARD: this email holds your personal AI work link".

## Not true yet

- The app icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) are still the sister product's: `tools/make-icons.py` draws a bingo ball with the letter B and a card grid on a teal square. They need a Tic Tac Toe mark.
- The manifest description says "The whole game is saved on your phone and plays from your own device". That is not how this product works: the server decides every move. The sentence should be replaced.
- `apps/edge/wrangler.toml` sends mail "from" `bingo@veridian-aios.com`. The sender name and address need a Tic Tac Toe one before launch.
- The report page title is "Your engagement report | Corporate Tic Tac Toe"; the console and e-mails still say "engagement" in places where the player-facing pages say "tournament".
