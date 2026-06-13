"""Phase 5B-3 Task 7a: dossier research fetcher.

Pieces (plan Task 7a; recon doc 2026-06-12-phase5b3-recon-artifacts.md):

- top50(duckdb_path)        — the dossier selection (recon §C): dim_programs
                              joined to fct_budget_trajectory via the
                              workbook_org() translation (govbudget.jbooks.orgs),
                              ordered by fy2026_total desc, limit 50.
- RSS_FEEDS                 — the 7 feeds verified live in recon §I (Janes has
                              no public RSS; Inside Defense / Defense Daily are
                              paywalled and excluded).
- parse_feed()              — stdlib xml.etree parser for RSS 2.0 + Atom.
- build_program_terms()     — keyword matcher terms: program-title tokens
                              (>=5 chars, non-generic) + alias terms from
                              data-seeds/search_aliases.csv.
- match_articles()          — case-insensitive word-boundary matching of feed
                              items against program terms.
- SnapshotFetcher           — polite article fetcher: honest UA, robots.txt
                              honored (urllib.robotparser), <=1 req/s/host.
                              Snapshot = {url, retrieved_at, sha256, title,
                              text} written to
                              data/research/snapshots/{sha256}.json plus an
                              index at data/research/snapshots/index.json.
- fetch_research()          — orchestration used by `govbudget dossiers fetch`.

Citation/source_ref conventions used by the committed seed CSVs
(data-seeds/program_categories.csv, data-seeds/search_aliases.csv):
  - bare xml_path (e.g. 'ProgramElement[22]')   — J-book narrative for the
    row's own pe_bli (jbook_narratives sidecar / Postgres detail_narratives).
  - 'jbook:{pe_bli}:{xml_path}'                 — J-book narrative of another
    program (cross-program alias evidence).
  - 'lda:{filing_uuid}'                         — LDA filing whose activity
    description contains the term (fct_program_lobbying / lda_activities).
  - 'snapshot:{sha256}'                         — cached article snapshot in
    data/research/snapshots/.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import re
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit

import httpx

USER_AGENT = "GovBudget-Research/1.0 (contact: research@govbudget.dev)"

# Verified live 2026-06-12 (recon §I): each URL returns RSS 2.0 XML.
RSS_FEEDS: dict[str, str] = {
    "defense_news": "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml",
    "breaking_defense": "https://breakingdefense.com/feed/",
    "the_war_zone": "https://www.twz.com/feed",
    "usni_news": "https://news.usni.org/feed",
    "air_and_space_forces": "https://www.airandspaceforces.com/feed/",
    "defensescoop": "https://defensescoop.com/feed/",
    "c4isrnet": "https://www.c4isrnet.com/arc/outboundfeeds/rss/?outputType=xml",
}

# Title tokens that appear across dozens of program titles and/or are common
# defense-news vocabulary carrying no program identity — never used as match
# terms even when >=5 chars. (Tuned against a live pull of the 7 feeds: broad
# tokens like 'platforms' or 'aviation' matched unrelated articles.)
GENERIC_TITLE_TOKENS: frozenset[str] = frozenset({
    "advanced", "activities", "agency", "analysis", "assured", "ballistic",
    "battle", "capabilities", "center", "central", "chain", "command",
    "communications", "complex", "control", "cooperative", "counter",
    "defense", "development", "demonstration", "destruction", "emerging",
    "enabling", "engineering", "enhancements", "enterprise", "evaluation",
    "experimentation", "fielding", "hazard", "homeland", "improved",
    "industrial", "information", "innovation", "innovative", "intelligence",
    "investment", "israeli", "joint", "logistics", "maintaining", "making",
    "management", "manufacturing", "maritime", "missile", "mitigation",
    "network", "operations", "operational", "opportunities", "performance",
    "pilot", "platforms", "procurement", "production", "program", "programs",
    "protection", "prototyping", "purchases", "rapid", "research", "science",
    "sciences", "segment", "sensors", "software", "special", "supply",
    "support", "sustainment", "system", "systems", "targets", "technology",
    "technologies", "terminal", "transition", "trusted", "warfare",
    "warfighting", "warrior", "weapons", "aviation",
})

MIN_TOKEN_LEN = 5


# ---------------------------------------------------------------------------
# Top-50 selection (recon §C — MUST stay within dim_programs)
# ---------------------------------------------------------------------------


def top50(duckdb_path: str | Path, *, limit: int = 50) -> list[tuple[str, str, str, float]]:
    """Dossier selection: top-`limit` dim_programs by FY2026 total.

    Joins dim_programs to fct_budget_trajectory on
    (pe_bli, workbook_org(org)) — the doc-org -> workbook-org translation is
    Python-side (govbudget.jbooks.orgs.workbook_org), per recon §C.

    Returns [(pe_bli, title, org, fy2026_total)], fy2026_total in $thousands.
    Programs with no trajectory row (or NULL fy2026_total) are excluded —
    a naive top-50 over fct_budget_trajectory alone would pick service lines
    without program pages.
    """
    import duckdb

    from govbudget.jbooks.orgs import workbook_org

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        progs = con.execute("select pe_bli, title, org from dim_programs").fetchall()
        traj = {
            (r[0], r[1]): r[2]
            for r in con.execute(
                "select pe_bli, organization, fy2026_total from fct_budget_trajectory"
            ).fetchall()
        }
    finally:
        con.close()

    rows: list[tuple[str, str, str, float]] = []
    for pe_bli, title, org in progs:
        total = traj.get((pe_bli, workbook_org(org)))
        if total is None:
            continue
        rows.append((pe_bli, title, org, float(total)))
    rows.sort(key=lambda r: -r[3])
    return rows[:limit]


# ---------------------------------------------------------------------------
# RSS parsing (stdlib xml.etree; RSS 2.0 + Atom)
# ---------------------------------------------------------------------------

_ATOM_NS = "{http://www.w3.org/2005/Atom}"


def parse_feed(xml_text: str) -> list[dict]:
    """Parse RSS 2.0 or Atom into [{title, url, summary, published}]."""
    root = ET.fromstring(xml_text)
    items: list[dict] = []

    if root.tag == "rss" or root.tag.endswith("rss"):
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            url = (item.findtext("link") or "").strip()
            summary = (item.findtext("description") or "").strip()
            published = (item.findtext("pubDate") or "").strip()
            if title and url:
                items.append({"title": title, "url": url,
                              "summary": summary, "published": published})
    elif root.tag == f"{_ATOM_NS}feed":
        for entry in root.iter(f"{_ATOM_NS}entry"):
            title = (entry.findtext(f"{_ATOM_NS}title") or "").strip()
            url = ""
            for link in entry.iter(f"{_ATOM_NS}link"):
                rel = link.get("rel", "alternate")
                if rel == "alternate" and link.get("href"):
                    url = link.get("href", "").strip()
                    break
            summary = (entry.findtext(f"{_ATOM_NS}summary")
                       or entry.findtext(f"{_ATOM_NS}content") or "").strip()
            published = (entry.findtext(f"{_ATOM_NS}published")
                         or entry.findtext(f"{_ATOM_NS}updated") or "").strip()
            if title and url:
                items.append({"title": title, "url": url,
                              "summary": summary, "published": published})
    return items


# ---------------------------------------------------------------------------
# Keyword matcher
# ---------------------------------------------------------------------------


def title_terms(title: str) -> set[str]:
    """Distinctive lowercase tokens from a program title.

    Tokens must be >= MIN_TOKEN_LEN chars, alphabetic-leading, and not in
    GENERIC_TITLE_TOKENS. Acronyms in parens (e.g. '(C2BMC)') survive as
    their own tokens when long enough.
    """
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9-]*", title)
    out: set[str] = set()
    for tok in tokens:
        low = tok.lower()
        if len(low) >= MIN_TOKEN_LEN and low not in GENERIC_TITLE_TOKENS:
            out.add(low)
    return out


def load_alias_terms(csv_path: str | Path) -> dict[str, str]:
    """search_aliases.csv -> {term: pe_bli} for terms targeting program pages."""
    out: dict[str, str] = {}
    path = Path(csv_path)
    if not path.exists():
        return out
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            term = (row.get("term") or "").strip()
            target = (row.get("target_url") or "").strip()
            m = re.fullmatch(r"/program/([^/]+)/", target)
            if term and m:
                out[term.lower()] = m.group(1)
    return out


def build_program_terms(
    programs: list[tuple[str, str, str, float]],
    alias_terms: dict[str, str] | None = None,
) -> dict[str, set[str]]:
    """{pe_bli: lowercase match terms} from titles + alias table."""
    terms: dict[str, set[str]] = {}
    pe_set = {p[0] for p in programs}
    for pe_bli, title, _org, _total in programs:
        terms.setdefault(pe_bli, set()).update(title_terms(title))
    for term, pe_bli in (alias_terms or {}).items():
        if pe_bli in pe_set:
            terms.setdefault(pe_bli, set()).add(term.lower())
    return terms


def _term_pattern(term: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", re.IGNORECASE)


def match_articles(
    items: list[dict], program_terms: dict[str, set[str]]
) -> list[dict]:
    """Match feed items against program terms (word-boundary, case-insensitive).

    Returns [{pe_bli, matched_term, **item}] — one row per (item, pe_bli),
    keeping the first matching term per program.
    """
    matches: list[dict] = []
    for item in items:
        haystack = f"{item.get('title', '')} {item.get('summary', '')}"
        for pe_bli, terms in program_terms.items():
            for term in sorted(terms):
                if _term_pattern(term).search(haystack):
                    matches.append({"pe_bli": pe_bli, "matched_term": term, **item})
                    break
    return matches


# ---------------------------------------------------------------------------
# Polite snapshot fetcher
# ---------------------------------------------------------------------------


def extract_text(html: str) -> tuple[str, str]:
    """(title, text) extracted with selectolax; scripts/styles stripped."""
    from selectolax.parser import HTMLParser

    tree = HTMLParser(html)
    title_node = tree.css_first("title")
    title = title_node.text(strip=True) if title_node else ""
    for sel in ("script", "style", "noscript", "nav", "header", "footer"):
        for node in tree.css(sel):
            node.decompose()
    body = tree.body
    text = body.text(separator=" ", strip=True) if body is not None else ""
    text = re.sub(r"\s+", " ", text).strip()
    return title, text


class SnapshotFetcher:
    """Article snapshotter with robots.txt + per-host rate limiting.

    Politeness rules (recon §I):
      - honest UA (USER_AGENT) on every request,
      - robots.txt checked per host before any fetch (deny -> skip; robots
        unreachable with a server error -> conservative skip; 4xx -> allow,
        the de-facto standard),
      - >= min_interval seconds between requests to the same host.

    `sleep` and `clock` are injectable for tests.
    """

    def __init__(
        self,
        client: httpx.Client,
        snapshots_dir: str | Path,
        *,
        min_interval: float = 1.0,
        sleep=time.sleep,
        clock=time.monotonic,
    ) -> None:
        self.client = client
        self.snapshots_dir = Path(snapshots_dir)
        self.min_interval = min_interval
        self._sleep = sleep
        self._clock = clock
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._last_request: dict[str, float] = {}

    # -- politeness -----------------------------------------------------

    def _host(self, url: str) -> str:
        return urlsplit(url).netloc.lower()

    def _throttle(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            elapsed = self._clock() - last
            if elapsed < self.min_interval:
                self._sleep(self.min_interval - elapsed)
        self._last_request[host] = self._clock()

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser | None:
        """RobotFileParser for the url's host; None means 'skip this host'."""
        host = self._host(url)
        if host in self._robots:
            return self._robots[host]
        parts = urlsplit(url)
        robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
        rp = urllib.robotparser.RobotFileParser()
        try:
            self._throttle(host)
            resp = self.client.get(
                robots_url, headers={"User-Agent": USER_AGENT},
                follow_redirects=True,
            )
            if 400 <= resp.status_code < 500:
                rp.parse([])  # no robots.txt -> everything allowed
            elif resp.status_code >= 500:
                self._robots[host] = None  # server error -> conservative skip
                return None
            else:
                rp.parse(resp.text.splitlines())
        except httpx.HTTPError:
            self._robots[host] = None
            return None
        self._robots[host] = rp
        return rp

    def allowed(self, url: str) -> bool:
        rp = self._robots_for(url)
        if rp is None:
            return False
        return rp.can_fetch(USER_AGENT, url)

    # -- fetching -------------------------------------------------------

    def fetch_url(self, url: str) -> httpx.Response | None:
        """Polite GET: robots check + throttle. None when denied/failed."""
        if not self.allowed(url):
            return None
        host = self._host(url)
        self._throttle(host)
        try:
            resp = self.client.get(
                url, headers={"User-Agent": USER_AGENT}, follow_redirects=True
            )
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None
        return resp

    def fetch_snapshot(self, url: str, *, pe_bli: str = "", matched_term: str = "") -> dict | None:
        """Fetch one article -> snapshot dict; writes {sha}.json + index entry.

        Snapshot shape: {url, retrieved_at, sha256, title, text} (recon §I).
        sha256 is the hash of the raw response body. Returns None when the
        fetch was denied by robots, failed, or yielded no text.
        """
        resp = self.fetch_url(url)
        if resp is None:
            return None
        raw = resp.content
        sha256 = hashlib.sha256(raw).hexdigest()
        title, text = extract_text(resp.text)
        if not text:
            return None
        snapshot = {
            "url": url,
            "retrieved_at": dt.datetime.now(dt.UTC).isoformat(),
            "sha256": sha256,
            "title": title,
            "text": text,
        }
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        path = self.snapshots_dir / f"{sha256}.json"
        path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1),
                        encoding="utf-8")
        self._update_index(snapshot, pe_bli=pe_bli, matched_term=matched_term)
        return snapshot

    def _update_index(self, snapshot: dict, *, pe_bli: str, matched_term: str) -> None:
        index_path = self.snapshots_dir / "index.json"
        if index_path.exists():
            index = json.loads(index_path.read_text(encoding="utf-8"))
        else:
            index = {"snapshots": []}
        entry = {
            "sha256": snapshot["sha256"],
            "url": snapshot["url"],
            "retrieved_at": snapshot["retrieved_at"],
            "title": snapshot["title"],
            "pe_bli": pe_bli,
            "matched_term": matched_term,
        }
        existing = {(e["sha256"], e.get("pe_bli", "")) for e in index["snapshots"]}
        if (entry["sha256"], pe_bli) not in existing:
            index["snapshots"].append(entry)
            index_path.write_text(
                json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
            )


