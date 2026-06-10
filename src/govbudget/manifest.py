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
    records = []
    with open(path) as f:
        for lineno, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                records.append(ManifestRecord(**json.loads(line)))
            except (json.JSONDecodeError, TypeError) as e:
                raise ValueError(
                    f"Corrupt manifest line {lineno} in {path}: {e}"
                ) from e
    return records


def has_file(path: Path, file_name: str) -> bool:
    return any(r.file_name == file_name for r in load_records(path))
