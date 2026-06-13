"""Tests for Phase 5B-3 Task 6b: GAO oversight overlays sidecar.

TDD scope:
  - _emit_gao_overlays_sidecar: high-risk join semantics (canonical agency
    codes; site orgs map to DOD), improper-exposure derived fact_id wiring,
    graceful degradation when high_risk.parquet is absent.
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb

from govbudget.export_site import (
    _emit_gao_overlays_sidecar,
    fact_id_derived,
)


def _write_parquet(path: Path, col_defs: str, rows: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(f"create table _t ({col_defs})")
        if rows:
            placeholders = ", ".join("?" for _ in rows[0])
            con.executemany(f"insert into _t values ({placeholders})", rows)
        path_str = str(path).replace("'", "''")
        con.execute(f"copy _t to '{path_str}' (format parquet, compression zstd)")
    finally:
        con.close()


# ---------------------------------------------------------------------------
# GAO overlays sidecar (Task 6b)
# ---------------------------------------------------------------------------


def _make_gao_fixture(tmp_path: Path) -> tuple[Path, object]:
    """DuckDB with dim_programs + fct_improper_exposure, plus high_risk.parquet."""
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE dim_programs (pe_bli varchar, org varchar,"
        " exhibit_family varchar, title varchar, project_count integer,"
        " fy2024_actual_millions double, fully_reconciled boolean)"
    )
    con.execute(
        "INSERT INTO dim_programs VALUES"
        " ('0601101E','DARPA','RDT&E','DARPA Research',1,100.0,true),"
        " ('0603286D8Z','OSD','RDT&E','OSD Thing',1,50.0,true)"
    )
    con.execute(
        "CREATE TABLE fct_improper_exposure (agency_code varchar,"
        " program_count bigint, derived_improper_amount_usd double,"
        " weighted_rate_pct double, latest_fiscal_year integer)"
    )
    con.execute(
        "INSERT INTO fct_improper_exposure VALUES"
        " ('DOD', 8, 1801214045.0, 0.6914, 2025),"
        " ('HHS', 3, 9e9, 5.0, 2025)"
    )
    con.close()

    _write_parquet(
        tmp_path / "parquet" / "oversight" / "high_risk.parquet",
        "area_title varchar, area_url varchar, agency_code varchar,"
        " mapped varchar, notes varchar, source_url varchar",
        [
            ("DOD Contract Management",
             "https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc1",
             "DOD", "true", "Defense contract management",
             "https://www.gao.gov/high-risk-list"),
            ("DOD Weapon Systems Acquisition",
             "https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc2",
             "DOD", "true", "MDAPs",
             "https://www.gao.gov/high-risk-list"),
            ("Medicare Program & Improper Payments",
             "https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc3",
             "HHS", "true", "CMS",
             "https://www.gao.gov/high-risk-list"),
        ],
    )

    ro = duckdb.connect(str(db_path), read_only=True)
    return db_path, ro


class TestEmitGaoOverlaysSidecar:
    def test_creates_overlay_json(self, tmp_path):
        db_path, con = _make_gao_fixture(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        try:
            _emit_gao_overlays_sidecar(
                json_dir=json_dir,
                duckdb_path=db_path,
                con=con,
                cited_fact_ids={
                    fact_id_derived("improper", "DOD", "derived_improper_amount_usd"),
                },
            )
        finally:
            con.close()
        obj = json.loads((json_dir / "gao_overlays.json").read_text())
        # Every site org maps to DOD
        assert obj["agency_code_by_org"] == {"DARPA": "DOD", "OSD": "DOD"}
        dod = obj["agencies"]["DOD"]
        titles = [a["area_title"] for a in dod["high_risk_areas"]]
        assert "DOD Contract Management" in titles
        assert "Medicare Program & Improper Payments" not in titles
        # Areas carry the report deep link
        assert dod["high_risk_areas"][0]["area_url"].startswith("https://files.gao.gov/")

    def test_improper_fact_id_wired_when_cited(self, tmp_path):
        db_path, con = _make_gao_fixture(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        fid = fact_id_derived("improper", "DOD", "derived_improper_amount_usd")
        try:
            _emit_gao_overlays_sidecar(
                json_dir=json_dir,
                duckdb_path=db_path,
                con=con,
                cited_fact_ids={fid},
            )
        finally:
            con.close()
        obj = json.loads((json_dir / "gao_overlays.json").read_text())
        imp = obj["agencies"]["DOD"]["improper"]
        assert imp["fact_id"] == fid
        assert imp["derived_improper_amount_usd"] == 1801214045.0
        assert imp["weighted_rate_pct"] == 0.6914
        assert imp["latest_fiscal_year"] == 2025
        assert imp["program_count"] == 8

    def test_improper_fact_id_null_when_uncited(self, tmp_path):
        db_path, con = _make_gao_fixture(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        try:
            _emit_gao_overlays_sidecar(
                json_dir=json_dir,
                duckdb_path=db_path,
                con=con,
                cited_fact_ids=set(),
            )
        finally:
            con.close()
        obj = json.loads((json_dir / "gao_overlays.json").read_text())
        assert obj["agencies"]["DOD"]["improper"]["fact_id"] is None

    def test_missing_high_risk_parquet_still_emits_improper(self, tmp_path):
        db_path, con = _make_gao_fixture(tmp_path)
        # Remove the high-risk parquet — improper figures must still flow
        (tmp_path / "parquet" / "oversight" / "high_risk.parquet").unlink()
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        try:
            _emit_gao_overlays_sidecar(
                json_dir=json_dir,
                duckdb_path=db_path,
                con=con,
                cited_fact_ids=set(),
            )
        finally:
            con.close()
        obj = json.loads((json_dir / "gao_overlays.json").read_text())
        assert obj["agencies"]["DOD"]["high_risk_areas"] == []
        assert obj["agencies"]["DOD"]["improper"]["derived_improper_amount_usd"] == 1801214045.0
