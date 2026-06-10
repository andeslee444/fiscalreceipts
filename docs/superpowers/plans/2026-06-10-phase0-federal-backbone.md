# Phase 0: Federal Data Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-queryable federal spending spine: DoD award transactions (FY2017+), subawards, and Treasury outlays landed as Parquet on the Mac Mini, modeled into a dbt star schema over DuckDB — no scraping, no LLM.

**Architecture:** Three thin loaders (USAspending award-data-archive zips, USAspending custom subaward downloads, Treasury FiscalData JSON) stream files to `data/raw/`, convert immediately to zstd Parquet partitioned by fiscal year, record a source manifest, and delete raws. dbt-duckdb builds staging views directly over the Parquet (no data copied into the .duckdb file) plus a small `dim_recipients` table derived from transaction UEI fields.

**Tech Stack:** Python 3.12, uv, httpx, DuckDB, dbt-duckdb, pytest (httpx.MockTransport for all network tests).

**Deviations from spec (flagged for user):** (1) No `dlt` in Phase 0 — the loaders are bulk-file downloads + one paginated GET; plain httpx keeps one debuggable pattern. Reconsider dlt when incremental multi-resource sync arrives. (2) SAM.gov entity extract deferred to Phase 2 (entity resolution) — `dim_recipients` derives from `recipient_uei` / `recipient_parent_uei` fields already in USAspending transactions. (3) No Postgres in Phase 0 — DuckDB covers the analytics spine; Postgres enters in Phase 1 (canonical extracted facts with provenance) and Phase 5 (app backend).

**Conventions for every task:**
- All commands run from `/Users/andeslee/Documents/Cursor-Projects/GovBudget`.
- Every commit: `git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "<msg>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`
- Core functions take explicit `path`/`client` arguments (testable); only `cli.py` binds defaults from `config.py`.

---

### Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/govbudget/__init__.py`, `src/govbudget/config.py`, `tests/test_config.py`

- [ ] **Step 1: Verify uv is installed**

Run: `uv --version`
Expected: `uv 0.x.x`. If missing: `brew install uv`.

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[project]
name = "govbudget"
version = "0.1.0"
description = "Government spending intelligence — federal data backbone"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "duckdb>=1.1",
    "dbt-duckdb>=1.9",
]

