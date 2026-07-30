"use client";

/**
 * fact-anchor.tsx — `#fact-{id}` deep-link handler (PM Sprint 1 Task 5,
 * spec §P0-4.2: "#fact-{id} on any page scrolls to the figure, focuses it,
 * and opens the drawer").
 *
 * Mounted INSIDE CitationPanelProvider (citation-panel/panel.tsx) so every
 * figure-bearing page gets the behavior for free. On load and on hashchange:
 *   1. parse `#fact-{id}` (8-hex public id or 16-hex full id),
 *   2. find the figure — exact [data-fact-id="{id}"] first, then the first
 *      [data-fact-id^="{id}"] prefix match in document order,
 *   3. scroll it into view (block:center; scroll-margin still applies),
 *   4. apply a temporary highlight ring (globals.css .fact-anchor-highlight),
 *   5. SYNTHESIZE A CLICK on the element instead of calling openPanel
 *      directly — this reuses the <Cite> click wiring, including the Task-4
 *      figure-context threading (fy/measure/basis/units…) that the footnote
 *      formatter needs. Calling openPanel(factId) here would open the drawer
 *      WITHOUT the figure context and silently degrade the copied footnote.
 *
 * No matching element (a stale or foreign id) → no scroll, no click, no
 * error — the hash is left untouched so the URL stays shareable.
 */

import { useEffect } from "react";

/** Class applied to the target figure for the temporary highlight ring. */
export const FACT_ANCHOR_HIGHLIGHT_CLASS = "fact-anchor-highlight";

/** How long the highlight ring stays on the figure (ms). */
const HIGHLIGHT_MS = 2400;

const FACT_HASH_RE = /^#fact-([0-9a-fA-F]{8,16})$/;

/** "#fact-bb54b165" → "bb54b165" (lowercase); anything else → null. */
export function parseFactHash(hash: string): string | null {
  const m = hash.match(FACT_HASH_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Locate the figure for a fact id: exact [data-fact-id] match first, then
 * the first prefix match in document order (the 8-hex public id is a prefix
 * of the full 16-hex id).
 */
export function findFactElement(
  root: ParentNode,
  id: string,
): HTMLElement | null {
  const exact = root.querySelector<HTMLElement>(`[data-fact-id="${id}"]`);
  if (exact) return exact;
  return root.querySelector<HTMLElement>(`[data-fact-id^="${id}"]`);
}

/** Scroll + highlight + synthesized click for the current location.hash. */
function activateFactHash(): void {
  const id = parseFactHash(window.location.hash);
  if (!id) return;
  const el = findFactElement(document, id);
  if (!el) return;

  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add(FACT_ANCHOR_HIGHLIGHT_CLASS);
  window.setTimeout(
    () => el.classList.remove(FACT_ANCHOR_HIGHLIGHT_CLASS),
    HIGHLIGHT_MS,
  );
  // Reuse the element's own click wiring (opens the citation drawer with the
  // full figure context) — see the module docstring for why not openPanel().
  el.click();
}

/**
 * Renders nothing; wires the `#fact-{id}` behavior for the page. Safe to
 * mount once per page (CitationPanelProvider does). Activation is idempotent
 * (re-opening the already-open fact is a no-op in the panel), so the dev
 * StrictMode double-effect needs no guard.
 */
export function FactAnchor() {
  useEffect(() => {
    activateFactHash();
    window.addEventListener("hashchange", activateFactHash);
    return () => window.removeEventListener("hashchange", activateFactHash);
  }, []);

  return null;
}
