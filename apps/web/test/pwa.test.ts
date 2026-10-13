// The installable, saved-on-the-device game: manifest, icons and service worker are complete and actually shipped.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PUB = join(import.meta.dir, "../public");
const BUILD = readFileSync(join(import.meta.dir, "../../../pages/build.mjs"), "utf8");
const manifest = JSON.parse(readFileSync(join(PUB, "manifest.webmanifest"), "utf8"));
const sw = readFileSync(join(PUB, "zsw.js"), "utf8");
const filesInSw: string[] = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)![1]!);

describe("installable app (PWA)", () => {
  test("manifest is installable: name, standalone, start url, 192 and 512 icons, one maskable", () => {
    expect(manifest.name).toBe("Corporate Tic Tac Toe"); expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/z.html"); expect(manifest.scope).toBe("/");
    const sizes = manifest.icons.map((i: any) => i.sizes);
    expect(sizes).toContain("192x192"); expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i: any) => i.purpose === "maskable")).toBe(true);
    for (const i of manifest.icons) { const f = join(PUB, i.src.slice(1)); expect(existsSync(f)).toBe(true); expect(statSync(f).size).toBeGreaterThan(500); }
  });
  test("every file the service worker saves exists and is shipped by the Pages build", () => {
    for (const f of filesInSw) {
      expect(existsSync(join(PUB, f.slice(1)))).toBe(true);
      const top = f.slice(1).split("/")[0]!;
      expect(BUILD.includes(`"${top}"`)).toBe(true); // a whitelisted file, or the fonts/img folder
    }
    for (const f of ["zsw.js", "pwa.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) expect(BUILD.includes(`"${f}"`)).toBe(true);
  });
  test("the game pages (every file the phone screen loads) are all in the saved set", () => {
    const html = readFileSync(join(PUB, "z.html"), "utf8");
    const used = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!).filter((u) => u !== "/rum.js");
    for (const u of used) expect(filesInSw).toContain(u);
    expect(filesInSw).toContain("/z.html");
  });
  test("service worker never touches the API or other sites, and the pages link manifest and installer", () => {
    expect(sw).toContain('url.pathname.startsWith("/api/")'); expect(sw).toContain("url.origin !== location.origin");
    for (const p of ["z.html", "zc.html", "big.html", "index.html"]) {
      const h = readFileSync(join(PUB, p), "utf8");
      expect(h).toContain('rel="manifest"'); expect(h).toContain("/pwa.js"); expect(h).toContain("apple-touch-icon");
    }
    expect(readFileSync(join(PUB, "pwa.js"), "utf8")).toContain('register("/zsw.js")');
  });
  test("an installed app opens the last game: the phone page remembers its engagement", () => {
    expect(readFileSync(join(PUB, "ttt.js"), "utf8")).toContain("ttt:last");
  });
  test("it works silently: no banner, no button, no text of ours on any page; news only through the browser's own notification permission", () => {
    const js = readFileSync(join(PUB, "pwa.js"), "utf8");
    expect(js).not.toMatch(/innerHTML|Install app|Saving the game|saved on this device|Remind me/i); // nothing is drawn, except one small "Notify me" button
    expect((js.match(/createElement/g) ?? []).length).toBe(1); expect(js).toContain("Notify me"); expect(js).not.toContain("pointerdown"); // the permission question comes only from a tap on that button
    expect(js).toContain("preventDefault"); expect(js).toContain("Notification.permission"); expect(js).toContain("/api/notices"); expect(js).toContain("periodicSync");
    expect(sw).toContain("periodicsync"); expect(sw).toContain("notificationclick"); expect(sw).toContain('Notification.permission !== "granted"');
    expect(js + sw).not.toMatch(/pushManager|subscribe\(/); // no push subscription: we never receive an address of the visitor
  });
});
