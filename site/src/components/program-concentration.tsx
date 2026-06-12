import type { ProgramHHI } from "@/lib/data";
import { Cite } from "@/components/cite";

/**
 * ProgramConcentration — HHI concentration card.
 *
 * Shown only when hhi is non-null.
 * Phase 5B-3 flip: both figures are State A via derived citation fact_ids
 * carried on the sidecar (dataset fct_program_concentration):
 *   - HHI value → hhi_fact_id (display override — index, not currency)
 *   - program_dollars → program_dollars_fact_id
 */

interface ProgramConcentrationProps {
  hhi: ProgramHHI | null;
}

function hhiLabel(hhi: number): { label: string; color: string } {
  if (hhi < 1500) return { label: "Competitive", color: "text-green-700" };
  if (hhi < 2500) return { label: "Moderately Concentrated", color: "text-yellow-700" };
  return { label: "Highly Concentrated", color: "text-red-700" };
}

export function ProgramConcentration({ hhi }: ProgramConcentrationProps) {
  if (!hhi) return null;

  const { label, color } = hhiLabel(hhi.hhi);

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
              />
            </div>
            <div className={`text-xs font-medium ${color}`}>{label}</div>
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
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
