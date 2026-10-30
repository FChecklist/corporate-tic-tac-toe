// Builds the new public pages of Corporate Tic Tac Toe from the shared brand kit snippets (C:\ct\test-sites\corporate-brand-kit\snippets).
// Run: node tools/site/make-pages.mjs   (writes apps/web/public/{index,how-it-works,guide,brochure,refer,thank-you,game-completed}.html and sitemap.xml)
// The kit files themselves are never edited here; this only pastes them into pages and adds this game's own plain words.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KIT = process.env.BRANDKIT || "C:/ct/test-sites/corporate-brand-kit", PUB = join(import.meta.dirname, "../../apps/web/public");
const ORIGIN = "https://tictactoe.corporatetambola.com", V = "2", VERSION = "1.5.0";
const snip = (n) => readFileSync(join(KIT, "snippets", n), "utf8").replace(/\r/g, "").trim();
const spriteAll = snip("sprite.html"), sprite = spriteAll.replace(/<symbol id="(?!i-ttt")[\s\S]*?<\/symbol>/g, ""),  header = snip("header-tictactoe.html"), footer = snip("footer-tictactoe.html").replace(/(<p class="ck-brandline">[^<]*<\/p>)/, `$1<p class="ck-small" data-version>Version ${VERSION}</p>`);
const LEG = { terms: "Terms", privacy: "Privacy notice", subprocessors: "Sub-processors", dpa: "Data processing terms", "refund-policy": "Refund policy" };
const footerFixed = footer.replace(/<li><a href="https:\/\/housie\.corporatetambola\.com\/(terms|privacy|subprocessors|dpa|refund-policy)">/g, (m, k) => `<li><a href="/${k}.html">`).replace("<h2>Legal, on corporatetambola.com</h2>", "<h2>Legal</h2>");
const hero = snip("hero-tictactoe.html").replace('<section class="ck-hero g-ttt">', '<section class="ck-hero g-ttt" id="top">'), trust = snip("trust.html").replace("A free Tambola or Bingo demo for 10 people.", "A free Tic Tac Toe demo for 10 people."), gameday = snip("gameday.html");

