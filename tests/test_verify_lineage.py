"""verify-lineage gate tests (program-lineage Task 5, evaluator-first).

Postgres-backed legs (a stated-cite, b family-integrity) use a dedicated
throwaway database (govbudget_test_lineage) migrated from migrations/*.sql —
same pattern as tests/test_verify_phase5e.py, separate DB name so the suites
never collide. Leg (c) additionally builds a tmp DuckDB carrying a minimal
fct_decade_series so the request-series resolution is exercised.

Each seeded-violation test PROVES a leg can FAIL (the proof-can-fail), and the
all-pass test proves a clean mini-warehouse passes with exit 0.
"""
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import duckdb
import psycopg
import pytest

from govbudget.export_site import fact_id_narrative
from govbudget.verify_lineage import (
    family_integrity_leg,
    one_to_one_sum_leg,
    stated_cite_leg,
)

ADMIN_DSN = os.environ.get("GOVBUDGET_TEST_PG_DSN", "postgresql://localhost/postgres")
TEST_DB = "govbudget_test_lineage"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def pg_dsn_lineage():
    try:
        admin = psycopg.connect(ADMIN_DSN, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(
            f"Postgres unavailable ({e}); start local postgres to run lineage gate tests"
        )
    admin.execute(f"drop database if exists {TEST_DB}")
    admin.execute(f"create database {TEST_DB}")
    admin.close()

    parts = urlsplit(ADMIN_DSN)
    dsn = urlunsplit(parts._replace(path="/" + TEST_DB))

    from govbudget.jbooks.db import migrate

    migrate(dsn)
    yield dsn


@pytest.fixture()
def pg(pg_dsn_lineage):
    yield pg_dsn_lineage
    with psycopg.connect(pg_dsn_lineage, autocommit=True) as con:
        con.execute(
            "truncate program_lineage, program_family, detail_narratives,"
            " extraction_runs, jbook_documents restart identity cascade"
        )


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def seed_narrative(
    dsn: str, *, sha: str, pe_bli: str, kind: str, xml_path: str, body: str
) -> str:
    """Insert a jbook_documents + extraction_run + detail_narratives row and
    return the canonical fact_id_narrative for it (so a stated edge can cite a
    genuinely re-derivable narrative)."""
    with psycopg.connect(dsn, autocommit=True) as con:
        doc_id = con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, sha256, status) values ('DARPA', 'rdte', 2026, %s, %s, %s,"
            " 'downloaded') returning id",
            (f"doc-{sha}", f"https://example.test/{sha}.pdf", sha),
        ).fetchone()[0]
        run_id = con.execute(
            "insert into extraction_runs (document_id, tier, tool_versions, status)"
            " values (%s, 1, '{}', 'finished') returning id",
            (doc_id,),
        ).fetchone()[0]
        con.execute(
            "insert into detail_narratives (extraction_run_id, document_id, pe_bli,"
            " kind, body, xml_path, superseded) values (%s, %s, %s, %s, %s, %s, false)",
            (run_id, doc_id, pe_bli, kind, body, xml_path),
        )
    return fact_id_narrative(sha, pe_bli, kind, xml_path)


def seed_edge(
    dsn: str,
    from_pe: str,
    to_pe: str,
    *,
    fy: int = 2026,
    relation: str = "realigned",
    confidence: str = "stated",
    fact_id: str | None = None,
    sentence: str | None = None,
    portion: float | None = None,
    inference_basis: str | None = None,
) -> None:
    with psycopg.connect(dsn, autocommit=True) as con:
        con.execute(
            "insert into program_lineage (from_pe_bli, to_pe_bli, fiscal_year,"
            " relation, portion_amount, confidence, evidence_fact_id,"
            " evidence_sentence, inference_basis)"
            " values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (from_pe, to_pe, fy, relation, portion, confidence, fact_id, sentence,
             inference_basis),
        )


def seed_family(dsn: str, mapping: dict[str, int]) -> None:
    with psycopg.connect(dsn, autocommit=True) as con:
        con.cursor().executemany(
            "insert into program_family (pe_bli, family_id) values (%s, %s)",
            list(mapping.items()),
        )


_series_db_counter = [0]


