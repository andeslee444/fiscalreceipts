"""Senate LDA (Lobbying Disclosure Act) ingestion for the top defense families.

Income vs. expenses semantics
------------------------------
LDA filings distinguish two dollar fields:
- income: what the *registrant firm* was paid by the client (outside lobbying firm model).
- expenses: what the *registrant* spent on behalf of the client
  (in-house/self-filer model where the registrant IS the client).
Exactly one of {income, expenses} is non-null per filing; the other is null.
To compute a family's total lobbying outlay for a given year, sum both fields
(never double-count: they are mutually exclusive within a filing).

Politeness: ≤ 14 requests/min (one client, 5 s floor between calls), exponential
backoff on 429 (first wait 65 s, doubling up to 600 s).

Output parquets (all-varchar convention; written by pull_top_families):
  lda_filings.parquet     — one row per filing
  lda_activities.parquet  — one row per lobbying activity within a filing
  lda_lobbyists.parquet   — one row per lobbyist per activity (filing-level deduped)

Match tiers (in order):
  1. exact_family   — normalize_name(client_name) == family_key
  2. curated_alias  — client_name normalized matches a row in client_aliases.csv for this family
  3. normalized     — family_key is substring of normalize_name(client_name)
  4. family_raw_name — normalize_name(client_name) equals normalize of any parent_name or
                       recipient_name in entity_xwalk for this family (UEI-grounded)
  5. suffix_residue — after stripping GENERIC_RESIDUE tokens from both normalized client
                      name and family_key, residual cores are identical (≥2 tokens or
                      single token ≥4 chars, non-empty on both sides)
  none              — no match; row kept with match_method='none'

Query expansion per family (deduped case-insensitively):
  1. display_name
  2. family_key (if it differs case-insensitively from display_name)
  3. Up to 2 most-common parent_name values from entity_xwalk (by total_obligation sum),
     normalized before use as query strings, excluding strings already in the list
  4. curated alias lda_client_name values for this family
"""
from __future__ import annotations

import csv
import json
import time
from pathlib import Path
from typing import Sequence

import duckdb
import httpx

from govbudget.entities import normalize_name

LDA_BASE = "https://lda.senate.gov/api/v1"
_FILINGS_URL = f"{LDA_BASE}/filings/"

# Polite floor: 5 s between requests = 12/min, well under 14/min cap.
_REQUEST_FLOOR_S = 5.0
_BACKOFF_INITIAL_S = 65.0
_BACKOFF_MAX_S = 600.0

# Tokens stripped from both sides when checking suffix_residue match.
# These are generic corporate-structure tokens only — NOT company-name words.
GENERIC_RESIDUE = {
    "HOLDING", "HOLDINGS", "GROUP", "PLC", "SPA", "COMPANY", "CORPORATION",
    "INCORPORATED", "INTERNATIONAL", "AMERICA", "USA",
}

# Path to the curated alias seed CSV (relative to this file's repo root).
_ALIASES_CSV = Path(__file__).resolve().parents[3] / "dbt" / "seeds" / "client_aliases.csv"

# Match-tier ranking for cross-family attribution (lower = stronger claim).
# When two families' queries return the same filing UUID (the LDA client_name
# filter is contains-style, so this happens for name-sharing families like
# VECTRUS / VERTEX AEROSPACE SERVICES post-V2X-merger), the family with the
# STRONGEST match tier wins the attribution; ties go to the family processed
# first (higher total_obligation — dim_entities ordering), which is
# deterministic and preserves the pre-fix behavior for equal-tier claims.
_TIER_RANK = {
    "exact_family": 0,
    "curated_alias": 1,
    "normalized": 2,
    "family_raw_name": 3,
    "suffix_residue": 4,
    "none": 5,
}


def _get_with_backoff(client: httpx.Client, url: str, params: dict | None = None) -> dict:
    """GET a URL with exponential backoff on 429, polite rate-limiting floor."""
    wait = _BACKOFF_INITIAL_S
    while True:
        r = client.get(url, params=params)
        if r.status_code == 429:
            print(f"  LDA 429 — waiting {wait:.0f}s before retry")
            time.sleep(wait)
            wait = min(wait * 2, _BACKOFF_MAX_S)
            continue
        r.raise_for_status()
        return r.json()


