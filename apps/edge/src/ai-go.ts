// The guided path for an AI assistant: every screen is one short, ready-made link; the AI shows the words, offers the choices, opens the link the organizer picks.
// Nothing is typed into an address by the AI (some chatbots refuse addresses they build themselves, and Claude limits addresses to 250 characters), and nothing is saved
// until the organizer says yes at the read-back (so the 10 free drafts are never wasted). State travels in the link itself (short keys), so there is nothing to store.
//
//   z time zone (in | et | ct | mt | pt | uk | utc)  d day (YYYY-MM-DD, in that zone)  t time (HHMM)  o occasion  c people limit  j join (o open | c invite-only)  v invitations per guest (0 = off)
//   p prize bundle (c classic | s simple | r rich)  id game code  m message number
//
// The renderer is pure except for `ctx.api`, which calls our own API as the organizer's AI key (so every rule and every audit row is the same as a direct call).

import { PACKS, price } from "../../../packages/shared/src/pricing";
import { roundAt, roundTimeMs } from "../../../packages/beacon/src/index";
import { DEFAULT_TZ, zoneLocalToUtc, zoneParts } from "./tz";

export interface Choice { n: number; label: string; url: string; recommended?: boolean }
export interface Screen { say: string; choices: Choice[]; ifWrong?: string; done?: boolean }
export interface GoCtx { base: string; origin: string; now: number; api: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> }

/** The time zones the guided path offers (a game's own zone is kept with it). */
export const ZONES: Record<string, { tz: string; label: string }> = {
  in: { tz: "Asia/Kolkata", label: "India time" }, et: { tz: "America/New_York", label: "US Eastern time" }, ct: { tz: "America/Chicago", label: "US Central time" },
  mt: { tz: "America/Denver", label: "US Mountain time" }, pt: { tz: "America/Los_Angeles", label: "US Pacific time" }, uk: { tz: "Europe/London", label: "UK time" }, utc: { tz: "UTC", label: "UTC" },
};
const zoneKey = (q: URLSearchParams) => (q.get("z") && ZONES[q.get("z")!] ? q.get("z")! : "");
const zoneOf = (q: URLSearchParams) => (zoneKey(q) ? ZONES[zoneKey(q)]!.tz : DEFAULT_TZ);
const zoneLabel = (q: URLSearchParams) => (zoneKey(q) ? ZONES[zoneKey(q)]!.label : ZONES.in!.label);
export const OCCASIONS: Record<string, { label: string; code: string }> = {
  team: { label: "Team event", code: "TEAM-EVENT" }, holiday: { label: "Holiday party", code: "HOLIDAY-PARTY" }, allhands: { label: "All-hands opener", code: "ALL-HANDS" },
  newhire: { label: "New-hire welcome", code: "NEW-HIRE" }, customer: { label: "Customer event", code: "CUSTOMER-EVENT" }, friday: { label: "Friday team break", code: "TEAM-BREAK" },
  family: { label: "Family day", code: "FAMILY-DAY" }, diwali: { label: "Diwali party", code: "DIWALI" }, other: { label: "Corporate event", code: "EVENT" },
};
const SLOTS = ["0900", "1000", "1200", "1300", "1500", "1600", "1800", "1900"];
export const PRESET_MESSAGES = ["Welcome! The game starts soon. Please keep this page open.", "The game starts in about 10 minutes. Please keep this page open.", "Thank you for joining. Good luck, everyone!", "A short break is coming. Please stay on this page."];
const BUNDLES: Record<string, { label: string; houses: string[] }> = {
  c: { label: "Classic: 1st, 2nd and 3rd place", houses: ["first", "second", "third"] },
  s: { label: "Simple: champion only", houses: ["first"] },
  r: { label: "Rich: 1st to 5th place", houses: ["first", "second", "third", "fourth", "fifth"] },
};

