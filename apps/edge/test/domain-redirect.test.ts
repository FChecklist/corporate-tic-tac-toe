import { describe, expect, test } from "bun:test";
import { domainRedirect } from "../src/domain-redirect";

const ORIGIN = "https://tictactoe.corporatetambola.com";
const req = (url: string, method = "GET") => new Request(url, { method });

describe("the pages.dev address redirects to the real address", () => {
  test("a GET page request on pages.dev answers 301 to the same path and query", () => {
    const r = domainRedirect(req("https://corporate-tic-tac-toe.pages.dev/pricing.html?x=1"), ORIGIN)!;
    expect(r.status).toBe(301); expect(r.headers.get("location")).toBe(ORIGIN + "/pricing.html?x=1");
    expect(domainRedirect(req("https://corporate-tic-tac-toe.pages.dev/"), ORIGIN)!.headers.get("location")).toBe(ORIGIN + "/");
    expect(domainRedirect(req("https://abc123.corporate-tic-tac-toe.pages.dev/", "HEAD"), ORIGIN)!.status).toBe(301);
  });
  test("/api/ keeps working: a POST, and even a GET, is not redirected; so are /ai/, /version.json and /.well-known/", () => {
    expect(domainRedirect(req("https://corporate-tic-tac-toe.pages.dev/api/pay/webhook", "POST"), ORIGIN)).toBeNull();
    expect(domainRedirect(req("https://corporate-tic-tac-toe.pages.dev/api/health"), ORIGIN)).toBeNull();
    for (const p of ["/ai/key/x", "/version.json", "/.well-known/x", "/__probe"]) expect(domainRedirect(req("https://corporate-tic-tac-toe.pages.dev" + p), ORIGIN)).toBeNull();
  });
  test("a POST to a page is not redirected, and the real address is never redirected", () => {
    expect(domainRedirect(req("https://corporate-tic-tac-toe.pages.dev/terms", "POST"), ORIGIN)).toBeNull();
    expect(domainRedirect(req(ORIGIN + "/terms"), ORIGIN)).toBeNull();
  });
  test("an unrelated host is left alone", () => { expect(domainRedirect(req("https://example.com/x"), ORIGIN)).toBeNull(); });
});
