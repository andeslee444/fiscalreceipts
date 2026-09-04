"""The FPDS deriver cannot demote an evidence-graded link, whatever the run
order (2026-09-04 final review, finding I3).

THE DEFECT. `derive_ap_links.py` deletes only its OWN rows
(`method like 'fpds-ap%'`) and then upserts. An announcement- or
subaward-evidenced link on the same unique key (pe_bli, exhibit, fiscal_year,
award_piid) survives that delete and is then hit by the upsert's
`do update set method=…, confidence=…`, which had no method guard. Run the
loaders in the wrong order — crosswalk → load_announcement_links →
derive_ap_links instead of the canonical
crosswalk → derive_ap_links → load_announcement_links — and an
`announcement+lexicon`/high link becomes `fpds-ap`/medium, its
`award_link_sources` row is orphaned, and the citation panel quietly loses the
defense.gov article. Nothing fails: every remaining number is still true.

These tests run the loader's REAL statement (`derive_ap_links.UPSERT_SQL`,
hoisted for exactly this reason) against the fixture Postgres.
"""
import re

import psycopg
import pytest

from derive_ap_links import EVIDENCE_GRADED_METHODS, UPSERT_SQL  # scripts/ on sys.path


PE = "RO0601101E"
ORG = "run-order-test"


def _row(piid, method, confidence, *, rationale="fpds-ap derivation", account=None):
    """One 13-column budget_line_awards tuple in the loader's own order."""
    return (
        PE, "R-1", 2026, ORG, piid,
        "RECIPIENT INC", "UEI000000000", 1000.0, method,
        confidence, 1.0, rationale, account,
    )


@pytest.fixture()
def pg(pg_dsn):
    with psycopg.connect(pg_dsn) as con:
        con.execute("delete from budget_line_awards where organization = %s", (ORG,))
        con.commit()
        yield con
        con.execute("delete from budget_line_awards where organization = %s", (ORG,))
        con.commit()


def _published(con, piid):
    return con.execute(
        "select method, confidence, rationale from budget_line_awards"
        " where organization = %s and award_piid = %s",
        (ORG, piid),
    ).fetchone()


@pytest.mark.parametrize("method", EVIDENCE_GRADED_METHODS)
def test_deriver_cannot_overwrite_an_evidence_graded_link(pg, method):
    """The bug: run AFTER the announcement loader, the deriver rewrote this
    row to fpds-ap/medium and orphaned its award_link_sources row."""
    conf = "high" if method == "announcement+lexicon" else "medium"
    pg.execute(
        "insert into budget_line_awards (pe_bli, exhibit, fiscal_year,"
        " organization, award_piid, method, confidence, rationale)"
        " values (%s,'R-1',2026,%s,'PIID-EVIDENCE',%s,%s,"
        " 'defense.gov article 3624785')",
        (PE, ORG, method, conf),
    )
    pg.commit()

    pg.cursor().execute(UPSERT_SQL, _row("PIID-EVIDENCE", "fpds-ap", "medium"))
    pg.commit()

    assert _published(pg, "PIID-EVIDENCE") == (
        method, conf, "defense.gov article 3624785"
    ), "an evidence-graded link must survive a later mechanical derivation"


def test_deriver_still_updates_its_own_rows(pg):
    """The guard must not turn the loader into a no-op on re-run: an
    `fpds-ap` row it wrote before is still refreshed in place."""
    pg.cursor().execute(
        UPSERT_SQL, _row("PIID-OWN", "fpds-ap", "low", rationale="0 of 3 lines")
    )
    pg.commit()
    pg.cursor().execute(
        UPSERT_SQL, _row("PIID-OWN", "fpds-ap", "medium", rationale="1 of 3 lines")
    )
    pg.commit()
    assert _published(pg, "PIID-OWN") == ("fpds-ap", "medium", "1 of 3 lines")


