// ONE legal document for the home page and every game (owner order, 1 Nov 2026), published once at one address:
//   1 Terms and Conditions, 2 Payments and Credit, 3 Privacy and Data, 4 Data retention, 5 Cookies and navigation data, 6 Companies that help run the service (and data processing terms), 7 Grievance and contact, 8 Acceptable use and Legal Disclaimer, 9 Game Rules (common first, then one subsection per game).
// Third person only (never we, our, us), never "erase", payments only through IT Services by Rajat Agarwal and Razorpay. Sites link to DOC_URLS and render with renderDocument() (packages/ui); they keep no copy.
// Content rules (owner, 1 Nov 2026): each rule is stated once, short soft sentences, true to the code. Only the Acts and judgments already quoted in Corporate Tambola's legal text are cited.
import { AUTO_DELETE_LINE, DETAILS_LINE, ID_ONLY_LINE } from "./lines";
import { NAVIGATION_LINE, REPORT_LINE } from "./legal";

export type DocSectionId = "terms" | "payments" | "privacy" | "retention" | "cookies" | "processors" | "grievance" | "acceptable-use" | "game-rules";
export type DocGameId = "tambola" | "bingo" | "tictactoe" | "snakes" | "luck" | "luckydraw";
export const DOC_SECTION_IDS: DocSectionId[] = ["terms", "payments", "privacy", "retention", "cookies", "processors", "grievance", "acceptable-use", "game-rules"];
export const DOC_GAMES: { id: DocGameId; name: string }[] = [
  { id: "tambola", name: "Tambola" }, { id: "bingo", name: "Bingo" }, { id: "tictactoe", name: "Tic Tac Toe" },
  { id: "snakes", name: "Snakes and Ladders" }, { id: "luck", name: "Luck by Chance" }, { id: "luckydraw", name: "Lucky Draw" },
];
/** Section titles. The notice line and the small links use only terms, privacy and game-rules. */
export const DOC_TITLES: Record<DocSectionId, string> = {
  terms: "Terms and Conditions", payments: "Payments and Credit", privacy: "Privacy and Data", retention: "Data retention", cookies: "Cookies and navigation data",
  processors: "Companies that help run the service", grievance: "Grievance and contact", "acceptable-use": "Acceptable use and Legal Disclaimer", "game-rules": "Game rules",
};
export const DOC_HOST = "https://home.corporatetambola.com";
/** The ONE address of the document, and the three section anchors that the small links open. Every game, e-mail, PDF and the console link to these. */
export const DOC_URL = `${DOC_HOST}/terms`;
export const DOC_URLS = Object.fromEntries(DOC_SECTION_IDS.map((k) => [k, `${DOC_URL}#${k}`])) as Record<DocSectionId, string>;
/** Old separate pages, each answered with a 301 to its anchor in the one document (nothing is deleted without a redirect). Paths are on each site's own host and on home. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/legal": "terms", "/legal-position": "acceptable-use", "/disclaimer": "acceptable-use", "/privacy": "privacy", "/privacy-policy": "privacy",
  "/refund-policy": "payments", "/refund": "payments", "/policy": "payments", "/cookies": "cookies", "/retention": "retention",
  "/dpa": "processors", "/data-processing": "processors", "/sub-processors": "processors", "/trust": "terms", "/partner-terms": "terms",
};
export const legacyTarget = (path: string): string | null => { const k = LEGACY_REDIRECTS[path.toLowerCase().replace(/\/+$/, "")]; return k ? `${DOC_URL}#${k}` : null; };
/** ONE version and date of the whole document. A change of any text changes both. */
export const TERMS_VERSION = "2026-11-01";
export const TERMS_DATE = "1 November 2026";
export const SELLER = "IT Services by Rajat Agarwal";
export const CONTACT_EMAIL = "hello@corporatetambola.com";
/** The owner's own wording on what is and is not kept (the only data sentence that names a mobile number; exempt from the data-text guard). */
export const NOTHING_KEPT_LINES = ["No mobile number or e-mail address is taken or kept for taking part.", "All information about participants is deleted within 24 hours after the game.", "Only the winners' results, the game logs, the Organizer and Host details and the tax invoices are kept, for the periods in the table below."];

export interface DocSub { id: string; heading: string; paragraphs: string[]; table?: string[][] }
export interface DocSection { id: DocSectionId; title: string; subs: DocSub[] }
const sub = (id: string, heading: string, ...paragraphs: string[]): DocSub => ({ id, heading, paragraphs });
const SUBPROC = "Cloudflare hosts the website and keeps the database in its Asia-Pacific region. Resend sends e-mail to Organizers and Hosts. Razorpay takes the Organizer's payment, and the IT Services payment service records each payment for the invoice. Google is used only if an Organizer chooses to sign in with Google. A public source of random values is used for draws, and YouTube in privacy mode only if an Organizer adds a video.";

