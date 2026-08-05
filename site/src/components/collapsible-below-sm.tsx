"use client";

/**
 * <CollapsibleBelowSm> — one-line disclosure BELOW `sm`, always open at and
 * above it (PM Sprint 3 §P2-6 / the /years/ mobile fold).
 *
 * WHY. /years/ at 390px put five blocks of explanation — the intro, the unit
 * statement, the single-edition coverage note, the corpus statement, and three
 * decoding legends — between the heading and the first number, pushing the
 * grid 766px down the page. A phone reader scrolled past all of it to reach
 * a single figure. Deleting the disclosure would be the wrong trade: it is the
 * page's credibility. Collapsing it is the right one.
 *
 * CONTRACT. The children are ALWAYS in the DOM — hidden with `hidden`, never
 * unmounted — because the static gates (coverage §G2, corpus §P1-5 leg d,
 * the years-matrix legend legs) read the built HTML and must keep seeing every
 * word. At ≥640px `sm:block` wins and the toggle itself is hidden, so nothing
 * changes on a desktop.
 *
 * Same idiom as the /years/ column picker (aria-expanded + aria-controls on a
 * real <button>), so the page has one disclosure pattern, not two.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

export function CollapsibleBelowSm({
  summary,
  children,
  className = "",
  testId,
  bodyClassName = "space-y-1.5",
}: {
  summary: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  bodyClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:ring-2 focus:ring-ring focus:outline-none sm:hidden"
      >
        <span>{summary}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      <div
        id={bodyId}
        className={`${open ? "block" : "hidden"} sm:block ${bodyClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
