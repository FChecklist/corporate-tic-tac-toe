// Owner order 2026-10-29: the new Corporate Games brand in the report PDF and in every e-mail (the badge, the small CORPORATE line above the proper name, the kit's colours, the payee).
import { describe, expect, test } from "bun:test";
import { BRAND, footerHtml, headerHtml, plainToHtml } from "../src/brand";
import { layoutReport, type ReportData } from "../src/report-layout";
import { PdfDoc } from "../src/pdf";

const data = (): ReportData => ({
  engagementId: "KIT-1", organizerEmail: "boss@acme.com", sentAtMs: 1_800_000_000_000, scheduledMs: 1_799_990_000_000, firstNumberMs: 1_799_990_100_000, endMs: 1_799_995_000_000, endReason: "The tournament was played", wasHeld: false,
  rounds: 1, callSeconds: 9, ticketsPerPerson: 1, cap: 10, inviteOnly: false, numbersCalled: 0, people: [], prizes: [], lucky: [], timeline: [], breaks: [], personalDeleteAtMs: 1_800_050_000_000, fullDeleteAtMs: 1_830_000_000_000,
});

describe("the report PDF wears the Corporate Tic Tac Toe brand", () => {
  test("the title band has the badge (the kit's green square, white board, coral crosses, gold rings) drawn at the left, in the kit's blue and marigold", () => {
    const pdf = new TextDecoder("latin1").decode(layoutReport(data()));
    expect(pdf).toContain("0.09 0.47 0.29 rg"); // the badge's green, #17784A
    expect((pdf.match(/1 0\.83 0\.23 RG/g) ?? []).length).toBe(3); // the three gold rings
    expect(pdf).toContain("0.04 0.24 0.57 rg"); // the band: studio blue #0B3D91
    expect(pdf).toContain("1 0.79 0.24 rg"); // the words in marigold #FFC93C
    expect(pdf).toContain("(Corporate Tic Tac Toe)"); expect(pdf).toContain("(Complete game report)");
  });
  test("the badge is only drawn when asked (a PDF without it has no green square)", () => {
    const d = new PdfDoc(); d.para("plain"); expect(new TextDecoder("latin1").decode(d.build())).not.toContain("0.09 0.47 0.29 rg");
  });
});

describe("every e-mail wears the brand", () => {
  test("the header has the badge image, CORPORATE above Tic Tac Toe, on the kit's blue with the gold edge; the footer says whose product it is", () => {
    const h = headerHtml("https://tictactoe.corporatetambola.com"), f = footerHtml("https://tictactoe.corporatetambola.com");
    expect(h).toContain('<img src="https://tictactoe.corporatetambola.com/icon-192.png" width="40" height="40" alt="Corporate Tic Tac Toe"'); expect(h).toContain(">CORPORATE</div>"); expect(h).toContain(">Tic Tac Toe</div>");
    expect(h).toContain("background:#0B3D91"); expect(h).toContain("border-bottom:3px solid #E0B872");
    expect(f).toContain("A product of IT Services by Rajat Agarwal"); expect(f).toContain("Online games for company events");
    expect(BRAND.wine).toBe("#0B3D91"); expect(BRAND.tagline).toBe("Online games for company events");
    expect(plainToHtml("x", "Hello").includes("0B5D5B")).toBe(false); // no old teal anywhere
  });
});