def fetch_client_filings(
    client: httpx.Client,
    client_name: str,
    *,
    years: Sequence[int],
) -> list[dict]:
    """Fetch all LDA filings for a given client_name across requested years.

    Paginates automatically.  Raw filing dicts are trimmed to only the fields
    used downstream (uuid, url, type, year, period, income, expenses, client
    name/desc, registrant name, lobbying_activities, lobbyists).

    Returns list of raw (trimmed) filing dicts; duplicates removed by uuid.
    """
    seen_uuids: set[str] = set()
    results: list[dict] = []

    for year in years:
        page_url: str | None = _FILINGS_URL
        params: dict | None = {
            "client_name": client_name,
            "filing_year": year,
            "page_size": 25,
        }
        while page_url:
            time.sleep(_REQUEST_FLOOR_S)
            data = _get_with_backoff(client, page_url, params=params)
            params = None  # subsequent pages use the full URL from data["next"]
            for raw in data.get("results", []):
                uuid = raw.get("filing_uuid") or raw.get("url", "")
                if uuid in seen_uuids:
                    continue
                seen_uuids.add(uuid)
                results.append(_trim_filing(raw))
            page_url = data.get("next")

    return results


def _trim_filing(raw: dict) -> dict:
    """Keep only the fields we need; strip large unused sub-objects."""
    registrant = raw.get("registrant") or {}
    client_obj = raw.get("client") or {}
    activities = []
    for act in raw.get("lobbying_activities") or []:
        lobbyists = []
        for lb in act.get("lobbyists") or []:
            lob_obj = lb.get("lobbyist") or {}
            first = lob_obj.get("first_name") or ""
            last = lob_obj.get("last_name") or ""
            name = f"{first} {last}".strip()
            lobbyists.append({
                "name": name,
                "covered_position": lb.get("covered_position"),
            })
        gov_entities = [g.get("name", "") for g in (act.get("government_entities") or [])]
        activities.append({
            "issue_code": act.get("general_issue_code"),
            "issue_display": act.get("general_issue_code_display"),
            "description": act.get("description", ""),
            "government_entities": gov_entities,
            "lobbyists": lobbyists,
        })
    return {
        "filing_uuid": raw.get("filing_uuid", ""),
        "url": raw.get("url", ""),
        "filing_type": raw.get("filing_type", ""),
        "filing_year": raw.get("filing_year"),
        "filing_period": raw.get("filing_period", ""),
        "income": raw.get("income"),
        "expenses": raw.get("expenses"),
        "client_name": client_obj.get("name", ""),
        "client_description": client_obj.get("general_description", ""),
        "registrant_name": registrant.get("name", ""),
        "lobbying_activities": activities,
    }


def _normalize_dollar(val) -> str:
    """Convert income/expenses (str decimal or None) to varchar USD (integer cents→dollars)."""
    if val is None:
        return ""
    try:
        return str(round(float(val)))
    except (ValueError, TypeError):
        return ""


def _load_aliases(aliases_csv: Path | None = None) -> dict[str, set[str]]:
    """Load client_aliases.csv → {family_key: {norm_alias, ...}}.

    Normalizes both sides at load time so match is O(1) at call time.
    Silently returns empty dict if the file does not exist.
    """
    path = aliases_csv if aliases_csv is not None else _ALIASES_CSV
    result: dict[str, set[str]] = {}
    if not path.exists():
        return result
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            raw_client = (row.get("lda_client_name") or "").strip()
            fk = (row.get("family_key") or "").strip()
            if not raw_client or not fk:
                continue
            norm = normalize_name(raw_client)
            if norm:
                result.setdefault(fk, set()).add(norm)
    return result


