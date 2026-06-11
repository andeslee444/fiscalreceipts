"""TDD tests for verify_phase4 gates.

Each gate is tested in isolation with minimal fixture data.
"""
import json
from pathlib import Path

import duckdb
import pytest

from govbudget.verify_phase4 import (
    comparable_gate4,
    provenance_gate4,
    reconcile_gate4,
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


def make_ca_budget(path: Path, n_depts: int = 5, rows_per_dept: int = 3) -> None:
    """Write a minimal ca_budget.parquet with n_depts departments, rows_per_dept lines each."""
    rows = []
    for d in range(n_depts):
        for r in range(rows_per_dept):
            amt = float((d + 1) * 100 + r * 10)
            rows.append(
                f"('Dept{d}','Agency{d}','Category{r}','General Fund',"
                f"'2025','{amt}','False',"
                f"'https://open.fiscal.ca.gov/dept')"
            )
    write_parquet(
        path,
        ",".join(rows),
        "department, agency, category, fund, fiscal_year, amount_usd, is_total, source_url",
    )


def make_ca_checkbook(path: Path, n_depts: int = 5, rows_per_dept: int = 3) -> None:
    """Write ca_checkbook_agg.parquet matching the ca_budget fixture totals exactly."""
    # Each dept total = sum of (d+1)*100 + r*10 for r in 0..rows_per_dept-1
    rows = []
    for d in range(n_depts):
        for r in range(rows_per_dept):
            amt = float((d + 1) * 100 + r * 10)
            rows.append(
                f"('CA','Dept{d}','Category{r}','2025','{amt}',"
                f"'https://open.fiscal.ca.gov/dept')"
            )
    write_parquet(
        path,
        ",".join(rows),
        "jurisdiction, department, category, fiscal_year, amount_usd, source_url",
    )


def make_ct_checkbook(path: Path) -> None:
    rows = [
        "('CT','CtDept1','Travel','2025','5000.00','https://data.ct.gov/q')",
        "('CT','CtDept1','Salaries','2025','100000.00','https://data.ct.gov/q')",
    ]
    write_parquet(
        path,
        ",".join(rows),
        "jurisdiction, department, category, fiscal_year, amount_usd, source_url",
    )


def make_population(path: Path) -> None:
    rows = [
        "('CA','2024','39000000','https://census.gov/pop')",
        "('CT','2024','3600000','https://census.gov/pop')",
    ]
    write_parquet(
        path,
        ",".join(rows),
        "state, year, population, source_url",
    )


def make_manifest(manifest_path: Path, acfr_file: str, sha: str) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "dataset": "state_acfr_ca",
        "fiscal_year": 2023,
        "file_name": acfr_file,
        "source_url": "https://www.sco.ca.gov/Files-ARD/ACFR/acfr23web.pdf",
        "sha256": sha,
        "bytes": 1000,
        "downloaded_at": "2026-06-01T00:00:00+00:00",
    }
    with open(manifest_path, "w") as f:
        f.write(json.dumps(rec) + "\n")


