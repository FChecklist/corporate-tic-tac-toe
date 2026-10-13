// Group 2: the ten console steps filled by tapping (Organizer): date and time, number of players, every place and prize kind, brand, the tournament page link, team, people, publish.
import { H, openConsole, openStep, chip, chipOn, saveStep, uiPublish, tinyPng, tickTerms, tickGuestList } from "./kit.mjs";

const eidOf = (page) => new URL(page.url()).searchParams.get("e");
/** from the empty console: tap 'Start a new game' and return the game id */
async function startGameUi(t, device = "laptop") {
  const org = await t.org("c");
  const x = await openConsole(t, org, null, { device });
  await x.page.click("#mk"); await x.page.waitForSelector(".zc-sech", { timeout: 15000 });
  await x.page.waitForFunction(() => /[?&]e=/.test(location.search), null, { timeout: 8000 });
  return { org, x, eid: eidOf(x.page) };
}
const rewardsOf = async (org, eid) => (await org.info(eid)).body.rewards ?? [];
/** tick or untick a prize house to the wanted state */
async function houseOn(page, id, on = true) {
  const cb = page.locator(`#sec3 [data-hc="${id}"]`);
  if ((await cb.isChecked()) !== on) await cb.click();
}
/** make one prize house: on, n winners, prize kind (+ text) */
async function setHouse(page, id, { n, pt = "voucher", pd } = {}) {
  await houseOn(page, id, true);
  if (!(await page.$(`#sec3 [data-ck="hs.${id}.pt"]`))) { const ch = await page.$(`#sec3 [data-ph="${id}"]`); if (ch) await ch.click(); }
  await page.waitForSelector(`#sec3 [data-ck="hs.${id}.pt"]`, { timeout: 4000 });
  const nChips = await page.$$(`#sec3 [data-ck="hs.${id}.n"]`);
  if (nChips.length && n) await page.click(`#sec3 [data-ck="hs.${id}.n"][data-v="${Math.min(n, nChips.length)}"]`);
  await page.click(`#sec3 [data-ck="hs.${id}.pt"][data-v="${pt}"]`);
  if (pd !== undefined && (await page.$(`#sec3 #f-hs-${id}-pd`))) await page.fill(`#sec3 #f-hs-${id}-pd`, pd);
  return nChips.length;
}
const PLACES = ["first", "second", "third", "fourth", "fifth"]; // the places a tournament names: Champion, Runner-up, 3rd, 4th, 5th (packages/beacon/src/config.ts PRIZE_HOUSES)

