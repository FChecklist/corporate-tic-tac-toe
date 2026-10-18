// Group 12: Help Desk (docs/HELPDESK_SPEC.md). A Refer & earn partner (the helper) prepares games for an Organizer, who allows it, publishes with one tap, and can stop it.
// Everything is driven through the real pages (helpdesk.html, helpdesk-accept.html, helpdesk-approve.html, the console zc) in real Chrome, with the e-mail sink and the test payment of the sim.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { H, openConsole, openStep, chip, saveStep, tickTerms, passK5Gate, setupSendUi, nextPhone, payOnPage, payStatus } from "./kit.mjs";

// ------------------------------------------------------------------------------------------------ helpers
const pk = (key) => (key ? { "x-partner": key } : {});
const hd = (method, path, body, key, opts) => H.call(method, path, body, pk(key), opts);
/** a call that does not tick anything on the way (the harness retries a 'consent-required' answer with ticks: right for a person, wrong for a check that the server refuses without them) */
const rawCall = async (method, path, body, headers = {}) => { const r = await fetch(H.SIM + path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { text }; } return { status: r.status, body: j, ok: r.ok }; };
const asKey = (key) => (method, path, body) => H.call(method, path, body, { "x-organizer": key });
const tokenIn = (m, page) => new RegExp(`${page}\\.html\\?t=([0-9a-f]{48})`).exec(m.text)?.[1] ?? null;
const mailsTo = async (to, re) => (await H.mailbox.list({ to })).filter((m) => !re || re.test(m.subject));
/** waits for a mail to `to` whose subject matches `re`, newer than the first `have` such mails; returns the newest */
async function newMail(t, to, re, have = 0) { return t.until(async () => { const l = await mailsTo(to, re); return l.length > have ? l[l.length - 1] : null; }, { what: `mail to ${to} ${re}`, timeout: 10000 }); }

/** A Refer & earn partner through the API (the same two steps as the page), who has turned Help Desk on. */
async function mkHelper(t, { name = "Hema Helper", join = true } = {}) {
  const email = t.mail("hp"), phone = t.phone(), ip = t.ip();
  const a = await H.call("POST", "/api/partner/enroll", { phone, email, name, consent: true }, {}, { ip });
  if (!a.ok) throw new Error("partner enroll " + JSON.stringify(a.body));
  const code = a.body.devCode ?? H.mailbox.code(await H.mailbox.waitFor({ to: email, subject: "code" }));
  const v = await H.call("POST", "/api/partner/enroll/verify", { email, code }, {}, { ip });
  if (!v.ok) throw new Error("partner verify " + JSON.stringify(v.body));
  const h = { name, email, phone, key: v.body.partnerKey, code: v.body.code, ip };
  if (join) { const j = await hd("POST", "/api/helpdesk/join", { email }, h.key, { ip }); if (!j.ok) throw new Error("join " + JSON.stringify(j.body)); }
  return h;
}
const me = async (h) => (await hd("GET", "/api/helpdesk/me", undefined, h.key)).body;
const clientOf = async (h, id) => (await me(h)).clients.find((c) => c.id === id);

/** The helper invites `org.email`; returns the link id and the token of the e-mailed accept link. */
async function invite(t, h, org, name = "Boss") {
  const have = (await mailsTo(org.email, /asks to prepare/)).length;
  const r = await hd("POST", "/api/helpdesk/invite", { email: org.email, name }, h.key, { ip: h.ip });
  if (!r.ok) throw new Error("invite " + JSON.stringify(r.body));
  const m = await newMail(t, org.email, /asks to prepare/, have);
  return { id: r.body.id, token: tokenIn(m, "helpdesk-accept"), mail: m };
}
/** The Organizer's Allow through the API (the page does exactly this call). */
const allow = (org, token) => org.api("POST", "/api/helpdesk/accept", { t: token, consent: true });

/** helper + Organizer + invitation + Allow. Returns everything a scenario needs, including the helper's AI key. */
async function world(t, { orgTag = "o", helper } = {}) {
  const h = helper ?? (await mkHelper(t));
  const org = await t.org(orgTag);
  const inv = await invite(t, h, org);
  const a = await allow(org, inv.token); if (!a.ok) throw new Error("allow " + JSON.stringify(a.body));
  const c = await clientOf(h, inv.id);
  const aiKey = /k=(cba_[0-9a-f]{48})/.exec(c.consoleUrl)[1];
  const orgId = (await H.sql("SELECT org FROM helpdesk_link WHERE id=?", [inv.id]))[0].org;
  return { h, org, link: inv, aiKey, orgId, ai: asKey(aiKey), asHelper: new H.Organizer(org.email, aiKey) };
}

/** The helper's AI key creates a draft game in the Organizer's account (what the console does at "Start a new game"). */
async function helperGame(w, o = {}) { return w.asHelper.createGame({ leadMs: 3 * H.HOUR, ...o }); }
/** the helper taps "Ask the Organizer to publish" through the API, returns the token of the e-mailed approval link */
async function askPublish(t, w, eid) {
  const have = (await mailsTo(w.org.email, /asks you to publish/)).length;
  const r = await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid }, w.h.key, { ip: w.h.ip });
  if (!r.ok) throw new Error("request-publish " + JSON.stringify(r.body));
  const m = await newMail(t, w.org.email, /asks you to publish/, have);
  return { token: tokenIn(m, "helpdesk-approve"), mail: m };
}
/** the sign-in code mailed to `to` after `have` mails existed (the subject of the sign-in mail is not fixed: find the mail that holds a 6-digit code) */
const codeMail = (t, to, have) => t.until(async () => { const l = await mailsTo(to); return l.length > have ? l.slice(have).reverse().find((m) => H.mailbox.code(m)) : null; }, { what: `sign-in code for ${to}`, timeout: 10000 });
/** Put the helper's partner key in the browser the way the page keeps it after sign-in. */
const withPartnerKey = (x, key) => x.ctx.addInitScript((k) => { try { if (location.hostname === "localhost") localStorage.setItem("cbz-pkey", k); } catch { /* storage blocked */ } }, key);

/** The Organizer's accept page as a person: e-mail, code, Allow. */
async function acceptUi(t, page, org, tok, { email = org.email, allowIt = true } = {}) {
  await page.goto(`${H.SIM}/helpdesk-accept.html?t=${tok}`);
  await page.waitForSelector("#em", { timeout: 12000 });
  const have = (await mailsTo(email)).length;
  await page.fill("#em", email); await tickTerms(t, page, { scope: "#hdtb", btn: "#go", what: "Accept page sign-in (K2)" }); await page.click("#go"); await page.waitForSelector("#cd", { timeout: 10000 });
  const m = await codeMail(t, email, have);
  await page.fill("#cd", H.mailbox.code(m)); await page.click("#go");
  if (allowIt) await page.waitForSelector("#ok", { timeout: 10000 });
}
/** The approve page as a person: confirmation fields, K1 boxes, Publish. */
async function approveUi(t, page, tok, org, { phone = "9811122233", tick = true } = {}) {
  await page.goto(`${H.SIM}/helpdesk-approve.html?t=${tok}`);
  await page.waitForSelector("#pub", { timeout: 12000 });
  await page.fill("#em", org.email); await page.fill("#ph", phone);
  if (tick) await tickTerms(t, page, { scope: "#hdtb", btn: "#pub", what: "Approve page" });
}
/** "Start a new game" in the console with the helper's AI key, then steps 1 to 3 by tapping. Returns the game id. */
async function buildInConsole(t, w, { device, wpx, hpx, label }) {
  const x = await t.open({ device, w: wpx, h: hpx, token: w.aiKey, label });
  await x.page.goto(`${H.SIM}/zc`); await x.page.waitForSelector("#mk", { timeout: 15000 });
  t.check(`${label}: the helper's console opens on the empty state ('Start a new game')`, true);
  await x.page.click("#mk"); await x.page.waitForSelector(".zc-sech", { timeout: 15000 });
  await x.page.waitForFunction(() => /[?&]e=/.test(location.search), null, { timeout: 8000 });
  const eid = new URL(x.page.url()).searchParams.get("e");
  await openStep(x.page, 1); await chip(x.page, "occ", "Customer event");
  const days = await x.page.$$eval('[data-ck="day"]', (els) => els.map((e) => e.dataset.v).filter((v) => v !== "other"));
  await chip(x.page, "day", days[2]); await chip(x.page, "time", "19:00"); await saveStep(x.page, 1);
  await openStep(x.page, 2); await chip(x.page, "cap", 500); await saveStep(x.page, 2);
  await openStep(x.page, 3); await chip(x.page, "bundle", "Simple"); await saveStep(x.page, 3);
  await t.shot(x.page, `${label}-built`);
  return eid;
}
/** A world where the Organizer has already published the helper's game (through the same three calls the approve page makes). Adds g, deskUrl, hostKey, hostAiKey to the world. */
async function publishedWorld(t, o = {}) {
  const w = await world(t, o);
  const g = await helperGame(w, { cfg: { name: "Annual Day" } });
  const have = (await mailsTo(w.h.email, /is published/)).length;
  const a = await askPublish(t, w, g.id);
  const st = await H.call("POST", "/api/helpdesk/approve/start", { t: a.token });
  const pub = await H.call("POST", `/api/z/${g.id}/publish`, { email: w.org.email, phone: "9811122233" }, { "x-organizer": st.body.key });
  if (!pub.ok) throw new Error("publish " + JSON.stringify(pub.body));
  const dn = await H.call("POST", "/api/helpdesk/approve/done", { t: a.token });
  if (!dn.ok) throw new Error("done " + JSON.stringify(dn.body));
  const mail = await newMail(t, w.h.email, /is published/, have);
  const url = /OPEN MY HOST CONSOLE: (\S+)/.exec(mail.text)?.[1];
  const u = url ? new URL(url) : null;
  return Object.assign(w, { g, approval: a, deskUrl: u ? H.SIM + u.pathname + u.search : null, hostKey: url ? /k=(cbh_[0-9a-f]{48})/.exec(url)[1] : null, hostAiKey: /\/ai\/(cbh_[0-9a-f]{48})/.exec(mail.text)[1], pubMail: mail });
}
/** The Host's first open in the UI on a phone: e-mail code, mobile; returns the page and the Host's own device key. */
async function hostFirstOpenUi(t, link, email) {
  const h = await t.open({ device: "mobile", label: "helper-host" });
  await h.page.goto(link); await h.page.waitForSelector("#finishsetup", { timeout: 15000 });
  if (await h.page.$("#setupemail")) {
    const have = (await mailsTo(email)).length;
    await setupSendUi(h.page, email);
    const m = await codeMail(t, email, have); await h.page.fill("#setupcode", H.mailbox.code(m)); await h.page.click("#setupverify");
    await h.page.waitForFunction(() => !document.getElementById("setupcode"), null, { timeout: 15000 });
  }
  if (await h.page.$("#setupmobile")) { await h.page.fill("#setupmobile", nextPhone()); await h.page.click("#setupmobilego"); }
  await h.page.waitForSelector(".zc-sech, #mk, .zc-main", { timeout: 15000 }); await h.page.waitForTimeout(700);
  return { h, key: await h.page.evaluate(() => sessionStorage.getItem("cbz-org")) };
}
const isPublished = async (org, eid) => /published/i.test((await org.summary(eid)).body.status ?? "") || (await org.info(eid)).body.published === true;

