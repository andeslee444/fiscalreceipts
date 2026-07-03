"use client";

/**
 * panel.tsx — Citation side panel: Radix Dialog styled as a right-side sheet.
 *
 * CitationPanelProvider:
 *   - Implements the CitationPanelContext.openPanel function
 *   - Holds the citations slice (per-page subset, passed from the server page)
 *   - Opens the panel when openPanel(factId) is called
 *   - Fetch-on-miss (Phase 5D Task 3): a fact_id NOT in the embedded slice is
 *     resolved lazily from /json/cite-shards/{fact_id[:2]}.json (cached Map,
 *     single-flight per shard — lib/cite-shards.ts). While resolving, the
 *     panel shows a loading body; on failure it shows the degraded state
 *     ([data-degraded="citation"]) — never a silent no-op or fake success.
 *     The embedded fast path is untouched (no fetch, zero behavior change on
 *     existing pages).
 *   - Dispatches to the right card based on citation.kind
 *   - Drill-down history (Phase 5D Task 3b): opening another citation while
 *     the panel is already open (derived-input chips, breakdown-table row
 *     cites) pushes the current fact onto a back stack; a Back button in the
 *     header returns to it. The stack resets when the panel closes.
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

import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { X, ExternalLink, Copy, Check, ArrowLeft, AlertCircle } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { Citation, CitationsMap } from "@/lib/data";
import { formatFootnote, footnoteInputFromCitation } from "./footnote";
import {
  isJbookPdf,
  isWorkbook,
  isLdaFiling,
  isDerived,
  isUsaspending,
  isStateSoql,
  isStateFile,
  isJbookNarrative,
} from "@/lib/citations";
import { CitationPanelContext } from "@/components/cite";
import { resolveCitationFromShards } from "@/lib/cite-shards";
import {
  AssetConfigProvider,
  AssetConfigContext,
} from "@/components/asset-config";
import { PdfView } from "./pdf-view";
import { WorkbookCard } from "./workbook-card";
import { LdaCard } from "./lda-card";
import { DerivedCard } from "./derived-card";
import { UsaspendingCard } from "./usaspending-card";
import { StateCard } from "./state-card";
import { JbookNarrativeCard } from "./jbook-narrative-card";

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
/** Body display state: ready (card), loading (shard fetch), error (degraded). */
type PanelBodyState = "ready" | "loading" | "error";

export function CitationPanelProvider({
  citations,
  children,
}: CitationPanelProviderProps) {
  const [open, setOpen] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [activeFactId, setActiveFactId] = useState<string | null>(null);
  const [bodyState, setBodyState] = useState<PanelBodyState>("ready");
  // Drill-down back stack (fact_ids UNDER the active one). State so the Back
  // button re-renders; ref-free because updates only happen in handlers.
  const [backStack, setBackStack] = useState<string[]>([]);

  // Citations resolved lazily via cite-shards — merged view for lookups.
  // A ref (not state): resolved rows are only read inside handlers, and the
  // panel re-renders via setActiveCitation when one becomes active.
  const dynamicRef = useRef<CitationsMap>({});
  // Monotonic token so a stale shard resolution can't clobber a newer open.
  const openEpochRef = useRef(0);

  const lookup = useCallback(
    (factId: string): Citation | undefined =>
      citations[factId] ?? dynamicRef.current[factId],
    [citations],
  );

  const showCitation = useCallback((factId: string, citation: Citation) => {
    setActiveCitation(citation);
    setActiveFactId(factId);
    setBodyState("ready");
    setOpen(true);
  }, []);

  const openPanel = useCallback(
    (factId: string) => {
      // Drill-down: opening a NEW fact while the panel is already showing one
      // pushes the current fact onto the back stack (Back returns to it).
      setBackStack((stack) => {
        if (!open || !activeFactId || activeFactId === factId) return stack;
        return [...stack, activeFactId];
      });

      const embedded = lookup(factId);
      if (embedded) {
        // Fast path — embedded slice (or an already-fetched shard row).
        // Behavior identical to the pre-5D panel: no fetch.
        showCitation(factId, embedded);
        return;
      }

      // Fetch-on-miss: open immediately in the loading state, resolve the
      // fact's shard, then either show the card or the degraded state.
      const epoch = ++openEpochRef.current;
      setActiveCitation(null);
      setActiveFactId(factId);
      setBodyState("loading");
      setOpen(true);
      resolveCitationFromShards(factId).then((citation) => {
        if (openEpochRef.current !== epoch) return; // superseded by a newer open
        if (citation) {
          dynamicRef.current[factId] = citation;
          setActiveCitation(citation);
          setBodyState("ready");
        } else {
          setBodyState("error");
        }
      });
    },
    [open, activeFactId, lookup, showCitation],
  );

  // Derived-card input chips ask this before rendering a clickable chip —
  // calling openPanel again from inside the panel REPLACES the active card
  // (stack navigation with Back).
  const hasCitation = useCallback(
    (factId: string) => lookup(factId) !== undefined,
    [lookup],
  );

  const goBack = useCallback(() => {
    setBackStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      const citation = lookup(prev);
      if (citation) {
        showCitation(prev, citation);
      }
      return stack.slice(0, -1);
    });
  }, [lookup, showCitation]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      // Invalidate any in-flight shard resolution and reset navigation.
      openEpochRef.current++;
      setBackStack([]);
    }
  }, []);

  const contextValue = React.useMemo(
    () => ({ openPanel, hasCitation }),
    [openPanel, hasCitation],
  );

  return (
    <CitationPanelContext.Provider value={contextValue}>
      {/*
        AssetConfigProvider is needed here so child components (PdfView,
        WorkbookCard) can call useAssetUrl(). If the parent layout already
        provides it, this is a no-op equivalent (context re-wrapping is safe).
      */}
      <AssetConfigProvider>
        <AssetPreconnect />
        {children}
        <CitationPanelDialog
          open={open}
          onOpenChange={handleOpenChange}
          citation={activeCitation}
          factId={activeFactId}
          bodyState={bodyState}
          canGoBack={backStack.length > 0}
          onBack={goBack}
        />
      </AssetConfigProvider>
    </CitationPanelContext.Provider>
  );
}

