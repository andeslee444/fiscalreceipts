"""Tests for Census state population ingestion.

Golden values hand-read from committed fixture:
  tests/fixtures/states/census_population_fixture.csv
  (CA FIPS 06, CT FIPS 09, years 2020-2024)

No live network calls.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from govbudget.states.population import (
    POPULATION_CSV_URL,
    parse_population_csv,
    write_population_parquet,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "states"
POP_FIXTURE = FIXTURE_DIR / "census_population_fixture.csv"

# Golden values hand-read from fixture (NST-EST2024-ALLDATA.csv)
# California (FIPS 06): POPESTIMATE2024 = 39431263
# Connecticut (FIPS 09): POPESTIMATE2024 = 3675069
GOLDEN_CA_2024 = 39431263
GOLDEN_CT_2024 = 3675069
GOLDEN_CA_2022 = 39142414
GOLDEN_CT_2022 = 3617925

SOURCE_URL = POPULATION_CSV_URL


# ---------------------------------------------------------------------------
# parse_population_csv — golden values from fixture
# ---------------------------------------------------------------------------


def test_parse_population_csv_ca_2024():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    ca_2024 = [r for r in rows if r[0] == "CA" and r[1] == "2024"]
    assert ca_2024, "No CA 2024 row"
    assert ca_2024[0][2] == str(GOLDEN_CA_2024)


def test_parse_population_csv_ct_2024():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    ct_2024 = [r for r in rows if r[0] == "CT" and r[1] == "2024"]
    assert ct_2024, "No CT 2024 row"
    assert ct_2024[0][2] == str(GOLDEN_CT_2024)


def test_parse_population_csv_ca_2022():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    ca_2022 = [r for r in rows if r[0] == "CA" and r[1] == "2022"]
    assert ca_2022, "No CA 2022 row"
    assert ca_2022[0][2] == str(GOLDEN_CA_2022)


def test_parse_population_csv_ct_2022():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    ct_2022 = [r for r in rows if r[0] == "CT" and r[1] == "2022"]
    assert ct_2022, "No CT 2022 row"
    assert ct_2022[0][2] == str(GOLDEN_CT_2022)


def test_parse_population_csv_source_url_on_all_rows():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    assert all(r[3] == SOURCE_URL for r in rows)


def test_parse_population_csv_default_years():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    # Default years: 2022, 2023, 2024 — 2 states × 3 years = 6 rows
    assert len(rows) == 6


def test_parse_population_csv_tuple_length():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06"])
    assert all(len(r) == 4 for r in rows)
    # (state, year, population, source_url)


def test_parse_population_csv_both_states():
    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    states = {r[0] for r in rows}
    assert "CA" in states
    assert "CT" in states


# ---------------------------------------------------------------------------
# write_population_parquet — schema + content
# ---------------------------------------------------------------------------


def test_write_population_parquet_schema():
    import duckdb

    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "state_population.parquet"
        write_population_parquet(rows, out)
        con = duckdb.connect()
        cols = {r[0] for r in con.execute(f"describe select * from '{out}'").fetchall()}
        con.close()
    expected = {"state", "year", "population", "source_url"}
    assert expected == cols


def test_write_population_parquet_all_varchar():
    import duckdb

    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "state_population.parquet"
        write_population_parquet(rows, out)
        con = duckdb.connect()
        dtypes = {
            r[0]: r[1]
            for r in con.execute(f"describe select * from '{out}'").fetchall()
        }
        con.close()
    assert all(v == "VARCHAR" for v in dtypes.values()), f"Non-varchar columns: {dtypes}"


def test_write_population_parquet_row_count():
    import duckdb

    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "state_population.parquet"
        write_population_parquet(rows, out)
        con = duckdb.connect()
        count = con.execute(f"select count(*) from '{out}'").fetchone()[0]
        con.close()
    assert count == 6  # 2 states × 3 default years


def test_write_population_parquet_source_url_on_all_rows():
    import duckdb

    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "state_population.parquet"
        write_population_parquet(rows, out)
        con = duckdb.connect()
        nulls = con.execute(
            f"select count(*) from '{out}' where source_url is null or source_url=''"
        ).fetchone()[0]
        con.close()
    assert nulls == 0


def test_write_population_parquet_ca_2024_value():
    import duckdb

    text = POP_FIXTURE.read_text(encoding="utf-8")
    rows = parse_population_csv(text, SOURCE_URL, fips_filter=["06", "09"])
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / "states" / "state_population.parquet"
        write_population_parquet(rows, out)
        con = duckdb.connect()
        val = con.execute(
            f"select population from '{out}' where state='CA' and year='2024'"
        ).fetchone()
        con.close()
    assert val is not None
    assert val[0] == str(GOLDEN_CA_2024)
