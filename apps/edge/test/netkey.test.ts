// Per-address limits (wrong employee ID, sign-in link failures, game starts, joins, pay-link counter...) group IPv6 by its first 64 bits, so changing the address inside your own /64 gives no fresh counter.
import { describe, expect, test } from "bun:test";
import { netKey, netKeyOf } from "../src/netkey";

describe("netKey", () => {
  test("IPv4 and test values are used as they are; nothing becomes 'local' by accident", () => {
    expect(netKey("203.0.113.9")).toBe("203.0.113.9");
    expect(netKey("local")).toBe("local");
    expect(netKey(null)).toBe("local");
    expect(netKey("")).toBe("local");
  });
  test("two addresses in the same /64 share one key, a different /64 does not", () => {
    const a = netKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), b = netKey("2001:db8:1:2:1:2:3:4"), c = netKey("2001:db8:1:3:aaaa:bbbb:cccc:dddd");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  test("compressed forms and capital letters give the same key as the long form", () => {
    expect(netKey("2001:db8::1")).toBe(netKey("2001:0db8:0000:0000:0000:0000:0000:0002"));
    expect(netKey("2001:DB8:0:0:9::1")).toBe(netKey("2001:db8::7"));
    expect(netKey("::1")).toBe(netKey("0:0:0:0:ffff:0:0:2"));
  });
  test("an IPv4 address written in IPv6 form is the IPv4 address", () => {
    expect(netKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
  test("a value that is not an address is not guessed at", () => {
    expect(netKey("not:an:ip")).toBe("not:an:ip");
  });
  test("netKeyOf reads cf-connecting-ip", () => {
    const r = (ip?: string) => new Request("http://x/", { headers: ip ? { "cf-connecting-ip": ip } : {} });
    expect(netKeyOf(r("2001:db8:5:6:1:1:1:1"))).toBe(netKeyOf(r("2001:db8:5:6:2:2:2:2")));
    expect(netKeyOf(r())).toBe("local");
  });
});
