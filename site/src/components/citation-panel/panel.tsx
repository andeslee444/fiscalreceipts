"use client";

/**
 * panel.tsx — Citation side panel: Radix Dialog styled as a right-side sheet.
 *
 * CitationPanelProvider:
 *   - Implements the CitationPanelContext.openPanel function
 *   - Holds the citations slice (per-page subset, passed from the server page)
 *   - Opens the panel when openPanel(factId) is called
 *   - Dispatches to the right card based on citation.kind
 *   - State B (xml-path) and state C (uncited) spans NEVER call openPanel
 *     (they have no data-fact-id — cite.tsx only wires clicks for state A)
 *
 * Panel layout:
 *   - Right-side sheet (full height, fixed right, max-w-md, scrollable)
 *   - Header: "Citation" title + kind badge + close button
 *   - Body: dispatches to PdfView / WorkbookCard / LdaCard
 *   - Footer: retrieved_at, sha256 8-char prefix (mono), official-source link
 *     (jbook: official_url already carries #page=N — render as-is)
 *
 * The Dialog is rendered via a portal so it doesn't clip inside containers.
 */

import React, { useCallback, useContext, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { Citation, CitationsMap } from "@/lib/data";
import { isJbookPdf, isWorkbook, isLdaFiling } from "@/lib/citations";
import { CitationPanelContext } from "@/components/cite";
import { AssetConfigProvider } from "@/components/asset-config";
import { PdfView } from "./pdf-view";
import { WorkbookCard } from "./workbook-card";
import { LdaCard } from "./lda-card";

// ── CitationPanelProvider ─────────────────────────────────────────────────────

interface CitationPanelProviderProps {
  /** Pre-sliced citations for the current page (from collectCitations()). */
  citations: CitationsMap;
  children: React.ReactNode;
}

/**
 * Provides the citation panel context to all child components.
 * Wrap this around page content where State A <Cite> elements appear.
 *
 * Usage (in a server page component):
 *   const citationsSlice = collectCitations(factIds);
 *
 *   return (
 *     <CitationPanelProvider citations={citationsSlice}>
 *       <PageContent />
 *     </CitationPanelProvider>
 *   );
 */
export function CitationPanelProvider({
  citations,
  children,
}: CitationPanelProviderProps) {
  const [open, setOpen] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [activeFactId, setActiveFactId] = useState<string | null>(null);

  const openPanel = useCallback(
    (factId: string) => {
      const citation = citations[factId];
      if (!citation) {
        // factId not in slice — shouldn't happen if caller is correct
        console.warn(
          `[CitationPanel] openPanel("${factId}") — fact_id not found in citations slice.`,
        );
        return;
      }
      setActiveCitation(citation);
      setActiveFactId(factId);
      setOpen(true);
    },
    [citations],
  );

  return (
    <CitationPanelContext.Provider value={{ openPanel }}>
      {/*
        AssetConfigProvider is needed here so child components (PdfView,
        WorkbookCard) can call useAssetUrl(). If the parent layout already
        provides it, this is a no-op equivalent (context re-wrapping is safe).
      */}
      <AssetConfigProvider>
        {children}
        <CitationPanelDialog
          open={open}
          onOpenChange={setOpen}
          citation={activeCitation}
          factId={activeFactId}
        />
      </AssetConfigProvider>
    </CitationPanelContext.Provider>
  );
}

// ── CitationPanelDialog ───────────────────────────────────────────────────────

interface CitationPanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citation: Citation | null;
  factId: string | null;
}

function kindLabel(citation: Citation): string {
  switch (citation.kind) {
    case "jbook_pdf":
      return "Budget Justification PDF";
    case "workbook":
      return "Budget Workbook";
    case "lda_filing":
      return "LDA Lobbying Filing";
  }
}

function kindBadgeClass(citation: Citation): string {
  switch (citation.kind) {
    case "jbook_pdf":
      return "bg-blue-100 text-blue-800";
    case "workbook":
      return "bg-green-100 text-green-800";
    case "lda_filing":
      return "bg-purple-100 text-purple-800";
  }
}

function CitationPanelDialog({
  open,
  onOpenChange,
  citation,
  factId,
}: CitationPanelDialogProps) {
  const shortId = factId ? factId.slice(0, 8) : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay — semi-transparent, closes panel on click */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />

        {/* Panel — right-side sheet */}
        <DialogPrimitive.Content
          data-testid="citation-panel"
          className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-background shadow-xl outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right duration-200"
          aria-label="Citation details"
        >
          {/* Accessible title (visually hidden if we use our own heading) */}
          <DialogPrimitive.Title className="sr-only">
            Citation details
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Source citation for this budget figure
          </DialogPrimitive.Description>

          {/* ── Header ── */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Citation</h2>
              {citation && (
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${kindBadgeClass(citation)}`}
                >
                  {kindLabel(citation)}
                </span>
              )}
            </div>
            <DialogPrimitive.Close
              className="rounded-sm p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Close citation panel"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {citation ? (
              <CitationBody citation={citation} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No citation loaded.
              </p>
            )}
          </div>

          {/* ── Footer ── */}
          {citation && (
            <div className="shrink-0 border-t border-border px-4 py-3 space-y-1.5">
              {/* retrieved_at */}
              {citation.retrieved_at && (
                <p className="text-xs text-muted-foreground">
                  Retrieved{" "}
                  <time dateTime={citation.retrieved_at}>
                    {formatRetrievedAt(citation.retrieved_at)}
                  </time>
                </p>
              )}

              {/* sha256 8-char prefix in mono */}
              {citation.sha256 && (
                <p className="text-xs text-muted-foreground">
                  SHA-256:{" "}
                  <span className="font-mono">
                    {citation.sha256.slice(0, 8)}…
                  </span>
                </p>
              )}

              {/* Official source link */}
              {citation.official_url && (
                <a
                  href={citation.official_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">Official source</span>
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              )}

              {/* fact_id short — debugging aid */}
              {/* Note: muted-foreground/60 fails WCAG AA contrast; use muted-foreground at full opacity */}
              {shortId && (
                <p className="text-[11px] font-mono text-muted-foreground">
                  fact #{shortId}
                </p>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── CitationBody — dispatches to the right card ────────────────────────────

function CitationBody({ citation }: { citation: Citation }) {
  if (isJbookPdf(citation)) {
    return <PdfView citation={citation} />;
  }
  if (isWorkbook(citation)) {
    return <WorkbookCard citation={citation} />;
  }
  if (isLdaFiling(citation)) {
    return <LdaCard citation={citation} />;
  }
  // Should never reach here — exhaustive guard
  return (
    <p className="text-sm text-muted-foreground">
      Unknown citation kind.
    </p>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRetrievedAt(iso: string): string {
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

// ── Re-export the context hook for convenience ─────────────────────────────

export { CitationPanelContext };
export function useCitationPanel() {
  return useContext(CitationPanelContext);
}
