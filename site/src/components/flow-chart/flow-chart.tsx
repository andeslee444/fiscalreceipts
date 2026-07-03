"use client";

/**
 * flow-chart.tsx — /flow/ two-river Sankey island (Phase 5H).
 *
 * Client island: lazily fetches /json/flow_chart.json (exporter sidecar,
 * copied to public/json/ by prepare-assets) and renders the PRECOMPUTED
 * Sankey layout as SVG — two visually distinct, separately-labeled systems:
 *
 *   - Budget river (intent): FY2026 PB request, USD thousands, monochrome
 *     slate ribbons, terminating in the explicit bridge band (crosswalked vs
 *     "not yet crosswalked").
 *   - Spend river (obligations): USD, per selected FY (payload carries all
 *     FYs — the selector re-renders, never refetches). Ribbons are split
 *     into competition-class sub-bands (extent_competed, Okabe-Ito
 *     colorblind-safe palette + hatch pattern on "not competed"), with the
 *     offers-received distribution on hover.
 *
 * Provenance: every node opens the citation panel on click/Enter via
 * CitationPanelContext (lazy cite-shard resolution — the /flow/ page mounts
 * the provider with an EMPTY slice, same as /years/). Edge ribbons open
 * their own edge facts on click. "Other (N)" nodes open a drill-down dialog
 * ([data-testid="flow-drilldown"]) listing the aggregated members.
 *
 * Negative flows (net de-obligations) follow the exporter's documented rule:
 * zero-width band → rendered as a dashed hairline whose STROKE never encodes
 * magnitude; the tooltip and aria-label carry the honest negative value.
 *
 * Motion: tokens only, compositor-only (opacity/transform keyframes in
 * globals.css); prefers-reduced-motion collapses everything to the final
 * frame via the token override. Amounts inside the SVG are formatted
 * WITHOUT '$' (Task 6b convention) — the cited figures are one click away.
 *
 * DOM contract (G9 flowdown gate leg e, BINDING — gate built first):
 *   [data-testid="flow-chart"], [data-flow-river="budget|spend"][data-fy],
 *   [data-flow-node][data-node-id] (click → citation panel),
 *   [data-flow-other] (click → drill-down), [data-testid="flow-drilldown"]
 *   with [data-drill-member] rows, [data-testid="flow-fy-select"].
 */

import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CitationPanelContext } from "@/components/cite";
import type { AmountUnits } from "@/lib/format";
import {
  BUDGET_LEVEL_LABELS,
  COMPETED_CLASS_LABELS,
  SPEND_LEVEL_LABELS,
  type FlowChartPayload,
  type FlowEdge,
  type FlowNode,
} from "@/lib/flow";
import {
  centerlinePath,
  displayAmount,
  distributionRows,
  isZeroBand,
  ribbonPath,
  splitEdgeBands,
} from "./geometry";

// ── Constants ────────────────────────────────────────────────────────────────

/** viewBox headroom above y=0 for the column-header row. */
const HEADER_H = 30;
/** Minimum node height (viewBox units) that still gets an inline label. */
const MIN_LABEL_H = 9;
/** Okabe-Ito fills per competed-class index — declared in globals.css. */
const CLASS_FILL_VARS = [
  "var(--flow-class-full)",
  "var(--flow-class-setaside)",
  "var(--flow-class-otherfull)",
  "var(--flow-class-notcomp)",
];
/** Class index rendered with the extra hatch overlay (colorblind backup). */
const HATCHED_CLASS_INDEX = 3; // not_competed

function asUnits(u: string): AmountUnits {
  return u === "USD thousands" || u === "USD millions" ? u : "USD";
}

// ── Tooltip model ────────────────────────────────────────────────────────────

interface TipRow {
  label: string;
  value: string;
  pct?: string;
}

interface TipState {
  x: number;
  y: number;
  title: string;
  sub?: string;
  note?: string;
  sections: { heading: string; rows: TipRow[] }[];
}

// ── Component ────────────────────────────────────────────────────────────────

