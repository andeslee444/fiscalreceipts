/**
 * years-totals-chart.tsx — "Budget over time" corpus trend for /years/
 * (Sprint C Task C5, ROADMAP #64).
 *
 * The page is titled "Budget over time" and, before this change, contained
 * no chart — a 1,741-row matrix behind 39 column chips answers "up or down?"
 * only after manual arithmetic. This renders one line: the corpus's own
 * decade-default columns (years_matrix.json's `decade_default_columns`,
 * FY2015 actuals … FY2026 request), summed and plotted.
 *
 * REUSE, per the plan: <ChartFigure> (chart-figure.tsx) for the name/
 * description/table contract, and axisLabelYears() (decade-trajectory.tsx)
 * for x-axis label placement — the SAME helper the per-program decade chart
 * uses, so both charts pick labels the same way. The plot geometry
 * (headroom-below-min domain, not a zero baseline) mirrors
 * DecadeTrajectory's for visual consistency, but is written out directly
 * here rather than imported: DecadeTrajectory renders three Cite-backed
 * per-program series (actuals/enacted/request) through its own citation
 * plumbing, which does not fit a single corpus-level, non-cited total — see
 * the honesty note below. Inventing a shared "LineChart" primitive for one
 * caller would be the third chart vocabulary the plan says not to build.
 *
 * ── A DISCLOSED PREMISE SUBSTITUTION (see commit message) ─────────────────
 * The plan says every plotted total "must be cited". Investigated first
 * (per the standing instruction to verify premises, not assume them):
 * years_matrix.json carries ONLY per-program cells — no corpus-wide
 * per-year total exists anywhere in the citation graph. The one genuine
 * aggregate citation in the whole corpus is a single FY2026 figure
 * (site_meta.json programs_coverage.index_fact_id, "sum(...) over the
 * 1741-program /programs/ index") — nothing comparable exists for any other
 * year, and minting new ones is a data-pipeline change (export_site.py,
 * real recompute cost) outside this session's scope and the files this task
 * named (page.tsx + a chart component).
 *
 * So this total is NOT wrapped in <Cite>: no factId/xmlPath/uncited-ledger
 * dataset legitimately applies to a sum with no single source row, and
 * fabricating one would be exactly the "true number, false claim" failure
 * this product exists to avoid. Two things follow:
 *
 *   1. NAIVE full-corpus sums are actively misleading here, not just
 *      uncited: coverage of the 12 default columns ranges from 35% of
 *      programs (FY2015, sparse early ingestion) to 90% (FY2022+), so a
 *      sum over "every program with a figure that year" would show total
 *      spending roughly SEXTUPLING over the decade — almost entirely a
 *      corpus-growth artifact, not real budget movement. This chart instead
 *      sums a BALANCED PANEL: only the programs that report a figure in
 *      EVERY one of the 12 default years, so the same set is compared
 *      year over year and a true "up or down" can be shown while the
 *      naive full-corpus version cannot.
 *   2. The total renders as a bare number (no "$"), matching the page's
 *      own stated-once "All figures in USD millions" convention (see
 *      page.tsx) — the SAME convention years-matrix.tsx's own %Δ column
 *      already uses for a computed-not-independently-cited figure ("no
 *      data-amount, matching the program-figures precedent for the
 *      uncited pct column" — years-matrix.tsx's own docstring). Every
 *      number here is fully auditable: it is the sum of the panel
 *      programs' own individually cited cells in the matrix directly
 *      below, on the same page, and the table states the panel size so a
 *      reader can tell this is a subset, not the whole corpus.
 */

import { ChartFigure, chartDescId } from "@/components/chart-figure";
import { axisLabelYears } from "@/components/decade-trajectory";
import { formatCount } from "@/lib/format";
import type { DecadeColumn, ProgramEntry, YearsMatrixData } from "@/components/years-matrix";

const SVG_WIDTH = 340;
const SVG_HEIGHT = 72;
const PADDING = 8;
const LABEL_BAND = 12;
const POINT_R = 2.5;

const KIND_LETTER: Record<DecadeColumn["kind"], string> = {
  actuals: "A",
  enacted: "E",
  request: "R",
};

interface TotalPoint {
  key: string;
  fy: number;
  kind: DecadeColumn["kind"];
  edition: number;
  valueMillions: number;
}