export default [
  {
    id: "S02-01", name: "Step 1 by tapping: occasion, a day and a time; the game is created and the start time is exactly what was tapped",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      t.check("a game id is in the address after 'Start a new game'", /^[A-Za-z0-9_-]{4,40}$/.test(eid ?? ""), eid);
      await openStep(x.page, 1);
      await chip(x.page, "occ", "Customer event");
      const days = await x.page.$$eval('[data-ck="day"]', (els) => els.map((e) => e.dataset.v).filter((v) => v !== "other"));
      const day = days[2]; await chip(x.page, "day", day); await chip(x.page, "time", "19:00");
      t.check("tapped chips show as selected", (await chipOn(x.page, "occ", "Customer event")) && (await chipOn(x.page, "day", day)) && (await chipOn(x.page, "time", "19:00")));
      await saveStep(x.page, 1);
      const info = (await org.info(eid)).body, want = Date.parse(`${day}T19:00:00+05:30`);
      t.check("game name is the occasion", info.name === "Customer event", String(info.name));
      t.check("start time is the tapped day at 7 pm India time (within one number step)", Math.abs(info.startMs - want) < 15000, `${new Date(info.startMs).toISOString()} vs ${new Date(want).toISOString()}`);
      t.check("the synopsis line for step 1 says 7:00 pm", /7:00 pm/.test(await t.text(x.page, '.zc-syn[data-open="1"]')), await t.text(x.page, '.zc-syn[data-open="1"]'));
      await t.shot(x.page, "step1-done");
    },
  },
  {
    id: "S02-02", name: "Step 1 other date and other time inputs, and a past date is refused kindly",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 1);
      await chip(x.page, "occ", "Other"); await x.page.waitForTimeout(300);
      const name = await x.page.$('[data-fi="oname"]'); if (name) await name.fill("Sim Gala");
      await chip(x.page, "day", "other"); await x.page.waitForTimeout(300);
      const dayIn = await x.page.$('[data-fi="dayo"]');
      t.check("'Pick another date' reveals a date input", !!dayIn);
      if (dayIn) {
        const d = new Date(Date.now() + 9 * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
        await dayIn.fill(d); await chip(x.page, "time", "other"); await x.page.waitForTimeout(300);
        const tIn = await x.page.$('[data-fi="timeo"]'); if (tIn) await tIn.fill("14:30");
        await saveStep(x.page, 1);
        const info = (await org.info(eid)).body;
        t.check("custom day and time were saved", Math.abs(info.startMs - Date.parse(`${d}T14:30:00+05:30`)) < 15000, new Date(info.startMs).toISOString());
        t.check("custom name saved", /Sim Gala/.test(info.name ?? ""), String(info.name));
        // a past day
        await openStep(x.page, 1); if (!(await x.page.$('[data-fi="dayo"]'))) { await chip(x.page, "day", "other"); await x.page.waitForTimeout(400); } const y = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
        await (await x.page.$('[data-fi="dayo"]')).fill(y); await x.page.click('#sec1 [data-save="1"]'); await x.page.waitForTimeout(900);
        t.check("a date in the past is refused with a message", /past|earlier|future|later|already/i.test(await t.text(x.page, "#sec1")), (await t.text(x.page, "#sec1")).slice(-200));
        const after = (await org.info(eid)).body;
        t.check("start time unchanged after the refusal", Math.abs(after.startMs - info.startMs) < 15000);
        // 40 days ahead is beyond the 30 day window
        const far = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
        await (await x.page.$('[data-fi="dayo"]')).fill(far); await x.page.click('#sec1 [data-save="1"]'); await x.page.waitForTimeout(900);
        t.check("40 days ahead is refused (30 day limit) with a message", /30 days|too far|ahead/i.test(await t.text(x.page, "#sec1")), (await t.text(x.page, "#sec1")).slice(-220));
        t.check("start time still unchanged", Math.abs((await org.info(eid)).body.startMs - info.startMs) < 15000);
      }
    },
  },
  {
    id: "S02-03", name: "Step 2 by tapping: 500 players then own number 321, anyone with the link; saved and still there after a reload; the step talks about players and a knockout, never about cards, numbers or rounds",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 2);
      const txt = await t.text(x.page, "#sec2");
      t.check("step 2 speaks of players and the knockout", /How many players/i.test(txt) && /knockout/i.test(txt) && /one champion/i.test(txt), txt.slice(0, 300));
      t.check("step 2 has no card, number, rounds, daub or invite controls (they belong to another game)", !/\bcards?\b|daub|between two numbers|How many rounds|squares light up|own people|invite a few/i.test(txt), txt.slice(0, 400));
      await chip(x.page, "cap", 500); t.check("cap chip 500 selected", await chipOn(x.page, "cap", 500));
      await x.page.fill("#f-cap", "321");
      await chip(x.page, "who", "anyone"); await x.page.waitForTimeout(150);
      t.check("the tapped chip shows as selected", await chipOn(x.page, "who", "anyone"));
      await saveStep(x.page, 2);
      t.check("cap 321 (typed number wins over chip)", (await org.info(eid)).body.cap === 321, String((await org.info(eid)).body.cap));
      t.check("who can join = anyone", (await org.summary(eid)).body.whoCanJoin === "anyone");
      await x.page.reload(); await x.page.waitForSelector(".zc-sech"); await openStep(x.page, 2);
      t.check("after a reload the choice is still selected", await chipOn(x.page, "who", "anyone"));
      t.check("the number of players is still 321", (await x.page.inputValue("#f-cap")) === "321");
      t.check("the step summary says 321 players", /321 players/.test(await t.text(x.page, '.zc-syn[data-open="2"]')), await t.text(x.page, '.zc-syn[data-open="2"]'));
      await t.shot(x.page, "step2-done");
    },
  },
  {
    id: "S02-04", name: "Step 2 players: a number that is not whole or below 1 is refused; the largest chip 10000 is accepted",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 2);
      await x.page.fill("#f-cap", "0"); await x.page.click('#sec2 [data-save="2"]'); await x.page.waitForTimeout(700);
      t.check("0 players is refused with a message", /number|at least|1/i.test(await t.text(x.page, "#sec2")) && (await org.info(eid)).body.cap !== 0);
      await x.page.fill("#f-cap", "12.5"); await x.page.click('#sec2 [data-save="2"]'); await x.page.waitForTimeout(700);
      t.check("12.5 players is refused or rounded, never stored as fraction", Number.isInteger((await org.info(eid)).body.cap));
      await chip(x.page, "cap", 10000); await saveStep(x.page, 2);
      t.check("10000 players saved", (await org.info(eid)).body.cap === 10000, String((await org.info(eid)).body.cap));
    },
  },
  {
    id: "S02-05", name: "Step 3: the start-from choices (Top 3 places, Champion only, Top 5 places, Choose myself) tick the right places and are saved",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 3);
      const ticked = async () => x.page.$$eval("#sec3 [data-hc]", (els) => els.filter((e) => e.checked).map((e) => e.dataset.hc));
      const names = await x.page.$$eval('#sec3 [data-ck="bundle"]', (els) => els.map((e) => e.textContent.trim()));
      t.check("the four start-from buttons are worded for places", JSON.stringify(names) === JSON.stringify(["Top 3 places", "Champion only", "Top 5 places", "Choose myself"]), JSON.stringify(names));
      const seen = {};
      for (const [b, label] of [["Classic", "top3"], ["Simple", "champ"], ["Rich", "top5"]]) { await chip(x.page, "bundle", b); await x.page.waitForTimeout(300); seen[label] = await ticked(); }
      t.check("Top 3 places ticks Champion, Runner-up and 3rd", seen.top3.join() === "first,second,third", seen.top3.join());
      t.check("Champion only ticks the champion", seen.champ.join() === "first", seen.champ.join());
      t.check("Top 5 places ticks all five", seen.top5.join() === PLACES.join(), seen.top5.join());
      await chip(x.page, "bundle", "Rich"); await saveStep(x.page, 3);
      const patterns = [...new Set((await rewardsOf(org, eid)).map((r) => r.pattern))];
      t.check("saved prizes are the five places", patterns.join() === PLACES.join(), patterns.join());
      await x.page.reload(); await x.page.waitForSelector(".zc-sech"); await openStep(x.page, 3);
      t.check("after a reload the five places are still ticked", (await ticked()).join() === PLACES.join(), (await ticked()).join());
      await t.shot(x.page, "step3-top5");
    },
  },
  {
    id: "S02-06", name: "Step 3: each place on its own (Champion, Runner-up, 3rd, 4th, 5th), one winner each, saved and read back",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 3);
      let bad = [];
      for (const id of PLACES) {
        for (const other of PLACES) if (other !== id) await houseOn(x.page, other, false).catch(() => {});
        await houseOn(x.page, id, true);
        await setHouse(x.page, id, { pt: "voucher" });
        t.check(`${id}: there is no 'how many winners' choice (a place has one winner)`, (await x.page.$$(`#sec3 [data-ck="hs.${id}.n"]`)).length === 0, "");
        await saveStep(x.page, 3); await openStep(x.page, 3);
        const rw = await rewardsOf(org, eid);
        const mine = rw.filter((r) => r.pattern === id), others = rw.filter((r) => r.pattern !== id);
        if (mine.length !== 1 || others.length) bad.push(`${id}: saved ${mine.length}, others ${others.length}`);
      }
      t.check("each of the 5 places saved alone with exactly one winner", bad.length === 0, bad.join(" | "));
    },
  },
  {
    id: "S02-07", name: "Step 3: every prize kind (10 popular + something else + decide later + no prize) for the champion",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 3);
      for (const other of PLACES) if (other !== "first") await houseOn(x.page, other, false).catch(() => {});
      await setHouse(x.page, "first", { pt: "voucher" });
      const kinds = await x.page.$$eval('#sec3 [data-ck="hs.first.pt"]', (els) => els.map((e) => e.dataset.v));
      t.check("13 prize options offered", kinds.length === 13, kinds.join());
      const out = {};
      for (const k of kinds) {
        await setHouse(x.page, "first", { pt: k, pd: k === "other" ? "Gold coin" : undefined });
        await saveStep(x.page, 3); await openStep(x.page, 3);
        const r = (await rewardsOf(org, eid)).find((q) => q.pattern === "first"); out[k] = r?.text ?? JSON.stringify(r);
      }
      t.check("every kind saved a prize text", Object.values(out).every((v) => v !== undefined && v !== "undefined"), JSON.stringify(out));
      t.check("'Something else' keeps the typed text", /Gold coin/.test(out.other ?? ""), out.other);
      t.check("'No prize' differs from 'decide later'", out.none !== out.later, `${out.none} / ${out.later}`);
      const txt = await t.text(x.page, "#sec3");
      t.check("the step says the prizes are the organizer's own", /You give the (prizes|gifts)/i.test(txt), txt.slice(-200));
    },
  },
  {
    id: "S02-08", name: "Step 4: company name, colour, a logo file; the preview page shows the brand strip; players' page and the big screen show it too",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 4);
      await x.page.fill("#f-brand-name", "Sim Industries"); await chip(x.page, "brand.color", "#1B7F5C");
      t.check("the logo rules are on the screen (formats, 5 MB, 64 x 64 minimum, shape)", /PNG, JPEG or WebP/.test(await t.text(x.page, "#brandbox")) && /5 MB/.test(await t.text(x.page, "#brandbox")) && /64 x 64/.test(await t.text(x.page, "#brandbox")) && /256 x 256/.test(await t.text(x.page, "#brandbox")));
      await x.page.setInputFiles("#brandlogo", tinyPng("logo-small.png", 32, 32)); await x.page.waitForTimeout(1200);
      t.check("a too small picture (32 x 32) is refused with a plain reason", /too small/i.test(await t.text(x.page, "#brandbox")), (await t.text(x.page, "#brandbox")).slice(0, 300));
      await x.page.setInputFiles("#brandlogo", tinyPng("logo-thin.png", 500, 100)); await x.page.waitForTimeout(1200);
      t.check("a too long and thin picture (500 x 100) is refused with a plain reason", /long and thin/i.test(await t.text(x.page, "#brandbox")), (await t.text(x.page, "#brandbox")).slice(0, 300));
      await x.page.setInputFiles("#brandlogo", tinyPng("logo-big.png", 1500, 1500)); await x.page.waitForTimeout(2500);
      t.check("a big picture (1500 x 1500) is shrunk to fit, not refused", !!(await x.page.$("#brandbox .zc-logo img")), (await t.text(x.page, "#brandbox")).slice(0, 300));
      await x.page.setInputFiles("#brandlogo", tinyPng()); await x.page.waitForTimeout(1500);
      await saveStep(x.page, 4);
      const b = (await org.info(eid)).body.brand;
      t.check("brand name and colour stored", b?.name === "Sim Industries" && b?.color === "#1B7F5C", JSON.stringify(b)?.slice(0, 120));
      t.check("logo stored as a small data URL (no outside request)", /^data:image\//.test(b?.logo ?? ""), (b?.logo ?? "").slice(0, 40));
      { const L = b?.logo ?? ""; const bytes = Math.floor((L.length - L.indexOf(",") - 1) * 3 / 4); t.check("the stored logo is at most 30 KB", bytes > 0 && bytes <= 30720, String(bytes)); }
      t.check("the step-4 summary names the brand and the logo", /Sim Industries/.test(await t.text(x.page, '.zc-syn[data-open="4"]')), await t.text(x.page, '.zc-syn[data-open="4"]'));
      await org.publish(eid);
      const p = await t.open({ device: "mobile", token: org.token });
      await p.page.goto(`${H.SIM}/preview.html#w=player&e=${eid}`); await p.page.waitForTimeout(2000);
      const ptxt = await t.text(p.page);
      t.check("preview is marked PREVIEW and shows the brand name and the logo", /PREVIEW/i.test(ptxt) && /Sim Industries/.test(ptxt) && !!(await p.page.$("#pvbrand img.zblogo")), ptxt.slice(0, 200));
      await t.shot(p.page, "preview-brand");
      const g = await t.open({ device: "mobile" });
      await g.page.goto(`${H.SIM}/z?e=${eid}`); await g.page.waitForTimeout(1500);
      t.check("the player's page shows the brand strip with the logo", /Sim Industries/.test(await t.text(g.page)) && !!(await g.page.$(".zbrand img.zblogo")), (await t.text(g.page)).slice(0, 160));
      await t.shot(g.page, "guest-brand");
      const big = await t.open({ device: "laptop" });
      await big.page.goto(`${H.SIM}/big.html?e=${eid}`); await big.page.waitForTimeout(2200);
      t.check("the big screen shows the company name and the logo", /Sim Industries/.test(await t.text(big.page)) && !!(await big.page.$(".blogo")), (await t.text(big.page)).slice(0, 160));
    },
  },
  {
    id: "S02-09", name: "Step 4 is only the brand: no brand moments, lucky draws, videos or audio (a tournament has no breaks to fill)",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 4);
      const txt = await t.text(x.page, "#sec4");
      t.check("step 4 offers the brand box (name, colour, logo)", !!(await x.page.$("#brandbox")) && /Company name/.test(txt), txt.slice(0, 200));
      t.check("step 4 offers no moments, lucky draw, YouTube, video or audio", !/moment|lucky|YouTube|video|audio|Before the game starts|At the end of the game/i.test(txt), txt.slice(0, 400));
      t.check("the step title is not 'Set Brand Moments'", !/Set Brand Moments/.test(await t.text(x.page, ".zc-sech[data-open='4']")), await t.text(x.page, ".zc-sech[data-open='4']"));
      const i0 = (await org.info(eid)).body;
      t.check("a new game has no brand moments", !(i0.opening?.length) && !(i0.breaks?.length) && !(i0.closing?.length), JSON.stringify({ o: i0.opening, b: i0.breaks, c: i0.closing }).slice(0, 120));
    },
  },
  {
    id: "S02-10", name: "Step 9 (Game day) before the start: the tournament is 'Not started yet', its link opens the tournament page; no Pause or End buttons and no 'message to phones' here",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await org.publish(eid); await x.page.reload(); await x.page.waitForSelector(".zc-sech"); await openStep(x.page, 9);
      const txt = await t.text(x.page, "#sec9");
      t.check("step 9 says the tournament has not started", /Not started yet/.test(txt), txt.slice(0, 260));
      t.check("step 9 has no Pause / End the game controls and no message-to-phones box (the tournament page does that)", !(await x.page.$('[data-ctl="pause"]')) && !/Message to everyone|End the game|Prizes handed over|first number/i.test(txt), txt.slice(0, 300));
      await x.page.click("#runt"); await x.page.waitForURL(/host\.html/, { timeout: 8000 });
      await x.page.waitForSelector(".zhead", { timeout: 10000 });
      t.check("the link opens the tournament page for this game, already signed in", new URL(x.page.url()).searchParams.get("e") === eid && /Before the start/i.test(await t.text(x.page)), (await t.text(x.page)).slice(0, 200));
      await t.shot(x.page, "host-page-before");
    },
  },
  {
    id: "S02-11", name: "Step 5: add a Host (name, mobile, e-mail) and a Co-host (name, mobile) by tapping; Host e-mail is mandatory in the form",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await org.publish(eid);
      await x.page.reload(); await x.page.waitForSelector(".zc-sech");
      await openStep(x.page, 5);
      await x.page.fill("#hostlabel", "Hema"); await x.page.click("#hostadd"); await x.page.waitForTimeout(800);
      t.check("a Host with no mobile and no e-mail is not added, and a message says why", (await org.team()).body.hosts.length === 0 && /e-?mail|mobile/i.test(await t.text(x.page, "#sec5")), (await t.text(x.page, "#sec5")).slice(-160));
      await x.page.fill("#hostphone", "9812345670");
      const hm = t.mail("host"); t.team.add(hm);
      await x.page.fill("#hostemail", hm); await x.page.click("#hostadd"); await x.page.waitForTimeout(1500);
      const team = (await org.team()).body;
      t.check("Host appears in the team list", team.hosts.length === 1 && team.hosts[0].label === "Hema", JSON.stringify(team.hosts).slice(0, 200));
      { const ml = await H.mailbox.list({ to: hm }); t.check("Host's link was e-mailed to the Host (not only to the Organizer)", ml.length >= 1, "all mails: " + (await H.mailbox.list()).filter((m) => /Host/.test(m.subject)).map((m) => m.to + " | " + m.subject).join(" ; ").slice(0, 300)); }
      await x.page.fill("#cohostlabel", "Chandra"); await x.page.fill("#cohostphone", "9812345671"); await x.page.click("#cohostadd"); await x.page.waitForTimeout(1500);
      const t2 = (await org.team(eid)).body;
      t.check("Co-host added (name + mobile only)", (await org.api("GET", `/api/org/team?e=${eid}`)).body.cohosts.length === 1, JSON.stringify((await org.api("GET", `/api/org/team?e=${eid}`)).body.cohosts).slice(0, 200));
      t.check("the e-mail rule sentence is on the screen", /No e-mail is needed|need only a name and a mobile/i.test(await t.text(x.page, "#sec5")));
      t.check("a Co-host link is shown for copying", /\/zc|copy/i.test(await t.text(x.page, "#sec5")));
      await chip(x.page, "x", 0).catch(() => {}); await x.page.click('[data-cohl="50"]').catch(() => {});
      await t.shot(x.page, "step5-team");
    },
  },
  {
    id: "S02-12", name: "Step 6: add people one by one, paste from Excel with duplicates and wrong numbers, upload a CSV",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await org.publish(eid);
      await x.page.reload(); await x.page.waitForSelector(".zc-sech");
      await openStep(x.page, 6); await tickGuestList(x.page);
      await x.page.fill("#gname", "Asha Rao"); await x.page.fill("#gphone", "98765 43210"); await x.page.click("#gadd"); await x.page.waitForTimeout(900);
      let p = (await org.people(eid)).body.people ?? [];
      t.check("one person added by typing (spaces cleaned)", p.length === 1, JSON.stringify(p).slice(0, 160));
      await x.page.click('[data-mode="paste"]'); await x.page.waitForTimeout(300);
      const ta = await x.page.$("#sec6 textarea");
      t.check("paste mode shows a box", !!ta);
      if (ta) {
        await ta.fill("Bala\t+91 98111 11111\nCharu 09822222222\nBala again 9811111111\nBroken 12345\nDev\t0091-9833333333");
        await x.page.click("#rosterGo"); await x.page.waitForTimeout(1500);
        const txt = await t.text(x.page, "#sec6");
        t.check("a cleaning summary tells duplicates and wrong numbers", /duplicate/i.test(txt) && /look wrong|wrong|invalid/i.test(txt), txt.slice(txt.search(/good|duplicate/i), 400));
        p = (await org.people(eid)).body.people ?? [];
        t.check("3 good new people were added (Bala, Charu, Dev) and the repeat was removed", p.length === 4, `people: ${p.length}`);
      }
      await t.shot(x.page, "step6-paste");
    },
  },
  {
    id: "S02-13", name: "Step 7 then 8 by tapping: publish with confirmation, then 'Pay now' leads to the pay page",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await uiPublish(x.page, org.email, "9811122233");
      const s = (await org.summary(eid)).body;
      t.check("game is published (summary)", /published/i.test(s.status ?? ""), s.status);
      t.check("pill says Payment pending", /Payment pending/i.test(await t.text(x.page)));
      await openStep(x.page, 8);
      const price = await t.text(x.page, "#sec8");
      t.check("Pay step shows the price (no GST)", /Rs\s?[\d,]+/i.test(price), price.slice(300, 520));
      t.check("Copy payment link button exists", !!(await x.page.$("#copypaylink")));
      await t.shot(x.page, "step8-pending");
    },
  },
  {
    id: "S02-14", name: "Publish refuses a wrong e-mail / mobile and keeps the game a draft",
    async run(t) {
      const { org, x, eid } = await startGameUi(t);
      await openStep(x.page, 7); await x.page.click("#publishopen"); await x.page.waitForSelector("#pubEmail");
      await x.page.fill("#pubEmail", "nope"); await x.page.fill("#pubPhone", "123");
      await tickTerms(t, x.page, { scope: ".tb", btn: "#pubgo", what: "Publish" }); await x.page.click("#pubgo"); await x.page.waitForTimeout(900);
      t.check("a message is shown", /e-?mail|mobile|number/i.test(await t.text(x.page, "#sec7")));
      t.check("still a draft", /draft/i.test((await org.summary(eid)).body.status ?? ""), (await org.summary(eid)).body.status);
      await x.page.click("#pubcancel"); await x.page.waitForTimeout(300);
      t.check("Back returns to the review", !!(await x.page.$("#publishopen")));
    },
  },
  {
    id: "S02-15", name: "All ten steps on a phone (390 px), tapping only: complete journey from sign-up to paid, with the progress bar",
    async run(t) {
      const email = t.mail("j"); t.team.add(email);
      const x = await t.open({ device: "mobile" });
      await x.page.goto(H.SIM + "/"); await x.page.click("#payBtn"); await x.page.fill("#fMail", email);
      await tickTerms(t, x.page, { scope: ".tb", btn: "#frGo", what: "Sign-up" }); await x.page.click("#frGo");
      await x.page.waitForURL(/\/zc/, { timeout: 15000 }); await x.page.waitForSelector("#mk"); await x.page.click("#mk"); await x.page.waitForSelector(".zc-sech");
      await x.page.waitForFunction(() => /[?&]e=/.test(location.search), null, { timeout: 8000 });
      const eid = eidOf(x.page);
      await openStep(x.page, 1); await chip(x.page, "occ", "Team event"); await chip(x.page, "time", "19:00"); await saveStep(x.page, 1);
      await openStep(x.page, 2); await chip(x.page, "cap", 100); await chip(x.page, "who", "list"); await saveStep(x.page, 2);
      await openStep(x.page, 3); await chip(x.page, "bundle", "Simple"); await saveStep(x.page, 3);
      await openStep(x.page, 4); await x.page.fill("#f-brand-name", "Phone Co"); await chip(x.page, "brand.color", "#6A1B9A"); await saveStep(x.page, 4);
      await openStep(x.page, 5); await x.page.click('#sec5 [data-save="5"]'); await x.page.waitForTimeout(500);
      await openStep(x.page, 6); await x.page.click('#sec6 [data-save="6"]'); await x.page.waitForTimeout(500);
      const prog0 = await t.text(x.page, ".zc-prog,[class*=prog]");
      await uiPublish(x.page, email, "9811122233");
      const org = new H.Organizer(email, await x.page.evaluate(() => sessionStorage.getItem("cbz-org")));
      // step 8: the pay page in the same tab
      await openStep(x.page, 8); await x.page.click("a[href*='/pay.html']"); await x.page.waitForURL(/pay/, { timeout: 10000 });
      await x.page.waitForSelector("#paygo"); await x.page.fill("#nm", "Journey Payer"); await x.page.fill("#em", email); await x.page.fill("#org", "Journey Co");
      await tickTerms(t, x.page, { scope: ".tb", btn: "#paygo", what: "Pay" }); await x.page.click("#paygo");
      await t.until(async () => (await org.summary(eid)).body.payment?.status === "paid", { what: "payment paid", timeout: 15000 });
      t.check("paid through the pay page (test payment)", true);
      await x.page.goto(`${H.SIM}/zc?e=${eid}`); await x.page.waitForSelector(".zc-sech");
      t.check("pill says Paid", /\bPaid\b/.test(await t.text(x.page)));
      await openStep(x.page, 9); await openStep(x.page, 10);
      t.check("progress text mentions steps done", /of 10 done/.test(await t.text(x.page)), prog0.slice(0, 80));
      await t.shot(x.page, "journey-paid");
    },
  },
];
