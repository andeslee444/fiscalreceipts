"""TDD golden tests for canonical_agency()."""

import pytest

from govbudget.agency_codes import canonical_agency


# ---------------------------------------------------------------------------
# Slug mappings from paymentaccuracy.gov
# ---------------------------------------------------------------------------

def test_dow_maps_to_dod():
    assert canonical_agency("dow") == "DOD"


def test_dod_maps_to_dod():
    assert canonical_agency("dod") == "DOD"


def test_hhs_maps_to_hhs():
    assert canonical_agency("hhs") == "HHS"


def test_ssa_maps_to_ssa():
    assert canonical_agency("ssa") == "SSA"


def test_va_maps_to_va():
    assert canonical_agency("va") == "VA"


# ---------------------------------------------------------------------------
# Treasury agency codes
# ---------------------------------------------------------------------------

def test_097_maps_to_dod():
    assert canonical_agency("097") == "DOD"


def test_021_maps_to_dod():
    assert canonical_agency("021") == "DOD"


# ---------------------------------------------------------------------------
# Already-canonical uppercase passes through
# ---------------------------------------------------------------------------

def test_hhs_uppercase_passthrough():
    assert canonical_agency("HHS") == "HHS"


def test_dod_uppercase_passthrough():
    assert canonical_agency("DOD") == "DOD"


# ---------------------------------------------------------------------------
# Unknown codes uppercased as passthrough
# ---------------------------------------------------------------------------

def test_unknown_code_uppercased():
    assert canonical_agency("xyz_agency") == "XYZ_AGENCY"


def test_unknown_short_code_uppercased():
    assert canonical_agency("abc") == "ABC"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_none_returns_none():
    assert canonical_agency(None) is None


def test_empty_string_returns_none():
    assert canonical_agency("") is None


def test_whitespace_only_returns_none():
    assert canonical_agency("   ") is None


def test_whitespace_stripped():
    assert canonical_agency("  dow  ") == "DOD"


# ---------------------------------------------------------------------------
# Mixed-case lookup
# ---------------------------------------------------------------------------

def test_uppercase_dow_maps_to_dod():
    assert canonical_agency("DOW") == "DOD"


def test_mixed_case_hhs():
    assert canonical_agency("Hhs") == "HHS"


# ---------------------------------------------------------------------------
# IRS maps to TREASURY
# ---------------------------------------------------------------------------

def test_irs_maps_to_treasury():
    assert canonical_agency("irs") == "TREASURY"
