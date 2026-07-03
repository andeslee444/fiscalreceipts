"use client";

/**
 * jbook-narrative-card.tsx — Display card for jbook_narrative citations.
 *
 * Phase 5F §2b: 2,449 / 2,457 narrative citations carry the PASSAGE START's
 * page + bbox (narrative provenance builder). Those render like the
 * jbook_pdf card — the shared PdfView renders the page, highlights the
 * passage-start region, and links "Open official source at p.N".
 * ambiguous_first passages surface PdfView's existing amber ambiguity note.
 *
 * The 8 unresolved narratives (OCR-hostile layouts) keep the original
 * non-paged card — never a fake location.
 *
 * Both variants show:
 *   - "J-book narrative text" label
 *   - xml_path locator (mono chip)
 *   - Document SHA-256 prefix (8 chars, mono)
 * The unpaged variant adds the plain official-source link (the paged variant
 * gets the page-anchored link from PdfView).
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import type { JbookNarrativeCitation } from "@/lib/data";
import { pagedNarrativeCitation } from "@/lib/citations";
import { PdfView } from "./pdf-view";

interface JbookNarrativeCardProps {
  citation: JbookNarrativeCitation;
}

export function JbookNarrativeCard({ citation }: JbookNarrativeCardProps) {
  const shaPrefix = citation.sha256 ? citation.sha256.slice(0, 8) : null;
  const paged = pagedNarrativeCitation(citation);

  return (
    <div
      className="space-y-3"
      data-testid="jbook-narrative-card"
      data-paged={paged ? "true" : "false"}
    >
      {/* Label */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
          Source
        </span>
        <span className="text-sm font-medium">J-book narrative text</span>
        {paged && (
          <span className="ml-2 text-xs text-muted-foreground">
            passage starts on p.{paged.page_number}
          </span>
        )}
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

      {/* Paged narrative (§2b): PDF page render + passage-start highlight +
          page-anchored official link — the shared PdfView owns loading /
          degraded / enlarge behavior and the ambiguous_first amber note. */}
      {paged && (
        <PdfView
          citation={paged}
          officialLinkLabel={`Open official source at p.${paged.page_number}`}
        />
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

      {/* Official source link — unpaged card only (PdfView renders the
          page-anchored link for paged narratives). */}
      {!paged && citation.official_url && (
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
