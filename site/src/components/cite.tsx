"use client";

/**
 * <Cite> — THE THREE-STATE CONTRACT
 *
 * Every rendered dollar/fiscal figure on the site MUST be wrapped in <Cite>.
 * The three states are defined by props:
 *
 * State A — cited (factId resolves in citations.json):
 *   <span data-amount data-fact-id={factId} data-dataset={dataset}>
 *   Clicking/entering opens the citation panel via CitationPanelContext.
 *   Caller GUARANTEES factId resolves in citations.json.
 *
 * State B — xml-path (zero_amount jbook facts: no citation row, but xml_path known):
 *   <span data-amount data-citation-kind="xml-path" data-xml-path={xmlPath} data-dataset={dataset}>
 *   Renders value + a small chip showing the xml path.
 *   Title attr explains: "cited to the budget justification XML — zero-dollar line, no page highlight"
 *   No panel opens.
 *
 * State C — uncited (no factId, no xmlPath):
 *   <span data-amount data-uncited="true" data-dataset={dataset}>
 *   Renders value + visible ⁂ symbol + tooltip "citation tier pending — see methodology".
 *   No panel opens.
 *
 * Decision order: A if factId, else B if xmlPath, else C.
 *
 * dataset (REQUIRED) — the warehouse dataset the VALUE came from (e.g.
 * 'fct_budget_trajectory', 'jbook_details', 'dim_entities'). Emitted as
 * data-dataset on ALL three states. The render-static dataset-ledger gate
 * enforces: state C is only allowed for datasets on site_meta.uncited_datasets,
 * and state A is forbidden for datasets still on that ledger.
 *
 * Receipts mode (ReceiptsContext):
 *   When ON:
 *     State A: shows short fact-id chip inline (last 8 chars of factId)
 *     State B: xml-path chip is always visible anyway (no change)
 *     State C: the ⁂ gains a visible "uncited" text label
 */

import React, { createContext, useContext } from "react";
import { formatAmount, exactTitle, type AmountUnits } from "@/lib/format";
import type { FootnoteFigure } from "@/lib/footnote";

// ── Citation Panel Context ─────────────────────────────────────────────────
// The panel provider (citation-panel/panel.tsx) implements the real openPanel.

interface CitationPanelContextValue {
  /**
   * Open the citation panel for a fact. `figure` is the clicked figure's own
   * declared context (value/units/fy/measure/basis/entity/edition — the same
   * vocabulary as the data-* attributes) — the copy-as-footnote formatter
   * (§P0-3) needs it because the citation payload alone cannot supply the
   * fiscal year or row identity. Optional: drill-down opens (derived-input
   * chips) have no figure context and the footnote omits those fields.
   */
  openPanel: (factId: string, figure?: FootnoteFigure) => void;
  /**
   * True when the given fact_id is available in the current page's citation
   * slice (derived-card input chips use this to decide clickability).
   * Optional — consumers treat a missing implementation as "not available".
   */
  hasCitation?: (factId: string) => boolean;
}

export const CitationPanelContext = createContext<CitationPanelContextValue>({
  openPanel: (factId: string) => {
    console.warn(
      `[Cite] openPanel("${factId}") called without a CitationPanelContext.Provider`,
    );
  },
  hasCitation: () => false,
});

// ── Receipts Context ───────────────────────────────────────────────────────

interface ReceiptsContextValue {
  receiptsOn: boolean;
}

export const ReceiptsContext = createContext<ReceiptsContextValue>({
  receiptsOn: false,
});

// ── Basis vocabulary (PM Sprint 1 — spec §P0-1, gate 23 legs a1/a2) ────────
//
// Every figure that has a declared basis carries data-basis / data-fy /
// data-measure (+ data-entity when component-scoped) and renders a small
// ALWAYS-VISIBLE basis chip: `P-1 TOA · PB2026` (toa) / `P-40 detail ·
// PB2026` (jbook-detail). Extended measure tokens (component pots that
// legitimately differ from a headline value) render their human label inside
// the chip. Non-budget figures (USAspending-derived award aggregates) carry
// source-family tokens ('usaspending') and no chip — the two budget bases
// are the only chip vocabulary.
//
// CONTRACT: the chip is a SIBLING of the [data-amount] element, never inside
// it. Gate 23 parses the [data-amount] element's rendered text as a single
// currency figure (normalizeAmount) — chip text inside the span would null
// every parse and silently blind the collision/agreement legs.

const BASIS_LABEL: Record<string, string> = {
  toa: "P-1 TOA",
  "jbook-detail": "P-40 detail",
};

/**
 * Human labels for the extended measure tokens, mirroring the exporter's
 * `_amount_type_meta` / `_scenario_meta` slug decisions (export_site.py).
 * Core tokens (actuals/enacted/request/total/change) are conveyed by the
 * surrounding label (card title, table header) and stay OUT of the chip.
 */
