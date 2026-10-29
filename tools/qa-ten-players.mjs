// The free 10-person game, end to end, through the real endpoints (QA 2026-10-29). Ten simulated phones (the same TttPhone code the browser runs) join a Rs 0 game by name,
// the 11th is refused, the Organizer presses Start, the phones play the whole tournament, the report is e-mailed after 3 minutes, and 20 hours later every name is gone.
// Run:   bun tools/qa-ten-players.mjs [seed=1] [away=0]       (away = how many of the ten never open the page)
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => import(join(ROOT, p));
const { handle } = await src("apps/edge/test/with-terms.ts");
const { makeD1 } = await src("apps/edge/test/d1-sqlite.ts");
const { playCrowd, apiFor, clockOf } = await src("tools/sim2/phones.ts");
const { TttPhone } = await src("packages/ttt/src/phone.ts");
const { lifecycleTick } = await src("apps/edge/src/lifecycle.ts");
const { sentReports, FREE_GAME_CAP } = await src("apps/edge/src/pay.ts");

const SEED = Number(process.argv[2] ?? 1), AWAY = Number(process.argv[3] ?? 0);
const T0 = Date.UTC(2026, 9, 29, 10, 0, 0), GEN = 1692803367, START = Math.floor((T0 / 1000 - GEN) / 3) + 1 + 1200;
let s = SEED >>> 0; const rng = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
const d = makeD1(), raw = d.raw;
const env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt", DATA_KEY: "k" };
const call = (method, path, body, headers = {}, now = T0) => handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r) => r.json().catch(() => ({}));
const dev = (i) => i.toString(16).padStart(4, "0").repeat(8);
const rows = []; const step = (name, ok, detail = "") => { rows.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  | " + detail : "")); };

const org = await j(await call("POST", "/api/start", { email: "organizer@acme.com" }, { "cf-connecting-ip": "10.0.0.1" })); const h = { "x-organizer": org.token };
step("Organizer signs in (e-mail only)", !!org.token);
const c = await call("POST", "/api/z", { id: "TEN-FREE", startRound: START, callSeconds: 6, cap: 10 }, h); step("creates a game for 10 people", c.status === 200, "HTTP " + c.status);
const p = await call("POST", "/api/z/TEN-FREE/publish", { email: "organizer@acme.com", phone: "98765 43210" }, h); const pb = await j(p);
step("publishes with no payment (Rs 0)", p.status === 200 && pb.published === true && pb.paid === true, `published=${pb.published} paid=${pb.paid}`);
const e = raw.query("SELECT pack, cap FROM engagement WHERE id='TEN-FREE'").get(); step("the free cap is 10 and it used no bought pack", FREE_GAME_CAP === 10 && e.cap === 10, JSON.stringify(e));
const phones = [];
for (let i = 1; i <= 10; i++) { const r = await call("POST", "/api/z/TEN-FREE/join", { name: `Player ${i}`, device: dev(i) }, { "cf-connecting-ip": `10.1.0.${i}` }); const b = await j(r); if (r.status === 200) phones.push({ pid: b.pid, device: dev(i), name: `Player ${i}` }); }
step("ten players join by name", phones.length === 10, `${phones.length} in`);
const eleventh = await call("POST", "/api/z/TEN-FREE/join", { name: "Player 11", device: dev(11) }, { "cf-connecting-ip": "10.1.0.11" });
step("the eleventh is told the game is full", eleventh.status === 409 && /full/i.test((await j(eleventh)).error), "HTTP " + eleventh.status);
const again = await call("POST", "/api/z/TEN-FREE/join", { name: "Player 4", device: dev(4) }, { "cf-connecting-ip": "10.1.0.4" }); step("the same phone joining again gets the same place", again.status === 200 && (await j(again)).pid === phones[3].pid);
const wrongPhone = await call("POST", "/api/z/TEN-FREE/ttt/move", { pid: phones[0].pid, device: dev(99), mid: "r1m0", seq: 0, sq: 4 }); step("a move from another phone with a player's code is refused", wrongPhone.status === 409 || wrongPhone.status === 403, "HTTP " + wrongPhone.status);
const early = await call("POST", "/api/z/TEN-FREE/ttt/start", {}, {}); step("a stranger cannot start the tournament", early.status === 403);
const st = await call("POST", "/api/z/TEN-FREE/ttt/start", { moveSecs: 20 }, h); const sb = await j(st); step("the Organizer starts it: 10 players in the draw", st.status === 200 && sb.players === 10, JSON.stringify(sb).slice(0, 120));
const late = await call("POST", "/api/z/TEN-FREE/join", { name: "Latecomer", device: dev(12) }, { "cf-connecting-ip": "10.1.0.12" }); step("a latecomer is not let into the draw (can watch)", late.status === 409 && (await j(late)).code === "closed");
const away = new Set(phones.slice(0, AWAY).map((x) => x.pid)); const clock = clockOf(T0);
const r = await playCrowd({ call, eid: "TEN-FREE", phones, orgHeaders: h, clock, rng, away, isDone: () => raw.query("SELECT state FROM ttt_t WHERE eid='TEN-FREE'").get()?.state === "done", maxSteps: 30000 });
const t = raw.query("SELECT state, champion, rounds, entrants, ranking FROM ttt_t WHERE eid='TEN-FREE'").get();
step("the tournament finishes by itself", t.state === "done" && !!t.champion, `${t.rounds} rounds, ${r.moves} squares tapped, ${r.claims} clock-out claims, ${Math.round((clock.t - T0) / 60000)} virtual minutes`);
const real = raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid='TEN-FREE' AND bye=0 AND status='done'").get().c; step("9 matches were played (10 players, 6 free passes)", real === 9, `${real} matches`);
const rank = JSON.parse(t.ranking); step("the ranking has 10 places, no ties", rank.length === 10 && rank.every((x, i) => x.rank === i + 1), rank.slice(0, 3).map((x) => x.name).join(" > "));
const flagged = raw.query("SELECT COUNT(*) c FROM ttt_b WHERE eid='TEN-FREE' AND flag=1").get().c; step("nothing is flagged for the Organizer", flagged === 0);
// what each phone shows at the end
const finals = {}; for (const x of phones) { if (away.has(x.pid)) continue; clock.t += 1500; const ph = new TttPhone({ api: apiFor(call, clock), eid: "TEN-FREE", pid: x.pid, device: x.device, now: () => clock.t }); const v = await ph.tick(); finals[v.phase] = (finals[v.phase] ?? 0) + 1; }
step("one champion screen, the others 'you are out' with their place", finals.champion === 1 && finals.out === 10 - AWAY - 1, JSON.stringify(finals));
const winners = raw.query("SELECT COUNT(*) c FROM winner WHERE eid='TEN-FREE'").get().c; step("the winners record holds the top 5 (seat numbers only)", winners === 5, `${winners} rows`);
// the report after 3 minutes, and the deletion after 20 hours
const end = raw.query("SELECT end_ms FROM life WHERE eid='TEN-FREE'").get().end_ms; sentReports.length = 0;
await lifecycleTick(env, end + 60_000); const early1 = sentReports.length; for (let i = 0; i < 6; i++) await lifecycleTick(env, end + 4 * 60_000 + i * 1000);
step("the report e-mail goes out about 3 minutes after the end, not before", early1 === 0 && sentReports.length >= 1, `after 1 min: ${early1}, after 4 min: ${sentReports.length}; subject: ${sentReports[0]?.subject ?? "-"}`);
step("the report e-mail does not use the word private and names the game", !!sentReports[0] && !/\bprivate\b/i.test(sentReports[0].text + sentReports[0].subject) && /Corporate Tic Tac Toe/.test(sentReports[0].subject));
await lifecycleTick(env, end + 21 * 3_600_000);
const left = raw.query("SELECT COUNT(*) c FROM participant WHERE eid='TEN-FREE'").get().c, names = raw.query("SELECT COUNT(*) c FROM ttt_p WHERE eid='TEN-FREE'").get().c;
step("20 hours after the end no player name or detail is left", left === 0 && names === 0, `participants ${left}, draw names ${names}`);
const kept = raw.query("SELECT COUNT(*) c FROM winner WHERE eid='TEN-FREE'").get().c; step("the winners record (seat numbers) stays for 365 days", kept === 5);
const bad = rows.filter((x) => !x.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} steps passed${AWAY ? ` (${AWAY} of the ten never opened the page)` : ""}.`); process.exit(bad.length ? 1 : 0);
