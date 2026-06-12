"use client";

/**
 * workbook-card.tsx — Display card for workbook citations.
 *
 * Shows:
 *   - Sheet name
 *   - Cells as individual chips (split on commas)
 *   - Amount formatted from amount_thousands ("USD thousands")
 *   - Download link for the hosted xlsx file via useAssetUrl()
 *   - Official source link
 */

import React from "react";
import { Download, ExternalLink } from "lucide-react";
import type { WorkbookCitation } from "@/lib/data";
import { formatAmount } from "@/lib/format";
import { useAssetUrl } from "@/components/asset-config";

interface WorkbookCardProps {
  citation: WorkbookCitation;
}

export function WorkbookCard({ citation }: WorkbookCardProps) {
  const assetUrl = useAssetUrl();

  // Split cells string on commas and trim
  const cellChips = citation.cells
    ? citation.cells
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  // Download link: /workbooks/{sha256}.xlsx
  const downloadPath = `/workbooks/${citation.sha256}.xlsx`;

  return (
    <div className="space-y-3">
      {/* Amount — prominent */}
      {citation.amount_thousands != null && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
            Amount
          </span>
          <span className="text-xl font-semibold tabular-nums">
            {formatAmount(citation.amount_thousands, "USD thousands")}
          </span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            USD thousands
          </span>
        </div>
      )}

      {/* Sheet */}
      {citation.sheet && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-0.5">
            Sheet
          </span>
          <span className="text-sm font-medium">{citation.sheet}</span>
        </div>
      )}

      {/* Cells as chips */}
      {cellChips.length > 0 && (
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1">
            Cells
          </span>
          <div className="flex flex-wrap gap-1">
            {cellChips.map((cell) => (
              <span
                key={cell}
                className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
              >
                {cell}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Download xlsx */}
      <a
        href={assetUrl(downloadPath)}
        download
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium hover:bg-muted transition-colors group"
      >
        <Download
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
          aria-hidden="true"
        />
        <span>Download workbook (.xlsx)</span>
      </a>

      {/* Official source link */}
      {citation.official_url && (
        <a
          href={citation.official_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ExternalLink
            className="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="truncate">Official source</span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}
    </div>
  );
}