const EXTENDED_MEASURE_LABEL: Record<string, string> = {
  "disc-request": "discretionary request",
  "reconciliation-request": "reconciliation request",
  supplemental: "supplemental",
  "base-request": "base request",
  "all-prior-years": "all prior years",
  // decade-grid kind-qualified tokens (_decade_measure_token): rendered
  // under one row label, sourced from a diverging column
  "enacted-request": "enacted (request column)",
  "enacted-total": "enacted (book total)",
  "actuals-base-oco": "actuals (base + OCO)",
  "request-total-base-oco": "request (base + OCO total)",
};

const CORE_MEASURES = new Set([
  "actuals",
  "enacted",
  "request",
  "total",
  "change",
]);

/** Chip text: basis label, extended-measure label when applicable, edition. */
export function basisChipText(
  basis: string,
  measure?: string,
  edition?: number,
): string | null {
  const basisLabel = BASIS_LABEL[basis];
  if (!basisLabel) return null; // non-budget bases render no chip
  const parts = [basisLabel];
  if (measure && !CORE_MEASURES.has(measure)) {
    parts.push(
      EXTENDED_MEASURE_LABEL[measure] ?? measure.replace(/-/g, " "),
    );
  }
  if (edition) parts.push(`PB${edition}`);
  return parts.join(" · ");
}

// ── Cite Props ─────────────────────────────────────────────────────────────

export interface CiteProps {
  /** The numeric value to display. */
  value: number;
  /** Units (NEVER inferred — always declared by the data source). */
  units: AmountUnits;
  /**
   * REQUIRED: name of the dataset the value came from — emitted as
   * data-dataset on all three states (dataset-ledger render gate).
   */
  dataset: string;
  /**
   * State A: fact_id that resolves in citations.json.
   * Caller guarantees this resolves. If provided, overrides xmlPath.
   */
  factId?: string | null;
  /**
   * State B: XML xpath string for zero-amount jbook facts.
   * Used when factId is absent but an xml_path is known from jbook_details.
   */
  xmlPath?: string | null;
  /**
   * Optional display override for non-currency figures (e.g. an HHI index).
   * When set, this string is rendered instead of formatAmount(value, units),
   * and the title attribute is the override verbatim (units are shown in the
   * citation panel instead).
   */
  display?: string;
  /** Additional className for the outer span. */
  className?: string;
  /**
   * Basis threading (gate 23 leg a1 — 100% coverage on program pages):
   * 'toa' | 'jbook-detail' for budget figures; source-family tokens (e.g.
   * 'usaspending') for non-budget figures. Emitted as data-basis.
   */
  basis?: string;
  /** Fiscal year (data-fy). Non-FY aggregates pass an honest token
   *  ('all-years' for award aggregates, 'all' for cumulative J-book rows). */
  fy?: number | string | null;
  /** Measure token (data-measure) — see the exporter's basis vocabulary. */
  measure?: string | null;
  /**
   * Gate-23 grouping scope (data-entity). Omit for program-level figures —
   * the gate falls back to the page's PE; pass the payload's component
   * entity ('{pe}/{project}', '{pe}/{org}/{acct}/…') for component rows.
   */
  entity?: string | null;
  /** PB edition year — rendered inside the basis chip ("· PB2026"). */
  edition?: number | null;
  /**
   * True when this figure is a member of a DECLARED (fy, measure)
   * reconciliation group (the sidecar's reconciliation payload) — emits
   * data-reconciliation so gate 23 leg a2 sees the collision declared.
   */
  reconciled?: boolean;
  /**
   * Basis chip visibility. Defaults to true (chip renders whenever the basis
   * has a chip label). Dense table/grid cells pass false and declare the
   * basis once at section level instead — REQUIRED for cells gate 23 leg b
   * reads as FY evidence (decade cells, FY-labeled table columns), where
   * sibling chip text inside the cell would null the gate's value parse.
   */
  chip?: boolean;
}

/**
 * <CiteLegend> — one-line legend decoding the three Cite states (visual-judge
 * M2 finding: the honesty markers were unexplained at the point of use).
 * Rendered near the /years/ table controls and in the breakdown overlay
 * header. Each marker is shown with its real visual treatment so the legend
 * doubles as a swatch.
 */