const pad = (n: number) => String(n).padStart(2, "0");
const istParts = (ms: number, tz: string = DEFAULT_TZ) => zoneParts(ms, tz);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); return `${DAYS[wd]} ${d} ${MONTHS[m! - 1]}`; };
const timeLabel = (t: string) => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}${t.slice(2) === "00" ? "" : ":" + t.slice(2)} ${h < 12 ? "am" : "pm"}`; };
/** The start moment for a day (YYYY-MM-DD) and time (HHMM), both in the given time zone (India time when none is given). */
export const startMsOf = (d: string, t: string, tz: string = DEFAULT_TZ): number => { const [y, m, dd] = d.split("-").map(Number); return zoneLocalToUtc(y!, m!, dd!, Number(t.slice(0, 2)), Number(t.slice(2)), tz); };
export const startRoundOf = (ms: number): number => roundAt(ms);
const validDay = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d), validTime = (t: string | null) => !!t && SLOTS.includes(t);
const money = (n: number, inIndia = true) => inIndia ? `Rs ${price(n, "INR").total.toLocaleString("en-IN")} (about US$ ${price(n, "USD").total})` : `US$ ${price(n, "USD").total} (or Rs ${price(n, "INR").total.toLocaleString("en-IN")})`;
const packFor = (cap: number) => PACKS.find((p) => p[0] >= cap)?.[0] ?? null;

/** The params a step carries forward, in a stable short order. */
const KEYS = ["id", "z", "d", "t", "o", "c", "k", "s", "r", "j", "v", "p", "x", "m"];
export function link(ctx: GoCtx, step: string, q: URLSearchParams, set: Record<string, string> = {}): string {
  const out = new URLSearchParams();
  for (const k of KEYS) { const v = k in set ? set[k] : q.get(k); if (v !== null && v !== undefined && v !== "") out.set(k, v); }
  const s = out.toString();
  return `${ctx.base}/go/${step}${s ? "?" + s : ""}`;
}
const choices = (rows: [string, string, boolean?][]): Choice[] => rows.map(([label, url, rec], i) => ({ n: i + 1, label, url, ...(rec ? { recommended: true } : {}) }));
const WRONG = "If a link does not open or the answer is an error, tell the organizer plainly and offer the console (their own page) instead. Do not make up addresses.";

const dayRows = (ctx: GoCtx, q: URLSearchParams, next: string): [string, string, boolean?][] => {
  const rows: [string, string, boolean?][] = [];
  const now = istParts(ctx.now), tz = zoneOf(q);
  for (let i = 0; i < 8; i++) {
    const ms = ctx.now + i * 86_400_000, p = istParts(ms, tz), iso = `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
    if (i === 0 && !SLOTS.some((t) => startMsOf(iso, t, tz) >= ctx.now + 2 * 3_600_000)) continue; // nothing left today that is at least 2 hours ahead
    rows.push([(i === 0 ? "Today, " : i === 1 ? "Tomorrow, " : "") + dayLabel(iso), link(ctx, next, q, { d: iso })]);
  }
  void now; return rows;
};
const timeRows = (ctx: GoCtx, q: URLSearchParams, next: string): [string, string, boolean?][] => {
  const d = q.get("d")!;
  const tz = zoneOf(q);
  return SLOTS.filter((t) => startMsOf(d, t, tz) >= ctx.now + 2 * 3_600_000).map((t) => [timeLabel(t) + " (" + zoneLabel(q) + ")", link(ctx, next, q, { t }), t === "1600"] as [string, string, boolean?]);
};
const summaryLines = (q: URLSearchParams): string[] => {
  const d = q.get("d")!, t = q.get("t")!, o = OCCASIONS[q.get("o") || "other"] ?? OCCASIONS.other!, c = Number(q.get("c"));
  const v = Number(q.get("v")) || 0, j = q.get("j") === "c", p = BUNDLES[q.get("p") || "c"] ?? BUNDLES.c!;
  const pk = packFor(c);
  return [`Game: ${o!.label}`, `Day and time: ${dayLabel(d)}, ${timeLabel(t)} ${zoneLabel(q)} (players can join before; you press Start on the day)`, `People: up to ${c}${pk ? ` (${money(pk)})` : ""}`,
    "A knockout tournament: one against one, or in teams (you choose the format and the move clock on the day)", j ? "Invite-only: only people on your list can join" : "Anyone with the link can join",
    v ? `Each guest may invite up to ${v} more people` : "Guests may not invite others", `Prizes: ${p.label}`, "Nothing is charged until you pay, before the start time."];
};
const consoleOf = (ctx: GoCtx, id: string, act = "") => `${ctx.origin}/zc.html?e=${encodeURIComponent(id)}${act ? "&do=" + act : ""}`;

