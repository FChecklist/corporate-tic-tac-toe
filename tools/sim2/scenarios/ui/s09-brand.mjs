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
      const pv = await t.open({ device: "mobile", token: org.token }); await pv.page.goto(`${H.SIM}/preview.html#w=ticket&e=${g.id}`); await pv.page.waitForTimeout(1800);
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
    id: "S09-04", name: "The installed app (service worker) shows the logo and company name again with the network OFF",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: false });
      await org.settings(g.id, { brand: { name: "Offline Foods", color: "#1B7F5C", logo: await dataUrlOf(tinyPng("off-logo.png", 128, 128)) } }); await org.publish(g.id);
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/z?e=${g.id}`); await x.page.waitForTimeout(1500);
      await x.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller ? true : navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)), null, { timeout: 15000 }).catch(() => {});
      await x.page.waitForTimeout(3000);
      t.check("the strip with the logo shows online", !!(await logoBox(x.page)) && /Offline Foods/.test(await t.text(x.page)));
      await x.ctx.setOffline(true); await x.page.reload().catch(() => {}); await x.page.waitForTimeout(2500);
      const off = await t.text(x.page);
      t.check("with the network off the page still opens (saved on the device)", off.length > 40, off.slice(0, 160));
      t.check("and still shows the company name and the logo", /Offline Foods/.test(off) && !!(await logoBox(x.page)), off.slice(0, 200));
      await t.shot(x.page, "offline-brand"); await x.ctx.setOffline(false);
    },
  },
];
