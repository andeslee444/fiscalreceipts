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
