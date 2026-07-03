"""Phase 5H — flowdown chart payload builder (two rivers, honestly bridged).

Builds the precomputed sankey payload for /flow/ from the fct_flow_edges mart
(full grain) and mints the derived citations for every exported node and edge.

Design contract (binding for the G9 flowdown gate and the /flow/ UI):

- All arithmetic is Decimal. Leaf amounts are quantized once (0.001 for the
  budget river's USD thousands, 0.01 for the spend river's USD) and every
  exported value is a Decimal sum of those leaves — so parents equal the sum
  of their children EXACTLY, "Other" nodes equal total-minus-top EXACTLY, and
  the bridge remainder equals budget_total − crosswalked_total EXACTLY.
- Top-N per level + "Other (N)" happens HERE, at export time only; the mart
  keeps full grain. Other nodes carry drill-down payloads (members capped,
  with an exact omitted_value remainder so the members always account for
  100% of the node).
- Layout (node positions, band geometry) is precomputed here — the client
  renders SVG with no layout math. Deterministic: nodes ordered by
  (value desc, id asc), Other last; geometry rounded to 2 decimals
  (monotonic rounding preserves containment).
- Citations:
    budget nodes/edges  → kind='derived', formula starts with
      'sum(budget_lines' and inputs = the budget_lines workbook fact_ids of
      the node/edge's leaf subtree — recomputable by the existing
      _verify_derived rule 4c (sum of inputs == recorded_value).
    spend edges         → kind='derived', formula
      'sum(contracts.federal_action_obligation …' + query_body (the durable
      scope description); recorded_value present. The lake recompute lives in
      the G9 gate (a 35M-row parquet scan has no place in a citation row).
    spend nodes         → kind='derived', formula starts with
      'sum(flow_children' and inputs = the node's own edge fact_ids —
      recomputable by the _verify_derived flow_children rule.
  Tree edges in the budget river (single in-edge per non-Other node) cite
  their child node's fact directly — same value, no duplicate rows.

The two rivers are separate labeled systems (USD thousands FY2026 PB intent
vs USD obligations per FY) — nothing here implies equivalence.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

# ---------------------------------------------------------------------------
# Canonical vocabularies (mirrors of the fct_flow_edges mart contract)
# ---------------------------------------------------------------------------

COMPETED_CLASSES = ("full_and_open", "set_aside", "other_than_full", "not_competed")
OFFERS_BUCKETS = ("1", "2", "3-4", "5-9", "10+", "unknown")

BUDGET_LEVELS = ("total", "component", "appropriation", "budget_activity",
                 "program", "bridge")
SPEND_LEVELS = ("total", "sub_agency", "office", "family")

TOP_N = 12
OTHER_MEMBERS_CAP = 50          # budget river + default spend FY
OTHER_MEMBERS_CAP_OFF_FY = 20   # non-default spend FYs (size budget)
FAMILIES_CAP = 40               # bridge families per program (high-conf only)
PAYLOAD_BUDGET_BYTES = 600 * 1024

WIDTH = 1000.0
HEIGHT = 640.0
NODE_W = 18.0
NODE_PAD = 8.0

_Q_THOUSANDS = Decimal("0.001")
_Q_DOLLARS = Decimal("0.01")


def _fnum(d: Decimal) -> float:
    return float(d)


def _r2(x: float) -> float:
    return round(x, 2)


# ---------------------------------------------------------------------------
# Layout (pure, deterministic)
# ---------------------------------------------------------------------------


def _layout(nodes: list[dict], edges: list[dict], levels: list[str],
            *, width: float = WIDTH, height: float = HEIGHT,
            node_w: float = NODE_W, pad: float = NODE_PAD) -> None:
    """Assign x0/x1/y0/y1 to nodes and g=[sy0,sy1,ty0,ty1] to edges in place.

    Columns are the level order; node heights are strictly proportional to
    value (never distorted for legibility — honesty over aesthetics); edge
    bands are stacked within their nodes ordered by the far end's position.

    Negative flows (net de-obligations are real in the spend river —
    e.g. an office's net position with a family can be negative for a year):
    the VALUE stays honestly negative; the GEOMETRY renders them as
    zero-width bands (a ribbon cannot have negative width), and the node's
    positive bands are compressed by factor node_height / Σ(positive band
    heights) so the stack still fits exactly. Node heights use max(value, 0).
    This rule is duplicated in the G9 gate (independent copy, by design).
    """
    present_levels = [lv for lv in levels if any(n["level"] == lv for n in nodes)]
    n_cols = len(present_levels)
    col_of = {lv: i for i, lv in enumerate(present_levels)}

    columns: dict[str, list[int]] = {lv: [] for lv in present_levels}
    for i, n in enumerate(nodes):
        columns[n["level"]].append(i)

    # Shared vertical scale: the tightest column wins.
    scale = None
    for lv, idxs in columns.items():
        col_total = sum((n["_v"] for n in (nodes[i] for i in idxs)), Decimal(0))
        if col_total <= 0:
            continue
        avail = height - (len(idxs) - 1) * pad
        s = avail / float(col_total)
        scale = s if scale is None else min(scale, s)
    if scale is None:
        scale = 0.0

    for lv, idxs in columns.items():
        c = col_of[lv]
        x0 = 0.0 if n_cols <= 1 else c * (width - node_w) / (n_cols - 1)
        y = 0.0
        for i in idxs:
            n = nodes[i]
            h = max(float(n["_v"]), 0.0) * scale
            n["x0"], n["x1"] = _r2(x0), _r2(x0 + node_w)
            n["y0"], n["y1"] = _r2(y), _r2(y + h)
            n["_y0f"], n["_y1f"] = y, y + h  # unrounded, for band stacking
            y += h + pad

    # Band geometry: out-bands stacked by target y, in-bands by source y.
    by_source: dict[int, list[int]] = {}
    by_target: dict[int, list[int]] = {}
    for ei, e in enumerate(edges):
        by_source.setdefault(e["s"], []).append(ei)
        by_target.setdefault(e["t"], []).append(ei)
    geoms: dict[int, list[float]] = {ei: [0.0, 0.0, 0.0, 0.0] for ei in range(len(edges))}
    # Bands are clamped to their node's extent: float accumulation can
    # overshoot the node end by ~1e-9, which independent rounding could
    # amplify to a visible 0.01 protrusion.
    def stack(eis: list[int], ni: int, lo: int, hi: int) -> None:
        y0n, y1n = nodes[ni]["_y0f"], nodes[ni]["_y1f"]
        node_h = y1n - y0n
        pos_h = sum(max(float(edges[ei]["_v"]), 0.0) for ei in eis) * scale
        f = 1.0 if pos_h <= node_h or pos_h <= 0 else node_h / pos_h
        y = y0n
        for ei in eis:
            h = max(float(edges[ei]["_v"]), 0.0) * scale * f
            geoms[ei][lo], geoms[ei][hi] = max(y, y0n), min(y + h, y1n)
            y += h

    for ni, eis in by_source.items():
        eis.sort(key=lambda ei: (nodes[edges[ei]["t"]]["_y0f"], edges[ei]["t"]))
        stack(eis, ni, 0, 1)
    for ni, eis in by_target.items():
        eis.sort(key=lambda ei: (nodes[edges[ei]["s"]]["_y0f"], edges[ei]["s"]))
        stack(eis, ni, 2, 3)
    for ei, e in enumerate(edges):
        e["g"] = [_r2(v) for v in geoms[ei]]

    for n in nodes:
        n.pop("_y0f", None)
        n.pop("_y1f", None)


# ---------------------------------------------------------------------------
# Top-N + Other selection
# ---------------------------------------------------------------------------


def _pick_top(values: dict[str, Decimal], top_n: int) -> tuple[list[str], list[str]]:
    """Deterministic (value desc, key asc) split into (top, other_members)."""
    ordered = sorted(values.keys(), key=lambda k: (-values[k], k))
    return ordered[:top_n], ordered[top_n:]


def _other_payload(members: list[str], values: dict[str, Decimal],
                   labels: dict[str, str], cap: int) -> dict:
    ordered = sorted(members, key=lambda k: (-values[k], k))
    total = sum((values[k] for k in members), Decimal(0))
    shown = ordered[:cap]
    shown_sum = sum((values[k] for k in shown), Decimal(0))
    return {
        "count": len(members),
        "members": [
            {"k": k, "l": labels.get(k, k), "v": _fnum(values[k])} for k in shown
        ],
        "omitted": len(members) - len(shown),
        "omitted_value": _fnum(total - shown_sum),
    }


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------


def build_flow_chart(*, duckdb_path, bl_rows: list, top_n: int = TOP_N,
                     default_fy: int = 2025) -> tuple[dict | None, list[tuple]]:
    """Build (payload, citation_rows) for flow_chart.json.

    Returns (None, []) when the fct_flow_edges mart is absent (degenerate
    export — the sidecar is honestly not written and G9 fails loudly).
    """
    import datetime

    import duckdb as _duckdb

    from govbudget.export_site import (
        _null_derived_row,
        canonical_amount,
        fact_id_derived,
    )

    built_at = datetime.datetime.now(datetime.UTC).isoformat()
    citation_rows: list[tuple] = []
    minted_fids: set[str] = set()

    def mint(fid: str, units: str, formula: str, inputs: list,
             recorded: Decimal, query_body: str | None = None) -> str:
        if fid in minted_fids:
            return fid
        minted_fids.add(fid)
        citation_rows.append(_null_derived_row(
            fid, "derived", units, formula, json.dumps(inputs),
            canonical_amount(recorded), built_at, query_body=query_body,
        ))
        return fid

    con = _duckdb.connect(str(Path(duckdb_path)), read_only=True)
    try:
        try:
            budget_leaves = con.execute(
                "select node_to, node_to_label, amount from fct_flow_edges"
                " where river='budget' and level_from='budget_activity'"
                " order by node_to"
            ).fetchall()
        except _duckdb.CatalogException:
            print("flow_chart: fct_flow_edges mart missing — no flow_chart.json")
            return None, []

        label_maps = {}
        for lv in ("component", "appropriation", "budget_activity"):
            label_maps[lv] = dict(con.execute(
                "select node_to, max(node_to_label) from fct_flow_edges"
                " where river='budget' and level_to=? group by 1", [lv]
            ).fetchall())

        # ---- crosswalk bridge inputs ------------------------------------
        # PE confidence: 'high' if ANY link is high (integer max — a naive
        # varchar max() would pick 'medium' lexicographically).
        # Families: HIGH-confidence links ONLY — medium rows are
        # account-level matches that fan out ~400 PIIDs/PE (the same 14.7x
        # hazard fct_district_programs guards against); listing hundreds of
        # incidental families per program would be noise dressed as data.
        xwalk_conf: dict[str, str] = {}
        xwalk_fams: dict[str, dict[str, str]] = {}
        try:
            for pe, has_high in con.execute(
                "select pe_bli, max(case when confidence='high' then 1"
                " else 0 end) from fct_budget_to_awards group by 1"
            ).fetchall():
                xwalk_conf[pe] = "high" if has_high else "medium"
            for pe, fam in con.execute(
                """
                select distinct b.pe_bli,
                       coalesce(x.family_key, t.recipient_uei) as fam
                from fct_budget_to_awards b
                left join fct_award_transactions t
                    on t.award_id_piid = b.award_piid
                left join entity_xwalk x on x.recipient_uei = t.recipient_uei
                where b.confidence = 'high'
                order by 1, 2
                """
            ).fetchall():
                if fam is None:
                    continue
                xwalk_fams.setdefault(pe, {})[fam] = "high"
        except _duckdb.CatalogException:
            pass

        pe_titles: dict[str, str] = {}
        try:
            pe_titles = dict(con.execute(
                "select pe_bli, title from dim_pe_titles"
            ).fetchall())
        except _duckdb.CatalogException:
            pass

        # ---- spend leaves per FY ----------------------------------------
        spend_fys = [r[0] for r in con.execute(
            "select distinct fiscal_year from fct_flow_edges"
            " where river='spend' order by 1"
        ).fetchall()]
        spend_leaves_by_fy: dict[int, list] = {}
        for fy in spend_fys:
            spend_leaves_by_fy[fy] = con.execute(
                "select node_from, node_from_label, node_to, competed_class,"
                " offers_bucket, amount from fct_flow_edges"
                " where river='spend' and level_from='office'"
                " and fiscal_year=? order by node_from, node_to,"
                " competed_class, offers_bucket",
                [fy],
            ).fetchall()
    finally:
        con.close()

    if not budget_leaves and not spend_fys:
        print("flow_chart: fct_flow_edges is empty — no flow_chart.json")
        return None, []

    # ---- budget_lines fact_id lookup: (comp, acct, ba, pe) → [fid] ---------
    bl_lookup: dict[tuple, list[str]] = {}
    for r in bl_rows:
        (fid, _exh, _fy, account, _atitle, org, budget_activity, _batitle,
         pe_bli, title, amount_type, _amt, _units, _sha, _sheet, _cells) = r
        if title is None or amount_type != "fy_2026_total":
            continue
        comp = "CLASSIFIED" if org in (None, "") else org
        ba = "?" if budget_activity is None else budget_activity
        bl_lookup.setdefault((comp, account, ba, pe_bli), []).append(fid)

    budget_river = _build_budget_river(
        budget_leaves, label_maps, bl_lookup, xwalk_conf, xwalk_fams,
        pe_titles, top_n=top_n, mint=mint, fact_id_derived=fact_id_derived,
    )

    spend = _build_spend_rivers(
        spend_leaves_by_fy, top_n=top_n, default_fy=default_fy,
        mint=mint, fact_id_derived=fact_id_derived,
    )

    payload = {
        "schema_version": 1,
        "budget": budget_river,
        "spend": spend,
    }
    return payload, citation_rows


# ---------------------------------------------------------------------------
# Budget river
# ---------------------------------------------------------------------------


def _build_budget_river(budget_leaves, label_maps, bl_lookup, xwalk_conf,
                        xwalk_fams, pe_titles, *, top_n, mint,
                        fact_id_derived) -> dict:
    UNITS = "USD thousands"

    # leaves: (comp, acct, ba, pe, label, value, bl_fids)
    leaves = []
    missing_bl = 0
    for node_to, label, amount in budget_leaves:
        if amount is None:
            continue
        parts = node_to.split("|")
        comp, acct, ba, pe = parts[0], parts[1], parts[2], "|".join(parts[3:])
        v = Decimal(str(amount)).quantize(_Q_THOUSANDS)
        fids = bl_lookup.get((comp, acct, ba, pe), [])
        if not fids:
            missing_bl += 1
        leaves.append((comp, acct, ba, pe, label, v, fids))
    if missing_bl:
        print(f"flow_chart: {missing_bl} budget leaf node(s) have no"
              " budget_lines fact_ids — their citations fall back to an"
              " honest non-recomputable formula")

    # per-level values / labels / subtree fids, keyed by path string
    lvl_values: dict[str, dict[str, Decimal]] = {
        "component": {}, "appropriation": {}, "budget_activity": {}, "program": {},
    }
    lvl_labels: dict[str, dict[str, str]] = {
        "component": dict(label_maps.get("component", {})),
        "appropriation": dict(label_maps.get("appropriation", {})),
        "budget_activity": dict(label_maps.get("budget_activity", {})),
        "program": {},
    }
    subtree_fids: dict[tuple, list[str]] = {}
    total = Decimal(0)
    pe_values: dict[str, Decimal] = {}

    def _acc(level: str, key: str, v: Decimal, fids: list[str]):
        lvl_values[level][key] = lvl_values[level].get(key, Decimal(0)) + v
        subtree_fids.setdefault((level, key), []).extend(fids)

    for comp, acct, ba, pe, label, v, fids in leaves:
        total += v
        k_comp = comp
        k_acct = f"{comp}|{acct}"
        k_ba = f"{comp}|{acct}|{ba}"
        k_prog = f"{comp}|{acct}|{ba}|{pe}"
        _acc("component", k_comp, v, fids)
        _acc("appropriation", k_acct, v, fids)
        _acc("budget_activity", k_ba, v, fids)
        _acc("program", k_prog, v, fids)
        lvl_labels["program"].setdefault(k_prog, label or pe)
        pe_values[pe] = pe_values.get(pe, Decimal(0)) + v
    # (flatten deterministic: leaves are already ordered by node_to)
    subtree_fids[("total", "TOTAL")] = [f for l in leaves for f in l[6]]

    # ---- top-N per level ----------------------------------------------------
    node_prefix = {"component": "b:c:", "appropriation": "b:a:",
                   "budget_activity": "b:ba:", "program": "b:p:"}
    exported: dict[tuple, str] = {}   # (level, key) → node id
    nodes: list[dict] = []
    node_index: dict[str, int] = {}
    other_members: dict[str, list[str]] = {}

    def add_node(node_id: str, level: str, label: str, v: Decimal,
                 other: dict | None = None) -> int:
        idx = len(nodes)
        node_index[node_id] = idx
        nodes.append({
            "id": node_id, "level": level, "label": label,
            "value": _fnum(v), "_v": v, "fid": None, "other": other,
        })
        return idx

    add_node("b:total", "total", "FY2026 President's Budget (R-1 + P-1)", total)
    exported[("total", "TOTAL")] = "b:total"

    for level in ("component", "appropriation", "budget_activity", "program"):
        values = lvl_values[level]
        top, others = _pick_top(values, top_n)
        for k in top:
            nid = node_prefix[level] + k
            exported[(level, k)] = nid
            add_node(nid, level, lvl_labels[level].get(k, k), values[k])
        if others:
            nid = f"b:other:{level}"
            other_members[level] = others
            for k in others:
                exported[(level, k)] = nid
            ov = sum((values[k] for k in others), Decimal(0))
            add_node(nid, level, f"Other ({len(others)})", ov,
                     other=_other_payload(others, values, lvl_labels[level],
                                          OTHER_MEMBERS_CAP))

    # bridge bands
    crosswalked_pes = set(xwalk_conf.keys()) & set(pe_values.keys())
    crosswalked_total = sum((pe_values[pe] for pe in crosswalked_pes), Decimal(0))
    remainder = total - crosswalked_total
    idx_cw = add_node("b:bridge:crosswalked", "bridge",
                      f"Crosswalked to contractors ({len(crosswalked_pes)} PEs)",
                      crosswalked_total)
    idx_ny = add_node("b:bridge:not-crosswalked", "bridge",
                      "Not yet crosswalked", remainder)

    # ---- edges (accumulated from leaves through exported chains) -----------
    # edge key (src_id, tgt_id) → {"v": Decimal, "fids": [bl fids]}
    edge_acc: dict[tuple, dict] = {}

    def acc_edge(src: str, tgt: str, v: Decimal, fids: list[str]):
        e = edge_acc.setdefault((src, tgt), {"v": Decimal(0), "fids": []})
        e["v"] += v
        e["fids"].extend(fids)

    for comp, acct, ba, pe, _label, v, fids in leaves:
        chain = [
            "b:total",
            exported[("component", comp)],
            exported[("appropriation", f"{comp}|{acct}")],
            exported[("budget_activity", f"{comp}|{acct}|{ba}")],
            exported[("program", f"{comp}|{acct}|{ba}|{pe}")],
            "b:bridge:crosswalked" if pe in crosswalked_pes
            else "b:bridge:not-crosswalked",
        ]
        for a, b in zip(chain, chain[1:]):
            acc_edge(a, b, v, fids)

    # ---- citations ----------------------------------------------------------
    def node_formula(node_id: str) -> str:
        return ("sum(budget_lines.amount_thousands where"
                f" amount_type=fy_2026_total and flow_node={node_id})")

    for n in nodes:
        nid = n["id"]
        if nid == "b:total":
            fids = subtree_fids[("total", "TOTAL")]
        elif nid == "b:bridge:crosswalked":
            fids = [f for l in leaves if l[3] in crosswalked_pes for f in l[6]]
        elif nid == "b:bridge:not-crosswalked":
            fids = [f for l in leaves if l[3] not in crosswalked_pes for f in l[6]]
        elif nid.startswith("b:other:"):
            level = nid.split(":", 2)[2]
            fids = [f for k in other_members[level]
                    for f in subtree_fids[(level, k)]]
        else:
            level = {"b:c": "component", "b:a": "appropriation",
                     "b:ba": "budget_activity", "b:p": "program"}[
                nid.rsplit(":", 1)[0]]
            fids = subtree_fids[(level, nid.split(":", 2)[2])]
        fid = fact_id_derived("flow_budget_node", nid, "fy_2026_total")
        if fids:
            n["fid"] = mint(fid, UNITS, node_formula(nid), fids, n["_v"])
        else:
            # honest non-recomputable shape (no budget_lines inputs exist)
            n["fid"] = mint(
                fid, UNITS,
                f"flow budget node aggregation (inputs unavailable) {nid}",
                [], n["_v"],
            )

    edges: list[dict] = []
    for (src, tgt), acc in sorted(edge_acc.items(),
                                  key=lambda kv: (node_index[kv[0][0]],
                                                  node_index[kv[0][1]])):
        tgt_node = nodes[node_index[tgt]]
        if not tgt.startswith(("b:other:", "b:bridge:")):
            fid = tgt_node["fid"]  # tree edge — child node fact, same value
        else:
            fid = fact_id_derived("flow_budget_edge", f"{src}->{tgt}",
                                  "fy_2026_total")
            formula = ("sum(budget_lines.amount_thousands where"
                       f" amount_type=fy_2026_total and flow_edge={src}->{tgt})")
            if acc["fids"]:
                mint(fid, UNITS, formula, acc["fids"], acc["v"])
            else:
                mint(fid, UNITS,
                     f"flow budget edge aggregation (inputs unavailable)"
                     f" {src}->{tgt}", [], acc["v"])
        edges.append({
            "s": node_index[src], "t": node_index[tgt],
            "v": _fnum(acc["v"]), "_v": acc["v"], "f": fid,
        })

    _layout(nodes, edges, list(BUDGET_LEVELS))

    # ---- bridge summary ------------------------------------------------------
    programs = []
    for pe in sorted(crosswalked_pes):
        fams = xwalk_fams.get(pe, {})
        fam_keys = sorted(fams)
        entry = {
            "pe_bli": pe,
            "title": pe_titles.get(pe) or pe,
            "value": _fnum(pe_values[pe]),
            "confidence": xwalk_conf[pe],
            "families": [
                {"family_key": fam, "confidence": fams[fam]}
                for fam in fam_keys[:FAMILIES_CAP]
            ],
        }
        if len(fam_keys) > FAMILIES_CAP:
            entry["families_omitted"] = len(fam_keys) - FAMILIES_CAP
        programs.append(entry)
    n_high = sum(1 for pe in crosswalked_pes if xwalk_conf[pe] == "high")
    bridge = {
        "budget_total": _fnum(total),
        "budget_total_str": f"{total:.3f}",
        "crosswalked_total": _fnum(crosswalked_total),
        "crosswalked_total_str": f"{crosswalked_total:.3f}",
        "not_yet_crosswalked": _fnum(remainder),
        "not_yet_crosswalked_str": f"{remainder:.3f}",
        "crosswalked_pe_count": len(crosswalked_pes),
        "crosswalk_universe_pe_count": len(xwalk_conf),
        "high_confidence_pe_count": n_high,
        "crosswalked_node": nodes[idx_cw]["id"],
        "not_crosswalked_node": nodes[idx_ny]["id"],
        "coverage_note": (
            f"Program→contractor links exist only where the award crosswalk"
            f" links them: {len(crosswalked_pes)} of the {len(xwalk_conf)}"
            f" crosswalked PEs carry FY2026 request dollars ({n_high}"
            f" high-confidence; families are listed from high-confidence"
            f" links only). The remaining"
            f" ${remainder / Decimal(1000000):.1f}B of the FY2026 request is"
            f" not yet crosswalked — an honest gap, not an absence of"
            f" contractors."
        ),
        "programs": programs,
    }

    for n in nodes:
        n.pop("_v", None)
        if n["other"] is None:
            n.pop("other", None)
    for e in edges:
        e.pop("_v", None)

    return {
        "units": UNITS,
        "fiscal_year": 2026,
        "label": "FY2026 President's Budget (R-1 + P-1)",
        "levels": list(BUDGET_LEVELS),
        "width": WIDTH,
        "height": HEIGHT,
        "nodes": nodes,
        "edges": edges,
        "bridge": bridge,
    }


# ---------------------------------------------------------------------------
# Spend rivers (per FY)
# ---------------------------------------------------------------------------


def _build_spend_rivers(spend_leaves_by_fy, *, top_n, default_fy, mint,
                        fact_id_derived) -> dict:
    UNITS = "USD"
    fys = sorted(spend_leaves_by_fy.keys())
    by_fy: dict[str, dict] = {}

    for fy in fys:
        cap = OTHER_MEMBERS_CAP if fy == default_fy else OTHER_MEMBERS_CAP_OFF_FY
        by_fy[str(fy)] = _build_spend_river(
            fy, spend_leaves_by_fy[fy], top_n=top_n, members_cap=cap,
            mint=mint, fact_id_derived=fact_id_derived, units=UNITS,
        )

    chosen_default = default_fy if default_fy in fys else (fys[-1] if fys else None)
    return {
        "units": UNITS,
        "source_note": (
            "USAspending DoD prime contract transactions; assistance excluded"
            " (no competition fields). Obligation years are not budget years —"
            " the two rivers are separate systems."
        ),
        "competed_classes": list(COMPETED_CLASSES),
        "offers_buckets": list(OFFERS_BUCKETS),
        "levels": list(SPEND_LEVELS),
        "default_fy": chosen_default,
        "fys": fys,
        "width": WIDTH,
        "height": HEIGHT,
        "by_fy": by_fy,
        "notes": {
            "fy2026_partial": 2026 in fys,
            "offers": "number_of_offers_received counts offers, not bidders'"
                      " identities — FPDS records no losing-bidder identities.",
        },
    }


def _build_spend_river(fy: int, leaf_rows, *, top_n, members_cap, mint,
                       fact_id_derived, units) -> dict:
    # leaves: (sub, office_key, office_label, family, cls, bucket, v)
    leaves = []
    for node_from, office_label, family, cls, bucket, amount in leaf_rows:
        if amount is None:
            continue
        sub = node_from.split("|", 1)[0]
        v = Decimal(str(amount)).quantize(_Q_DOLLARS)
        leaves.append((sub, node_from, office_label, family, cls, bucket, v))

    sub_values: dict[str, Decimal] = {}
    office_values: dict[str, Decimal] = {}
    office_labels: dict[str, str] = {}
    fam_values: dict[str, Decimal] = {}
    total = Decimal(0)
    for sub, office, office_label, family, _cls, _bkt, v in leaves:
        total += v
        sub_values[sub] = sub_values.get(sub, Decimal(0)) + v
        office_values[office] = office_values.get(office, Decimal(0)) + v
        office_labels.setdefault(office, office_label or office)
        fam_values[family] = fam_values.get(family, Decimal(0)) + v

    nodes: list[dict] = []
    node_index: dict[str, int] = {}

    def add_node(node_id: str, level: str, label: str, v: Decimal,
                 other: dict | None = None) -> int:
        idx = len(nodes)
        node_index[node_id] = idx
        nodes.append({
            "id": node_id, "level": level, "label": label,
            "value": _fnum(v), "_v": v, "fid": None, "other": other,
        })
        return idx

    add_node(f"s:{fy}:total", "total", f"DoD contract obligations FY{fy}", total)

    exported: dict[tuple, str] = {}
    level_specs = [
        ("sub_agency", f"s:{fy}:sub:", sub_values, {}),
        ("office", f"s:{fy}:o:", office_values, office_labels),
        ("family", f"s:{fy}:f:", fam_values, {}),
    ]
    for level, prefix, values, labels in level_specs:
        top, others = _pick_top(values, top_n)
        for k in top:
            nid = prefix + k
            exported[(level, k)] = nid
            add_node(nid, level, labels.get(k, k), values[k])
        if others:
            nid = f"s:{fy}:other:{level}"
            for k in others:
                exported[(level, k)] = nid
            ov = sum((values[k] for k in others), Decimal(0))
            add_node(nid, level, f"Other ({len(others)})", ov,
                     other=_other_payload(others, values, labels, members_cap))

    # edges with competition/offers splits
    cls_idx = {c: i for i, c in enumerate(COMPETED_CLASSES)}
    bkt_idx = {b: i for i, b in enumerate(OFFERS_BUCKETS)}
    edge_acc: dict[tuple, dict] = {}

    def acc_edge(src, tgt, v, cls, bucket):
        e = edge_acc.setdefault((src, tgt), {
            "v": Decimal(0),
            "c": [Decimal(0)] * len(COMPETED_CLASSES),
            "o": [Decimal(0)] * len(OFFERS_BUCKETS),
        })
        e["v"] += v
        e["c"][cls_idx[cls]] += v
        e["o"][bkt_idx[bucket]] += v

    for sub, office, _olabel, family, cls, bucket, v in leaves:
        chain = [
            f"s:{fy}:total",
            exported[("sub_agency", sub)],
            exported[("office", office)],
            exported[("family", family)],
        ]
        for a, b in zip(chain, chain[1:]):
            acc_edge(a, b, v, cls, bucket)

    # top keys per level for the query_body "other" scope descriptions
    top_keys = {
        "total": None,
        "sub_agency": _pick_top(sub_values, top_n)[0],
        "office": _pick_top(office_values, top_n)[0],
        "family": _pick_top(fam_values, top_n)[0],
    }

    def scope_of(node_id: str) -> dict:
        n = nodes[node_index[node_id]]
        if n["level"] == "total":
            return {"level": "total"}
        if node_id.startswith(f"s:{fy}:other:"):
            return {"level": n["level"],
                    "other_excluding_top": top_keys[n["level"]]}
        return {"level": n["level"], "key": node_id.split(":", 3)[3]}

    edges: list[dict] = []
    for (src, tgt), acc in sorted(edge_acc.items(),
                                  key=lambda kv: (node_index[kv[0][0]],
                                                  node_index[kv[0][1]])):
        fid = fact_id_derived("flow_spend_edge", f"{fy}|{src}->{tgt}",
                              "obligation")
        formula = ("sum(contracts.federal_action_obligation where"
                   f" fy={fy} and flow_edge={src}->{tgt})")
        query_body = json.dumps({
            "source": "data/parquet/contracts (hive fy partitions)",
            "fy": fy,
            "from": scope_of(src),
            "to": scope_of(tgt),
            "family_resolution": "entity_xwalk.family_key; fallback"
                                 " upper(parent-or-recipient name), then UEI",
        }, sort_keys=True)
        mint(fid, units, formula, [], acc["v"], query_body=query_body)
        edges.append({
            "s": node_index[src], "t": node_index[tgt],
            "v": _fnum(acc["v"]), "_v": acc["v"], "f": fid,
            "c": [_fnum(x) for x in acc["c"]],
            "o": [_fnum(x) for x in acc["o"]],
        })

    # node facts: sum of the node's own edge facts (flow_children rule)
    out_edges: dict[int, list[dict]] = {}
    in_edges: dict[int, list[dict]] = {}
    for e in edges:
        out_edges.setdefault(e["s"], []).append(e)
        in_edges.setdefault(e["t"], []).append(e)
    for i, n in enumerate(nodes):
        own = in_edges.get(i, []) if n["level"] == "family" else out_edges.get(i, [])
        side = "in_edges" if n["level"] == "family" else "out_edges"
        fid = fact_id_derived("flow_spend_node", f"{fy}|{n['id']}", "obligation")
        inputs = [e["f"] for e in own]
        recorded = sum((e["_v"] for e in own), Decimal(0))
        n["fid"] = mint(
            fid, units,
            f"sum(flow_children({side}) where fy={fy} and flow_node={n['id']})",
            inputs, recorded,
        )

    _layout(nodes, edges, list(SPEND_LEVELS))

    for n in nodes:
        n.pop("_v", None)
        if n["other"] is None:
            n.pop("other", None)
    for e in edges:
        e.pop("_v", None)

    return {
        "total": _fnum(total),
        "total_str": f"{total:.2f}",
        "nodes": nodes,
        "edges": edges,
    }
