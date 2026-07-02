"use client";

/**
 * pdf-view.tsx — PDF.js viewer for jbook_pdf citations with bbox highlight.
 *
 * Contract (per plan):
 *   - GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
 *   - getDocument({ url: assetUrl(stripFragment(hosted_pdf_url)) })
 *     (useAssetUrl; hosted_pdf_url starts '/pdfs/'; the #page=N fragment is
 *     stripped for getDocument, page_number field is used instead)
 *   - Render page_number to canvas at scale = containerWidth / 792
 *   - Highlight div absolutely positioned at:
 *       left:  x0 * scale - 2
 *       top:   top_pt * scale - 2
 *       width: (x1 - x0) * scale + 4
 *       height:(bottom_pt - top_pt) * scale + 4
 *     (2px pad; amber outline)
 *   - resolution === 'ambiguous_first' → amber badge
 *     "first matching page — see methodology"
 *   - StrictMode-safe: renderTask.cancel() + loadingTask.destroy() in cleanup
 *   - Loading skeleton while rendering
 *   - Error state: "couldn't load the PDF — open the official source"
 *     with official link. NEVER fake success.
 *   - amount_text + units displayed prominently
 */

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import type { JbookPdfCitation } from "@/lib/data";
import { pdfHighlightRect } from "@/lib/citations";
import { useAssetUrl } from "@/components/asset-config";

// ── PDF.js lazy import ───────────────────────────────────────────────────────
// Imported dynamically to avoid SSR issues (PDF.js expects browser globals).
// pdfjs-dist v6: PDFDocumentLoadingTask has destroy() — cancels the HTTP fetch,
// tears down the worker channel, and supersedes cleanup().
// RenderParameters requires `canvas: HTMLCanvasElement | null`.

type PdfDocProxy = import("pdfjs-dist").PDFDocumentProxy;
type RenderTask = import("pdfjs-dist").RenderTask;

// Cached promise for the pdfjs module — only import once.
let _pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function getPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return _pdfjsPromise;
}

/**
 * Strip the fragment portion (#page=N etc.) from a URL path.
 * pdf.js getDocument needs the bare URL.
 */
function stripFragment(url: string): string {
  const idx = url.indexOf("#");
  return idx === -1 ? url : url.slice(0, idx);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PdfViewProps {
  citation: JbookPdfCitation;
}

type ViewState = "loading" | "ready" | "error";

export function PdfView({ citation }: PdfViewProps) {
  const assetUrl = useAssetUrl();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

    let pdf: PdfDocProxy | null = null;
    let renderTask: RenderTask | null = null;
    let loadingTask: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | null = null;
    let cancelled = false;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setViewState("loading");
    setError(null);

    const pdfPath = stripFragment(citation.hosted_pdf_url);
    const url = assetUrl(pdfPath);
    const pageNum = citation.page_number;

    (async () => {
      try {
        const pdfjs = await getPdfJs();
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({ url });
        pdf = await loadingTask.promise;
        if (cancelled) {
          // destroy() cancels the HTTP fetch + worker channel and tears down the
          // document; supersedes cleanup() in pdfjs v6.
          loadingTask.destroy().catch(() => {});
          return;
        }

        const page = await pdf.getPage(pageNum);
        if (cancelled) {
          loadingTask.destroy().catch(() => {});
          return;
        }

        // Scale to container width (page is 792pt wide)
        const scale = containerWidth / 792;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext("2d");
        if (!ctx || cancelled) {
          loadingTask.destroy().catch(() => {});
          return;
        }

        // pdfjs-dist v6: RenderParameters requires `canvas` (HTMLCanvasElement | null)
        // plus optional `canvasContext`
        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
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
      loadingTask?.destroy().catch(() => {});
    };
  }, [containerWidth, citation, assetUrl]);

  // Compute highlight rect (needs containerWidth > 0 and successful render)
  const highlight =
    viewState === "ready" && containerWidth > 0
      ? pdfHighlightRect(citation, containerWidth)
      : null;

  const isAmbiguous = citation.resolution === "ambiguous_first";

  return (
    <div className="space-y-3">
      {/* Amount + units — prominent */}
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

      {/* PDF canvas with highlight overlay */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-md border border-border bg-muted"
        style={{ minHeight: "120px" }}
      >
        {/* Loading skeleton */}
        {viewState === "loading" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            aria-label="Loading PDF page"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        )}

        {/* Error state — never fake success */}
        {viewState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
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
            loading keeps the skeleton's min-height in charge of layout. */}
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
          <span className="truncate">Open in official source (PDF)</span>
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}
    </div>
  );
}
