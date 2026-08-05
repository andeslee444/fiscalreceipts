import { Cite } from "@/components/cite";
import type { AmountUnits } from "@/lib/format";
import type { FeedCard, FeedMagnitude, FeedMagnitudePoint } from "@/lib/data";

/**
 * FeedMagnitudeLine — the dollars a feed card is about (§P1-8).
 *
 * "/feed/ items read 'Minuteman Squadrons increased 79% FY25→26' with +79% as
 * the only figure. A +79% swing on a $50M line and on a $5B line are different
 * stories." This line is the fix, rendered as
 *
 *     FY2025 $59.3M → FY2026 $106.0M   +$46.7M
 *
 * with EACH figure independently cited: the base, the new figure and the
 * change each open their own receipt. That is the whole product promise
 * applied to the number that was missing.
 *
 * WHY AN UNCITED POINT IS NOT RENDERED. The dataset ledger is empty — every
 * figure on this site is expected to be citable — so a magnitude point with
 * no resolving fact would render Cite's state C. Rather than publish a dollar
 * figure we cannot back, the line renders nothing; the gate then FAILS
 * because a pair-kind card must show its pair, and the fix is to mint the
 * missing citation, never to show the number bare.
 */

/** Card units vocabulary → the site's declared AmountUnits. Never inferred. */
function amountUnits(units: string): AmountUnits {
  if (units === "thousands_usd") return "USD thousands";
  if (units === "dollars") return "USD";
  throw new Error(`FeedMagnitudeLine: unknown magnitude units ${units}`);
}

/**
 * The warehouse dataset each endpoint's VALUE came from — Cite emits it as
 * data-dataset, which the render-static dataset-ledger leg reads.
 */
function datasetFor(eventType: string, role: "from" | "to" | "delta"): string {
  switch (eventType) {
    case "yoy_swing":
    case "zeroed_fy2026":
      return "fct_budget_trajectory";
    case "request_vs_actuals_gap":
      return role === "delta" ? "fct_book_diff" : "fct_decade_series";
    default:
      return "fct_feed_events";
  }
}

/** Basis threading: endpoints are totals, the delta is a change. */
function basisProps(card: FeedCard, point: FeedMagnitudePoint, role: string) {
  if (!card.basis) return {};
  return {
    basis: card.basis,
    fy: point.fy ?? undefined,
    measure: role === "delta" ? "change" : "total",
    edition: card.edition ?? undefined,
    entity: card.pe_bli ?? undefined,
  };
}

function allPointsCited(m: FeedMagnitude): boolean {
  return [m.from, m.to, m.delta]
    .filter((p): p is FeedMagnitudePoint => Boolean(p))
    .every((p) => Boolean(p.fact_id));
}

function Point({
  card,
  point,
  role,
}: {
  card: FeedCard;
  point: FeedMagnitudePoint;
  role: "from" | "to" | "delta";
}) {
  const m = card.magnitude!;
  const units = amountUnits(m.units);
  return (
    <span className="inline-flex items-baseline gap-1" data-mag-role={role}>
      <span className="text-muted-foreground">{point.label}</span>
      <span className="font-mono">
        <Cite
          value={point.value}
          units={units}
          dataset={datasetFor(card.event_type, role)}
          factId={point.fact_id}
          {...basisProps(card, point, role)}
          // Dense line beside the headline: the card's primary figure already
          // carries the visible basis / fact-id chips, so repeating three more
          // chip pairs per card would bury the numbers (and overflow 390px).
          chip={false}
        />
      </span>
    </span>
  );
}

export function FeedMagnitudeLine({ card }: { card: FeedCard }) {
  const m = card.magnitude;
  if (!m || !m.to || !allPointsCited(m)) return null;
  const isPair = m.kind === "pair" && Boolean(m.from);
  return (
    <p
      className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"
      data-feed-magnitude={m.kind}
    >
      {isPair && m.from && (
        <>
          <Point card={card} point={m.from} role="from" />
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="sr-only">changing to</span>
        </>
      )}
      <Point card={card} point={m.to} role="to" />
      {isPair && m.delta && <Point card={card} point={m.delta} role="delta" />}
    </p>
  );
}
