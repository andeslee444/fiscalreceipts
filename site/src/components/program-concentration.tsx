import type { ProgramHHI } from "@/lib/data";
import { Cite } from "@/components/cite";
import { hhiBand } from "@/lib/hhi-band.mjs";

/**
 * ProgramConcentration — HHI concentration card.
 *
 * Shown only when hhi is non-null.
 * Phase 5B-3 flip: both figures are State A via derived citation fact_ids
 * carried on the sidecar (dataset fct_program_concentration):
 *   - HHI value → hhi_fact_id (display override — index, not currency)
 *   - program_dollars → program_dollars_fact_id
 *
 * Band vocabulary lives in hhi-band.mjs (backlog #57) — this is the
 * DESTINATION page a homepage/feed concentration claim links to, and
 * scripts/gates/feed.mjs leg (l) reads the [data-hhi-band] attribute below
 * to check that claim against what this page actually renders. Color stays
 * local (presentational only, not part of the shared vocabulary).
 */

interface ProgramConcentrationProps {
  hhi: ProgramHHI | null;
}

const BAND_COLOR: Record<string, string> = {
  competitive: "text-green-700",
  moderate: "text-yellow-700",
  concentrated: "text-red-700",
};

export function ProgramConcentration({ hhi }: ProgramConcentrationProps) {
  if (!hhi) return null;

  const band = hhiBand(hhi.hhi);
  const { label } = band;
  const color = BAND_COLOR[band.key];

  return (
    <section aria-labelledby="concentration-heading" className="mb-8">
      <h2
        id="concentration-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Contractor Concentration
      </h2>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* HHI — derived citation (display override: index, not dollars) */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              HHI Index
              <span
                className="ml-1 text-muted-foreground/60 cursor-help"
                title="Herfindahl-Hirschman Index: 0–10,000. <1500 competitive; 1500–2500 moderate; >2500 concentrated. Derived from positive-only contractor shares — click the value for the formula."
              >
                ⓘ
              </span>
            </div>
            <div className={`text-xl font-bold ${color}`}>
              <Cite
                value={hhi.hhi}
                units="USD"
                dataset="fct_program_concentration"
                factId={hhi.hhi_fact_id}
                display={hhi.hhi.toFixed(0)}
                // Non-budget figure (gate 23 a1): source-family basis token,
                // honest multi-year fy token — no basis chip (usaspending is
                // not a chip-vocabulary basis).
                basis="usaspending"
                fy="all-years"
                measure="hhi"
              />
            </div>
            {/* data-hhi-band: the pooled all-years band, stable selector for
                scripts/gates/feed.mjs leg (l) — see hhi-band.mjs. */}
            <div className={`text-xs font-medium ${color}`} data-hhi-band={label}>
              {label}
            </div>
          </div>

          {/* Top family */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">Top Contractor</div>
            <div className="text-sm font-medium text-foreground">
              {hhi.top_family}
            </div>
          </div>

          {/* Family count */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Contractor Families
            </div>
            <div className="text-xl font-bold text-foreground">
              {hhi.family_count}
            </div>
          </div>

          {/* Program dollars — derived citation */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Program Obligations
              <span
                className="ml-1 text-muted-foreground/60 cursor-help"
                title="Total contract obligations attributed to this program element. Derived — click the value for the formula."
              >
                ⓘ
              </span>
            </div>
            <div className="text-xl font-bold">
              <Cite
                value={hhi.program_dollars}
                units="USD"
                dataset="fct_program_concentration"
                factId={hhi.program_dollars_fact_id}
                basis="usaspending"
                fy="all-years"
                measure="obligations"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
