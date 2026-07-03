"""TDD tests for verify_phase5a gates.

Each gate is tested in isolation with minimal fixture data built in tmp_path.
No network access. No dependence on the live warehouse.
"""
from pathlib import Path

import duckdb
import pytest

from govbudget.verify_phase5a import (
    influence_gate5a,
    match_gate5a,
    mention_gate5a,
    provenance_gate5a,
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


def make_filings(path: Path, rows: list[tuple]) -> None:
    """Write lda_filings.parquet with the canonical schema.

    Columns: filing_uuid, url, client_name, registrant_name, filing_year,
             filing_period, filing_type, income_usd, expenses_usd,
             family_key_guess, match_method
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(
        "create table _f (filing_uuid varchar, url varchar, client_name varchar,"
        " registrant_name varchar, filing_year varchar, filing_period varchar,"
        " filing_type varchar, income_usd varchar, expenses_usd varchar,"
        " family_key_guess varchar, match_method varchar)"
    )
    if rows:
        con.executemany("insert into _f values (?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.execute(f"copy _f to '{path}' (format parquet)")
    con.close()


def make_mentions(path: Path, rows: list[tuple]) -> None:
    """Write lda_program_mentions.parquet.

    Columns: filing_uuid, pe_bli, matched_term, description_snippet
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(
        "create table _m (filing_uuid varchar, pe_bli varchar,"
        " matched_term varchar, description_snippet varchar)"
    )
    if rows:
        con.executemany("insert into _m values (?,?,?,?)", rows)
    con.execute(f"copy _m to '{path}' (format parquet)")
    con.close()


def make_duckdb_with_influence(
    db_path: Path,
    *,
    fct_influence_rows: list[tuple] | None = None,
    dim_entities_rows: list[tuple] | None = None,
    bad_col_name: str | None = None,
) -> None:
    """Build a minimal DuckDB with the mart tables needed by influence_gate5a and match_gate5a.

    fct_influence cols: family_key, display_name, filing_year,
                        filings_count, lobbying_income_usd, lobbying_expense_usd,
                        lobbying_total_usd, obligations_usd
    dim_entities cols: family_key, display_name, total_obligation
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))

    # fct_influence — build using INSERT to avoid VALUES-alias type issues
    extra_fi = ", won_due_to_lobbying double" if bad_col_name == "fct_influence" else ""
    con.execute(
        f"create table fct_influence ("
        f"family_key varchar, display_name varchar, filing_year varchar,"
        f" filings_count integer, lobbying_income_usd double,"
        f" lobbying_expense_usd double, lobbying_total_usd double,"
        f" family_obligations_usd double{extra_fi})"
    )
    if fct_influence_rows:
        if bad_col_name == "fct_influence":
            # add a dummy value for the extra column
            rows_aug = [r + (0.0,) for r in fct_influence_rows]
            con.executemany(
                "insert into fct_influence values (?,?,?,?,?,?,?,?,?)", rows_aug
            )
        else:
            con.executemany(
                "insert into fct_influence values (?,?,?,?,?,?,?,?)", fct_influence_rows
            )

    # dim_entities
    con.execute(
        "create table dim_entities ("
        "family_key varchar, display_name varchar, total_obligation double)"
    )
    if dim_entities_rows:
        con.executemany(
            "insert into dim_entities values (?,?,?)", dim_entities_rows
        )

    # fct_program_lobbying
    extra_pl = ", caused_by_lobbying double" if bad_col_name == "fct_program_lobbying" else ""
    con.execute(
        f"create table fct_program_lobbying ("
        f"filing_uuid varchar, pe_bli varchar, program_title varchar,"
        f" matched_term varchar, description_snippet varchar,"
        f" filing_url varchar, client_name varchar,"
        f" family_key varchar, filing_year varchar{extra_pl})"
    )

    # dim_lobbyists
    extra_dl = ", because_of_revolving varchar" if bad_col_name == "dim_lobbyists" else ""
    con.execute(
        f"create table dim_lobbyists ("
        f"name varchar, covered_position varchar,"
        f" filings_count integer, revolving_door boolean{extra_dl})"
    )

    con.close()


# ---------------------------------------------------------------------------
# Gate 1: provenance_gate5a
# ---------------------------------------------------------------------------


class TestProvenanceGate5a:
    def _good_filing_row(self, uuid: str, url: str) -> tuple:
        return (uuid, url, "LockheedCo", "LobbyFirm", "2025", "Q1", "LD2",
                "500000", "", "lockheed", "exact_family")

    def test_pass(self, tmp_path):
        p = tmp_path / "lda_filings.parquet"
        rows = [
            self._good_filing_row("uuid-1", "https://lda.senate.gov/f/1"),
            self._good_filing_row("uuid-2", "https://lda.senate.gov/f/2"),
        ]
        make_filings(p, rows)
        result = provenance_gate5a(p)
        assert result["ok"] is True
        assert result["total_filings"] == 2
        assert result["violations"] == 0

    def test_fail_empty_url(self, tmp_path):
        p = tmp_path / "lda_filings.parquet"
        rows = [
            self._good_filing_row("uuid-1", "https://lda.senate.gov/f/1"),
            ("uuid-2", "", "BadCo", "Firm", "2025", "Q1", "LD2", "100", "", "badco", "exact_family"),
        ]
        make_filings(p, rows)
        result = provenance_gate5a(p)
        assert result["ok"] is False
        assert result["violations"] == 1

    def test_fail_empty_uuid(self, tmp_path):
        p = tmp_path / "lda_filings.parquet"
        rows = [
            ("", "https://lda.senate.gov/f/1", "Co", "Firm", "2025", "Q1", "LD2",
             "100", "", "co", "exact_family"),
        ]
        make_filings(p, rows)
        result = provenance_gate5a(p)
        assert result["ok"] is False
        assert result["violations"] == 1

    def test_fail_missing_file(self, tmp_path):
        p = tmp_path / "does_not_exist.parquet"
        result = provenance_gate5a(p)
        assert result["ok"] is False
        assert "missing" in result.get("reason", "").lower()

    def test_fail_empty_parquet(self, tmp_path):
        p = tmp_path / "lda_filings.parquet"
        make_filings(p, [])
        result = provenance_gate5a(p)
        assert result["ok"] is False


# ---------------------------------------------------------------------------
# Gate 2: match_gate5a
# ---------------------------------------------------------------------------


class TestMatchGate5a:
    def _make_entities(self, n: int) -> list[tuple]:
        """Return n dim_entities rows in descending obligation order."""
        return [
            (f"family_{i}", f"Family {i}", float(10000 - i * 100))
            for i in range(n)
        ]

    def test_pass_all_matched(self, tmp_path):
        db = tmp_path / "t.duckdb"
        n = 10
        entities = self._make_entities(n)
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        # Write filings that match all top-10 families
        filings_rows = [
            (f"uuid-{i}", f"https://lda.senate.gov/f/{i}", f"Family {i} Inc",
             "LobbyFirm", "2025", "Q1", "LD2", "500000", "",
             f"family_{i}", "exact_family")
            for i in range(n)
        ]
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)
        result = match_gate5a(db, filings_p)
        assert result["ok"] is True
        assert result["matched_fraction"] >= 0.80
        assert result["unmatched_families"] == []

    def test_fail_below_threshold(self, tmp_path):
        """Only 2 of 10 families have a matched filing → 20% < 80% → FAIL."""
        db = tmp_path / "t.duckdb"
        n = 10
        entities = self._make_entities(n)
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        # Only match families 0 and 1
        filings_rows = [
            ("uuid-0", "https://lda.senate.gov/f/0", "Family 0 Inc", "Firm",
             "2025", "Q1", "LD2", "500000", "", "family_0", "exact_family"),
            ("uuid-1", "https://lda.senate.gov/f/1", "Family 1 Inc", "Firm",
             "2025", "Q1", "LD2", "500000", "", "family_1", "normalized"),
        ]
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)
        result = match_gate5a(db, filings_p)
        assert result["ok"] is False
        assert result["matched_fraction"] == pytest.approx(0.2)
        assert len(result["unmatched_families"]) == 8

    def test_pass_boundary_86_pct(self, tmp_path):
        """Exactly 86% match (43 of 50) → PASS at the ≥85% threshold.

        Documented-expectation update (5A backlog #1, 2026-07): the threshold
        moved 0.80 → 0.85 after curated aliases for Booz Allen, ADS Tactical,
        Vertex (V2X fka), and Shell E&P raised the live floor to 44/50 = 88%.
        43/50 is the lowest whole-family fraction that still passes.
        """
        db = tmp_path / "t.duckdb"
        n = 50
        entities = self._make_entities(n)
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        # Match exactly 43 families (86%)
        filings_rows = [
            (f"uuid-{i}", f"https://lda.senate.gov/f/{i}", f"Family {i} Inc",
             "Firm", "2025", "Q1", "LD2", "100", "", f"family_{i}", "exact_family")
            for i in range(43)
        ]
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)
        result = match_gate5a(db, filings_p)
        assert result["ok"] is True
        assert result["matched_fraction"] == pytest.approx(0.86)

    def test_fail_boundary_84_pct(self, tmp_path):
        """42 of 50 = 84% < 85% → FAIL (proof the hardened threshold bites)."""
        db = tmp_path / "t.duckdb"
        n = 50
        entities = self._make_entities(n)
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        filings_rows = [
            (f"uuid-{i}", f"https://lda.senate.gov/f/{i}", f"Family {i} Inc",
             "Firm", "2025", "Q1", "LD2", "100", "", f"family_{i}", "exact_family")
            for i in range(42)
        ]
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)
        result = match_gate5a(db, filings_p)
        assert result["ok"] is False
        assert result["matched_fraction"] == pytest.approx(0.84)

    def test_match_method_none_not_counted(self, tmp_path):
        """Filings with match_method='none' do NOT count as matched."""
        db = tmp_path / "t.duckdb"
        entities = self._make_entities(5)
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        # All filings have match_method='none'
        filings_rows = [
            (f"uuid-{i}", f"https://lda.senate.gov/f/{i}", f"Other Co {i}",
             "Firm", "2025", "Q1", "LD2", "100", "", f"family_{i}", "none")
            for i in range(5)
        ]
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)
        result = match_gate5a(db, filings_p)
        assert result["ok"] is False
        assert result["matched_fraction"] == 0.0

    def test_unmatched_list_populated(self, tmp_path):
        """Unmatched family names are in the result for Phase 5B alias work."""
        db = tmp_path / "t.duckdb"
        entities = [("boeing", "Boeing", 99000.0), ("raytheon", "Raytheon", 88000.0)]
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        # No matched filings at all
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, [])
        result = match_gate5a(db, filings_p)
        assert result["ok"] is False
        assert "Boeing" in result["unmatched_families"] or "boeing" in result["unmatched_families"]


# ---------------------------------------------------------------------------
# Gate 3: influence_gate5a
# ---------------------------------------------------------------------------


class TestInfluenceGate5a:
    def _good_fct_influence(self) -> list[tuple]:
        """30 distinct families each with lobbying > 0 and obligations > 0."""
        return [
            (f"family_{i}", f"Family {i}", "2025", 5, 1000000.0, 0.0, 1000000.0, 5000000000.0)
            for i in range(35)
        ]

    def test_pass(self, tmp_path):
        db = tmp_path / "t.duckdb"
        make_duckdb_with_influence(db, fct_influence_rows=self._good_fct_influence())
        result = influence_gate5a(db)
        assert result["ok"] is True
        assert result["distinct_families_with_both"] >= 30
        assert result["negative_lobbying_rows"] == 0

    def test_fail_too_few_families(self, tmp_path):
        """Only 10 families with both lobbying and obligations → below 30 threshold."""
        db = tmp_path / "t.duckdb"
        rows = [
            (f"family_{i}", f"Family {i}", "2025", 5, 1000000.0, 0.0, 1000000.0, 5000000000.0)
            for i in range(10)
        ]
        make_duckdb_with_influence(db, fct_influence_rows=rows)
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert result["distinct_families_with_both"] == 10

    def test_fail_negative_lobbying(self, tmp_path):
        """A row with negative lobbying_income_usd → honesty check fails."""
        db = tmp_path / "t.duckdb"
        rows = self._good_fct_influence() + [
            ("bad_family", "Bad Co", "2025", 1, -500.0, 0.0, -500.0, 1000000.0)
        ]
        make_duckdb_with_influence(db, fct_influence_rows=rows)
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert result["negative_lobbying_rows"] > 0

    def test_fail_causation_column_in_fct_influence(self, tmp_path):
        """A column named 'won_due_to_lobbying' in fct_influence → honesty check fails."""
        db = tmp_path / "t.duckdb"
        make_duckdb_with_influence(
            db,
            fct_influence_rows=self._good_fct_influence(),
            bad_col_name="fct_influence",
        )
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert result["bad_columns"]

    def test_fail_causation_column_in_fct_program_lobbying(self, tmp_path):
        db = tmp_path / "t.duckdb"
        make_duckdb_with_influence(
            db,
            fct_influence_rows=self._good_fct_influence(),
            bad_col_name="fct_program_lobbying",
        )
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert result["bad_columns"]

    def test_fail_causation_column_in_dim_lobbyists(self, tmp_path):
        db = tmp_path / "t.duckdb"
        make_duckdb_with_influence(
            db,
            fct_influence_rows=self._good_fct_influence(),
            bad_col_name="dim_lobbyists",
        )
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert result["bad_columns"]

    def test_families_with_only_obligations_not_counted(self, tmp_path):
        """Families with obligations > 0 but lobbying = 0 do NOT count toward the 30."""
        db = tmp_path / "t.duckdb"
        # 29 families with lobbying, plus 5 with zero lobbying
        rows = [
            (f"family_{i}", f"Family {i}", "2025", 5, 1000000.0, 0.0, 1000000.0, 5000000000.0)
            for i in range(29)
        ] + [
            (f"nolob_{i}", f"NoLob {i}", "2025", 0, 0.0, 0.0, 0.0, 5000000000.0)
            for i in range(5)
        ]
        make_duckdb_with_influence(db, fct_influence_rows=rows)
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert result["distinct_families_with_both"] == 29

    def test_fail_mart_tables_missing_no_exception(self, tmp_path):
        """DuckDB without mart tables → structured failure dict, no CatalogException."""
        db = tmp_path / "empty.duckdb"
        db.parent.mkdir(parents=True, exist_ok=True)
        # Create a duckdb with no mart tables at all
        con = duckdb.connect(str(db))
        con.close()
        result = influence_gate5a(db)
        assert result["ok"] is False
        assert "reason" in result
        assert "mart tables missing" in result["reason"]
        assert "govbudget build" in result["reason"]
        # Should still have all the expected keys
        assert "distinct_families_with_both" in result
        assert "sub_checks" in result


# ---------------------------------------------------------------------------
# Gate 4: mention_gate5a
# ---------------------------------------------------------------------------


class TestMentionGate5a:
    def _good_filings(self, tmp_path: Path) -> Path:
        p = tmp_path / "lda_filings.parquet"
        rows = [
            ("uuid-A", "https://lda.senate.gov/f/A", "LockCo", "Firm",
             "2025", "Q1", "LD2", "1000000", "", "lockheed", "exact_family"),
            ("uuid-B", "https://lda.senate.gov/f/B", "RayCo", "Firm",
             "2025", "Q2", "LD2", "500000", "", "raytheon", "normalized"),
            ("uuid-C", "https://lda.senate.gov/f/C", "BoCo", "Firm",
             "2025", "Q1", "LD2", "", "750000", "boeing", "exact_family"),
        ]
        make_filings(p, rows)
        return p

    def _good_mentions(self, tmp_path: Path) -> Path:
        p = tmp_path / "lda_program_mentions.parquet"
        # 12 mentions across 4 distinct pe_bli
        rows = [
            ("uuid-A", "PE001", "F-35", "F-35 Joint Strike Fighter program"),
            ("uuid-A", "PE002", "destroyer", "DDG-51 destroyer class"),
            ("uuid-B", "PE003", "hypersonic", "Hypersonic glide vehicle development"),
            ("uuid-B", "PE001", "F-35", "F-35 second reference"),
            ("uuid-C", "PE004", "satellite", "GPS satellite constellation upgrade"),
            ("uuid-C", "PE002", "destroyer", "destroyer reference"),
            ("uuid-A", "PE003", "hypersonic", "hypersonic second mention"),
            ("uuid-B", "PE004", "satellite", "satellite reference"),
            ("uuid-C", "PE001", "F-35", "third F-35 ref"),
            ("uuid-A", "PE004", "satellite", "fourth satellite ref"),
            ("uuid-B", "PE002", "destroyer", "fifth destroyer ref"),
            ("uuid-C", "PE003", "hypersonic", "sixth hypersonic ref"),
        ]
        make_mentions(p, rows)
        return p

    def test_pass(self, tmp_path):
        filings_p = self._good_filings(tmp_path)
        mentions_p = self._good_mentions(tmp_path)
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is True
        assert result["total_mentions"] >= 10
        assert result["distinct_pe_bli"] >= 3
        assert result["orphan_mentions"] == 0

    def test_fail_too_few_mentions(self, tmp_path):
        """Only 5 total mentions → below 10 threshold → FAIL."""
        filings_p = self._good_filings(tmp_path)
        mentions_p = tmp_path / "lda_program_mentions.parquet"
        rows = [
            ("uuid-A", "PE001", "F-35", "ref"),
            ("uuid-A", "PE002", "destroyer", "ref"),
            ("uuid-B", "PE001", "F-35", "ref"),
            ("uuid-B", "PE003", "hypersonic", "ref"),
            ("uuid-C", "PE002", "destroyer", "ref"),
        ]
        make_mentions(mentions_p, rows)
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is False
        assert result["total_mentions"] == 5

    def test_fail_too_few_distinct_pe_bli(self, tmp_path):
        """10+ mentions but only 2 distinct pe_bli → FAIL."""
        filings_p = self._good_filings(tmp_path)
        mentions_p = tmp_path / "lda_program_mentions.parquet"
        # 12 mentions but only 2 pe_bli
        rows = [
            ("uuid-A", "PE001", "F-35", f"ref {i}") for i in range(6)
        ] + [
            ("uuid-B", "PE002", "destroyer", f"ref {i}") for i in range(6)
        ]
        make_mentions(mentions_p, rows)
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is False
        assert result["distinct_pe_bli"] == 2

    def test_fail_orphan_mention(self, tmp_path):
        """A mention whose filing_uuid does not appear in filings → orphan → FAIL."""
        filings_p = self._good_filings(tmp_path)
        mentions_p = tmp_path / "lda_program_mentions.parquet"
        rows = [
            ("uuid-A", "PE001", "F-35", "ref"),
            ("uuid-A", "PE002", "destroyer", "ref"),
            ("uuid-B", "PE003", "hyp", "ref"),
            ("uuid-B", "PE001", "F-35", "ref"),
            ("uuid-C", "PE004", "sat", "ref"),
            ("uuid-C", "PE002", "destroyer", "ref"),
            ("uuid-A", "PE003", "hyp", "ref"),
            ("uuid-B", "PE004", "sat", "ref"),
            ("uuid-C", "PE001", "F-35", "ref"),
            ("uuid-A", "PE004", "sat", "ref"),
            # orphan: uuid-GHOST has no corresponding filing with a url
            ("uuid-GHOST", "PE001", "F-35", "ghost ref"),
        ]
        make_mentions(mentions_p, rows)
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is False
        assert result["orphan_mentions"] == 1

    def test_fail_missing_mentions_file(self, tmp_path):
        filings_p = self._good_filings(tmp_path)
        mentions_p = tmp_path / "does_not_exist.parquet"
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is False
        assert "missing" in result.get("reason", "").lower()

    def test_fail_missing_filings_file(self, tmp_path):
        filings_p = tmp_path / "does_not_exist.parquet"
        mentions_p = tmp_path / "mentions.parquet"
        make_mentions(mentions_p, [("u", "PE001", "t", "s")])
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is False
        assert "missing" in result.get("reason", "").lower()

    def test_fail_zero_mentions_no_exception(self, tmp_path):
        """mention_gate5a with a zero-row mentions parquet → ok False, no exception."""
        filings_p = self._good_filings(tmp_path)
        mentions_p = tmp_path / "lda_program_mentions.parquet"
        make_mentions(mentions_p, [])
        result = mention_gate5a(mentions_p, filings_p)
        assert result["ok"] is False
        assert result["total_mentions"] == 0


# ---------------------------------------------------------------------------
# Finding 1d: match_gate5a gate hardening — bad 'normalized' rows fail gate
# ---------------------------------------------------------------------------


class TestMatchGate5aHardening:
    """Finding 1d: sub-assertion that all 'normalized' rows pass token-boundary re-validation."""

    def _make_entities(self, n: int) -> list[tuple]:
        return [
            (f"family_{i}", f"Family {i}", float(10000 - i * 100))
            for i in range(n)
        ]

    def test_gate_fails_when_bad_normalized_row_present(self, tmp_path):
        """A filing stamped 'normalized' that fails token-boundary check causes gate FAIL.

        'JAMESTOWN BPU' stamped as 'normalized' for family 'BP' is a legacy bad row.
        The gate re-validates and must fail with that pair listed.
        """
        db = tmp_path / "t.duckdb"
        # Need enough families to be above 80% threshold so the ONLY failure is
        # the bad_normalized sub-assertion. Use 10 families, all matched.
        n = 10
        entities = self._make_entities(n)
        make_duckdb_with_influence(db, dim_entities_rows=entities)

        # All 10 families have a legitimately-matched filing
        filings_rows = [
            (f"uuid-{i}", f"https://lda.senate.gov/f/{i}", f"Family {i} Inc",
             "Firm", "2025", "Q1", "LD2", "100", "", f"family_{i}", "exact_family")
            for i in range(n)
        ]
        # Inject one stale 'normalized' row for a different family
        filings_rows.append(
            ("uuid-bad-norm", "https://lda.senate.gov/f/bad", "JAMESTOWN BPU",
             "Firm", "2025", "Q1", "LD2", "50000", "", "BP", "normalized")
        )
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)

        result = match_gate5a(db, filings_p)

        # Gate must fail because of the bad normalized row
        assert result["ok"] is False
        assert len(result["bad_normalized_rows"]) >= 1
        # The offending pair must be listed
        bad_pairs = result["bad_normalized_rows"]
        assert any(client == "JAMESTOWN BPU" and fk == "BP" for client, fk in bad_pairs), (
            f"Expected ('JAMESTOWN BPU', 'BP') in bad_normalized_rows, got {bad_pairs}"
        )

    def test_gate_passes_when_all_normalized_rows_valid(self, tmp_path):
        """Gate passes when all 'normalized' rows satisfy token-boundary containment."""
        db = tmp_path / "t.duckdb"
        n = 10
        entities = self._make_entities(n)
        make_duckdb_with_influence(db, dim_entities_rows=entities)

        filings_rows = [
            (f"uuid-{i}", f"https://lda.senate.gov/f/{i}", f"Family {i} Inc",
             "Firm", "2025", "Q1", "LD2", "100", "", f"family_{i}", "exact_family")
            for i in range(n)
        ]
        # Add a valid 'normalized' row: "GENERAL DYNAMICS LAND" contains "GENERAL DYNAMICS"
        filings_rows.append(
            ("uuid-gd", "https://lda.senate.gov/f/gd", "GENERAL DYNAMICS LAND SYSTEMS",
             "Firm", "2025", "Q1", "LD2", "200000", "", "GENERAL DYNAMICS", "normalized")
        )
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, filings_rows)

        result = match_gate5a(db, filings_p)

        assert result["ok"] is True
        assert result["bad_normalized_rows"] == []

    def test_bad_normalized_rows_key_always_present(self, tmp_path):
        """Result dict always contains 'bad_normalized_rows' key."""
        db = tmp_path / "t.duckdb"
        entities = [("fam_a", "Family A", 1000.0)]
        make_duckdb_with_influence(db, dim_entities_rows=entities)
        filings_p = tmp_path / "lda_filings.parquet"
        make_filings(filings_p, [])
        result = match_gate5a(db, filings_p)
        assert "bad_normalized_rows" in result


# ---------------------------------------------------------------------------
# Finding 2: influence_gate5a uses family_obligations_usd (rename check)
# ---------------------------------------------------------------------------


class TestInfluenceGate5aObligationsColumn:
    """Finding 2: verify influence_gate5a queries the renamed family_obligations_usd column."""

    def _good_fct_influence(self) -> list[tuple]:
        return [
            (f"family_{i}", f"Family {i}", "2025", 5, 1000000.0, 0.0, 1000000.0, 5000000000.0)
            for i in range(35)
        ]

    def test_families_with_zero_obligations_not_counted(self, tmp_path):
        """Families with family_obligations_usd=0 but lobbying>0 do NOT count toward ≥30."""
        db = tmp_path / "t.duckdb"
        rows = [
            # 29 families with both obligations and lobbying > 0
            (f"family_{i}", f"Family {i}", "2025", 5, 1000000.0, 0.0, 1000000.0, 5000000000.0)
            for i in range(29)
        ] + [
            # 5 families with lobbying but zero obligations
            (f"noobl_{i}", f"NoObl {i}", "2025", 2, 500000.0, 0.0, 500000.0, 0.0)
            for i in range(5)
        ]
        make_duckdb_with_influence(db, fct_influence_rows=rows)
        result = influence_gate5a(db)
        # 29 < 30 threshold → FAIL
        assert result["ok"] is False
        assert result["distinct_families_with_both"] == 29

    def test_pass_with_family_obligations_usd_column(self, tmp_path):
        """influence_gate5a passes when fct_influence has family_obligations_usd column."""
        db = tmp_path / "t.duckdb"
        make_duckdb_with_influence(db, fct_influence_rows=self._good_fct_influence())
        result = influence_gate5a(db)
        assert result["ok"] is True
        assert result["distinct_families_with_both"] >= 30
