"use client";

/**
 * lda-card.tsx — Display card for lda_filing citations.
 *
 * Shows:
 *   - Filing year
 *   - Human-readable link (lda.senate.gov/filings/public/filing/{uuid}/print/)
 *     as the prominent action — opens in new tab
 *   - API URL co-cited in smaller mono text
 *   - UUID displayed in mono
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import type { LdaFilingCitation } from "@/lib/data";
import { humanLdaUrl, extractLdaUuid } from "@/lib/citations";

interface LdaCardProps {
  citation: LdaFilingCitation;
  /** Filing year from the program mention row — optional, displayed if present. */
  filingYear?: string | null;
}

export function LdaCard({ citation, filingYear }: LdaCardProps) {
  const humanUrl = humanLdaUrl(citation.official_url);
  const uuid = extractLdaUuid(citation.official_url);

  return (
    <div className="space-y-3">
      {/* Filing year */}
      {filingYear && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Filing year
          </span>
          <span className="text-sm font-medium">{filingYear}</span>
        </div>
      )}

      {/* Human-readable link — prominent */}
      {humanUrl ? (
        <a
          href={humanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
        >
          <ExternalLink
            className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
            aria-hidden="true"
          />
          <span>View filing on LDA</span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No human-readable URL available for this filing.
        </p>
      )}

      {/* UUID in mono */}
      {uuid && (
        <div className="space-y-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Filing ID
          </span>
          <p className="font-mono text-xs text-muted-foreground break-all">
            {uuid}
          </p>
        </div>
      )}

      {/* API URL co-cited in smaller text */}
      {citation.official_url && (
        <div className="space-y-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            API source
          </span>
          <p className="font-mono text-[11px] text-muted-foreground break-all leading-relaxed">
            {citation.official_url}
          </p>
        </div>
      )}
    </div>
  );
}
