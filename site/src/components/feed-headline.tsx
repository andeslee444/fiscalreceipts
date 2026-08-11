/**
 * <FeedHeadline> — a feed headline rendered from its SEGMENTS, so every dollar
 * token in it carries a citation affordance (ROADMAP backlog #44).
 *
 * WHY THIS EXISTS. A feed headline is a sentence the export pipeline composes
 * — "…new defense contractor (first award FY2025, $3.1M total)". Its dollar
 * tokens are figures the SITE computed, on the syndication surface: the
 * most-forwarded, least-context view there is. While the headline was one flat
 * string they were the only figures on the site that reached a reader with no
 * way to ask where they came from, and the `data-source-text="headline"`
 * marker exempted them from the gate that would have said so. Backlog #38
 * named that gap; this closes it.
 *
 * The exporter now emits the sentence as runs — plain text, and amount tokens
 * carrying the fact id of the figure they print (feed.json `headline_segments`,
 * whose texts re-join to `headline` exactly). Amount runs render as
 * <ProseCite>: state A, dotted underline, opens the citation panel, and
 * render-static (a1) asserts the fact id resolves in citations.json.
 *
 * <ProseCite> rather than <Cite> for two reasons. The token is the exporter's
 * own formatting and must render verbatim — a request-vs-actuals gap prints
 * |delta| beside the word "above", while the fact it cites is the signed value
 * — and the headline sits inside [data-source-text], where render-static (a0)
 * forbids [data-amount] descendants. A prose cite is the sanctioned anchor
 * there, and it is the stricter of the two: [data-amount] does not require a
 * resolving fact id, [data-prose-cite] does.
 *
 * `href` links the LEADING TEXT RUN only, never the amounts: a prose cite is
 * an interactive element, and nesting one inside an anchor would put two
 * controls in one hit target. The program name is what a reader aims at
 * anyway.
 */

import Link from "next/link";

import { ProseCite } from "@/components/prose-cite";
import { feedHeadlineSegments, type FeedCard } from "@/lib/data";
import { hhiBand } from "@/lib/hhi-band.mjs";

/**
 * hhiScopeNote — the "this is one year, not the program's pooled figure"
 * disclosure for an hhi-unit feed card (backlog #57).
 *
 * WHY THIS EXISTS. concentration_shift cards headline a SINGLE (pe_bli,
 * fiscal_year)'s HHI over high-confidence award transactions for that year
 * alone (dbt fct_feed_events). The /program/{peBli}/ page a card links to
 * renders a DIFFERENT figure: fct_program_concentration's HHI pooled across
 * every year and high+medium-confidence links. Both are real, correctly
 * computed numbers — they are just not the same measure, and a single
 * concentrated year can sit next to a competitive pooled figure (or the
 * reverse) with no error anywhere. Without this note, a reader who reads
 * "HHI=8662 (2020)" glossed with a concentration adjective, then clicks
 * through and finds the page calling the SAME program "Competitive," has no
 * way to tell that apart from the site contradicting itself.
 *
 * Returns null for non-hhi cards. Text and band both derive from the SAME
 * shared hhiBand() the destination page's own badge uses (hhi-band.mjs) —
 * see that file's doc-comment for why it is .mjs, not .ts. Consumed by both
 * the homepage lede (page.tsx, inline span) and every /feed/ card
 * (feed/page.tsx, block <p>) — one function, two renderings, so the note
 * cannot read differently in the two places it appears.
 */
export function hhiScopeNote(
  card: FeedCard,
): { band: string; text: string } | null {
  if (card.figure_units !== "hhi" || card.figure_value === null) return null;
  const band = hhiBand(card.figure_value);
  const yearText = card.fiscal_year ? `FY${card.fiscal_year}` : "that year";
  return {
    band: band.label,
    text:
      `${band.label} in ${yearText} — the program's pooled, all-years HHI ` +
      `can differ; see the program page.`,
  };
}

export function FeedHeadline({
  card,
  href,
  linkClassName,
}: {
  card: FeedCard;
  /** Optional program link. Wraps the leading text run only. */
  href?: string | null;
  linkClassName?: string;
}) {
  const segments = feedHeadlineSegments(card);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.text !== undefined) {
          if (i === 0 && href) {
            return (
              <Link key={i} href={href} className={linkClassName}>
                {seg.text}
              </Link>
            );
          }
          return <span key={i}>{seg.text}</span>;
        }
        return (
          <ProseCite key={i} factId={seg.fact_id}>
            {seg.amount}
          </ProseCite>
        );
      })}
    </>
  );
}
