"use client";

/**
 * <ProseCite> — state-A citation for a dollar token INSIDE quoted source
 * text (Phase 5F §2c).
 *
 * Narrative bodies live in [data-source-text] subtrees, where the
 * render-static a0 contract forbids [data-amount] descendants (computed
 * figures may not hide inside source prose). A prose amount link is therefore
 * NOT a <Cite>: it renders as data-prose-cite + data-fact-id — the render
 * gate's prose-cite leg asserts every such fact_id resolves in
 * citations.json — and behaves like state A (dotted underline, opens the
 * citation panel).
 *
 * The token text is the SOURCE's own string, rendered verbatim — never
 * reformatted.
 */

import React, { useContext } from "react";
import { CitationPanelContext } from "@/components/cite";

export function ProseCite({
  factId,
  children,
}: {
  /** Citation fact_id — the exporter guarantees it resolves (§2c: exact
   *  canonical match to a fact amount scoped to the same PE). */
  factId: string;
  children: React.ReactNode;
}) {
  const { openPanel } = useContext(CitationPanelContext);
  return (
    <span
      data-prose-cite=""
      data-fact-id={factId}
      role="button"
      tabIndex={0}
      aria-label="View citation for this figure"
      title="This figure in the source text matches a cited fact — click to view the citation"
      className="cursor-pointer underline decoration-dotted decoration-(--cite-decoration) underline-offset-2 hover:decoration-solid hover:decoration-(--cite-decoration-hover) focus-visible:decoration-solid focus-visible:decoration-(--cite-decoration-hover) interactive-raise"
      onClick={() => openPanel(factId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPanel(factId);
        }
      }}
    >
      {children}
    </span>
  );
}
