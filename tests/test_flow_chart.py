"""Phase 5H — flow_chart exporter unit tests.

Covers the precomputed sankey payload builder (src/govbudget/flow_chart.py):
Decimal-exact top-N + Other aggregation, conservation inside the payload,
deterministic layout geometry, the honest crosswalk bridge (remainder ==
total − crosswalked EXACTLY), the competition overlay partition, and the
minted derived citations (budget nodes recompute via sum(budget_lines…;
spend nodes recompute via sum(flow_children…).
"""

import json
from decimal import Decimal as D
from pathlib import Path

import duckdb
import pytest

from govbudget.export_site import fact_id_workbook
from govbudget.flow_chart import (
    COMPETED_CLASSES,
    OFFERS_BUCKETS,
    build_flow_chart,
)

FLOW_COLS = (
    "river varchar, fiscal_year integer, level_from varchar, node_from varchar,"
    " node_from_label varchar, level_to varchar, node_to varchar,"
    " node_to_label varchar, competed_class varchar, offers_bucket varchar,"
    " amount double, line_count bigint, units varchar"
)


def _bl_row(org, account, ba, pe, title, amount, amount_type="fy_2026_total"):
    """Build a 16-element bl_rows tuple like export_site's step 2c."""
    sha = "deadbeef" * 8
    fid = fact_id_workbook(sha, "R-1", 2026, account, org, ba, pe, amount_type)
    return (
        fid, "R-1", 2026, account, f"title of {account}", org, ba,
        f"BA {ba}", pe, title, amount_type, float(amount),
        "USD thousands", sha, "Sheet1", "A1",
    )