// ── AssetPreconnect ───────────────────────────────────────────────────────────

/**
 * Injects <link rel="preconnect"> for the asset origin so the first PDF /
 * parquet fetch skips DNS + TCP + TLS setup.
 *
 * Tradeoff: the asset base is RUNTIME config (/config.json — rewritten to the
 * R2 host at deploy time), so we cannot emit the preconnect into the static
 * <head> without baking the committed prod URL into the build and breaking
 * the one-artifact contract. Injecting after config resolution still warms
 * the connection well before the user opens a citation panel.
 */
function AssetPreconnect() {
  const base = useContext(AssetConfigContext);

  useEffect(() => {
    if (!/^https?:\/\//i.test(base)) return; // same-origin (/assets) — nothing to warm
    let origin: string;
    try {
      origin = new URL(base).origin;
    } catch {
      return;
    }
    if (origin === window.location.origin) return;
    if (
      document.head.querySelector(
        `link[rel="preconnect"][href="${origin}"]`,
      )
    ) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    // PDF.js/DuckDB fetch cross-origin in CORS mode — the warmed connection
    // must be a CORS one to be reused.
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }, [base]);

  return null;
}

// ── CitationPanelDialog ───────────────────────────────────────────────────────

interface CitationPanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citation: Citation | null;
  factId: string | null;
  bodyState: "ready" | "loading" | "error";
  canGoBack: boolean;
  onBack: () => void;
}

function kindLabel(citation: Citation): string {
  switch (citation.kind) {
    case "jbook_pdf":
      return "Budget Justification PDF";
    case "workbook":
      return "Budget Workbook";
    case "lda_filing":
      return "LDA Lobbying Filing";
    case "derived":
      return "Derived Figure";
    case "usaspending":
      return "USAspending Query";
    case "state_soql":
      return "State Open Data Query";
    case "state_file":
      return "State Source File";
    case "jbook_narrative":
      return "J-book Narrative";
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
    case "derived":
      return "bg-cyan-100 text-cyan-800";
    case "usaspending":
      return "bg-orange-100 text-orange-800";
    case "state_soql":
    case "state_file":
      return "bg-teal-100 text-teal-800";
    case "jbook_narrative":
      return "bg-amber-100 text-amber-800";
  }
}

