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
    EVIDENCE_KINDS,
    REQUIRED_COLUMNS,
    FamilyEventsError,
    event_changed_keys,
    load_family_events,
    member_arrivals,
    resolve_families,
    slugify,
)

SEED = ROOT / "data-seeds" / "entity_family_events.csv"

HEADER = ",".join(REQUIRED_COLUMNS)


def write_csv(tmp_path: Path, *rows: str) -> Path:
    p = tmp_path / "events.csv"
    p.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return p


def row(
    family: str,
    from_name: str,
    to_name: str,
    event: str = "rename",
    effective_date: str = "2023-07-17",
    *,
    evidence: str = "sourced",
    source_url: str = "https://www.sec.gov/x.htm",
    source_form: str = "8-K",
    source_date: str = "2023-07-17",
    source_verified: str = "2026-08-04",
    note: str = "note",
) -> str:
    """One seed line with the chain-of-custody columns defaulted.

    Fields are quoted so a test can pass a name containing a comma.
    """
    cells = [
        family,
        from_name,
        to_name,
        event,
        effective_date,
        evidence,
        source_url,
        source_form,
        source_date,
        source_verified,
        note,
    ]
    return ",".join(f'"{c}"' for c in cells)


ROW = row("RTX", "Raytheon Company", "RTX Corporation")


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
        row("RTX", "Raytheon Company", "RTX Corporation", "spinoff"),
    )
    with pytest.raises(FamilyEventsError, match="not in"):
        load_family_events(p)


def test_unknown_evidence_kind_raises(tmp_path):
    """A row must declare whether its source names THESE parties (fix round)."""
    p = write_csv(
        tmp_path,
        row("RTX", "Raytheon Company", "RTX Corporation", evidence="probably"),
    )
    with pytest.raises(FamilyEventsError, match="evidence"):
        load_family_events(p)


def test_bad_date_raises(tmp_path):
    p = write_csv(
        tmp_path,
        row("RTX", "Raytheon Company", "RTX Corporation", "rename", "July 2023"),
    )
    with pytest.raises(FamilyEventsError, match="YYYY-MM-DD"):
        load_family_events(p)


def test_bad_source_date_raises(tmp_path):
    p = write_csv(
        tmp_path,
        row("RTX", "Raytheon Company", "RTX Corporation", source_date="July 2023"),
    )
    with pytest.raises(FamilyEventsError, match="source_date"):
        load_family_events(p)


def test_source_verified_before_source_date_raises(tmp_path):
    """A row cannot have been checked before its source existed."""
    p = write_csv(
        tmp_path,
        row(
            "RTX",
            "Raytheon Company",
            "RTX Corporation",
            source_date="2023-07-17",
            source_verified="2019-01-01",
        ),
    )
    with pytest.raises(FamilyEventsError, match="precedes"):
        load_family_events(p)


def test_impossible_date_raises(tmp_path):
    p = write_csv(
        tmp_path,
        row("RTX", "Raytheon Company", "RTX Corporation", "rename", "2023-02-30"),
    )
    with pytest.raises(FamilyEventsError):
        load_family_events(p)


def test_non_https_source_raises(tmp_path):
    p = write_csv(
        tmp_path,
        row("RTX", "Raytheon Company", "RTX Corporation", source_url="http://x/y"),
    )
    with pytest.raises(FamilyEventsError, match="https"):
        load_family_events(p)


def test_empty_cell_raises(tmp_path):
    p = write_csv(
        tmp_path, row("RTX", "Raytheon Company", "RTX Corporation", note="")
    )
    with pytest.raises(FamilyEventsError, match="empty note"):
        load_family_events(p)


def test_no_op_event_raises(tmp_path):
    """from and to normalizing identically records no event at all."""
    p = write_csv(tmp_path, row("RTX", "RTX Corporation", "RTX Corp"))
    with pytest.raises(FamilyEventsError, match="no event"):
        load_family_events(p)


def test_empty_file_raises(tmp_path):
    p = write_csv(tmp_path)
    with pytest.raises(FamilyEventsError, match="no rows"):
        load_family_events(p)


def test_event_kind_vocabulary_is_locked():
    assert EVENT_KINDS == ("rename", "acquisition", "merger")


def test_evidence_vocabulary_is_locked():
    assert EVIDENCE_KINDS == ("sourced", "name-inferred")


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
        row(
            "Northrop Grumman",
            "Orbital ATK, Inc.",
            "Northrop Grumman Innovation Systems LLC",
            "acquisition",
            "2018-06-06",
        ),
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
        row("RTX", "Raytheon Technical Services", "RTX Corporation"),
    )
    [fam] = resolve_families(load_family_events(p), KNOWN)
    assert fam.events[0].from_endpoint.resolved is False
    assert "RAYTHEON" not in fam.member_keys


def test_a_family_key_in_two_families_is_a_load_error(tmp_path):
    """The seed-level form of a double count."""
    p = write_csv(
        tmp_path,
        ROW,
        row(
            "Northrop Grumman",
            "Raytheon Company",
            "Northrop Grumman Innovation Systems LLC",
            "acquisition",
            "2018-06-06",
        ),
    )
    with pytest.raises(FamilyEventsError, match="double-count"):
        resolve_families(load_family_events(p), KNOWN)


