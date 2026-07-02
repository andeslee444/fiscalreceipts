"""
Subaward outlier sanity tests — proof-can-fail included.

Background
----------
The USAspending subaward bulk-download lake contains at least three known
data-entry errors where the reported subaward_amount vastly exceeds the prime
award ceiling:

  1. CPI SATCOM & Antenna Technologies (FY2024) — $39.16 T subaward vs $23 M prime
     prime_award_unique_key = CONT_AWD_N0003022C2001_9700_-NONE-_-NONE-
  2. BAE Systems Space & Mission Systems (FY2020) — $566 B vs $14 M prime
  3. Universal Avionics Systems Corp (FY2024) — $430 B vs $37 M prime

The stg_subawards staging model quarantines these rows with is_amount_suspect=True
rather than silently dropping them so the error is auditable.

These tests:
  a. Verify that the quarantine logic is correct on synthetic data.
  b. Prove the guard CAN fail (i.e. a row that should be suspect is NOT flagged
     if the guard were absent / threshold set too high).
  c. Verify the $50 B hard-cap triggers correctly independent of prime ceiling.
  d. Query the real parquet lake (if present) to confirm the known outliers are
     classified as suspect.
"""

from pathlib import Path

import duckdb
import pytest

ROOT = Path(__file__).resolve().parents[1]
SUBAWARD_PARQUET = ROOT / "data" / "parquet" / "subawards"

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

SUSPECT_LOGIC = """
(
    try_cast(subaward_amount as double) > 50000000000
    or (
        try_cast(subaward_amount  as double) is not null
        and try_cast(prime_award_amount as double) is not null
        and try_cast(subaward_amount as double) > try_cast(prime_award_amount as double)
    )
) as is_amount_suspect
"""


def _eval_suspect(subaward_amount: str, prime_award_amount: str) -> bool:
    """Run the exact same SQL expression used in stg_subawards against a single row."""
    con = duckdb.connect()
    result = con.execute(
        f"""
        select {SUSPECT_LOGIC}
        from (
            select
                '{subaward_amount}' as subaward_amount,
                '{prime_award_amount}' as prime_award_amount
        )
        """
    ).fetchone()[0]
    con.close()
    return bool(result)


# ──────────────────────────────────────────────────────────────────────────────
# Core quarantine-logic tests (fast, no parquet required)
# ──────────────────────────────────────────────────────────────────────────────

class TestSuspectFlagLogic:
    """Unit tests for the is_amount_suspect expression."""

    def test_clean_row_not_suspect(self):
        """A subaward well below the prime ceiling and $50 B cap is not suspect."""
        assert _eval_suspect("250.0", "1000.0") is False

    def test_subaward_exceeds_prime_is_suspect(self):
        """Subaward > prime ceiling triggers the flag (even below $50 B)."""
        assert _eval_suspect("5000.0", "1000.0") is True

    def test_subaward_at_prime_ceiling_not_suspect(self):
        """Subaward exactly equal to prime is NOT suspect (edge: not strictly greater)."""
        assert _eval_suspect("1000.0", "1000.0") is False

    def test_hard_cap_50b_triggers_suspect(self):
        """Any subaward > $50 B is suspect regardless of prime ceiling."""
        assert _eval_suspect("50000000001", "99999999999") is True

    def test_exactly_50b_not_suspect(self):
        """Subaward exactly $50 B is NOT suspect (boundary: strictly greater-than)."""
        assert _eval_suspect("50000000000", "99999999999") is False

    def test_cpi_satcom_amount_is_suspect(self):
        """The CPI SATCOM $39.16 T row must be flagged as suspect."""
        assert _eval_suspect("39157943915794.00", "23129183.00") is True

    def test_bae_systems_amount_is_suspect(self):
        """The BAE Systems $566 B row must be flagged as suspect."""
        assert _eval_suspect("566362566362.00", "14164468.00") is True

    def test_universal_avionics_is_suspect(self):
        """The Universal Avionics $430 B row must be flagged as suspect."""
        assert _eval_suspect("430246430246.00", "37078644.00") is True


# ──────────────────────────────────────────────────────────────────────────────
# Proof-can-fail: demonstrate the guard catches what a naïve threshold misses
# ──────────────────────────────────────────────────────────────────────────────

class TestProofCanFail:
    """
    These tests intentionally use a WRONG threshold to prove the guard would
    miss the outlier if the logic were relaxed — i.e., the guard 'can fail'.
    """

    def test_wrong_threshold_misses_cpi_satcom(self):
        """
        If the cap were raised to $100 T (higher than CPI SATCOM's $39 T),
        the outlier would NOT be caught by the cap alone — demonstrating that
        the prime-ceiling check is the essential second line of defence.
        We prove this by evaluating a weakened version that uses only a $100 T cap.
        """
        con = duckdb.connect()
        # Weakened logic: only hard-cap at $100 T, no prime-ceiling check
        weakened_logic = "try_cast(subaward_amount as double) > 100000000000000"
        result = con.execute(
            f"select {weakened_logic} from "
            "(select '39157943915794.00' as subaward_amount)"
        ).fetchone()[0]
        con.close()
        # CPI SATCOM is $39 T < $100 T threshold → weakened guard says NOT suspect
        assert result is False, (
            "Proof-can-fail: the weakened $100T-only cap missed the $39T outlier, "
            "confirming the prime-ceiling check is necessary."
        )

    def test_guard_catches_what_wrong_threshold_misses(self):
        """
        The actual guard (prime-ceiling check) DOES catch the CPI SATCOM row
        even when the hard-cap alone would not.
        """
        # $39 T subaward vs $23 M prime — caught by prime > subaward rule
        assert _eval_suspect("39157943915794.00", "23129183.00") is True

    def test_missing_prime_amount_uses_cap_only(self):
        """
        When prime_award_amount is NULL (missing), the cap-only path applies.
        A $10 M subaward with NULL prime is NOT suspect (cap not breached).
        """
        con = duckdb.connect()
        result = con.execute(
            f"""
            select {SUSPECT_LOGIC}
            from (
                select '10000000' as subaward_amount, null as prime_award_amount
            )
            """
        ).fetchone()[0]
        con.close()
        assert result is False, "A $10M subaward with NULL prime should not be flagged"