@pytest.fixture()
def flow_db(tmp_path: Path) -> Path:
    db = tmp_path / "flow.duckdb"
    con = duckdb.connect(str(db))
    con.execute(f"create table fct_flow_edges ({FLOW_COLS})")

    budget = [
        # total → component (labels for the component level)
        ("budget", 2026, "total", "TOTAL", "FY2026 PB", "component",
         "DARPA", "DARPA", None, None, 400000.0, 2, "USD_thousands"),
        ("budget", 2026, "total", "TOTAL", "FY2026 PB", "component",
         "A", "Army", None, None, 100000.0, 1, "USD_thousands"),
        ("budget", 2026, "total", "TOTAL", "FY2026 PB", "component",
         "CLASSIFIED", "Classified Programs", None, None, 30000.0, 1,
         "USD_thousands"),
        # component → appropriation (labels for the appropriation level)
        ("budget", 2026, "component", "DARPA", "DARPA", "appropriation",
         "DARPA|0400D", "RDT&E Defense-Wide", None, None, 400000.0, 2,
         "USD_thousands"),
        ("budget", 2026, "component", "A", "Army", "appropriation",
         "A|2040A", "RDT&E Army", None, None, 100000.0, 1, "USD_thousands"),
        ("budget", 2026, "component", "CLASSIFIED", "Classified Programs",
         "appropriation", "CLASSIFIED|3080F", "Other Procurement AF",
         None, None, 30000.0, 1, "USD_thousands"),
        # appropriation → budget_activity (labels for the BA level)
        ("budget", 2026, "appropriation", "DARPA|0400D", "RDT&E Defense-Wide",
         "budget_activity", "DARPA|0400D|01", "Basic Research",
         None, None, 400000.0, 2, "USD_thousands"),
        ("budget", 2026, "appropriation", "A|2040A", "RDT&E Army",
         "budget_activity", "A|2040A|02", "Applied Research",
         None, None, 100000.0, 1, "USD_thousands"),
        ("budget", 2026, "appropriation", "CLASSIFIED|3080F",
         "Other Procurement AF", "budget_activity", "CLASSIFIED|3080F|04",
         "BA 04", None, None, 30000.0, 1, "USD_thousands"),
        # budget_activity → program (the leaf grain the builder sums from)
        ("budget", 2026, "budget_activity", "DARPA|0400D|01", "Basic Research",
         "program", "DARPA|0400D|01|0601101E", "DEFENSE RESEARCH",
         None, None, 300000.0, 1, "USD_thousands"),
        ("budget", 2026, "budget_activity", "DARPA|0400D|01", "Basic Research",
         "program", "DARPA|0400D|01|0601102E", "APPLIED RESEARCH",
         None, None, 100000.0, 1, "USD_thousands"),
        ("budget", 2026, "budget_activity", "A|2040A|02", "Applied Research",
         "program", "A|2040A|02|0601104A", "ARMY RESEARCH",
         None, None, 100000.0, 1, "USD_thousands"),
        ("budget", 2026, "budget_activity", "CLASSIFIED|3080F|04", "BA 04",
         "program", "CLASSIFIED|3080F|04|9999999999", "Classified Programs",
         None, None, 30000.0, 1, "USD_thousands"),
    ]
    spend = [
        # office → family leaves (the only spend grain the builder reads)
        ("spend", 2025, "office", "DEPT ARMY|ACC-APG", "ACC-APG", "family",
         "ACME PARENT", "ACME PARENT", "full_and_open", "3-4", 600.25, 3, "USD"),
        ("spend", 2025, "office", "DEPT ARMY|ACC-APG", "ACC-APG", "family",
         "ACME PARENT", "ACME PARENT", "not_competed", "1", 150.5, 1, "USD"),
        ("spend", 2025, "office", "DEPT NAVY|NAVSEA", "NAVSEA", "family",
         "BETA LLC", "BETA LLC", "set_aside", "2", 250.0, 2, "USD"),
        ("spend", 2025, "office", "DEPT NAVY|NAVSEA", "NAVSEA", "family",
         "GAMMA CO", "GAMMA CO", "other_than_full", "unknown", 99.25, 1, "USD"),
        ("spend", 2024, "office", "DEPT ARMY|ACC-APG", "ACC-APG", "family",
         "ACME PARENT", "ACME PARENT", "other_than_full", "unknown",
         100.0, 1, "USD"),
        # net de-obligation: a REAL spend-river case — NAVAIR's net FY2025
        # position with ACME is negative. Values stay negative (honest);
        # geometry renders zero-width bands (see _layout docstring).
        ("spend", 2025, "office", "DEPT NAVY|NAVAIR", "NAVAIR", "family",
         "ACME PARENT", "ACME PARENT", "not_competed", "unknown",
         -50.0, 1, "USD"),
    ]
    con.executemany(
        "insert into fct_flow_edges values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        budget + spend,
    )
    # bridge marts: 0601101E crosswalks high (PIID1) AND medium (PIID3) —
    # PE confidence must be 'high' (an int-max, never a lexicographic
    # varchar max where 'medium' > 'high') and families must come from the
    # high link only. 0601104A is medium-only → confidence 'medium',
    # families [] (medium fan-out excluded by design).
    con.execute(
        "create table fct_budget_to_awards as select * from (values"
        " ('0601101E','PIID1','high'),"
        " ('0601101E','PIID3','medium'),"
        " ('0601104A','PIID2','medium'))"
        " t(pe_bli, award_piid, confidence)"
    )
    con.execute(
        "create table fct_award_transactions as select * from (values"
        " ('PIID1','UEI1',1000.0),"
        " ('PIID2','UEI2',500.0),"
        " ('PIID3','UEI2',250.0))"
        " t(award_id_piid, recipient_uei, obligation)"
    )
    con.execute(
        "create table entity_xwalk as select * from (values"
        " ('UEI1','ACME PARENT'),('UEI2','BETA LLC'))"
        " t(recipient_uei, family_key)"
    )
    con.execute(
        "create table dim_pe_titles as select * from (values"
        " ('0601101E','DEFENSE RESEARCH'),('0601104A','ARMY RESEARCH'))"
        " t(pe_bli, title)"
    )
    con.close()
    return db


@pytest.fixture()
def bl_rows():
    return [
        _bl_row("DARPA", "0400D", "01", "0601101E", "DEFENSE RESEARCH", 300000),
        _bl_row("DARPA", "0400D", "01", "0601102E", "APPLIED RESEARCH", 100000),
        _bl_row("A", "2040A", "02", "0601104A", "ARMY RESEARCH", 100000),
        _bl_row("", "3080F", "04", "9999999999", "Classified Programs", 30000),
        # noise: other amount_type must be ignored by the fid lookup
        _bl_row("DARPA", "0400D", "01", "0601101E", "DEFENSE RESEARCH",
                280494, amount_type="fy_2024_actuals"),
    ]


