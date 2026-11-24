// No check boxes anywhere (owner decision, 1 Nov 2026): nothing blocks or alarms the user. Publishing a game, signing in or joining is the clear act of going ahead.
// Instead: ONE small gentle line BELOW the action button, with three links, and a proof kept on the server (version of the document, sha256 of the text shown, time). No other personal data.
import { DOC_TITLES, DOC_URLS, TERMS_VERSION, type DocSectionId } from "./documents";

/** The one version. A change of any text in the document changes TERMS_VERSION, and with it this. */
export const AGREEMENT_VERSION = TERMS_VERSION;
/** The notice, as three links in order. The page renders them; nothing else is shown with it. */
export const NOTICE_LINKS: { id: DocSectionId; label: string; href: string }[] = (["terms", "privacy", "game-rules"] as const).map((id) => ({ id, label: DOC_TITLES[id], href: DOC_URLS[id] }));
/** The exact plain text of the notice (what the server fingerprints): "By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules." */
export const NOTICE_TEXT = `By continuing, you agree to the ${DOC_TITLES.terms}, ${DOC_TITLES.privacy}, and ${DOC_TITLES["game-rules"]}.`;
/** Where the notice is shown: below the button where data is first given (sign-in or start), where a game is published or paid, and where a participant joins. */
export type AgreementPoint = "signin" | "publish" | "join";
export const AGREEMENT_POINTS: AgreementPoint[] = ["signin", "publish", "join"];
export interface AgreementRecord { point: AgreementPoint; version: string; textHash: string; at: number }
/** The proof to store at sign-in and at publish (and join): version + sha256 of the shown text + time, nothing personal. The site hashes `NOTICE_TEXT` with sha256 and passes the hex here. */
export function recordAgreement(point: AgreementPoint, textHash: string, at: number, version: string = AGREEMENT_VERSION): AgreementRecord {
  return { point, version, textHash, at };
}
/** A returning user who last agreed to an older version just sees the new line; the server stores the new version at their next action. No screen, no tick. */
export const needsNewRecord = (lastVersion: string | null | undefined): boolean => lastVersion !== AGREEMENT_VERSION;
