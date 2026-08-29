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
import type {
  Fy26Split,
  ProgramRow,
  ProgramSummary,
  SummaryCard,
} from "@/lib/data";

const PROGRAM: ProgramRow = {
  award_count: 0,
  exhibit_family: "procurement",
  fully_reconciled: false,
  reconciled_in_scope: false,
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
  slug: "ATA000",
  account: null,
  account_title: null,
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

// ── FY2026 discretionary/reconciliation split (backlog #50) ─────────────────
//
// Long Range Kill Chains, PE 1203154SF: fy_2025_enacted 244,121 / disc_request
// 1,916 / reconciliation_request 7,695,000 / fy_2026_total 7,696,916 — the
// headline reads "+3052.9%" on the combined basis and "-99.2%" on the
// like-for-like discretionary basis. Verified against build_fy26_split's own
// test fixture in tests/test_fy26_split.py.
const FY26_SPLIT: Fy26Split = {
  disc_k: 1916,
  recon_k: 7695000,
  total_k: 7696916,
  recon_share: 0.9997510691295058,
  disc_pct_change: -99.2,
  has_reconciliation: true,
  disc: {
    v: 1916,
    units: "USD thousands",
    fid: "07c454d28771d656",
    public_id: "07c454d2",
    dataset: "budget_lines",
    basis: "toa",
    fy: 2026,
    measure: "disc-request",
    edition: 2026,
  },
  reconciliation: {
    v: 7695000,
    units: "USD thousands",
    fid: "11020da183a1c682",
    public_id: "11020da1",
    dataset: "budget_lines",
    basis: "toa",
    fy: 2026,
    measure: "reconciliation-request",
    edition: 2026,
  },
};

const SUMMARY_WITH_FY26_TOTAL: ProgramSummary = {
  ...SUMMARY,
  cards: SUMMARY.cards.map((c) =>
    c.key === "fy2026"
      ? card({
          key: "fy2026",
          fy: 2026,
          measure: "request",
          value: 7696916,
          fid: "aaaaaaaaaaaaaaaa",
          public_id: "aaaaaaaa",
          dataset: "fct_budget_trajectory",
        })
      : c,
  ),
};

describe("ProgramFigures — FY2026 discretionary/reconciliation split (#50)", () => {
  it("renders no split note when the sidecar carries none", () => {
    const { container } = render(
      <ProgramFigures program={PROGRAM} summary={SUMMARY_WITH_FY26_TOTAL} />,
    );
    expect(container.querySelector("[data-fy26-recon-chip]")).toBeNull();
  });

  it("renders no split note for a pure-discretionary split (has_reconciliation false)", () => {
    const { container } = render(
      <ProgramFigures
        program={PROGRAM}
        summary={SUMMARY_WITH_FY26_TOTAL}
        fy26Split={{ ...FY26_SPLIT, recon_k: 0, has_reconciliation: false }}
      />,
    );
    expect(container.querySelector("[data-fy26-recon-chip]")).toBeNull();
  });

  it("renders the reconciliation chip, both cited addends, and the discretionary rate", () => {
    const { container } = render(
      <ProgramFigures
        program={PROGRAM}
        summary={SUMMARY_WITH_FY26_TOTAL}
        fy26Split={FY26_SPLIT}
      />,
    );
    const chip = container.querySelector("[data-fy26-recon-chip]");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("100.0% reconciliation");

    // Both addends are their OWN cited [data-amount] figures — never plain text.
    const disc = container.querySelector('[data-fact-id="07c454d28771d656"]');
    expect(disc).not.toBeNull();
    expect(disc).toHaveAttribute("data-basis", "toa");
    expect(disc).toHaveAttribute("data-fy", "2026");
    expect(disc).toHaveAttribute("data-measure", "disc-request");
    expect(disc!.textContent).toBe("$1.92M");

    const recon = container.querySelector('[data-fact-id="11020da183a1c682"]');
    expect(recon).not.toBeNull();
    expect(recon).toHaveAttribute("data-measure", "reconciliation-request");
    expect(recon!.textContent).toBe("$7.70B");

    // Not the +3052.9% combined rate — the discretionary-only, like-for-like
    // change vs FY2025 enacted (the number this task exists to surface).
    const pct = container.querySelector("[data-fy26-disc-pct-change]");
    expect(pct).not.toBeNull();
    expect(pct!.textContent).toContain("-99.2%");

    // The note is a scope disclosure, not a caution — gate 2's vocabulary.
    expect(container.querySelector('[data-note-kind="scope"]')).not.toBeNull();

    // The combined headline figure is UNCHANGED and still the fy2026 card's
    // own cited value — the split is additive, not a replacement.
    const headline = container.querySelector('[data-fact-id="aaaaaaaaaaaaaaaa"]');
    expect(headline!.textContent).toBe("$7.70B");
  });

  it("omits the discretionary-rate sentence when there is no FY2025 enacted to compare against", () => {
    const { container } = render(
      <ProgramFigures
        program={PROGRAM}
        summary={SUMMARY_WITH_FY26_TOTAL}
        fy26Split={{ ...FY26_SPLIT, disc_pct_change: null }}
      />,
    );
    expect(container.querySelector("[data-fy26-recon-chip]")).not.toBeNull();
    expect(container.querySelector("[data-fy26-disc-pct-change]")).toBeNull();
  });
});

describe("ProgramFigures — PB2026 renumber note (ROADMAP #32a)", () => {
  it("renders nothing when the sidecar carries no fy2026_absent flag", () => {
    const { container } = render(
      <ProgramFigures program={PROGRAM} summary={SUMMARY_WITH_FY26_TOTAL} />,
    );
    expect(container.querySelector("[data-fy2026-absent]")).toBeNull();
  });

  it("states the absence, its year, and the renumber context — and names no successor", () => {
    const { container } = render(
      <ProgramFigures
        program={PROGRAM}
        summary={SUMMARY}
        fy2026Absent={{
          last_fy: 2025,
          jbook_fy2026_zero: false,
          has_successor: false,
        }}
      />,
    );
    const note = container.querySelector("[data-fy2026-absent]");
    expect(note).not.toBeNull();
    const text = note!.textContent!.replace(/\s+/g, " ").trim();

    expect(text).toContain(
      "No FY2026 R-1/P-1 request line for this program element.",
    );
    expect(text).toContain("its last workbook figure is FY2025");
    expect(text).toContain("PB2026 renumbered program elements at scale");
    expect(text).toContain(
      "No ingested budget document in this corpus states a successor for this line.",
    );
    // A dollar figure in prose is an UNCITED figure. Gate 2 rejects any
    // currency pattern outside [data-amount], and the first cut of this
    // note shipped a literal "$0" on 50 pages.
    expect(text).not.toMatch(/\$\d/);

    // Absence in one edition is not an ending. These are the words the 87
    // withdrawn "zeroed out in FY2026" feed cards used.
    expect(text).not.toMatch(
      /\b(zeroed|defunded|cancell?ed|cancellation|terminat(ed|ion))\b/i,
    );

    // Scope disclosure, not a caution about a number (notes.tsx registers).
    expect(container.querySelector('[data-note-kind="scope"]')).not.toBeNull();
  });

  it("names the year the flag carries, not a hardcoded one", () => {
    const { container } = render(
      <ProgramFigures
        program={PROGRAM}
        summary={SUMMARY}
        fy2026Absent={{
          last_fy: 2024,
          jbook_fy2026_zero: false,
          has_successor: false,
        }}
      />,
    );
    const text = container
      .querySelector("[data-fy2026-absent]")!
      .textContent!.replace(/\s+/g, " ");
    expect(text).toContain("its last workbook figure is FY2024");
    expect(text).not.toContain("FY2025");
  });
});

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