export const DOCUMENT: DocSection[] = [
  { id: "terms", title: DOC_TITLES.terms, subs: [
    sub("what", "What the service is",
      `Corporate Tambola and its sister games are software provided as a service by ${SELLER}, the trade name of Rajat Agarwal, a sole proprietorship in India (called IT Services here).`,
      "Each game is a separate, one-time service for a single game run. Nothing is sold for keeps: there is no perpetual licence, no transfer of ownership of the software and no subscription. Each new game is arranged and paid for on its own.",
      "The Organizer uses the software to run a game for the people the Organizer invites. IT Services is the software provider only. It does not organize, conduct or take part in any game, and it is not a party to any arrangement between an Organizer and a participant."),
    sub("who-plays", "Who plays",
      "The Organizer chooses and invites the people who play: people listed by employee ID. The Organizer is responsible for that choice and for the prizes."),
    sub("free-play", "Players pay nothing",
      "Participants pay nothing to play. The only charge is the Organizer's fee for the game, shown before payment. It is the price of the software service, and it is not a stake, an entry fee or the price of a chance.",
      "IT Services does not collect, hold or give any money or prize. Any prize is provided, funded and handed over by the Organizer."),
    sub("agree", "How these terms are agreed",
      "Continuing to use the service means agreeing to the Terms and Conditions, Privacy and Data, and the Game rules. Publishing a game is the Organizer's clear act of going ahead.",
      "The agreement is electronic and is valid as such under section 10A of the Information Technology Act, 2000. At sign-in and when a game is published, the version of this document, a fingerprint of the notice shown and the time are stored, and nothing else personal.",
      "These terms may change. The latest version is always on this page, with its version and date at the top. A change applies to games created after it is published."),
    sub("law", "Law and disputes",
      "Indian law applies. A dispute is first raised with the Grievance Officer (section 7). If it is not settled within 30 days, it goes to a sole arbitrator in India, in English, under the Arbitration and Conciliation Act, 1996. The courts in India have exclusive jurisdiction.",
      "This whole document is read together. If one part is found not to apply, the rest stays in force. The Organizer cannot pass on rights under these terms without written consent."),
  ] },
  { id: "payments", title: DOC_TITLES.payments, subs: [
    sub("what", "What is paid for",
      "One payment is for one game, for the group size chosen, at the price shown on the payment page. No commitment and no repeat charges.",
      "Building and publishing a game is free. A game that is not paid for simply does not begin, and nothing is charged."),
    sub("who", "Who is paid",
      `Payments go only to ${SELLER}, through Razorpay. Card, UPI and bank details stay with Razorpay. An invoice is issued for each payment.`),
    sub("credit", "Credit instead of a refund",
      "Once the payment is made, it stays with the game as credit for 365 days rather than being refunded. A paid game can be moved to any date within 365 days of payment, free of charge.",
      "A paid game can be cancelled until its start time. It then stays with the Organizer as credit for a new game of the same kind within the same 365 days from the date of payment. Unused credit lapses at the end of day 365, and an e-mail is sent before it lapses.",
      "Once the start time has passed, the game has started and keeps its time. A game that is stopped because it is not allowed (section 8) keeps no credit."),
    sub("wrong", "A failed, wrong or double payment",
      "If a payment fails or is cancelled, nothing is charged, the game stays unpaid and can be paid for again later. If money is taken but the game is not created, or a payment is taken twice or at a wrong amount, the extra or the whole amount is refunded in full.",
      `Write to ${CONTACT_EMAIL} with the subject Billing, the payment reference, the amount and the date. An approved refund is started within 7 working days to the original payment method.`,
      "If a paid game cannot run because of a fault in the software, it is moved free of charge. If it cannot be provided at all within the 365 days, the amount paid is refunded. A test payment is only for trying the payment and its invoice; it is not returned."),
  ] },
  { id: "privacy", title: DOC_TITLES.privacy, subs: [
    sub("short", "In short", ID_ONLY_LINE, DETAILS_LINE),
    sub("kept", "What is kept", ...NOTHING_KEPT_LINES),
    sub("use", "How a game uses data",
      "The Organizer sets up the game and decides who is invited, and participants join with an employee ID only.",
      "Participant data is used for that game only and is never shown to other participants.",
      "The Organizer decides why participant data is used. IT Services handles it only for the Organizer, as the Organizer's data processor under the Digital Personal Data Protection Act, 2023 (sections 2 and 8), as set out in section 6."),
    sub("after", "After the game",
      REPORT_LINE,
      "The report has the statistics, the game log, how the game was played and the winners in full. It has no row for any individual participant.",
      "The Organizer and the Hosts receive it. Co-hosts do not.",
      "If the e-mail bounces, the report is held in encrypted form and sent again after 24, 36 and 72 hours, and is deleted on delivery or after the last try.",
      "The Organizer can delete all participant data at any time from the console, once the game is over or if it was never published."),
    sub("rights", "Participant rights",
      "A participant can leave a game at any time, ask what data is held, ask for a correction or deletion (section 12 of the Act), or ask another person to use these rights for them (section 14).",
      `Write to ${CONTACT_EMAIL} with the subject Grievance, or use the game page. A request is answered within 7 days. A complaint can also go to the Data Protection Board of India.`),
    sub("laws", "Laws followed",
      "The service is designed to follow India's Digital Personal Data Protection Act, 2023 and its Rules, 2025, the EU General Data Protection Regulation and the California Consumer Privacy Act of the United States.",
      "Only the data a game needs is asked for, and it is kept for the shortest time that is practical, in line with Justice K.S. Puttaswamy (Retd.) v. Union of India, (2017) 10 SCC 1."),
  ] },
  { id: "retention", title: DOC_TITLES.retention, subs: [
    { id: "table", heading: "What is kept, and for how long", paragraphs: [
      "Each item is auto-deleted by timer as shown. Deleted means a person deletes it.",
    ], table: [
      ["What", "How long", "Then"],
      ["Participant data, codes, invitation records and requests", "Within 24 hours after the game ends", "Auto-deleted"],
      ["A game that never starts: its participant data", "Within 24 hours after it was meant to end", "Auto-deleted"],
      ["Participant data, when the Organizer deletes it", "At once", "Deleted"],
      ["The winners' record: who won which prize place", "365 days", "Auto-deleted"],
      ["Details a winner confirms to receive a prize (Tambola, Bingo, Snakes and Ladders)", "365 days", "Auto-deleted"],
      ["Game settings, prizes, time and the result summary, without personal details; Tic Tac Toe and Luck by Chance results in numeric form only", "365 days after the game", "Auto-deleted"],
      ["Audit log of the game, without personal details", "365 days", "Auto-deleted"],
      ["Speed and error reports", "90 days", "Auto-deleted"],
      ["Mail log", "3 days", "Auto-deleted"],
      ["A game report held after a bounce", "Until delivered, or after the last try at 72 hours", "Deleted"],
      ["Organizer account details", "Until the Organizer closes the account", "Deleted"],
      ["Billing records", "Kept", "For audit and tax"],
    ] },
  ] },
  { id: "cookies", title: DOC_TITLES.cookies, subs: [
    sub("storage", "Cookies and storage",
      "The games use only first-party storage on the device, for settings such as the look and the language. No advertising cookies and no third-party trackers are used."),
    sub("navigation", "Navigation data",
      NAVIGATION_LINE,
      "A Global Privacy Control signal from the browser is respected: no navigation data is collected."),
  ] },
  { id: "processors", title: DOC_TITLES.processors, subs: [
    sub("companies", "Companies that help run the service", SUBPROC),
    sub("terms", "Data processing terms",
      "For participant data, the Organizer decides the purpose and the means, and IT Services processes the data only on the Organizer's instructions, under these terms as the contract that section 8 of the Digital Personal Data Protection Act, 2023 asks for. For the Organizer's own account, sign-in and billing data, IT Services decides how it is used.",
      "The companies that help work under contracts that keep the data confidential and secure. All data is encrypted in transit and at rest.",
      "Participant data is deleted as set out in section 4. Any incident that touches participant data is told to the Organizer without delay."),
  ] },
  { id: "grievance", title: DOC_TITLES.grievance, subs: [
    sub("officer", "Seller and Grievance Officer",
      `Seller: ${SELLER}, India.`,
      "Grievance Officer: Rajat Agarwal. E-mail " + CONTACT_EMAIL + " with the subject Grievance. Phone +91 96503 97480. Each message gets a reply within 7 days.",
      "The seller, the Grievance Officer and the payment policy are shown here as the Consumer Protection Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020 ask."),
  ] },
  { id: "acceptable-use", title: DOC_TITLES["acceptable-use"], subs: [
    sub("use", "Acceptable use",
      "The Organizer follows the law that applies to the game, charges no participant anything, links no game to betting, pooling of money or side bets, shares game links only with the people invited, and does not interfere with the fairness, randomness or sealed data of the software."),
    sub("stop", "Stopping a game",
      "A game or an account may be stopped, and a link disabled, when the service is misused, when the law, a court or an authority requires it, or on a court order, government notification or credible notice of unlawful use. This follows section 79 of the Information Technology Act, 2000 as read in Shreya Singhal v. Union of India, (2015) 5 SCC 1. Participants can report misuse to the Grievance Officer."),
    sub("provider", "Software provider only",
      "The software is provided as is, for entertainment. The Organizer runs the game, and the software follows the rules of the game. IT Services does not decide who plays."),
    sub("prizes", "Prizes and tax",
      "Prizes, if any, are the Organizer's own. The Organizer is responsible for their cost, delivery and any dispute about them with a participant. Gifts that are not cash are recommended.",
      "The Organizer, as the payer of a prize, deducts tax where the law asks, under section 393(3), Table Sl. No. 1 of the Income-tax Act, 2025 (formerly section 194B of the Income-tax Act, 1961), and pays the tax on a prize in kind before it is released. IT Services is not the payer, deductor or collector for any prize."),
    sub("availability", "Availability",
      "The service runs on the internet and on the participants' own devices. It is offered without a promise of uninterrupted use. IT Services is not responsible for interruptions of the internet, of a device or of a company that helps run the service, or for events beyond its control. If a fault in the software stops a paid game, section 2 applies."),
    sub("liability", "Limit of liability and Organizer's responsibility",
      "To the extent the law permits, the total liability of Rajat Agarwal and IT Services by Rajat Agarwal to an Organizer for any claim about a game is limited to the fee paid for that game. Nothing limits a liability that the law does not allow to be limited.",
      "The Organizer keeps IT Services and Rajat Agarwal free from any claim, loss or cost that arises from the Organizer's content, invitation lists, prizes, tax or use that is not allowed, to the extent permitted by the Indian Contract Act, 1872."),
    sub("ip", "Ownership",
      "The software (a computer programme under section 2(ffc) of the Copyright Act, 1957), the game rules, designs, text and names, and all rights in them, belong to Rajat Agarwal, trading as IT Services by Rajat Agarwal. The Organizer gets only the right to use the software for a paid game, as a service.",
      "Nobody may copy, change, resell or reverse-engineer the software, use automated access, or feed the pages, code, text, rules or designs to an AI system or another tool to copy or derive a similar product."),
  ] },
  { id: "game-rules", title: DOC_TITLES["game-rules"], subs: [
    sub("common", "Rules common to all games",
      "Each participant has one seat or entry in a game. An ID that already has a seat is not given a second one, and a full game does not take more people.",
      "A game starts by itself at its published time, or when the Organizer or a Host presses Start, as the Organizer chose. The Organizer or a Host can pause and resume the game. While a game is paused nothing counts down, and play continues from the same point. Co-hosts help but do not start or pause the game.",
      "The game software decides every win from the rules of the game. Neither the Organizer nor IT Services can add, remove or change a winner in the software. The result is final, apart from the correction of a demonstrable technical error."),
    sub("tambola", "Tambola", "Tambola is played with tickets. A participant presses Claim when a pattern is complete, and the software checks the claim against the numbers called. A correct claim wins the prize, and the first correct claim for a prize is the winner. A wrong claim does not stop the game."),
    sub("bingo", "Bingo", "Bingo is played with cards. Winners are worked out by the software from the public list of numbers called and the seats of the game, so no claim is needed. Where two cards complete a pattern on the same call, the software breaks the tie by a fixed public rule that nobody can change."),
    sub("tictactoe", "Tic Tac Toe", "Tic Tac Toe is played in rounds and stages after a waiting room of 2 minutes. The software pairs participants, and the result of each pair decides who goes on. A tie is played once more; after that the rules of the game decide. Prize places go to the last participants standing."),
    sub("snakes", "Snakes and Ladders", "Snakes and Ladders is played in rounds after a waiting room of 2 minutes, with the dice rolled by the software. A participant who is not playing in time is out of the next round. Prize places go to the last participants standing."),
    sub("luck", "Luck by Chance", "Luck by Chance is played in rounds after a waiting room of 2 minutes, decided by the software's throws. A tie is thrown again. Prize places go to the last participants standing."),
    sub("luckydraw", "Lucky Draw", "Lucky Draw has one entry per participant. Entry closes at the draw time. The winners are drawn by the software from the entries using a public value, so anyone with the entries and the value gets the same winners. Winners are shown to all, with the words You won."),
  ] },
];

/** Every paragraph of the document (and every table row, joined), with where it is. */
export const allDocParagraphs = (): { section: DocSectionId; sub: string; text: string }[] =>
  DOCUMENT.flatMap((s) => s.subs.flatMap((u) => [...u.paragraphs, ...(u.table ?? []).slice(1).map((r) => r.join(", "))].map((text) => ({ section: s.id, sub: u.id, text }))));
const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const FINGERPRINTS = allDocParagraphs().filter((p) => p.text.length >= 40).map((p) => ({ section: p.section, text: norm(p.text) }));
/** Drift check: the sections of the document that `text` carries a copy of. A site links to DOC_URLS or renders renderDocument(), and keeps no copy. */
export const findDocumentCopies = (text: string): DocSectionId[] => {
  const n = norm(text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'"));
  return [...new Set(FINGERPRINTS.filter((f) => n.includes(f.text)).map((f) => f.section))];
};