def _suffix_residue_match(norm_client: str, family_key: str) -> bool:
    """Return True iff norm_client and family_key match after stripping GENERIC_RESIDUE tokens.

    Guards:
    - Residual core must be ≥2 tokens OR a single token of ≥4 characters.
    - Core must be non-empty on both sides.
    These guards prevent single-generic-token over-merge (e.g. 'UNITED' cannot match
    'UNITED LAUNCH ALLIANCE').
    """
    def strip_residue(tokens: list[str]) -> list[str]:
        return [t for t in tokens if t not in GENERIC_RESIDUE]

    client_tokens = norm_client.split()
    key_tokens = family_key.split()

    client_core = strip_residue(client_tokens)
    key_core = strip_residue(key_tokens)

    if not client_core or not key_core:
        return False

    def _valid_core(core: list[str]) -> bool:
        return len(core) >= 2 or (len(core) == 1 and len(core[0]) >= 4)

    if not _valid_core(client_core) or not _valid_core(key_core):
        return False

    return client_core == key_core


def _normalized_tier_match(norm_client: str, family_key: str) -> bool:
    """Return True iff family_key matches tier 3 ('normalized') against norm_client.

    Requirements (both must hold):
    1. Token-boundary containment: the token sequence of family_key appears as a
       *contiguous* subsequence of norm_client's token list.  Bare substring in
       the character sense is NOT sufficient — "BP" must not match token "BPU".
    2. Guard: family_key has ≥2 tokens OR its single token is ≥4 characters.
       This mirrors the suffix_residue guard and prevents single short-token keys
       like "BP" (2 chars, 1 token) from producing false positives.

    Examples:
      "LOCKHEED MARTIN SPACE SYSTEMS" / "LOCKHEED MARTIN" → True  (contiguous 2-token prefix)
      "GENERAL DYNAMICS LAND SYSTEMS" / "GENERAL DYNAMICS" → True  (contiguous prefix)
      "JAMESTOWN BPU"                 / "BP"               → False (guard: 1 token, 2 chars)
      "MARTIN MARIETTA"               / "LOCKHEED MARTIN"  → False (tokens not contiguous)
      "RAYTHEON INTELLIGENCE SPACE"   / "RAYTHEON"         → True  (1 token ≥ 4 chars, contiguous)
    """
    key_tokens = family_key.split()
    if not key_tokens:
        return False

    # Guard: ≥2 tokens OR single token ≥4 chars
    if len(key_tokens) == 1 and len(key_tokens[0]) < 4:
        return False

    client_tokens = norm_client.split()
    n_key = len(key_tokens)
    n_client = len(client_tokens)

    # Sliding window: check every contiguous window of length n_key in client_tokens
    for i in range(n_client - n_key + 1):
        if client_tokens[i:i + n_key] == key_tokens:
            return True
    return False


def _match_method(
    client_name: str,
    family_key: str,
    *,
    family_raw_names: set[str] | None = None,
    alias_norms: set[str] | None = None,
) -> str:
    """Return match_method tier string.

    Tiers (first match wins):
      'exact_family'   — normalize_name(client_name) == family_key
      'curated_alias'  — normalize_name(client_name) in alias_norms
      'normalized'     — family_key token sequence is a contiguous subsequence of
                         normalize_name(client_name) tokens AND family_key has ≥2
                         tokens or its single token is ≥4 chars (prevents short
                         single-token keys like "BP" from matching e.g. "JAMESTOWN BPU")
      'family_raw_name'— normalize_name(client_name) in family_raw_names
      'suffix_residue' — residual cores match after GENERIC_RESIDUE removal
      'none'           — no match
    """
    if not client_name or not family_key:
        return "none"
    norm = normalize_name(client_name)
    if norm == family_key:
        return "exact_family"
    if alias_norms and norm in alias_norms:
        return "curated_alias"
    if _normalized_tier_match(norm, family_key):
        return "normalized"
    if family_raw_names and norm in family_raw_names:
        return "family_raw_name"
    if _suffix_residue_match(norm, family_key):
        return "suffix_residue"
    return "none"


