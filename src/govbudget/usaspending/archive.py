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
