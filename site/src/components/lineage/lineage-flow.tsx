"use client";

/**
 * <LineageFlow> — the /lineage/ identity diagram (ROADMAP #29(c)).
 *
 * WHAT IT DRAWS, AND WHAT IT REFUSES TO DRAW.
 *
 * #29(c) asked for "a lineage Sankey — reuse the /flow/ renderer — identities
 * as nodes over time, dollar ribbons for transfers/splits/merges". The ribbons
 * are here and they reuse /flow/'s ribbonPath() verbatim. They are NOT dollar
 * ribbons, and that is deliberate:
 *
 *     A Sankey ribbon's width is a transferred amount. Not one lineage edge in
 *     the corpus states one — program_lineage.portion_amount is non-null on
 *     ZERO rows. So every ribbon on this page is the same `ribbon_w` thick, on
 *     both faces, and a reader who measures one learns nothing about money,
 *     because there is nothing to learn. The page says so in its own copy,
 *     the legend says so, gate 22 leg (g) re-measures every built `d=` path to
 *     hold it there, and verify-lineage leg (i) checks the payload against the
 *     live table.
 *
 * Node boxes are uniform for the same reason: in a Sankey, node height is a
 * value. Here it must not be readable as one.
 *
 * STATED vs INFERRED. The program rail's treatment, kept literal rather than
 * merely similar: stated links are solid ribbons in the /flow/ budget-band
 * colour and every one is cited; inferred links are dashed amber, carry
 * data-inferred="true" and a visible "candidate (unverified)" label, and live
 * in their OWN collapsed figure below — not in the same picture as a fact.
 * A candidate is never drawn inside a family diagram.
 *
 * PAINT ORDER (the /flow/ gate-22-leg-f lesson, applied by construction).
 * SVG has no z-index: a later element covers an earlier one, which is how the
 * /flow/ Sankey ate 2–4 characters off 17 of 29 labels. Here every label sits
 * INSIDE its own opaque box, the boxes are disjoint by layout, and the three
 * layers are emitted strictly ribbons → box fills → labels/links. No rect can
 * cover a label, by construction rather than by collision search.
 *
 * 390px. /flow/'s Sankey is a fixed 840px inside a ~356px scroller, so its
 * right-hand column is cut mid-word and its node values clip at the scroll
 * edge. These diagrams are sized to their own content (most are 334px — they
 * fit a phone outright), every value label lives inside its box rather than at
 * a scroll edge, and the count of diagrams that do need a swipe is computed
 * from the payload instead of typed.
 *
 * DOM contract (BINDING — gate 22 leg (g) and verify-lineage leg (i) read it):
 *   [data-lineage-flow], [data-lineage-diagram][data-family-id|data-candidate],
 *   [data-lineage-edge="stated"|"inferred"][data-edge-from][data-edge-to]
 *     [data-edge-relation][data-edge-fy] with a [data-ribbon] path,
 *   [data-lineage-node][data-node-pe] and [data-lineage-unresolved] on the
 *     identities with no program page,
 *   [data-inferred="true"] on every candidate row/edge,
 *   table[data-chart-table][data-basis-table="lineage-identities"].
 */

import React, { useContext } from "react";
import { Cite, CitationPanelContext } from "@/components/cite";
import {
  ChartFigure,
  ChartTableDisclosure,
  chartDescId,
} from "@/components/chart-figure";
import { ribbonPath } from "@/components/flow-chart/geometry";
import { CautionNote } from "@/components/notes";
import {
  edgeRelationLabel,
  wideDiagramCount,
  type LineageFlowCandidate,
  type LineageFlowDiagram,
  type LineageFlowEdge,
  type LineageFlowFamily,
  type LineageFlowNode,
  type LineageFlowPayload,
} from "@/lib/lineage-flow";

// ── Small shared pieces ──────────────────────────────────────────────────────

