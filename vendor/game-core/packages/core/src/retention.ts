// Data and retention (spec 410 section 6). The code auto-deletes at 20 h so a late scheduler still stays inside the promised 24 h.
export const AUTO_DELETE_AFTER_MS = 20 * 3_600_000;
export const PRIZE_SHEET_REMINDER_MS = 12 * 3_600_000;
export const PDF_SEND_WITHIN_MS = 3 * 3_600_000;
export const PDF_RETRY_HOURS = [24, 36, 72];
export const WINNERS_KEEP_DAYS = 365;
export const autoDeleteDue = (endedAt: number, now: number): boolean => now - endedAt >= AUTO_DELETE_AFTER_MS;
/** Auto-deleted at 24 h (winners' names too, option A; only position + prize record is kept). */
export const AUTO_DELETED = ["emails", "employee IDs", "names", "seats", "tickets", "moves", "claims", "winners' names"] as const;
