/**
 * gate 22 — flowdown_gate (Phase 5H, G9)
 *
 * Verifies the /flow/ two-river flowdown end to end (spec §4 legs a–e):
 *
 *  (a) conservation — payload-internal: every node equals the sum of its
 *      in-edges AND out-edges (both rivers, every FY, Other + bridge nodes
 *      included); node heights/band geometry proportional and contained;
 *      payload ≤ 600KB. Lake recompute: EVERY budget node and the sampled
 *      spend FYs' nodes recomputed independently from the parquet lake via
 *      flowdown-recompute.py (same dedup/mapping rules, duplicated by
 *      design). "Other (N)" values and counts recomputed as
 *      level-total − top members.
 *  (b) bridge honesty — not_yet_crosswalked == budget_total −
 *      crosswalked_total EXACTLY (BigInt milli-unit arithmetic on the
 *      canonical _str fields, no tolerance); band nodes carry the same
 *      values; program list sums to crosswalked_total; the crosswalked PE
 *      set equals the site bundle's fct_budget_to_awards PE set (∩ budget
 *      lake); coverage note states the gap.
 *  (c) citation contract — sampled nodes/edges resolve in citations.json
 *      AND their cite-shard (deep-equal), kind='derived', recorded_value
 *      matches the payload value; sum(flow_children…) node facts recompute
 *      exactly from their edge facts; budget node facts carry
 *      sum(budget_lines… formulas with non-empty inputs.
 *  (d) competition overlay — competed_classes/offers_buckets vocabularies
 *      are canonical; every spend edge's class and offers vectors partition
 *      its value; per-(FY, class) totals at the river mouth match an
 *      independent lake regroup for ALL FYs.
 *  (e) Playwright on /flow/ (DOM contract BINDING for the UI batch), plus
 *      built-string regressions (Turbopack once dropped the space in
 *      "FY2026 President's Budget" / "across N entries" — asserted on the
 *      rendered page) and the static offers-not-bidders note by the legend:
 *        [data-testid="flow-chart"]           chart container
 *        [data-flow-experimental]             experimental banner
 *        [data-testid="flow-offers-note"]     static offers honesty note
 *        [data-coverage="flow-bridge"]        bridge coverage note (names the
 *                                             not-yet-crosswalked honesty gap)
 *        [data-flow-node][data-node-id]       nodes (click → citation panel)
 *        [data-flow-other]                    Other nodes (click → drilldown)
 *        [data-testid="flow-drilldown"]       drill-down panel,
 *          [data-drill-member] rows
 *        [data-testid="flow-fy-select"]       FY selector for the spend river
 *        [data-flow-river="spend"][data-fy]   spend river container, data-fy
 *                                             switches with the selector
 *        [data-testid="citation-panel"]       opens from a node click
 *  (f) render-level label bbox (backlog #20) — the exporter's TDD bbox test
 *      proves the PRECOMPUTED layout is collision-free under its own font
 *      metrics; this leg re-asserts it on the RENDERED page at 1440 via
 *      getBoundingClientRect, at initial render and again after the FY
 *      switch, so site font/metric drift cannot silently re-collide labels.
 *      A "label" is the single <text> child of a [data-flow-node]/
 *      [data-flow-other] group (name + value are tspans of that ONE element
 *      — never counted as two); labels are compared within their own river
 *      container only, with a ≤1px bilateral tolerance (halo/antialias
 *      slop, not a masking tolerance).
 *      LABEL-vs-NODE-RECT (PM Sprint 3 Task 4, §P2-3): label-vs-label was
 *      only half the picture. SVG has no z-index, so a node rect emitted
 *      after a label PAINTS OVER IT — which is how the review saw
 *      "Shipbuilding and Conversio…avy 47.4B": 17 of the budget river's 29
 *      labels were clipped by a downstream column's rect, and the exporter's
 *      collision model could not see it because the obstacle was never a
 *      label. The leg now also asserts that no rendered label box intersects
 *      any node fill rect BELOW it in paint order. Vacuity fails.
 *  (g) LINEAGE RIBBONS ENCODE NOTHING (ROADMAP #29(c)) — the mirror of leg
 *      (a). On /flow/ a band's thickness IS its value and leg (a) proves it.
 *      On /lineage/ a ribbon's thickness is NOT a value and must never be
 *      readable as one: no lineage edge in the corpus states a transferred
 *      amount (program_lineage.portion_amount is non-null on zero rows), so
 *      there is nothing to encode. Measured off the BUILT
 *      out/lineage/index.html — the `d=` strings the browser paints, not the
 *      exporter's layout code — so an exporter that started encoding an
 *      amount in a width is caught rather than agreed with. Also pins that
 *      the drawn edge set equals the sidecar's, that stated and inferred are
 *      separable by attribute AND by the reader's eye, and that an identity
 *      with no program page renders as an unresolved reference and not a
 *      link. Vacuity fails three ways (no ribbons, no stated, no inferred).
 *
 * Export: runFlowdownGate({ baseUrl }) → { pass, errors, notes }
 *         runLineageRibbonLeg() → { errors, notes }   (leg g, standalone)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { parse as parseHtml } from "node-html-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(siteRoot, "..");
const jsonDir = path.resolve(repoRoot, "data", "site", "json");
const outDir = path.resolve(siteRoot, "out");

const PAYLOAD_BUDGET_BYTES = 600 * 1024;
const COMPETED_CLASSES = ["full_and_open", "set_aside", "other_than_full", "not_competed"];
const OFFERS_BUCKETS = ["1", "2", "3-4", "5-9", "10+", "unknown"];

const TOL_INTERNAL = 0.005; // payload-internal (values are quantized decimals)
const TOL_CITE = 0.001;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** relative lake tolerance: quantization + double accumulation, never masking */
function lakeTol(v, floor) {
  return Math.max(floor, 1e-8 * Math.abs(v));
}

