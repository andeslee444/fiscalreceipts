import type { ProgramTrajectory, ProgramTrajectoryFactIds } from "@/lib/data";
import { Cite } from "@/components/cite";

/**
 * TrajectorySpark — inline SVG sparkline from trajectory data.
 *
 * SERVER COMPONENT (embeds the client <Cite> for the legend values).
 * Skip gracefully when trajectory is null or all values are null.
 *
 * Units: trajectory values are in USD thousands.
 * We render a 3-point sparkline: FY24 actuals → FY25 total → FY26 total.
 * Legend dollar values are wrapped in <Cite> with the derived trajectory
 * fact_ids (dataset fct_budget_trajectory) — Phase 5B-3 flip.
 */

const SVG_WIDTH = 120;
const SVG_HEIGHT = 36;
const POINT_R = 3;
const PADDING = 6;

interface TrajectorySparkProps {
  trajectory: ProgramTrajectory | null;
  trajectoryFactIds?: ProgramTrajectoryFactIds | null;
}

export function TrajectorySpark({
  trajectory,
  trajectoryFactIds,
}: TrajectorySparkProps) {
  if (!trajectory) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No trajectory data available.
      </p>
    );
  }

  // Collect the three data points in order (label, value, derived fact_id)
  const rawPoints: [string, number | null, string | null][] = [
    ["FY24", trajectory.fy2024_actuals, trajectoryFactIds?.fy2024_actuals ?? null],
    ["FY25", trajectory.fy2025_total, trajectoryFactIds?.fy2025_total ?? null],
    ["FY26", trajectory.fy2026_total, trajectoryFactIds?.fy2026_total ?? null],
  ];

  const defined = rawPoints.filter(([, v]) => v !== null) as [
    string,
    number,
    string | null,
  ][];

  if (defined.length < 2) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Insufficient trajectory data for sparkline
        {defined.length === 1
          ? ` (only ${defined[0][0]} available)`
          : ""}.
      </p>
    );
  }

  // Compute min/max for y scaling
  const values = defined.map(([, v]) => v as number);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV;

  // Map data → SVG coordinates
  // x: evenly spaced among defined points
  // y: inverted (SVG y=0 is top)
  const innerW = SVG_WIDTH - PADDING * 2;
  const innerH = SVG_HEIGHT - PADDING * 2;

  function toX(idx: number): number {
    return PADDING + (idx / Math.max(defined.length - 1, 1)) * innerW;
  }

  function toY(v: number): number {
    if (range === 0) return PADDING + innerH / 2;
    return PADDING + innerH - ((v - minV) / range) * innerH;
  }

  const points = defined.map(([label, v, factId], i) => ({
    label,
    v,
    factId,
    x: toX(i),
    y: toY(v),
  }));

  // Build polyline points string
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Determine trend color
  const firstVal = points[0].v;
  const lastVal = points[points.length - 1].v;
  const trendColor =
    lastVal > firstVal
      ? "#16a34a" // green-600
      : lastVal < firstVal
        ? "#dc2626" // red-600
        : "#6b7280"; // gray-500

  return (
    <div className="flex items-center gap-3">
      <svg
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="img"
        aria-label="Budget trajectory sparkline"
        className="shrink-0"
      >
        {/* Baseline */}
        <line
          x1={PADDING}
          y1={SVG_HEIGHT - PADDING}
          x2={SVG_WIDTH - PADDING}
          y2={SVG_HEIGHT - PADDING}
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
                and is the correct SVG element for shape-level descriptions anyway. */}
            <desc>
              {p.label}: ${(p.v / 1000).toFixed(1)}M (USD thousands)
            </desc>
          </circle>
        ))}
        {/* Year labels */}
        {points.map((p) => (
          <text
            key={`label-${p.label}`}
            x={p.x}
            y={SVG_HEIGHT - 1}
            textAnchor="middle"
            fontSize="7"
            fill="#9ca3af"
          >
            {p.label}
          </text>
        ))}
      </svg>

      {/* Compact year/value legend — Cite-wrapped (dataset fct_budget_trajectory) */}
      <dl className="flex gap-3 text-xs text-muted-foreground flex-wrap">
        {points.map((p) => (
          <div key={p.label} className="flex flex-col">
            <dt className="font-medium text-foreground/80">{p.label}</dt>
            <dd>
              <Cite
                value={p.v}
                units="USD thousands"
                dataset="fct_budget_trajectory"
                factId={p.factId}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
