"""Phase 5B-3 Task 7a tests: dossier research fetcher + seed CSV validation.

Coverage (plan Task 7a TDD scope):
  - top50() against a fixture duckdb (workbook_org translation, ordering,
    dim_programs-only scope)
  - RSS parsing (RSS 2.0 + Atom, stdlib xml.etree)
  - keyword matcher (>=5-char non-generic title tokens + alias terms,
    word boundaries)
  - fetcher politeness via httpx.MockTransport: robots deny -> skip (no
    article request), robots 4xx -> allow, robots 5xx -> skip, >=1s/host
    spacing with injected clock/sleep
  - snapshot shape ({url, retrieved_at, sha256, title, text}) + {sha}.json +
    index.json maintenance
  - committed seed CSVs: program_categories.csv (enum, non-empty rationale +
    source_ref; all-top-50 coverage when the live duckdb is present) and
    search_aliases.csv (shape, /program/ targets, pe_bli existence when the
    live duckdb is present)
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import duckdb
import httpx
import pytest

from govbudget.dossiers.research import (
    GENERIC_TITLE_TOKENS,
    RSS_FEEDS,
    USER_AGENT,
    SnapshotFetcher,
    build_program_terms,
    extract_text,
    load_alias_terms,
    match_articles,
    parse_feed,
    title_terms,
    top50,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CATEGORIES_CSV = REPO_ROOT / "data-seeds" / "program_categories.csv"
ALIASES_CSV = REPO_ROOT / "data-seeds" / "search_aliases.csv"
LIVE_DUCKDB = REPO_ROOT / "data" / "duckdb" / "govbudget.duckdb"
NARRATIVES_PARQUET = REPO_ROOT / "data" / "site" / "data" / "jbook_narratives.parquet"

CATEGORY_ENUM = {"drones", "hypersonics", "space", "shipbuilding", "cyber", "default"}


# ---------------------------------------------------------------------------
# top50 (fixture duckdb)
# ---------------------------------------------------------------------------


@pytest.fixture()
def fixture_duckdb(tmp_path):
    db = tmp_path / "fixture.duckdb"
    con = duckdb.connect(str(db))
    con.execute("create table dim_programs (pe_bli varchar, org varchar,"
                " exhibit_family varchar, project_count bigint,"
                " fy2024_actual_millions double, fully_reconciled boolean,"
                " title varchar)")
    con.execute("create table fct_budget_trajectory (pe_bli varchar,"
                " organization varchar, fy2024_actuals double,"
                " fy2025_total double, fy2026_total double,"
                " fy2526_change double, fy2526_pct_change double)")
    rows = [
        # (pe_bli, doc org, title, workbook org, fy2026)
        ("0601101E", "DARPA", "Defense Research Sciences", "DARPA", 100.0),
        # CYBERCOM doc org -> CYBER workbook org (the translation under test)
        ("0306250JCY", "CYBERCOM", "Cyber Operations Technology Support", "CYBER", 900.0),
        ("0603183D8Z", "OSD", "Joint Hypersonic Technology", "OSD", 500.0),
        # in dim_programs but NO trajectory row -> excluded
        ("0699NOPE", "OSD", "Orphan Program", None, None),
    ]
    for pe, org, title, wb, total in rows:
        con.execute("insert into dim_programs values (?,?,?,?,?,?,?)",
                    [pe, org, "rdte", 1, 1.0, True, title])
        if wb is not None:
            con.execute("insert into fct_budget_trajectory values (?,?,?,?,?,?,?)",
                        [pe, wb, 1.0, 1.0, total, 0.0, 0.0])
    # trajectory-only service line (not in dim_programs) -> never selected
    con.execute("insert into fct_budget_trajectory values"
                " ('2013','N',0,0,99999999,0,0)")
    con.close()
    return db


class TestTop50:
    def test_orders_by_fy2026_and_translates_org(self, fixture_duckdb):
        rows = top50(fixture_duckdb)
        assert [r[0] for r in rows] == ["0306250JCY", "0603183D8Z", "0601101E"]
        # the CYBERCOM row was matched via workbook_org('CYBERCOM') == 'CYBER'
        assert rows[0] == ("0306250JCY", "Cyber Operations Technology Support",
                           "CYBERCOM", 900.0)

    def test_scope_is_dim_programs_only(self, fixture_duckdb):
        pes = {r[0] for r in top50(fixture_duckdb)}
        assert "2013" not in pes      # service line without a program page
        assert "0699NOPE" not in pes  # no trajectory row -> no fy2026 total

    def test_limit(self, fixture_duckdb):
        assert len(top50(fixture_duckdb, limit=2)) == 2


# ---------------------------------------------------------------------------
# RSS parsing
# ---------------------------------------------------------------------------

RSS_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title>Army fields hypersonic missile</title>
<link>https://example.com/a1</link>
<description>Long Range Hypersonic Weapon update</description>
<pubDate>Thu, 11 Jun 2026 12:00:00 +0000</pubDate></item>
<item><title>No link item</title></item>
</channel></rss>"""