/** The rail's citation marker, same markup and same attributes. */
function StatedCiteMarker({ factId }: { factId: string }) {
  const { openPanel } = useContext(CitationPanelContext);
  return (
    <button
      type="button"
      data-lineage-cite=""
      data-fact-id={factId}
      className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-card px-1 py-0.5 align-middle font-mono text-xs whitespace-nowrap text-muted-foreground underline decoration-dotted decoration-(--cite-decoration) underline-offset-2 transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground hover:decoration-solid hover:decoration-(--cite-decoration-hover) focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title="View the source sentence stating this link (official J-book page)"
      aria-label="View source citation for this lineage link"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanel(factId);
      }}
    >
      <span aria-hidden="true" className="not-italic">
        &#8220;
      </span>
      cited
    </button>
  );
}

function describeDiagram(d: LineageFlowDiagram, name: string): string {
  const links = d.edges.length;
  return (
    `${name}: ${d.nodes.length} program-element ${
      d.nodes.length === 1 ? "identity" : "identities"
    } and ${links} recorded ${links === 1 ? "link" : "links"} between them, ` +
    `laid out left to right in ${d.steps} lineage ${
      d.steps === 1 ? "step" : "steps"
    }. Ribbon thickness is the same for every link and carries no amount.`
  );
}

// ── One diagram (a family, or a single candidate pair) ───────────────────────

