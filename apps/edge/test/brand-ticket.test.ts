// Phase 3: the brand on the ticket (docs/ROLES_AND_CONSOLE_SPEC_4.md section B, spec 2 item 11): a name, one of 8 colours and an optional small logo kept INSIDE the game's settings.
// Nothing is ever fetched from outside: a logo is a data URL whose type, size and first bytes are all checked here, on the server.
import { beforeEach, describe, expect, test } from "bun:test";
import { BRAND_COLORS, BRAND_LOGO_MAX_BYTES, checkBrandLogo, validateCfg } from "../../../packages/beacon/src/config";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367, START = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const call = (method: string, path: string, body?: unknown, key?: string, raw0?: string) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: raw0 ?? (body === undefined ? undefined : JSON.stringify(body)) }), env as Env, T);
const j = async (r: Response) => (await r.json()) as any;
const dataUrl = (mime: string, bytes: number[], pad = 0) => `data:${mime};base64,${Buffer.from([...bytes, ...new Array(pad).fill(1)]).toString("base64")}`;
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const pngOf = (w: number, h: number) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h)];
const jpgOf = (w: number, h: number) => [0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1];
const webpOf = (w: number, h: number) => [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)), [..."VP8X"].map((c) => c.charCodeAt(0)), [10, 0, 0, 0], [0, 0, 0, 0], le24(w - 1), le24(h - 1));
const PNG = pngOf(96, 96), JPG = jpgOf(96, 96), WEBP = webpOf(96, 96);
const png = (pad = 0) => dataUrl("image/png", PNG, pad), jpeg = (pad = 0) => dataUrl("image/jpeg", JPG, pad), webp = (pad = 0) => dataUrl("image/webp", WEBP, pad);
const C0 = BRAND_COLORS[0]!;

beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "http://x" } as PayEnv; });
const game = async () => {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `5.5.5.${++ipN}` }, body: JSON.stringify({ email: `b${ipN}@acme.com` }) }), env as Env, T));
  await call("POST", "/api/z", { id: "BRAND-1", startRound: START, callSeconds: 6, cap: 100 }, st.token);
  await call("POST", "/api/z/BRAND-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, st.token);
  return st.token as string;
};

