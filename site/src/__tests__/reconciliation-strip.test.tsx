/**
 * ReconciliationStrip (PM Sprint 1 §P0-1; restructured in the visual-judge
 * fix round, M1) — the declared two-basis reconciliation under the Budget
 * Figures cards.
 *
 * Gate 23 leg a2 contract: figures sharing (entity, fy, measure) with
 * DIFFERENT values must sit inside a [data-reconciliation] ancestor — the
 * strip is that ancestor for its own two Cites.
 *
 * Visual-judge M1 contract:
 *   - ONE shared mechanism sentence (never repeated per year) carries the
 *     canonical-basis statement and the "advance procurement" explanation;
 *   - each entry renders a COMPACT per-year arithmetic row: both cited
 *     values as their own <Cite>, the difference as UNLABELED, $-less
 *     arithmetic (the bridge row is not parsed as a fact — no fabricated
 *     middle term, no uncited dollar figure);
 *   - the header claim matches what is shown ("reconciled below" + the
 *     arithmetic actually below).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ReconciliationStrip } from "@/components/reconciliation-strip";
import type { ReconciliationEntry } from "@/lib/data";

const CITED_ENTRY: ReconciliationEntry = {
  fy: 2024,
  measure: "actuals",
  toa: {
    v: 5565655.0,
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
  delta_thousands: 318585.0,
};

const ZERO_ENTRY: ReconciliationEntry = {
  fy: 2026,
  measure: "request",
  toa: {
    v: 202697.0,
    units: "USD thousands",
    fid: "5b532c52d3ebb4c2",
    public_id: "5b532c52",
    dataset: "budget_lines",
  },
  detail: {
    v: 0.0,
    units: "USD millions",
    fid: null,
    public_id: null,
    dataset: "jbook_details",
    scenario: "BudgetYearOne",
    xml_path: "LineItem[9]",
    resolution: "zero_amount",
  },
  delta_thousands: 202697.0,
};

describe("ReconciliationStrip", () => {
  it("renders nothing for an empty entry list", () => {
    const { container } = render(<ReconciliationStrip entries={[]} />);
    expect(container.querySelector("[data-reconciliation]")).toBeNull();
  });

  it("wraps both figures in a [data-reconciliation] ancestor", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY]} />,
    );
    const wrapper = container.querySelector("[data-reconciliation]");
    expect(wrapper).not.toBeNull();
    const amounts = wrapper!.querySelectorAll("[data-amount]");
    expect(amounts.length).toBe(2);
  });

  it("both figures carry full basis attributes for the same (fy, measure)", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY]} />,
    );
    const toa = container.querySelector('[data-basis="toa"]');
    const det = container.querySelector('[data-basis="jbook-detail"]');
    expect(toa).not.toBeNull();
    expect(det).not.toBeNull();
    for (const el of [toa!, det!]) {
      expect(el).toHaveAttribute("data-fy", "2024");
      expect(el).toHaveAttribute("data-measure", "actuals");
    }
    expect(toa!.textContent).toBe("$5.57B");
    expect(det!.textContent).toBe("$5.25B");
  });

  it("renders ONE shared mechanism sentence, not one per entry (M1)", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY, ZERO_ENTRY]} />,
    );
    const text = container.textContent!;
    const occurrences = text.split("The workbook TOA includes").length - 1;
    expect(occurrences).toBe(1);
    // Canonical-basis statement is part of the shared sentence.
    expect(text).toContain(
      "P-1/R-1 workbook total obligation authority (TOA) as the headline figure sitewide",
    );
  });

  it("header claim matches the content: two official figures, reconciled below", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY]} />,
    );
    const text = container.textContent!;
    expect(text).toContain("Two official figures, one label");
    expect(text).toContain("reconciled below");
    // The old bare "— reconciled" claim (no arithmetic shown) is gone.
    expect(text).not.toContain("one label — reconciled");
  });

  it("each entry renders a compact arithmetic row with an UNLABELED, $-less delta", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY, ZERO_ENTRY]} />,
    );
    const rows = container.querySelectorAll(
      '[data-testid="reconciliation-row"]',
    );
    expect(rows.length).toBe(2);
    const fy24 = rows[0].textContent!;
    // FY label + measure, both cited values, arithmetic tokens, the delta.
    expect(fy24).toContain("FY24 Actuals");
    expect(fy24).toContain("$5.57B");
    expect(fy24).toContain("$5.25B");
    expect(fy24).toContain("−");
    expect(fy24).toContain("= 318.6M");
    // HONESTY: the delta is not labeled "advance procurement" — the bridge
    // row is not parsed as a fact; only the shared mechanism sentence
    // explains the difference.
    expect(fy24).not.toContain("advance procurement");
    // HONESTY: the delta renders WITHOUT a currency symbol (it is not a
    // cited figure) — "318.6M" must not appear as "$318.6M".
    expect(fy24).not.toContain("$318.6M");
  });

  it("renders a fid-less zero root as a state-B (xml-path) cite", () => {
    const { container } = render(<ReconciliationStrip entries={[ZERO_ENTRY]} />);
    const det = container.querySelector('[data-basis="jbook-detail"]');
    expect(det).toHaveAttribute("data-citation-kind", "xml-path");
    expect(det).toHaveAttribute("data-xml-path", "LineItem[9]");
    expect(container.textContent).toContain("zero-dollar");
  });

  it("asserts no uncited dollar figure — every $ lives inside a [data-amount]", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY, ZERO_ENTRY]} />,
    );
    const total = (container.textContent!.match(/\$/g) ?? []).length;
    let inAmounts = 0;
    for (const el of container.querySelectorAll("[data-amount]")) {
      inAmounts += (el.textContent!.match(/\$/g) ?? []).length;
    }
    expect(total).toBe(inAmounts);
  });

  it("links the methodology page from the shared sentence", () => {
    const { container } = render(
      <ReconciliationStrip entries={[CITED_ENTRY]} />,
    );
    // next/link normalizes the trailing slash in the jsdom env
    const links = container.querySelectorAll('a[href^="/methodology"]');
    expect(links.length).toBe(1);
  });
});
