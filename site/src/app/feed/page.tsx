import type { Metadata } from "next";
import Link from "next/link";
import {
  getFeed,
  getEntityTopByFamilyKey,
  getPrograms,
  collectCitations,
  feedDisplayHeadline,
} from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { coreOgImages } from "@/lib/og";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
import { Reveal } from "@/components/reveal";
import type { FeedCard } from "@/lib/data";

export const metadata: Metadata = {
  title: `Anomaly Feed — ${SITE_NAME}`,
  description:
    "Automated signals from the defense budget: year-over-year swings, zeroed programs, award concentration shifts, and new contractors.",
  alternates: { canonical: `${SITE_URL}/feed/` },
  openGraph: {
    title: `Anomaly Feed — ${SITE_NAME}`,
    description:
      "Automated signals from the defense budget: year-over-year swings, zeroed programs, award concentration shifts, and new contractors.",
    url: `${SITE_URL}/feed/`,
    siteName: SITE_NAME,
    images: coreOgImages("feed"),
  },
};

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
    description:
      "Programs that had FY2025 funding but show no FY2026 budget request. These may have been cancelled, merged, or transferred.",
    anchorId: "feed-zeroed_fy2026",
  },
  concentration_shift: {
    label: "Award Concentration Shifts",
    description:
      "Programs whose Herfindahl-Hirschman Index (HHI) indicates high award concentration (≥ $5M matched obligations). An HHI above 2,500 suggests a near-monopoly supplier.",
    anchorId: "feed-concentration_shift",
  },
  new_entrant: {
    label: "New Defense Contractors",
    description:
      "Companies or families whose first award in the DoD transaction data is FY2024 or later and whose total obligations exceed $1M. Early-stage signal of emerging vendors.",
    anchorId: "feed-new_entrant",
  },
};

// Order in which event types are displayed on the page.
const EVENT_ORDER = [
  "yoy_swing",
  "zeroed_fy2026",
  "concentration_shift",
  "new_entrant",
];

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

  return (
    <div
      data-feed-card=""
      className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-muted/60 transition-colors"
      {...(isNewEntrant && !companySlug ? { "data-no-company-page": "" } : {})}
    >
      <div className="min-w-0 flex-1">
        {/* data-source-text="headline": auto-generated prose from export pipeline —
            dollar strings (e.g. "first award FY2025, $3.1M total") are descriptive
            context, not site-computed cite-able figures.
            data-xml-path provides the block-level citation anchor, satisfying
            the constraint that every data-source-text element must carry
            data-xml-path. */}
        {/* Headline leads with the program title when the programs index has
            one (feedDisplayHeadline); the raw PE/BLI code is demoted to the
            metadata line below. */}
        <p
          className="text-sm font-medium leading-snug"
          data-source-text="headline"
          data-xml-path={`site:feed/${card.event_type}/${card.pe_bli ?? card.family_key ?? "unknown"}`}
        >{feedDisplayHeadline(card)}</p>
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
      <div className="shrink-0 text-right">
        {card.figure_value !== null && (
          <span className="text-sm font-mono font-semibold">
            {isConcentration || card.figure_units === "hhi" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_feed_events"
                factId={card.figure_fact_id}
                display={`HHI ${card.figure_value.toFixed(0)}`}
              />
            ) : isNewEntrant || card.figure_units === "dollars" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_feed_events"
                factId={card.figure_fact_id}
              />
            ) : card.figure_units === "pct_change" ? (
              <Cite
                value={card.figure_value}
                units="USD"
                dataset="fct_budget_trajectory"
                factId={card.figure_fact_id}
                display={`${card.figure_value >= 0 ? "+" : ""}${card.figure_value.toFixed(0)}%`}
              />
            ) : (
              <Cite
                value={card.figure_value}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={card.figure_fact_id}
              />
            )}
          </span>
        )}
        <div className="mt-1">
          <Link
            href={card.why_url}
            className="text-xs text-muted-foreground underline decoration-dotted hover:decoration-solid"
            title="Why am I seeing this?"
          >
            why?
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function FeedPage() {
  const { cards, total } = getFeed();
  const grouped = groupByEventType(cards);

  // family_key → company slug lookup (SSG) from the same top-200 entity
  // index the companies page uses. Families outside the top 200 have no
  // company page — their cards get data-no-company-page instead of a link.
  const entityByFamilyKey = getEntityTopByFamilyKey();

  // pe_blis that actually have a /program/{pe_bli}/ page — programs.json is
  // the generateStaticParams source for program pages. Feed events come from
  // the trajectory mart, which covers pe_blis outside this set; linking those
  // would 404 in the static export (G1 dead-link contract).
  const programPeBlis = new Set(getPrograms().map((p) => p.pe_bli));

  // Collect all fact_ids on this page
  const pageFactIds: string[] = [];
  for (const card of cards) {
    if (card.figure_fact_id) pageFactIds.push(card.figure_fact_id);
  }
  const citationsSlice = collectCitations(pageFactIds);

  return (
    <CitationPanelProvider citations={citationsSlice}>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Anomaly Feed" }]}
        />
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Anomaly Feed</h1>
          <p className="text-muted-foreground">
            {total}{" "}automated signals across{" "}{grouped.size}{" "}event types.
            Figures carry citations — click an underlined value to inspect the
            source. &ldquo;Why?&rdquo; links explain each signal type and its
            threshold.
          </p>
        </div>

        <div className="space-y-10">
          {EVENT_ORDER.map((etype) => {
            const meta = EVENT_META[etype];
            const section_cards = grouped.get(etype) ?? [];
            if (section_cards.length === 0) return null;

            return (
              <section key={etype} id={meta.anchorId}>
                <div className="mb-3">
                  <h2 className="text-xl font-semibold">
                    {meta.label}{" "}
                    <span className="ml-1 text-sm text-muted-foreground font-normal">
                      ({section_cards.length})
                    </span>
                  </h2>
                  {/* data-source-text="methodology" — description text contains
                      threshold dollar amounts ($50M, $5M, $1M) that are
                      methodology prose, not site-computed figures.
                      data-xml-path identifies the section anchor. */}
                  <p
                    className="text-sm text-muted-foreground mt-1"
                    data-source-text="methodology"
                    data-xml-path={`site:feed/section/${etype}`}
                  >
                    {meta.description}
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
