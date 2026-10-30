// People, links and joining (Phase 2, docs/ROLES_AND_CONSOLE_SPEC_3.md). Everything about WHO is on a game's lists lives here:
//   - Every inviter has ONE list of people (name + mobile): the Organizer ('o'), each Host ('h:<7 hex>'), each Co-host ('c:<7 hex>') and each level-1 guest ('s:<seat no>').
//     A person is on one list only; the first list wins (unique phone hash per game), so a second add says "already invited".
//   - A listed person has a PERSONAL link (https://<site>/j/<token>, single use, binds to the first phone) and everybody has a COMMON link (z.html?e=ID&from=<code>).
//   - A typed mobile number is MATCHED to a list, it is not proven. Only the personal link is strong proof (it carries a secret and binds to one phone).
//   - Someone who is on no list waits in the WAITING ROOM (game setting "who can join") or joins at once under the link owner up to that owner's limit. Waiting requests use no place.
//   - Removing a person before the game frees the place; during the game the seat stays in the public seat list (winners must be identical on every phone) and is only blocked.
// Names and numbers are sealed at rest (pii.ts) and never reach an AI key (every route here refuses an AI, and anything arriving through an AI work link).
// The Worker (worker.ts) owns routing, `join` and `settings`; this file owns the schema, the cleaning of numbers and the people / waiting / me routes.
import { normEmpFor } from "./ids";
import { consentRequired, recordConsent } from "./consent";
import { openPii, openText, sealPii, sealText } from "./pii";
import { consentMissing } from "./consent";
import { deviceMatches } from "./checkin";
import type { D1, Env } from "./worker";

/** 0016_people.sql: who invited whom, the personal links, the waiting room, and the flag that stops a removed person's phone without touching the public seat list. */
export const PEOPLE_SCHEMA: string[] = [
  `ALTER TABLE organizer_key ADD COLUMN created_by TEXT`,
  `ALTER TABLE engagement ADD COLUMN cohost_limit INTEGER`,
  `ALTER TABLE seat ADD COLUMN blocked INTEGER`,
  `CREATE TABLE IF NOT EXISTS person (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, inviter TEXT NOT NULL, role TEXT, status TEXT NOT NULL, tok_hash TEXT, tok_sealed TEXT, approved_by TEXT, approved_ms INTEGER, added_ms INTEGER NOT NULL, joined_ms INTEGER, removed_ms INTEGER, removed_by TEXT, PRIMARY KEY (eid, id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS person_phone ON person (eid, ph)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS person_token ON person (tok_hash)`,
  `CREATE INDEX IF NOT EXISTS person_inviter ON person (eid, inviter)`,
  `CREATE TABLE IF NOT EXISTS waiting (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, via TEXT NOT NULL, inviter TEXT NOT NULL, chain TEXT NOT NULL, overlimit INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, at_ms INTEGER NOT NULL, decided_by TEXT, decided_ms INTEGER, PRIMARY KEY (eid, id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS waiting_phone ON waiting (eid, ph)`,
];

/** The `from=` code of a common link. Co-hosts and the Organizer / Hosts get codes far above any seat number; a small code is a level-1 guest's seat number. */
export const COHOST_FROM = 1_000_000_000;
export const HOST_FROM = 1_500_000_000;
export const ORG_FROM = 1_900_000_000;
/** A Co-host may list this many people per game unless the Organizer changes it (10 to 1000). */
export const COHOST_LIMIT_DEFAULT = 100, COHOST_LIMIT_MIN = 10, COHOST_LIMIT_MAX = 1000;
/** People per request: each one is sealed twice (details and link), which a free Worker's CPU allowance handles in about this many. The console sends a bigger list in several requests. */
export const MAX_ADD_BATCH = 200;
/** Most people that may wait for an answer in one game at a time (a free-plan guard against someone filling the table). */
export const WAITING_MAX = 500;

export const isOrg = (id: string) => id === "o";
const encoder = new TextEncoder();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
export const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i: a link read aloud or typed cannot be mixed up
/** A personal-link token: 10 characters, about 49 bits. Only its hash is looked up; the link itself is kept sealed so the inviter can be shown it again. */
export const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHA[b % ALPHA.length]).join("");
export const tokenHash = async (token: string) => (await sha("pj|" + token.toLowerCase())).slice(0, 32);

/** Same formula as the Worker's join (worker.ts `phoneHash`): +91 98765 43210, 098765 43210 and 9876543210 are one person; one hash in every game. */
export const phoneHashOf = (env: { PHONE_SALT?: string; ORGANIZER_SECRET?: string }, digits: string) => sha(`${env.PHONE_SALT ?? env.ORGANIZER_SECRET ?? "unset"}|${digits.slice(-10)}`);

/** An employee ID as typed: spaces dropped, upper case. "" = nothing typed, null = not a usable ID. */
export const normEmp = (raw: unknown, createdMs?: number): string | null => normEmpFor(raw, createdMs); // one shared cleaner: see ids.ts
/** The identity of a person who is known by employee ID alone (no mobile number needed). One hash for the same ID in every game, like the phone hash. */
export const empHashOf = (env: { PHONE_SALT?: string; ORGANIZER_SECRET?: string }, id: string) => sha(`${env.PHONE_SALT ?? env.ORGANIZER_SECRET ?? "unset"}|emp|${id}`);
/** What the organizer asked people to give to get in, read from the game's stored settings. */
export const verifyOf = (e: { config?: string | null }): { mode: "mobile" | "id" | "either" | "both"; employeesOnly: boolean } => { try { const j = e.config ? JSON.parse(e.config) : {}; return { mode: j.verify === "id" || j.verify === "either" || j.verify === "both" ? j.verify : "mobile", employeesOnly: j.employeesOnly === true }; } catch { return { mode: "mobile", employeesOnly: false }; } };

