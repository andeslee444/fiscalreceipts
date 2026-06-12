import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("GOVBUDGET_DATA", ROOT / "data")).resolve()
RAW_DIR = DATA_DIR / "raw"
PARQUET_DIR = DATA_DIR / "parquet"
DUCKDB_PATH = DATA_DIR / "duckdb" / "govbudget.duckdb"
MANIFEST_PATH = DATA_DIR / "manifest.jsonl"

PG_DSN = os.environ.get("GOVBUDGET_PG_DSN", "postgresql://localhost/govbudget")
RAW_DOCS_DIR = DATA_DIR / "raw_docs"
RESEARCH_DIR = ROOT / "data" / "research"
JBOOK_FY = 2026

# Phase 5B site export
SITE_DIR = DATA_DIR / "site"
# Base URL where sha-named PDFs are hosted (R2). Relative default for local dev.
PDF_BASE_URL = os.environ.get("GOVBUDGET_PDF_BASE_URL", "/pdfs")

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
