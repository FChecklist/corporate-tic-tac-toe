import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { T, newWorld, openPage, roundAt } from "./harness";

// The three Help Desk pages, run as the browser runs them against the real Worker (docs/HELPDESK_SPEC.md): the helper's page, the Organizer's invitation page and the one-tap publish page.
const FAR = roundAt(T + 2 * 86_400_000);
const PUB = join(import.meta.dir, "../public");
const open: Awaited<ReturnType<typeof openPage>>[] = [];

async function setup() {
  const w = newWorld({ TEST_MODE: "1" });
  const a = await w.json(await w.api("POST", "/api/partner/enroll", { phone: "98111 22233", name: "Asha", email: "asha@partner.example", consent: true }));
  const p = await w.json(await w.api("POST", "/api/partner/enroll/verify", { email: "asha@partner.example", code: a.devCode }));
  const master = (await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }))).token as string;
  const mails = () => w.world.raw.prepare("SELECT to_addr, subject, body FROM outbox ORDER BY id").all() as { to_addr: string; subject: string; body: string }[];
  const tokenFrom = (re: RegExp, page: string) => [...mails()].reverse().find((m) => re.test(m.subject))!.body.match(new RegExp(page + "\\.html\\?t=([0-9a-f]{48})"))![1]!;
  return { ...w, partnerKey: p.partnerKey as string, master, mails, tokenFrom };
}
type S = Awaited<ReturnType<typeof setup>>;
const page = async (s: S, url: string, html: string, scripts: string[], opts: { session?: Record<string, string>; local?: Record<string, string> } = {}) => {
  const p = await openPage(s.world, { url: "http://localhost" + url, html, scripts, session: opts.session, afterLoad: (win, f) => { if (f === scripts[0]) for (const [k, v] of Object.entries(opts.local ?? {})) win.localStorage.setItem(k, v); } });
  open.push(p); return p;
};
const fetchWith = async (s: S, method: string, path: string, body: unknown, headers: Record<string, string>) => {
  const { handle } = await import("../../edge/test/with-terms");
  return handle(new Request("http://localhost" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), s.world.env, s.world.now);
};