export { cleanPhone, maskedPhone, keptPhone, phoneDigits, keptFromClean } from "./phonekit";
export type { Cleaned } from "./phonekit";
import { cleanPhone, maskedPhone, keptFromClean, phoneDigits } from "./phonekit";
/** A name as kept: no control or invisible characters, no markup characters, and nothing at the front that a spreadsheet would run as a formula (= + - @). Also the server's answer to a hand-made request: the page already sends only tidy names. */
export const cleanName = (n: unknown) => (typeof n === "string" ? Array.from(n).filter((ch) => { const c = ch.charCodeAt(0); return !(c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff); }).join("").replace(/[<>`]/g, "").replace(/\s+/g, " ").replace(/^[=+\-@\s]+/, "").trim().slice(0, 60) : "");

/** What a `from=` code on a common link means. */
export type FromOwner = { kind: "org" } | { kind: "host"; hex: string } | { kind: "cohost"; hex: string } | { kind: "guest"; seq: number };
export function parseFrom(from: unknown): FromOwner | null {
  if (!Number.isInteger(from) || (from as number) < 1) return null;
  const f = from as number;
  if (f === ORG_FROM) return { kind: "org" };
  if (f >= HOST_FROM && f < HOST_FROM + 0x10000000) return { kind: "host", hex: (f - HOST_FROM).toString(16).padStart(7, "0") };
  if (f >= COHOST_FROM && f < COHOST_FROM + 0x10000000) return { kind: "cohost", hex: (f - COHOST_FROM).toString(16).padStart(7, "0") };
  if (f < COHOST_FROM) return { kind: "guest", seq: f };
  return null;
}
/** The `from=` code that goes in an inviter's common link. */
export function fromCodeOf(inviter: string): number | null {
  if (inviter === "o") return ORG_FROM;
  const [k, v] = inviter.split(":");
  if (k === "h") return HOST_FROM + parseInt(v!, 16);
  if (k === "c") return COHOST_FROM + parseInt(v!, 16);
  if (k === "s") return Number(v);
  return null;
}
/** The inviter id that goes in `person.inviter` for an owner of a common link. */
export const inviterOf = (o: FromOwner): string => (o.kind === "org" ? "o" : o.kind === "host" ? "h:" + o.hex : o.kind === "cohost" ? "c:" + o.hex : "s:" + o.seq);
/** What `seat.src` says for a person who came in under this inviter (a Co-host's count of people brought reads it). */
export const srcOf = (inviter: string): string => (inviter.startsWith("c:") ? "co:" + inviter.slice(2) : inviter.startsWith("h:") ? "ho:" + inviter.slice(2) : "link");

export const waMessage = (name: string | null, game: string, link: string) => `${name ? name + ", you" : "You"} are invited to ${game}. Open your game here: ${link}`;
export const waLinkOf = (digits: string, text: string) => `https://wa.me/${phoneDigits(digits)}?text=${encodeURIComponent(text)}`; // a kept number may start with +: wa.me wants the digits only

/** Callers of the people routes. `all` = sees every list of the game (Organizer, Host). */
export interface Caller { id: string; kind: "organizer" | "host" | "cohost" | "guest"; all: boolean; limit: number | null; label: string; seat?: number; platform?: boolean }
export interface Ctx {
  req: Request; env: Env; now: number; url: URL; e: any; eid: string; tail: string;
  /** From worker.ts `authOf`: who holds the key, and the first 7 hex of its hash (its id in the chains). */
  a: { plat: boolean; org: string | null; kind: string | null; eid?: string | null; viaLink?: boolean };
  keyId7: string; viaLink: boolean; origin: string; gameName: string; invites: { on: boolean; per: number; cats: string[] };
  started: boolean; draft: boolean; cancelled: boolean;
  json: (o: unknown, status?: number) => Response;
  body: (req: Request, max?: number) => Promise<any | null>;
  spend: (n?: number) => Promise<boolean>;
  busy: () => Response;
  endBound: () => Promise<number>;
  sendMail: (to: string, subject: string, text: string) => Promise<unknown>;
  orgEmail: () => Promise<string | null>;
  istTime: (ms: number) => string;
}

const AI_REFUSAL = "Names and mobile numbers are handled by people in the console, never by an AI assistant. Ask the owner to do this in the console.";
const PERSON_COLS = "eid, id, ph, pii, inviter, role, status, tok_hash, tok_sealed, approved_by, approved_ms, added_ms, joined_ms, removed_ms, removed_by";
interface PersonRow { eid: string; id: string; ph: string; pii: string; inviter: string; role: string | null; status: "invited" | "joined" | "removed"; tok_hash: string | null; tok_sealed: string | null; approved_by: string | null; approved_ms: number | null; added_ms: number; joined_ms: number | null; removed_ms: number | null; removed_by: string | null }

/** Who may use the people routes, and as which list. Returns a response when they may not. A guest (level 1) is known by their card id (`me`), the same trust as the /invites route. */
async function callerOf(c: Ctx, bodyMe?: unknown, bodyDevice?: unknown): Promise<{ who: Caller } | { res: Response }> {
  const { a, e } = c;
  if (a.kind === "ai" || c.viaLink || c.req.headers.get("x-cb-link") === "1") return { res: c.json({ error: AI_REFUSAL }, 403) };
  if (a.kind) {
    if (!a.plat && (!a.org || a.org !== e.org)) return { res: c.json({ error: "Not allowed." }, 403) };
    if (a.plat || a.kind === "master") return { who: { id: "o", kind: "organizer", all: true, limit: null, label: "Organizer", platform: a.plat } };
    if (a.kind === "host") return { who: { id: "h:" + c.keyId7, kind: "host", all: true, limit: null, label: "Host" } };
    if (a.kind === "cohost") {
      if (a.eid && a.eid !== e.id) return { res: c.json({ error: "Your Co-host link is for a different game." }, 403) };
      return { who: { id: "c:" + c.keyId7, kind: "cohost", all: false, limit: e.cohost_limit ?? COHOST_LIMIT_DEFAULT, label: "Co-host" } };
    }
    return { res: c.json({ error: "Not allowed." }, 403) };
  }
  const pid = c.req.headers.get("x-cb-pid") || c.url.searchParams.get("me") || (typeof bodyMe === "string" ? bodyMe : "");
  if (!pid) return { res: c.json({ error: "Please sign in, or open your personal link first." }, 403) };
  const seat = await c.env.DB.prepare("SELECT seq, role, inv, blocked FROM seat WHERE eid=? AND pid=?").bind(c.eid, pid).first<{ seq: number; role: string | null; inv: number | null; blocked: number | null }>();
  if (!seat) return { res: c.json({ error: "Not a participant of this game." }, 403) };
  // the card id is public (the seat list shows it): acting for a card also needs the phone's own device id, like check-in, prizes and leaving do
  if (!(await deviceMatches(c.env, c.eid, pid, c.req.headers.get("x-cb-dev") || c.url.searchParams.get("device") || (typeof bodyDevice === "string" ? bodyDevice : "")))) return { res: c.json({ error: "Open this card on the phone you joined with to invite people.", code: "device" }, 403) };
  if (seat.blocked) return { res: c.json({ error: "You were removed from this game.", code: "removed" }, 403) };
  if (seat.role) return { res: c.json({ error: "Your team seat invites through the console, not through the game page." }, 403) };
  if (seat.inv !== null) return { res: c.json({ error: "Guests invited by a guest can play but cannot invite more people." }, 403) };
  if (!c.invites.on) return { res: c.json({ error: "The organizer has not switched on guest invitations for this game." }, 403) };
  return { who: { id: "s:" + seat.seq, kind: "guest", all: false, limit: c.invites.per, label: "Guest", seat: seat.seq } };
}

/** The labels the console shows for inviter ids: Organizer, Host <label>, Co-host <label>, Guest (card n). */
async function labelsOf(c: Ctx): Promise<(id: string | null) => string> {
  const rows = (await c.env.DB.prepare("SELECT substr(hash,1,7) AS h, kind, label FROM organizer_key WHERE org=? AND kind IN ('host','cohost') AND (eid IS NULL OR eid=?)").bind(c.e.org, c.eid).all<{ h: string; kind: string; label: string | null }>()).results ?? [];
  const m = new Map<string, string>();
  for (const r of rows) m.set((r.kind === "host" ? "h:" : "c:") + r.h, `${r.kind === "host" ? "Host" : "Co-host"}${r.label ? " " + r.label : ""}`);
  return (id) => (!id ? "" : id === "o" ? "Organizer" : id.startsWith("s:") ? `Guest (seat ${id.slice(2)})` : m.get(id) ?? (id.startsWith("h:") ? "Host" : "Co-host"));
}

export interface PersonView { id: string; name: string; maskedPhone: string; status: "invited" | "joined" | "waiting" | "removed"; empId?: string; link: string | null; waLink: string | null; role?: string; inviter?: string; approvedBy?: string }
async function viewOf(c: Ctx, r: PersonRow, label: (id: string | null) => string, showInviter: boolean): Promise<PersonView> {
  const pii = await openPii(c.env, r.pii);
  const token = r.status === "removed" ? null : await openText(c.env, r.tok_sealed);
  const link = token ? `${c.origin}/j/${token}` : null;
  const digits = pii?.phone ?? "";
  return {
    id: r.id, name: pii?.name ?? "", maskedPhone: digits ? maskedPhone(digits) : "", status: r.status, ...(pii?.empId ? { empId: pii.empId } : {}),
    link, waLink: link && digits ? waLinkOf(digits, waMessage(pii?.name || null, c.gameName, link)) : null,
    ...(r.role ? { role: r.role } : {}), ...(showInviter ? { inviter: label(r.inviter) } : {}), ...(r.approved_by ? { approvedBy: label(r.approved_by) } : {}),
  };
}

/** How many people are on this inviter's list (a removed person frees the place; a team member's own play seat is not a guest). */
export const listCount = async (db: D1, eid: string, inviter: string): Promise<number> =>
  (await db.prepare("SELECT COUNT(*) AS c FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL").bind(eid, inviter).first<{ c: number }>())?.c ?? 0;
const totalCount = async (db: D1, eid: string): Promise<number> => (await db.prepare("SELECT COUNT(*) AS c FROM person WHERE eid=? AND status<>'removed'").bind(eid).first<{ c: number }>())?.c ?? 0;

/** The limit of whoever owns this inviter id (null = none): Co-host's per-game limit, a level-1 guest's invites each, nobody else. */
export async function limitOfInviter(c: { env: Env; eid: string; e: any; invites: { on: boolean; per: number } }, inviter: string): Promise<number | null> {
  if (inviter.startsWith("c:")) return c.e.cohost_limit ?? COHOST_LIMIT_DEFAULT;
  if (inviter.startsWith("s:")) {
    const s = await c.env.DB.prepare("SELECT role FROM seat WHERE eid=? AND seq=?").bind(c.eid, Number(inviter.slice(2))).first<{ role: string | null }>();
    return s?.role ? null : c.invites.per;
  }
  return null;
}
/** Everybody who may answer a waiting request from this link owner: the owner and the people above them, as ",id,id,". Organizer and Hosts see every request anyway. */
export async function chainOf(db: D1, eid: string, inviter: string): Promise<string> {
  const ids = [inviter];
  if (inviter.startsWith("s:")) { // a guest's own inviter sits above them
    const up = await db.prepare("SELECT p.inviter AS inviter FROM seat s JOIN person p ON p.eid=s.eid AND p.ph=s.ph WHERE s.eid=? AND s.seq=?").bind(eid, Number(inviter.slice(2))).first<{ inviter: string }>();
    if (up?.inviter && !ids.includes(up.inviter)) ids.push(up.inviter);
  }
  return "," + ids.join(",") + ",";
}

const csvCell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = "'" + s; /* a plain international number (+447911123456) is not a formula: keep it exactly, so a re-upload reads the same number */ return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Removed seats stay in the public seat list (winners must be identical on every phone) but cannot win Unlucky: their ids are kept in one small public list that phones read with the seats. */
async function refreshBlocked(db: D1, eid: string): Promise<void> {
  try {
    const rows = (await db.prepare("SELECT pid FROM seat WHERE eid=? AND blocked=1").bind(eid).all<{ pid: string }>()).results ?? [];
    await db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(`seats-blk/${eid}`, JSON.stringify(rows.map((r) => r.pid))).run();
  } catch { /* the next removal or restore writes it again; until then Unlucky treats these seats as present */ }
}
async function batched(db: D1, stmts: ReturnType<D1["prepare"]>[]): Promise<{ meta?: { changes?: number } }[]> {
  const out: { meta?: { changes?: number } }[] = [];
  for (let i = 0; i < stmts.length; i += 50) out.push(...(await db.batch(stmts.slice(i, i + 50))));
  return out;
}
const inList = (n: number) => Array(n).fill("?").join(",");
async function existingBy(db: D1, table: "person" | "waiting" | "seat", eid: string, hashes: string[], cols: string): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  const col = table === "seat" ? "ph" : "ph";
  for (let i = 0; i < hashes.length; i += 50) {
    const part = hashes.slice(i, i + 50);
    const rows = (await db.prepare(`SELECT ${cols} FROM ${table} WHERE eid=? AND ${col} IN (${inList(part.length)})`).bind(eid, ...part).all<any>()).results ?? [];
    for (const r of rows) m.set(r.ph, r);
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------- routes
export async function peopleRoute(c: Ctx): Promise<Response> {
  const parts = c.tail.split("/").filter(Boolean), method = c.req.method;
  if (parts[0] === "me") return method === "GET" ? meRoute(c) : c.json({ error: "Not found" }, 404);

  let bodyObj: any = null;
  if (method === "POST" || method === "PATCH") { const ct = c.req.clone(); bodyObj = await c.body(ct, 65_536); }
  const got = await callerOf(c, bodyObj?.me, bodyObj?.device);
  if ("res" in got) return got.res;
  const who = got.who;
  if (c.e.unplayed_ms && method !== "GET") return c.json({ error: "This game did not start. Your details have been erased.", code: "did-not-start", didNotStart: true }, 409);
  if (c.cancelled && method !== "GET") return c.json({ error: "This game was cancelled by the organizer.", code: "cancelled", cancelled: true }, 409);

  if (parts[0] === "waiting") {
    if (parts.length === 1 && method === "GET") return listWaiting(c, who);
    if (parts.length === 2 && parts[1] === "all" && method === "POST") return decideAll(c, who, bodyObj);
    if (parts.length === 2 && method === "POST") return decideWaiting(c, who, parts[1]!, bodyObj);
    return c.json({ error: "Not found" }, 404);
  }
  // people
  if (parts.length === 1 && method === "GET") return listPeople(c, who);
  if (parts.length === 1 && method === "POST") return addPeople(c, who, bodyObj);
  if (parts.length === 2 && parts[1] === "export" && method === "GET") return exportPeople(c, who);
  if (parts.length === 2 && parts[1] === "me" && (method === "GET" || method === "POST")) return myOwnSeat(c, who, bodyObj);
  if (parts.length === 3 && parts[2] === "remove" && method === "POST") return removePerson(c, who, parts[1]!, bodyObj);
  if (parts.length === 3 && parts[2] === "resend" && method === "POST") return resendPerson(c, who, parts[1]!, bodyObj);
  return c.json({ error: "Not found" }, 404);
}

async function listPeople(c: Ctx, who: Caller): Promise<Response> {
  const limit = Math.min(Math.max(Number(c.url.searchParams.get("limit")) || 200, 1), 500), offset = Math.max(Number(c.url.searchParams.get("offset")) || 0, 0);
  const rows = await (who.all
    ? c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? ORDER BY added_ms, id LIMIT ? OFFSET ?`).bind(c.eid, limit, offset)
    : c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND inviter=? ORDER BY added_ms, id LIMIT ? OFFSET ?`).bind(c.eid, who.id, limit, offset)).all<PersonRow>();
  const label = await labelsOf(c);
  const people: PersonView[] = [];
  for (const r of rows.results ?? []) people.push(await viewOf(c, r, label, who.all));
  const used = await listCount(c.env.DB, c.eid, who.id);
  const waitingCount = (await waitingRows(c, who, 1000)).length;
  const code = fromCodeOf(who.id);
  return c.json({
    people, limit: who.limit ?? c.e.cap, used, total: who.all ? await totalCount(c.env.DB, c.eid) : used, cap: c.e.cap, offset, waiting: waitingCount,
    whoCanJoin: c.e.closed ? "list" : "anyone", role: who.kind, canExport: who.all,
    commonLink: c.draft || c.cancelled || code === null ? null : `${c.origin}/z.html?e=${c.eid}&from=${code}`,
  });
}

async function addPeople(c: Ctx, who: Caller, b: any): Promise<Response> {
  if (!b || !Array.isArray(b.people) || b.people.length < 1) return c.json({ error: "Send at least one person: {people:[{name, phone}]}." }, 400);
  { const mt = consentRequired(b, "K6"); if (mt) return mt; } // K6: "I am allowed to use these names and numbers for this game. The people have been told."
  if (b.people.length > MAX_ADD_BATCH) return c.json({ error: `Send up to ${MAX_ADD_BATCH} people at a time; the console sends a bigger list in several parts.`, code: "too-many" }, 413);
  if (c.now >= await c.endBound()) return c.json({ error: "The game has ended, so no one can be added." }, 409);
  const invalid: { raw: string; why: string }[] = []; let duplicates = 0;
  const seen = new Set<string>(); const todo: { name: string; digits: string; ph: string; empId?: string; idHash?: string }[] = [];
  const vf = verifyOf(c.e);
  for (const x of b.people) {
    const raw = `${cleanName(x?.name)} ${String(x?.phone ?? "")}`.trim().slice(0, 100);
    const emp = normEmp(x?.empId ?? x?.employeeId);
    if (emp === null) { invalid.push({ raw, why: "An employee ID has letters and numbers only (up to 30)." }); continue; }
    const phoneTyped = String(x?.phone ?? "").trim() !== "";
    if (vf.mode === "either" && !emp && !phoneTyped) { invalid.push({ raw, why: "Give a mobile number or an employee ID." }); continue; }
    if (vf.employeesOnly && vf.mode !== "mobile" && vf.mode !== "either" && !emp) { invalid.push({ raw, why: "This game is for employees: the employee ID is missing." }); continue; }
    if ((vf.mode === "id" || (vf.mode === "either" && !phoneTyped)) && emp) { // known by ID alone: a mobile number is welcome but not needed
      let digits = "";
      if (phoneTyped) { const cl = cleanPhone(x?.phone); if (!cl.ok) { invalid.push({ raw, why: cl.why }); continue; } digits = keptFromClean(cl.digits); }
      const ph = await empHashOf(c.env, emp);
      if (seen.has(ph)) { duplicates++; continue; }
      seen.add(ph); todo.push({ name: cleanName(x?.name), digits, ph, empId: emp }); continue;
    }
    const cl = cleanPhone(x?.phone);
    if (!cl.ok) { invalid.push({ raw, why: cl.why }); continue; }
    const ph = await phoneHashOf(c.env, cl.digits);
    if (seen.has(ph)) { duplicates++; continue; }
    const idHash = vf.mode === "either" && emp ? await empHashOf(c.env, emp) : undefined; // "mobile number or employee ID": a listed person with both can come in with either, so the ID points to the mobile-number identity
    if (idHash) { // the same employee ID on two people of one list would let the second take over the first's ID: the second is a duplicate
      const al = await c.env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`idx/${c.eid}/${idHash}`).first<{ v: string }>();
      if ((al && al.v !== ph && (await c.env.DB.prepare("SELECT 1 AS x FROM person WHERE eid=? AND ph=? AND status<>'removed'").bind(c.eid, al.v).first())) || seen.has("I" + idHash)) { duplicates++; continue; }
      seen.add("I" + idHash);
    }
    seen.add(ph); todo.push({ name: cleanName(x?.name), digits: keptFromClean(cl.digits), ph, ...(emp && vf.mode !== "mobile" ? { empId: emp } : {}), ...(idHash ? { idHash } : {}) });
  }
  const db = c.env.DB, hashes = todo.map((t) => t.ph);
  const persons = await existingBy(db, "person", c.eid, hashes, "ph, status, id, inviter, removed_by");
  const seats = await existingBy(db, "seat", c.eid, hashes, "ph, blocked");
  const waits = await existingBy(db, "waiting", c.eid, hashes, "ph, id, status");
  const fresh: typeof todo = [], revive: typeof todo = [];
  for (const t of todo) {
    const p = persons.get(t.ph);
    if (p) { if (p.status === "removed" && (who.all || (p.inviter === who.id && p.removed_by === who.id))) revive.push(t); /* an Organizer or Host puts anyone back; a Co-host or guest only takes back a person they removed themselves */ else if (p.status === "removed") invalid.push({ raw: `${t.name} ${t.digits ? "+" + phoneDigits(t.digits) : ""}`.trim(), why: "This person was removed. Ask the Organizer or a Host to put them back." }); else duplicates++; continue; }
    if (seats.has(t.ph)) { duplicates++; continue; } // a seat from an older flow (a loaded list): already in the game
    fresh.push(t);
  }
  const adds = fresh.length + revive.length;
  if (adds === 0) return c.json({ added: 0, duplicates, invalid, people: [] });
  if (who.limit !== null) {
    const used = await listCount(db, c.eid, who.id), room = Math.max(0, who.limit - used);
    if (adds > room) return c.json({ error: room === 0 ? `Your list is full: ${who.limit} people. Remove someone first, or ask the Organizer.` : `You can add ${room} more ${room === 1 ? "person" : "people"} (your limit is ${who.limit}). Nothing was added; please send fewer.`, code: "over-limit", limit: who.limit, used, room }, 409);
  }
  const total = await totalCount(db, c.eid);
  if (total + adds > c.e.cap) return c.json({ error: `This game is for ${c.e.cap} people and ${total} are already on the lists. Nothing was added.`, code: "over-cap", cap: c.e.cap, total }, 409);
  if (!(await c.spend(adds))) return c.busy();

  const stmts: ReturnType<D1["prepare"]>[] = [], toks = new Map<string, string>(), ids = new Map<string, string>();
  for (const t of fresh) {
    const token = newToken(), id = randHex(6); toks.set(t.ph, token); ids.set(t.ph, id);
    stmts.push(db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,approved_by,approved_ms,added_ms) SELECT ?,?,?,?,?,NULL,'invited',?,?,NULL,NULL,? WHERE (? IS NULL OR (SELECT COUNT(*) FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL) < ?) AND (SELECT COUNT(*) FROM person WHERE eid=? AND status<>'removed') < ?")
      .bind(c.eid, id, t.ph, await sealPii(c.env, { phone: t.digits, name: t.name || null, empId: t.empId }), who.id, await tokenHash(token), await sealText(c.env, token), c.now, who.limit, c.eid, who.id, who.limit ?? 0, c.eid, c.e.cap));
  }
  for (const t of revive) { // an Organizer / Host puts a removed person back
    const token = newToken(); toks.set(t.ph, token); ids.set(t.ph, persons.get(t.ph).id);
    const hasSeat = seats.has(t.ph);
    stmts.push(db.prepare("UPDATE person SET status=?, inviter=?, pii=?, tok_hash=?, tok_sealed=?, approved_by=?, approved_ms=?, removed_ms=NULL, removed_by=NULL WHERE eid=? AND ph=? AND status='removed'")
      .bind(hasSeat ? "joined" : "invited", who.id, await sealPii(c.env, { phone: t.digits, name: t.name || null, empId: t.empId }), await tokenHash(token), await sealText(c.env, token), who.id, c.now, c.eid, t.ph));
    if (hasSeat) stmts.push(db.prepare("UPDATE seat SET blocked=NULL WHERE eid=? AND ph=?").bind(c.eid, t.ph));
  }
  // someone who was waiting and is now put on a list is admitted by whoever listed them
  const waitingNow = todo.filter((t) => waits.has(t.ph) && waits.get(t.ph).status !== "admitted");
  for (const t of waitingNow) stmts.push(db.prepare("UPDATE waiting SET status='admitted', decided_by=?, decided_ms=? WHERE eid=? AND ph=?").bind(who.id, c.now, c.eid, t.ph));
  const res = await batched(db, stmts);
  for (const t of todo) if (t.idHash) await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`idx/${c.eid}/${t.idHash}`, t.ph).run();
  await recordConsent(db, { subject: who.kind === "organizer" ? (c.e.org ?? "platform") : `${c.e.org ?? "-"}/${who.id}`, kind: "K6", ref: c.eid, now: c.now });
  if (c.started && revive.length) await refreshBlocked(db, c.eid);
  // stmts are in the order fresh..., revive (+seat update)..., waiting...: map the person inserts back by position
  let i = 0; const done: typeof todo = [];
  for (const t of fresh) { if ((res[i++]?.meta?.changes ?? 0) > 0) done.push(t); else duplicates++; }
  for (const t of revive) { if ((res[i++]?.meta?.changes ?? 0) > 0) done.push(t); else duplicates++; if (seats.has(t.ph)) i++; }
  const label = await labelsOf(c);
  const out: PersonView[] = [];
  for (const t of done) {
    const token = toks.get(t.ph)!, link = `${c.origin}/j/${token}`;
    out.push({ id: ids.get(t.ph)!, name: t.name, maskedPhone: t.digits ? maskedPhone(t.digits) : "", status: "invited", ...(t.empId ? { empId: t.empId } : {}), link, waLink: t.digits ? waLinkOf(t.digits, waMessage(t.name || null, c.gameName, link)) : null, ...(who.all ? { inviter: label(who.id) } : {}) });
  }
  return c.json({ added: done.length, duplicates, invalid, people: out });
}

