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
