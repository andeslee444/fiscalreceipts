import { Cite } from "@/components/cite";
import { TrajectorySpark } from "@/components/trajectory-spark";
import { DecadeTrajectory } from "@/components/decade-trajectory";
import { CoverageNote } from "@/components/coverage-note";
import type { DecadeSeries, ProgramBookDiff, ProgramRow } from "@/lib/data";
import { TRAJECTORY_FY_LABEL } from "@/lib/site";

/**
 * ProgramFigures — top-line financial figures grid (data-section="figures").
 *
 * FY24 actuals: State A (cited via fy2024_fact_id), State B via fy2024_xml_path
 *   (zero-amount jbook facts), dataset jbook_details. Rollup-tier pages (and
 *   full-tier lines without a J-book FY24 detail row) fall back to the
 *   trajectory FY24 figure with its derived citation — never an uncited value.
 * FY25 total + FY26 total + FY25→26 change: State A via the derived
 *   trajectory_fact_ids (Phase 5B-3 flip), dataset fct_budget_trajectory.
 *
 * trajectory_fact_ids are minted in Python (export_site.fact_id_derived) and
 * carried on the sidecar — NEVER recomputed in TS.
 *
 * Phase 5F §2d: the sparkline moved to <ProgramTrajectorySection>
 * (data-section="trajectory") so the two skeleton sections stay distinct.
 */

interface ProgramFiguresProps {
  program: ProgramRow;
}

export function ProgramFigures({ program }: ProgramFiguresProps) {
  const {
    fy2024_actual_millions,
    fy2024_fact_id,
    fy2024_xml_path,
    trajectory,
    trajectory_fact_ids,
  } = program;

  // FY25 and FY26 totals come from trajectory (USD thousands)
  const fy25 = trajectory?.fy2025_total ?? null;
  const fy26 = trajectory?.fy2026_total ?? null;
  const fy2526Change = trajectory?.fy2526_change ?? null;
  const fy2526Pct = trajectory?.fy2526_pct_change ?? null;

  // FY24 trajectory fallback (rollup tier): only when the derived citation
  // exists — a figure without its receipt renders as absence, not state C.
  const fy24Trajectory =
    trajectory?.fy2024_actuals != null && trajectory_fact_ids?.fy2024_actuals
      ? {
          value: trajectory.fy2024_actuals,
          factId: trajectory_fact_ids.fy2024_actuals,
        }
      : null;

  return (
    <div className="mb-8">
      <h2
        id="figures-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Budget Figures
      </h2>

      {/* Key figures grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* FY24 Actuals */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-1">FY24 Actuals</div>
          <div className="text-xl font-bold">
            {fy2024_actual_millions !== null ? (
              <Cite
                value={fy2024_actual_millions}
                units="USD millions"
                dataset="jbook_details"
                factId={fy2024_fact_id}
                xmlPath={fy2024_xml_path}
              />
            ) : fy24Trajectory ? (
              <Cite
                value={fy24Trajectory.value}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={fy24Trajectory.factId}
              />
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </div>

        {/* FY25 Total */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-1">FY25 Total</div>
          <div className="text-xl font-bold">
            {fy25 !== null ? (
              <Cite
                value={fy25}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={trajectory_fact_ids?.fy2025_total}
              />
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </div>

        {/* FY26 Total */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-1">FY26 Request</div>
          <div className="text-xl font-bold">
            {fy26 !== null ? (
              <Cite
                value={fy26}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={trajectory_fact_ids?.fy2026_total}
              />
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </div>

        {/* FY25→26 Change — label from the shared TRAJECTORY_FY_LABEL constant
            (single "FY25→26" source; U+2192 arrow, never ASCII "-->") */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-1">{TRAJECTORY_FY_LABEL} Change</div>
          <div className="text-xl font-bold">
            {fy2526Change !== null ? (
              <span
                className={
                  fy2526Change > 0
                    ? "text-green-700"
                    : fy2526Change < 0
                      ? "text-red-700"
                      : "text-foreground"
                }
              >
                <Cite
                  value={fy2526Change}
                  units="USD thousands"
                  dataset="fct_budget_trajectory"
                  factId={trajectory_fact_ids?.fy2526_change}
                />
                {fy2526Pct !== null && (
                  <span
                    className="ml-1 text-sm font-normal text-muted-foreground"
                    aria-hidden="true"
                  >
                    ({fy2526Pct > 0 ? "+" : ""}
                    {fy2526Pct.toFixed(1)}%)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </div>
      </div>

      {/* FY2026 partial-year scope note — G2 contract
          (data-coverage="fy2026-partial") */}
      <CoverageNote id="fy2026-partial" className="mt-3" />
    </div>
  );
}

/**
 * ProgramTrajectorySection — the year-over-year sparkline card
 * (data-section="trajectory" content; the page wraps it). Renders the
 * PB2026 sparkline when a trajectory row exists, plus the Phase 5E decade
 * series (edition-honest, gaps never interpolated) when the sidecar
 * carries one — both tiers. The page renders the quiet empty-state line
 * only when NEITHER exists.
 */
export function ProgramTrajectoryCard({
  program,
  decadeSeries = null,
  bookDiff = null,
}: ProgramFiguresProps & {
  decadeSeries?: DecadeSeries | null;
  bookDiff?: ProgramBookDiff | null;
}) {
  if (!program.trajectory && !decadeSeries) return null;
  return (
    <div className="mb-8 rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-2">
        Budget Trajectory
      </div>
      {program.trajectory && (
        <TrajectorySpark
          trajectory={program.trajectory}
          trajectoryFactIds={program.trajectory_fact_ids}
        />
      )}
      {decadeSeries && (
        <div className={program.trajectory ? "mt-4 border-t border-border pt-4" : undefined}>
          <div className="text-xs text-muted-foreground mb-2">
            Decade view — each figure cites its own President&apos;s Budget
            edition
          </div>
          <DecadeTrajectory series={decadeSeries} bookDiff={bookDiff} />
        </div>
      )}
    </div>
  );
}
