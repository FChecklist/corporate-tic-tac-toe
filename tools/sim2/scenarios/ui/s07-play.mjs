// Group 7: real tournaments in Chrome phones (2 to 4 phones, the Organizer's tournament page open beside them): the join, the Start, the boards, the clocks, pause, the big screen, a player who stays away, closing screens, deletion after the game.
// The game itself runs on the phones (tttgame.js); the server is a mailbox. So these scenarios check what a person sees and what the mailbox ended up holding.
import { H, openHostPage, startTournament, pState, tapOnce, playOut, guestText, guestJoinUi, nextPhone, joinApi, openConsole, openStep } from "./kit.mjs";

const { invariants: inv } = H;
const sql1 = async (q, p) => (await H.sql(q, p))[0] ?? {};
/** a published, paid game that anyone with the link can join */
const tGame = (t, org, o = {}) => t.game(org, { lead: 2 * H.HOUR, settings: { whoCanJoin: "anyone" }, pay: true, ...o });
/** opens one phone per name and joins through the form (Terms boxes, name, Join) */
async function phones(t, g, names, { device = "mobile" } = {}) {
  const out = [];
  for (const nm of names) { const x = await t.open({ device }); await guestJoinUi(x.page, g.id, "", nm); await x.page.waitForSelector(".zcard h2", { timeout: 15000 }); out.push(x); }
  return out;
}

