"use client";

/**
 * NarrativeSourceChip (Phase 5F §2b) — per-paragraph citation chip for
 * J-book narrative prose. Opens the citation panel on the paragraph's
 * jbook_narrative fact — which now renders the source page with the
 * passage-start highlight (see jbook-narrative-card.tsx).
 *
 * Not a currency element: carries data-fact-id but never data-amount, so it
 * is legal inside the data-source-text subtree (render-static a0).
 */

import React, { useContext } from "react";
import { CitationPanelContext } from "@/components/cite";

export function NarrativeSourceChip({ factId }: { factId: string }) {
  const { openPanel } = useContext(CitationPanelContext);
  return (
    <button
      type="button"
      data-narrative-chip=""
      data-fact-id={factId}
      className="ml-1.5 inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1 py-0.5 font-mono text-[10px] text-amber-700 align-middle whitespace-nowrap cursor-pointer hover:bg-amber-100 transition-colors"
      title="View this passage in the official J-book (page render with the paragraph highlighted)"
      aria-label="View source citation for this passage"
      onClick={(e) => {
        // Chips render inside <summary> for accomplishments — opening the
        // panel must not also toggle the <details> disclosure.
        e.preventDefault();
        e.stopPropagation();
        openPanel(factId);
      }}
    >
      source
    </button>
  );
}
