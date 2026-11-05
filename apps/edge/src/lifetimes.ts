// The three clocks of a finished game, in one leaf file so that lifecycle.ts, the AI texts, the mails and the copy test all read the SAME numbers (gap plan TT-16).
// The promise to players is "within 24 hours". Nothing here changes a window: these are the values lifecycle.ts has always used.
export const PURGE_AFTER_MS = 20 * 3_600_000;      // participants' personal data (and the personal part of their audit rows) goes this long after the game ended (the promise is 24 hours)
export const REPORT_LINK_MS = 19 * 3_600_000;      // the organizer's report link stops working this long after the game ended, an hour before the deletion
export const REPORT_AFTER_MS = 3 * 60_000;         // the report starts a few minutes after the end, so late wins have been recorded
/** The same windows in whole hours, for sentences people read. */
export const PURGE_HOURS = PURGE_AFTER_MS / 3_600_000;
export const REPORT_LINK_HOURS = REPORT_LINK_MS / 3_600_000;
