"use client";

/**
 * jbook-narrative-card.tsx — Display card for jbook_narrative citations.
 *
 * Shows:
 *   - "J-book narrative text" label
 *   - Document SHA-256 prefix (8 chars, mono)
 *   - xml_path locator (mono chip)
 *   - Official source link (the document's hosted source URL)
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import type { JbookNarrativeCitation } from "@/lib/data";

interface JbookNarrativeCardProps {
  citation: JbookNarrativeCitation;
}

export function JbookNarrativeCard({ citation }: JbookNarrativeCardProps) {
  const shaPrefix = citation.sha256 ? citation.sha256.slice(0, 8) : null;

  return (
    <div className="space-y-3" data-testid="jbook-narrative-card">
      {/* Label */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
          Source
        </span>
        <span className="text-sm font-medium">J-book narrative text</span>
      </div>

      {/* xml_path locator */}
      {citation.xml_path && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
            XML location
          </span>
          <span className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground break-all">
            {citation.xml_path}
          </span>
        </div>
      )}

      {/* Document fingerprint */}
      {shaPrefix && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
            Document SHA-256
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {shaPrefix}&hellip;
          </span>
        </div>
      )}

      {/* Official source link */}
      {citation.official_url && (
        <a
          href={citation.official_url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="jbook-narrative-source-link"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
        >
          <ExternalLink
            className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
            aria-hidden="true"
          />
          <span>Official source document</span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}
    </div>
  );
}
