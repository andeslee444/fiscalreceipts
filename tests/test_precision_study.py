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
    with psycopg.connect(pg_dsn) as pg:
        pg.execute("""insert into link_precision_samples
            (sample_id, award_piid, pe_bli, method, verdict, reason)
            values ('s1','P1','0601101E','announcement+lexicon','confirmed','ok'),
                   ('s1','P2','0601101E','announcement+lexicon','refuted','platform mention'),
                   ('s1','P3','0601101E','announcement+lexicon',null,null)""")
        pg.commit()
    assert precision_by_method(pg_dsn)["announcement+lexicon"] == (1, 2)  # unjudged rows excluded

def test_load_verdicts_upserts_on_rerun(pg_dsn, tmp_path):
    # A method name not touched by the other tests in this module — the
    # session-scoped pg_dsn fixture is never truncated between tests, and
    # precision_by_method groups by method with no sample_id filter, so
    # reusing a method name here would pick up other tests' rows too.
    method = "load-verdicts-test"
    verdicts_path = tmp_path / "verdicts.json"
    verdicts_path.write_text(json.dumps([
        {"piid": "L1", "pe_bli": "0601101E", "method": method,
         "verdict": "confirmed", "reason": "ok"},
        {"piid": "L2", "pe_bli": "0601101E", "method": method,
         "verdict": "refuted", "reason": "platform mention"},
    ]))

    assert load_verdicts(pg_dsn, "study-x", verdicts_path) == 2
    assert precision_by_method(pg_dsn)[method] == (1, 2)

    # Re-running load with a corrected verdict for the same (sample_id,
    # award_piid, pe_bli) upserts in place rather than duplicating the row.
    verdicts_path.write_text(json.dumps([
        {"piid": "L1", "pe_bli": "0601101E", "method": method,
         "verdict": "confirmed", "reason": "ok"},
        {"piid": "L2", "pe_bli": "0601101E", "method": method,
         "verdict": "confirmed", "reason": "re-reviewed: platform mention was wrong"},
    ]))
    assert load_verdicts(pg_dsn, "study-x", verdicts_path) == 2
    assert precision_by_method(pg_dsn)[method] == (2, 2)
