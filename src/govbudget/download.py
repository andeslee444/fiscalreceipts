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
        except OSError:
            # Disk-level failure (e.g. ENOSPC mid-write): clean up the partial
            # file to free space, but don't retry a doomed write.
            tmp.unlink(missing_ok=True)
            raise
        except httpx.HTTPError:
            tmp.unlink(missing_ok=True)
            if attempt == max_retries:
                raise
            time.sleep(backoff_base**attempt)
    raise AssertionError("unreachable")
