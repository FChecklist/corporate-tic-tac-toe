// Demo label (demo-label.js, owner order 1 Nov 2026): the real script runs against a small stand-in for the browser. A demo game shows a "Demo" bar; any other game shows nothing;
// the three game screens load the script; the demo link, the owner-only test page key and the wording rules hold.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PUB = new URL("../public/", import.meta.url), rd = (f: string) => readFileSync(new URL(f, PUB), "utf8");
const JS = rd("demo-label.js");

async function run(search: string, info: unknown, ok = true) {
  const added: any[] = []; const asked: string[] = [];
  const ctx: any = {
    URLSearchParams, encodeURIComponent, RegExp, Promise,
    location: { search },
    fetch: (u: string) => { asked.push(u); return Promise.resolve({ ok, json: () => Promise.resolve(info) }); },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), body: { insertBefore: (el: any) => added.push(el), firstChild: null } },
  };
  vm.createContext(ctx); vm.runInContext(JS, ctx); await new Promise((r) => setTimeout(r, 5));
  return { added, asked };
}

describe("the Demo bar", () => {
  test("a demo game gets one bar that says Demo", async () => {
    const x = await run("?e=DEMO-1", { demo: true }); expect(x.added.length).toBe(1); expect(x.added[0].textContent).toMatch(/^DEMO/); expect(x.asked).toEqual(["/api/z/DEMO-1/info"]);
  });
  test("a normal game, an unknown game, a failed answer or no game code get no bar", async () => {
    expect((await run("?e=REAL-1", { rs0: true })).added.length).toBe(0);
    expect((await run("?e=REAL-1", null, false)).added.length).toBe(0);
    expect((await run("?e=a b!", { demo: true })).asked.length).toBe(0);
    expect((await run("", { demo: true })).asked.length).toBe(0);
  });
  test("the console, the player page and the big screen all load it, and it is shipped", () => {
    for (const f of ["zc.html", "z.html", "big.html"]) expect(rd(f)).toContain('src="/demo-label.js"');
    expect(readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8")).toContain('"demo-label.js"');
  });
  test("the script stores nothing and uses no forbidden word", () => {
    expect(JS).not.toMatch(/localStorage|sessionStorage|document\.cookie|innerHTML/); expect(JS).not.toMatch(/erase|private game|\bwe\b|\bour\b/i);
  });
});

describe("the way in", () => {
  test("the console sends demo:true only for the demo link, and the pages link to it", () => {
    expect(rd("zc.js")).toContain("...(NEWDEMO ? { demo: true } : {})");
    expect(rd("brochure.html")).toContain("/zc?demo=1");
  });
  test("the Rs 1 test page sends the owner key from the address fragment as a header and nowhere else", () => {
    const js = rd("paytest.js"); expect(js).toContain("location.hash"); expect(js).toContain('"x-organizer"'); expect(js).not.toMatch(/localStorage|sessionStorage|location\.search/);
    expect(rd("common.js")).toContain("Object.assign(headers, opt.headers)");
  });
});