def test_members_are_deduped(tmp_path):
    p = write_csv(
        tmp_path,
        ROW,
        row(
            "RTX",
            "Rockwell Collins, Inc.",
            "RTX Corporation",
            "acquisition",
            "2018-11-26",
        ),
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


# ── per-member arrival: the Exelis defect (Sprint 2 visual-judge fix round) ──


def test_exelis_carries_its_own_2015_event_not_the_2019_merger():
    """THE repro. /companies/ hung one trailing label off the whole member
    list, so EXELIS INC. read "acquired 2019" — the Harris/L3 merger date.
    Harris acquired Exelis in **2015**; the 2019 event is a different one."""
    fams = resolve_families(
        load_family_events(SEED),
        {"EXELIS", "L3 TECHNOLOGIES", "L3HARRIS TECHNOLOGIES"},
    )
    l3h = next(f for f in fams if f.label == "L3Harris Technologies")
    arrivals = member_arrivals(l3h)
    exelis = l3h.events[arrivals["EXELIS"].event_index].event
    assert exelis.effective_date == "2015-05-29"
    assert exelis.event == "acquisition"
    l3 = l3h.events[arrivals["L3 TECHNOLOGIES"].event_index].event
    assert l3.effective_date == "2019-06-29"


def test_rockwell_collins_carries_an_acquisition_not_the_2023_rename():
    """The other half: a RENAME label pinned to a company that arrived by
    ACQUISITION (Rockwell Collins entered via UTC in 2018)."""
    fams = resolve_families(
        load_family_events(SEED),
        {"RAYTHEON", "RTX", "ROCKWELL COLLINS", "ROCKWELL COLLINS AUSTRALIA"},
    )
    rtx = next(f for f in fams if f.label == "RTX")
    arrivals = member_arrivals(rtx)
    for key in ("ROCKWELL COLLINS", "ROCKWELL COLLINS AUSTRALIA"):
        ev = rtx.events[arrivals[key].event_index].event
        assert ev.event == "acquisition", key
        assert ev.effective_date == "2018-11-26", key
    # and Raytheon Company's own event is the 2020 merger of equals
    ray = rtx.events[arrivals["RAYTHEON"].event_index].event
    assert (ray.event, ray.effective_date) == ("merger", "2020-04-03")


def test_the_acquirer_side_is_never_labelled_acquired():
    """HII acquired Alion; labelling HII "acquired 2021" inverts the deal."""
    fams = resolve_families(
        load_family_events(SEED),
        {"ALION SCIENCE AND TECHNOLOGY", "HUNTINGTON INGALLS INDUSTRIES"},
    )
    hii = next(f for f in fams if f.label == "Huntington Ingalls Industries")
    arrivals = member_arrivals(hii)
    assert "ALION SCIENCE AND TECHNOLOGY" in arrivals
    assert "HUNTINGTON INGALLS INDUSTRIES" not in arrivals


def test_a_renamed_predecessor_keeps_its_own_arrival():
    """NGIS is the post-acquisition name of Orbital ATK — a "to" arrival, so
    the reader learns WHY that registry name is in the family."""
    fams = resolve_families(
        load_family_events(SEED),
        {"NORTHROP GRUMMAN", "NORTHROP GRUMMAN INNOVATION SYSTEMS"},
    )
    ng = next(f for f in fams if f.label == "Northrop Grumman")
    arrivals = member_arrivals(ng)
    ngis = arrivals["NORTHROP GRUMMAN INNOVATION SYSTEMS"]
    assert ngis.role == "to"
    assert ngis.counterparty == "Orbital ATK, Inc."
    assert "NORTHROP GRUMMAN" not in arrivals  # the anchor, not an arrival


def test_every_event_that_moved_a_row_is_traceable():
    """The judges: on /families/ every visible RTX event showed "no separate
    registry family" on one side, so no event explained the merge it caused.
    Every member must now point at exactly one event, and every event must
    know which members it moved."""
    known = {
        "RAYTHEON", "RTX", "ROCKWELL COLLINS", "ROCKWELL COLLINS AUSTRALIA",
        "EXELIS", "L3 TECHNOLOGIES", "L3HARRIS TECHNOLOGIES",
        "NORTHROP GRUMMAN", "NORTHROP GRUMMAN INNOVATION SYSTEMS",
    }
    for fam in resolve_families(load_family_events(SEED), known):
        arrivals = member_arrivals(fam)
        changed = event_changed_keys(fam)
        assert len(changed) == len(fam.events)
        flat = [k for keys in changed for k in keys]
        assert sorted(flat) == sorted(arrivals)
        assert len(flat) == len(set(flat)), "an event pair cannot both claim a row"


def test_the_sikorsky_row_honestly_moves_nothing():
    """Recorded for completeness; the page must be able to SAY that."""
    fams = resolve_families(load_family_events(SEED), {"LOCKHEED MARTIN"})
    lm = next(f for f in fams if f.label == "Lockheed Martin")
    assert event_changed_keys(lm) == [[]]


# ── chain of custody (ADD 9) ────────────────────────────────────────────────


def test_every_shipped_row_carries_a_form_and_two_dates():
    for e in load_family_events(SEED):
        assert e.source_form, e.from_name
        assert e.source_date >= "2015-01-01", e.from_name
        assert e.source_verified >= e.source_date, e.from_name
        assert e.evidence in EVIDENCE_KINDS


def test_the_source_date_is_never_before_the_event_it_documents():
    """A filing cannot report a merger that has not happened yet — the Exelis
    row used to cite a SHAREHOLDER-APPROVAL release that only said the merger
    was *expected* to close on the effective date."""
    for e in load_family_events(SEED):
        assert e.source_date >= e.effective_date, (
            f"{e.from_name}: source dated {e.source_date} predates the "
            f"{e.effective_date} event it is cited for"
        )
