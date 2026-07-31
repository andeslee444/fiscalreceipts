import { Cite } from "@/components/cite";
import { formatAmount } from "@/lib/format";
import type { DecadePoint, DecadeSeries, ProgramBookDiff } from "@/lib/data";

/**
 * DecadeTrajectory — the Phase 5E decade series inside the program page's
 * trajectory section (data-section="trajectory").
 *
 * SERVER COMPONENT (embeds the client <Cite> for every value). Renders:
 *   - a wide sparkline: the ACTUALS line across FY2015–FY2024 with
 *     enacted (hollow circle) and request (hollow diamond) markers — the
 *     same visual language as <TrajectorySpark>, stretched to the decade;
 *   - edition gaps as GAPS: contiguous FY runs become separate polyline
 *     segments; missing books are never interpolated (spec §2 rule 4);
 *   - a compact value grid where EVERY point is a state-A <Cite> on its
 *     own fid (dataset budget_lines_decade) — the citable interface for
 *     the sparkline; gap cells render "–" with a "Not in the PB20XX
 *     edition" tooltip;
 *   - an "asked vs spent" line when the sidecar carries the PE's largest
 *     request-vs-actuals book diff — the delta cites the minted diff fact
 *     (dataset fct_book_diff, breakdown reachable via the citation panel);
 *     both sides cite their own edition's grains from the series. If a
 *     side is missing from the series, the whole line is suppressed — an
 *     uncitable claim renders as absence, never as bare prose.
 *
 * Units: decade values are USD thousands (Cite renders compact USD).
 * Motion: the line segments fade in via .decade-draw (globals.css, motion
 * tokens, opacity-only per the G7 compositor rule) — prefers-reduced-motion
 * collapses to the final frame.
 *
 * Edition window: the loaded editions are PB2017–PB2026 (Phase 5E). A
 * kind's eligible FY range derives from that window (actuals for FY N live
 * in PB(N+2) → FY2015–FY2024); cells OUTSIDE the window are structurally
 * impossible (no loaded book could carry them) and render empty, while
 * cells INSIDE the window with no entry are honest per-edition gaps.
 * Update alongside the edition manifest when editions roll forward.
 */

const EDITION_MIN = 2017;
const EDITION_MAX = 2026;

/** fy of the KIND's figure → the edition (PB book) that reports it. */
const EDITION_FOR_FY: Record<Kind, (fy: number) => number> = {
  actuals: (fy) => fy + 2,
  enacted: (fy) => fy + 1,
  request: (fy) => fy,
};

type Kind = "actuals" | "enacted" | "request";
const KINDS: Kind[] = ["actuals", "enacted", "request"];
const KIND_LABEL: Record<Kind, string> = {
  actuals: "Actuals",
  enacted: "Enacted",
  request: "Request",
};

const SVG_WIDTH = 340;
const SVG_HEIGHT = 72;
const PADDING = 8;
const LABEL_BAND = 12;
const POINT_R = 2.5;

interface DecadeTrajectoryProps {
  series: DecadeSeries | null | undefined;
  bookDiff: ProgramBookDiff | null | undefined;
  /** "fy|measure" keys with a declared reconciliation entry (gate 23 a2):
   *  grid cells / asked-vs-spent sides on those keys carry
   *  data-reconciliation. */
  reconKeys?: Set<string>;
}

