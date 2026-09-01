"""Curated published labels for company families (ROADMAP #10, option A).

The defect: `/companies/families/` and `/company/{slug}/` published
`dim_entities.display_name`, an argmax over registered parent names. 15 of the
200 published families ($255.2B) carry a label that beat its runner-up by under
15%, and the flagship — `ROCKWELL COLLINS AUSTRALIA`, 97.3% RAYTHEON COMPANY —
won by 3.1% with a registration RTX had already reverted.

These tests pin the alias layer that corrects it: its validation, its refusal
to accept a source on a row that claims none, and the shipped seed itself.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from govbudget.config import ROOT
from govbudget.entity_display_aliases import (
    EVIDENCE_KINDS,
    MIN_NOTE_CHARS,
    REQUIRED_COLUMNS,
    DisplayAliasError,
    alias_map,
    assert_keys_known,
    load_display_aliases,
)

SEED = ROOT / "data-seeds" / "entity_display_aliases.csv"

HEADER = ",".join(REQUIRED_COLUMNS)

LONG_NOTE = "x" * MIN_NOTE_CHARS


def write_csv(tmp_path: Path, *rows: str) -> Path:
    p = tmp_path / "aliases.csv"
    p.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return p


def row(
    family_key: str = "ROCKWELL COLLINS AUSTRALIA",
    display_name: str = "RTX (Raytheon Company registrations)",
    *,
    evidence: str = "measured",
    source_url: str = "",
    source_form: str = "",
    source_date: str = "",
    measured_on: str = "2026-09-01",
    note: str = LONG_NOTE,
) -> str:
    cells = [
        family_key,
        display_name,
        evidence,
        source_url,
        source_form,
        source_date,
        measured_on,
        note,
    ]
    return ",".join('"' + c.replace('"', '""') + '"' for c in cells)


# ── The shipped seed ────────────────────────────────────────────────────────


def test_shipped_seed_loads():
    aliases = load_display_aliases(SEED)
    assert aliases, "the shipped alias seed is empty"
    assert len({a.family_key for a in aliases}) == len(aliases)


def test_shipped_seed_covers_the_flagship():
    """The defect that occasioned the layer must actually be fixed by it."""
    labels = alias_map(load_display_aliases(SEED))
    assert "ROCKWELL COLLINS AUSTRALIA" in labels
    assert "ROCKWELL" not in labels["ROCKWELL COLLINS AUSTRALIA"].upper()


def test_shipped_seed_keys_are_warehouse_keys_not_names():
    """family_key is the warehouse key verbatim — upper case, no punctuation.

    A curator who writes a company NAME here would produce a row that resolves
    to nothing and ships looking like a fix.
    """
    for a in load_display_aliases(SEED):
        assert a.family_key == a.family_key.upper(), a.family_key
        assert a.family_key.strip() == a.family_key


def test_shipped_seed_unsourced_rows_carry_no_source():
    for a in load_display_aliases(SEED):
        if a.evidence == "sourced":
            assert a.source_url.startswith("https://")
        else:
            assert (a.source_url, a.source_form, a.source_date) == ("", "", "")


# ── Validation ──────────────────────────────────────────────────────────────


def test_columns_must_match_exactly(tmp_path):
    p = tmp_path / "aliases.csv"
    p.write_text("family_key,display_name\nA,B\n", encoding="utf-8")
    with pytest.raises(DisplayAliasError, match="columns"):
        load_display_aliases(p)


def test_missing_file_raises(tmp_path):
    with pytest.raises(DisplayAliasError, match="missing"):
        load_display_aliases(tmp_path / "nope.csv")


def test_empty_seed_raises(tmp_path):
    with pytest.raises(DisplayAliasError, match="no rows"):
        load_display_aliases(write_csv(tmp_path))


def test_unknown_evidence_kind_raises(tmp_path):
    with pytest.raises(DisplayAliasError, match="evidence"):
        load_display_aliases(write_csv(tmp_path, row(evidence="measured-contents")))


def test_evidence_kinds_are_this_module_s_own():
    """Not entity_families.EVIDENCE_KINDS — that field types something else.

    `name-inferred` types whether a DOCUMENT names the parties to a corporate
    event. No alias row is about an event, and reusing that vocabulary is how
    a finding gets written into a field that means something different.
    """
    assert EVIDENCE_KINDS == ("sourced", "measured", "pin")


def test_duplicate_family_key_raises(tmp_path):
    with pytest.raises(DisplayAliasError, match="already"):
        load_display_aliases(
            write_csv(tmp_path, row(display_name="One thing"), row(display_name="Other"))
        )


def test_shouted_alias_raises(tmp_path):
    """An all-caps alias means the curator meant the registry string."""
    with pytest.raises(DisplayAliasError, match="lower-case"):
        load_display_aliases(write_csv(tmp_path, row(display_name="RTX CORP")))


def test_measured_row_may_not_carry_a_source(tmp_path):
    with pytest.raises(DisplayAliasError, match="source_url"):
        load_display_aliases(
            write_csv(tmp_path, row(source_url="https://www.sec.gov/x.htm"))
        )


def test_pin_row_may_not_carry_a_source(tmp_path):
    with pytest.raises(DisplayAliasError, match="source_form"):
        load_display_aliases(
            write_csv(tmp_path, row(evidence="pin", source_form="8-K"))
        )


def test_sourced_row_requires_https(tmp_path):
    with pytest.raises(DisplayAliasError, match="https"):
        load_display_aliases(
            write_csv(
                tmp_path,
                row(
                    evidence="sourced",
                    source_url="http://sec.gov/x.htm",
                    source_form="8-K",
                    source_date="2023-07-17",
                ),
            )
        )


def test_sourced_row_requires_the_whole_trio(tmp_path):
    with pytest.raises(DisplayAliasError, match="empty source_form"):
        load_display_aliases(
            write_csv(
                tmp_path,
                row(evidence="sourced", source_url="https://www.sec.gov/x.htm"),
            )
        )


def test_measured_on_must_be_iso(tmp_path):
    with pytest.raises(DisplayAliasError, match="measured_on"):
        load_display_aliases(write_csv(tmp_path, row(measured_on="Sept 1 2026")))


def test_measurement_cannot_predate_its_source(tmp_path):
    with pytest.raises(DisplayAliasError, match="precedes"):
        load_display_aliases(
            write_csv(
                tmp_path,
                row(
                    evidence="sourced",
                    source_url="https://www.sec.gov/x.htm",
                    source_form="8-K",
                    source_date="2023-07-17",
                    measured_on="2020-01-01",
                ),
            )
        )


def test_a_shrug_is_not_a_reason(tmp_path):
    with pytest.raises(DisplayAliasError, match="characters"):
        load_display_aliases(write_csv(tmp_path, row(note="it looked wrong")))


def test_relabels_property_separates_pins_from_relabels(tmp_path):
    aliases = load_display_aliases(
        write_csv(
            tmp_path,
            row(family_key="A ONE", display_name="A one"),
            row(family_key="A TWO", display_name="A two", evidence="pin"),
        )
    )
    assert [a.relabels for a in aliases] == [True, False]


# ── Key resolution ──────────────────────────────────────────────────────────


def test_unknown_family_key_raises_rather_than_being_dropped(tmp_path):
    aliases = load_display_aliases(write_csv(tmp_path, row(family_key="NOT A FAMILY")))
    with pytest.raises(DisplayAliasError, match="not in dim_entities"):
        assert_keys_known(aliases, {"ROCKWELL COLLINS AUSTRALIA"})


def test_known_family_keys_pass(tmp_path):
    aliases = load_display_aliases(write_csv(tmp_path, row()))
    assert_keys_known(aliases, {"ROCKWELL COLLINS AUSTRALIA", "RTX"})


def test_seed_is_rfc4180_parseable_with_the_stdlib():
    """The gate re-parses this file in Node; both readers must see one shape."""
    with SEED.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == len(load_display_aliases(SEED))
