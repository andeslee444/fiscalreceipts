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
            import json

            payload = json.loads(request.content)
            assert "subawards" not in payload
            assert payload["filters"]["sub_award_types"] == ["grant", "procurement"]
            assert "prime_award_types" not in payload["filters"]
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
