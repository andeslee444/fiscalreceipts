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
