import { describe, expect, test } from "bun:test";
import { settingsOf } from "../src/gamerecord";

// The permanent settings record of a game must hold the rules and never a person.
describe("game settings record", () => {
  const row = {
    id: "ACME-2026", start_round: 33000000, call_seconds: 9, cap: 100, tickets: 2, pack: 100, closed: 1, cancelled_ms: null,
    config: JSON.stringify({
      ties: "next", rounds: 2, callMode: "host", verify: "both", employeesOnly: true, name: "Annual day",
      rewards: [{ pattern: "early5", scope: "card", ordinal: 1, text: "Mug" }, { pattern: "full", scope: "card", ordinal: 1, text: "Hamper" }],
      breaks: [{ after: 10, seconds: 60, kind: "speech", title: "Message from the CEO", mediaUrl: "https://example.com/private.mp4" }],
      brand: { name: "Acme Ltd", color: "#0B3D91", logo: "data:image/png;base64,AAAA" },
      invites: { on: true, per: 4, cats: ["family", "colleagues"] },
      // things that must never be copied even if they were ever put in the config by mistake
      people: [{ name: "Asha Rao", phone: "9811100101", empId: "EMP-1001" }], hostEmail: "asha@acme.in", phone: "9650397480",
    }),
  };
  const s = settingsOf(row as any), j = JSON.stringify(s);
  test("keeps the rules", () => {
    expect(s).toMatchObject({ gameId: "ACME-2026", callSeconds: 9, cap: 100, ticketsPerPerson: 2, tieRule: "next", rounds: 2, callMode: "host", whoCanJoin: "list", verify: "both", employeesOnly: true, gameName: "Annual day" });
    expect((s as any).prizes).toEqual([{ house: "early5", scope: "card", position: 1, prize: "Mug" }, { house: "full", scope: "card", position: 1, prize: "Hamper" }]);
    expect((s as any).breaks[0]).toMatchObject({ kind: "speech", seconds: 60, title: "Message from the CEO" });
    expect((s as any).brand).toEqual({ company: "Acme Ltd", colour: "#0B3D91" });
  });
  test("holds no personal data and no media address or logo picture", () => {
    for (const bad of ["Asha", "9811100101", "EMP-1001", "asha@acme.in", "9650397480", "private.mp4", "data:image"]) expect(j.includes(bad)).toBe(false);
  });
  test("a game with a broken config still gives a record", () => {
    expect(settingsOf({ ...row, config: "{nope" } as any)).toMatchObject({ gameId: "ACME-2026", tieRule: "next", callMode: "auto" });
  });
});
