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
    { fy: 2024, pe: "0602201F", v: 346135, fid: "e32f2488e7ecb682" },
    { fy: 2025, pe: "0602203F", v: 344712, fid: "35adeab4a79b9a89" },
    { fy: 2026, pe: "0602203F", v: 321059, fid: "bf242daa9213a7c2" },
  ],
  has_split: false,
};

const splitFamily: LineageFamily = {
  family_id: 4,
  chain: ["837300"],
  funding_line: [
    { fy: 2024, pe: "837300", v: 113563, fid: "2c3bcac28b6306f9" },
    { fy: 2025, pe: "837300", v: 60744, fid: "4c0c005988ecd63a" },
  ],
  has_split: true,
};

/**
 * Defect-2 coexistence shape (2026-07-28): FY2024 carries BOTH chain members'
 * cited points (realigned pairs coexist for whole decades). 100000 + 200000
 * thousands would render "$300.0M" if anything summed — the tests assert that
 * NEVER appears; each member's own value renders as its own labeled Cite.
 */
const coexistFamily: LineageFamily = {
  family_id: 9,
  chain: ["0602201F", "0602203F"],
  chain_head_title: "Aerospace Vehicle Technologies",
  funding_line: [
    { fy: 2024, pe: "0602201F", v: 100000, fid: "fidPRED2024aaaa" },
    { fy: 2024, pe: "0602203F", v: 200000, fid: "fidSUCC2024bbbb" },
    { fy: 2025, pe: "0602203F", v: 250000, fid: "fidSUCC2025cccc" },
  ],
  has_split: false,
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

  it("branch note covers BOTH directions — splits AND merges (fan-in honesty)", () => {
    // has_split now also fires for a many-to-one FAN-IN (Fix B, 2026-07-28):
    // the note's copy must not claim the branching is splits-only, or a merge
    // family's funding chain would carry a note describing the wrong shape.
    const { container } = render(<FamilyFundingLine family={splitFamily} />);
    const text =
      container.querySelector('[data-has-split="true"]')?.textContent?.toLowerCase() ?? "";
    expect(text).toContain("splits or merges");
    expect(text).toContain("1:1");
    expect(text).not.toContain("multiple successors"); // old splits-only wording
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
      funding_line: [{ fy: 2026, pe: "0601111X", v: 1000, fid: "onlyfid0000abcd" }],
      has_split: false,
    };
    const { container } = render(<FamilyFundingLine family={stray} />);
    const cites = container.querySelectorAll("[data-amount][data-fact-id]");
    // exactly one point (funding_line has one entry) — NOT one per chain PE
    expect(cites.length).toBe(1);
    expect(container.querySelector('[data-fact-id="onlyfid0000abcd"]')).not.toBeNull();
  });

  // ── Defect-2 coexistence rendering (2026-07-28) ─────────────────────────

  it("renders one Cite per member on a coexistence fy, each with its own fid", () => {
    const { container } = render(<FamilyFundingLine family={coexistFamily} />);
    // Every entry's fid renders as its own state-A Cite…
    for (const p of coexistFamily.funding_line) {
      const cite = container.querySelector(`[data-fact-id="${p.fid}"]`);
      expect(cite).not.toBeNull();
      expect(cite).toHaveAttribute("data-amount");
    }
    // …and exactly as many cited amounts as funding_line entries (3 — the
    // coexistence fy contributes TWO, never a single blended point).
    const cites = container.querySelectorAll("[data-amount][data-fact-id]");
    expect(cites.length).toBe(coexistFamily.funding_line.length);
  });

  it("labels each coexisting member's value with its PE code", () => {
    const { container } = render(<FamilyFundingLine family={coexistFamily} />);
    const multi = container.querySelector('[data-multi-member-fy="2024"]');
    expect(multi).not.toBeNull();
    const text = multi?.textContent ?? "";
    // Both members' codes label their own values inside the FY2024 group.
    expect(text).toContain("0602201F");
    expect(text).toContain("0602203F");
  });

  it("NEVER renders an arithmetic sum of coexisting members", () => {
    const { container } = render(<FamilyFundingLine family={coexistFamily} />);
    const text = container.textContent ?? "";
    // 100000 + 200000 USD thousands → "$300.0M" would be the old defect's
    // fabricated single number; each member renders its own cited value.
    expect(text).not.toContain("$300.0M");
    expect(text).toContain("$100.0M");
    expect(text).toContain("$200.0M");
  });

  it("renders a single-entry fy exactly as before (no member sub-labels)", () => {
    const { container } = render(<FamilyFundingLine family={coexistFamily} />);
    // FY2025 has one entry — no multi-member group wrapper for it.
    expect(container.querySelector('[data-multi-member-fy="2025"]')).toBeNull();
    const cite = container.querySelector('[data-fact-id="fidSUCC2025cccc"]');
    expect(cite).not.toBeNull();
  });
});