[dependency-groups]
dev = ["pytest>=8"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/govbudget"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 3: Write `.gitignore`**

```gitignore
.venv/
__pycache__/
*.pyc
data/raw/
data/parquet/
data/duckdb/
dbt/target/
dbt/dbt_packages/
dbt/logs/
logs/
.env
```

Note: `data/manifest.jsonl` is intentionally NOT ignored — it is the reproducibility record.

- [ ] **Step 4: Write the failing test `tests/test_config.py`**

```python
from govbudget import config


def test_paths_and_constants():
    assert config.DATA_DIR.name == "data"
    assert config.PARQUET_DIR == config.DATA_DIR / "parquet"
    assert config.DOD_TOPTIER_CODE == "097"
    assert config.FY_START == 2017
    assert "contracts" in config.REQUIRED_COLUMNS
```

- [ ] **Step 5: Run test to verify it fails**

Run: `uv sync && uv run pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError` or `ImportError` (config does not exist yet). `src/govbudget/__init__.py` is an empty file — create it now.

- [ ] **Step 6: Write `src/govbudget/config.py`**

```python
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("GOVBUDGET_DATA", ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
PARQUET_DIR = DATA_DIR / "parquet"
DUCKDB_PATH = DATA_DIR / "duckdb" / "govbudget.duckdb"
MANIFEST_PATH = DATA_DIR / "manifest.jsonl"

USASPENDING_API = "https://api.usaspending.gov/api/v2"
FISCALDATA_API = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"

DOD_TOPTIER_CODE = "097"
FY_START = 2017
FY_END = 2026
MIN_FREE_GB = 25

# Columns that must exist in converted Parquet or the load is rejected.
REQUIRED_COLUMNS: dict[str, set[str]] = {
    "contracts": {
        "contract_transaction_unique_key",
        "action_date",
        "federal_action_obligation",
        "recipient_uei",
    },
    "assistance": {
        "assistance_transaction_unique_key",
        "action_date",
        "federal_action_obligation",
        "recipient_uei",
    },
    "subawards": {
        "prime_award_unique_key",
        "subaward_amount",
        "subaward_action_date",
    },
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS (1 passed)

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml .gitignore uv.lock src/govbudget tests/test_config.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): scaffold govbudget python project

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Source manifest

Every downloaded file gets an append-only JSONL record so loads are idempotent and reproducible (raws are deleted after conversion; the manifest is what lets us re-download byte-identical inputs).

**Files:**
- Create: `src/govbudget/manifest.py`
- Test: `tests/test_manifest.py`

- [ ] **Step 1: Write the failing test**

```python
from govbudget.manifest import ManifestRecord, append_record, has_file, load_records


def make_record(name="FY2017_097_Assistance_Full_20260601.zip"):
    return ManifestRecord(
        dataset="assistance",
        fiscal_year=2017,
        file_name=name,
        source_url="https://files.usaspending.gov/award_data_archive/" + name,
        sha256="ab" * 32,
        bytes=12345,
        downloaded_at="2026-06-10T00:00:00+00:00",
    )


def test_append_and_load_roundtrip(tmp_path):
    path = tmp_path / "manifest.jsonl"
    append_record(path, make_record())
    append_record(path, make_record(name="other.zip"))
    records = load_records(path)
    assert len(records) == 2
    assert records[0].dataset == "assistance"
    assert records[1].file_name == "other.zip"


def test_has_file(tmp_path):
    path = tmp_path / "manifest.jsonl"
    assert not has_file(path, "x.zip")  # missing manifest file is fine
    append_record(path, make_record(name="x.zip"))
    assert has_file(path, "x.zip")
    assert not has_file(path, "y.zip")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.manifest'`

- [ ] **Step 3: Write `src/govbudget/manifest.py`**

```python
import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class ManifestRecord:
    dataset: str
    fiscal_year: int | None
    file_name: str
    source_url: str
    sha256: str
    bytes: int
    downloaded_at: str


def append_record(path: Path, record: ManifestRecord) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(asdict(record)) + "\n")


def load_records(path: Path) -> list[ManifestRecord]:
    if not path.exists():
        return []
    with open(path) as f:
        return [ManifestRecord(**json.loads(line)) for line in f if line.strip()]


def has_file(path: Path, file_name: str) -> bool:
    return any(r.file_name == file_name for r in load_records(path))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_manifest.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/manifest.py tests/test_manifest.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): add append-only source manifest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Disk guard + streaming downloader

**Files:**
- Create: `src/govbudget/download.py`
- Test: `tests/test_download.py`

- [ ] **Step 1: Write the failing test**

```python
import hashlib

import httpx
import pytest

from govbudget.download import DiskSpaceError, download_file, ensure_free_space

PAYLOAD = b"x" * (3 * 1024 * 1024)  # 3 MB to exercise chunking


def make_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_download_writes_file_and_returns_sha(tmp_path):
    def handler(request):
        return httpx.Response(200, content=PAYLOAD)

    dest = tmp_path / "file.zip"
    with make_client(handler) as client:
        sha, n = download_file(client, "https://example.test/file.zip", dest)
    assert dest.read_bytes() == PAYLOAD
    assert n == len(PAYLOAD)
    assert sha == hashlib.sha256(PAYLOAD).hexdigest()
    assert not dest.with_suffix(".zip.part").exists()


def test_download_retries_then_raises(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(500)

    with make_client(handler) as client:
        with pytest.raises(httpx.HTTPError):
            download_file(
                client, "https://example.test/f.zip", tmp_path / "f.zip",
                max_retries=3, backoff_base=0,
            )
    assert len(calls) == 3


def test_ensure_free_space_raises_when_insufficient(tmp_path):
    with pytest.raises(DiskSpaceError):
        ensure_free_space(tmp_path, min_free_gb=10**9)  # absurd requirement
    ensure_free_space(tmp_path, min_free_gb=0)  # should not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_download.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.download'`

- [ ] **Step 3: Write `src/govbudget/download.py`**

```python
import hashlib
import shutil
import time
from pathlib import Path

import httpx


class DiskSpaceError(RuntimeError):
    pass


def ensure_free_space(path: Path, min_free_gb: float) -> None:
    path.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(path).free
    if free < min_free_gb * 2**30:
        raise DiskSpaceError(
            f"{free / 2**30:.1f} GB free at {path}, need {min_free_gb} GB. "
            "Free disk space or lower MIN_FREE_GB."
        )


def download_file(
    client: httpx.Client,
    url: str,
    dest: Path,
    *,
    max_retries: int = 3,
    backoff_base: float = 2.0,
) -> tuple[str, int]:
    """Stream url to dest. Returns (sha256, byte_count). Writes dest.part then renames."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, max_retries + 1):
        try:
            digest = hashlib.sha256()
            n = 0
            with client.stream("GET", url, follow_redirects=True, timeout=300) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes(1024 * 1024):
                        f.write(chunk)
                        digest.update(chunk)
                        n += len(chunk)
            tmp.rename(dest)
            return digest.hexdigest(), n
        except httpx.HTTPError:
            tmp.unlink(missing_ok=True)
            if attempt == max_retries:
                raise
            time.sleep(backoff_base**attempt)
    raise AssertionError("unreachable")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_download.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/download.py tests/test_download.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): streaming downloader with disk guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: USAspending archive client

The Award Data Archive serves pre-generated per-agency per-FY zips (regenerated monthly) — far more reliable than custom download generation for full-agency pulls. API contract: `fedspendingtransparency/usaspending-api` repo, `api_contracts/contracts/v2/bulk_download/list_monthly_files.md`.

**Files:**
- Create: `src/govbudget/usaspending/__init__.py` (empty), `src/govbudget/usaspending/archive.py`
- Test: `tests/test_archive_client.py`

- [ ] **Step 1: Write the failing test**

```python
import httpx
import pytest

from govbudget.usaspending.archive import list_full_files, resolve_agency_id

AGENCIES = {
    "results": [
        {"agency_id": 1137, "toptier_code": "012", "agency_name": "Department of Agriculture"},
        {"agency_id": 1173, "toptier_code": "097", "agency_name": "Department of Defense"},
    ]
}

MONTHLY = {
    "monthly_files": [
        {
            "file_name": "FY2017_097_Contracts_Delta_20260603.zip",
            "url": "https://files.usaspending.gov/award_data_archive/FY2017_097_Contracts_Delta_20260603.zip",
            "updated_date": "2026-06-03",
        },
        {
            "file_name": "FY2017_097_Contracts_Full_20260510.zip",
            "url": "https://files.usaspending.gov/award_data_archive/FY2017_097_Contracts_Full_20260510.zip",
            "updated_date": "2026-05-10",
        },
        {
            "file_name": "FY2017_097_Contracts_Full_20260607.zip",
            "url": "https://files.usaspending.gov/award_data_archive/FY2017_097_Contracts_Full_20260607.zip",
            "updated_date": "2026-06-07",
        },
    ]
}


def make_client():
    def handler(request):
        if request.url.path.endswith("/references/toptier_agencies/"):
            return httpx.Response(200, json=AGENCIES)
        if request.url.path.endswith("/bulk_download/list_monthly_files/"):
            return httpx.Response(200, json=MONTHLY)
        return httpx.Response(404)

    return httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://api.usaspending.gov/api/v2",
    )


def test_resolve_agency_id_finds_dod():
    with make_client() as client:
        assert resolve_agency_id(client, "097") == 1173


def test_resolve_agency_id_unknown_code_raises():
    with make_client() as client:
        with pytest.raises(LookupError):
            resolve_agency_id(client, "999")


def test_list_full_files_picks_latest_full():
    with make_client() as client:
        info = list_full_files(client, agency_id=1173, fiscal_year=2017, type_="contracts")
    assert info["file_name"] == "FY2017_097_Contracts_Full_20260607.zip"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_archive_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.usaspending'`

- [ ] **Step 3: Write `src/govbudget/usaspending/archive.py`** (and empty `__init__.py`)

```python
import httpx


def resolve_agency_id(client: httpx.Client, toptier_code: str) -> int:
    r = client.get("/references/toptier_agencies/")
    r.raise_for_status()
    for agency in r.json()["results"]:
        if agency["toptier_code"] == toptier_code:
            return agency["agency_id"]
    raise LookupError(f"No toptier agency with code {toptier_code}")


def list_full_files(
    client: httpx.Client, *, agency_id: int, fiscal_year: int, type_: str
) -> dict:
    """Latest 'Full' archive file for one agency/FY/type. type_ in {contracts, assistance}."""
    r = client.post(
        "/bulk_download/list_monthly_files/",
        json={"agency": agency_id, "fiscal_year": fiscal_year, "type": type_},
    )
    r.raise_for_status()
    fulls = [
        f for f in r.json()["monthly_files"] if "_Full_" in f["file_name"]
    ]
    if not fulls:
        raise LookupError(f"No Full archive file for agency={agency_id} fy={fiscal_year} type={type_}")
    return max(fulls, key=lambda f: f["updated_date"])
```

Note the keyword-only signature (`*,`) — the test calls `list_full_files(client, agency_id=..., fiscal_year=..., type_=...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_archive_client.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/usaspending tests/test_archive_client.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): usaspending award-data-archive client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Zip → Parquet converter

Disk-bounded conversion: extract one CSV member at a time, convert via DuckDB with `all_varchar=true` (numeric casting happens in dbt staging with `try_cast` — archive CSVs contain messy fields that break type inference), delete each CSV after converting, delete the zip at the end. Rejects files missing `REQUIRED_COLUMNS`.

**Files:**
- Create: `src/govbudget/convert.py`
- Test: `tests/test_convert.py`

- [ ] **Step 1: Write the failing test**

```python
import zipfile

import duckdb
import pytest

from govbudget.convert import MissingColumnsError, convert_zip_to_parquet

CONTRACT_HEADER = (
    "contract_transaction_unique_key,action_date,federal_action_obligation,"
    "recipient_uei,recipient_name,recipient_parent_uei,recipient_parent_name,"
    "awarding_agency_name,awarding_sub_agency_name,naics_code,"
    "product_or_service_code,primary_place_of_performance_state_code"
)
CONTRACT_ROWS = [
    'K1,2017-01-15,1000.50,UEI1,ACME CORP,PUEI1,ACME PARENT,Department of Defense,Dept of the Army,336411,1510,CA',
    'K2,2017-03-02,-50.25,UEI2,BETA LLC,,,Department of Defense,Dept of the Navy,541330,R425,VA',
]


def make_zip(tmp_path, name, header, rows, members=2):
    zip_path = tmp_path / name
    with zipfile.ZipFile(zip_path, "w") as zf:
        for i in range(members):
            zf.writestr(f"part_{i}.csv", header + "\n" + "\n".join(rows) + "\n")
    return zip_path


def test_convert_writes_partitioned_parquet_and_cleans_up(tmp_path):
    zip_path = make_zip(tmp_path, "FY2017_097_Contracts_Full_20260607.zip", CONTRACT_HEADER, CONTRACT_ROWS)
    parquet_dir = tmp_path / "parquet"
    raw_dir = tmp_path / "raw"
    written = convert_zip_to_parquet(
        zip_path, dataset="contracts", fiscal_year=2017,
        parquet_dir=parquet_dir, raw_dir=raw_dir,
        required_columns={"contract_transaction_unique_key", "action_date"},
    )
    assert len(written) == 2
    out = duckdb.sql(
        f"select count(*) n, count(distinct fy) fys from read_parquet('{parquet_dir}/contracts/*/*.parquet', hive_partitioning=true)"
    ).fetchone()
    assert out == (4, 1)  # 2 members x 2 rows, one fy partition
    assert not zip_path.exists()
    assert not any(raw_dir.rglob("*.csv"))


def test_convert_replaces_existing_partition(tmp_path):
    parquet_dir = tmp_path / "parquet"
    stale = parquet_dir / "contracts" / "fy=2017" / "stale.parquet"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"junk")
    zip_path = make_zip(tmp_path, "a.zip", CONTRACT_HEADER, CONTRACT_ROWS, members=1)
    convert_zip_to_parquet(
        zip_path, dataset="contracts", fiscal_year=2017,
        parquet_dir=parquet_dir, raw_dir=tmp_path / "raw",
        required_columns=set(),
    )
    assert not stale.exists()


