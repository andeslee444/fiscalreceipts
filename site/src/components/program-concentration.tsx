import type { ProgramHHI } from "@/lib/data";
import { Cite } from "@/components/cite";

/**
 * ProgramConcentration — HHI concentration card.
 *
 * Shown only when hhi is non-null.
 * program_dollars is derived/uncited → State C.
 * HHI value is derived → State C.
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
          {/* HHI */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              HHI Index
              <span
                className="ml-1 text-muted-foreground/60 cursor-help"
                title="Herfindahl-Hirschman Index: 0–10,000. <1500 competitive; 1500–2500 moderate; >2500 concentrated. Derived — no direct citation."
              >
                ⓘ
              </span>
            </div>
            <div className={`text-xl font-bold ${color}`}>
              <span
                data-amount
                data-uncited="true"
                title={`${hhi.hhi.toFixed(1)} (derived HHI)`}
              >
                {hhi.hhi.toFixed(0)}
                <span
                  className="ml-0.5 text-muted-foreground text-sm"
                  title="citation tier pending — see methodology"
                  aria-hidden="true"
                >
                  ⁂
                </span>
              </span>
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

          {/* Program dollars — derived/uncited State C */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Program Obligations
              <span
                className="ml-1 text-muted-foreground/60 cursor-help"
                title="Total contract obligations attributed to this program element. Derived — uncited (see methodology)."
              >
                ⓘ
              </span>
            </div>
            <div className="text-xl font-bold">
              <Cite
                value={hhi.program_dollars}
                units="USD"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
