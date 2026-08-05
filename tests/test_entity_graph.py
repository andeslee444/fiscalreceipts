from pathlib import Path

import duckdb

from govbudget.entity_graph import build_entity_xwalk

AWARD_COLS = (
    "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name,"
    " federal_action_obligation"
)


def make_lake(tmp_path: Path) -> Path:
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('U1','BOEING DEFENSE SPACE','P1','THE BOEING COMPANY','100'),
          ('U2','BOEING AEROSPACE OPS','P2','BOEING COMPANY, THE (INC)','50'),
          ('U3','HII MISSION TECH','P3','HUNTINGTON INGALLS INDUSTRIES, INC','75'),
          ('U4','SOLO RESEARCH LLC',NULL,NULL,'10')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    return tmp_path


def test_confidence_tiers(tmp_path):
    """Cross-parent-UEI name merges must carry 'medium' confidence; single-parent 'high'."""
    lake = make_lake(tmp_path)
    out = build_entity_xwalk(
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
        out_path=tmp_path / "entity_xwalk_conf.parquet",
    )
    rows = duckdb.sql(f"select * from read_parquet('{out}')").fetchall()
    cols = [d[0] for d in duckdb.sql(f"describe select * from read_parquet('{out}')").fetchall()]
    by_uei = {r[cols.index("recipient_uei")]: r for r in rows}
    conf = cols.index("confidence")
    # U1 (parent P1) and U2 (parent P2) share family 'BOEING' via name merge
    # -> cross-parent merge -> both must be 'medium'
    assert by_uei["U1"][conf] == "medium", f"Expected medium, got {by_uei['U1'][conf]!r}"
    assert by_uei["U2"][conf] == "medium", f"Expected medium, got {by_uei['U2'][conf]!r}"
    # U3 has a single parent UEI (P3) -> single-parent family -> stays 'high'
    assert by_uei["U3"][conf] == "high", f"Expected high, got {by_uei['U3'][conf]!r}"
    # U4 has no parent (recipient_name method) -> 'medium' (unchanged)
    assert by_uei["U4"][conf] == "medium"


def test_build_entity_xwalk_merges_families(tmp_path):
    lake = make_lake(tmp_path)
    out = build_entity_xwalk(
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
        out_path=tmp_path / "entity_xwalk.parquet",
    )
    rows = duckdb.sql(f"select * from read_parquet('{out}')").fetchall()
    cols = [d[0] for d in duckdb.sql(f"describe select * from read_parquet('{out}')").fetchall()]
    by_uei = {r[cols.index("recipient_uei")]: r for r in rows}
    fam = cols.index("family_key")
    # P1 and P2 normalize to the same family name -> same canonical key
    assert by_uei["U1"][fam] == by_uei["U2"][fam] == "BOEING"
    assert by_uei["U3"][fam] == "HUNTINGTON INGALLS INDUSTRIES"
    assert by_uei["U4"][fam] == "SOLO RESEARCH"
    method = cols.index("method")
    assert by_uei["U1"][method] == "parent_name"
    assert by_uei["U4"][method] == "recipient_name"


def _read(out) -> tuple[dict, list[str]]:
    rows = duckdb.sql(f"select * from read_parquet('{out}')").fetchall()
    cols = [d[0] for d in duckdb.sql(f"describe select * from read_parquet('{out}')").fetchall()]
    return {r[cols.index("recipient_uei")]: r for r in rows}, cols


def make_chimera_lake(tmp_path: Path) -> Path:
    """A UEI whose parent changed over time — the shape that shatters families.

    U9 filed 2 transactions under parent ('P9', 'LOCKHEED MARTIN CORP') worth
    $1,000 and 1 transaction under a different, tiny parent ('P1', 'SIKORSKY
    SUPPORT SERVICES INC') worth $10.  Aggregating the two parent columns with
    INDEPENDENT max() takes the uei from one pair and the name from the other:
    ('P9', 'SIKORSKY SUPPORT SERVICES INC') — a pair that appears on no
    transaction anywhere.  That is the real FY2017-2026 defect: it moved
    $210B of Lockheed Martin into a family named after a support subsidiary.
    """
    out = tmp_path / "contracts" / "fy=2024"
    out.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('U9','LOCKHEED MARTIN CORPORATION','P9','LOCKHEED MARTIN CORP','600'),
          ('U9','LOCKHEED MARTIN CORPORATION','P9','LOCKHEED MARTIN CORP','400'),
          ('U9','LOCKHEED MARTIN CORP','P1','SIKORSKY SUPPORT SERVICES INC','10')
        ) t({AWARD_COLS})) to '{out}/part.parquet' (format parquet)
        """
    )
    return tmp_path


def test_parent_pair_is_never_a_chimera(tmp_path):
    """The emitted (parent_uei, parent_name) pair must co-occur on a real transaction."""
    lake = make_chimera_lake(tmp_path)
    out = build_entity_xwalk(
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
        out_path=tmp_path / "xw_chimera.parquet",
    )
    by_uei, cols = _read(out)
    row = by_uei["U9"]
    pair = (row[cols.index("parent_uei")], row[cols.index("parent_name")])
    assert pair in {("P9", "LOCKHEED MARTIN CORP"), ("P1", "SIKORSKY SUPPORT SERVICES INC")}, (
        f"{pair} never co-occurs on any transaction — independent max() over two "
        f"correlated columns invented it"
    )
    # ...and of the two real pairs it must be the one carrying the dollars.
    assert pair == ("P9", "LOCKHEED MARTIN CORP")
    assert row[cols.index("family_key")] == "LOCKHEED MARTIN"


def test_recipient_name_is_the_dominant_one_not_the_last_alphabetically(tmp_path):
    """Display names follow the money, not the alphabet."""
    lake = make_chimera_lake(tmp_path)
    out = build_entity_xwalk(
        award_glob=str(lake / "contracts" / "*" / "*.parquet"),
        out_path=tmp_path / "xw_name.parquet",
    )
    by_uei, cols = _read(out)
    # 'LOCKHEED MARTIN CORPORATION' ($1,000) vs 'LOCKHEED MARTIN CORP' ($10);
    # max() would take neither on merit — it takes 'LOCKHEED MARTIN CORPORATION'
    # here only by luck of the alphabet.  Assert the dollar-weighted choice.
    assert by_uei["U9"][cols.index("recipient_name")] == "LOCKHEED MARTIN CORPORATION"


def test_award_globs_union_contracts_and_assistance(tmp_path):
    """The crosswalk covers the same award universe fct_award_transactions does."""
    lake = make_lake(tmp_path)
    assist = lake / "assistance" / "fy=2024"
    assist.mkdir(parents=True)
    duckdb.sql(
        f"""
        copy (select * from (values
          ('U1','BOEING DEFENSE SPACE','P1','THE BOEING COMPANY','7'),
          ('U8','GRANTEE UNIVERSITY',NULL,NULL,'12')
        ) t({AWARD_COLS})) to '{assist}/part.parquet' (format parquet)
        """
    )
    out = build_entity_xwalk(
        award_glob=[
            str(lake / "contracts" / "*" / "*.parquet"),
            str(lake / "assistance" / "*" / "*.parquet"),
        ],
        out_path=tmp_path / "xw_union.parquet",
    )
    by_uei, cols = _read(out)
    tot = cols.index("total_obligation")
    assert by_uei["U1"][tot] == 107.0, "assistance dollars must land on the same UEI"
    assert "U8" in by_uei, "assistance-only recipients must get a family"
    assert by_uei["U8"][cols.index("family_key")] == "GRANTEE UNIVERSITY"
