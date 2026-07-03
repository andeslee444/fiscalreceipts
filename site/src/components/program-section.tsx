/**
 * Program page section skeleton (Phase 5F §2d).
 *
 * EVERY program page — full tier and rollup tier — renders the same ordered
 * sections, each wrapped in <section data-section={id}>. Sections without
 * data render the established quiet empty-state line (one muted sentence
 * that EXPLAINS the absence) — never silently absent.
 *
 * PROGRAM_SECTIONS is the canonical order. The program-skeleton gate
 * (scripts/gates/program-skeleton.mjs) recomputes this list independently
 * and asserts sampled pages from BOTH tiers render all markers in order.
 */

import type { ReactNode } from "react";

export const PROGRAM_SECTIONS = [
  "answer-strip",
  "figures",
  "trajectory",
  "description",
  "justification",
  "line-items",
  "follow-dollar",
  "awards",
  "lobbying",
  "oversight",
  "dossier",
  "sources",
] as const;

export type ProgramSectionId = (typeof PROGRAM_SECTIONS)[number];

export function ProgramSection({
  id,
  children,
  className,
}: {
  id: ProgramSectionId;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-section={id} className={className}>
      {children}
    </section>
  );
}

/**
 * Quiet empty-state line: one muted sentence explaining WHY the section has
 * nothing to show (the Phase 5C honesty pattern). data-section-empty is the
 * program-skeleton gate contract — the gate asserts a non-trivial
 * explanation on every empty section.
 */
export function SectionEmpty({
  title,
  children,
  className = "",
}: {
  /** Section heading kept visible so the skeleton reads consistently. */
  title: string;
  /** The explanation sentence(s) — may embed links. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-8 ${className}`}>
      <h2 className="text-lg font-semibold mb-2 text-foreground">{title}</h2>
      <p data-section-empty className="text-xs text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
