"""Tests for Phase 5D Task 1: years_matrix.json + sharded citation slices.

TDD scope (plan 2026-07-02-phase5d-years-matrix Task 1, tests a-h):
  (a) matrix sidecar exists with org→programs→projects nesting
  (b) a known program's FY24 cell equals the fct_budget_lines detail-row value
      with its workbook fact_id (incl. the CYBERCOM→CYBER org translation)
  (c) a known project cell equals its jbook_details row + jbook_pdf fact_id
  (d) Δ cells carry trajectory derived fact_ids; multi-line pivot cells fall
      back to the derived trajectory fact_id (the cited sum)
  (e) missing values are null/absent, never 0; multi-line cells for
      amount_types with NO derived citation are absent (no uncited sums)
  (f) every fid in the matrix exists in exactly the right shard file
  (g) shard union == citations_dict keys (no orphans, no misses), shard rows
      byte-identical to the citations.json values
  (h) payload < 900 KB raw (loud exporter guard + live-file check)

Cell contract (BINDING for the /years/ page and the G8 yearsmatrix gate):
  program cells keyed by amount_type; each cell {"v": float, "fid": str|null}.
  - exactly one cited budget_lines detail row → v = amount_thousands,
    fid = the workbook fact_id (the direct receipt)
  - zero or >1 detail rows for a trajectory-covered amount_type → v = the
    fct_budget_trajectory value, fid = the derived trajectory fact_id
    (the recompute-verified cited sum)
  - otherwise the cell is ABSENT (missing → "–", never 0, never uncited sums)
  Δ cell key 'fy2526_change' (derived fid); '%Δ' key 'fy2526_pct_change'
  carries {"v": pct} with NO fid (mart-computed presentation figure, only
  emitted when the cited Δ cell is present).
  project cells keyed fy2024/fy2025/fy2026 (PriorYear/CurrentYear/
  BudgetYearOne); cited rows carry fid, uncited zero_amount rows carry
  xp (xml_path, Cite state B).
"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from govbudget.config import ROOT as _ROOT
from govbudget.export_site import (
    _emit_cite_shards,
    _emit_years_matrix,
    fact_id_derived,
)


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

# Workbook fact_ids (16-hex-ish literals are fine — the emitters treat them
# as opaque strings; shard tests need real [0:2] prefixes)
W_DARPA_24 = "aa11000000000001"
W_DARPA_25A = "aa11000000000002"
W_DARPA_25B = "ab11000000000003"
W_DARPA_26 = "ac11000000000004"
W_DARPA_25E_A = "ad11000000000005"
W_DARPA_25E_B = "ae11000000000006"
W_ARMY_24 = "ba11000000000007"
W_CYBER_24 = "ca11000000000008"
J_P1_PRIOR = "da11000000000009"
J_P1_BY1 = "db1100000000000a"

D_DARPA_25 = fact_id_derived("trajectory", "0601101E|DARPA", "fy2025_total")
D_DARPA_CHG = fact_id_derived("trajectory", "0601101E|DARPA", "fy2526_change")
D_ARMY_CHG = fact_id_derived("trajectory", "0602303A|A", "fy2526_change")
D_CYBER_CHG = fact_id_derived("trajectory", "0303140K|CYBER", "fy2526_change")

# ---------------------------------------------------------------------------
# Phase 5E Task 6 decade fixtures — grains are
# (pe_bli, fy, edition_year, amount_type_kind, amount_thousands, fid,
#  amount_type) (7-tuple since PM Sprint 1: the trailing chosen slug feeds
# slug-accurate `measure` derivation in the sidecar/summary consumers)
# ---------------------------------------------------------------------------

W_DEC_20A = "ea11000000000010"   # single-source FY2020 actuals (PB2022)
W_DEC_25E = "eb11000000000011"   # single-source FY2025 enacted (PB2026)
UNCITED_DEC = "ec11000000000012"  # decade grain with NO citation row
D_DEC_15A = fact_id_derived("decade", "0601101E|2017", "fy_2015_actuals")


def _decade_grains() -> list[tuple]:
    return [
        # FY2020 actuals from PB2022 (edition-authoritative rule: PB(N+2))
        ("0601101E", 2020, 2022, "actuals", 150000.0, W_DEC_20A,
         "fy_2020_actuals"),
        # FY2015 actuals from PB2017 — multi-source grain → derived decade fid
        ("0601101E", 2015, 2017, "actuals", 90000.0, D_DEC_15A,
         "fy_2015_actuals"),
        # FY2025 enacted from PB2026 CurrentYear
        ("0601101E", 2025, 2026, "enacted", 200000.0, W_DEC_25E,
         "fy_2025_enacted"),
        # FY2026 request from PB2026 BudgetYearOne — reuses the workbook fid
        ("0601101E", 2026, 2026, "request", 400000.0, W_DARPA_26,
         "fy_2026_total"),
        # UNCITED grain — the cell must be honestly absent
        ("0303140K", 2020, 2022, "actuals", 30000.0, UNCITED_DEC,
         "fy_2020_actuals"),
    ]


def _make_duckdb_with_trajectory(tmp_path: Path) -> Path:
    db_path = tmp_path / "govbudget.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        "CREATE TABLE fct_budget_trajectory ("
        "  pe_bli varchar, organization varchar,"
        "  fy2024_actuals double, fy2025_total double, fy2026_total double,"
        "  fy2526_change double, fy2526_pct_change double"
        ")"
    )
    con.execute(
        "INSERT INTO fct_budget_trajectory VALUES "
        # DARPA: fy25 has TWO detail rows (120k + 80k) → pivot fallback
        "('0601101E', 'DARPA', 100000.0, 200000.0, 400000.0, 200000.0, 100.0),"
        # Army (workbook-code org, synth-style): zeroed FY26
        "('0602303A', 'A', 50000.0, 60000.0, 0.0, -60000.0, -100.0),"
        # CYBERCOM program: trajectory keyed by workbook org CYBER
        "('0303140K', 'CYBER', 30000.0, 35000.0, 40000.0, 5000.0, 14.29)"
    )
    con.close()
    return db_path


def _all_prog_rows() -> list[tuple]:
    """(pe_bli, org, exhibit_family, title, project_count, fy2024m, fully_reconciled)."""
    return [
        ("0601101E", "DARPA", "rdte", "DARPA Research", 1, 100.0, True),
        ("0602303A", "A", "rdte", "Army Research Lab", 0, None, False),
        ("0303140K", "CYBERCOM", "rdte", "Cyber Ops", 0, 30.0, False),
    ]


def _bl_row(fid, pe, org, amount_type, amount, title="Line"):
    """16-tuple matching the export pass bl_rows shape."""
    return (
        fid, "R-1", 2026, "2040", "RDT&E", org, "3", "Adv Tech",
        pe, title, amount_type, amount, "USD thousands",
        "sha_wb", "Exhibit R-1", "D5",
    )


def _bl_rows() -> list[tuple]:
    return [
        _bl_row(W_DARPA_24, "0601101E", "DARPA", "fy_2024_actuals", 100000.0),
        # TWO fy_2025_total rows → cell must fall back to the derived traj fid
        _bl_row(W_DARPA_25A, "0601101E", "DARPA", "fy_2025_total", 120000.0),
        _bl_row(W_DARPA_25B, "0601101E", "DARPA", "fy_2025_total", 80000.0),
        _bl_row(W_DARPA_26, "0601101E", "DARPA", "fy_2026_total", 400000.0),
        # TWO fy_2025_enacted rows — NO derived citation exists for this
        # amount_type → the cell must be ABSENT (never an uncited sum)
        _bl_row(W_DARPA_25E_A, "0601101E", "DARPA", "fy_2025_enacted", 90000.0),
        _bl_row(W_DARPA_25E_B, "0601101E", "DARPA", "fy_2025_enacted", 95000.0),
        _bl_row(W_ARMY_24, "0602303A", "A", "fy_2024_actuals", 50000.0),
        # CYBERCOM program's lines live under workbook org CYBER
        _bl_row(W_CYBER_24, "0303140K", "CYBER", "fy_2024_actuals", 30000.0),
    ]


def _detail_row(fid, pe, pn, pt, scenario, amount, xml_path, resolution):
    """13-tuple matching the export pass detail_rows shape."""
    return (
        fid, pe, pn, pt, scenario, amount, "USD millions", xml_path,
        "DARPA", "rdte", 2026, "sha_jb", resolution,
    )


def _detail_rows() -> list[tuple]:
    return [
        # root row (project_number None) — never a project sub-row
        _detail_row("dc1100000000000b", "0601101E", None, None, "PriorYear",
                    100.0, "ProgramElement[1]", "unique"),
        _detail_row(J_P1_PRIOR, "0601101E", "P1", "Project One", "PriorYear",
                    12.5, "ProgramElement[1]/Project[0]", "unique"),
        # zero_amount project cell — uncited, carries xml_path (state B)
        _detail_row(J_P1_BY1, "0601101E", "P1", "Project One", "BudgetYearOne",
                    0.0, "ProgramElement[1]/Project[1]", "zero_amount"),
    ]


def _cited_fact_ids() -> set[str]:
    return {
        W_DARPA_24, W_DARPA_25A, W_DARPA_25B, W_DARPA_26,
        W_DARPA_25E_A, W_DARPA_25E_B, W_ARMY_24, W_CYBER_24,
        W_DEC_20A, W_DEC_25E, D_DEC_15A,  # decade fids (UNCITED_DEC absent)
        J_P1_PRIOR,  # J_P1_BY1 is zero_amount → NOT cited
        "dc1100000000000b",
        fact_id_derived("trajectory", "0601101E|DARPA", "fy2024_actuals"),
        D_DARPA_25,
        fact_id_derived("trajectory", "0601101E|DARPA", "fy2026_total"),
        D_DARPA_CHG,
        fact_id_derived("trajectory", "0602303A|A", "fy2024_actuals"),
        fact_id_derived("trajectory", "0602303A|A", "fy2025_total"),
        fact_id_derived("trajectory", "0602303A|A", "fy2026_total"),
        D_ARMY_CHG,
        fact_id_derived("trajectory", "0303140K|CYBER", "fy2024_actuals"),
        fact_id_derived("trajectory", "0303140K|CYBER", "fy2025_total"),
        fact_id_derived("trajectory", "0303140K|CYBER", "fy2026_total"),
        D_CYBER_CHG,
    }


def _emit(tmp_path: Path, decade_grains: list | None = None) -> dict:
    db_path = _make_duckdb_with_trajectory(tmp_path)
    json_dir = tmp_path / "json"
    json_dir.mkdir(exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=True)
    try:
        payload = _emit_years_matrix(
            json_dir=json_dir,
            con=con,
            all_prog_rows=_all_prog_rows(),
            detail_rows=_detail_rows(),
            bl_rows=_bl_rows(),
            cited_fact_ids=_cited_fact_ids(),
            decade_grains=decade_grains,
        )
    finally:
        con.close()
    return payload


def _program(payload: dict, pe_bli: str) -> dict:
    for org in payload["orgs"]:
        for p in org["programs"]:
            if p["pe_bli"] == pe_bli:
                return p
    raise AssertionError(f"program {pe_bli} not in matrix")


# ---------------------------------------------------------------------------
# (a) structure
# ---------------------------------------------------------------------------


class TestMatrixStructure:
    def test_creates_years_matrix_json(self, tmp_path):
        payload = _emit(tmp_path)
        path = tmp_path / "json" / "years_matrix.json"
        assert path.exists(), "years_matrix.json was not created"
        on_disk = json.loads(path.read_text())
        assert on_disk == payload

    def test_top_level_contract(self, tmp_path):
        payload = _emit(tmp_path)
        for key in ("schema_version", "program_units", "project_units",
                    "amount_types", "delta_columns", "default_columns",
                    "project_scenarios", "orgs"):
            assert key in payload, f"missing top-level key {key!r}"
        assert payload["program_units"] == "USD thousands"
        assert payload["project_units"] == "USD millions"
        assert payload["delta_columns"] == ["fy2526_change", "fy2526_pct_change"]
        assert payload["project_scenarios"] == {
            "fy2024": "PriorYear",
            "fy2025": "CurrentYear",
            "fy2026": "BudgetYearOne",
        }

    def test_org_sections_sorted_and_programs_grouped(self, tmp_path):
        payload = _emit(tmp_path)
        orgs = [o["org"] for o in payload["orgs"]]
        assert orgs == sorted(orgs)
        assert set(orgs) == {"DARPA", "A", "CYBERCOM"}
        darpa = next(o for o in payload["orgs"] if o["org"] == "DARPA")
        assert [p["pe_bli"] for p in darpa["programs"]] == ["0601101E"]
        prog = darpa["programs"][0]
        assert prog["title"] == "DARPA Research"
        assert isinstance(prog["cells"], dict)
        assert isinstance(prog["projects"], list)

    def test_amount_types_present_in_canonical_order(self, tmp_path):
        """Only amount_types with ≥1 EMITTED cell appear — fy_2025_enacted's
        sole rows are the multi-line uncitable DARPA pair (absent cell), so
        the column is dropped rather than shipped as a dead all-'–' column."""
        payload = _emit(tmp_path)
        assert payload["amount_types"] == [
            "fy_2024_actuals", "fy_2025_total", "fy_2026_total",
        ]

    def test_amount_type_outside_program_set_dropped(self, tmp_path):
        """A workbook amount_type whose only rows belong to pe_blis outside
        the program set (e.g. fy_2025_supplemental live) never becomes a
        column."""
        db_path = _make_duckdb_with_trajectory(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir(exist_ok=True)
        extra = _bl_rows() + [
            _bl_row("ff11000000000099", "9999999X", "OSD",
                    "fy_2025_supplemental", 123.0),
        ]
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            payload = _emit_years_matrix(
                json_dir=json_dir,
                con=con,
                all_prog_rows=_all_prog_rows(),
                detail_rows=_detail_rows(),
                bl_rows=extra,
                cited_fact_ids=_cited_fact_ids() | {"ff11000000000099"},
            )
        finally:
            con.close()
        assert "fy_2025_supplemental" not in payload["amount_types"]


# ---------------------------------------------------------------------------
# (b) program cells — workbook fact_ids
# ---------------------------------------------------------------------------


class TestProgramCells:
    def test_fy24_cell_single_row_workbook_fid(self, tmp_path):
        payload = _emit(tmp_path)
        cell = _program(payload, "0601101E")["cells"]["fy_2024_actuals"]
        assert cell == {"v": 100000.0, "fid": W_DARPA_24}

    def test_org_translation_cybercom(self, tmp_path):
        """CYBERCOM program's cells resolve via workbook org CYBER."""
        payload = _emit(tmp_path)
        cell = _program(payload, "0303140K")["cells"]["fy_2024_actuals"]
        assert cell == {"v": 30000.0, "fid": W_CYBER_24}

    # ---- (d) derived fallbacks ------------------------------------------------

    def test_multirow_trajectory_cell_uses_derived_fid(self, tmp_path):
        """Two fy_2025_total lines → cell is the cited trajectory sum."""
        payload = _emit(tmp_path)
        cell = _program(payload, "0601101E")["cells"]["fy_2025_total"]
        assert cell == {"v": 200000.0, "fid": D_DARPA_25}

    def test_delta_cell_derived_fid(self, tmp_path):
        payload = _emit(tmp_path)
        cell = _program(payload, "0601101E")["cells"]["fy2526_change"]
        assert cell == {"v": 200000.0, "fid": D_DARPA_CHG}

    def test_pct_cell_has_no_fid(self, tmp_path):
        payload = _emit(tmp_path)
        cell = _program(payload, "0601101E")["cells"]["fy2526_pct_change"]
        assert cell == {"v": 100.0}

    def test_zeroed_fy26_renders_zero_not_missing(self, tmp_path):
        """A real 0.0 trajectory value is a value (zeroed program), not '–'."""
        payload = _emit(tmp_path)
        cell = _program(payload, "0602303A")["cells"]["fy_2026_total"]
        assert cell is not None
        assert cell["v"] == 0.0
        assert cell["fid"] == fact_id_derived(
            "trajectory", "0602303A|A", "fy2026_total"
        )

    # ---- (e) honest absences --------------------------------------------------

    def test_missing_values_absent_never_zero(self, tmp_path):
        """Army has no fy_2026_total budget line but DOES have a trajectory
        value (0.0 zeroed) — covered above. A truly missing amount_type
        (fy_2025_enacted for Army) must be absent, not 0."""
        payload = _emit(tmp_path)
        cells = _program(payload, "0602303A")["cells"]
        assert cells.get("fy_2025_enacted") is None

    def test_multirow_nontrajectory_cell_absent(self, tmp_path):
        """Two fy_2025_enacted lines and no derived citation for that
        amount_type → the cell is absent (never an uncited client-side sum)."""
        payload = _emit(tmp_path)
        cells = _program(payload, "0601101E")["cells"]
        assert cells.get("fy_2025_enacted") is None

    def test_no_cell_fabricates_zero(self, tmp_path):
        """Every emitted v corresponds to real data — the ONLY zero program
        cell in this fixture is Army's genuinely-zeroed fy_2026_total."""
        payload = _emit(tmp_path)
        zeros = []
        for org in payload["orgs"]:
            for p in org["programs"]:
                for at, cell in p["cells"].items():
                    if cell is not None and cell["v"] == 0.0:
                        zeros.append((p["pe_bli"], at))
        assert zeros == [("0602303A", "fy_2026_total")]


