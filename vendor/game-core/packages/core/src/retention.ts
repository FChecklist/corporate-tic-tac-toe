// Data and retention (spec 410 section 6). Code erases at 20 h so a late scheduler still stays inside the promised 24 h.
export const ERASE_AFTER_MS = 20 * 3_600_000;
export const PRIZE_SHEET_REMINDER_MS = 12 * 3_600_000;
export const PDF_SEND_WITHIN_MS = 3 * 3_600_000;
export const PDF_RETRY_HOURS = [24, 36, 72];
export const WINNERS_KEEP_DAYS = 365;
export const eraseDue = (endedAt: number, now: number): boolean => now - endedAt >= ERASE_AFTER_MS;
/** Erased at 24 h (winners' names too, option A; only position + prize record is kept). */
export const ERASED = ["emails", "employee IDs", "names", "seats", "tickets", "moves", "claims", "winners' names"] as const;
