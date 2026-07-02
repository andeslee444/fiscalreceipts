"""TDD tests for verify_phase3 gates.

Each gate is tested in isolation with minimal fixture data.
"""
from pathlib import Path

import duckdb
import pytest

from govbudget.verify_phase3 import (
    ingest_gate,
    linkage_gate,
    marts_gate,
    trace_gate3,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def write_parquet(path: Path, sql: str, cols: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    duckdb.sql(
        f"copy (select * from (values {sql}) t({cols}))"
        f" to '{path}' (format parquet)"
    )


def make_oversight_fixtures(
    tmp_path: Path,
    *,
    n_programs: int = 55,
    n_areas: int = 35,
    mapped_count: int = 30,
) -> tuple[Path, Path]:
    """Write minimal improper_payments and high_risk parquet fixtures.

    Mirrors the typed ingestion schema (backlog #11): fiscal_year INTEGER,
    rate/amount columns DOUBLE, mapped BOOLEAN.
    """
    ip_path = tmp_path / "improper_payments.parquet"
    hr_path = tmp_path / "high_risk.parquet"

    # Build n_programs unique programs, each with ≥1 FY row
    ip_rows = []
    for i in range(n_programs):
        ip_rows.append(
            f"('Program{i}','Agency{i % 5}','ag{i % 5}',2023,"
            f"5.0,1000000.0,0.0,20000000.0,'https://paymentaccuracy.gov/program/p{i}')"
        )
    ip_sql = ",".join(ip_rows)
    write_parquet(
        ip_path, ip_sql,
        "program, agency_name, agency_code, fiscal_year, rate_pct, derived_improper_amount_usd, unknown_rate_pct, outlays_usd, source_url",
    )

    # Build n_areas high-risk areas; mapped_count have agency_code, rest don't
    hr_rows = []
    for i in range(n_areas):
        if i < mapped_count:
            code = f"AGENCY{i % 5}"
            mapped = "true"
        else:
            code = ""
            mapped = "false"
        hr_rows.append(
            f"('Area{i}','https://gao.gov/area{i}','{code}',{mapped},"
            f"'notes','https://www.gao.gov/high-risk-list')"
        )
    hr_sql = ",".join(hr_rows)
    write_parquet(
        hr_path, hr_sql,
        "area_title, area_url, agency_code, mapped, notes, source_url",
    )

    return ip_path, hr_path


def make_duckdb_with_marts(tmp_path: Path) -> Path:
    """Build a minimal DuckDB with the four efficiency marts populated."""
    db_path = tmp_path / "t.duckdb"
    con = duckdb.connect(str(db_path))

    # fct_budget_trajectory: ≥300 rows required
    rows = [
        f"('PE{i:04d}','ORG{i % 10}',{i * 100.0},{i * 110.0},{i * 120.0},"
        f"{i * 10.0},{9.09})"
        for i in range(1, 401)
    ]
    con.execute(
        "create table fct_budget_trajectory as select * from (values "
        + ",".join(rows)
        + ") t(pe_bli, organization, fy2024_actuals, fy2025_total, fy2026_total,"
        "  fy2526_change, fy2526_pct_change)"
    )

    # fct_program_concentration: valid HHI rows
    con.execute(
        """
        create table fct_program_concentration as select * from (values
          ('0601101E', 2500.0, 'ACME CORP', 3, 1000000.0),
          ('0601102E', 5000.0, 'MEGA CORP', 2, 2000000.0),
          ('0601103E', 10000.0,'SOLO CORP', 1, 500000.0)
        ) t(pe_bli, hhi, top_family, family_count, program_dollars)
        """
    )

    # fct_agency_concentration: ≥10 sub-agencies required
    agency_rows = [
        f"('Agency{i}', {1000.0 + i * 100}, {i * 50000.0}, {3 + i})"
        for i in range(1, 15)
    ]
    con.execute(
        "create table fct_agency_concentration as select * from (values "
        + ",".join(agency_rows)
        + ") t(awarding_sub_agency_name, hhi, total_obligation, family_count)"
    )

    # fct_improper_exposure: ≥10 agencies required
    exposure_rows = [
        f"('ag{i}', {2 + i}, {i * 1e9}, {5.0 + i * 0.5}, 2023)"
        for i in range(1, 15)
    ]
    con.execute(
        "create table fct_improper_exposure as select * from (values "
        + ",".join(exposure_rows)
        + ") t(agency_code, program_count, derived_improper_amount_usd, weighted_rate_pct, latest_fiscal_year)"
    )

    # dim_programs: some DoD programs
    con.execute(
        """
        create table dim_programs as select * from (values
          ('0601101E', 'DARPA', 'rdte', 3, 280.0, true, 'Defense Research'),
          ('0601102E', 'DARPA', 'rdte', 2, 140.0, true, 'Applied Research'),
          ('0601103E', 'ARMY', 'rdte', 5, 500.0, true, 'Army Research')
        ) t(pe_bli, org, exhibit_family, project_count, fy2024_actual_millions,
            fully_reconciled, title)
        """
    )

    con.close()
    return db_path


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

class TestIngestGate:
    def test_pass(self, tmp_path):
        ip_path, hr_path = make_oversight_fixtures(tmp_path)
        result = ingest_gate(ip_path, hr_path)
        assert result["ok"] is True
        assert result["program_count"] >= 50
        assert result["area_count"] >= 30

    def test_fail_too_few_programs(self, tmp_path):
        ip_path, hr_path = make_oversight_fixtures(tmp_path, n_programs=40)
        result = ingest_gate(ip_path, hr_path)
        assert result["ok"] is False

    def test_fail_too_few_areas(self, tmp_path):
        ip_path, hr_path = make_oversight_fixtures(tmp_path, n_areas=25)
        result = ingest_gate(ip_path, hr_path)
        assert result["ok"] is False


class TestLinkageGate:
    def test_pass(self, tmp_path):
        _, hr_path = make_oversight_fixtures(
            tmp_path, n_areas=35, mapped_count=30
        )  # 30/35 ≈ 85.7% > 80%
        result = linkage_gate(hr_path)
        assert result["ok"] is True
        assert result["mapped_pct"] >= 80.0
        assert "unmapped_count" in result

    def test_fail_low_mapped(self, tmp_path):
        _, hr_path = make_oversight_fixtures(
            tmp_path, n_areas=35, mapped_count=20
        )  # 20/35 ≈ 57.1% < 80%
        result = linkage_gate(hr_path)
        assert result["ok"] is False
        assert result["unmapped_count"] == 15


class TestMartsGate:
    def test_pass(self, tmp_path):
        db_path = make_duckdb_with_marts(tmp_path)
        result = marts_gate(db_path)
        assert result["ok"] is True, result

    def test_fail_empty_trajectory(self, tmp_path):
        db_path = tmp_path / "t.duckdb"
        con = duckdb.connect(str(db_path))
        con.execute("create table fct_budget_trajectory (pe_bli varchar)")
        con.execute(
            """
            create table fct_program_concentration as select * from (values
              ('0601101E', 2500.0, 'ACME', 1, 1e6)
            ) t(pe_bli, hhi, top_family, family_count, program_dollars)
            """
        )
        con.execute(
            "create table fct_agency_concentration (awarding_sub_agency_name varchar,"
            " hhi double, total_obligation double, family_count integer)"
        )
        con.execute(
            "create table fct_improper_exposure (agency_code varchar,"
            " program_count integer, derived_improper_amount_usd double,"
            " weighted_rate_pct double, latest_fiscal_year integer)"
        )
        con.close()
        result = marts_gate(db_path)
        assert result["ok"] is False

    def test_fail_invalid_hhi(self, tmp_path):
        """HHI > 10000 should fail."""
        db_path = tmp_path / "t.duckdb"
        con = duckdb.connect(str(db_path))
        # Minimal trajectory rows
        rows = [f"('PE{i}','ORG',{i},{i},{i},{0},{0})" for i in range(1, 310)]
        con.execute(
            "create table fct_budget_trajectory as select * from (values "
            + ",".join(rows)
            + ") t(pe_bli,organization,fy2024_actuals,fy2025_total,fy2026_total,"
            "fy2526_change,fy2526_pct_change)"
        )
        con.execute(
            """
            create table fct_program_concentration as select * from (values
              ('0601101E', 99999.0, 'ACME', 1, 1e6)
            ) t(pe_bli, hhi, top_family, family_count, program_dollars)
            """
        )
        con.execute(
            "create table fct_agency_concentration (awarding_sub_agency_name varchar,"
            " hhi double, total_obligation double, family_count integer)"
        )
        con.execute(
            "create table fct_improper_exposure (agency_code varchar,"
            " program_count integer, derived_improper_amount_usd double,"
            " weighted_rate_pct double, latest_fiscal_year integer)"
        )
        con.close()
        result = marts_gate(db_path)
        assert result["ok"] is False


class TestTraceGate3:
    def test_pass(self, tmp_path):
        """Two DoD high-risk areas with DoD programs present → PASS."""
        db_path = make_duckdb_with_marts(tmp_path)
        _, hr_path = make_oversight_fixtures(tmp_path)

        # Add DOD-mapped areas to the fixture (mapped is BOOLEAN)
        hr_path.unlink(missing_ok=True)
        write_parquet(
            hr_path,
            "('DOD Weapon Systems','https://gao.gov/area1','DOD',true,'dod notes','https://www.gao.gov/high-risk-list'),"
            "('DOD Financial Mgmt','https://gao.gov/area2','DOD',true,'dod notes','https://www.gao.gov/high-risk-list'),"
            "('Other HHS','https://gao.gov/area3','HHS',true,'hhs notes','https://www.gao.gov/high-risk-list')",
            "area_title, area_url, agency_code, mapped, notes, source_url",
        )
        result = trace_gate3(db_path, hr_path)
        assert result["ok"] is True, result
        assert result["dod_areas_traced"] == 2

    def test_fail_no_programs(self, tmp_path):
        """DB has dim_programs empty → should fail trace."""
        db_path = tmp_path / "t.duckdb"
        con = duckdb.connect(str(db_path))
        con.execute(
            "create table dim_programs (pe_bli varchar, org varchar,"
            " exhibit_family varchar, project_count integer,"
            " fy2024_actual_millions double, fully_reconciled boolean, title varchar)"
        )
        con.execute(
            "create table fct_program_concentration "
            "(pe_bli varchar, hhi double, top_family varchar, family_count integer, program_dollars double)"
        )
        con.close()
        hr_path = tmp_path / "hr.parquet"
        write_parquet(
            hr_path,
            "('DOD Weapon Systems','https://gao.gov/area1','DOD',true,'dod notes','https://www.gao.gov/high-risk-list')",
            "area_title, area_url, agency_code, mapped, notes, source_url",
        )
        result = trace_gate3(db_path, hr_path)
        assert result["ok"] is False
