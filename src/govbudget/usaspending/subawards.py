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
