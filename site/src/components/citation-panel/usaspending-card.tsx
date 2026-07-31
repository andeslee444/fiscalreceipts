"use client";

/**
 * usaspending-card.tsx — Display card for usaspending citations.
 *
 * Shows:
 *   - Recorded value (prominent, with units)
 *   - The durable query_body pretty-printed inside a collapsible <details>
 *   - Search-hash permalink link when official_url is a usaspending.gov
 *     /search/?hash=… permalink
 *   - Recipient profile link when official_url is a recipient profile page
 *   - Otherwise the API endpoint is shown as the queried endpoint
 *   - "recorded {retrieved_at}" + drift note (live API results may drift)
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import type { UsaspendingCitation } from "@/lib/data";
import { prettyQueryBody, usaspendingUrlKind } from "@/lib/citations";
import { usdEquivalence } from "@/lib/format";

interface UsaspendingCardProps {
  citation: UsaspendingCitation;
}

function formatRecordedValue(recorded: string): string {
  const n = Number(recorded);
  if (!Number.isFinite(n)) return recorded;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function UsaspendingCard({ citation }: UsaspendingCardProps) {
  const urlKind = usaspendingUrlKind(citation.official_url);
  const pretty = prettyQueryBody(citation.query_body);

  return (
    <div className="space-y-3" data-testid="usaspending-card">
      {/* Recorded value — prominent */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
          Recorded value
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

      {/* Search-hash permalink — prominent action when present */}
      {urlKind === "permalink" && (
        <a
          href={citation.official_url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="usaspending-permalink"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
        >
          <ExternalLink
            className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
            aria-hidden="true"
          />
          <span>Open this search on USAspending.gov</span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}

      {/* Recipient profile link — prominent action when present */}
      {urlKind === "profile" && (
        <a
          href={citation.official_url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="usaspending-profile"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
        >
          <ExternalLink
            className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
            aria-hidden="true"
          />
          <span>View recipient profile on USAspending.gov</span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}

      {/* Endpoint (always co-cited; the durable artifact is endpoint + query) */}
      {urlKind === "endpoint" && (
        <div className="space-y-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            API endpoint
          </span>
          <p className="font-mono text-xs text-muted-foreground break-all leading-relaxed">
            {citation.official_url}
          </p>
        </div>
      )}

      {/* Query body — collapsible */}
      {pretty && (
        <details className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">
            Query body (durable artifact)
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
            {pretty}
          </pre>
        </details>
      )}

      {/* Recorded-at + drift note */}
      <p className="text-xs text-muted-foreground">
        {citation.retrieved_at ? (
          <>
            Recorded{" "}
            <time dateTime={citation.retrieved_at}>
              {formatDate(citation.retrieved_at)}
            </time>
            .{" "}
          </>
        ) : (
          <>Recorded at export time. </>
        )}
        Live USAspending results may drift from the recorded value as new
        award transactions post.
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