type LoadState =
  | { s: "loading" }
  | { s: "error" }
  | { s: "ready"; payload: FlowChartPayload };

interface DrillItem {
  node: FlowNode;
  units: AmountUnits;
  levelLabel: string;
}

export function FlowChart() {
  const [load, setLoad] = useState<LoadState>({ s: "loading" });
  const [fy, setFy] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillItem | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { openPanel } = useContext(CitationPanelContext);

  useEffect(() => {
    let cancelled = false;
    fetch("/json/flow_chart.json")
      .then((res) => {
        if (!res.ok) throw new Error(`flow_chart.json HTTP ${res.status}`);
        return res.json() as Promise<FlowChartPayload>;
      })
      .then((payload) => {
        if (!cancelled) setLoad({ s: "ready", payload });
      })
      .catch(() => {
        if (!cancelled) setLoad({ s: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Tooltip follows the pointer, clamped inside the chart container. */
  const showTip = useCallback(
    (evt: { clientX: number; clientY: number }, tipBody: Omit<TipState, "x" | "y">) => {
      const host = containerRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = Math.min(Math.max(evt.clientX - rect.left + 14, 0), rect.width - 270);
      const y = evt.clientY - rect.top + 14;
      setTip({ x, y, ...tipBody });
    },
    [],
  );
  const hideTip = useCallback(() => setTip(null), []);

  if (load.s === "loading") {
    return (
      <div
        data-testid="flow-loading"
        className="animate-pulse space-y-2 rounded-lg border border-border p-4"
        aria-label="Loading the flow chart"
      >
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-4 rounded bg-muted" aria-hidden="true" />
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          Loading the flow chart…
        </p>
      </div>
    );
  }

  if (load.s === "error") {
    return (
      <div
        data-degraded="flow"
        role="alert"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
      >
        The flow chart data could not be loaded — check your connection and
        reload. Every figure it aggregates is also browsable from{" "}
        <Link href="/programs/" className="underline hover:opacity-80">
          the programs index
        </Link>{" "}
        and{" "}
        <Link href="/years/" className="underline hover:opacity-80">
          the years matrix
        </Link>
        .
      </div>
    );
  }

  const { budget, spend } = load.payload;
  const activeFy = fy ?? String(spend.default_fy);
  const spendRiver = spend.by_fy[activeFy];
  const budgetUnits = asUnits(budget.units);
  const spendUnits = asUnits(spend.units);

  return (
    <div ref={containerRef} data-testid="flow-chart" className="relative space-y-10">
      {/* ── Budget river ── */}
      <section
        data-flow-river="budget"
        data-fy={String(budget.fiscal_year)}
        aria-label="Budget river"
      >
        <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">Budget river</h2>
          <span className="text-xs font-medium text-muted-foreground">
            {budget.label} · USD thousands
          </span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Requested dollars, split down to programs; the last column states
          how much of the request the contractor crosswalk can bridge. Click
          any block for its citation.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
          <RiverSvg
            idPrefix="flow-budget"
            nodes={budget.nodes}
            edges={budget.edges}
            width={budget.width}
            height={budget.height}
            units={budgetUnits}
            levelLabels={BUDGET_LEVEL_LABELS}
            variant="budget"
            ariaLabel={`Budget river Sankey: ${budget.label}, from the total request through components, appropriations, and budget activities to programs and the contractor bridge. All values in USD thousands.`}
            competedClasses={null}
            offersBuckets={null}
            onNode={(n, levelLabel) =>
              n.other
                ? setDrill({ node: n, units: budgetUnits, levelLabel })
                : openPanel(n.fid)
            }
            onEdgeClick={(e) => openPanel(e.f)}
            showTip={showTip}
            hideTip={hideTip}
          />
        </div>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
            Crosswalked programs ({budget.bridge.crosswalked_pe_count} PEs,{" "}
            {budget.bridge.high_confidence_pe_count} high-confidence)
          </summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {budget.bridge.programs.map((p) => (
              <li
                key={p.pe_bli}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="flex items-baseline gap-2">
                  <Link
                    href={`/program/${p.pe_bli}/`}
                    className="font-mono text-primary hover:underline"
                  >
                    {p.pe_bli}
                  </Link>
                  {p.confidence !== "high" && (
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      {p.confidence} confidence
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {displayAmount(p.value, budgetUnits)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {/* ── Spend river ── */}
      <section
        data-flow-river="spend"
        data-fy={activeFy}
        aria-label="Spend river"
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold">Spend river</h2>
          <span className="text-xs font-medium text-muted-foreground">
            DoD prime contract obligations · USD · FY{activeFy}
          </span>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Fiscal year
            <select
              data-testid="flow-fy-select"
              value={activeFy}
              onChange={(e) => setFy(e.target.value)}
              aria-label="Spend river fiscal year"
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {spend.fys.map((f) => (
                <option key={f} value={String(f)}>
                  FY{f}
                  {f === 2026 && spend.notes.fy2026_partial ? " — partial" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Obligated dollars for the selected year — a different measurement
          system from the budget river above (obligation years are not budget
          years). Ribbons are colored by FPDS competition class; hover for the
          offers-received distribution.
        </p>
        <CompetitionLegend classes={spend.competed_classes} />
        <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card p-3">
          {/* key remount = token fade per FY switch (final frame under
              reduced motion); data comes from the payload — no fetch. */}
          <div key={activeFy} className="flow-fade-in">
            <RiverSvg
              idPrefix={`flow-spend-${activeFy}`}
              nodes={spendRiver.nodes}
              edges={spendRiver.edges}
              width={spend.width}
              height={spend.height}
              units={spendUnits}
              levelLabels={SPEND_LEVEL_LABELS}
              variant="spend"
              ariaLabel={`Spend river Sankey: DoD prime contract obligations for FY${activeFy}, from the total through awarding sub-agencies and contracting offices to contractor families. All values in USD. Ribbon colors mark FPDS competition classes.`}
              competedClasses={spend.competed_classes}
              offersBuckets={spend.offers_buckets}
              onNode={(n, levelLabel) =>
                n.other
                  ? setDrill({ node: n, units: spendUnits, levelLabel })
                  : openPanel(n.fid)
              }
              onEdgeClick={(e) => openPanel(e.f)}
              showTip={showTip}
              hideTip={hideTip}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {spend.source_note} {spend.notes.offers}
        </p>
      </section>

      {/* ── Drill-down dialog for "Other (N)" nodes ── */}
      <DrillDialog
        item={drill}
        onClose={() => setDrill(null)}
        onCite={(fid) => {
          setDrill(null);
          openPanel(fid);
        }}
      />

      {/* ── Pointer tooltip (visual duplicate of the aria labels) ── */}
      {tip && (
        <div
          className="flow-tooltip pointer-events-none absolute left-0 top-0 z-30 w-64 rounded-md border border-border bg-background p-2.5 text-xs shadow-lg"
          style={{ transform: `translate3d(${tip.x}px, ${tip.y}px, 0)` }}
          aria-hidden="true"
        >
          <p className="font-semibold text-foreground">{tip.title}</p>
          {tip.sub && <p className="text-muted-foreground">{tip.sub}</p>}
          {tip.note && <p className="mt-1 text-muted-foreground">{tip.note}</p>}
          {tip.sections.map((sec) => (
            <div key={sec.heading} className="mt-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {sec.heading}
              </p>
              <ul>
                {sec.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {row.label}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-foreground">
                      {row.value}
                      {row.pct ? (
                        <span className="text-muted-foreground"> · {row.pct}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Competition legend ───────────────────────────────────────────────────────

function CompetitionLegend({ classes }: { classes: string[] }) {
  return (
    <div
      data-testid="flow-competition-legend"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Competition classes legend"
    >
      {classes.map((cls, i) => (
        <span key={cls} className="flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden="true" className="shrink-0">
            <rect width="16" height="10" rx="2" fill={CLASS_FILL_VARS[i]} />
            {i === HATCHED_CLASS_INDEX && (
              <g stroke="rgba(255,255,255,0.85)" strokeWidth="1">
                <line x1="3" y1="11" x2="11" y2="-1" />
                <line x1="8" y1="11" x2="16" y2="-1" />
              </g>
            )}
          </svg>
          {COMPETED_CLASS_LABELS[cls] ?? cls}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <svg width="16" height="10" aria-hidden="true" className="shrink-0">
          <line
            x1="0"
            y1="5"
            x2="16"
            y2="5"
            stroke="var(--flow-negative)"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
        </svg>
        net de-obligation (negative — drawn without width)
      </span>
    </div>
  );
}

// ── River SVG ────────────────────────────────────────────────────────────────

interface RiverSvgProps {
  idPrefix: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  width: number;
  height: number;
  units: AmountUnits;
  levelLabels: Record<string, string>;
  variant: "budget" | "spend";
  ariaLabel: string;
  competedClasses: string[] | null;
  offersBuckets: string[] | null;
  onNode: (node: FlowNode, levelLabel: string) => void;
  onEdgeClick: (edge: FlowEdge) => void;
  showTip: (
    evt: { clientX: number; clientY: number },
    tip: { title: string; sub?: string; note?: string; sections: { heading: string; rows: TipRow[] }[] },
  ) => void;
  hideTip: () => void;
}

/** Per-level column extents for the header row. */
function levelColumns(
  nodes: FlowNode[],
  levelLabels: Record<string, string>,
): { level: string; label: string; x0: number; x1: number }[] {
  const byLevel = new Map<string, { x0: number; x1: number }>();
  for (const n of nodes) {
    const cur = byLevel.get(n.level);
    if (!cur) byLevel.set(n.level, { x0: n.x0, x1: n.x1 });
    else {
      cur.x0 = Math.min(cur.x0, n.x0);
      cur.x1 = Math.max(cur.x1, n.x1);
    }
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[1].x0 - b[1].x0)
    .map(([level, ext]) => ({
      level,
      label: levelLabels[level] ?? level,
      ...ext,
    }));
}

function nodeFill(node: FlowNode, variant: "budget" | "spend"): string {
  if (node.id.endsWith(":not-crosswalked")) return "var(--flow-bridge-gap)";
  if (node.id.endsWith(":crosswalked")) return "var(--flow-bridge-ok)";
  if (node.other) return "var(--flow-node-other)";
  return variant === "budget" ? "var(--flow-node-budget)" : "var(--flow-node-spend)";
}

function RiverSvg({
  idPrefix,
  nodes,
  edges,
  width,
  height,
  units,
  levelLabels,
  variant,
  ariaLabel,
  competedClasses,
  offersBuckets,
  onNode,
  onEdgeClick,
  showTip,
  hideTip,
}: RiverSvgProps) {
  const columns = levelColumns(nodes, levelLabels);

  const edgeTip = (e: FlowEdge) => {
    const src = nodes[e.s];
    const tgt = nodes[e.t];
    const sections: { heading: string; rows: TipRow[] }[] = [];
    if (competedClasses && e.c) {
      sections.push({
        heading: "Competition",
        rows: distributionRows(e.c, competedClasses).map((r) => ({
          label: COMPETED_CLASS_LABELS[r.key] ?? r.key,
          value: displayAmount(r.value, units),
          pct: r.pct,
        })),
      });
    }
    if (offersBuckets && e.o) {
      sections.push({
        heading: "Offers received",
        rows: distributionRows(e.o, offersBuckets).map((r) => ({
          label: r.key === "unknown" ? "unknown" : `${r.key} offer${r.key === "1" ? "" : "s"}`,
          value: displayAmount(r.value, units),
          pct: r.pct,
        })),
      });
    }
    return {
      title: `${src.label} → ${tgt.label}`,
      sub: `${displayAmount(e.v, units)} ${units}`,
      note:
        e.v < 0
          ? "Net de-obligation — more was clawed back than newly obligated; drawn without width."
          : undefined,
      sections,
    };
  };

  const nodeTip = (n: FlowNode, levelLabel: string) => ({
    title: n.label,
    sub: `${levelLabel} · ${displayAmount(n.value, units)} ${units}`,
    note: n.other
      ? `Aggregates ${n.other.count} smaller ${levelLabel.toLowerCase()} entries — click to list them.`
      : "Click to open the citation.",
    sections: [],
  });

  return (
    <svg
      viewBox={`0 -${HEADER_H} ${width} ${height + HEADER_H + 6}`}
      className="h-auto w-full min-w-[840px]"
      role="group"
      aria-label={ariaLabel}
    >
      <desc>{ariaLabel}</desc>
      <defs>
        <pattern
          id={`${idPrefix}-hatch`}
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.65)" strokeWidth="1.6" />
        </pattern>
        <pattern
          id={`${idPrefix}-gap-dots`}
          patternUnits="userSpaceOnUse"
          width="7"
          height="7"
        >
          <rect width="7" height="7" fill="transparent" />
          <circle cx="2" cy="2" r="1" fill="rgba(255,255,255,0.7)" />
        </pattern>
      </defs>

      {/* Column headers */}
      {columns.map((col) => {
        const mid = (col.x0 + col.x1) / 2;
        const anchor = col.x0 < 40 ? "start" : col.x1 > width - 40 ? "end" : "middle";
        const x = anchor === "start" ? col.x0 : anchor === "end" ? col.x1 : mid;
        return (
          <text
            key={col.level}
            x={x}
            y={-12}
            textAnchor={anchor}
            className="fill-muted-foreground"
            fontSize={10}
            fontWeight={600}
            letterSpacing="0.08em"
          >
            {col.label.toUpperCase()}
          </text>
        );
      })}

      {/* Edges (painted under the nodes) */}
      {edges.map((e, i) => {
        const src = nodes[e.s];
        const zero = isZeroBand(e.g);
        const bands =
          competedClasses && e.c && !zero ? splitEdgeBands(e.g, e.c) : [];
        return (
          <g
            key={`e-${i}`}
            className="flow-edge"
            onClick={() => onEdgeClick(e)}
            onMouseMove={(evt) => showTip(evt, edgeTip(e))}
            onMouseLeave={hideTip}
            style={{ cursor: "pointer" }}
          >
            {zero ? (
              <path
                d={centerlinePath(src.x1, nodes[e.t].x0, e.g)}
                fill="none"
                stroke="var(--flow-negative)"
                strokeWidth={1.25}
                strokeDasharray="4 3"
                data-flow-negative=""
                role="img"
                aria-label={`${src.label} to ${nodes[e.t].label}: ${displayAmount(e.v, units)} ${units} (net de-obligation)`}
                className="flow-band"
              />
            ) : bands.length > 0 ? (
              <>
                {bands.map((b) => (
                  <path
                    key={b.classIndex}
                    d={ribbonPath(src.x1, nodes[e.t].x0, [b.sy0, b.sy1, b.ty0, b.ty1])}
                    fill={CLASS_FILL_VARS[b.classIndex]}
                    className="flow-band"
                  />
                ))}
                {bands
                  .filter((b) => b.classIndex === HATCHED_CLASS_INDEX)
                  .map((b) => (
                    <path
                      key={`h-${b.classIndex}`}
                      d={ribbonPath(src.x1, nodes[e.t].x0, [b.sy0, b.sy1, b.ty0, b.ty1])}
                      fill={`url(#${idPrefix}-hatch)`}
                      className="flow-band"
                    />
                  ))}
              </>
            ) : (
              <path
                d={ribbonPath(src.x1, nodes[e.t].x0, e.g)}
                fill={
                  nodes[e.t].id.endsWith(":not-crosswalked")
                    ? "var(--flow-band-gap)"
                    : "var(--flow-band-budget)"
                }
                className="flow-band"
              />
            )}
            {/* Invisible full-band hover/click target (thin bands are hard to hit) */}
            {!zero && (
              <path
                d={ribbonPath(src.x1, nodes[e.t].x0, e.g)}
                fill="transparent"
              />
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isOther = Boolean(n.other);
        const levelLabel = levelLabels[n.level] ?? n.level;
        const h = Math.max(n.y1 - n.y0, 0);
        const labelRight = n.x1 < width * 0.75;
        const showLabel = h >= MIN_LABEL_H;
        const gap = n.id.endsWith(":not-crosswalked");
        const marker = isOther
          ? { "data-flow-other": "" }
          : { "data-flow-node": "" };
        const activate = () => onNode(n, levelLabel);
        return (
          <g
            key={n.id}
            {...marker}
            data-node-id={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${n.label}: ${displayAmount(n.value, units)} ${units}. ${
              isOther
                ? `Aggregates ${n.other!.count} entries — press Enter to list them.`
                : "Press Enter for the citation."
            }`}
            className="flow-node"
            onClick={activate}
            onKeyDown={(evt) => {
              if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                activate();
              }
            }}
            onMouseMove={(evt) => showTip(evt, nodeTip(n, levelLabel))}
            onMouseLeave={hideTip}
            onBlur={hideTip}
          >
            {/* Enlarged invisible hit target for hairline nodes */}
            <rect
              x={n.x0 - 3}
              y={Math.min(n.y0, n.y1) - 3}
              width={n.x1 - n.x0 + 6}
              height={Math.max(h, 2) + 6}
              fill="transparent"
            />
            <rect
              className="flow-node-rect"
              x={n.x0}
              y={n.y0}
              width={n.x1 - n.x0}
              height={h}
              fill={nodeFill(n, variant)}
            />
            {gap && h > 0 && (
              <rect
                x={n.x0}
                y={n.y0}
                width={n.x1 - n.x0}
                height={h}
                fill={`url(#${idPrefix}-gap-dots)`}
                aria-hidden="true"
              />
            )}
            {showLabel && (
              <text
                x={labelRight ? n.x1 + 5 : n.x0 - 5}
                y={(n.y0 + n.y1) / 2 + 3.5}
                textAnchor={labelRight ? "start" : "end"}
                fontSize={10}
                className="fill-foreground"
              >
                {n.label}
                <tspan className="fill-muted-foreground">
                  {"  "}
                  {displayAmount(n.value, units)}
                </tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Drill-down dialog ────────────────────────────────────────────────────────

function DrillDialog({
  item,
  onClose,
  onCite,
}: {
  item: DrillItem | null;
  onClose: () => void;
  onCite: (fid: string) => void;
}) {
  const node = item?.node;
  const other = node?.other;
  return (
    <DialogPrimitive.Root
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="citation-panel-overlay fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content
          data-testid="flow-drilldown"
          className="flow-drill-pop fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-background shadow-xl outline-none"
          aria-describedby={undefined}
        >
          {node && other && item && (
            <>
              <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <DialogPrimitive.Title className="text-sm font-semibold">
                    {node.label} — {item.levelLabel.toLowerCase()} level
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-xs text-muted-foreground">
                    {displayAmount(node.value, item.units)} {item.units} across{" "}
                    {other.count} entries below the chart&apos;s top slice.
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close
                  className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Close drill-down"
                >
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>
              <div className="min-h-0 overflow-y-auto px-4 py-3">
                <ol className="space-y-1">
                  {other.members.map((m) => (
                    <li
                      key={m.k}
                      data-drill-member=""
                      className="flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="min-w-0 truncate text-foreground" title={m.k}>
                        {m.l}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        {displayAmount(m.v, item.units)}
                      </span>
                    </li>
                  ))}
                </ol>
                {other.omitted > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    …and {other.omitted} more totaling{" "}
                    {displayAmount(other.omitted_value, item.units)} — not
                    itemized in this export, but included (and verified) in the
                    node total.
                  </p>
                )}
              </div>
              <div className="border-t border-border px-4 py-3">
                <button
                  type="button"
                  data-testid="flow-drill-cite"
                  onClick={() => onCite(node.fid)}
                  className="text-xs text-primary underline decoration-dotted transition-colors hover:text-foreground"
                >
                  View the citation for this total
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
