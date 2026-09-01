"""site_meta.source_freshness — ROADMAP #8.

`config.MANIFEST_PATH` had existed since Phase 1 and the exporter never opened
it. site_meta carried `built_at` — when the SITE was built — and nothing about
when the DATA underneath it was downloaded, so a 2026-08-31 build over a
corpus fetched 2026-06-11 stamped the export date on 39,288 derived citations
and /methodology/ published "Update cadence: monthly" over an 81-day-old
corpus. These tests pin the block that makes the fetch date renderable.
"""

import json

import pytest

from govbudget import export_site
from govbudget.export_site import (
    _DECLARED_CADENCE,
    _FRESHNESS_GROUPS,
    _source_freshness_block,
)


def _write_manifest(tmp_path, records):
    p = tmp_path / "manifest.jsonl"
    p.write_text("".join(json.dumps(r) + "\n" for r in records))
    return p


@pytest.fixture
def manifest_at(tmp_path, monkeypatch):
    """Point config.MANIFEST_PATH at a fixture manifest."""

    def _set(records):
        path = _write_manifest(tmp_path, records)
        from govbudget import config

        monkeypatch.setattr(config, "MANIFEST_PATH", path)
        return path

    return _set


class TestDeclaredCadence:
    def test_every_declared_cadence_is_a_word_the_gate_knows(self):
        """The gate ages `monthly|quarterly|annual|biennial`; None = no claim."""
        allowed = {None, "monthly", "quarterly", "annual", "biennial"}
        for ds, cad in _DECLARED_CADENCE.items():
            assert cad in allowed, f"{ds} declares unknown cadence {cad!r}"

    def test_every_group_member_is_a_declared_dataset(self):
        for group, members in _FRESHNESS_GROUPS.items():
            assert members, f"{group} has no members"
            for m in members:
                assert m in _DECLARED_CADENCE, f"{group} names undeclared {m}"


class TestSourceFreshnessBlock:
    def test_newest_download_wins_per_dataset(self, manifest_at):
        manifest_at([
            {"dataset": "contracts", "file_name": "old.zip",
             "downloaded_at": "2026-01-01T00:00:00+00:00"},
            {"dataset": "contracts", "file_name": "new.zip",
             "downloaded_at": "2026-06-11T11:50:15+00:00"},
        ])
        block = _source_freshness_block()
        ds = block["datasets"]["contracts"]
        assert ds["newest_downloaded_at"] == "2026-06-11T11:50:15+00:00"
        assert ds["newest_file_name"] == "new.zip"
        assert ds["declared_cadence"] == "monthly"
        assert ds["files"] == 2

    def test_group_as_of_is_the_stalest_member(self, manifest_at):
        """One fresh dataset must not vouch for two stale ones."""
        manifest_at([
            {"dataset": "contracts", "file_name": "c.zip",
             "downloaded_at": "2026-06-11T11:50:15+00:00"},
            {"dataset": "assistance", "file_name": "a.zip",
             "downloaded_at": "2026-08-30T00:00:00+00:00"},
            {"dataset": "subawards", "file_name": "s.zip",
             "downloaded_at": "2026-08-31T00:00:00+00:00"},
        ])
        block = _source_freshness_block()
        grp = block["groups"]["usaspending"]
        assert grp["as_of"] == "2026-06-11", "as_of took the newest, not the stalest"
        assert grp["newest_file_name"] == "c.zip"
        assert grp["declared_cadence"] == "monthly"
        assert grp["datasets"] == ["assistance", "contracts", "subawards"]

    def test_undeclared_dataset_raises_rather_than_defaulting(self, manifest_at):
        """A new source is a decision; defaulting makes it silently."""
        manifest_at([
            {"dataset": "contracts", "file_name": "c.zip",
             "downloaded_at": "2026-06-11T11:50:15+00:00"},
            {"dataset": "brand_new_feed", "file_name": "x.zip",
             "downloaded_at": "2026-08-31T00:00:00+00:00"},
        ])
        with pytest.raises(ValueError) as exc:
            _source_freshness_block()
        assert "brand_new_feed" in str(exc.value)
        assert "_DECLARED_CADENCE" in str(exc.value)

    def test_missing_manifest_yields_empty_block_not_a_crash(self, tmp_path, monkeypatch):
        from govbudget import config

        monkeypatch.setattr(config, "MANIFEST_PATH", tmp_path / "nope.jsonl")
        assert _source_freshness_block() == {"datasets": {}, "groups": {}}

    def test_real_manifest_declares_every_dataset_it_holds(self):
        """The shipped manifest must not have outgrown the cadence table."""
        block = _source_freshness_block()
        assert block["datasets"], "the repo manifest produced no datasets"
        for ds in block["datasets"]:
            assert ds in _DECLARED_CADENCE