# ---------------------------------------------------------------------------
# (c) project sub-rows
# ---------------------------------------------------------------------------


class TestProjectCells:
    def test_project_cell_jbook_fid(self, tmp_path):
        payload = _emit(tmp_path)
        projects = _program(payload, "0601101E")["projects"]
        assert len(projects) == 1
        p1 = projects[0]
        assert p1["project_number"] == "P1"
        assert p1["title"] == "Project One"
        assert p1["cells"]["fy2024"] == {"v": 12.5, "fid": J_P1_PRIOR}

    def test_project_zero_amount_cell_state_b(self, tmp_path):
        """zero_amount rows have NO citation — cell carries xp, no fid."""
        payload = _emit(tmp_path)
        p1 = _program(payload, "0601101E")["projects"][0]
        cell = p1["cells"]["fy2026"]
        assert cell["v"] == 0.0
        assert cell.get("fid") is None
        assert cell["xp"] == "ProgramElement[1]/Project[1]"

    def test_project_missing_scenario_absent(self, tmp_path):
        payload = _emit(tmp_path)
        p1 = _program(payload, "0601101E")["projects"][0]
        assert p1["cells"].get("fy2025") is None

    def test_root_rows_are_not_projects(self, tmp_path):
        payload = _emit(tmp_path)
        for org in payload["orgs"]:
            for p in org["programs"]:
                for proj in p["projects"]:
                    assert proj["project_number"] is not None

    def test_program_without_details_has_empty_projects(self, tmp_path):
        payload = _emit(tmp_path)
        assert _program(payload, "0602303A")["projects"] == []


