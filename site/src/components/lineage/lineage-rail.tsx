"use client";

/**
 * <LineageRail> — the program-page lineage rail (program-lineage Task 7).
 *
 * Renders predecessors → THIS program → successors as an evidence-tiered
 * money-flow chain. The three honesty treatments are load-bearing:
 *
 *   - STATED edge (confidence "stated"): a solid entry whose source sentence is
 *     citable. A small clickable citation marker opens the citation panel on
 *     evidence.fact_id (no amount to show — mirrors NarrativeSourceChip /
 *     ProseCite, which cite a sentence, not a figure).
 *
 *   - INFERRED edge (confidence "inferred"): NO citation exists. Rendered dashed
 *     / amber, carries data-inferred="true", shows a visible
 *     "candidate (unverified)" label, and lives inside a COLLAPSED
 *     <details>"Show possible connections" disclosure — opt-in, never asserted
 *     as fact. (The render-static inferred-honesty leg asserts every
 *     [data-inferred] element carries the candidate/unverified label.)
 *
 *   - resolved:false: the linked PE has no program page. Rendered as plain text
 *     "PE <code> (unresolved)" — NEVER an <a>/<Link> (avoids a 404 + the
 *     dead-link gate). We trust the exporter's `resolved` flag verbatim.
 *
 * An honest empty state (never silence) renders when there are no edges.
 */

import React, { useContext } from "react";
import Link from "next/link";
import { CitationPanelContext } from "@/components/cite";
import type { LineageRail as LineageRailData, LineageRailEntry } from "@/lib/lineage";

/**
 * Direction-aware plain-language edge label.
 *
 * The stored relation is DIRECTION-NEUTRAL ("realigned"/"renamed"/…); the
 * preposition comes from the entry's POSITION in the rail, NOT the relation:
 *   - a PREDECESSOR (funding flowed IN) reads "…from"  — this program was
 *     realigned/renamed/transferred FROM that PE;
 *   - a SUCCESSOR (funding flowed OUT) reads "…to"     — this program was
 *     realigned/renamed/transferred TO that PE.
 * Getting this wrong is a directional-honesty bug (the label would assert the
 * opposite money-flow), so predecessors render dir "pred" and successors "succ".
 *
 * `matured_ba` is an inferred tier, not a from/to hand-off — it stays
 * directionless ("BA-maturation"). Unknown tokens fall back to the raw verb
 * plus the matching preposition.
 */
function relationLabel(relation: string, direction: "pred" | "succ"): string {
  const prep = direction === "pred" ? "from" : "to";
  switch (relation) {
    case "realigned":
      return `realigned ${prep}`;
    case "renamed":
      return `renamed ${prep}`;
    case "appropriation_transfer":
    case "transferred":
      return `transferred ${prep}`;
    case "split":
      return `split ${prep}`;
    case "merged":
      return `merged ${prep}`;
    case "matured_ba":
      // Directionless: the inferred BA-maturation tier reads fine as-is.
      return "BA-maturation";
    default:
      return `${relation.replace(/_/g, " ")} ${prep}`;
  }
}

/** The PE identity of an edge: internal link when resolved, else plain text
 *  + an "(unresolved)" marker (never a dead link). */
function EdgePe({
  entry,
  linkablePes,
}: {
  entry: LineageRailEntry;
  linkablePes: ReadonlySet<string>;
}) {
  const label = entry.title ? `${entry.pe} — ${entry.title}` : `PE ${entry.pe}`;
  // resolved:false OR the PE simply isn't a built page → plain text, no link.
  if (!entry.resolved || !linkablePes.has(entry.pe)) {
    return (
      <span className="text-muted-foreground">
        <code className="font-mono text-xs">{entry.pe}</code>{" "}
        <span className="text-xs italic">(unresolved)</span>
      </span>
    );
  }
  return (
    <Link
      href={`/program/${entry.pe}/`}
      className="font-medium text-primary hover:underline"
    >
      {label}
    </Link>
  );
}