function CitationPanelDialog({
  open,
  onOpenChange,
  citation,
  factId,
  bodyState,
  canGoBack,
  onBack,
}: CitationPanelDialogProps) {
  const shortId = factId ? factId.slice(0, 8) : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay — semi-transparent, closes panel on click.
            data-citation-panel: print stylesheet hides panel chrome.
            citation-panel-overlay: token-driven fade keyframes (globals.css,
            Phase 5C Task 11 — replaced inert tw-animate classes). */}
        <DialogPrimitive.Overlay
          data-citation-panel
          className="citation-panel-overlay fixed inset-0 z-50 bg-black/30"
        />

        {/* Panel — right-side sheet. citation-panel-sheet: slide-in/out
            keyframes on var(--motion-slow)/var(--motion-base) tokens
            (globals.css) — Radix waits for the close animation before
            unmounting. */}
        <DialogPrimitive.Content
          data-testid="citation-panel"
          data-citation-panel
          className="citation-panel-sheet fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-background shadow-xl outline-none"
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
            <div className="flex items-center gap-2 min-w-0">
              {/* Back — drill-down navigation (derived-input chips /
                  breakdown-table row cites push onto the back stack). */}
              {canGoBack && (
                <button
                  type="button"
                  data-testid="panel-back"
                  onClick={onBack}
                  aria-label="Back to previous citation"
                  className="flex items-center gap-1 rounded-sm p-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back
                </button>
              )}
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
          {/* min-h-0 (not flex-1): the body only grows to its content, so the
              footer metadata block sits directly below it instead of being
              pinned to the bottom of the full-height sheet — at tall
              viewports flex-1 marooned the footer below a large blank gap
              (visual-judge nit, 2 judges). When content overflows, min-h-0
              lets the body shrink and scroll exactly as before. */}
          <div className="min-h-0 overflow-y-auto px-4 py-4">
            {bodyState === "loading" ? (
              /* Shard fetch in flight — explicit loading body (skeleton +
                 label), mirroring the PDF loading pattern. */
              <div
                data-testid="citation-loading"
                className="animate-pulse space-y-2"
                aria-label="Loading citation"
              >
                <div className="h-2 w-3/5 rounded bg-border" aria-hidden="true" />
                <div className="h-2 w-full rounded bg-border" aria-hidden="true" />
                <div className="h-2 w-4/5 rounded bg-border" aria-hidden="true" />
                <p className="pt-1 text-xs text-muted-foreground">
                  Loading citation…
                </p>
              </div>
            ) : bodyState === "error" ? (
              /* Degraded state — the shard was unreachable or the fact has no
                 citation row. Explicit, never fake success (G3 pattern). */
              <div
                data-degraded="citation"
                role="alert"
                className="flex flex-col items-center gap-3 py-6 text-center"
              >
                <AlertCircle
                  className="h-8 w-8 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  {"couldn't load this citation — check your connection and try again"}
                </p>
                {factId && (
                  <p className="max-w-full truncate font-mono text-xs text-muted-foreground">
                    fact #{factId.slice(0, 8)}
                  </p>
                )}
              </div>
            ) : citation ? (
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

              {/* Official source link + copy-as-footnote (Phase 5C Task 9) */}
              <div className="flex items-center gap-4">
                {citation.official_url && (
                  <a
                    href={citation.official_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">Official source</span>
                    <span className="sr-only">(opens in new tab)</span>
                  </a>
                )}
                {factId && (
                  <CopyFootnoteButton citation={citation} factId={factId} />
                )}
              </div>

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
  if (isDerived(citation)) {
    return <DerivedCard citation={citation} />;
  }
  if (isUsaspending(citation)) {
    return <UsaspendingCard citation={citation} />;
  }
  if (isStateSoql(citation) || isStateFile(citation)) {
    return <StateCard citation={citation} />;
  }
  if (isJbookNarrative(citation)) {
    return <JbookNarrativeCard citation={citation} />;
  }
  // Should never reach here — exhaustive guard
  return (
    <p className="text-sm text-muted-foreground">
      Unknown citation kind.
    </p>
  );
}

// ── CopyFootnoteButton — copy a quotable footnote to the clipboard ──────────

type CopyState = "idle" | "copied" | "failed";

function CopyFootnoteButton({
  citation,
  factId,
}: {
  citation: Citation;
  factId: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the transient-state timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    // Canonical permalink: origin + pathname (no hash/query).
    const url = `${window.location.origin}${window.location.pathname}`;
    // Human label from the page title, trimmed of site-name suffixes
    // ("{Program} — FY2026 Budget… | Fiscal Receipts" → "{Program}").
    const label =
      document.title.split(" | ")[0].split(" — ")[0].trim() || null;
    const text = formatFootnote(
      footnoteInputFromCitation(citation, factId, { url, label }),
    );
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      timerRef.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context).
      setCopyState("failed");
      timerRef.current = setTimeout(() => setCopyState("idle"), 2000);
    }
  }, [citation, factId]);

  // Icon swaps outside the live region; label text swaps inside it.
  const icon =
    copyState === "copied" ? (
      <Check className="h-3 w-3 shrink-0 text-green-600" aria-hidden="true" />
    ) : copyState === "failed" ? (
      <Copy className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
    ) : (
      <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
    );

  const label =
    copyState === "copied"
      ? "Copied ✓"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy as footnote";

  return (
    <button
      type="button"
      data-testid="copy-footnote"
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy this citation as a formatted footnote"
    >
      {icon}
      {/* Always-mounted live region: screen readers announce state changes. */}
      <span aria-live="polite">{label}</span>
    </button>
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
