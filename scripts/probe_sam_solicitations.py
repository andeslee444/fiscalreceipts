#!/usr/bin/env python3
"""
scripts/probe_sam_solicitations.py — timeboxed evidence spike, no acquisition lane.

Question: does SAM.gov (or the FBO-era archive via the Wayback Machine)
expose solicitation text in which DoD program-element (PE) codes like
"0604800F" appear, at a rate that would justify building an acquisition
lane in the crosswalk?

Read-only. No credentials, no account creation, no CAPTCHA bypass. Polite
pacing (>=1s between requests, a descriptive User-Agent). Every request and
its response summary is appended to data/research/sam_spike/probe_log.jsonl.

Step 1 below is the exact probe code from the task brief (#74), run
unmodified. Steps 2-4 extend it: the same query pattern applied across a
service-spread PE-code sample and prose BLI-title queries, a full-text scan
of retrieved solicitation descriptions for PE-code-shaped tokens (in case a
direct PE-code *query* returns zero for a tokenizer reason even though the
text contains the code), and a Wayback CDX probe of FBO-era archives with a
follow-up fetch of any archived page found.

See docs/superpowers/reviews/sam-solicitations-spike.md for the write-up.
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://sam.gov/api/prod/sgs/v1/search/"
WAYBACK_CDX = "http://web.archive.org/cdx/search/cdx"
UA = "fiscalreceipts-spike/1.0 (research probe; contact: andes.lee444@gmail.com)"
SLEEP_S = 1.2  # be polite; >=1s between requests

LOG_PATH = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "research"
    / "sam_spike"
    / "probe_log.jsonl"
)
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

# PE-code-shaped token: 7 digits + 1 service letter (e.g. 0604800F, 0604262N).
# Used to scan retrieved solicitation description text directly, since a bare
# PE-code *query* returning zero could be a tokenizer artifact rather than
# proof the code is absent from the underlying text.
PE_CODE_RE = re.compile(r"\b\d{7}[A-Z]\b")

SAMPLE_PE_CODES = ["0604800F", "0604262N", "0603286E", "0605018A", "0101126F"]
SAMPLE_BLI_TITLES = ["KC-46A", "Virginia class", "GMLRS"]


def _log(entry):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), **entry}
    with LOG_PATH.open("a") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def q(params):
    url = BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r), r.status


def run_sam_query(phase, params, extract_text=False):
    """Run one SAM.gov opp-search query, print + log a summary, return the
    parsed body (or None on error)."""
    try:
        body, status = q(params)
        results = body.get("_embedded", {}).get("results", [])
        total = body.get("page", {}).get("totalElements")
        titles = [x.get("title", "")[:60] for x in results[:3]]
        print(params.get("q"), "->", total, titles)

        entry = {
            "phase": phase,
            "query": params,
            "http_status": status,
            "total_elements": total,
            "sample_titles": [x.get("title", "")[:80] for x in results[:3]],
        }

        if extract_text and results:
            pe_hits = {}
            for rec in results:
                text_blob = " ".join(
                    d.get("content", "") for d in rec.get("descriptions", []) or []
                )
                text_blob += " " + (rec.get("title") or "")
                found = sorted(set(PE_CODE_RE.findall(text_blob)))
                if found:
                    pe_hits[rec.get("_id", rec.get("title", "?"))] = found
            entry["pe_code_hits_in_text"] = pe_hits
            entry["records_scanned_for_pe_codes"] = len(results)
            if pe_hits:
                print("    PE-code-shaped tokens found in text:", pe_hits)

        _log(entry)
        return body
    except urllib.error.HTTPError as e:
        print(params.get("q"), "HTTP ERR", e.code, e.reason)
        _log({"phase": phase, "query": params, "error": f"HTTPError {e.code} {e.reason}"})
    except Exception as e:
        print(params.get("q"), "ERR", e)
        _log({"phase": phase, "query": params, "error": str(e)})
    return None


def wayback_cdx(params, attempt=1, max_attempts=3):
    url = WAYBACK_CDX + "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", errors="replace")
            lines = [l for l in body.splitlines() if l.strip()]
            print("wayback cdx ->", r.status, f"{len(lines)} rows")
            _log(
                {
                    "phase": "wayback-cdx",
                    "query": params,
                    "http_status": r.status,
                    "row_count": len(lines),
                    "sample_rows": lines[:5],
                    "attempt": attempt,
                }
            )
            return lines
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print("wayback cdx HTTP ERR", e.code, e.reason, "attempt", attempt)
        _log(
            {
                "phase": "wayback-cdx",
                "query": params,
                "error": f"HTTPError {e.code} {e.reason}",
                "body_snippet": body,
                "attempt": attempt,
            }
        )
        if e.code in (503, 429) and attempt < max_attempts:
            backoff = 2 ** attempt
            print(f"    retrying in {backoff}s ...")
            time.sleep(backoff)
            return wayback_cdx(params, attempt=attempt + 1, max_attempts=max_attempts)
    except Exception as e:
        print("wayback cdx ERR", e, "attempt", attempt)
        _log({"phase": "wayback-cdx", "query": params, "error": str(e), "attempt": attempt})
        if attempt < max_attempts:
            backoff = 2 ** attempt
            print(f"    retrying in {backoff}s ...")
            time.sleep(backoff)
            return wayback_cdx(params, attempt=attempt + 1, max_attempts=max_attempts)
    return None


def fetch_wayback_snapshot(timestamp, original):
    """Fetch one archived page and scan it for PE-code-shaped tokens."""
    url = f"http://web.archive.org/web/{timestamp}id_/{original}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", errors="replace")
            found = sorted(set(PE_CODE_RE.findall(body)))
            print(f"wayback snapshot {url} -> {r.status}, {len(body)} bytes, PE-shaped hits: {found}")
            _log(
                {
                    "phase": "wayback-snapshot",
                    "url": url,
                    "http_status": r.status,
                    "byte_len": len(body),
                    "pe_code_hits_in_text": found,
                }
            )
            return found
    except Exception as e:
        print(f"wayback snapshot {url} ERR", e)
        _log({"phase": "wayback-snapshot", "url": url, "error": str(e)})
        return None


def main():
    print(f"Logging every request/response to {LOG_PATH}")
    print()

    # --- Step 1: verbatim probe from the task brief -------------------------
    print("=== Step 1: brief's verbatim probe ===")
    tests = [
        {"index": "opp", "q": "0604800F", "is_active": "false", "page": 0, "size": 5},
        {"index": "opp", "q": '"0604800F"', "is_active": "false", "page": 0, "size": 5},
        {"index": "opp", "q": "F-35 EMD", "is_active": "false", "page": 0, "size": 5},
        {"index": "opp", "q": "program element 0604800F", "is_active": "all", "page": 0, "size": 5},
    ]
    for t in tests:
        run_sam_query("brief-verbatim", t, extract_text=True)
        time.sleep(SLEEP_S)

    # --- Step 2: extended PE-code sample, spread across services ------------
    # 0604800F already covered above; the remaining four codes get the same
    # bare / quoted / "program element X" pattern the brief used.
    print()
    print("=== Step 2: extended PE-code sample (bare / quoted / phrase) ===")
    for code in SAMPLE_PE_CODES[1:]:
        for params in (
            {"index": "opp", "q": code, "is_active": "false", "page": 0, "size": 5},
            {"index": "opp", "q": f'"{code}"', "is_active": "false", "page": 0, "size": 5},
            {"index": "opp", "q": f"program element {code}", "is_active": "all", "page": 0, "size": 5},
        ):
            run_sam_query("extended-pe-code", params, extract_text=True)
            time.sleep(SLEEP_S)

    # --- Step 3: procurement BLI titles as prose, scan hits for PE codes ----
    # is_active=all (per the brief's phrase-query pattern) 400s reliably — see
    # step 1/2 log entries. Use is_active=true here instead so the second pass
    # is a genuine additional sample (active-only) rather than repeating the
    # same 400.
    print()
    print("=== Step 3: BLI-title prose queries, full-text PE-code scan ===")
    for title in SAMPLE_BLI_TITLES:
        for is_active in ("false", "true"):
            params = {"index": "opp", "q": title, "is_active": is_active, "page": 0, "size": 10}
            run_sam_query("bli-prose", params, extract_text=True)
            time.sleep(SLEEP_S)

    # --- Step 3b: the folk-method phrase itself, at higher volume -----------
    # "program element" as free text (not code-anchored) — the query engine's
    # quoting does not appear to enforce exact-phrase matching (see write-up),
    # so this is effectively "program" OR "element" at BM25-style relevance.
    # Still useful: scan a bigger sample of whatever it returns for PE-code-
    # shaped tokens actually present in the description text.
    print()
    print("=== Step 3b: 'program element' phrase, larger sample, PE-code scan ===")
    run_sam_query(
        "phrase-program-element",
        {"index": "opp", "q": '"program element"', "is_active": "false", "page": 0, "size": 25},
        extract_text=True,
    )
    time.sleep(SLEEP_S)

    # --- Step 4: FBO-era archives via Wayback CDX ----------------------------
    print()
    print("=== Step 4: Wayback CDX probe of fbo.gov (brief's literal query) ===")
    rows = wayback_cdx(
        {"url": "fbo.gov/index*", "filter": "statuscode:200", "limit": 20}
    )
    time.sleep(SLEEP_S)

    if rows:
        # CDX rows are space-separated: urlkey timestamp original mimetype
        # statuscode digest length. Fetch up to 2 snapshots and scan for
        # PE-code-shaped tokens in the archived FBO page text. This URL
        # pattern (fbo.gov/index*) surfaces the FBO homepage/portal, not
        # individual notice pages — see step 4b for those.
        for row in rows[:2]:
            parts = row.split()
            if len(parts) >= 3:
                timestamp, original = parts[1], parts[2]
                fetch_wayback_snapshot(timestamp, original)
                time.sleep(SLEEP_S)
    else:
        print("No CDX rows returned (see log for status/errors) — nothing to fetch.")

    # --- Step 4b: targeted CDX query for individual FBO notice pages --------
    # fbo.gov notice-detail pages carry mode=form&s=opportunity in the query
    # string; a domain-wide CDX filter on that pattern surfaces archived
    # solicitation pages (not just the homepage), so we can check whether
    # actual notice-body text is retrievable and scan it for PE codes.
    print()
    print("=== Step 4b: Wayback CDX for individual FBO notice-detail pages ===")
    notice_rows = wayback_cdx(
        {
            "url": "fbo.gov",
            "matchType": "domain",
            "filter": ["original:.*mode=form.*s=opportunity.*", "statuscode:200"],
            "collapse": "urlkey",
            "limit": 20,
        }
    )
    time.sleep(SLEEP_S)

    if notice_rows:
        # A few FBO captures have a malformed "original" field (the archived
        # crawl target got concatenated with a redirect URL) — original.count
        # ("https://") > 1 is that signature. Skip those and prefer clean rows
        # so the fetched URL is unambiguous.
        clean_rows = [r for r in notice_rows if r.split()[2].count("https://") <= 1] if notice_rows else []
        for row in (clean_rows or notice_rows)[:2]:
            parts = row.split()
            if len(parts) >= 3:
                timestamp, original = parts[1], parts[2]
                fetch_wayback_snapshot(timestamp, original)
                time.sleep(SLEEP_S)
    else:
        print("No notice-detail CDX rows returned — nothing to fetch.")

    print()
    print(f"Done. Full request/response log: {LOG_PATH}")


if __name__ == "__main__":
    main()
