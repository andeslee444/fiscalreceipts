"use client";

/**
 * pdf-view.tsx — PDF.js viewer for jbook_pdf citations with bbox highlight.
 *
 * Contract (per plan, updated for the clarity/speed pass):
 *   - GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
 *   - getDocument({ url, rangeChunkSize, disableAutoFetch, disableStream:false })
 *     — ranged transport: only the target page's objects are fetched (the R2
 *     asset host and the gate server both answer 206 + Accept-Ranges).
 *     Documents are cached module-level (LRU, DOC_CACHE_MAX entries) keyed by
 *     resolved URL, so reopening the same citation is instant. destroy() runs
 *     on LRU eviction, not on unmount — the render effect only cancels its
 *     own RenderTask (still StrictMode-safe: the cache dedupes the double
 *     effect run).
 *   - Render page_number to canvas. CSS size stays fit-to-panel, but the
 *     canvas BACKING STORE is oversampled: scale = (cssWidth / 792) ×
 *     devicePixelRatio × PANEL_OVERSAMPLE, capped at MAX_CANVAS_PIXELS —
 *     this is what makes small glyphs crisp on hi-dpi screens.
 *   - Highlight div absolutely positioned via pdfHighlightRect (CSS pixels,
 *     2px pad, amber outline); the container auto-scrolls so the highlight
 *     is centered when the page overflows.
 *   - "Enlarge" button (data-testid="pdf-enlarge") opens a full-screen
 *     zoom overlay (PdfZoomOverlay below): same page at fit-to-width of the
 *     viewport, +/− zoom re-renders at the new scale (never CSS upscaling),
 *     highlight preserved at every scale, Esc/click-outside closes.
 *   - resolution === 'ambiguous_first' → amber badge
 *     "first matching page — see methodology"
 *   - Loading: page-shaped skeleton + "Loading page N…" (not just a spinner)
 *   - Error state: "couldn't load the PDF — open the official source"
 *     with official link, data-degraded="pdf" (G3 contract). NEVER fake
 *     success.
 *   - Gate contracts kept verbatim: canvas.pdf-page-fade.is-ready in the
 *     panel (receiptmoment), canvas + [data-testid="pdf-highlight"]
 *     (clickthrough), [data-degraded="pdf"] (degraded).
 *   - amount_text + units displayed prominently
 */

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { pdfHighlightRect, type PdfPageCitation } from "@/lib/citations";
import { usdEquivalence } from "@/lib/format";
import { useAssetUrl } from "@/components/asset-config";

// ── PDF.js lazy import ───────────────────────────────────────────────────────
// Imported dynamically to avoid SSR issues (PDF.js expects browser globals).
// pdfjs-dist v6: PDFDocumentLoadingTask has destroy() — cancels the HTTP fetch,
// tears down the worker channel, and supersedes cleanup().
// RenderParameters requires `canvas: HTMLCanvasElement | null`.

type PdfJsModule = typeof import("pdfjs-dist");
type PdfDocProxy = import("pdfjs-dist").PDFDocumentProxy;
type PdfPageProxy = import("pdfjs-dist").PDFPageProxy;
type RenderTask = import("pdfjs-dist").RenderTask;

// Cached promise for the pdfjs module — only import once.
let _pdfjsPromise: Promise<PdfJsModule> | null = null;

function getPdfJs(): Promise<PdfJsModule> {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return _pdfjsPromise;
}

// ── Document cache (module-level LRU) ────────────────────────────────────────
// J-book PDFs run 5–31 MB; even with ranged transport, re-parsing the xref on
// every panel open wastes time. Cache PDFDocumentProxy promises keyed by the
// resolved asset URL (sha-addressed, so contents never change under a key).
// Small cap: each cached doc holds a worker-side parse + fetched chunks.

const DOC_CACHE_MAX = 4;
/** 256 KiB — a page's content stream + shared font objects usually fit in a
 *  handful of chunks; bigger chunks would drag in neighboring pages. */
const RANGE_CHUNK_SIZE = 262144;

interface DocCacheEntry {
  promise: Promise<PdfDocProxy>;
  destroy: () => void;
}

const docCache = new Map<string, DocCacheEntry>();

