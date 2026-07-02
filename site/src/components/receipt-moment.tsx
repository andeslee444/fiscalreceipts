"use client";

/**
 * ReceiptMoment — the home page's above-the-fold "receipt moment"
 * (Phase 5C Goal 1).
 *
 * Stages the largest FY2024-actuals figure that carries a jbook_pdf citation
 * (selected at build time by getReceiptMomentFact() in lib/data.ts) with an
 * explicit invitation to open the citation panel: "See the page it's printed
 * on →". Because the fact kind is jbook_pdf, the panel renders the actual
 * PDF page with the amber bbox highlight — the number IS printed on the page
 * (spec Goal 1: "opens the citation panel with the PDF page + highlight").
 * Both the figure (via <Cite>, the standard three-state renderer) and the
 * invitation button open the SAME citation panel through the existing
 * CitationPanelContext — no new citation path is introduced.
 *
 * Contract: the card wrapper carries data-testid="receipt-moment" (G4 gate).
 * The figure and the button are SIBLING interactive elements (never nested —
 * axe flags nested-interactive, same rule as the movers list).
 */

import { useContext } from "react";
import Link from "next/link";
import { Cite, CitationPanelContext } from "@/components/cite";
import { RECEIPT_MOMENT_FY_LABEL } from "@/lib/site";

export interface ReceiptMomentProps {
  /** Program element / budget line item id (links to the program page). */
  peBli: string;
  /** Program title. */
  title: string;
  /** Owning organization (e.g. "MDA"). */
  org: string;
  /** FY2024 actuals, USD millions (J-book detail row units). */
  amountMillions: number;
  /**
   * jbook_pdf citation fact_id. Caller guarantees it resolves in the page's
   * citation slice (same guarantee as every other <Cite>).
   */
  factId: string;
}

export function ReceiptMoment({
  peBli,
  title,
  org,
  amountMillions,
  factId,
}: ReceiptMomentProps) {
  const { openPanel } = useContext(CitationPanelContext);

  return (
    <div
      data-testid="receipt-moment"
      className="rounded-xl border border-border bg-card px-5 py-5 md:px-8 md:py-6 interactive-raise"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Largest {RECEIPT_MOMENT_FY_LABEL} actual in the J-books
      </p>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0">
          {/* Big cited figure — clicking opens the PDF page it's printed on. */}
          <p className="text-3xl md:text-5xl font-bold font-mono tabular-nums leading-none">
            <Cite
              value={amountMillions}
              units="USD millions"
              dataset="jbook_details"
              factId={factId}
            />
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link
              href={`/program/${peBli}/`}
              className="font-medium text-foreground hover:underline"
            >
              {title}
            </Link>
            <span className="ml-2 font-mono text-xs">{peBli}</span>
            <span className="ml-2 text-xs">{org}</span>
          </p>
        </div>
        <button
          onClick={() => openPanel(factId)}
          className="shrink-0 inline-flex items-center justify-center rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors"
          aria-label="Open the citation panel showing the source page this figure is printed on"
        >
          See the page it&apos;s printed on &rarr;
        </button>
      </div>
    </div>
  );
}
