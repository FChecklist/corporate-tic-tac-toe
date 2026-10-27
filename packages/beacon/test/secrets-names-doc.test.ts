// config/SECRETS_NAMES.md lists every setting by name, once, and says where it is set. A name listed twice with two different "where set" cells leaves the owner not knowing which one changes the live value.
// (apps/edge/test/secrets-list.test.ts keeps the list complete; it keys rows by name, so a repeated name slipped through it.)
import { describe, expect, test } from "bun:test";

const read = async (rel: string) => (await Bun.file(new URL(rel, import.meta.url)).text()).replace(/\r\n/g, "\n");
const rows = async () => {
  const out: { name: string; where: string }[] = [];
  for (const line of (await read("../../../config/SECRETS_NAMES.md")).split("\n")) {
    if (!line.startsWith("|")) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    const m = /^`(\w+)`$/.exec(c[0] ?? "");
    if (m) out.push({ name: m[1]!, where: c[2] ?? "" });
  }
  return out;
};

describe("config/SECRETS_NAMES.md", () => {
  test("every name is listed once", async () => {
    const seen = new Map<string, number>();
    for (const r of await rows()) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([name]) => name)).toEqual([]);
  });
  test("a setting that pages/wrangler.toml [vars] sets is listed as a wrangler var (a name cannot be in both places)", async () => {
    const toml = await read("../../../pages/wrangler.toml");
    const vars = /\[vars\]\n([\s\S]*?)(?:\n\[|$)/.exec(toml)?.[1] ?? "";
    const names = [...vars.matchAll(/^([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]!);
    expect(names).toContain("JOIN_PER_IP_MINUTE"); // the reading above found the section
    const list = await rows();
    for (const n of names) expect([n, list.filter((r) => r.name === n).map((r) => r.where)]).toEqual([n, ["wrangler var"]]);
  });
});
