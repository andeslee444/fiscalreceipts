"""verify-lineage gate tests (program-lineage Task 5, evaluator-first).

Postgres-backed legs (a stated-cite, b family-integrity) use a dedicated
throwaway database (govbudget_test_lineage) migrated from migrations/*.sql —
same pattern as tests/test_verify_phase5e.py, separate DB name so the suites
never collide. Leg (c) additionally builds a tmp DuckDB carrying a minimal
fct_decade_series so the request-series resolution is exercised.

Each seeded-violation test PROVES a leg can FAIL (the proof-can-fail), and the
all-pass test proves a clean mini-warehouse passes with exit 0.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import duckdb
import psycopg
import pytest

from govbudget.export_site import fact_id_narrative
from govbudget.verify_lineage import (
    family_integrity_leg,
    funding_point_value_leg,
    lake_binding_leg,
    no_retraction_leg,
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
    dsn: str, *, sha: str, pe_bli: str, kind: str, xml_path: str, body: str,
    fiscal_year: int = 2026,
) -> str:
    """Insert a jbook_documents + extraction_run + detail_narratives row and
    return the canonical fact_id_narrative for it (so a stated edge can cite a
    genuinely re-derivable narrative)."""
    with psycopg.connect(dsn, autocommit=True) as con:
        doc_id = con.execute(
            "insert into jbook_documents (org, exhibit_family, fiscal_year, title,"
            " source_url, sha256, status) values ('DARPA', 'rdte', %s, %s, %s, %s,"
            " 'downloaded') returning id",
            (fiscal_year, f"doc-{sha}", f"https://example.test/{sha}.pdf", sha),
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


def test_leg_a_fails_when_edge_endpoints_contradict_both_named_sentence(pg):
    """proof-can-fail (Defect 1 gate teeth, 2026-07-28): an edge whose evidence
    sentence names BOTH endpoints ("PE 0207436F ... transferred to PE 0303004F")
    but whose (from, to) pair involves a THIRD PE (the rollup narrative line)
    must FAIL leg a — the citation contradicts the edge it claims to back."""
    body = ("In FY2021, PE 0207436F (Engineering and Installation Support AF), "
            "efforts were transferred to PE 0303004F (EIT Connect).")
    fid = seed_narrative(
        pg, sha="bn1", pe_bli="837300", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]", body=body,
    )
    # The fabricated live-defect shape: rollup 837300 minted as the source.
    seed_edge(pg, "837300", "0303004F", fact_id=fid, sentence=body)
    g = stated_cite_leg(pg)
    assert g["ok"] is False
    assert any("contradict" in r for _, r in g["failures"])


def test_leg_a_accepts_a_pre2026_narrative_citation(pg):
    """#29(b), 2026-08-27 — this test asserted the OPPOSITE until today.

    Through Phase 5I, leg (a)'s narrative index was fenced to
    CITED_NARRATIVE_FY, so an edge citing a PB2025 narrative failed with
    "re-derives to no narrative". That fence was never the real contract; it
    was a proxy for one, because PB2026 was the only edition export_site
    minted narrative citations for. export_site now mints a citation for every
    narrative a stated edge cites in ANY edition, so leg (a) — which asks
    "does this fact_id re-derive to a real narrative?" — must answer yes here.

    The real contract, "the reader can open this citation", did not go away;
    it moved to leg (g), which asserts it against the BUILT cite-shards
    instead of inferring it from an edition number. See
    test_leg_g_fails_when_the_built_shard_lacks_the_edges_fact_id."""
    fid = seed_narrative(
        pg, sha="fy25", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body="Funding was realigned to PE 0601102E for the follow-on effort.",
        fiscal_year=2025,  # a PB2025 narrative — previously out of bounds
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id=fid,
        sentence="Funding was realigned to PE 0601102E for the follow-on effort.",
    )
    g = stated_cite_leg(pg)
    assert g["ok"] is True, g["failures"]
    assert g["checked"] == 1


def test_leg_a_passes_when_edge_matches_both_named_pair(pg):
    """Companion: the SAME sentence backing the pair it actually names PASSES."""
    body = ("In FY2021, PE 0207436F (Engineering and Installation Support AF), "
            "efforts were transferred to PE 0303004F (EIT Connect).")
    fid = seed_narrative(
        pg, sha="bn2", pe_bli="837300", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]", body=body,
    )
    seed_edge(pg, "0207436F", "0303004F", fact_id=fid, sentence=body)
    g = stated_cite_leg(pg)
    assert g["ok"] is True, g["failures"]


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
    """proof-can-fail: a family root PRESENT in the series but lacking a
    request row is a real warehouse gap — never an exemptible dangling origin
    (the origin carve-out requires absence from the ENTIRE series)."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    # Series that keeps root 0601101E in the series (actuals) but NOT in the
    # request set — an in-series root with no request row must FAIL.
    db = make_series_db(
        tmp_path,
        ["0601102E", "0700001F", "0700002F", "0700003F"],
        other_pes=["0601101E"],
    )
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is False
    assert any("does not resolve in the request series" in r for _, r in g["failures"])