# ---------------------------------------------------------------------------
# (f)+(g) citation shards
# ---------------------------------------------------------------------------


def _citations_dict() -> dict:
    """Minimal citations.json-shaped dict covering the fixture fact_ids."""
    out = {}
    for fid in sorted(_cited_fact_ids()):
        out[fid] = {"kind": "workbook", "units": "USD thousands", "sha256": "x"}
    return out


class TestCiteShards:
    def test_shard_placement_and_union(self, tmp_path):
        json_dir = tmp_path / "json"
        json_dir.mkdir(exist_ok=True)
        cits = _citations_dict()
        n = _emit_cite_shards(json_dir=json_dir, citations_dict=cits)
        shard_dir = json_dir / "cite-shards"
        assert shard_dir.exists()
        files = sorted(shard_dir.glob("*.json"))
        assert len(files) == n

        union: set[str] = set()
        for f in files:
            prefix = f.stem
            assert len(prefix) == 2
            data = json.loads(f.read_text())
            for fid in data:
                assert fid[:2] == prefix, f"{fid} misplaced in shard {prefix}"
            assert union.isdisjoint(data.keys())
            union.update(data.keys())
        assert union == set(cits.keys()), "shard union != citations keys"

    def test_shard_rows_identical_to_citations_dict(self, tmp_path):
        json_dir = tmp_path / "json"
        json_dir.mkdir(exist_ok=True)
        cits = _citations_dict()
        _emit_cite_shards(json_dir=json_dir, citations_dict=cits)
        for fid, obj in cits.items():
            shard = json.loads(
                (json_dir / "cite-shards" / f"{fid[:2]}.json").read_text()
            )
            assert shard[fid] == obj

    def test_matrix_fids_resolve_in_shards(self, tmp_path):
        """(f): every fid referenced by the matrix payload resolves in its
        shard file — the lazy-resolution contract for the /years/ page."""
        payload = _emit(tmp_path)
        json_dir = tmp_path / "json"
        _emit_cite_shards(json_dir=json_dir, citations_dict=_citations_dict())

        fids: set[str] = set()
        for org in payload["orgs"]:
            for p in org["programs"]:
                for cell in p["cells"].values():
                    if cell and cell.get("fid"):
                        fids.add(cell["fid"])
                for proj in p["projects"]:
                    for cell in proj["cells"].values():
                        if cell and cell.get("fid"):
                            fids.add(cell["fid"])
        assert fids, "matrix references no fact_ids — fixture broken"
        for fid in fids:
            shard_path = json_dir / "cite-shards" / f"{fid[:2]}.json"
            assert shard_path.exists(), f"shard missing for {fid}"
            assert fid in json.loads(shard_path.read_text())


