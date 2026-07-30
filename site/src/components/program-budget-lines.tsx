import { Cite } from "@/components/cite";
import type { ProgramBudgetLine } from "@/lib/data";

/**
 * ProgramBudgetLines — workbook-cited budget line items table.
 *
 * State A throughout (fact_id always present on budget_lines per schema).
 * Grouped by exhibit.
 */

interface ProgramBudgetLinesProps {
  budgetLines: ProgramBudgetLine[];
  /** "fy|measure" keys with a declared reconciliation entry (gate 23 a2):
   *  program-entity rows on those keys carry data-reconciliation. */
  reconKeys?: Set<string>;
}

/** Human-friendly label for amount_type. */
function humanizeAmountType(amountType: string): string {
  const map: Record<string, string> = {
    fy_2024_actuals: "FY24 Actuals",
    fy_2025_enacted: "FY25 Enacted",
    fy_2025_total: "FY25 Total",
    fy_2026_disc_request: "FY26 Disc. Request",
    fy_2026_reconciliation_request: "FY26 Reconciliation",
    fy_2026_total: "FY26 Total",
  };
  return map[amountType] ?? amountType.replace(/_/g, " ").replace(/\bfy\b/gi, "FY");
}

export function ProgramBudgetLines({ budgetLines, reconKeys }: ProgramBudgetLinesProps) {
  if (budgetLines.length === 0) {
    return null;
  }

  // Group by exhibit
  const exhibits = Array.from(new Set(budgetLines.map((bl) => bl.exhibit)));

  return (
    <section aria-labelledby="budget-lines-heading" className="mb-8">
      <h2
        id="budget-lines-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Budget Line Items
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          (workbook-cited)
        </span>
      </h2>
      {/* Section-level basis statement (P0-1): one label for every row —
          per-cell chips are suppressed in dense tables by design. ≥12px. */}
      <p className="mb-2 text-xs text-muted-foreground">
        P-1/R-1 workbook Total Obligation Authority basis (USD thousands) ·
        PB2026.
      </p>

      {exhibits.map((exhibit) => {
        const rows = budgetLines.filter((bl) => bl.exhibit === exhibit);
        return (
          <div key={exhibit} className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              Exhibit {exhibit}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="text-left py-2 pr-3 font-medium text-muted-foreground">
                      Account
                    </th>
                    <th scope="col" className="text-left py-2 pr-3 font-medium text-muted-foreground">
                      Org
                    </th>
                    <th scope="col" className="text-left py-2 pr-3 font-medium text-muted-foreground">
                      Type
                    </th>
                    <th scope="col" className="text-right py-2 font-medium text-muted-foreground">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((bl) => (
                    <tr
                      key={bl.fact_id}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="py-2 pr-3 text-foreground">
                        {bl.account_title}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground font-mono text-xs">
                        {bl.organization}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {humanizeAmountType(bl.amount_type)}
                      </td>
                      <td className="py-2 text-right font-medium">
                        <Cite
                          value={bl.amount_thousands}
                          units="USD thousands"
                          dataset="budget_lines"
                          factId={bl.fact_id}
                          basis={bl.basis}
                          fy={bl.fy ?? "all"}
                          measure={bl.measure ?? bl.amount_type}
                          entity={bl.entity}
                          edition={bl.edition}
                          reconciled={
                            !bl.entity.includes("/") &&
                            reconKeys?.has(`${bl.fy}|${bl.measure}`)
                          }
                          chip={false}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
