import "server-only";

/**
 * feeds.ts — <link rel="alternate"> discovery for the feeds the build wrote
 * (PM-review Sprint 3 Task 2, §P1-8).
 *
 * The XML files themselves are produced by scripts/generate-feeds.mjs during
 * prebuild (static export: no server). This module answers only "which feeds
 * exist, and what are their URLs" — using the SAME membership rules from
 * lib/feed-model.mjs that the generator used, so a page can never advertise a
 * feed that was not written.
 *
 * Next renders `alternates.types` as
 *   <link rel="alternate" type="application/rss+xml" href="…" title="…">
 * which is what every feed reader's autodiscovery looks for.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";

import { getFeed, getProgramPeBlis } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import {
  WHOLE_FEED_RSS,
  WHOLE_FEED_ATOM,
  eventTypeFeedPaths,
  programFeedPaths,
  companyFeedPaths,
  hasProgramFeed,
  hasCompanyFeed,
  companyWatchPeBlis,
} from "@/lib/feed-model.mjs";
import type { EntityDetails } from "@/lib/data";

const RSS_TYPE = "application/rss+xml";
const ATOM_TYPE = "application/atom+xml";

export type FeedAlternates = Record<string, { url: string; title: string }[]>;

function abs(p: string): string {
  return `${SITE_URL.replace(/\/$/, "")}${p}`;
}

function pair(
  rssPath: string,
  atomPath: string,
  title: string,
): FeedAlternates {
  return {
    [RSS_TYPE]: [{ url: abs(rssPath), title }],
    [ATOM_TYPE]: [{ url: abs(atomPath), title: `${title} (Atom)` }],
  };
}

function merge(...parts: FeedAlternates[]): FeedAlternates {
  const out: FeedAlternates = {};
  for (const p of parts) {
    for (const [type, entries] of Object.entries(p)) {
      out[type] = [...(out[type] ?? []), ...entries];
    }
  }
  return out;
}

/**
 * The whole feed, advertised site-wide.
 *
 * NOT delivered through the root layout's `metadata.alternates`: Next merges
 * metadata field-by-field, so any page that declares its own `alternates`
 * (every page here declares a canonical) REPLACES the layout's and would
 * silently lose the feed link. The layout therefore renders these as real
 * <link> elements, which React hoists into <head> — present on every page by
 * construction, not by each page remembering to re-declare it.
 */
export function siteFeedLinks(): { rel: string; type: string; href: string; title: string }[] {
  return [
    {
      rel: "alternate",
      type: RSS_TYPE,
      href: abs(WHOLE_FEED_RSS),
      title: `${SITE_NAME} — budget anomaly feed`,
    },
    {
      rel: "alternate",
      type: ATOM_TYPE,
      href: abs(WHOLE_FEED_ATOM),
      title: `${SITE_NAME} — budget anomaly feed (Atom)`,
    },
  ];
}

/**
 * /feed/'s PAGE-SPECIFIC feeds: one per event type it renders a section for.
 * The whole feed is already advertised site-wide by siteFeedLinks(), so it is
 * deliberately not repeated here.
 */
export function feedPageAlternates(labels: Record<string, string>): FeedAlternates {
  const { cards } = getFeed();
  const present = [...new Set(cards.map((c) => c.event_type))].sort();
  return merge(
    ...present.map((et) => {
      const p = eventTypeFeedPaths(et);
      return pair(p.rss, p.atom, `${SITE_NAME} — ${labels[et] ?? et}`);
    }),
  );
}

/** Watch feed for one program element, or null when it has no events. */
export function programFeedAlternates(
  peBli: string,
  title: string,
): FeedAlternates | null {
  const { cards } = getFeed();
  if (!hasProgramFeed(peBli, cards, new Set(getProgramPeBlis()))) return null;
  const p = programFeedPaths(peBli);
  return pair(p.rss, p.atom, `${SITE_NAME} — ${title} (${peBli}) watch feed`);
}

/**
 * Watch feed for one company, or null when nothing on its watchlist has
 * events. The watchlist is derived by companyWatchPeBlis() — the same
 * function the generator used — so page and file agree by construction.
 */
export function companyFeedAlternates(
  slug: string,
  displayName: string,
  details: EntityDetails,
  familyKey: string,
): FeedAlternates | null {
  const { cards } = getFeed();
  const watch = { ...companyWatchPeBlis(details), familyKey };
  if (watch.peBlis.size === 0 || !hasCompanyFeed(cards, watch)) return null;
  const p = companyFeedPaths(slug);
  return pair(p.rss, p.atom, `${SITE_NAME} — ${displayName} watchlist`);
}

/** Human-facing URLs for the small "Subscribe" affordance next to a heading. */
export function feedLinks(paths: { rss: string; atom: string }) {
  return { rss: abs(paths.rss), atom: abs(paths.atom) };
}

// ── Feed inventory (PM Sprint 3 Task 6, §Coverage) ───────────────────────────

export interface FeedInventory {
  /** Items in the whole feed — feed.json's card count. */
  items: number;
  /** Distinct event types with their own feed. */
  eventTypes: number;
  /** Per-program watch feeds written. */
  programFeeds: number;
  /** Per-company watch feeds written. */
  companyFeeds: number;
}

let _feedInventory: FeedInventory | null = null;

/**
 * How many feeds this build wrote — COUNTED OFF DISK, from public/feeds/.
 *
 * /coverage/ and /methodology/ both state these numbers, and the honest source
 * for "how many watch feeds exist" is the set of files a reader can actually
 * subscribe to, not a re-derivation of the membership rules. generate-feeds
 * runs in `prebuild` and deletes stale files before writing, so by the time a
 * page renders, public/feeds/ IS the shipped inventory; `next build` copies it
 * verbatim into out/, which is where the gate recomputes these four numbers.
 *
 * Only the RSS file of each pair is counted (every feed also ships .atom.xml),
 * so the number reads as "feeds" rather than "files".
 */
export function getFeedInventory(): FeedInventory {
  if (_feedInventory) return _feedInventory;
  const feedsDir = join(process.cwd(), "public", "feeds");
  const rssIn = (sub: string): number => {
    const dir = sub ? join(feedsDir, sub) : feedsDir;
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter(
      (f) => f.endsWith(".xml") && !f.endsWith(".atom.xml"),
    ).length;
  };
  _feedInventory = {
    items: getFeed().cards.length,
    eventTypes: rssIn(""),
    programFeeds: rssIn("program"),
    companyFeeds: rssIn("company"),
  };
  return _feedInventory;
}

export { eventTypeFeedPaths, programFeedPaths, companyFeedPaths, WHOLE_FEED_RSS, WHOLE_FEED_ATOM };