async function exportPeople(c: Ctx, who: Caller): Promise<Response> {
  if (!who.all) return c.json({ error: "Only the Organizer and Hosts can download a list." }, 403);
  const whole = c.url.searchParams.get("all") === "1";
  const rows = await (whole
    ? c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? ORDER BY added_ms, id`).bind(c.eid)
    : c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND inviter=? ORDER BY added_ms, id`).bind(c.eid, who.id)).all<PersonRow>();
  const label = await labelsOf(c);
  const withId = verifyOf(c.e).mode !== "mobile"; // the Employee ID column only when the organizer asked for IDs
  const lines = [["Name", "Mobile", ...(withId ? ["Employee ID"] : []), "Personal link", "WhatsApp link", "Status", ...(whole ? ["Invited by"] : [])].join(",")];
  for (const r of rows.results ?? []) {
    const v = await viewOf(c, r, label, true), pii = await openPii(c.env, r.pii);
    lines.push([v.name, pii?.phone ?? "", ...(withId ? [pii?.empId ?? ""] : []), v.link ?? "", v.waLink ?? "", r.status === "invited" ? "Invited" : r.status === "joined" ? "Joined" : "Removed", ...(whole ? [v.inviter ?? ""] : [])].map(csvCell).join(","));
  }
  return new Response("﻿" + lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="people-${c.eid.replace(/[^A-Za-z0-9_-]/g, "_")}.csv"` } });
}

async function personFor(c: Ctx, who: Caller, id: string): Promise<{ row: PersonRow } | { res: Response }> {
  if (!/^[0-9a-f]{12}$/.test(id)) return { res: c.json({ error: "No such person." }, 404) };
  const row = await c.env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND id=?`).bind(c.eid, id).first<PersonRow>();
  if (!row || (!who.all && row.inviter !== who.id)) return { res: c.json({ error: "No such person on your list." }, 404) };
  return { row };
}