# ---------------------------------------------------------------------------
# (h) size budget
# ---------------------------------------------------------------------------


class TestSizeBudget:
    def test_size_budget_guard_raises_loudly(self, tmp_path, monkeypatch):
        import govbudget.export_site as es
        monkeypatch.setattr(es, "_YEARS_MATRIX_MAX_BYTES", 10)
        with pytest.raises(ValueError, match="years_matrix.json"):
            _emit(tmp_path)

    @pytest.mark.skipif(
        not (_ROOT / "data" / "site" / "json" / "years_matrix.json").exists(),
        reason="live export not present",
    )
    def test_live_payload_under_budget(self):
        """Phase 5E raised the budget 900 KB → 2 MB (spec §6: ~7 more decade
        columns × existing rows). Phase 5G raised it 2 MB → 4 MB across two
        rounds: the Navy J-books grew the detail-grade matrix ~462 → 813
        programs, then the Army/AF/SF archive round grew it 813 → ~1,741
        programs (~2.7–3.0 MB) at the SAME per-program density — legitimate
        corpus growth, not a design regression. Pinned to the exporter's own
        _YEARS_MATRIX_MAX_BYTES so this test and the exporter never drift."""
        import govbudget.export_site as es

        path = _ROOT / "data" / "site" / "json" / "years_matrix.json"
        size = path.stat().st_size
        assert size < es._YEARS_MATRIX_MAX_BYTES, (
            f"years_matrix.json is {size} bytes "
            f"(≥ {es._YEARS_MATRIX_MAX_BYTES}-byte budget)"
        )


