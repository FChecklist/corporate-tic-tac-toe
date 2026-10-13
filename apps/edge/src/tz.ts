// Times in mails, summaries and the report are worded in the organizer's own time zone (kept with the game as `tz`, an IANA name such as America/New_York).
// A game with no time zone uses India time, as before. Pure: no clock, no network.
export const DEFAULT_TZ = "Asia/Kolkata";

/** The time zone saved with a game row (its config JSON), or the default. */
export function tzOfRow(e: { config?: string | null } | null | undefined): string {
  try { const j = e?.config ? JSON.parse(e.config) : {}; return typeof j.tz === "string" && j.tz ? j.tz : DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

/** The short name of the zone at that moment: "IST" for India, otherwise what the runtime knows ("EDT", "GMT+1") or the zone's own name. */
export function zoneAbbr(ms: number, tz: string = DEFAULT_TZ): string {
  if (tz === DEFAULT_TZ) return "IST";
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value ?? tz; } catch { return tz; }
}
const loc = (tz: string) => (tz === DEFAULT_TZ ? "en-IN" : "en-US");
const safe = <T>(tz: string, f: (z: string) => T): T => { try { return f(tz); } catch { return f(DEFAULT_TZ); } };

/** "12 Oct 2026, 4:00 pm IST" */
export const zoneStamp = (ms: number, tz: string = DEFAULT_TZ, withYear = true): string => safe(tz, (z) => `${new Date(ms).toLocaleString(loc(z), { timeZone: z, day: "numeric", month: "short", ...(withYear ? { year: "numeric" as const } : {}), hour: "numeric", minute: "2-digit", hour12: true })} ${zoneAbbr(ms, z)}`);
/** "Fri, 2 Oct, 4:00 pm IST" */
export const zoneTime = (ms: number, tz: string = DEFAULT_TZ): string => safe(tz, (z) => `${new Date(ms).toLocaleString(loc(z), { timeZone: z, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })} ${zoneAbbr(ms, z)}`);

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** The wall-clock parts of `ms` in the zone. */
export function zoneParts(ms: number, tz: string = DEFAULT_TZ): { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number } {
  return safe(tz, (z) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }).formatToParts(new Date(ms));
    const g = (k: string) => parts.find((x) => x.type === k)!.value;
    return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")), h: Number(g("hour")), mi: Number(g("minute")), s: Number(g("second")), wd: DOW.indexOf(g("weekday")) };
  });
}
/** "Mon 12 Oct 2026, 16:00:00 IST" */
export const zoneFull = (ms: number, tz: string = DEFAULT_TZ): string => { const p = zoneParts(ms, tz); return `${DOW[p.wd]} ${p2(p.d)} ${MON[p.mo - 1]} ${p.y}, ${p2(p.h)}:${p2(p.mi)}:${p2(p.s)} ${zoneAbbr(ms, tz)}`; };
/** "Mon 12 Oct 2026" */
export const zoneDate = (ms: number, tz: string = DEFAULT_TZ): string => { const p = zoneParts(ms, tz); return `${DOW[p.wd]} ${p2(p.d)} ${MON[p.mo - 1]} ${p.y}`; };

/** How far the zone is ahead of UTC at that instant, in milliseconds (daylight saving included). */
export function zoneOffsetMs(ms: number, tz: string = DEFAULT_TZ): number { const p = zoneParts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
/** The UTC instant of a wall-clock time in the zone. */
export function zoneLocalToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string = DEFAULT_TZ): number { const guess = Date.UTC(y, mo - 1, d, h, mi); return guess - zoneOffsetMs(guess - zoneOffsetMs(guess, tz), tz); }
