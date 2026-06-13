/**
 * Tests for Task 8a — category hero animations.
 *
 * Recon §H / plan constraints, asserted per motif:
 *   - SVG carries a <desc> and NEVER a <title> (hydration trap).
 *   - ≤24 animated nodes (elements with a hero animation class).
 *   - 'default' (FlowHero) is the STATIC motif — zero animation classes.
 *   - CategoryHero wrapper is decorative (aria-hidden, pointer-events off)
 *     and tags its category for the Task 9 animation gate.
 *   - ProgramHeader renders the hero ONLY when a category is passed
 *     (non-top-50 pages stay byte-identical in structure).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { CategoryHero } from "@/components/hero";
import { FlowHero } from "@/components/hero/flow";
import { ProgramHeader } from "@/components/program-header";
import type { HeroCategory, ProgramRow } from "@/lib/data";

const ANIMATED_SELECTOR = [
  ".hero-swarm-dot",
  ".hero-streak",
  ".hero-star",
  ".hero-wave",
  ".hero-net-node",
].join(", ");

const CATEGORIES: HeroCategory[] = [
  "drones",
  "hypersonics",
  "space",
  "shipbuilding",
  "cyber",
  "default",
];

describe("CategoryHero motifs", () => {
  for (const category of CATEGORIES) {
    describe(category, () => {
      it("renders an SVG with <desc> and no <title>", () => {
        const { container } = render(<CategoryHero category={category} />);
        const svg = container.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg!.querySelector("desc")).not.toBeNull();
        expect(svg!.querySelector("title")).toBeNull();
      });

      it("keeps animated nodes ≤ 24", () => {
        const { container } = render(<CategoryHero category={category} />);
        const animated = container.querySelectorAll(ANIMATED_SELECTOR);
        expect(animated.length).toBeLessThanOrEqual(24);
      });

      it("is a decorative, category-tagged background layer", () => {
        const { container } = render(<CategoryHero category={category} />);
        const wrapper = container.querySelector(".hero-anim");
        expect(wrapper).not.toBeNull();
        expect(wrapper).toHaveAttribute("aria-hidden", "true");
        expect(wrapper).toHaveAttribute("data-hero-category", category);
      });
    });
  }

  it("animated motifs have at least one animated node", () => {
    for (const category of CATEGORIES.filter((c) => c !== "default")) {
      const { container } = render(<CategoryHero category={category} />);
      expect(
        container.querySelectorAll(ANIMATED_SELECTOR).length,
      ).toBeGreaterThan(0);
    }
  });

  it("'default' (FlowHero) is fully static — zero animation classes", () => {
    const { container } = render(<FlowHero />);
    expect(container.querySelectorAll(ANIMATED_SELECTOR).length).toBe(0);
    expect(container.querySelectorAll('[class*="hero-"]').length).toBe(0);
  });
});

// ── ProgramHeader integration ────────────────────────────────────────────────

const PROGRAM: ProgramRow = {
  award_count: 0,
  exhibit_family: "rdte",
  fully_reconciled: true,
  fy2024_actual_millions: 100,
  fy2024_fact_id: null,
  fy2024_xml_path: null,
  hhi: null,
  narrative_count: 1,
  org: "DARPA",
  pe_bli: "0603183D8Z",
  project_count: 1,
  title: "Joint Hypersonics Transition Office",
  trajectory: null,
  trajectory_fact_ids: null,
};

describe("ProgramHeader hero wiring", () => {
  it("renders the hero layer when a category is passed (top-50)", () => {
    const { container } = render(
      <ProgramHeader program={PROGRAM} category="hypersonics" />,
    );
    const hero = container.querySelector(".hero-anim");
    expect(hero).not.toBeNull();
    expect(hero).toHaveAttribute("data-hero-category", "hypersonics");
  });

  it("renders NO hero markup without a category (non-top-50 unchanged)", () => {
    const { container } = render(<ProgramHeader program={PROGRAM} />);
    expect(container.querySelector(".hero-anim")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
