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
