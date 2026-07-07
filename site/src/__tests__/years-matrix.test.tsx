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
            fy2025e: { fid: "dd00000000000003", v: 200000 },
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
    { key: "fy2015a", fy: 2015, kind: "actuals", edition: 2017 },
    { key: "fy2020a", fy: 2020, kind: "actuals", edition: 2022 },
    { key: "fy2020e", fy: 2020, kind: "enacted", edition: 2021 },
    { key: "fy2024a", fy: 2024, kind: "actuals", edition: 2026 },
    { key: "fy2025e", fy: 2025, kind: "enacted", edition: 2026 },
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
    expect(legend.textContent).toContain("zero in source XML");
    expect(legend.textContent).toContain("uncited input (still counted)");
  });

  it("renders program rows with data-pe under collapsible org sections", async () => {
    await renderMatrix();
    const rows = document.querySelectorAll("tr[data-program-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("data-pe")).toBe("0601101E");
    // Org section headers present in grouped mode
    expect(screen.getByText("DARPA")).toBeInTheDocument();
    expect(screen.getByText("MDA")).toBeInTheDocument();
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

  it('null cells render "–" plain text: no data-amount, no data-v', async () => {
    await renderMatrix();
    const cell = document.querySelector(
      'tr[data-program-row][data-pe="0602702E"] td[data-col="fy_2025_total"]',
    ) as HTMLElement;
    expect(cell.textContent).toBe("–");
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

  it("sorting flattens the grouped view: global desc order, missing-last", async () => {
    await renderMatrix();
    fireEvent.click(
      document.querySelector('[data-sort="fy_2026_total"]') as HTMLElement,
    );
    const pes = [...document.querySelectorAll("tr[data-program-row]")].map(
      (tr) => tr.getAttribute("data-pe"),
    );
    expect(pes).toEqual(["0601101E", "0602702E", "0603882C"]);
    // Org section header rows are hidden in sorted (flat) mode
    expect(document.querySelectorAll("tr[data-org-row]")).toHaveLength(0);

    // Second click → asc, missing still last
    fireEvent.click(
      document.querySelector('[data-sort="fy_2026_total"]') as HTMLElement,
    );
    const pesAsc = [...document.querySelectorAll("tr[data-program-row]")].map(
      (tr) => tr.getAttribute("data-pe"),
    );
    expect(pesAsc).toEqual(["0602702E", "0601101E", "0603882C"]);
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

  it('absent decade cells render "–" with the not-in-edition tooltip', async () => {
    await renderMatrix();
    const cell = document.querySelector(
      'tr[data-pe="0602702E"] td[data-col="fy2015a"]',
    ) as HTMLElement;
    expect(cell.textContent).toBe("–");
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
