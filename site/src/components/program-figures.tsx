import { Cite } from "@/components/cite";
import { TrajectorySpark } from "@/components/trajectory-spark";
import type { ProgramRow } from "@/lib/data";

/**
 * ProgramFigures — top-line financial figures.
 *
 * FY24 actuals: State A (cited via fy2024_fact_id), State B via fy2024_xml_path
 *   (zero-amount jbook facts), dataset jbook_details.
 * FY25 total + FY26 total + FY25→26 change: State A via the derived
 *   trajectory_fact_ids (Phase 5B-3 flip), dataset fct_budget_trajectory.
 *
 * trajectory_fact_ids are minted in Python (export_site.fact_id_derived) and
 * carried on the sidecar — NEVER recomputed in TS.
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

  return (
    <section aria-labelledby="figures-heading" className="mb-8">
      <h2
        id="figures-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Budget Figures
      </h2>

      {/* Key figures grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
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

        {/* FY25→26 Change */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-1">FY25→26 Change</div>
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

      {/* Sparkline */}
      {trajectory && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground mb-2">
            Budget Trajectory
          </div>
          <TrajectorySpark
            trajectory={trajectory}
            trajectoryFactIds={trajectory_fact_ids}
          />
        </div>
      )}
    </section>
  );
}
