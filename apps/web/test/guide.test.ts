// The guide (apps/web/public/guide.js): every message the server can send a person has a polite, complete explanation, exact steps and a place to go,
// and the pop-up / in-place message / "take me there" / "back to where you were" really work. A new server message with no guide fails the first test.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { newWorld, openPage, type Page } from "./harness";

setDefaultTimeout(30_000);
const EDGE = join(import.meta.dir, "../../edge/src");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function page(html = "pricing.html", url = "/pricing.html") {
  const w = newWorld({ DATA_KEY: "k" });
  const p = await openPage(w.world, { url: "http://localhost" + url, html, scripts: ["guide.js"] });
  open.push(p); return p;
}
/** every `error: "..."` the server can send, with the status written next to it */
function serverMessages() {
  const out: { file: string; line: number; status: number; msg: string }[] = [];
  for (const f of readdirSync(EDGE).filter((x) => x.endsWith(".ts"))) {
    readFileSync(join(EDGE, f), "utf8").split("\n").forEach((l, i) => {
      for (const m of l.matchAll(/error:\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)) {
        const st = /\}\s*,\s*(\d{3})\s*\)/.exec(l.slice(m.index! + m[0].length)) ?? /status:\s*(\d{3})/.exec(l);
        out.push({ file: f, line: i + 1, status: st ? Number(st[1]) : 400, msg: m[1]!.slice(1, -1) });
      }
    });
  }
  return out;
}

describe("every message the server can send has a guide", () => {
  test("each one is either guided (matched by a catalog entry) or on the list of messages no person ever sees", async () => {
    const p = await page(); const CTG = p.win.CTG;
    const missing: string[] = [];
    for (const m of serverMessages()) {
      if (CTG.apiOnly(m.msg)) continue;
      if (!CTG.find({ status: m.status, message: m.msg }).matched) missing.push(`${m.file}:${m.line} [${m.status}] ${m.msg.slice(0, 90)}`);
    }
    expect(missing).toEqual([]); // a message listed here needs a catalog entry in guide.js (what happened, what to do, where to go)
  });
  test("the messages kept out of people's sight really are only the owner's tools, AI links and machine-to-machine calls", async () => {
    const p = await page(); const CTG = p.win.CTG;
    const hidden = serverMessages().filter((m) => CTG.apiOnly(m.msg));
    expect(hidden.length).toBeGreaterThan(20);
    for (const m of hidden) expect(["admin.ts", "partners.ts", "mode.ts", "ledgerc.ts", "pay.ts", "worker.ts", "lifecycle.ts", "people.ts", "credit.ts", "helpdesk.ts", "winners.ts", "hostsetup.ts", "rights.ts", "clone.ts", "consent.ts", "tournament.ts", "luck.ts"]).toContain(m.file);
  });
});

