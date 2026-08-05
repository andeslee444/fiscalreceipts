/**
 * notes.tsx — the site's TWO note registers (PM Sprint 3, spec §P2-6).
 *
 * The review found coverage notes, "medium confidence", non-additivity
 * warnings and GAO flags all rendering in the same amber warning treatment.
 * Conflating them teaches a reader to skip both, which costs the site exactly
 * where it should be strongest: the amber that means "this number needs care"
 * stops being read, because the amber that means "here is what this page does
 * and does not cover" arrived first and turned out to be nothing to worry
 * about.
 *
 * So there are two registers, and they differ in the palette AND in the
 * semantics:
 *
 *   <ScopeNote>    HONEST SCOPE DISCLOSURE — what the page covers, what it
 *                  does not, and why. A credibility asset, not a warning:
 *                  calm cool-neutral panel (--scope-bg / --scope-border), no
 *                  alert semantics, and never above the page's <h1>.
 *                  Marked data-note-kind="scope".
 *
 *   <CautionNote>  CAUTION ABOUT A SPECIFIC NUMBER — inferred, ambiguous,
 *                  unverified, or otherwise not what it looks like. Keeps the
 *                  amber, and now earns it: role="note" plus a required label,
 *                  so the register survives with styles off.
 *                  Marked data-note-kind="caution".
 *
 * Gate 2 (render-static (nk)) pins the vocabulary, the caution semantics and
 * the <h1> order statically; gate 6 (charts.mjs) pins that the two registers
 * are visually distinguishable on the COMPOSITED colours a reader sees —
 * caution borders warm (r−b ≥ 30), scope borders not (≤ 12).
 *
 * Both are server components: a disclosure that needs JavaScript to be read is
 * not a disclosure. The one place a note collapses on small screens
 * (/years/, where five stacked blocks pushed the grid 766px down the page)
 * composes this panel with <CollapsibleBelowSm>, which keeps the text in the
 * DOM either way.
 */

import type { ReactNode } from "react";

export function ScopeNote({
  children,
  className = "",
  /** Visible register label; pass null where the surrounding copy supplies it. */
  label = "Scope",
}: {
  children: ReactNode;
  className?: string;
  label?: string | null;
}) {
  return (
    <div
      data-note-kind="scope"
      className={`rounded-md border border-(--scope-border) bg-(--scope-bg) px-3 py-2 sm:px-4 sm:py-3 ${className}`}
    >
      {label && (
        <p className="mb-1 text-[11px] font-semibold tracking-widest text-foreground/60 uppercase">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

export function CautionNote({
  children,
  className = "",
  /** What the caution is about — the accessible name of the note region. */
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      data-note-kind="caution"
      role="note"
      aria-label={label}
      className={`rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:text-amber-200 ${className}`}
    >
      {children}
    </div>
  );
}