def make_series_db(tmp_path: Path, request_pes: list[str], *,
                   other_pes: list[str] | None = None) -> Path:
    """Minimal fct_decade_series: each request_pe gets a request row; each
    other_pe gets a non-request (actuals) row (present in series, no request).

    Each call writes a fresh file so a test can build more than one series
    warehouse under the same tmp_path without colliding."""
    _series_db_counter[0] += 1
    db = tmp_path / f"wh{_series_db_counter[0]}.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_decade_series (pe_bli varchar, fy int, edition_year int,"
        " amount_type_kind varchar, amount_thousands double)"
    )
    for pe in request_pes:
        con.execute(
            "insert into fct_decade_series values (?, 2026, 2026, 'request', 100.0)",
            [pe],
        )
    for pe in (other_pes or []):
        con.execute(
            "insert into fct_decade_series values (?, 2024, 2026, 'actuals', 50.0)",
            [pe],
        )
    con.close()
    return db


# ===========================================================================
# Leg (a) — stated-cite
# ===========================================================================


def test_leg_a_passes_when_stated_edge_genuinely_cited(pg):
    fid = seed_narrative(
        pg, sha="aaa", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body="Funding was realigned to PE 0601102E for the follow-on effort.",
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id=fid,
        sentence="Funding was realigned to PE 0601102E for the follow-on effort.",
    )
    g = stated_cite_leg(pg)
    assert g["ok"] is True
    assert g["checked"] == 1 and g["passed"] == 1


def test_leg_a_fails_on_bogus_fact_id(pg):
    """proof-can-fail: a stated edge whose fact_id re-derives to no narrative."""
    seed_narrative(
        pg, sha="aaa", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body="Funding was realigned to PE 0601102E for the follow-on effort.",
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id="deadbeefdeadbeef",
        sentence="Funding was realigned to PE 0601102E for the follow-on effort.",
    )
    g = stated_cite_leg(pg)
    assert g["ok"] is False
    assert any("re-derives to no narrative" in r for _, r in g["failures"])


def test_leg_a_fails_when_sentence_lacks_pe_token(pg):
    """proof-can-fail: evidence_sentence contains neither PE token."""
    fid = seed_narrative(
        pg, sha="aaa", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body="Some unrelated prose that mentions no program element at all.",
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id=fid,
        sentence="Some unrelated prose that mentions no program element at all.",
    )
    g = stated_cite_leg(pg)
    assert g["ok"] is False
    assert any("cites neither PE token" in r for _, r in g["failures"])


def test_leg_a_fails_when_body_lacks_sentence(pg):
    """proof-can-fail: fact_id re-derives but the narrative body does not
    contain the cited sentence (a fabricated verbatim citation)."""
    fid = seed_narrative(
        pg, sha="aaa", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body="The real narrative body says nothing about a realignment.",
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id=fid,
        sentence="Funding was realigned to PE 0601102E (this sentence is fabricated).",
    )
    g = stated_cite_leg(pg)
    assert g["ok"] is False
    assert any("does not contain evidence_sentence" in r for _, r in g["failures"])


# ===========================================================================
# Leg (b) — family-integrity
# ===========================================================================


def _seed_clean_two_family_warehouse(pg, tmp_path):
    """Two stated 1:1 chains -> two families:
       A: 0601101E -> 0601102E ; B: 0700001F -> 0700002F -> 0700003F.
    All narratives genuinely cite (so leg a is clean too). Returns the
    request-series DuckDB for leg c."""
    def cite(sha, pe, other):
        body = f"Funding for PE {pe} was realigned to PE {other}."
        fid = seed_narrative(
            pg, sha=sha, pe_bli=pe, kind="mission",
            xml_path="ProgramElement[0]/Narrative[0]", body=body,
        )
        seed_edge(pg, pe, other, fact_id=fid, sentence=body)

    cite("s1", "0601101E", "0601102E")
    cite("s2", "0700001F", "0700002F")
    cite("s3", "0700002F", "0700003F")
    # family ids assigned arbitrarily (the gate is id-agnostic).
    seed_family(pg, {
        "0601101E": 7, "0601102E": 7,
        "0700001F": 42, "0700002F": 42, "0700003F": 42,
    })
    return make_series_db(
        tmp_path,
        ["0601101E", "0601102E", "0700001F", "0700002F", "0700003F"],
    )


def test_leg_b_passes_on_matching_partition(pg, tmp_path):
    _seed_clean_two_family_warehouse(pg, tmp_path)
    g = family_integrity_leg(pg)
    assert g["ok"] is True, g["failures"]
    assert g["recomputed_pes"] == 5 and g["persisted_pes"] == 5


