"use client";

/**
 * <FeedSectionExpand> — /feed/ client-side "show all" (Task 6, #73).
 *
 * MIRRORS ProgramAwards.handleExpand (program-awards.tsx): client component,
 * useState, plain same-origin fetch, an error state. On click it fetches
 * /json/feed.json (copied to public/json/ by prepare-assets.mjs — the exact
 * sidecar the exporter/generate-feeds.mjs already reads), filters `cards` by
 * `event_type`, and renders everything past `shown` with the client-safe
 * <FeedCardItemClient> twin (feed-card-item-client.tsx).
 *
 * WHY A LOOKUP-PROPS DESIGN (addendum ruling 1, option (a) — not a
 * generate-feeds.mjs sidecar, option (b)): the /feed/ static-weight ceiling
 * (site/scripts/gates/build.mjs) had ~80KB of gzip headroom at the time this
 * was measured. A client card needs the SAME companySlug/hasProgramPage
 * resolution feed/page.tsx computes server-side for the visible cards, but
 * ONLY the two sections that ever truncate today (concentration_shift,
 * yoy_swing) are pe_bli-driven with family_key always null — so
 * companySlugByFamilyKey is a near-empty map and programPeBlis is a couple
 * hundred short PE/BLI code strings, well under the headroom (see the task
 * report for the measured byte counts). Passed as per-SECTION props scoped
 * to just the cards beyond the cap — never the whole entity/program index —
 * so this stays small even if a family_key-driven section (new_entrant)
 * eventually grows past FEED_SECTION_CAP too.
 *
 * The collapsed (initial, pre-hydration) render keeps
 * `[data-feed-truncation-note]` on the note — gate 23 leg g4
 * (scripts/gates/basis.mjs runFeedFy26SplitLeg) reads that attribute against
 * the STATIC HTML to excuse a qualifying yoy_swing card that sits below the
 * cap; client-side expansion is invisible to a gate that only ever reads the
 * exported out/feed/index.html.
 */

import { useState } from "react";
import type { FeedCard, FeedSidecar } from "@/lib/data";
import { FeedCardItemClient } from "@/components/feed-card-item-client";
import { formatCount } from "@/lib/format";

interface FeedSectionExpandProps {
  /** feed.json card.event_type this section renders. */
  eventType: string;
  /** Cards already rendered statically (FEED_SECTION_CAP, today 75). */
  shown: number;
  /** Total cards in this section (all_section_cards.length). */
  total: number;
  /**
   * Distinct pe_blis, among this section's cards beyond `shown`, that have
   * a /program/{pe_bli}/ page (i.e. are in the generateStaticParams
   * universe) — the same test feed/page.tsx applies to the visible cards.
   */
  programPeBlis: string[];
  /**
   * family_key → /company/{slug}/ slug (or null) for this section's cards
   * beyond `shown` that carry a family_key — the same top-200 entity-index
   * lookup feed/page.tsx applies to the visible cards.
   */
  companySlugByFamilyKey: Record<string, string | null>;
}

export function FeedSectionExpand({
  eventType,
  shown,
  total,
  programPeBlis,
  companySlugByFamilyKey,
}: FeedSectionExpandProps) {
  const [expanded, setExpanded] = useState(false);
  const [extraCards, setExtraCards] = useState<FeedCard[] | null>(null);
  // feed.json's own count for this event type, as actually fetched — kept
  // separate from `total` (the server-rendered count) because the two can
  // disagree after a partial deploy (build.mjs's page reads a newer/older
  // feed.json than the one prepare-assets.mjs shipped to /json/feed.json).
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExpand() {
    if (extraCards) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/json/feed.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: FeedSidecar = await resp.json();
      // Filter, don't re-sort — feed.json's card order IS the "ranked by
      // magnitude" order the static section already sliced its first
      // `shown` cards from, so slicing the SAME filtered array at `shown`
      // continues that exact sequence with no gap or overlap.
      const filtered = data.cards.filter((c) => c.event_type === eventType);
      setFilteredCount(filtered.length);
      setExtraCards(filtered.slice(shown));
      setExpanded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  if (expanded && extraCards) {
    const programPeBliSet = new Set(programPeBlis);
    return (
      <>
        <div className="divide-y divide-border rounded-b-lg border border-t-0 border-border overflow-hidden bg-card">
          {extraCards.map((card, i) => (
            <FeedCardItemClient
              key={`${card.event_type}-${card.pe_bli ?? card.family_key ?? i}-${i}`}
              card={card}
              companySlug={
                card.family_key
                  ? (companySlugByFamilyKey[card.family_key] ?? null)
                  : null
              }
              hasProgramPage={
                card.pe_bli != null && programPeBliSet.has(card.pe_bli)
              }
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {/* feed.json can lag the built page after a partial deploy —
              assert only what was actually fetched, not "all". */}
          {filteredCount !== null && filteredCount !== total
            ? `Showing ${formatCount(filteredCount)} of ${formatCount(total)} cards in this section.`
            : `Showing all ${formatCount(total)} cards in this section.`}
        </p>
      </>
    );
  }

  return (
    <div>
      <p
        className="mt-2 text-xs text-muted-foreground"
        data-feed-truncation-note=""
      >
        Showing the {formatCount(shown)} largest of {formatCount(total)}{" "}
        cards in this section; the full set is in the RSS/Atom feeds above
        and in feed.json.
      </p>
      <div className="mt-2">
        {error && (
          <p className="text-xs text-red-600 mb-2">Failed to load: {error}</p>
        )}
        <button
          onClick={handleExpand}
          disabled={loading}
          className="text-sm text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Loading…" : `Show all ${formatCount(total)}`}
        </button>
      </div>
    </div>
  );
}