ATOM_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>
<entry><title>Aegis test</title>
<link rel="alternate" href="https://example.com/b1"/>
<summary>SM-3 intercept</summary>
<published>2026-06-11T12:00:00Z</published></entry>
</feed>"""


class TestParseFeed:
    def test_rss2(self):
        items = parse_feed(RSS_SAMPLE)
        assert items == [{
            "title": "Army fields hypersonic missile",
            "url": "https://example.com/a1",
            "summary": "Long Range Hypersonic Weapon update",
            "published": "Thu, 11 Jun 2026 12:00:00 +0000",
        }]

    def test_atom(self):
        items = parse_feed(ATOM_SAMPLE)
        assert items[0]["url"] == "https://example.com/b1"
        assert items[0]["title"] == "Aegis test"

    def test_feed_registry_is_the_seven_verified_sources(self):
        assert len(RSS_FEEDS) == 7
        for url in RSS_FEEDS.values():
            assert url.startswith("https://")


# ---------------------------------------------------------------------------
# Keyword matcher
# ---------------------------------------------------------------------------


class TestKeywordMatcher:
    def test_title_terms_drop_short_and_generic(self):
        terms = title_terms("Joint Hypersonic Technology Development &Transition")
        assert "hypersonic" in terms
        # generic/short tokens excluded
        assert "joint" not in terms
        assert "technology" not in terms
        assert "development" not in terms

    def test_generic_list_is_lowercase(self):
        assert all(t == t.lower() for t in GENERIC_TITLE_TOKENS)

    def test_alias_terms_merge_into_program_terms(self):
        programs = [("0604122D8Z", "JADC2 Development and Experimentation Activities",
                     "OSD", 1.0)]
        terms = build_program_terms(programs, {"jadc2": "0604122D8Z",
                                               "thaad": "MD07-not-in-set"})
        assert "jadc2" in terms["0604122D8Z"]
        assert "MD07-not-in-set" not in terms  # alias for unknown pe ignored

    def test_match_word_boundaries(self):
        programs = [("0603183D8Z", "Joint Hypersonic Technology", "OSD", 1.0)]
        terms = build_program_terms(programs)
        items = [
            {"title": "Hypersonic test succeeds", "url": "u1", "summary": ""},
            {"title": "HYPERSONICS budget grows", "url": "u2", "summary": ""},
            # substring inside a longer token must NOT match
            {"title": "antihypersonic shield", "url": "u3", "summary": ""},
        ]
        got = match_articles(items, terms)
        assert [m["url"] for m in got] == ["u1"]
        assert got[0]["pe_bli"] == "0603183D8Z"
        assert got[0]["matched_term"] == "hypersonic"

    def test_match_in_summary(self):
        terms = {"MD07": {"thaad"}}
        items = [{"title": "Missile defense", "url": "u",
                  "summary": "THAAD battery deployed"}]
        assert match_articles(items, terms)[0]["matched_term"] == "thaad"


# ---------------------------------------------------------------------------
# Polite fetcher (httpx.MockTransport)
# ---------------------------------------------------------------------------

ARTICLE_HTML = """<html><head><title>Hypersonic article</title>
<script>tracking()</script></head>
<body><nav>menu</nav><p>The Army tested a hypersonic missile.</p></body></html>"""


def _transport(robots_status=200, robots_text="User-agent: *\nAllow: /\n",
               calls=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(robots_status, text=robots_text)
        return httpx.Response(200, text=ARTICLE_HTML)
    return httpx.MockTransport(handler)


def _fetcher(tmp_path, transport, *, sleeps=None, clock=None):
    client = httpx.Client(transport=transport)
    times = {"t": 0.0}

    def fake_clock():
        times["t"] += 0.01  # monotonic-ish
        return times["t"]

    return SnapshotFetcher(
        client, tmp_path / "snapshots",
        sleep=(sleeps.append if sleeps is not None else (lambda s: None)),
        clock=clock or fake_clock,
    )


class TestFetcherPoliteness:
    def test_robots_deny_skips_article(self, tmp_path):
        calls: list[str] = []
        f = _fetcher(tmp_path, _transport(
            robots_text="User-agent: *\nDisallow: /\n", calls=calls))
        snap = f.fetch_snapshot("https://example.com/article")
        assert snap is None
        # only robots.txt was requested — never the article
        assert calls == ["https://example.com/robots.txt"]

    def test_robots_404_allows(self, tmp_path):
        f = _fetcher(tmp_path, _transport(robots_status=404))
        assert f.fetch_snapshot("https://example.com/article") is not None

    def test_robots_500_conservative_skip(self, tmp_path):
        calls: list[str] = []
        f = _fetcher(tmp_path, _transport(robots_status=500, calls=calls))
        assert f.fetch_snapshot("https://example.com/article") is None
        assert calls == ["https://example.com/robots.txt"]

    def test_rate_spacing_same_host(self, tmp_path):
        sleeps: list[float] = []
        f = _fetcher(tmp_path, _transport(), sleeps=sleeps)
        f.fetch_snapshot("https://example.com/a")
        f.fetch_snapshot("https://example.com/b")
        # consecutive same-host requests (robots + a + b) with a fast clock
        # must be spaced by sleeping the remaining interval
        assert sleeps, "expected sleep() to be called for same-host spacing"
        assert all(0 < s <= 1.0 for s in sleeps)

    def test_honest_user_agent_sent(self, tmp_path):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen[request.url.path] = request.headers.get("user-agent")
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            return httpx.Response(200, text=ARTICLE_HTML)

        f = _fetcher(tmp_path, httpx.MockTransport(handler))
        f.fetch_snapshot("https://example.com/article")
        assert seen["/robots.txt"] == USER_AGENT
        assert seen["/article"] == USER_AGENT


class TestSnapshotShape:
    def test_snapshot_fields_and_files(self, tmp_path):
        f = _fetcher(tmp_path, _transport())
        snap = f.fetch_snapshot("https://example.com/article",
                                pe_bli="0603183D8Z", matched_term="hypersonic")
        assert snap is not None
        assert set(snap) == {"url", "retrieved_at", "sha256", "title", "text"}
        assert snap["url"] == "https://example.com/article"
        assert re.fullmatch(r"[0-9a-f]{64}", snap["sha256"])
        assert snap["title"] == "Hypersonic article"
        assert "hypersonic missile" in snap["text"]
        assert "tracking()" not in snap["text"]  # scripts stripped
        # {sha}.json written
        path = tmp_path / "snapshots" / f"{snap['sha256']}.json"
        assert path.exists()
        assert json.loads(path.read_text())["url"] == snap["url"]
        # index.json maintained
        index = json.loads((tmp_path / "snapshots" / "index.json").read_text())
        assert index["snapshots"][0]["pe_bli"] == "0603183D8Z"
        assert index["snapshots"][0]["matched_term"] == "hypersonic"
        assert index["snapshots"][0]["sha256"] == snap["sha256"]

    def test_index_dedupes_same_sha_and_pe(self, tmp_path):
        f = _fetcher(tmp_path, _transport())
        f.fetch_snapshot("https://example.com/a", pe_bli="X")
        f.fetch_snapshot("https://example.com/a", pe_bli="X")
        index = json.loads((tmp_path / "snapshots" / "index.json").read_text())
        assert len(index["snapshots"]) == 1

    def test_extract_text_strips_chrome(self):
        title, text = extract_text(ARTICLE_HTML)
        assert title == "Hypersonic article"
        assert "menu" not in text  # nav removed


# ---------------------------------------------------------------------------
# Committed seed CSVs
# ---------------------------------------------------------------------------


def _read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


class TestProgramCategoriesCsv:
    def test_shape_enum_and_nonempty_refs(self):
        rows = _read_csv(CATEGORIES_CSV)
        assert len(rows) == 50
        pes = [r["pe_bli"] for r in rows]
        assert len(set(pes)) == 50, "duplicate pe_bli rows"
        for r in rows:
            assert r["category"] in CATEGORY_ENUM, r
            assert r["rationale"].strip(), r["pe_bli"]
            assert r["source_ref"].strip(), r["pe_bli"]

    def test_default_rows_explain_why(self):
        for r in _read_csv(CATEGORIES_CSV):
            if r["category"] == "default":
                # rationale must say why no category fits (conservative authorship)
                assert re.search(
                    r"(no |not |none |portfolio|stretch|signal|classified|distinct)",
                    r["rationale"], re.IGNORECASE,
                ), r["pe_bli"]

    @pytest.mark.skipif(not LIVE_DUCKDB.exists(), reason="live duckdb not present")
    def test_covers_live_top50_exactly(self):
        live = {r[0] for r in top50(LIVE_DUCKDB)}
        committed = {r["pe_bli"] for r in _read_csv(CATEGORIES_CSV)}
        assert committed == live

    @pytest.mark.skipif(
        not NARRATIVES_PARQUET.exists(), reason="narratives sidecar not present"
    )
    def test_source_refs_resolve_to_narratives(self):
        con = duckdb.connect()
        known = set(con.execute(
            f"select pe_bli, xml_path from"
            f" read_parquet('{NARRATIVES_PARQUET}')"
        ).fetchall())
        con.close()
        for r in _read_csv(CATEGORIES_CSV):
            assert (r["pe_bli"], r["source_ref"]) in known, (
                f"{r['pe_bli']}: source_ref {r['source_ref']} not found in"
                " jbook_narratives"
            )


class TestSearchAliasesCsv:
    def test_shape_and_targets(self):
        rows = _read_csv(ALIASES_CSV)
        assert 10 <= len(rows) <= 20
        terms = [r["term"] for r in rows]
        assert len(set(t.lower() for t in terms)) == len(terms)
        for r in rows:
            assert r["term"].strip()
            assert re.fullmatch(r"/program/[^/]+/", r["target_url"]), r
            assert r["source_ref"].strip(), r["term"]
            assert re.match(r"^(jbook:|lda:)", r["source_ref"]), (
                f"{r['term']}: source_ref must cite a J-book narrative"
                " (jbook:pe_bli:xml_path) or an LDA filing (lda:uuid)"
            )
            assert r["note"].strip(), r["term"]

    def test_loader_extracts_pe_bli(self):
        terms = load_alias_terms(ALIASES_CSV)
        assert terms.get("jadc2") == "0604122D8Z"
        assert all(re.fullmatch(r"[0-9A-Za-z]+", pe) for pe in terms.values())

    @pytest.mark.skipif(not LIVE_DUCKDB.exists(), reason="live duckdb not present")
    def test_targets_exist_in_dim_programs(self):
        con = duckdb.connect(str(LIVE_DUCKDB), read_only=True)
        known = {r[0] for r in con.execute("select pe_bli from dim_programs").fetchall()}
        con.close()
        for term, pe in load_alias_terms(ALIASES_CSV).items():
            assert pe in known, f"alias {term!r} targets missing program {pe}"

    @pytest.mark.skipif(
        not NARRATIVES_PARQUET.exists(), reason="narratives sidecar not present"
    )
    def test_jbook_source_refs_resolve(self):
        con = duckdb.connect()
        known = set(con.execute(
            f"select pe_bli, xml_path from"
            f" read_parquet('{NARRATIVES_PARQUET}')"
        ).fetchall())
        con.close()
        for r in _read_csv(ALIASES_CSV):
            ref = r["source_ref"]
            if not ref.startswith("jbook:"):
                continue
            _, pe, xml_path = ref.split(":", 2)
            assert (pe, xml_path) in known, f"{r['term']}: {ref} unresolved"
