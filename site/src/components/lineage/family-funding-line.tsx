"use client";

/**
 * <FamilyFundingLine> — the 1:1 family money line (program-lineage Task 7).
 *
 * Renders one cited point per funding_line entry (each a state-A <Cite> on its
 * fid — the funding values are amounts) and shows the family's chain identities
 * in order. Values are USD thousands, from the decade series (dataset
 * "fct_decade_series").
 *
 * Honesty invariants:
 *   - A point is minted ONLY for what is in funding_line — NEVER for a chain PE
 *     that carries no funding_line entry (the chain may list more identities
 *     than the 1:1 line has cited points).
 *   - has_split → an honest branch marker: the family branches, so the line is
 *     drawn for the 1:1 chain only (the split arms are not summed in).
 */

import React from "react";
import { Cite } from "@/components/cite";
import type { LineageFamily } from "@/lib/lineage";

export function FamilyFundingLine({ family }: { family: LineageFamily }) {
  const points = family.funding_line ?? [];
  const chain = family.chain ?? [];

  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No family funding line is available for this program element — no 1:1
        year-over-year chain of cited request figures could be assembled.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Chain identities in order. */}
      {chain.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">
            Funding chain:
          </span>{" "}
          {chain.map((pe, i) => (
            <React.Fragment key={pe}>
              {i > 0 && <span aria-hidden="true"> → </span>}
              <code className="font-mono">{pe}</code>
            </React.Fragment>
          ))}
        </p>
      )}

      {/* One cited point per funding_line entry — the money line. */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-5">
        {points.map((p) => (
          <li key={p.fid} className="flex flex-col text-sm">
            <span className="text-xs text-muted-foreground">FY{p.fy}</span>
            <Cite
              value={p.v}
              units="USD thousands"
              dataset="fct_decade_series"
              factId={p.fid}
            />
          </li>
        ))}
      </ul>

      {/* Split/branch honesty marker. */}
      {family.has_split && (
        <p
          data-has-split="true"
          className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          This family branches — the funding line above is shown for the 1:1
          chain only. Where the line splits into multiple successors, the branch
          arms are not summed into this series.
        </p>
      )}
    </div>
  );
}