# ---------------------------------------------------------------------------
# Orchestration (CLI `govbudget dossiers fetch`)
# ---------------------------------------------------------------------------


def fetch_research(
    duckdb_path: str | Path,
    *,
    snapshots_dir: str | Path,
    aliases_csv: str | Path,
    feeds: dict[str, str] | None = None,
    limit: int | None = None,
    client: httpx.Client | None = None,
) -> dict:
    """Pull all feeds, match against the top-50, snapshot matching articles.

    Returns a summary dict {feeds_fetched, items_seen, matches, snapshots}.
    `limit` caps the number of article snapshots (smoke runs).
    """
    feeds = feeds if feeds is not None else RSS_FEEDS
    programs = top50(duckdb_path)
    alias_terms = load_alias_terms(aliases_csv)
    program_terms = build_program_terms(programs, alias_terms)

    own_client = client is None
    if client is None:
        client = httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT})
    fetcher = SnapshotFetcher(client, snapshots_dir)

    summary = {"feeds_fetched": 0, "items_seen": 0, "matches": 0, "snapshots": 0}
    try:
        all_matches: list[dict] = []
        for name, feed_url in feeds.items():
            resp = fetcher.fetch_url(feed_url)
            if resp is None:
                print(f"dossiers fetch: feed {name}: SKIPPED (robots/HTTP)")
                continue
            summary["feeds_fetched"] += 1
            try:
                items = parse_feed(resp.text)
            except ET.ParseError as e:
                print(f"dossiers fetch: feed {name}: parse error ({e})")
                continue
            summary["items_seen"] += len(items)
            matched = match_articles(items, program_terms)
            all_matches.extend(matched)
            print(f"dossiers fetch: feed {name}: {len(items)} items, {len(matched)} matches")

        summary["matches"] = len(all_matches)
        seen_urls: set[str] = set()
        for m in all_matches:
            if limit is not None and summary["snapshots"] >= limit:
                break
            if m["url"] in seen_urls:
                continue
            seen_urls.add(m["url"])
            snap = fetcher.fetch_snapshot(
                m["url"], pe_bli=m["pe_bli"], matched_term=m["matched_term"]
            )
            if snap is not None:
                summary["snapshots"] += 1
                print(f"dossiers fetch: snapshot {snap['sha256'][:12]} "
                      f"{m['pe_bli']} ({m['matched_term']}) {m['url']}")
    finally:
        if own_client:
            client.close()
    return summary
