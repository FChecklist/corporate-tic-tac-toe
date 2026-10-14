// E8 / O11: the contact page is a mail address and a phone number. It must not promise an automatic reply or acknowledgement that does not exist.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pub = (f: string) => readFileSync(join(import.meta.dir, "../public", f), "utf8");
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("E8 / O11: the contact page keeps no promise of an automatic acknowledgement", () => {
  test("it is a mail link and says how long a real answer takes, and nowhere says a reply is sent automatically", () => {
    const html = pub("contact.html"), t = text(html);
    expect(html).toMatch(/href="mailto:[^"]+@[^"]+"/);
    expect(t).toMatch(/We reply within 30 days/);
    for (const f of ["contact.html", "legal.html", "terms.html", "refund-policy.html", "trust.html", "index.html", "pricing.html"]) {
      expect([f, /auto-?repl|automatic(ally)? (reply|replies|acknowledg|confirm|response)|acknowledg(e)?ment|instant(ly)? repl|we have received your (message|request)/i.test(text(pub(f)))]).toEqual([f, false]);
    }
  });
  test("there is no contact form and no address that takes a message (so there is nothing to acknowledge)", () => {
    const html = pub("contact.html");
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/\/api\/contact/);
  });
});