/**
 * The clickable sentence-citation marker for a stated edge (no amount).
 *
 * This is a TRUST anchor, not a warning: it must read as trustworthy AND
 * interactive (opens the source sentence). Deliberately NOT amber — amber is
 * reserved for the inferred/candidate caution tier. A tiny quote glyph +
 * cursor-pointer + a stronger hover (solid underline, muted bg, border tint)
 * signal "click me for the source" without competing with the candidate pill.
 */
function StatedCiteMarker({ factId }: { factId: string }) {
  const { openPanel } = useContext(CitationPanelContext);
  return (
    <button
      type="button"
      data-lineage-cite=""
      data-fact-id={factId}
      className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-card px-1 py-0.5 font-mono text-xs text-muted-foreground align-middle whitespace-nowrap cursor-pointer underline decoration-dotted decoration-(--cite-decoration) underline-offset-2 transition-colors hover:decoration-solid hover:decoration-(--cite-decoration-hover) hover:border-primary/50 hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title="View the source sentence stating this transfer (official J-book page)"
      aria-label="View source citation for this lineage link"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanel(factId);
      }}
    >
      <span aria-hidden="true" className="not-italic">
        &#8220;
      </span>
      cited
    </button>
  );
}

/** One stated (solid, cited) rail entry.
 *
 * data-lineage-stated is the render-static gate's handle: every element
 * carrying it must contain the [data-lineage-cite][data-fact-id] marker
 * (the stated-side positive leg) — a stated edge may never render bare.
 *
 * The eyebrow year is honest about WHAT the year is: a stated edge's
 * fiscal_year is the J-BOOK EDITION the link is asserted in (the FY2026
 * narrative fence), not the transfer year — so it reads "per FY2026 J-book"
 * (CSS uppercases it like the rest of the eyebrow).
 */
function StatedEdge({
  entry,
  direction,
  linkablePes,
}: {
  entry: LineageRailEntry;
  /** Rail position — drives the from/to preposition (directional honesty). */
  direction: "pred" | "succ";
  linkablePes: ReadonlySet<string>;
}) {
  return (
    <li
      data-lineage-stated=""
      className="rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {relationLabel(entry.relation, direction)} · per FY{entry.fy} J-book
        {entry.ba ? ` · BA${entry.ba}` : ""}
      </span>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <EdgePe entry={entry} linkablePes={linkablePes} />
        {entry.evidence ? (
          <StatedCiteMarker factId={entry.evidence.fact_id} />
        ) : null}
      </div>
      {/* The gate-verified verbatim transfer sentence (server-rendered into
          the static HTML; collapsed by default — an opt-in read). The "cited"
          chip above still opens the citation panel for full provenance.
          data-source-text + data-cite-fact-id (a0 contract): the sentence is
          quoted J-book prose and may itself quote dollar figures — the
          currency scan must treat them as source text, anchored to the same
          evidence fact the "cited" chip opens. */}
      {entry.evidence?.sentence ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            show sentence
          </summary>
          <blockquote
            data-source-text="lineage-evidence"
            data-cite-fact-id={entry.evidence.fact_id}
            className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted-foreground"
          >
            &ldquo;{entry.evidence.sentence}&rdquo;
          </blockquote>
        </details>
      ) : null}
    </li>
  );
}

/** One inferred (dashed, amber, opt-in) rail entry. Never cited. */
function InferredEdge({
  entry,
  direction,
  linkablePes,
}: {
  entry: LineageRailEntry;
  /** Rail position — drives the from/to preposition (directional honesty). */
  direction: "pred" | "succ";
  linkablePes: ReadonlySet<string>;
}) {
  return (
    <li
      data-inferred="true"
      className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
    >
      <span className="text-xs uppercase tracking-wide">
        {relationLabel(entry.relation, direction)} · FY{entry.fy}
        {entry.ba ? ` · BA${entry.ba}` : ""}
        <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-amber-500/20 px-1 py-0.5 text-xs font-semibold not-italic">
          candidate (unverified)
        </span>
      </span>
      <div className="mt-0.5">
        <EdgePe entry={entry} linkablePes={linkablePes} />
      </div>
    </li>
  );
}