function Diagram({
  diagram,
  idPrefix,
  name,
  variant,
  linkable,
}: {
  diagram: LineageFlowDiagram;
  idPrefix: string;
  /** Accessible name for this SVG. */
  name: string;
  variant: "stated" | "candidate";
  linkable: ReadonlySet<string>;
}) {
  const { openPanel } = useContext(CitationPanelContext);
  const { nodes, edges, width, height } = diagram;
  const candidate = variant === "candidate";

  return (
    // The scroller, not the page: a diagram wider than the viewport scrolls
    // inside its own box so the document never moves sideways (gate 3 m1).
    // `min-w-0` is not decoration — without it the grid item above keeps its
    // default `min-width: auto` and grows to the widest diagram (742px),
    // which is exactly how the first build of this page pushed the document
    // 394px sideways at 390. Gate 3's m1 caught it; nothing else would have.
    <div className="min-w-0 overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        // role="group", not "img" — the /flow/ RiverSvg convention, for the
        // /flow/ reason: the identities inside are links and the ribbons are
        // buttons, and content inside a role="img" is not exposed to assistive
        // technology at all. A single image label would hide every one of them.
        role="group"
        aria-label={name}
        aria-describedby={chartDescId(
          candidate ? "lineage-candidates" : "lineage-graph",
        )}
        style={{ minWidth: width }}
        className="block"
      >
        <desc>{describeDiagram(diagram, name)}</desc>

        {/* ── layer 1: ribbons (painted UNDER every box and every label) ── */}
        <g>
          {edges.map((e, i) => {
            const src = nodes[e.s];
            const tgt = nodes[e.t];
            // Stated only — a candidate ribbon is not a button and carries no
            // accessible name of its own; its <title> and its section's
            // "candidate (unverified)" badge are what describe it.
            const label = `${src.pe} ${edgeRelationLabel(e.relation)} ${
              tgt.pe
            }, stated in the FY${e.fy} J-book`;
            const title = candidate
              ? `${src.pe} → ${tgt.pe} · ${edgeRelationLabel(
                  e.relation,
                )} · candidate (unverified) — inferred from program-element structure, not stated in any J-book sentence`
              : `${src.pe} → ${tgt.pe} · ${edgeRelationLabel(
                  e.relation,
                )} · per FY${e.fy} J-book — click for the source sentence`;
            return (
              <g
                key={`${idPrefix}-e-${i}`}
                data-lineage-edge={candidate ? "inferred" : "stated"}
                data-edge-from={src.pe}
                data-edge-to={tgt.pe}
                data-edge-relation={e.relation}
                data-edge-fy={e.fy}
                data-edge-fid={e.fid ?? undefined}
                {...(candidate ? { "data-inferred": "true" } : {})}
                role={candidate ? undefined : "button"}
                tabIndex={candidate || !e.fid ? undefined : 0}
                aria-label={candidate ? undefined : `${label}. Press Enter for the source.`}
                onClick={candidate || !e.fid ? undefined : () => openPanel(e.fid!)}
                onKeyDown={
                  candidate || !e.fid
                    ? undefined
                    : (evt) => {
                        if (evt.key === "Enter" || evt.key === " ") {
                          evt.preventDefault();
                          openPanel(e.fid!);
                        }
                      }
                }
                style={{ cursor: candidate ? "default" : "pointer" }}
              >
                <title>{title}</title>
                <path
                  data-ribbon=""
                  d={ribbonPath(src.x1, tgt.x0, e.g)}
                  className={
                    candidate
                      ? "fill-amber-500/20 stroke-amber-500/80"
                      : "fill-(--flow-band-budget) transition-opacity hover:opacity-70"
                  }
                  strokeWidth={candidate ? 1 : 0}
                  strokeDasharray={candidate ? "4 3" : undefined}
                />
              </g>
            );
          })}
        </g>

        {/* ── layer 2: box fills. Emitted before ANY label so no box can
              cover one — the /flow/ paint-order fix, made structural. ── */}
        <g aria-hidden="true" style={{ pointerEvents: "none" }}>
          {nodes.map((n) => (
            <rect
              key={`${idPrefix}-fill-${n.pe}`}
              x={n.x0}
              y={n.y0}
              width={n.x1 - n.x0}
              height={n.y1 - n.y0}
              rx={5}
              className={
                n.resolved
                  ? "fill-card stroke-border"
                  : "fill-muted/50 stroke-muted-foreground/50"
              }
              strokeWidth={1}
              strokeDasharray={n.resolved ? undefined : "3 2"}
            />
          ))}
        </g>

        {/* ── layer 3: labels and links ── */}
        {nodes.map((n) => (
          <NodeLabel
            key={`${idPrefix}-lbl-${n.pe}`}
            node={n}
            linkable={linkable}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * One identity's label. Two lines INSIDE its own box: the PE code, and either
 * the exporter-truncated title or "(unresolved)".
 *
 * resolved:false — or a PE that is simply not a built page — renders as plain
 * text, never an <a>. The rail's rule, and for the rail's reason: a dead link
 * is a 404 plus a gate failure, and an unresolved reference is a real,
 * publishable state of the record rather than a rendering gap.
 */
function NodeLabel({
  node,
  linkable,
}: {
  node: LineageFlowNode;
  linkable: ReadonlySet<string>;
}) {
  const cx = (node.x0 + node.x1) / 2;
  const isLink = node.resolved && linkable.has(node.pe);
  const body = (
    <>
      <text
        x={cx}
        y={node.y0 + 17}
        textAnchor="middle"
        fontSize={11}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        className={isLink ? "fill-primary" : "fill-muted-foreground"}
      >
        {node.pe}
      </text>
      <text
        x={cx}
        y={node.y0 + 30}
        textAnchor="middle"
        fontSize={8}
        className="fill-muted-foreground"
      >
        {node.resolved ? node.short ?? "—" : "(unresolved)"}
      </text>
    </>
  );
  return (
    <g
      data-lineage-node=""
      data-node-pe={node.pe}
      {...(isLink ? {} : { "data-lineage-unresolved": "" })}
    >
      <title>
        {node.title
          ? `${node.pe} — ${node.title}`
          : isLink
            ? node.pe
            : `${node.pe} — no program page in this corpus (unresolved reference)`}
      </title>
      {isLink ? (
        <a href={`/program/${node.pe}/`} aria-label={`${node.pe}${node.title ? ` — ${node.title}` : ""}`}>
          {body}
        </a>
      ) : (
        body
      )}
    </g>
  );
}

// ── The identities table (the chart's text form, and its only money) ─────────

function IdentityTable({
  payload,
  rows,
  caption,
  tableName,
}: {
  payload: LineageFlowPayload;
  rows: { node: LineageFlowNode; group: string }[];
  caption: string;
  tableName: string;
}) {
  return (
    <table
      data-chart-table=""
      data-basis-table={tableName}
      className="w-full min-w-[300px] text-xs"
    >
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
            Identity
          </th>
          <th scope="col" className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
            Group · step
          </th>
          <th
            scope="col"
            data-basis="toa"
            data-fy={String(payload.amount_fy)}
            data-measure={payload.amount_measure}
            className="px-2 py-1.5 text-right font-semibold text-muted-foreground"
          >
            FY{payload.amount_fy} request · P-1/R-1 TOA
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map(({ node, group }) => (
          <tr key={`${group}-${node.pe}`} data-entity={node.pe}>
            <th scope="row" className="px-2 py-1 text-left font-medium text-foreground">
              <code className="font-mono">{node.pe}</code>
              {node.title ? (
                <span className="block font-normal text-muted-foreground">
                  {node.title}
                </span>
              ) : null}
              {!node.resolved ? (
                <span className="block font-normal italic text-muted-foreground">
                  no program page in this corpus (unresolved reference)
                </span>
              ) : null}
            </th>
            <td className="px-2 py-1 text-muted-foreground">
              {group} · step {node.step + 1}
            </td>
            {/* data-primary-value sits on the CELL, not on the figure inside
                it: 36 of the 86 identities honestly render "—", and a hook on
                the [data-amount] would make exactly those rows unmeasurable at
                390 — the /district/ lesson, and the reason gate 3's own config
                measures cells everywhere else too. */}
            <td
              data-primary-value="lineage-amount"
              className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap"
            >
              {node.amount ? (
                <span>
                  <Cite
                    value={node.amount.v}
                    units="USD thousands"
                    dataset="fct_decade_series"
                    factId={node.amount.fid}
                    basis={node.amount.basis ?? "toa"}
                    fy={node.amount.fy}
                    measure={node.amount.measure ?? "request"}
                    entity={node.pe}
                    edition={node.amount.edition}
                    chip={false}
                  />
                </span>
              ) : (
                <span
                  className="text-muted-foreground"
                  title={`No FY${payload.amount_fy} request point for this identity in the ingested editions — an absence, not a zero`}
                >
                  —
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── The links table: every edge as text, with its citation ───────────────────

function LinkTable({
  diagrams,
  groupLabel,
  caption,
  candidate,
}: {
  diagrams: { key: string; label: string; d: LineageFlowDiagram }[];
  groupLabel: string;
  caption: string;
  candidate: boolean;
}) {
  return (
    <table className="w-full min-w-[300px] text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
            Link
          </th>
          <th scope="col" className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
            {groupLabel}
          </th>
          <th scope="col" className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
            Evidence
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {diagrams.flatMap(({ key, label, d }) =>
          d.edges.map((e: LineageFlowEdge, i: number) => {
            const src = d.nodes[e.s];
            const tgt = d.nodes[e.t];
            return (
              <tr
                key={`${key}-${i}`}
                {...(candidate
                  ? { "data-inferred": "true" }
                  : { "data-lineage-stated": "" })}
              >
                <th scope="row" className="px-2 py-1 text-left font-medium text-foreground">
                  <code className="font-mono">{src.pe}</code>{" "}
                  <span className="font-normal text-muted-foreground">
                    {edgeRelationLabel(e.relation)}
                  </span>{" "}
                  <code className="font-mono">{tgt.pe}</code>
                </th>
                <td className="px-2 py-1 text-muted-foreground">{label}</td>
                <td className="px-2 py-1 text-muted-foreground">
                  {candidate ? (
                    <span className="inline-block rounded bg-amber-500/20 px-1 py-0.5 font-semibold text-amber-800 dark:text-amber-200">
                      candidate (unverified)
                    </span>
                  ) : (
                    <>
                      per FY{e.fy} J-book
                      {e.fid ? <StatedCiteMarker factId={e.fid} /> : null}
                    </>
                  )}
                </td>
              </tr>
            );
          }),
        )}
      </tbody>
    </table>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend({ ribbonW }: { ribbonW: number }) {
  return (
    <div
      data-testid="lineage-legend"
      className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Lineage diagram legend"
    >
      <span className="flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true" className="shrink-0">
          <rect
            y={(10 - Math.min(ribbonW, 8)) / 2}
            width="22"
            height={Math.min(ribbonW, 8)}
            className="fill-(--flow-band-budget)"
          />
        </svg>
        stated in a J-book sentence — cited, click a ribbon for the source
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true" className="shrink-0">
          <rect
            x="0.5"
            y="1"
            width="21"
            height="8"
            className="fill-amber-500/20 stroke-amber-500/80"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        </svg>
        candidate (unverified) — inferred, never cited
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="12" aria-hidden="true" className="shrink-0">
          <rect
            x="0.5"
            y="0.5"
            width="21"
            height="11"
            rx="2"
            className="fill-muted/50 stroke-muted-foreground/50"
            strokeWidth="1"
            strokeDasharray="3 2"
          />
        </svg>
        unresolved reference — named in a cited sentence, no program page here
      </span>
      <span className="font-medium text-foreground">
        every ribbon is the same width; none of them is a dollar amount
      </span>
    </div>
  );
}

// ── The island ───────────────────────────────────────────────────────────────

export function LineageFlow({
  payload,
  linkablePes,
}: {
  payload: LineageFlowPayload;
  /** PEs that ARE built program pages (plain array — RSC-serializable). */
  linkablePes: readonly string[];
}) {
  const linkable = new Set(linkablePes);
  const families: LineageFlowFamily[] = payload.families;
  const candidates: LineageFlowCandidate[] = payload.candidates;

  const wideFamilies = wideDiagramCount(families);
  const identityRows = families.flatMap((f) =>
    f.nodes.map((node) => ({ node, group: `Family ${f.family_id}` })),
  );
  const candidateRows = candidates.flatMap((c, i) =>
    c.nodes.map((node) => ({ node, group: `Candidate ${i + 1}` })),
  );

  return (
    <div data-lineage-flow="" className="space-y-8">
      {/* ── Stated: the families ── */}
      <ChartFigure
        id="lineage-graph"
        description={
          `Every program-element identity the ingested J-books link to another one, grouped into the ` +
          `${payload.counts.families} families those links form. Boxes are identities and ribbons are the links between ` +
          `them; columns are lineage STEPS, not calendar years, because predecessors and successors keep drawing ` +
          `money side by side for whole decades and a year axis would assert a hand-off date the record does not ` +
          `contain. Read a ribbon as "this line became that one", never as a sum: every ribbon is drawn at one ` +
          `fixed width because no J-book sentence in the corpus states how much money moved. The table below adds ` +
          `the one figure that IS stated per identity — its FY${payload.amount_fy} request — and the links table lists every ` +
          `link with the edition that asserts it.` +
          (wideFamilies > 0
            ? ` ${wideFamilies} of the ${payload.counts.families} family diagrams are wider than a phone screen and scroll sideways inside their own box.`
            : "")
        }
        table={
          <>
            <ChartTableDisclosure label="View every identity as a table">
              <IdentityTable
                payload={payload}
                rows={identityRows}
                tableName="lineage-identities"
                caption={`Every program-element identity in the lineage layer, with the family it belongs to, its lineage step, and its cited FY${payload.amount_fy} request figure where the ingested editions carry one. Values in USD thousands.`}
              />
            </ChartTableDisclosure>
            <ChartTableDisclosure label="View every stated link as a table">
              <LinkTable
                diagrams={families.map((f) => ({
                  key: `f${f.family_id}`,
                  label: `Family ${f.family_id}`,
                  d: f,
                }))}
                groupLabel="Family"
                caption="Every stated lineage link, the J-book edition that asserts it, and its citation."
                candidate={false}
              />
            </ChartTableDisclosure>
          </>
        }
      >
        <Legend ribbonW={payload.ribbon_w} />
        <div className="grid gap-4 md:grid-cols-2">
          {families.map((f) => (
            <section
              key={f.family_id}
              data-lineage-diagram=""
              data-family-id={f.family_id}
              className="min-w-0 rounded-lg border border-border bg-card p-3"
            >
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Family {f.family_id}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {f.nodes.length} identities · {f.edges.length} stated{" "}
                  {f.edges.length === 1 ? "link" : "links"}
                </span>
                {f.has_split && (
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                    branches — the funding line follows the 1:1 chain only
                  </span>
                )}
                {f.cyclic && (
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                    editions disagree on direction — step order is not a claim
                  </span>
                )}
              </div>
              <Diagram
                diagram={f}
                idPrefix={`fam-${f.family_id}`}
                name={`Lineage family ${f.family_id}, rooted at ${f.root}`}
                variant="stated"
                linkable={linkable}
              />
            </section>
          ))}
        </div>
      </ChartFigure>

      {/* ── Inferred: their own picture, opt-in, never beside a fact ── */}
      {candidates.length > 0 && (
        <CautionNote label="Candidate lineage connections — inferred and unverified">
          <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">
            {candidates.length} candidate connection
            {candidates.length === 1 ? "" : "s"} — inferred, unverified
          </p>
          <p className="mb-3 text-xs text-amber-800/80 dark:text-amber-200/80">
            These links are inferred from program-element and budget-activity
            structure, not stated in any J-book sentence — treat them as leads,
            not facts. They are drawn apart from the families above on purpose:
            a candidate does not belong in the same picture as a cited fact.
          </p>
          {/* The honesty text is always visible; the PICTURES are opt-in, the
              way the program rail's disclosure is. The <details> wraps only
              the diagrams — putting the whole figure inside it would hide the
              figcaption from sighted readers, which gate 6 (c1) correctly
              treats as a chart with no description at all. */}
            <ChartFigure
              id="lineage-candidates"
              description={
                `The ${candidates.length} candidate links the inference tier proposes, drawn in the same shape as the ` +
                `stated families above but dashed and amber, and labelled candidate (unverified) on every one. Each ` +
                `is a same-agency RDT&E budget-activity maturation with a funding taper — a pattern, not a sentence. ` +
                `No J-book asserts any of them, none is cited, none is ever summed into a funding line, and as with ` +
                `the stated links no ribbon here carries an amount.`
              }
              table={
                <>
                  <ChartTableDisclosure label="View every candidate identity as a table">
                    <IdentityTable
                      payload={payload}
                      rows={candidateRows}
                      tableName="lineage-candidate-identities"
                      caption={`The program-element identities named by candidate (unverified) lineage links, with their cited FY${payload.amount_fy} request figures. Values in USD thousands.`}
                    />
                  </ChartTableDisclosure>
                  <ChartTableDisclosure label="View every candidate link as a table">
                    <LinkTable
                      diagrams={candidates.map((c, i) => ({
                        key: `c${i}`,
                        label: c.basis ?? "inferred",
                        d: c,
                      }))}
                      groupLabel="Inference basis"
                      caption="Every candidate lineage link and the structural pattern it was inferred from. None is cited."
                      candidate
                    />
                  </ChartTableDisclosure>
                </>
              }
            >
              <details>
                <summary className="mb-2 inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-amber-500/50 px-2.5 py-1 text-xs font-medium text-amber-800 focus:outline-none focus:ring-2 focus:ring-ring dark:text-amber-200 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true">▸</span>
                  Show the {candidates.length} candidate diagram
                  {candidates.length === 1 ? "" : "s"}
                </summary>
              <div className="grid gap-4 md:grid-cols-2">
                {candidates.map((c, i) => (
                  <section
                    key={`cand-${i}`}
                    data-lineage-diagram=""
                    data-candidate=""
                    data-inferred="true"
                    className="min-w-0 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 p-3"
                  >
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
                        Candidate {i + 1}
                      </h3>
                      <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-amber-800 dark:text-amber-200">
                        candidate (unverified)
                      </span>
                      {c.basis && (
                        <span className="text-xs text-amber-800/80 dark:text-amber-200/80">
                          {c.basis}
                        </span>
                      )}
                    </div>
                    <Diagram
                      diagram={c}
                      idPrefix={`cand-${i}`}
                      name={`Candidate lineage link ${i + 1} — inferred, unverified`}
                      variant="candidate"
                      linkable={linkable}
                    />
                  </section>
                ))}
              </div>
              </details>
            </ChartFigure>
        </CautionNote>
      )}
    </div>
  );
}
