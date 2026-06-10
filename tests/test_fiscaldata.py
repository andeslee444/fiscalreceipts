import duckdb
import httpx
import pytest

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


def test_fetch_all_pages_raises_on_missing_meta():
    def handler(request):
        return httpx.Response(200, json={"data": []})

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://api.fiscaldata.treasury.gov/services/api/fiscal_service",
    )
    with client, pytest.raises(ValueError, match="total-pages"):
        fetch_all_pages(client, "/v1/accounting/mts/mts_table_5", {})


def test_sync_manifest_source_url_has_no_double_slash(tmp_path):
    from govbudget.manifest import load_records

    manifest = tmp_path / "manifest.jsonl"
    with make_client() as client:
        sync_mts_outlays(
            client, parquet_dir=tmp_path / "parquet",
            raw_dir=tmp_path / "raw", manifest_path=manifest, fy_start=2017,
        )
    url = load_records(manifest)[0].source_url
    assert "//v1" not in url
    assert url.endswith("/v1/accounting/mts/mts_table_5")