def _load_family_raw_names(duckdb_path: str | Path, family_keys: list[str]) -> dict[str, set[str]]:
    """Query entity_xwalk for all parent_name and recipient_name values per family.

    Returns {family_key: {normalize_name(n) for n in names}} using a read-only
    DuckDB connection.  Skips null/empty names.
    """
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        placeholders = ", ".join(f"'{fk.replace(chr(39), chr(39)*2)}'" for fk in family_keys)
        rows = con.execute(
            f"SELECT family_key, parent_name, recipient_name FROM entity_xwalk "
            f"WHERE family_key IN ({placeholders})"
        ).fetchall()
    finally:
        con.close()

    result: dict[str, set[str]] = {}
    for fk, parent, recipient in rows:
        norms = result.setdefault(fk, set())
        for raw in (parent, recipient):
            if raw:
                n = normalize_name(raw)
                if n:
                    norms.add(n)
    return result


def _build_query_strings(
    family_key: str,
    display_name: str,
    raw_names_set: set[str],
    alias_client_norms: set[str],
    *,
    max_raw: int = 2,
) -> list[str]:
    """Build ordered, deduped query strings for a family.

    Order:
    1. display_name (as-is)
    2. family_key (if differs from display_name case-insensitively)
    3. Up to max_raw most-common raw parent_name values (normalized, excluding duplicates)
    4. Curated alias lda_client_name values (already normalized; skip dupes)

    Deduplication is case-insensitive (compare uppercased).
    """
    seen_upper: set[str] = set()
    queries: list[str] = []

    def _add(q: str) -> None:
        u = q.strip().upper()
        if u and u not in seen_upper:
            seen_upper.add(u)
            queries.append(q.strip())

    _add(display_name)
    if family_key.upper() != display_name.strip().upper():
        _add(family_key)

    # raw_names_set contains normalized strings — add them directly (normalized
    # strings used as query terms); take up to max_raw (already sorted by caller)
    added = 0
    for norm in raw_names_set:
        if added >= max_raw:
            break
        _add(norm)
        added += 1

    # alias client names (normalized)
    for norm in alias_client_norms:
        _add(norm)

    return queries


def _load_top_raw_names(duckdb_path: str | Path, family_keys: list[str]) -> dict[str, list[str]]:
    """Return {family_key: [top_2_parent_name_norms_by_obligation]}.

    Uses entity_xwalk; groups by parent_name, sums obligation, picks top 2.
    Normalized before returning so they can be used directly as query strings.
    """
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        placeholders = ", ".join(f"'{fk.replace(chr(39), chr(39)*2)}'" for fk in family_keys)
        rows = con.execute(
            f"SELECT family_key, parent_name, SUM(total_obligation) as total "
            f"FROM entity_xwalk "
            f"WHERE family_key IN ({placeholders}) AND parent_name IS NOT NULL "
            f"GROUP BY family_key, parent_name "
            f"ORDER BY family_key, total DESC NULLS LAST"
        ).fetchall()
    finally:
        con.close()

    result: dict[str, list[str]] = {}
    for fk, parent_name, _ in rows:
        if fk not in result:
            result[fk] = []
        if len(result[fk]) < 2:
            n = normalize_name(parent_name)
            if n and n not in result[fk]:
                result[fk].append(n)
    return result