export function CiteLegend({ className }: { className?: string }) {
  return (
    <p
      data-testid="cite-legend"
      className={[
        "text-[11px] leading-5 text-muted-foreground",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="underline decoration-dotted underline-offset-2">
        dotted underline
      </span>
      {" = cited (click for source) · "}
      <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-700">
        XML
      </span>
      {" = zero in source XML · "}
      <span>⁂</span>
      {" = uncited input (still counted)"}
    </p>
  );
}

/**
 * Render a cited monetary amount with full three-state provenance signaling.
 *
 * The rendered span ALWAYS has:
 *   - data-amount (no value — presence-only marker)
 *   - data-dataset={dataset}
 *   - title={exactTitle(value, units)} for screen readers / hover
 *
 * Plus state-specific attributes as documented above.
 */
export function Cite({
  value,
  units,
  dataset,
  factId,
  xmlPath,
  display,
  className,
  basis,
  fy,
  measure,
  entity,
  edition,
  reconciled,
  chip = true,
}: CiteProps) {
  const { openPanel } = useContext(CitationPanelContext);
  const { receiptsOn } = useContext(ReceiptsContext);

  const displayText = display ?? formatAmount(value, units);
  const title = display ?? exactTitle(value, units);

  // Basis attrs — shared by all three states (gate 23 leg a1 requires them
  // on EVERY [data-amount] on program pages, states B/C included).
  const basisAttrs: Record<string, string> = {};
  if (basis) basisAttrs["data-basis"] = basis;
  if (fy != null) basisAttrs["data-fy"] = String(fy);
  if (measure) basisAttrs["data-measure"] = measure;
  if (entity) basisAttrs["data-entity"] = entity;
  if (reconciled) basisAttrs["data-reconciliation"] = "";

  // The always-visible basis chip — SIBLING of [data-amount], see contract
  // note above. ≥12px (text-xs) per P1-1: 10px provenance chips are banned.
  const chipText = basis && chip ? basisChipText(basis, measure ?? undefined, edition ?? undefined) : null;
  const basisChip = chipText ? (
    <span className="ml-1 inline-block whitespace-nowrap rounded border border-border bg-muted px-1 py-0.5 align-middle font-sans text-xs font-normal leading-none text-muted-foreground no-underline">
      {chipText}
    </span>
  ) : null;

  // ── State A: cited ───────────────────────────────────────────────────────
  if (factId) {
    // PUBLIC id (P0-4): fid[:8] — the SAME truncation the citation drawer
    // shows (panel.tsx factId.slice(0, 8)) and the /fact/{id8} permalink
    // uses. Never re-slice differently: the live chip/drawer id mismatch
    // (#8b2746cb vs #bb54b165) was two truncations of one id.
    const publicId = factId.slice(0, 8);
    // Figure context for the copy-as-footnote formatter (§P0-3): thread the
    // figure's own declared basis vocabulary through the panel open call.
    const figureCtx: FootnoteFigure = {
      value,
      units,
      display: display ?? null,
      fy: fy ?? null,
      measure: measure ?? null,
      basis: basis ?? null,
      entity: entity ?? null,
      edition: edition ?? null,
    };
    return (
      <>
      <span
        data-amount
        data-fact-id={factId}
        data-dataset={dataset}
        {...basisAttrs}
        title={title}
        className={[
          "cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid",
          // Shared motion-system hover raise (globals.css .interactive-raise,
          // Phase 5C Task 11) — inline-block so transform applies to the span.
          "interactive-raise",
          "text-foreground",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="button"
        tabIndex={0}
        aria-label={`${displayText} — click to view citation`}
        onClick={() => openPanel(factId, figureCtx)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPanel(factId, figureCtx);
          }
        }}
      >
        {displayText}
        {receiptsOn && (
          <span
            className="ml-1 inline-block rounded bg-blue-100 px-1 py-0.5 font-mono text-[10px] text-blue-700 align-middle"
            aria-hidden="true"
          >
            #{publicId}
          </span>
        )}
      </span>
      {basisChip}
      </>
    );
  }

  // ── State B: xml-path chip ───────────────────────────────────────────────
  if (xmlPath) {
    return (
      <>
      <span
        data-amount
        data-citation-kind="xml-path"
        data-xml-path={xmlPath}
        data-dataset={dataset}
        {...basisAttrs}
        title={title}
        className={["text-foreground", className].filter(Boolean).join(" ")}
        aria-label={`${displayText} — cited to budget justification XML (no page highlight)`}
      >
        {displayText}
        {/* Human label by default — the raw XML anchor reads like an error to
            visitors. The full path stays in data-xml-path (gate contract) and
            the tooltip; receipts mode surfaces it inline for power users.
            Covers both state-B origins: zero-dollar lines and 'unresolved'
            facts (non-zero, but no PDF bbox found) — neither has a page cite. */}
        <span
          className="ml-1 inline-block rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-700 align-middle"
          title={`cited to the budget justification XML at ${xmlPath} — no page highlight`}
          aria-hidden="true"
        >
          {receiptsOn ? xmlPath : "XML"}
        </span>
      </span>
      {basisChip}
      </>
    );
  }

  // ── State C: uncited ─────────────────────────────────────────────────────
  return (
    <>
    <span
      data-amount
      data-uncited="true"
      data-dataset={dataset}
      {...basisAttrs}
      title={title}
      className={["text-foreground", className].filter(Boolean).join(" ")}
      aria-label={`${displayText} — citation tier pending`}
    >
      {displayText}
      {receiptsOn ? (
        <span
          className="ml-0.5 inline-flex items-baseline whitespace-nowrap rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-700 align-middle"
          title="citation tier pending — see methodology"
          aria-hidden="true"
        >
          ⁂ uncited
        </span>
      ) : (
        <span
          className="ml-0.5 text-muted-foreground"
          title="citation tier pending — see methodology"
          aria-hidden="true"
        >
          ⁂
        </span>
      )}
    </span>
    {basisChip}
    </>
  );
}
