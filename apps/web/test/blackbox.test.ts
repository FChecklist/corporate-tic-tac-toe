// The error box, end to end: the recorder on the person's device (blackbox.js) builds a complete, clean report; the box (pages/functions/api/blackbox.ts) stores and groups it;
// the Worker adds the server-side errors (apps/edge/src/errorbox.ts); the owner's tools read and close them. Above all: no personal data can get in.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { onRequest, scrub, clean, toMarkdown } from "../../../pages/functions/api/blackbox";
import { recordServerError, scrubText, routeLabel } from "../../edge/src/errorbox";
import { newWorld, openPage, T, type Page } from "./harness";

setDefaultTimeout(30_000);
const PUB = join(import.meta.dir, "../public");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

/** A page of the site with the recorder, and a sendBeacon that keeps what it is given. */
async function device(o: { html?: string; url?: string; online?: boolean; noBeacon?: boolean } = {}) {
  const w = newWorld({ DATA_KEY: "k" });
  const sent: any[] = [];
  const p = await openPage(w.world, {
    url: "http://localhost" + (o.url ?? "/z.html?e=GAME1234"), html: o.html ?? "z.html", scripts: ["blackbox.js"],
    afterLoad: (win, file) => {
      if (file !== "blackbox.js" && file !== "consent.js") return; if (win.__bbHook) return; win.__bbHook = true;
      Object.defineProperty(win.navigator, "sendBeacon", { configurable: true, value: o.noBeacon ? undefined : (_u: string, blob: Blob) => { blob.text().then((t) => sent.push(JSON.parse(t))); return true; } });
      if (o.online === false) Object.defineProperty(win.navigator, "onLine", { configurable: true, get: () => false });
      win.console = { ...console };
    },
  });
  open.push(p);
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const boom = (message: string, extra: any = {}) => p.win.dispatchEvent(new p.win.ErrorEvent("error", { message, error: Object.assign(new Error(message), extra), filename: "http://localhost/z.js", lineno: 12 }));
  return { p, w, sent, settle, boom };
}

