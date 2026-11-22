// The sign-in page's hand-off from the master console: the console makes a one-time link for a signed-in person; the game's own page redeems it and opens that game's own screen.
// (The link is made by POST /api/console/handoff; here the row is written directly so this file tests the PAGE and the redeem route together.)
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";

setDefaultTimeout(30_000);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function setup() {
  const w = newWorld({ CONSOLE_PUBKEYS: "k1:" + "A".repeat(43) });
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  const START = roundAt(T) + 1200;
  for (const id of ["HAND-1", "HAND-2"]) expect((await w.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 10 }, s.token)).status).toBe(200);
  const org = (w.world.raw.prepare("SELECT org FROM engagement WHERE id='HAND-1'").get() as any).org as string;
  const link = (eid: string, kind = "master", ttl = 60_000) => { const t = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join(""); w.world.raw.prepare("INSERT INTO console_handoff(token_hash,eid,kind,org,created_by,expires_ms) VALUES(?,?,?,?,?,?)").run(sha("handoff|" + t), eid, kind, org, "c:test", T + ttl); return t; };
  return { w, link };
}
const visit = async (w: Awaited<ReturnType<typeof setup>>["w"], url: string) => { const p = await openPage(w.world, { url: "http://localhost" + url, html: "signin.html", scripts: ["signin.js"], session: {} }); open.push(p); return p; };

test("hand-off: the page redeems the one-time link, keeps a key for that game in this tab only, and goes to that game's own screen; the token leaves the address bar", async () => {
  const { w, link } = await setup();
  const t = link("HAND-1");
  const p = await visit(w, `/signin?t=${t}&go=console&e=HAND-1`);
  await new Promise((r) => setTimeout(r, 600));
  expect(p.win.location.search).toBe("?e=HAND-1");
  expect(p.win.location.pathname).toContain("zc");
  const key = p.win.sessionStorage.getItem("cbz-org") as string;
  expect(key).toMatch(/^cbk_[0-9a-f]{48}$/);
  expect((await w.api("GET", "/api/z/HAND-1/summary", undefined, key)).status).toBe(200);
  expect((await w.api("GET", "/api/z/HAND-2/summary", undefined, key)).status).toBe(403); // the key is for the one game
  expect((await w.api("GET", "/api/history", undefined, key)).status).toBe(403);
  const row = w.world.raw.prepare("SELECT eid, label, expires_ms FROM organizer_key WHERE label='console'").get() as any;
  expect(row.eid).toBe("HAND-1"); expect(row.expires_ms - T).toBe(16 * 3600_000);
});

test("hand-off: opening the link twice, or after a minute, opens nothing and says so; no key is kept", async () => {
  const { w, link } = await setup();
  const t = link("HAND-1");
  const first = await visit(w, `/signin?t=${t}&go=console&e=HAND-1`);
  await new Promise((r) => setTimeout(r, 500));
  expect(first.win.sessionStorage.getItem("cbz-org")).toBeTruthy();
  const again = await visit(w, `/signin?t=${t}&go=console&e=HAND-1`);
  await again.waitFor((x: string) => /has run out/.test(x));
  expect(again.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
  const old = link("HAND-2", "master", -1000);
  const late = await visit(w, `/signin?t=${old}&go=console&e=HAND-2`);
  await late.waitFor((x: string) => /has run out/.test(x));
  expect(late.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
});

test("the ordinary sign-in page is unchanged: without go=console it still shows the 'Sign in' button and redeems nothing by itself", async () => {
  const { w } = await setup();
  const p = await visit(w, "/signin?t=" + "0".repeat(48));
  await p.waitFor((x: string) => /Press the button to sign in/.test(x));
  expect(p.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
  const q = await visit(w, "/signin?t=" + "0".repeat(48) + "&go=console&e=not a game!");
  await q.waitFor((x: string) => /Press the button to sign in/.test(x)); // an invalid game name is not a hand-off
});