const page = ({ file, title, desc, body, index = true, hero: h = "", jsonld = "" }) => {
  const url = ORIGIN + (file === "index" ? "/" : "/" + file + ".html"), img = ORIGIN + "/og-card.png";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${index ? "index, follow, max-image-preview:large" : "noindex, follow"}">
<meta name="theme-color" content="#0B5D5B">
<meta property="og:type" content="website"><meta property="og:site_name" content="Corporate Tic Tac Toe"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Corporate Tic Tac Toe"><meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${img}">${jsonld}
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${V}"><link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/Inter-normal-400.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Fraunces-normal-500-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css?v=${V}"><link rel="stylesheet" href="/tokens.css?v=${V}"><link rel="stylesheet" href="/components.css?v=${V}"><link rel="stylesheet" href="/gamesbar.css?v=3">
<script src="/theme-init.js?v=${V}"></script>
</head><body class="ck g-ttt">
${sprite}
<a class="ck-skip" href="#main">Skip to the content</a>
${header}
<main id="main" tabindex="-1">
${h}${body}
</main>
${footerFixed}
<script src="/brandkit.js?v=${V}" defer></script><script src="/gamesbar.js?v=3" defer></script><script src="/siteversion.js?v=${V}" defer></script><script src="/guide.js" defer></script><script src="/blackbox.js" defer></script><script src="/rum.js" defer></script><script src="/v.js" defer></script><script src="/pwa.js" defer></script>
</body></html>
`;
};
const sec = (kick, h2, inner, cls = "") => `<section class="ck-sec ${cls}"><div class="ck-wrap"><div class="ck-sec-head"><span class="ck-kicker">${kick}</span><h2>${h2}</h2></div>${inner}</div></section>`;
const cta = `<div class="ck-btn-row"><a class="ck-btn main" href="/zc?demo=1">Try a free game with 10 people</a><a class="ck-btn" href="/zc">Log in</a></div>`;
const card = (h, p) => `<div class="ck-card"><h3>${h}</h3><p>${p}</p></div>`;
const cards = (a) => `<div class="ck-cards">${a.map(([h, p]) => card(h, p)).join("")}</div>`;
const small = (h1, lead) => `<section class="ck-hero g-ttt" id="top"><div class="ck-wrap ck-hero-in"><div><h1>${h1}</h1><p class="ck-lead">${lead}</p>${cta}</div></div></section>`;

const FAIR = "Who plays whom is fixed before anyone joins, and the same rules run on every phone. Nobody can change the draw or the bracket. There is one exception, and it is shown on screen: when boards must be settled, a person decides.";
const out = {};

const LD = readFileSync(join(import.meta.dirname, "ld-index.json"), "utf8").trim();
const FACTS = sec("Good to know", "Plain answers", cards([
  ["Is there prize money?", "No. Players never pay and never stake money. Corporate Tic Tac Toe is software only: we never hold or pay prize money. Any gift is the organizer's own, outside the product."],
  ["Who decides the winners?", "The software only. The phones apply the same rules and our server only stores and passes on the moves. When boards must be settled, a person picks the winner of that one board, and it is shown on screen."],
  ["Is it tested for a big crowd?", "A computer rehearsal with 1,000 simulated players finished. A live event of that size has not been run yet."],
  ["What does it cost?", "You pay once per game, before it starts. Festive offer: 50% off on every pack. See the <a href=\"/pricing.html\">price list</a>, the <a href=\"/terms.html\">terms</a>, the <a href=\"/privacy.html\">privacy notice</a>, the <a href=\"/dpa.html\">data processing terms</a> and the <a href=\"/organizer-guide.html\">organizer guide</a>."],
  ["Earn by telling others", "See the <a href=\"/partner.html\">partner page</a>."]]), "ck-alt");
out.index = page({ jsonld: `<script type="application/ld+json">${LD}</script>`, file: "index", title: "Corporate Tic Tac Toe | Online games for company events", index: true,
  desc: "Corporate Tic Tac Toe: a tournament for your whole company. Colleagues play one against one on their own phone, every move has a clock, and the software names the winners.",
  hero, body: `<section class="ck-sec"><div class="ck-wrap"><img src="/img/card.png" width="1400" height="879" decoding="async" fetchpriority="high" alt="Corporate Tic Tac Toe on a phone: a 3 by 3 board with crosses and noughts"></div></section>` + trust + gameday.replace(/<\/?main>/g, "") + sec("Fair play", "Fair, and easy to check", `<p class="ck-lead">${FAIR}</p>`, "ck-alt") + FACTS });

out["how-it-works"] = page({ file: "how-it-works", title: "How it works | Corporate Tic Tac Toe",
  desc: "How a Corporate Tic Tac Toe game works: you set it up in ten short steps, share one link, colleagues play one against one on their phones, and the software names the winners.",
  hero: small("How it works", "Easy for you. Fun for your people."),
  body: sec("Five steps", "From set-up to winners", cards([
    ["1. Set up", "Log in with your e-mail. Pick the day and time, the number of players and the move clock (10, 20, 30 or 60 seconds)."],
    ["2. Share one link", "Send it by e-mail, Teams, Slack or WhatsApp. Only the people you invite can join. No app to install."],
    ["3. Players join", "Each colleague types a name and is in. Players never pay."],
    ["4. The bracket plays itself", "Colleagues play one against one, each move on a clock. Winners move up on their own. A drawn game is replayed at once with the marks swapped."],
    ["5. Winners and report", "The software names the winners. You get a report by e-mail. Player details are erased within 24 hours."]])) + sec("Fair play", "Who decides the winners?", `<p class="ck-lead">${FAIR}</p>${cta}`, "ck-alt") });

out.guide = page({ file: "guide", title: "Guide for organizers | Corporate Tic Tac Toe",
  desc: "A short guide for organizers of a Corporate Tic Tac Toe game: the ten steps, the move clock, the tournament shapes, running the game day and what you get afterwards.",
  hero: small("Guide for organizers", "Ten short steps. You can leave and come back."),
  body: sec("Before the game", "Set up", cards([
    ["Date, time and size", "Pick the day and time and how many players. A free demo game is for up to 10 people."],
    ["Move clock", "Every move has a clock of 10, 20, 30 or 60 seconds. When it runs out, the software plays a square for the player. Two clock-outs in a row lose the board."],
    ["Tournament shape", "One against one for the whole company, or team against team with teams of 3 or 5."],
    ["Share the link", "Send one link to the people you invite. Players need only a phone and a name."]])) +
    sec("On the day", "Run the game", cards([
    ["Start", "You press Start when everyone is in. A late payment opens the game."],
    ["Pause", "You can pause. While the game is paused the clocks wait."],
    ["Big screen", "Show the bracket on a projector or a shared video call."],
    ["If someone drops", "They open the link again and see the board as it is."]]), "ck-alt") +
    sec("Afterwards", "Winners and report", `<p class="ck-lead">The software names the winners and the order has no ties. You get a report by e-mail a few minutes after the game ends. Player details are erased within 24 hours.</p>${cta}`) });

out.brochure = page({ file: "brochure", title: "Brochure | Corporate Tic Tac Toe",
  desc: "The Corporate Tic Tac Toe brochure: a tournament for your whole company, played one against one on each person's phone, with a clock on every move and winners named by the software.",
  hero: small("Brochure", "One page you can send to your manager."),
  body: sec("In short", "Corporate Tic Tac Toe", cards([
    ["For whom", "HR teams and managers who want one fun event for the whole company, in the room or remote."],
    ["What colleagues do", "Play one against one on their own phone. Every move has a clock."],
    ["What you do", "Set up in ten short steps, share one link, press Start."],
    ["What you can count on", "Players never pay. Only invited people join. No app. Player details erased within 24 hours."]]) + cta) });

out.refer = page({ file: "refer", title: "Refer and earn | Corporate Tic Tac Toe",
  desc: "Refer and earn with Corporate Tic Tac Toe: tell another company about close group online games for company events and see how the partner programme works.",
  hero: small("Refer &amp; earn", "Know a company that would enjoy this? Tell them."),
  body: sec("Partners", "How it works", `<p class="ck-lead">Share your partner link with a company. When they run a paid game, you earn a share. The full terms are on the <a href="/partner-terms.html">partner terms</a> page, and you can join on the <a href="/partner.html">partner page</a>.</p>`) });

out["thank-you"] = page({ file: "thank-you", index: false, title: "Thank you | Corporate Tic Tac Toe",
  desc: "Thank you for playing Corporate Tic Tac Toe. Share it with a colleague or tell your team about it on WhatsApp.",
  hero: small("Thank you for playing", "We hope your team had fun."),
  body: sec("Share", "Tell a colleague", `<div class="ck-btn-row"><a class="ck-btn main" href="https://wa.me/?text=Corporate%20Tic%20Tac%20Toe%3A%20a%20tournament%20for%20the%20whole%20company%20https%3A%2F%2Ftictactoe.corporatetambola.com%2F" rel="noopener">Share on WhatsApp</a><a class="ck-btn" href="mailto:?subject=Corporate%20Tic%20Tac%20Toe&amp;body=https%3A%2F%2Ftictactoe.corporatetambola.com%2F">Share by e-mail</a></div>`) });

out["game-completed"] = page({ file: "game-completed", index: false, title: "Game completed | Corporate Tic Tac Toe",
  desc: "This Corporate Tic Tac Toe game is completed. The winners are named and the organizer gets a report. Share the game with a colleague.",
  hero: small("Game completed", "The winners are named. The organizer gets a report by e-mail."),
  body: sec("Share", "Enjoyed it?", `<div class="ck-btn-row"><a class="ck-btn main" href="https://wa.me/?text=Corporate%20Tic%20Tac%20Toe%3A%20a%20tournament%20for%20the%20whole%20company%20https%3A%2F%2Ftictactoe.corporatetambola.com%2F" rel="noopener">Share on WhatsApp</a><a class="ck-btn" href="/thank-you">Thank you page</a></div>`) });

for (const [f, h] of Object.entries(out)) writeFileSync(join(PUB, f + ".html"), h);
console.log("wrote", Object.keys(out).join(", "));
