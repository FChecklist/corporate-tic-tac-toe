// ONE shared cleaner for every typed or uploaded employee ID and e-mail ID (owner rule 30 Oct 2026). Same words in the browser hint.
/** Games created before this instant keep the old employee-ID behaviour. SET TO THE DEPLOY INSTANT AT RELEASE. */
export const EMP_CLEAN_FROM_MS = Date.UTC(2099, 0, 1); // far-future PLACEHOLDER: the release session sets the exact deploy instant (docs/TEST_HANDOFF.md)
export const EMP_MAX = 30;
/** Employee ID: NFKC, upper case, keep only A-Z and 0-9 (spaces, dashes, slashes, dots, symbols, accents, other scripts, emoji and zero-width marks all go). Never use this on an e-mail. */
export const cleanEmpId = (raw: unknown): string => String(raw ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** E-mail ID: NFKC, trim, no inner spaces, lower case. Upper/lower case never makes a different person. */
export const cleanEmail = (raw: unknown): string => String(raw ?? "").normalize("NFKC").replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase();
/** An ACCOUNT e-mail (organizer sign-up/sign-in, Host, Google, payment, forms): only trim and lower case. An inner space or a full-width at-sign is NOT repaired: such an address is not valid and is refused by the shape checks. Only a participant's Email ID uses cleanEmail. */
export const cleanAccountEmail = (raw: unknown): string => String(raw ?? "").trim().toLowerCase();
/** What the browser hint says: "The system will read this as 1B678". */
export const empHint = (raw: unknown): string => { const c = cleanEmpId(raw); return c ? `The system will read this as ${c}` : ""; };
/** "" = nothing typed, null = refused (nothing left after cleaning, or longer than 30). Old games (created before EMP_CLEAN_FROM_MS) use the old rule. */
export const normEmpFor = (raw: unknown, createdMs?: number): string | null => {
  if (typeof createdMs === "number" && createdMs < EMP_CLEAN_FROM_MS) { const s = String(raw ?? "").replace(/\s+/g, "").toUpperCase(); if (!s) return ""; return /^[A-Z0-9][A-Z0-9._\-/]{0,29}$/.test(s) ? s : null; }
  if (!String(raw ?? "").trim()) return "";
  if (String(raw ?? "").normalize("NFKC").includes("@")) return null; // an e-mail typed where an employee ID is asked is refused, never turned into letters
  const c = cleanEmpId(raw); return c && c.length <= EMP_MAX ? c : null;
};
