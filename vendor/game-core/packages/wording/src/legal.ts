// Privacy, Terms, storage notice and grievance text: ONE common text for the home page and every game (owner, 31 Oct 2026). Only the rules of a game differ between games.
// Change it here once; sites render it with the shared renderer (packages/ui/src/legal.ts) and never keep a copy (tools/drift.ts checks that).
// Third person, calm and short. Drafted for the owner's approval: the owner (and a lawyer) decides the final words.
import { AUTO_DELETE_LINE, DETAILS_LINE, ID_ONLY_LINE, TERMS_RETENTION } from "./lines";
export const NAVIGATION_LINE = "Navigation data is collected to improve the games.";
export const REPORT_LINE = "The game report is e-mailed to the Organizer and the Hosts within 3 hours after the game and is not stored.";
/** To be confirmed by the owner before the text goes live. */
export const GRIEVANCE_EMAIL = "grievance@corporatetambola.com";
export type LegalKind = "privacy" | "terms" | "cookies" | "grievance";
export interface LegalSection { id: LegalKind; title: string; paragraphs: string[] }
export const LEGAL: LegalSection[] = [
  { id: "privacy", title: "Privacy", paragraphs: [
    ID_ONLY_LINE, DETAILS_LINE, TERMS_RETENTION, AUTO_DELETE_LINE,
    "The winners' record is kept for 365 days as the audit record of the game.",
    "The e-mail addresses of the Organizer and the Hosts are kept for invoices and payments.",
    REPORT_LINE, NAVIGATION_LINE,
  ] },
  { id: "terms", title: "Terms and Conditions", paragraphs: [
    "These terms apply to the home page and to every game.",
    "Games are played for entertainment. The game software decides the winners from the rules of the game.",
    "The Organizer sets the game, the prizes and the people who may join. Prizes are given by the Organizer.",
    "Game details (settings, prizes, time and a result summary without personal details) are auto-deleted after 365 days.",
    "Invoices and the payment ledger are kept as tax records.",
    "A game report that cannot be delivered is held in encrypted form and sent again after 24, 36 and 72 hours. It is deleted on delivery or after the last try.",
    "These terms may change. The latest version is always on this page.",
  ] },
  { id: "cookies", title: "Cookies and storage", paragraphs: [
    "The games use only first-party storage on the device, for settings such as the look and the language.",
    "No advertising cookies and no third-party trackers are used.",
    NAVIGATION_LINE,
    "A Global Privacy Control signal from the browser is respected: no navigation data is collected.",
  ] },
  { id: "grievance", title: "Questions and complaints", paragraphs: [
    `Questions or complaints about data can be sent to ${GRIEVANCE_EMAIL}.`,
    "Each message gets a reply.",
  ] },
];
const norm = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** Every paragraph of the common text, normalised, that is long enough to be a fingerprint. */
export const LEGAL_FINGERPRINTS: { id: LegalKind; text: string }[] = LEGAL.flatMap((s) => s.paragraphs.filter((p) => p.length >= 40).map((p) => ({ id: s.id, text: norm(p) })));
/** Drift check: the sections of the common text that `text` carries a copy of. A site must show them through the renderer, so a copy in its own files is a failure. */
export const findCopies = (text: string): LegalKind[] => {
  const n = norm(text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'"));
  return [...new Set(LEGAL_FINGERPRINTS.filter((f) => n.includes(f.text)).map((f) => f.id))];
};