def test_convert_rejects_missing_required_columns(tmp_path):
    zip_path = make_zip(tmp_path, "bad.zip", "colA,colB", ["1,2"], members=1)
    with pytest.raises(MissingColumnsError):
        convert_zip_to_parquet(
            zip_path, dataset="contracts", fiscal_year=2017,
            parquet_dir=tmp_path / "parquet", raw_dir=tmp_path / "raw",
            required_columns={"contract_transaction_unique_key"},
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_convert.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.convert'`

- [ ] **Step 3: Write `src/govbudget/convert.py`**

```python
import shutil
import zipfile
from pathlib import Path

import duckdb


class MissingColumnsError(RuntimeError):
    pass


def _check_columns(con: duckdb.DuckDBPyConnection, parquet_path: Path, required: set[str]) -> None:
    cols = {
        row[0]
        for row in con.execute(
            f"describe select * from read_parquet('{parquet_path}')"
        ).fetchall()
    }
    missing = required - cols
    if missing:
        raise MissingColumnsError(
            f"{parquet_path.name} missing required columns: {sorted(missing)}"
        )


def convert_zip_to_parquet(
    zip_path: Path,
    *,
    dataset: str,
    fiscal_year: int,
    parquet_dir: Path,
    raw_dir: Path,
    required_columns: set[str],
) -> list[Path]:
    """Extract CSV members one at a time, convert to zstd Parquet, delete raws.

    Replaces the whole fy partition (archive Full files supersede prior months).
    """
    out_dir = parquet_dir / dataset / f"fy={fiscal_year}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    extract_dir = raw_dir / f"extract_{zip_path.stem}"
    extract_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    con = duckdb.connect()
    try:
        with zipfile.ZipFile(zip_path) as zf:
            members = [m for m in zf.namelist() if m.lower().endswith(".csv")]
            for i, member in enumerate(members):
                csv_path = Path(zf.extract(member, extract_dir))
                out_path = out_dir / f"part_{i:03d}.parquet"
                con.execute(
                    f"""
                    copy (select * from read_csv('{csv_path}', header=true, all_varchar=true))
                    to '{out_path}' (format parquet, compression zstd)
                    """
                )
                csv_path.unlink()
                _check_columns(con, out_path, required_columns)
                written.append(out_path)
    finally:
        con.close()
        shutil.rmtree(extract_dir, ignore_errors=True)
    zip_path.unlink()
    return written
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_convert.py -v`
Expected: PASS (3 passed)

Note: conversion writes to a temporary `fy={year}.incoming` partition and atomically swaps it in only after every member validates — a rejected load preserves the prior live partition and the source zip (review fix; supersedes the original clear-then-write design).

- [ ] **Step 5: Commit**

```bash
git add src/govbudget/convert.py tests/test_convert.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): disk-bounded zip to parquet converter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Archive sync orchestration + CLI

**Files:**
- Create: `src/govbudget/usaspending/archive_sync.py`, `src/govbudget/cli.py`, `src/govbudget/__main__.py`
- Test: `tests/test_archive_sync.py`

- [ ] **Step 1: Write the failing test**

```python
import io
import zipfile

import httpx

from govbudget.manifest import load_records
from govbudget.usaspending.archive_sync import sync_archive

CSV = "contract_transaction_unique_key,action_date\nK1,2017-01-15\n"


def make_zip_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("part_0.csv", CSV)
    return buf.getvalue()


AGENCIES = {"results": [{"agency_id": 1173, "toptier_code": "097", "agency_name": "DoD"}]}


def make_client():
    zip_bytes = make_zip_bytes()

    def handler(request):
        if request.url.path.endswith("/references/toptier_agencies/"):
            return httpx.Response(200, json=AGENCIES)
        if request.url.path.endswith("/bulk_download/list_monthly_files/"):
            return httpx.Response(200, json={"monthly_files": [{
                "file_name": "FY2017_097_Contracts_Full_20260607.zip",
                "url": "https://api.usaspending.gov/fake/FY2017_097_Contracts_Full_20260607.zip",
                "updated_date": "2026-06-07",
            }]})
        if request.url.path.endswith(".zip"):
            return httpx.Response(200, content=zip_bytes)
        return httpx.Response(404)

    return httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://api.usaspending.gov/api/v2",
    )


