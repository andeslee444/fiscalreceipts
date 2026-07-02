"use client";

/**
 * state-card.tsx — Display card for state citations (state_soql + state_file).
 *
 * state_soql (CT Socrata aggregate):
 *   - Captured value (prominent)
 *   - The exact SoQL URL as a clickable link ("Run this query on data.ct.gov")
 *   - retrieved_at
 *   - Nightly-drift note: the CT dataset refreshes nightly, so live results
 *     may drift from the captured value.
 *
 * state_file (CA Open Fi$Cal pointer tier):
 *   - Captured value (prominent)
 *   - Pointer page link ("Open Fi$Cal source page")
 *   - The pointer/aggregation note (formula field)
 *   - retrieved_at
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import type { StateSoqlCitation, StateFileCitation } from "@/lib/data";
import { usdEquivalence } from "@/lib/format";

interface StateCardProps {
  citation: StateSoqlCitation | StateFileCitation;
}

function formatRecordedValue(recorded: string): string {
  const n = Number(recorded);
  if (!Number.isFinite(n)) return recorded;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function StateCard({ citation }: StateCardProps) {
  const isSoql = citation.kind === "state_soql";

  return (
    <div className="space-y-3" data-testid="state-card">
      {/* Captured value — prominent */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
          Captured value
        </span>
        <span className="text-xl font-semibold tabular-nums">
          {citation.units === "USD" ? "$" : ""}
          {formatRecordedValue(citation.recorded_value)}
        </span>
        {citation.units && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {citation.units}
          </span>
        )}
        {/* Compact-USD equivalence for ≥$1B millions values — recorded value
            stays primary, equivalence is parenthetical. */}
        {(() => {
          const eq = usdEquivalence(
            Number(citation.recorded_value),
            citation.units,
          );
          return eq ? (
            <span className="ml-1.5 text-xs text-muted-foreground">({eq})</span>
          ) : null;
        })()}
      </div>

      {/* SoQL / pointer link — prominent action */}
      <a
        href={citation.official_url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={isSoql ? "state-soql-link" : "state-file-link"}
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
      >
        <ExternalLink
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
          aria-hidden="true"
        />
        <span>
          {isSoql
            ? "Run this query on data.ct.gov"
            : "Open Fi$Cal source page"}
        </span>
        <span className="sr-only">(opens in new tab)</span>
      </a>

      {/* Raw URL co-cited */}
      <div className="space-y-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isSoql ? "SoQL query URL" : "Pointer page URL"}
        </span>
        <p className="font-mono text-[11px] text-muted-foreground break-all leading-relaxed">
          {citation.official_url}
        </p>
      </div>

      {/* Pointer / aggregation note (state_file carries it in formula) */}
      {citation.formula && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
            {isSoql ? "Query note" : "Aggregation note"}
          </span>
          <p className="rounded bg-muted px-2.5 py-2 font-mono text-xs text-foreground break-words leading-relaxed">
            {citation.formula}
          </p>
        </div>
      )}

      {/* retrieved_at + drift note */}
      <p className="text-xs text-muted-foreground">
        Captured{" "}
        <time dateTime={citation.retrieved_at}>
          {formatDate(citation.retrieved_at)}
        </time>
        .{" "}
        {isSoql
          ? "The Connecticut Open Data dataset refreshes nightly — live query results may drift from the captured value."
          : "California publishes per-department files; re-running the aggregation against newer files may drift from the captured value."}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