def _pull_families_with_client(
    client: httpx.Client,
    families: list[tuple],
    years: Sequence[int],
    *,
    duckdb_path: str | Path | None = None,
    aliases_csv: Path | None = None,
) -> tuple[list, list, list]:
    """Inner loop: iterate families, fetch filings, collect rows.

    Returns (all_filings, all_activities, all_lobbyists) as lists of tuples.

    When duckdb_path is provided, loads entity_xwalk raw names for query expansion
    and family_raw_name matching.  When aliases_csv is provided (or the default
    path exists), loads curated aliases.

    Attribution (fix round A3, backlog #19): a filing UUID returned by queries
    for multiple families is attributed ONCE, to the family with the strongest
    match tier (_TIER_RANK; exact_family strongest, none weakest).  Ties go to
    the first-processed family (highest obligation).  This replaces the old
    first-query-wins global dedup, under which VECTRUS's contains-style 'V2X'
    query consumed the 'V2X, Inc. (formerly known as Vertex Aerospace)' filings
    at match 'none', starving VERTEX AEROSPACE SERVICES' curated alias
    (ROADMAP finding 2026-07-02).  Claims are collected during the fetch pass
    and resolved in a single emit pass afterwards, so the result is independent
    of which family's query happened to fetch a filing first.
    """
    # uuid → trimmed filing payload, in first-fetch order (deterministic output order)
    filings_by_uuid: dict[str, dict] = {}
    # uuid → (tier_rank, family_key, match_method) — the strongest claim so far
    best_claim: dict[str, tuple[int, str, str]] = {}

    family_keys = [fk for fk, _ in families if fk]

    # Load raw names from entity_xwalk for both query expansion and family_raw_name matching
    top_raw_names: dict[str, list[str]] = {}
    family_raw_names_map: dict[str, set[str]] = {}
    if duckdb_path is not None:
        try:
            top_raw_names = _load_top_raw_names(duckdb_path, family_keys)
            family_raw_names_map = _load_family_raw_names(duckdb_path, family_keys)
        except Exception as exc:
            print(f"  WARNING: could not load entity_xwalk raw names: {exc}")

    # Load curated aliases
    alias_map = _load_aliases(aliases_csv)  # {family_key: {norm, ...}}

    # Build reverse alias map: norm_alias -> family_key (for query expansion)
    alias_raw_norms_map: dict[str, set[str]] = alias_map  # already {fk: set[norm]}

    for family_key_val, display_name in families:
        if not display_name:
            continue
        print(f"  LDA pull: {family_key_val} ({display_name!r})")

        raw_norms = top_raw_names.get(family_key_val, [])
        alias_norms = alias_raw_norms_map.get(family_key_val, set())
        query_strings = _build_query_strings(
            family_key_val, display_name, raw_norms, alias_norms
        )

        fam_raw_names = family_raw_names_map.get(family_key_val)
        fam_alias_norms = alias_map.get(family_key_val)

        # family-level UUID dedup across all query strings
        family_seen_uuids: set[str] = set()

        for query_str in query_strings:
            try:
                filings = fetch_client_filings(client, query_str, years=list(years))
            except Exception as exc:
                print(f"    WARNING: {query_str!r} -> {type(exc).__name__}: {exc}")
                continue

            for f in filings:
                uuid = f["filing_uuid"]
                # Dedupe within family across query strings (match_method is
                # family-level, so re-computing for the same family is a no-op)
                if uuid in family_seen_uuids:
                    continue
                family_seen_uuids.add(uuid)

                # Keep the first-fetched payload; the filing content is
                # identical regardless of which query string returned it.
                if uuid not in filings_by_uuid:
                    filings_by_uuid[uuid] = f

                # Register this family's claim; strongest tier wins, ties keep
                # the earlier (higher-obligation) family — strict < comparison.
                match_method = _match_method(
                    f["client_name"],
                    family_key_val,
                    family_raw_names=fam_raw_names,
                    alias_norms=fam_alias_norms,
                )
                rank = _TIER_RANK.get(match_method, len(_TIER_RANK))
                prev = best_claim.get(uuid)
                if prev is None or rank < prev[0]:
                    best_claim[uuid] = (rank, family_key_val, match_method)

    # Emit pass: one row per UUID, attributed to the winning claim.
    all_filings: list[tuple] = []
    all_activities: list[tuple] = []
    all_lobbyists: list[tuple] = []
    for uuid, f in filings_by_uuid.items():
        _rank, family_key_val, match_method = best_claim[uuid]
        income_usd = _normalize_dollar(f.get("income"))
        expenses_usd = _normalize_dollar(f.get("expenses"))

        all_filings.append((
            uuid,
            f["url"],
            f["client_name"],
            f["registrant_name"],
            str(f["filing_year"] or ""),
            f["filing_period"],
            f["filing_type"],
            income_usd,
            expenses_usd,
            family_key_val,
            match_method,
        ))

        for act in f.get("lobbying_activities") or []:
            all_activities.append((
                uuid,
                act.get("issue_code") or "",
                act.get("issue_display") or "",
                act.get("description") or "",
                json.dumps(act.get("government_entities") or []),
            ))

        # Dedup lobbyists within the filing (same name can appear in multiple activities)
        seen_lobbyists: set[str] = set()
        for act in f.get("lobbying_activities") or []:
            for lb in act.get("lobbyists") or []:
                name = lb.get("name") or ""
                cov = lb.get("covered_position") or ""
                key = f"{name}|||{cov}"
                if key not in seen_lobbyists:
                    seen_lobbyists.add(key)
                    all_lobbyists.append((uuid, name, cov))

    return all_filings, all_activities, all_lobbyists


