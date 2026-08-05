import type { SummaryCard } from "@/lib/data";
import { Cite } from "@/components/cite";
import { ChartFigure, chartDescId } from "@/components/chart-figure";
import { basisChipText } from "@/lib/basis";
import { formatAmount } from "@/lib/format";

/**
 * TrajectorySpark — inline SVG sparkline over the summary-union cards.
 *
 * SERVER COMPONENT (embeds the client <Cite> for the legend values).
 *
 * PM Sprint 1 (§P0-1): the spark previously drew fct_budget_trajectory's
 * primary-org metrics, which on multi-org programs are a per-service SLICE —
 * the legend said "FY26 $911K" two inches from a card saying "FY26 Request
 * $3.14M" (a live same-label collision). The spark now draws the SUMMARY
 * CARDS themselves, so spark and cards agree by construction and every
 * legend value carries the card's own citation, basis attributes, and chip.
 *
 * Cards may sit on either basis (union prefers toa; detail-only slots are
 * labeled) and either unit — points are scaled in raw dollars.
 *
 * Provenance caption (visual-judge M7): when every legend value would
 * render the IDENTICAL basis chip ("P-1 TOA · PB2026" three times inside
 * one component), the per-figure chips are suppressed (chip={false} — the
 * decade grid's existing dense-cell idiom) and ONE caption line declares
 * the shared provenance for the whole series. Per-figure chips remain
 * whenever bases/editions/extended measures differ within the series.
 */

const SVG_WIDTH = 120;
// Height includes a reserved LABEL_BAND strip below the baseline so the
// FY24/FY25/FY26 year labels never crowd or overlap the data points
// (visual-judge D3 finding: labels were cramped/clipped at 390px).
const SVG_HEIGHT = 46;
const POINT_R = 3;
const PADDING = 6;
const LABEL_BAND = 10;

interface TrajectorySparkProps {
  /** The summary union cards (fy2024/fy2025/fy2026 slots draw; change is skipped). */
  cards: SummaryCard[];
  /** "fy|measure" keys with a declared reconciliation entry (gate 23 a2). */
  reconKeys?: Set<string>;
}

function toDollars(card: SummaryCard): number {
  return card.units === "USD millions"
    ? card.value! * 1_000_000
    : card.value! * 1_000;
}

