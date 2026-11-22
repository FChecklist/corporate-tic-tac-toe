// TEST AUTHOR 30 Oct 2026. Footer version line (siteversion.js): "Version 1.5.0 | released <date, time> IST" when /version.json is served, plain "Version 1.5.0" otherwise.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
const SRC = readFileSync(new URL("../public/siteversion.js", import.meta.url), "utf8");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Runs the real siteversion.js on a page with `n` data-version elements; fetch answers with `answer` (a Response, or a function that throws). */
async function run(answer: (() => Response | Promise<Response>) | "nofetch", n = 1, plain = "Version 1.5.0") {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/" });
  w.document.body.innerHTML = Array.from({ length: n }, () => `<span data-version>${plain}</span>`).join("");
  const calls: { url: string; init: any }[] = [];
  if (answer !== "nofetch") w.fetch = async (u: string, init: any) => { calls.push({ url: String(u), init }); return answer(); }; else w.fetch = undefined;
  new Function("window", "document", "fetch", "Intl", SRC)(w, w.document, w.fetch, Intl);
  await tick();
  return { text: [...w.document.querySelectorAll("[data-version]")].map((e: any) => e.textContent), calls };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

describe("footer version line", () => {
  test("with /version.json served it reads 'Version 1.5.0 | released 30 Oct 2026, 14:05 IST' style: the build time is shown in India time, not UTC", async () => {
    const r = await run(() => json({ builtAt: "2026-10-30T08:35:00.000Z" })); // 08:35 UTC = 14:05 IST
    expect(r.text).toEqual(["Version 1.5.0 | released 30 Oct 2026 14:05 IST"]);
  });
  test("it asks for /version.json and never uses a cached copy (cache: no-store)", async () => { const r = await run(() => json({ builtAt: "2026-10-30T08:35:00Z" })); expect(r.calls.length).toBe(1); expect(r.calls[0]!.url).toBe("/version.json"); expect(r.calls[0]!.init.cache).toBe("no-store"); });
  test("a build time that is late evening UTC rolls to the NEXT day in IST (30 Oct 20:00 UTC = 31 Oct 01:30 IST)", async () => {
    expect((await run(() => json({ builtAt: "2026-10-30T20:00:00Z" }))).text).toEqual(["Version 1.5.0 | released 31 Oct 2026 01:30 IST"]);
  });
  test("every data-version element on the page is updated", async () => { expect((await run(() => json({ builtAt: "2026-10-30T08:35:00Z" }), 3)).text).toEqual(Array(3).fill("Version 1.5.0 | released 30 Oct 2026 14:05 IST")); });
  const plain = "Version 1.5.0";
  test("404 from /version.json keeps the plain text", async () => { expect((await run(() => new Response("nope", { status: 404 }))).text).toEqual([plain]); });
  test("a network failure keeps the plain text", async () => { expect((await run(() => { throw new Error("offline"); })).text).toEqual([plain]); });
  test("no fetch in the browser keeps the plain text", async () => { expect((await run("nofetch")).text).toEqual([plain]); });
  test("bad JSON, no builtAt, an unreadable date all keep the plain text", async () => {
    expect((await run(() => new Response("{not json", { status: 200 }))).text).toEqual([plain]);
    expect((await run(() => json({ commit: "abc" }))).text).toEqual([plain]);
    expect((await run(() => json({ builtAt: "yesterday-ish" }))).text).toEqual([plain]);
    expect((await run(() => json(null))).text).toEqual([plain]);
  });
  test("a page with no data-version element does nothing and does not call fetch", async () => { const r = await run(() => json({ builtAt: "2026-10-30T08:35:00Z" }), 0); expect(r.calls.length).toBe(0); });
  test("the version in the script equals the version printed in every page footer (no page says an older number)", () => {
    const v = /VERSION = "([^"]+)"/.exec(SRC)![1]!; expect(v).toBe("1.5.0");
    for (const p of ["index", "how-it-works", "guide", "brochure", "refer", "thank-you", "game-completed"]) expect([p, readFileSync(new URL(`../public/${p}.html`, import.meta.url), "utf8").includes(`Version ${v}`)]).toEqual([p, true]);
  });
});