export function LineageRail({
  selfPe,
  selfTitle,
  rail,
  linkablePes,
}: {
  selfPe: string;
  selfTitle: string;
  rail: LineageRailData;
  /**
   * PEs that ARE built pages — a plain string[] (functions are not
   * serializable across the RSC server→client boundary). Any edge PE not in
   * this list, OR marked resolved:false, renders as plain text (no link).
   */
  linkablePes: readonly string[];
}) {
  const linkable = new Set(linkablePes);
  const predecessors = rail?.predecessors ?? [];
  const successors = rail?.successors ?? [];

  const statedPred = predecessors.filter((e) => e.confidence === "stated");
  const inferredPred = predecessors.filter((e) => e.confidence === "inferred");
  const statedSucc = successors.filter((e) => e.confidence === "stated");
  const inferredSucc = successors.filter((e) => e.confidence === "inferred");

  // Inferred edges are pooled into one opt-in disclosure, but each keeps its
  // rail-position direction so the from/to preposition stays honest.
  const inferred: { entry: LineageRailEntry; direction: "pred" | "succ" }[] = [
    ...inferredPred.map((entry) => ({ entry, direction: "pred" as const })),
    ...inferredSucc.map((entry) => ({ entry, direction: "succ" as const })),
  ];
  const hasStated = statedPred.length > 0 || statedSucc.length > 0;

  if (predecessors.length === 0 && successors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No predecessor or successor lineage edges are recorded for this program
        element — no FY-to-FY transfer into or out of this line was stated in
        the ingested J-books, and none was inferred.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {hasStated ? (
        <div className="space-y-3">
          {statedPred.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Predecessors (funding flowed in)
              </h3>
              <ul className="space-y-1.5">
                {statedPred.map((e, i) => (
                  <StatedEdge
                    key={`p-${e.pe}-${e.relation}-${e.fy}-${i}`}
                    entry={e}
                    direction="pred"
                    linkablePes={linkable}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* THIS program — the pivot of the rail. */}
          <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              This program
            </span>
            <div className="mt-0.5 font-semibold text-foreground">
              <code className="font-mono text-xs">{selfPe}</code>
              {selfTitle ? ` — ${selfTitle}` : ""}
            </div>
          </div>

          {statedSucc.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Successors (funding flowed out)
              </h3>
              <ul className="space-y-1.5">
                {statedSucc.map((e, i) => (
                  <StatedEdge
                    key={`s-${e.pe}-${e.relation}-${e.fy}-${i}`}
                    entry={e}
                    direction="succ"
                    linkablePes={linkable}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No <em>stated</em> lineage edges for this program element — only the
          candidate connections below, which are inferred and unverified.
        </p>
      )}

      {/* Inferred edges — opt-in disclosure, collapsed by default. Server-
          rendered so the markup is in the static HTML (the render-static
          inferred-honesty leg scans it); visually collapsed = the opt-in
          affordance. */}
      {inferred.length > 0 && (
        /* §P2-6: the caution register lives on the panel, not on each <li>
           (overriding an <li>'s role would break the list semantics). The
           amber stays here — an inferred edge IS caution about a specific
           connection. */
        <div
          data-note-kind="caution"
          role="note"
          aria-label="Candidate lineage connections — inferred and unverified"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
        >
        <details>
          <summary className="cursor-pointer text-sm font-medium text-amber-800 dark:text-amber-200">
            Show possible connections ({inferred.length} candidate
            {inferred.length === 1 ? "" : "s"}, unverified)
          </summary>
          <p className="mt-1.5 mb-2 text-xs text-amber-800/80 dark:text-amber-200/80">
            These edges are inferred from program-element and budget-activity
            structure, not stated in any J-book sentence — treat them as leads,
            not facts.
          </p>
          <ul className="space-y-1.5">
            {inferred.map(({ entry, direction }, i) => (
              <InferredEdge
                key={`i-${direction}-${entry.pe}-${entry.relation}-${entry.fy}-${i}`}
                entry={entry}
                direction={direction}
                linkablePes={linkable}
              />
            ))}
          </ul>
        </details>
        </div>
      )}
    </div>
  );
}
