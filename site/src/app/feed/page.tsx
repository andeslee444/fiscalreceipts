import type { Metadata } from "next";
import Link from "next/link";
import {
  getFeed,
  getEntityTopByFamilyKey,
  getProgramPeBlis,
  getSiteMeta,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
import { Reveal } from "@/components/reveal";
import { FeedMagnitudeLine } from "@/components/feed-magnitude";
import { FeedHeadline } from "@/components/feed-headline";
import { feedPageAlternates, feedLinks, eventTypeFeedPaths } from "@/lib/feeds";
import { WHOLE_FEED_RSS, WHOLE_FEED_ATOM } from "@/lib/feed-model.mjs";
import type { FeedCard } from "@/lib/data";
import { formatCount } from "@/lib/format";

// Event type metadata: display name, description, methodology anchor.
const EVENT_META: Record<
  string,
  { label: string; description: string; anchorId: string }
> = {
  yoy_swing: {
    label: "Year-over-Year Swings",
    description:
      "Programs with FY2025 budget ≥ $50M that changed by ≥ 50% going into FY2026. Large swings signal major policy or requirements shifts.",
    anchorId: "feed-yoy_swing",
  },
  zeroed_fy2026: {
    label: "Zeroed in FY2026",
    // Sprint 3 Task 1b: this section previously claimed a zeroing whenever a
    // program was ABSENT from the FY2026 extract — 87 cards, none of them a
    // real zero. The predicate now demands a literal zero in the workbooks,
    // which currently matches nothing, so the section renders only when a
    // genuine termination appears. The description must therefore describe
    // the evidence bar, not the old absence heuristic.
    description:
      "Programs the FY2026 budget workbooks record as literally zero after carrying FY2025 funding. Programs merely absent from the FY2026 columns are excluded — a blank cell usually means the program element was renumbered, not cancelled.",
    anchorId: "feed-zeroed_fy2026",
  },
  concentration_shift: {
    label: "Award Concentration Shifts",
    description:
      "Programs whose Herfindahl-Hirschman Index (HHI) indicates high award concentration (≥ $5M matched obligations). An HHI above 2,500 suggests a near-monopoly supplier.",
    anchorId: "feed-concentration_shift",
  },
  request_vs_actuals_gap: {
    label: "Largest Request-vs-Actuals Gaps",
    // Claim scoped EXACTLY to request-vs-actuals (Task 6 review advisory):
    // this section says nothing about request-vs-request changes.
    // "reported as actual total obligation authority", not "actually spent"
    // (visual-judge M6: TOA ≠ outlays).
    description:
      "The largest gaps between what a President's Budget asked for a fiscal year and what a later book reported as actual total obligation authority — the PB(N) request for FY N vs the PB(N+2) book's FY N actuals, ranked by absolute dollar gap across the loaded PB2017–PB2026 editions.",
    anchorId: "feed-request_vs_actuals_gap",
  },
  new_entrant: {
    label: "New Defense Contractors",
    description:
      "Companies or families whose first award in the DoD transaction data is FY2024 or later and whose total obligations exceed $1M. Early-stage signal of emerging vendors.",
    anchorId: "feed-new_entrant",
  },
};

// Order in which event types are displayed on the page.
// §P0-5: budget-figure superlative sections carry the corpus scope
// qualifier ONCE in the section header (not per card). Award-derived
// sections (concentration, new entrants) rank a different universe.
const SCOPED_EVENT_TYPES = new Set([
  "yoy_swing",
  "zeroed_fy2026",
  "request_vs_actuals_gap",
]);

const EVENT_ORDER = [
  "yoy_swing",
  "zeroed_fy2026",
  "request_vs_actuals_gap",
  "concentration_shift",
  "new_entrant",
];

const EVENT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_META).map(([k, v]) => [k, v.label]),
);

export const metadata: Metadata = {
  title: "Anomaly Feed",
  description:
    "Automated signals from the defense budget: year-over-year swings, zeroed programs, award concentration shifts, and new contractors.",
  alternates: {
    canonical: `${SITE_URL}/feed/`,
    // §P1-8: autodiscovery for the whole feed AND for each event type this
    // page renders a section for — the feeds scripts/generate-feeds.mjs
    // wrote, resolved through the same membership rules.
    types: feedPageAlternates(EVENT_LABELS),
  },
  openGraph: {
    title: `Anomaly Feed — ${SITE_NAME}`,
    description:
      "Automated signals from the defense budget: year-over-year swings, zeroed programs, award concentration shifts, and new contractors.",
    url: `${SITE_URL}/feed/`,
    siteName: SITE_NAME,
    images: coreOgImages("feed"),
  },
};

