"""TDD tests for Phase 4 coverage gate and CA no-size-cap ingestion.

Tests (no live network calls):
  1. coverage_gate4 unit tests with synthetic pointer totals.
  2. CA list_department_files with max_mb=None (no cap).
  3. CA acquire_ca_checkbook reports departments_failed count.
  4. CT category-map exhaustiveness: every live CT grant/consulting line
     value appears in the seed for its bucket (fixture the distinct-category list).
"""
from __future__ import annotations

import csv
import io
import tempfile
from pathlib import Path

import duckdb
import httpx
import pytest

# ---------------------------------------------------------------------------
# Fixture: distinct CT categories (sampled from the exhaustive live list)
# ---------------------------------------------------------------------------

# These are the CT categories that MUST appear in the state_category_map seed.
# Granularity-matched: for grants_and_subventions, ALL major grant lines;
# for consulting_professional, ALL consulting/professional service lines.
CT_GRANT_CATEGORIES = [
    "State Aid Grants",
    "Trnsfr Grant Expend-St Agency",
    "Pass thru Grant Non-State",
    "GT Transfer-Grant-St Agencies",
    "Student Grant & Aid-Undergrad",
    "State Aid Grants-State Agency",
]

CT_CONSULTING_CATEGORIES = [
    "Management Consultant Services",
    "IT Consultant Services",
    "IT Consultant Services Hourly",
    "IT Consultant Services Fixed F",
    "Environmental Consulting Servi",
    "Insurance Consultant Services",
]

CT_TRAVEL_CATEGORIES = [
    "In-State Travel",
    "Out-Of-State Travel",
]

CT_DEBT_SERVICE_CATEGORIES = [
    "Debt Service Paid",
    "Debt Sevice Paid",  # typo variant that actually exists in the data
]

SEED_PATH = (
    Path(__file__).resolve().parents[2]
    / "dbt" / "seeds" / "state_category_map.csv"
)


