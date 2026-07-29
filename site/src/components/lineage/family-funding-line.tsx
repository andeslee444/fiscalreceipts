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
 *   - Every displayed number IS its cited fact's value (Defect 2, 2026-07-28):
 *     entries are per (fy, chain member); an fy where two members coexist
 *     renders EACH member's value as its own labeled <Cite> — the reader sees
 *     the handoff/coexistence. An arithmetic sum is NEVER rendered (a summed
 *     number would display a value its single citation does not back — and a
 *     bare currency string outside a Cite trips the render-static gate).
 *   - A point is minted ONLY for what is in funding_line — NEVER for a chain PE
 *     that carries no funding_line entry (the chain may list more identities
 *     than the 1:1 line has cited points).
 *   - has_split → an honest branch marker: the family branches (a split, a
 *     merge/fan-in, or any stated fan-out), so the line is drawn for the 1:1
 *     chain only (branch arms — splits or merges — are not summed in).
 */

import React from "react";
import { Cite } from "@/components/cite";
import type { LineageFamily, LineageFundingPoint } from "@/lib/lineage";

export function FamilyFundingLine({ family }: { family: LineageFamily }) {
  const points = family.funding_line ?? [];
  const chain = family.chain ?? [];
  const headTitle = family.chain_head_title ?? null;

  // Group per-member entries by fiscal year, preserving the exporter's
  // (fy, chain-position) order — a coexistence fy lists the predecessor's
  // point before the successor's.
  const byFy = new Map<number, LineageFundingPoint[]>();
  for (const p of points) {
    const arr = byFy.get(p.fy);
    if (arr) arr.push(p);
    else byFy.set(p.fy, [p]);
  }

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
      {/* Chain identities in order, followed by the chain HEAD's short title so
          the summed line is self-describing (not a bare-id cross-reference). */}
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
          {headTitle ? (
            <span className="text-foreground"> — {headTitle}</span>
          ) : null}
        </p>
      )}

      {/* One cited point per funding_line entry — the money line. An fy with
          a single entry renders as before; a coexistence fy renders EACH
          member's own cited value with a small PE-code label (the handoff is
          shown, never a fabricated single sum). */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-5">
        {[...byFy.entries()].map(([fy, entries]) => (
          <li key={fy} className="flex flex-col text-sm">
            <span className="text-xs text-muted-foreground">FY{fy}</span>
            {entries.length === 1 ? (
              <Cite
                value={entries[0].v}
                units="USD thousands"
                dataset="fct_decade_series"
                factId={entries[0].fid}
              />
            ) : (
              <span className="flex flex-col gap-0.5" data-multi-member-fy={fy}>
                {entries.map((p) => (
                  <span key={p.pe} className="flex items-baseline gap-1">
                    <code className="font-mono text-[10px] text-muted-foreground">
                      {p.pe}
                    </code>
                    <Cite
                      value={p.v}
                      units="USD thousands"
                      dataset="fct_decade_series"
                      factId={p.fid}
                    />
                  </span>
                ))}
              </span>
            )}
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
          chain only. Branch arms (splits or merges) are not summed into this
          series.
        </p>
      )}
    </div>
  );
}
