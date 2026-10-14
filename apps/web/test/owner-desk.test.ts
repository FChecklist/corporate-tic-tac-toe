// The owner desk on the owner page (owner-desk.js): the site switch, data requests with a Close button, mail events, error counts, organizer lookup. Real page scripts in a DOM, real Worker code.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";

setDefaultTimeout(30_000);
const START = roundAt(T) + 1200;
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });
const txt = (p: Page) => String(p.win.document.body.textContent).replace(/\s+/g, " ").trim();
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function desk() {
  const w = newWorld({ DATA_KEY: "k" });
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  const p = await openPage(w.world, { url: "http://localhost/owner-visits.html", html: "owner-visits.html", scripts: ["owner-visits.js", "owner-desk.js"], afterLoad: (win) => { win.confirm = () => true; } }); open.push(p);
  p.win.document.getElementById("key").value = "plat";
  return { w, p, token: s.token as string, aiKey: s.aiKey as string };
}
const click = async (p: Page, id: string) => { p.win.document.getElementById(id).dispatchEvent(new p.win.MouseEvent("click", { bubbles: true })); await tick(); };

describe("the owner desk page", () => {
  test("the site switch: shows ON, switches OFF after asking, shows OFF with the note, switches ON again", async () => {
    const { p, w } = await desk();
    await click(p, "deskSite"); expect(txt(p)).toMatch(/The site is ON/); expect(txt(p)).toMatch(/Switch the site OFF/);
    p.win.document.getElementById("deskNote").value = "short pause";
    const btn = [...p.win.document.querySelectorAll("#deskout button")][0]; btn.dispatchEvent(new p.win.MouseEvent("click", { bubbles: true })); await tick(150);
    expect(txt(p)).toMatch(/The site is OFF/); expect(txt(p)).toMatch(/short pause/); expect(txt(p)).toMatch(/Switch the site ON/);
    w.world.now += 10_000; expect((await w.api("GET", "/api/notices")).status).toBe(503);
    const on = [...p.win.document.querySelectorAll("#deskout button")][0]; on.dispatchEvent(new p.win.MouseEvent("click", { bubbles: true })); await tick(150);
    expect(txt(p)).toMatch(/The site is ON/); w.world.now += 10_000; expect((await w.api("GET", "/api/notices")).status).toBe(200);
  });
  test("a wrong key says Not found, nothing else", async () => {
    const { p } = await desk(); p.win.document.getElementById("key").value = "wrong";
    await click(p, "deskSite"); expect(txt(p)).toMatch(/Not found\. Check the key\./); expect(txt(p)).not.toMatch(/The site is/);
  });
  test("data requests: a player's request is listed and the Close button closes it", async () => {
    const { p, w, token } = await desk();
    expect((await w.api("POST", "/api/z", { id: "OD-1", startRound: START, callSeconds: 6, cap: 100 }, token)).status).toBe(200);
    expect((await w.api("POST", "/api/z/OD-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, token)).status).toBe(200);
    const dev = "ab".repeat(16);
    const pid = (await w.json(await w.api("POST", "/api/z/OD-1/join", { name: "Maya", device: dev }))).pid;
    expect((await w.api("POST", "/api/z/OD-1/datareq", { pid, device: dev, kind: "access", note: "hello" })).status).toBe(200);
    await click(p, "deskReq"); expect(txt(p)).toMatch(/1 request\(s\)/); expect(txt(p)).toMatch(/OD-1/); expect(txt(p)).toMatch(/hello/);
    const close = [...p.win.document.querySelectorAll("#deskout button")].find((b: any) => b.textContent === "Close"); expect(close).toBeTruthy();
    close.dispatchEvent(new p.win.MouseEvent("click", { bubbles: true })); await tick(150);
    expect(txt(p)).toMatch(/0 request\(s\)/);
    const d = p.win.document.getElementById("deskStatus"); d.value = "done"; await click(p, "deskReq"); expect(txt(p)).toMatch(/1 request\(s\)/);
  });
  test("mail events and error counts are shown; the organizer lookup lists the games", async () => {
    const { p, w, token } = await desk();
    w.world.raw.prepare("INSERT INTO mail_bounce(id,at_ms,event,to_hash,to_mask,subject,kind,detail) VALUES('x',?,'bounced','h','m***@acme.com','Sign-in code',NULL,'Permanent/General')").run(T);
    w.world.raw.prepare("INSERT INTO kv(k,v) VALUES('err/2026-10-01T09:5','4')").run();
    await click(p, "deskMailEv"); expect(txt(p)).toMatch(/m\*\*\*@acme\.com/); expect(txt(p)).toMatch(/Permanent\/General/); expect(txt(p)).toMatch(/Webhook off/);
    await click(p, "deskErr"); expect(txt(p)).toMatch(/error answer\(s\) in the last hour/);
    await w.api("POST", "/api/z", { id: "OD-2", startRound: START, callSeconds: 6, cap: 100 }, token);
    p.win.document.getElementById("deskMail").value = "boss@acme.com";
    p.win.document.getElementById("deskOrg").dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true })); await tick(150);
    expect(txt(p)).toMatch(/Games of boss@acme\.com/); expect(txt(p)).toMatch(/OD-2/); expect(txt(p)).toMatch(/draft/);
  });
});
