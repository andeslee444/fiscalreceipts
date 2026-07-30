"use client";

/**
 * ReceiptMoment — the home page's above-the-fold hero card
 * (Phase 5C Goal 1 + PM Sprint 1 §P0-5).
 *
 * §P0-5: the hero's headline figure is the CANONICAL BASIS — Total
 * Obligation Authority from the site_meta hero payload ("it is what
 * Congress provides"), with its workbook fact, basis chip, and the corpus
 * scope qualifier rendered as small print by the page below the card. The
 * old unqualified "largest FY2024 actual in the J-books — $5.25B" claim was
 * the narrower Net-Procurement basis AND scope-unqualified — the single
 * most prominent number on the site contradicted the program page.
 *
 * Goal 1 (G4 gate) is unchanged: the card still stages a REAL PDF receipt —
 * the same program-year's P-40 line, whose jbook_pdf citation renders the
 * actual page + highlight. That receipt strip is the card's FIRST
 * [data-fact-id] (the gate clicks it) and doubles as the honest two-basis
 * reconciliation: net procurement (P-40, printed on the page) vs TOA (P-1
 * workbook, the headline).
 *
 * Contract: the card wrapper carries data-testid="receipt-moment" (G4 gate).
 * Figures and the button are SIBLING interactive elements (never nested —
 * axe flags nested-interactive, same rule as the movers list).
 */

import { useContext } from "react";
import Link from "next/link";
import { Cite, CitationPanelContext } from "@/components/cite";
import { RECEIPT_MOMENT_FY_LABEL } from "@/lib/site";
import type { SiteMetaHero } from "@/lib/data";

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
  /**
   * §P0-5 canonical-TOA hero payload (site_meta.hero). Rendered as the
   * headline figure when it covers the SAME program (live: both are the
   * F-35); the caller guarantees hero.fid is in the citation slice. Null →
   * the card falls back to the P-40 figure as its headline.
   */
  hero?: SiteMetaHero | null;
}

export function ReceiptMoment({
  peBli,
  title,
  org,
  amountMillions,
  factId,
  hero,
}: ReceiptMomentProps) {
  const { openPanel } = useContext(CitationPanelContext);
  const showToaHeadline = hero != null && hero.pe_bli === peBli;

  return (
    <div
      data-testid="receipt-moment"
      className="rounded-xl border border-border bg-card px-5 py-5 md:px-8 md:py-6 interactive-raise"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        {showToaHeadline
          ? `Largest ${RECEIPT_MOMENT_FY_LABEL} program element in our corpus`
          : `Largest ${RECEIPT_MOMENT_FY_LABEL} actual in the J-books`}
      </p>

      {/* The receipt strip — the P-40 net-procurement line, PRINTED on the
          PDF page (jbook_pdf fact = the card's first data-fact-id; the G4
          gate clicks it and asserts the rendered page + highlight). Also the
          honest second basis for the TOA headline below. */}
      {showToaHeadline && (
        <p className="mb-1.5 text-xs leading-5 text-muted-foreground">
          Printed on the P-40 page:{" "}
          <Cite
            value={amountMillions}
            units="USD millions"
            dataset="jbook_details"
            factId={factId}
            basis="jbook-detail"
            fy={hero.fy}
            measure={hero.measure}
            edition={hero.edition}
          />{" "}
          net procurement — the workbook total below adds advance-procurement
          rows.
        </p>
      )}

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0">
          {/* Big cited figure — canonical TOA (chip: P-1 TOA · PB2026). */}
          <p className="text-3xl md:text-5xl font-bold font-mono tabular-nums leading-none">
            {showToaHeadline ? (
              <Cite
                value={hero.value}
                units={hero.units}
                dataset={hero.dataset}
                factId={hero.fid}
                basis={hero.basis}
                fy={hero.fy}
                measure={hero.measure}
                edition={hero.edition}
              />
            ) : (
              <Cite
                value={amountMillions}
                units="USD millions"
                dataset="jbook_details"
                factId={factId}
              />
            )}
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
