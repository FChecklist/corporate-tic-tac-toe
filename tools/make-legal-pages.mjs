// Builds the short document pages (Terms, Data processing terms, Sub-processors, Partner terms, Organizer guide) in the same style as legal.html.
// Run: node tools/make-legal-pages.mjs   (writes apps/web/public/*.html; commit the result). The pages are plain static files: no new user flow.
// The wording is a (see docs/compliance/DRAFTS_README.md); the public text carries no "draft" mark by product decision.
import { readFileSync, writeFileSync } from "node:fs";

export const TERMS_VERSION = "2026-10-09";
const PUB = new URL("../apps/web/public/", import.meta.url);
const tpl = readFileSync(new URL("legal.html", PUB), "utf8");
const nl = tpl.includes("\r\n") ? "\r\n" : "\n";
const head = tpl.slice(0, tpl.indexOf('<main class="legal">'));
const foot = tpl.slice(tpl.indexOf("</main>"));
// Search-engine and sharing tags, one set per page (unique description, canonical, Open Graph, Twitter card). Written idempotently: old copies are removed first, so the template's own tags never leak into the other pages.
const SITE = "https://corporate-tic-tac-toe.pages.dev";
const META = {
  "legal.html": ["Rules, privacy and disclaimer", "The rules of a Corporate Tic Tac Toe game, how guest names are erased within 24 hours, and the disclaimer. Plain English."],
  "terms.html": ["Terms", "The short, plain-English terms for organizers who run a Corporate Tic Tac Toe game for their company or team."],
  "dpa.html": ["Data processing terms", "Data processing terms for organizers: what we do with your players' details, on one page."],
  "subprocessors.html": ["Sub-processors", "The providers that help us run Corporate Tic Tac Toe, and what each one receives."],
  "partner-terms.html": ["Partner terms", "The terms for Corporate Tic Tac Toe's Refer and earn partners, in plain English."],
  "organizer-guide.html": ["Organizer guide", "Short notes for a safe, simple Corporate Tic Tac Toe: how to set up, share, run and close a game."],
};
const attr = (v) => v.replace(/&(?!amp;|rsquo;|ldquo;|rdquo;)/g, "&amp;").replace(/"/g, "&quot;");
export function withSeo(html, file) {
  const [t, d] = META[file], title = `${t} | Corporate Tic Tac Toe`, url = `${SITE}/${file}`;
  const strip = html.replace(/[ \t]*<meta name="description"[^>]*>\r?\n?/g, "").replace(/[ \t]*<link rel="canonical"[^>]*>\r?\n?/g, "").replace(/[ \t]*<meta property="og:[^>]*>\r?\n?/g, "").replace(/[ \t]*<meta name="twitter:[^>]*>\r?\n?/g, "");
  const tags = [`<meta name="description" content="${attr(d)}">`, `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="Corporate Tic Tac Toe"><meta property="og:title" content="${attr(title)}"><meta property="og:description" content="${attr(d)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/img/card.webp"><meta property="og:image:alt" content="A Corporate Tic Tac Toe card on a phone: a 5 by 5 grid under the letters B I N G O with a FREE center square"><meta property="og:locale" content="en_US">`,
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${attr(title)}"><meta name="twitter:description" content="${attr(d)}"><meta name="twitter:image" content="${SITE}/img/card.webp">`].join(nl);
  return strip.replace(/(<title>[^<]*<\/title>)\r?\n?/, (m, a) => a + nl + tags + nl);
}
const FOOTNAV = '<nav class="fl" aria-label="Legal"><a href="/legal.html#rules">Rules</a><a href="/legal.html#privacy">Privacy</a><a href="/legal.html#disclaimer">Disclaimer</a><a href="/about.html">About</a><a href="/pricing.html">Pricing</a><a href="/contact.html">Contact</a><a href="/terms.html">Terms</a><a href="/refund-policy.html">Refund policy</a><a href="/dpa.html">Data processing</a><a href="/subprocessors.html">Sub-processors</a><a href="/organizer-guide.html">Organizer guide</a><a href="/partner-terms.html">Partner terms</a><a href="/partner.html">Refer &amp; earn</a><a href="/demo.html">Demo</a><a href="/brochure.pdf">Brochure</a><a href="/">Home</a></nav>';
const newFoot = foot.replace(/<nav class="fl"[\s\S]*?<\/nav>/, FOOTNAV);
export const footNav = FOOTNAV;
const e = (s) => s.replace(/&(?!rsquo;|amp;)/g, "&amp;");

const PAGES = {
  "terms.html": { title: "Terms", h1: "Terms", lead: `Short and plain. Version ${TERMS_VERSION}.`, sections: [
    ["organizer", "For organizers", [
      "You run the game. We provide the software only.",
      "You must be 18 or older, or act for a company.",
      "You must not charge any fee, price, donation or purchase for taking part. Not directly, not indirectly.",
      "Taking part must be voluntary. Tell your people what you do with their details.",
      "You provide the prizes and hand them over. Corporate Tic Tac Toe is software only: we never hold or pay prize money.",
      "You make sure the game is allowed under the law where you and your players are.",
      "You are responsible for tax on prizes you give.",
      "Do not enter a child as a player. See Players.",
      "If you break these terms, we may stop your game.",
    ]],
    ["payment", "Payment and credit", [
      "Building and publishing are free. A game does not begin until it is paid for.",
      "You can pay at any time until the guest data is erased. A late payment starts the game 2 minutes after it is confirmed.",
      "We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365.",
      "The credit belongs to your organizer account. We show the exact amount and date before you confirm.",
      "We e-mail you before it lapses. No credit note is raised for credit that lapses.",
      "Instead of cancelling, you can change the date of the game. A game time can be set at most 30 days ahead.",
      "Once the start time has passed, a paid game cannot be cancelled. You can still end the game.",
      "A game that was never paid for can be cancelled at any time. Nothing is charged.",
      "A game that was not paid for closes when its guest data is erased, 23 hours after it was meant to end.",
      "You can then create a new game like it. The settings stay for 30 days.",
      "Unused places are not credited once the game has started.",
    ]],
    ["players", "For players", [
      "Players are 18 or older.",
      "A child may only watch, on a parent&rsquo;s or guardian&rsquo;s own card and phone, with that adult&rsquo;s permission.",
      "Playing is free and voluntary. One card per phone.",
      "The software decides every winner. Results are final.",
    ]],
    ["service", "The service", [
      "The software is provided as it is. We do not promise it will never fail.",
      "We are not responsible for prize handover, or for disputes between an organizer and players.",
      "Our liability is limited to the fee you paid for the engagement in question.",
    ]],
    ["signin", "Signing in", [
      "You sign in with a 6-digit code sent to your e-mail, or with &ldquo;Continue with Google&rdquo; if you choose. We use Google only to confirm your e-mail address.",
      "A Host&rsquo;s personal link works once, for 7 days. After the Host confirms an e-mail and adds a mobile number, the Host signs in with an e-mail code or Google.",
    ]],
    ["data", "Data", [
      "Your use of Corporate Tic Tac Toe is also covered by the <a href=\"/legal.html#privacy\">Privacy &amp; Data Policy</a>.",
      "For the details you enter about your players, you are in charge and we are your processor. See the <a href=\"/dpa.html\">Data processing terms</a>.",
    ]],
    ["changes", "Changes and contact", [
      "We may update these terms. The version date is at the top.",
      "Questions: <a href=\"mailto:rajatsiroffice@gmail.com\">rajatsiroffice@gmail.com</a>.",
    ]],
  ] },
  "dpa.html": { title: "Data processing terms", h1: "Data processing terms", lead: "For organizers. One page.", sections: [
    ["roles", "Roles", ["You are in charge of the players&rsquo; details (the controller, or business, or data fiduciary in India). We process them for you (the processor).", "We act only on your instructions: run your game and send you the report."]],
    ["data", "What we process", ["Names of players, mobile numbers only if you choose to ask for them, and, if you switch invitations on, who invited whom and what kind of guest.", "Winners&rsquo; prize hand-over details, which winners confirm on their own phone."]],
    ["security", "Security", ["Names and numbers are sealed (AES-256) in our database and are also encrypted in transit and at rest.", "Players never see each other&rsquo;s data.", "Access to your game is limited to you, your co-hosts and your AI assistant, as you choose."]],
    ["delete", "Deletion", ["All player data is deleted within 24 hours after the game ends. Backups clear within 7 days.", "A game that did not start (nobody paid) is treated the same way: its player data is deleted 23 hours after it was meant to end.", "Its people lists, waiting requests and personal links go too. Its settings stay for 30 days so you can reuse them.", "Winners&rsquo; prize details and the winners record stay 365 days, then are deleted automatically.", "At the end of day 365 everything else about the game is deleted.", "Only these stay, as tax and accounting need them: payment and invoice records, the organizer&rsquo;s details on the invoice (name, e-mail, mobile), and who paid.","You can delete a game&rsquo;s player data any time from your console."]],
    ["help", "Helping you", ["We help you answer a player&rsquo;s request to see or delete their data. Use your console, or write to us.", "If we learn of a breach that affects your game, we tell you without undue delay."]],
    ["subs", "Sub-processors", ["We use the <a href=\"/subprocessors.html\">sub-processors</a> on our list. Changes are shown there.", "Data may be processed in other countries by these providers, under their own safeguards."]],
    ["end", "When it ends", ["When your account or the game ends, the deletion rules above apply.", "On request we give you the information that shows we follow these terms."]],
  ] },
  "subprocessors.html": { title: "Sub-processors", h1: "Sub-processors", lead: "The providers that help us run Corporate Tic Tac Toe.", table: [
    ["Cloudflare", "Hosting, database, network", "Global network. Locations as published by Cloudflare."],
    ["Resend", "Sending e-mail to organizers", "United States, as published by Resend."],
    ["Google", "Optional &ldquo;Continue with Google&rdquo; sign-in for organizers and Hosts (only if you press the button)", "United States, as published by Google."],
    ["Razorpay", "Organizer payments (never players)", "India, as published by Razorpay."],
  ], sections: [
    ["notes", "Also used", [
      "drand: public random numbers. Your phone contacts it; we send it no personal data.",
      "YouTube (privacy mode): only if an organizer adds a video break. The player&rsquo;s phone contacts YouTube.",
      "Google Sign-In: only if an organizer or Host presses Continue with Google. Google confirms the e-mail; we keep that address and nothing else. Players never meet Google.",
    ]],
    ["change", "Changes", ["We update this page when the list changes."]],
  ] },
  "partner-terms.html": { title: "Partner terms", h1: "Partner terms", lead: "For Refer &amp; earn partners.", sections: [
    ["role", "Your role", [
      "You are an independent partner. You are not our employee or agent.",
      "You may share your link. You may not make false promises about Corporate Tic Tac Toe.",
      "No spam. Message only people who expect to hear from you.",
    ]],
    ["pay", "Commission", [
      "You earn up to half of the software price on every game a company buys through your link, including repeat purchases within 12 months.",
      "Commission rates can change from time to time under our management policy. A change applies to purchases made after it and is shown on your partner page.",
      "No payment from the buyer, no commission.",
      "A sale stays as earned if the buyer cancels the game. We do not give refunds: the payment becomes credit.",
      "Using credit is not a new sale and earns no new commission.",
      "We may refuse or reverse commission for self-referral or misuse.",
    ]],
    ["tax", "Tax", [
      "Tax may be deducted at source from your commission, where the law requires it (for example TDS in India).",
      "You are responsible for your own taxes.",
      "We keep the details we need for payment and tax records.",
    ]],
    ["data", "Your details", ["We use your mobile number to run your partner account. See the <a href=\"/legal.html#privacy\">Privacy &amp; Data Policy</a>.", "You may stop at any time."]],
  ] },
  "organizer-guide.html": { title: "Organizer guide", h1: "Organizer guide", lead: "Short notes for a safe, simple game.", sections: [
    ["rules", "Keep it a private game", [
      "Invite people you know: colleagues, families, customers, partners.",
      "Never ask for a fee, a purchase or a donation to take part.",
      "Taking part must be voluntary.",
      "Players are 18 or older.",
    ]],
    ["law", "Check the law", [
      "Some countries and states restrict games with prizes. You must check yours.",
      "In the United States, prize promotions above a certain value may need registration. Check your state.",
      "In India, prizes above INR 10,000 may carry tax deducted at source. Check with your tax adviser.",
      "You are responsible for tax on the prizes you give.",
    ]],
    ["run", "Running the game", [
      "Share one link in Slack, Teams, Zoom chat, e-mail or WhatsApp.",
      "Pick the gap between calls: 6, 9, 12 or 15 seconds.",
      "Show the big-screen page on a projector or in a shared video call.",
    ]],
    ["prizes", "Prizes", [
      "You provide the prizes and hand them over.",
      "Corporate Tic Tac Toe is software only. We never hold or pay prize money.",
      "Winners confirm their details on their own phone. Tick &ldquo;Prize given&rdquo; in your console.",
    ]],
    ["data", "Your players&rsquo; data", [
      "Tell your players what you do with their details.",
      "Names and numbers are deleted within 24 hours after the game. Your report link works for 22 hours, so open it before then.",
      "To delete earlier, use your console.",
    ]],
    ["pay", "Payment", ["Build and publish for free. The game does not begin until it is paid for.", "You can pay at any time until the guest data is erased. A late payment starts the game 2 minutes after it is confirmed.", "To cancel, tap Cancel this game in your console.", "We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365.", "Once the start time has passed, a paid game cannot be cancelled.", "Want another game like this one? Tap Create a new game like this one. Your credit is offered first on the Pay step."]],
  ] },
};

for (const [file, p] of Object.entries(PAGES)) {
  const toc = p.sections.map(([id, t]) => `<a href="#${id}">${t}</a>`).join("");
  const table = p.table ? `  <section id="list" aria-labelledby="lh"><h2 id="lh">Providers</h2>${nl}    <ul>${nl}${p.table.map(([n, w, l]) => `      <li><b>${n}</b>: ${w}. ${l}</li>`).join(nl)}${nl}    </ul></section>${nl}${nl}` : "";
  const secs = p.sections.map(([id, t, items]) => `  <section id="${id}" aria-labelledby="${id}h"><h2 id="${id}h">${t}</h2>${nl}    <ul>${nl}${items.map((i) => `      <li>${i}</li>`).join(nl)}${nl}    </ul></section>`).join(nl + nl);
  const html = head.replace(/<title>[^<]*<\/title>/, `<title>${p.title} | Corporate Tic Tac Toe</title>`) +
    `<main class="legal">${nl}  <div class="eyebrow">Plain English</div>${nl}  <h1>${p.title}</h1>${nl}  <p class="muted">${p.lead}</p>${nl}${p.table ? "" : `  <div class="toc">${toc}</div>${nl}`}${nl}${table}${secs}${nl}` + newFoot;
  writeFileSync(new URL(file, PUB), withSeo(html, file));
}
// the footer navigation of legal.html and the home page links to every document
for (const f of ["legal.html", "index.html"]) {
  const u = new URL(f, PUB); let s = readFileSync(u, "utf8");
  const next = s.replace(/<nav class="fl" aria-label="Legal">[\s\S]*?<\/nav>/, f === "index.html" ? FOOTNAV : FOOTNAV);
  if (next === s && !s.includes('href="/terms.html"')) throw new Error("footer nav not found in " + f);
  writeFileSync(u, f === "legal.html" ? withSeo(next, f) : next);
}
console.log("legal pages written, terms version", TERMS_VERSION);