describe("the recorder on the device", () => {
  test("an error becomes one complete report with the game, the stage, the device and the trail of actions", async () => {
    const d = await device();
    d.p.win.document.body.innerHTML += '<button id="join" data-ck="join.go">Call me on 9812345678</button>';
    d.p.win.document.getElementById("join").click();
    d.p.win.ctzView({ phase: "play", locked: false, log: [1, 2, 3] });
    d.boom("Cannot read properties of undefined (reading 'x')");
    await d.settle();
    expect(d.sent.length).toBe(1);
    const r = d.sent[0];
    expect(r).toMatchObject({ v: 1, kind: "script", sev: "error", role: "player", game: "GAME1234", page: "/z" });
    expect(r.stage).toContain("play");
    expect(r.msg).toContain("Cannot read properties");
    expect(r.dev.browser).toBeTruthy(); expect(r.dev.view).toMatch(/^\d+x\d+$/);
    const kinds = r.trail.map((t: any) => t.t);
    expect(kinds).toContain("tap"); expect(kinds).toContain("stage");
    expect(JSON.stringify(r)).not.toContain("9812345678"); // the words written on a button are never recorded
    expect(JSON.stringify(r.trail)).toContain("button #join ck=join.go");
  });
  test("a phone number, an e-mail, a token or a key inside an error is replaced before anything is kept", async () => {
    const d = await device();
    d.boom("failed for asha@example.com on +91 98123 45678 with t=abcdef0123456789abcdef0123456789 and key 0123456789abcdef0123456789abcdef");
    await d.settle();
    const s = JSON.stringify(d.sent[0]);
    for (const bad of ["asha@example.com", "98123 45678", "9812345678", "abcdef0123456789abcdef0123456789", "0123456789abcdef0123456789abcdef"]) expect(s).not.toContain(bad);
    expect(d.sent[0].msg).toContain("[email]"); expect(d.sent[0].msg).toContain("[number]");
  });
  test("the same error twice is one report, and a flood stops at six", async () => {
    const d = await device();
    d.boom("same thing"); d.boom("same thing"); await d.settle();
    expect(d.sent.length).toBe(1);
    for (let i = 0; i < 12; i++) d.boom("different thing " + String.fromCharCode(97 + i) + "x".repeat(i)); await d.settle();
    expect(d.sent.length).toBeLessThanOrEqual(6);
  });
  test("a server error and a call that never arrived are errors; the trail shows each call with its status and time", async () => {
    const d = await device();
    (d.w.world.env as any).DB = { prepare() { throw new Error("database down"); }, batch() { throw new Error("database down"); } }; // the real Worker now answers 500
    await d.p.win.fetch("/api/z/GAME1234/vote?me=secretpid", { method: "POST" });
    await d.p.win.fetch("https://elsewhere.example/api/down").catch(() => {}); // never reaches the server
    await d.p.win.fetch("/api/z/GAME1234/vote?me=secretpid", { method: "POST" }); // the same failure again is not reported twice
    await d.settle();
    expect(d.sent.map((r) => r.kind).sort()).toEqual(["network", "server"]);
    const srv = d.sent.find((r) => r.kind === "server");
    expect(srv.msg).toContain("server error 500 on POST /api/z/GAME1234/vote (server-error)");
    expect(JSON.stringify(d.sent)).not.toContain("secretpid");
    expect(srv.trail.some((t: any) => t.t === "call" && /POST \/api\/z\/GAME1234\/vote 500 \d+ms/.test(t.d))).toBe(true);
  });
  test("offline: the report waits on the device and goes when the phone is back online", async () => {
    const d = await device({ online: false });
    d.boom("while offline"); await d.settle();
    expect(d.sent.length).toBe(0);
    const q = JSON.parse(d.p.win.localStorage.getItem("ctz-bbq") || "[]");
    expect(q.length).toBe(1); expect(JSON.parse(q[0]).msg).toContain("while offline");
    Object.defineProperty(d.p.win.navigator, "onLine", { configurable: true, get: () => true });
    d.p.win.dispatchEvent(new d.p.win.Event("online")); await d.settle();
    expect(d.sent.length).toBe(1); expect(d.p.win.localStorage.getItem("ctz-bbq")).toBeNull();
  });
  test("the scrubber alone: what it keeps and what it removes", () => {
    expect(scrub("see /api/paylink/0123456789abcdef0123?t=secret&me=pid123 now")).not.toMatch(/secret|pid123/);
    expect(scrub("a normal sentence about a ticket")).toBe("a normal sentence about a ticket");
    expect(scrubText("mail a@b.co or call 9812345678")).toBe("mail [email] or call [number]");
    expect(routeLabel("http://x/api/paylink/0123456789abcdef0123456789?t=abc")).toBe("/api/paylink/[id]");
    expect(routeLabel("https://x/j/SOMETOKEN123?me=pid")).toBe("/j/[id]");
  });
});

/** The error box with a real database behind it. */
function box() {
  const w = newWorld({ DATA_KEY: "k" });
  const env = { DB: w.world.env.DB, REPORT_KEY: "owner-key-123" };
  const post = (body: unknown, headers: Record<string, string> = {}) => onRequest({ request: new Request("http://localhost/api/blackbox", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), env });
  const get = (qs: string, key = "owner-key-123") => onRequest({ request: new Request("http://localhost/api/blackbox" + qs, { headers: key ? { authorization: "Bearer " + key } : {} }), env });
  return { w, env, post, get };
}
const rep = (o: any = {}) => ({ v: 1, id: "r" + Math.random().toString(36).slice(2, 8), fp: "fp1", kind: "script", sev: "error", msg: "boom", stack: "Error: boom\n at f (http://localhost/z.js:12:3)", page: "/z", role: "player", game: "GAME1234", stage: "play", rel: "abc123", after: 5,
  dev: { browser: "Chrome 130", os: "Android 14", view: "390x844", dpr: 3, lang: "en-IN", tz: -330, online: true, net: "4g", app: true, worker: true, visible: "visible" }, trail: [{ s: 1, t: "tap", d: "button #join" }, { s: 2, t: "call", d: "POST /api/z/GAME1234/join 200 120ms" }], ...o });

