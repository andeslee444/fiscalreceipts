"""site_meta.link_precision — the held-out study, tallied under the tier each
sampled link publishes under TODAY (ROADMAP #72; final review C1, C2, I1).

The defect these tests pin: /methodology/ printed "Measured precision of the
published tiers: … fpds-ap 60/60; fpds-ap+account 34/60 …" while
`fpds-ap+account` had been WITHDRAWN and its 60 links had moved into the
`fpds-ap` medium tier. Both numbers were true of a corpus that no longer
existed; the honest figure for the tier a reader meets was 94/120. Every
number↔citation gate was green — the figures came straight from the study
table, they were simply about the wrong population.

Run against the fixture Postgres (root conftest's `pg_dsn`), so the SQL under
test is the SQL that runs in production, not a hand-rolled stand-in.
"""
import psycopg
import pytest

from govbudget.export_site import (
    _UNRUBRICKED_PRECISION_STRATA,
    _link_precision_block,
)
from precision_study import precision_by_method  # scripts/ on sys.path (conftest)


@pytest.fixture()
def seeded(pg_dsn):
    """A miniature of the 2026-09-04 corpus.

    budget_line_awards is the PUBLISHED state; link_precision_samples records
    what each link's method was when the sample was drawn. The two disagree on
    purpose:

      * LPB-P1/LPB-P2 were drawn as 'fpds-ap+account' (the withdrawn high tier) and
        now publish as 'fpds-ap' medium — they must land in the fpds-ap tally;
      * LPB-P3 was drawn and still publishes as 'fpds-ap';
      * LPB-A1/LPB-A2 publish as 'announcement+lexicon' high;
      * LPB-A3 was drawn as 'announcement+lexicon' and is GONE from
        budget_line_awards (removed by the O&M funding-account filter) — it
        must count toward neither number;
      * LPB-S1 was drawn as 'account+subagency' and has been demoted to
        'account'/low — unpublished, so it drops out too;
      * LPB-G1 publishes as 'account+subagency' medium — the stratum whose
        adjudication asked a different question, dropped from the figures;
      * LPB-U1 belongs to an older sample_id and must be ignored entirely.
    """
    marker = "lp-block-test"
    with psycopg.connect(pg_dsn) as pg:
        pg.execute(
            "delete from link_precision_samples where sample_id in"
            " ('2026-09-04', '2026-08-01')"
        )
        pg.execute(
            "delete from budget_line_awards where organization = %s", (marker,)
        )
        rows = [
            # (piid, pe_bli, published method, published confidence)
            ("LPB-P1", "LPB0601101E", "fpds-ap", "medium"),
            ("LPB-P2", "LPB0601101E", "fpds-ap", "medium"),
            ("LPB-P3", "LPB0601101E", "fpds-ap", "medium"),
            ("LPB-A1", "LPB0603286E", "announcement+lexicon", "high"),
            ("LPB-A2", "LPB0603286E", "announcement+lexicon", "high"),
            ("LPB-S1", "LPB0604256N", "account", "low"),
            ("LPB-G1", "LPB0604256N", "account+subagency", "medium"),
            ("LPB-U1", "LPB0605502F", "fpds-ap", "medium"),
        ]
        for piid, pe_bli, method, conf in rows:
            pg.execute(
                "insert into budget_line_awards (pe_bli, exhibit, fiscal_year,"
                " organization, award_piid, method, confidence)"
                " values (%s, 'R-1', 2026, %s, %s, %s, %s)",
                (pe_bli, marker, piid, method, conf),
            )
        samples = [
            # (piid, pe_bli, method AT DRAW TIME, verdict)
            ("LPB-P1", "LPB0601101E", "fpds-ap+account", "confirmed"),
            ("LPB-P2", "LPB0601101E", "fpds-ap+account", "refuted"),
            ("LPB-P3", "LPB0601101E", "fpds-ap", "confirmed"),
            ("LPB-A1", "LPB0603286E", "announcement+lexicon", "confirmed"),
            ("LPB-A2", "LPB0603286E", "announcement+lexicon", "refuted"),
            ("LPB-A3", "LPB0603286E", "announcement+lexicon", "refuted"),
            ("LPB-S1", "LPB0604256N", "account+subagency", "confirmed"),
            ("LPB-G1", "LPB0604256N", "account+subagency", "confirmed"),
        ]
        for piid, pe_bli, method, verdict in samples:
            pg.execute(
                "insert into link_precision_samples (sample_id, award_piid,"
                " pe_bli, method, verdict, reason, adjudicated_at) values"
                " ('2026-09-04', %s, %s, %s, %s, 'fixture',"
                " timestamptz '2026-09-04 14:58:54-04')",
                (piid, pe_bli, method, verdict),
            )
        # An EARLIER run whose verdicts must never pool into the latest one.
        pg.execute(
            "insert into link_precision_samples (sample_id, award_piid, pe_bli,"
            " method, verdict, reason, adjudicated_at) values"
            " ('2026-08-01', 'LPB-U1', 'LPB0605502F', 'fpds-ap', 'refuted', 'old run',"
            " timestamptz '2026-08-01 09:00:00-04')"
        )
        pg.commit()
    yield pg_dsn
    with psycopg.connect(pg_dsn) as pg:
        pg.execute(
            "delete from link_precision_samples where sample_id in"
            " ('2026-09-04', '2026-08-01')"
        )
        pg.execute(
            "delete from budget_line_awards where organization = %s", (marker,)
        )
        pg.commit()