# ---------------------------------------------------------------------------
# Phase 5E Task 6: decade columns (edition-honest FY2015A…FY2026R)
# ---------------------------------------------------------------------------


class TestDecadeColumns:
    def test_no_decade_grains_no_decade_keys(self, tmp_path):
        """Backward compat: without decade grains the payload is byte-stable
        with the 5D shape — no decade_columns/decade_default_columns keys."""
        payload = _emit(tmp_path)
        assert "decade_columns" not in payload
        assert "decade_default_columns" not in payload

    def test_decade_columns_header_carries_edition(self, tmp_path):
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        cols = {c["key"]: c for c in payload["decade_columns"]}
        assert cols["fy2020a"] == {
            "key": "fy2020a", "fy": 2020, "kind": "actuals", "edition": 2022,
        }
        for c in payload["decade_columns"]:
            assert isinstance(c["edition"], int), f"{c['key']} missing edition"

    def test_decade_columns_only_emitted_columns(self, tmp_path):
        """Columns appear only when ≥1 cited cell exists among matrix
        programs (no dead all-dash columns); ordering is (fy, kind)."""
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        keys = [c["key"] for c in payload["decade_columns"]]
        assert keys == ["fy2015a", "fy2020a", "fy2025e", "fy2026r"]

    def test_decade_default_columns_spec_order(self, tmp_path):
        """Default set = FY(e-2)A per edition + latest-edition FY(L-1)E and
        FY(L)R, filtered to present columns (spec §1: ≈12 with the full
        2017–2026 edition run)."""
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        assert payload["decade_default_columns"] == [
            "fy2015a", "fy2020a", "fy2025e", "fy2026r",
        ]

    def test_fy2020a_cell_value_and_fid_from_pb2022(self, tmp_path):
        """The FY2020A cell comes from the PB2022 edition (PB(N+2) rule) —
        value + fid are the fct_decade_series grain's."""
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        cell = _program(payload, "0601101E")["cells"]["fy2020a"]
        assert cell == {"v": 150000.0, "fid": W_DEC_20A}
        col = next(c for c in payload["decade_columns"] if c["key"] == "fy2020a")
        assert col["edition"] == 2022

    def test_multi_source_grain_uses_derived_decade_fid(self, tmp_path):
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        cell = _program(payload, "0601101E")["cells"]["fy2015a"]
        assert cell == {"v": 90000.0, "fid": D_DEC_15A}

    def test_absent_edition_cell_absent_never_zero(self, tmp_path):
        """A PE absent from an edition has NO cell for that column — missing
        renders '–', never 0."""
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        army = _program(payload, "0602303A")["cells"]
        assert "fy2020a" not in army
        assert "fy2015a" not in army
        # and no decade cell anywhere fabricates a zero
        for org in payload["orgs"]:
            for p in org["programs"]:
                for key, cell in p["cells"].items():
                    if key[:2] == "fy" and key[-1] in "aer" and "_" not in key:
                        assert cell["v"] != 0.0 or key == "fy_2026_total"

    def test_uncited_decade_cell_absent(self, tmp_path):
        """A grain whose fid has no citation row NEVER becomes a cell."""
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        cyber = _program(payload, "0303140K")["cells"]
        assert "fy2020a" not in cyber

    def test_existing_columns_unchanged_by_decade(self, tmp_path):
        """amount_types / default_columns / delta_columns are byte-identical
        with and without decade grains — existing /years/ consumers render
        unchanged until Task 7 adopts the decade keys."""
        base_dir = tmp_path / "base"
        dec_dir = tmp_path / "dec"
        base_dir.mkdir()
        dec_dir.mkdir()
        base = _emit(base_dir)
        withd = _emit(dec_dir, decade_grains=_decade_grains())
        assert withd["amount_types"] == base["amount_types"]
        assert withd["default_columns"] == base["default_columns"]
        assert withd["delta_columns"] == base["delta_columns"]
        for key in ("fy2015a", "fy2020a", "fy2025e", "fy2026r"):
            assert key not in withd["amount_types"]

    def test_conflicting_edition_for_column_raises(self, tmp_path):
        """Two grains mapping one column key to different editions is data
        corruption (the edition-authoritative rule makes the mapping unique)
        — the exporter must fail loudly, never emit an ambiguous column."""
        bad = _decade_grains() + [
            ("0602303A", 2020, 2023, "actuals", 1.0, W_ARMY_24,
             "fy_2020_actuals"),
        ]
        with pytest.raises(ValueError, match="edition"):
            _emit(tmp_path, decade_grains=bad)

    def test_decade_fids_resolve_in_shards(self, tmp_path):
        """Every decade cell fid resolves in its cite-shard (the /years/
        lazy-resolution contract extends to decade columns)."""
        payload = _emit(tmp_path, decade_grains=_decade_grains())
        json_dir = tmp_path / "json"
        _emit_cite_shards(json_dir=json_dir, citations_dict=_citations_dict())
        for org in payload["orgs"]:
            for p in org["programs"]:
                for key, cell in p["cells"].items():
                    if cell and cell.get("fid"):
                        shard = json_dir / "cite-shards" / f"{cell['fid'][:2]}.json"
                        assert shard.exists(), f"shard missing for {cell['fid']}"
                        assert cell["fid"] in json.loads(shard.read_text())


