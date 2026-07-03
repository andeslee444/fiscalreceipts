"""Era procurement pe_bli namespacing (adversarial review Finding D, 5E).

Covers:
  - era_procurement_key format / strictness; p40_agency_org strictness;
    era_key_anchor round-trip and non-era rejections.
  - The permanent collision guard: era-procurement pe_bli space must be
    disjoint from (modern pe_bli space ∪ R-1 PE space) in the LIVE warehouse
    (skip-if-db-unavailable — same posture as the jbooks pg fixtures, but
    read-only against the real GOVBUDGET_PG_DSN warehouse).
"""
from __future__ import annotations

import pytest

from govbudget.jbooks.era_keys import (
    era_key_anchor,
    era_procurement_key,
    p40_agency_org,
)


class TestEraProcurementKey:
    def test_key_format(self):
        assert era_procurement_key("0300D", "CBDP", "70") == "0300D-CBDP-L70"

    def test_inputs_are_stripped(self):
        # era workbook 'Line Number' cells are padded ('14 ')
        assert era_procurement_key(" 0300D", "DTRA ", "14 ") == "0300D-DTRA-L14"

    def test_missing_parts_raise(self):
        with pytest.raises(ValueError, match="era_procurement_key"):
            era_procurement_key("0300D", "", "70")
        with pytest.raises(ValueError, match="era_procurement_key"):
            era_procurement_key("", "CBDP", "70")
        with pytest.raises(ValueError, match="era_procurement_key"):
            era_procurement_key("0300D", "CBDP", None)


class TestP40AgencyOrg:
    def test_known_agencies_map_to_workbook_codes(self):
        assert p40_agency_org("Chemical and Biological Defense Program") == "CBDP"
        assert p40_agency_org("Office of the Secretary Of Defense") == "OSD"
        # both live spellings
        assert p40_agency_org("Defense POW MIA Accounting Agency") == "DPAA"
        assert p40_agency_org("Defense POW/MIA Accounting Agency") == "DPAA"
        assert p40_agency_org("Washington Headquarters Service") == "WHS"
        assert p40_agency_org("Washington Headquarters Services") == "WHS"
        # JUON fund rows sit under DEFW in the P-1 display (orgs.py rule)
        assert p40_agency_org("Defense Wide") == "DEFW"
        assert p40_agency_org("Joint Urgent Operational Needs Fund") == "DEFW"

    def test_unknown_agency_raises_loudly(self):
        with pytest.raises(ValueError, match="unmapped era P-40"):
            p40_agency_org("Bureau of Imaginary Programs")
        with pytest.raises(ValueError, match="unmapped era P-40"):
            p40_agency_org(None)


class TestEraKeyAnchor:
    def test_round_trip(self):
        key = era_procurement_key("0300D", "CBDP", "70")
        assert era_key_anchor(key) == "70"
        assert era_key_anchor("2031A-ARMY-L102") == "102"
        # WHS sub-line numbers ('46-1') appear in the era P-1 workbooks
        assert era_key_anchor("0300D-WHS-L46-1") == "46-1"

    def test_non_era_keys_return_none(self):
        # R-1 PE codes, modern BLI codes, bare line numbers, era P-1R codes
        for v in ("0601101E", "7001SA1000", "70", "013005", "0300D", None, ""):
            assert era_key_anchor(v) is None


# ---------------------------------------------------------------------------
# Permanent collision guard against the LIVE warehouse
# ---------------------------------------------------------------------------


def _live_pg():
    import psycopg

    from govbudget import config

    try:
        return psycopg.connect(config.PG_DSN)
    except psycopg.OperationalError as e:  # pragma: no cover
        pytest.skip(f"live warehouse unavailable ({e})")


def test_era_procurement_keyspace_disjoint_from_modern_and_r1():
    """Finding D guard: era-procurement pe_bli ∩ (modern pe_bli ∪ R-1 PE) = ∅.

    Era procurement keys (budget_lines exhibit='P-1' fy<=2023 and
    budget_line_details of era procurement documents) must never collide
    with modern (fy>=2024) pe_bli values or with any edition's R-1 PE codes.
    """
    with _live_pg() as con:
        era = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines"
                " where exhibit='P-1' and fiscal_year<=2023"
            )
        }
        era |= {
            r[0]
            for r in con.execute(
                """
                select distinct d.pe_bli
                from budget_line_details d
                join jbook_documents j on j.id = d.document_id
                where j.exhibit_family='procurement' and j.fiscal_year<=2023
                  and not d.superseded
                """
            )
        }
        modern = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines where fiscal_year>=2024"
            )
        }
        modern |= {
            r[0]
            for r in con.execute(
                """
                select distinct d.pe_bli
                from budget_line_details d
                join jbook_documents j on j.id = d.document_id
                where j.fiscal_year>=2024 and not d.superseded
                """
            )
        }
        r1 = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from budget_lines where exhibit='R-1'"
            )
        }
    if not era:
        pytest.skip("no era procurement rows loaded in this warehouse")
    collisions = era & (modern | r1)
    assert collisions == set(), (
        f"{len(collisions)} era procurement pe_bli values collide with the"
        f" modern/R-1 keyspace: {sorted(collisions)[:10]}"
    )
    # every era P-1 key is namespaced (anchor extracts a line number)
    unkeyed = {k for k in era if era_key_anchor(k) is None}
    assert unkeyed == set(), (
        f"{len(unkeyed)} era procurement pe_bli values are not namespaced"
        f" era keys: {sorted(unkeyed)[:10]}"
    )
