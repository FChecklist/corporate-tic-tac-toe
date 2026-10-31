// ID and account-email rules, copied from Tambola 1.9.0 apps/edge/src/empid.ts (uniform rule of 1.8.5). Every game cleans IDs with these functions only.
export const EMP_MAX = 30;
/** The one cleaning function: only A-Z and 0-9 are left, in upper case. "1b-678", "1B/678" and "1B 678" all become 1B678. */
export const cleanEmpId = (raw: unknown): string => String(raw ?? "").normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
/** An Email ID by ONE rule: NFKC, every space removed, lower case. Never run cleanEmpId on an email. */
export const normEmail = (raw: unknown): string => String(raw ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\u2060\ufeff\u0085\u2028\u2029]/g, "").toLowerCase();
export const looksLikeEmail = (raw: unknown): boolean => String(raw ?? "").normalize("NFKC").includes("@");
export const EMP_BAD = "An employee ID has letters and numbers only. The system ignores spaces, dashes and symbols, and the ID may be up to 30 characters once cleaned.";
export const EMP_LOOKS_LIKE_EMAIL = "This looks like an Email ID. This game asks for an employee ID: letters and numbers only.";
export const EMP_TOO_LONG = "This ID is too long. An employee ID may be up to 30 characters once cleaned.";
/** An employee ID as typed. "" = nothing typed; null = not a usable ID (an email typed here is refused, never mangled into letters). */
export function normEmp(raw: unknown): string | null {
  if (String(raw ?? "").trim() === "") return "";
  if (looksLikeEmail(raw)) return null;
  const s = cleanEmpId(raw);
  return s && s.length <= EMP_MAX ? s : null;
}
/** The plain refusal sentence for an ID that cannot be used. */
export const empBadMessage = (raw: unknown): string => (looksLikeEmail(raw) ? EMP_LOOKS_LIKE_EMAIL : cleanEmpId(raw).length > EMP_MAX ? EMP_TOO_LONG : EMP_BAD);
/** Which ID a game asks for; locked once people are listed. */
export type IdKind = "emp" | "email";
export const normId = (kind: IdKind, raw: unknown): string | null => (kind === "email" ? normEmail(raw) || null : normEmp(raw) || null);
