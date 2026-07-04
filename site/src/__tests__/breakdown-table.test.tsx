/**
 * Task 3b (Phase 5D) — derived breakdown tables ("show your work").
 *
 * Contract under test (plan Task 3b, spec §3b):
 *   - DerivedCard with a factId lazily fetches /json/breakdowns/{fact_id}.json;
 *     404 → card unchanged (no breakdown UI, no error).
 *   - Small input sets (≤5 rows) render the table INLINE in the panel;
 *     large sets render a "View all N line items →" button that opens a
 *     full-screen overlay (Radix dialog — Esc closes, focus trapped).
 *   - Table: [data-testid="breakdown-table"]; sum row
 *     [data-testid="breakdown-sum"][data-v] equals the derived recorded_value;
 *     subtracted inputs render as a negative line ("− <label>", negative v);
 *     uncited rows (fid:null, uncited:true) render the ⁂ state (data-uncited);
 *     cited rows are state-A <Cite>s whose click drills the panel
 *     (openPanel(input fid)).
 *   - CSV export ([data-testid="breakdown-csv"]) downloads rows matching the
 *     table body.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

import { fetchBreakdown, __resetBreakdownCache } from "@/lib/breakdowns";
import { DerivedCard } from "@/components/citation-panel/derived-card";
import { CitationPanelContext } from "@/components/cite";
import type { DerivedCitation } from "@/lib/citations";

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

const DELTA_FID = "0020e98cc83a9076";

const DELTA_CITATION: DerivedCitation = {
  kind: "derived",
  ...NON_DOC_NULLS,
  official_url: null,
  retrieved_at: "2026-06-12T22:09:13.330786+00:00",
  units: "USD thousands",
  formula: "fy2026_total - fy2025_total",
  inputs: JSON.stringify(["a684d54e1ffa35cf", "75bebc3cac4cc41a"]),
  query_body: null,
  recorded_value: "-690.000",
};

/** Real exporter shape: Δ breakdown — subtracted input carries negative v. */
const DELTA_BREAKDOWN = {
  fact_id: DELTA_FID,
  formula: "fy2026_total - fy2025_total",
  op: "difference",
  recorded_value: "-690.000",
  units: "USD thousands",
  rows: [
    { fid: "a684d54e1ffa35cf", label: "FY2026 total", pe_bli: "0604256N", v: 25133.0 },
    {
      fid: "75bebc3cac4cc41a",
      label: "FY2025 total",
      pe_bli: "0604256N",
      subtracted: true,
      v: -25823.0,
    },
  ],
};

const SUM_FID = "227abd03fe02f490";

const SUM_CITATION: DerivedCitation = {
  kind: "derived",
  ...NON_DOC_NULLS,
  official_url: null,
  retrieved_at: "2026-06-12T22:09:13.330786+00:00",
  units: "USD millions",
  formula: "sum(dim_programs.fy2024_actual_millions) for org='X'",
  inputs: JSON.stringify(["1111111111111111"]),
  query_body: null,
  recorded_value: "60.000",
};

/** 8 rows (>5 → overlay), including an uncited row that accounts for the sum. */
const SUM_BREAKDOWN = {
  fact_id: SUM_FID,
  formula: "sum(dim_programs.fy2024_actual_millions) for org='X'",
  op: "sum",
  recorded_value: "60.000",
  units: "USD millions",
  rows: [
    { fid: "1111111111111111", label: "Program One", pe_bli: "0101A", v: 20.0 },
    { fid: "2222222222222222", label: "Program Two", pe_bli: "0102A", v: 15.0 },
    { fid: "3333333333333333", label: "Program Three", pe_bli: "0103A", v: 10.0 },
    { fid: "4444444444444444", label: "Program Four", pe_bli: "0104A", v: 8.0 },
    { fid: "5555555555555555", label: "Program Five", pe_bli: "0105A", v: 4.0 },
    { fid: "6666666666666666", label: "Program Six", pe_bli: "0106A", v: 2.0 },
    { fid: "7777777777777777", label: "Program Seven", pe_bli: "0107A", v: 1.0 },
    { fid: null, label: "Uncited Program", pe_bli: "0108A", uncited: true, v: 0.0 },
  ],
};

const BIG_FID = "331155dd0099aabb";

const BIG_CITATION: DerivedCitation = {
  kind: "derived",
  ...NON_DOC_NULLS,
  official_url: null,
  retrieved_at: "2026-06-12T22:09:13.330786+00:00",
  units: "USD millions",
  formula: "sum(dim_programs.fy2024_actual_millions) for org='Y'",
  inputs: JSON.stringify(["1111111111111111"]),
  query_body: null,
  recorded_value: "435.000",
};

