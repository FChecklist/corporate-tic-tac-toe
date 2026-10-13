// Phase 3/4 headers (pages/build.mjs): Google's script, frames and connections are allowed ONLY on the pages that show "Continue with Google"
// (signin, index with its "/" rule, zc), and the pay-link page gets the Razorpay rules like pay.html. Read from the source, as the other header tests do.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8");
const GOOGLE_HOSTS = ["accounts.google.com/gsi/client", "accounts.google.com/gsi/style", "accounts.google.com/gsi/"];

test("only signin, index, zc (and the home '/') use the Google rules; every other page keeps the plain or game rules", () => {
  const pages = [...src.matchAll(/\["(\/[a-z0-9-]*)", (\w+CSP), (true|false)\]/g)].map((m) => [m[1]!, m[2]!] as const);
  const google = pages.filter(([, c]) => c === "GOOGLECSP").map(([p]) => p).sort();
  expect(google).toEqual(["/index", "/signin", "/zc"]);
  expect(src).toContain('rules += "/" + hdr(GOOGLECSP)');
  expect(pages.length).toBeGreaterThan(15);
  for (const [p, c] of pages) if (!["/index", "/signin", "/zc"].includes(p)) expect([p, c === "GOOGLECSP"]).toEqual([p, false]);
});

test("the Google rules allow Google's sign-in script, frame, connection and style - and only those", () => {
  const def = src.slice(src.indexOf("const GOOGLECSP"), src.indexOf("\n", src.indexOf("const GOOGLECSP")));
  expect(def).toContain("script-src 'self' https://static.cloudflareinsights.com https://accounts.google.com/gsi/client;");
  expect(def).toContain("frame-src https://accounts.google.com/gsi/;"); expect(def).toContain("connect-src 'self' https://accounts.google.com/gsi/");
  expect(def).toContain("style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style;");
  expect(def).not.toMatch(/\*|https:\/\/www\.google|googleusercontent|https:\s*;/); // no wildcard, no blanket https:
  // the other CSP definitions never mention Google
  for (const line of src.split("\n")) if (/^const (CSP|PAYCSP|GAMECSP|PLAINCSP) /.test(line)) for (const g of GOOGLE_HOSTS) expect(line).not.toContain(g);
});

test("the pay-link page is served with the Razorpay rules, and paylink.html / paylink.js are in the build's file list", () => {
  expect(src).toContain('["/paylink", PAYCSP, true]');
  expect(src).toMatch(/"pay\.html", "pay\.js", "paytest\.html", "paytest\.js", "paylink\.html", "paylink\.js"/);
});
