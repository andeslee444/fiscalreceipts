"use client";

/**
 * <Cite> — THE THREE-STATE CONTRACT
 *
 * Every rendered dollar/fiscal figure on the site MUST be wrapped in <Cite>.
 * The three states are defined by props:
 *
 * State A — cited (factId resolves in citations.json):
 *   <span data-amount data-fact-id={factId}>
 *   Clicking/entering opens the citation panel via CitationPanelContext.
 *   Caller GUARANTEES factId resolves in citations.json.
 *
 * State B — xml-path (zero_amount jbook facts: no citation row, but xml_path known):
 *   <span data-amount data-citation-kind="xml-path" data-xml-path={xmlPath}>
 *   Renders value + a small chip showing the xml path.
 *   Title attr explains: "cited to the budget justification XML — zero-dollar line, no page highlight"
 *   No panel opens.
 *
 * State C — uncited (no factId, no xmlPath):
 *   <span data-amount data-uncited="true">
 *   Renders value + visible ⁂ symbol + tooltip "citation tier pending — see methodology".
 *   No panel opens.
 *
 * Decision order: A if factId, else B if xmlPath, else C.
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
// Task 5 implements the real panel; for now, a no-op default.

interface CitationPanelContextValue {
  openPanel: (factId: string) => void;
}

export const CitationPanelContext = createContext<CitationPanelContextValue>({
  openPanel: (factId: string) => {
    console.warn(
      `[Cite] openPanel("${factId}") called without a CitationPanelContext.Provider`,
    );
  },
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
   * State A: fact_id that resolves in citations.json.
   * Caller guarantees this resolves. If provided, overrides xmlPath.
   */
  factId?: string | null;
  /**
   * State B: XML xpath string for zero-amount jbook facts.
   * Used when factId is absent but an xml_path is known from jbook_details.
   */
  xmlPath?: string | null;
  /** Additional className for the outer span. */
  className?: string;
}

/**
 * Render a cited monetary amount with full three-state provenance signaling.
 *
 * The rendered span ALWAYS has:
 *   - data-amount (no value — presence-only marker)
 *   - title={exactTitle(value, units)} for screen readers / hover
 *
 * Plus state-specific attributes as documented above.
 */
export function Cite({ value, units, factId, xmlPath, className }: CiteProps) {
  const { openPanel } = useContext(CitationPanelContext);
  const { receiptsOn } = useContext(ReceiptsContext);

  const display = formatAmount(value, units);
  const title = exactTitle(value, units);

  // ── State A: cited ───────────────────────────────────────────────────────
  if (factId) {
    const shortId = factId.slice(-8);
    return (
      <span
        data-amount
        data-fact-id={factId}
        title={title}
        className={[
          "cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid",
          "text-foreground",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="button"
        tabIndex={0}
        aria-label={`${display} — click to view citation`}
        onClick={() => openPanel(factId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPanel(factId);
          }
        }}
      >
        {display}
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
        title={title}
        className={["text-foreground", className].filter(Boolean).join(" ")}
        aria-label={`${display} — zero-dollar line cited to budget justification XML`}
      >
        {display}
        <span
          className="ml-1 inline-block rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] text-amber-700 align-middle"
          title="cited to the budget justification XML — zero-dollar line, no page highlight"
          aria-hidden="true"
        >
          {xmlPath}
        </span>
      </span>
    );
  }

  // ── State C: uncited ─────────────────────────────────────────────────────
  return (
    <span
      data-amount
      data-uncited="true"
      title={title}
      className={["text-foreground", className].filter(Boolean).join(" ")}
      aria-label={`${display} — citation tier pending`}
    >
      {display}
      <span
        className={[
          "ml-0.5 text-muted-foreground",
          receiptsOn ? "after:content-['uncited']" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title="citation tier pending — see methodology"
        aria-hidden="true"
      >
        ⁂{receiptsOn && <span className="ml-0.5 text-[10px]">uncited</span>}
      </span>
    </span>
  );
}
