# Phase 5H — Experimental Budget Flowdown Chart (/flow/)

**Date:** 2026-07-02
**Status:** Approved (user directive: "experimental visual flowdown chart that starts
from the total defense budget, breaks it down into agencies, departments, programs,
and contractors")
**Sequenced:** after 5F (shared exporter surface). Uses 5D infra (cite-shards,
breakdown tables) and 5C motion system.

## 1. Concept — two rivers, honestly bridged

An interactive Sankey-style flowdown at **/flow/** (nav: under an "Experimental" tag):

- **Budget river (intent):** Total FY2026 PB (defense-wide + service rollups from
  R-1/P-1) → Component (Army/Navy/AF/Defense-Wide agencies) → Appropriation
  (RDT&E/Procurement) → Budget Activity → Program (top-N per branch + "Other (N)"
  drill-down nodes). Sums exact at every level (R-1 arithmetic).
- **Spend river (obligations, per FY selector):** Total DoD obligations → Awarding
  sub-agency → **Contracting office** (the "departments" level; from
  awarding_office_name) → Contractor family (top-N + Other) → optional subaward hop
  (quarantine-flagged rows excluded, stated).
- **The bridge:** program→contractor edges exist ONLY where the crosswalk links them
  (currently 24 PEs / 17 high-confidence). Unbridged budget flows terminate in an
  explicit **"not yet crosswalked"** band with a coverage note; unbridged spend
  arrives via the sub-agency path. Budget years ≠ obligation years — the two rivers
  are visually distinct systems with labeled units/years; no implied equivalence.

## 2. Competition overlay (the differentiator)

Spend-side flows color by `extent_competed` (full-and-open / other-than-full /
not-competed / set-aside classes), with `number_of_offers_received` distribution on
hover. Data verified present in the contracts parquet (untapped until now). Requires
a new mart `fct_flow_edges` capturing (level_from, node_from, level_to, node_to, fy,
amount, competed_class, offers_bucket) with dbt tests that child sums equal parents.

## 3. Provenance (non-negotiable)

- Every node value and every edge is cited: existing derived/usaspending facts where
  they exist; new derived facts minted for flow nodes/edges (formula = the aggregation,
  inputs = child fact_ids or query_body) — same _verify_derived recompute contract.
- Click a node/edge → citation panel; "View all N line items" → 5D breakdown table.
- Sankey LAYOUT precomputed in the exporter (node positions, band geometry) →
  static flow_chart.json; client renders SVG with compositor-only transitions
  (motion tokens; reduced-motion renders final frame). No client-side layout math,
  no new heavy deps.

## 4. Verification

- **G9 flowdown gate (built first, failing):** (a) conservation — every node equals
  the sum of its inflows/child nodes, recomputed from the parquet lake; (b) bridge
  honesty — unbridged band value equals total minus crosswalked sum exactly;
  (c) citation contract on sampled nodes/edges; (d) competition overlay classes sum
  to the spend total; (e) Playwright: drill-down expands "Other" nodes, FY selector
  switches spend river, panel opens from a node.
- Visual judging round (is it legible? does the experimental banner + coverage
  honesty land?) + live verification.

## 5. Non-goals

- Losing-bidder identities (structurally absent — FPDS records offer counts only;
  the UI must never imply otherwise). GAO protest-docket enrichment = future backlog.
- Outlay-stage flows (MTS staged data — future).
- Real-time anything; static export only.
