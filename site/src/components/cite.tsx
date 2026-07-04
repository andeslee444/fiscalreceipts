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

// ── Citation Panel Context ─────────────────────────────────────────────────
// The panel provider (citation-panel/panel.tsx) implements the real openPanel.

interface CitationPanelContextValue {
  openPanel: (factId: string) => void;
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
}: CiteProps) {
  const { openPanel } = useContext(CitationPanelContext);
  const { receiptsOn } = useContext(ReceiptsContext);

  const displayText = display ?? formatAmount(value, units);
  const title = display ?? exactTitle(value, units);

  // ── State A: cited ───────────────────────────────────────────────────────
  if (factId) {
    const shortId = factId.slice(-8);
    return (
      <span
        data-amount
        data-fact-id={factId}
        data-dataset={dataset}
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
        onClick={() => openPanel(factId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPanel(factId);
          }
        }}
      >
        {displayText}
        {receiptsOn && (
          <span
            className="ml-1 inline-block rounded bg-blue-100 px-1 py-0.5 font-mono text-[10px] text-blue-700 align-middle"
            aria-hidden="true"
          >
            #{shortId}
          </span>
        )}
      </span>
    );
  }

  // ── State B: xml-path chip ───────────────────────────────────────────────
  if (xmlPath) {
    return (
      <span
        data-amount
        data-citation-kind="xml-path"
        data-xml-path={xmlPath}
        data-dataset={dataset}
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
    );
  }

  // ── State C: uncited ─────────────────────────────────────────────────────
  return (
    <span
      data-amount
      data-uncited="true"
      data-dataset={dataset}
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
  );
}