/** "223,393.2" — grouped, one decimal, no unit symbol (page states the unit once). */
function fmtTotal(vMillions: number): string {
  return vMillions.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function YearsTotalsChart({
  matrix,
  entries,
}: {
  matrix: YearsMatrixData;
  entries: ProgramEntry[];
}) {
  const defaultKeys = matrix.decade_default_columns ?? [];
  // The 5D pre-decade payload shape (no decade_columns) has no per-column
  // fy/kind/edition meta to plot against — rather than guess, this chart
  // simply does not render until the decade columns it needs exist. Every
  // matrix built since Phase 5E carries them (verified against the live
  // payload; see the commit message).
  if (defaultKeys.length < 2) return null;

  const decadeMeta = new Map(
    (matrix.decade_columns ?? []).map((c) => [c.key, c] as const),
  );

  // Balanced panel: programs with a reported figure in EVERY default
  // column, so the same set is compared across all years (see the header
  // comment — a full-corpus sum here would show corpus growth, not budget
  // growth).
  const panel = entries.filter((e) =>
    defaultKeys.every((k) => e.program.cells[k] != null),
  );
  if (panel.length === 0) return null;

  const points: TotalPoint[] = defaultKeys
    .map((key): TotalPoint | null => {
      const meta = decadeMeta.get(key);
      if (!meta) return null;
      const sumThousands = panel.reduce(
        (acc, e) => acc + (e.program.cells[key]?.v ?? 0),
        0,
      );
      return {
        key,
        fy: meta.fy,
        kind: meta.kind,
        edition: meta.edition,
        valueMillions: sumThousands / 1000,
      };
    })
    .filter((p): p is TotalPoint => p !== null)
    .sort((a, b) => a.fy - b.fy);
  if (points.length < 2) return null;

  const fys = points.map((p) => p.fy);
  const minFy = fys[0];
  const maxFy = fys[fys.length - 1];
  const values = points.map((p) => p.valueMillions);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV;

  const innerW = SVG_WIDTH - PADDING * 2;
  const innerH = SVG_HEIGHT - PADDING * 2 - LABEL_BAND;
  const chartBottom = PADDING + innerH;
  const toX = (fy: number) =>
    PADDING + ((fy - minFy) / Math.max(maxFy - minFy, 1)) * innerW;
  // Headroom below the minimum / above the maximum, never a zero baseline —
  // same fix DecadeTrajectory carries (a bare min-max scale puts the series
  // minimum exactly on the baseline rule, which reads as "zero" beside a
  // caption stating a real, non-zero figure).
  const domainMin = range === 0 ? minV : minV - range * 0.22;
  const domainMax = range === 0 ? maxV : maxV + range * 0.06;
  const domainRange = domainMax - domainMin;
  const toY = (v: number) =>
    domainRange === 0
      ? PADDING + innerH / 2
      : PADDING + innerH - ((v - domainMin) / domainRange) * innerH;

  const first = points[0];
  const last = points[points.length - 1];
  const trendColor =
    last.valueMillions > first.valueMillions
      ? "#16a34a"
      : last.valueMillions < first.valueMillions
        ? "#dc2626"
        : "#6b7280";
  const trendWord =
    last.valueMillions > first.valueMillions
      ? "rose"
      : last.valueMillions < first.valueMillions
        ? "fell"
        : "stayed flat";
  const pctChange =
    first.valueMillions !== 0
      ? ((last.valueMillions - first.valueMillions) / first.valueMillions) * 100
      : 0;
  const panelPct = Math.round((100 * panel.length) / entries.length);

  const chartName = `Corpus budget total, FY${minFy} to FY${maxFy}, balanced panel of ${formatCount(panel.length)} programs`;
  const chartDescription =
    `The combined total for the ${formatCount(panel.length)} programs (${panelPct}% ` +
    `of the ${formatCount(entries.length)}-program corpus) that report a figure in ` +
    `every one of these ${points.length} years — the SAME programs counted each ` +
    `year, so the line reflects real change rather than more programs being added ` +
    `to the corpus over time. It ${trendWord} by roughly ${Math.abs(pctChange).toFixed(0)}% ` +
    `from FY${minFy} to FY${maxFy}. Figures are in USD millions (page unit) and are ` +
    `sums of the individually cited program figures in the matrix below — this ` +
    `total itself carries no single citation because no one source records a ` +
    `corpus-wide figure; every input does.`;

  const chart = (
    <div data-testid="years-totals-chart">
      <svg
        width="100%"
        height={SVG_HEIGHT}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMinYMid meet"
        className="h-auto w-full max-w-[720px]"
        role="img"
        aria-label={chartName}
        aria-describedby={chartDescId("years-totals")}
        data-testid="years-totals-svg"
      >
        <desc>{chartDescription}</desc>
        <line
          x1={PADDING}
          y1={chartBottom}
          x2={SVG_WIDTH - PADDING}
          y2={chartBottom}
          stroke="#e5e7eb"
          strokeWidth="1"
        />
        <polyline
          data-totals-line=""
          points={points.map((p) => `${toX(p.fy)},${toY(p.valueMillions)}`).join(" ")}
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p) => (
          <circle
            key={p.key}
            data-totals-point=""
            data-fy={p.fy}
            cx={toX(p.fy)}
            cy={toY(p.valueMillions)}
            r={POINT_R}
            fill={trendColor}
          >
            <desc>
              FY{p.fy} {p.kind} — PB{p.edition} edition
            </desc>
          </circle>
        ))}
        {axisLabelYears(fys, innerW).map((fy) => {
          const isFirst = fy === minFy;
          const isLast = fy === maxFy;
          return (
            <g key={`axis-${fy}`} data-totals-axis-label="" data-fy={fy}>
              <line
                x1={toX(fy)}
                y1={chartBottom}
                x2={toX(fy)}
                y2={chartBottom + 2.5}
                stroke="#d1d5db"
                strokeWidth="1"
              />
              <text
                x={
                  isFirst
                    ? Math.max(toX(fy) - POINT_R, 1)
                    : isLast
                      ? Math.min(toX(fy) + POINT_R, SVG_WIDTH - 1)
                      : toX(fy)
                }
                y={SVG_HEIGHT - 2}
                textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                fontSize={9}
                fill="#6b7280"
              >
                FY{String(fy).slice(-2)}
              </text>
            </g>
          );
        })}
      </svg>
      {range > 0 && (
        <p
          data-testid="years-totals-scale"
          className="mt-1 text-xs leading-5 text-muted-foreground"
        >
          The vertical scale does not start at zero: the baseline sits just
          below the panel&rsquo;s smallest year, so a low point on this line
          is not a small amount. Read the shape for direction and the table
          below for the figures.
        </p>
      )}
    </div>
  );

  const tableView = (
    <div className="mt-2 overflow-x-auto">
      <table
        data-testid="years-totals-table"
        className="w-full border-collapse text-[11px]"
      >
        <caption className="sr-only">
          Corpus budget total by fiscal year, balanced panel of{" "}
          {formatCount(panel.length)} programs present in every year shown.
          Figures in USD millions, not independently cited — see the matrix
          below for each contributing program&apos;s own cited figure.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b border-border px-1.5 py-1 text-left font-medium text-muted-foreground"
            >
              <span className="sr-only">Series</span>
            </th>
            {points.map((p) => (
              <th
                key={p.key}
                scope="col"
                className="border-b border-border px-1.5 py-1 text-right font-medium text-muted-foreground whitespace-nowrap"
              >
                FY{String(p.fy).slice(-2)}
                {KIND_LETTER[p.kind]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th
              scope="row"
              className="px-1.5 py-1 text-left font-medium text-muted-foreground whitespace-nowrap"
            >
              Total ({formatCount(panel.length)} programs)
            </th>
            {points.map((p) => (
              <td
                key={p.key}
                data-totals-cell={p.key}
                className="px-1.5 py-1 text-right font-mono tabular-nums whitespace-nowrap"
              >
                {fmtTotal(p.valueMillions)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p
        data-testid="years-totals-note"
        className="mt-2 text-xs leading-4 text-muted-foreground"
      >
        Balanced panel: the {formatCount(panel.length)} of {formatCount(entries.length)}{" "}
        programs ({panelPct}%) with a reported figure in every year shown, so
        the total compares the same programs year over year instead of
        growing as more programs enter the corpus. Not independently
        cited — each figure is a sum of the panel programs&apos; own cited
        cells, browsable in the matrix below.
      </p>
    </div>
  );

  return (
    <ChartFigure
      id="years-totals"
      description={chartDescription}
      table={tableView}
      descClassName="max-w-prose"
    >
      {chart}
    </ChartFigure>
  );
}
