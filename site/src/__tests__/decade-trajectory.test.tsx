/**
 * Phase 5E Task 7 — program-page decade trajectory.
 *
 * Contracts (spec §4 + honesty rules §2):
 *   - [data-testid="decade-trajectory"] renders when a decade_series exists;
 *     null series renders nothing.
 *   - The actuals line NEVER interpolates across edition gaps: contiguous
 *     FY runs become separate [data-decade-line] polylines; isolated points
 *     render as markers only.
 *   - Every point is citable: the value grid Cite-wraps each point on its
 *     own fid (dataset budget_lines_decade); gap cells inside a kind's
 *     eligible FY window render "–" with the not-in-edition tooltip.
 *   - The asked-vs-spent line renders only when book_diff is present AND
 *     both side points resolve from the series; the delta cites the minted
 *     book_diff fid (dataset fct_book_diff).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import { axisLabelYears, DecadeTrajectory } from "@/components/decade-trajectory";
import type { DecadeSeries, ProgramBookDiff } from "@/lib/data";

const SERIES: DecadeSeries = {
  actuals: [
    { fy: 2015, v: 90000, fid: "aa00000000000001", edition: 2017, basis: "toa", measure: "actuals" },
    { fy: 2016, v: 95000, fid: "aa00000000000002", edition: 2018, basis: "toa", measure: "actuals" },
    // FY2017 gap — the PE is not in the PB2019 edition
    { fy: 2018, v: 99000, fid: "aa00000000000003", edition: 2020, basis: "toa", measure: "actuals" },
    { fy: 2019, v: 101000, fid: "aa00000000000004", edition: 2021, basis: "toa", measure: "actuals" },
    // FY2020–FY2023 gap, FY2024 isolated point
    { fy: 2024, v: 120000, fid: "aa00000000000005", edition: 2026, basis: "toa", measure: "actuals" },
  ],
  enacted: [{ fy: 2025, v: 130000, fid: "aa00000000000006", edition: 2026, basis: "toa", measure: "enacted" }],
  request: [
    { fy: 2019, v: 90000, fid: "aa00000000000007", edition: 2019, basis: "toa", measure: "request" },
    { fy: 2026, v: 140000, fid: "aa00000000000008", edition: 2026, basis: "toa", measure: "request" },
  ],
};

const BOOK_DIFF: ProgramBookDiff = {
  kind: "request_vs_actuals",
  fy: 2019,
  from_edition: 2019,
  to_edition: 2021,
  delta: 11000,
  fid: "bd00000000000001",
  basis: "toa",
  measure: "change",
  edition: 2026,
};

describe("DecadeTrajectory", () => {
  it("renders nothing when the series is absent", () => {
    const { container } = render(
      <DecadeTrajectory series={null} bookDiff={null} />,
    );
    expect(
      container.querySelector('[data-testid="decade-trajectory"]'),
    ).toBeNull();
  });

  it("splits the actuals line at edition gaps — never interpolates", () => {
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={null} />,
    );
    const spark = container.querySelector('[data-testid="decade-spark"]');
    expect(spark).not.toBeNull();
    // Runs: [2015,2016], [2018,2019], [2024] → 2 polylines (≥2 points each)
    const lines = container.querySelectorAll("[data-decade-line]");
    expect(lines).toHaveLength(2);
    // All 5 actuals points render as markers (isolated FY2024 included)
    const points = container.querySelectorAll(
      '[data-decade-point][data-kind="actuals"]',
    );
    expect(points).toHaveLength(5);
    // Enacted + request markers present too
    expect(
      container.querySelectorAll('[data-decade-point][data-kind="enacted"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-decade-point][data-kind="request"]'),
    ).toHaveLength(2);
  });

  it("every point is citable through the value grid (state-A Cite per fid)", () => {
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={null} />,
    );
    const grid = container.querySelector('[data-testid="decade-grid"]');
    expect(grid).not.toBeNull();
    const cite = grid!.querySelector('[data-fact-id="aa00000000000003"]');
    expect(cite).not.toBeNull();
    expect(cite!.getAttribute("data-dataset")).toBe("budget_lines_decade");
  });

  it('gap cells render "–" with the not-in-edition tooltip, never zeros', () => {
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={null} />,
    );
    const gapCell = container.querySelector(
      '[data-decade-cell="actuals-2017"]',
    ) as HTMLElement;
    expect(gapCell).not.toBeNull();
    expect(gapCell.textContent).toBe("–");
    expect(gapCell.getAttribute("title")).toBe("Not in the PB2019 edition");
    expect(gapCell.querySelector("[data-amount]")).toBeNull();
  });

  it("disambiguates blank (out-of-window) cells from in-window – gaps", () => {
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={null} />,
    );
    // FY2025 actuals would live in PB2027 — no loaded edition could carry
    // it → structurally blank, NOT a "–" gap.
    const blankCell = container.querySelector(
      '[data-decade-cell="actuals-2025"]',
    ) as HTMLElement;
    expect(blankCell).not.toBeNull();
    expect(blankCell.textContent).toBe("");
    // The one-line grid note makes the blank-vs-dash distinction decodable
    // without the methodology page.
    const note = container.querySelector(
      '[data-testid="decade-grid-note"]',
    ) as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("blank = series not published");
    expect(note.textContent).toContain("– = absent from that edition");
  });

  it("renders the asked-vs-spent line citing the book-diff fid", () => {
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={BOOK_DIFF} />,
    );
    const strip = container.querySelector(
      '[data-testid="asked-vs-spent"]',
    ) as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip.textContent).toContain("PB2019");
    expect(strip.textContent).toContain("PB2021");
    expect(strip.textContent).toContain("FY2019");
    // Delta cites the minted diff fact
    const delta = strip.querySelector('[data-fact-id="bd00000000000001"]');
    expect(delta).not.toBeNull();
    expect(delta!.getAttribute("data-dataset")).toBe("fct_book_diff");
    // Both sides cite their own edition's grains
    expect(
      strip.querySelector('[data-fact-id="aa00000000000007"]'),
    ).not.toBeNull();
    expect(
      strip.querySelector('[data-fact-id="aa00000000000004"]'),
    ).not.toBeNull();
  });

  it("suppresses the asked-vs-spent line when a side is missing from the series", () => {
    const bd: ProgramBookDiff = { ...BOOK_DIFF, fy: 2016, from_edition: 2016, to_edition: 2018 };
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={bd} />,
    );
    // No FY2016 request point exists → the claim would be uncitable → absent
    expect(
      container.querySelector('[data-testid="asked-vs-spent"]'),
    ).toBeNull();
  });

  it("the reveal animation is on motion tokens and reduced-motion-safe", () => {
    const { container } = render(
      <DecadeTrajectory series={SERIES} bookDiff={null} />,
    );
    // Class-based opacity animation defined in globals.css on
    // var(--motion-story) (compositor-only per the G7 motion gate) —
    // prefers-reduced-motion collapses tokens to 1ms (final frame).
    const line = container.querySelector("[data-decade-line]") as SVGElement;
    expect(line.getAttribute("class") ?? "").toContain("decade-draw");
  });
});

// ── X axis (ROADMAP backlog #41 remnant) ─────────────────────────────────────
//
// The axis labelled the first and last fiscal year only, at 8 viewBox units,
// on the site's most-repeated chart. Two labels a decade apart do not let a
// reader place a marker on a year.

describe("axisLabelYears", () => {
  const INNER_W = 324; // SVG_WIDTH 340 - 2 * PADDING 8

  const span = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it("always labels both ends", () => {
    for (const [from, to] of [
      [2015, 2026],
      [2022, 2026],
      [2025, 2026],
    ] as const) {
      const labels = axisLabelYears(span(from, to), INNER_W);
      expect(labels[0]).toBe(from);
      expect(labels[labels.length - 1]).toBe(to);
    }
  });

  it("labels more than the two ends across a decade", () => {
    const labels = axisLabelYears(span(2015, 2026), INNER_W);
    expect(labels.length).toBeGreaterThan(2);
    expect(labels).toContain(2020);
  });

  it("labels every year when the span is short enough to fit them", () => {
    expect(axisLabelYears(span(2022, 2026), INNER_W)).toEqual([
      2022, 2023, 2024, 2025, 2026,
    ]);
  });

  it("never places two labels closer than the collision pitch", () => {
    for (let to = 2018; to <= 2030; to++) {
      const fys = span(2015, to);
      const labels = axisLabelYears(fys, INNER_W);
      const perYear = INNER_W / (to - 2015);
      for (let i = 1; i < labels.length; i++) {
        expect(
          (labels[i] - labels[i - 1]) * perYear,
          `FY${labels[i - 1]}→FY${labels[i]} over ${fys.length} years`,
        ).toBeGreaterThanOrEqual(34);
      }
    }
  });

  it("handles a single-year program without dividing by zero", () => {
    expect(axisLabelYears([2026], INNER_W)).toEqual([2026]);
    expect(axisLabelYears([], INNER_W)).toEqual([]);
  });
});