def _build(flow_db, bl_rows, **kw):
    kw.setdefault("top_n", 2)
    kw.setdefault("default_fy", 2025)
    return build_flow_chart(duckdb_path=flow_db, bl_rows=bl_rows, **kw)


def _cit_index(cit_rows):
    return {r[0]: r for r in cit_rows}


def _node_by_id(river, node_id):
    return next(n for n in river["nodes"] if n["id"] == node_id)


# ---------------------------------------------------------------------------
# Conservation + aggregation
# ---------------------------------------------------------------------------


def test_budget_conservation_and_other_aggregation(flow_db, bl_rows):
    payload, _rows = _build(flow_db, bl_rows)
    b = payload["budget"]
    nodes = b["nodes"]
    edges = b["edges"]

    # every non-terminal node: sum(out) == value; every non-root: sum(in) == value
    by_idx = {i: n for i, n in enumerate(nodes)}
    inflow: dict[int, D] = {}
    outflow: dict[int, D] = {}
    for e in edges:
        outflow[e["s"]] = outflow.get(e["s"], D(0)) + D(str(e["v"]))
        inflow[e["t"]] = inflow.get(e["t"], D(0)) + D(str(e["v"]))
    for i, n in by_idx.items():
        v = D(str(n["value"]))
        if n["level"] != "total":
            assert inflow.get(i, D(0)) == v, f"inflow != value for {n['id']}"
        if n["level"] not in ("bridge",):
            assert outflow.get(i, D(0)) == v, f"outflow != value for {n['id']}"

    # top_n=2 → component level: DARPA + A exported, CLASSIFIED in Other
    comp_ids = [n["id"] for n in nodes if n["level"] == "component"]
    assert "b:c:DARPA" in comp_ids and "b:c:A" in comp_ids
    other = _node_by_id(b, "b:other:component")
    assert other["value"] == 30000.0
    assert other["other"]["count"] == 1
    members = other["other"]["members"]
    assert members[0]["k"] == "CLASSIFIED"
    # members + omitted_value account for 100% of the Other node exactly
    assert (
        sum(D(str(m["v"])) for m in members)
        + D(str(other["other"]["omitted_value"]))
        == D(str(other["value"]))
    )

    # total equals the river mouth
    total = _node_by_id(b, "b:total")
    assert D(str(total["value"])) == D("530000")


def test_spend_conservation_and_competition_partition(flow_db, bl_rows):
    payload, _rows = _build(flow_db, bl_rows)
    s = payload["spend"]
    assert s["competed_classes"] == list(COMPETED_CLASSES)
    assert s["offers_buckets"] == list(OFFERS_BUCKETS)
    assert s["default_fy"] == 2025
    assert s["fys"] == [2024, 2025]

    river = s["by_fy"]["2025"]
    # every edge: competed classes and offers buckets partition the edge value
    for e in river["edges"]:
        v = D(str(e["v"]))
        assert sum(D(str(x)) for x in e["c"]) == v
        assert sum(D(str(x)) for x in e["o"]) == v
    # node conservation
    inflow: dict[int, D] = {}
    outflow: dict[int, D] = {}
    for e in river["edges"]:
        outflow[e["s"]] = outflow.get(e["s"], D(0)) + D(str(e["v"]))
        inflow[e["t"]] = inflow.get(e["t"], D(0)) + D(str(e["v"]))
    for i, n in enumerate(river["nodes"]):
        v = D(str(n["value"]))
        if n["level"] != "total":
            assert inflow.get(i, D(0)) == v
        if n["level"] != "family":
            assert outflow.get(i, D(0)) == v
    # 600.25 + 150.5 + 250 + 99.25 − 50 (net de-obligation stays in the sums)
    assert D(str(river["total"])) == D("1050.00")
    # the negative office survives as an honestly negative Other node
    other_office = next(n for n in river["nodes"] if n["id"] == "s:2025:other:office")
    assert other_office["value"] == -50.0


def test_deterministic_output(flow_db, bl_rows):
    p1, r1 = _build(flow_db, bl_rows)
    p2, r2 = _build(flow_db, bl_rows)
    assert json.dumps(p1, sort_keys=True) == json.dumps(p2, sort_keys=True)
    # rows identical apart from retrieved_at (index 19 — the build timestamp)
    mask = [r[:19] + r[20:] for r in r1]
    assert mask == [r[:19] + r[20:] for r in r2]


