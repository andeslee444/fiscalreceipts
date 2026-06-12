import { Cite } from "@/components/cite";
import type { ProgramDetailRow } from "@/lib/data";

/**
 * ProgramDetailsTable — R-2/P-40 facts table.
 *
 * Project rows with scenario columns; each amount:
 *   - State A via <Cite factId> when resolution is 'unique' or 'ambiguous_first'
 *   - State B via <Cite xmlPath={xml_path}> when resolution === 'zero_amount'
 *     (pass NO factId in this case per THREE-STATE contract)
 *
 * Grouped by project_number / project_title.
 */

interface ProgramDetailsTableProps {
  details: ProgramDetailRow[];
}

// Canonical scenario display order
const SCENARIO_ORDER = [
  "AllPriorYears",
  "PriorYear",
  "CurrentYear",
  "BudgetYearOneBase",
  "BudgetYearOne",
];

function humanizeScenario(scenario: string): string {
  const map: Record<string, string> = {
    AllPriorYears: "All Prior Years",
    PriorYear: "FY24 Actuals",
    CurrentYear: "FY25 Total",
    BudgetYearOneBase: "FY26 Base",
    BudgetYearOne: "FY26 Request",
  };
  return map[scenario] ?? scenario;
}

interface ProjectGroup {
  key: string;
  project_number: string | null;
  project_title: string | null;
  rows: ProgramDetailRow[];
}

export function ProgramDetailsTable({ details }: ProgramDetailsTableProps) {
  if (details.length === 0) {
    return null;
  }

  // Collect unique scenarios in display order
  const scenarioSet = new Set(details.map((r) => r.scenario));
  const scenarios = SCENARIO_ORDER.filter((s) => scenarioSet.has(s));
  // Append any scenarios not in the order list
  for (const s of scenarioSet) {
    if (!scenarios.includes(s)) scenarios.push(s);
  }

  // Group rows by project_number + project_title
  const groupMap = new Map<string, ProjectGroup>();
  for (const row of details) {
    const key =
      row.project_number != null
        ? `proj:${row.project_number}`
        : `pe:${row.xml_path}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        project_number: row.project_number,
        project_title: row.project_title,
        rows: [],
      });
    }
    groupMap.get(key)!.rows.push(row);
  }
  const groups = Array.from(groupMap.values());

  return (
    <section aria-labelledby="details-heading" className="mb-8">
      <h2
        id="details-heading"
        className="text-lg font-semibold mb-4 text-foreground"
      >
        Budget Details
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          (R-2/P-40 facts)
        </span>
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="text-left py-2 pr-3 font-medium text-muted-foreground min-w-[200px]">
                Project
              </th>
              {scenarios.map((s) => (
                <th
                  key={s}
                  scope="col"
                  className="text-right py-2 px-2 font-medium text-muted-foreground whitespace-nowrap"
                >
                  {humanizeScenario(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              // Build a map of scenario → row for this group
              const scenarioMap = new Map<string, ProgramDetailRow>();
              for (const row of group.rows) {
                scenarioMap.set(row.scenario, row);
              }

              const label =
                group.project_number && group.project_title
                  ? `${group.project_number}: ${group.project_title}`
                  : group.project_title ??
                    group.project_number ??
                    "Program Element";

              return (
                <tr
                  key={group.key}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2 pr-3 text-foreground font-medium">
                    {label}
                  </td>
                  {scenarios.map((scenario) => {
                    const row = scenarioMap.get(scenario);
                    if (!row) {
                      return (
                        <td
                          key={scenario}
                          className="py-2 px-2 text-right text-muted-foreground"
                        >
                          —
                        </td>
                      );
                    }

                    // Three-state logic:
                    // State A: resolution unique or ambiguous_first → use factId
                    // State B: resolution zero_amount → use xmlPath, NO factId
                    const isZeroAmount = row.resolution === "zero_amount";

                    return (
                      <td key={scenario} className="py-2 px-2 text-right">
                        {isZeroAmount ? (
                          <Cite
                            value={row.amount_millions}
                            units="USD millions"
                            xmlPath={row.xml_path}
                          />
                        ) : (
                          <Cite
                            value={row.amount_millions}
                            units="USD millions"
                            factId={row.fact_id}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
