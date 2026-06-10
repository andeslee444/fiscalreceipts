from pathlib import Path

import duckdb

from govbudget.verify_phase2 import entity_gate, geography_gate, golden_gate


def make_marts(tmp_path: Path) -> Path:
    db = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        """
        create table entity_xwalk as select * from (values
          ('U1','BOEING DEFENSE','P1','THE BOEING COMPANY','BOEING','parent_name','high',100.0),
          ('U2','BOEING AERO','P2','BOEING COMPANY, THE (INC)','BOEING','parent_name','high',50.0),
          ('U3','HII MISSION','P3','HUNTINGTON INGALLS INDUSTRIES, INC','HUNTINGTON INGALLS INDUSTRIES','parent_name','high',75.0),
          ('U4','MYSTERY','','','U4','self_uei','medium',10.0)
        ) t(recipient_uei, recipient_name, parent_uei, parent_name, family_key, method, confidence, total_obligation)
        """
    )
    con.execute(
        """
        create table fct_award_transactions as select * from (values
          ('K1','contract','CA','CA-52', 10.0),
          ('K2','contract','MD','MD-04', 20.0),
          ('K3','contract', null, null, 5.0)
        ) t(transaction_key, award_type, pop_state, pop_district, obligation)
        """
    )
    con.close()
    return db


def test_entity_gate(tmp_path):
    g = entity_gate(make_marts(tmp_path), top_n=4)
    assert g["resolved_pct"] == 75.0  # 3 of 4 via parent evidence
    assert g["top_n"] == 4


def test_golden_gate(tmp_path):
    g = golden_gate(make_marts(tmp_path))
    assert g["boeing_ueis"] == 2 and g["boeing_one_family"] is True
    assert g["hii_one_family"] is True


def test_geography_gate(tmp_path):
    g = geography_gate(make_marts(tmp_path))
    assert g["with_state"] == 2
    assert g["resolved_pct"] == 100.0  # both state-bearing rows have districts