describe("the error box", () => {
  test("a report is stored, grouped by its fingerprint, and counted", async () => {
    const b = box();
    await b.post(rep()); await b.post(rep()); await b.post(rep({ fp: "fp2", msg: "another" }));
    const r = await (await b.get("?status=open")).json() as any;
    expect(r.count).toBe(2);
    expect(r.groups.find((g: any) => g.fp === "fp1").n).toBe(2);
  });
  test("what is stored is cleaned again on the server, and odd or oversized bodies are ignored", async () => {
    const b = box();
    const res = await b.post(rep({ msg: "bad asha@example.com +919812345678", trail: [{ s: 1, t: "tap", d: "x t=abcdef0123456789abcdef0123456789" }], game: "has space" }));
    expect(res.status).toBe(204);
    const md = await (await b.get("?fp=fp1&format=md")).text();
    for (const bad of ["asha@example.com", "919812345678", "abcdef0123456789abcdef0123456789", "has space"]) expect(md).not.toContain(bad);
    expect((await b.post("not json")).status).toBe(204);
    expect((await b.post("x".repeat(30000))).status).toBe(204);
    expect(clean({ v: 2, fp: "a" })).toBeNull();
    expect(clean({ v: 1 })).toBeNull();
  });
  test("only the owner can read, and the plain report has everything an AI needs", async () => {
    const b = box(); await b.post(rep());
    expect((await b.get("?status=open", "")).status).toBe(404);
    expect((await b.get("?status=open", "wrong")).status).toBe(404);
    const md = await (await b.get("?fp=fp1&format=md")).text();
    for (const need of ["Error fp1", "boom", "GAME1234", "play", "Chrome 130", "Android 14", "390x844", "POST /api/z/GAME1234/join 200 120ms", "button #join", "Status: **new**"]) expect(md).toContain(need);
  });
  test("fixing: the owner's AI must name the files and say what was done; then it shows fixed, and comes back as reopened if it happens again after the fix had time to reach devices", async () => {
    const b = box(); await b.post(rep());
    const bare = await b.post({ resolve: { fp: "fp1" } }, { authorization: "Bearer owner-key-123" }) as Response;
    expect(bare.status).toBe(400);
    expect((await b.post({ resolve: { fp: "fp1", files: ["a.js"], note: "x" } })).status).toBe(404); // no key
    const ok = await b.post({ resolve: { fp: "fp1", files: ["apps/web/public/z.js"], note: "the guard was missing", commit: "abc1234" } }, { authorization: "Bearer owner-key-123" }) as Response;
    expect(ok.status).toBe(200);
    expect((await (await b.get("?status=open")).json() as any).count).toBe(0);
    const fixed = await (await b.get("?status=fixed")).json() as any;
    expect(fixed.groups[0]).toMatchObject({ fp: "fp1", status: "fixed", fix_files: "apps/web/public/z.js", fix_note: "the guard was missing", fix_commit: "abc1234" });
    await b.post(rep()); // right after the fix: devices still hold the old copy, so it stays fixed
    expect(((await (await b.get("?status=fixed")).json()) as any).count).toBe(1);
    b.w.world.raw.prepare("UPDATE error_group SET fixed_ts = fixed_ts - 3600000 WHERE fp='fp1'").run(); // an hour later
    await b.post(rep());
    const again = await (await b.get("?status=open")).json() as any;
    expect(again.groups[0]).toMatchObject({ fp: "fp1", status: "reopened" });
    expect(await (await b.get("?fp=fp1&format=md")).text()).toContain("the guard was missing"); // the earlier fix stays on record
  });
  test("a group keeps at most four samples however often it happens", async () => {
    const b = box();
    for (let i = 0; i < 15; i++) await b.post(rep());
    const n = b.w.world.raw.prepare("SELECT COUNT(*) c FROM error_report WHERE fp='fp1'").get() as any;
    expect(n.c).toBeLessThanOrEqual(4);
    expect((b.w.world.raw.prepare("SELECT n FROM error_group WHERE fp='fp1'").get() as any).n).toBe(15);
  });
  test("markdown for a group is stable text", () => {
    const md = toMarkdown({ fp: "f", msg: "m", status: "new", kind: "script", sev: "error", n: 3, games: 2, first_ts: T, last_ts: T, page: "/z", role: "player" }, []);
    expect(md).toContain("# Error f: m");
  });
});

