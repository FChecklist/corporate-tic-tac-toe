import { describe, expect, test } from "bun:test";
import { layoutReport, type ReportData } from "../src/report-layout";

// The organizer's logo and company name are printed on the report PDF (product rule 2026-10-09: "visible in the ticket and all the places, documents").
const base = (extra: Partial<ReportData> = {}): ReportData => ({
  engagementId: "LOGO-1", organizerEmail: "boss@acme.com", sentAtMs: 1_800_000_000_000, scheduledMs: 1_799_990_000_000, firstNumberMs: 1_799_990_100_000, endMs: 1_799_995_000_000, endReason: "All numbers were called.", wasHeld: false,
  rounds: 1, callSeconds: 9, ticketsPerPerson: 1, cap: 100, inviteOnly: false, numbersCalled: 90, people: [], prizes: [], lucky: [], timeline: [], breaks: [], personalDeleteAtMs: 1_800_050_000_000, fullDeleteAtMs: 1_830_000_000_000, ...extra,
});
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
describe("report PDF prints a foreign mobile number in full", () => {
  test("+971, +44 and a 15-digit number are not cut in the winners, lucky-draw and everyone tables", () => {
    const nums = ["+971501234567", "+447911123456", "+123456789012345"];
    const people = nums.map((phone, i) => ({ seat: i + 1, name: "P" + i, phone, joinedMs: 1_799_990_000_000, late: false, role: null, invitedBy: null, onRoster: false, joined: true }));
    const w = (phone: string, i: number) => ({ seat: i + 1, name: "P" + i, phone, role: null, callNo: 5, atMs: 1_799_990_500_000, verified: true, given: null });
    const t = text(layoutReport(base({ people, prizes: [{ round: 1, label: "Full house", text: "Full house", winners: nums.map(w) }] as any, lucky: [{ label: "Lucky", winners: nums.map(w) }] as any })));
    for (const n of nums) { expect(t.split(n).length - 1).toBeGreaterThanOrEqual(2); expect(t).not.toContain(n.slice(0, 11) + ".."); }
  });
});
describe("report PDF carries the organizer's brand", () => {
  test("with a logo: the picture is embedded and the company name is in the band", () => {
    const px = { w: 2, h: 2, hex: "ff0000" + "00ff00" + "0000ff" + "ffffff" };
    const t = text(layoutReport(base({ brand: { name: "Acme Ltd" }, logoPix: px })));
    expect(t).toContain("/Subtype /Image"); expect(t).toContain("/Im1 Do"); expect(t).toContain("/XObject << /Im1"); expect(t).toContain("ff000000ff000000ffffffff"); expect(t).toContain("Acme Ltd | Corporate Tic Tac Toe");
  });
  test("without a logo: no picture, and our own name stays in writing", () => {
    const t = text(layoutReport(base()));
    expect(t).not.toContain("/Subtype /Image"); expect(t).toContain("(Corporate Tic Tac Toe)");
  });
  test("a damaged logo (wrong number of pixels) is ignored, not embedded", () => {
    expect(text(layoutReport(base({ logoPix: { w: 4, h: 4, hex: "ff00ff" } })))).not.toContain("/Subtype /Image");
  });
});