def restamp_filings(filings_parquet: Path, duckdb_path: str | Path) -> dict:
    """Re-stamp match_method on every row using the current tier logic.

    Reads filings_parquet, recomputes match_method for every (client_name,
    family_key_guess) row using the same tier function + alias/raw-name sets
    loaded from duckdb_path (entity_xwalk) and the default client_aliases.csv.
    Rewrites the parquet atomically (temp file then rename).

    Returns a dict:
        before: {match_method: count}
        after:  {match_method: count}

    The caller must run this after updating _match_method logic.  It does NOT
    re-pull from LDA — it operates entirely on the existing parquet rows.
    """
    filings_parquet = Path(filings_parquet)
    duckdb_path = Path(duckdb_path)

    # Load the parquet into an in-memory list
    rcon = duckdb.connect()
    try:
        rows = rcon.execute(
            f"select filing_uuid, url, client_name, registrant_name, filing_year, "
            f"filing_period, filing_type, income_usd, expenses_usd, "
            f"family_key_guess, match_method "
            f"from read_parquet('{filings_parquet}')"
        ).fetchall()
    finally:
        rcon.close()

    # Collect before-counts
    before: dict[str, int] = {}
    for row in rows:
        mm = row[10] or "none"
        before[mm] = before.get(mm, 0) + 1

    # Load aliases and raw names keyed by family_key
    alias_map = _load_aliases()  # {family_key: {norm, ...}}
    family_keys = list({row[9] for row in rows if row[9]})
    family_raw_names_map: dict[str, set[str]] = {}
    if duckdb_path.exists():
        try:
            family_raw_names_map = _load_family_raw_names(duckdb_path, family_keys)
        except Exception as exc:
            print(f"  WARNING: restamp_filings: could not load entity_xwalk: {exc}")

    # Re-stamp each row
    new_rows: list[tuple] = []
    after: dict[str, int] = {}
    for row in rows:
        (uuid, url, client_name, registrant_name, filing_year, filing_period,
         filing_type, income_usd, expenses_usd, family_key_guess, _old_mm) = row
        new_mm = _match_method(
            client_name or "",
            family_key_guess or "",
            family_raw_names=family_raw_names_map.get(family_key_guess or ""),
            alias_norms=alias_map.get(family_key_guess or ""),
        )
        after[new_mm] = after.get(new_mm, 0) + 1
        new_rows.append((
            uuid, url, client_name, registrant_name, filing_year, filing_period,
            filing_type, income_usd, expenses_usd, family_key_guess, new_mm,
        ))

    # Write atomically: temp file → rename
    tmp_path = filings_parquet.with_suffix(".parquet.tmp")
    wcon = duckdb.connect()
    try:
        wcon.execute(
            "create table _f (filing_uuid varchar, url varchar, client_name varchar,"
            " registrant_name varchar, filing_year varchar, filing_period varchar,"
            " filing_type varchar, income_usd varchar, expenses_usd varchar,"
            " family_key_guess varchar, match_method varchar)"
        )
        wcon.executemany("insert into _f values (?,?,?,?,?,?,?,?,?,?,?)", new_rows)
        wcon.execute(f"copy _f to '{tmp_path}' (format parquet, compression zstd)")
    finally:
        wcon.close()
    tmp_path.replace(filings_parquet)

    return {"before": before, "after": after}


