"""Acquire DoD daily contract announcements via the Internet Archive.

defense.gov (now war.gov) sits behind an Akamai WAF that blocks non-browser
clients, but web.archive.org holds deep coverage of
/News/Contracts/Contract/Article/{id}/ pages and is fetchable directly —
the same workaround the Army J-book backfill used.

Phase 1 (this script): enumerate distinct article snapshots via the CDX API,
then fetch each article's latest-timestamp snapshot politely (rate-limited,
resumable) into data/raw/announcements/{article_id}.html with a manifest
recording (article_id, original_url, snapshot_ts, sha256, bytes).

Usage:
  uv run python scripts/fetch_contract_announcements.py enumerate
  uv run python scripts/fetch_contract_announcements.py fetch [--limit N]
"""
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "announcements"
CDX = "http://web.archive.org/cdx/search/cdx"
UA = "fiscalreceipts-announcements/1.0 (research; contact via fiscalreceipts.com)"

ARTICLE_RE = re.compile(r"/news/contracts/contract/article/(\d+)", re.I)


def _get(url: str, timeout: int = 60, retries: int = 4) -> bytes:
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(3 * (i + 1))
    raise RuntimeError("unreachable")


def enumerate_articles() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    best: dict[str, tuple[str, str]] = {}  # article_id -> (timestamp, original)
    page = 0
    while True:
        # NB: the CDX API rejects `collapse` combined with `page` (HTTP 400);
        # we page uncollapsed and dedupe per article id client-side instead.
        q = urllib.parse.urlencode({
            "url": "defense.gov/News/Contracts/Contract/Article/*",
            "output": "json", "filter": "statuscode:200",
            "page": page,
        })
        try:
            raw = _get(f"{CDX}?{q}", timeout=180, retries=6)
        except urllib.error.HTTPError as e:
            # the paged CDX backend answers 400 for a page past the end of
            # the filtered result set (numpages reflects the unfiltered query)
            if e.code == 400 and page > 0:
                print(f"CDX page {page}: past end (400) — enumeration complete")
                break
            raise
        rows = json.loads(raw) if raw.strip() else []
        if not rows or len(rows) <= 1:
            break
        for ts_row in rows[1:]:
            _, ts, original, mimetype, _, _, _ = ts_row
            if mimetype != "text/html":
                continue
            m = ARTICLE_RE.search(original)
            if not m:
                continue
            aid = m.group(1)
            # keep the LATEST snapshot per article (later re-crawls fix truncation)
            if aid not in best or ts > best[aid][0]:
                best[aid] = (ts, original)
        print(f"CDX page {page}: cumulative {len(best)} distinct articles")
        page += 1
        time.sleep(1)
    with open(RAW / "enumeration.json", "w") as f:
        json.dump({aid: {"ts": ts, "url": u} for aid, (ts, u) in sorted(best.items())}, f, indent=0)
    print(f"enumerated {len(best)} distinct articles -> {RAW/'enumeration.json'}")


def fetch(limit: int | None = None) -> None:
    enum = json.load(open(RAW / "enumeration.json"))
    manifest_path = RAW / "manifest.jsonl"
    have = set()
    if manifest_path.exists():
        for line in open(manifest_path):
            try:
                have.add(json.loads(line)["article_id"])
            except Exception:
                pass
    todo = [(aid, meta) for aid, meta in enum.items() if aid not in have]
    print(f"{len(enum)} enumerated; {len(have)} already fetched; {len(todo)} to go")
    if limit:
        todo = todo[:limit]
    ok = err = 0
    with open(manifest_path, "a") as mf:
        for i, (aid, meta) in enumerate(todo):
            url = f"http://web.archive.org/web/{meta['ts']}id_/{meta['url']}"
            try:
                body = _get(url, timeout=90)
                sha = hashlib.sha256(body).hexdigest()
                (RAW / f"{aid}.html").write_bytes(body)
                mf.write(json.dumps({
                    "article_id": aid, "original_url": meta["url"],
                    "snapshot_ts": meta["ts"], "sha256": sha, "bytes": len(body),
                }) + "\n")
                mf.flush()
                ok += 1
            except Exception as e:
                err += 1
                print(f"  !! {aid}: {e}")
            if i % 100 == 0:
                print(f"[{i}/{len(todo)}] ok={ok} err={err}")
            time.sleep(0.6)  # polite to archive.org
    print(f"done: ok={ok} err={err}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "enumerate"
    if cmd == "enumerate":
        enumerate_articles()
    elif cmd == "fetch":
        lim = None
        if "--limit" in sys.argv:
            lim = int(sys.argv[sys.argv.index("--limit") + 1])
        fetch(lim)
    else:
        raise SystemExit(f"unknown command {cmd}")