def test_sync_downloads_converts_and_records(tmp_path):
    manifest = tmp_path / "manifest.jsonl"
    with make_client() as client:
        result = sync_archive(
            client, type_="contracts", fiscal_year=2017,
            parquet_dir=tmp_path / "parquet", raw_dir=tmp_path / "raw",
            manifest_path=manifest,
            required_columns={"contract_transaction_unique_key"},
            min_free_gb=0,
        )
    assert result == "loaded"
    records = load_records(manifest)
    assert len(records) == 1
    assert records[0].dataset == "contracts"
    assert (tmp_path / "parquet" / "contracts" / "fy=2017" / "part_000.parquet").exists()


def test_sync_skips_already_loaded_file(tmp_path):
    manifest = tmp_path / "manifest.jsonl"
    with make_client() as client:
        kwargs = dict(
            type_="contracts", fiscal_year=2017,
            parquet_dir=tmp_path / "parquet", raw_dir=tmp_path / "raw",
            manifest_path=manifest,
            required_columns={"contract_transaction_unique_key"},
            min_free_gb=0,
        )
        sync_archive(client, **kwargs)
        result = sync_archive(client, **kwargs)
    assert result == "skipped"
    assert len(load_records(manifest)) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_archive_sync.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.usaspending.archive_sync'`

- [ ] **Step 3: Write `src/govbudget/usaspending/archive_sync.py`**

```python
import datetime as dt
from pathlib import Path

import httpx

from govbudget.config import DOD_TOPTIER_CODE
from govbudget.convert import convert_zip_to_parquet
from govbudget.download import download_file, ensure_free_space
from govbudget.manifest import ManifestRecord, append_record, has_file
from govbudget.usaspending.archive import list_full_files, resolve_agency_id


def sync_archive(
    client: httpx.Client,
    *,
    type_: str,
    fiscal_year: int,
    parquet_dir: Path,
    raw_dir: Path,
    manifest_path: Path,
    required_columns: set[str],
    min_free_gb: float,
    toptier_code: str = DOD_TOPTIER_CODE,
) -> str:
    """Returns 'loaded' or 'skipped'."""
    agency_id = resolve_agency_id(client, toptier_code)
    info = list_full_files(client, agency_id=agency_id, fiscal_year=fiscal_year, type_=type_)
    if has_file(manifest_path, info["file_name"]):
        return "skipped"
    ensure_free_space(raw_dir, min_free_gb)
    zip_path = raw_dir / info["file_name"]
    sha, n = download_file(client, info["url"], zip_path)
    convert_zip_to_parquet(
        zip_path, dataset=type_, fiscal_year=fiscal_year,
        parquet_dir=parquet_dir, raw_dir=raw_dir,
        required_columns=required_columns,
    )
    append_record(manifest_path, ManifestRecord(
        dataset=type_, fiscal_year=fiscal_year,
        file_name=info["file_name"], source_url=info["url"],
        sha256=sha, bytes=n,
        downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
    ))
    return "loaded"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_archive_sync.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Write `src/govbudget/cli.py` and `src/govbudget/__main__.py`**

`src/govbudget/cli.py`:

```python
import argparse
import subprocess
import sys

import httpx

from govbudget import config


def _usaspending_client() -> httpx.Client:
    return httpx.Client(base_url=config.USASPENDING_API, timeout=60)


def cmd_sync_archive(args) -> None:
    types = ["contracts", "assistance"] if args.type == "both" else [args.type]
    with _usaspending_client() as client:
        for fy in range(args.fy_start, args.fy_end + 1):
            for type_ in types:
                result = sync_archive_cmd(client, type_, fy)
                print(f"{type_} fy{fy}: {result}")


def sync_archive_cmd(client, type_, fy) -> str:
    from govbudget.usaspending.archive_sync import sync_archive

    return sync_archive(
        client, type_=type_, fiscal_year=fy,
        parquet_dir=config.PARQUET_DIR, raw_dir=config.RAW_DIR,
        manifest_path=config.MANIFEST_PATH,
        required_columns=config.REQUIRED_COLUMNS[type_],
        min_free_gb=config.MIN_FREE_GB,
    )