/** canonical "123.456"/"123.45" strings → BigInt milli-units (exact) */
function milli(str) {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(String(str));
  if (!m) throw new Error(`not a canonical decimal string: ${str}`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  return (m[1] === "-" ? -1n : 1n) * (BigInt(m[2]) * 1000n + BigInt(frac));
}

/** Spawn the python lake-recompute helper. */
function recomputeFromLake(request) {
  const reqFile = path.join(os.tmpdir(), `flowdown-recompute-${process.pid}.json`);
  fs.writeFileSync(reqFile, JSON.stringify(request));
  try {
    const res = spawnSync(
      "uv",
      ["run", "python", "site/scripts/gates/flowdown-recompute.py", reqFile],
      { cwd: repoRoot, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 }
    );
    if (res.status !== 0) {
      throw new Error(`recompute helper exited ${res.status}: ${(res.stderr || "").slice(0, 400)}`);
    }
    return JSON.parse(res.stdout);
  } finally {
    fs.rmSync(reqFile, { force: true });
  }
}

/** node-level in/out conservation + geometry for one river */
function checkRiver(errors, label, river, { terminalLevels, rootLevel }) {
  const { nodes, edges } = river;
  const inflow = new Map();
  const outflow = new Map();
  for (const e of edges) {
    outflow.set(e.s, (outflow.get(e.s) ?? 0) + e.v);
    inflow.set(e.t, (inflow.get(e.t) ?? 0) + e.v);
  }
  nodes.forEach((n, i) => {
    if (n.level !== rootLevel) {
      const got = inflow.get(i) ?? 0;
      if (Math.abs(got - n.value) > TOL_INTERNAL) {
        errors.push(`leg a: ${label} node ${n.id} inflow ${got} != value ${n.value}`);
      }
    }
    if (!terminalLevels.includes(n.level)) {
      const got = outflow.get(i) ?? 0;
      if (Math.abs(got - n.value) > TOL_INTERNAL) {
        errors.push(`leg a: ${label} node ${n.id} outflow ${got} != value ${n.value}`);
      }
    }
    if (n.other) {
      const memberSum = n.other.members.reduce((a, m) => a + m.v, 0);
      if (Math.abs(memberSum + n.other.omitted_value - n.value) > TOL_INTERNAL) {
        errors.push(
          `leg a: ${label} ${n.id} drilldown members+omitted != node value`
        );
      }
    }
  });

  // geometry: heights proportional (scale anchored on the root node).
  // Negative flows (net de-obligations) keep honest negative VALUES but
  // render as zero-width bands, with a node-side compression factor
  // node_height / Σ(positive band heights) so positive bands still fit —
  // independent copy of the flow_chart.py layout rule.
  const root = nodes.find((n) => n.level === rootLevel);
  if (root && root.value > 0) {
    const scale = (root.y1 - root.y0) / root.value;
    for (const n of nodes) {
      if (Math.abs(n.y1 - n.y0 - Math.max(n.value, 0) * scale) > 0.05) {
        errors.push(`leg a: ${label} node ${n.id} height not proportional to value`);
      }
    }
    const posOut = new Map();
    const posIn = new Map();
    for (const e of edges) {
      posOut.set(e.s, (posOut.get(e.s) ?? 0) + Math.max(e.v, 0));
      posIn.set(e.t, (posIn.get(e.t) ?? 0) + Math.max(e.v, 0));
    }
    const factor = (node, posSum) =>
      posSum > 0 ? Math.min(1, Math.max(node.value, 0) / posSum) : 0;
    for (const e of edges) {
      const sn = nodes[e.s];
      const tn = nodes[e.t];
      const [sy0, sy1, ty0, ty1] = e.g;
      if (sy0 < sn.y0 - 0.02 || sy1 > sn.y1 + 0.02 || ty0 < tn.y0 - 0.02 || ty1 > tn.y1 + 0.02) {
        errors.push(`leg a: ${label} edge ${sn.id}→${tn.id} band escapes its nodes`);
      }
      const expS = Math.max(e.v, 0) * scale * factor(sn, posOut.get(e.s));
      const expT = Math.max(e.v, 0) * scale * factor(tn, posIn.get(e.t));
      if (Math.abs(sy1 - sy0 - expS) > 0.05 || Math.abs(ty1 - ty0 - expT) > 0.05) {
        errors.push(`leg a: ${label} edge ${sn.id}→${tn.id} band thickness != value`);
      }
    }
  }
}

// ── Leg (g): the lineage ribbons encode nothing (ROADMAP #29(c)) ────────────

/**
 * Tokenize an absolute SVG path into its ON-PATH points.
 *
 * Deliberately NOT a re-implementation of ribbonPath(): it reads the built
 * `d=` attribute and returns the vertices the browser will actually draw, so a
 * renderer that changed shape, swapped a face, or scaled a band is measured
 * rather than assumed. Control points (a cubic's first two triples) are
 * dropped — only the points the curve passes THROUGH define the two faces.
 *
 * Any command other than M/C/L/Z, or a relative command, throws: the gate must
 * fail loudly on a path shape it cannot measure, never silently pass one.
 */
export function onPathPoints(d) {
  const toks = String(d).trim().match(/[MCLZmclz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!toks) throw new Error(`unparseable path: ${String(d).slice(0, 60)}`);
  const pts = [];
  let i = 0;
  while (i < toks.length) {
    const cmd = toks[i++];
    if (!/^[MCLZ]$/.test(cmd)) {
      throw new Error(
        `lineage ribbon path uses "${cmd}" — this leg measures absolute M/C/L/Z only`,
      );
    }
    const take = (n) => {
      const out = [];
      for (let k = 0; k < n; k++) out.push(Number(toks[i++]));
      return out;
    };
    if (cmd === "M" || cmd === "L") {
      const [x, y] = take(2);
      pts.push([x, y]);
    } else if (cmd === "C") {
      const a = take(6);
      pts.push([a[4], a[5]]);
    }
  }
  return pts;
}

/**
 * The two face thicknesses of a ribbon path: |Δy| among the on-path points at
 * the leftmost x, and among those at the rightmost x.
 */
export function ribbonFaces(d) {
  const pts = onPathPoints(d);
  if (pts.length < 4) throw new Error(`ribbon path has ${pts.length} on-path points, expected 4`);
  const xs = pts.map((p) => p[0]);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const at = (x) => pts.filter((p) => Math.abs(p[0] - x) < 1e-6).map((p) => p[1]);
  const l = at(xmin);
  const r = at(xmax);
  if (l.length !== 2 || r.length !== 2) {
    throw new Error(
      `ribbon path faces are not 2+2 points (${l.length}+${r.length}) — shape changed`,
    );
  }
  return { source: Math.abs(l[1] - l[0]), target: Math.abs(r[1] - r[0]) };
}

/**
 * Leg (g) — /lineage/ ribbons carry no amount, and candidates cannot be
 * mistaken for facts.
 *
 * WHY THIS SITS ON GATE 22. Gate 22 already owns "is the Sankey geometry
 * honest": leg (a) checks that a /flow/ band's thickness IS its value. This is
 * the same question with the opposite answer — a /lineage/ band's thickness is
 * NOT a value and must not be readable as one — so it belongs beside it rather
 * than in a 25th gate.
 *
 * WHAT IT MEASURES, and what it deliberately does not. Everything here is read
 * off the BUILT out/lineage/index.html: the `d=` strings the browser will
 * paint, the attributes the DOM carries, the text a reader sees. It never
 * calls the exporter's layout code, so an exporter that started encoding an
 * amount in a width would be caught by the artifact rather than agreed with.
 *
 *   g1 EVERY ribbon has the same thickness as every other ribbon, on BOTH
 *      faces. This is the artifact-only form of "no width encodes an amount":
 *      widths that encode differing values differ. It needs no reference to
 *      the payload at all.
 *   g2 …and that one thickness equals the payload's declared ribbon_w, so the
 *      renderer cannot quietly rescale what the exporter laid out.
 *   g3 NO amount is drawn inside any lineage SVG: no [data-amount], and no
 *      currency token in any svg subtree. The money on this page lives in the
 *      table, one column, cited — never on a ribbon.
 *   g4 The drawn edge multiset EQUALS the sidecar's (from, to, relation, fy,
 *      confidence). A dropped or duplicated ribbon is a lie about the corpus.
 *   g5 Stated and inferred are machine-separable and reader-separable: every
 *      [data-lineage-edge="inferred"] carries data-inferred="true" and names
 *      itself candidate/unverified in its own subtree text; no stated edge
 *      carries data-inferred; every stated edge carries a fact id.
 *   g6 Unresolved identities render as unresolved: every [data-lineage-node]
 *      the payload marks unresolvable carries [data-lineage-unresolved] and
 *      contains no <a>.
 *   VACUITY: zero ribbons, zero stated, or zero inferred all FAIL.
 */
export function runLineageRibbonLeg({ payloadPath, htmlPath } = {}) {
  const errors = [];
  const notes = [];
  // Paths are injectable for ONE reason: proof-can-fail. A leg nobody has
  // watched fail is not a gate, and the only way to watch this one fail is to
  // point it at a scratch copy of the built page with a real defect edited in
  // (the pattern gate 3's mobile leg already uses on a scratch stylesheet).
  // The gate run itself always passes nothing and measures the real build.
  payloadPath = payloadPath ?? path.join(jsonDir, "lineage_flow.json");
  htmlPath = htmlPath ?? path.join(outDir, "lineage", "index.html");
  if (!fs.existsSync(payloadPath)) {
    return {
      errors: [`leg g: lineage_flow.json missing at ${payloadPath} — run export-site`],
      notes,
    };
  }
  if (!fs.existsSync(htmlPath)) {
    return {
      errors: [`leg g: out/lineage/index.html not built — /lineage/ must render for this leg to measure anything`],
      notes,
    };
  }
  const payload = readJson(payloadPath);
  const root = parseHtml(fs.readFileSync(htmlPath, "utf8"), { comment: false });

  const groups = root.querySelectorAll("[data-lineage-edge]");
  if (groups.length === 0) {
    errors.push("leg g: no [data-lineage-edge] ribbons on /lineage/ — the leg is vacuous");
    return { errors, notes };
  }

  // ── g1 + g2: thickness ────────────────────────────────────────────────────
  const thicknesses = [];
  for (const g of groups) {
    const p = g.querySelector("path[data-ribbon]");
    if (!p) {
      errors.push(
        `leg g: [data-lineage-edge] ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")} has no path[data-ribbon]`,
      );
      continue;
    }
    let faces;
    try {
      faces = ribbonFaces(p.getAttribute("d"));
    } catch (e) {
      errors.push(
        `leg g: ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")}: ${e.message}`,
      );
      continue;
    }
    thicknesses.push({
      id: `${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")}`,
      ...faces,
    });
  }
  if (thicknesses.length > 0) {
    // 0.011 is the exporter's own 2-decimal rounding grain, not a tolerance
    // chosen to make something pass: geometry ships rounded to 0.01.
    const TOL = 0.011;
    // The reference width is the MODE, not the first ribbon's. Taking the
    // first made the message name the 51 correct ribbons as the offenders
    // when the one broken ribbon happened to be first — an error message that
    // misexplains its own finding sends the next reader to the wrong file.
    // Ties break toward the declared ribbon_w, then toward the smaller value.
    const tally = new Map();
    for (const t of thicknesses) {
      const k = t.source.toFixed(2);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const w0 = Number(
      [...tally.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          Math.abs(Number(a[0]) - payload.ribbon_w) -
            Math.abs(Number(b[0]) - payload.ribbon_w) ||
          Number(a[0]) - Number(b[0]),
      )[0][0],
    );
    const off = thicknesses.filter(
      (t) => Math.abs(t.source - w0) > TOL || Math.abs(t.target - w0) > TOL,
    );
    if (off.length > 0) {
      errors.push(
        `leg g1: ${off.length} of ${thicknesses.length} lineage ribbon(s) differ from the page's common ribbon ` +
          `width (${w0.toFixed(2)}) — a lineage ribbon's width must encode NOTHING, because no lineage edge states ` +
          `a transferred amount. Offenders: ` +
          off
            .slice(0, 5)
            .map((t) => `${t.id} ${t.source.toFixed(2)}/${t.target.toFixed(2)}`)
            .join(", "),
      );
    } else {
      notes.push(
        `leg g1: ${thicknesses.length} lineage ribbons, all ${w0.toFixed(2)} units on both faces ✓`,
      );
    }
    if (Math.abs(w0 - payload.ribbon_w) > TOL) {
      errors.push(
        `leg g2: lineage ribbons render at ${w0.toFixed(2)} units but lineage_flow.json declares ribbon_w=${payload.ribbon_w} — ` +
          `the renderer rescaled the laid-out geometry`,
      );
    } else {
      notes.push(`leg g2: rendered width == declared ribbon_w (${payload.ribbon_w}) ✓`);
    }
  }

  // ── g3: no amount inside any lineage svg ─────────────────────────────────
  {
    let svgs = 0;
    let offenders = 0;
    // Same detection set as gate 2's currency scan ("$" followed by a digit,
    // or a spelled magnitude); the extra trailing groups only widen what the
    // MESSAGE can quote, so the reader sees "$512.15M" rather than "$5".
    const CURRENCY = /\$\s?[\d,]+(?:\.\d+)?\s*[TBMK]?|\d[\d,.]*\s?(?:billion|million|trillion)\b/i;
    for (const svg of root.querySelectorAll("svg")) {
      svgs++;
      if (svg.querySelectorAll("[data-amount]").length > 0) {
        offenders++;
        errors.push("leg g3: a [data-amount] figure is drawn INSIDE a lineage svg — the diagram must carry no dollars");
      }
      const t = (svg.text || "").replace(/\s+/g, " ");
      const hit = CURRENCY.exec(t);
      // Quote the TOKEN and its immediate context, not the start of the svg's
      // text: a message that opens with the chart's <desc> reads as if the
      // description were the problem and sends the reader to the wrong string.
      if (hit) {
        offenders++;
        const from = Math.max(0, hit.index - 30);
        errors.push(
          `leg g3: currency token "${hit[0]}" is drawn inside a lineage svg (…${t.slice(from, hit.index + 40)}…) — ` +
            `the money on this page belongs in the table, cited, never on a ribbon whose width means nothing`,
        );
      }
    }
    if (offenders === 0) {
      notes.push(`leg g3: ${svgs} lineage svg(s), 0 dollar figures drawn ✓`);
    }
  }

  // ── g4: the drawn edges ARE the sidecar's edges ──────────────────────────
  {
    const key = (from, to, rel, fy, conf) => `${from}|${to}|${rel}|${fy}|${conf}`;
    const want = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const d of [...payload.families, ...payload.candidates]) {
      for (const e of d.edges) {
        bump(want, key(d.nodes[e.s].pe, d.nodes[e.t].pe, e.relation, e.fy, e.confidence));
      }
    }
    const got = new Map();
    for (const g of groups) {
      bump(
        got,
        key(
          g.getAttribute("data-edge-from"),
          g.getAttribute("data-edge-to"),
          g.getAttribute("data-edge-relation"),
          g.getAttribute("data-edge-fy"),
          g.getAttribute("data-lineage-edge"),
        ),
      );
    }
    const diffs = [];
    for (const [k, n] of want) if ((got.get(k) ?? 0) !== n) diffs.push(`missing/undercount ${k} (payload ${n}, drawn ${got.get(k) ?? 0})`);
    for (const [k, n] of got) if ((want.get(k) ?? 0) !== n) diffs.push(`extra ${k} (drawn ${n}, payload ${want.get(k) ?? 0})`);
    if (diffs.length > 0) {
      errors.push(
        `leg g4: the drawn ribbon set does not equal lineage_flow.json's edge set — ${diffs.length} difference(s): ${diffs.slice(0, 5).join("; ")}`,
      );
    } else {
      notes.push(`leg g4: ${groups.length} drawn ribbons == the sidecar's ${want.size} distinct edge(s) ✓`);
    }
  }

  // ── g5: stated vs inferred, at a glance and by attribute ─────────────────
  {
    let stated = 0;
    let inferred = 0;
    for (const g of groups) {
      const tier = g.getAttribute("data-lineage-edge");
      const hasInferredFlag = g.getAttribute("data-inferred") === "true";
      const text = (g.text || "").toLowerCase();
      if (tier === "stated") {
        stated++;
        if (hasInferredFlag) {
          errors.push(`leg g5: stated edge ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")} carries data-inferred="true"`);
        }
        if (!g.getAttribute("data-edge-fid")) {
          errors.push(`leg g5: stated edge ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")} carries no data-edge-fid — a stated edge may never render uncited`);
        }
      } else if (tier === "inferred") {
        inferred++;
        if (!hasInferredFlag) {
          errors.push(`leg g5: inferred edge ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")} does not carry data-inferred="true"`);
        }
        if (!text.includes("candidate") && !text.includes("unverified")) {
          errors.push(`leg g5: inferred edge ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")} never names itself candidate/unverified in its own subtree`);
        }
        if (g.getAttribute("data-edge-fid")) {
          errors.push(`leg g5: inferred edge ${g.getAttribute("data-edge-from")}→${g.getAttribute("data-edge-to")} carries a fact id — inferred edges are NEVER cited`);
        }
      } else {
        errors.push(`leg g5: data-lineage-edge="${tier}" is not stated|inferred`);
      }
    }
    if (stated === 0) errors.push("leg g5: zero stated ribbons rendered — vacuous");
    if (inferred === 0) errors.push("leg g5: zero inferred ribbons rendered — the stated/inferred separation is untested");
    if (stated !== payload.counts.stated_edges) {
      errors.push(`leg g5: ${stated} stated ribbons drawn, sidecar says ${payload.counts.stated_edges}`);
    }
    if (inferred !== payload.counts.inferred_edges) {
      errors.push(`leg g5: ${inferred} inferred ribbons drawn, sidecar says ${payload.counts.inferred_edges}`);
    }
    if (stated > 0 && inferred > 0) {
      notes.push(`leg g5: ${stated} stated (all cited, none flagged inferred) vs ${inferred} inferred (all flagged + labelled) ✓`);
    }
  }

  // ── g6: unresolved identities render unresolved ──────────────────────────
  {
    const unresolvable = new Set();
    for (const d of [...payload.families, ...payload.candidates]) {
      for (const n of d.nodes) if (!n.resolved) unresolvable.add(n.pe);
    }
    let checked = 0;
    let bad = 0;
    for (const n of root.querySelectorAll("[data-lineage-node]")) {
      const pe = n.getAttribute("data-node-pe");
      if (!unresolvable.has(pe)) continue;
      checked++;
      if (n.getAttribute("data-lineage-unresolved") === null) {
        bad++;
        errors.push(`leg g6: ${pe} has no program page but renders without [data-lineage-unresolved]`);
      }
      if (n.querySelectorAll("a").length > 0) {
        bad++;
        errors.push(`leg g6: ${pe} has no program page but renders as a link`);
      }
    }
    if (unresolvable.size > 0 && checked === 0) {
      errors.push(`leg g6: the payload names ${unresolvable.size} unresolvable identities but none of them rendered`);
    } else if (bad === 0) {
      notes.push(`leg g6: ${checked} unresolved reference(s) rendered as plain text, 0 as links ✓`);
    }
  }

  return { errors, notes };
}

export async function runFlowdownGate({ baseUrl }) {
  const errors = [];
  const notes = [];

  // ── Load the payload ─────────────────────────────────────────────────────
  const payloadPath = path.join(jsonDir, "flow_chart.json");
  if (!fs.existsSync(payloadPath)) {
    return {
      pass: false,
      errors: [`flow_chart.json missing at ${payloadPath} — run export-site`],
      notes,
    };
  }
  const payload = readJson(payloadPath);
  const citations = readJson(path.join(jsonDir, "citations.json"));
  const shardDir = path.join(jsonDir, "cite-shards");

  const size = fs.statSync(payloadPath).size;
  if (size > PAYLOAD_BUDGET_BYTES) {
    errors.push(`leg a: flow_chart.json is ${size} bytes — over the 600KB budget`);
  }
  const b = payload.budget;
  const spend = payload.spend;
  const spendFys = spend.fys.map(String);
  notes.push(
    `payload: ${size} bytes; budget ${b.nodes.length} nodes/${b.edges.length} edges; ` +
      `spend FYs ${spendFys[0]}–${spendFys[spendFys.length - 1]}, default ${spend.default_fy}`
  );

  // ── Leg (a): payload-internal conservation + geometry ────────────────────
  checkRiver(errors, "budget", b, { terminalLevels: ["bridge"], rootLevel: "total" });
  for (const fy of spendFys) {
    checkRiver(errors, `spend FY${fy}`, spend.by_fy[fy], {
      terminalLevels: ["family"],
      rootLevel: "total",
    });
  }
  notes.push("leg a: payload-internal conservation checked on every node/edge");

  // ── Leg (a)+(b)+(d): lake recompute via the python helper ────────────────
  const sampleFys = [String(spend.default_fy), spendFys[0]].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  const spendKeys = {};
  for (const fy of sampleFys) {
    const river = spend.by_fy[fy];
    const keysOf = (level, prefix) =>
      river.nodes
        .filter((n) => n.level === level && !n.id.includes(":other:"))
        .map((n) => n.id.slice(prefix.length));
    spendKeys[fy] = {
      sub: keysOf("sub_agency", `s:${fy}:sub:`),
      office: keysOf("office", `s:${fy}:o:`),
      family: keysOf("family", `s:${fy}:f:`),
    };
  }
  let lake = null;
  try {
    lake = recomputeFromLake({
      budget: true,
      crosswalk_pes: b.bridge.programs.map((p) => p.pe_bli),
      spend_fys: sampleFys.map(Number),
      spend_keys: spendKeys,
      class_totals: true,
    });
  } catch (e) {
    errors.push(`leg a: lake recompute helper failed: ${e.message}`);
  }

  if (lake) {
    // budget: EVERY node against the lake
    const levelDicts = {
      component: lake.budget.component,
      appropriation: lake.budget.appropriation,
      budget_activity: lake.budget.budget_activity,
      program: lake.budget.program,
    };
    const prefixes = { component: "b:c:", appropriation: "b:a:", budget_activity: "b:ba:", program: "b:p:" };
    let nBudgetOk = 0;
    for (const n of b.nodes) {
      let expected = null;
      if (n.id === "b:total") expected = lake.budget.total;
      else if (n.id === "b:bridge:crosswalked") expected = lake.crosswalk.sum;
      else if (n.id === "b:bridge:not-crosswalked")
        expected = lake.budget.total - lake.crosswalk.sum;
      else if (n.id.startsWith("b:other:")) {
        const level = n.id.slice("b:other:".length);
        const dict = levelDicts[level];
        const topSum = b.nodes
          .filter((x) => x.level === level && !x.id.startsWith("b:other:"))
          .reduce((a, x) => a + (dict[x.id.slice(prefixes[level].length)] ?? NaN), 0);
        expected = Object.values(dict).reduce((a, v) => a + v, 0) - topSum;
        const nMembers = Object.keys(dict).length -
          b.nodes.filter((x) => x.level === level && !x.id.startsWith("b:other:")).length;
        if (n.other && n.other.count !== nMembers) {
          errors.push(`leg a: budget ${n.id} count ${n.other.count} != lake ${nMembers}`);
        }
      } else {
        const level = n.level;
        expected = levelDicts[level]?.[n.id.slice(prefixes[level].length)] ?? null;
      }
      if (expected === null || Number.isNaN(expected)) {
        errors.push(`leg a: budget node ${n.id} not recomputable from the lake`);
      } else if (Math.abs(expected - n.value) > lakeTol(expected, 1.0)) {
        errors.push(`leg a: budget node ${n.id} payload=${n.value} lake=${expected}`);
      } else nBudgetOk++;
    }
    notes.push(`leg a: ${nBudgetOk}/${b.nodes.length} budget nodes recomputed from the lake ✓`);

    // spend: sampled FYs, every exported node
    for (const fy of sampleFys) {
      const river = spend.by_fy[fy];
      const lakeFy = lake.spend[fy];
      const counts = { sub_agency: lakeFy.n_sub, office: lakeFy.n_office, family: lakeFy.n_family };
      const dicts = { sub_agency: lakeFy.sub, office: lakeFy.office, family: lakeFy.family };
      const prefixesS = { sub_agency: `s:${fy}:sub:`, office: `s:${fy}:o:`, family: `s:${fy}:f:` };
      let ok = 0;
      for (const n of river.nodes) {
        let expected = null;
        if (n.level === "total") expected = lakeFy.total;
        else if (n.id.includes(":other:")) {
          const level = n.id.split(":other:")[1];
          const tops = river.nodes.filter((x) => x.level === level && !x.id.includes(":other:"));
          const topSum = tops.reduce((a, x) => a + (dicts[level][x.id.slice(prefixesS[level].length)] ?? NaN), 0);
          expected = lakeFy.total - topSum;
          const nMembers = counts[level] - tops.length;
          if (n.other && n.other.count !== nMembers) {
            errors.push(`leg a: spend FY${fy} ${n.id} count ${n.other.count} != lake ${nMembers}`);
          }
        } else {
          expected = dicts[n.level]?.[n.id.slice(prefixesS[n.level].length)] ?? null;
        }
        if (expected === null || Number.isNaN(expected)) {
          errors.push(`leg a: spend FY${fy} node ${n.id} not recomputable from the lake`);
        } else if (Math.abs(expected - n.value) > lakeTol(expected, 2.0)) {
          errors.push(`leg a: spend FY${fy} node ${n.id} payload=${n.value} lake=${expected}`);
        } else ok++;
      }
      notes.push(`leg a: FY${fy} ${ok}/${river.nodes.length} spend nodes recomputed from the lake ✓`);
    }
  }

  // ── Leg (b): bridge honesty ───────────────────────────────────────────────
  {
    const br = b.bridge;
    try {
      if (milli(br.budget_total_str) - milli(br.crosswalked_total_str) !== milli(br.not_yet_crosswalked_str)) {
        errors.push(
          `leg b: bridge remainder NOT exact: ${br.budget_total_str} − ${br.crosswalked_total_str} != ${br.not_yet_crosswalked_str}`
        );
      }
    } catch (e) {
      errors.push(`leg b: bridge _str fields not canonical decimals: ${e.message}`);
    }
    const totalNode = b.nodes.find((n) => n.id === "b:total");
    const cwNode = b.nodes.find((n) => n.id === "b:bridge:crosswalked");
    const nyNode = b.nodes.find((n) => n.id === "b:bridge:not-crosswalked");
    if (!totalNode || !cwNode || !nyNode) {
      errors.push("leg b: total/bridge band nodes missing from the budget river");
    } else {
      if (Math.abs(totalNode.value - Number(br.budget_total_str)) > TOL_CITE)
        errors.push("leg b: budget_total_str != total node value");
      if (Math.abs(cwNode.value - Number(br.crosswalked_total_str)) > TOL_CITE)
        errors.push("leg b: crosswalked band node != crosswalked_total_str");
      if (Math.abs(nyNode.value - Number(br.not_yet_crosswalked_str)) > TOL_CITE)
        errors.push("leg b: not-crosswalked band node != not_yet_crosswalked_str");
    }
    const progSum = br.programs.reduce((a, p) => a + p.value, 0);
    if (Math.abs(progSum - Number(br.crosswalked_total_str)) > 0.01) {
      errors.push(`leg b: bridge programs sum ${progSum} != crosswalked_total ${br.crosswalked_total_str}`);
    }
    if (lake && lake.crosswalk) {
      if ((lake.crosswalk.unknown_pes ?? []).length > 0) {
        errors.push(`leg b: bridge PEs absent from the budget lake: ${lake.crosswalk.unknown_pes.join(",")}`);
      }
      if (Math.abs(lake.crosswalk.sum - Number(br.crosswalked_total_str)) > lakeTol(lake.crosswalk.sum, 1.0)) {
        errors.push(`leg b: crosswalked_total ${br.crosswalked_total_str} != lake ${lake.crosswalk.sum}`);
      }
      const expected = lake.crosswalk.expected_pes;
      if (expected) {
        const got = br.programs.map((p) => p.pe_bli).sort();
        if (JSON.stringify(got) !== JSON.stringify(expected)) {
          errors.push(
            `leg b: bridge PE set != fct_budget_to_awards ∩ budget lake (got ${got.length}, expected ${expected.length})`
          );
        }
      }
    }
    if (!/not yet crosswalked/i.test(br.coverage_note ?? "")) {
      errors.push("leg b: coverage_note does not state the not-yet-crosswalked gap");
    }
    notes.push(
      `leg b: bridge ${br.crosswalked_pe_count} PEs (${br.high_confidence_pe_count} high), ` +
        `remainder ${(Number(br.not_yet_crosswalked_str) / Number(br.budget_total_str) * 100).toFixed(1)}% of the request — exact ✓`
    );
  }

  // ── Leg (c): citation contract on sampled nodes/edges ────────────────────
  {
    const shardCache = new Map();
    const loadShard = (prefix) => {
      if (!shardCache.has(prefix)) {
        const p = path.join(shardDir, `${prefix}.json`);
        shardCache.set(prefix, fs.existsSync(p) ? readJson(p) : null);
      }
      return shardCache.get(prefix);
    };
    const resolveCit = (fid, what) => {
      const cit = citations[fid];
      if (!cit) {
        errors.push(`leg c: ${what} fid ${fid} unresolvable in citations.json`);
        return null;
      }
      const shard = loadShard(fid.slice(0, 2));
      if (!shard || !(fid in shard)) {
        errors.push(`leg c: ${what} fid ${fid} missing from its cite-shard`);
        return null;
      }
      if (JSON.stringify(shard[fid]) !== JSON.stringify(cit)) {
        errors.push(`leg c: ${what} shard row differs from citations.json (${fid})`);
        return null;
      }
      if (cit.kind !== "derived") {
        errors.push(`leg c: ${what} fid ${fid} kind=${cit.kind} (want derived)`);
        return null;
      }
      return cit;
    };

    let ok = 0;
    let sampled = 0;
    // budget nodes: total, bridge bands, all Other nodes, first+last 3 per level
    const budgetSample = b.nodes.filter(
      (n, i) =>
        n.id === "b:total" ||
        n.id.startsWith("b:bridge:") ||
        n.id.startsWith("b:other:") ||
        i < 4 ||
        i >= b.nodes.length - 3
    );
    for (const n of budgetSample) {
      sampled++;
      const cit = resolveCit(n.fid, `budget node ${n.id}`);
      if (!cit) continue;
      if (Math.abs(Number(cit.recorded_value) - n.value) > TOL_CITE) {
        errors.push(`leg c: budget node ${n.id} value ${n.value} != recorded ${cit.recorded_value}`);
        continue;
      }
      if (!cit.formula?.startsWith("sum(budget_lines")) {
        errors.push(`leg c: budget node ${n.id} formula is not sum(budget_lines…: ${cit.formula}`);
        continue;
      }
      const inputs = JSON.parse(cit.inputs ?? "[]");
      if (inputs.length < 1) {
        errors.push(`leg c: budget node ${n.id} has no budget_lines inputs`);
        continue;
      }
      ok++;
    }
    // spend default FY: every node (flow_children recompute) + first 8 edges
    const fy = String(spend.default_fy);
    const river = spend.by_fy[fy];
    for (const n of river.nodes) {
      sampled++;
      const cit = resolveCit(n.fid, `spend node ${n.id}`);
      if (!cit) continue;
      if (Math.abs(Number(cit.recorded_value) - n.value) > TOL_CITE) {
        errors.push(`leg c: spend node ${n.id} value ${n.value} != recorded ${cit.recorded_value}`);
        continue;
      }
      if (!cit.formula?.startsWith("sum(flow_children")) {
        errors.push(`leg c: spend node ${n.id} formula is not sum(flow_children…`);
        continue;
      }
      const inputs = JSON.parse(cit.inputs ?? "[]");
      let sum = 0n;
      let bad = false;
      for (const f of inputs) {
        const c = citations[f];
        if (!c || c.recorded_value == null) {
          errors.push(`leg c: spend node ${n.id} input ${f} unresolvable`);
          bad = true;
          break;
        }
        sum += milli(c.recorded_value);
      }
      if (bad) continue;
      if (sum !== milli(cit.recorded_value)) {
        errors.push(`leg c: spend node ${n.id} flow_children recompute ${sum} != ${milli(cit.recorded_value)}`);
        continue;
      }
      ok++;
    }
    for (const e of river.edges.slice(0, 8)) {
      sampled++;
      const cit = resolveCit(e.f, `spend edge #${e.s}→#${e.t}`);
      if (!cit) continue;
      if (Math.abs(Number(cit.recorded_value) - e.v) > TOL_CITE) {
        errors.push(`leg c: spend edge #${e.s}→#${e.t} v=${e.v} != recorded ${cit.recorded_value}`);
        continue;
      }
      let body = null;
      try {
        body = JSON.parse(cit.query_body ?? "null");
      } catch {
        /* handled below */
      }
      if (!body || body.fy !== Number(fy)) {
        errors.push(`leg c: spend edge #${e.s}→#${e.t} query_body missing/inconsistent`);
        continue;
      }
      ok++;
    }
    // budget edges: every edge must carry a resolvable fid
    for (const e of b.edges) {
      const cit = citations[e.f];
      if (!cit) errors.push(`leg c: budget edge #${e.s}→#${e.t} fid ${e.f} unresolvable`);
    }
    notes.push(`leg c: ${ok}/${sampled} sampled node/edge citations verified ✓`);
  }

  // ── Leg (d): competition overlay ──────────────────────────────────────────
  {
    if (JSON.stringify(spend.competed_classes) !== JSON.stringify(COMPETED_CLASSES)) {
      errors.push(`leg d: competed_classes vocabulary drifted: ${spend.competed_classes}`);
    }
    if (JSON.stringify(spend.offers_buckets) !== JSON.stringify(OFFERS_BUCKETS)) {
      errors.push(`leg d: offers_buckets vocabulary drifted: ${spend.offers_buckets}`);
    }
    for (const fy of spendFys) {
      const river = spend.by_fy[fy];
      for (const e of river.edges) {
        if (e.c.length !== 4 || e.o.length !== 6) {
          errors.push(`leg d: FY${fy} edge #${e.s}→#${e.t} class/offers vector lengths wrong`);
          continue;
        }
        const cs = e.c.reduce((a, x) => a + x, 0);
        const os_ = e.o.reduce((a, x) => a + x, 0);
        if (Math.abs(cs - e.v) > TOL_INTERNAL)
          errors.push(`leg d: FY${fy} edge #${e.s}→#${e.t} classes sum ${cs} != ${e.v}`);
        if (Math.abs(os_ - e.v) > TOL_INTERNAL)
          errors.push(`leg d: FY${fy} edge #${e.s}→#${e.t} offers sum ${os_} != ${e.v}`);
      }
    }
    if (lake && lake.class_totals) {
      let checked = 0;
      for (const fy of spendFys) {
        const river = spend.by_fy[fy];
        const totalIdx = river.nodes.findIndex((n) => n.level === "total");
        const sums = [0, 0, 0, 0];
        for (const e of river.edges) {
          if (e.s !== totalIdx) continue;
          e.c.forEach((v, i) => (sums[i] += v));
        }
        const lakeFy = lake.class_totals[fy] ?? {};
        COMPETED_CLASSES.forEach((cls, i) => {
          const expected = lakeFy[cls] ?? 0;
          if (Math.abs(sums[i] - expected) > lakeTol(expected, 2.0)) {
            errors.push(`leg d: FY${fy} class ${cls} payload=${sums[i]} lake=${expected}`);
          } else checked++;
        });
      }
      notes.push(`leg d: ${checked} (FY × class) mouth totals match the lake regroup ✓`);
    }
  }

  // ── Leg (e): Playwright on /flow/ ─────────────────────────────────────────
  {
    if (!fs.existsSync(path.join(outDir, "flow", "index.html"))) {
      errors.push("leg e: /flow/ not built (out/flow/index.html missing)");
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      let pageUp = false;
      try {
        const resp = await page.goto(`${baseUrl}/flow/`, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        if (!resp || resp.status() >= 400) {
          errors.push(`leg e: /flow/ returned status ${resp ? resp.status() : "none"}`);
        } else if (
          !(await page.waitForSelector('[data-testid="flow-chart"]', { timeout: 15000 }).catch(() => null))
        ) {
          errors.push('leg e: [data-testid="flow-chart"] not found on /flow/');
        } else {
          pageUp = true;
        }
      } catch (e) {
        errors.push(`leg e: /flow/ navigation failed: ${e.message}`);
      }

      if (pageUp) {
        // experimental banner + bridge coverage note
        if ((await page.locator("[data-flow-experimental]").count()) === 0) {
          errors.push("leg e: [data-flow-experimental] banner missing");
        }
        const note = page.locator('[data-coverage="flow-bridge"]');
        if ((await note.count()) === 0) {
          errors.push('leg e: [data-coverage="flow-bridge"] note missing');
        } else if (!/not yet crosswalked/i.test((await note.first().textContent()) ?? "")) {
          errors.push("leg e: bridge note does not state the not-yet-crosswalked gap");
        }

        // built-string regression: Turbopack drops the leading space of an
        // entity-bearing JSX text chunk after an expression — the shipped
        // page once read "FY2026President's Budget". Assert the BUILT text.
        const bodyText = (await page.locator("body").innerText()) ?? "";
        if (!/FY\d{4} President's Budget/.test(bodyText)) {
          errors.push(
            "leg e: unit statement must read \"FY#### President's Budget\" (spaced)"
          );
        }
        if (/FY\d{4}President/.test(bodyText)) {
          errors.push(
            'leg e: "FY####President" — missing-space regression in the built page'
          );
        }

        // ── Leg (f): render-level label bbox (backlog #20) ────────────────
        // One rect per node group's single <text> label (value tspans share
        // that element's bbox — a name+value pair can never self-collide).
        // Tooltip-only nodes (no lbl in the payload) contribute nothing.
        const collectLabelRects = () =>
          page.evaluate(() => {
            const box = (el, id, extra) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return null;
              const river = el.closest("[data-flow-river]");
              return {
                id,
                river: river
                  ? `${river.getAttribute("data-flow-river")} FY${river.getAttribute("data-fy")}`
                  : "(no river container)",
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
                ...extra,
              };
            };
            const rects = [];
            const groups = document.querySelectorAll(
              '[data-testid="flow-chart"] [data-flow-node], [data-testid="flow-chart"] [data-flow-other]'
            );
            // Paint order = document order. A label is only safe from a rect
            // if that rect is emitted BEFORE it, so each box records its
            // position in the SVG's own element sequence.
            const order = new Map();
            for (const svg of document.querySelectorAll(
              '[data-testid="flow-chart"] svg'
            )) {
              let i = 0;
              for (const el of svg.querySelectorAll("*")) order.set(el, i++);
            }
            for (const g of groups) {
              const text = g.querySelector("text");
              if (!text) continue;
              const b = box(text, g.getAttribute("data-node-id"), {
                paintIndex: order.get(text) ?? 0,
              });
              if (b) rects.push(b);
            }
            // Node FILL rects — the obstacles a label may not sit under.
            const fills = [];
            for (const el of document.querySelectorAll(
              '[data-testid="flow-chart"] rect.flow-node-rect'
            )) {
              const owner = el.closest("[data-node-fill], [data-node-id]");
              const b = box(
                el,
                owner
                  ? owner.getAttribute("data-node-fill") ??
                      owner.getAttribute("data-node-id")
                  : "(unowned)",
                { paintIndex: order.get(el) ?? 0 },
              );
              if (b) fills.push(b);
            }
            return { rects, fills };
          });
        const BBOX_TOL = 1; // px — halo/antialias slop, NOT a masking tolerance
        const labelCollisions = (rects, tag) => {
          const found = [];
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i];
              const b2 = rects[j];
              // distinct rivers are separate SVGs — they cannot legitimately
              // interact, and vertical page flow already separates them.
              if (a.river !== b2.river) continue;
              const ow = Math.min(a.right, b2.right) - Math.max(a.left, b2.left);
              const oh = Math.min(a.bottom, b2.bottom) - Math.max(a.top, b2.top);
              if (ow > BBOX_TOL && oh > BBOX_TOL) {
                found.push(
                  `leg f: ${tag} ${a.river}: labels "${a.id}" and "${b2.id}" ` +
                    `overlap ${ow.toFixed(1)}×${oh.toFixed(1)}px`
                );
              }
            }
          }
          return found;
        };
        /**
         * A label is CLIPPED when a node fill rect painted AFTER it (later in
         * the SVG's element order) covers part of its box. Rects painted
         * before are harmless — the label draws on top of them.
         */
        const labelClips = (rects, fills, tag) => {
          const found = [];
          for (const a of rects) {
            for (const f of fills) {
              if (a.river !== f.river) continue;
              if (a.id === f.id) continue; // a node's own fill
              if (f.paintIndex < a.paintIndex) continue; // painted under
              const ow = Math.min(a.right, f.right) - Math.max(a.left, f.left);
              const oh = Math.min(a.bottom, f.bottom) - Math.max(a.top, f.top);
              if (ow > BBOX_TOL && oh > BBOX_TOL) {
                found.push(
                  `leg f: ${tag} ${a.river}: node "${f.id}"'s fill rect is painted OVER label ` +
                    `"${a.id}" and clips ${ow.toFixed(1)}×${oh.toFixed(1)}px of it — ` +
                    `paint the fills before the labels`
                );
              }
            }
          }
          return found;
        };
        {
          const { rects, fills } = await collectLabelRects();
          if (rects.length === 0) {
            errors.push("leg f: no rendered flow labels found — leg cannot vacuously pass");
          } else if (fills.length === 0) {
            errors.push(
              "leg f: no rendered node fill rects found — the label-vs-rect check cannot vacuously pass"
            );
          } else {
            const found = [
              ...labelCollisions(rects, "initial render"),
              ...labelClips(rects, fills, "initial render"),
            ];
            errors.push(...found);
            if (found.length === 0) {
              notes.push(
                `leg f: ${rects.length} rendered labels vs ${fills.length} node fills at 1440, ` +
                  `0 bbox collisions and 0 clipped labels (initial) ✓`
              );
            }
          }
        }

        // offers honesty must be STATIC and adjacent to the legend — not
        // hover-only, not footer-only.
        const offers = page.locator('[data-testid="flow-offers-note"]');
        if ((await offers.count()) === 0) {
          errors.push('leg e: [data-testid="flow-offers-note"] missing');
        } else if (!/counts offers, not bidders/.test((await offers.first().textContent()) ?? "")) {
          errors.push("leg e: offers note does not state offers-not-bidders");
        } else {
          notes.push("leg e: static offers-not-bidders note beside the legend ✓");
        }

        // drill-down expands an Other node
        const other = page.locator("[data-flow-other]").first();
        if ((await other.count()) === 0) {
          errors.push("leg e: no [data-flow-other] node to drill into");
        } else {
          await other.click();
          const drill = await page
            .waitForSelector('[data-testid="flow-drilldown"]', { timeout: 10000 })
            .catch(() => null);
          if (!drill) {
            errors.push("leg e: drill-down panel did not open from an Other node");
          } else if ((await page.locator("[data-drill-member]").count()) === 0) {
            errors.push("leg e: drill-down shows no [data-drill-member] rows");
          } else {
            notes.push("leg e: Other drill-down expands ✓");
            // built-string regression twin: the description once read
            // "across 14entries" (same Turbopack chunk bug).
            const drillText =
              (await page.locator('[data-testid="flow-drilldown"]').innerText()) ?? "";
            if (!/across \d+ entries below/.test(drillText)) {
              errors.push(
                `leg e: drill-down description must read "across N entries below" — got "${drillText
                  .replace(/\s+/g, " ")
                  .slice(0, 100)}"`
              );
            }
          }
          await page.keyboard.press("Escape");
        }

        // FY selector switches the spend river
        const sel = page.locator('[data-testid="flow-fy-select"]');
        if ((await sel.count()) === 0) {
          errors.push('leg e: [data-testid="flow-fy-select"] missing');
        } else {
          const targetFy = spendFys.find((f) => f !== String(spend.default_fy));
          await sel.selectOption(String(targetFy));
          await page.waitForTimeout(400);
          const got = await page
            .locator('[data-flow-river="spend"]')
            .first()
            .getAttribute("data-fy");
          if (got !== String(targetFy)) {
            errors.push(`leg e: FY selector switched to ${targetFy} but spend river shows data-fy=${got}`);
          } else {
            notes.push(`leg e: FY selector switches the spend river (${spend.default_fy}→${targetFy}) ✓`);
            // Leg (f) again on the re-rendered spend river: the FY switch
            // remounts the SVG with a different node/label set.
            const { rects, fills } = await collectLabelRects();
            const found = [
              ...labelCollisions(rects, `after FY→${targetFy} switch`),
              ...labelClips(rects, fills, `after FY→${targetFy} switch`),
            ];
            errors.push(...found);
            if (found.length === 0) {
              notes.push(
                `leg f: ${rects.length} rendered labels vs ${fills.length} node fills, ` +
                  `0 bbox collisions and 0 clipped labels (after FY→${targetFy}) ✓`
              );
            }
          }
        }

        // node click opens the citation panel
        const node = page.locator("[data-flow-node]").first();
        if ((await node.count()) === 0) {
          errors.push("leg e: no [data-flow-node] elements");
        } else {
          await node.click();
          const panel = await page
            .waitForSelector('[data-testid="citation-panel"]', { timeout: 10000 })
            .catch(() => null);
          if (!panel) {
            errors.push("leg e: citation panel did not open from a flow node");
          } else {
            notes.push("leg e: citation panel opens from a node ✓");
          }
        }

        if (consoleErrors.length > 0) {
          errors.push(`leg e: ${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(" | ")}`);
        }
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }

  // ── Leg (g): /lineage/ ribbons encode nothing (ROADMAP #29(c)) ──────────
  {
    const g = runLineageRibbonLeg();
    errors.push(...g.errors);
    notes.push(...g.notes);
  }

  return { pass: errors.length === 0, errors, notes };
}
