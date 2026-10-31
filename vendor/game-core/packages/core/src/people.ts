// The People step rows "Add a Host" and "Add a Co-host" (spec 410 section 2; limits from Tambola: 5 Hosts, unlimited Co-hosts).
// Hosts and Co-hosts are named by e-mail or employee ID. The change list records the role only, never the name.
import type { Role } from "./roles";
import { logChange, type Change } from "./roles";
import { normId, type IdKind } from "./ids";
export const MAX_HOSTS = 5;
export const COHOST_LIST_DEFAULT = 100, COHOST_LIST_MIN = 10, COHOST_LIST_MAX = 1000;
export const PEOPLE_ROWS = [
  { id: "addHost", label: "Add a Host", help: "A Host can run the game with you. Up to 5.", who: ["organizer"] as Role[] },
  { id: "addCohost", label: "Add a Co-host", help: "A Co-host invites people with their own link.", who: ["organizer", "host"] as Role[] },
] as const;
/** A Host or Co-host as stored: the ID, and for a Host whether the Organizer has approved the Host's own key yet. */
export interface Helper { id: string; role: "host" | "cohost"; keyApproved: boolean }
export interface Team { hosts: Helper[]; cohosts: Helper[]; log: Change[] }
export const newTeam = (): Team => ({ hosts: [], cohosts: [], log: [] });
export type Added = { ok: true; team: Team } | { ok: false; why: string };
const add = (t: Team, by: Role, kind: IdKind, raw: string, role: "host" | "cohost", now: number): Added => {
  const row = PEOPLE_ROWS.find((r) => r.id === (role === "host" ? "addHost" : "addCohost"))!;
  if (!row.who.includes(by)) return { ok: false, why: role === "host" ? "Only the Organizer can add a Host." : "Only the Organizer or a Host can add a Co-host." };
  const id = normId(kind, raw);
  if (!id) return { ok: false, why: kind === "email" ? "That e-mail does not look right." : "That employee ID does not look right." };
  if ([...t.hosts, ...t.cohosts].some((h) => h.id === id)) return { ok: false, why: "This person already has a role in this game." };
  if (role === "host" && t.hosts.length >= MAX_HOSTS) return { ok: false, why: `A game can have up to ${MAX_HOSTS} Hosts.` };
  const h: Helper = { id, role, keyApproved: false };
  return { ok: true, team: { ...t, [role === "host" ? "hosts" : "cohosts"]: [...(role === "host" ? t.hosts : t.cohosts), h], log: logChange(t.log, by, `${role === "host" ? "Host" : "Co-host"} added`, now) } };
};
export const addHost = (t: Team, by: Role, kind: IdKind, raw: string, now: number): Added => add(t, by, kind, raw, "host", now);
export const addCohost = (t: Team, by: Role, kind: IdKind, raw: string, now: number): Added => add(t, by, kind, raw, "cohost", now);
/** The Host key is registered later, by the Organizer's approval, and is the Host's own key (never the Organizer's key). */
export function approveHostKey(t: Team, by: Role, hostId: string, now: number): Added {
  if (by !== "organizer") return { ok: false, why: "Only the Organizer can approve a Host key." };
  const h = t.hosts.find((x) => x.id === hostId);
  if (!h) return { ok: false, why: "That Host is not in this game." };
  if (h.keyApproved) return { ok: true, team: t };
  return { ok: true, team: { ...t, hosts: t.hosts.map((x) => (x === h ? { ...x, keyApproved: true } : x)), log: logChange(t.log, by, "Host key approved", now) } };
}
/** A Host without an approved key is listed but cannot yet press Start, Pause or Resume. */
export const hostMayControl = (t: Team, hostId: string): boolean => !!t.hosts.find((h) => h.id === hostId)?.keyApproved;
export const cohostLimitOk = (n: number): boolean => Number.isInteger(n) && n >= COHOST_LIST_MIN && n <= COHOST_LIST_MAX;