describe("Help Desk pages", () => {
  test("the helper's page: turn on Help Desk, add an Organizer, see the client with a masked address", async () => {
    const s = await setup();
    const p = await page(s, "/helpdesk.html", "helpdesk.html", ["common.js", "helpdesk.js"], { local: { "cbz-pkey": s.partnerKey } });
    await p.waitFor((x) => /Turn on Help Desk/.test(x));
    (p.$("#em") as any).value = "asha@partner.example"; p.click("#on");
    await p.waitFor((x) => /Add an Organizer/.test(x));
    (p.$("#oe") as any).value = "boss@acme.com"; (p.$("#on") as any).value = "Boss"; p.click("#inv");
    const t = await p.waitFor((x) => /b\*\*\*@acme\.com/.test(x));
    expect(t).toMatch(/Waiting for the Organizer to allow/); expect(t).not.toContain("boss@acme.com");
    expect(s.mails().some((m) => m.to_addr === "boss@acme.com" && /asks to prepare/.test(m.subject))).toBe(true);
    expect(p.errors).toEqual([]);
  });
  test("the helper's page with a wrong key goes back to the sign-in view and keeps nothing", async () => {
    const s = await setup();
    const p = await page(s, "/helpdesk.html", "helpdesk.html", ["common.js", "helpdesk.js"], { local: { "cbz-pkey": "ctp_" + "0".repeat(40) } });
    await p.waitFor((x) => /Become a Help Desk person/.test(x));
    expect(p.win.localStorage.getItem("cbz-pkey")).toBeNull(); expect(p.$("a[href='/partner.html#joinbox']")).toBeTruthy();
  });
  test("the invitation page: shows the promise, signs the Organizer in with the e-mail code, Allow makes the helper's key", async () => {
    const s = await setup();
    // join and invite as the helper (partner key header)
    const joined = await fetchWith(s, "POST", "/api/helpdesk/join", { email: "asha@partner.example" }, { "x-partner": s.partnerKey }); expect(joined.status).toBe(200);
    expect((await fetchWith(s, "POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, { "x-partner": s.partnerKey })).status).toBe(200);
    const t = s.tokenFrom(/asks to prepare/, "helpdesk-accept");
    const p = await page(s, `/helpdesk-accept.html?t=${t}`, "helpdesk-accept.html", ["termsbox.js", "helpdesk-accept.js"]);
    await p.waitFor((x) => /Asha asks to prepare games for you/.test(x));
    expect(p.text()).toMatch(/Only you publish/); expect(p.text()).toMatch(/b\*\*\*@acme\.com/);
    expect(p.win.location.search).toBe(""); // the token left the address bar
    await p.waitFor(() => !!p.$(".tb input")); (p.$("#em") as any).value = "boss@acme.com"; p.click("#go"); // the Terms box (K2) is drawn from the server wording first
    await p.waitFor((x) => /6-digit code sent to boss@acme.com/.test(x));
    const code = [...s.mails()].reverse().find((m) => m.to_addr === "boss@acme.com" && /sign-in|Sign in/i.test(m.subject))!.body.match(/\b\d{6}\b/)![0];
    (p.$("#cd") as any).value = code; p.click("#go");
    await p.waitFor((x) => /By tapping Allow/.test(x));
    p.click("#ok");
    await p.waitFor((x) => /can now prepare games for you/.test(x));
    expect(s.world.raw.prepare("SELECT state FROM helpdesk_link").get()).toEqual({ state: "active" });
    // Stop from the same page
    (p.win as any).confirm = () => true; p.click("#stop");
    await p.waitFor((x) => /Stopped\./.test(x));
    expect(s.world.raw.prepare("SELECT state FROM helpdesk_link").get()).toEqual({ state: "stopped" });
    expect(p.errors).toEqual([]);
  });
  test("the invitation page: a wrong or missing token says so, and nothing is allowed by opening the link", async () => {
    const s = await setup();
    const bad = await page(s, `/helpdesk-accept.html?t=${"0".repeat(48)}`, "helpdesk-accept.html", ["termsbox.js", "helpdesk-accept.js"]);
    await bad.waitFor((x) => /This link is not valid/.test(x));
    const none = await page(s, "/helpdesk-accept.html", "helpdesk-accept.html", ["termsbox.js", "helpdesk-accept.js"]);
    await none.waitFor((x) => /incomplete/.test(x));
    expect(s.world.raw.prepare("SELECT COUNT(*) c FROM helpdesk_link").get()).toEqual({ c: 0 });
  });
  test("the one-tap publish page: summary, confirm e-mail and mobile, Terms boxes, Publish; the game is published by the Organizer and the link is used up", async () => {
    const s = await setup();
    const hp = { "x-partner": s.partnerKey };
    await fetchWith(s, "POST", "/api/helpdesk/join", { email: "asha@partner.example" }, hp);
    await fetchWith(s, "POST", "/api/helpdesk/invite", { email: "boss@acme.com" }, hp);
    const t0 = s.tokenFrom(/asks to prepare/, "helpdesk-accept");
    expect((await fetchWith(s, "POST", "/api/helpdesk/accept", { t: t0, consent: true }, { "x-organizer": s.master })).status).toBe(200);
    const me = await (await fetchWith(s, "GET", "/api/helpdesk/me", undefined, hp)).json() as any;
    const aiKey = me.clients[0].consoleUrl.match(/k=(cba_[0-9a-f]{48})/)[1] as string, linkId = me.clients[0].id as string;
    expect((await fetchWith(s, "POST", "/api/z", { id: "PG-1", startRound: FAR, callSeconds: 9, cap: 300, name: "Annual Day" }, { "x-organizer": aiKey })).status).toBe(200);
    expect((await fetchWith(s, "POST", "/api/helpdesk/request-publish", { linkId, eid: "PG-1" }, hp)).status).toBe(200);
    const t = s.tokenFrom(/asks you to publish/, "helpdesk-approve");
    const p = await page(s, `/helpdesk-approve.html?t=${t}`, "helpdesk-approve.html", ["termsbox.js", "helpdesk-approve.js"]);
    await p.waitFor((x) => /Asha asks you to publish this game/.test(x));
    expect(p.text()).toMatch(/Annual Day/); expect(p.text()).toMatch(/Up to 300 people/); expect(p.text()).toMatch(/Only you publish and pay/);
    expect(p.win.location.search).toBe("");
    await p.waitFor(() => !!p.$(".tb input")); (p.$("#em") as any).value = "boss@acme.com"; (p.$("#ph") as any).value = "98765 00009"; p.click("#pub");
    await p.waitFor((x) => /Your game is live/.test(x));
    expect(s.world.raw.prepare("SELECT COUNT(*) c FROM kv WHERE k='pub/PG-1'").get()).toEqual({ c: 1 });
    expect((s.world.raw.prepare("SELECT used_ms FROM helpdesk_pub").get() as any).used_ms).not.toBeNull();
    expect(s.world.raw.prepare("SELECT COUNT(*) c FROM organizer_key WHERE created_by='d' AND kind='host' AND host_id=hash").get()).toEqual({ c: 1 });
    expect(s.world.raw.prepare("SELECT kind FROM consent_log WHERE kind='K1'").all().length).toBe(1);
    // the link is used up
    const again = await page(s, `/helpdesk-approve.html?t=${t}`, "helpdesk-approve.html", ["termsbox.js", "helpdesk-approve.js"]);
    await again.waitFor((x) => /already been used/.test(x));
    expect(p.errors).toEqual([]);
  });
  test("regressions found by the real-Chrome simulation (S12): Sign out is not hidden, text links are 40 px targets, the token pages have one main heading, the prize list never depends on prize text, the console says 'Not published' for an AI key", () => {
    const hd = readFileSync(join(PUB, "helpdesk.js"), "utf8");
    expect(hd).not.toMatch(/class="zhead"/); // partner.css hides .zhead inside the hero card: the signed-in header (and its Sign out) must not use it
    expect(hd).toMatch(/class="hdl" id="out"/);
    for (const f of ["helpdesk-accept.js", "helpdesk-approve.js"]) { const j = readFileSync(join(PUB, f), "utf8"); expect(j).toContain('<h1 class="hdh">'); expect(j).toContain('class="hdl"'); }
    expect(readFileSync(join(PUB, "z.css"), "utf8")).toMatch(/\.hdl\{[^}]*min-height:40px/);
    const ap = readFileSync(join(PUB, "helpdesk-approve.js"), "utf8"); expect(ap).toContain("r.label || r.pattern"); expect(ap).not.toContain("r.house");
    expect(readFileSync(join(PUB, "zc.js"), "utf8")).toContain("pr && pr.needsOrganizer"); // an AI key's Publish only hands the link over: the console must not say "Published."
  });
  test("the pages are shipped: in the build list, noindex for the two token pages, indexable home, linked from the partner page and the guide", () => {
    const build = readFileSync(join(import.meta.dir, "../../../pages/build.mjs"), "utf8");
    for (const f of ["helpdesk.html", "helpdesk.js", "helpdesk-accept.html", "helpdesk-accept.js", "helpdesk-approve.html", "helpdesk-approve.js"]) expect(build).toContain(`"${f}"`);
    expect(build).toContain('["/helpdesk-accept", PLAINCSP, true]'); expect(build).toContain('["/helpdesk-approve", PLAINCSP, true]'); expect(build).toContain('["/helpdesk", PLAINCSP, false]');
    for (const f of ["helpdesk-accept.html", "helpdesk-approve.html"]) expect(readFileSync(join(PUB, f), "utf8")).toMatch(/name="robots" content="noindex, nofollow"/);
    expect(readFileSync(join(PUB, "helpdesk.html"), "utf8")).not.toMatch(/noindex/);
    expect(readFileSync(join(PUB, "partner.html"), "utf8")).toContain('href="/helpdesk.html"'); expect(readFileSync(join(PUB, "organizer-guide.html"), "utf8")).toContain('href="/helpdesk.html"');
    const robots = readFileSync(join(PUB, "robots.txt"), "utf8"); expect(robots).toContain("Disallow: /helpdesk-accept.html"); expect(robots).toContain("Disallow: /helpdesk-approve.html");
    expect(readFileSync(join(PUB, "zc.js"), "utf8")).toContain("cb[hca]_"); // a helper opens the console with their AI key
  });
});