function getCachedDocument(
  pdfjs: PdfJsModule,
  url: string,
): Promise<PdfDocProxy> {
  const hit = docCache.get(url);
  if (hit) {
    // LRU refresh: re-insert as most recent.
    docCache.delete(url);
    docCache.set(url, hit);
    return hit.promise;
  }

  const loadingTask = pdfjs.getDocument({
    url,
    // Ranged transport: fetch only the byte ranges the target page needs
    // instead of streaming the whole file (some J-books are >30 MB).
    //
    // disableStream MUST be true: PDF.js only cancels its initial full GET
    // (which otherwise streams the ENTIRE file to completion, in parallel
    // with the range requests) when streaming is disabled — measured on the
    // 31 MB J-book: stream enabled ≈ full file + chunk overlap transferred;
    // stream disabled ≈ only the target page's chunks.
    rangeChunkSize: RANGE_CHUNK_SIZE,
    disableAutoFetch: true,
    disableStream: true,
  });

  const entry: DocCacheEntry = {
    promise: loadingTask.promise,
    destroy: () => {
      loadingTask.destroy().catch(() => {});
    },
  };
  docCache.set(url, entry);

  // A rejected load (asset unreachable) must not poison the cache — drop it
  // so the next open retries the fetch.
  entry.promise.catch(() => {
    if (docCache.get(url) === entry) {
      docCache.delete(url);
      entry.destroy();
    }
  });

  // Evict least-recently-used beyond the cap (Map preserves insertion order).
  while (docCache.size > DOC_CACHE_MAX) {
    const oldestKey = docCache.keys().next().value as string;
    const oldest = docCache.get(oldestKey);
    docCache.delete(oldestKey);
    oldest?.destroy();
  }

  return entry.promise;
}

// ── Render helpers ────────────────────────────────────────────────────────────

/** J-book pages are 792pt wide (landscape letter) — highlight-math contract. */
const PAGE_WIDTH_PT = 792;
/** Extra backing-store resolution beyond devicePixelRatio (≥1.5× CSS width
 *  even at dpr=1) so small table glyphs stay crisp. */
const PANEL_OVERSAMPLE = 1.5;
/** Backing-store budget (~16 MP ≈ 64 MB RGBA) — clamps runaway zoom levels. */
const MAX_CANVAS_PIXELS = 16_000_000;

function deviceDpr(): number {
  return (typeof window !== "undefined" && window.devicePixelRatio) || 1;
}

/**
 * Kick off a PDF.js render of `page` into `canvas`.
 * The backing store is sized at (cssWidth / 792) × oversample, capped at
 * MAX_CANVAS_PIXELS; CSS sizing is left to the caller (the canvas keeps its
 * intrinsic aspect ratio when styled with a width).
 */
function startPageRender(
  page: PdfPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  oversample: number,
): RenderTask {
  let scale = (cssWidth / PAGE_WIDTH_PT) * oversample;
  const probe = page.getViewport({ scale });
  const pixels = probe.width * probe.height;
  if (pixels > MAX_CANVAS_PIXELS) {
    scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
  }
  const viewport = page.getViewport({ scale });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  // pdfjs-dist v6: `canvas` is the primary RenderParameters target; the 2D
  // context is derived internally (canvasContext is the legacy path).
  return page.render({ canvas, viewport });
}

/**
 * Strip the fragment portion (#page=N etc.) from a URL path.
 * pdf.js getDocument needs the bare URL.
 */
function stripFragment(url: string): string {
  const idx = url.indexOf("#");
  return idx === -1 ? url : url.slice(0, idx);
}

/** Numeric highlight rect (px) for scroll math — same geometry as
 *  pdfHighlightRect, which returns CSS strings. */
function highlightNumbers(
  citation: PdfPageCitation,
  cssWidth: number,
): { left: number; top: number; width: number; height: number } {
  const r = pdfHighlightRect(citation, cssWidth);
  return {
    left: parseFloat(r.left),
    top: parseFloat(r.top),
    width: parseFloat(r.width),
    height: parseFloat(r.height),
  };
}

