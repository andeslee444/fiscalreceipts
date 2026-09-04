import json
import psycopg
import pytest

from precision_study import draw_sample, load_verdicts, precision_by_method  # scripts/ is on sys.path via conftest

def test_sample_is_deterministic_and_stratified(pg_dsn):
    with psycopg.connect(pg_dsn) as pg:
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            select '0601101E','R-1',2026,'DARPA','P'||g, 'announcement+lexicon','high'
            from generate_series(1,80) g""")
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            select '0601101E','R-1',2026,'DARPA','Q'||g, 'subaward+lexicon','medium'
            from generate_series(1,10) g""")
        pg.commit()
    a = draw_sample(pg_dsn, per_method=20, seed=7)
    b = draw_sample(pg_dsn, per_method=20, seed=7)
    assert a == b
    by = {}
    for r in a: by.setdefault(r["method"], 0); by[r["method"]] += 1
    assert by["announcement+lexicon"] == 20
    assert by["subaward+lexicon"] == 10   # fewer rows than per_method: take all

def test_precision_counts_only_confirmed(pg_dsn):
    # P1..P3 are published announcement+lexicon links seeded by the test above
    # (budget_line_awards P1..P80). Since the 2026-09-04 fix the tally JOINS
    # the sample to budget_line_awards and counts under the method the link
    # publishes under today, so those published rows are what makes these
    # sampled rows countable at all.
    with psycopg.connect(pg_dsn) as pg:
        pg.execute("""insert into link_precision_samples
            (sample_id, award_piid, pe_bli, method, verdict, reason)
            values ('s1','P1','0601101E','announcement+lexicon','confirmed','ok'),
                   ('s1','P2','0601101E','announcement+lexicon','refuted','platform mention'),
                   ('s1','P3','0601101E','announcement+lexicon',null,null)""")
        pg.commit()
    # Explicit sample_id: the fixture DB is session-scoped and never truncated,
    # so "latest run" depends on what other tests have inserted.
    got = precision_by_method(pg_dsn, sample_id="s1")
    assert got["announcement+lexicon"] == (1, 2)  # unjudged rows excluded


def test_a_sampled_link_the_corpus_no_longer_publishes_is_not_counted(pg_dsn):
    """ROADMAP #72 final review C1. The study measures the PUBLISHED tiers, so
    a sampled link that has since been deleted (or demoted below medium) is
    evidence about neither — it counts toward neither numerator nor
    denominator, in either direction."""
    with psycopg.connect(pg_dsn) as pg:
        # One published link, one that was deleted, one demoted to 'low'.
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            values ('0601101E','R-1',2026,'DARPA','WITHDRAWN-KEPT','announcement+lexicon','high'),
                   ('0601101E','R-1',2026,'DARPA','WITHDRAWN-LOW','announcement+lexicon','low')""")
        pg.execute("""insert into link_precision_samples
            (sample_id, award_piid, pe_bli, method, verdict, reason)
            values ('s-withdrawn','WITHDRAWN-KEPT','0601101E','announcement+lexicon','confirmed','ok'),
                   ('s-withdrawn','WITHDRAWN-LOW','0601101E','announcement+lexicon','refuted','demoted'),
                   ('s-withdrawn','WITHDRAWN-GONE','0601101E','announcement+lexicon','refuted','deleted')""")
        pg.commit()
    assert precision_by_method(pg_dsn, sample_id="s-withdrawn") == {
        "announcement+lexicon": (1, 1)
    }


def test_the_tier_a_link_publishes_under_today_owns_its_verdict(pg_dsn):
    """The `fpds-ap+account` shape: a link drawn under a tier that was
    withdrawn is counted under the tier that absorbed it, not the dead one."""
    with psycopg.connect(pg_dsn) as pg:
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            values ('0601101E','R-1',2026,'DARPA','MOVED-1','fpds-ap','medium'),
                   ('0601101E','R-1',2026,'DARPA','MOVED-2','fpds-ap','medium')""")
        pg.execute("""insert into link_precision_samples
            (sample_id, award_piid, pe_bli, method, verdict, reason)
            values ('s-moved','MOVED-1','0601101E','fpds-ap+account','confirmed','ok'),
                   ('s-moved','MOVED-2','0601101E','fpds-ap+account','refuted','sibling line')""")
        pg.commit()
    got = precision_by_method(pg_dsn, sample_id="s-moved")
    assert "fpds-ap+account" not in got
    assert got == {"fpds-ap": (1, 2)}

def test_load_verdicts_upserts_on_rerun(pg_dsn, tmp_path):
    # A method name not touched by the other tests in this module — the
    # session-scoped pg_dsn fixture is never truncated between tests, so
    # reusing a method name here would pick up other tests' rows too. The
    # sample_id is passed explicitly for the same reason.
    method = "load-verdicts-test"
    with psycopg.connect(pg_dsn) as pg:
        # Since the C1 fix the tally joins to the PUBLISHED link, so the two
        # links these verdicts are about have to exist in budget_line_awards.
        pg.execute("""insert into budget_line_awards
            (pe_bli, exhibit, fiscal_year, organization, award_piid, method, confidence)
            values ('0601101E','R-1',2026,'DARPA','L1',%s,'medium'),
                   ('0601101E','R-1',2026,'DARPA','L2',%s,'medium')
            on conflict do nothing""", (method, method))
        pg.commit()
    verdicts_path = tmp_path / "verdicts.json"
    verdicts_path.write_text(json.dumps([
        {"piid": "L1", "pe_bli": "0601101E", "method": method,
         "verdict": "confirmed", "reason": "ok"},
        {"piid": "L2", "pe_bli": "0601101E", "method": method,
         "verdict": "refuted", "reason": "platform mention"},
    ]))

    assert load_verdicts(pg_dsn, "study-x", verdicts_path) == 2
    assert precision_by_method(pg_dsn, sample_id="study-x")[method] == (1, 2)

    # Re-running load with a corrected verdict for the same (sample_id,
    # award_piid, pe_bli) upserts in place rather than duplicating the row.
    verdicts_path.write_text(json.dumps([
        {"piid": "L1", "pe_bli": "0601101E", "method": method,
         "verdict": "confirmed", "reason": "ok"},
        {"piid": "L2", "pe_bli": "0601101E", "method": method,
         "verdict": "confirmed", "reason": "re-reviewed: platform mention was wrong"},
    ]))
    assert load_verdicts(pg_dsn, "study-x", verdicts_path) == 2
    assert precision_by_method(pg_dsn, sample_id="study-x")[method] == (2, 2)
