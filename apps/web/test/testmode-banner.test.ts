// The TEST MODE notice (docs/TEST_AND_LIVE_MODE.md) lives inside the organizer console only: never on the public pages, the payment page, the participant phone page, the big screen or the report page.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newWorld, openPage, type Page } from "./harness";
import { setMode } from "../../edge/src/mode";

setDefaultTimeout(30_000);
const PUB = join(import.meta.dir, "../public");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function consoleIn(mode: "TEST" | "LIVE") {
  const w = newWorld();
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  if (mode === "TEST") await setMode(w.world.env as any, "TEST", "banner test", w.world.now);
  const p = await openPage(w.world, { url: "http://localhost/zc", html: "zc.html", scripts: ["zgame.js", "control.js", "zc.js"], session: { "cbz-org": s.token, "cbz-aimsg": s.aiMessage, "cbz-email": "boss@acme.com" } });
  open.push(p); await p.waitFor((x) => /Start a new game/.test(x)); await new Promise((r) => setTimeout(r, 30));
  return p;
}

describe("TEST MODE banner", () => {
  test("in TEST the organizer console shows one calm notice, outside the working area", async () => {
    const p = await consoleIn("TEST");
    const b = p.win.document.getElementById("testmode"); expect(b).toBeTruthy();
    expect(b.textContent).toMatch(/^TEST MODE: nothing here is real\./); expect(b.getAttribute("role")).toBe("status");
    expect(p.win.document.querySelectorAll("#testmode").length).toBe(1);
    expect(p.win.document.getElementById("app").contains(b)).toBe(false); // the console redraws #app; the notice is not wiped with it
    expect(p.errors).toEqual([]);
  });
  test("in LIVE the console has no notice at all", async () => {
    const p = await consoleIn("LIVE");
    expect(p.win.document.getElementById("testmode")).toBeNull(); expect(p.win.document.body.textContent).not.toMatch(/TEST MODE/);
    expect(p.errors).toEqual([]);
  });
  test("only the organizer console's own files carry the wording: no public page, participant page, screen, report or shared script does", () => {
    const hits = readdirSync(PUB).filter((f) => /\.(html|js|css|webmanifest|txt)$/.test(f)).filter((f) => /TEST MODE|testmode|ztest/.test(readFileSync(join(PUB, f), "utf8")));
    expect(hits.sort()).toEqual(["zc.css", "zc.js"]);
  });
});
