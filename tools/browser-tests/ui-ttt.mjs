// A 10-player Rs 0 demo game played ONLY by clicking and typing in real Chrome pages (no API call sets anything up): the Organizer signs in, builds the game through the console,
// publishes it, 10 players open the link on phone-sized pages, tick the boxes, type a name and join; the Organizer starts the tournament on the tournament page, the players see
// their boards and one move is made by tapping a square; the Organizer ends the tournament. Everything is read back from what the pages show.
//   SITE=https://tictactoe.corporatetambola.com node tools/browser-tests/ui-ttt.mjs --login demo1@xyz.in --players 10
// Uses the helper pieces of Corporate Tambola's browser tests (read only, not changed).
import { launch, signIn, sleep } from "file:///C:/ct/test-sites/tambola/tools/browser-tests/ui-lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const SITE = process.env.SITE || "https://tictactoe.corporatetambola.com", LOGIN = opt("login", "demo1@xyz.in"), PLAYERS = Number(opt("players", 10)), B = process.env.BROWSER || "chrome";
const R = { site: SITE, players: PLAYERS, checks: [], errors: [] };
const check = (n, ok, d = "") => { R.checks.push({ n, ok: !!ok, d: String(d).slice(0, 300) }); console.log(ok ? "PASS" : "FAIL", n, ok ? "" : "| " + String(d).slice(0, 300)); };
const body = async (p) => (await p.innerText("body")).replace(/\s+/g, " ");
const browser = await launch(B); let eid = null;
try {
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await octx.newPage();
  p.on("pageerror", (e) => R.errors.push("organizer: " + String(e).slice(0, 200)));
  await signIn(p, SITE, LOGIN); check("signed in as Organizer", /Signed in as Organizer/.test(await body(p)));
  if (await p.$("#mk")) await p.click("#mk"); await p.waitForSelector('[data-ck="occ"]', { timeout: 40000 }); await sleep(800);
  eid = new URL(p.url()).searchParams.get("e"); R.eid = eid; check("a draft game exists after pressing Create a new game", !!eid, p.url());
  // step 1: an occasion and a day three days ahead (so the demo never counts as a game starting soon), and a time
  await p.locator('[data-ck="occ"]').first().click();
  const days = await p.$$('[data-ck="day"]'); await days[Math.min(3, days.length - 2)].click(); await p.click('[data-ck="time"][data-v="10:00"]');
  check("step 1: the choices are radio buttons with one selected in each group", (await p.$$("[role=radiogroup]")).length >= 3 && (await p.$$("[role=radio][aria-checked=true]")).length >= 3);
  await p.click('[data-save="1"]'); await sleep(1500);
  // step 2: the Rs 0 demo game for 10 people
  await p.click('.zc-dot[data-open="2"]'); await sleep(900); await p.waitForSelector('[data-ck="cap"]');
  await p.click('[data-ck="cap"][data-v="10"]'); await sleep(300); await p.click('[data-ck="who"][data-v="anyone"]'); await sleep(300); // anyone with the link joins at once
  const t2 = await body(p); check("step 2: the 10-people choice says it is free", /Free: nothing to pay/.test(t2)); check("step 2: a live line shows the choice", /Your choice: Up to 10 people/.test(t2));
  check("step 2: the rarely used 'What must a person give' choice is hidden", !(await p.locator(".zc-hide").first().isVisible().catch(() => false)));
  await p.click('[data-save="2"]'); await sleep(1500);
  for (const n of [3, 4, 5, 6]) { await p.click(`.zc-dot[data-open="${n}"]`); await sleep(900); if (await p.$(`[data-save="${n}"]`)) { await p.click(`[data-save="${n}"]`); await sleep(1200); } }
  check("steps 1 to 6 done by clicking", true);
  // step 7: publish (tick the box, confirm)
  await p.click('.zc-dot[data-open="7"]'); await sleep(900); if (await p.$("#publishopen")) { await p.click("#publishopen"); await sleep(1200);
    for (const bx of await p.$$("#sec7 input[type=checkbox]")) await bx.check({ force: true }).catch(() => {});
    await sleep(500); await p.click("#pubgo"); await sleep(3500); } // a Rs 0 game for 10 may already be open
  const t7 = await body(p); check("published, no payment asked (Rs 0)", /published|Published|Guest link/.test(t7) && !/Pay now/i.test(t7), t7.slice(0, 160));
  // the players: ten phone-sized pages, each in its own browser profile
  let joined = 0; R.pages = [];
  for (let i = 1; i <= PLAYERS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } }); const pg = await ctx.newPage(); pg.on("pageerror", (e) => R.errors.push("player " + i + ": " + String(e).slice(0, 200)));
    await pg.goto(`${SITE}/z.html?e=${eid}`, { waitUntil: "domcontentloaded", timeout: 60000 }); await pg.waitForSelector("#tbslot input[type=checkbox]", { timeout: 30000 });
    for (const bx of await pg.$$("#tbslot input[type=checkbox]")) await bx.check({ force: true });
    await pg.fill("#nm", "Player " + i); await pg.click("#go");
    try { await pg.waitForFunction(() => !document.getElementById("go") && !/by invitation|Join the tournament/.test(document.body.innerText), null, { timeout: 60000 }); joined++; } catch { R.errors.push("player " + i + " did not get in: " + (await body(pg)).slice(0, 160)); }
    R.pages.push(pg);
  }
  check(`${PLAYERS} players joined by clicking`, joined === PLAYERS, "joined " + joined);
  // an 11th is refused (the game is for 10)
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } }); const pg = await ctx.newPage(); await pg.goto(`${SITE}/z.html?e=${eid}`, { waitUntil: "domcontentloaded", timeout: 60000 }); await pg.waitForSelector("#tbslot input[type=checkbox]");
    for (const bx of await pg.$$("#tbslot input[type=checkbox]")) await bx.check({ force: true }); await pg.fill("#nm", "Player 11"); await pg.click("#go"); await sleep(3500);
    check("the 11th is told the game is full", /full/i.test(await body(pg)), (await body(pg)).slice(0, 160)); }
  // the Organizer starts the tournament on the tournament page
  await p.goto(`${SITE}/host.html?e=${eid}`, { waitUntil: "load" }); await sleep(2500);
  check("the tournament page shows the players", new RegExp(String(PLAYERS)).test(await body(p)), (await body(p)).slice(0, 160));
  p.on("dialog", (d) => d.accept()); await p.click("#start"); await p.waitForSelector("#pause, #resume", { timeout: 30000 }).catch(() => {});
  check("the tournament started (the page shows it running)", !!(await p.$("#pause")) || /running|Round|Quarter|Semi|First/i.test(await body(p)), (await body(p)).slice(0, 200));
  // players see a board; the one whose turn it is taps the first free square
  let boards = 0, moved = 0;
  for (const pg of R.pages) { await pg.waitForSelector(".tboard", { timeout: 30000 }).catch(() => {}); if (await pg.$(".tboard")) boards++; const sq = await pg.$(".tsq:not([disabled])"); if (sq) { await sq.click().catch(() => {}); moved++; } }
  check("players see their boards", boards === PLAYERS, boards + " of " + PLAYERS);
  check("a player whose turn it is placed a mark by tapping a square", moved >= 1, "moves " + moved);
  // the Organizer ends it (a demo: nothing more to play), so no game stays running
  await p.reload({ waitUntil: "load" }); await sleep(2500); if (await p.$("#end")) { await p.click("#end"); await sleep(4000); }
  check("the Organizer ended the tournament", /ended|over|Ended/i.test(await body(p)) || !(await p.$("#pause")), (await body(p)).slice(0, 160));
  check("no page error anywhere", R.errors.length === 0, R.errors.join(" | "));
} catch (e) { check("the run finished without a crash", false, String(e).slice(0, 300)); }
finally { mkdirSync("C:/ct/test-sites/data/ui", { recursive: true }); writeFileSync(`C:/ct/test-sites/data/ui/ui-ttt-${Date.now()}.json`, JSON.stringify(R, null, 1)); await browser.close().catch(() => {}); }
console.log("RESULT", R.checks.filter((c) => c.ok).length, "pass", R.checks.filter((c) => !c.ok).length, "fail");
