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
    assert not (tmp_path / "f.zip.part").exists()


def test_download_recovers_after_midstream_error(tmp_path):
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ReadError("connection lost")
        return httpx.Response(200, content=PAYLOAD)

    dest = tmp_path / "file.zip"
    with make_client(handler) as client:
        sha, n = download_file(
            client, "https://example.test/file.zip", dest, backoff_base=0
        )
    assert dest.read_bytes() == PAYLOAD
    assert len(calls) == 2
    assert not dest.with_suffix(".zip.part").exists()


def test_ensure_free_space_raises_when_insufficient(tmp_path):
    with pytest.raises(DiskSpaceError):
        ensure_free_space(tmp_path, min_free_gb=10**9)  # absurd requirement
    ensure_free_space(tmp_path, min_free_gb=0)  # should not raise


def test_sweep_stale_parts(tmp_path):
    (tmp_path / "a.zip.part").write_bytes(b"x")
    (tmp_path / "b.zip").write_bytes(b"x")
    from govbudget.download import sweep_stale_parts

    assert sweep_stale_parts(tmp_path) == 1
    assert not (tmp_path / "a.zip.part").exists()
    assert (tmp_path / "b.zip").exists()
    assert sweep_stale_parts(tmp_path / "missing") == 0