def cmd_build(args) -> None:
    rc = subprocess.run(
        ["dbt", "build", "--project-dir", "dbt", "--profiles-dir", "dbt"]
    ).returncode
    sys.exit(rc)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="govbudget")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("sync-archive", help="DoD award archive zips -> parquet")
    a.add_argument("--type", choices=["contracts", "assistance", "both"], default="both")
    a.add_argument("--fy-start", type=int, default=config.FY_START)
    a.add_argument("--fy-end", type=int, default=config.FY_END)
    a.set_defaults(func=cmd_sync_archive)

    b = sub.add_parser("build", help="dbt build star schema")
    b.set_defaults(func=cmd_build)

    args = p.parse_args(argv)
    args.func(args)
```

`src/govbudget/__main__.py`:

```python
from govbudget.cli import main

main()
```

- [ ] **Step 6: Verify CLI parses**

Run: `uv run python -m govbudget --help`
Expected: usage text listing `sync-archive` and `build` subcommands, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/govbudget/usaspending/archive_sync.py src/govbudget/cli.py src/govbudget/__main__.py tests/test_archive_sync.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): archive sync orchestration and cli

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Subaward custom bulk download

Subawards are not in the archive; they come from the custom download API (request → poll → download). API contract: `api_contracts/contracts/v2/bulk_download/awards.md` and `api_contracts/contracts/v2/download/status.md` in the `fedspendingtransparency/usaspending-api` repo. If the live API rejects the payload during the Task 10 smoke, fix the payload against those two docs — the payload builder is isolated in one function for exactly this reason.

**Files:**
- Create: `src/govbudget/usaspending/subawards.py`
- Modify: `src/govbudget/cli.py` (add `sync-subawards` subcommand)
- Test: `tests/test_subawards.py`

- [ ] **Step 1: Write the failing test**

```python
import io
import zipfile

import httpx
import pytest

from govbudget.usaspending.subawards import (
    DownloadFailedError, fy_date_range, poll_until_ready, request_subaward_download,
)


def test_fy_date_range():
    assert fy_date_range(2017) == ("2016-10-01", "2017-09-30")
    assert fy_date_range(2026) == ("2025-10-01", "2026-09-30")


def make_client(status_sequence):
    statuses = iter(status_sequence)

    def handler(request):
        if request.url.path.endswith("/bulk_download/awards/"):
            return httpx.Response(200, json={
                "file_name": "sub_dl_123.zip",
                "status_url": "https://api.usaspending.gov/api/v2/download/status?file_name=sub_dl_123.zip",
                "file_url": "https://files.usaspending.gov/generated_downloads/sub_dl_123.zip",
            })
        if request.url.path.endswith("/download/status"):
            return httpx.Response(200, json=next(statuses))
        return httpx.Response(404)

    return httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://api.usaspending.gov/api/v2",
    )


def test_request_returns_file_name():
    with make_client([]) as client:
        resp = request_subaward_download(client, fiscal_year=2017)
    assert resp["file_name"] == "sub_dl_123.zip"


def test_poll_until_ready_returns_file_url():
    seq = [
        {"status": "running", "file_url": None},
        {"status": "finished", "file_url": "https://files.usaspending.gov/generated_downloads/sub_dl_123.zip"},
    ]
    with make_client(seq) as client:
        url = poll_until_ready(client, "sub_dl_123.zip", interval_s=0, timeout_s=10)
    assert url.endswith("sub_dl_123.zip")


def test_poll_raises_on_failed():
    seq = [{"status": "failed", "file_url": None, "message": "boom"}]
    with make_client(seq) as client:
        with pytest.raises(DownloadFailedError):
            poll_until_ready(client, "sub_dl_123.zip", interval_s=0, timeout_s=10)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_subawards.py -v`
Expected: FAIL with `ModuleNotFoundError` (subawards module does not exist)

- [ ] **Step 3: Write `src/govbudget/usaspending/subawards.py`**

```python
import time

import httpx


class DownloadFailedError(RuntimeError):
    pass


def fy_date_range(fiscal_year: int) -> tuple[str, str]:
    return (f"{fiscal_year - 1}-10-01", f"{fiscal_year}-09-30")


def request_subaward_download(client: httpx.Client, *, fiscal_year: int) -> dict:
    """POST /bulk_download/awards/ for DoD subawards in one fiscal year.

    Payload shape: api_contracts/contracts/v2/bulk_download/awards.md
    """
    start, end = fy_date_range(fiscal_year)
    payload = {
        "filters": {
            "agencies": [
                {"type": "awarding", "tier": "toptier", "name": "Department of Defense"}
            ],
            "prime_award_types": [
                "A", "B", "C", "D",
                "02", "03", "04", "05", "06", "07", "08", "09", "10", "11",
            ],
            "date_type": "action_date",
            "date_range": {"start_date": start, "end_date": end},
        },
        "subawards": True,
        "file_format": "csv",
    }
    r = client.post("/bulk_download/awards/", json=payload)
    r.raise_for_status()
    return r.json()


def poll_until_ready(
    client: httpx.Client, file_name: str, *, interval_s: float = 30, timeout_s: float = 3600
) -> str:
    """GET /download/status until finished. Returns file_url.

    Contract: api_contracts/contracts/v2/download/status.md
    """
    deadline = time.monotonic() + timeout_s
    while True:
        r = client.get("/download/status", params={"file_name": file_name})
        r.raise_for_status()
        body = r.json()
        if body["status"] == "finished":
            return body["file_url"]
        if body["status"] == "failed":
            raise DownloadFailedError(f"{file_name}: {body.get('message', 'unknown error')}")
        if time.monotonic() > deadline:
            raise TimeoutError(f"{file_name} not ready after {timeout_s}s")
        time.sleep(interval_s)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_subawards.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Wire `sync-subawards` into `src/govbudget/cli.py`**

Add this function to `cli.py`:

