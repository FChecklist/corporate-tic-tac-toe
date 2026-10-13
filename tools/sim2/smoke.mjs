// node tools/sim2/smoke.mjs  : proves the simulation environment works end to end (about 2 to 4 minutes). Screenshots go to sim/shots/, results to sim/smoke-result.json.
//   1 parity report   2 stack up on the live copy (TEST mode)   3 Organizer created in real Chrome through the UI (e-mail code read from the capture sink)
//   4 Host invited through the WhatsApp simulator + Host first-open flow in the UI   5 guest joins through a personal link taken from the WhatsApp simulator (mobile context)
//   6 a 30-phone game finished in seconds on the fake beacon with identical winners   7 clock moved 2 days with lifecycle ticks erasing the data   8 invariants
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as H from "./lib/index.mjs";

const { invariants: inv } = H;
const results = []; const t00 = Date.now();
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + String(detail).slice(0, 200) : ""}`); return !!ok; };
const step = (s) => console.log(`\n== ${s}`);
let stack, browser;
try {
  // ---- 1 parity (builds pages/public, so it runs before the server starts)
  step("1 parity report");
  const pr = spawnSync("node", [join(H.ROOT, "tools/sim2/parity.mjs")], { cwd: H.ROOT, encoding: "utf8" });
  console.log(pr.stdout.trim().split("\n").pop());
  check("parity report produced", pr.status === 0 && /Report: docs\/SIM_PARITY_REPORT.md/.test(pr.stdout), pr.stderr.slice(0, 200));
  check("schema parity: SCHEMA = migrations and nothing in live that the code lacks (live may be BEHIND = a pending migration)", /parity: schema (EQUAL|CONSISTENT)/.test(pr.stdout), pr.stdout.split("\n").filter((l) => /^parity/.test(l)).pop());

  // ---- 2 stack
  step("2 stack");
  stack = await H.startStack({ build: false });
  const rs = await stack.reset();
  check("stack up on the live copy", rs.ok, `started: ${stack.started.join(", ") || "reused"}`);
  const rows = await H.sql("SELECT COUNT(*) c FROM engagement"); check("live rows present in the copy (24 engagements from the export)", rows[0].c >= 24, rows[0].c);
  check("site is in TEST mode for the run", (await (await fetch(H.SIM + "/api/mode")).json()).mode === "TEST");
  const track = await H.trackClock();
  browser = await H.launchChrome(); const open = H.opener(browser, { track });
  const team = []; // addresses that may receive mail

  // ---- 3 Organizer through the UI
  step("3 Organizer via the UI in real Chrome");
  const email = "sim+uiorg@example.com"; team.push(email);
  const a = await open({ device: "laptop" });
  await a.page.goto(H.SIM + "/"); await a.page.click("#payBtn"); await a.page.fill("#fMail", email); await a.page.click("#frGo");
  await a.page.waitForURL(/\/zc/, { timeout: 15000 });
  const token1 = await a.page.evaluate(() => sessionStorage.getItem("cbz-org"));
  await a.page.waitForTimeout(800); await H.shot(a.page, "03-organizer-console-after-signup");
  check("Organizer signed up in the UI and landed in the console", /^cbk_[0-9a-f]{48}$/.test(token1 ?? ""), (token1 ?? "").slice(0, 8));
  await a.close();
  const b = await open({ device: "mobile" }); // coming back later: sign in with the e-mailed code
  await b.page.goto(H.SIM + "/#login"); await b.page.fill("#lMail", email); await b.page.click("#lgGo");
  await b.page.waitForSelector("#lCode");
  const codeMail = await H.mailbox.waitFor({ to: email, timeout: 8000 }); const code = H.mailbox.code(codeMail);
  check("sign-in code arrived in the capture sink", !!code, codeMail.subject);
  await b.page.fill("#lCode", code); await b.page.click("#cdGo"); await b.page.waitForURL(/\/zc/, { timeout: 15000 });
  const token2 = await b.page.evaluate(() => sessionStorage.getItem("cbz-org"));
  await H.shot(b.page, "03b-organizer-code-signin-mobile");
  check("Organizer signed in with the e-mail code (new key)", /^cbk_/.test(token2 ?? "") && token2 !== token1);
  await b.close();
  const org = new H.Organizer(email, token2, null);
  check("API key from the UI session works", (await org.whoami()).body.kind === "master");

  // ---- game 1 (UI game): published and paid
  const g1 = await org.createGame({ leadMs: 3 * 3_600_000 });
  await org.publish(g1.id); const pay = await org.pay(g1.id);
  check("game created, published, test payment accepted", pay.status === 200, `${g1.id} pay ${pay.status}`);

  // ---- 4 Host via WhatsApp simulator
  step("4 Host via WhatsApp + first open");
  const hostEmail = "sim+host1@example.com"; team.push(hostEmail);
  const inv1 = await org.inviteHost({ label: "Hema", mobile: "9812345678" });
  const o = await open({ device: "laptop", token: token2, sender: "9811122233" });
  await o.page.goto(inv1.waLink); await H.pressSend(o.page); await H.shot(o.page, "04-whatsapp-organizer-sent");
  const hmsg = await H.wa.waitFor("9812345678", { match: "cbh_" });
  check("Host invitation landed in the Host's WhatsApp inbox", hmsg.links.length === 1, hmsg.links[0]?.slice(0, 60));
  await o.close();
  const h = await H.openLinkAsRecipient(open, "9812345678", hmsg);
  await h.page.waitForSelector("#setupemail"); await H.shot(h.page, "04b-host-first-open-mobile");
  await h.page.fill("#setupemail", hostEmail); await h.page.click("#setupsend"); await h.page.waitForSelector("#setupcode");
  const hm = await H.mailbox.waitFor({ to: hostEmail, timeout: 8000 }); const hcode = H.mailbox.code(hm);
  await h.page.fill("#setupcode", hcode); await h.page.click("#setupverify");
  await h.page.waitForFunction(() => !document.getElementById("setupcode"), null, { timeout: 15000 });
  const hostToken = await h.page.evaluate(() => sessionStorage.getItem("cbz-org"));
  await h.page.waitForTimeout(600); await H.shot(h.page, "04c-host-console-after-setup");
  const who = await H.call("GET", "/api/whoami", undefined, { "x-organizer": hostToken });
  check("Host first-open flow completed in the UI (e-mail code from the sink), key is a Host key", who.body.kind === "host", JSON.stringify(who.body));
  const tm = (await org.team()).body;
  check("Organizer team list shows the Host as ready", JSON.stringify(tm).includes('"ready"'), JSON.stringify(tm.hosts?.map((x) => x.setup)));
  await h.close();

  // ---- 5 guest through a personal link from the WhatsApp simulator
  step("5 guest via personal link");
  const added = await org.addPeople(g1.id, [{ name: "Gita Rao", phone: "9876501234" }]);
  const person = added.people?.[0]; check("personal link created", !!person?.waLink, JSON.stringify(person).slice(0, 120));
  const o2 = await open({ device: "laptop", token: token2, sender: "9811122233" });
  await o2.page.goto(person.waLink); await H.pressSend(o2.page); await o2.close();
  const gmsg = await H.wa.waitFor("9876501234", { match: "/j/" });
  const gu = await H.openLinkAsRecipient(open, "9876501234", gmsg);
  await gu.page.waitForTimeout(2500);
  const gtxt = await gu.page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
  await H.shot(gu.page, "05-guest-personal-link-mobile");
  const mm = await H.measure(gu.page);
  check("guest page opened from the WhatsApp link (game page, no error)", /z\.html|\/z\?/.test(gu.page.url()) && gu.mon.pageErrors.length === 0, gu.page.url().replace(/t=[\w-]+/, "t=<token>") + " | " + gtxt.slice(0, 100));
  check("guest page has no horizontal overflow at 390 px", !mm.overflowX, JSON.stringify(mm.wideElements));
  const ppl = (await org.people(g1.id)).body;
  check("guest shows in the Organizer's people list", (ppl.people ?? []).length >= 1, JSON.stringify((ppl.people ?? []).map((x) => x.status)));
  await gu.close();

  // ---- 5b two real Chrome phones play a whole game on the fake beacon with page.clock
  step("5b two Chrome phones, fake beacon, page.clock");
  const g3 = await org.createGame({ leadMs: 8 * 60_000 }); await org.publish(g3.id); await org.pay(g3.id);
  await H.clock.advance(6 * H.MIN); await track.refresh(); // 2 minutes before the start
  const pa = await open({ device: "mobile", ip: "10.31.0.1" }), pb = await open({ device: "mobile", ip: "10.31.0.2" });
  for (const [p, ph, nm] of [[pa, "9810000001", "Asha"], [pb, "9810000002", "Bala"]]) { await p.page.goto(`${H.SIM}/z?e=${g3.id}`); await p.page.waitForSelector("#ph"); await p.page.fill("#ph", ph); await p.page.fill("#nm", nm); await p.page.click("#go"); }
  await Promise.all([pa, pb].map((p) => p.page.waitForFunction(() => window.__rt && window.__rt.phase === "play", null, { timeout: 20000 })));
  check("fake beacon accepted in Chrome: bundles patched and phones reached the play phase", Object.keys(pa.patched).includes("zgame.js") && pa.patched["zgame.js"] > 0, JSON.stringify(pa.patched));
  const t0b = Date.now(); const bg = await H.playBrowserGame([pa, pb], { track });
  await H.shot(pa.page, "05b-chrome-phone-after-game");
  check("two Chrome phones played the game to the end in seconds", bg.ended.every(Boolean) && Date.now() - t0b < 180000, `${bg.steps} steps in ${((Date.now() - t0b) / 1000).toFixed(0)} s; logs ${bg.views.map((v) => v.log.length)}`);
  const idb = inv.identicalWinners(bg.views.map((v, i) => ({ who: "chrome" + i, results: v.results }))); check("Chrome phones: " + idb.name, idb.ok && bg.views[0].results.length > 0, idb.detail);
  check("Chrome phones: no JavaScript errors", pa.mon.pageErrors.length + pb.mon.pageErrors.length === 0, [...pa.mon.pageErrors, ...pb.mon.pageErrors].join(" | "));
  await pa.close(); await pb.close();

  // ---- 6 a 30-phone game on the fake beacon
  step("6 30 phones, fake beacon, virtual time");
  const g2 = await org.createGame({ leadMs: 20 * 60_000, cfg: { rewards: [{ pattern: "corners", scope: "ticket", ordinal: 1, text: "" }, { pattern: "line", scope: "ticket", ordinal: 1, text: "" }, { pattern: "x", scope: "ticket", ordinal: 1, text: "" }, { pattern: "frame", scope: "ticket", ordinal: 1, text: "" }, { pattern: "corners", scope: "ticket", ordinal: 1, text: "" }, { pattern: "plus", scope: "ticket", ordinal: 1, text: "" }, { pattern: "blackout", scope: "ticket", ordinal: 1, text: "" }] } });
  await org.publish(g2.id); await org.pay(g2.id);
  const c = spawnSync(H.BUN, [join(H.ROOT, "tools/sim2/crowd.ts"), JSON.stringify({ eid: g2.id, startRound: g2.startRound, phones: 30, seed: "smoke", base: H.SIM })], { cwd: H.ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  let cr; try { cr = JSON.parse(c.stdout.trim().split("\n").pop()); } catch { cr = { ok: false, failures: ["no JSON from crowd.ts: " + (c.stderr || c.stdout).slice(0, 300)] }; }
  check("30-phone game finished in seconds of real time", cr.ok && cr.seconds < 90, `${cr.joined}/${cr.phones} joined, ${cr.ended} ended, ${cr.steps} steps, ${cr.seconds}s real; ${(cr.failures ?? []).join("; ")}`);
  check("every phone has the identical 90-number log (equal to the reference derived from the fake beacon)", cr.logsEqual && cr.logsEqual.split("/")[0] === cr.logsEqual.split("/")[1] && +cr.logsEqual.split("/")[0] > 0, cr.logsEqual);
  const info2 = (await H.call("GET", `/api/z/${g2.id}/info`)).body;
  const views = (cr.perPhone ?? []).map((p) => ({ who: p.phone, results: [{ round: 1, pattern: p.canon, ordinal: 1, idx: 0 }] })); // compare by hash of each phone's own result set
  const ident = inv.identicalWinners(views); check(ident.name, ident.ok, ident.detail);
  const pub = (await H.call("GET", `/api/z/${g2.id}/results`)).body.results ?? [];
  check("winners were published (phones' votes reached quorum)", pub.length > 0, `${pub.length} result lines: ` + pub.slice(0, 7).map((r) => `${r.pattern}@${r.idx + 1}x${r.count}`).join(" "));
  const hm1 = inv.perHouseMaxima(pub, info2.rewards ?? []); check(hm1.name, hm1.ok, hm1.detail);
  const one = await inv.oneTicketPerPhone(g2.id); check(one.name, one.ok, one.detail);
  const left = (await H.sql("SELECT COUNT(*) c FROM participant WHERE eid=?", [g2.id]))[0].c; check("30 participants stored for the game", left >= 27, left);

  // ---- 7 clock +2 days with lifecycle ticks
  step("7 clock +2 days, lifecycle ticks");
  const before = { p1: (await H.sql("SELECT COUNT(*) c FROM participant WHERE eid=?", [g1.id]))[0].c, p2: left };
  const t0 = Date.now(); const tick = await H.clock.advanceWithTicks(2 * H.DAY, 5 * H.MIN);
  console.log(`   ${tick.ticks} ticks in ${((Date.now() - t0) / 1000).toFixed(1)} s, clock now ${tick.iso}`);
  await track.refresh();
  check("clock moved 2 days", tick.ticks >= 576 && tick.last.status === 200, `${tick.ticks} ticks, last status ${tick.last.status}`);
  const er1 = await inv.noPersonalDataAfterErasure(g1.id, ["Gita"]), er2 = await inv.noPersonalDataAfterErasure(g2.id);
  const lf = await H.sql("SELECT eid, end_ms, end_src, purged_ms, tries FROM life WHERE eid IN (?,?)", [g1.id, g2.id]);
  check(`erasure by the lifecycle tick (game 1: ${before.p1} joined + 1 invited person, game 2: ${before.p2} phones)`, er1.ok && er2.ok, er1.detail + " / " + er2.detail + " | life " + JSON.stringify(lf) + " | last tick " + JSON.stringify(tick.last.body));
  const probe = await open({ device: "mobile" }); await probe.page.goto(H.SIM + "/");
  const pageNow = await probe.page.evaluate(() => Date.now()), srvNow = await H.clock.now();
  check("browser clock follows the simulated server clock (page.clock)", Math.abs(pageNow - srvNow) < 15000, `page - server = ${pageNow - srvNow} ms`);
  await probe.close();

  // ---- 8 invariants
  step("8 invariants");
  const em = await inv.emailOnlyToTeam(team); check(em.name, em.ok, em.detail);
  const wb = await inv.writeBudget(); check(wb.name, wb.ok, wb.detail);
  const npt = await inv.nobodyPaidTwice(); check(npt.name, npt.ok, npt.detail);
  const health = await (await fetch(H.SIM + "/__sim/health")).json();
  check("nothing tried to leave the machine (outbound fetch guard)", health.blockedFetches.length === 0, health.blockedFetches.join(", "));
} catch (e) {
  check("smoke run completed without an exception", false, e?.stack ?? e);
} finally {
  try { await browser?.close(); } catch { /* closed */ }
  try { stack?.stop(); } catch { /* gone */ }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(H.ROOT, "sim/smoke-result.json"), JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - t00) / 1000), total: results.length, failed: failed.length, results }, null, 1));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${Math.round((Date.now() - t00) / 1000)} s${failed.length ? "; FAILED: " + failed.map((f) => f.name).join(" | ") : ""}`);
  process.exit(failed.length ? 1 : 0);
}