def _load_seed_ct_categories(comparable_category: str) -> set[str]:
    """Load CT raw_category values mapped to a given comparable_category from the seed."""
    mapped = set()
    with open(SEED_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["jurisdiction"] == "CT" and row["comparable_category"] == comparable_category:
                mapped.add(row["raw_category"])
    return mapped


# ---------------------------------------------------------------------------
# CT category-map exhaustiveness tests
# ---------------------------------------------------------------------------


class TestCTCategoryMapExhaustiveness:
    """Every major CT category value for each bucket must appear in the seed."""

    def test_grants_and_subventions_exhaustive(self):
        mapped = _load_seed_ct_categories("grants_and_subventions")
        missing = [c for c in CT_GRANT_CATEGORIES if c not in mapped]
        assert not missing, (
            f"CT grants_and_subventions bucket missing categories: {missing}\n"
            f"Mapped: {sorted(mapped)}"
        )

    def test_consulting_professional_exhaustive(self):
        mapped = _load_seed_ct_categories("consulting_professional")
        missing = [c for c in CT_CONSULTING_CATEGORIES if c not in mapped]
        assert not missing, (
            f"CT consulting_professional bucket missing categories: {missing}\n"
            f"Mapped: {sorted(mapped)}"
        )

    def test_travel_exhaustive(self):
        mapped = _load_seed_ct_categories("travel")
        missing = [c for c in CT_TRAVEL_CATEGORIES if c not in mapped]
        assert not missing, (
            f"CT travel bucket missing categories: {missing}\n"
            f"Mapped: {sorted(mapped)}"
        )

    def test_debt_service_exhaustive(self):
        mapped = _load_seed_ct_categories("debt_service")
        # debt_service is CA-only (excluded from comparable); CT side should be absent
        # or if included, both variants must be mapped
        # We'll just check both typo variants are present if debt_service is mapped at all
        ct_debt_mapped = _load_seed_ct_categories("debt_service")
        # If the seed maps any CT debt_service, both variants must be there
        if ct_debt_mapped:
            missing = [c for c in CT_DEBT_SERVICE_CATEGORIES if c not in ct_debt_mapped]
            assert not missing, (
                f"CT debt_service has some entries but missing typo variant: {missing}"
            )

    def test_no_orphan_ct_rows(self):
        """All seed CT rows must have a valid comparable_category."""
        with open(SEED_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["jurisdiction"] == "CT":
                    assert row["comparable_category"], (
                        f"CT row with empty comparable_category: {row}"
                    )


# ---------------------------------------------------------------------------
# CA list_department_files: max_mb=None means no size cap
# ---------------------------------------------------------------------------


def _pointer_csv_with_sizes() -> str:
    """Pointer CSV with small, medium, and large files."""
    return (
        'FileName,UploadDate,FileSize,Download\n'
        '"Spending_001_SmallDept_FY25.csv","2026-04-05","2 MB",'
        '"https://example.com/Spending_001_FY25.csv"\n'
        '"Spending_002_MedDept_FY25.csv","2026-04-05","50 MB",'
        '"https://example.com/Spending_002_FY25.csv"\n'
        '"Spending_003_BigDept_FY25.csv","2026-04-05","300 MB",'
        '"https://example.com/Spending_003_FY25.csv"\n'
        '"Spending_004_HugeDept_FY25.csv","2026-04-05","999 MB",'
        '"https://example.com/Spending_004_FY25.csv"\n'
        '"Spending_001_SmallDept_FY24.csv","2026-04-05","2 MB",'
        '"https://example.com/Spending_001_FY24.csv"\n'
    )


class TestListDepartmentFilesNoCap:
    def test_max_mb_none_returns_all_fy25_files(self):
        """When max_mb=None, all FY25 files are returned regardless of size."""
        from govbudget.states.california import list_department_files

        def handler(req):
            return httpx.Response(200, text=_pointer_csv_with_sizes())

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            entries = list_department_files(client, fiscal_year="FY25", max_mb=None)

        fns = [e["file_name"] for e in entries]
        assert len(entries) == 4, f"Expected 4 FY25 files, got {len(entries)}: {fns}"
        assert all("FY25" in fn for fn in fns)

    def test_max_mb_5_still_filters(self):
        """Explicit max_mb=5.0 still filters large files (backward compat)."""
        from govbudget.states.california import list_department_files

        def handler(req):
            return httpx.Response(200, text=_pointer_csv_with_sizes())

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            entries = list_department_files(client, fiscal_year="FY25", max_mb=5.0)

        assert len(entries) == 1
        assert entries[0]["size_mb"] <= 5.0

    def test_max_mb_none_no_fy_filtering(self):
        """max_mb=None does not affect fiscal year filtering."""
        from govbudget.states.california import list_department_files

        def handler(req):
            return httpx.Response(200, text=_pointer_csv_with_sizes())

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            entries_fy24 = list_department_files(client, fiscal_year="FY24", max_mb=None)

        assert len(entries_fy24) == 1
        assert "FY24" in entries_fy24[0]["file_name"]


# ---------------------------------------------------------------------------
# CA acquire_ca_checkbook: departments_failed count in result
# ---------------------------------------------------------------------------


class TestAcquireCaCheckbookFailureReporting:
    """acquire_ca_checkbook must return departments_failed count and
    continue past per-file errors."""

    def test_reports_departments_failed(self, tmp_path):
        """If some files fail, acquire_ca_checkbook returns departments_failed > 0
        and still writes parquet from the files that succeeded."""
        from govbudget.states.california import acquire_ca_checkbook

        # Minimal spending CSV for the one good file
        good_csv = (
            "business_unit,agency_name,department_name,fiscal_year_begin,"
            "account_category_1,monetary_amount,fund_description_1\n"
            "8885,Agency1,GoodDept,2025,Travel,500.00,General Fund\n"
        )

        call_count = {"n": 0}

        def handler(req):
            url = str(req.url)
            if "Pointer" in url or "pointer" in url.lower():
                # pointer CSV: 2 FY25 files
                return httpx.Response(
                    200,
                    text=(
                        'FileName,UploadDate,FileSize,Download\n'
                        '"Spending_001_Good_FY25.csv","2026","1 MB",'
                        '"https://example.com/good_FY25.csv"\n'
                        '"Spending_002_Bad_FY25.csv","2026","1 MB",'
                        '"https://example.com/bad_FY25.csv"\n'
                    ),
                )
            call_count["n"] += 1
            if "good" in url:
                return httpx.Response(200, text=good_csv)
            # Simulate a server error for the bad file
            return httpx.Response(503, text="Service Unavailable")

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            budget_path, ck_path, raw_rows, depts_failed = acquire_ca_checkbook(
                client,
                parquet_dir=tmp_path,
                fiscal_year="FY25",
                max_mb=None,
            )

        # 1 file failed
        assert depts_failed == 1, f"Expected 1 failed dept, got {depts_failed}"
        # Still wrote parquet from the good file
        assert budget_path.exists()
        assert ck_path.exists()
        assert raw_rows > 0

    def test_zero_failures_when_all_succeed(self, tmp_path):
        """departments_failed = 0 when all files download successfully."""
        from govbudget.states.california import acquire_ca_checkbook

        good_csv = (
            "business_unit,agency_name,department_name,fiscal_year_begin,"
            "account_category_1,monetary_amount,fund_description_1\n"
            "8885,Agency1,GoodDept,2025,Travel,500.00,General Fund\n"
        )

        def handler(req):
            url = str(req.url)
            if "Pointer" in url or "pointer" in url.lower():
                return httpx.Response(
                    200,
                    text=(
                        'FileName,UploadDate,FileSize,Download\n'
                        '"Spending_001_Good_FY25.csv","2026","1 MB",'
                        '"https://example.com/good_FY25.csv"\n'
                    ),
                )
            return httpx.Response(200, text=good_csv)

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            budget_path, ck_path, raw_rows, depts_failed = acquire_ca_checkbook(
                client,
                parquet_dir=tmp_path,
                fiscal_year="FY25",
                max_mb=None,
            )

        assert depts_failed == 0
        assert raw_rows > 0


# ---------------------------------------------------------------------------
# Coverage gate unit tests
# ---------------------------------------------------------------------------


def _write_pointer_totals(path: Path, rows: list[tuple]) -> None:
    """Write a synthetic pointer totals parquet: (file_name, size_mb)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.executemany(
        f"insert into (values (?,?)) ... ",
        rows,
    )
    con.close()


def _make_ca_checkbook(path: Path, total_usd: float, dept_count: int = 10) -> None:
    """Write a minimal CA checkbook parquet with a known total."""
    path.parent.mkdir(parents=True, exist_ok=True)
    per_dept = total_usd / dept_count
    rows_sql = ",".join(
        f"('CA','Dept{i}','Travel','2025','{per_dept:.2f}','https://src')"
        for i in range(dept_count)
    )
    con = duckdb.connect()
    con.execute(
        f"copy (select * from (values {rows_sql})"
        f" t(jurisdiction, department, category, fiscal_year, amount_usd, source_url))"
        f" to '{path}' (format parquet)"
    )
    con.close()


class TestCoverageGate4:
    """coverage_gate4 unit tests with synthetic pointer totals."""

    def test_pass_when_coverage_above_80pct(self):
        """When captured total >= 80% of pointer total, gate passes."""
        from govbudget.verify_phase4 import coverage_gate4

        # Pointer: 10 files totalling 100B → 100B pointer implied total
        # Captured: 85B → 85% coverage → PASS
        pointer_entries = [{"file_name": f"Dept{i}_FY25.csv", "estimated_gb": 10.0} for i in range(10)]
        captured_total_usd = 85_000_000_000.0
        pointer_total_usd = 100_000_000_000.0

        result = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=captured_total_usd,
            pointer_total_usd=pointer_total_usd,
            departments_failed=0,
        )
        assert result["ok"] is True, f"Expected PASS: {result}"
        assert result["coverage_pct"] >= 80.0

    def test_fail_when_coverage_below_80pct(self):
        """When captured total < 80% of pointer total, gate fails."""
        from govbudget.verify_phase4 import coverage_gate4

        captured_total_usd = 30_000_000_000.0   # only 30%
        pointer_total_usd = 100_000_000_000.0

        result = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=captured_total_usd,
            pointer_total_usd=pointer_total_usd,
            departments_failed=0,
        )
        assert result["ok"] is False, f"Expected FAIL: {result}"
        assert result["coverage_pct"] < 80.0

    def test_exact_80pct_passes(self):
        """Exactly 80% coverage passes (boundary)."""
        from govbudget.verify_phase4 import coverage_gate4

        result = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=80_000_000_000.0,
            pointer_total_usd=100_000_000_000.0,
            departments_failed=0,
        )
        assert result["ok"] is True
        assert abs(result["coverage_pct"] - 80.0) < 0.01

    def test_reports_departments_failed(self):
        """coverage_gate4 reports departments_failed count in result."""
        from govbudget.verify_phase4 import coverage_gate4

        result = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=90_000_000_000.0,
            pointer_total_usd=100_000_000_000.0,
            departments_failed=5,
        )
        assert result["departments_failed"] == 5
        assert result["ok"] is True  # coverage still 90%

    def test_reports_coverage_note(self):
        """coverage_gate4 result includes a coverage_note string."""
        from govbudget.verify_phase4 import coverage_gate4

        result = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=90_000_000_000.0,
            pointer_total_usd=100_000_000_000.0,
            departments_failed=3,
        )
        assert "coverage_note" in result
        assert result["coverage_note"]  # non-empty
        assert "CA" in result["coverage_note"]

    def test_threshold_may_not_be_lowered(self):
        """The threshold is exactly 80%; verify the function uses it correctly."""
        from govbudget.verify_phase4 import coverage_gate4

        # 79.9% should fail
        result_low = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=79_900_000_000.0,
            pointer_total_usd=100_000_000_000.0,
            departments_failed=0,
        )
        assert result_low["ok"] is False

        # 80.1% should pass
        result_high = coverage_gate4(
            jurisdiction="CA",
            captured_total_usd=80_100_000_000.0,
            pointer_total_usd=100_000_000_000.0,
            departments_failed=0,
        )
        assert result_high["ok"] is True