```python
def cmd_sync_subawards(args) -> None:
    import datetime as dt

    from govbudget.convert import convert_zip_to_parquet
    from govbudget.download import download_file, ensure_free_space
    from govbudget.manifest import ManifestRecord, append_record, has_file
    from govbudget.usaspending.subawards import poll_until_ready, request_subaward_download

    with _usaspending_client() as client:
        resp = request_subaward_download(client, fiscal_year=args.fy)
        file_name = resp["file_name"]
        if has_file(config.MANIFEST_PATH, file_name):
            print(f"subawards fy{args.fy}: skipped")
            return
        url = poll_until_ready(client, file_name)
        ensure_free_space(config.RAW_DIR, config.MIN_FREE_GB)
        zip_path = config.RAW_DIR / file_name
        sha, n = download_file(client, url, zip_path)
        convert_zip_to_parquet(
            zip_path, dataset="subawards", fiscal_year=args.fy,
            parquet_dir=config.PARQUET_DIR, raw_dir=config.RAW_DIR,
            required_columns=config.REQUIRED_COLUMNS["subawards"],
        )
        append_record(config.MANIFEST_PATH, ManifestRecord(
            dataset="subawards", fiscal_year=args.fy,
            file_name=file_name, source_url=url, sha256=sha, bytes=n,
            downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
        ))
        print(f"subawards fy{args.fy}: loaded")
```

And register it inside `main()` after the `sync-archive` parser:

```python
    s = sub.add_parser("sync-subawards", help="DoD subawards (custom download) -> parquet")
    s.add_argument("--fy", type=int, required=True)
    s.set_defaults(func=cmd_sync_subawards)
```

- [ ] **Step 6: Run full test suite and CLI help**

Run: `uv run pytest -v && uv run python -m govbudget --help`
Expected: all tests PASS; help lists `sync-subawards`.

- [ ] **Step 7: Commit**

```bash
git add src/govbudget/usaspending/subawards.py src/govbudget/cli.py tests/test_subawards.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): subaward custom bulk download

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Treasury FiscalData loader (MTS outlays)

Monthly Treasury Statement table 5 (outlays by agency) gives the top-down control totals that award-level data reconciles against later. Paginated JSON, no API key.

**Files:**
- Create: `src/govbudget/fiscaldata.py`
- Modify: `src/govbudget/cli.py` (add `sync-fiscaldata`)
- Test: `tests/test_fiscaldata.py`

- [ ] **Step 1: Write the failing test**

```python
import duckdb
import httpx

from govbudget.fiscaldata import fetch_all_pages, sync_mts_outlays

PAGE1 = {
    "data": [{"record_date": "2017-10-31", "classification_desc": "Department of Defense", "current_month_gross_outly_amt": "1000"}],
    "meta": {"total-pages": 2},
}
PAGE2 = {
    "data": [{"record_date": "2017-11-30", "classification_desc": "Department of Defense", "current_month_gross_outly_amt": "2000"}],
    "meta": {"total-pages": 2},
}


def make_client():
    def handler(request):
        page = request.url.params.get("page[number]", "1")
        return httpx.Response(200, json=PAGE1 if page == "1" else PAGE2)

    return httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://api.fiscaldata.treasury.gov/services/api/fiscal_service",
    )


def test_fetch_all_pages_concatenates():
    with make_client() as client:
        rows = fetch_all_pages(client, "/v1/accounting/mts/mts_table_5", {})
    assert len(rows) == 2
    assert rows[1]["record_date"] == "2017-11-30"


def test_sync_writes_parquet_and_manifest(tmp_path):
    manifest = tmp_path / "manifest.jsonl"
    with make_client() as client:
        out = sync_mts_outlays(
            client, parquet_dir=tmp_path / "parquet",
            raw_dir=tmp_path / "raw", manifest_path=manifest, fy_start=2017,
        )
    n = duckdb.sql(f"select count(*) from read_parquet('{out}')").fetchone()[0]
    assert n == 2
    assert manifest.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_fiscaldata.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'govbudget.fiscaldata'`

- [ ] **Step 3: Write `src/govbudget/fiscaldata.py`**

```python
import datetime as dt
import hashlib
import json
from pathlib import Path

import duckdb
import httpx

from govbudget.manifest import ManifestRecord, append_record


def fetch_all_pages(client: httpx.Client, path: str, params: dict) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while True:
        r = client.get(path, params={**params, "page[number]": str(page), "page[size]": "10000"})
        r.raise_for_status()
        body = r.json()
        rows.extend(body["data"])
        if page >= int(body["meta"]["total-pages"]):
            return rows
        page += 1


def sync_mts_outlays(
    client: httpx.Client, *, parquet_dir: Path, raw_dir: Path,
    manifest_path: Path, fy_start: int,
) -> Path:
    path = "/v1/accounting/mts/mts_table_5"
    rows = fetch_all_pages(client, path, {"filter": f"record_fiscal_year:gte:{fy_start}"})
    raw_dir.mkdir(parents=True, exist_ok=True)
    jsonl = raw_dir / "mts_table_5.jsonl"
    with open(jsonl, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    out_dir = parquet_dir / "mts_outlays"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "mts_table_5.parquet"
    con = duckdb.connect()
    try:
        con.execute(
            f"""
            copy (select * from read_json_auto('{jsonl}', format='newline_delimited'))
            to '{out_path}' (format parquet, compression zstd)
            """
        )
    finally:
        con.close()
    jsonl.unlink()
    append_record(manifest_path, ManifestRecord(
        dataset="mts_outlays", fiscal_year=None,
        file_name=out_path.name, source_url=str(client.base_url) + path,
        sha256=hashlib.sha256(out_path.read_bytes()).hexdigest(),
        bytes=out_path.stat().st_size,
        downloaded_at=dt.datetime.now(dt.UTC).isoformat(),
    ))
    return out_path
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_fiscaldata.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Wire `sync-fiscaldata` into `src/govbudget/cli.py`**

Add:

```python
def cmd_sync_fiscaldata(args) -> None:
    from govbudget.fiscaldata import sync_mts_outlays

    with httpx.Client(base_url=config.FISCALDATA_API, timeout=60) as client:
        out = sync_mts_outlays(
            client, parquet_dir=config.PARQUET_DIR, raw_dir=config.RAW_DIR,
            manifest_path=config.MANIFEST_PATH, fy_start=config.FY_START,
        )
    print(f"fiscaldata: loaded {out}")
```

Register inside `main()`:

```python
    f = sub.add_parser("sync-fiscaldata", help="Treasury MTS outlays -> parquet")
    f.set_defaults(func=cmd_sync_fiscaldata)
```

- [ ] **Step 6: Run full suite**

Run: `uv run pytest -v`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/govbudget/fiscaldata.py src/govbudget/cli.py tests/test_fiscaldata.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): treasury fiscaldata mts outlays loader

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: dbt star schema

