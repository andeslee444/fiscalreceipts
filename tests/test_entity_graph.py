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
