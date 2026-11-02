// ONE SIGN-IN (owner feedback, 2 Nov 2026). Every Log in / Sign in link of this game's website goes to the ONE sign-in page, the console (the screen with the big Continue with Google button).
// The e-mail words are plain ("e-mail"): never "work e-mail", "company e-mail", "official e-mail" or an example company domain. A bare /#login (an old link, a bookmark, the Guide's Sign in button)
// forwards to the console (this game's landing page has no sign-in sheet of its own).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

const CONSOLE = "https://console.corporatetambola.com/";
const MIN_LINKS = 10; // the landing page and the information pages all carry the header Log in link
const PUB = new URL("../public/", import.meta.url);
const EDGE = new URL("../../edge/src/", import.meta.url);
const SERVER = new URL("../../server/src/", import.meta.url);
const read = (base: URL, f: string) => readFileSync(new URL(f, base), "utf8");
const list = (base: URL, re: RegExp) => (existsSync(base) ? readdirSync(base).filter((f) => re.test(f)) : []);

const LOGIN_TEXT = /^(log in|sign in|organizer sign in|log in \/ sign up)$/i;
/** every anchor whose visible words are Log in / Sign in, on every page of the website and in the generated page shell */
function loginLinks() {
  const out: { file: string; href: string; text: string }[] = [];
  const sources: [string, string][] = list(PUB, /\.html$/).map((f) => [f, read(PUB, f)]);
  if (existsSync(new URL("site-shell.gen.ts", EDGE))) sources.push(["site-shell.gen.ts", read(EDGE, "site-shell.gen.ts").replace(/\\"/g, '"')]);
  for (const [file, h] of sources) {
    for (const m of h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
      const text = m[2]!.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (LOGIN_TEXT.test(text)) out.push({ file, href: /\bhref="([^"]*)"/.exec(m[1]!)?.[1] ?? "", text });
    }
  }
  return out;
}

describe("one sign-in: the links", () => {
  test("every Log in / Sign in link on every page of the website (and in the page shell) goes to the one console sign-in address", () => {
    const found = loginLinks();
    expect(found.length).toBeGreaterThanOrEqual(MIN_LINKS);
    expect(found.filter((x) => x.href !== CONSOLE)).toEqual([]);
  });

  test("the top bar Log in link is a plain link: the page no longer catches its click to open a sheet of its own", () => {
    expect(read(PUB, "site.js")).not.toMatch(/\$\("loginLink"\)\.addEventListener\("click"/);
  });

  test("the organizer console's own sign-in view points to the console for normal sign-in (and keeps its own form for the flow that is waiting)", () => {
    const zc = read(PUB, "zc.js");
    expect(zc).toContain('id="toConsole"');
    expect(zc).toContain(`<a href="${CONSOLE}">console</a>`);
  });
});

describe("one sign-in: a bare /#login on the landing page forwards to the console", () => {
  /** guide.js is on every page; at its end it forwards a bare /#login of the landing page */
  function runGuide(url: string) {
    const win: any = new Window({ url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
    const went: string[] = [];
    Object.defineProperty(win.location, "replace", { value: (u: string) => went.push(String(u)), configurable: true });
    win.document.body.innerHTML = '<main id="app"></main>';
    const errors: string[] = [];
    try { new Function("window", `with (window) { ${read(PUB, "guide.js")}
}`).call(win, win); } catch (e: any) { errors.push(String(e?.message ?? e)); }
    return { went, errors, close: () => win.happyDOM.close() };
  }

  test("the landing page with #login goes to the console", async () => {
    for (const url of ["https://tictactoe.corporatetambola.com/#login", "https://tictactoe.corporatetambola.com/index.html#login"]) {
      const r = runGuide(url);
      expect([url, r.errors, r.went]).toEqual([url, [], [CONSOLE]]);
      await r.close();
    }
  });

  test("any other page or hash is left alone", async () => {
    for (const url of ["https://tictactoe.corporatetambola.com/", "https://tictactoe.corporatetambola.com/#how", "https://tictactoe.corporatetambola.com/zc.html#login", "https://tictactoe.corporatetambola.com/pricing.html#login"]) {
      const r = runGuide(url);
      expect([url, r.errors, r.went]).toEqual([url, [], []]);
      await r.close();
    }
  });
});

describe("plain e-mail words", () => {
  const OLD = /work[ -]?e-?mail|company[ -]?e-?mail|yourcompany|official[ -]?e-?mail/i;
  // mode.ts: a code comment about the company's own configured address, not a word anyone sees or hears
  const files: [string, string][] = [
    ...list(PUB, /\.(html|js|json|txt|webmanifest)$/).map((f): [string, string] => ["public/" + f, read(PUB, f)]),
    ...list(EDGE, /\.(ts|json)$/).filter((f) => f !== "mode.ts").map((f): [string, string] => ["edge/" + f, read(EDGE, f)]),
    ...list(SERVER, /\.ts$/).map((f): [string, string] => ["server/" + f, read(SERVER, f)]),
  ];

  test("no page, script or server message says work e-mail, company e-mail, official e-mail or yourcompany (the Guide's old-message matcher lists are the only place the old words stay)", () => {
    const hits: string[] = [];
    for (const [name, text] of files) {
      const seen = name === "public/guide.js" ? text.replace(/\bm:\s*\[[^\]]*\]/g, "") : text;
      if (OLD.test(seen)) hits.push(name);
    }
    expect(hits).toEqual([]);
  });

  test("no example company address (like name@company.com or host@example.com) in any page, script or server message of this website", () => {
    const EX = /@(company|example|yourcompany|acme|mycompany|domain)\.(com|org|net)/i;
    const shown = files.filter(([name]) => name.startsWith("public/") || name === "edge/worker.ts");
    expect(shown.filter(([, text]) => EX.test(text)).map(([name]) => name)).toEqual([]);
  });

  test("the Guide recognises the plain message", () => {
    expect(read(PUB, "guide.js")).toContain('"Please enter a valid e-mail address"');
  });

  test("the sign-up checks say 'Please enter a valid e-mail address.'", () => {
    const s = read(PUB, "site.js");
    expect(s).toContain('"Please enter a valid e-mail address."');
    expect(s).not.toMatch(/valid work e-?mail/i);
  });
});