export default [
  {
    id: "S12-01", name: "A helper enrols in Refer & earn on the page, turns on Help Desk; a different e-mail is refused (page and API), the right one works",
    async run(t) {
      const email = t.mail("hp"), phone = t.phone();
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/partner`); await x.page.waitForSelector("#join");
      await x.page.fill("#ph", phone); await x.page.fill("#em", email); await x.page.fill("#nm", "Hema Helper"); await x.page.check("#ok");
      await x.page.click("#join"); await x.page.waitForSelector("#cd", { timeout: 10000 });
      const m = await newMail(t, email, /code/i); await x.page.fill("#cd", H.mailbox.code(m)); await x.page.click("#cdgo");
      await x.page.waitForSelector("#mylink", { timeout: 10000 });
      const key = await x.page.evaluate(() => localStorage.getItem("cbz-pkey"));
      t.check("Refer & earn enrolment gave a partner key", /^cbp_/.test(key ?? ""), String(key).slice(0, 8));
      await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("#app .zcard");
      t.check("signed in with the same device key, Help Desk offers to turn it on", !!(await x.page.$("#on")) && /Turn on Help Desk/.test(await t.text(x.page, "#app")), (await t.text(x.page, "#app")).slice(0, 160));
      await t.shot(x.page, "join-view");
      await x.page.fill("#em", t.mail("other")); await x.page.click("#on");
      await x.page.waitForSelector("#app .zbanner.bad", { timeout: 8000 });
      t.check("another e-mail is refused with a plain message", /not the e-?mail address you joined/i.test(await t.text(x.page, "#app .zbanner.bad")), await t.text(x.page, "#app .zbanner.bad"));
      t.check("nothing was turned on yet", (await me({ key })).joined === false);
      t.check("API: join with another e-mail is 403", (await hd("POST", "/api/helpdesk/join", { email: t.mail("o2") }, key)).status === 403);
      t.check("API: join without a partner key is 403", (await hd("POST", "/api/helpdesk/join", { email })).status === 403);
      t.check("API: a made-up partner key is 403", (await hd("POST", "/api/helpdesk/join", { email }, "cbp_" + "0".repeat(40))).status === 403);
      await x.page.fill("#em", email); await x.page.click("#on");
      await x.page.waitForSelector("#inv", { timeout: 8000 });
      t.check("the right e-mail turns Help Desk on and shows the 'Add an Organizer' form", /Add an Organizer/.test(await t.text(x.page, "#app")) && (await me({ key })).joined === true);
      t.check("the sealed e-mail is not stored in clear", !JSON.stringify(await H.sql("SELECT * FROM helpdesk_helper")).includes(email));
      await t.shot(x.page, "dashboard-empty");
    },
  },
  {
    id: "S12-02", name: "The helper invites an Organizer on the page: mail arrives with the accept link; a duplicate and the helper's own address are refused; no account-existence leak",
    async run(t) {
      const h = await mkHelper(t); const known = await t.org("o"); const unknown = t.mail("new");
      const x = await t.open({ device: "mobile" }); await withPartnerKey(x, h.key);
      await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("#inv");
      await x.page.fill("#oe", known.email); await x.page.fill("#on", "Boss"); await x.page.click("#inv");
      await x.page.waitForSelector("#app .zbanner.ok", { timeout: 8000 });
      t.check("the page says the invitation is on its way", /on its way/i.test(await t.text(x.page, "#app .zbanner.ok")));
      const m = await newMail(t, known.email, /asks to prepare/);
      t.check("the Organizer's mail has the accept link and the promise 'Nothing is published or paid without your OK'", !!tokenIn(m, "helpdesk-accept") && /Nothing is published or paid without your OK/.test(m.text), m.text.slice(0, 200));
      t.check("the mail names the helper", /Hema Helper/.test(m.subject + m.text), m.subject);
      t.check("the helper's list shows the client, waiting for the Organizer", /Waiting for the Organizer to allow/.test(await t.text(x.page, "#app")) && !(await x.page.$("[data-client] a[href*='zc.html']")), (await t.text(x.page, "#app")).slice(0, 200));
      await t.shot(x.page, "invited");
      // the same address again is refused, in the page too
      await x.page.fill("#oe", known.email); await x.page.click("#inv"); await x.page.waitForSelector("#app .zbanner.bad", { timeout: 8000 });
      t.check("a second invitation to the same address is refused", /already have this client/i.test(await t.text(x.page, "#app .zbanner.bad")), await t.text(x.page, "#app .zbanner.bad"));
      t.check("API: the helper's own address is refused", (await hd("POST", "/api/helpdesk/invite", { email: h.email }, h.key)).status === 400);
      t.check("API: a bad address is refused", (await hd("POST", "/api/helpdesk/invite", { email: "nope" }, h.key)).status === 400);
      // no leak: an address with an account and one without get the very same answer shape
      const a = await hd("POST", "/api/helpdesk/invite", { email: unknown }, h.key), b = await hd("POST", "/api/helpdesk/invite", { email: t.mail("new2") }, h.key);
      const shape = (r) => `${r.status} ${Object.keys(r.body).sort().join(",")}`;
      t.check("answer for an address with an account and one without is the same shape", shape(a) === shape(b) && a.ok, `${shape(a)} / ${shape(b)}`);
      const known2 = await hd("POST", "/api/helpdesk/invite", { email: (await t.org("o3")).email }, h.key);
      t.check("an address that already has an account gets the same answer shape too", shape(known2) === shape(a), shape(known2));
      t.check("a partner who did not turn Help Desk on cannot invite", (await hd("POST", "/api/helpdesk/invite", { email: t.mail("z") }, (await mkHelper(t, { join: false })).key)).status === 403);
    },
  },
  {
    id: "S12-03", name: "Invite limits: 5 per hour per helper, 3 a day per Organizer address across helpers",
    async run(t) {
      const h = await mkHelper(t);
      let last;
      for (let i = 0; i < 5; i++) { last = await hd("POST", "/api/helpdesk/invite", { email: t.mail("lim") }, h.key); if (!last.ok) break; }
      t.check("five invitations in an hour go through", last.ok, JSON.stringify(last.body));
      const sixth = await hd("POST", "/api/helpdesk/invite", { email: t.mail("lim") }, h.key);
      t.check("the sixth in the same hour is refused (429) kindly", sixth.status === 429 && /enough invitations/i.test(sixth.body.error ?? ""), JSON.stringify(sixth.body));
      // 3 a day per Organizer address, across three different helpers; the fourth helper is told to wait
      const shared = t.mail("shared");
      const hs = [await mkHelper(t), await mkHelper(t), await mkHelper(t), await mkHelper(t)];
      const rs = []; for (const x of hs) rs.push((await hd("POST", "/api/helpdesk/invite", { email: shared }, x.key)).status);
      t.check("three helpers can invite the same Organizer address in a day, the fourth cannot", rs.slice(0, 3).every((s) => s === 200) && rs[3] === 429, rs.join(","));
      t.check("the Organizer got exactly three mails", (await mailsTo(shared, /asks to prepare/)).length === 3);
      // the page shows the refusal as a message
      const x = await t.open({ device: "mobile" }); await withPartnerKey(x, hs[3].key);
      await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("#inv"); await x.page.fill("#oe", shared); await x.page.click("#inv");
      await x.page.waitForSelector("#app .zbanner.bad", { timeout: 8000 });
      t.check("the page shows 'tomorrow' wording, not a code", /tomorrow/i.test(await t.text(x.page, "#app .zbanner.bad")), await t.text(x.page, "#app .zbanner.bad"));
    },
  },
  {
    id: "S12-04", name: "The Organizer opens the accept page, signs in with the e-mailed code, reads the promise, taps Allow; the helper is told and gets console + AI link; consent is required",
    async run(t) {
      const h = await mkHelper(t); const org = await t.org("o"); const inv = await invite(t, h, org);
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv.token}`); await x.page.waitForSelector("#em", { timeout: 12000 });
      t.check("the token leaves the address bar at once", !x.page.url().includes(inv.token), x.page.url());
      const txt0 = await t.text(x.page, "#app");
      t.check("the page shows who asks and the five promise points", /Hema Helper/.test(txt0) && (await x.page.$$("ol li")).length === 5, txt0.slice(0, 200));
      t.check("the promise says they cannot publish or pay and can be stopped at any time", /cannot publish a game, pay/.test(txt0) && /stop this at any time/.test(txt0));
      t.check("the masked address is shown, not the full one", /\*|•|…|\.\.\./.test(txt0.match(/sent to \(([^)]*)\)/)?.[1] ?? "") && !txt0.includes(org.email), txt0.match(/sent to \(([^)]*)\)/)?.[1]);
      t.check("opening the link allowed nothing yet", (await clientOf(h, inv.id)).state === "invited");
      await t.shot(x.page, "accept-signin");
      const have0 = (await mailsTo(org.email)).length;
      await x.page.fill("#em", org.email); await tickTerms(t, x.page, { scope: "#hdtb", btn: "#go", what: "Accept page sign-in (K2)" }); await x.page.click("#go"); await x.page.waitForSelector("#cd", { timeout: 10000 });
      const m = await codeMail(t, org.email, have0); await x.page.fill("#cd", H.mailbox.code(m)); await x.page.click("#go");
      await x.page.waitForSelector("#ok", { timeout: 10000 });
      t.check("after sign-in the page offers Allow and 'Not now', still nothing allowed", !!(await x.page.$("#no")) && (await clientOf(h, inv.id)).state === "invited");
      await t.shot(x.page, "accept-allow");
      // consent is required on the server: an Allow without the tick of agreement is refused
      const key = await x.page.evaluate(() => sessionStorage.getItem("cbz-org"));
      const noC = await H.call("POST", "/api/helpdesk/accept", { t: inv.token }, { "x-organizer": key });
      t.check("API: Allow without consent is refused (400, consent-required)", noC.status === 400 && noC.body.code === "consent-required", JSON.stringify(noC.body));
      t.check("API: Allow without signing in is refused (403)", (await H.call("POST", "/api/helpdesk/accept", { t: inv.token, consent: true })).status === 403);
      await x.page.click("#ok"); await x.page.waitForSelector("#stop", { timeout: 10000 });
      t.check("the page says Done and offers Stop", /Done/i.test(await t.text(x.page, "#app")) && /Stop Help Desk/i.test(await t.text(x.page, "#app")));
      await t.shot(x.page, "accept-done");
      const c = await clientOf(h, inv.id);
      t.check("the helper's list: Active with a console link, an AI link and games none", c.state === "active" && /\/zc\.html\?k=cba_/.test(c.consoleUrl) && /\/ai\/cba_/.test(c.aiLink) && c.games.length === 0, JSON.stringify(c).slice(0, 200));
      const told = await newMail(t, h.email, /allowed you/);
      t.check("the helper was told by mail, with the Help Desk link and 'cannot publish or pay'", /helpdesk\.html/.test(told.text) && /cannot publish or pay/.test(told.text), told.text.slice(0, 200));
      const row = (await H.sql("SELECT consent_ms, consent_text_hash, org, ai_key_hash FROM helpdesk_link WHERE id=?", [inv.id]))[0];
      t.check("consent time, text version hash and the Organizer's account are recorded", !!row.consent_ms && /^[0-9a-f]{64}$/.test(row.consent_text_hash) && !!row.org && !!row.ai_key_hash, JSON.stringify(row));
      const key2 = (await H.sql("SELECT kind, created_by, label, revoked FROM organizer_key WHERE hash=?", [row.ai_key_hash]))[0];
      t.check("the helper's key is an AI-kind key made 'by desk', not revoked", key2.kind === "ai" && key2.created_by === "d" && key2.revoked === 0, JSON.stringify(key2));
      t.check("opening the same link again shows it is already active (no second key)", await (async () => { await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv.token}`); await x.page.waitForSelector("#stop"); return (await H.sql("SELECT COUNT(*) c FROM organizer_key WHERE org=? AND created_by='d'", [row.org]))[0].c === 1; })());
      t.check("a second Allow call is refused as used (410)", (await allow(org, inv.token)).status === 410);
      t.check("the Organizer's own list (mine) shows the helper", (await org.api("GET", "/api/helpdesk/mine")).body.helpers?.[0]?.state === "active");
    },
  },
  {
    id: "S12-05", name: "Wrong-account sign-in is refused on the accept page; made-up, malformed and expired tokens show calm messages",
    resetAfter: true,
    async run(t) {
      const h = await mkHelper(t); const org = await t.org("o"), other = await t.org("w"); const inv = await invite(t, h, org);
      const x = await t.open({ device: "mobile" });
      await acceptUi(t, x.page, other, inv.token, { email: other.email });
      await x.page.click("#ok"); await x.page.waitForSelector("#app .zbanner.bad", { timeout: 8000 });
      const txt = await t.text(x.page, "#app");
      t.check("the other account is told the invitation went to a different address", /different e-?mail address/i.test(txt), txt.slice(0, 220));
      t.check("the page went back to sign-in", !!(await x.page.$("#em")) && !(await x.page.$("#ok")));
      t.check("nothing was allowed and no key was made", (await clientOf(h, inv.id)).state === "invited" && (await H.sql("SELECT ai_key_hash FROM helpdesk_link WHERE id=?", [inv.id]))[0].ai_key_hash === null);
      const wr = await allow(other, inv.token);
      t.check("API: wrong account is 403 wrong-account", wr.status === 403 && wr.body.code === "wrong-account", JSON.stringify(wr.body));
      await t.shot(x.page, "accept-wrong-account");
      // bad tokens
      const y = await t.open({ device: "mobile" });
      for (const [tok, re, what] of [["abc", /incomplete/i, "a short token"], ["0".repeat(48), /not valid/i, "a made-up token"]]) {
        await y.page.goto(`${H.SIM}/helpdesk-accept.html?t=${tok}`); await y.page.waitForSelector("#app .zcard", { timeout: 8000 });
        t.check(`${what}: a calm message and no sign-in form`, re.test(await t.text(y.page, "#app")) && !(await y.page.$("#em")), (await t.text(y.page, "#app")).slice(0, 120));
      }
      await y.page.goto(`${H.SIM}/helpdesk-accept.html`); await y.page.waitForSelector("#app .zcard");
      t.check("no token at all: a calm message", /incomplete/i.test(await t.text(y.page, "#app")));
      // expired (14 days)
      await H.clock.advance(15 * H.DAY); await t.shared.track.refresh();
      const z = await t.open({ device: "mobile" });
      await z.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv.token}`); await z.page.waitForSelector("#app .zcard", { timeout: 8000 });
      t.check("an invitation after 14 days says it expired and names the helper", /expired/i.test(await t.text(z.page, "#app")) && /Hema Helper/.test(await t.text(z.page, "#app")) && !(await z.page.$("#em")), (await t.text(z.page, "#app")).slice(0, 160));
      t.check("API: Allow after expiry is refused (410)", (await allow(org, inv.token)).status === 410);
    },
  },
  {
    id: "S12-06", name: "The helper opens the REAL console with the AI key on a 360 px phone and builds a game through the steps; it is the Organizer's game and the Help Desk page lists it",
    async run(t) {
      const w = await world(t);
      const eid = await buildInConsole(t, w, { device: "mobile", wpx: 360, hpx: 780, label: "helper-phone" });
      const i = (await w.org.info(eid)).body;
      t.check("the game belongs to the Organizer's account (the Organizer reads it with their own key)", i.name === "Customer event", JSON.stringify(i).slice(0, 120));
      t.check("step 2 settings were saved (500 people)", i.cap === 500, `${i.cap}`);
      t.check("step 3 prizes were saved (the Simple bundle has its prizes)", (i.rewards ?? []).length >= 1, String((i.rewards ?? []).length));
      t.check("the game is a draft", !(await isPublished(w.org, eid)));
      t.check("the game is recorded as prepared through this link", (await H.sql("SELECT link_id FROM helpdesk_game WHERE eid=?", [eid]))[0]?.link_id === w.link.id);
      t.check("the Organizer's own history lists the game", JSON.stringify((await w.org.history()).body).includes(eid));
      const c = await clientOf(w.h, w.link.id);
      t.check("the helper's list shows the game as not published", c.games.length === 1 && c.games[0].eid === eid && c.games[0].published === false, JSON.stringify(c.games));
    },
  },
  {
    id: "S12-07", name: "The same on a 1280 px laptop: Start a new game, steps 1 to 3, every other step opens without an error",
    async run(t) {
      const w = await world(t);
      const eid = await buildInConsole(t, w, { device: "laptop", label: "helper-laptop" });
      const i = (await w.org.info(eid)).body;
      t.check("name, size and prizes saved on the laptop too", i.name === "Customer event" && i.cap === 500 && (i.rewards ?? []).length >= 1, `${i.name} ${i.cap} ${(i.rewards ?? []).length}`);
      const x = t.pages[t.pages.length - 1];
      for (const n of [4, 5, 6, 7]) await openStep(x.page, n);
      t.check("steps 4 to 7 all open for the helper", !!(await x.page.$("#sec7.open")));
      await t.shot(x.page, "helper-laptop-step7");
    },
  },
  {
    id: "S12-08", name: "The helper cannot publish, pay, close the account, see sign-in keys or add a Host: refused in the console and by the API",
    async run(t) {
      const w = await world(t); const g = await helperGame(w);
      const x = await openConsole(t, w.org, g.id, { device: "laptop", token: w.aiKey, label: "helper-console" });
      // publish through the console
      await openStep(x.page, 7); await x.page.click("#publishopen"); await x.page.waitForSelector("#pubEmail");
      await x.page.fill("#pubEmail", w.org.email); await x.page.fill("#pubPhone", "9811122233");
      await tickTerms(t, x.page, { scope: "[data-tbk^='pub']", btn: "#pubgo", what: "Publish (helper)" }); await x.page.click("#pubgo");
      await x.page.waitForFunction(() => /Only the Organizer publishes/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
      t.check("tapping Publish says plainly 'Not published, only the Organizer publishes' (not 'Published') and nothing is published", /Not published\. Only the Organizer publishes/.test(await t.text(x.page)) && !/Published\. Send the link/.test(await t.text(x.page)) && !(await isPublished(w.org, g.id)), (await t.text(x.page)).slice(-200));
      await t.shot(x.page, "helper-publish-refused");
      // add a Host in the console
      await openStep(x.page, 5);
      await x.page.fill("#hostlabel", "Sneaky"); if (await x.page.$("#hostphone")) await x.page.fill("#hostphone", "9811100099"); await x.page.fill("#hostemail", t.mail("sn"));
      await x.page.click("#hostadd", { timeout: 4000 }).catch(() => {}); await x.page.waitForTimeout(1200);
      t.check("adding a Host in the console creates no Host", (await w.org.team()).body.hosts.length === 0, JSON.stringify((await w.org.team()).body.hosts));
      // account block: no sign-in keys, closing refused
      await x.page.click("[data-acct]").catch(() => {}); await x.page.waitForTimeout(700);
      t.check("the account block lists no sign-in keys", !/Your sign-in keys/i.test(await t.text(x.page)));
      if (await x.page.$("#closeacct")) { x.page.once("dialog", (d) => d.accept()); await x.page.click("#closeacct"); await x.page.waitForTimeout(1200); }
      t.check("closing the account through the console does nothing", (await w.org.whoami()).ok && (await w.org.info(g.id)).ok, "");
      // the API, call by call
      const calls = [
        ["POST", "/api/payments/test", { eid: g.id, email: w.org.email, org: "X", country: "IN" }, "pay (test)"],
        ["POST", "/api/checkout", { eid: g.id, email: w.org.email, org: "X", name: "X Y", country: "IN" }, "pay (checkout)"],
        ["POST", `/api/z/${g.id}/paylink`, {}, "pay link"],
        ["POST", "/api/org/close", { confirm: true }, "close the account"],
        ["GET", "/api/org/keys", undefined, "list sign-in keys"],
        ["POST", "/api/org/keys/revoke", { id: "x" }, "revoke a key"],
        ["POST", "/api/org/host", { label: "Z", email: t.mail("zz") }, "add a Host"],
        ["POST", "/api/org/cohost", { label: "Z", phone: nextPhone(), e: g.id }, "add a Co-host"],
        ["GET", "/api/org/ai/link", undefined, "read the Organizer's AI link"],
        ["POST", "/api/org/ai/replace", {}, "replace the AI link"],
        ["POST", "/api/org/ai/revoke", {}, "revoke the AI link"],
      ];
      const pubTry = await w.ai("POST", `/api/z/${g.id}/publish`, { email: w.org.email, phone: "9811122233" });
      t.check("API: publish with the helper's key only hands the link to the Organizer (published:false, needsOrganizer)", pubTry.body.published === false && pubTry.body.needsOrganizer === true, JSON.stringify(pubTry.body).slice(0, 120));
      for (const [m, p, b, what] of calls) { const r = await w.ai(m, p, b); t.check(`API: ${what} is refused for the helper's key`, r.status === 403 || r.status === 404 || r.status === 405, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`); }
      t.check("the game is still a draft, unpaid", !(await isPublished(w.org, g.id)) && (await payStatus(w.org, g.id)) !== "paid");
      t.check("the helper's key still works for its own job (settings)", (await w.ai("PATCH", `/api/z/${g.id}/settings`, { cap: 120 })).ok);
      t.check("the Organizer's own key can still do all of it (keys list)", (await w.org.api("GET", "/api/org/keys")).ok);
    },
  },
  {
    id: "S12-09", name: "The helper asks the Organizer to publish: button on the Help Desk page, the Organizer's mail has the summary and the approval link, asking again waits",
    async run(t) {
      const w = await world(t); const g = await helperGame(w, { cfg: { name: "Annual Day" } });
      await w.asHelper.settings(g.id, { cap: 150 });
      const x = await t.open({ device: "mobile" }); await withPartnerKey(x, w.h.key);
      await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("[data-client]");
      const card = await t.text(x.page, "[data-client]");
      t.check("the client card shows Active, the game as not published, Open console and Copy my AI link", /Active/.test(card) && /Not published yet/.test(card) && !!(await x.page.$("[data-client] a[href*='zc.html?k=cba_']")) && !!(await x.page.$("[data-copy]")), card.slice(0, 220));
      t.check("the card says a Host comes after publishing", /You become a Host when the Organizer publishes/.test(card));
      await t.shot(x.page, "client-card");
      await x.page.click(`[data-ask="${g.id}"]`);
      await x.page.waitForSelector("#app .zbanner.ok", { timeout: 8000 });
      t.check("the page says the Organizer was e-mailed", /e-?mailed the Organizer/i.test(await t.text(x.page, "#app .zbanner.ok")));
      const m = await newMail(t, w.org.email, /asks you to publish/);
      t.check("the mail has the approval link, a short summary and the promise", !!tokenIn(m, "helpdesk-approve") && /Annual Day/.test(m.text) && /Up to 150 people/.test(m.text) && /Nothing is published or paid until you tap/.test(m.text), m.text.slice(0, 400));
      t.check("the mail does not contain the helper's keys", !/cba_|cbp_|cbh_/.test(m.text));
      // asking again at once waits (page + API)
      await x.page.click(`[data-ask="${g.id}"]`); await x.page.waitForSelector("#app .zbanner.bad", { timeout: 8000 });
      t.check("asking again at once shows 'wait a few minutes'", /wait a few minutes/i.test(await t.text(x.page, "#app .zbanner.bad")), await t.text(x.page, "#app .zbanner.bad"));
      t.check("only one mail was sent", (await mailsTo(w.org.email, /asks you to publish/)).length === 1);
      // other refusals
      const other = await world(t, { helper: w.h });
      const og = await helperGame(other);
      t.check("API: a game prepared through another client is refused (404)", (await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: og.id }, w.h.key)).status === 404);
      const own = await w.org.createGame({ leadMs: 3 * H.HOUR });
      t.check("API: a game the Organizer made themselves is refused (404)", (await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: own.id }, w.h.key)).status === 404);
      t.check("API: another helper cannot ask for this client's game", (await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: g.id }, (await mkHelper(t)).key)).status >= 400);
      t.check("API: no key at all is refused", (await H.call("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: g.id })).status === 403);
      t.check("API: a made-up game id is refused", (await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: "NOPE9999" }, w.h.key)).status === 404);
    },
  },
  {
    id: "S12-10", name: "The approve page: summary shown, the K1 box starts unticked and is required, e-mail and mobile must be confirmed; wrong, replaced and expired tokens are refused",
    resetAfter: true,
    async run(t) {
      const w = await world(t); const g = await helperGame(w, { cfg: { name: "Annual Day" } });
      await w.asHelper.settings(g.id, { cap: 150 });
      const a1 = await askPublish(t, w, g.id);
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/helpdesk-approve.html?t=${a1.token}`); await x.page.waitForSelector("#pub", { timeout: 12000 });
      t.check("the token leaves the address bar at once", !x.page.url().includes(a1.token), x.page.url());
      const txt = await t.text(x.page, "#app");
      t.check("the page names the helper and shows the game name, size and the free-to-publish promise", /Hema Helper asks you to publish/i.test(txt) && /Annual Day/i.test(txt) && /Up to 150 people/i.test(txt) && /Publishing is free/i.test(txt), txt.slice(0, 260));
      t.check("the prizes are listed", /Prizes/i.test(txt));
      await t.shot(x.page, "approve-page");
      const boxes = await x.page.$$eval("#hdtb input[data-box]", (els) => els.map((e) => e.checked));
      t.check("the Terms box (K1) starts unticked", boxes.length >= 1 && boxes.every((b) => !b), JSON.stringify(boxes));
      t.check("Publish is disabled until the box is ticked", await x.page.isDisabled("#pub"));
      // nothing typed: ticks the box, taps Publish
      await tickTerms(t, x.page, { scope: "#hdtb", btn: "#pub", what: "Approve page" });
      await x.page.click("#pub"); await x.page.waitForSelector("#app .zbanner.bad", { timeout: 5000 });
      t.check("an empty e-mail is refused with a plain message", /valid e-?mail/i.test(await t.text(x.page, "#app .zbanner.bad")), await t.text(x.page, "#app .zbanner.bad"));
      await x.page.fill("#em", w.org.email); await tickTerms(t, x.page, { scope: "#hdtb", btn: "#pub", what: "Approve page (again)" });
      await x.page.fill("#ph", "123"); await x.page.click("#pub"); await x.page.waitForSelector("#app .zbanner.bad", { timeout: 5000 });
      t.check("a short mobile number is refused with a plain message", /mobile number/i.test(await t.text(x.page, "#app .zbanner.bad")), await t.text(x.page, "#app .zbanner.bad"));
      t.check("nothing was published and no temporary key was made", !(await isPublished(w.org, g.id)) && (await H.sql("SELECT COUNT(*) c FROM organizer_key WHERE org=? AND created_by='dp'", [w.orgId]))[0].c === 0);
      // API: the box is required by the publish route itself, and 'done' before publishing is refused
      const st = await H.call("POST", "/api/helpdesk/approve/start", { t: a1.token });
      t.check("API: approve/start gives a short-lived key", st.ok && /^cbk_/.test(st.body.key ?? "") && st.body.expiresMs - Date.now() < 31 * 60_000 + 3 * H.DAY, JSON.stringify(st.body).slice(0, 80));
      const noBox = await rawCall("POST", `/api/z/${g.id}/publish`, { email: w.org.email, phone: "9811122233", consent: { v: "x", boxes: [] } }, { "x-organizer": st.body.key });
      t.check("API: publishing without the Terms box ticked is refused", !noBox.ok && !(await isPublished(w.org, g.id)), `${noBox.status} ${JSON.stringify(noBox.body).slice(0, 100)}`);
      const early = await H.call("POST", "/api/helpdesk/approve/done", { t: a1.token });
      t.check("API: 'done' before the game is published is refused (409)", early.status === 409 && early.body.code === "not-published", JSON.stringify(early.body));
      // wrong tokens
      const y = await t.open({ device: "mobile" });
      for (const [tok, re, what] of [["abc", /incomplete/i, "a short token"], ["f".repeat(48), /not valid/i, "a made-up token"]]) {
        await y.page.goto(`${H.SIM}/helpdesk-approve.html?t=${tok}`); await y.page.waitForSelector("#app .zcard", { timeout: 8000 });
        t.check(`${what}: a calm message and no Publish button`, re.test(await t.text(y.page, "#app")) && !(await y.page.$("#pub")), (await t.text(y.page, "#app")).slice(0, 120));
      }
      t.check("API: a made-up token is 404 for info, start and done", (await H.call("GET", `/api/helpdesk/approve/info?t=${"f".repeat(48)}`)).status === 404 && (await H.call("POST", "/api/helpdesk/approve/start", { t: "f".repeat(48) })).status === 404 && (await H.call("POST", "/api/helpdesk/approve/done", { t: "f".repeat(48) })).status === 404);
      // asking again after 10 minutes replaces the old link
      await H.clock.advance(11 * 60_000); await t.shared.track.refresh();
      const a2 = await askPublish(t, w, g.id);
      t.check("a second ask gives a different link", a2.token !== a1.token);
      await y.page.goto(`${H.SIM}/helpdesk-approve.html?t=${a1.token}`); await y.page.waitForSelector("#app .zcard", { timeout: 8000 });
      t.check("the old link no longer works ('not valid')", /not valid/i.test(await t.text(y.page, "#app")) && !(await y.page.$("#pub")), (await t.text(y.page, "#app")).slice(0, 120));
      t.check("the old link's temporary key is dead", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": st.body.key })).status >= 400);
      await y.page.goto(`${H.SIM}/helpdesk-approve.html?t=${a2.token}`); await y.page.waitForSelector("#pub", { timeout: 8000 });
      t.check("the new link works", true);
      // 8 days later the approval has expired
      await H.clock.advance(8 * H.DAY); await t.shared.track.refresh();
      const z = await t.open({ device: "mobile" });
      await z.page.goto(`${H.SIM}/helpdesk-approve.html?t=${a2.token}`); await z.page.waitForSelector("#app .zcard", { timeout: 8000 });
      t.check("after 7 days the link says it was used, expired or stopped; no Publish button", /already been used|expired|stopped/i.test(await t.text(z.page, "#app")) && !(await z.page.$("#pub")), (await t.text(z.page, "#app")).slice(0, 160));
      t.check("API: start and info on the expired link are 410", (await H.call("POST", "/api/helpdesk/approve/start", { t: a2.token })).status === 410 && (await H.call("GET", `/api/helpdesk/approve/info?t=${a2.token}`)).status === 410);
    },
  },
  {
    id: "S12-11", name: "The Organizer publishes in one tap from the e-mailed link; the game is really published, guests can open the share link, the link cannot be used twice",
    async run(t) {
      const w = await world(t); const g = await helperGame(w, { cfg: { name: "Annual Day" } });
      const a = await askPublish(t, w, g.id);
      const x = await t.open({ device: "mobile" });
      await approveUi(t, x.page, a.token, w.org);
      await x.page.click("#pub");
      await x.page.waitForFunction(() => /Your game is live/i.test(document.body.innerText), null, { timeout: 15000 });
      await t.shot(x.page, "approve-published");
      const txt = await t.text(x.page, "#app");
      t.check("the page says Published and that the helper is now a Host", /Published/i.test(txt) && /Hema Helper is now a Host/i.test(txt), txt.slice(0, 200));
      const sum = (await w.org.summary(g.id)).body;
      t.check("the game is published (summary status)", await isPublished(w.org, g.id), String(sum.status));
      t.check("the game is not paid yet (publishing is free, paying is the Organizer's)", (await payStatus(w.org, g.id)) !== "paid");
      const share = await x.page.$eval(".zlink", (e) => e.textContent.trim()).catch(() => "");
      t.check("the page shows the guests' share link", /\/z\?e=|\/z\.html\?e=|\/j\//.test(share), share);
      const guest = await t.open({ device: "mobile", label: "guest" });
      await guest.page.goto(share || `${H.SIM}/z?e=${g.id}`); await guest.page.waitForSelector(".tb input[data-box], #go, #ph", { timeout: 12000 });
      const gtxt = await t.text(guest.page);
      t.check("a guest can open the share link and meets the join form (not a 'not published' page)", !!(await guest.page.$(".tb input[data-box]")) && !/not (been )?published|not open yet|not found/i.test(gtxt), gtxt.slice(0, 200));
      await t.shot(guest.page, "guest-join-after-approve");
      // the link works once
      const again = await t.open({ device: "mobile" });
      await again.page.goto(`${H.SIM}/helpdesk-approve.html?t=${a.token}`); await again.page.waitForSelector("#app .zcard");
      t.check("opening the link again: 'already been used', no Publish button", /already been used|expired|stopped/i.test(await t.text(again.page, "#app")) && !(await again.page.$("#pub")), (await t.text(again.page, "#app")).slice(0, 140));
      t.check("API: start on the used link is 410", (await H.call("POST", "/api/helpdesk/approve/start", { t: a.token })).status === 410);
      t.check("the temporary key is revoked (no key of the 'publish approval' kind works any more)", (await H.sql("SELECT COUNT(*) c FROM organizer_key WHERE org=? AND created_by='dp' AND revoked=0", [w.orgId]))[0].c === 0);
      const c = await clientOf(w.h, w.link.id);
      t.check("the helper's list now shows the game as Published with no 'Ask' button", c.games[0].published === true, JSON.stringify(c.games));
      const mail = await newMail(t, w.h.email, /is published/);
      t.check("the helper got 'Your game is published' with the Host console link and a Host AI link", /zc\.html\?k=cbh_[0-9a-f]{48}&e=/.test(mail.text) && /\/ai\/cbh_[0-9a-f]{48}/.test(mail.text), mail.text.slice(0, 300));
      t.check("API: asking to publish a game that is already published is refused (409)", (await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: g.id }, w.h.key)).status === 409);
    },
  },
  {
    id: "S12-12", name: "After publishing the helper gets the Host link: first-open setup works in the UI, the helper changes a game detail as Host, and does not use one of the Organizer's 5 Host places",
    async run(t) {
      const w = await publishedWorld(t);
      t.check("the helper's mail carries the one-time Host console link for the published game", !!w.deskUrl && w.deskUrl.includes(`e=${w.g.id}`), String(w.deskUrl).slice(0, 100));
      const c0 = await clientOf(w.h, w.link.id);
      t.check("the Help Desk page data says the Host link is waiting for setup", c0.hostLink === "waiting-for-setup", c0.hostLink);
      const { h, key } = await hostFirstOpenUi(t, w.deskUrl, w.h.email);
      const who = await H.call("GET", "/api/whoami", undefined, { "x-organizer": key });
      t.check("after setup the helper is a Host (device key)", who.body.kind === "host", JSON.stringify(who.body));
      t.check("the one-time link no longer works", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.hostKey })).status >= 400);
      t.check("the Host console is open on the game with the role pill Host", /\bHost\b/.test(await t.text(h.page)) && !!(await h.page.$(".zc-sech")), (await t.text(h.page)).slice(0, 120));
      // the helper changes a game detail as a Host: the name (step 1) and the number of people (step 2)
      await openStep(h.page, 1); await chip(h.page, "occ", "Customer event"); await saveStep(h.page, 1);
      await openStep(h.page, 2); await chip(h.page, "cap", 500); await saveStep(h.page, 2);
      const i = (await w.org.info(w.g.id)).body;
      t.check("the Organizer's game now has the helper's changes (name, size)", i.name === "Customer event" && i.cap === 500, `${i.name} ${i.cap}`);
      await t.shot(h.page, "helper-as-host");
      const hh = new H.Host(key);
      t.check("a Host cannot add Hosts or close the account (API)", (await hh.api("POST", "/api/org/host", { label: "X", email: t.mail("x") })).status === 403 && (await hh.api("POST", "/api/org/close", { confirm: true })).status === 403);
      const c1 = await clientOf(w.h, w.link.id);
      t.check("the Help Desk page data now says 'ready'", c1.hostLink === "ready", c1.hostLink);
      const team = (await w.org.team()).body;
      const desk = (team.hosts ?? []).filter((x) => /Help desk/i.test(x.label ?? ""));
      t.check("the team list shows the helper once, labelled 'Help desk: <name>'", desk.length === 1 && /Help desk: Hema Helper/.test(desk[0].label), JSON.stringify(team.hosts).slice(0, 200));
      let added = 0, lastStatus = 0;
      for (let n = 1; n <= 6; n++) { const r = await w.org.api("POST", "/api/org/host", { label: "Host" + n, email: t.mail("hh"), mobile: nextPhone() }); lastStatus = r.status; if (r.ok) added++; else break; }
      t.check("the Organizer can still add five Hosts of their own, and the sixth is refused", added === 5 && lastStatus === 409, `${added} added, last status ${lastStatus}`);
      t.check("the helper's Host is still working after the Organizer filled all five places", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": key })).body.kind === "host");
    },
  },
  {
    id: "S12-13", name: "The helper sees the AI link on the Help Desk page; /ai/<key> opens the manual with the helper paragraph; the AI can ask for publishing with the link alone; the Host AI link opens too",
    async run(t) {
      const w = await world(t); const g = await helperGame(w, { cfg: { name: "AI Day" } });
      const x = await t.open({ device: "laptop" }); await withPartnerKey(x, w.h.key);
      await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("[data-copy]");
      const link = await x.page.getAttribute("[data-copy]", "data-copy");
      t.check("the Help Desk page offers 'Copy my AI link' with the /ai/<key> link", /\/ai\/cba_[0-9a-f]{48}$/.test(link ?? ""), String(link).slice(0, 60));
      await x.page.click("[data-copy]"); await x.page.waitForTimeout(400);
      t.check("tapping it answers (Copied, or a fallback line)", /Copied|Select and copy/i.test(await t.text(x.page, "[data-copy]")), await t.text(x.page, "[data-copy]"));
      const ai = await t.open({ device: "laptop", label: "ai-reader" });
      await ai.page.goto(H.SIM + new URL(link).pathname); await ai.page.waitForTimeout(1200);
      const manual = await t.text(ai.page);
      t.check("/ai/<key> opens the manual", manual.length > 400, manual.slice(0, 100));
      t.check("the manual starts the helper paragraph: you prepare games, never publish or pay, how to ask", /YOU ARE A HELP DESK HELPER/i.test(manual) && /never publish and never pay/i.test(manual) && /request-publish/.test(manual), manual.slice(0, 200));
      const own = await H.call("GET", `/ai/${w.org.aiKey}`); const ownText = JSON.stringify(own.body) + (own.body.text ?? "");
      t.check("the Organizer's own AI link manual has no helper paragraph", own.ok && !/HELP DESK HELPER/i.test(ownText), String(own.status));
      const have = (await mailsTo(w.org.email, /asks you to publish/)).length;
      const r = await H.call("POST", `/ai/${w.aiKey}/helpdesk/request-publish`, { eid: g.id });
      t.check("with only the AI link the AI can ask the Organizer to publish", r.ok && r.body.sent === true, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
      const m = await newMail(t, w.org.email, /asks you to publish/, have);
      t.check("the Organizer's mail arrives with the approve link", !!tokenIn(m, "helpdesk-approve"));
      t.check("asking again at once is told to wait (429)", (await H.call("POST", `/ai/${w.aiKey}/helpdesk/request-publish`, { eid: g.id })).status === 429);
      const pw = await publishedWorld(t);
      const hx = await H.call("GET", "/api/whoami", undefined, { "x-organizer": pw.hostAiKey });
      t.check("the Host AI link's key is a Host key", hx.body.kind === "host", JSON.stringify(hx.body));
      await ai.page.goto(`${H.SIM}/ai/${pw.hostAiKey}`); await ai.page.waitForTimeout(1200);
      t.check("the Host AI link opens its page", (await t.text(ai.page)).length > 200 && !/not found|expired/i.test((await t.text(ai.page)).slice(0, 200)), (await t.text(ai.page)).slice(0, 120));
      const exp = (await H.sql("SELECT expires_ms FROM organizer_key WHERE hash=?", [H.sha("key|" + pw.hostAiKey)]))[0].expires_ms, left = exp - (await H.clock.now());
      t.check("the Host AI link works for about 24 hours", left > 23 * H.HOUR && left <= 24 * H.HOUR + 60_000, String(left));
    },
  },
  {
    id: "S12-14", name: "The Organizer stops the helper on the page: every helper key stops at once (AI key, Host keys, Host AI link, console), published games stay, the helper is told",
    async run(t) {
      const w = await publishedWorld(t);
      const dev = await new H.Host(w.hostKey).firstOpen({ email: w.h.email, mobile: nextPhone() });
      const keys = { "the helper's AI key": w.aiKey, "the Host's one-time link key": w.hostKey, "the Host's device key": dev.token, "the Host AI link key": w.hostAiKey };
      for (const [n, k] of Object.entries(keys)) if (n !== "the Host's one-time link key") t.check(`before stopping, ${n} works`, (await H.call("GET", "/api/whoami", undefined, { "x-organizer": k })).ok, n);
      const x = await t.open({ device: "laptop", token: w.org.token, label: "organizer" });
      await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${w.link.token}`); await x.page.waitForSelector("#stop", { timeout: 10000 });
      t.check("the Organizer's link shows the helper as allowed, with a Stop button", /Stop Help Desk/i.test(await t.text(x.page, "#app")));
      x.page.once("dialog", (d) => d.accept());
      await x.page.click("#stop"); await x.page.waitForFunction(() => /Stopped\./i.test(document.body.innerText), null, { timeout: 8000 });
      t.check("the page says Stopped and that the helper has no access", /Hema Helper has no access to your account/i.test(await t.text(x.page, "#app")), await t.text(x.page, "#app"));
      await t.shot(x.page, "stopped");
      for (const [n, k] of Object.entries(keys)) t.check(`${n} stopped at once`, (await H.call("GET", "/api/whoami", undefined, { "x-organizer": k })).status >= 400, n);
      t.check("an API call with the helper's AI key is refused", (await w.ai("PATCH", `/api/z/${w.g.id}/settings`, { cap: 90 })).status >= 400);
      t.check("the helper cannot ask for publishing any more", (await hd("POST", "/api/helpdesk/request-publish", { linkId: w.link.id, eid: w.g.id }, w.h.key)).status >= 400);
      t.check("the helper's Host is gone from the Organizer's team list", (await w.org.team()).body.hosts.length === 0, JSON.stringify((await w.org.team()).body.hosts).slice(0, 200));
      t.check("the published game stays published, the Organizer still manages it", (await isPublished(w.org, w.g.id)) && (await w.org.info(w.g.id)).ok);
      const gx = await t.open({ device: "mobile", label: "guest" });
      await gx.page.goto(`${H.SIM}/z?e=${w.g.id}`); await gx.page.waitForSelector(".tb input[data-box]", { timeout: 12000 });
      t.check("guests can still open the game's join page", true);
      const c = await clientOf(w.h, w.link.id);
      t.check("the helper's list says Stopped and offers no console or AI link", c.state === "stopped" && !c.consoleUrl && !c.aiLink && c.hostLink === "ended", JSON.stringify(c).slice(0, 160));
      const hc = await t.open({ device: "mobile", token: w.aiKey, label: "helper-old-console" });
      await hc.page.goto(`${H.SIM}/zc`); await hc.page.waitForTimeout(2500);
      const ht = await t.text(hc.page);
      t.check("the helper's old console link shows a readable message, not a blank page", ht.length > 40 && !/undefined|\[object/.test(ht), ht.slice(0, 160));
      const hm = await newMail(t, w.h.email, /stopped/i);
      t.check("the helper was told by mail, kindly", /stopped Help Desk/.test(hm.text) && /Games already published stay/.test(hm.text), hm.text.slice(0, 200));
      const hp = await t.open({ device: "mobile", label: "helper-page" }); await withPartnerKey(hp, w.h.key);
      await hp.page.goto(`${H.SIM}/helpdesk`); await hp.page.waitForSelector("[data-client]");
      t.check("the Help Desk page shows 'Stopped' and the published game", /Stopped/.test(await t.text(hp.page, "[data-client]")) && /Published/.test(await t.text(hp.page, "[data-client]")), (await t.text(hp.page, "[data-client]")).slice(0, 200));
      await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${w.link.token}`); await x.page.waitForSelector("#app .zcard");
      t.check("opening the old invitation link now says it was stopped", /stopped/i.test(await t.text(x.page, "#app")), await t.text(x.page, "#app"));
    },
  },
  {
    id: "S12-15", name: "Stopping by API (the Organizer's key, the helper's own 'End this for me', declining an invitation); other accounts and other helpers cannot stop a link",
    async run(t) {
      const w = await world(t); const g = await helperGame(w);
      const stranger = await t.org("s"); const other = await mkHelper(t);
      t.check("another Organizer's key cannot stop this link (404)", (await stranger.api("POST", "/api/helpdesk/stop", { linkId: w.link.id })).status === 404);
      t.check("another helper cannot stop this link (404)", (await hd("POST", "/api/helpdesk/stop", { linkId: w.link.id }, other.key)).status === 404);
      t.check("nobody at all cannot stop it (403)", (await H.call("POST", "/api/helpdesk/stop", { linkId: w.link.id })).status === 403);
      t.check("the link is still active", (await clientOf(w.h, w.link.id)).state === "active");
      const mine = (await w.org.api("GET", "/api/helpdesk/mine")).body;
      t.check("the Organizer's list shows the helper by name with the game count", mine.helpers.length === 1 && mine.helpers[0].helperName === "Hema Helper" && mine.helpers[0].games === 1, JSON.stringify(mine));
      const r = await w.org.api("POST", "/api/helpdesk/stop", { linkId: w.link.id });
      t.check("the Organizer's key stops it", r.ok && r.body.state === "stopped", JSON.stringify(r.body));
      t.check("the helper's AI key stopped at once", (await w.ai("GET", `/api/z/${g.id}/info`)).status >= 400 && (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.aiKey })).status >= 400);
      t.check("stopping twice is harmless", (await w.org.api("POST", "/api/helpdesk/stop", { linkId: w.link.id })).ok);
      t.check("the helper got exactly one 'stopped' mail", (await mailsTo(w.h.email, /Help Desk stopped/)).length === 1);
      const w2 = await world(t, { helper: w.h });
      const x = await t.open({ device: "mobile" }); await withPartnerKey(x, w.h.key);
      await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector(`[data-client="${w2.link.id}"]`);
      x.page.once("dialog", (d) => d.accept());
      await x.page.click(`[data-client="${w2.link.id}"] [data-stop]`);
      await x.page.waitForFunction((id) => /Stopped/.test(document.querySelector(`[data-client="${id}"]`)?.innerText ?? ""), w2.link.id, { timeout: 8000 });
      t.check("'End this for me' on the page stops the link and the AI key", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w2.aiKey })).status >= 400 && (await clientOf(w.h, w2.link.id)).state === "stopped");
      t.check("the Organizer is not told anything by mail when the helper ends it", (await mailsTo(w2.org.email, /stopped|ended/i)).length === 0);
      const org3 = await t.org("d"); const inv3 = await invite(t, w.h, org3);
      const y = await t.open({ device: "mobile" });
      await y.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv3.token}`); await y.page.waitForSelector("#stop", { timeout: 10000 });
      await y.page.click("#stop"); await y.page.waitForFunction(() => /Stopped\./i.test(document.body.innerText), null, { timeout: 8000 });
      const c3 = await clientOf(w.h, inv3.id);
      t.check("'I do not want this' stops the invitation without signing in", c3.state === "stopped" && !c3.consoleUrl, JSON.stringify(c3).slice(0, 120));
      t.check("the helper is told the Organizer did not allow it", /did not allow/i.test((await newMail(t, w.h.email, /did not allow/i)).text));
    },
  },
  {
    id: "S12-16", name: "A stopped link can be re-invited: a new invitation works, the old keys stay dead, the old games stay recorded under the old link",
    async run(t) {
      const w = await world(t); const g = await helperGame(w);
      await w.org.api("POST", "/api/helpdesk/stop", { linkId: w.link.id });
      const inv2 = await invite(t, w.h, w.org);
      t.check("a new invitation is allowed after a stop (a different link)", inv2.id !== w.link.id && !!inv2.token);
      const x = await t.open({ device: "mobile" });
      await acceptUi(t, x.page, w.org, inv2.token); await x.page.click("#ok"); await x.page.waitForSelector("#stop", { timeout: 10000 });
      const c = (await me(w.h)).clients.find((q) => q.id === inv2.id);
      t.check("the new link is active with a new console and AI link", c.state === "active" && /k=cba_/.test(c.consoleUrl), JSON.stringify(c).slice(0, 120));
      const key2 = /k=(cba_[0-9a-f]{48})/.exec(c.consoleUrl)[1];
      t.check("the new key differs from the old one, the old one stays dead", key2 !== w.aiKey && (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.aiKey })).status >= 400);
      const g2 = await new H.Organizer(w.org.email, key2).createGame({ leadMs: 3 * H.HOUR });
      t.check("the new key works for a new game, recorded under the new link", (await H.sql("SELECT link_id FROM helpdesk_game WHERE eid=?", [g2.id]))[0].link_id === inv2.id);
      t.check("the old game stays recorded under the old link", (await H.sql("SELECT link_id FROM helpdesk_game WHERE eid=?", [g.id]))[0].link_id === w.link.id);
      await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${w.link.token}`); await x.page.waitForSelector("#app .zcard");
      t.check("the old invitation token still says stopped", /stopped/i.test(await t.text(x.page, "#app")), await t.text(x.page, "#app"));
      t.check("the old link cannot be allowed again (410)", (await allow(w.org, w.link.token)).status === 410);
    },
  },
  {
    id: "S12-17", name: "A paid game the helper prepared earns the helper commission (shown on the partner page), whatever partner code the buyer carried; a game the Organizer made alone earns the helper nothing",
    async run(t) {
      const w = await publishedWorld(t);
      const rival = await mkHelper(t, { join: false });
      const x = await t.open({ device: "laptop", token: w.org.token });
      await x.page.goto(`${H.SIM}/pay.html?e=${w.g.id}`);
      await payOnPage(x.page, { email: w.org.email });
      await x.page.waitForFunction(() => /PAYMENT RECEIVED/i.test(document.body.innerText), null, { timeout: 15000 });
      t.check("the Organizer's payment went through", (await payStatus(w.org, w.g.id)) === "paid");
      const row = (await H.sql("SELECT p.ref AS ref, c.partner_code AS code, c.status AS status, c.rate AS rate, c.amount AS amount, c.base AS base FROM payment p LEFT JOIN commission c ON c.payment_id=p.id WHERE p.eid=?", [w.g.id]))[0];
      t.check("the payment carries the helper's partner code and a commission row is accrued for the helper", row.ref === w.h.code && row.code === w.h.code && row.status === "accrued" && row.amount > 0, JSON.stringify(row));
      t.check("the commission is the usual rate on the software price (50%)", row.rate === 0.5 && Math.abs(row.amount - row.base * 0.5) < 0.02, JSON.stringify(row));
      // the partner page shows the sale
      const p = await t.open({ device: "mobile", label: "partner-page" }); await withPartnerKey(p, w.h.key);
      await p.page.goto(`${H.SIM}/partner`); await p.page.waitForSelector("#mylink", { timeout: 10000 });
      const pt = await t.text(p.page);
      t.check("the Refer & earn page shows one sale, 'Earned', with the amount and no buyer details", /Sales\s*1/i.test(pt) && /Earned/.test(pt) && pt.includes("₹") && !pt.includes(w.org.email), pt.slice(0, 300));
      await t.shot(p.page, "partner-earned");
      t.check("the helper's total on the partner API matches the commission row", Math.abs((await H.call("GET", "/api/partner/me", undefined, pk(w.h.key))).body.totals.accruedInr - row.amount) < 0.02);
      // a second game paid with another partner's code in the buyer's request: the helper still earns
      const g2 = await helperGame(w, { cfg: { name: "Second" } });
      const a2 = await askPublish(t, w, g2.id);
      const st2 = await H.call("POST", "/api/helpdesk/approve/start", { t: a2.token });
      await H.call("POST", `/api/z/${g2.id}/publish`, { email: w.org.email, phone: "9811122233" }, { "x-organizer": st2.body.key });
      await H.call("POST", "/api/helpdesk/approve/done", { t: a2.token });
      const pay2 = await w.org.api("POST", "/api/payments/test", { eid: g2.id, email: t.mail("payer2"), name: "Other Payer", org: "Other Co", country: "IN", ref: rival.code });
      t.check("paying with another partner's code in the request still pays the helper", pay2.ok && (await H.sql("SELECT ref FROM payment WHERE eid=?", [g2.id]))[0].ref === w.h.code, JSON.stringify(pay2.body).slice(0, 100));
      t.check("the other partner earned nothing from it", (await H.sql("SELECT COUNT(*) c FROM commission WHERE partner_code=?", [rival.code]))[0].c === 0);
      // a game the Organizer made with their own key is not the helper's
      const own = await w.org.createGame({ leadMs: 3 * H.HOUR }); await w.org.publish(own.id);
      const pay3 = await w.org.api("POST", "/api/payments/test", { eid: own.id, email: t.mail("payer3"), name: "Own Payer", org: "Own Co", country: "IN", ref: rival.code });
      t.check("a game the Organizer made alone pays the code the buyer carried, not the helper", pay3.ok && (await H.sql("SELECT ref FROM payment WHERE eid=?", [own.id]))[0].ref === rival.code, JSON.stringify(pay3.body).slice(0, 100));
      t.check("the helper has exactly the two commissions", (await H.sql("SELECT COUNT(*) c FROM commission WHERE partner_code=?", [w.h.code]))[0].c === 2);
    },
  },
  {
    id: "S12-18", name: "Self-referral earns nothing: when the helper's mobile number is the payer's, the commission is blocked and the partner page says so",
    async run(t) {
      const w = await publishedWorld(t);
      const pay = await w.org.api("POST", "/api/payments/test", { eid: w.g.id, email: w.org.email, name: "Hema Helper", org: "Own Co", country: "IN", phone: w.h.phone });
      t.check("the payment went through", pay.ok && (await payStatus(w.org, w.g.id)) === "paid", JSON.stringify(pay.body).slice(0, 100));
      const row = (await H.sql("SELECT c.status AS status, c.reason AS reason, c.amount AS amount FROM payment p JOIN commission c ON c.payment_id=p.id WHERE p.eid=?", [w.g.id]))[0];
      t.check("the commission row is blocked as self-referral with no amount", row.status === "blocked" && row.reason === "self_referral" && row.amount === null, JSON.stringify(row));
      const p = await t.open({ device: "mobile", label: "partner-page" }); await withPartnerKey(p, w.h.key);
      await p.page.goto(`${H.SIM}/partner`); await p.page.waitForSelector("#mylink", { timeout: 10000 });
      const pt = await t.text(p.page);
      t.check("the Refer & earn page says 'Not counted (own purchase)' and shows no earnings", /Not counted \(own purchase\)/i.test(pt) && !/Earned\s+₹[1-9]/i.test(pt), pt.slice(0, 300));
      t.check("accrued total is zero on the API", (await H.call("GET", "/api/partner/me", undefined, pk(w.h.key))).body.totals.accruedInr === 0);
      await t.shot(p.page, "partner-blocked");
    },
  },
  {
    id: "S12-19", name: "Two helpers for the same Organizer are independent: own keys, own games, own approvals, own Host, own commission; stopping one leaves the other working",
    async run(t) {
      const org = await t.org("o");
      const h1 = await mkHelper(t, { name: "Alpha Helper" }), h2 = await mkHelper(t, { name: "Beta Helper" });
      const i1 = await invite(t, h1, org), i2 = await invite(t, h2, org);
      t.check("both invitations arrived as separate mails with separate links", i1.token && i2.token && i1.token !== i2.token);
      t.check("both are allowed", (await allow(org, i1.token)).ok && (await allow(org, i2.token)).ok);
      const k1 = /k=(cba_[0-9a-f]{48})/.exec((await clientOf(h1, i1.id)).consoleUrl)[1], k2 = /k=(cba_[0-9a-f]{48})/.exec((await clientOf(h2, i2.id)).consoleUrl)[1];
      t.check("each helper has their own AI key", k1 !== k2);
      const o1 = new H.Organizer(org.email, k1), o2 = new H.Organizer(org.email, k2);
      const g1 = await o1.createGame({ leadMs: 3 * H.HOUR, cfg: { name: "Alpha Game" } }), g2 = await o2.createGame({ leadMs: 3 * H.HOUR, cfg: { name: "Beta Game" } });
      t.check("each game is recorded under its own helper", (await H.sql("SELECT partner_code FROM helpdesk_game WHERE eid=?", [g1.id]))[0].partner_code === h1.code && (await H.sql("SELECT partner_code FROM helpdesk_game WHERE eid=?", [g2.id]))[0].partner_code === h2.code);
      t.check("each helper's list shows only their own game", (await clientOf(h1, i1.id)).games.map((g) => g.eid).join() === g1.id && (await clientOf(h2, i2.id)).games.map((g) => g.eid).join() === g2.id);
      t.check("helper 2 cannot ask the Organizer to publish helper 1's game", (await hd("POST", "/api/helpdesk/request-publish", { linkId: i2.id, eid: g1.id }, h2.key)).status === 404 && (await hd("POST", "/api/helpdesk/request-publish", { linkId: i1.id, eid: g2.id }, h2.key)).status >= 400);
      // the Organizer approves only helper 1's game
      const have = (await mailsTo(org.email, /asks you to publish/)).length;
      t.check("helper 1 asks", (await hd("POST", "/api/helpdesk/request-publish", { linkId: i1.id, eid: g1.id }, h1.key)).ok);
      const m = await newMail(t, org.email, /asks you to publish/, have);
      t.check("the Organizer's mail names helper 1", /Alpha Helper/.test(m.subject + m.text), m.subject);
      const st = await H.call("POST", "/api/helpdesk/approve/start", { t: tokenIn(m, "helpdesk-approve") });
      await H.call("POST", `/api/z/${g1.id}/publish`, { email: org.email, phone: "9811122233" }, { "x-organizer": st.body.key });
      t.check("approve/done for helper 1", (await H.call("POST", "/api/helpdesk/approve/done", { t: tokenIn(m, "helpdesk-approve") })).ok);
      t.check("only helper 1's game is published", (await isPublished(org, g1.id)) && !(await isPublished(org, g2.id)));
      t.check("only helper 1 became a Host", (await clientOf(h1, i1.id)).hostLink !== "none" && (await clientOf(h2, i2.id)).hostLink === "none");
      t.check("helper 2 was told nothing about the publishing", (await mailsTo(h2.email, /is published/)).length === 0);
      // helper 1 is stopped, helper 2 goes on
      t.check("the Organizer stops helper 1", (await org.api("POST", "/api/helpdesk/stop", { linkId: i1.id })).ok);
      t.check("helper 1's key stopped", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": k1 })).status >= 400);
      t.check("helper 2's key works as before and can still change their game", (await o2.settings(g2.id, { cap: 80 })).ok && (await org.info(g2.id)).body.cap === 80);
      t.check("helper 2's client is still active and helper 1's is stopped", (await clientOf(h2, i2.id)).state === "active" && (await clientOf(h1, i1.id)).state === "stopped");
      t.check("the Organizer's list shows both with their own state", (await org.api("GET", "/api/helpdesk/mine")).body.helpers.map((x) => x.helperName + ":" + x.state).sort().join() === "Alpha Helper:stopped,Beta Helper:active");
    },
  },
  {
    id: "S12-20", name: "The Organizer replaces or revokes their own AI link: the helper keeps working (page, console and API)",
    async run(t) {
      const w = await world(t); const g = await helperGame(w);
      t.check("before: the Organizer's own AI key works", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.org.aiKey })).ok);
      const rep = await w.org.api("POST", "/api/org/ai/replace", {});
      t.check("the Organizer replaces their AI link", rep.ok, JSON.stringify(rep.body).slice(0, 100));
      t.check("the Organizer's old AI key stopped", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.org.aiKey })).status >= 400);
      t.check("the helper's key still works (API)", (await w.ai("PATCH", `/api/z/${g.id}/settings`, { cap: 90 })).ok && (await w.org.info(g.id)).body.cap === 90);
      const x = await openConsole(t, w.org, g.id, { device: "mobile", token: w.aiKey, label: "helper-console" });
      t.check("the helper's console still opens on the game", !!(await x.page.$(".zc-sech")));
      await openStep(x.page, 2); await chip(x.page, "cap", 500); await saveStep(x.page, 2);
      t.check("and still saves changes after the replace", (await w.org.info(g.id)).body.cap === 500);
      const rev = await w.org.api("POST", "/api/org/ai/revoke", {});
      t.check("the Organizer revokes the AI link altogether (if the route exists)", rev.ok || rev.status === 404 || rev.status === 405, String(rev.status));
      t.check("the helper's key is still alive after that too", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.aiKey })).ok);
      t.check("the helper's link is still 'active' on the Help Desk page", (await clientOf(w.h, w.link.id)).state === "active");
      t.check("the helper's AI manual link still opens", (await H.call("GET", `/ai/${w.aiKey}`)).ok);
    },
  },
  {
    id: "S12-21", name: "Layout of the three Help Desk pages at 360 px and 1280 px: no sideways scroll, readable text, every tap target at least 36 px",
    async run(t) {
      const w = await world(t); const g = await helperGame(w, { cfg: { name: "Annual Day" } });
      const ap = await askPublish(t, w, g.id);
      const w2 = { h: await mkHelper(t) }; const org2 = await t.org("l"); const inv2 = await invite(t, w2.h, org2);
      const tapsOf = (page) => page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[hidden]") && !e.closest("details:not([open]) > :not(summary)"); };
        const out = [];
        for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=checkbox]), select, textarea, summary')) {
          if (!vis(e)) continue; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
          // a text link inside a sentence is measured by the row it sits in; every other control by itself
          const inline = e.tagName === "A" && cs.display === "inline"; const h = inline ? (e.closest("p,li,div")?.getBoundingClientRect().height ?? r.height) : r.height;
          if (Math.min(h, inline ? 99 : r.width) < 36 - 0.5) out.push(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""} "${(e.textContent || e.value || "").trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(h)}`);
        }
        for (const l of document.querySelectorAll("label")) { if (l.querySelector("input[type=checkbox]") || (l.htmlFor && document.getElementById(l.htmlFor)?.type === "checkbox")) { const r = l.getBoundingClientRect(); if (vis(l) && r.height < 36) out.push(`checkbox label "${l.textContent.trim().slice(0, 20)}" ${Math.round(r.height)}`); } }
        return out;
      });
      const views = [
        ["helpdesk signed-out", async (x) => { await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("#pk"); }, {}],
        ["helpdesk join", async (x) => { const h = await mkHelper(t, { join: false }); await withPartnerKey(x, h.key); await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("#on"); }, {}],
        ["helpdesk client", async (x) => { await withPartnerKey(x, w.h.key); await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("[data-ask]"); }, {}],
        ["accept sign-in", async (x) => { await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv2.token}`); await x.page.waitForSelector("#em"); }, {}],
        ["accept allow", async (x) => { await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv2.token}`); await x.page.waitForSelector("#ok"); }, { token: org2.token }],
        ["approve", async (x) => { await x.page.goto(`${H.SIM}/helpdesk-approve.html?t=${ap.token}`); await x.page.waitForSelector("#pub"); }, {}],
      ];
      for (const wpx of [360, 1280]) {
        for (const [name, go, o] of views) {
          const x = await t.open({ device: wpx < 700 ? "mobile" : "laptop", w: wpx, h: wpx < 700 ? 780 : 900, ...o, label: `${name} ${wpx}` });
          await go(x); await x.page.waitForTimeout(500);
          const m = await H.measure(x.page, { minPx: 12 });
          t.check(`${name} at ${wpx}: no sideways scroll`, !m.overflowX, `scrollWidth ${m.scrollWidth}`);
          t.check(`${name} at ${wpx}: no text below 12 px`, (m.smallText ?? []).length === 0, JSON.stringify(m.smallText).slice(0, 160));
          const small = await tapsOf(x.page);
          t.check(`${name} at ${wpx}: every button, field and link is at least 36 px`, small.length === 0, small.slice(0, 5).join(" ; "));
          await t.shot(x.page, `${name}-${wpx}`);
          await x.close();
        }
      }
    },
  },
  {
    id: "S12-22", name: "Accessibility basics on the three Help Desk pages: language, title, one main heading, labels for every field, names for every button, and axe-core finds nothing",
    async run(t) {
      const w = await world(t); const g = await helperGame(w, { cfg: { name: "Annual Day" } });
      const ap = await askPublish(t, w, g.id);
      const h2 = await mkHelper(t); const org2 = await t.org("l"); const inv2 = await invite(t, h2, org2);
      const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
      const axe = async (page) => { await page.evaluate(AXE); return page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id} x${v.nodes.length} [${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}]`)); };
      const basics = (page) => page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
        const nameOf = (e) => (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.getAttribute("title") || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent) || e.closest("label")?.textContent || e.textContent || e.value || "").trim();
        const unlabelled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(vis).filter((e) => !nameOf(e)).map((e) => e.id || e.type);
        const noName = [...document.querySelectorAll("button, a[href]")].filter(vis).filter((e) => !nameOf(e) && !e.querySelector("img[alt]")).map((e) => e.id || e.tagName);
        const hs = [...document.querySelectorAll("h1,h2,h3,h4")].filter(vis).map((e) => e.tagName.toLowerCase());
        return { lang: document.documentElement.lang, title: document.title, h1: hs.filter((x) => x === "h1").length, hs, unlabelled, noName, main: !!document.querySelector("main, [role=main]"), viewport: !!document.querySelector('meta[name=viewport]') };
      });
      const views = [
        ["Help Desk page (signed out)", async (x) => { await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("#pk"); }, {}],
        ["Help Desk page (with a client)", async (x) => { await withPartnerKey(x, w.h.key); await x.page.goto(`${H.SIM}/helpdesk`); await x.page.waitForSelector("[data-ask]"); }, {}],
        ["accept page (sign-in)", async (x) => { await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv2.token}`); await x.page.waitForSelector("#em"); }, {}],
        ["accept page (allow)", async (x) => { await x.page.goto(`${H.SIM}/helpdesk-accept.html?t=${inv2.token}`); await x.page.waitForSelector("#ok"); }, { token: org2.token }],
        ["approve page", async (x) => { await x.page.goto(`${H.SIM}/helpdesk-approve.html?t=${ap.token}`); await x.page.waitForSelector("#pub"); }, {}],
      ];
      for (const [name, go, o] of views) {
        const x = await t.open({ device: "laptop", ...o, label: name }); await go(x); await x.page.waitForTimeout(500);
        const b = await basics(x.page);
        t.check(`${name}: language is set to English`, /^en/i.test(b.lang), b.lang);
        t.check(`${name}: has a title of its own`, b.title.length > 8 && /Corporate Tic Tac Toe/.test(b.title), b.title);
        t.check(`${name}: exactly one main heading (h1)`, b.h1 === 1, JSON.stringify(b.hs));
        t.check(`${name}: has a main landmark`, b.main);
        t.check(`${name}: every field has a label`, b.unlabelled.length === 0, b.unlabelled.join(","));
        t.check(`${name}: every button and link has a name`, b.noName.length === 0, b.noName.join(","));
        const v = await axe(x.page);
        t.check(`${name}: axe-core (WCAG 2 A/AA, contrast) finds nothing`, v.length === 0, v.join(" ;; ").slice(0, 300));
      }
    },
  },
  {
    id: "S12-23", name: "A tour of every state of the three pages (signed out, joined, invited, allowed, approve, used, stopped) raises no JavaScript or console error and no 5xx",
    async run(t) {
      const w = await publishedWorld(t);
      const g2 = await helperGame(w, { cfg: { name: "Draft Two" } }); const a2 = await askPublish(t, w, g2.id);
      const x = await t.open({ device: "mobile", label: "tour" }); await withPartnerKey(x, w.h.key);
      const stops = [`/helpdesk`, `/helpdesk.html?api=`, `/helpdesk-accept.html?t=${w.link.token}`, `/helpdesk-accept.html`, `/helpdesk-approve.html?t=${a2.token}`, `/helpdesk-approve.html?t=${w.approval.token}`, `/helpdesk-approve.html?t=zzz`, `/helpdesk-accept.html?t=${"1".repeat(48)}`];
      for (const u of stops) { await x.page.goto(H.SIM + u); await x.page.waitForTimeout(900); t.check(`the page ${u.replace(/t=[0-9a-f]{48}/, "t=…")} rendered something`, (await t.text(x.page, "body")).length > 30); }
      const y = await t.open({ device: "mobile", label: "tour-signedout" });
      await y.page.goto(`${H.SIM}/helpdesk`); await y.page.waitForSelector("#pk"); await y.page.fill("#pk", "cbp_" + "1".repeat(40)); await y.page.click("#go");
      await y.page.waitForSelector("#app .zbanner.bad", { timeout: 6000 });
      t.check("a wrong partner key shows 'not recognised' and the sign-in form again", /not recognised/i.test(await t.text(y.page, "#app")) && !!(await y.page.$("#pk")), await t.text(y.page, "#app"));
      await y.page.fill("#pk", w.h.key); await y.page.click("#go"); await y.page.waitForSelector("[data-client]", { timeout: 8000 });
      t.check("the right key shows the client", true);
      await y.page.click("#out"); await y.page.waitForSelector("#pk");
      t.check("Sign out brings back the sign-in form and forgets the key", (await y.page.evaluate(() => localStorage.getItem("cbz-pkey"))) === null);
    },
  },
  {
    id: "S12-24", name: "When the helper closes their Refer & earn account every link ends and every key stops; when the Organizer closes theirs the Help Desk rows go",
    async run(t) {
      const w = await publishedWorld(t);
      const w2 = await world(t);
      const closeH = await hd("POST", "/api/partner/close", {}, w.h.key);
      t.check("the helper closes the partner account", closeH.ok, JSON.stringify(closeH.body));
      t.check("the helper's AI key, Host AI key and Host key stopped at once", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.aiKey })).status >= 400 && (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.hostAiKey })).status >= 400 && (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w.hostKey })).status >= 400);
      t.check("no Help Desk rows of that helper are left", (await H.sql("SELECT (SELECT COUNT(*) FROM helpdesk_link WHERE partner_code=?) + (SELECT COUNT(*) FROM helpdesk_helper WHERE partner_code=?) c", [w.h.code, w.h.code]))[0].c === 0);
      t.check("the published game stays published", await isPublished(w.org, w.g.id));
      t.check("the helper's partner key is dead", (await hd("GET", "/api/helpdesk/me", undefined, w.h.key)).status === 403);
      // the Organizer closes the account: the Help Desk rows of that account go
      const rows = async () => (await H.sql("SELECT COUNT(*) c FROM helpdesk_link WHERE org=?", [w2.orgId]))[0].c;
      t.check("before: the second helper has a link in that account", (await rows()) === 1);
      const cl = await w2.org.api("POST", "/api/org/close", { confirm: true });
      t.check("the Organizer closes their account", cl.ok, JSON.stringify(cl.body).slice(0, 100));
      t.check("the Help Desk rows of that account are gone and the helper's key stopped", (await rows()) === 0 && (await H.call("GET", "/api/whoami", undefined, { "x-organizer": w2.aiKey })).status >= 400);
      t.check("the second helper can still sign in to Help Desk and sees no active client for that account", !(await me(w2.h)).clients.some((c) => c.state === "active"));
    },
  },
];