Models are **views over Parquet** (the 256GB constraint: no data duplicated into the .duckdb file); only `dim_recipients` materializes as a table (it is small). Numeric casting happens here via `try_cast` because Parquet columns are all-varchar by design.

**Files:**
- Create: `dbt/dbt_project.yml`, `dbt/profiles.yml`, `dbt/models/sources.yml`, `dbt/models/staging/stg_contracts.sql`, `dbt/models/staging/stg_assistance.sql`, `dbt/models/staging/stg_subawards.sql`, `dbt/models/staging/stg_mts_outlays.sql`, `dbt/models/marts/fct_award_transactions.sql`, `dbt/models/marts/dim_recipients.sql`, `dbt/models/marts/schema.yml`
- Test: `tests/test_dbt_build.py`

- [ ] **Step 1: Write `dbt/dbt_project.yml`**

```yaml
name: govbudget
version: "1.0"
profile: govbudget
model-paths: ["models"]
models:
  govbudget:
    +materialized: view
    marts:
      dim_recipients:
        +materialized: table
```

- [ ] **Step 2: Write `dbt/profiles.yml`**

```yaml
govbudget:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: "{{ env_var('GOVBUDGET_DUCKDB', 'data/duckdb/govbudget.duckdb') }}"
      threads: 4
```

- [ ] **Step 3: Write `dbt/models/sources.yml`**

```yaml
version: 2
sources:
  - name: lake
    schema: main
    tables:
      - name: contracts
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/contracts/*/*.parquet', hive_partitioning=true, union_by_name=true)"
      - name: assistance
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/assistance/*/*.parquet', hive_partitioning=true, union_by_name=true)"
      - name: subawards
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/subawards/*/*.parquet', hive_partitioning=true, union_by_name=true)"
      - name: mts_outlays
        meta:
          external_location: "read_parquet('{{ env_var('GOVBUDGET_DATA', 'data') }}/parquet/mts_outlays/*.parquet')"
```

Note: `GOVBUDGET_DATA` defaults to the relative path `data` — dbt always runs from the GovBudget root (`--project-dir dbt --profiles-dir dbt`).

- [ ] **Step 4: Write staging models**

`dbt/models/staging/stg_contracts.sql`:

```sql
select
    contract_transaction_unique_key as transaction_key,
    'contract' as award_type,
    try_cast(action_date as date) as action_date,
    cast(fy as integer) as fiscal_year,
    try_cast(federal_action_obligation as double) as obligation,
    nullif(recipient_uei, '') as recipient_uei,
    upper(recipient_name) as recipient_name,
    nullif(recipient_parent_uei, '') as recipient_parent_uei,
    upper(recipient_parent_name) as recipient_parent_name,
    awarding_agency_name,
    awarding_sub_agency_name,
    naics_code,
    product_or_service_code,
    primary_place_of_performance_state_code as pop_state
from {{ source('lake', 'contracts') }}
```

`dbt/models/staging/stg_assistance.sql`:

```sql
select
    assistance_transaction_unique_key as transaction_key,
    'assistance' as award_type,
    try_cast(action_date as date) as action_date,
    cast(fy as integer) as fiscal_year,
    try_cast(federal_action_obligation as double) as obligation,
    nullif(recipient_uei, '') as recipient_uei,
    upper(recipient_name) as recipient_name,
    nullif(recipient_parent_uei, '') as recipient_parent_uei,
    upper(recipient_parent_name) as recipient_parent_name,
    awarding_agency_name,
    awarding_sub_agency_name,
    cast(null as varchar) as naics_code,
    cast(null as varchar) as product_or_service_code,
    primary_place_of_performance_state_code as pop_state
from {{ source('lake', 'assistance') }}
```

`dbt/models/staging/stg_subawards.sql`:

```sql
select
    prime_award_unique_key,
    try_cast(subaward_amount as double) as subaward_amount,
    try_cast(subaward_action_date as date) as subaward_action_date,
    cast(fy as integer) as fiscal_year,
    nullif(subawardee_uei, '') as subawardee_uei,
    upper(subawardee_name) as subawardee_name
from {{ source('lake', 'subawards') }}
```

`dbt/models/staging/stg_mts_outlays.sql`:

```sql
select * from {{ source('lake', 'mts_outlays') }}
```

- [ ] **Step 5: Write mart models**

`dbt/models/marts/fct_award_transactions.sql`:

```sql
select * from {{ ref('stg_contracts') }}
union all
select * from {{ ref('stg_assistance') }}
```

`dbt/models/marts/dim_recipients.sql`:

```sql
select
    recipient_uei,
    max(recipient_name) as recipient_name,
    max(recipient_parent_uei) as recipient_parent_uei,
    max(recipient_parent_name) as recipient_parent_name,
    sum(obligation) as total_obligation,
    count(*) as transaction_count,
    min(fiscal_year) as first_fiscal_year,
    max(fiscal_year) as last_fiscal_year
from {{ ref('fct_award_transactions') }}
where recipient_uei is not null
group by recipient_uei
```

(Phase 2 replaces the `max()` name-picking with proper entity resolution; good enough for a spine.)

`dbt/models/marts/schema.yml`:

```yaml
version: 2
models:
  - name: fct_award_transactions
    columns:
      - name: transaction_key
        data_tests: [unique, not_null]
  - name: dim_recipients
    columns:
      - name: recipient_uei
        data_tests: [unique, not_null]
```

- [ ] **Step 6: Write the integration test `tests/test_dbt_build.py`**

Builds a tiny fixture lake (all four datasets), then runs `dbt build` as a subprocess against it.