PUBLISHED = {
    "account",
    "account+subagency",
    "account+tokens",
    "announcement+lexicon",
    "fpds-ap",
    "subaward+lexicon",
}


def test_withdrawn_tier_disappears_and_its_links_land_in_the_tier_they_publish_under(seeded):
    """C1: the figure describes the tier a reader can actually meet."""
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)

    assert "fpds-ap+account" not in block["methods"], (
        "a withdrawn tier must not carry a published precision figure"
    )
    # LPB-P1 confirmed + LPB-P2 refuted (drawn as fpds-ap+account) + LPB-P3 confirmed.
    assert block["methods"]["fpds-ap"] == {"confirmed": 2, "sampled": 3}


def test_sampled_links_the_corpus_no_longer_publishes_count_toward_neither_number(seeded):
    """LPB-A3 (deleted) and LPB-S1 (demoted to an unpublished tier) are not evidence
    about a tier the site publishes, in either direction."""
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)

    # LPB-A1 confirmed + LPB-A2 refuted; LPB-A3 (gone from budget_line_awards) excluded.
    assert block["methods"]["announcement+lexicon"] == {"confirmed": 1, "sampled": 2}
    # LPB-S1 now publishes as 'account'/low — no figure is minted for it.
    assert "account" not in block["methods"]


def test_unrubricked_stratum_is_dropped_from_the_figures_and_named_unmeasured(seeded):
    """C2: `account+subagency` verdicts judged whether the MECHANICAL rule
    fired, not program attribution, so they are not published as precision."""
    assert "account+subagency" in _UNRUBRICKED_PRECISION_STRATA
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)

    assert "account+subagency" not in block["methods"]
    assert "account+subagency" in block["unmeasured"]


def test_every_published_tier_is_either_measured_or_named_unmeasured(seeded):
    """The invariant gate 24 leg n enforces on the rendered page."""
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)

    assert set(block["methods"]) | set(block["unmeasured"]) == PUBLISHED
    assert not set(block["methods"]) & set(block["unmeasured"])
    # Tiers the study never drew from surface as unmeasured, not as absent.
    assert "account+tokens" in block["unmeasured"]
    assert "subaward+lexicon" in block["unmeasured"]


def test_only_the_latest_sample_id_is_read(seeded):
    """I1: an earlier run must not pool into the run that replaced it."""
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)
        older = _link_precision_block(
            pg, published_methods=PUBLISHED, sample_id="2026-08-01"
        )

    assert block["sample_id"] == "2026-09-04"
    # LPB-U1 belongs to 2026-08-01 and is 'fpds-ap' — had the runs pooled, the
    # fpds-ap denominator would be 4, not 3.
    assert block["methods"]["fpds-ap"]["sampled"] == 3
    assert older["methods"]["fpds-ap"] == {"confirmed": 0, "sampled": 1}


def test_block_is_dated_so_the_paragraph_can_say_how_old_it_is(seeded):
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)
    assert block["sampled_at"] == "2026-09-04"


def test_no_study_yields_an_empty_block(pg_dsn):
    """The /methodology/ paragraph stays absent rather than rendering an
    empty 'measured precision' claim (gate 24 leg n's other direction)."""
    with psycopg.connect(pg_dsn) as pg:
        assert _link_precision_block(pg, sample_id="no-such-study") == {}


def test_precision_study_twin_agrees_with_the_exporter(seeded):
    """scripts/precision_study.py owns the CLI; export_site inlines the same
    query. They are kept in step by hand — this is the check that they are."""
    cli = precision_by_method(seeded)
    with psycopg.connect(seeded) as pg:
        block = _link_precision_block(pg, published_methods=PUBLISHED)

    for method, figures in block["methods"].items():
        assert cli[method] == (figures["confirmed"], figures["sampled"]), method
    # The CLI is the AUDIT view: it still reports the stratum the site does not
    # publish, which is why the exporter — not the CLI — owns the filter.
    assert cli["account+subagency"] == (1, 1)