/** 30 rows (> FILTER_ROW_THRESHOLD 25) — the overlay gets a text filter. */
const BIG_BREAKDOWN = {
  fact_id: BIG_FID,
  formula: "sum(dim_programs.fy2024_actual_millions) for org='Y'",
  op: "sum",
  recorded_value: "435.000",
  units: "USD millions",
  rows: Array.from({ length: 30 }, (_, i) => ({
    fid: String(1000000000000000 + i),
    label: `Big Program ${String(i + 1).padStart(2, "0")}`,
    pe_bli: `0200${String(i + 1).padStart(2, "0")}F`,
    v: 30 - i,
  })),
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function notFound(): Response {
  return {
    ok: false,
    status: 404,
    json: () => Promise.reject(new Error("no body")),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetBreakdownCache();
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u === `/json/breakdowns/${DELTA_FID}.json`) {
      return Promise.resolve(jsonResponse(DELTA_BREAKDOWN));
    }
    if (u === `/json/breakdowns/${SUM_FID}.json`) {
      return Promise.resolve(jsonResponse(SUM_BREAKDOWN));
    }
    if (u === `/json/breakdowns/${BIG_FID}.json`) {
      return Promise.resolve(jsonResponse(BIG_BREAKDOWN));
    }
    if (u.startsWith("/json/breakdowns/")) {
      return Promise.resolve(notFound());
    }
    return Promise.reject(new Error(`unmocked fetch ${u}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── lib/breakdowns ───────────────────────────────────────────────────────────

describe("breakdowns lib", () => {
  it("fetches /json/breakdowns/{fact_id}.json and caches the result", async () => {
    const b1 = await fetchBreakdown(DELTA_FID);
    expect(b1?.rows).toHaveLength(2);
    const b2 = await fetchBreakdown(DELTA_FID);
    expect(b2).toBe(b1 === null ? b2 : b1); // same cached object
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("404 (no breakdown for this fact) resolves null and is cached", async () => {
    expect(await fetchBreakdown("ffffffffffffffff")).toBeNull();
    expect(await fetchBreakdown("ffffffffffffffff")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("network failure resolves null but is NOT poison-cached", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await fetchBreakdown(DELTA_FID)).toBeNull();
    expect(await fetchBreakdown(DELTA_FID)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── DerivedCard wiring — inline table (≤5 rows) ─────────────────────────────

describe("DerivedCard breakdown — inline (≤5 rows)", () => {
  it("renders the inline breakdown table with a sum row equal to recorded_value", async () => {
    render(<DerivedCard citation={DELTA_CITATION} factId={DELTA_FID} />);

    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    // Two data rows in tbody
    const table = screen.getByTestId("breakdown-table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);

    // Sum row pinned at the bottom equals the derived figure
    const sum = screen.getByTestId("breakdown-sum");
    expect(Number(sum.getAttribute("data-v"))).toBeCloseTo(-690.0, 3);
  });

  it("subtracted inputs render as a negative line (− label, negative amount)", async () => {
    render(<DerivedCard citation={DELTA_CITATION} factId={DELTA_FID} />);
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    const table = screen.getByTestId("breakdown-table");
    expect(table.textContent).toContain("− FY2025 total");
    // Negative value visible (exact numerals make the arithmetic checkable)
    expect(table.textContent).toContain("-25,823");
  });

  it("amounts render FIXED 3 decimals (decimal-aligned column)", async () => {
    render(<DerivedCard citation={DELTA_CITATION} factId={DELTA_FID} />);
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    const table = screen.getByTestId("breakdown-table");
    // 25133 / -25823 / -690 all pad to 3dp — no mixed "168.2"-style rows.
    expect(table.textContent).toContain("25,133.000");
    expect(table.textContent).toContain("-25,823.000");
    expect(table.textContent).toContain("-690.000");
  });

  it("row amounts are state-A cites; clicking drills the panel to that input", async () => {
    let openedWith: string | null = null;
    render(
      <CitationPanelContext.Provider
        value={{
          openPanel: (id) => {
            openedWith = id;
          },
          hasCitation: () => true,
        }}
      >
        <DerivedCard citation={DELTA_CITATION} factId={DELTA_FID} />
      </CitationPanelContext.Provider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    const cite = screen
      .getByTestId("breakdown-table")
      .querySelector('[data-fact-id="a684d54e1ffa35cf"]') as HTMLElement;
    expect(cite).not.toBeNull();
    fireEvent.click(cite);
    expect(openedWith).toBe("a684d54e1ffa35cf");
  });

  it("no breakdown file (404) → derived card unchanged, no breakdown UI", async () => {
    render(
      <DerivedCard
        citation={{ ...DELTA_CITATION, recorded_value: "1.000" }}
        factId="ffffffffffffffff"
      />,
    );
    // Give the fetch a tick to settle
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("breakdown-table")).toBeNull();
    expect(screen.queryByText(/line items/i)).toBeNull();
  });

  it("no factId prop → no fetch, no breakdown UI (existing pages untouched)", () => {
    render(<DerivedCard citation={DELTA_CITATION} />);
    const breakdownCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("breakdowns"),
    );
    expect(breakdownCalls).toHaveLength(0);
    expect(screen.queryByTestId("breakdown-table")).toBeNull();
  });
});

// ── DerivedCard wiring — overlay (>5 rows) ──────────────────────────────────

describe("DerivedCard breakdown — overlay (>5 rows)", () => {
  it('shows "View all N line items →" and opens the overlay with the table', async () => {
    render(<DerivedCard citation={SUM_CITATION} factId={SUM_FID} />);

    const openBtn = await screen.findByTestId("breakdown-open");
    expect(openBtn.textContent).toContain("View all 8 line items");
    // Table not rendered until the overlay opens
    expect(screen.queryByTestId("breakdown-table")).toBeNull();

    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("breakdown-table").querySelectorAll("tbody tr"),
    ).toHaveLength(8);

    // Sum row equals the recorded value
    expect(
      Number(screen.getByTestId("breakdown-sum").getAttribute("data-v")),
    ).toBeCloseTo(60.0, 3);
  });

  it("overlay is a dialog and Esc closes it", async () => {
    render(<DerivedCard citation={SUM_CITATION} factId={SUM_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-overlay")).toBeInTheDocument();
    });

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("breakdown-overlay")).toBeNull();
    });
  });

  it("uncited rows render the ⁂ state (data-uncited), accounting for 100% of the sum", async () => {
    render(<DerivedCard citation={SUM_CITATION} factId={SUM_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    const table = screen.getByTestId("breakdown-table");
    const uncited = table.querySelectorAll('[data-uncited="true"]');
    expect(uncited).toHaveLength(1);
    // Uncited rows never carry a fact id
    expect(uncited[0].getAttribute("data-fact-id")).toBeNull();
    expect(table.textContent).toContain("Uncited Program");
  });

  it('uncited rows carry an explicit muted "uncited" tag in the amount cell', async () => {
    render(<DerivedCard citation={SUM_CITATION} factId={SUM_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    const table = screen.getByTestId("breakdown-table");
    const uncitedSpan = table.querySelector('[data-uncited="true"]') as HTMLElement;
    const amountCell = uncitedSpan.closest("td") as HTMLElement;
    // The tag is a visible word, not just the ⁂ glyph.
    expect(amountCell.textContent).toContain("uncited");
  });

  it('overlay header states the recorded total ("sums to …") and shows the legend', async () => {
    render(<DerivedCard citation={SUM_CITATION} factId={SUM_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    const overlay = await screen.findByTestId("breakdown-overlay");

    const total = screen.getByTestId("breakdown-overlay-total");
    expect(Number(total.getAttribute("data-v"))).toBeCloseTo(60.0, 3);
    expect(total.textContent).toBe("60.000");
    expect(overlay.textContent).toContain("sums to");

    // Honesty-marker legend in the overlay header
    expect(
      overlay.querySelector('[data-testid="cite-legend"]'),
    ).not.toBeNull();
    // …and the sum row is inside the dedicated scrollport contract element.
    const scroll = overlay.querySelector('[data-testid="breakdown-scroll"]');
    expect(scroll).not.toBeNull();
    expect(
      scroll!.querySelector('[data-testid="breakdown-sum"]'),
    ).not.toBeNull();
  });
});

// ── Overlay text filter — pinned in the sticky header (backlog #21) ──────────

describe("DerivedCard breakdown — overlay filter pinning (>25 rows)", () => {
  it("renders the filter INSIDE the overlay header, not the scrollport", async () => {
    render(<DerivedCard citation={BIG_CITATION} factId={BIG_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    const overlay = await screen.findByTestId("breakdown-overlay");

    const filter = screen.getByTestId("breakdown-filter");
    // In the overlay…
    expect(overlay.contains(filter)).toBe(true);
    // …but NOT inside the scrollable row list — the scrollport scrolling
    // must never carry the filter out of view (judge advisory).
    const scroll = screen.getByTestId("breakdown-scroll");
    expect(scroll.contains(filter)).toBe(false);
    // Same non-scrolling header region as the recorded total.
    const headerRegion = screen
      .getByTestId("breakdown-overlay-total")
      .closest(".shrink-0");
    expect(headerRegion).not.toBeNull();
    expect(headerRegion!.contains(filter)).toBe(true);
  });

  it("filter below the threshold is not rendered (small overlay sets)", async () => {
    render(<DerivedCard citation={SUM_CITATION} factId={SUM_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    await screen.findByTestId("breakdown-overlay");
    expect(screen.queryByTestId("breakdown-filter")).toBeNull();
  });

  it("typing in the pinned filter narrows the rows; sum row keeps the full count", async () => {
    render(<DerivedCard citation={BIG_CITATION} factId={BIG_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    await screen.findByTestId("breakdown-overlay");

    const table = screen.getByTestId("breakdown-table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(30);

    fireEvent.change(screen.getByTestId("breakdown-filter"), {
      target: { value: "Big Program 07" },
    });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.textContent).toContain("Big Program 07");
    // Honesty note: the sum row still states it covers ALL line items.
    expect(screen.getByTestId("breakdown-sum").textContent).toContain(
      "(all 30 line items)",
    );
  });

  it("closing and reopening the overlay resets the filter", async () => {
    render(<DerivedCard citation={BIG_CITATION} factId={BIG_FID} />);
    fireEvent.click(await screen.findByTestId("breakdown-open"));
    await screen.findByTestId("breakdown-overlay");
    fireEvent.change(screen.getByTestId("breakdown-filter"), {
      target: { value: "Big Program 07" },
    });

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("breakdown-overlay")).toBeNull();
    });

    fireEvent.click(screen.getByTestId("breakdown-open"));
    await screen.findByTestId("breakdown-overlay");
    expect(
      (screen.getByTestId("breakdown-filter") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.getByTestId("breakdown-table").querySelectorAll("tbody tr"),
    ).toHaveLength(30);
  });
});

// ── Drill-down + Back (full provider) ────────────────────────────────────────

describe("breakdown drill-down with Back (provider integration)", () => {
  it("row cite drills the panel to the input; Back returns to the derived card", async () => {
    const { CitationPanelProvider } = await import(
      "@/components/citation-panel"
    );

    const INPUT_CITATION = {
      kind: "workbook" as const,
      ...NON_DOC_NULLS,
      sha256: "inputsha",
      sheet: "Exhibit R-2A Input",
      cells: "P19",
      amount_thousands: 25133,
      official_url: "https://example.gov/wb.xlsx",
      retrieved_at: null,
      units: "USD thousands",
      formula: null,
      inputs: null,
      query_body: null,
      recorded_value: null,
    };

    function OpenDelta() {
      const { openPanel } = React.useContext(CitationPanelContext);
      return (
        <button type="button" onClick={() => openPanel(DELTA_FID)}>
          open delta
        </button>
      );
    }

    render(
      <CitationPanelProvider
        citations={
          {
            [DELTA_FID]: DELTA_CITATION,
            a684d54e1ffa35cf: INPUT_CITATION,
          } as never
        }
      >
        <OpenDelta />
      </CitationPanelProvider>,
    );

    fireEvent.click(screen.getByText("open delta"));
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });
    // No Back affordance at the root of the drill stack
    expect(screen.queryByTestId("panel-back")).toBeNull();

    // Drill into the FY2026 input
    fireEvent.click(
      screen
        .getByTestId("breakdown-table")
        .querySelector('[data-fact-id="a684d54e1ffa35cf"]') as HTMLElement,
    );
    await waitFor(() => {
      expect(screen.getByTestId("citation-panel").textContent).toContain(
        "Exhibit R-2A Input",
      );
    });

    // Back returns to the derived card
    const back = screen.getByTestId("panel-back");
    fireEvent.click(back);
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("panel-back")).toBeNull();
  });
});

// ── CSV export ───────────────────────────────────────────────────────────────

describe("breakdown CSV export", () => {
  let capturedBlob: Blob | null = null;

  beforeEach(() => {
    capturedBlob = null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((b: Blob) => {
        capturedBlob = b;
        return "blob:test";
      }),
      revokeObjectURL: vi.fn(),
    });
    // Prevent jsdom navigation on the synthetic <a>.click()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a CSV whose data rows match the table body", async () => {
    render(<DerivedCard citation={DELTA_CITATION} factId={DELTA_FID} />);
    await waitFor(() => {
      expect(screen.getByTestId("breakdown-table")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("breakdown-csv"));
    expect(capturedBlob).not.toBeNull();
    const text = await capturedBlob!.text();
    const lines = text.trim().split("\n");
    // header + 2 data rows (sum row NOT exported)
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("label");
    expect(lines[0]).toContain("pe_bli");
    expect(text).toContain("FY2026 total");
    expect(text).toContain("-25823");
  });
});