export function TrajectorySpark({ cards, reconKeys }: TrajectorySparkProps) {
  const slots = cards.filter((c) => c.key !== "change");
  const defined = slots.filter((c) => c.value !== null && c.units !== null);

  if (defined.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No trajectory data available.
      </p>
    );
  }
  if (defined.length < 2) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Insufficient trajectory data for sparkline (only FY
        {String(defined[0].fy).slice(-2)} available).
      </p>
    );
  }

  // Compute min/max for y scaling (raw dollars — units may be mixed)
  const values = defined.map(toDollars);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV;

  const innerW = SVG_WIDTH - PADDING * 2;
  const innerH = SVG_HEIGHT - PADDING * 2 - LABEL_BAND;
  const chartBottom = PADDING + innerH;

  function toX(idx: number): number {
    return PADDING + (idx / Math.max(defined.length - 1, 1)) * innerW;
  }

  function toY(v: number): number {
    if (range === 0) return PADDING + innerH / 2;
    return PADDING + innerH - ((v - minV) / range) * innerH;
  }

  const points = defined.map((card, i) => ({
    card,
    label: `FY${String(card.fy).slice(-2)}`,
    dollars: toDollars(card),
    x: toX(i),
    y: toY(toDollars(card)),
  }));

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Shared-provenance caption (M7): compare the EXACT chip text each legend
  // value would render — identical, non-null text across all points means
  // one caption carries the provenance and the per-figure chips drop.
  const chipTexts = points.map((p) =>
    p.card.basis
      ? basisChipText(
          p.card.basis,
          p.card.measure ?? undefined,
          p.card.edition ?? undefined,
        )
      : null,
  );
  const sharedChipText =
    chipTexts[0] != null && chipTexts.every((t) => t === chipTexts[0])
      ? chipTexts[0]
      : null;

  // Determine trend color
  const firstVal = points[0].dollars;
  const lastVal = points[points.length - 1].dollars;
  const trendColor =
    lastVal > firstVal
      ? "#16a34a" // green-600
      : lastVal < firstVal
        ? "#dc2626" // red-600
        : "#6b7280"; // gray-500

  // §P2-3: the accessible name NAMES the chart; the description says what it
  // shows and what to take from it. The takeaway is computed, never authored
  // — the direction of travel is the one thing a sparkline exists to say.
  const spanLabel = `${points[0].label} to ${points[points.length - 1].label}`;
  const chartName = `Budget trajectory sparkline, ${spanLabel}`;
  const direction =
    lastVal > firstVal
      ? "ends higher than it starts"
      : lastVal < firstVal
        ? "ends lower than it starts"
        : "ends level with where it starts";
  const chartDescription =
    `The program's ${points.length} summary figures for ${spanLabel}, plotted in ` +
    `fiscal-year order so the direction of travel is readable at a glance: this ` +
    `line ${direction}. The points are the summary cards above, not a separate ` +
    `derivation; the table beside the chart carries each figure with its own citation.`;

  return (
    <ChartFigure id="trajectory-spark" description={chartDescription}>
    <div className="flex items-center gap-3">
      <svg
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="img"
        aria-label={chartName}
        aria-describedby={chartDescId("trajectory-spark")}
        className="shrink-0"
      >
        <desc>{chartDescription}</desc>
        {/* Baseline */}
        <line
          x1={PADDING}
          y1={chartBottom}
          x2={SVG_WIDTH - PADDING}
          y2={chartBottom}
          stroke="#e5e7eb"
          strokeWidth="1"
        />
        {/* Trend line */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Data points */}
        {points.map((p) => (
          <circle
            key={p.label}
            cx={p.x}
            cy={p.y}
            r={POINT_R}
            fill={trendColor}
          >
            {/* Use <desc> not <title>: Next.js App Router hoists <title> elements
                from server components to <head>, leaving empty SVG titles in SSG
                output and causing React hydration error #418. <desc> is unaffected
                and is the correct SVG element for shape-level descriptions anyway.
                The currency gate checks each desc token against the adjacent
                Cite-wrapped legend: a desc may only echo values that exist in
                a [data-amount] sibling — it must never introduce its own. */}
            <desc>
              {p.label}: {formatAmount(p.card.value!, p.card.units!)}
            </desc>
          </circle>
        ))}
        {/* Year labels — inside the reserved band below the baseline. The
            first/last labels anchor start/end so they never clip at the SVG
            edges (middle-anchored text at x=PADDING spilled outside the
            viewBox and was cut off). */}
        {points.map((p, i) => {
          const isFirst = i === 0;
          const isLast = i === points.length - 1;
          return (
            <text
              key={`label-${p.label}`}
              x={
                isFirst
                  ? Math.max(p.x - POINT_R, 1)
                  : isLast
                    ? Math.min(p.x + POINT_R, SVG_WIDTH - 1)
                    : p.x
              }
              y={SVG_HEIGHT - 2}
              textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
              fontSize="8"
              fill="#9ca3af"
            >
              {p.label}
            </text>
          );
        })}
      </svg>

      {/* THE TABLE VIEW (§P2-3), not a legend: the sparkline's data is
          already tabular, so it ships as a real table with a caption and
          row headers instead of a <dl> that only looks like one. Each value
          is the CARD's own Cite with its basis attributes + chip (never a
          re-derived figure). Its own scroll container, so a long money
          string can never widen the document at 390px. */}
      <div className="min-w-0 overflow-x-auto">
        <table
          data-chart-table=""
          className="text-xs text-muted-foreground"
        >
          <caption className="sr-only">
            Budget trajectory: one row per fiscal year, carrying the summary
            figure the sparkline plots. Every figure opens its own citation.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="pr-3 text-left font-medium whitespace-nowrap"
              >
                Fiscal year
              </th>
              <th scope="col" className="text-left font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <th
                  scope="row"
                  className="pr-3 text-left font-medium text-foreground/80 whitespace-nowrap"
                >
                  {p.label}
                </th>
                <td className="text-left whitespace-nowrap">
                  <Cite
                    value={p.card.value!}
                    units={p.card.units!}
                    dataset={p.card.dataset ?? "fct_budget_trajectory"}
                    factId={p.card.fid}
                    xmlPath={p.card.fid ? null : p.card.xml_path}
                    basis={p.card.basis ?? undefined}
                    fy={p.card.fy}
                    measure={p.card.measure}
                    edition={p.card.edition}
                    reconciled={reconKeys?.has(`${p.card.fy}|${p.card.measure}`)}
                    chip={!sharedChipText}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

      {/* ONE caption for the whole series when provenance is uniform (M7) —
          12px floor per P1-1, same quiet register as the decade caption. */}
      {sharedChipText && (
        <p
          data-testid="spark-provenance"
          className="mt-1 text-xs text-muted-foreground"
        >
          All series figures: {sharedChipText}
        </p>
      )}
    </ChartFigure>
  );
}
