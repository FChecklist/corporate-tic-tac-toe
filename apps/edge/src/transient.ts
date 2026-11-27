// Errors that pass by themselves (kept in their own file so winners.ts / lifecycle.ts can use them without importing the worker).
/** Errors that pass by themselves: the database's own 10-second overload limit, a dropped connection, a timeout. Anything else (a bug, a bad row) is NOT retried. */
export const transientDb = (e: unknown): boolean => /overloaded|too many resources|network connection lost|connection (?:reset|closed)|timed out|timeout|internal error|temporarily unavailable|storage operation exceeded|D1_ERROR: .*(?:reset|unavailable)/i.test(String((e as any)?.message ?? e));
