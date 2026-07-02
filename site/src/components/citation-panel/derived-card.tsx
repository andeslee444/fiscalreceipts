"use client";

/**
 * derived-card.tsx — Display card for derived citations.
 *
 * Shows:
 *   - Recorded value (prominent, with units)
 *   - Formula text (mono block)
 *   - Input chips:
 *       16-hex fact_id inputs → clickable chips that open THAT citation in
 *       the panel (replacing the current card — "stack/replace" navigation).
 *       Chips are only clickable when the input citation is present in the
 *       page's citation slice (hasCitation); otherwise they render as plain
 *       mono chips with an explanatory title.
 *       URL inputs → external links (new tab).
 *   - "recorded {retrieved_at}" note when present
 */

import React, { useContext } from "react";
import { ExternalLink } from "lucide-react";
import type { DerivedCitation } from "@/lib/data";
import { parseDerivedInputs } from "@/lib/citations";
import { usdEquivalence } from "@/lib/format";
import { CitationPanelContext } from "@/components/cite";

interface DerivedCardProps {
  citation: DerivedCitation;
}

function formatRecordedValue(recorded: string): string {
  const n = Number(recorded);
  if (!Number.isFinite(n)) return recorded;
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function DerivedCard({ citation }: DerivedCardProps) {
  const { openPanel, hasCitation } = useContext(CitationPanelContext);
  const inputs = parseDerivedInputs(citation.inputs);
  const factInputs = inputs.filter((i) => i.isFactId);
  const urlInputs = inputs.filter((i) => i.isUrl);
  const isAvailable = (factId: string) =>
    hasCitation ? hasCitation(factId) : false;

  return (
    <div className="space-y-3" data-testid="derived-card">
      {/* Recorded value — prominent */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
          Recorded value
        </span>
        <span className="text-xl font-semibold tabular-nums">
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

      {/* Formula */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
          Formula
        </span>
        <p className="rounded bg-muted px-2.5 py-2 font-mono text-xs text-foreground break-words leading-relaxed">
          {citation.formula}
        </p>
      </div>

      {/* Fact-id input chips — open their own citation in the panel */}
      {factInputs.length > 0 && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
            Inputs ({factInputs.length})
          </span>
          <div className="flex flex-wrap gap-1">
            {factInputs.map((inp) => {
              const clickable = isAvailable(inp.value);
              return clickable ? (
                <button
                  key={inp.value}
                  type="button"
                  data-testid="derived-input-chip"
                  onClick={() => openPanel(inp.value)}
                  title="Open this input's citation"
                  className="inline-block rounded bg-blue-100 px-2 py-0.5 font-mono text-xs text-blue-700 hover:bg-blue-200 transition-colors cursor-pointer"
                >
                  #{inp.value.slice(-8)}
                </button>
              ) : (
                <span
                  key={inp.value}
                  data-testid="derived-input-chip-static"
                  title="Input citation not loaded on this page — open the source page to inspect it"
                  className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  #{inp.value.slice(-8)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* URL inputs — external links */}
      {urlInputs.length > 0 && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
            Source inputs
          </span>
          <ul className="space-y-1">
            {urlInputs.map((inp) => (
              <li key={inp.value}>
                <a
                  href={inp.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{inp.value}</span>
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recorded-at note */}
      {citation.retrieved_at && (
        <p className="text-xs text-muted-foreground">
          Recorded{" "}
          <time dateTime={citation.retrieved_at}>
            {formatDate(citation.retrieved_at)}
          </time>{" "}
          from warehouse data — recomputed and verified at export time.
        </p>
      )}
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
