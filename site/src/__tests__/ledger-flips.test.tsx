/**
 * Uncited-ledger clearance flips.
 *
 * 1. DistrictTable — linkable-dollars cells render Cite state A
 *    ([data-fact-id]) when the sidecar carries total_linkable_fact_id, and
 *    honest state C ([data-uncited]) when it is null. Dataset attribute is
 *    fct_district_totals (#51 — the award-distinct headline model, not the
 *    per-program fct_district_programs it supersedes at this grain), never a
 *    hardcoded uncited span.
 * 2. DownloadCards — the "cited" badge is manifest-driven: a dataset shows
 *    the badge IFF it is off the uncited_datasets ledger, so badges flip
 *    automatically when a dataset gains a citation tier.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { DistrictTable } from "@/components/district-table";
import { DownloadCards } from "@/components/download-cards";
import type { DistrictIndexRow } from "@/lib/data";

function districtRow(overrides: Partial<DistrictIndexRow> = {}): DistrictIndexRow {
  return {
    pop_district: "VA-08",
    pop_state: "VA",
    program_count: 2,
    award_count: 2,
    total_cited_dollars: 70000000,
    total_cited_fact_id: "b".repeat(16),
    total_linkable_dollars: 70000000,
    total_linkable_fact_id: "a".repeat(16),
    ...overrides,
  };
}

describe("DistrictTable linkable dollars — Cite states", () => {
  it("renders state A with the sidecar fact_id and fct_district_totals dataset", () => {
    const { container } = render(
      <DistrictTable districts={[districtRow()]} />,
    );
    const el = container.querySelector("[data-amount]");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("data-fact-id", "a".repeat(16));
    expect(el).toHaveAttribute("data-dataset", "fct_district_totals");
    expect(el).not.toHaveAttribute("data-uncited");
  });

  it("renders honest state C when the fact_id is null", () => {
    const { container } = render(
      <DistrictTable
        districts={[districtRow({ total_linkable_fact_id: null })]}
      />,
    );
    const el = container.querySelector("[data-amount]");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("data-uncited", "true");
    expect(el).toHaveAttribute("data-dataset", "fct_district_totals");
    expect(el).not.toHaveAttribute("data-fact-id");
  });

  it("renders an em dash (no data-amount) for zero-dollar districts", () => {
    const { container } = render(
      <DistrictTable
        districts={[
          districtRow({ total_linkable_dollars: 0, total_linkable_fact_id: null }),
        ]}
      />,
    );
    expect(container.querySelector("[data-amount]")).toBeNull();
    expect(container.textContent).toContain("—");
  });
});

describe("DownloadCards — manifest-driven cited badges", () => {
  beforeEach(() => {
    // HEAD probe for the asset bundle — resolve ok so cards render enabled.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );
  });

  function cardFor(container: HTMLElement, name: string): HTMLElement {
    const nameEl = [...container.querySelectorAll("span")].find(
      (s) => s.textContent === name,
    );
    expect(nameEl, `card for ${name}`).toBeTruthy();
    return nameEl!.closest("div.rounded-lg") as HTMLElement;
  }

  it("shows the cited badge for a dataset OFF the ledger", () => {
    const { container } = render(
      <DownloadCards builtAt="2026-07-01T00:00:00Z" uncitedDatasets={[]} />,
    );
    for (const name of ["dim_geography", "fct_budget_to_awards", "dim_lobbyists"]) {
      const card = cardFor(container, name);
      expect(card.textContent, `${name} badge`).toContain("cited");
    }
  });

  it("hides the cited badge for a dataset ON the ledger", () => {
    const { container } = render(
      <DownloadCards
        builtAt="2026-07-01T00:00:00Z"
        uncitedDatasets={["dim_geography", "dim_lobbyists", "fct_budget_to_awards"]}
      />,
    );
    for (const name of ["dim_geography", "fct_budget_to_awards", "dim_lobbyists"]) {
      const card = cardFor(container, name);
      expect(card.textContent, `${name} badge`).not.toContain("cited");
    }
    // …while workbook-cited datasets keep theirs
    expect(cardFor(container, "budget_lines").textContent).toContain("cited");
  });
});