/** Split points (sorted by fy) into runs of CONSECUTIVE fiscal years. */
export function contiguousRuns(points: DecadePoint[]): DecadePoint[][] {
  const runs: DecadePoint[][] = [];
  for (const p of points) {
    const run = runs[runs.length - 1];
    if (run && p.fy === run[run.length - 1].fy + 1) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

export function DecadeTrajectory({ series, bookDiff, reconKeys }: DecadeTrajectoryProps) {
  if (!series) return null;

  const byKind: Record<Kind, DecadePoint[]> = {
    actuals: [...(series.actuals ?? [])].sort((a, b) => a.fy - b.fy),
    enacted: [...(series.enacted ?? [])].sort((a, b) => a.fy - b.fy),
    request: [...(series.request ?? [])].sort((a, b) => a.fy - b.fy),
  };
  const all = [...byKind.actuals, ...byKind.enacted, ...byKind.request];
  if (all.length === 0) return null;

  const fys = all.map((p) => p.fy);
  const minFy = Math.min(...fys);
  const maxFy = Math.max(...fys);
  const values = all.map((p) => p.v);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV;

  const innerW = SVG_WIDTH - PADDING * 2;
  const innerH = SVG_HEIGHT - PADDING * 2 - LABEL_BAND;
  const chartBottom = PADDING + innerH;

  const toX = (fy: number) =>
    PADDING + ((fy - minFy) / Math.max(maxFy - minFy, 1)) * innerW;
  const toY = (v: number) =>
    range === 0 ? PADDING + innerH / 2 : PADDING + innerH - ((v - minV) / range) * innerH;

  // Trend color from the actuals span (existing sparkline idiom).
  const a = byKind.actuals;
  const trendColor =
    a.length >= 2
      ? a[a.length - 1].v > a[0].v
        ? "#16a34a" // green-600
        : a[a.length - 1].v < a[0].v
          ? "#dc2626" // red-600
          : "#6b7280"
      : "#6b7280"; // gray-500

  const runs = contiguousRuns(byKind.actuals);

  // Grid columns: every FY in the observed span. Cells outside a kind's
  // eligible edition window render empty (structurally impossible); inside
  // the window, absent entries are per-edition gaps ("–" + tooltip).
  const gridFys: number[] = [];
  for (let fy = minFy; fy <= maxFy; fy++) gridFys.push(fy);
  const pointAt = (kind: Kind, fy: number) =>
    byKind[kind].find((p) => p.fy === fy);
  const inWindow = (kind: Kind, fy: number) => {
    const edition = EDITION_FOR_FY[kind](fy);
    return edition >= EDITION_MIN && edition <= EDITION_MAX;
  };

  // Asked-vs-spent (largest request-vs-actuals gap): only render when BOTH
  // sides resolve from the series — every dollar in the line must be cited.
  const diffSides =
    bookDiff && bookDiff.kind === "request_vs_actuals"
      ? {
          request: byKind.request.find(
            (p) => p.fy === bookDiff.fy && p.edition === bookDiff.from_edition,
          ),
          actuals: byKind.actuals.find(
            (p) => p.fy === bookDiff.fy && p.edition === bookDiff.to_edition,
          ),
        }
      : null;
  const showDiff = Boolean(diffSides?.request && diffSides?.actuals);

  return (
    <div data-testid="decade-trajectory" className="space-y-3">
      <svg
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="img"
        aria-label={`Decade budget trajectory, FY${minFy} to FY${maxFy}, across President's Budget editions`}
        data-testid="decade-spark"
        className="max-w-full"
      >
        {/* Baseline */}
        <line
          x1={PADDING}
          y1={chartBottom}
          x2={SVG_WIDTH - PADDING}
          y2={chartBottom}
          stroke="#e5e7eb"
          strokeWidth="1"
        />
        {/* Actuals line — one segment per contiguous FY run (gaps stay gaps) */}
        {runs
          .filter((run) => run.length >= 2)
          .map((run) => (
            <polyline
              key={`run-${run[0].fy}`}
              data-decade-line=""
              className="decade-draw"
              points={run.map((p) => `${toX(p.fy)},${toY(p.v)}`).join(" ")}
              fill="none"
              stroke={trendColor}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        {/* Actuals points (isolated points render even without a segment) */}
        {byKind.actuals.map((p) => (
          <circle
            key={`a-${p.fy}`}
            data-decade-point=""
            data-kind="actuals"
            data-fy={p.fy}
            cx={toX(p.fy)}
            cy={toY(p.v)}
            r={POINT_R}
            fill={trendColor}
          >
            {/* <desc> (a11y): year + edition ONLY — currency tokens in desc
                must twin a [data-amount] sibling (render-static rule); the
                cited values live in the grid below instead. */}
            <desc>
              FY{p.fy} actuals — PB{p.edition} edition
            </desc>
          </circle>
        ))}
        {/* Enacted markers — hollow circles */}
        {byKind.enacted.map((p) => (
          <circle
            key={`e-${p.fy}`}
            data-decade-point=""
            data-kind="enacted"
            data-fy={p.fy}
            cx={toX(p.fy)}
            cy={toY(p.v)}
            r={POINT_R}
            fill="none"
            stroke="#6b7280"
            strokeWidth="1.2"
          >
            <desc>
              FY{p.fy} enacted — PB{p.edition} edition
            </desc>
          </circle>
        ))}
        {/* Request markers — hollow diamonds */}
        {byKind.request.map((p) => {
          const x = toX(p.fy);
          const y = toY(p.v);
          const r = POINT_R + 0.5;
          return (
            <path
              key={`r-${p.fy}`}
              data-decade-point=""
              data-kind="request"
              data-fy={p.fy}
              d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
              fill="none"
              stroke="#6b7280"
              strokeWidth="1.2"
            >
              <desc>
                FY{p.fy} request — PB{p.edition} edition
              </desc>
            </path>
          );
        })}
        {/* Span labels inside the reserved band (first/last anchor at edges) */}
        <text
          x={Math.max(toX(minFy) - POINT_R, 1)}
          y={SVG_HEIGHT - 2}
          textAnchor="start"
          fontSize="8"
          fill="#9ca3af"
        >
          FY{String(minFy).slice(-2)}
        </text>
        <text
          x={Math.min(toX(maxFy) + POINT_R, SVG_WIDTH - 1)}
          y={SVG_HEIGHT - 2}
          textAnchor="end"
          fontSize="8"
          fill="#9ca3af"
        >
          FY{String(maxFy).slice(-2)}
        </text>
      </svg>

      {/* Marker key — one quiet line (12px floor per P1-1: provenance
          legends are never sub-12px) */}
      <p data-testid="decade-marker-key" className="text-xs leading-4 text-muted-foreground">
        &#9679; actuals (line) &nbsp;&middot;&nbsp; &#9675; enacted
        &nbsp;&middot;&nbsp; &#9671; request &mdash; gaps are editions the
        program is absent from, never interpolated.
      </p>

      {/* Value grid — the citable interface: every point opens its citation */}
      <div className="overflow-x-auto">
        <table
          data-testid="decade-grid"
          className="w-full border-collapse text-[11px]"
          aria-label="Decade series values by fiscal year and edition"
        >
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border px-1.5 py-1 text-left font-medium text-muted-foreground"
              >
                <span className="sr-only">Series</span>
              </th>
              {gridFys.map((fy) => (
                <th
                  key={fy}
                  scope="col"
                  className="border-b border-border px-1.5 py-1 text-right font-medium text-muted-foreground whitespace-nowrap"
                >
                  FY{String(fy).slice(-2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KINDS.map((kind) =>
              byKind[kind].length === 0 ? null : (
                <tr key={kind} className="border-b border-border last:border-b-0">
                  <th
                    scope="row"
                    className="px-1.5 py-1 text-left font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {KIND_LABEL[kind]}
                  </th>
                  {gridFys.map((fy) => {
                    const p = pointAt(kind, fy);
                    if (p) {
                      return (
                        <td
                          key={fy}
                          data-decade-cell={`${kind}-${fy}`}
                          className="px-1.5 py-1 text-right font-mono tabular-nums whitespace-nowrap"
                        >
                          <Cite
                            value={p.v}
                            units="USD thousands"
                            dataset="budget_lines_decade"
                            factId={p.fid}
                            basis={p.basis}
                            fy={p.fy}
                            measure={p.measure}
                            edition={p.edition}
                            reconciled={reconKeys?.has(`${p.fy}|${p.measure}`)}
                            chip={false}
                          />
                        </td>
                      );
                    }
                    if (!inWindow(kind, fy)) {
                      // No loaded book could carry this cell — structurally
                      // empty, not a gap.
                      return (
                        <td
                          key={fy}
                          data-decade-cell={`${kind}-${fy}`}
                          className="px-1.5 py-1"
                          aria-hidden="true"
                        />
                      );
                    }
                    return (
                      <td
                        key={fy}
                        data-decade-cell={`${kind}-${fy}`}
                        title={`Not in the PB${EDITION_FOR_FY[kind](fy)} edition`}
                        className="px-1.5 py-1 text-right font-mono tabular-nums text-muted-foreground"
                      >
                        –
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* Blank-vs-dash disambiguation — one quiet line (5E visual-judge E3):
          blank cells are structurally impossible (no loaded book could carry
          them); "–" cells are honest per-edition gaps. The distinction must
          be decodable without the methodology page. */}
      <p
        data-testid="decade-grid-note"
        className="text-xs leading-4 text-muted-foreground"
      >
        blank = series not published for this year; – = absent from that
        edition.
      </p>

      {/* Asked vs spent — the PE's largest request-vs-actuals gap, fully cited */}
      {showDiff && bookDiff && diffSides?.request && diffSides?.actuals && (
        <p
          data-testid="asked-vs-spent"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground"
        >
          <span className="font-medium text-foreground">Asked vs spent:</span>{" "}
          the PB{bookDiff.from_edition} book requested{" "}
          <Cite
            value={diffSides.request.v}
            units="USD thousands"
            dataset="budget_lines_decade"
            factId={diffSides.request.fid}
            basis={diffSides.request.basis}
            fy={diffSides.request.fy}
            measure={diffSides.request.measure}
            edition={diffSides.request.edition}
            reconciled={reconKeys?.has(
              `${diffSides.request.fy}|${diffSides.request.measure}`,
            )}
            chip={false}
          />{" "}
          for FY{bookDiff.fy}; the PB{bookDiff.to_edition} book reports{" "}
          <Cite
            value={diffSides.actuals.v}
            units="USD thousands"
            dataset="budget_lines_decade"
            factId={diffSides.actuals.fid}
            basis={diffSides.actuals.basis}
            fy={diffSides.actuals.fy}
            measure={diffSides.actuals.measure}
            edition={diffSides.actuals.edition}
            reconciled={reconKeys?.has(
              `${diffSides.actuals.fy}|${diffSides.actuals.measure}`,
            )}
            chip={false}
          />{" "}
          actually spent —{" "}
          <Cite
            value={bookDiff.delta}
            units="USD thousands"
            dataset="fct_book_diff"
            factId={bookDiff.fid}
            basis={bookDiff.basis}
            fy={bookDiff.fy}
            measure={bookDiff.measure}
            edition={bookDiff.edition}
            chip={false}
            // Direction is stated in words; the magnitude renders unsigned
            // (the citation panel carries the signed recorded_value).
            display={formatAmount(Math.abs(bookDiff.delta), "USD thousands")}
          />{" "}
          {bookDiff.delta >= 0 ? "above" : "below"} the request.
        </p>
      )}
    </div>
  );
}
