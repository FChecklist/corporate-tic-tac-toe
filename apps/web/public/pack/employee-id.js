// ONE way to read an employee ID (owner rule 30 Oct 2026). Wherever the console accepts, shows, lists, matches, uploads, exports or passes on an employee ID, it goes through this function first.
// NFKC (full-width and look-alike characters become plain ones), then CAPITAL letters, then everything that is not A-Z or 0-9 is removed:
// 1B-678, 1b-678, 1B/678 and 1B 678 are all the same person: 1B678. The same function is used when an ID is handed to a game.
export const EMPLOYEE_ID_MAX = 30; // letters and numbers, counted AFTER the cleaning

export function cleanEmployeeId(raw) { return String(raw == null ? "" : raw).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

/** what to say about a typed ID: { ok, id, hint } or { ok:false, error } in plain words (empty after cleaning, or longer than 30 after cleaning, is refused: an ID is never cut short) */
export function checkEmployeeId(raw) {
  const id = cleanEmployeeId(raw);
  if (!id) return { ok: false, error: "Please type an employee ID. It needs at least one letter or number." };
  if (id.length > EMPLOYEE_ID_MAX) return { ok: false, error: "An employee ID can have at most " + EMPLOYEE_ID_MAX + " letters and numbers." };
  return { ok: true, id, hint: "The system will read this as " + id };
}
