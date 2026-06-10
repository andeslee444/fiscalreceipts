import pytest

from govbudget.manifest import (
    ManifestRecord, append_record, has_dataset_fy, has_file, load_records,
)


def make_record(name="FY2017_097_Assistance_Full_20260601.zip"):
    return ManifestRecord(
        dataset="assistance",
        fiscal_year=2017,
        file_name=name,
        source_url="https://files.usaspending.gov/award_data_archive/" + name,
        sha256="ab" * 32,
        bytes=12345,
        downloaded_at="2026-06-10T00:00:00+00:00",
    )


def test_append_and_load_roundtrip(tmp_path):
    path = tmp_path / "manifest.jsonl"
    append_record(path, make_record())
    append_record(path, make_record(name="other.zip"))
    records = load_records(path)
    assert len(records) == 2
    assert records[0].dataset == "assistance"
    assert records[1].file_name == "other.zip"


def test_has_file(tmp_path):
    path = tmp_path / "manifest.jsonl"
    assert not has_file(path, "x.zip")  # missing manifest file is fine
    append_record(path, make_record(name="x.zip"))
    assert has_file(path, "x.zip")
    assert not has_file(path, "y.zip")


def test_load_raises_on_corrupt_line(tmp_path):
    path = tmp_path / "manifest.jsonl"
    append_record(path, make_record())
    with open(path, "a") as f:
        f.write("{not json\n")
    with pytest.raises(ValueError, match="line 2"):
        load_records(path)


def test_has_dataset_fy(tmp_path):
    path = tmp_path / "manifest.jsonl"
    assert not has_dataset_fy(path, "subawards", 2017)
    append_record(path, make_record())  # dataset="assistance", fiscal_year=2017
    assert has_dataset_fy(path, "assistance", 2017)
    assert not has_dataset_fy(path, "assistance", 2018)
    assert not has_dataset_fy(path, "subawards", 2017)