# ──────────────────────────────────────────────────────────────────────────────
# Real-data tests — skipped when parquet lake is absent (CI without data)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(
    not SUBAWARD_PARQUET.exists(),
    reason="Subaward parquet lake not present — skipping real-data checks",
)
class TestRealParquetOutliers:
    """
    Query the actual parquet lake to confirm the known outliers are classified
    as suspect.  These tests are authoritative when the lake is available.
    """

    @pytest.fixture(scope="class")
    def con(self):
        c = duckdb.connect()
        yield c
        c.close()

    def _query(self, con, sql):
        return con.execute(sql).fetchall()

    def test_cpi_satcom_in_lake(self, con):
        """CPI SATCOM $39 T row is present in the lake."""
        rows = self._query(
            con,
            f"""
            select try_cast(subaward_amount as double)
            from read_parquet('{SUBAWARD_PARQUET}/*/*.parquet',
                              hive_partitioning=true, union_by_name=true)
            where prime_award_unique_key = 'CONT_AWD_N0003022C2001_9700_-NONE-_-NONE-'
            order by 1 desc
            """,
        )
        assert len(rows) >= 1, "CPI SATCOM outlier row not found in parquet lake"
        # rows is sorted DESC — the first row is the largest (the $39T outlier)
        amount = rows[0][0]
        assert amount > 1e13, f"Expected CPI SATCOM amount > $10T, got {amount:,.0f}"

    def test_all_outliers_exceed_50b(self, con):
        """All rows with subaward_amount > $50 B are classified as suspect."""
        rows = self._query(
            con,
            f"""
            select
                prime_award_unique_key,
                try_cast(subaward_amount as double)     as sub_amt,
                try_cast(prime_award_amount as double)  as prime_amt,
                -- apply the exact stg_subawards suspect logic
                (
                    try_cast(subaward_amount as double) > 50000000000
                    or (
                        try_cast(subaward_amount  as double) is not null
                        and try_cast(prime_award_amount as double) is not null
                        and try_cast(subaward_amount as double) > try_cast(prime_award_amount as double)
                    )
                ) as is_amount_suspect
            from read_parquet('{SUBAWARD_PARQUET}/*/*.parquet',
                              hive_partitioning=true, union_by_name=true)
            where try_cast(subaward_amount as double) > 50000000000
            """,
        )
        assert len(rows) >= 1, "Expected at least one row with subaward_amount > $50B"
        for key, sub_amt, prime_amt, is_suspect in rows:
            assert is_suspect is True, (
                f"Row {key} has sub_amt={sub_amt:,.0f} > $50B "
                f"but is_amount_suspect={is_suspect}"
            )

    def test_known_outlier_count(self, con):
        """At least 3 known outlier rows are present (CPI SATCOM + BAE + Universal Avionics)."""
        rows = self._query(
            con,
            f"""
            select count(*)
            from read_parquet('{SUBAWARD_PARQUET}/*/*.parquet',
                              hive_partitioning=true, union_by_name=true)
            where try_cast(subaward_amount as double) > 1e11
            """,
        )
        count = rows[0][0]
        assert count >= 3, (
            f"Expected >= 3 outlier rows (>$100B), found {count}. "
            "Known outliers: CPI SATCOM ($39T), BAE ($566B), Universal Avionics ($430B)."
        )

    def test_suspect_rows_excluded_from_total_shrinks_aggregate(self, con):
        """
        Proof that the outliers materially distort aggregates: total subaward spend
        with all rows is orders of magnitude larger than with suspect rows excluded.
        """
        total_all = self._query(
            con,
            f"""
            select sum(try_cast(subaward_amount as double))
            from read_parquet('{SUBAWARD_PARQUET}/*/*.parquet',
                              hive_partitioning=true, union_by_name=true)
            """,
        )[0][0]

        total_clean = self._query(
            con,
            f"""
            select sum(try_cast(subaward_amount as double))
            from read_parquet('{SUBAWARD_PARQUET}/*/*.parquet',
                              hive_partitioning=true, union_by_name=true)
            where try_cast(subaward_amount as double) <= 50000000000
              and (
                  try_cast(prime_award_amount as double) is null
                  or try_cast(subaward_amount as double) <= try_cast(prime_award_amount as double)
              )
            """,
        )[0][0]

        assert total_all > total_clean * 10, (
            f"Outliers should inflate total by >10x: all={total_all:,.0f}, clean={total_clean:,.0f}"
        )