/** Scroll `container` so the highlight center sits at the container center. */
function centerHighlight(
  container: HTMLElement,
  citation: PdfPageCitation,
  cssWidth: number,
): void {
  const h = highlightNumbers(citation, cssWidth);
  container.scrollTop = Math.max(
    0,
    h.top + h.height / 2 - container.clientHeight / 2,
  );
  container.scrollLeft = Math.max(
    0,
    h.left + h.width / 2 - container.clientWidth / 2,
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PdfViewProps {
  /**
   * Any PDF-page-renderable citation (structural): jbook_pdf always fits;
   * paged jbook_narrative citations fit via pagedNarrativeCitation()
   * (Phase 5F §2b — the narrative card reuses this whole view).
   */
  citation: PdfPageCitation;
  /** Official-source link label override (narrative card: "Open official
   *  source at p.N"). Defaults to the jbook_pdf wording. */
  officialLinkLabel?: string;
}

type ViewState = "loading" | "ready" | "error";

export function PdfView({ citation, officialLinkLabel }: PdfViewProps) {
  const assetUrl = useAssetUrl();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Bumped on every open — remounts the overlay via key, resetting its zoom
  // and render state without effect-driven resets.
  const [overlayEpoch, setOverlayEpoch] = useState(0);

  const pdfUrl = assetUrl(stripFragment(citation.hosted_pdf_url));

  // Measure container width once mounted
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setContainerWidth(width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Render the PDF page whenever containerWidth is known
  useEffect(() => {
    if (containerWidth <= 0) return;

    let renderTask: RenderTask | null = null;
    let cancelled = false;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setViewState("loading");
    setError(null);

    const pageNum = citation.page_number;

    (async () => {
      try {
        const pdfjs = await getPdfJs();
        if (cancelled) return;

        // Shared module-level cache — the doc (and its loading task) outlive
        // this component; cleanup below only cancels the render task.
        const pdf = await getCachedDocument(pdfjs, pdfUrl);
        if (cancelled) return;

        const page = await pdf.getPage(pageNum);
        if (cancelled) return;

        // Oversampled backing store; CSS width stays fit-to-panel (w-full).
        renderTask = startPageRender(
          page,
          canvas,
          containerWidth,
          deviceDpr() * PANEL_OVERSAMPLE,
        );
        await renderTask.promise;

        if (cancelled) return;
        setViewState("ready");
      } catch (err: unknown) {
        if (cancelled) return;
        // Don't fake success on render task cancellation errors
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "RenderingCancelledException"
        ) {
          return;
        }
        const msg =
          err instanceof Error ? err.message : "PDF render failed";
        setError(msg);
        setViewState("error");
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [containerWidth, citation, pdfUrl]);

  // Once rendered, auto-scroll the container so the cited cell is visible
  // without hunting (no-op when the whole page already fits).
  useEffect(() => {
    if (viewState !== "ready") return;
    const container = containerRef.current;
    if (!container || containerWidth <= 0) return;
    centerHighlight(container, citation, containerWidth);
  }, [viewState, citation, containerWidth]);

  // Compute highlight rect (needs containerWidth > 0 and successful render)
  const highlight =
    viewState === "ready" && containerWidth > 0
      ? pdfHighlightRect(citation, containerWidth)
      : null;

  const isAmbiguous = citation.resolution === "ambiguous_first";

  return (
    <div className="space-y-3">
      {/* Amount + units — prominent. The recorded amount_text stays primary;
          usdEquivalence adds a compact-USD parenthetical for ≥$1B millions
          values (e.g. "3,080.000 USD millions (= $3.08B)") so the panel
          reconciles with the surface card's compact figure. */}
      {citation.amount_text && (
        <div>
          <span className="text-xl font-semibold tabular-nums">
            {citation.amount_text}
          </span>
          {citation.units && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {citation.units}
            </span>
          )}
          {(() => {
            const eq = usdEquivalence(
              Number(citation.amount_text.replace(/,/g, "")),
              citation.units,
            );
            return eq ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({eq})
              </span>
            ) : null;
          })()}
        </div>
      )}

      {/* Ambiguous resolution badge */}
      {isAmbiguous && (
        <div
          data-testid="ambiguous-badge"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          role="note"
          aria-label="Ambiguous match: first matching page — see methodology"
        >
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>
            Ambiguous: first matching page — see methodology
          </span>
        </div>
      )}

      {/* PDF canvas with highlight overlay. The outer wrapper anchors the
          Enlarge button; the inner container scrolls (auto-centered on the
          highlight) when the rendered page overflows. */}
      <div className="relative">
        <div
          ref={containerRef}
          className={`relative w-full max-h-96 overflow-auto rounded-md border border-border bg-muted ${
            viewState !== "ready" ? "aspect-[792/612]" : ""
          }`}
          style={{ minHeight: "120px" }}
        >
          {/* Loading: page-shaped skeleton + explicit page number */}
          {viewState === "loading" && (
            <div
              data-testid="pdf-loading-skeleton"
              className="absolute inset-0 flex animate-pulse flex-col items-center justify-center gap-3 p-4"
              aria-label={`Loading PDF page ${citation.page_number}`}
            >
              <div className="w-full max-w-[85%] space-y-2" aria-hidden="true">
                <div className="h-2 w-3/5 rounded bg-border" />
                <div className="h-2 w-full rounded bg-border" />
                <div className="h-2 w-full rounded bg-border" />
                <div className="h-2 w-4/5 rounded bg-border" />
              </div>
              <p className="text-xs text-muted-foreground">
                Loading page {citation.page_number}…
              </p>
            </div>
          )}

          {/* Error state — never fake success.
              data-degraded="pdf": Phase 5C G3 contract — when the hosted PDF
              asset is unreachable the panel surfaces an explicit degraded
              state instead of a spinner. */}
          {viewState === "error" && (
            <div
              data-degraded="pdf"
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
            >
              <AlertCircle
                className="h-8 w-8 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                {"couldn't load the PDF — open the official source"}
              </p>
              {error && (
                /* text-muted-foreground/70 would fail WCAG AA; use full opacity */
                <p className="text-xs font-mono text-muted-foreground max-w-full truncate">
                  {error}
                </p>
              )}
              {citation.official_url && (
                <a
                  href={citation.official_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open official source
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              )}
            </div>
          )}

          {/* Canvas — crossfades in when the render completes (.pdf-page-fade
              tokens in globals.css, Phase 5C Task 11). display:none while
              erroring keeps the fallback in charge of layout. */}
          <canvas
            ref={canvasRef}
            className={
              viewState === "ready"
                ? "block w-full pdf-page-fade is-ready"
                : "block w-full pdf-page-fade"
            }
            style={{
              display: viewState === "error" ? "none" : "block",
            }}
            aria-label={`Budget justification PDF page ${citation.page_number}`}
          />

          {/* Highlight overlay */}
          {highlight && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: highlight.left,
                top: highlight.top,
                width: highlight.width,
                height: highlight.height,
                border: "2px solid rgb(217 119 6)", // amber-600
                borderRadius: "2px",
                backgroundColor: "rgba(251 191 36 / 0.15)", // amber-400/15
              }}
              aria-hidden="true"
              data-testid="pdf-highlight"
            />
          )}
        </div>

        {/* Enlarge — opens the full-screen zoom overlay. Anchored on the
            wrapper (not the scroll container) so it never scrolls away. */}
        {viewState === "ready" && (
          <button
            type="button"
            data-testid="pdf-enlarge"
            onClick={() => {
              setOverlayEpoch((e) => e + 1);
              setOverlayOpen(true);
            }}
            aria-haspopup="dialog"
            aria-label={`Enlarge PDF page ${citation.page_number}`}
            className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            Enlarge
          </button>
        )}
      </div>

      {/* Full-screen zoom overlay (portal — outside the panel DOM, so the
          receiptmoment/clickthrough canvas selectors stay unambiguous). */}
      <PdfZoomOverlay
        key={overlayEpoch}
        citation={citation}
        url={pdfUrl}
        open={overlayOpen}
        onOpenChange={setOverlayOpen}
      />

      {/* Official source link (always visible) */}
      {citation.official_url && (
        <a
          href={citation.official_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ExternalLink
            className="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="truncate">
            {officialLinkLabel ?? "Open in official source (PDF)"}
          </span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}
    </div>
  );
}

// ── PdfZoomOverlay — full-screen enlarge view with re-render zoom ────────────

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

interface PdfZoomOverlayProps {
  citation: PdfPageCitation;
  /** Resolved asset URL (fragment already stripped). */
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PdfZoomOverlay({
  citation,
  url,
  open,
  onOpenChange,
}: PdfZoomOverlayProps) {
  // Callback refs (state-backed): the dialog content mounts inside a Radix
  // portal/presence, so plain refs are not reliably populated when an
  // [open]-keyed effect fires — keying the effects on the elements is.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  // Last CSS width the canvas successfully rendered at. "ready"/"loading" are
  // DERIVED (renderedWidth vs pageCssWidth) so effects never set state
  // synchronously; the parent remounts this component (key=epoch) per open,
  // which also resets zoom to fit-to-width.
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [failed, setFailed] = useState(false);

  // Measure the scroll viewport (fit-to-width baseline).
  useEffect(() => {
    if (!open || !scrollEl) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setFitWidth(w);
    });
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [open, scrollEl]);

  // Page CSS width at the current zoom (1 = fit-to-width). fitWidth is the
  // ResizeObserver contentRect — the content box, i.e. the p-4 padding of
  // the scroll container is already excluded.
  const pageCssWidth = fitWidth > 0 ? Math.floor(fitWidth * zoom) : 0;

  const ready = !failed && pageCssWidth > 0 && renderedWidth === pageCssWidth;
  const loading = !failed && !ready;

  // (Re-)render at the current zoom — a real PDF.js re-render at the new
  // scale (dpr-aware, pixel-capped), never CSS upscaling.
  useEffect(() => {
    if (!open || pageCssWidth <= 0 || !canvasEl) return;

    let renderTask: RenderTask | null = null;
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await getPdfJs();
        if (cancelled) return;
        const pdf = await getCachedDocument(pdfjs, url);
        if (cancelled) return;
        const page = await pdf.getPage(citation.page_number);
        if (cancelled) return;

        renderTask = startPageRender(page, canvasEl, pageCssWidth, deviceDpr());
        await renderTask.promise;
        if (cancelled) return;
        setRenderedWidth(pageCssWidth);

        // Keep the cited cell in view at every scale.
        if (scrollEl) centerHighlight(scrollEl, citation, pageCssWidth);
      } catch (err: unknown) {
        if (cancelled) return;
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name: string }).name === "RenderingCancelledException"
        ) {
          return;
        }
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [open, pageCssWidth, url, citation, canvasEl, scrollEl]);

  const highlight =
    ready && pageCssWidth > 0
      ? pdfHighlightRect(citation, pageCssWidth)
      : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Dark scrim — token-driven fade (citation-panel-overlay keyframes
            run on var(--motion-slow)/var(--motion-base), globals.css). */}
        <DialogPrimitive.Overlay className="citation-panel-overlay fixed inset-0 z-[60] bg-black/70" />

        {/* Near-full-screen content; the visible scrim margin is the
            click-outside close target. Radix supplies Esc-to-close, focus
            trap, and aria-modal. */}
        <DialogPrimitive.Content
          data-testid="pdf-zoom-overlay"
          className="citation-panel-overlay fixed inset-2 z-[70] flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl outline-none sm:inset-8"
          aria-label={`Budget justification PDF page ${citation.page_number}, enlarged`}
          /* Radix conveys modality via aria-hidden on outside content;
             set aria-modal explicitly for AT that keys off the attribute. */
          aria-modal="true"
        >
          <DialogPrimitive.Title className="sr-only">
            Enlarged PDF page {citation.page_number}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Full-screen view of the cited budget justification page with zoom
            controls
          </DialogPrimitive.Description>

          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
            <span className="truncate text-sm font-medium">
              Page {citation.page_number}
              <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="pdf-zoom-out"
                onClick={() =>
                  setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))
                }
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
                className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                data-testid="pdf-zoom-in"
                onClick={() =>
                  setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))
                }
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
                className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
              <DialogPrimitive.Close
                aria-label="Close enlarged view"
                className="ml-1 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Scroll/pan viewport */}
          <div
            ref={setScrollEl}
            className="relative min-h-0 flex-1 overflow-auto bg-muted p-4"
          >
            {failed ? (
              <div
                role="alert"
                className="flex h-full flex-col items-center justify-center gap-2 text-center"
              >
                <AlertCircle
                  className="h-8 w-8 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  {"couldn't render the enlarged page"}
                </p>
              </div>
            ) : (
              <div
                className="relative mx-auto"
                style={{
                  width: pageCssWidth > 0 ? `${pageCssWidth}px` : undefined,
                }}
              >
                <canvas
                  ref={setCanvasEl}
                  className={
                    ready
                      ? "block w-full pdf-page-fade is-ready"
                      : "block w-full pdf-page-fade"
                  }
                  aria-label={`Budget justification PDF page ${citation.page_number}, enlarged`}
                />
                {highlight && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: highlight.left,
                      top: highlight.top,
                      width: highlight.width,
                      height: highlight.height,
                      border: "2px solid rgb(217 119 6)", // amber-600
                      borderRadius: "2px",
                      backgroundColor: "rgba(251 191 36 / 0.15)", // amber-400/15
                    }}
                    aria-hidden="true"
                    data-testid="pdf-zoom-highlight"
                  />
                )}
                {loading && (
                  <div
                    className="absolute inset-x-0 top-8 flex justify-center"
                    aria-label={`Loading PDF page ${citation.page_number}`}
                  >
                    <span className="animate-pulse rounded-md border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                      Loading page {citation.page_number}…
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
