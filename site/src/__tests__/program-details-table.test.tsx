/**
 * ProgramDetailsTable — R-2/P-40 facts table THREE-STATE cite contract.
 *
 * Contract under test (Phase 5F §2a, hardened in 5G §5):
 *   - resolution 'unique' | 'ambiguous_first' → State A: data-fact-id present,
 *     NO data-citation-kind="xml-path" (the exporter emits a jbook_pdf citation
 *     for exactly these two).
 *   - resolution 'zero_amount' | 'unresolved'  → State B: data-citation-kind=
 *     "xml-path" + non-empty data-xml-path, NO data-fact-id (the exporter emits
 *     NO citation for either — a factId would orphan against citations.json and
 *     fail the render-static Cite contract). Navy's FY2026 books (5G) are the
 *     first corpus to surface 'unresolved' on full-tier pages.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import { ProgramDetailsTable } from "@/components/program-details-table";
import type { ProgramDetailRow } from "@/lib/data";

function row(overrides: Partial<ProgramDetailRow> = {}): ProgramDetailRow {
  return {
    amount_millions: 22.307,
    fact_id: "a8d6822466f8c3e9",
    project_number: "0001",
    project_title: "Test Project",
    resolution: "unique",
    scenario: "AllPriorYears",
    units: "USD millions",
    xml_path: "ProgramElement[205]/Project[2]",
    basis: "jbook-detail",
    fy: null,
    measure: "all-prior-years",
    edition: 2026,
    entity: "TESTPE/0001",
    ...overrides,
  };
}

/** The [data-amount] cell for a given fact amount, whatever cite state it is. */
function amountCell(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-amount]");
  if (!el) throw new Error("no [data-amount] rendered");
  return el as HTMLElement;
}

describe("ProgramDetailsTable — cite state by resolution", () => {
  it("renders State A (data-fact-id, no xml-path) for 'unique'", () => {
    const { container } = render(
      <ProgramDetailsTable details={[row({ resolution: "unique" })]} />,
    );
    const cell = amountCell(container);
    expect(cell.getAttribute("data-fact-id")).toBe("a8d6822466f8c3e9");
    expect(cell.getAttribute("data-citation-kind")).not.toBe("xml-path");
    expect(cell.hasAttribute("data-uncited")).toBe(false);
  });

  it("renders State A for 'ambiguous_first'", () => {
    const { container } = render(
      <ProgramDetailsTable details={[row({ resolution: "ambiguous_first" })]} />,
    );
    const cell = amountCell(container);
    expect(cell.getAttribute("data-fact-id")).toBe("a8d6822466f8c3e9");
  });

  it("renders State B (xml-path chip, NO fact-id) for 'zero_amount'", () => {
    const { container } = render(
      <ProgramDetailsTable details={[row({ resolution: "zero_amount" })]} />,
    );
    const cell = amountCell(container);
    expect(cell.getAttribute("data-citation-kind")).toBe("xml-path");
    expect(cell.getAttribute("data-xml-path")).toBe(
      "ProgramElement[205]/Project[2]",
    );
    expect(cell.hasAttribute("data-fact-id")).toBe(false);
  });

  it("renders State B (xml-path chip, NO fact-id) for 'unresolved' — the 5G Navy fix", () => {
    // Regression guard: before 5G, 'unresolved' fell through to State A and
    // orphaned (fact-id absent from citations.json) on every Navy full-tier
    // page. It must render as State B, exactly like 'zero_amount'.
    const { container } = render(
      <ProgramDetailsTable details={[row({ resolution: "unresolved" })]} />,
    );
    const cell = amountCell(container);
    expect(cell.getAttribute("data-citation-kind")).toBe("xml-path");
    expect(cell.getAttribute("data-xml-path")).toBe(
      "ProgramElement[205]/Project[2]",
    );
    expect(cell.hasAttribute("data-fact-id")).toBe(false);
  });
});