class TestDecadeLive:
    """Live-payload checks (skipped until the 5E export lands)."""

    _live = _ROOT / "data" / "site" / "json" / "years_matrix.json"

    @pytest.mark.skipif(not _live.exists(), reason="live export not present")
    def test_live_decade_header_editions(self):
        payload = json.loads(self._live.read_text())
        if "decade_columns" not in payload:
            pytest.skip("live payload predates the 5E decade export")
        cols = {c["key"]: c for c in payload["decade_columns"]}
        # the edition-authoritative rule: actuals for FY N come from PB(N+2)
        assert cols["fy2020a"]["edition"] == 2022
        assert cols["fy2015a"]["edition"] == 2017
        for c in payload["decade_columns"]:
            if c["kind"] == "actuals":
                assert c["edition"] == c["fy"] + 2
            elif c["kind"] == "enacted":
                assert c["edition"] == c["fy"] + 1
            else:
                assert c["edition"] == c["fy"]

    @pytest.mark.skipif(not _live.exists(), reason="live export not present")
    def test_live_decade_default_columns(self):
        payload = json.loads(self._live.read_text())
        if "decade_default_columns" not in payload:
            pytest.skip("live payload predates the 5E decade export")
        # FY2015A…FY2024A + FY2025E + FY2026R (spec §1 — 12 columns)
        expected = [f"fy{y}a" for y in range(2015, 2025)] + ["fy2025e", "fy2026r"]
        assert payload["decade_default_columns"] == expected

    @pytest.mark.skipif(not _live.exists(), reason="live export not present")
    def test_live_decade_cell_fids_resolve_in_shards(self):
        payload = json.loads(self._live.read_text())
        if "decade_columns" not in payload:
            pytest.skip("live payload predates the 5E decade export")
        decade_keys = {c["key"] for c in payload["decade_columns"]}
        shard_dir = _ROOT / "data" / "site" / "json" / "cite-shards"
        checked = 0
        for org in payload["orgs"]:
            for p in org["programs"]:
                for key in decade_keys & set(p["cells"].keys()):
                    fid = p["cells"][key].get("fid")
                    assert fid, f"decade cell {p['pe_bli']}/{key} lacks fid"
                    shard = json.loads((shard_dir / f"{fid[:2]}.json").read_text())
                    assert fid in shard, f"{fid} unresolvable in shard"
                    checked += 1
                    if checked >= 25:
                        return
        assert checked, "no decade cells found in live payload"


