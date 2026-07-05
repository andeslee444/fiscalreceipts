"""Tests for Phase 5B-3 Task 8a: categories.json sidecar.

TDD scope:
  - _emit_categories_sidecar: flat {pe_bli: category} mapping from
    data-seeds/program_categories.csv; enum filtering; graceful empty file
    when the seed is absent.
  - The committed seed itself: 50 rows, every category within the gate enum
    (the sidecar is a verbatim copy of the seed's category column, so the
    seed's integrity is what the site ships).
"""
from __future__ import annotations

import json
from pathlib import Path

from govbudget.dossiers.gate import CATEGORY_ENUM
from govbudget.export_site import _emit_categories_sidecar

REPO_ROOT = Path(__file__).resolve().parents[1]
SEED_CSV = REPO_ROOT / "data-seeds" / "program_categories.csv"


def _write_csv(path: Path, rows: list[dict]) -> None:
    import csv

    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["pe_bli", "category", "rationale", "source_ref"]
        )
        writer.writeheader()
        writer.writerows(rows)


class TestEmitCategoriesSidecar:
    def test_maps_pe_bli_to_category(self, tmp_path):
        csv_path = tmp_path / "program_categories.csv"
        _write_csv(
            csv_path,
            [
                {"pe_bli": "0603183D8Z", "category": "hypersonics",
                 "rationale": "JHTO", "source_ref": "ProgramElement[22]"},
                {"pe_bli": "0306250JCY", "category": "cyber",
                 "rationale": "CYBERCOM", "source_ref": "ProgramElement[7]"},
                {"pe_bli": "0607210D8Z", "category": "default",
                 "rationale": "broad", "source_ref": "ProgramElement[116]"},
            ],
        )
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        _emit_categories_sidecar(json_dir=json_dir, categories_csv=csv_path)

        obj = json.loads((json_dir / "categories.json").read_text())
        assert obj == {
            "0603183D8Z": "hypersonics",
            "0306250JCY": "cyber",
            "0607210D8Z": "default",
        }

    def test_skips_rows_outside_enum_or_blank(self, tmp_path):
        csv_path = tmp_path / "program_categories.csv"
        _write_csv(
            csv_path,
            [
                {"pe_bli": "0601101E", "category": "drones",
                 "rationale": "x", "source_ref": "ProgramElement[1]"},
                {"pe_bli": "0602702E", "category": "not-a-category",
                 "rationale": "x", "source_ref": "ProgramElement[2]"},
                {"pe_bli": "", "category": "space",
                 "rationale": "x", "source_ref": "ProgramElement[3]"},
                {"pe_bli": "0603286E", "category": "",
                 "rationale": "x", "source_ref": "ProgramElement[4]"},
            ],
        )
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        _emit_categories_sidecar(json_dir=json_dir, categories_csv=csv_path)

        obj = json.loads((json_dir / "categories.json").read_text())
        assert obj == {"0601101E": "drones"}

    def test_missing_seed_writes_empty_mapping(self, tmp_path):
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        _emit_categories_sidecar(
            json_dir=json_dir, categories_csv=tmp_path / "nope.csv"
        )
        obj = json.loads((json_dir / "categories.json").read_text())
        assert obj == {}


class TestCommittedSeed:
    """The committed taxonomy seed is what the sidecar ships — verify it."""

    def test_seed_has_50_rows_all_in_enum(self):
        import csv

        with SEED_CSV.open(newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        assert len(rows) == 50
        for row in rows:
            assert row["pe_bli"].strip()
            assert row["category"].strip() in CATEGORY_ENUM

    def test_seed_emits_verbatim(self, tmp_path):
        json_dir = tmp_path / "json"
        json_dir.mkdir()
        _emit_categories_sidecar(json_dir=json_dir, categories_csv=SEED_CSV)
        obj = json.loads((json_dir / "categories.json").read_text())
        assert len(obj) == 50
        assert obj["1203154SF"] == "space"
        assert obj["0306250JCY"] == "cyber"
        assert obj["1000"] == "shipbuilding"
        assert sorted(set(obj.values()) - {"default"}) == [
            "cyber", "shipbuilding", "space",
        ]
