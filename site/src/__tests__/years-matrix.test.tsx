/**
 * Task 4 (Phase 5D) — /years/ CapIQ-style budget matrix island.
 *
 * Pure-logic contracts (exported helpers):
 *   - flattenPrograms: org→program nesting → ordered {org, program} entries
 *   - filterEntries: case-insensitive match on pe_bli / title / org
 *   - sortEntries: numeric, stable, missing-last (both directions)
 *   - buildYearsCsv: header carries pe_bli; values in USD millions; nulls empty
 *
 * Render contracts (G8 leg c DOM, BINDING per the gate header):
 *   - [data-testid="years-matrix"], tr[data-program-row][data-pe],
 *     tr[data-project-row], td[data-col][data-v], [data-sort], [data-expand],
 *     [data-testid="years-filter"], [data-testid="years-csv"],
 *     [data-sticky-col]
 *   - null cells render "–" as plain text: NO data-amount, NO data-v
 *   - Δ cells are state-A <Cite>s (data-fact-id); %Δ cells are plain
 *     (annotation of the cited Δ — no data-amount, matching program-figures)
 *   - expand caret reveals project sub-rows; org header collapses its section
 *   - sorting flattens the grouped view (global ordering, missing-last)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

import {
  flattenPrograms,
  filterEntries,
  sortEntries,
  buildYearsCsv,
  decadeQualifierSummary,
  decadeCellMeasure,
  decadeColumnQualified,
  decadeQualifierNote,
  defaultSortKey,
  cellState,
  fmtDisplayMillions,
  fmtDelta,
  fmtPct,
  YearsMatrix,
  type YearsMatrixData,
} from "@/components/years-matrix";

// ── Fixture matrix (schema of data/site/json/years_matrix.json) ─────────────

const MATRIX: YearsMatrixData = {
  schema_version: 1,
  program_units: "USD thousands",
  project_units: "USD millions",
  amount_types: [
    "fy_2024_actuals",
    "fy_2025_total",
    "fy_2026_total",
  ],
  default_columns: [
    "fy_2024_actuals",
    "fy_2025_total",
    "fy_2026_total",
    "fy2526_change",
    "fy2526_pct_change",
  ],
  delta_columns: ["fy2526_change", "fy2526_pct_change"],
  project_scenarios: {
    fy2024: "PriorYear",
    fy2025: "CurrentYear",
    fy2026: "BudgetYearOne",
  },
  orgs: [
    {
      org: "DARPA",
      programs: [
        {
          pe_bli: "0601101E",
          title: "Defense Research Sciences",
          cells: {
            fy_2024_actuals: { fid: "aa00000000000001", v: 100000 },
            fy_2025_total: { fid: "aa00000000000002", v: 200000 },
            fy_2026_total: { fid: "aa00000000000003", v: 300000 },
            fy2526_change: { fid: "aa00000000000004", v: 100000 },
            fy2526_pct_change: { v: 50.0 },
          },
          projects: [
            {
              project_number: "P1",
              title: "Basic Research Project",
              cells: {
                fy2024: { fid: "bb00000000000001", v: 10.5 },
                fy2025: { fid: null, v: 0.0, xp: "PE[1]/Proj[2]" },
              },
            },
          ],
        },
        {
          pe_bli: "0602702E",
          title: "Tactical Technology",
          cells: {
            fy_2024_actuals: { fid: "aa00000000000005", v: 50000 },
            // fy_2025_total missing → "–"
            fy_2026_total: { fid: "aa00000000000006", v: 40000 },
            fy2526_change: { fid: "aa00000000000007", v: -10000 },
            fy2526_pct_change: { v: -20.0 },
          },
          projects: [],
        },
      ],
    },
    {
      org: "MDA",
      programs: [
        {
          pe_bli: "0603882C",
          title: "Ballistic Missile Defense",
          cells: {
            fy_2024_actuals: { fid: "aa00000000000008", v: 75000 },
            fy_2025_total: { fid: "aa00000000000009", v: 80000 },
            // fy_2026_total missing
            fy2526_change: { fid: "aa0000000000000a", v: 5000 },
            fy2526_pct_change: { v: 6.3 },
          },
          projects: [],
        },
      ],
    },
  ],
};

// ── Phase 5E decade fixture (decade_columns / decade_default_columns) ───────
// Cells live under fy{yyyy}{a|e|r} keys; absent editions are GAPS (no key).

const MATRIX_DECADE: YearsMatrixData = {
  ...MATRIX,
  orgs: [
    {
      org: "DARPA",
      programs: [
        {
          ...MATRIX.orgs[0].programs[0],
          cells: {
            ...MATRIX.orgs[0].programs[0].cells,
            fy2015a: { fid: "dd00000000000001", v: 90000 },
            fy2020a: { fid: "dd00000000000002", v: 95000 },
            fy2020e: { fid: "dd00000000000005", v: 94000 },
            fy2025e: { fid: "dd00000000000003", v: 200000, m: "enacted-total" },
            fy2026r: { fid: "dd00000000000004", v: 300000 },
          },
        },
        {
          // 0602702E: NOT in the PB2017 edition → fy2015a is a gap
          ...MATRIX.orgs[0].programs[1],
          cells: {
            ...MATRIX.orgs[0].programs[1].cells,
            fy2020a: { fid: "dd00000000000006", v: 40000 },
            fy2026r: { fid: "dd00000000000007", v: 42000 },
          },
        },
      ],
    },
    MATRIX.orgs[1],
  ],
  decade_columns: [
    // Tri-persona review Wave 2 — a UNIFORM qualified column: every emitted
    // cell comes from one workbook column that reports something other than
    // the header's kind, so the qualifier lives on the COLUMN and no cell
    // repeats it (the real fy2015a is "FY 2015 (Base & OCO)").
    { key: "fy2015a", fy: 2015, kind: "actuals", edition: 2017, measures: ["actuals-base-oco"] },
    { key: "fy2020a", fy: 2020, kind: "actuals", edition: 2022 },
    { key: "fy2020e", fy: 2020, kind: "enacted", edition: 2021, measures: ["enacted-request"] },
    { key: "fy2024a", fy: 2024, kind: "actuals", edition: 2026 },
    // …and a MIXED one: some cells are plain enacted, some are the book
    // total, so the divergent cells carry their own `m` (the real fy2025e).
    { key: "fy2025e", fy: 2025, kind: "enacted", edition: 2026, measures: ["enacted", "enacted-total"] },
    { key: "fy2026r", fy: 2026, kind: "request", edition: 2026 },
  ],
  decade_default_columns: ["fy2015a", "fy2020a", "fy2025e", "fy2026r"],
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("years-matrix helpers", () => {
  const entries = flattenPrograms(MATRIX);

  it("flattenPrograms preserves org and program order", () => {
    expect(entries.map((e) => e.program.pe_bli)).toEqual([
      "0601101E",
      "0602702E",
      "0603882C",
    ]);
    expect(entries.map((e) => e.org)).toEqual(["DARPA", "DARPA", "MDA"]);
  });

  it("filterEntries matches pe_bli, title, and org (case-insensitive)", () => {
    expect(filterEntries(entries, "0601101e")).toHaveLength(1);
    expect(filterEntries(entries, "tactical")).toHaveLength(1);
    expect(filterEntries(entries, "mda")).toHaveLength(1);
    expect(filterEntries(entries, "")).toHaveLength(3);
    expect(filterEntries(entries, "zzz-no-match")).toHaveLength(0);
  });

  it("sortEntries desc puts missing values LAST", () => {
    const sorted = sortEntries(entries, "fy_2026_total", "desc");
    expect(sorted.map((e) => e.program.pe_bli)).toEqual([
      "0601101E", // 300000
      "0602702E", // 40000
      "0603882C", // missing → last
    ]);
  });

  it("sortEntries asc keeps missing values LAST (not first)", () => {
    const sorted = sortEntries(entries, "fy_2026_total", "asc");
    expect(sorted.map((e) => e.program.pe_bli)).toEqual([
      "0602702E", // 40000
      "0601101E", // 300000
      "0603882C", // missing → still last
    ]);
  });

  it("sortEntries is stable for ties", () => {
    const tied = flattenPrograms(MATRIX).map((e, i) => ({
      ...e,
      program: {
        ...e.program,
        cells: { ...e.program.cells, fy_2024_actuals: { fid: `t${i}`, v: 7 } },
      },
    }));
    const sorted = sortEntries(tied, "fy_2024_actuals", "desc");
    expect(sorted.map((e) => e.program.pe_bli)).toEqual([
      "0601101E",
      "0602702E",
      "0603882C",
    ]);
  });

  it("defaultSortKey: the newest NON-delta column of the default set", () => {
    // Pre-decade payload: default_columns ends with the two Δ columns, which
    // are annotations of two amounts — the newest AMOUNT is what opens.
    expect(defaultSortKey(MATRIX)).toBe("fy_2026_total");
    // Decade payload: the decade defaults take precedence and end on the
    // FY2026 request.
    expect(defaultSortKey(MATRIX_DECADE)).toBe("fy2026r");
  });

  it("defaultSortKey: null when every default column is a Δ column", () => {
    expect(
      defaultSortKey({
        ...MATRIX,
        decade_default_columns: [],
        default_columns: ["fy2526_change", "fy2526_pct_change"],
      }),
    ).toBeNull();
  });

  it("buildYearsCsv: pe_bli header, USD-millions values, empty for null", () => {
    const csv = buildYearsCsv(entries, ["fy_2026_total", "fy2526_pct_change"]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(4); // header + 3 programs
    expect(lines[0]).toMatch(/pe_bli/);
    // 300000 thousands → 300 millions
    expect(lines[1]).toContain("300");
    // missing fy_2026_total on MDA row → empty field, never 0
    const mdaRow = lines[3].split(",");
    const colIdx = lines[0].split(",").findIndex((h) => h.includes("fy_2026_total"));
    expect(mdaRow[colIdx]).toBe("");
  });
});

// ── Render contract ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    if (String(url) === "/json/years_matrix.json") {
      return Promise.resolve(jsonResponse(MATRIX));
    }
    return Promise.reject(new Error(`unmocked fetch ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderMatrix() {
  const utils = render(<YearsMatrix />);
  await waitFor(() => {
    expect(screen.getByTestId("years-matrix")).toBeInTheDocument();
  });
  return utils;
}

describe("YearsMatrix — render contract", () => {
  it("renders the honesty-marker legend near the table controls", async () => {
    await renderMatrix();
    const legend = screen.getByTestId("cite-legend");
    expect(legend.textContent).toContain("cited (click for source)");
    // Round-1 judging: the legend used to read "zero in source XML", but the
    // XML badge also marks NON-zero figures whose page match did not resolve,
    // so a judge found it beside a live amount and read a contradiction. The
    // legend now states what the badge means, and this asserts it can never
    // silently narrow back to the zero-only claim.
    expect(legend.textContent).toContain(
      "cited to the justification XML, no page highlight",
    );
    expect(legend.textContent).not.toContain("zero in source XML");
    expect(legend.textContent).toContain("uncited input (still counted)");
  });

  it("renders a family-thread legend decoding the branch glyph", async () => {
    // The per-row GitBranch signpost ([data-family-badge]) needs a legend so
    // users can learn what it means (visual-judge round).
    await renderMatrix();
    const legend = screen.getByTestId("family-legend");
    expect(legend.textContent?.toLowerCase()).toContain("tracked program family");
    expect(legend.textContent?.toLowerCase()).toContain("lineage");
  });

  it("renders program rows with data-pe", async () => {
    await renderMatrix();
    const rows = document.querySelectorAll("tr[data-program-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("data-pe")).toBe("0601101E");
  });

  // ── §P2-2: the grid opens on substance, not on a screenful of dashes ──

  it("opens sorted DESC on the newest amount column, missing LAST", async () => {
    await renderMatrix();
    const pes = [...document.querySelectorAll("tr[data-program-row]")].map(
      (tr) => tr.getAttribute("data-pe"),
    );
    // 300000 · 40000 · missing — not payload order by accident: the MDA row
    // has no fy_2026_total and sorts last in BOTH directions.
    expect(pes).toEqual(["0601101E", "0602702E", "0603882C"]);
    const th = document.querySelector('th[data-col="fy_2026_total"]');
    expect(th?.getAttribute("aria-sort")).toBe("descending");
    // Flat: the org section headers are suspended while a sort is active.
    expect(document.querySelectorAll("tr[data-org-row]")).toHaveLength(0);
  });

  it("the default sort key is the payload's, not a hardcoded column", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url) === "/json/years_matrix.json"
        ? Promise.resolve(jsonResponse(MATRIX_DECADE))
        : Promise.reject(new Error(`unmocked fetch ${url}`)),
    );
    await renderMatrix();
    expect(
      document.querySelector('th[data-col="fy2026r"]')?.getAttribute("aria-sort"),
    ).toBe("descending");
    expect(
      document.querySelector('th[data-col="fy2015a"]')?.getAttribute("aria-sort"),
    ).toBe("none");
  });

  it("'Group by organization' restores the collapsible org sections", async () => {
    await renderMatrix();
    fireEvent.click(screen.getByTestId("years-group-by-org"));
    expect(
      document.querySelectorAll("tr[data-org-row]").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("DARPA")).toBeInTheDocument();
    expect(screen.getByText("MDA")).toBeInTheDocument();
    // The control is a no-op in grouped mode, so it takes itself away.
    expect(screen.queryByTestId("years-group-by-org")).toBeNull();
  });

  it("the 33-chip column picker hides behind a disclosure below sm", async () => {
    await renderMatrix();
    const toggle = screen.getByTestId("years-columns-toggle");
    const picker = document.getElementById("years-column-picker")!;
    // Closed by default: `hidden` below sm, `sm:flex` at ≥640px.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(picker.className).toContain("hidden");
    expect(picker.className).toContain("sm:flex");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(picker.className).toContain("flex");
    expect(picker.className).not.toContain("hidden");
  });

  it("numeric cells carry data-col + data-v; cited cells are state-A Cites", async () => {
    await renderMatrix();
    const cell = document.querySelector(
      'tr[data-program-row][data-pe="0601101E"] td[data-col="fy_2026_total"]',
    ) as HTMLElement;
    expect(cell.getAttribute("data-v")).toBe("300000");
    expect(
      cell.querySelector('[data-fact-id="aa00000000000003"]'),
    ).not.toBeNull();
  });

  it('null cells render "—" as absent: no data-amount, no data-v (§P2-7)', async () => {
    await renderMatrix();
    const cell = document.querySelector(
      'tr[data-program-row][data-pe="0602702E"] td[data-col="fy_2025_total"]',
    ) as HTMLElement;
    // The em dash is the glyph; the sr-only twin is what a screen reader gets,
    // because "—" read aloud is not a claim.
    expect(cell.textContent).toBe("—no figure");
    expect(cell.getAttribute("data-cell-state")).toBe("absent");
    expect(cell.hasAttribute("data-v")).toBe(false);
    expect(cell.querySelector("[data-amount]")).toBeNull();
  });

  it("Δ cells are cited; %Δ cells are plain annotations (no data-amount)", async () => {
    await renderMatrix();
    const delta = document.querySelector(
      'tr[data-pe="0601101E"] td[data-col="fy2526_change"]',
    ) as HTMLElement;
    expect(delta.querySelector('[data-fact-id="aa00000000000004"]')).not.toBeNull();

    const pct = document.querySelector(
      'tr[data-pe="0601101E"] td[data-col="fy2526_pct_change"]',
    ) as HTMLElement;
    expect(pct.getAttribute("data-v")).toBe("50");
    expect(pct.querySelector("[data-amount]")).toBeNull();
    expect(pct.textContent).toContain("+50.0%");
  });

  it("sticky contract: header cells and first-column cells", async () => {
    await renderMatrix();
    const th = document.querySelector(
      '[data-testid="years-matrix"] thead th',
    ) as HTMLElement;
    expect(th.className).toContain("sticky");
    const stickyCol = document.querySelector("[data-sticky-col]") as HTMLElement;
    expect(stickyCol).not.toBeNull();
    expect(stickyCol.className).toContain("sticky");
  });

  it("expand caret reveals project sub-rows and collapses back", async () => {
    await renderMatrix();
    expect(document.querySelectorAll("tr[data-project-row]")).toHaveLength(0);

    const caret = document.querySelector("[data-expand]") as HTMLElement;
    fireEvent.click(caret);
    const projRows = document.querySelectorAll("tr[data-project-row]");
    expect(projRows.length).toBeGreaterThan(0);
    // Project cell: state-B (xml-path) cite for the zero-amount fact
    expect(
      document.querySelector('tr[data-project-row] [data-citation-kind="xml-path"]'),
    ).not.toBeNull();

    fireEvent.click(caret);
    expect(document.querySelectorAll("tr[data-project-row]")).toHaveLength(0);
  });

  it("collapsing an org section hides its program rows", async () => {
    await renderMatrix();
    fireEvent.click(screen.getByTestId("years-group-by-org"));
    fireEvent.click(screen.getByRole("button", { name: /collapse darpa/i }));
    const rows = [...document.querySelectorAll("tr[data-program-row]")];
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-pe")).toBe("0603882C");
  });

  it("filter narrows rows within the 50-millisecond budget and clearing restores", async () => {
    await renderMatrix();
    const input = screen.getByTestId("years-filter");
    const t0 = performance.now();
    fireEvent.change(input, { target: { value: "0601101E" } });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
    expect(document.querySelectorAll("tr[data-program-row]")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "" } });
    expect(document.querySelectorAll("tr[data-program-row]")).toHaveLength(3);
  });

  it("the sort header still cycles desc → asc → grouped from the default", async () => {
    await renderMatrix();
    const pes = () =>
      [...document.querySelectorAll("tr[data-program-row]")].map((tr) =>
        tr.getAttribute("data-pe"),
      );
    const header = () =>
      document.querySelector('[data-sort="fy_2026_total"]') as HTMLElement;

    // Opens on desc (§P2-2) — the state the first click used to produce.
    expect(pes()).toEqual(["0601101E", "0602702E", "0603882C"]);
    expect(document.querySelectorAll("tr[data-org-row]")).toHaveLength(0);

    // Click 1 → asc, missing still last.
    fireEvent.click(header());
    expect(pes()).toEqual(["0602702E", "0601101E", "0603882C"]);
    expect(
      document
        .querySelector('th[data-col="fy_2026_total"]')
        ?.getAttribute("aria-sort"),
    ).toBe("ascending");

    // Click 2 → sort cleared, back to the grouped view.
    fireEvent.click(header());
    expect(
      document.querySelectorAll("tr[data-org-row]").length,
    ).toBeGreaterThan(0);

    // Click 3 → desc again: the three-state cycle is intact.
    fireEvent.click(header());
    expect(pes()).toEqual(["0601101E", "0602702E", "0603882C"]);
    expect(document.querySelectorAll("tr[data-org-row]")).toHaveLength(0);
  });

  it("sorting a DIFFERENT column re-sorts from the default, missing-last", async () => {
    await renderMatrix();
    fireEvent.click(
      document.querySelector('[data-sort="fy_2024_actuals"]') as HTMLElement,
    );
    const pes = [...document.querySelectorAll("tr[data-program-row]")].map(
      (tr) => tr.getAttribute("data-pe"),
    );
    // 100000 · 75000 · 50000 — every row has an FY24 actual in the fixture.
    expect(pes).toEqual(["0601101E", "0603882C", "0602702E"]);
  });

  it("CSV export matches the current visible view", async () => {
    let capturedBlob: Blob | null = null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((b: Blob) => {
        capturedBlob = b;
        return "blob:test";
      }),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await renderMatrix();
    // Filter to one program, then export
    fireEvent.change(screen.getByTestId("years-filter"), {
      target: { value: "Tactical" },
    });
    fireEvent.click(screen.getByTestId("years-csv"));

    expect(capturedBlob).not.toBeNull();
    const text = await capturedBlob!.text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2); // header + the one visible program
    expect(lines[1]).toContain("0602702E");

    clickSpy.mockRestore();
  });

  it("column picker toggles columns beyond the default set", async () => {
    await renderMatrix();
    // fy_2025_total is a default column → visible
    expect(
      document.querySelector('th[data-col="fy_2025_total"]'),
    ).not.toBeNull();
    // Toggle it off via the picker
    fireEvent.click(
      screen.getByRole("button", { name: /hide fy2025 total column/i }),
    );
    expect(document.querySelector('th[data-col="fy_2025_total"]')).toBeNull();
  });

  it("fetch failure surfaces an explicit degraded state", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("down")));
    render(<YearsMatrix />);
    await waitFor(() => {
      expect(
        document.querySelector('[data-degraded="years-matrix"]'),
      ).toBeInTheDocument();
    });
  });
});

// ── Phase 5E — decade columns (edition-honest defaults) ──────────────────────

describe("YearsMatrix — decade view (Phase 5E)", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url) === "/json/years_matrix.json") {
        return Promise.resolve(jsonResponse(MATRIX_DECADE));
      }
      return Promise.reject(new Error(`unmocked fetch ${url}`));
    });
  });

  it("default columns come from decade_default_columns", async () => {
    await renderMatrix();
    for (const key of MATRIX_DECADE.decade_default_columns!) {
      expect(document.querySelector(`th[data-col="${key}"]`)).not.toBeNull();
    }
    // PB2026-detail columns are NOT default in the decade view…
    expect(document.querySelector('th[data-col="fy_2024_actuals"]')).toBeNull();
    // …but non-default decade alternates aren't either
    expect(document.querySelector('th[data-col="fy2020e"]')).toBeNull();
  });

  // Tri-persona review Wave 2 — the qualifier a reader can see.
  it("renders the † mark, the footnote, and per-cell data-measure", async () => {
    await renderMatrix();
    // uniform qualified column: the token is on the column
    const uniform = document.querySelector('th[data-col="fy2015a"]') as HTMLElement;
    expect(uniform.getAttribute("data-qualified")).toBe("true");
    expect(uniform.getAttribute("data-measures")).toBe("actuals-base-oco");
    expect(uniform.textContent).toContain("†");
    // mixed qualified column
    const mixed = document.querySelector('th[data-col="fy2025e"]') as HTMLElement;
    expect(mixed.getAttribute("data-measures")).toBe("enacted enacted-total");
    expect(mixed.textContent).toContain("†");
    // an unqualified column must NOT fly the mark
    const plain = document.querySelector('th[data-col="fy2026r"]') as HTMLElement;
    expect(plain.getAttribute("data-qualified")).toBeNull();
    expect(plain.textContent).not.toContain("†");

    const note = document.querySelector(
      '[data-testid="measure-qualifier-legend"]',
    ) as HTMLElement;
    expect(note.textContent).toContain("FY2015A (PB2017) — actuals (base + OCO)");
    expect(note.textContent).toContain(
      "FY2025E (PB2026) — enacted (book total) on some lines",
    );

    // The cell's own machine label — the attribute gate 23 groups figures on.
    const cell = document.querySelector(
      'tr[data-pe="0601101E"] td[data-col="fy2015a"] [data-measure]',
    ) as HTMLElement;
    expect(cell.getAttribute("data-measure")).toBe("actuals-base-oco");
    const mixedCell = document.querySelector(
      'tr[data-pe="0601101E"] td[data-col="fy2025e"] [data-measure]',
    ) as HTMLElement;
    expect(mixedCell.getAttribute("data-measure")).toBe("enacted-total");
  });

  it("decade column headers carry the fiscal year and an edition tag", async () => {
    await renderMatrix();
    const th = document.querySelector('th[data-col="fy2020a"]') as HTMLElement;
    expect(th.textContent).toContain("FY2020A");
    expect(th.textContent).toContain("PB2022");
    expect(th.getAttribute("data-edition")).toBe("2022");
  });

  it("renders the edition-rule legend linking to the methodology anchor", async () => {
    await renderMatrix();
    const legend = document.querySelector(
      '[data-testid="edition-legend"]',
    ) as HTMLElement;
    expect(legend).not.toBeNull();
    expect(legend.textContent).toMatch(/actuals for FY N come from the PB\(N\+2\) book/i);
    expect(legend.textContent).toMatch(/each column states its edition/i);
    // next/link may normalize the trailing slash before the hash — the
    // contract is the methodology anchor target.
    const link = legend.querySelector('a[href$="#coverage-editions"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toMatch(/^\/methodology\/?#coverage-editions$/);
  });

  it("decade cells render as state-A Cites with dataset budget_lines_decade", async () => {
    await renderMatrix();
    const cell = document.querySelector(
      'tr[data-pe="0601101E"] td[data-col="fy2020a"]',
    ) as HTMLElement;
    expect(cell.getAttribute("data-v")).toBe("95000");
    const cite = cell.querySelector('[data-fact-id="dd00000000000002"]');
    expect(cite).not.toBeNull();
    expect(cite!.getAttribute("data-dataset")).toBe("budget_lines_decade");
  });

  it('absent decade cells render "—" with the not-in-edition tooltip', async () => {
    await renderMatrix();
    const cell = document.querySelector(
      'tr[data-pe="0602702E"] td[data-col="fy2015a"]',
    ) as HTMLElement;
    expect(cell.textContent).toBe("—no figure");
    expect(cell.getAttribute("data-cell-state")).toBe("absent");
    expect(cell.hasAttribute("data-v")).toBe(false);
    expect(cell.querySelector("[data-amount]")).toBeNull();
    expect(cell.getAttribute("title")).toBe("Not in the PB2017 edition");
  });

  it("sorting by a decade column works, missing-last", async () => {
    await renderMatrix();
    fireEvent.click(
      document.querySelector('[data-sort="fy2015a"]') as HTMLElement,
    );
    const pes = [...document.querySelectorAll("tr[data-program-row]")].map(
      (tr) => tr.getAttribute("data-pe"),
    );
    // only 0601101E has fy2015a — the others sort last in original order
    expect(pes[0]).toBe("0601101E");
  });

  it("CSV headers carry the per-column edition for decade columns", async () => {
    const entries = flattenPrograms(MATRIX_DECADE);
    const csv = buildYearsCsv(
      entries,
      ["fy2020a", "fy2026r", "fy_2026_total"],
      MATRIX_DECADE.decade_columns,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("fy2020a_pb2022_usd_millions");
    expect(lines[0]).toContain("fy2026r_pb2026_usd_millions");
    expect(lines[0]).toContain("fy_2026_total_usd_millions");
    // 95000 thousands → 95.000 millions
    expect(lines[1]).toContain("95.000");
    // gap → empty field, never 0: 0603882C has no decade cells at all
    const mdaRow = lines[3].split(",");
    const colIdx = lines[0]
      .split(",")
      .findIndex((h) => h.includes("fy2020a"));
    expect(mdaRow[colIdx]).toBe("");
  });

  // ── Tri-persona review Wave 2: the measure qualifier ─────────────────────
  //
  // FY2024 "Enacted" on /years/ is column K of the PB2025 R-1 workbook,
  // headed "FY 2024 PB Request with CR Amounts*". The grid published a bare
  // "enacted" on the header, the cell's data-measure and the CSV field name,
  // on the one surface built for cross-program "asked vs got" work.

  it("decadeCellMeasure prefers the cell's own token, then the column's", () => {
    const uniform = MATRIX_DECADE.decade_columns!.find((c) => c.key === "fy2020e")!;
    const mixed = MATRIX_DECADE.decade_columns!.find((c) => c.key === "fy2025e")!;
    const plain = MATRIX_DECADE.decade_columns!.find((c) => c.key === "fy2026r")!;
    // uniform column: the token lives on the column, cells carry no `m`
    expect(decadeCellMeasure(uniform, { v: 1 })).toBe("enacted-request");
    // mixed column: a cell without `m` falls back to the KIND, not to one of
    // the two tokens — picking either would be a guess
    expect(decadeCellMeasure(mixed, { v: 1 })).toBe("enacted");
    expect(decadeCellMeasure(mixed, { v: 1, m: "enacted-total" })).toBe("enacted-total");
    // unqualified column is unchanged
    expect(decadeCellMeasure(plain, { v: 1 })).toBe("request");
  });

  it("decadeColumnQualified is true only where a token differs from the kind", () => {
    const byKey = new Map(MATRIX_DECADE.decade_columns!.map((c) => [c.key, c]));
    expect(decadeColumnQualified(byKey.get("fy2020e")!)).toBe(true);
    expect(decadeColumnQualified(byKey.get("fy2025e")!)).toBe(true);
    expect(decadeColumnQualified(byKey.get("fy2015a")!)).toBe(true);
    // a column with no `measures` at all is never qualified
    expect(decadeColumnQualified(byKey.get("fy2026r")!)).toBe(false);
    expect(decadeColumnQualified(byKey.get("fy2020a")!)).toBe(false);
  });

  it("decadeQualifierSummary groups columns that share a qualifier", () => {
    const byKey = new Map(MATRIX_DECADE.decade_columns!.map((c) => [c.key, c]));
    // Six of the thirty real decade columns can be visible at once and share
    // one phrase; one line per column would be five repetitions a reader
    // skips, which is how a qualifier stops qualifying anything. The shape
    // below is the shipped default view's, in miniature.
    expect(
      decadeQualifierSummary([
        { key: "fy2015a", fy: 2015, kind: "actuals", edition: 2017, measures: ["actuals-base-oco"] },
        { key: "fy2016a", fy: 2016, kind: "actuals", edition: 2018, measures: ["actuals-base-oco"] },
        { key: "fy2024e", fy: 2024, kind: "enacted", edition: 2025, measures: ["enacted-request"] },
      ]),
    ).toBe(
      "FY2015A (PB2017), FY2016A (PB2018) — actuals (base + OCO). " +
        "FY2024E (PB2025) — enacted (request column)",
    );
    // an unqualified column contributes nothing
    expect(decadeQualifierSummary([byKey.get("fy2026r")!])).toBe("");
  });

  it("decadeQualifierNote names the column and what it actually reports", () => {
    const byKey = new Map(MATRIX_DECADE.decade_columns!.map((c) => [c.key, c]));
    expect(decadeQualifierNote(byKey.get("fy2020e")!)).toBe(
      "FY2020E (PB2021): enacted (request column)",
    );
    // mixed: only the DIVERGENT token is named, and the note says it is
    // partial rather than implying the whole column
    expect(decadeQualifierNote(byKey.get("fy2025e")!)).toBe(
      "FY2025E (PB2026): enacted (book total) on some lines",
    );
  });

  it("CSV headers carry the measure qualifier for a qualified column", () => {
    const entries = flattenPrograms(MATRIX_DECADE);
    const csv = buildYearsCsv(
      entries,
      ["fy2020a", "fy2020e", "fy2025e"],
      MATRIX_DECADE.decade_columns,
    );
    const header = csv.trim().split("\n")[0];
    // unqualified column keeps its exact pre-existing field name
    expect(header).toContain("fy2020a_pb2022_usd_millions");
    // qualified columns say what they are, so a downstream script inherits it
    expect(header).toContain("fy2020e_pb2021_enacted_request_usd_millions");
    expect(header).toContain("fy2025e_pb2026_enacted_enacted_total_usd_millions");
    expect(header).not.toContain("fy2020e_pb2021_usd_millions");
  });

  it("column picker groups decade and PB2026-detail columns", async () => {
    await renderMatrix();
    const picker = document.querySelector(
      '[role="group"][aria-label="Choose visible columns"]',
    ) as HTMLElement;
    expect(picker.textContent).toContain("Decade");
    expect(picker.textContent).toContain("PB2026 detail");
    // Toggling a decade chip hides its column
    fireEvent.click(
      screen.getByRole("button", { name: /hide fy2020a column/i }),
    );
    expect(document.querySelector('th[data-col="fy2020a"]')).toBeNull();
    // The PB2026-detail chips still work
    fireEvent.click(
      screen.getByRole("button", { name: /show fy2025 total column/i }),
    );
    expect(document.querySelector('th[data-col="fy_2025_total"]')).not.toBeNull();
  });

  it("project sub-rows map PB2026-edition decade columns to project cells", async () => {
    await renderMatrix();
    fireEvent.click(document.querySelector("[data-expand]") as HTMLElement);
    // fy2026r (edition 2026) maps to the project fy2026 scenario cell — but
    // the fixture project has no fy2026 cell, so check fy2024a → fy2024.
    // First bring fy2024a into view via the picker.
    fireEvent.click(
      screen.getByRole("button", { name: /show fy2024a column/i }),
    );
    const projCell = document.querySelector(
      'tr[data-project-row] td[data-col="fy2024"]',
    );
    expect(projCell).not.toBeNull();
    expect(
      projCell!.querySelector('[data-fact-id="bb00000000000001"]'),
    ).not.toBeNull();
  });
});

// ── Program-lineage — family-thread affordance on the /years/ matrix ─────────
// A row whose PE belongs to a tracked lineage family gets a per-row signpost
// (data-family-badge) linking to that program's Lineage section. A lone PE
// gets none. family_id is a sparse, UI-only overlay: it is NOT a column, NOT
// a cell data-v, NOT in the CSV export (that keeps the yearsmatrix gate green).

const MATRIX_FAMILY: YearsMatrixData = {
  ...MATRIX,
  orgs: [
    {
      org: "DARPA",
      programs: [
        // Two programs in the SAME family (id 1) — NOT adjacent-dependent:
        // each row must carry its own badge (per-row, not a connector line).
        { ...MATRIX.orgs[0].programs[0], family_id: 1 },
        { ...MATRIX.orgs[0].programs[1] }, // lone PE — no family_id
      ],
    },
    {
      org: "MDA",
      programs: [
        // Second member of family 1, in a different org section (proves the
        // affordance is per-row and independent of row adjacency).
        { ...MATRIX.orgs[1].programs[0], family_id: 1 },
      ],
    },
  ],
};

describe("YearsMatrix — family-thread affordance (program-lineage)", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url) === "/json/years_matrix.json") {
        return Promise.resolve(jsonResponse(MATRIX_FAMILY));
      }
      return Promise.reject(new Error(`unmocked fetch ${url}`));
    });
  });

  it("family-member rows carry [data-family-badge]; lone rows do not", async () => {
    await renderMatrix();

    const famRow = document.querySelector(
      'tr[data-program-row][data-pe="0601101E"]',
    ) as HTMLElement;
    const famBadge = famRow.querySelector("[data-family-badge]") as HTMLElement;
    expect(famBadge).not.toBeNull();
    expect(famBadge.getAttribute("data-family-badge")).toBe("1");

    // Second family member lives in a different org section — still badged.
    const famRow2 = document.querySelector(
      'tr[data-program-row][data-pe="0603882C"]',
    ) as HTMLElement;
    expect(famRow2.querySelector("[data-family-badge]")).not.toBeNull();

    // The lone PE (no family_id) has NO badge.
    const loneRow = document.querySelector(
      'tr[data-program-row][data-pe="0602702E"]',
    ) as HTMLElement;
    expect(loneRow.querySelector("[data-family-badge]")).toBeNull();
  });

  it("badge is honest + accessible: it does not expose the opaque id as text", async () => {
    await renderMatrix();
    const badge = document.querySelector(
      'tr[data-pe="0601101E"] [data-family-badge]',
    ) as HTMLElement;
    // The user-facing label points at the Lineage section, never the raw id.
    const label = badge.getAttribute("aria-label") ?? badge.getAttribute("title") ?? "";
    expect(label.toLowerCase()).toContain("lineage");
    expect(badge.textContent).not.toContain("1");
  });

  it("family_id never leaks into the CSV export (not a column)", async () => {
    const entries = flattenPrograms(MATRIX_FAMILY);
    const csv = buildYearsCsv(entries, ["fy_2026_total"]);
    expect(csv).not.toContain("family_id");
    expect(csv).not.toContain("family");
  });
});

describe("§P2-7 — 0 vs <0.05 vs — are three different facts", () => {
  it("classifies a cell by its value in the DISPLAY unit", () => {
    expect(cellState(0)).toBe("zero");
    expect(cellState(0.012)).toBe("rounded-zero");
    expect(cellState(-0.012)).toBe("rounded-zero");
    expect(cellState(0.049999)).toBe("rounded-zero");
    expect(cellState(0.05)).toBe("value");
    expect(cellState(223.7)).toBe("value");
  });

  it("renders a true zero as 0 — never 0.0, which reads as a rounded value", () => {
    expect(fmtDisplayMillions(0)).toBe("0");
    expect(fmtDisplayMillions(-0)).toBe("0");
  });

  it("renders a rounded-down nonzero as its BOUND, with its sign", () => {
    expect(fmtDisplayMillions(0.012)).toBe("<0.05");
    expect(fmtDisplayMillions(0.049)).toBe("<0.05");
    expect(fmtDisplayMillions(-0.012)).toBe("−<0.05");
  });

  it("never collapses a real magnitude into the bound", () => {
    expect(fmtDisplayMillions(0.05)).toBe("0.1");
    expect(fmtDisplayMillions(223.719)).toBe("223.7");
    expect(fmtDisplayMillions(-1200.4)).toBe("-1,200.4");
  });

  it("applies the same three-way split to Δ and %Δ", () => {
    expect(fmtDelta(0)).toBe("0");
    expect(fmtDelta(12)).toBe("+<0.05");
    expect(fmtDelta(-12)).toBe("−<0.05");
    expect(fmtDelta(417_500)).toBe("+417.5");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(0.02)).toBe("+<0.05%");
    expect(fmtPct(-0.02)).toBe("−<0.05%");
    expect(fmtPct(-35.15)).toBe("−35.1%");
  });
});
