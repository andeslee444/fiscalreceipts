"""Curated corporate-family events (PM Sprint 2, §P1-3).

The defect: `/companies/` listed RAYTHEON COMPANY ($43.7B, #4) and RTX CORP
($24.6B, #6) as two families. These tests pin the curated layer that merges
them — its validation, its exact-match resolution, and above all its refusal
to double count.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from govbudget.config import ROOT
from govbudget.entities import normalize_name
from govbudget.entity_families import (
    EVENT_KINDS,
    REQUIRED_COLUMNS,
    FamilyEventsError,
    load_family_events,
    resolve_families,
    slugify,
)

SEED = ROOT / "data-seeds" / "entity_family_events.csv"

HEADER = ",".join(REQUIRED_COLUMNS)


def write_csv(tmp_path: Path, *rows: str) -> Path:
    p = tmp_path / "events.csv"
    p.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return p


ROW = (
    "RTX,Raytheon Company,RTX Corporation,rename,2023-07-17,"
    "https://www.sec.gov/x.htm,note"
)


# ── the shipped seed ────────────────────────────────────────────────────────


def test_shipped_seed_loads():
    events = load_family_events(SEED)
    assert len(events) >= 10, "the curated table is the publishable asset"


def test_shipped_seed_covers_the_pm_repro():
    events = load_family_events(SEED)
    renames = [
        e
        for e in events
        if normalize_name(e.from_name) == "RAYTHEON TECHNOLOGIES"
        and normalize_name(e.to_name) == "RTX"
    ]
    assert renames, "the Raytheon→RTX rename must be curated"
    assert renames[0].event == "rename"
    assert renames[0].effective_date == "2023-07-17"


def test_shipped_seed_every_source_is_an_official_document():
    """Official press release or SEC filing — not a warehouse citation, and
    not a blog. The page renders these as external references."""
    events = load_family_events(SEED)
    for e in events:
        assert e.source_url.startswith("https://"), e.source_url
        host = e.source_url.split("/")[2]
        assert (
            host.endswith("sec.gov")
            or host.endswith("lockheedmartin.com")
            or host.endswith("teledyne.com")
            or host.endswith("globenewswire.com")
        ), f"{e.from_name}: unexpected source host {host}"


def test_shipped_seed_named_families_are_present():
    """The plan's named events (locked design) are all curated."""
    events = load_family_events(SEED)
    labels = {e.family for e in events}
    for expected in (
        "RTX",
        "L3Harris Technologies",
        "Northrop Grumman",
        "Lockheed Martin",
    ):
        assert expected in labels


def test_shipped_seed_has_no_duplicate_event_rows():
    with SEED.open(newline="", encoding="utf-8") as fh:
        rows = [
            (r["from_name"], r["to_name"], r["effective_date"])
            for r in csv.DictReader(fh)
        ]
    assert len(rows) == len(set(rows))


# ── validation is loud ──────────────────────────────────────────────────────


def test_missing_file_raises():
    with pytest.raises(FamilyEventsError, match="seed missing"):
        load_family_events(Path("/nonexistent/events.csv"))


def test_wrong_columns_raise(tmp_path):
    p = tmp_path / "events.csv"
    p.write_text("family,from_name\nRTX,Raytheon\n", encoding="utf-8")
    with pytest.raises(FamilyEventsError, match="columns"):
        load_family_events(p)


def test_unknown_event_kind_raises(tmp_path):
    p = write_csv(
        tmp_path,
        "RTX,Raytheon Company,RTX Corporation,spinoff,2023-07-17,https://x/y,n",
    )
    with pytest.raises(FamilyEventsError, match="not in"):
        load_family_events(p)


def test_bad_date_raises(tmp_path):
    p = write_csv(
        tmp_path,
        "RTX,Raytheon Company,RTX Corporation,rename,July 2023,https://x/y,n",
    )
    with pytest.raises(FamilyEventsError, match="YYYY-MM-DD"):
        load_family_events(p)


def test_impossible_date_raises(tmp_path):
    p = write_csv(
        tmp_path,
        "RTX,Raytheon Company,RTX Corporation,rename,2023-02-30,https://x/y,n",
    )
    with pytest.raises(FamilyEventsError):
        load_family_events(p)


def test_non_https_source_raises(tmp_path):
    p = write_csv(
        tmp_path,
        "RTX,Raytheon Company,RTX Corporation,rename,2023-07-17,http://x/y,n",
    )
    with pytest.raises(FamilyEventsError, match="https"):
        load_family_events(p)


