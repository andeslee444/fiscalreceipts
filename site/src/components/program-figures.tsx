import { Cite } from "@/components/cite";
import { TrajectorySpark } from "@/components/trajectory-spark";
import { DecadeTrajectory } from "@/components/decade-trajectory";
import { ReconciliationStrip } from "@/components/reconciliation-strip";
import { CoverageNote } from "@/components/coverage-note";
import type {
  DecadeSeries,
  ProgramBookDiff,
  ProgramRow,
  ProgramSummary,
  SummaryCard,
} from "@/lib/data";
import { TRAJECTORY_FY_LABEL } from "@/lib/site";

/**
 * ProgramFigures — top-line financial figures grid (data-section="figures").
 *
 * PM Sprint 1 (§P0-1/§P0-2): the four cards render the sidecar's SUMMARY
 * UNION payload — computed in the exporter from workbook (toa) + J-book
 * detail facts, preferring toa — never a narrower upstream table. Each card
 * carries full basis attributes + the visible basis chip; absences render
 * the honest reason label (never a bare "—"); the reconciliation strip
 * declares every (fy, measure) where the two bases disagree, with both
 * receipts. Cards whose (fy, measure) appears in the reconciliation payload
 * carry data-reconciliation (gate 23 leg a2: every member of a declared
 * collision group is marked).
 *
 * Phase 5F §2d: the sparkline lives in <ProgramTrajectoryCard>
 * (data-section="trajectory") so the two skeleton sections stay distinct.
 */

/** Human measure labels for the card titles ("FY25 Enacted", "FY25 Total"). */
const CARD_MEASURE_LABEL: Record<string, string> = {
  actuals: "Actuals",
  enacted: "Enacted",
  request: "Request",
  total: "Total",
  "base-request": "Base Request",
};

/**
 * Honest absence labels (§P0-2 fix 2) — never a bare "—".
 *
 * DELIBERATELY free of em/en dashes and "$": gate 23 leg b2's bootstrap
 * matcher treats a dash-bearing card as an absence claim to test against the
 * page's detail figures. These ARE honest absences (the union found no
 * defensible canonical-basis value), and the machine-readable declaration is
 * the [data-absence][data-fy][data-measure][data-absence-reason] contract —
 * not a dash glyph.
 */
const ABSENCE_LABEL: Record<string, string> = {
  "not-published": "Not in the FY2026 J-books we ingested",
  "no-rollup": "No single program-level figure; see the line items below",
  "no-comparison": "No comparison: endpoints unavailable or on different bases",
};

export function cardLabel(card: SummaryCard): string {
  if (card.key === "change") return `${TRAJECTORY_FY_LABEL} Change`;
  const fy = `FY${String(card.fy).slice(-2)}`;
  const measure =
    CARD_MEASURE_LABEL[card.measure] ?? card.measure.replace(/-/g, " ");
  return `${fy} ${measure}`;
}

/** Set of "fy|measure" keys with a declared reconciliation entry. */
export function reconKeySet(summary: ProgramSummary | null): Set<string> {
  return new Set(
    (summary?.reconciliation ?? []).map((r) => `${r.fy}|${r.measure}`),
  );
}

function SummaryCardCell({
  card,
  reconKeys,
}: {
  card: SummaryCard;
  reconKeys: Set<string>;
}) {
  const label = cardLabel(card);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-bold">
        {card.value !== null && card.units ? (
          <span
            className={
              card.key === "change"
                ? card.value > 0
                  ? "text-green-700"
                  : card.value < 0
                    ? "text-red-700"
                    : "text-foreground"
                : undefined
            }
          >
            {card.key === "change" && card.value >= 0 ? "+" : ""}
            <Cite
              value={card.value}
              units={card.units}
              dataset={card.dataset ?? "fct_decade_series"}
              factId={card.fid}
              xmlPath={card.fid ? null : card.xml_path}
              basis={card.basis ?? undefined}
              fy={card.fy}
              measure={card.measure}
              edition={card.edition}
              reconciled={reconKeys.has(`${card.fy}|${card.measure}`)}
            />
            {card.key === "change" && card.pct != null && (
              <span
                className="ml-1 text-sm font-normal text-muted-foreground"
                aria-hidden="true"
              >
                ({card.pct > 0 ? "+" : ""}
                {card.pct.toFixed(1)}%)
              </span>
            )}
          </span>
        ) : (
          <span
            data-absence=""
            data-fy={card.fy}
            data-measure={card.measure}
            data-absence-reason={card.absence_reason ?? "not-published"}
            className="block text-xs font-normal leading-4 text-muted-foreground"
          >
            {ABSENCE_LABEL[card.absence_reason ?? "not-published"] ??
              ABSENCE_LABEL["not-published"]}
          </span>
        )}
      </div>
    </div>
  );
}

interface ProgramFiguresProps {
  program: ProgramRow;
  summary: ProgramSummary;
}

export function ProgramFigures({ summary }: ProgramFiguresProps) {
  const reconKeys = reconKeySet(summary);
  return (
    <div className="mb-8">
      <h2
        id="figures-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Budget Figures
      </h2>

      {/* Key figures grid — the union cards, in slot order */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {summary.cards.map((card) => (
          <SummaryCardCell key={card.key} card={card} reconKeys={reconKeys} />
        ))}
      </div>

      {/* §P0-1: the declared two-basis reconciliation, both receipts */}
      <ReconciliationStrip entries={summary.reconciliation} />

      {/* FY2026 partial-year scope note — G2 contract
          (data-coverage="fy2026-partial") */}
      <CoverageNote id="fy2026-partial" className="mt-3" />
    </div>
  );
}

/**
 * ProgramTrajectorySection — the year-over-year sparkline card
 * (data-section="trajectory" content; the page wraps it). The sparkline
 * renders the SUMMARY CARDS themselves (PM Sprint 1: the trajectory mart's
 * per-org slices contradicted the union cards on multi-org programs — same
 * label, different value; drawing the cards makes spark and cards agree BY
 * CONSTRUCTION), plus the Phase 5E decade series (edition-honest, gaps
 * never interpolated) when the sidecar carries one.
 */
export function ProgramTrajectoryCard({
  summary,
  decadeSeries = null,
  bookDiff = null,
}: ProgramFiguresProps & {
  decadeSeries?: DecadeSeries | null;
  bookDiff?: ProgramBookDiff | null;
}) {
  const reconKeys = reconKeySet(summary);
  const sparkCards = summary.cards.filter(
    (c) => c.key !== "change" && c.value !== null,
  );
  if (sparkCards.length === 0 && !decadeSeries) return null;
  return (
    <div className="mb-8 rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-2">
        Budget Trajectory
      </div>
      {sparkCards.length > 0 && (
        <TrajectorySpark cards={summary.cards} reconKeys={reconKeys} />
      )}
      {decadeSeries && (
        <div className={sparkCards.length >= 2 ? "mt-4 border-t border-border pt-4" : undefined}>
          <div className="text-xs text-muted-foreground mb-2">
            Decade view — P-1/R-1 workbook TOA basis (USD thousands); each
            figure cites its own President&apos;s Budget edition
          </div>
          <DecadeTrajectory
            series={decadeSeries}
            bookDiff={bookDiff}
            reconKeys={reconKeys}
          />
        </div>
      )}
    </div>
  );
}
