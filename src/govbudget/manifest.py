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