describe("validateCfg: the brand rules", () => {
  test("a name, a palette colour and a PNG, JPEG or WebP logo are accepted; the palette has exactly 8 colours", () => {
    expect(BRAND_COLORS).toHaveLength(8);
    for (const logo of [undefined, png(), jpeg(), webp()]) {
      const v = validateCfg({ brand: { name: "Acme Foods", color: C0, ...(logo ? { logo } : {}) } });
      expect(v.ok).toBe(true); if (v.ok) expect(v.cfg.brand).toEqual({ name: "Acme Foods", color: C0, ...(logo ? { logo } : {}) });
    }
    expect((validateCfg({ brand: { name: "Acme", color: C0.toLowerCase() } }) as any).cfg.brand.color).toBe(C0); // a colour is stored in the palette's spelling
  });
  test("the name is 1 to 40 characters; markup and quotes are stripped, never kept", () => {
    expect(validateCfg({ brand: { name: "x".repeat(41), color: C0 } }).ok).toBe(false);
    expect(validateCfg({ brand: { name: "   ", color: C0 } }).ok).toBe(false);
    expect(validateCfg({ brand: { name: "x".repeat(40), color: C0 } }).ok).toBe(true);
    const v = validateCfg({ brand: { name: `<img src=x onerror="alert('1')">Acme & Sons\\`, color: C0 } }) as any;
    expect(v.ok).toBe(true); expect(v.cfg.brand.name).not.toMatch(/[<>"'&\\`]/); expect(v.cfg.brand.name).toContain("Acme");
  });
  test("the colour must be one of the 8 palette values (no free hex, no css, no names)", () => {
    for (const c of ["#123456", "red", "#0B3D9", "#0B5D5B; background:url(//evil)", "url(x)", "", 7, null]) expect(validateCfg({ brand: { name: "A", color: c as any } }).ok).toBe(false);
    for (const c of BRAND_COLORS) expect(validateCfg({ brand: { name: "A", color: c } }).ok).toBe(true);
  });
  test("a logo's size in pixels: 48 to 192 on the longest side, at most 4 times wider than tall, read from the picture's own header", () => {
    for (const [name, mk, mime] of [["png", pngOf, "image/png"], ["jpeg", jpgOf, "image/jpeg"], ["webp", webpOf, "image/webp"]] as const) {
      const ok = (w: number, h: number) => checkBrandLogo(dataUrl(mime, mk(w, h))).ok;
      expect([name, ok(96, 96), ok(192, 192), ok(192, 48), ok(48, 48)]).toEqual([name, true, true, true, true]);
      expect([name, ok(193, 96), ok(47, 47), ok(192, 40), ok(2000, 2000)]).toEqual([name, false, false, false, false]);
    }
  });
  test("a logo: only png, jpeg or webp data URLs, at most 30 KB decoded, and the first bytes must match the type", () => {
    const edge = png(BRAND_LOGO_MAX_BYTES - PNG.length), over = png(BRAND_LOGO_MAX_BYTES - PNG.length + 1);
    expect(checkBrandLogo(edge).ok).toBe(true); expect(checkBrandLogo(over).ok).toBe(false);
    const bad: Array<[string, unknown]> = [
      ["a remote address", "https://evil.example/logo.png"], ["svg", `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)/>").toString("base64")}`], ["gif", dataUrl("image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])],
      ["html named png", dataUrl("image/png", [..."<script>alert(1)</script>"].map((c) => c.charCodeAt(0)))], ["jpeg bytes called png", dataUrl("image/png", JPG.concat([0, 0, 0, 0, 0, 0]))],
      ["png bytes called webp", dataUrl("image/webp", PNG)], ["not base64", "data:image/png;base64,@@@@"], ["plain base64 without the prefix", Buffer.from(PNG).toString("base64")], ["a script after the data", png() + "<script>"],
      ["utf8 data url", "data:image/png;charset=utf-8,%89PNG"], ["a number", 5],
    ];
    for (const [why, logo] of bad) { const v = validateCfg({ brand: { name: "A", color: C0, logo } }); expect([why, v.ok]).toEqual([why, false]); }
  });
  test("only name, color and logo exist; null removes the brand; leaving it out keeps it", () => {
    expect(validateCfg({ brand: { name: "A", color: C0, href: "https://x" } as any }).ok).toBe(false);
    expect(validateCfg({ brand: "Acme" }).ok).toBe(false); expect(validateCfg({ brand: [] }).ok).toBe(false);
    const base = (validateCfg({ brand: { name: "Acme", color: C0, logo: png() } }) as any).cfg;
    expect((validateCfg({ name: "Dinner" }, base) as any).cfg.brand).toEqual(base.brand);
    expect((validateCfg({ brand: null }, base) as any).cfg.brand).toBeUndefined();
    expect((validateCfg({ brand: {} }, base) as any).cfg.brand).toBeUndefined();
    expect(validateCfg({}).ok && (validateCfg({}) as any).cfg.brand).toBeFalsy();
  });
});

describe("the brand through the API", () => {
  test("settings saves it; info (what phones read) carries the logo; summary and the join reply carry it as well, but a long list carries no logo", async () => {
    const k = await game();
    const logo = png(2000);
    const r = await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "Acme Foods", color: BRAND_COLORS[2], logo } }, k);
    expect(r.status).toBe(200); expect((await j(r)).brand).toEqual({ name: "Acme Foods", color: BRAND_COLORS[2], logo });
    const info = await j(await call("GET", "/api/z/BRAND-1/info"));
    expect(info.brand).toEqual({ name: "Acme Foods", color: BRAND_COLORS[2], logo });
    expect((await j(await call("GET", "/api/z/BRAND-1/summary", undefined, k))).brand.name).toBe("Acme Foods");
    const joined = await j(await call("POST", "/api/z/BRAND-1/join", { phone: "9123456780", name: "Guest", device: "c".repeat(32) }));
    expect(joined.brand).toEqual({ name: "Acme Foods", color: BRAND_COLORS[2], hasLogo: true }); expect(JSON.stringify(joined)).not.toContain("base64");
    const list = await j(await call("GET", "/api/z/BRAND-1/participants", undefined, k));
    expect(list.brand.hasLogo).toBe(true); expect(JSON.stringify(list)).not.toContain("base64");
  });
  test("a game can be created with a brand, and the brand can be removed again", async () => {
    const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.9.9" }, body: JSON.stringify({ email: "c@acme.com" }) }), env as Env, T));
    expect((await call("POST", "/api/z", { id: "BRAND-2", startRound: START, callSeconds: 6, cap: 100, brand: { name: "Zed", color: C0, logo: webp() } }, st.token)).status).toBe(200);
    await call("POST", "/api/z/BRAND-2/publish", { email: "boss@acme.com", phone: "98765 43210" }, st.token);
    expect((await j(await call("GET", "/api/z/BRAND-2/info"))).brand.name).toBe("Zed");
    expect((await call("PATCH", "/api/z/BRAND-2/settings", { brand: null }, st.token)).status).toBe(200);
    expect((await j(await call("GET", "/api/z/BRAND-2/info"))).brand).toBeUndefined();
  });
  test("a bad brand is refused with a plain reason and changes nothing (oversize, wrong type, injected markup in the colour)", async () => {
    const k = await game();
    await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "Keep", color: C0 } }, k);
    const tooBig = await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "Big", color: C0, logo: png(31 * 1024) } }, k);
    expect(tooBig.status).toBe(400); expect((await j(tooBig)).error).toMatch(/30 KB|too big/i);
    expect((await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "X", color: C0, logo: dataUrl("image/svg+xml", [60, 115, 118, 103]) } }, k)).status).toBe(400);
    expect((await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "X", color: "red;background:url(//evil)" } }, k)).status).toBe(400);
    expect((await call("PATCH", "/api/z/BRAND-1/settings", undefined, k, "x".repeat(70_000))).status).toBe(400); // a request far bigger than any logo
    expect((await j(await call("GET", "/api/z/BRAND-1/info"))).brand).toEqual({ name: "Keep", color: C0 });
  });
  test("a brand that was tampered with in storage is never shown (the stored settings are checked again on every read)", async () => {
    const k = await game();
    await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "Acme", color: C0, logo: png() } }, k);
    const cfg = JSON.parse((raw.prepare("SELECT config FROM engagement WHERE id='BRAND-1'").get() as any).config);
    cfg.brand.logo = `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)/>").toString("base64")}`;
    raw.prepare("UPDATE engagement SET config=? WHERE id='BRAND-1'").run(JSON.stringify(cfg));
    const info = JSON.stringify(await j(await call("GET", "/api/z/BRAND-1/info")));
    expect(info).not.toContain("svg"); expect(info).not.toContain("onload");
  });
  test("the logo travels as text inside the game and nothing in the Worker asks any outside address for it", async () => {
    const k = await game(); const real = globalThis.fetch; let outside = 0; (globalThis as any).fetch = async () => { outside++; return new Response("{}"); };
    try { await call("PATCH", "/api/z/BRAND-1/settings", { brand: { name: "Acme", color: C0, logo: png() } }, k); await call("GET", "/api/z/BRAND-1/info"); } finally { globalThis.fetch = real; }
    expect(outside).toBe(0);
  });
});