async function removePerson(c: Ctx, who: Caller, id: string, b: any): Promise<Response> {
  const got = await personFor(c, who, id);
  if ("res" in got) return got.res;
  const row = got.row, db = c.env.DB;
  if (c.started && !who.all) return c.json({ error: "Once the game has started only the Organizer or a Host can remove people." }, 403);
  if (row.role) return c.json({ error: "That is a team member's own seat. Retire the team member instead." }, 409);
  if (row.status === "removed") return c.json({ ok: true, removed: 0 });
  // this person, and (when asked) everyone they invited, and everyone those people invited
  const targets: PersonRow[] = [row];
  if (b?.withTheirPeople === true) {
    let frontier = [row];
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next: PersonRow[] = [];
      for (const p of frontier) {
        const seat = await db.prepare("SELECT seq FROM seat WHERE eid=? AND ph=?").bind(c.eid, p.ph).first<{ seq: number }>();
        if (!seat) continue;
        const kids = (await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL`).bind(c.eid, "s:" + seat.seq).all<PersonRow>()).results ?? [];
        for (const k of kids) if (!targets.some((t) => t.id === k.id)) { targets.push(k); next.push(k); }
      }
      frontier = next;
    }
  }
  if (!(await c.spend(targets.length * 3))) return c.busy();
  const stmts: ReturnType<D1["prepare"]>[] = [];
  for (const t of targets) {
    stmts.push(db.prepare("UPDATE person SET status='removed', removed_ms=?, removed_by=?, tok_hash=NULL, tok_sealed=NULL WHERE eid=? AND id=? AND status<>'removed'").bind(c.now, who.id, c.eid, t.id));
    if (c.started) stmts.push(db.prepare("UPDATE seat SET blocked=1 WHERE eid=? AND ph=?").bind(c.eid, t.ph)); // the seat stays in the public list: winners must be identical on every phone
    else stmts.push(db.prepare("DELETE FROM claim WHERE eid=? AND pid IN (SELECT pid FROM seat WHERE eid=? AND ph=?)").bind(c.eid, c.eid, t.ph), db.prepare("DELETE FROM participant WHERE eid=? AND phone_hash=?").bind(c.eid, t.ph), db.prepare("DELETE FROM seat WHERE eid=? AND ph=?").bind(c.eid, t.ph));
  }
  await batched(db, stmts);
  if (c.started) await refreshBlocked(db, c.eid);
  if (who.kind === "host") { // a Host's removal tells the Organizer (the people are not named: the Organizer sees them in the console)
    try { const to = await c.orgEmail(); if (to) await c.sendMail(to, `A Host removed ${targets.length === 1 ? "someone" : targets.length + " people"} from ${c.gameName}`, `${(await labelsOf(c))(who.id)} removed ${targets.length === 1 ? "one person" : targets.length + " people"} from ${c.gameName} at ${c.istTime(c.now)}.\n\nYou can see who in your console, under My people.`); } catch { /* a mail is a nudge, never a requirement */ }
  }
  return c.json({ ok: true, removed: targets.length, during: c.started });
}

async function resendPerson(c: Ctx, who: Caller, id: string, b: any): Promise<Response> {
  const got = await personFor(c, who, id);
  if ("res" in got) return got.res;
  const row = got.row, db = c.env.DB;
  if (row.status === "removed") return c.json({ error: "That person was removed. Add them again first." }, 409);
  if (c.started && !who.all) return c.json({ error: "Once the game has started only the Organizer or a Host can send a link again." }, 403);
  let pii = await openPii(c.env, row.pii), ph = row.ph, newPii: string | null = null;
  const hasSeat = !!(await db.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND ph=?").bind(c.eid, row.ph).first());
  if (b?.phone !== undefined && b.phone !== null && String(b.phone).trim() !== "") { // a new number: only for someone who has not joined yet
    const cl = cleanPhone(b.phone);
    if (!cl.ok) return c.json({ error: cl.why }, 400);
    const idKeyed = !!pii?.empId && (await empHashOf(c.env, pii.empId)) === row.ph; // a person known by employee ID stays known by it: a new number is only a new contact number
    ph = idKeyed ? row.ph : await phoneHashOf(c.env, cl.digits);
    if (idKeyed) { newPii = await sealPii(c.env, { phone: keptFromClean(cl.digits), name: pii?.name ?? null, empId: pii!.empId }); pii = { phone: keptFromClean(cl.digits), name: pii?.name ?? null, empId: pii!.empId }; }
    else if (ph !== row.ph) {
      if (hasSeat) return c.json({ error: "They have already joined with their first number. Their card can move to a new phone, but not to a new number." }, 409);
      if ((await db.prepare("SELECT 1 AS x FROM person WHERE eid=? AND ph=?").bind(c.eid, ph).first()) || (await db.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND ph=?").bind(c.eid, ph).first())) return c.json({ error: "That number is already invited.", code: "duplicate" }, 409);
      newPii = await sealPii(c.env, { phone: keptFromClean(cl.digits), name: pii?.name ?? null, ...(pii?.empId ? { empId: pii.empId } : {}) }); pii = { phone: keptFromClean(cl.digits), name: pii?.name ?? null, ...(pii?.empId ? { empId: pii.empId } : {}) };
    }
  }
  if (!(await c.spend(2))) return c.busy();
  const token = newToken();
  const res = await batched(db, [
    db.prepare("UPDATE person SET tok_hash=?, tok_sealed=?, ph=COALESCE(?, ph), pii=COALESCE(?, pii) WHERE eid=? AND id=? AND status<>'removed'").bind(await tokenHash(token), await sealText(c.env, token), newPii ? ph : null, newPii, c.eid, row.id),
    db.prepare("UPDATE seat SET dev=NULL WHERE eid=? AND ph=?").bind(c.eid, row.ph), // the first phone to open the new link keeps the card
  ]);
  if ((res[0]?.meta?.changes ?? 0) === 0) return c.json({ error: "That number is already invited.", code: "duplicate" }, 409);
  if (newPii && pii?.empId && verifyOf(c.e).mode === "either") await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`idx/${c.eid}/${await empHashOf(c.env, pii.empId)}`, ph).run(); // the employee ID keeps pointing at this person's current number
  const link = `${c.origin}/j/${token}`;
  return c.json({ ok: true, link, waLink: pii?.phone ? waLinkOf(pii.phone, waMessage(pii.name || null, c.gameName, link)) : null, unlocked: hasSeat });
}

/** The caller's OWN play seat: Organizer, Host and Co-host also play, through a personal link, and their seat is flagged so they stay out of the lucky draws. */
async function myOwnSeat(c: Ctx, who: Caller, b: any): Promise<Response> {
  if (who.kind === "guest") return c.json({ error: "Your card link is the one you were sent." }, 403);
  const db = c.env.DB;
  const role = who.kind === "organizer" ? "organizer" : who.kind === "host" ? "host" : "co-host";
  let name: string | null = null, digits: string | null = null;
  if (who.kind === "host" || who.kind === "cohost") {
    const k = await db.prepare("SELECT pii, label, created_by FROM organizer_key WHERE org=? AND substr(hash,1,7)=? AND kind=? AND revoked=0").bind(c.e.org, c.keyId7, who.kind).first<{ pii: string | null; label: string | null; created_by: string | null }>();
    const p = await openPii(c.env, k?.pii); name = p?.name ?? k?.label ?? null; digits = p?.phone ? (cleanPhone(p.phone).ok ? (cleanPhone(p.phone) as { digits: string }).digits : null) : null;
  } else {
    try { const ct = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${c.eid}`).first<{ v: string }>(); const ph = ct ? String(JSON.parse(ct.v).phone ?? "") : ""; const cl = cleanPhone(ph); digits = cl.ok ? cl.digits : null; } catch { /* none yet */ }
    name = "Organizer";
  }
  if (b?.phone !== undefined && b.phone !== null && String(b.phone).trim() !== "") { const cl = cleanPhone(b.phone); if (!cl.ok) return c.json({ error: cl.why }, 400); digits = cl.digits; }
  if (b?.name !== undefined) name = cleanName(b.name) || name;
  if (!digits) return c.json({ error: "We need your mobile number to make your play link.", code: "need-phone" }, 400);
  const ph = await phoneHashOf(c.env, digits);
  const label = await labelsOf(c);
  let row = await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND ph=?`).bind(c.eid, ph).first<PersonRow>();
  if (row && row.status === "removed") return c.json({ error: "That number was removed from this game. Add it back from My people first." }, 409);
  if (!row) {
    if (!(await c.spend(2))) return c.busy();
    const token = newToken(), up = who.kind === "organizer" ? "o" : (await db.prepare("SELECT created_by FROM organizer_key WHERE org=? AND substr(hash,1,7)=? AND revoked=0").bind(c.e.org, c.keyId7).first<{ created_by: string | null }>())?.created_by ?? "o";
    await db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,added_ms) VALUES(?,?,?,?,?,?, 'invited', ?,?,?)")
      .bind(c.eid, randHex(6), ph, await sealPii(c.env, { phone: digits, name }), up, role, await tokenHash(token), await sealText(c.env, token), c.now).run();
    row = await db.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND ph=?`).bind(c.eid, ph).first<PersonRow>();
  } else if (!row.role) { // the number was already on a list: it becomes the team member's own seat
    if (!(await c.spend(1))) return c.busy();
    await db.prepare("UPDATE person SET role=? WHERE eid=? AND id=?").bind(role, c.eid, row.id).run();
    if (!c.started) await db.prepare("UPDATE seat SET role=? WHERE eid=? AND ph=?").bind(role, c.eid, ph).run();
    row = { ...row, role };
  }
  const seat = await db.prepare("SELECT pid FROM seat WHERE eid=? AND ph=?").bind(c.eid, ph).first<{ pid: string }>();
  return c.json({ person: await viewOf(c, row!, label, false), role, joined: !!seat, ...(seat ? { pid: seat.pid } : {}) });
}