export async function goScreen(ctx: GoCtx, step: string, q: URLSearchParams): Promise<Screen> {
  const L = (s: string, set: Record<string, string> = {}) => link(ctx, s, q, set);
  switch (step) {
    case "": case "start": return { say: "Hello! I can set up or manage your Corporate Tic Tac Toe game with you. What would you like to do?", choices: choices([["Start a new game", `${ctx.base}/go/new`, true], ["Change a game that has not started yet", `${ctx.base}/go/games`], ["Show the links of a game", `${ctx.base}/go/games?then=links`], ["Tell me about the software (is it safe, protected, legal?)", `${ctx.base}/facts`], ["Try a free demo first", `${ctx.origin}/demo.html`]]), ifWrong: WRONG };
    case "new":
      if (!zoneKey(q)) return { say: "Which time zone are you in? (The start time is set in it.)", choices: choices(Object.entries(ZONES).map(([k, z]) => [z.label, L("new", { z: k })] as [string, string, boolean?])), ifWrong: WRONG };
      return { say: `Which day is the game? (${zoneLabel(q)})`, choices: choices(dayRows(ctx, q, "time")), ifWrong: WRONG };
    case "time": if (!validDay(q.get("d"))) return goScreen(ctx, "new", q);
      return { say: `${dayLabel(q.get("d")!)}. At what time should it start? (Players can join before; you press Start on the tournament page when everybody is in.)`, choices: choices(timeRows(ctx, q, "occ")), ifWrong: WRONG };
    case "occ": if (!validDay(q.get("d")) || !validTime(q.get("t"))) return goScreen(ctx, "new", q);
      return { say: "What is the occasion?", choices: choices(Object.entries(OCCASIONS).map(([k, v]) => [v.label, L("size", { o: k })] as [string, string])), ifWrong: WRONG };
    case "size": return { say: "How many people at most? Choose a little above your headcount (people invited by your guests count too). The price follows the size and is paid only when you are ready, before the start.", choices: choices(PACKS.map(([n]) => [`Up to ${n} people: ${money(n, zoneKey(q) === "in" || !zoneKey(q))}`, L("play", { c: String(n) }), n === 250] as [string, string, boolean?])), ifWrong: WRONG };
    case "play": {
      const j = q.get("j") === "c", v = Number(q.get("v")) || 0;
      const lines = `Here is how it will play: a knockout tournament, one against one or in teams (you choose the format and the move clock on the day). ${j ? "Invite-only." : "Open to anyone with the link."} ${v ? `Guests may invite up to ${v} more people each.` : "Guests may not invite others."}`;
      return { say: `${lines} These are the recommended choices. Change anything, or continue.`, choices: choices([["Looks good, continue", L("prizes"), true], [j ? "Open to anyone with the link" : "Invite-only (only people on my list)", L("play", { j: j ? "o" : "c" })], [v ? "Guests may not invite others" : "Let each guest invite up to 4 more (family, colleagues)", L("play", { v: v ? "0" : "4" })]]), ifWrong: WRONG };
    }
    case "prizes": return { say: "Which prizes do you want to run? (You give the prizes; we only provide the software. You name each prize afterwards.)", choices: choices(Object.entries(BUNDLES).map(([k, b]) => [b.label, L("review", { p: k }), k === "c"] as [string, string, boolean?])), ifWrong: WRONG };
    case "extras": return goScreen(ctx, "review", q); // an old link from the days of the lucky draw step
    case "review": {
      if (!validDay(q.get("d")) || !validTime(q.get("t")) || !q.get("c")) return goScreen(ctx, "new", q);
      return { say: ["Please read this back to the organizer and ask for a clear yes:", ...summaryLines(q).map((l) => "- " + l), "", "Nothing has been saved yet."].join("\n"), choices: choices([["Yes, save my draft", L("save"), true], ["Change the day or time", L("new", { d: "", t: "" })], ["Change the size", L("size")], ["Change how it plays", L("play")], ["Change the prizes", L("prizes")]]), ifWrong: WRONG };
    }
    case "save": {
      if (!validDay(q.get("d")) || !validTime(q.get("t")) || !q.get("c")) return goScreen(ctx, "new", q);
      const tz = zoneOf(q), startMs = startMsOf(q.get("d")!, q.get("t")!, tz);
      if (startMs <= ctx.now) return { say: "That start time has already passed. Please choose a new day and time.", choices: choices([["Choose a new day and time", `${ctx.base}/go/new`]]) };
      const o = OCCASIONS[q.get("o") || "other"] ?? OCCASIONS.other!, p = BUNDLES[q.get("p") || "c"] ?? BUNDLES.c!;
      const seen: Record<string, number> = {}; const rewards = p.houses.map((h) => { seen[h] = (seen[h] ?? 0) + 1; return { pattern: h, ordinal: seen[h], text: "" }; });
      const base = `${o.code}-${pad(istParts(startMs, tz).mo)}${pad(istParts(startMs, tz).d)}`; let id = base, made: any = null;
      for (let i = 1; i <= 9; i++) {
        id = i === 1 ? base : `${base}-${i}`;
        const body: any = { id, name: `${o.label}, ${dayLabel(q.get("d")!)}`, startRound: startRoundOf(startMs), tz, callSeconds: 9, cap: Number(q.get("c")), rewards, closed: q.get("j") === "c" };
        const r = await ctx.api("POST", "z", body);
        if (r.status !== 200) return { say: `I could not save it: ${r.json?.error ?? "something went wrong"}. ${r.json?.next ?? ""}`.trim(), choices: choices([["Open the organizer's console", `${ctx.origin}/zc.html`]]), ifWrong: WRONG };
        if (!r.json.existed) { made = r.json; break; }
      }
      if (!made) return { say: "I could not find a free game code. Please open the console.", choices: choices([["Open the organizer's console", `${ctx.origin}/zc.html`]]) };
      const v = Number(q.get("v")) || 0;
      if (v) await ctx.api("PATCH", `z/${id}/settings`, { invites: { on: true, per: v, cats: ["family", "colleagues"] } });
      return { done: true, say: [`Your draft is saved. Its code is ${id}. Nobody else can see it yet.`, "What is left, and who does it:", "1. Name the prizes (you, or tell me what each prize is and I will add them).", "2. Add your company name, colour and logo if you want (I can help).", "3. You press Publish (free) on the page below: one tap.", `4. You pay before the start time (${dayLabel(q.get("d")!)}, ${timeLabel(q.get("t")!)} ${zoneLabel(q)}). I never pay.`, "5. You share the guest link, which arrives by e-mail after publishing."].join("\n"),
        choices: choices([["Open the draft in the console (watch it)", made.openUrl ?? consoleOf(ctx, id), true], ["Publish: the organizer taps once", consoleOf(ctx, id, "publish")], ["Read the game back", `${ctx.base}/go/game?id=${id}`], ["See the links", `${ctx.base}/go/links?id=${id}`]]), ifWrong: WRONG };
    }
    case "games": {
      const r = await ctx.api("GET", "history");
      if (r.status !== 200) return { say: "I could not read your games. Please open the console.", choices: choices([["Open the organizer's console", `${ctx.origin}/zc.html`]]) };
      const next = q.get("then") === "links" ? "links" : "game";
      const open = (r.json.engagements as any[]).filter((e) => roundTimeMs(e.start_round) > ctx.now);
      if (!open.length) return { say: "You have no game that has not started yet. Do you want to start a new one?", choices: choices([["Start a new game", `${ctx.base}/go/new`, true]]) };
      return { say: "Which game? (Only games that have not started are shown.)", choices: choices(open.slice(0, 12).map((e) => [`${e.id}: ${e.startsAtIST}${e.draft ? " (draft)" : ""}, ${e.participants} joined`, `${ctx.base}/go/${next}?id=${encodeURIComponent(e.id)}`] as [string, string])), ifWrong: WRONG };
    }
    case "game": case "links": case "who": case "gtime": case "gtime2": case "gtime3": case "say": case "say2": case "helper": return gameStep(ctx, step, q);
    case "facts": return { say: "Open the facts address; it lists the 10 facts.", choices: choices([["The 10 facts", `${ctx.base}/facts`]]) };
    default: return { say: "That step does not exist. Start again.", choices: choices([["Start", `${ctx.base}/go`]]) };
  }
}