describe("server-side errors", () => {
  test("a Worker error is stored with its route, message and stack, and nothing that identifies a person", async () => {
    const w = newWorld({ DATA_KEY: "k" });
    const err = Object.assign(new Error("exploded for asha@example.com +919812345678"), { name: "TypeError" });
    await recordServerError(w.world.env.DB, new Request("http://localhost/api/z/GAME1234/vote?me=secretpid&t=0123456789abcdef0123456789abcdef", { method: "POST" }), err, 500, T);
    const g = w.world.raw.prepare("SELECT * FROM error_group").all() as any[];
    expect(g.length).toBe(1);
    expect(g[0]).toMatchObject({ kind: "worker", role: "server", page: "/api/z/GAME1234/vote", status: "new" });
    const rows = JSON.stringify(w.world.raw.prepare("SELECT body FROM error_report").all());
    for (const bad of ["asha@example.com", "919812345678", "secretpid", "0123456789abcdef0123456789abcdef"]) expect(rows + JSON.stringify(g)).not.toContain(bad);
    expect(rows).toContain("GAME1234");
    await recordServerError(w.world.env.DB, new Request("http://localhost/api/z/GAME1234/vote", { method: "POST" }), err, 500, T + 1000);
    expect((w.world.raw.prepare("SELECT n FROM error_group").get() as any).n).toBe(2);
  });
  test("a plain 5xx answer with no exception is stored too, with its status", async () => {
    const w = newWorld({ DATA_KEY: "k" });
    await recordServerError(w.world.env.DB, new Request("http://localhost/x"), undefined, 503, T);
    expect((w.world.raw.prepare("SELECT msg FROM error_group").get() as any).msg).toContain("503");
  });
});

describe("the pages carry the recorder", () => {
  test("every built page that reports page speed also runs the recorder, before it; the file is built; the game screens hand over their stage", () => {
    const build = readFileSync(join(import.meta.dir, "../../../pages/build.mjs"), "utf8");
    expect(build).toContain('"blackbox.js"');
    const pages = readdirSync(PUB).filter((f) => f.endsWith(".html"));
    let withRum = 0;
    for (const f of pages) {
      const h = readFileSync(join(PUB, f), "utf8");
      if (h.includes('src="/rum.js"')) { withRum++; expect(h.indexOf('src="/blackbox.js"')).toBeGreaterThan(-1); expect(h.indexOf('src="/blackbox.js"')).toBeLessThan(h.indexOf('src="/rum.js"')); }
    }
    expect(withRum).toBeGreaterThan(8);
    for (const f of ["z.html", "zc.html", "big.html", "demo.html", "pay.html", "paylink.html", "signin.html", "preview.html", "index.html"].filter((x) => existsSync(join(PUB, x)))) expect(readFileSync(join(PUB, f), "utf8")).toContain('src="/blackbox.js"');
    expect(readFileSync(join(PUB, "ttt.js"), "utf8")).toContain("window.ctzView(");
  });
  test("the recorder file never reads what a person types or writes", () => {
    const js = readFileSync(join(PUB, "blackbox.js"), "utf8");
    for (const bad of [".value", "innerText", "textContent", "innerHTML", "document.cookie", "getItem(\"ctz-org\")", "sessionStorage"]) expect(js.includes(bad)).toBe(false);
  });
});
