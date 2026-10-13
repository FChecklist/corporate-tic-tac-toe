// Group 9: the brand on the ticket and in the documents. Organizer AND Host can set the logo; without one the ticket says CORPORATE TIC TAC TOE in writing.
import { H, openConsole, openStep, chip, saveStep, tinyPng } from "./kit.mjs";

const logoBox = (page) => page.evaluate(() => { const i = document.querySelector(".zbrand img.zblogo, .zblogo, .blogo"); if (!i) return null; const r = i.getBoundingClientRect(); return { ok: i.naturalWidth > 0, h: Math.round(r.height), w: Math.round(r.width) }; });
const dataUrlOf = async (path) => { const { readFileSync } = await import("node:fs"); return "data:image/png;base64," + readFileSync(path).toString("base64"); };

export default [
  {
    id: "S09-01", name: "No logo set: the guest ticket page, the preview and the big screen say CORPORATE TIC TAC TOE in writing",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: true });
      const p = await t.open({ device: "mobile" }); await p.page.goto(`${H.SIM}/z?e=${g.id}`); await p.page.waitForTimeout(1800);
      const strip = await p.page.evaluate(() => { const s = document.querySelector(".zbrand"); return s ? s.innerText.trim() : ""; });
      t.check("the guest ticket page carries a strip that says CORPORATE TIC TAC TOE", /CORPORATE TIC TAC TOE/.test(strip), strip);
      const pv = await t.open({ device: "mobile", token: org.token }); await pv.page.goto(`${H.SIM}/preview.html#w=player&e=${g.id}`); await pv.page.waitForTimeout(1800);
      t.check("the preview shows the same default strip", /CORPORATE TIC TAC TOE/.test(await t.text(pv.page)));
      const b = await t.open({ device: "laptop" }); await b.page.goto(`${H.SIM}/big.html?e=${g.id}`); await b.page.waitForTimeout(2000);
      t.check("the big screen says Corporate Tic Tac Toe and shows no logo", /Corporate Tic Tac Toe/i.test(await t.text(b.page)) && !(await logoBox(b.page)));
    },
  },
  {
    id: "S09-02", name: "The Organizer uploads a logo in the console: it shows on the ticket, the preview and the big screen, at a size that fits",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: false });
      const x = await openConsole(t, org, g.id);
      await openStep(x.page, 4); await x.page.fill("#f-brand-name", "Sim Industries"); await chip(x.page, "brand.color", "#1B7F5C");
      await x.page.setInputFiles("#brandlogo", tinyPng("org-logo.png", 256, 256)); await x.page.waitForTimeout(1500); await saveStep(x.page, 4);
      await org.publish(g.id);
      const b = (await org.info(g.id)).body.brand;
      t.check("the logo is stored", /^data:image\//.test(b?.logo ?? ""));
      const p = await t.open({ device: "mobile" }); await p.page.goto(`${H.SIM}/z?e=${g.id}`); await p.page.waitForTimeout(1800);
      const lb = await logoBox(p.page);
      t.check("the logo shows on the guest ticket page: loaded, 30 px high, not wider than 96 px", lb && lb.ok && lb.h >= 24 && lb.h <= 34 && lb.w <= 100, JSON.stringify(lb));
      t.check("the company name shows next to it", /Sim Industries/.test(await t.text(p.page)));
      const big = await t.open({ device: "laptop" }); await big.page.goto(`${H.SIM}/big.html?e=${g.id}`); await big.page.waitForTimeout(2000);
      const bb = await logoBox(big.page);
      t.check("the big screen shows the logo and the company name", bb && bb.ok && bb.h >= 30 && /Sim Industries/.test(await t.text(big.page)), JSON.stringify(bb));
      await t.shot(p.page, "ticket-with-logo"); await t.shot(big.page, "big-with-logo");
    },
  },
  {
    id: "S09-03", name: "A Host can set and change the logo too; a Co-host cannot; a bad logo is refused by the server with a plain reason",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: true });
      const hmail = t.mail("h"); t.team.add(hmail); const hmob = t.phone();
      const inv = await org.inviteHost({ label: "Hema", email: hmail, mobile: hmob });
      const first = await new H.Host(inv.hostKey).firstOpen({ email: hmail, mobile: hmob }); const hkey = first.token || inv.hostKey; // the Host finishes the first-open steps like a real Host
      const host = (body) => H.call("PATCH", `/api/z/${g.id}/settings`, body, { "x-organizer": hkey });
      const logo = await dataUrlOf(tinyPng("host-logo.png", 192, 96));
      const r1 = await host({ brand: { name: "Host Brand", color: "#6A1B9A", logo } });
      t.check("a Host can set the brand and logo", r1.status === 200, `${r1.status} ${JSON.stringify(r1.body).slice(0, 160)}`);
      t.check("the logo is stored for the game", /^data:image\/png/.test(((await org.info(g.id)).body.brand?.logo) ?? ""));
      const r2 = await host({ brand: { name: "Host Brand 2", color: "#6A1B9A", logo: await dataUrlOf(tinyPng("host-logo2.png", 100, 100)) } });
      t.check("the Host can change it again", r2.status === 200 && (await org.info(g.id)).body.brand?.name === "Host Brand 2", `${r2.status}`);
      const c = await org.inviteCohost({ label: "Chandra", phone: t.phone(), e: g.id });
      await (await import("./kit.mjs")).acceptRole(c.cohostKey);
      const rc = await H.call("PATCH", `/api/z/${g.id}/settings`, { brand: { name: "Hack", color: "#6A1B9A" } }, { "x-organizer": c.cohostKey });
      t.check("a Co-host cannot change the brand", rc.status === 403 || rc.status === 401, `${rc.status}`);
      const small = await host({ brand: { name: "X", color: "#6A1B9A", logo: await dataUrlOf(tinyPng("tiny.png", 20, 20)) } });
      t.check("a logo that is too small is refused with a reason that names the size", small.status === 400 && /small|pixels/i.test(JSON.stringify(small.body)), `${small.status} ${JSON.stringify(small.body).slice(0, 160)}`);
      const wide = await host({ brand: { name: "X", color: "#6A1B9A", logo: await dataUrlOf(tinyPng("wide.png", 190, 30)) } });
      t.check("a logo that is too long and thin is refused", wide.status === 400 && /thin|wider/i.test(JSON.stringify(wide.body)), `${wide.status} ${JSON.stringify(wide.body).slice(0, 160)}`);
      const p = await t.open({ device: "mobile" }); await p.page.goto(`${H.SIM}/z?e=${g.id}`); await p.page.waitForTimeout(1800);
      t.check("the guest sees the Host's last brand with the logo", /Host Brand 2/.test(await t.text(p.page)) && !!(await logoBox(p.page)));
    },
  },
  {
    id: "S09-04", name: "The installed app (service worker) opens the player's page with the network OFF from the copy saved on the phone; it says plainly that it cannot connect (never a blank page) and works again when the network returns",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: false });
      await org.settings(g.id, { brand: { name: "Offline Foods", color: "#1B7F5C", logo: await dataUrlOf(tinyPng("off-logo.png", 128, 128)) } }); await org.publish(g.id);
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/z?e=${g.id}`); await x.page.waitForTimeout(1500);
      await x.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller ? true : navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)), null, { timeout: 15000 }).catch(() => {});
      await x.page.waitForTimeout(3000);
      t.check("online: the strip with the logo shows", !!(await logoBox(x.page)) && /Offline Foods/.test(await t.text(x.page)));
      await x.ctx.setOffline(true); await x.page.reload().catch(() => {}); await x.page.waitForTimeout(3000);
      const off = await t.text(x.page);
      t.check("with the network off the page still opens (saved on the device) and is not blank", off.length > 40, off.slice(0, 160));
      t.check("it tells the person in words that the terms or the game could not be loaded, or that there is no connection", /could not be loaded|check your connection|No connection|Trying again/i.test(off), off.slice(0, 260));
      await t.shot(x.page, "offline-player"); await x.ctx.setOffline(false);
      await x.page.reload(); await x.page.waitForTimeout(2500);
      t.check("back online the page is whole again: the brand and the join boxes are there", /Offline Foods/.test(await t.text(x.page)) && !!(await x.page.$(".tb input[data-box]")), (await t.text(x.page)).slice(0, 200));
    },
  },
  {
    id: "S09-05", name: "No page shows an internal note (who asked for wording, legal or review status, the old company name) and no page talks about another game: public pages, join and waiting pages, tournament pages, the big screen, the console steps",
    async run(t) {
      // the same pattern as apps/web/test/no-internal-notes.test.ts, applied to what a person actually reads on the screen
      const NOTES = /COUNSEL|\[●\]|legal(ly)?\s+(review|pending|sign-?off)|review\s+pending|pending\s+(legal|review|approval)|awaiting\s+(legal|counsel|lawyer|approval|review)|\blawyer\b|\badvocate\b|owner'?s?\s+(told|instruction|order|directive|decision)|\bTODO\b|\bFIXME\b|under review|not yet (reviewed|approved)|Shobha|Owner told/i;
      const OTHER = /\b(bingo|tambola|housie|snakes|ladders|daub\w*|blackout|full house|four corners|lucky draw|call board|first number|75 numbers)\b/i;
      const seen = [], notes = [], other = [];
      const org = await t.org("o"); const g = await t.game(org, { settings: { whoCanJoin: "list" }, pay: true });
      const open = await t.game(org, { settings: { whoCanJoin: "anyone" }, pay: true });
      const x = await t.open({ device: "laptop", token: org.token });
      const scan = async (label) => {
        const tx = await x.page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll(".cg-bar, script, style").forEach((e) => e.remove()); return c.innerText || c.textContent || ""; }).catch(() => "");
        const src = await x.page.content().catch(() => "");
        const visible = tx.replace(/\s+/g, " ");
        seen.push(label);
        const n = visible.match(NOTES) || src.match(NOTES); if (n) notes.push(`${label}: ${n[0]}`);
        const o = visible.match(OTHER); if (o) other.push(`${label}: ${o[0]}`);
      };
      const go = async (u, wait = 700) => { await x.page.goto(H.SIM + u, { waitUntil: "domcontentloaded" }).catch(() => {}); await x.page.waitForTimeout(wait); await scan(u); };
      for (const u of ["/", "/signin.html", "/organizer-guide.html", "/trust.html", "/terms.html", "/legal.html", "/dpa.html", "/subprocessors.html", "/partner.html", "/partner-terms.html", "/demo.html", "/brochure.html", "/ai-link.html", "/pricing.html", "/about.html", "/contact.html", "/refund-policy.html", "/legal-position.html", "/404-nothing-here"]) await go(u);
      await go(`/z?e=${g.id}`, 1500); await go(`/z?e=${open.id}`, 1500);
      await go(`/big.html?e=${open.id}`, 2500); await go(`/host.html?e=${open.id}`, 2000); await go(`/preview.html#w=player&e=${open.id}`, 1500); await go(`/pay.html?e=${g.id}`, 1500);
      const ph = await t.open({ device: "mobile" }); await ph.page.goto(`${H.SIM}/z?e=${open.id}`); const { joinForm } = await import("./kit.mjs"); await joinForm(ph.page, "", "Scan Sam"); await ph.page.waitForTimeout(2500);
      { const tx = (await ph.page.innerText("body")).replace(/\s+/g, " "); seen.push("player: you are in"); const n = tx.match(NOTES); if (n) notes.push("player: " + n[0]); const o = tx.match(OTHER); if (o) other.push("player: " + o[0]); }
      await x.page.goto(`${H.SIM}/zc?e=${g.id}`); await x.page.waitForSelector(".zc-sech"); await x.page.waitForTimeout(800);
      for (let n = 1; n <= 10; n++) { const { openStep } = await import("./kit.mjs"); await openStep(x.page, n).catch(() => {}); await x.page.waitForTimeout(300); await scan(`console step ${n}`); }
      t.check(`no internal note or old company name on any of the ${seen.length} screens`, notes.length === 0, notes.join(" ; ").slice(0, 400));
      t.check(`no screen talks about another game (Bingo, Tambola, Snakes and Ladders, cards, numbers called, lucky draw) in ${seen.length} screens`, other.length === 0, other.join(" ; ").slice(0, 600));
    },
  },
];