// ------------------------------------------------------------------------------------------------------------------------------- the waiting room
async function waitingRows(c: Ctx, who: Caller, limit: number): Promise<{ id: string; pii: string; via: string; inviter: string; overlimit: number; at_ms: number }[]> {
  const cols = "id, pii, via, inviter, overlimit, at_ms";
  const q = who.all
    ? c.env.DB.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' ORDER BY at_ms LIMIT ?`).bind(c.eid, limit)
    : c.env.DB.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' AND chain LIKE ? ORDER BY at_ms LIMIT ?`).bind(c.eid, `%,${who.id},%`, limit);
  return (await q.all<any>()).results ?? [];
}
async function listWaiting(c: Ctx, who: Caller): Promise<Response> {
  const label = await labelsOf(c), out = [];
  for (const r of await waitingRows(c, who, 200)) {
    const p = await openPii(c.env, r.pii), first = (p?.name ?? "").trim().split(/\s+/)[0] ?? "";
    out.push({ id: r.id, firstName: first, last4: (p?.phone ?? "").slice(-4), via: r.via, at: r.at_ms, ...(who.all ? { inviter: label(r.inviter), overLimit: !!r.overlimit, ...(p?.empId ? { empId: p.empId } : {}) } : {}) }); // the Employee ID is shown to the Organizer and the Hosts only (they decide whether this person is an employee)
  }
  return c.json({ waiting: out });
}
/** Puts an admitted person on a list, but only while the waiting request is still "waiting" (so a decline that won the race leaves nobody inside). */
const admitInsert = (db: D1, eid: string, wid: string, id: string, ph: string, pii: string, inviter: string, tokHash: string, tokSealed: string, by: string, now: number) =>
  db.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,tok_hash,tok_sealed,approved_by,approved_ms,added_ms) SELECT ?,?,?,?,?,NULL,'invited',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')")
    .bind(eid, id, ph, pii, inviter, tokHash, tokSealed, by, now, now, eid, wid);