# ---------------------------------------------------------------------------
# Layout geometry
# ---------------------------------------------------------------------------


def test_layout_geometry(flow_db, bl_rows):
    payload, _ = _build(flow_db, bl_rows)
    b = payload["budget"]
    total_node = _node_by_id(b, "b:total")
    scale = (total_node["y1"] - total_node["y0"]) / total_node["value"]
    for n in b["nodes"]:
        assert 0 <= n["x0"] < n["x1"] <= b["width"]
        assert 0 <= n["y0"] <= n["y1"] <= b["height"] + 1e-6
        # heights proportional to value (never distorted)
        assert abs((n["y1"] - n["y0"]) - n["value"] * scale) < 0.05, n["id"]
    # levels occupy strictly increasing x columns
    level_x = {}
    for n in b["nodes"]:
        level_x.setdefault(n["level"], n["x0"])
        assert level_x[n["level"]] == n["x0"]
    xs = [level_x[lv] for lv in b["levels"] if lv in level_x]
    assert xs == sorted(xs) and len(set(xs)) == len(xs)
    # edge bands sit inside their nodes and match edge thickness on both ends
    for e in b["edges"]:
        sn, tn = b["nodes"][e["s"]], b["nodes"][e["t"]]
        sy0, sy1, ty0, ty1 = e["g"]
        assert sn["y0"] - 1e-6 <= sy0 <= sy1 <= sn["y1"] + 1e-6
        assert tn["y0"] - 1e-6 <= ty0 <= ty1 <= tn["y1"] + 1e-6
        assert abs((sy1 - sy0) - e["v"] * scale) < 0.05
        assert abs((ty1 - ty0) - e["v"] * scale) < 0.05


def test_negative_flows_geometry(flow_db, bl_rows):
    """Negative flows: honest negative values, zero-width bands, node-side
    compression so positive bands still fit (the documented layout rule)."""
    payload, _ = _build(flow_db, bl_rows)
    river = payload["spend"]["by_fy"]["2025"]
    nodes = river["nodes"]
    total = next(n for n in nodes if n["level"] == "total")
    scale = (total["y1"] - total["y0"]) / total["value"]

    # negative node → zero height
    other_office = next(n for n in nodes if n["id"] == "s:2025:other:office")
    assert other_office["y1"] == other_office["y0"]

    pos_out: dict[int, float] = {}
    pos_in: dict[int, float] = {}
    for e in river["edges"]:
        pos_out[e["s"]] = pos_out.get(e["s"], 0.0) + max(e["v"], 0.0)
        pos_in[e["t"]] = pos_in.get(e["t"], 0.0) + max(e["v"], 0.0)

    def factor(node, pos_sum):
        return min(1.0, max(node["value"], 0.0) / pos_sum) if pos_sum > 0 else 0.0

    saw_negative = False
    for e in river["edges"]:
        sn, tn = nodes[e["s"]], nodes[e["t"]]
        sy0, sy1, ty0, ty1 = e["g"]
        if e["v"] < 0:
            saw_negative = True
            assert sy1 - sy0 == 0 and ty1 - ty0 == 0, "negative flow must be zero-width"
        exp_s = max(e["v"], 0.0) * scale * factor(sn, pos_out.get(e["s"], 0.0))
        exp_t = max(e["v"], 0.0) * scale * factor(tn, pos_in.get(e["t"], 0.0))
        assert abs((sy1 - sy0) - exp_s) < 0.05
        assert abs((ty1 - ty0) - exp_t) < 0.05
        # containment
        assert sn["y0"] - 1e-6 <= sy0 <= sy1 <= sn["y1"] + 1e-6
        assert tn["y0"] - 1e-6 <= ty0 <= ty1 <= tn["y1"] + 1e-6
    assert saw_negative, "fixture must exercise a negative edge"


# ---------------------------------------------------------------------------
# Bridge honesty
# ---------------------------------------------------------------------------


