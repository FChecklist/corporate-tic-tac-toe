// A5: while the owner has switched the site off, a page that makes a call to the Worker gets the plain 503 and rum.js puts a "Back soon" cover over it.
// Real page script in a DOM, real Worker code, in-memory database.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, type Page } from "./harness";

setDefaultTimeout(30_000);
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("the Back soon cover (rum.js)", () => {
  test("while the site is on there is no cover; after the owner switches it off, the first call that gets the 503 covers the page; switching on again lets a reload through", async () => {
    const w = newWorld();
    const p = await openPage(w.world, { url: "http://localhost/", html: "index.html", scripts: ["rum.js"] }); open.push(p);
    expect((await p.win.fetch("/api/notices")).status).toBe(200); await tick();
    expect(p.win.document.getElementById("back-soon")).toBeNull();
    expect((await w.api("POST", "/api/owner/site", { off: true, note: "test" }, "plat")).status).toBe(200);
    w.world.now += 10_000; // past the few seconds a Worker instance remembers the flag
    const r = await p.win.fetch("/api/notices"); expect(r.status).toBe(503); await tick();
    const cover = p.win.document.getElementById("back-soon"); expect(cover).not.toBeNull();
    expect(cover.textContent).toMatch(/Back soon/); expect(cover.getAttribute("role")).toBe("alert"); expect(cover.textContent).not.toMatch(/owner|legal|review/i);
    await p.win.fetch("/api/notices"); await tick(); expect(p.win.document.querySelectorAll("#back-soon").length).toBe(1); // one cover, not a pile
    expect((await w.api("POST", "/api/owner/site", { off: false }, "plat")).status).toBe(200);
    const q = await openPage(w.world, { url: "http://localhost/", html: "index.html", scripts: ["rum.js"] }); open.push(q);
    expect((await q.win.fetch("/api/notices")).status).toBe(200); await tick(); expect(q.win.document.getElementById("back-soon")).toBeNull();
  });
  test("an ordinary 503 (not the owner's switch) does not cover the page", async () => {
    const w = newWorld(); let armed = false;
    const p = await openPage(w.world, { url: "http://localhost/", html: "index.html", scripts: ["rum.js"], afterLoad: (win, f) => { // before rum.js loads: the page's own fetch answers one address with an ordinary 503
      if (armed) return; armed = true; const real = win.fetch;
      win.fetch = async (u: any, i: any) => (String(u).includes("/api/odd") ? new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "content-type": "application/json" } }) : real(u, i));
    } }); open.push(p);
    expect((await p.win.fetch("/api/odd")).status).toBe(503); await tick();
    expect(p.win.document.getElementById("back-soon")).toBeNull();
  });
});