/**
 * The subscribe affordance. Small by design — it sits beside a heading, not
 * as a banner — but present on the whole feed and on every section, because
 * §P1-8's point is that a reader on this beat wants the section, not the
 * firehose.
 */
function SubscribeLinks({
  paths,
  label,
  className,
}: {
  paths: { rss: string; atom: string };
  label: string;
  className?: string;
}) {
  const urls = feedLinks(paths);
  return (
    <span
      data-feed-subscribe=""
      className={["text-xs text-muted-foreground", className].filter(Boolean).join(" ")}
    >
      Subscribe:{" "}
      <a
        href={urls.rss}
        className="text-foreground/80 underline decoration-dotted hover:text-foreground hover:decoration-solid"
        title={`${label} — RSS`}
      >
        RSS
      </a>
      {" · "}
      <a
        href={urls.atom}
        className="text-foreground/80 underline decoration-dotted hover:text-foreground hover:decoration-solid"
        title={`${label} — Atom`}
      >
        Atom
      </a>
    </span>
  );
}

function groupByEventType(cards: FeedCard[]): Map<string, FeedCard[]> {
  const map = new Map<string, FeedCard[]>();
  for (const card of cards) {
    if (!map.has(card.event_type)) {
      map.set(card.event_type, []);
    }
    map.get(card.event_type)!.push(card);
  }
  return map;
}