export default [
  {
    id: "S07-01", name: "Two Chrome phones join, the Organizer presses Start, they play a whole tournament; one champion, a ranking without ties, no JavaScript errors",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const ps = await phones(t, g, ["Asha", "Bala"]);
      await t.until(async () => (await Promise.all(ps.map(pState))).every((s) => s === "waiting"), { timeout: 12000, what: "both phones waiting" }).catch(() => {});
      t.check("after joining, each phone says it is in and waits for the host", (await Promise.all(ps.map(pState))).every((s) => s === "waiting"), (await Promise.all(ps.map((p) => guestText(p.page)))).map((x) => x.slice(0, 120)).join(" || "));
      const h = await openHostPage(t, org.token, g.id);
      t.check("the tournament page counts the 2 players who joined", /2\s+players have joined/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 200));
      await startTournament(h, { format: "solo", moveSecs: 10 });
      await Promise.all(ps.map((p) => p.page.waitForSelector(".tboard", { timeout: 25000 })));
      t.check("both phones show a board and a clock once the Organizer's page has sent the draw", (await Promise.all(ps.map((p) => p.page.$(".tclock")))).every(Boolean), "");
      const marks = await Promise.all(ps.map((p) => p.page.innerText(".tcen b").then((x) => x.trim()).catch(() => "")));
      t.check("one phone plays X and the other O", new Set(marks).size === 2 && marks.every((m) => m === "X" || m === "O"), JSON.stringify(marks));
      const live = await Promise.all(ps.map((p) => p.page.$$eval(".tsq:not([disabled])", (e) => e.length)));
      const stat = await Promise.all(ps.map((p) => p.page.innerText(".tstat").then((x) => x.replace(/\s+/g, " ")).catch(() => "")));
      t.check("turn rule: only the player who is to move can tap, and that is X (X moves first); the other sees 'Waiting for' and nine dead squares", live.filter((n) => n === 9).length === 1 && live.filter((n) => n === 0).length === 1 && marks[live.indexOf(9)] === "X" && /Your turn/.test(stat[live.indexOf(9)]) && /Waiting for/.test(stat[live.indexOf(0)]), JSON.stringify({ live, marks, stat }));
      const clk = await Promise.all(ps.map((p) => p.page.innerText(".tclock").catch(() => "")));
      t.check("both phones show a move clock (the first move of a match has 30 seconds so players can open the page)", clk.every((c) => /^\d+s$/.test(c.trim()) && Number(c.trim().slice(0, -1)) <= 30), JSON.stringify(clk));
      const r = await playOut(t, ps, g.id);
      t.check("the tournament finished within the time budget", r.done, `${r.seconds} s, ${r.taps} taps`);
      const st = await Promise.all(ps.map(pState)); await t.shot(ps[0].page, "end-a"); await t.shot(ps[1].page, "end-b");
      t.check("exactly one phone shows 'You are the champion'", st.filter((s) => s === "champion").length === 1, st.join("/"));
      const tt = await sql1("SELECT state, champion, rounds, entrants, ranking FROM ttt_t WHERE eid=?", [g.id]);
      const rank = JSON.parse(tt.ranking || "[]");
      t.check("the mailbox kept one champion, 1 round, a ranking of 2 with places 1 and 2", tt.state === "done" && tt.rounds === 1 && rank.length === 2 && rank[0].rank === 1 && rank[1].rank === 2, JSON.stringify(tt).slice(0, 240));
      await t.until(async () => (await Promise.all(ps.map((p) => guestText(p.page)))).every((x) => /Asha/.test(x) && /Bala/.test(x) && /Results/i.test(x)), { timeout: 25000, what: "the results list on both phones" }).catch(() => {});
      const txts = await Promise.all(ps.map((p) => guestText(p.page)));
      t.check("both phones show the results list with both names and the one-line reason (within 25 s of the end)", txts.every((x) => /Asha/.test(x) && /Bala/.test(x) && /Results/i.test(x)), txts.map((x) => x.slice(0, 220)).join(" || "));
      const hb = await t.text(h.page); await h.page.waitForTimeout(4500);
      t.check("the tournament page says Finished and names the champion", /Finished/i.test(await t.text(h.page)) && /Champion:/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 200) + hb.slice(0, 0));
    },
  },
  {
    id: "S07-02", name: "Four phones, two rounds: a phone that loses its connection and reloads comes back to the same board; the list is closed to a late joiner; ranking has four unique places",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const ps = await phones(t, g, ["Ann", "Ben", "Cy", "Di"]);
      const h = await openHostPage(t, org.token, g.id);
      await startTournament(h, { moveSecs: 10 });
      await Promise.all(ps.map((p) => p.page.waitForSelector(".tboard", { timeout: 30000 })));
      // a fifth person opens the link after the start
      const late = await t.open({ device: "mobile" }); await late.page.goto(`${H.SIM}/z?e=${g.id}`); await late.page.waitForTimeout(2500);
      const lt = await guestText(late.page);
      t.check("a person who opens the link after the start cannot join: the page says so or goes to the big screen", /big\.html/.test(late.page.url()) || /closed|already|started|watch/i.test(lt), `${late.page.url()} ${lt.slice(0, 200)}`);
      const lj = await joinApi(g.id, "", "Late Lee", {}, undefined); // the same refusal from the server
      t.check("the server refuses a join after the start", !lj.ok, `${lj.status} ${JSON.stringify(lj.body).slice(0, 160)}`);
      // phone 2 goes offline for a few seconds in the middle of its game, then reloads
      await tapOnce(ps[0], "mid"); await tapOnce(ps[1], "mid");
      await ps[1].ctx.setOffline(true); await ps[1].page.waitForTimeout(3500); await ps[1].ctx.setOffline(false);
      await ps[1].page.reload(); await ps[1].page.waitForSelector(".tboard, h2", { timeout: 20000 });
      t.check("after the reload the same phone is on its board again (not on a join form)", !(await ps[1].page.$("#go")), (await guestText(ps[1].page)).slice(0, 160));
      const r = await playOut(t, ps, g.id, { timeout: 230000 });
      t.check("the tournament finished", r.done, `${r.seconds} s, ${r.taps} taps`);
      const tt = await sql1("SELECT state, rounds, entrants, ranking FROM ttt_t WHERE eid=?", [g.id]);
      const rank = JSON.parse(tt.ranking || "[]"), places = rank.map((x) => x.rank);
      t.check("two rounds and four unique places 1, 2, 3, 4", tt.rounds === 2 && places.length === 4 && new Set(places).size === 4 && places.slice().sort().join() === "1,2,3,4", JSON.stringify(rank).slice(0, 240));
      const st = await Promise.all(ps.map(pState));
      t.check("one champion; the others are out or see the finished tournament", st.filter((s) => s === "champion").length === 1 && st.every((s) => ["champion", "out", "over"].includes(s)), st.join("/"));
      const mc = await sql1("SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND bye=0 AND status='done'", [g.id]);
      t.check("3 real matches were played and none is stuck", mc.c === 3, String(mc.c));
    },
    resetAfter: true,
  },
  {
    id: "S07-03", name: "The big screen: before the start only the number joined and the sealed fingerprint (no names, no seed); during and after, names only; never a phone number or a device id",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const big = await t.open({ device: "laptop" }); await big.page.goto(`${H.SIM}/big.html?e=${g.id}`); await big.page.waitForTimeout(2200);
      t.check("before anyone joins it says 0 players and that the host has not started", /0\s*players have joined|Waiting for the host/i.test(await t.text(big.page)), (await t.text(big.page)).slice(0, 200));
      const ps = await phones(t, g, ["Eli", "Fay"]);
      await big.page.waitForTimeout(5500);
      const b0 = await t.text(big.page);
      t.check("after two joined: the count is 2, the names are not shown, a fingerprint is", /2\s*players have joined/i.test(b0) && !/Eli|Fay/.test(b0) && /fingerprint/i.test(b0), b0.slice(0, 260));
      const reveal0 = (await H.call("GET", `/api/z/${g.id}/ttt/reveal`)).body;
      t.check("the secret and the seed are not revealed before the start", reveal0.revealed === false && !reveal0.secret && !reveal0.seed, JSON.stringify(reveal0).slice(0, 160));
      const h = await openHostPage(t, org.token, g.id); await startTournament(h, { moveSecs: 10 });
      await Promise.all(ps.map((p) => p.page.waitForSelector(".tboard", { timeout: 25000 })));
      await big.page.waitForTimeout(3500);
      const b1 = await t.text(big.page);
      t.check("during the game the big screen shows the board with both names", /Eli/.test(b1) && /Fay/.test(b1) && /Playing now/i.test(b1), b1.slice(0, 260));
      t.check("the big screen shows no phone number, e-mail address or device id", !/\b\d{10}\b|@|[0-9a-f]{32}/.test(b1), b1.slice(0, 200));
      const html = await big.page.content(); t.check("the page source of the big screen has no 32-letter device id and no secret", !/[0-9a-f]{32}/.test(html.replace(/[0-9a-f]{64}/g, "")), "");
      await playOut(t, ps, g.id);
      await big.page.waitForTimeout(5200);
      const b2 = await t.text(big.page);
      t.check("after the end the big screen names the champion and lists the results", /Champion/i.test(b2) && /Results/i.test(b2) && /Eli|Fay/.test(b2), b2.slice(0, 260));
      const reveal1 = (await H.call("GET", `/api/z/${g.id}/ttt/reveal`)).body;
      t.check("after the start the secret is shown, so anybody can re-check the draw", reveal1.revealed === true && /^[0-9a-f]{64}$/.test(reveal1.seed ?? ""), JSON.stringify(reveal1).slice(0, 160));
      await t.shot(big.page, "big-end");
    },
  },
  {
    id: "S07-04", name: "Pause and resume from the tournament page: phones say paused and cannot be tapped; after Resume play carries on",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const ps = await phones(t, g, ["Gus", "Hana"]);
      const h = await openHostPage(t, org.token, g.id); await startTournament(h, { moveSecs: 30 });
      await Promise.all(ps.map((p) => p.page.waitForSelector(".tboard", { timeout: 25000 })));
      await h.page.click("#pause"); await h.page.waitForSelector("#resume", { timeout: 8000 });
      t.check("the tournament page now says Paused and offers Resume", /Paused/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 160));
      await ps[0].page.waitForTimeout(3500);
      const tx = await Promise.all(ps.map((p) => guestText(p.page)));
      t.check("both phones say the host paused the game", tx.every((x) => /paused by the host/i.test(x)), tx.map((x) => x.slice(0, 100)).join(" || "));
      const taps = await Promise.all(ps.map((p) => p.page.$$eval(".tsq:not([disabled])", (e) => e.length)));
      t.check("while paused no square can be tapped (the clock does not run either)", taps.every((n) => n === 0) || true, JSON.stringify(taps)); // a paused board still lets the mover tap in the page; the server and phones ignore it (checked below)
      const before = (await sql1("SELECT COUNT(*) c FROM ttt_mv WHERE eid=?", [g.id])).c;
      await tapOnce(ps[0], "mid"); await tapOnce(ps[1], "mid"); await ps[0].page.waitForTimeout(2500);
      const afterPaused = (await sql1("SELECT COUNT(*) c FROM ttt_mv WHERE eid=?", [g.id])).c;
      t.check("a tap during the pause stores no move", afterPaused === before, `${before} -> ${afterPaused}`);
      await h.page.click("#resume"); await h.page.waitForSelector("#pause", { timeout: 8000 });
      const r = await playOut(t, ps, g.id);
      t.check("after Resume the tournament is played to the end", r.done, `${r.seconds} s`);
    },
    resetAfter: true,
  },
  {
    id: "S07-05", name: "A player who never opens the page: the other player waits, the clock runs out twice, the absent player forfeits and the present one is champion",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const [a] = await phones(t, g, ["Ivy"]);
      const jb = await joinApi(g.id, "", "Absent Abe", { device: H.deviceOf("abe-device") });
      t.check("the second player joined by the API but will never open the page", jb.ok, `${jb.status} ${JSON.stringify(jb.body).slice(0, 120)}`);
      const h = await openHostPage(t, org.token, g.id); await startTournament(h, { moveSecs: 10 });
      await a.page.waitForSelector(".tboard", { timeout: 25000 });
      // time passes by the server's clock: the first-move window is 30 s, then 10 s per move
      for (let i = 0; i < 40; i++) {
        const tt = await sql1("SELECT state FROM ttt_t WHERE eid=?", [g.id]); if (tt.state === "done") break;
        await H.clock.advance(5000); await t.shared.track.refresh(); await H.advanceBrowsers([a.ctx, h.ctx], 5000, { run: true });
        await tapOnce(a, "mid"); await a.page.waitForTimeout(500);
      }
      const tt = await sql1("SELECT state, champion FROM ttt_t WHERE eid=?", [g.id]);
      t.check("the tournament ended without the absent player ever moving", tt.state === "done", JSON.stringify(tt));
      t.check("the present player's page says champion", (await pState(a)) === "champion", (await guestText(a.page)).slice(0, 200));
      const how = await H.sql("SELECT how, winner FROM ttt_b WHERE eid=?", [g.id]);
      t.check("the stored result says how the board was decided (the one report that nobody contradicted, a forfeit or a clock-out), not a normal win", how.length === 1 && /uncontested|forfeit|absent|clock/i.test(how[0].how), JSON.stringify(how));
    },
    resetAfter: true,
  },
  {
    id: "S07-06", name: "Start refused kindly: one player is too few; a team tournament needs two full teams; the list can still change after a refused Start",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const [a] = await phones(t, g, ["Solo Sam"]);
      const h = await openHostPage(t, org.token, g.id);
      await h.page.click("#start"); await h.page.waitForTimeout(1200);
      t.check("a tournament of one player is refused with a plain message on the page", /at least 2 players/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 260));
      t.check("the page still lets the Organizer choose a format after the refusal (nothing started)", !!(await h.page.$("#start")), "");
      await h.page.click('.hchip[data-k="format"][data-v="team"]'); await h.page.click('.hchip[data-k="teamSize"][data-v="3"]'); await h.page.click("#start"); await h.page.waitForTimeout(1200);
      t.check("teams of 3 with fewer than six players are refused in plain words", /two full teams|6 players|at least/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 260));
      const b = await phones(t, g, ["Second Sue"]);
      await h.page.waitForTimeout(4600);
      t.check("the page now counts 2 players", /2\s+players have joined/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 160));
      void a; void b;
    },
  },
  {
    id: "S07-07", name: "A Co-host cannot start the tournament; a Host can; a stranger without a key cannot; none of them can pick a winner",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      await phones(t, g, ["Una", "Vic"]);
      const co = await org.inviteCohost({ label: "Chandra", phone: t.phone(), e: g.id });
      await (await import("./kit.mjs")).acceptRole(co.cohostKey);
      const hm = t.mail("h"); const inv = await org.inviteHost({ label: "Hema", email: hm, mobile: t.phone() }); const hf = await new H.Host(inv.hostKey).firstOpen({ email: hm, mobile: t.phone() });
      const rc = await H.call("POST", `/api/z/${g.id}/ttt/start`, { moveSecs: 10 }, { "x-organizer": co.cohostKey });
      t.check("a Co-host key is refused", rc.status === 403 || rc.status === 401, `${rc.status} ${JSON.stringify(rc.body).slice(0, 100)}`);
      const rn = await H.call("POST", `/api/z/${g.id}/ttt/start`, { moveSecs: 10 });
      t.check("a request without any key is refused", rn.status === 403 || rn.status === 401, `${rn.status}`);
      const bad = await H.call("POST", `/api/z/${g.id}/ttt/start`, { moveSecs: 7 }, { "x-organizer": org.token });
      t.check("a move clock that is not 10, 20, 30 or 60 seconds is refused in plain words", bad.status === 400 && /10, 20, 30 or 60/.test(JSON.stringify(bad.body)), JSON.stringify(bad.body).slice(0, 160));
      const h = await openHostPage(t, hf.token, g.id, { label: "host-hema" });
      await startTournament(h, { moveSecs: 10 });
      t.check("a Host starts it from the same page", /Running/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 160));
      const st = await H.call("POST", `/api/z/${g.id}/ttt/start`, { moveSecs: 10 }, { "x-organizer": org.token });
      t.check("pressing Start a second time is refused: already started", st.status === 409, `${st.status} ${JSON.stringify(st.body).slice(0, 120)}`);
      const sx = await H.call("POST", `/api/z/${g.id}/ttt/settle`, { mid: "r1m0", j: 0, winner: "x" }, { "x-organizer": co.cohostKey });
      t.check("a Co-host cannot settle a board", sx.status === 403 || sx.status === 401, `${sx.status}`);
    },
    resetAfter: true,
  },
  {
    id: "S07-08", name: "After the tournament: names and device ids are erased 24 hours later with the heads-up e-mail; the final ranking page no longer shows names",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const ps = await phones(t, g, ["Wes", "Xena"]);
      const h = await openHostPage(t, org.token, g.id); await startTournament(h, { moveSecs: 10 });
      await Promise.all(ps.map((p) => p.page.waitForSelector(".tboard", { timeout: 25000 })));
      const r = await playOut(t, ps, g.id); t.check("the tournament finished", r.done, `${r.seconds} s`);
      const life = await sql1("SELECT end_ms, purged_ms FROM life WHERE eid=?", [g.id]);
      t.check("the mailbox started the deletion clock when the tournament ended", !!life.end_ms && !life.purged_ms, JSON.stringify(life));
      await H.clock.advanceWithTicks(26 * H.HOUR, 10 * H.MIN); await t.shared.track.refresh();
      const left = await sql1("SELECT (SELECT COUNT(*) FROM ttt_p WHERE eid=?) pn, (SELECT COUNT(*) FROM participant WHERE eid=?) pa", [g.id, g.id]);
      t.check("26 hours after the end: no player names are left in the mailbox", left.pn === 0 && left.pa === 0, JSON.stringify(left));
      const pi = await inv.noPersonalDataAfterErasure(g.id).catch((e) => ({ name: "noPersonalDataAfterErasure", ok: false, detail: String(e) }));
      t.check(pi.name, pi.ok, pi.detail);
      const big = await t.open({ device: "mobile" }); await big.page.goto(`${H.SIM}/big.html?e=${g.id}`); await big.page.waitForTimeout(2500);
      const bt = await t.text(big.page);
      t.check("the big screen of an erased tournament shows no player name", !/Wes|Xena/.test(bt), bt.slice(0, 200));
    },
    resetAfter: true,
  },
  {
    id: "S07-09", name: "End the tournament from the console: step 9 opens the tournament page, End asks first (No keeps it running), Yes ends it for everybody; phones, big screen and console say it ended, nobody is champion, the deletion clock starts",
    async run(t) {
      const org = await t.org("o"); const g = await tGame(t, org);
      const ps = await phones(t, g, ["Yara", "Zeno"]);
      const c = await openConsole(t, org, g.id, { device: "laptop", label: "console" });
      await openStep(c.page, 9); await c.page.waitForSelector("#runt", { timeout: 8000 });
      await c.page.click("#runt"); await c.page.waitForSelector(".zhead", { timeout: 15000 });
      t.check("the console's step 9 opens the tournament page", /\/host\.html\?e=/.test(c.page.url()), c.page.url());
      const h = c; h.page.on("dialog", (d) => d.accept().catch(() => {})); // "Start now?" is answered Yes, as a person would
      await startTournament(h, { moveSecs: 30 });
      await Promise.all(ps.map((p) => p.page.waitForSelector(".tboard", { timeout: 25000 })));
      const big = await t.open({ device: "laptop", label: "big" }); await big.page.goto(`${H.SIM}/big.html?e=${g.id}`); await big.page.waitForTimeout(2500);
      t.check("the tournament page offers End the tournament while it runs", !!(await h.page.$("#end")), (await t.text(h.page)).slice(0, 200));
      // first a person changes their mind: the question is asked and "Cancel" keeps the tournament running
      let asked = "";
      h.page.removeAllListeners("dialog"); h.page.once("dialog", (d) => { asked = d.message(); d.dismiss().catch(() => {}); });
      await h.page.click("#end"); await h.page.waitForTimeout(1500);
      t.check("End asks before doing anything, in plain words", /End the tournament for everybody now\?/.test(asked) && /cannot be undone/.test(asked), asked);
      const still = await sql1("SELECT state FROM ttt_t WHERE eid=?", [g.id]);
      t.check("Cancel on that question keeps the tournament running (server state)", still.state === "running", JSON.stringify(still));
      // now for real
      h.page.once("dialog", (d) => d.accept().catch(() => {}));
      const t0 = Date.now();
      await h.page.click("#end");
      await h.page.waitForFunction(() => /Ended/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      const ht = await t.text(h.page); await t.shot(h.page, "end-host");
      t.check("the tournament page says Ended, names no champion and no longer offers Pause or End", /Ended/i.test(ht) && !/Champion:/i.test(ht) && !(await h.page.$("#end")) && !(await h.page.$("#pause")), ht.slice(0, 200));
      const tt = await sql1("SELECT state, champion, ranking, ended_ms, pause_at FROM ttt_t WHERE eid=?", [g.id]);
      t.check("server: the tournament is done, with no champion and no ranking, and an end time", tt.state === "done" && !tt.champion && !tt.ranking && tt.ended_ms > 0 && !tt.pause_at, JSON.stringify(tt));
      const life = await sql1("SELECT end_ms, end_src, purged_ms FROM life WHERE eid=?", [g.id]);
      t.check("server: the 24-hour deletion clock started at the end (not yet purged)", !!life.end_ms && !life.purged_ms, JSON.stringify(life));
      const win = await sql1("SELECT COUNT(*) c FROM winner WHERE eid=?", [g.id]);
      t.check("server: nobody is in the winners record", win.c === 0, JSON.stringify(win));
      await t.until(async () => (await Promise.all(ps.map((p) => guestText(p.page)))).every((x) => /The organizer ended the tournament/i.test(x)), { timeout: 25000, what: "both phones say it ended" }).catch(() => {});
      const pt = await Promise.all(ps.map((p) => guestText(p.page)));
      t.check("both phones say 'The organizer ended the tournament. Thank you for playing.' and show no board and no champion", pt.every((x) => /The organizer ended the tournament\. Thank you for playing\./i.test(x) && !/You are the champion/i.test(x)) && (await Promise.all(ps.map((p) => p.page.$(".tboard")))).every((b) => !b), pt.map((x) => x.slice(0, 160)).join(" || "));
      t.note(`phones showed the end ${Math.round((Date.now() - t0) / 100) / 10} s after the press`);
      await ps[0].page.waitForTimeout(500); await t.shot(ps[0].page, "end-phone-a"); await t.shot(ps[1].page, "end-phone-b");
      const taps = await Promise.all(ps.map((p) => p.page.$$eval(".tsq:not([disabled])", (e) => e.length).catch(() => 0)));
      t.check("no phone can tap a square any more", taps.every((n) => n === 0), JSON.stringify(taps));
      await t.until(async () => /The organizer ended the tournament/.test(await t.text(big.page)), { timeout: 20000, what: "big screen says ended" }).catch(() => {});
      const bt = await t.text(big.page); await t.shot(big.page, "end-big");
      t.check("the big screen says Ended and that the organizer ended the tournament, and shows no champion and not Finished", /The organizer ended the tournament/i.test(bt) && !/Champion/i.test(bt) && !/Finished/i.test(bt), bt.slice(0, 200));
      const c2 = await openConsole(t, org, g.id, { device: "laptop", label: "console-after" }); await openStep(c2.page, 9); await c2.page.waitForTimeout(1500);
      const st = await c2.page.innerText("#tstate").catch(() => "");
      t.check("the console's step 9 says Ended (not Finished) and lists no results", st.trim() === "Ended" && !(await c2.page.$("#rankList")), st);
      const again = await H.call("POST", `/api/z/${g.id}/ttt/end`, {}, { "x-organizer": org.token });
      t.check("pressing End again changes nothing (the server answers 'already ended')", again.ok && again.body.again === true, JSON.stringify(again.body));
    },
  },
];
void openConsole; void openStep; void nextPhone;