def pull_top_families(
    duckdb_path: str | Path,
    *,
    out_dir: Path,
    top_n: int = 100,
    years: Sequence[int] = (2024, 2025, 2026),
    _client: httpx.Client | None = None,
    _aliases_csv: Path | None = None,
) -> tuple[Path, Path, Path]:
    """Pull LDA filings for the top-N families by obligation.

    Reads dim_entities from govbudget.duckdb (read-only) to get family keys
    and display names.  For each family builds a set of query strings (display
    name + family key if different + top-2 raw parent names + curated aliases).
    Deduplicates filings by uuid across all queries.  Writes three parquets:

      lda_filings.parquet     — one row per unique filing
      lda_activities.parquet  — one row per activity
      lda_lobbyists.parquet   — one row per lobbyist (deduped per filing)

    Single-attribution note: families are processed in descending obligation order
    (matching the dim_entities query).  When a filing UUID is returned by queries
    for two different families (the LDA client_name filter is contains-style),
    it is attributed to exactly ONE family — the one with the strongest match
    tier (_TIER_RANK: exact_family > curated_alias > normalized >
    family_raw_name > suffix_residue > none); ties go to the higher-obligation
    family.  Single attribution prevents double-counting of lobbying spend
    across families; best-tier resolution ensures a curated alias can never be
    starved by an earlier family's unmatched contains-hit (fix round A3,
    backlog #19 — VECTRUS/VERTEX finding 2026-07-02).

    _client: optional injected httpx.Client (for testing; must already be open).
    _aliases_csv: optional path override for client_aliases.csv (for testing).
    Returns (filings_path, activities_path, lobbyists_path).
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Read top-N families from dim_entities
    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        families = con.execute(
            "select family_key, display_name from dim_entities "
            "order by total_obligation desc nulls last "
            f"limit {top_n}"
        ).fetchall()
    finally:
        con.close()

    if _client is not None:
        all_filings, all_activities, all_lobbyists = _pull_families_with_client(
            _client, families, years,
            duckdb_path=duckdb_path,
            aliases_csv=_aliases_csv,
        )
    else:
        with httpx.Client(
            headers={"User-Agent": "GovBudget-Research/1.0 (academic; contact: research@govbudget.dev)"},
            timeout=60,
        ) as real_client:
            all_filings, all_activities, all_lobbyists = _pull_families_with_client(
                real_client, families, years,
                duckdb_path=duckdb_path,
                aliases_csv=_aliases_csv,
            )

    # Write lda_filings.parquet
    filings_path = out_dir / "lda_filings.parquet"
    wcon = duckdb.connect()
    try:
        wcon.execute(
            "create table _f (filing_uuid varchar, url varchar, client_name varchar,"
            " registrant_name varchar, filing_year varchar, filing_period varchar,"
            " filing_type varchar, income_usd varchar, expenses_usd varchar,"
            " family_key_guess varchar, match_method varchar)"
        )
        wcon.executemany("insert into _f values (?,?,?,?,?,?,?,?,?,?,?)", all_filings)
        wcon.execute(f"copy _f to '{filings_path}' (format parquet, compression zstd)")

        # Write lda_activities.parquet
        activities_path = out_dir / "lda_activities.parquet"
        wcon.execute(
            "create table _a (filing_uuid varchar, issue_code varchar,"
            " issue_display varchar, description varchar, agencies_json varchar)"
        )
        wcon.executemany("insert into _a values (?,?,?,?,?)", all_activities)
        wcon.execute(f"copy _a to '{activities_path}' (format parquet, compression zstd)")

        # Write lda_lobbyists.parquet
        lobbyists_path = out_dir / "lda_lobbyists.parquet"
        wcon.execute(
            "create table _l (filing_uuid varchar, name varchar, covered_position varchar)"
        )
        wcon.executemany("insert into _l values (?,?,?)", all_lobbyists)
        wcon.execute(f"copy _l to '{lobbyists_path}' (format parquet, compression zstd)")
    finally:
        wcon.close()

    print(
        f"LDA pull: {len(all_filings)} filings, {len(all_activities)} activities,"
        f" {len(all_lobbyists)} lobbyist rows"
    )
    return filings_path, activities_path, lobbyists_path