function FeedCardItem({
  card,
  companySlug,
  hasProgramPage,
}: {
  card: FeedCard;
  /**
   * /company/{slug}/ slug when the card's family_key has a page in the
   * top-200 entity index; null otherwise. new_entrant cards without a page
   * carry data-no-company-page on the wrapper (G1 link-graph contract).
   */
  companySlug: string | null;
  /**
   * Whether /program/{pe_bli}/ exists in the static export (pe_bli present
   * in programs.json, the generateStaticParams source). Feed events come
   * from the trajectory mart, which covers more pe_blis than the programs
   * index — cards for those extra pe_blis keep the code text but get no
   * "view program" link (G1 dead-link contract).
   */
  hasProgramPage: boolean;
}) {
  const isConcentration = card.event_type === "concentration_shift";
  const isNewEntrant = card.event_type === "new_entrant";
  const isRvaGap = card.event_type === "request_vs_actuals_gap";

  // Basis threading (PM Sprint 1): budget-figure cards carry
  // basis/fy/measure/edition from the sidecar; award-derived cards
  // (basis null) render without attrs or chip.
  const basisProps = card.basis
    ? {
        basis: card.basis,
        fy: card.fy ?? undefined,
        measure: card.measure ?? undefined,
        edition: card.edition ?? undefined,
        entity: card.pe_bli ?? undefined,
      }
    : {};

  return (
    // PM Sprint 3 round-1 judging: this row kept its desktop two-column shape
    // at 390. The figure column is `shrink-0` and carries the percentage, the
    // fact-id chip, the basis chip and "why flagged?" — roughly 260px of it —
    // which left the headline about 110px and wrapped it one or two words per
    // line ("Strategic / Sub & / Weapons / System / Support / increased ...").
    // Nothing was clipped, so no gate saw it; the page was simply unreadable.
    //
    // It stacks below `sm` and keeps the desktop row above it.
    <div
      data-feed-card=""
      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 hover:bg-muted/60 transition-colors"
      {...(isNewEntrant && !companySlug ? { "data-no-company-page": "" } : {})}
    >
      <div data-mobile-pair-label="" className="min-w-0 sm:flex-1">
        {/* data-source-text="headline": prose COMPOSED by the export pipeline.
            Since backlog #44 it earns neither formatting exemption
            (source-text-kinds.mjs): the notation is ours and so are the dollar
            tokens, which now carry their own fact ids through <ProseCite>.
            What the marker still does is (a0) — no [data-amount] may nest
            inside it — which is what forces those per-token anchors.
            data-xml-path is the block-level anchor (a0) requires. */}
        {/* Headline leads with the program title when the programs index has
            one (feedHeadlineSegments); the raw PE/BLI code is demoted to the
            metadata line below. */}
        <p
          className="text-sm font-medium leading-snug"
          data-source-text="headline"
          data-xml-path={`site:feed/${card.event_type}/${card.pe_bli ?? card.family_key ?? "unknown"}`}
        ><FeedHeadline card={card} /></p>
        {/* §P1-8: the dollars the headline's percentage is a percentage OF.
            Kept OUTSIDE the [data-source-text] headline — computed figures
            may not nest inside source text (render-static leg a0). */}
        <FeedMagnitudeLine card={card} />
        {card.pe_bli && (
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {card.pe_bli}
            </span>
            {card.program_url && hasProgramPage && (
              <Link
                href={card.program_url}
                className="text-xs text-primary underline decoration-dotted hover:decoration-solid"
              >
                view program &rarr;
              </Link>
            )}
          </div>
        )}
        {card.family_key && !card.pe_bli && (
          <p className="mt-1 text-xs font-mono">
            {companySlug ? (
              <Link
                href={`/company/${companySlug}/`}
                className="text-primary underline decoration-dotted hover:decoration-solid"
              >
                {card.family_key}
              </Link>
            ) : (
              <span className="text-muted-foreground">{card.family_key}</span>
            )}
          </p>
        )}
      </div>
      <div
        data-mobile-pair-value=""
        className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 sm:block sm:text-right"
      >
        {card.figure_value !== null && (
          <span
            data-primary-value="feed-figure"
            className="text-sm font-mono font-semibold"
          >
            {isConcentration || card.figure_units === "hhi" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_feed_events"
                factId={card.figure_fact_id}
                {...basisProps}
                display={`HHI ${card.figure_value.toFixed(0)}`}
              />
            ) : isNewEntrant || card.figure_units === "dollars" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_feed_events"
                factId={card.figure_fact_id}
                {...basisProps}
              />
            ) : isRvaGap ? (
              // Signed gap in USD thousands, cited via the minted book_diff
              // derived fact (breakdown reachable from the citation panel).
              <Cite
                value={card.figure_value}
                units="USD thousands"
                dataset="fct_book_diff"
                factId={card.figure_fact_id}
                {...basisProps}
              />
            ) : card.figure_units === "pct_change" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_budget_trajectory"
                factId={card.figure_fact_id}
                display={`${card.figure_value >= 0 ? "+" : ""}${card.figure_value.toFixed(0)}%`}
                {...basisProps}
              />
            ) : (
              <Cite
                value={card.figure_value}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={card.figure_fact_id}
                {...basisProps}
              />
            )}
          </span>
        )}
        <div className="sm:mt-1">
          {/* Slightly larger + higher-contrast than muted-foreground
              (visual-judge nit: "why?" was easy to miss). href keeps the
              /methodology/#feed-{type} anchor the feed gate greps for. */}
          <Link
            href={card.why_url}
            className="text-[13px] text-foreground/70 underline decoration-dotted hover:text-foreground hover:decoration-solid"
            title="Why am I seeing this?"
          >
            why flagged?
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function FeedPage() {
  const { cards, total, scope_qualifier } = getFeed();
  // Backlog #49: the section scope note below used to hand-type its own
  // parenthetical, which had drifted false ("appropriations not covered by
  // the R-1/P-1 rollups" — COLUMBIA is a P-1 line and still absent). Reads
  // site_meta's corpus_scope now — the bare tail, not the full hero-style
  // scope_qualifier sentence above (which reads as a superlative caption,
  // not a "ranked across" clause) — so it cannot drift from the homepage,
  // /programs/, /years/, /methodology/ and /data/ wording again.
  const corpusScope = getSiteMeta().corpus_scope;
  const grouped = groupByEventType(cards);

  // family_key → company slug lookup (SSG) from the same top-200 entity
  // index the companies page uses. Families outside the top 200 have no
  // company page — their cards get data-no-company-page instead of a link.
  const entityByFamilyKey = getEntityTopByFamilyKey();

  // pe_blis that actually have a /program/{pe_bli}/ page — the page universe
  // is EVERY program_details sidecar (Phase 5F §2a: full + rollup tiers),
  // the same set generateStaticParams enumerates. Feed events may reference
  // pe_blis outside even that (trajectory-mart extras, dead decade-diff PEs);
  // linking those would 404 in the static export (G1 dead-link contract).
  const programPeBlis = new Set(getProgramPeBlis());

  return (
    // §P2-1 page weight: citations resolve LAZILY through cite-shards
    // (/json/cite-shards/{fact_id[:2]}.json), so the provider mounts with an
    // EMPTY embedded slice — the same treatment /programs/, /years/ and
    // /flow/ already use for the same reason, and /feed/ was the last index
    // page without it. Its 535-fact slice was 1.08 MB of a 1.72 MB document
    // (63% of it) purely to save one fetch on the first citation click — on
    // the SYNDICATION surface, the one page most likely to be opened once
    // from a link and never navigated. Clicking a figure still opens its
    // citation; the panel resolves the fact's shard first and shows the
    // declared loading/degraded states while it does.
    <CitationPanelProvider citations={{}}>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Anomaly Feed" }]}
        />
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Anomaly Feed</h1>
          <p className="text-muted-foreground">
            {formatCount(total)}{" "}automated signals across{" "}
            {formatCount(grouped.size)}{" "}event types.
            Every item states the dollars it is about, not just a percentage.
            Figures carry citations — click an underlined value to inspect the
            source. &ldquo;Why flagged?&rdquo; links explain each signal type and its
            threshold.
          </p>
          <p className="mt-2">
            <SubscribeLinks
              paths={{ rss: WHOLE_FEED_RSS, atom: WHOLE_FEED_ATOM }}
              label="Whole anomaly feed"
            />
            <span className="ml-2 text-xs text-muted-foreground">
              Items are dated to the corpus build — the budget books carry no
              per-event timestamp.
            </span>
          </p>
        </div>

        <div className="space-y-10">
          {EVENT_ORDER.map((etype) => {
            const meta = EVENT_META[etype];
            const section_cards = grouped.get(etype) ?? [];
            if (section_cards.length === 0) return null;

            return (
              // scroll-mt-16 clears the sticky header when navigating to the
              // #feed-{type} anchors directly (site-wide anchored-section
              // pattern — methodology/home sections use the same value).
              <section key={etype} id={meta.anchorId} className="scroll-mt-16">
                <div className="mb-3">
                  <h2 className="text-xl font-semibold">
                    {meta.label}{" "}
                    <span className="ml-1 text-sm text-muted-foreground font-normal">
                      ({section_cards.length})
                    </span>
                  </h2>
                  {/* backlog #38: this carried data-source-text="methodology"
                      + a sentinel data-xml-path. The description is OUR prose
                      stating the selection thresholds ($50M, $5M, $1M), quoted
                      from nothing, so it takes no source-text exemption. The
                      three thresholds are enumerated in
                      scripts/gates/prose-allowlist.json, scoped to this page
                      and /methodology/. */}
                  <p className="text-sm text-muted-foreground mt-1">
                    {meta.description}
                  </p>
                  {SCOPED_EVENT_TYPES.has(etype) && scope_qualifier && corpusScope && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Scope: ranked across the R&D and procurement program
                      elements in our corpus ({corpusScope}).
                    </p>
                  )}
                  <p className="mt-1">
                    <SubscribeLinks
                      paths={eventTypeFeedPaths(etype)}
                      label={meta.label}
                    />
                  </p>
                </div>
                {/* Card list — staggered once-reveal on scroll (Task 11);
                    the Reveal wrapper divs are the divide-y children. */}
                <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
                  {section_cards.map((card, i) => (
                    <Reveal
                      key={`${card.event_type}-${card.pe_bli ?? card.family_key ?? i}`}
                      index={i}
                    >
                      <FeedCardItem
                        card={card}
                        companySlug={
                          card.family_key
                            ? (entityByFamilyKey.get(card.family_key)?.slug ??
                              null)
                            : null
                        }
                        hasProgramPage={
                          card.pe_bli != null && programPeBlis.has(card.pe_bli)
                        }
                      />
                    </Reveal>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Signals computed from FY2026 budget justification books, USAspending
          award data, and LDA lobbying disclosures. Thresholds and methodology:
          see{" "}
          <Link href="/methodology/#feed" className="underline hover:text-foreground">
            /methodology/#feed
          </Link>
          .
        </p>
      </div>
    </CitationPanelProvider>
  );
}
