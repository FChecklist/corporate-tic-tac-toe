// Roles and participation (spec 410 section 2). Same invites, limits and change list in every game; the change list records the role, never names.
export type Role = "organizer" | "host" | "cohost" | "participant" | "family";
export const ROLES: Role[] = ["organizer", "host", "cohost", "participant", "family"];
/** Who may press Start, Pause, Resume. Co-hosts help but do not control the clock. */
export const canControlClock = (r: Role): boolean => r === "organizer" || r === "host";
export const canEditSetup = (r: Role): boolean => r === "organizer";
/** Who receives the end-of-game PDF: all Organizers and Hosts equally; Co-hosts are NOT included. */
export const getsEndPdf = (r: Role): boolean => r === "organizer" || r === "host";
export const isPlayer = (r: Role): boolean => r === "participant" || r === "family";
/** Seats a family pass brings (Tambola "Your people and their families", 4 each). */
export const FAMILY_SEATS = 4;
export type Who = "your-people" | "people-and-families" | "extended-family" | "open-link";
export type JoinWay = "link" | "list" | "family";
export type Admission = "in" | "waiting" | "refused";
export interface JoinRequest { listed: boolean; closeGroup: boolean; alreadySeated: boolean; full: boolean; open: boolean }
/** One person one seat/entry. Close group: only the listed come in, the rest wait for the Organizer or Host ("Let in" / "Not now"). */
export function admit(j: JoinRequest): { result: Admission; why?: string } {
  if (!j.open) return { result: "refused", why: "This game is not open yet." };
  if (j.alreadySeated) return { result: "refused", why: "This ID already has a seat in this game." };
  if (j.full) return { result: "refused", why: "This game is full." };
  if (j.closeGroup && !j.listed) return { result: "waiting" };
  return { result: "in" };
}
/** A waiting request lapses after 30 minutes. */
export const WAIT_LAPSE_MS = 30 * 60_000;
/** A change-list entry: the role only, never a name. */
export interface Change { at: number; role: Role; what: string }
export const logChange = (log: Change[], role: Role, what: string, at = Date.now()): Change[] => [...log, { at, role, what }];
export const OUT_MSG = "You are out.";
export const OVER_MSG = "Game over.";
