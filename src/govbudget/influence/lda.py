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
"""
from __future__ import annotations

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


def _match_method(client_name: str, family_key: str) -> str:
    """Return match_method: 'exact_family' | 'normalized' | 'none'."""
    if not client_name or not family_key:
        return "none"
    if normalize_name(client_name) == family_key:
        return "exact_family"
    # partial: family_key appears as substring in normalized client name
    norm = normalize_name(client_name)
    if family_key and family_key in norm:
        return "normalized"
    return "none"


def _pull_families_with_client(
    client: httpx.Client,
    families: list[tuple],
    years: Sequence[int],
) -> tuple[list, list, list]:
    """Inner loop: iterate families, fetch filings, collect rows.

    Returns (all_filings, all_activities, all_lobbyists) as lists of tuples.
    """
    all_filings: list[tuple] = []
    all_activities: list[tuple] = []
    all_lobbyists: list[tuple] = []
    seen_uuids: set[str] = set()

    for family_key_val, display_name in families:
        if not display_name:
            continue
        print(f"  LDA pull: {family_key_val} ({display_name!r})")
        try:
            filings = fetch_client_filings(client, display_name, years=list(years))
        except Exception as exc:
            print(f"    WARNING: {display_name} -> {type(exc).__name__}: {exc}")
            continue

        for f in filings:
            uuid = f["filing_uuid"]
            if uuid in seen_uuids:
                continue
            seen_uuids.add(uuid)

            match_method = _match_method(f["client_name"], family_key_val)
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


def pull_top_families(
    duckdb_path: str | Path,
    *,
    out_dir: Path,
    top_n: int = 100,
    years: Sequence[int] = (2024, 2025, 2026),
    _client: httpx.Client | None = None,
) -> tuple[Path, Path, Path]:
    """Pull LDA filings for the top-N families by obligation.

    Reads dim_entities from govbudget.duckdb (read-only) to get family keys
    and display names. Queries LDA by the family's display_name. Deduplicates
    across queries by filing_uuid. Writes three parquets to out_dir:

      lda_filings.parquet     — one row per unique filing
      lda_activities.parquet  — one row per activity
      lda_lobbyists.parquet   — one row per lobbyist (deduped per filing)

    _client: optional injected httpx.Client (for testing; must already be open).
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
            _client, families, years
        )
    else:
        with httpx.Client(
            headers={"User-Agent": "GovBudget-Research/1.0 (academic; contact: research@govbudget.dev)"},
            timeout=60,
        ) as real_client:
            all_filings, all_activities, all_lobbyists = _pull_families_with_client(
                real_client, families, years
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