def test_empty_cell_raises(tmp_path):
    p = write_csv(
        tmp_path, "RTX,Raytheon Company,RTX Corporation,rename,2023-07-17,https://x/y,"
    )
    with pytest.raises(FamilyEventsError, match="empty note"):
        load_family_events(p)


def test_no_op_event_raises(tmp_path):
    """from and to normalizing identically records no event at all."""
    p = write_csv(
        tmp_path, "RTX,RTX Corporation,RTX Corp,rename,2023-07-17,https://x/y,n"
    )
    with pytest.raises(FamilyEventsError, match="no event"):
        load_family_events(p)


def test_empty_file_raises(tmp_path):
    p = write_csv(tmp_path)
    with pytest.raises(FamilyEventsError, match="no rows"):
        load_family_events(p)


def test_event_kind_vocabulary_is_locked():
    assert EVENT_KINDS == ("rename", "acquisition")


# ── resolution ──────────────────────────────────────────────────────────────


KNOWN = {
    "RAYTHEON",
    "RTX",
    "ROCKWELL COLLINS",
    "NORTHROP GRUMMAN",
    "NORTHROP GRUMMAN INNOVATION SYSTEMS",
}


def test_resolution_is_exact_normalized_equality(tmp_path):
    p = write_csv(tmp_path, ROW)
    [fam] = resolve_families(load_family_events(p), KNOWN)
    # Membership, not order — the exporter ranks members by obligation size.
    assert set(fam.member_keys) == {"RTX", "RAYTHEON"}


def test_unresolved_endpoints_are_recorded_not_guessed(tmp_path):
    p = write_csv(
        tmp_path,
        "Northrop Grumman,\"Orbital ATK, Inc.\",Northrop Grumman Innovation Systems LLC,"
        "acquisition,2018-06-06,https://x/y,n",
    )
    [fam] = resolve_families(load_family_events(p), KNOWN)
    ev = fam.events[0]
    assert ev.from_endpoint.resolved is False
    assert ev.from_endpoint.name == "Orbital ATK, Inc."
    assert ev.to_endpoint.family_key == "NORTHROP GRUMMAN INNOVATION SYSTEMS"
    # the anchor is a member even though only one endpoint resolved
    assert "NORTHROP GRUMMAN" in fam.member_keys


def test_no_fuzzy_matching(tmp_path):
    """A near-miss must NOT resolve — a wrong merge is worse than no merge."""
    p = write_csv(
        tmp_path,
        "RTX,Raytheon Technical Services,RTX Corporation,rename,2023-07-17,https://x/y,n",
    )
    [fam] = resolve_families(load_family_events(p), KNOWN)
    assert fam.events[0].from_endpoint.resolved is False
    assert "RAYTHEON" not in fam.member_keys


def test_a_family_key_in_two_families_is_a_load_error(tmp_path):
    """The seed-level form of a double count."""
    p = write_csv(
        tmp_path,
        ROW,
        "Northrop Grumman,Raytheon Company,Northrop Grumman Innovation Systems LLC,"
        "acquisition,2018-06-06,https://x/y,n",
    )
    with pytest.raises(FamilyEventsError, match="double-count"):
        resolve_families(load_family_events(p), KNOWN)


def test_members_are_deduped(tmp_path):
    p = write_csv(
        tmp_path,
        ROW,
        "RTX,\"Rockwell Collins, Inc.\",RTX Corporation,acquisition,2018-11-26,https://x/y,n",
    )
    [fam] = resolve_families(load_family_events(p), KNOWN)
    assert len(fam.member_keys) == len(set(fam.member_keys))
    assert set(fam.member_keys) == {"RTX", "RAYTHEON", "ROCKWELL COLLINS"}


def test_slugify():
    assert slugify("L3Harris Technologies") == "l3harris-technologies"
    assert slugify("Science Applications International") == (
        "science-applications-international"
    )
    assert slugify("V2X") == "v2x"


def test_slugs_are_unique_in_the_shipped_seed():
    fams = resolve_families(load_family_events(SEED), set())
    slugs = [f.slug for f in fams]
    assert len(slugs) == len(set(slugs))


def test_shipped_seed_resolves_the_raytheon_rtx_merge_against_real_keys():
    """The PM's exact repro, against the real warehouse family keys."""
    fams = resolve_families(
        load_family_events(SEED),
        {"RAYTHEON", "RTX", "ROCKWELL COLLINS", "ROCKWELL COLLINS AUSTRALIA"},
    )
    rtx = next(f for f in fams if f.label == "RTX")
    assert "RAYTHEON" in rtx.member_keys
    assert "RTX" in rtx.member_keys