def test_deriver_still_upgrades_a_mechanical_account_row(pg):
    """`account*` rows are the mechanical crosswalk's, not evidence — FPDS
    account narrowing is strictly better evidence and must still win."""
    pg.execute(
        "insert into budget_line_awards (pe_bli, exhibit, fiscal_year,"
        " organization, award_piid, method, confidence, rationale)"
        " values (%s,'R-1',2026,%s,'PIID-ACCOUNT','account+subagency','medium',"
        " 'account 097-0400; sub-agency DARPA')",
        (PE, ORG),
    )
    pg.commit()
    pg.cursor().execute(UPSERT_SQL, _row("PIID-ACCOUNT", "fpds-ap", "medium"))
    pg.commit()
    assert _published(pg, "PIID-ACCOUNT") == (
        "fpds-ap", "medium", "fpds-ap derivation"
    )


def test_a_brand_new_link_still_inserts(pg):
    pg.cursor().execute(UPSERT_SQL, _row("PIID-NEW", "fpds-ap", "medium"))
    pg.commit()
    assert _published(pg, "PIID-NEW") == ("fpds-ap", "medium", "fpds-ap derivation")


def test_the_guard_names_both_evidence_methods():
    """load_announcement_links.py loads BOTH methods in one pass and deletes
    both on re-run; the guard has to cover both or the subaward route is
    protected only by luck."""
    assert set(EVIDENCE_GRADED_METHODS) == {
        "announcement+lexicon", "subaward+lexicon"
    }
    for method in EVIDENCE_GRADED_METHODS:
        assert f"'{method}'" in UPSERT_SQL


# ── M3: the positional row shape both loaders build ─────────────────────────


def test_incoming_member_claims_reads_the_documented_positions():
    from derive_ap_links import BLA_ROW_WIDTH, incoming_member_claims

    row = _row("PIID-1", "fpds-ap", "medium", account="1611N")
    assert len(row) == BLA_ROW_WIDTH
    assert incoming_member_claims([row]) == [((PE, "R-1", 2026, "PIID-1"), "1611N")]


def test_a_row_of_the_wrong_width_raises_instead_of_reading_the_wrong_column():
    """The subscripts (r[0], r[1], r[2], r[4], r[12]) are positional across two
    files. Insert a column in either loader and r[4] silently becomes
    recipient_name — the member-attribution guard would then compare nonsense
    while still looking like it fired (2026-09-04 final review M3)."""
    from derive_ap_links import incoming_member_claims

    short = _row("PIID-1", "fpds-ap", "medium")[:-1]  # 12 columns
    with pytest.raises(ValueError, match=r"12 column\(s\), expected 13"):
        incoming_member_claims([short])

    wide = _row("PIID-1", "fpds-ap", "medium") + ("extra",)
    with pytest.raises(ValueError, match=r"14 column\(s\), expected 13"):
        incoming_member_claims([wide])


def _insert_columns(source: str) -> list[str]:
    """The column list of a source file's `insert into budget_line_awards`."""
    m = re.search(
        r"insert into budget_line_awards\s*\(([^)]*)\)", source, re.IGNORECASE
    )
    assert m, "no budget_line_awards insert found"
    return [c.strip() for c in m.group(1).split(",") if c.strip()]


def test_both_loaders_build_a_row_of_that_width():
    """load_announcement_links.py imports incoming_member_claims from here and
    builds its own tuple positionally; the two insert statements must list the
    same columns in the same order, or r[4]/r[12] read different fields
    depending on which loader produced the row."""
    import inspect

    import load_announcement_links as lal

    from derive_ap_links import BLA_ROW_WIDTH

    deriver_cols = _insert_columns(UPSERT_SQL)
    announcement_cols = _insert_columns(inspect.getsource(lal))

    assert len(deriver_cols) == BLA_ROW_WIDTH
    assert deriver_cols == announcement_cols
    # The positions incoming_member_claims reads by index.
    assert deriver_cols[0] == "pe_bli"
    assert deriver_cols[1] == "exhibit"
    assert deriver_cols[2] == "fiscal_year"
    assert deriver_cols[4] == "award_piid"
    assert deriver_cols[12] == "account"
