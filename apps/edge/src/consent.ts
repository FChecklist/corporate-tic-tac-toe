// Consent boxes. Points: K1 publish, K2 sign-up and sign-in, K3 before paying, K4 joining a game, K5 Host and Co-host, K6 guest lists.
//
//   - The wording is in consent-text.json (one file). The pages fetch it from GET /api/consent/text?kind=K4 and draw it; no page types it.
//   - A box is never ticked in advance. The page keeps its button disabled until every box of the point is ticked, AND this file refuses the request without the ticks.
//   - The request carries   consent: { v: "<Terms version>", boxes: ["A", "B"] }.  Without the current version or a required box the answer is
//     HTTP 400 { error: "Please tick the box to continue.", code: "consent-required", kind, version }.
//   - Every acceptance is stored in consent_log: who (an organizer id, a seat id or a key id, never a name, a number or an address), the kind, the game or payment it was for, the version,
//     the boxes, a hash of the exact wording shown, and the time. Participant rows (K4) go with the other participant data after the game; organizer rows stay with the account.
import { TERMS_VERSION } from "./brand";
import TEXT from "./consent-text.json";
import type { D1 } from "./worker";

export type Kind = "K1" | "K2" | "K3" | "K4" | "K5" | "K6";
export const CONSENT_VERSION: string = TERMS_VERSION;
type Boxes = Record<string, string>;
const WORDING = TEXT as unknown as Record<string, Boxes | string>;
/** The boxes of a point in order: [["A", "wording"], ["B", "wording"]]. */
export const boxesOf = (kind: Kind): [string, string][] => Object.entries(WORDING[kind] as Boxes).sort((a, b) => (a[0] < b[0] ? -1 : 1));
export const KINDS: Kind[] = ["K1", "K2", "K3", "K4", "K5", "K6"];

export const CONSENT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS consent_log (id TEXT PRIMARY KEY, subject TEXT, kind TEXT, ref TEXT, version TEXT, boxes TEXT, text_hash TEXT, at_ms INTEGER)`,
  `CREATE INDEX IF NOT EXISTS consent_subject ON consent_log (subject, kind, version)`,
  `CREATE INDEX IF NOT EXISTS consent_ref ON consent_log (ref)`,
];

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/** The exact wording of the boxes of a point, as one string (what text_hash is made from). */
export const wordingOf = (kind: Kind): string => boxesOf(kind).map(([id, t]) => `${id}: ${t}`).join("\n");

/** null when the request ticked every box of the point under the current version; otherwise the answer to send. */
export function consentRequired(b: any, kind: Kind): Response | null {
  const c = b?.consent;
  const sent: unknown[] = Array.isArray(c?.boxes) ? c.boxes : [];
  if (c?.v === CONSENT_VERSION && boxesOf(kind).every(([id]) => sent.includes(id))) return null;
  return json({ error: "Please tick the box to continue.", code: "consent-required", kind, version: CONSENT_VERSION }, 400);
}

/** Stores one acceptance. */
export async function recordConsent(db: D1, o: { subject: string; kind: Kind; ref: string | null; now: number }): Promise<void> {
  const ids = boxesOf(o.kind).map(([id]) => id);
  await db.prepare("INSERT INTO consent_log(id,subject,kind,ref,version,boxes,text_hash,at_ms) VALUES(?,?,?,?,?,?,?,?)").bind(randId(), o.subject, o.kind, o.ref, CONSENT_VERSION, ids.join(","), await sha(wordingOf(o.kind)), o.now).run();
}

/** Has this subject accepted this point under the CURRENT version? (A new version asks again.) */
export async function hasConsented(db: D1, subject: string, kind: Kind): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM consent_log WHERE subject=? AND kind=? AND version=? LIMIT 1").bind(subject, kind, CONSENT_VERSION).first());
}

/** What a page needs to draw the boxes of a point. */
export const textFor = (kind: Kind) => ({ version: CONSENT_VERSION, kind, boxes: boxesOf(kind).map(([id, text]) => ({ id, text })) });

/** Names used by the shared platform code (same as Corporate Tambola): `consentMissing` is `consentRequired`; `hasConsent` can also look at any Terms version. */
export const consentMissing = consentRequired;
export type ConsentKind = Kind;
export async function hasConsent(db: D1, subject: string, kind: Kind, anyVersion = false): Promise<boolean> {
  if (!anyVersion) return hasConsented(db, subject, kind);
  return !!(await db.prepare("SELECT 1 AS x FROM consent_log WHERE subject=? AND kind=? LIMIT 1").bind(subject, kind).first());
}
