import type { Metadata } from "next";
import Link from "next/link";
import { getFeed, collectCitations } from "@/lib/data";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CitationPanelProvider } from "@/components/citation-panel";
import { Cite } from "@/components/cite";
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

function FeedCardItem({ card }: { card: FeedCard }) {
  const isConcentration = card.event_type === "concentration_shift";
  const isNewEntrant = card.event_type === "new_entrant";

  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-muted/60 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{card.headline}</p>
        {card.pe_bli && (
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {card.pe_bli}
            </span>
            {card.program_url && (
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
          <p className="mt-1 text-xs text-muted-foreground font-mono">
            {card.family_key}
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
            {total} automated signals across {grouped.size} event types.
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
                  <p className="text-sm text-muted-foreground mt-1">
                    {meta.description}
                  </p>
                </div>
                <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
                  {section_cards.map((card, i) => (
                    <FeedCardItem
                      key={`${card.event_type}-${card.pe_bli ?? card.family_key ?? i}`}
                      card={card}
                    />
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
