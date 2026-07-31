/**
 * ProgramFigures (PM Sprint 1 §P0-1/§P0-2) — the summary-union cards.
 *
 * Contracts under test:
 *  - cards render the UNION payload values with full basis attributes;
 *  - card labels are measure-accurate ("FY25 Enacted", not a hardcoded
 *    "FY25 Total");
 *  - absences render the honest reason label — machine-declared via
 *    [data-absence][data-fy][data-measure][data-absence-reason], text free
 *    of em/en dashes and "$" (gate 23 leg b2 bootstrap semantics);
 *  - reconciliation members carry data-reconciliation;
 *  - the reconciliation strip renders when entries exist.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import {
  ProgramFigures,
  ProgramTrajectoryCard,
  cardLabel,
} from "@/components/program-figures";
import type { ProgramRow, ProgramSummary, SummaryCard } from "@/lib/data";

const PROGRAM: ProgramRow = {
  award_count: 0,
  exhibit_family: "procurement",
  fully_reconciled: false,
  fy2024_actual_millions: 5247.07,
  fy2024_fact_id: "bb54b1658b2746cb",
  fy2024_xml_path: null,
  hhi: null,
  narrative_count: 0,
  org: "F",
  pe_bli: "ATA000",
  project_count: 0,
  title: "F-35",
  trajectory: null,
  trajectory_fact_ids: null,
};

function card(overrides: Partial<SummaryCard>): SummaryCard {
  return {
    key: "fy2024",
    fy: 2024,
    measure: "actuals",
    basis: "toa",
    value: 5565655,
    units: "USD thousands",
    fid: "5b532c52d3ebb4c2",
    public_id: "5b532c52",
    dataset: "fct_decade_series",
    edition: 2026,
    absence_reason: null,
    ...overrides,
  };
}

const SUMMARY: ProgramSummary = {
  edition: 2026,
  basis_preference: "toa",
  cards: [
    card({}),
    card({
      key: "fy2025",
      fy: 2025,
      measure: "enacted",
      value: 4972514,
      fid: "2503ccee43cd0c8f",
      public_id: "2503ccee",
    }),
    card({
      key: "fy2026",
      fy: 2026,
      measure: "request",
      value: null,
      units: null,
      basis: null,
      fid: null,
      public_id: null,
      dataset: null,
      absence_reason: "not-published",
    }),
    card({
      key: "change",
      fy: 2026,
      measure: "change",
      value: null,
      units: null,
      basis: null,
      fid: null,
      public_id: null,
      dataset: null,
      absence_reason: "no-comparison",
    }),
  ],
  reconciliation: [
    {
      fy: 2024,
      measure: "actuals",
      toa: {
        v: 5565655,
        units: "USD thousands",
        fid: "5b532c52d3ebb4c2",
        public_id: "5b532c52",
        dataset: "fct_decade_series",
      },
      detail: {
        v: 5247.07,
        units: "USD millions",
        fid: "bb54b1658b2746cb",
        public_id: "bb54b165",
        dataset: "jbook_details",
        scenario: "PriorYear",
      },
      delta_thousands: 318585,
    },
  ],
  named_primes: [],
};

describe("ProgramFigures — summary union cards", () => {
  it("renders the union values with basis attributes + chip", () => {
    const { container } = render(
      <ProgramFigures program={PROGRAM} summary={SUMMARY} />,
    );
    const fy24 = container.querySelector(
      '[data-fact-id="5b532c52d3ebb4c2"][data-fy="2024"]',
    );
    expect(fy24).not.toBeNull();
    expect(fy24).toHaveAttribute("data-basis", "toa");
    expect(fy24).toHaveAttribute("data-measure", "actuals");
    expect(fy24!.textContent).toBe("$5.57B");
    expect(container.textContent).toContain("P-1 TOA · PB2026");
  });

  it("labels the cards by their MEASURE (FY25 Enacted, never a hardcoded Total)", () => {
    expect(cardLabel(card({ key: "fy2025", fy: 2025, measure: "enacted" }))).toBe(
      "FY25 Enacted",
    );
    expect(cardLabel(card({ key: "fy2025", fy: 2025, measure: "total" }))).toBe(
      "FY25 Total",
    );
    const { container } = render(
      <ProgramFigures program={PROGRAM} summary={SUMMARY} />,
    );
    expect(container.textContent).toContain("FY25 Enacted");
  });

  it("renders honest machine-declared absences — no bare dash, no $ in the label", () => {
    const { container } = render(
      <ProgramFigures program={PROGRAM} summary={SUMMARY} />,
    );
    const absences = container.querySelectorAll("[data-absence]");
    expect(absences.length).toBe(2);
    const fy26 = container.querySelector(
      '[data-absence][data-fy="2026"][data-measure="request"]',
    )!;
    expect(fy26).toHaveAttribute("data-absence-reason", "not-published");
    expect(fy26.textContent).toContain("Not in the FY2026 J-books");
    for (const el of absences) {
      expect(el.textContent).not.toMatch(/[—–$]/);
    }
  });

  it("marks reconciliation members and renders the strip", () => {
    const { container } = render(
      <ProgramFigures program={PROGRAM} summary={SUMMARY} />,
    );
    const fy24 = container.querySelector('[data-fact-id="5b532c52d3ebb4c2"]');
    expect(fy24).toHaveAttribute("data-reconciliation");
    expect(
      container.querySelector('[data-testid="reconciliation-strip"]'),
    ).not.toBeNull();
    // the fy25 card is NOT a reconciliation member
    const fy25 = container.querySelector('[data-fact-id="2503ccee43cd0c8f"]');
    expect(fy25).not.toHaveAttribute("data-reconciliation");
  });
});

// ── Trajectory spark provenance caption (visual-judge M7) ────────────────────
//
// Uniform basis+edition across the series → ONE caption line carries the
// provenance and the per-figure chips drop (the decade grid's dense-cell
// idiom). Mixed provenance → per-figure chips remain, no series caption.

describe("ProgramTrajectoryCard — spark provenance caption", () => {
  it("renders ONE shared caption (not three identical chips) when provenance is uniform", () => {
    const { container } = render(
      <ProgramTrajectoryCard program={PROGRAM} summary={SUMMARY} />,
    );
    const caption = container.querySelector(
      '[data-testid="spark-provenance"]',
    );
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toContain("P-1 TOA · PB2026");
    // The chip text appears exactly ONCE in the whole card — the caption.
    const occurrences =
      container.textContent!.split("P-1 TOA · PB2026").length - 1;
    expect(occurrences).toBe(1);
  });

  it("keeps per-figure chips (no series caption) when bases differ within the series", () => {
    const mixed: ProgramSummary = {
      ...SUMMARY,
      cards: [
        SUMMARY.cards[0],
        {
          ...SUMMARY.cards[1],
          basis: "jbook-detail",
          units: "USD millions",
          value: 4489.93,
          dataset: "jbook_details",
        },
        SUMMARY.cards[2],
        SUMMARY.cards[3],
      ],
    };
    const { container } = render(
      <ProgramTrajectoryCard program={PROGRAM} summary={mixed} />,
    );
    expect(
      container.querySelector('[data-testid="spark-provenance"]'),
    ).toBeNull();
    expect(container.textContent).toContain("P-1 TOA · PB2026");
    expect(container.textContent).toContain("P-40 detail · PB2026");
  });
});