def test_leg_b_passes_when_only_ids_differ(pg, tmp_path):
    """id-agnostic: the same grouping with different integer ids still PASSES."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    # Re-stamp with a wholly different id numbering but IDENTICAL grouping.
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("truncate program_family")
    seed_family(pg, {
        "0601101E": 100, "0601102E": 100,
        "0700001F": 200, "0700002F": 200, "0700003F": 200,
    })
    g = family_integrity_leg(pg)
    assert g["ok"] is True, g["failures"]


def test_leg_b_fails_on_wrong_grouping(pg, tmp_path):
    """proof-can-fail: a PE moved to the wrong family id (split grouping)."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    with psycopg.connect(pg, autocommit=True) as con:
        # Move 0601102E out of its stated component into family B's grouping.
        con.execute("update program_family set family_id=42 where pe_bli='0601102E'")
    g = family_integrity_leg(pg)
    assert g["ok"] is False
    assert any(kind == "regroup" for kind, _ in g["failures"])


def test_leg_b_fails_on_missing_pe(pg, tmp_path):
    """proof-can-fail: a PE with a stated edge dropped from program_family."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("delete from program_family where pe_bli='0700003F'")
    g = family_integrity_leg(pg)
    assert g["ok"] is False
    assert any(kind == "missing" for kind, _ in g["failures"])


def test_leg_b_fails_on_extra_pe(pg, tmp_path):
    """proof-can-fail: a PE in program_family with no stated edge at all."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    seed_family(pg, {"0999999Z": 99})
    g = family_integrity_leg(pg)
    assert g["ok"] is False
    assert any(kind == "extra" for kind, _ in g["failures"])


# ===========================================================================
# Leg (c) — one-to-one-sum
# ===========================================================================


def test_leg_c_passes_on_clean_family(pg, tmp_path):
    """A clean 1:1 chain family whose members all resolve in the request
    series PASSES leg c (with families_checked reported)."""
    db = _seed_clean_two_family_warehouse(pg, tmp_path)
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is True, g["failures"]
    assert g["families_checked"] == 2
    assert g["cyclic_fallbacks"] == []
    assert g["dangling_terminals"] == []


def test_leg_c_fails_when_chain_pulls_in_split_successor(pg, tmp_path):
    """Honesty (positive): the funding line STOPS at a split — the split
    successor is never summed. root -realigned(1:1)-> mid -split-> child in one
    family. one_to_one_chain(root) = [root, mid] (stops at mid's split
    out-edge), so child is excluded and leg c PASSES: no split successor
    enters the summed chain."""
    for sha, (a, b, rel, portion) in {
        "s1": ("0601101E", "0601102E", "realigned", None),
        "s2": ("0601102E", "0605000X", "split", None),
    }.items():
        body = f"PE {a} money moved to PE {b}."
        fid = seed_narrative(pg, sha=sha, pe_bli=a, kind="mission",
                             xml_path="ProgramElement[0]/Narrative[0]", body=body)
        seed_edge(pg, a, b, relation=rel, portion=portion, fact_id=fid, sentence=body)
    seed_family(pg, {"0601101E": 1, "0601102E": 1, "0605000X": 1})
    db = make_series_db(tmp_path, ["0601101E", "0601102E", "0605000X"])
    g = one_to_one_sum_leg(pg, db)
    # The split child is NOT summed; the chain stops at the split. PASS, and the
    # split child never appears in any failure (it is correctly excluded).
    assert g["ok"] is True, g["failures"]
    assert not any("0605000X" in r for _, r in g["failures"])


def test_leg_c_fails_when_chain_pulls_in_inferred_successor(pg, tmp_path):
    """proof-can-fail: a chain that includes an INFERRED-edge successor.

    root -0601101E- STATED realigned -> 0601102E, and 0601102E -INFERRED-> the
    same node makes 0601102E an inferred target; but to force it INTO the
    summed chain we make the stated hop land on an inferred successor: seed a
    stated 1:1 edge whose target is also the target of an inferred edge."""
    body = "PE 0601101E money moved to PE 0601102E."
    fid = seed_narrative(pg, sha="s1", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=body)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=body)
    # An inferred edge that also lands on 0601102E (never cited, no fact_id).
    seed_edge(pg, "0600000Q", "0601102E", confidence="inferred",
              relation="matured_ba", inference_basis="ba_maturation_same_title")
    seed_family(pg, {"0601101E": 1, "0601102E": 1})
    db = make_series_db(tmp_path, ["0601101E", "0601102E"])
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is False
    assert any("INFERRED-edge successor" in r for _, r in g["failures"])


