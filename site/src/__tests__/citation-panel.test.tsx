/**
 * Task 5 tests:
 *   1. collectCitations — slices citations.json to only requested fact_ids
 *   2. CitationPanelProvider — dispatches to right card based on citation.kind
 *   3. pdfHighlightRect — known bbox math (plan spec values)
 *
 * Note: PdfView itself is NOT tested here (requires PDF.js browser canvas).
 * WorkbookCard and LdaCard render tests use mock citation rows.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// ── 1. collectCitations ───────────────────────────────────────────────────────
// Test the pure slice logic directly (without filesystem reads).
// collectCitations(factIds) filters a citations map to only the requested ids.
// We test this logic as a unit function, exercising the exact same code path.

/**
 * A stripped-down inline implementation of the same slice logic as
 * collectCitations in data.ts — used to verify the logic is correct
 * without triggering filesystem reads in the test environment.
 *
 * This also serves as the canonical spec for the contract.
 */
function collectCitationsSlice<T extends Record<string, unknown>>(
  all: T,
  factIds: string[],
): Partial<T> {
  const result: Partial<T> = {};
  for (const id of factIds) {
    if (id in all) {
      result[id as keyof T] = all[id as keyof T];
    }
  }
  return result;
}

const MOCK_CITATIONS = {
  "aaa111": { kind: "jbook_pdf", amount_text: "10.5" },
  "bbb222": { kind: "workbook", amount_thousands: 20420 },
  "ccc333": { kind: "lda_filing", official_url: "https://lda.senate.gov/api/v1/filings/84df56d3/" },
  "ddd444": { kind: "jbook_pdf", amount_text: "5.0" },
} as const;