def make_duckdb_with_per_capita(
    db_path: Path,
    *,
    include_valid: bool = True,
    ca_per_cap: float = 50.0,
    ct_per_cap: float = 40.0,
    spend_url: str = "https://open.fiscal.ca.gov/dept",
    pop_url: str = "https://census.gov/pop",
) -> None:
    """Build a minimal DuckDB with fct_state_per_capita populated."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    rows = []
    if include_valid:
        # One valid pair: category='travel', fy='2025', both CA and CT
        rows = [
            f"('CA','travel','2025',100000.0,2000000,{ca_per_cap},2024,'{spend_url}','{pop_url}')",
            f"('CT','travel','2025',50000.0,1250000,{ct_per_cap},2024,'{spend_url}','{pop_url}')",
        ]
    if rows:
        con.execute(
            "create table fct_state_per_capita as select * from (values "
            + ",".join(rows)
            + ") t(jurisdiction, comparable_category, fiscal_year, total_amount_usd,"
            "  population, amount_per_capita, pop_year_used, spend_source_url, pop_source_url)"
        )
    else:
        con.execute(
            "create table fct_state_per_capita ("
            "  jurisdiction varchar, comparable_category varchar, fiscal_year varchar,"
            "  total_amount_usd double, population bigint, amount_per_capita double,"
            "  pop_year_used integer, spend_source_url varchar, pop_source_url varchar"
            ")"
        )
    con.close()


# ---------------------------------------------------------------------------
# Gate 1: provenance_gate4
# ---------------------------------------------------------------------------


class TestProvenanceGate4:
    def test_pass(self, tmp_path):
        ca_b = tmp_path / "ca_budget.parquet"
        ca_c = tmp_path / "ca_checkbook_agg.parquet"
        ct_c = tmp_path / "ct_checkbook_agg.parquet"
        pop = tmp_path / "population.parquet"
        manifest = tmp_path / "manifest.jsonl"
        raw_docs = tmp_path / "raw_docs"

        make_ca_budget(ca_b)
        make_ca_checkbook(ca_c)
        make_ct_checkbook(ct_c)
        make_population(pop)

        acfr_file = "ca_acfr_fy2023.pdf"
        acfr_path = raw_docs / "state" / "ca" / acfr_file
        acfr_path.parent.mkdir(parents=True, exist_ok=True)
        acfr_path.write_bytes(b"fake pdf content")
        make_manifest(manifest, acfr_file, "abc123sha")

        result = provenance_gate4(ca_b, ca_c, ct_c, pop, manifest, raw_docs)
        assert result["ok"] is True
        assert result["files"]["acfr"]["on_disk"] is True
        assert result["files"]["acfr"]["sha256"] == "abc123sha"

    def test_fail_missing_file(self, tmp_path):
        ca_b = tmp_path / "ca_budget.parquet"
        ca_c = tmp_path / "ca_checkbook_agg.parquet"
        ct_c = tmp_path / "ct_checkbook_agg.parquet"  # will be missing
        pop = tmp_path / "population.parquet"
        manifest = tmp_path / "manifest.jsonl"
        raw_docs = tmp_path / "raw_docs"

        make_ca_budget(ca_b)
        make_ca_checkbook(ca_c)
        make_population(pop)

        acfr_file = "ca_acfr_fy2023.pdf"
        acfr_path = raw_docs / "state" / "ca" / acfr_file
        acfr_path.parent.mkdir(parents=True, exist_ok=True)
        acfr_path.write_bytes(b"fake")
        make_manifest(manifest, acfr_file, "sha1")

        result = provenance_gate4(ca_b, ca_c, ct_c, pop, manifest, raw_docs)
        assert result["ok"] is False
        assert result["files"]["ct_checkbook"]["ok"] is False

    def test_fail_missing_acfr_on_disk(self, tmp_path):
        ca_b = tmp_path / "ca_budget.parquet"
        ca_c = tmp_path / "ca_checkbook_agg.parquet"
        ct_c = tmp_path / "ct_checkbook_agg.parquet"
        pop = tmp_path / "population.parquet"
        manifest = tmp_path / "manifest.jsonl"
        raw_docs = tmp_path / "raw_docs"

        make_ca_budget(ca_b)
        make_ca_checkbook(ca_c)
        make_ct_checkbook(ct_c)
        make_population(pop)
        # Write manifest but do NOT create the file on disk
        make_manifest(manifest, "ca_acfr_fy2023.pdf", "sha1")
        raw_docs.mkdir(parents=True, exist_ok=True)

        result = provenance_gate4(ca_b, ca_c, ct_c, pop, manifest, raw_docs)
        assert result["ok"] is False
        assert result["files"]["acfr"]["on_disk"] is False

    def test_fail_missing_source_url(self, tmp_path):
        ca_b = tmp_path / "ca_budget.parquet"
        # Write ca_budget with empty source_url
        duckdb.sql(
            f"copy (select * from (values ('D','A','C','F','2025','100.0','False',''))"
            f" t(department, agency, category, fund, fiscal_year, amount_usd, is_total, source_url))"
            f" to '{ca_b}' (format parquet)"
        )
        ca_c = tmp_path / "ca_checkbook_agg.parquet"
        ct_c = tmp_path / "ct_checkbook_agg.parquet"
        pop = tmp_path / "population.parquet"
        manifest = tmp_path / "manifest.jsonl"
        raw_docs = tmp_path / "raw_docs"

        make_ca_checkbook(ca_c)
        make_ct_checkbook(ct_c)
        make_population(pop)
        acfr_file = "ca_acfr_fy2023.pdf"
        acfr_path = raw_docs / "state" / "ca" / acfr_file
        acfr_path.parent.mkdir(parents=True, exist_ok=True)
        acfr_path.write_bytes(b"fake")
        make_manifest(manifest, acfr_file, "sha1")

        result = provenance_gate4(ca_b, ca_c, ct_c, pop, manifest, raw_docs)
        assert result["ok"] is False
        assert result["files"]["ca_budget"]["rows_with_url"] == 0


# ---------------------------------------------------------------------------
# Gate 2: reconcile_gate4
# ---------------------------------------------------------------------------


class TestReconcileGate4:
    def test_pass_exact_match(self, tmp_path):
        ca_b = tmp_path / "ca_budget.parquet"
        ca_c = tmp_path / "ca_checkbook_agg.parquet"
        make_ca_budget(ca_b, n_depts=10)
        make_ca_checkbook(ca_c, n_depts=10)
        result = reconcile_gate4(ca_b, ca_c)
        assert result["ok"] is True
        assert result["pass_pct"] == 100.0
        assert result["failing_count"] == 0

    def test_fail_large_discrepancy(self, tmp_path):
        """Write checkbook with doubled amounts → >0.5% diff → fails gate."""
        ca_b = tmp_path / "ca_budget.parquet"
        ca_c = tmp_path / "ca_checkbook_agg.parquet"
        make_ca_budget(ca_b, n_depts=10)

        # Write checkbook with 2× amounts
        rows = []
        for d in range(10):
            for r in range(3):
                amt = float((d + 1) * 200 + r * 20)  # double budget amounts
                rows.append(
                    f"('CA','Dept{d}','Category{r}','2025','{amt}',"
                    f"'https://open.fiscal.ca.gov/dept')"
                )
        write_parquet(
            ca_c,
            ",".join(rows),
            "jurisdiction, department, category, fiscal_year, amount_usd, source_url",
        )
        result = reconcile_gate4(ca_b, ca_c)
        assert result["ok"] is False
        assert result["failing_count"] > 0

    def test_pass_pct_threshold(self, tmp_path):
        """95 depts match, 5 depts are off by 1% → pass_pct = 95% → barely passes."""
        ca_b = tmp_path / "ca_budget.parquet"
        ca_c = tmp_path / "ca_checkbook_agg.parquet"

        n_depts = 100
        # Budget: each dept has 1 row with amount 10000
        b_rows = []
        for d in range(n_depts):
            b_rows.append(
                f"('Dept{d}','A','C','F','2025','10000.0','False','https://src')"
            )
        write_parquet(
            ca_b, ",".join(b_rows),
            "department, agency, category, fund, fiscal_year, amount_usd, is_total, source_url",
        )

        # Checkbook: first 95 match exactly, last 5 are off by 1% (1% > 0.5% threshold)
        c_rows = []
        for d in range(95):
            c_rows.append(
                f"('CA','Dept{d}','C','2025','10000.0','https://src')"
            )
        for d in range(95, 100):
            c_rows.append(
                f"('CA','Dept{d}','C','2025','10100.0','https://src')"  # +1% off
            )
        write_parquet(
            ca_c, ",".join(c_rows),
            "jurisdiction, department, category, fiscal_year, amount_usd, source_url",
        )
        result = reconcile_gate4(ca_b, ca_c)
        assert result["ok"] is True  # 95% pass threshold
        assert result["pass_pct"] == 95.0
        assert result["failing_count"] == 5


# ---------------------------------------------------------------------------
# Gate 3: comparable_gate4
# ---------------------------------------------------------------------------


class TestComparableGate4:
    def test_pass_with_valid_pair(self, tmp_path):
        db_path = tmp_path / "t.duckdb"
        make_duckdb_with_per_capita(db_path)
        result = comparable_gate4(db_path)
        assert result["ok"] is True
        assert result["comparable_pairs_found"] >= 1
        pair = result["comparable_pairs"][0]
        assert pair["ca_per_capita"] > 0
        assert pair["ct_per_capita"] > 0
        assert pair["ca_spend_url"]
        assert pair["ct_spend_url"]

    def test_fail_empty_mart(self, tmp_path):
        db_path = tmp_path / "t.duckdb"
        make_duckdb_with_per_capita(db_path, include_valid=False)
        result = comparable_gate4(db_path)
        assert result["ok"] is False

    def test_fail_zero_per_capita(self, tmp_path):
        db_path = tmp_path / "t.duckdb"
        make_duckdb_with_per_capita(db_path, ca_per_cap=0.0, ct_per_cap=5.0)
        result = comparable_gate4(db_path)
        # ca_per_capita = 0 → not positive → no valid pair
        assert result["ok"] is False

    def test_pair_reports_category_and_year(self, tmp_path):
        db_path = tmp_path / "t.duckdb"
        make_duckdb_with_per_capita(db_path)
        result = comparable_gate4(db_path)
        assert result["ok"] is True
        pair = result["comparable_pairs"][0]
        assert "category" in pair
        assert "fiscal_year" in pair
        assert pair["category"] == "travel"
        assert pair["fiscal_year"] == "2025"
