import React from "react";
import Link from "next/link";
import {
  getFlow,
  getDistrictDetail,
  getEntityTopMap,
  type FlowSidecar,
} from "@/lib/data";
import { formatAmountNoCurrency } from "@/lib/format";
import { Cite } from "@/components/cite";

/**
 * FollowTheDollar (Task 6b) — server-rendered SVG flow for the 17
 * crosswalked programs: appropriation → PE → top-12 awards → recipient
 * families → district chips.
 *
 * Provenance contract (binding plan decision):
 *   - Award dollars inside the SVG are ILLUSTRATIVE transaction sums from the
 *     flows sidecar, rendered WITHOUT a '$' sign (outside the currency-gate
 *     regex; see formatAmountNoCurrency).
 *   - The CITED figures are in the table below the SVG: per-district
 *     obligations from fct_district_programs via their (district, pe_bli)
 *     USAspending fact_ids. The note under the SVG says so.
 *
 * Animation: compositor-only — dots translate along straight edges via CSS
 * transform keyframes (globals.css `flow-dot-travel`, per-edge --flow-dx/dy).
 * prefers-reduced-motion kills animations and hides the dots (static SVG).
 * Accessibility: <desc> only — never <title> (hydration trap, recon §H).
 */

// ── Data assembly (used by the program page for its citation slice) ──────────

export interface FlowDistrictRow {
  awardCount: number | null;
  district: string;
  /** USAspending (district, pe_bli) fact_id — null only if the mart row is missing. */
  factId: string | null;
  familyNames: string[];
  totalObligation: number | null;
}

export interface FlowData {
  districtRows: FlowDistrictRow[];
  flow: FlowSidecar;
}

