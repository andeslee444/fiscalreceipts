"use client";

/**
 * Citation chips for dossier claims (Task 8a).
 *
 * DossierFactChip — warehouse citation: opens the citation panel via the
 *   existing CitationPanelContext (the page's citation slice includes every
 *   dossier fact_id — collected in program page pageFactIds).
 * DossierUrlChip — news-snapshot citation: external link to the live source
 *   with the snapshot title as tooltip and a "retrieved" note (the cached
 *   snapshot is the citable artifact; the live page may have changed).
 */

import React, { useContext } from "react";
import { ExternalLink } from "lucide-react";
import { CitationPanelContext } from "@/components/cite";
import type { SnapshotMeta } from "@/lib/dossier";

const CHIP_BASE =
  "ml-1.5 inline-flex items-center gap-0.5 rounded border px-1 py-0.5 " +
  "font-mono text-xs align-middle whitespace-nowrap";

export function DossierFactChip({ factId }: { factId: string }) {
  const { openPanel } = useContext(CitationPanelContext);
  // PUBLIC id (P0-4): fid[:8] — the same truncation the drawer footer and
  // the /fact/{id8} permalink use. ONE id everywhere, never re-sliced.
  const shortId = factId.slice(0, 8);
  return (
    <button
      type="button"
      data-dossier-chip="fact"
      data-fact-id={factId}
      className={`${CHIP_BASE} cursor-pointer border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors`}
      title="View citation"
      aria-label={`View citation ${shortId}`}
      onClick={() => openPanel(factId)}
    >
      #{shortId}
    </button>
  );
}

export function DossierUrlChip({
  url,
  meta,
}: {
  url: string;
  meta: SnapshotMeta | null;
}) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // keep raw url as label fallback
  }
  const retrieved = meta?.retrieved_at ? meta.retrieved_at.slice(0, 10) : null;
  const tooltip = [meta?.title ?? url, retrieved ? `retrieved ${retrieved}` : null]
    .filter(Boolean)
    .join(" — ");
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-dossier-chip="url"
      className={`${CHIP_BASE} border-border bg-muted text-muted-foreground hover:text-foreground transition-colors`}
      title={tooltip}
    >
      {host}
      {retrieved && (
        <span className="text-muted-foreground/70">· retrieved {retrieved}</span>
      )}
      <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
    </a>
  );
}