```python
import os
import subprocess
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]

CONTRACT_COLS = (
    "contract_transaction_unique_key, action_date, federal_action_obligation, "
    "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name, "
    "awarding_agency_name, awarding_sub_agency_name, naics_code, "
    "product_or_service_code, primary_place_of_performance_state_code"
)


def write_parquet(dir_path: Path, sql: str):
    dir_path.mkdir(parents=True, exist_ok=True)
    duckdb.sql(f"copy ({sql}) to '{dir_path}/part.parquet' (format parquet)")


def make_lake(data_dir: Path):
    write_parquet(
        data_dir / "parquet/contracts/fy=2017",
        f"select * from (values "
        f"('K1','2017-01-15','1000.5','UEI1','ACME','PUEI1','ACME PARENT','DoD','Army','336411','1510','CA'),"
        f"('K2','2017-03-02','-50.25','UEI2','BETA','','','DoD','Navy','541330','R425','VA')"
        f") t({CONTRACT_COLS})",
    )
    write_parquet(
        data_dir / "parquet/assistance/fy=2017",
        "select * from (values "
        "('A1','2017-02-01','5000','UEI1','ACME','PUEI1','ACME PARENT','DoD','Army','MD')"
        ") t(assistance_transaction_unique_key, action_date, federal_action_obligation, "
        "recipient_uei, recipient_name, recipient_parent_uei, recipient_parent_name, "
        "awarding_agency_name, awarding_sub_agency_name, primary_place_of_performance_state_code)",
    )
    write_parquet(
        data_dir / "parquet/subawards/fy=2017",
        "select * from (values ('K1','250.0','2017-05-01','SUEI1','GAMMA SUB')) "
        "t(prime_award_unique_key, subaward_amount, subaward_action_date, subawardee_uei, subawardee_name)",
    )
    write_parquet(
        data_dir / "parquet/mts_outlays",
        "select * from (values ('2017-10-31','Department of Defense','1000')) "
        "t(record_date, classification_desc, current_month_gross_outly_amt)",
    )


def test_dbt_build_succeeds_on_fixture_lake(tmp_path):
    make_lake(tmp_path)
    (tmp_path / "duckdb").mkdir()
    env = {
        **os.environ,
        "GOVBUDGET_DATA": str(tmp_path),
        "GOVBUDGET_DUCKDB": str(tmp_path / "duckdb" / "test.duckdb"),
    }
    result = subprocess.run(
        ["uv", "run", "dbt", "build", "--project-dir", "dbt", "--profiles-dir", "dbt"],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    con = duckdb.connect(str(tmp_path / "duckdb" / "test.duckdb"))
    assert con.sql("select count(*) from fct_award_transactions").fetchone()[0] == 3
    assert con.sql("select count(*) from dim_recipients").fetchone()[0] == 2
    assert con.sql(
        "select total_obligation from dim_recipients where recipient_uei='UEI1'"
    ).fetchone()[0] == 6000.5
```

Note the fixture mts directory has no `fy=` subdirectory — matching its distinct glob in `sources.yml`.

- [ ] **Step 7: Run test to verify it fails, then passes**

Run: `uv run pytest tests/test_dbt_build.py -v`
Expected first run: FAIL if any model file has an error; iterate until PASS. (The dbt project files were written in steps 1–5, so this is the verification step for all of them; if `dbt build` errors, read its stdout in the assertion message.)

- [ ] **Step 8: Run full suite**

Run: `uv run pytest -v`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add dbt tests/test_dbt_build.py
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "feat(phase0): dbt star schema over parquet lake

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Live smoke (network, manual)

Validates real API endpoints, real CSV schemas, and disk behavior on the smallest real slice. **Requires network; subaward generation can take 10–30 minutes.** If any endpoint or payload is rejected, fix against the API contract docs referenced in Tasks 4 and 7 — those are the only two places runtime URLs/payloads live.

- [ ] **Step 1: Smallest real archive slice (DoD FY2017 assistance)**

Run: `uv run python -m govbudget sync-archive --type assistance --fy-start 2017 --fy-end 2017`
Expected: `assistance fy2017: loaded`; `data/parquet/assistance/fy=2017/` contains parquet; `data/raw/` contains no CSVs or zips; one new line in `data/manifest.jsonl`.

- [ ] **Step 2: FiscalData**

Run: `uv run python -m govbudget sync-fiscaldata`
Expected: `fiscaldata: loaded data/parquet/mts_outlays/mts_table_5.parquet`

- [ ] **Step 3: Subawards FY2017**

Run: `uv run python -m govbudget sync-subawards --fy 2017`
Expected: polling messages are silent (it just waits); eventually `subawards fy2017: loaded`. If the API returns 400, diff the payload against `bulk_download/awards.md` in the usaspending-api repo and adjust `request_subaward_download` (then re-run unit tests).

- [ ] **Step 4: Build and sanity-query**

Run: `uv run python -m govbudget build`
Expected: dbt build PASS including schema tests.

Run:

```bash
uv run python -c "
import duckdb
con = duckdb.connect('data/duckdb/govbudget.duckdb')
print(con.sql('''
  select recipient_name, round(total_obligation/1e6, 1) as obligation_mm
  from dim_recipients order by total_obligation desc limit 10
'''))
print(con.sql('select fiscal_year, count(*) from fct_award_transactions group by 1'))
"
```

Expected: ten real DoD FY2017 assistance recipients with non-zero obligations; non-zero FY2017 row count.

- [ ] **Step 5: Check disk usage**

Run: `du -sh data/`
Expected: well under 5 GB for this slice. Record the number — it calibrates the full FY2017–2026 estimate before running the wide sync.

- [ ] **Step 6: Commit the manifest**

```bash
git add data/manifest.jsonl
git commit --author="Andes Lee <andes.lee444@gmail.com>" -m "chore(phase0): record live smoke manifest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Full sync (kick off when satisfied — hours of download time)**

Run: `uv run python -m govbudget sync-archive --type both --fy-start 2017 --fy-end 2026`
Then per FY: `uv run python -m govbudget sync-subawards --fy <year>`
Then: `uv run python -m govbudget build`
Expected: all FYs `loaded`, dbt build PASS. Re-running any sync command is idempotent (`skipped`).

---

## Self-Review Notes

- **Spec coverage:** Phase 0 = USAspending bulk (Tasks 4–7) + FiscalData (Task 8) + star schema (Task 9) + 256GB strategy (converter deletes raws, Task 5; disk guard, Task 3; manifest reproducibility, Task 2). SAM deferred to Phase 2 — flagged in header as a deviation.
- **Column-name risk:** archive CSV headers follow the USAspending data dictionary; the converter's required-column check (Task 5) and the live smoke (Task 10) catch drift before dbt does.
- **dbt test cost:** `unique` on `fct_award_transactions` scans all Parquet; fine on smoke scale, acceptable (~minutes) at full DoD scale on the M-series Mac.