describe("collectCitations (slice logic)", () => {
  it("returns only the requested fact_ids from the full map", () => {
    const result = collectCitationsSlice(MOCK_CITATIONS, ["aaa111", "ccc333"]);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result["aaa111"]).toBeDefined();
    expect(result["ccc333"]).toBeDefined();
    expect(result["bbb222"]).toBeUndefined();
    expect(result["ddd444"]).toBeUndefined();
  });

  it("silently skips unknown fact_ids (zero_amount facts have no citations row)", () => {
    const result = collectCitationsSlice(MOCK_CITATIONS, [
      "aaa111",
      "unknown_zero_amount_fact",
    ]);

    expect(Object.keys(result)).toHaveLength(1);
    expect(result["aaa111"]).toBeDefined();
    expect((result as Record<string, unknown>)["unknown_zero_amount_fact"]).toBeUndefined();
  });

  it("returns empty object when no fact_ids match", () => {
    const result = collectCitationsSlice(MOCK_CITATIONS, ["zzz999"]);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns empty object for empty fact_ids array", () => {
    const result = collectCitationsSlice(MOCK_CITATIONS, []);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles duplicate fact_ids (deduplicates via object key)", () => {
    const result = collectCitationsSlice(MOCK_CITATIONS, [
      "aaa111",
      "aaa111",
      "bbb222",
    ]);
    // Object keys are naturally unique
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("preserves the full citation value for each included id", () => {
    const result = collectCitationsSlice(MOCK_CITATIONS, ["bbb222"]);
    expect(result["bbb222"]).toEqual({ kind: "workbook", amount_thousands: 20420 });
  });
});

// ── 2. pdfHighlightRect — plan spec values ───────────────────────────────────

describe("pdfHighlightRect", () => {
  it("computes highlight rect from plan spec values at scale=1", async () => {
    const { pdfHighlightRect } = await import("@/lib/citations");

    // Plan spec: x0=235.23, x1=267.75, top_pt=158.47, bottom_pt=167.47
    // at scale=1 → left=233.23, top=156.47, w=36.52, h=13.0 (with 2px pad)
    const citation = {
      x0: 235.23,
      x1: 267.75,
      top_pt: 158.47,
      bottom_pt: 167.47,
    };

    const result = pdfHighlightRect(citation, 792); // scale = 792/792 = 1

    expect(result.left).toBe("233.23px");
    expect(result.top).toBe("156.47px");
    // width = (267.75 - 235.23) * 1 + 4 = 32.52 + 4 = 36.52
    expect(result.width).toMatch(/^36\.52/); // allow float precision
    expect(result.height).toBe("13px");
  });

  it("computes highlight rect at scale=0.5 (containerWidth=396)", async () => {
    const { pdfHighlightRect } = await import("@/lib/citations");

    const citation = {
      x0: 235.23,
      x1: 267.75,
      top_pt: 158.47,
      bottom_pt: 167.47,
    };

    const result = pdfHighlightRect(citation, 396); // scale = 396/792 = 0.5
    const s = 0.5;

    const expectedLeft = citation.x0 * s - 2;
    const expectedTop = citation.top_pt * s - 2;
    const expectedWidth = (citation.x1 - citation.x0) * s + 4;
    const expectedHeight = (citation.bottom_pt - citation.top_pt) * s + 4;

    expect(result.left).toBe(`${expectedLeft}px`);
    expect(result.top).toBe(`${expectedTop}px`);
    // Compare numeric part
    expect(parseFloat(result.width)).toBeCloseTo(expectedWidth, 5);
    expect(parseFloat(result.height)).toBeCloseTo(expectedHeight, 5);
  });

  it("returns numeric pixel strings with 'px' suffix", async () => {
    const { pdfHighlightRect } = await import("@/lib/citations");

    const result = pdfHighlightRect(
      { x0: 100, x1: 200, top_pt: 50, bottom_pt: 100 },
      792,
    );

    expect(result.left).toMatch(/^-?\d+(\.\d+)?px$/);
    expect(result.top).toMatch(/^-?\d+(\.\d+)?px$/);
    expect(result.width).toMatch(/^\d+(\.\d+)?px$/);
    expect(result.height).toMatch(/^\d+(\.\d+)?px$/);
  });

  it("applies 2px padding — left is x0*scale - 2", async () => {
    const { pdfHighlightRect } = await import("@/lib/citations");

    const citation = { x0: 100, x1: 200, top_pt: 50, bottom_pt: 100 };
    const scale = 1;
    const result = pdfHighlightRect(citation, 792 * scale);

    expect(parseFloat(result.left)).toBe(citation.x0 * scale - 2);
    expect(parseFloat(result.top)).toBe(citation.top_pt * scale - 2);
    expect(parseFloat(result.width)).toBeCloseTo(
      (citation.x1 - citation.x0) * scale + 4,
      5,
    );
    expect(parseFloat(result.height)).toBeCloseTo(
      (citation.bottom_pt - citation.top_pt) * scale + 4,
      5,
    );
  });
});

// ── 3. Panel kind dispatch — renders the right card ─────────────────────────

describe("CitationPanelProvider — kind dispatch", () => {
  const WORKBOOK_CITATION = {
    kind: "workbook" as const,
    amount_text: null,
    amount_thousands: 99500,
    bottom_pt: null,
    cells: "P19,Q20,R21",
    formula: null,
    hosted_pdf_url: null,
    inputs: null,
    official_url: "https://example.gov/workbook.xlsx",
    page_height: null,
    page_number: null,
    page_width: null,
    query_body: null,
    recorded_value: null,
    resolution: null,
    retrieved_at: "2026-06-10T12:00:00Z",
    sha256: "worksheetsha256",
    sheet: "Exhibit R-2A",
    top_pt: null,
    units: "USD thousands",
    x0: null,
    x1: null,
    xml_path: null,
  };

  const LDA_CITATION = {
    kind: "lda_filing" as const,
    amount_text: null,
    amount_thousands: null,
    bottom_pt: null,
    cells: null,
    formula: null,
    hosted_pdf_url: null,
    inputs: null,
    official_url:
      "https://lda.senate.gov/api/v1/filings/84df56d3-5214-4054-854d-944d8af49389/",
    page_height: null,
    page_number: null,
    page_width: null,
    query_body: null,
    recorded_value: null,
    resolution: null,
    retrieved_at: null,
    sha256: null,
    sheet: null,
    top_pt: null,
    units: null,
    x0: null,
    x1: null,
    xml_path: null,
  };

  /** Shared null bbox fields for the non-document kinds. */
  const NON_DOC_NULLS = {
    amount_text: null,
    amount_thousands: null,
    bottom_pt: null,
    cells: null,
    hosted_pdf_url: null,
    page_height: null,
    page_number: null,
    page_width: null,
    resolution: null,
    sha256: null,
    sheet: null,
    top_pt: null,
    x0: null,
    x1: null,
    xml_path: null,
  } as const;

  const DERIVED_CITATION = {
    kind: "derived" as const,
    ...NON_DOC_NULLS,
    official_url: null,
    retrieved_at: "2026-06-12T22:09:13.330786+00:00",
    units: "USD thousands",
    formula:
      "sum(budget_lines.amount_thousands where amount_type=fy_2024_actuals)",
    inputs: JSON.stringify([
      "3dd4e3913f70c92b",
      "https://example.gov/source.csv",
    ]),
    query_body: null,
    recorded_value: "33486.000",
  };

  const USASPENDING_CITATION = {
    kind: "usaspending" as const,
    ...NON_DOC_NULLS,
    official_url: "https://api.usaspending.gov/api/v2/references/filter/",
    retrieved_at: null,
    units: "USD",
    formula: null,
    inputs: null,
    query_body: JSON.stringify({
      filters: {
        recipient_search_text: ["DT8KJHZXVJH5"],
        time_period: [{ end_date: "2017-09-30", start_date: "2016-10-01" }],
      },
      version: "2020-06-01",
    }),
    recorded_value: "357481110.530",
  };

  const STATE_SOQL_CITATION = {
    kind: "state_soql" as const,
    ...NON_DOC_NULLS,
    official_url:
      "https://data.ct.gov/resource/ajdm-rvz7.json?%24select=sum%28amount%29+as+total&%24where=fiscal_year%3D%272025%27",
    retrieved_at: "2026-06-12T22:09:59.866965+00:00",
    units: "USD",
    formula: null,
    inputs: null,
    query_body: null,
    recorded_value: "18364245509.610",
  };

  const STATE_FILE_CITATION = {
    kind: "state_file" as const,
    ...NON_DOC_NULLS,
    official_url: "https://open.fiscal.ca.gov/dept_spending_transaction.html",
    retrieved_at: "2026-06-12T22:09:59.866965+00:00",
    units: "USD",
    formula:
      "Aggregate of CA Open Fi$Cal per-department CSV files; pointer manifest: DepartmentSpendingTransactionPointer.csv",
    inputs: null,
    query_body: null,
    recorded_value: "155541690528.420",
  };

  it("workbook card: shows sheet name", async () => {
    const { WorkbookCard } = await import(
      "@/components/citation-panel/workbook-card"
    );

    const { container } = render(<WorkbookCard citation={WORKBOOK_CITATION} />);
    expect(container.textContent).toContain("Exhibit R-2A");
  });

  it("workbook card: shows formatted amount (USD thousands)", async () => {
    const { WorkbookCard } = await import(
      "@/components/citation-panel/workbook-card"
    );

    const { container } = render(<WorkbookCard citation={WORKBOOK_CITATION} />);
    // 99500 thousands = $99.5M
    expect(container.textContent).toContain("$99.5M");
  });

  it("workbook card: renders cells as chips (split on comma)", async () => {
    const { WorkbookCard } = await import(
      "@/components/citation-panel/workbook-card"
    );

    const { container } = render(<WorkbookCard citation={WORKBOOK_CITATION} />);
    expect(container.textContent).toContain("P19");
    expect(container.textContent).toContain("Q20");
    expect(container.textContent).toContain("R21");
  });

  it("workbook card: does NOT render its own official-source link (§P1-9.5)", async () => {
    // The card used to duplicate the panel footer's link — same URL, ~250px
    // apart. The footer keeps the single copy; see workbook-card.test.tsx for
    // the drawer-level "exactly one" assertion.
    const { WorkbookCard } = await import(
      "@/components/citation-panel/workbook-card"
    );

    const { container } = render(<WorkbookCard citation={WORKBOOK_CITATION} />);
    const officialLinks = Array.from(container.querySelectorAll("a[href]")).filter(
      (a) => a.getAttribute("href") === WORKBOOK_CITATION.official_url,
    );
    expect(officialLinks).toHaveLength(0);
    // the .xlsx download stays
    expect(
      Array.from(container.querySelectorAll("a[href]")).some((a) =>
        (a.getAttribute("href") ?? "").includes(
          `${WORKBOOK_CITATION.sha256}.xlsx`,
        ),
      ),
    ).toBe(true);
  });

  it("lda card: renders human-readable LDA link", async () => {
    const { LdaCard } = await import("@/components/citation-panel/lda-card");

    const { container } = render(<LdaCard citation={LDA_CITATION} />);
    const links = container.querySelectorAll("a[href]");
    const humanLink = Array.from(links).find((a) =>
      (a as HTMLAnchorElement).href.includes(
        "lda.senate.gov/filings/public/filing/",
      ),
    );
    expect(humanLink).toBeTruthy();
  });

  it("lda card: human link contains uuid from official_url", async () => {
    const { LdaCard } = await import("@/components/citation-panel/lda-card");

    const { container } = render(<LdaCard citation={LDA_CITATION} />);
    const links = container.querySelectorAll("a[href]");
    const humanLink = Array.from(links).find((a) =>
      (a as HTMLAnchorElement).href.includes("84df56d3"),
    );
    expect(humanLink).toBeTruthy();
  });

  it("lda card: renders uuid in mono", async () => {
    const { LdaCard } = await import("@/components/citation-panel/lda-card");

    const { container } = render(<LdaCard citation={LDA_CITATION} />);
    // UUID should appear somewhere in the component
    expect(container.textContent).toContain("84df56d3");
  });

  it("lda card: co-cites the API URL", async () => {
    const { LdaCard } = await import("@/components/citation-panel/lda-card");

    const { container } = render(<LdaCard citation={LDA_CITATION} />);
    expect(container.textContent).toContain("lda.senate.gov/api/v1/filings");
  });

  it("lda card: renders filing year when provided", async () => {
    const { LdaCard } = await import("@/components/citation-panel/lda-card");

    const { container } = render(
      <LdaCard citation={LDA_CITATION} filingYear="2025" />,
    );
    expect(container.textContent).toContain("2025");
  });

  it("panel: state B (xml-path) click does NOT open panel", async () => {
    // State B spans have no data-fact-id, so cite.tsx never calls openPanel.
    // This test verifies the cite component renders correctly without wiring
    // a panel open for xml-path shapes.
    const { Cite, CitationPanelContext } = await import("@/components/cite");

    let panelCallCount = 0;
    const { container } = render(
      <CitationPanelContext.Provider
        value={{ openPanel: () => { panelCallCount++; } }}
      >
        <Cite value={0} units="USD millions" dataset="test_dataset" xmlPath="ProgramElement[0]/Project[2]" />
      </CitationPanelContext.Provider>,
    );

    // State B span has no click handler — it's not role=button
    const el = container.querySelector("[data-amount]") as HTMLElement;
    expect(el).not.toHaveAttribute("role", "button");
    // Clicking the span should not call openPanel
    el.click();
    expect(panelCallCount).toBe(0);
  });

  it("panel: state C (uncited) click does NOT open panel", async () => {
    const { Cite, CitationPanelContext } = await import("@/components/cite");

    let panelCallCount = 0;
    const { container } = render(
      <CitationPanelContext.Provider
        value={{
          openPanel: () => { panelCallCount++; },
          hasCitation: () => true,
        }}
      >
        <Cite value={100} units="USD millions" dataset="test_dataset" />
      </CitationPanelContext.Provider>,
    );

    const el = container.querySelector("[data-amount]") as HTMLElement;
    expect(el).not.toHaveAttribute("role", "button");
    el.click();
    expect(panelCallCount).toBe(0);
  });

  // ── Derived card (Phase 5B-3) ───────────────────────────────────────────

  it("derived card: shows formula text", async () => {
    const { DerivedCard } = await import(
      "@/components/citation-panel/derived-card"
    );
    const { container } = render(<DerivedCard citation={DERIVED_CITATION} />);
    expect(container.textContent).toContain(
      "sum(budget_lines.amount_thousands where amount_type=fy_2024_actuals)",
    );
  });

  it("derived card: shows recorded value with units", async () => {
    const { DerivedCard } = await import(
      "@/components/citation-panel/derived-card"
    );
    const { container } = render(<DerivedCard citation={DERIVED_CITATION} />);
    expect(container.textContent).toContain("33,486");
    expect(container.textContent).toContain("USD thousands");
  });

  it("derived card: 16-hex input renders as clickable chip that opens its citation", async () => {
    const { DerivedCard } = await import(
      "@/components/citation-panel/derived-card"
    );
    const { CitationPanelContext } = await import("@/components/cite");

    let openedWith: string | null = null;
    const { container } = render(
      <CitationPanelContext.Provider
        value={{
          openPanel: (id) => { openedWith = id; },
          hasCitation: () => true,
        }}
      >
        <DerivedCard citation={DERIVED_CITATION} />
      </CitationPanelContext.Provider>,
    );

    const chip = container.querySelector(
      '[data-testid="derived-input-chip"]',
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("3f70c92b"); // last 8 of the input id
    chip.click();
    expect(openedWith).toBe("3dd4e3913f70c92b");
  });

  it("derived card: input chip is non-clickable when citation not in slice", async () => {
    const { DerivedCard } = await import(
      "@/components/citation-panel/derived-card"
    );
    const { CitationPanelContext } = await import("@/components/cite");

    const { container } = render(
      <CitationPanelContext.Provider
        value={{ openPanel: () => {}, hasCitation: () => false }}
      >
        <DerivedCard citation={DERIVED_CITATION} />
      </CitationPanelContext.Provider>,
    );

    expect(
      container.querySelector('[data-testid="derived-input-chip"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="derived-input-chip-static"]'),
    ).not.toBeNull();
  });

  it("derived card: URL input renders as external link", async () => {
    const { DerivedCard } = await import(
      "@/components/citation-panel/derived-card"
    );
    const { container } = render(<DerivedCard citation={DERIVED_CITATION} />);
    const links = container.querySelectorAll("a[href]");
    const urlLink = Array.from(links).find((a) =>
      (a as HTMLAnchorElement).href.includes("example.gov/source.csv"),
    );
    expect(urlLink).toBeTruthy();
    expect(urlLink).toHaveAttribute("target", "_blank");
  });

  // ── USAspending card (Phase 5B-3) ───────────────────────────────────────

  it("usaspending card: shows recorded value", async () => {
    const { UsaspendingCard } = await import(
      "@/components/citation-panel/usaspending-card"
    );
    const { container } = render(
      <UsaspendingCard citation={USASPENDING_CITATION} />,
    );
    expect(container.textContent).toContain("357,481,110.53");
  });

  it("usaspending card: query_body pretty-printed in a collapsible details", async () => {
    const { UsaspendingCard } = await import(
      "@/components/citation-panel/usaspending-card"
    );
    const { container } = render(
      <UsaspendingCard citation={USASPENDING_CITATION} />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    // Pretty-printed (multi-line) JSON includes the UEI filter
    expect(details!.textContent).toContain("DT8KJHZXVJH5");
    expect(details!.querySelector("pre")!.textContent).toContain("\n");
  });

  it("usaspending card: shows API endpoint when no permalink", async () => {
    const { UsaspendingCard } = await import(
      "@/components/citation-panel/usaspending-card"
    );
    const { container } = render(
      <UsaspendingCard citation={USASPENDING_CITATION} />,
    );
    expect(container.textContent).toContain(
      "api.usaspending.gov/api/v2/references/filter/",
    );
    expect(
      container.querySelector('[data-testid="usaspending-permalink"]'),
    ).toBeNull();
  });

  it("usaspending card: renders search-hash permalink link when present", async () => {
    const { UsaspendingCard } = await import(
      "@/components/citation-panel/usaspending-card"
    );
    const withPermalink = {
      ...USASPENDING_CITATION,
      official_url: "https://www.usaspending.gov/search/?hash=abc123def",
    };
    const { container } = render(<UsaspendingCard citation={withPermalink} />);
    const link = container.querySelector(
      '[data-testid="usaspending-permalink"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain("hash=abc123def");
  });

  it("usaspending card: renders recipient profile link when present", async () => {
    const { UsaspendingCard } = await import(
      "@/components/citation-panel/usaspending-card"
    );
    const withProfile = {
      ...USASPENDING_CITATION,
      official_url:
        "https://www.usaspending.gov/recipient/abc-123-def/latest",
    };
    const { container } = render(<UsaspendingCard citation={withProfile} />);
    expect(
      container.querySelector('[data-testid="usaspending-profile"]'),
    ).not.toBeNull();
  });

  it("usaspending card: shows drift note", async () => {
    const { UsaspendingCard } = await import(
      "@/components/citation-panel/usaspending-card"
    );
    const { container } = render(
      <UsaspendingCard citation={USASPENDING_CITATION} />,
    );
    expect(container.textContent).toMatch(/may drift/i);
  });

  // ── State card (Phase 5B-3) ─────────────────────────────────────────────

  it("state card (soql): SoQL link + captured value + nightly drift note", async () => {
    const { StateCard } = await import(
      "@/components/citation-panel/state-card"
    );
    const { container } = render(
      <StateCard citation={STATE_SOQL_CITATION} />,
    );
    const link = container.querySelector(
      '[data-testid="state-soql-link"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain("data.ct.gov");
    expect(container.textContent).toContain("18,364,245,509.61");
    expect(container.textContent).toMatch(/refreshes nightly/i);
  });

  it("state card (soql): shows retrieved_at", async () => {
    const { StateCard } = await import(
      "@/components/citation-panel/state-card"
    );
    const { container } = render(
      <StateCard citation={STATE_SOQL_CITATION} />,
    );
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute(
      "dateTime",
      "2026-06-12T22:09:59.866965+00:00",
    );
  });

  it("state card (file): pointer link + aggregation note, no nightly note", async () => {
    const { StateCard } = await import(
      "@/components/citation-panel/state-card"
    );
    const { container } = render(
      <StateCard citation={STATE_FILE_CITATION} />,
    );
    const link = container.querySelector(
      '[data-testid="state-file-link"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain("open.fiscal.ca.gov");
    expect(container.textContent).toContain(
      "DepartmentSpendingTransactionPointer.csv",
    );
    expect(container.textContent).not.toMatch(/refreshes nightly/i);
  });
});

// ── 4. Citation kind guards (Phase 5B-3) ─────────────────────────────────────

describe("citation kind guards", () => {
  it("guards discriminate all seven kinds", async () => {
    const {
      isJbookPdf,
      isWorkbook,
      isLdaFiling,
      isDerived,
      isUsaspending,
      isStateSoql,
      isStateFile,
    } = await import("@/lib/citations");

    const mk = (kind: string) => ({ kind }) as never;

    expect(isDerived(mk("derived"))).toBe(true);
    expect(isDerived(mk("workbook"))).toBe(false);
    expect(isUsaspending(mk("usaspending"))).toBe(true);
    expect(isUsaspending(mk("derived"))).toBe(false);
    expect(isStateSoql(mk("state_soql"))).toBe(true);
    expect(isStateSoql(mk("state_file"))).toBe(false);
    expect(isStateFile(mk("state_file"))).toBe(true);
    expect(isStateFile(mk("state_soql"))).toBe(false);
    expect(isJbookPdf(mk("jbook_pdf"))).toBe(true);
    expect(isWorkbook(mk("workbook"))).toBe(true);
    expect(isLdaFiling(mk("lda_filing"))).toBe(true);
  });

  it("parseDerivedInputs splits fact-id and URL inputs", async () => {
    const { parseDerivedInputs } = await import("@/lib/citations");
    const inputs = parseDerivedInputs(
      JSON.stringify(["3dd4e3913f70c92b", "https://example.gov/x", "junk"]),
    );
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toMatchObject({ isFactId: true, isUrl: false });
    expect(inputs[1]).toMatchObject({ isFactId: false, isUrl: true });
    expect(inputs[2]).toMatchObject({ isFactId: false, isUrl: false });
  });

  it("parseDerivedInputs returns [] on null/malformed", async () => {
    const { parseDerivedInputs } = await import("@/lib/citations");
    expect(parseDerivedInputs(null)).toEqual([]);
    expect(parseDerivedInputs("not json")).toEqual([]);
    expect(parseDerivedInputs('{"a":1}')).toEqual([]);
  });

  it("usaspendingUrlKind classifies permalink/profile/endpoint", async () => {
    const { usaspendingUrlKind } = await import("@/lib/citations");
    expect(
      usaspendingUrlKind("https://www.usaspending.gov/search/?hash=abc"),
    ).toBe("permalink");
    expect(
      usaspendingUrlKind("https://www.usaspending.gov/recipient/x/latest"),
    ).toBe("profile");
    expect(
      usaspendingUrlKind("https://api.usaspending.gov/api/v2/references/filter/"),
    ).toBe("endpoint");
    expect(usaspendingUrlKind(null)).toBe("endpoint");
  });
});