async function gameStep(ctx: GoCtx, step: string, q: URLSearchParams): Promise<Screen> {
  const id = q.get("id") || "";
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return goScreen(ctx, "games", q);
  const sm = await ctx.api("GET", `z/${id}/summary`);
  if (sm.status !== 200) return { say: `I could not read the game ${id}: ${sm.json?.error ?? "not found"}.`, choices: choices([["Choose another game", `${ctx.base}/go/games`]]) };
  const s = sm.json, draft = /draft/.test(s.status), unpaid = /payment due|NOT PAID/.test(s.status), published = !draft;
  const links = (): string[] => [`Console: ${s.consoleUrl}`, ...(s.shareUrl ? [`Guest link (send to guests): ${s.shareUrl}`, `Big screen: ${s.shareUrl.replace("/z.html", "/big.html")}`] : ["Guest link and big-screen link appear after you publish."]), ...(s.payUrl ? [`Pay (organizer only): ${s.payUrl}, before ${s.payBefore}`] : []), `Test a video or audio link: ${ctx.origin}/preview.html (the organizer can open this; I can build a ready address for a link)`];
  if (step === "links") return { say: ["Links for " + id + ":", ...links().map((l) => "- " + l)].join("\n"), choices: choices([["Back to this game", `${ctx.base}/go/game?id=${id}`]]) };
  if (step === "who") { const p = await ctx.api("GET", `z/${id}/participants?limit=1`); return { say: `${p.json?.total ?? 0} ${(p.json?.total ?? 0) === 1 ? "person has" : "people have"} joined ${id}${s.limit ? " out of a limit of " + s.limit : ""}. I only see seat numbers, never names or mobile numbers.`, choices: choices([["Back to this game", `${ctx.base}/go/game?id=${id}`]]) }; }
  if (step === "gtime") return { say: `Change the day of ${id} (now ${s.startsAtIST}). Which day?`, choices: choices(dayRows(ctx, new URLSearchParams([...q.entries(), ["z", Object.entries(ZONES).find(([, z]) => z.tz === s.tz)?.[0] ?? ""]]), "gtime2")), ifWrong: WRONG };
  if (step === "gtime2") { if (!validDay(q.get("d"))) return goScreen(ctx, "gtime", q); return { say: `${dayLabel(q.get("d")!)}. At what time?`, choices: choices(timeRows(ctx, q, "gtime3")), ifWrong: WRONG }; }
  if (step === "gtime3") {
    if (!validDay(q.get("d")) || !validTime(q.get("t"))) return goScreen(ctx, "gtime", q);
    const gz = typeof s.tz === "string" ? s.tz : DEFAULT_TZ, ms = startMsOf(q.get("d")!, q.get("t")!, gz); const r = await ctx.api("PATCH", `z/${id}/settings`, { startRound: startRoundOf(ms) });
    return r.status === 200 ? { done: true, say: `Done. ${id} now starts on ${dayLabel(q.get("d")!)} at ${timeLabel(q.get("t")!)} (${typeof s.tz === "string" ? s.tz.replace(/_/g, " ") : "India time"}).`, choices: choices([["Back to this game", `${ctx.base}/go/game?id=${id}`]]) } : { say: `I could not change it: ${r.json?.error ?? "error"}. ${r.json?.next ?? ""}`.trim(), choices: choices([["Back to this game", `${ctx.base}/go/game?id=${id}`]]) };
  }
  if (step === "say") { if (!published) return { say: "Messages can be sent only after you publish: nobody can see a draft.", choices: choices([["Publish: the organizer taps once", consoleOf(ctx, id, "publish")], ["Back", `${ctx.base}/go/game?id=${id}`]]) }; return { say: "Which message should go to every guest's phone (it is spoken and shown, and goes to the big screen)?", choices: choices(PRESET_MESSAGES.map((m, i) => [m, link(ctx, "say2", q, { id, m: String(i + 1) })] as [string, string])) }; }
  if (step === "say2") { const i = Number(q.get("m")) - 1, text = PRESET_MESSAGES[i]; if (!text) return goScreen(ctx, "say", q); const r = await ctx.api("POST", `z/${id}/announce`, { text }); return { done: r.status === 200, say: r.status === 200 ? `Sent to every guest: "${text}"` : `I could not send it: ${r.json?.error ?? "error"}. ${r.json?.next ?? ""}`.trim(), choices: choices([["Back to this game", `${ctx.base}/go/game?id=${id}`]]) }; }
  if (step === "helper") {
    return { done: true, say: `A Host needs a name and a mobile number or an e-mail address (or both), and only the owner enters those, in the console (Your team). Ask the organizer to add the Host there; I cannot. A Host looks after the game with them but cannot change the account or add another Host.`, choices: choices([["Back to this game", `${ctx.base}/go/game?id=${id}`]]) };
  }
  // the game menu
  const rows: [string, string, boolean?][] = [["Change the day or time", `${ctx.base}/go/gtime?id=${id}`], ["Show the links", `${ctx.base}/go/links?id=${id}`], ["How many have joined", `${ctx.base}/go/who?id=${id}`], ["Create a Host link", `${ctx.base}/go/helper?id=${id}`]];
  if (published) rows.splice(2, 0, ["Send a message to every guest", `${ctx.base}/go/say?id=${id}`]);
  if (draft) rows.unshift(["Publish (free): the organizer taps once", consoleOf(ctx, id, "publish"), true]);
  rows.push(["Erase all guest data now: the organizer confirms", consoleOf(ctx, id, "erase")], ["Pause or stop: the organizer taps once", consoleOf(ctx, id, "pause")]);
  return { say: [`Game ${id}: ${s.status}. Starts ${s.startsAtIST}. Up to ${s.limit} people, ${s.participants} joined.`, ...(unpaid && s.payBefore ? [`Payment is due before ${s.payBefore} (the organizer pays; I never do).`] : []), "What would you like to do?"].join("\n"), choices: choices(rows), ifWrong: WRONG };
}

export function screenText(s: Screen): string {
  const L = ["SAY TO THE ORGANIZER:", s.say, ""];
  if (s.choices.length) { L.push("CHOICES (offer these; open ONLY the link of the one the organizer picks; never build a link yourself):"); for (const c of s.choices) L.push(`${c.n}. ${c.label}${c.recommended ? "  (recommended)" : ""}`, `   LINK: ${c.url}`); }
  if (s.ifWrong) L.push("", "IF SOMETHING GOES WRONG: " + s.ifWrong);
  return L.join("\n");
}
export const screenJson = (s: Screen) => ({ say: s.say, choices: s.choices, ...(s.ifWrong ? { if_something_goes_wrong: s.ifWrong } : {}), ...(s.done ? { done: true } : {}) });