# ---------------------------------------------------------------------------
# (g) program-lineage — sparse family_id overlay (Task 8, /years/ badge)
# ---------------------------------------------------------------------------


class TestFamilyOverlay:
    """The `families` kwarg threads a sparse pe_bli→family_id map into the
    program dicts. It is a UI-only overlay for the /years/ family-thread
    badge — never a column, cell value, or CSV field."""

    def test_family_id_present_only_for_mapped_pes(self, tmp_path):
        db_path = _make_duckdb_with_trajectory(tmp_path)
        json_dir = tmp_path / "json"
        json_dir.mkdir(exist_ok=True)
        con = duckdb.connect(str(db_path), read_only=True)
        try:
            payload = _emit_years_matrix(
                json_dir=json_dir,
                con=con,
                all_prog_rows=_all_prog_rows(),
                detail_rows=_detail_rows(),
                bl_rows=_bl_rows(),
                cited_fact_ids=_cited_fact_ids(),
                # Two PEs share family 7; 0602303A is lone (absent from map).
                families={"0601101E": 7, "0303140K": 7},
            )
        finally:
            con.close()
        assert _program(payload, "0601101E")["family_id"] == 7
        assert _program(payload, "0303140K")["family_id"] == 7
        # Lone PE has NO family_id key (sparse — not None, absent).
        assert "family_id" not in _program(payload, "0602303A")

    def test_no_families_map_emits_no_family_id(self, tmp_path):
        """Default (no `families`) → no program carries family_id at all."""
        payload = _emit(tmp_path)  # _emit passes no families kwarg
        for org in payload["orgs"]:
            for p in org["programs"]:
                assert "family_id" not in p
