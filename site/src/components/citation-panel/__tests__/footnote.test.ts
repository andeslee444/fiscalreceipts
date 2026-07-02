import { describe, it, expect } from "vitest";
import { formatFootnote } from "../footnote";

describe("formatFootnote", () => {
  it("formats a jbook_pdf citation as a quotable footnote", () => {
    const s = formatFootnote({
      kind: "jbook_pdf", factId: "abc123def4567890",
      label: "PE 0601101E — Defense Research Sciences, FY2025 enacted",
      amountText: "$293.145M", docTitle: "FY2026 DoD J-book, RDT&E Defense-Wide Vol 1 (R-1)",
      page: 42, sha256: "deadbeef", retrievedAt: "2026-06-11", url: "https://govbudget.vercel.app/program/0601101E/",
    });
    expect(s).toContain("PE 0601101E");
    expect(s).toContain("$293.145M");
    expect(s).toContain("p.42");
    expect(s).toContain("sha256:deadbeef");
    expect(s).toContain("retrieved 2026-06-11");
    expect(s).toContain("govbudget.vercel.app/program/0601101E/");
  });

  it("formats a derived citation with its formula", () => {
    const s = formatFootnote({
      kind: "derived", factId: "fedcba9876543210",
      label: "DARPA FY2026 total",
      amountText: "17,199,181 USD thousands",
      formula: "SUM(fy2026_total) OVER programs WHERE org='DARPA'",
      retrievedAt: "2026-06-11", url: "https://govbudget.vercel.app/agency/DARPA/",
    });
    expect(s).toContain("derived: SUM(fy2026_total) OVER programs WHERE org='DARPA'");
    expect(s).toContain("17,199,181 USD thousands");
    expect(s).toContain("retrieved 2026-06-11");
    expect(s).toContain("govbudget.vercel.app/agency/DARPA/");
  });

  it("formats a workbook citation with sheet and cells", () => {
    const s = formatFootnote({
      kind: "workbook", factId: "0011223344556677",
      label: "PE 0601101E FY2025 enacted",
      amountText: "293,145 USD thousands",
      docTitle: "r1.xlsx",
      sheet: "Exhibit R-1", cells: "H1520",
      sha256: "cafebabe", retrievedAt: "2026-06-10",
      url: "https://govbudget.vercel.app/program/0601101E/",
    });
    expect(s).toContain("r1.xlsx");
    expect(s).toContain("sheet Exhibit R-1");
    expect(s).toContain("cells H1520");
    expect(s).toContain("sha256:cafebabe");
  });

  it("formats a usaspending citation with the official endpoint", () => {
    const s = formatFootnote({
      kind: "usaspending", factId: "8899aabbccddeeff",
      label: "District CA-52 obligations for PE 0601101E",
      amountText: "12,345,678 USD",
      officialUrl: "https://api.usaspending.gov/api/v2/search/spending_by_award/",
      retrievedAt: "2026-06-11", url: "https://govbudget.vercel.app/district/CA-52/",
    });
    expect(s).toContain("USAspending");
    expect(s).toContain("api.usaspending.gov");
    expect(s).toContain("govbudget.vercel.app/district/CA-52/");
  });

  it("omits segments whose fields are missing instead of printing null", () => {
    const s = formatFootnote({
      kind: "lda_filing", factId: "1122334455667788",
      url: "https://govbudget.vercel.app/filing/some-uuid/",
    });
    expect(s).not.toContain("null");
    expect(s).not.toContain("undefined");
    expect(s).toContain("Senate LDA filing");
    expect(s).toContain("govbudget.vercel.app/filing/some-uuid/");
  });
});
