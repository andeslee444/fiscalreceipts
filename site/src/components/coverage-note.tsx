/**
 * <CoverageNote id> — server component.
 *
 * Renders a small scope/coverage disclaimer at the point of use with a link to
 * the relevant methodology anchor. The data-coverage attribute is the contract
 * checked by the G2 gate (coverage.mjs).
 *
 * `empty` renders the empty-state variant ("No follow-the-dollar view — …")
 * used on pages where the surface is ABSENT (no flow sidecar, no dossier).
 * Both variants interpolate the same counts, so the G2 number check holds
 * regardless of which variant a representative page renders.
 */

import { getCoverage, type CoverageId } from "@/lib/coverage";
import Link from "next/link";

export function CoverageNote({
  id,
  empty = false,
  collapsible = false,
  className = "",
}: {
  id: CoverageId;
  /** Render the empty-state variant (surface absent on this page). */
  empty?: boolean;
  /**
   * Collapse the note sentence below `sm`, leaving only the methodology link
   * (e.g. "why one edition? →") — used on /years/ to tighten the 390px fold.
   * The full text stays in the DOM (CSS-hidden), so the G2 coverage gate's
   * static-HTML text check is unaffected.
   */
  collapsible?: boolean;
  className?: string;
}) {
  const c = getCoverage(id);
  const text = empty ? (c.emptyNote ?? c.note) : c.note;
  return (
    <p
      data-coverage={id}
      className={`text-xs text-muted-foreground ${className}`}
    >
      <span className={collapsible ? "hidden sm:inline" : undefined}>
        {text}{" "}
      </span>
      <Link
        href={c.anchor}
        className="underline decoration-dotted hover:text-foreground"
      >
        {c.linkText}
      </Link>
    </p>
  );
}