def test_leg_c_fails_when_root_not_in_request_series(pg, tmp_path):
    """proof-can-fail: the family root does not resolve in the request series."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    # Series that OMITS root 0601101E from the request set.
    db = make_series_db(
        tmp_path,
        ["0601102E", "0700001F", "0700002F", "0700003F"],
    )
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is False
    assert any("does not resolve in the request series" in r for _, r in g["failures"])


def test_leg_c_fails_when_midchain_member_missing_from_series(pg, tmp_path):
    """proof-can-fail: a MID-chain member (out-degree > 0) absent from the
    series is a real gap, NOT an honest terminal dangling reference."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    # Omit 0700002F (mid-chain, out-degree 1) from the series entirely.
    db = make_series_db(
        tmp_path,
        ["0601101E", "0601102E", "0700001F", "0700003F"],
    )
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is False
    assert any("not a terminal dangling reference" in r for _, r in g["failures"])


def test_leg_c_terminal_dangling_reference_is_noted_not_failed(pg, tmp_path):
    """A terminal (out-degree 0) successor absent from the ENTIRE series is an
    honest cited destination in a not-yet-ingested edition — noted, PASS."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    # Omit only the terminal 0700003F (out-degree 0) from the series entirely.
    db = make_series_db(
        tmp_path,
        ["0601101E", "0601102E", "0700001F", "0700002F"],
    )
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is True, g["failures"]
    assert ("0700001F", "0700003F") in g["dangling_terminals"]


def test_leg_c_uncited_dangling_terminal_fails_LOCALLY(pg, tmp_path):
    """proof-can-fail (LOCAL safety): a dangling terminal whose INCOMING stated
    edge is UNcited (bogus fact_id) must make leg c FAIL when called directly —
    NOT waved through as a dangling reference. This proves the carve-out is a
    local invariant of leg c, not merely emergent from leg a running in the
    same CLI. Adversarial-review closure: 000042 -> 9999999Z with an uncited
    incoming edge is fabricated lineage and must never sum/thread."""
    # A well-formed but nonexistent terminal 9999999Z whose incoming edge is
    # UNCITED (bogus fact_id, no matching narrative). Root 000042 is real.
    seed_edge(
        pg, "000042", "9999999Z", relation="realigned",
        fact_id="deadbeefdeadbeef",
        sentence="Funding for PE 000042 was realigned to PE 9999999Z.",
    )
    # Note: NO narrative seeded for that fact_id — the incoming edge does not
    # resolve. Family groups the two; 000042 resolves in the request series,
    # 9999999Z appears nowhere in the series (a terminal).
    seed_family(pg, {"000042": 1, "9999999Z": 1})
    db = make_series_db(tmp_path, ["000042"])  # 9999999Z absent from series
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is False
    assert ("000042", "9999999Z") not in g["dangling_terminals"]
    assert any("UNcited dangling terminal" in r for _, r in g["failures"])


def test_leg_c_cited_dangling_terminal_still_passes(pg, tmp_path):
    """Companion to the LOCAL-safety test: the SAME shape but with a genuinely
    CITED incoming edge is exempted (noted, PASS) — mirrors the real
    834190 -> 0207429F warehouse case. Proves the hardening did not over-tighten
    the honest carve-out."""
    body = "Funding for PE 000042 was realigned to PE 9999999Z."
    fid = seed_narrative(pg, sha="s9", pe_bli="000042", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=body)
    seed_edge(pg, "000042", "9999999Z", relation="realigned", fact_id=fid,
              sentence=body)
    seed_family(pg, {"000042": 1, "9999999Z": 1})
    db = make_series_db(tmp_path, ["000042"])
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is True, g["failures"]
    assert ("000042", "9999999Z") in g["dangling_terminals"]


# ===========================================================================
# All-pass end-to-end
# ===========================================================================


def test_all_three_legs_pass_on_clean_mini_warehouse(pg, tmp_path):
    db = _seed_clean_two_family_warehouse(pg, tmp_path)
    a = stated_cite_leg(pg)
    b = family_integrity_leg(pg)
    c = one_to_one_sum_leg(pg, db)
    assert a["ok"] and b["ok"] and c["ok"], (a, b, c)