export function getFlowData(peBli: string): FlowData | null {
  const flow = getFlow(peBli);
  if (!flow || flow.awards.length === 0) return null;

  const districts = [
    ...new Set(
      flow.awards
        .map((a) => a.district)
        .filter((d): d is string => Boolean(d)),
    ),
  ];

  const districtRows: FlowDistrictRow[] = districts.map((district) => {
    let factId: string | null = null;
    let totalObligation: number | null = null;
    let awardCount: number | null = null;
    try {
      const detail = getDistrictDetail(district);
      const prog = detail.programs.find((p) => p.pe_bli === peBli);
      if (prog) {
        factId = prog.fact_id;
        totalObligation = prog.total_obligation;
        awardCount = prog.award_count;
      }
    } catch {
      // district sidecar missing — row renders without cited dollars
    }
    const familyNames = [
      ...new Set(
        flow.awards
          .filter((a) => a.district === district)
          .map((a) => a.recipient_name),
      ),
    ];
    return { awardCount, district, factId, familyNames, totalObligation };
  });

  return { districtRows, flow };
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const VIEW_W = 1000;
const ROW = 50;
const TOP = 44; // leaves room for column headers
const BOTTOM = 24;
const NODE_H = 40;
const CHIP_H = 26;

const COL = {
  app: { x: 4, w: 150 },
  pe: { x: 192, w: 180 },
  award: { x: 412, w: 218 },
  fam: { x: 668, w: 198 },
  dist: { x: 904, w: 92 },
} as const;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Vertical center of row i in a stack of n rows, centered in the canvas. */
function rowY(i: number, n: number, contentRows: number): number {
  const stackTop = TOP + ((contentRows - n) * ROW) / 2;
  return stackTop + i * ROW + ROW / 2;
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  data: FlowData;
}

export function FollowTheDollar({ data }: Props) {
  const { flow, districtRows } = data;
  const { header } = flow;
  const awards = flow.awards;

  const entityMap = getEntityTopMap();

  // Ordered unique families (by first appearance in award order)
  const familySlugs: string[] = [];
  const familyName = new Map<string, string>();
  for (const a of awards) {
    if (!familyName.has(a.family_slug)) {
      familySlugs.push(a.family_slug);
      const entity = entityMap.get(a.family_slug);
      familyName.set(a.family_slug, entity?.display_name ?? a.recipient_name);
    }
  }

  // Ordered unique districts
  const districts = districtRows.map((r) => r.district);

  const contentRows = Math.max(awards.length, familySlugs.length, districts.length, 1);
  const viewH = TOP + contentRows * ROW + BOTTOM;

  const famIndex = new Map(familySlugs.map((s, i) => [s, i]));
  const distIndex = new Map(districts.map((d, i) => [d, i]));

  const yApp = TOP + (contentRows * ROW) / 2;
  const yPe = yApp;
  const yAward = (i: number) => rowY(i, awards.length, contentRows);
  const yFam = (i: number) => rowY(i, familySlugs.length, contentRows);
  const yDist = (i: number) => rowY(i, districts.length, contentRows);

  // family → district edges (deduped pairs)
  const famDistPairs: { from: string; to: string }[] = [];
  const seenPairs = new Set<string>();
  for (const a of awards) {
    if (!a.district) continue;
    const key = `${a.family_slug}|${a.district}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    famDistPairs.push({ from: a.family_slug, to: a.district });
  }

  const fy26Label =
    header.fy2026_total !== null
      ? `${formatAmountNoCurrency(header.fy2026_total, "USD thousands")} FY26`
      : null;

  const desc =
    `Flow of dollars for program ${header.pe_bli}` +
    (header.title ? ` (${header.title})` : "") +
    `: from the ${header.org ?? ""} appropriation to the program element, ` +
    `then to the top ${awards.length} high-confidence awards, their recipient ` +
    `families, and congressional districts. Figures inside the diagram are ` +
    `illustrative transaction sums; the table below carries the cited values.`;

  return (
    <section className="mt-8 pt-6 border-t border-border" id="follow-the-dollar">
      <h2 className="text-xl font-semibold mb-1">Follow the dollar</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Appropriation → program element → top high-confidence awards →
        recipient families → congressional districts.
      </p>

      <div className="flow-anim overflow-x-auto rounded-lg border border-border bg-card p-3">
        <svg
          viewBox={`0 0 ${VIEW_W} ${viewH}`}
          className="min-w-[860px] w-full h-auto"
          role="img"
          aria-label={`Follow-the-dollar diagram for ${header.pe_bli}`}
          data-flow-svg={header.pe_bli}
        >
          <desc>{desc}</desc>

          {/* Column headers */}
          <text x={COL.app.x + COL.app.w / 2} y={16} textAnchor="middle" className="fill-muted-foreground" fontSize={10} fontWeight={600}>
            APPROPRIATION
          </text>
          <text x={COL.pe.x + COL.pe.w / 2} y={16} textAnchor="middle" className="fill-muted-foreground" fontSize={10} fontWeight={600}>
            PROGRAM ELEMENT
          </text>
          <text x={COL.award.x + COL.award.w / 2} y={16} textAnchor="middle" className="fill-muted-foreground" fontSize={10} fontWeight={600}>
            TOP AWARDS
          </text>
          <text x={COL.fam.x + COL.fam.w / 2} y={16} textAnchor="middle" className="fill-muted-foreground" fontSize={10} fontWeight={600}>
            RECIPIENT FAMILIES
          </text>
          <text x={COL.dist.x + COL.dist.w / 2} y={16} textAnchor="middle" className="fill-muted-foreground" fontSize={10} fontWeight={600}>
            DISTRICTS
          </text>

          {/* Edges: appropriation → PE */}
          <line
            x1={COL.app.x + COL.app.w}
            y1={yApp}
            x2={COL.pe.x}
            y2={yPe}
            className="stroke-border"
            strokeWidth={1.5}
          />

          {/* Edges: PE → awards (+ animated dots) */}
          {awards.map((a, i) => {
            const x1 = COL.pe.x + COL.pe.w;
            const y1 = yPe;
            const x2 = COL.award.x;
            const y2 = yAward(i);
            return (
              <g key={`pe-award-${a.piid}-${i}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-border" strokeWidth={1} />
                <circle
                  cx={x1}
                  cy={y1}
                  r={3}
                  className="flow-dot fill-primary"
                  style={
                    {
                      "--flow-dx": `${x2 - x1}px`,
                      "--flow-dy": `${y2 - y1}px`,
                      animationDelay: `${(i % 6) * 0.6}s`,
                    } as React.CSSProperties
                  }
                />
              </g>
            );
          })}

          {/* Edges: award → family */}
          {awards.map((a, i) => {
            const fi = famIndex.get(a.family_slug);
            if (fi === undefined) return null;
            return (
              <line
                key={`award-fam-${a.piid}-${i}`}
                x1={COL.award.x + COL.award.w}
                y1={yAward(i)}
                x2={COL.fam.x}
                y2={yFam(fi)}
                className="stroke-border"
                strokeWidth={1}
              />
            );
          })}

          {/* Edges: family → district */}
          {famDistPairs.map((p) => {
            const fi = famIndex.get(p.from);
            const di = distIndex.get(p.to);
            if (fi === undefined || di === undefined) return null;
            return (
              <line
                key={`fam-dist-${p.from}-${p.to}`}
                x1={COL.fam.x + COL.fam.w}
                y1={yFam(fi)}
                x2={COL.dist.x}
                y2={yDist(di)}
                className="stroke-border"
                strokeWidth={1}
              />
            );
          })}

          {/* Appropriation node */}
          <g>
            <rect
              x={COL.app.x}
              y={yApp - NODE_H / 2}
              width={COL.app.w}
              height={NODE_H}
              rx={6}
              className="fill-muted stroke-border"
              strokeWidth={1}
            />
            <text x={COL.app.x + COL.app.w / 2} y={yApp - 2} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={600}>
              {header.org ?? "RDT&E"}
            </text>
            <text x={COL.app.x + COL.app.w / 2} y={yApp + 12} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
              RDT&amp;E appropriation
            </text>
          </g>

          {/* PE node */}
          <g data-flow-node="pe" data-dollars={header.fy2026_total ?? undefined}>
            <rect
              x={COL.pe.x}
              y={yPe - NODE_H / 2}
              width={COL.pe.w}
              height={NODE_H}
              rx={6}
              className="fill-muted stroke-border"
              strokeWidth={1.5}
            />
            <text x={COL.pe.x + COL.pe.w / 2} y={yPe - 4} textAnchor="middle" className="fill-foreground" fontSize={11} fontWeight={700} fontFamily="var(--font-mono)">
              {header.pe_bli}
            </text>
            <text x={COL.pe.x + COL.pe.w / 2} y={yPe + 11} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
              {fy26Label ?? truncate(header.title ?? "", 30)}
            </text>
          </g>

          {/* Award nodes */}
          {awards.map((a, i) => {
            const y = yAward(i);
            return (
              <g
                key={`award-${a.piid}-${i}`}
                data-flow-node="award"
                data-piid={a.piid}
                data-dollars={a.dollars ?? undefined}
              >
                <rect
                  x={COL.award.x}
                  y={y - NODE_H / 2 + 2}
                  width={COL.award.w}
                  height={NODE_H - 4}
                  rx={5}
                  className="fill-card stroke-border"
                  strokeWidth={1}
                />
                <text x={COL.award.x + 8} y={y - 3} className="fill-foreground" fontSize={9.5} fontFamily="var(--font-mono)">
                  {truncate(a.piid, 18)}
                </text>
                <text x={COL.award.x + 8} y={y + 10} className="fill-muted-foreground" fontSize={9}>
                  {truncate(a.recipient_name, 28)}
                </text>
                {a.dollars !== null && (
                  <text
                    x={COL.award.x + COL.award.w - 8}
                    y={y - 3}
                    textAnchor="end"
                    className="fill-foreground"
                    fontSize={10}
                    fontWeight={600}
                  >
                    {formatAmountNoCurrency(a.dollars, "USD")}
                  </text>
                )}
              </g>
            );
          })}

          {/* Recipient family nodes (linked when in entities_top) */}
          {familySlugs.map((slug, i) => {
            const y = yFam(i);
            const name = truncate(familyName.get(slug) ?? slug, 26);
            const linked = entityMap.has(slug);
            const node = (
              <g data-flow-node="family" data-family-slug={slug}>
                <rect
                  x={COL.fam.x}
                  y={y - 16}
                  width={COL.fam.w}
                  height={32}
                  rx={5}
                  className={linked ? "fill-card stroke-border" : "fill-muted stroke-border"}
                  strokeWidth={1}
                />
                <text
                  x={COL.fam.x + COL.fam.w / 2}
                  y={y + 4}
                  textAnchor="middle"
                  className={linked ? "fill-primary" : "fill-foreground"}
                  fontSize={10}
                  fontWeight={600}
                  textDecoration={linked ? "underline" : undefined}
                >
                  {name}
                </text>
              </g>
            );
            return linked ? (
              <a key={`fam-${slug}`} href={`/company/${slug}/`} aria-label={`Company page: ${familyName.get(slug)}`}>
                {node}
              </a>
            ) : (
              <g key={`fam-${slug}`}>{node}</g>
            );
          })}

          {/* District chips */}
          {districts.map((d, i) => {
            const y = yDist(i);
            return (
              <a key={`dist-${d}`} href={`/district/${d}/`} aria-label={`District page: ${d}`}>
                <g data-flow-node="district" data-district={d}>
                  <rect
                    x={COL.dist.x}
                    y={y - CHIP_H / 2}
                    width={COL.dist.w}
                    height={CHIP_H}
                    rx={13}
                    className="fill-muted stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={COL.dist.x + COL.dist.w / 2}
                    y={y + 4}
                    textAnchor="middle"
                    className="fill-primary"
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="var(--font-mono)"
                  >
                    {d}
                  </text>
                </g>
              </a>
            );
          })}
        </svg>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        The diagram illustrates the cited table below — amounts shown in the
        diagram are transaction sums per award (no citation chips); the
        per-district obligations in the table cite USAspending queries.
      </p>

      {/* Cited per-district table */}
      <div className="mt-3 rounded-lg border border-border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                District
              </th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide hidden sm:table-cell">
                Recipients in diagram
              </th>
              <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                Program obligations
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {districtRows.map((row) => (
              <tr key={row.district} className="hover:bg-muted/40 transition-colors">
                <td className="px-4 py-2.5 font-mono">
                  <Link
                    href={`/district/${row.district}/`}
                    className="text-primary hover:underline"
                  >
                    {row.district}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {row.familyNames.map((n) => truncate(n, 30)).join(", ")}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {row.totalObligation !== null && row.factId ? (
                    <Cite
                      value={row.totalObligation}
                      units="USD"
                      dataset="fct_district_programs"
                      factId={row.factId}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
