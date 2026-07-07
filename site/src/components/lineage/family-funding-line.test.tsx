/**
 * Tests for <FamilyFundingLine> — the 1:1 family money line (Task 7).
 *
 * Contract:
 *   - one cited point per funding_line entry, each carrying its fid as a
 *     state-A Cite (data-fact-id).
 *   - the chain identities are shown in order.
 *   - has_split → an honest branch marker ("line shown for the 1:1 chain only").
 *   - NEVER renders a point for a PE that is not represented in funding_line.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { FamilyFundingLine } from "./family-funding-line";
import type { LineageFamily } from "@/lib/lineage";

const family: LineageFamily = {
  family_id: 6,
  chain: ["0602201F", "0602203F"],
  chain_head_title: "Aerospace Vehicle Technologies",
  funding_line: [
    { fy: 2024, v: 346135, fid: "e32f2488e7ecb682" },
    { fy: 2025, v: 344712, fid: "35adeab4a79b9a89" },
    { fy: 2026, v: 321059, fid: "bf242daa9213a7c2" },
  ],
  has_split: false,
};

const splitFamily: LineageFamily = {
  family_id: 4,
  chain: ["837300"],
  funding_line: [
    { fy: 2024, v: 113563, fid: "2c3bcac28b6306f9" },
    { fy: 2025, v: 60744, fid: "4c0c005988ecd63a" },
  ],
  has_split: true,
};

describe("FamilyFundingLine", () => {
  it("renders one cited point per funding_line entry, each carrying its fid", () => {
    const { container } = render(<FamilyFundingLine family={family} />);
    for (const p of family.funding_line) {
      const cite = container.querySelector(`[data-fact-id="${p.fid}"]`);
      expect(cite).not.toBeNull();
    }
    // exactly as many cited amounts as funding_line points
    const cites = container.querySelectorAll("[data-amount][data-fact-id]");
    expect(cites.length).toBe(family.funding_line.length);
  });

  it("each cited point is a state-A amount (data-amount + data-dataset)", () => {
    const { container } = render(<FamilyFundingLine family={family} />);
    const cite = container.querySelector(`[data-fact-id="${family.funding_line[0].fid}"]`);
    expect(cite).toHaveAttribute("data-amount");
    expect(cite).toHaveAttribute("data-dataset");
  });

  it("shows the chain identities in order", () => {
    const { container } = render(<FamilyFundingLine family={family} />);
    const text = container.textContent ?? "";
    const iFirst = text.indexOf("0602201F");
    const iSecond = text.indexOf("0602203F");
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThanOrEqual(0);
    expect(iFirst).toBeLessThan(iSecond);
  });

  it("labels the funding chain with the chain-head short title (self-describing)", () => {
    const { container } = render(<FamilyFundingLine family={family} />);
    const text = container.textContent ?? "";
    // The head title appears on the FUNDING CHAIN line so it is not a bare id.
    expect(text).toContain("Aerospace Vehicle Technologies");
    // …after the head id, in the chain summary (not appearing before the chain).
    expect(text.indexOf("Aerospace Vehicle Technologies")).toBeGreaterThan(
      text.indexOf("0602201F"),
    );
  });

  it("falls back to the bare chain when no chain_head_title is present", () => {
    const noTitle: LineageFamily = { ...family, chain_head_title: null };
    const { container } = render(<FamilyFundingLine family={noTitle} />);
    // Chain ids still render; no dangling em-dash tail.
    expect(container.textContent).toContain("0602201F");
    expect(container.textContent).not.toContain("Aerospace Vehicle Technologies");
  });

  it("shows each funding-line fiscal year", () => {
    const { container } = render(<FamilyFundingLine family={family} />);
    for (const p of family.funding_line) {
      expect(container.textContent).toContain(String(p.fy));
    }
  });

  it("renders a split/branch marker when has_split is true", () => {
    const { container } = render(<FamilyFundingLine family={splitFamily} />);
    const marker = container.querySelector('[data-has-split="true"]');
    expect(marker).not.toBeNull();
    expect(container.textContent?.toLowerCase()).toContain("branch");
  });

  it("renders NO split marker when has_split is false", () => {
    const { container } = render(<FamilyFundingLine family={family} />);
    expect(container.querySelector('[data-has-split="true"]')).toBeNull();
  });

  it("never renders a point for a PE absent from funding_line", () => {
    // A chain PE that carries no funding_line point must not mint an amount.
    const stray: LineageFamily = {
      family_id: 9,
      chain: ["0601111X", "0602222Y"],
      funding_line: [{ fy: 2026, v: 1000, fid: "onlyfid0000abcd" }],
      has_split: false,
    };
    const { container } = render(<FamilyFundingLine family={stray} />);
    const cites = container.querySelectorAll("[data-amount][data-fact-id]");
    // exactly one point (funding_line has one entry) — NOT one per chain PE
    expect(cites.length).toBe(1);
    expect(container.querySelector('[data-fact-id="onlyfid0000abcd"]')).not.toBeNull();
  });
});
