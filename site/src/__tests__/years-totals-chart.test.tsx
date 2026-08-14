/**
 * Sprint C Task C5 (ROADMAP #64) — /years/ "Budget over time" corpus chart.
 *
 * Contracts (see years-totals-chart.tsx's header comment for the honesty
 * rationale in full):
 *   - renders nothing when the payload carries no usable decade columns;
 *   - sums a BALANCED PANEL (programs with a figure in every default
 *     column) rather than every program with a figure that year — a program
 *     missing even one year must be excluded from EVERY column, not just
 *     the year it lacks, or the totals would compare different populations
 *     across the x-axis;
 *   - renders no literal "$" anywhere (gate 2's currency sweep would flag
 *     any dollar-pattern text outside a Cite-backed [data-amount], and this
 *     total is deliberately not Cite-wrapped — see the component's header
 *     comment for why).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import { YearsTotalsChart } from "@/components/years-totals-chart";
import type {
  DecadeColumn,
  ProgramEntry,
  YearsMatrixData,
} from "@/components/years-matrix";

const DECADE_COLUMNS: DecadeColumn[] = [
  { key: "fy2024a", fy: 2024, kind: "actuals", edition: 2026 },
  { key: "fy2025e", fy: 2025, kind: "enacted", edition: 2026 },
  { key: "fy2026r", fy: 2026, kind: "request", edition: 2026 },
];
const DECADE_DEFAULT_COLUMNS = ["fy2024a", "fy2025e", "fy2026r"];

function makeMatrix(overrides: Partial<YearsMatrixData> = {}): YearsMatrixData {
  return {
    schema_version: 1,
    program_units: "thousands",
    project_units: "millions",
    amount_types: [],
    default_columns: [],
    delta_columns: [],
    project_scenarios: {},
    decade_columns: DECADE_COLUMNS,
    decade_default_columns: DECADE_DEFAULT_COLUMNS,
    orgs: [],
    ...overrides,
  };
}

// P1 and P2 report a figure in every default column (the balanced panel);
// P3 only reports FY2026 — present in the corpus, but must be EXCLUDED from
// every column, not just averaged in where it has data (the coverage-growth
// trap the component's header comment describes).
const ENTRIES: ProgramEntry[] = [
  {
    org: "X",
    program: {
      pe_bli: "P1",
      title: "Program One",
      projects: [],
      cells: {
        fy2024a: { v: 100_000, fid: "aa01" },
        fy2025e: { v: 150_000, fid: "aa02" },
        fy2026r: { v: 200_000, fid: "aa03" },
      },
    },
  },
  {
    org: "X",
    program: {
      pe_bli: "P2",
      title: "Program Two",
      projects: [],
      cells: {
        fy2024a: { v: 50_000, fid: "bb01" },
        fy2025e: { v: 60_000, fid: "bb02" },
        fy2026r: { v: 70_000, fid: "bb03" },
      },
    },
  },
  {
    org: "X",
    program: {
      pe_bli: "P3",
      title: "Program Three (later ingestion — FY2026 only)",
      projects: [],
      cells: {
        fy2026r: { v: 999_000, fid: "cc01" },
      },
    },
  },
];

describe("YearsTotalsChart", () => {
  it("renders nothing when the payload has no decade default columns", () => {
    const matrix = makeMatrix({ decade_default_columns: [], decade_columns: [] });
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={ENTRIES} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no program has a figure in every default column", () => {
    const matrix = makeMatrix();
    const onlyP3: ProgramEntry[] = [ENTRIES[2]];
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={onlyP3} />);
    expect(container.firstChild).toBeNull();
  });

  it("sums only the balanced panel — P3 (partial coverage) is excluded from EVERY column", () => {
    const matrix = makeMatrix();
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={ENTRIES} />);

    const fig = container.querySelector('[data-chart="years-totals"]');
    expect(fig).not.toBeNull();

    // One point per default column (3), never 999_000 (P3's value) folded in.
    const points = container.querySelectorAll("[data-totals-point]");
    expect(points).toHaveLength(3);

    // fy2024a total = 100,000 + 50,000 = 150,000 (thousands) = 150.0 millions.
    const fy2024Cell = container.querySelector('[data-totals-cell="fy2024a"]');
    expect(fy2024Cell?.textContent).toBe("150.0");
    // fy2025e = 150,000 + 60,000 = 210,000 -> 210.0
    expect(container.querySelector('[data-totals-cell="fy2025e"]')?.textContent).toBe(
      "210.0",
    );
    // fy2026r (panel-only) = 200,000 + 70,000 = 270,000 -> 270.0, NOT
    // 200,000+70,000+999,000 — P3 never enters the sum even in the one
    // column it reports.
    expect(container.querySelector('[data-totals-cell="fy2026r"]')?.textContent).toBe(
      "270.0",
    );
  });

  it("discloses the balanced-panel size (2 of 3 programs)", () => {
    const matrix = makeMatrix();
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={ENTRIES} />);
    const note = container.querySelector('[data-testid="years-totals-note"]');
    expect(note?.textContent).toContain("2");
    expect(note?.textContent).toContain("3");
    expect(note?.textContent).toMatch(/67%/);
  });

  it("never renders a literal currency sign anywhere (gate 2's currency sweep)", () => {
    const matrix = makeMatrix();
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={ENTRIES} />);
    expect(container.textContent).not.toContain("$");
  });

  it("does not wrap the total in [data-amount] — no single fact backs a corpus sum", () => {
    const matrix = makeMatrix();
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={ENTRIES} />);
    expect(container.querySelectorAll("[data-amount]")).toHaveLength(0);
  });

  it("carries the ChartFigure contract: named svg, description, table with caption", () => {
    const matrix = makeMatrix();
    const { container } = render(<YearsTotalsChart matrix={matrix} entries={ENTRIES} />);

    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(10);
    expect(svg?.getAttribute("aria-describedby")).toBe("chart-desc-years-totals");

    const desc = container.querySelector("[data-chart-desc]");
    expect(desc?.textContent?.length ?? 0).toBeGreaterThan(60);

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")?.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});
