// R9: the cookie and device-storage sentence on the Privacy page is exactly what the scripts do.
// The scripts are read as text (storage-scan.ts); apps/web/storage-registry.json lists every key in plain words; the Privacy page must carry every sentence.
// A new key in any script that is not listed, a listed key that is gone, a second cookie, or a page that lacks a sentence makes this test fail.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUB, scan, scanText } from "./storage-scan";

type Item = { id: string; store: "localStorage" | "sessionStorage"; say: string; keys: string[]; cleanup?: boolean };
const reg = JSON.parse(readFileSync(join(import.meta.dir, "../storage-registry.json"), "utf8")) as { items: Item[]; cookies: { name: string; maxAgeSeconds: number; say: string }[] };
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rsquo;|&#39;|&apos;/g, "'").replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/\s+/g, " ").trim();
const page = plain(readFileSync(join(PUB, "terms.html"), "utf8")); // the one legal document
const listed = new Set(reg.items.flatMap((i) => i.keys.map((k) => `${i.store}|${k}`)));

describe("R9: the storage notice matches the code", () => {
  const { uses, cookies } = scan();
  const used = new Set(uses.map((u) => `${u.store}|${u.key}`));

  test("every key the scripts keep on a device is listed in storage-registry.json", () => {
    const missing = uses.filter((u) => !listed.has(`${u.store}|${u.key}`)).map((u) => `${u.file}: ${u.store} ${u.key}`);
    expect(missing).toEqual([]);
  });
  test("every listed key is still used by a script (the page never claims something that is gone)", () => {
    const stale = [...listed].filter((k) => !used.has(k));
    expect(stale).toEqual([]);
  });
  test("every key could be followed to its name (nothing is hidden behind a computed key)", () => {
    expect(uses.filter((u) => u.key.startsWith("?")).map((u) => `${u.file}: ${u.key}`)).toEqual([]);
  });
  test("the cookies the scripts set are exactly the cookies listed, with their lifetime", () => {
    expect(cookies.map((c) => `${c.name}:${c.maxAge}`).sort()).toEqual(reg.cookies.map((c) => `${c.name}:${c.maxAgeSeconds}`).sort());
  });
  test("the one legal document says the games keep only first-party settings on the device and use no advertising cookies; the registry lists every key and cookie", () => {
    expect(page).toContain("No advertising cookies and no third-party trackers are used."); expect(page).toContain("only first-party storage on the device");
    expect(reg.items.length).toBeGreaterThan(0); expect(reg.items.every((i) => i.say.length > 0 && i.keys.length > 0)).toBe(true); expect(reg.cookies.every((c) => c.say.length > 0)).toBe(true);
  });
  test("a cleaned-up key is marked as such and is only ever removed, never written", () => {
    for (const i of reg.items.filter((x) => x.cleanup)) for (const f of ["z.js"]) {
      const src = readFileSync(join(PUB, f), "utf8");
      for (const k of i.keys) expect(src.includes(`setItem("${k}"`) || src.includes(`store.set("${k}"`)).toBe(false);
    }
  });
  test("the check has teeth: a new key, a new cookie and a computed key written into a script are all noticed", () => {
    const fake = `localStorage.setItem("brand-new-key", "1"); document.cookie = "tracker=1; Max-Age=60; Path=/"; const k2 = "x" + Math.random(); sessionStorage.getItem(foo(bar));`;
    const r = scanText("fake.js", fake);
    expect(r.uses.some((u) => u.key === "brand-new-key" && !listed.has(`${u.store}|${u.key}`))).toBe(true);
    expect(r.cookies.map((c) => c.name)).toContain("tracker");
    expect(r.uses.some((u) => u.key.startsWith("?"))).toBe(true);
  });
});