def test_bridge_remainder_exact(flow_db, bl_rows):
    payload, _ = _build(flow_db, bl_rows)
    br = payload["budget"]["bridge"]
    # crosswalked pes: 0601101E (300000) + 0601104A (100000) = 400000
    assert D(br["crosswalked_total_str"]) == D("400000.000")
    assert D(br["budget_total_str"]) == D("530000.000")
    # THE bridge-honesty identity — exact, no tolerance
    assert (
        D(br["budget_total_str"]) - D(br["crosswalked_total_str"])
        == D(br["not_yet_crosswalked_str"])
    )
    assert br["crosswalked_pe_count"] == 2
    assert br["high_confidence_pe_count"] == 1
    # the two band nodes exist and carry the same values
    cw = _node_by_id(payload["budget"], "b:bridge:crosswalked")
    ny = _node_by_id(payload["budget"], "b:bridge:not-crosswalked")
    assert D(str(cw["value"])) == D(br["crosswalked_total_str"])
    assert D(str(ny["value"])) == D(br["not_yet_crosswalked_str"])
    # program detail: families via HIGH-confidence crosswalk links only.
    # 0601101E has a high (→ACME PARENT) and a medium (→BETA LLC) link: the
    # PE is 'high' and BETA LLC must NOT appear (medium fan-out excluded).
    progs = {p["pe_bli"]: p for p in br["programs"]}
    assert progs["0601101E"]["confidence"] == "high"
    assert progs["0601101E"]["families"] == [
        {"family_key": "ACME PARENT", "confidence": "high"}
    ]
    assert progs["0601104A"]["confidence"] == "medium"
    assert progs["0601104A"]["families"] == []
    assert br["crosswalk_universe_pe_count"] == 2
    assert "not yet crosswalked" in br["coverage_note"]


# ---------------------------------------------------------------------------
# Citations
# ---------------------------------------------------------------------------


def test_budget_node_citations_recompute(flow_db, bl_rows):
    payload, rows = _build(flow_db, bl_rows)
    cits = _cit_index(rows)
    bl_amounts = {r[0]: r[11] for r in bl_rows}
    for n in payload["budget"]["nodes"]:
        assert n["fid"], f"budget node {n['id']} lacks a citation"
        row = cits[n["fid"]]
        kind, formula, inputs_raw, recorded = row[1], row[20], row[21], row[23]
        assert kind == "derived"
        assert formula.startswith("sum(budget_lines"), n["id"]
        inputs = json.loads(inputs_raw)
        assert len(inputs) >= 1
        # recompute: the _verify_derived 4c contract
        got = sum(D(str(bl_amounts[f])) for f in inputs)
        assert got == D(recorded), f"{n['id']}: {got} != {recorded}"
        assert D(str(n["value"])) == D(recorded)


def test_budget_edges_cite(flow_db, bl_rows):
    payload, rows = _build(flow_db, bl_rows)
    cits = _cit_index(rows)
    b = payload["budget"]
    for e in b["edges"]:
        assert e["f"] in cits, "budget edge without resolvable citation"
        recorded = cits[e["f"]][23]
        tgt = b["nodes"][e["t"]]
        if not tgt["id"].startswith(("b:other:", "b:bridge:")):
            # tree edge cites its child node fact — identical value
            assert e["f"] == tgt["fid"]
            assert D(str(e["v"])) == D(recorded)


def test_spend_citations_flow_children_recompute(flow_db, bl_rows):
    payload, rows = _build(flow_db, bl_rows)
    cits = _cit_index(rows)
    river = payload["spend"]["by_fy"]["2025"]
    for e in river["edges"]:
        row = cits[e["f"]]
        assert row[1] == "derived"
        assert row[20].startswith("sum(contracts.federal_action_obligation")
        assert row[22] is not None  # query_body
        body = json.loads(row[22])
        assert body["fy"] == 2025
        assert D(row[23]) == D(str(e["v"]))
    for i, n in enumerate(river["nodes"]):
        row = cits[n["fid"]]
        formula, inputs_raw, recorded = row[20], row[21], row[23]
        assert formula.startswith("sum(flow_children"), n["id"]
        inputs = json.loads(inputs_raw)
        got = sum(D(cits[f][23]) for f in inputs)
        assert got == D(recorded), f"{n['id']}: {got} != {recorded}"
        assert D(str(n["value"])) == D(recorded)


def test_missing_mart_returns_none(tmp_path, bl_rows):
    db = tmp_path / "empty.duckdb"
    duckdb.connect(str(db)).close()
    payload, rows = build_flow_chart(duckdb_path=db, bl_rows=bl_rows)
    assert payload is None
    assert rows == []