describe("what a person reads is polite, complete and free of technical words", () => {
  const BANNED = /\b(invalid|illegal|forbidden|unauthori[sz]ed|bad request|exception|undefined|null|json|http|https|status|endpoint|payload|stack|server error|error code|\b4\d\d\b|\b5\d\d\b|api)\b|\{|\}|\?[a-z]+=|=>|<[a-z]/i;
  test("every catalog entry has a short title, a plain explanation, at least one clear step and a place to go; none uses a technical word", async () => {
    const p = await page(); const C = p.win.CTG.catalog as any[];
    expect(C.length).toBeGreaterThan(50);
    for (const e of C) {
      const text = [e.t, e.w, ...e.d].join(" | ");
      expect(e.t.length).toBeGreaterThan(8); expect(e.t.length).toBeLessThanOrEqual(70);
      expect(e.w.length).toBeGreaterThan(20);
      expect(e.d.length).toBeGreaterThan(0);
      for (const s of e.d) { expect(s.length).toBeGreaterThan(10); expect(/[.!]$/.test(s) || /[,]$/.test(s)).toBe(true); }
      expect(["field", "blocked", "wait", "unexpected"]).toContain(e.k);
      expect(e.g && typeof e.g === "object").toBe(true);
      expect(text.match(BANNED)?.[0] ?? "").toBe(""); // no codes, addresses, JSON, HTTP words
      expect(text).not.toMatch(/\byou (failed|did not|didn't|forgot|should have)\b/i); // never blames the person
    }
  });
  test("a step-by-step instruction exists for every kind of situation", async () => {
    const p = await page(); const C = p.win.CTG.catalog as any[];
    for (const k of ["field", "blocked", "wait", "unexpected"]) expect(C.filter((e) => e.k === k).length).toBeGreaterThan(3);
    for (const st of [0, 400, 403, 404, 409, 429, 500, 503]) { const g = p.win.CTG.explain({ status: st, message: "something nobody wrote a guide for" }); expect(g.title.length).toBeGreaterThan(8); expect(g.steps.length).toBeGreaterThan(0); expect(g.matched).toBe(false); }
  });
});

describe("showing it: pop-up, in place, take me there, back to where you were", () => {
  test("a pop-up has the title, what happened, the steps, a way forward and a way to close; Escape closes it", async () => {
    const p = await page(); const d = p.win.document;
    p.win.CTG.dialog({ status: 409, message: "This engagement is full." }, {});
    const card = d.querySelector("#ctg-dialog [role=alertdialog]");
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("All the places in this game are taken");
    expect(d.querySelectorAll("#ctg-dialog li").length).toBeGreaterThan(0);
    expect(d.querySelector('#ctg-dialog [data-ctg="go"]')).toBeTruthy();
    expect(d.querySelector('#ctg-dialog [data-ctg="close"]')).toBeTruthy();
    d.querySelector("#ctg-dialog").dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(d.getElementById("ctg-dialog")).toBeNull();
  });
  test("an unexpected failure apologises, says the work is safe, offers Try again and WhatsApp with a reference, and keeps no personal detail", async () => {
    const p = await page(); const d = p.win.document; let again = 0;
    p.win.CTG.dialog({ status: 500, message: "boom for asha@example.com" }, { retry: () => again++ });
    const t = d.getElementById("ctg-dialog").textContent;
    expect(t).toContain("not your doing"); expect(t).toContain("Reference:"); expect(t).not.toContain("asha@example.com");
    expect(d.querySelector('#ctg-dialog a[href^="https://wa.me/919650397480?text="]')).toBeTruthy();
    d.querySelector('#ctg-dialog [data-ctg="retry"]').click(); expect(again).toBe(1); expect(d.getElementById("ctg-dialog")).toBeNull();
  });
  test("a mistake in what was typed is shown in place, and Take me there brings the box into view, outlines it and focuses it", async () => {
    const p = await page("signin.html", "/signin.html"); const d = p.win.document;
    d.body.insertAdjacentHTML("beforeend", '<div id="host"><input id="hemail" type="email"></div>');
    const g = p.win.CTG.show({ status: 400, message: "Please enter a valid work email." }, { host: d.getElementById("host") });
    expect(g.kind).toBe("field");
    expect(d.querySelector("#host .ctg-inline")).toBeTruthy();
    expect(d.getElementById("ctg-dialog")).toBeNull(); // no pop-up for a typing slip
    d.querySelector('#host [data-ctg="go"]').click();
    expect(d.getElementById("hemail").classList.contains("ctg-flag")).toBe(true);
  });
  test("when the fix is on another step, a Done? button remembers where the person was and takes them back", async () => {
    const p = await page(); const d = p.win.document; const seen: number[] = [];
    p.win.ctzFocus = (n: number) => seen.push(n);
    p.win.CTG.go({ step: 2, field: "#f-cap", label: "Number of participants" }, { back: { step: 7, label: "Check and publish" } });
    expect(seen).toEqual([2]);
    const b = d.getElementById("ctg-back"); expect(b.textContent).toContain("Check and publish");
    b.click(); expect(seen).toEqual([2, 7]); expect(d.getElementById("ctg-back")).toBeNull();
    expect(p.win.sessionStorage.getItem("ctz-return")).toBeNull();
  });
  test("an error nobody handled still reaches the person with a guide, and the guide is attached to every wrapped error", async () => {
    const p = await page(); const d = p.win.document;
    const err: any = Object.assign(new Error("This game was cancelled."), { status: 409 });
    p.win.CTG.wrap(err); expect(err.guide.title).toContain("not going ahead");
    p.win.dispatchEvent(Object.assign(new p.win.Event("unhandledrejection"), { reason: Object.assign(new Error("Too many tries from this network."), { status: 429 }) }));
    expect(d.getElementById("ctg-dialog")).toBeTruthy();
  });
});

describe("the screens use it", () => {
  test("the console, the pay page, the pay link, the player screen and the shared helper all give their errors a guide", () => {
    const PUB = join(import.meta.dir, "../public");
    for (const f of ["zc.js", "pay.js", "paylink.js", "z.js", "common.js"].filter((x) => existsSync(join(PUB, x)))) expect(readFileSync(join(PUB, f), "utf8")).toContain("CTG.wrap");
    expect(readFileSync(join(PUB, "zc.js"), "utf8")).toContain("window.ctzFocus");
    for (const f of readdirSync(PUB).filter((x) => x.endsWith(".html"))) { const h = readFileSync(join(PUB, f), "utf8"); if (h.includes('src="/blackbox.js"')) { expect(h).toContain('src="/guide.js"'); expect(h.indexOf('src="/guide.js"')).toBeLessThan(h.indexOf('src="/blackbox.js"')); } }
  });
});

describe("the right guide for the right message and the right person", () => {
  test("no catalog fragment is so short or common that it can guide an unrelated message", async () => {
    const p = await page(); const C = p.win.CTG.catalog as any[];
    // three short ones are whole, specific messages: "busy", "busy day", "choose a pack"
    for (const e of C) for (const m of e.m) { const n = String(m).toLowerCase().replace(/\d+/g, "").replace(/\s+/g, " ").trim(); expect(n.length >= 14 || ["busy", "busy day", "choose a pack", "bad draw.", "bad match.", "bad move.", "bad result.", "no such board."].includes(n)).toBe(true); }
    for (const msg of ["You have been removed from this game by someone.", "You can have a look at the report later.", "Send a postcard to your friend.", "Check the weather before you travel.", "Your ticket is lovely."]) {
      const f = p.win.CTG.find({ status: -1, message: msg }); expect(f.matched).toBe(false);
    }
    // and the real, similar messages still reach their own guide
    expect(p.win.CTG.find({ status: 403, message: "You were removed from this game." }).entry.t).toContain("not part of this game");
    expect(p.win.CTG.find({ status: 409, message: "You have 3 unpublished drafts. Publish one, or let one lapse: an unpublished draft is forgotten after 30 days" }).entry.t).toContain("drafts");
  });
  test("a guest on the game page never gets a button into the Organizer's console, and 'game full' is worded for a guest", async () => {
    const p = await page("z.html", "/z.html?e=ABCD1234");
    expect(p.win.CTG.role()).toBe("player");
    const full = p.win.CTG.explain({ status: 409, message: "This engagement is full." });
    expect(full.title).toBe("This game is full"); expect(full.go).toEqual({ none: true });
    expect(full.steps.join(" ")).not.toMatch(/Number of participants|Organizer, raise/i);
    for (const msg of ["This game was cancelled.", "This link is not valid any more. Please ask the person who invited you to send it again.", "This game did not start and is closed."]) {
      const g = p.win.CTG.explain({ status: 409, message: msg }); expect(g.go.step).toBeUndefined(); expect(String(g.go.href || "")).not.toMatch(/zc/);
    }
    const o = await page("pricing.html", "/zc.html?e=ABCD1234"); expect(o.win.CTG.role()).toBe("organizer");
    expect(o.win.CTG.explain({ status: 409, message: "This engagement is full." }).go.step).toBe(2);
  });
  test("the game page tells the truth about why a game could not be opened", () => {
    const rt = readFileSync(join(import.meta.dir, "../../../packages/beacon/src/phone-runtime.ts"), "utf8");
    expect(rt).toContain('st === 403 || st === 410 ? String(e?.message');
    expect(readFileSync(join(import.meta.dir, "../public/zgame.js"), "utf8")).toContain("The game could not be opened just now");
  });
});