const admitRevive = (db: D1, eid: string, wid: string, pid: string, inviter: string, tokHash: string, tokSealed: string, by: string, now: number) =>
  db.prepare("UPDATE person SET status='invited', inviter=?, tok_hash=?, tok_sealed=?, approved_by=?, approved_ms=?, removed_ms=NULL, removed_by=NULL WHERE eid=? AND id=? AND EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')")
    .bind(inviter, tokHash, tokSealed, by, now, eid, pid, eid, wid);
async function decideWaiting(c: Ctx, who: Caller, wid: string, b: any): Promise<Response> {
  if (!/^[0-9a-f]{12}$/.test(wid)) return c.json({ error: "No such request." }, 404);
  const decision = b?.decision;
  if (decision !== "admit" && decision !== "decline") return c.json({ error: "Say admit or decline." }, 400);
  const db = c.env.DB;
  const w = await db.prepare("SELECT id, ph, pii, inviter, chain, overlimit, status FROM waiting WHERE eid=? AND id=?").bind(c.eid, wid).first<any>();
  if (!w || (!who.all && !String(w.chain).includes(`,${who.id},`))) return c.json({ error: "No such request." }, 404);
  if (w.status !== "waiting") return c.json({ ok: true, already: w.status });
  if (c.now >= await c.endBound()) return c.json({ error: "The game has ended, so this request has lapsed." }, 409);
  if (!(await c.spend(3))) return c.busy();
  if (decision === "decline") { await db.prepare("UPDATE waiting SET status='declined', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, wid).run(); return c.json({ ok: true, declined: true }); }
  // admit: the person goes on the list of whoever's link they used; when that list is full (or they came over the limit) they go on the approver's own list, which has no limit
  let inviter: string = w.overlimit ? who.id : w.inviter;
  const lim = await limitOfInviter({ env: c.env, eid: c.eid, e: c.e, invites: c.invites }, inviter);
  if (lim !== null && (await listCount(db, c.eid, inviter)) >= lim) { if (!who.all) return c.json({ error: `Your list is full (${lim} people). Remove someone first.`, code: "over-limit" }, 409); inviter = who.id; }
  if ((await totalCount(db, c.eid)) >= c.e.cap && !(await db.prepare("SELECT 1 AS x FROM person WHERE eid=? AND ph=? AND status<>'removed'").bind(c.eid, w.ph).first())) return c.json({ error: `This game is for ${c.e.cap} people and all places are taken.`, code: "over-cap" }, 409);
  const token = newToken();
  const existing = await db.prepare("SELECT id, status FROM person WHERE eid=? AND ph=?").bind(c.eid, w.ph).first<{ id: string; status: string }>();
  // The person goes in only while this request is still "waiting" (checked inside the same batch, before the request is marked admitted), so a decline that lands at the same instant can never leave a declined request with the person inside.
  const stmts: ReturnType<D1["prepare"]>[] = [];
  if (!existing) stmts.push(admitInsert(db, c.eid, wid, randHex(6), w.ph, w.pii, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now));
  else if (existing.status === "removed") stmts.push(admitRevive(db, c.eid, wid, existing.id, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now), db.prepare("UPDATE seat SET blocked=NULL WHERE eid=? AND ph=? AND EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')").bind(c.eid, w.ph, c.eid, wid));
  stmts.push(db.prepare("UPDATE waiting SET status='admitted', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, wid));
  const res = await batched(db, stmts);
  if ((res[res.length - 1]?.meta?.changes ?? 0) === 0) return c.json({ ok: true, already: (await db.prepare("SELECT status FROM waiting WHERE eid=? AND id=?").bind(c.eid, wid).first<{ status: string }>())?.status ?? "decided" }); // someone decided this request an instant earlier: nothing was added
  const label = await labelsOf(c);
  return c.json({ ok: true, admitted: true, placedUnder: label(inviter) });
}

/** "Approve all" / "Decline all": every request this caller may decide (Organizer and Host: all; Co-host and guest: only their own link), in the order they asked. Each admitted person records who approved and when; admitting stops when the game is full and the rest stay waiting. */
async function decideAll(c: Ctx, who: Caller, b: any): Promise<Response> {
  const decision = b?.decision;
  if (decision !== "admit" && decision !== "decline") return c.json({ error: "Say admit or decline." }, 400);
  const db = c.env.DB;
  if (c.now >= await c.endBound()) return c.json({ error: "The game has ended, so these requests have lapsed." }, 409);
  const cols = "id, ph, pii, inviter, overlimit";
  const rows = await (who.all
    ? db.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' ORDER BY at_ms, id LIMIT ?`).bind(c.eid, WAITING_MAX)
    : db.prepare(`SELECT ${cols} FROM waiting WHERE eid=? AND status='waiting' AND chain LIKE ? ORDER BY at_ms, id LIMIT ?`).bind(c.eid, `%,${who.id},%`, WAITING_MAX)).all<any>();
  const list = rows.results ?? [];
  if (!list.length) return c.json({ admitted: 0, declined: 0, stillWaiting: 0 });
  if (!(await c.spend(list.length * 3))) return c.busy();
  const stmts: ReturnType<D1["prepare"]>[] = [];
  if (decision === "decline") {
    for (const w of list) stmts.push(db.prepare("UPDATE waiting SET status='declined', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, w.id));
    await batched(db, stmts);
    return c.json({ admitted: 0, declined: list.length, stillWaiting: 0 });
  }
  let total = await totalCount(db, c.eid), admitted = 0, notAdmitted = 0, skippedFull = false;
  const counts = new Map<string, number>(), limits = new Map<string, number | null>();
  for (const w of list) {
    let inviter: string = w.overlimit ? who.id : w.inviter;
    const existing = await db.prepare("SELECT id, status FROM person WHERE eid=? AND ph=?").bind(c.eid, w.ph).first<{ id: string; status: string }>();
    if (!existing || existing.status === "removed") {
      if (total >= c.e.cap) { skippedFull = true; notAdmitted++; continue; }
      if (!limits.has(inviter)) { limits.set(inviter, await limitOfInviter({ env: c.env, eid: c.eid, e: c.e, invites: c.invites }, inviter)); counts.set(inviter, await listCount(db, c.eid, inviter)); }
      const lim = limits.get(inviter)!;
      if (lim !== null && counts.get(inviter)! >= lim) { if (!who.all) { notAdmitted++; continue; } inviter = who.id; if (!counts.has(inviter)) { limits.set(inviter, null); counts.set(inviter, 0); } }
      counts.set(inviter, (counts.get(inviter) ?? 0) + 1); total++;
      const token = newToken();
      if (!existing) stmts.push(admitInsert(db, c.eid, w.id, randHex(6), w.ph, w.pii, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now));
      else stmts.push(admitRevive(db, c.eid, w.id, existing.id, inviter, await tokenHash(token), await sealText(c.env, token), who.id, c.now), db.prepare("UPDATE seat SET blocked=NULL WHERE eid=? AND ph=? AND EXISTS (SELECT 1 FROM waiting WHERE eid=? AND id=? AND status='waiting')").bind(c.eid, w.ph, c.eid, w.id));
    }
    stmts.push(db.prepare("UPDATE waiting SET status='admitted', decided_by=?, decided_ms=? WHERE eid=? AND id=? AND status='waiting'").bind(who.id, c.now, c.eid, w.id));
    admitted++;
  }
  await batched(db, stmts);
  return c.json({ admitted, declined: 0, stillWaiting: notAdmitted, ...(skippedFull ? { message: `The game is full (${c.e.cap} places). The rest are still waiting.` } : notAdmitted ? { message: "Some lists are full, so those requests are still waiting." } : {}) });
}

// ------------------------------------------------------------------------------------------------------------------------------- the phone's own status (public)
/** GET /api/z/{id}/me?pid=<card id> or ?wid=<waiting id>: a phone asks whether it is still in, or whether its request has been answered. No names, no numbers. */
async function meRoute(c: Ctx): Promise<Response> {
  const db = c.env.DB, pid = c.url.searchParams.get("pid"), wid = c.url.searchParams.get("wid");
  if (pid) {
    const s = await db.prepare("SELECT seq, role, inv, blocked FROM seat WHERE eid=? AND pid=?").bind(c.eid, pid).first<{ seq: number; role: string | null; inv: number | null; blocked: number | null }>();
    if (!s) return c.json({ error: "Not a participant of this game." }, 404);
    const p = await db.prepare("SELECT inviter, approved_by FROM person pe JOIN seat se ON se.eid=pe.eid AND se.ph=pe.ph WHERE se.eid=? AND se.pid=?").bind(c.eid, pid).first<{ inviter: string; approved_by: string | null }>().catch(() => null);
    const ownList = s.inv === null && !s.role;
    return c.json({ state: s.blocked ? "removed" : "playing", removed: !!s.blocked, role: s.role ?? null, seat: s.seq, canInvite: !s.blocked && ownList && c.invites.on, per: c.invites.per, used: ownList ? await listCount(db, c.eid, "s:" + s.seq) : 0, whoCanJoin: c.e.closed ? "list" : "anyone", ...(p ? { listed: true } : {}) });
  }
  if (wid && /^[0-9a-f]{12}$/.test(wid)) {
    const w = await db.prepare("SELECT status, inviter, overlimit FROM waiting WHERE eid=? AND id=?").bind(c.eid, wid).first<{ status: string; inviter: string; overlimit: number }>();
    if (!w) return c.json({ state: "gone", error: "That request is not here any more." }, 404);
    const ended = c.now >= await c.endBound();
    const state = w.status === "waiting" && ended ? "lapsed" : w.status;
    const who = await waitingWho(c, w.overlimit ? "o" : w.inviter);
    return c.json({ state, with: who, message: state === "waiting" ? `Your request is with ${who}. You can come in as soon as they say yes.` : state === "admitted" ? "You are in. Open your game link again to join." : state === "declined" ? "This game could not add you. Please talk to whoever invited you." : "This game has ended." });
  }
  return c.json({ error: "Say which: ?pid=<your card id> or ?wid=<your request id>." }, 400);
}
/** Who a waiting guest is told their request is with: the Organizer, a Host or Co-host by the name the Organizer gave them, or "the person who invited you". */
export async function waitingWho(c: { env: Env; e: any; eid: string }, inviter: string): Promise<string> {
  if (inviter === "o") return "the organizer";
  if (inviter.startsWith("s:")) return "the person who invited you";
  const r = await c.env.DB.prepare("SELECT label FROM organizer_key WHERE org=? AND substr(hash,1,7)=? AND kind=?").bind(c.e.org, inviter.slice(2), inviter.startsWith("h:") ? "host" : "cohost").first<{ label: string | null }>();
  return r?.label ? r.label : inviter.startsWith("h:") ? "the host" : "the co-host";
}

/** Joins a person's request to wait. Used by the Worker's `join`. Returns the existing request when the number already asked. */
export async function addWaiting(c: { env: Env; eid: string; e: any; now: number }, o: { ph: string; digits: string; name: string | null; empId?: string | null; via: "personal-link" | "common-link" | "direct"; inviter: string; overlimit: boolean }): Promise<{ id: string; status: string } | { full: true }> {
  const db = c.env.DB;
  const have = await db.prepare("SELECT id, status FROM waiting WHERE eid=? AND ph=?").bind(c.eid, o.ph).first<{ id: string; status: string }>();
  if (have) return have;
  const n = (await db.prepare("SELECT COUNT(*) AS c FROM waiting WHERE eid=? AND status='waiting'").bind(c.eid).first<{ c: number }>())?.c ?? 0;
  if (n >= WAITING_MAX) return { full: true };
  const id = randHex(6), chain = o.overlimit ? ",o," : await chainOf(db, c.eid, o.inviter);
  await db.prepare("INSERT OR IGNORE INTO waiting(eid,id,ph,pii,via,inviter,chain,overlimit,status,at_ms) VALUES(?,?,?,?,?,?,?,?,'waiting',?)")
    .bind(c.eid, id, o.ph, await sealPii(c.env as any, { phone: o.digits, name: o.name, empId: o.empId }), o.via, o.inviter, chain, o.overlimit ? 1 : 0, c.now).run();
  return (await db.prepare("SELECT id, status FROM waiting WHERE eid=? AND ph=?").bind(c.eid, o.ph).first<{ id: string; status: string }>()) ?? { id, status: "waiting" };
}

/** The person row behind a personal link, or null. */
export async function personByToken(env: Env, eid: string, token: string): Promise<(PersonRow & { name: string | null }) | null> {
  if (!/^[a-z0-9]{6,20}$/i.test(token)) return null;
  const r = await env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND tok_hash=?`).bind(eid, await tokenHash(token)).first<PersonRow>();
  return r ? { ...r, name: null } : null;
}
export async function personByPhone(env: Env, eid: string, ph: string): Promise<PersonRow | null> {
  return (await env.DB.prepare(`SELECT ${PERSON_COLS} FROM person WHERE eid=? AND ph=?`).bind(eid, ph).first<PersonRow>()) ?? null;
}
export type { PersonRow };

/** `GET /j/<token>`: the short personal link. It answers a page that sends the browser on to the game with the token, and carries Open Graph tags so WhatsApp shows "You are invited to <game>". */
export async function joinLinkPage(env: Env, token: string, origin: string, gameNameOf: (e: any) => string): Promise<Response> {
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" };
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const gone = () => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not valid</title></head><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>This link is not valid any more</h1><p>Please ask the person who invited you to send it again.</p></body></html>`, { status: 404, headers });
  if (!/^[a-z0-9]{6,20}$/i.test(token)) return gone();
  const row = await env.DB.prepare("SELECT eid, pii, status FROM person WHERE tok_hash=?").bind(await tokenHash(token)).first<{ eid: string; pii: string; status: string }>();
  if (!row || row.status === "removed") return gone();
  const e = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(row.eid).first<any>();
  if (!e || e.cancelled_ms || e.unplayed_ms) return gone();
  const pii = await openPii(env, row.pii), first = (pii?.name ?? "").trim().split(/\s+/)[0] ?? "", game = gameNameOf(e);
  const target = `${origin}/z.html?e=${encodeURIComponent(row.eid)}&t=${encodeURIComponent(token.toLowerCase())}`;
  const title = `You are invited to ${game}`, desc = `${first ? first + ", tap" : "Tap"} to open your game. Corporate Tic Tac Toe needs no app and no sign-up.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(target)}"><title>${esc(title)}</title>`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="Corporate Tic Tac Toe"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(origin + "/j/" + token.toLowerCase())}">`
    + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"></head><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>${esc(title)}</h1><p><a href="${esc(target)}">Open your game</a></p></body></html>`;
  return new Response(html, { headers });
}
