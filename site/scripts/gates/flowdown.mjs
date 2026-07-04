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
 *
 * Export: runFlowdownGate({ baseUrl }) → { pass, errors, notes }
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

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
            const rects = [];
            const groups = document.querySelectorAll(
              '[data-testid="flow-chart"] [data-flow-node], [data-testid="flow-chart"] [data-flow-other]'
            );
            for (const g of groups) {
              const text = g.querySelector("text");
              if (!text) continue;
              const r = text.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              const river = g.closest("[data-flow-river]");
              rects.push({
                id: g.getAttribute("data-node-id"),
                river: river
                  ? `${river.getAttribute("data-flow-river")} FY${river.getAttribute("data-fy")}`
                  : "(no river container)",
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
              });
            }
            return rects;
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
        {
          const rects = await collectLabelRects();
          if (rects.length === 0) {
            errors.push("leg f: no rendered flow labels found — leg cannot vacuously pass");
          } else {
            const found = labelCollisions(rects, "initial render");
            errors.push(...found);
            if (found.length === 0) {
              notes.push(
                `leg f: ${rects.length} rendered labels at 1440, 0 bbox collisions (initial) ✓`
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
            const rects = await collectLabelRects();
            const found = labelCollisions(rects, `after FY→${targetFy} switch`);
            errors.push(...found);
            if (found.length === 0) {
              notes.push(
                `leg f: ${rects.length} rendered labels, 0 bbox collisions (after FY→${targetFy}) ✓`
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

  return { pass: errors.length === 0, errors, notes };
}