def test_leg_c_cited_dangling_origin_is_noted_not_failed(pg, tmp_path):
    """A family ROOT absent from the ENTIRE series whose outgoing stated edge
    is genuinely cited is a dangling ORIGIN (the mirror of the terminal
    carve-out): a cited historical predecessor in a not-yet-ingested edition.
    With per-member cited funding points (Defect 2 — no summed line exists),
    the line simply starts at the first ingested member; noted, PASS.
    Mirrors the re-extracted 0207436F -> 0303004F warehouse family."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    # Series omits root 0601101E ENTIRELY (not even an actuals row).
    db = make_series_db(
        tmp_path,
        ["0601102E", "0700001F", "0700002F", "0700003F"],
    )
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is True, g["failures"]
    assert "0601101E" in g["dangling_origins"]


def test_leg_c_uncited_dangling_origin_fails(pg, tmp_path):
    """proof-can-fail (LOCAL safety, mirror of the terminal rule): a dangling
    ORIGIN whose OUTGOING stated edge is UNcited (bogus fact_id) must FAIL —
    an un-ingested root is only exemptible on the strength of its own cited
    edge, never waved through."""
    seed_edge(
        pg, "0000042Z", "0601102E", relation="realigned",
        fact_id="deadbeefdeadbeef",
        sentence="Funding for PE 0000042Z was realigned to PE 0601102E.",
    )
    seed_family(pg, {"0000042Z": 1, "0601102E": 1})
    db = make_series_db(tmp_path, ["0601102E"])  # 0000042Z absent from series
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is False
    assert "0000042Z" not in g["dangling_origins"]
    assert any("UNcited dangling origin" in r for _, r in g["failures"])


def test_leg_c_fully_dangling_family_passes_when_all_exempted(pg, tmp_path):
    """A two-member family where the root is a cited dangling ORIGIN and the
    successor a cited dangling TERMINAL has ZERO fundable points — the site
    renders the honest empty state. Both exemptions are citation-gated; noted,
    PASS. Mirrors the re-extracted 0208550F -> 0303005F warehouse family."""
    body = "Funding for PE 0000042Z was realigned to PE 0000043Z."
    fid = seed_narrative(pg, sha="sfd", pe_bli="0000042Z", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=body)
    seed_edge(pg, "0000042Z", "0000043Z", relation="realigned", fact_id=fid,
              sentence=body)
    seed_family(pg, {"0000042Z": 1, "0000043Z": 1})
    db = make_series_db(tmp_path, ["0601101E"])  # neither member in the series
    g = one_to_one_sum_leg(pg, db)
    assert g["ok"] is True, g["failures"]
    assert "0000042Z" in g["dangling_origins"]
    assert ("0000042Z", "0000043Z") in g["dangling_terminals"]


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
# Leg (d) — funding-point value == cited fact (Defect 2, 2026-07-28)
# ===========================================================================


def make_facts_db(tmp_path: Path, request_rows: list[tuple[str, int, float, str]],
                  *, multi_source_rows: list[tuple[str, int, float, str]] | None = None) -> Path:
    """fct_decade_series with grain identities: rows are (pe, fy, amount, fid).

    request_rows are single-source grains (source_fact_id = fid).
    multi_source_rows are n_source_rows=2 grains whose citable identity is the
    DERIVED decade-sum fact — their 4th element is the amount_type (the fid is
    fact_id_derived('decade', '{pe}|{edition}', amount_type), recomputed by the
    leg exactly as _decade_fact_space mints it)."""
    _series_db_counter[0] += 1
    db = tmp_path / f"facts{_series_db_counter[0]}.duckdb"
    con = duckdb.connect(str(db))
    con.execute(
        "create table fct_decade_series (pe_bli varchar, fy int, edition_year int,"
        " amount_type_kind varchar, amount double, amount_type varchar,"
        " n_source_rows int, source_fact_id varchar)"
    )
    for pe, fy, amount, fid in request_rows:
        con.execute(
            "insert into fct_decade_series values (?, ?, ?, 'request', ?, 'fy_x', 1, ?)",
            [pe, fy, fy, amount, fid],
        )
    for pe, fy, amount, amount_type in (multi_source_rows or []):
        con.execute(
            "insert into fct_decade_series values (?, ?, ?, 'request', ?, ?, 2, null)",
            [pe, fy, fy, amount, amount_type],
        )
    con.close()
    return db


def write_program_details(tmp_path: Path, name: str, funding_line: list[dict]) -> Path:
    d = tmp_path / "program_details"
    d.mkdir(exist_ok=True)
    payload = {"lineage": {"family": {"family_id": 1, "chain": [],
                                      "funding_line": funding_line,
                                      "has_split": False}}}
    (d / f"{name}.json").write_text(json.dumps(payload))
    return d


def test_leg_d_passes_when_every_point_equals_its_cited_fact(tmp_path):
    db = make_facts_db(tmp_path, [("0601101E", 2024, 100.0, "fidA"),
                                  ("0601102E", 2024, 40.0, "fidB")])
    details = write_program_details(tmp_path, "0601101E", [
        {"fy": 2024, "pe": "0601101E", "v": 100.0, "fid": "fidA"},
        {"fy": 2024, "pe": "0601102E", "v": 40.0, "fid": "fidB"},
    ])
    g = funding_point_value_leg(db, details)
    assert g["ok"] is True, g["failures"]
    assert g["points_checked"] == 2


def test_leg_d_fails_on_summed_point(tmp_path):
    """proof-can-fail (THE Defect-2 shape): a point displaying the SUM of two
    members' facts while citing only one member's fid must FAIL — the displayed
    value is not backed by the citation."""
    db = make_facts_db(tmp_path, [("0601101E", 2024, 100.0, "fidA"),
                                  ("0601102E", 2024, 40.0, "fidB")])
    details = write_program_details(tmp_path, "0601101E", [
        {"fy": 2024, "v": 140.0, "fid": "fidB"},  # 100+40 summed, cites fidB (=40)
    ])
    g = funding_point_value_leg(db, details)
    assert g["ok"] is False
    assert any("does not equal the cited fact" in r for _, r in g["failures"])


def test_leg_d_multi_source_grain_resolves_via_derived_fact(tmp_path):
    """A multi-source request grain's citable identity is the DERIVED
    decade-sum fact — the leg recomputes fact_id_derived('decade',
    '{pe}|{edition}', amount_type) exactly as the exporter mints it."""
    from govbudget.export_site import fact_id_derived

    db = make_facts_db(tmp_path, [],
                       multi_source_rows=[("0601101E", 2020, 250.0, "fy_2020_total")])
    fid = fact_id_derived("decade", "0601101E|2020", "fy_2020_total")
    details = write_program_details(tmp_path, "0601101E", [
        {"fy": 2020, "pe": "0601101E", "v": 250.0, "fid": fid},
    ])
    g = funding_point_value_leg(db, details)
    assert g["ok"] is True, g["failures"]


def test_leg_d_fails_on_unknown_fid(tmp_path):
    db = make_facts_db(tmp_path, [("0601101E", 2024, 100.0, "fidA")])
    details = write_program_details(tmp_path, "0601101E", [
        {"fy": 2024, "pe": "0601101E", "v": 100.0, "fid": "ghost"},
    ])
    g = funding_point_value_leg(db, details)
    assert g["ok"] is False
    assert any("no request fact" in r for _, r in g["failures"])


def test_leg_d_fails_on_pe_or_fy_mismatch(tmp_path):
    """A per-member point must cite ITS OWN member's fact — a point labeled
    with one PE but citing another member's fid (or another fy's) FAILS even
    when the dollar value happens to coincide."""
    db = make_facts_db(tmp_path, [("0601101E", 2024, 100.0, "fidA"),
                                  ("0601102E", 2024, 100.0, "fidB")])
    details = write_program_details(tmp_path, "0601101E", [
        {"fy": 2024, "pe": "0601101E", "v": 100.0, "fid": "fidB"},  # wrong member's fid
    ])
    g = funding_point_value_leg(db, details)
    assert g["ok"] is False
    assert any("labeled pe" in r for _, r in g["failures"])


def test_leg_d_fails_when_details_dir_missing(tmp_path):
    db = make_facts_db(tmp_path, [("0601101E", 2024, 100.0, "fidA")])
    g = funding_point_value_leg(db, tmp_path / "nope")
    assert g["ok"] is False


# ===========================================================================
# Leg (e) — lake ↔ DB binding (2026-07-28)
# ===========================================================================


def _seed_edges_and_export_lake(pg, tmp_path: Path) -> Path:
    """Seed a small stated warehouse and stage the jbooks parquet lake next to
    a tmp duckdb path (layout: {duckdb_dir}/parquet/jbooks/*.parquet)."""
    from govbudget.jbooks.export_facts import export_facts

    _seed_clean_two_family_warehouse(pg, tmp_path)
    base = tmp_path / f"lake{_series_db_counter[0]}"
    base.mkdir()
    export_facts(pg, parquet_dir=base / "parquet")
    return base / "wh.duckdb"  # need not exist; only its parent dir matters


def test_leg_e_passes_when_lake_matches_db(pg, tmp_path):
    db = _seed_edges_and_export_lake(pg, tmp_path)
    g = lake_binding_leg(pg, db)
    assert g["ok"] is True, g["failures"]
    assert g["lineage_rows_db"] == g["lineage_rows_lake"] == 3


def test_leg_e_fails_when_parquet_missing(pg, tmp_path):
    """proof-can-fail: a missing lake parquet is a FAIL (never a skip) — an
    un-staged lake would silently decouple the site export from Postgres."""
    _seed_clean_two_family_warehouse(pg, tmp_path)
    base = tmp_path / "emptylake"
    base.mkdir()
    g = lake_binding_leg(pg, base / "wh.duckdb")
    assert g["ok"] is False
    assert any("missing" in r for _, r in g["failures"])


def test_leg_e_fails_on_lineage_row_drift(pg, tmp_path):
    """proof-can-fail: an edge present in Postgres but not in the staged lake
    (stale lake after a rebuild) must FAIL the binding."""
    db = _seed_edges_and_export_lake(pg, tmp_path)
    seed_edge(pg, "0601102E", "0699999E", fact_id="late", sentence="PE x.")
    g = lake_binding_leg(pg, db)
    assert g["ok"] is False
    assert any("db-only" in r for _, r in g["failures"])


def test_leg_e_fails_on_family_partition_drift(pg, tmp_path):
    """proof-can-fail: a family regrouped in Postgres after staging must FAIL."""
    db = _seed_edges_and_export_lake(pg, tmp_path)
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("update program_family set family_id=7 where pe_bli='0700003F'")
    g = lake_binding_leg(pg, db)
    assert g["ok"] is False
    assert any("partition" in r for _, r in g["failures"])


# ===========================================================================
# Leg (f) — no-self-retraction (#53, 2026-08-08)
# ===========================================================================


def test_leg_f_passes_on_a_clean_transfer(pg):
    body = "Funding for PE 0601101E was realigned to PE 0601102E."
    fid = seed_narrative(
        pg, sha="s1", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]", body=body,
    )
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=body)
    g = no_retraction_leg(pg)
    assert g["ok"] is True, g["failures"]
    assert g["checked"] == 1 and g["passed"] == 1


def test_leg_f_fails_on_a_same_sentence_retraction(pg):
    """proof-can-fail: the #53 shape — a cue in the edge's OWN sentence."""
    body = "In FY 2026, funds were erroneously transferred to PE 0601102E."
    fid = seed_narrative(
        pg, sha="s2", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]", body=body,
    )
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=body)
    g = no_retraction_leg(pg)
    assert g["ok"] is False
    assert any("retracts itself" in r for _, r in g["failures"])


def test_leg_f_fails_on_a_next_sentence_retraction_naming_the_edges_own_pe(pg):
    """proof-can-fail: the #53 REAL shape — the cue is the NEXT sentence, and
    it names one of this edge's own endpoints (the "back to PE X" pattern)."""
    body = ("Project X is transferred to Program Element 0601102E. "
            "This funding will be realigned back to PE 0601101E.")
    fid = seed_narrative(
        pg, sha="s3", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]", body=body,
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id=fid,
        sentence="Project X is transferred to Program Element 0601102E.",
    )
    g = no_retraction_leg(pg)
    assert g["ok"] is False
    assert any("retracts itself" in r for _, r in g["failures"])


def test_leg_f_passes_when_next_sentence_cue_is_about_a_different_program(pg):
    """Companion (the false-positive this leg must NOT produce): a cue in the
    next sentence that names a DIFFERENT PE pair entirely must not retract
    this edge — mirrors the real 1203154SF page where a clean transfer
    sentence is immediately followed by an unrelated erroneous one."""
    body = ("Project M is transferred to Program Element 0601102E. "
            "Project N was erroneously transferred to Program Element 0699999E.")
    fid = seed_narrative(
        pg, sha="s4", pe_bli="0601101E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]", body=body,
    )
    seed_edge(
        pg, "0601101E", "0601102E", fact_id=fid,
        sentence="Project M is transferred to Program Element 0601102E.",
    )
    g = no_retraction_leg(pg)
    assert g["ok"] is True, g["failures"]


def test_leg_f_is_non_vacuous_with_zero_stated_edges(pg):
    """proof-can-fail: an empty program_lineage must FAIL, not vacuously PASS."""
    g = no_retraction_leg(pg)
    assert g["ok"] is False
    assert g["checked"] == 0


# ===========================================================================
# All-pass end-to-end
# ===========================================================================


def test_all_legs_pass_on_clean_mini_warehouse(pg, tmp_path):
    from govbudget.jbooks.export_facts import export_facts

    db = _seed_clean_two_family_warehouse(pg, tmp_path)
    base = tmp_path / "e2e-lake"
    base.mkdir()
    export_facts(pg, parquet_dir=base / "parquet")
    facts_db = make_facts_db(tmp_path, [("0601101E", 2026, 100.0, "fidA")])
    details = write_program_details(tmp_path, "0601101E", [
        {"fy": 2026, "pe": "0601101E", "v": 100.0, "fid": "fidA"},
    ])
    a = stated_cite_leg(pg)
    b = family_integrity_leg(pg)
    c = one_to_one_sum_leg(pg, db)
    d = funding_point_value_leg(facts_db, details)
    e = lake_binding_leg(pg, base / "wh.duckdb")
    f = no_retraction_leg(pg)
    assert a["ok"] and b["ok"] and c["ok"] and d["ok"] and e["ok"] and f["ok"], (
        a, b, c, d, e, f,
    )


# ===========================================================================
# Leg (g) — artifact cite-resolution (#29(b))
# ===========================================================================


def _build_artifact(tmp_path: Path, *, pe: str, other: str, fid: str,
                    sentence: str, shard_has_fid: bool = True,
                    shard_official_url: str | None = "https://example.test/d.pdf",
                    rail_fid: str | None = None,
                    rail_sentence: str | None = None) -> tuple[Path, Path]:
    """A minimal BUILT site artifact: one program_details sidecar + shards."""
    details = tmp_path / "program_details"
    shards = tmp_path / "cite-shards"
    details.mkdir(parents=True, exist_ok=True)
    shards.mkdir(parents=True, exist_ok=True)
    (details / f"{pe}.json").write_text(json.dumps({
        "lineage": {"rail": {"successors": [{
            "pe": other, "confidence": "stated", "relation": "realigned",
            "evidence": {
                "fact_id": rail_fid if rail_fid is not None else fid,
                "page": None,
                "sentence": rail_sentence if rail_sentence is not None else sentence,
            },
        }], "predecessors": []}},
    }))
    shard = {}
    if shard_has_fid:
        shard[fid] = {
            "kind": "jbook_narrative",
            "sha256": "a" * 64,
            "official_url": shard_official_url,
            "page_number": None,
        }
    (shards / f"{fid[:2]}.json").write_text(json.dumps(shard))
    return details, shards


def test_leg_g_passes_on_a_coherent_artifact(pg, tmp_path):
    from govbudget.verify_lineage import artifact_cite_leg

    sent = "Funding was realigned to PE 0601102E for the follow-on effort."
    fid = seed_narrative(pg, sha="g1", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=sent,
                         fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=sent, fy=2019)
    details, shards = _build_artifact(tmp_path, pe="0601101E", other="0601102E",
                                      fid=fid, sentence=sent)
    g = artifact_cite_leg(pg, details, shards)
    assert g["ok"] is True, g["failures"]
    assert g["checked"] == 1 and g["rendered"] == 1


def test_leg_g_fails_when_the_built_shard_lacks_the_edges_fact_id(pg, tmp_path):
    """proof-can-fail — THE defect the PB2026 fence used to prevent by brute
    force: a pre-2026 stated edge whose citation resolves to nothing. Leg (a)
    passes here (the narrative is real); only the artifact shows the dead
    <Cite>."""
    from govbudget.verify_lineage import artifact_cite_leg

    sent = "Funding was realigned to PE 0601102E for the follow-on effort."
    fid = seed_narrative(pg, sha="g2", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=sent,
                         fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=sent, fy=2019)
    assert stated_cite_leg(pg)["ok"] is True   # the warehouse row is honest
    details, shards = _build_artifact(tmp_path, pe="0601101E", other="0601102E",
                                      fid=fid, sentence=sent, shard_has_fid=False)
    g = artifact_cite_leg(pg, details, shards)
    assert g["ok"] is False
    assert any("absent from the built cite-shard" in r for _, r in g["failures"])


def test_leg_g_fails_when_the_shard_record_names_no_openable_source(pg, tmp_path):
    from govbudget.verify_lineage import artifact_cite_leg

    sent = "Funding was realigned to PE 0601102E for the follow-on effort."
    fid = seed_narrative(pg, sha="g3", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=sent,
                         fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=sent, fy=2019)
    details, shards = _build_artifact(tmp_path, pe="0601101E", other="0601102E",
                                      fid=fid, sentence=sent,
                                      shard_official_url=None)
    g = artifact_cite_leg(pg, details, shards)
    assert g["ok"] is False
    assert any("names no openable source" in r for _, r in g["failures"])


def test_leg_g_fails_when_the_page_ships_a_stale_sentence(pg, tmp_path):
    """A resolving shard beside a page that quotes an older sentence still
    misleads the reader — the artifact must match the row it came from."""
    from govbudget.verify_lineage import artifact_cite_leg

    sent = "Funding was realigned to PE 0601102E for the follow-on effort."
    fid = seed_narrative(pg, sha="g4", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=sent,
                         fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=sent, fy=2019)
    details, shards = _build_artifact(
        tmp_path, pe="0601101E", other="0601102E", fid=fid, sentence=sent,
        rail_sentence="An older sentence the warehouse no longer holds.")
    g = artifact_cite_leg(pg, details, shards)
    assert g["ok"] is False
    assert any("evidence sentence that is" in r for _, r in g["failures"])


def test_leg_g_is_not_vacuous_with_zero_stated_edges(pg, tmp_path):
    from govbudget.verify_lineage import artifact_cite_leg

    details, shards = tmp_path / "program_details", tmp_path / "cite-shards"
    details.mkdir(); shards.mkdir()
    g = artifact_cite_leg(pg, details, shards)
    assert g["ok"] is False
    assert "vacuous" in (g.get("reason") or "")


# ===========================================================================
# Leg (h) — supersession (#29(b))
# ===========================================================================


def test_leg_h_passes_when_no_later_edition_disagrees(pg):
    from govbudget.verify_lineage import no_supersession_leg

    sent = "Funding was realigned to PE 0601102E for the follow-on effort."
    fid = seed_narrative(pg, sha="h1", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=sent,
                         fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=sent, fy=2019)
    h = no_supersession_leg(pg)
    assert h["ok"] is True, h["failures"]
    assert h["checked"] == 1


def test_leg_h_fails_when_a_later_edition_states_the_mirror_link(pg):
    """proof-can-fail: PB2019 says X→Y, PB2024 says Y→X. The direction is
    contested, so neither is a settled Stated fact."""
    from govbudget.verify_lineage import no_supersession_leg

    s1 = "Funding was realigned to PE 0601102E for the follow-on effort."
    f1 = seed_narrative(pg, sha="h2a", pe_bli="0601101E", kind="mission",
                        xml_path="ProgramElement[0]/Narrative[0]", body=s1,
                        fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=f1, sentence=s1, fy=2019)
    s2 = "Funding was realigned to PE 0601101E to restore the original line."
    f2 = seed_narrative(pg, sha="h2b", pe_bli="0601102E", kind="mission",
                        xml_path="ProgramElement[0]/Narrative[0]", body=s2,
                        fiscal_year=2024)
    seed_edge(pg, "0601102E", "0601101E", fact_id=f2, sentence=s2, fy=2024)
    h = no_supersession_leg(pg)
    assert h["ok"] is False
    assert any("mirror link" in r for _, r in h["failures"])


def test_leg_h_fails_when_a_later_edition_retracts_the_transfer(pg):
    """proof-can-fail: the retraction of a PB2019 transfer is printed in
    PB2022, which single-edition extraction could never see."""
    from govbudget.verify_lineage import no_supersession_leg

    s1 = "Funding was realigned to PE 0601102E for the follow-on effort."
    f1 = seed_narrative(pg, sha="h3a", pe_bli="0601101E", kind="mission",
                        xml_path="ProgramElement[0]/Narrative[0]", body=s1,
                        fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=f1, sentence=s1, fy=2019)
    seed_narrative(
        pg, sha="h3b", pe_bli="0601102E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body=("Funds moved from PE 0601101E to PE 0601102E were transferred"
              " in error and will be returned."),
        fiscal_year=2022)
    h = no_supersession_leg(pg)
    assert h["ok"] is False
    assert any("retracts it" in r for _, r in h["failures"])


def test_leg_h_ignores_an_earlier_edition_and_mere_silence(pg):
    """A later edition that simply stops mentioning the link supersedes
    nothing, and an EARLIER retraction cannot take back a LATER statement."""
    from govbudget.verify_lineage import no_supersession_leg

    s1 = "Funding was realigned to PE 0601102E for the follow-on effort."
    f1 = seed_narrative(pg, sha="h4a", pe_bli="0601101E", kind="mission",
                        xml_path="ProgramElement[0]/Narrative[0]", body=s1,
                        fiscal_year=2024)
    seed_edge(pg, "0601101E", "0601102E", fact_id=f1, sentence=s1, fy=2024)
    seed_narrative(
        pg, sha="h4b", pe_bli="0601102E", kind="mission",
        xml_path="ProgramElement[0]/Narrative[0]",
        body=("An earlier move from PE 0601101E to PE 0601102E was made"
              " in error."),
        fiscal_year=2019)                      # EARLIER — cannot supersede
    seed_narrative(
        pg, sha="h4c", pe_bli="0601102E", kind="mission",
        xml_path="ProgramElement[1]/Narrative[0]",
        body="This program element continues prior-year work.",
        fiscal_year=2026)                      # later, but says nothing
    h = no_supersession_leg(pg)
    assert h["ok"] is True, h["failures"]


def test_leg_g_does_not_call_a_page_that_exists_missing(pg, tmp_path):
    """The message must not misexplain the finding. An edge whose endpoint HAS
    a sidecar but is absent from its rail is a FAIL about that rail — never a
    NOTE saying the endpoint has no page, which sends the reader looking for a
    file that is right there. (Caught on the live pre-failure run.)"""
    from govbudget.verify_lineage import artifact_cite_leg

    sent = "Funding was realigned to PE 0601102E for the follow-on effort."
    fid = seed_narrative(pg, sha="g5", pe_bli="0601101E", kind="mission",
                         xml_path="ProgramElement[0]/Narrative[0]", body=sent,
                         fiscal_year=2019)
    seed_edge(pg, "0601101E", "0601102E", fact_id=fid, sentence=sent, fy=2019)
    # The sidecar exists; its rail cites a DIFFERENT fact.
    details, shards = _build_artifact(tmp_path, pe="0601101E", other="0601102E",
                                      fid=fid, sentence=sent,
                                      rail_fid="00" * 8)
    g = artifact_cite_leg(pg, details, shards)
    assert g["ok"] is False
    assert any("ships no rail entry" in r for _, r in g["failures"])
    assert g["unrendered"] == []
