"""Era (PB2017–PB2023) procurement pe_bli namespacing.

The era P-1 display workbooks and P-40 XMLs share only the P-1 line number
('1', '10', '16', …) as a join key. Bare line numbers are hazardous as a
global pe_bli: they collide with modern BLI codes, the same string spans
many workbook orgs, and one consolidated Defense-Wide document can carry
the same (account, line) pair for several distinct programs (verified live:
the PB2021 DW book has 0300D P1LineNumber 81 for BOTH the CBDP situational-
awareness line and the SOCOM operational-enhancements line).

era_procurement_key() re-keys BOTH sides (p1_loader era path and the
load_details era P1LineNumber path) to '{account}-{org}-L{line}', e.g.
'0300D-CBDP-L70':

  - deterministic: a pure function of workbook / XML fields plus the pinned
    P40_AGENCY_ORGS map below (every ServiceAgencyName observed across the
    PB2017–PB2023 procurement XMLs, verified live 2026-07-03);
  - stable within an edition: account + workbook org + P-1 line number is
    the era P-1 display's own row identity;
  - human-readable;
  - provably disjoint from the modern BLI space and the R-1 PE space —
    guarded by tests/jbooks/test_era_keys.py against the live warehouse.

Cross-edition identity is intentionally NOT claimed: (account, org, line)
is unstable across editions, so era procurement keys are excluded from
pe_bli-keyed cross-edition diff joins (Task 5 binding in
docs/superpowers/plans/2026-07-03-phase5e-decade-backfill.md).
"""
from __future__ import annotations

import re

# XML ServiceAgencyName → P-1 display workbook org code. Pinned from live
# evidence: every distinct ServiceAgencyName across all PB2017–PB2023
# procurement master J-book XMLs on disk (both spellings of DPAA and WHS
# appear; 'Defense Wide'/'Joint Urgent Operational Needs Fund' are the JUON
# fund account 0303D, which the P-1 display carries under org DEFW — same
# rule as orgs.ORG_ALIASES).
P40_AGENCY_ORGS: dict[str, str] = {
    "Chemical and Biological Defense Program": "CBDP",
    "Defense Contract Audit Agency": "DCAA",
    "Defense Contract Management Agency": "DCMA",
    "Defense Counterintelligence and Security Agency": "DCSA",
    "Defense Information Systems Agency": "DISA",
    "Defense Logistics Agency": "DLA",
    "Defense Media Activity": "DMACT",
    "Defense POW MIA Accounting Agency": "DPAA",
    "Defense POW/MIA Accounting Agency": "DPAA",
    "Defense Security Cooperation Agency": "DSCA",
    "Defense Security Service": "DSS",
    "Defense Threat Reduction Agency": "DTRA",
    "Defense Wide": "DEFW",
    "Department of Defense Education Activity": "DODEA",
    "DoD Human Resources Activity": "DHRA",
    "Joint Urgent Operational Needs Fund": "DEFW",
    "Missile Defense Agency": "MDA",
    "Office of the Secretary Of Defense": "OSD",
    "Space Development Agency": "SDA",
    "The Joint Staff": "TJS",
    "United States Special Operations Command": "SOCOM",
    "Washington Headquarters Service": "WHS",
    "Washington Headquarters Services": "WHS",
}

# Shape of a namespaced era procurement key. Era accounts are 4 digits + a
# service designator letter ('0300D', '2031A'); org codes are the P-1
# display's short codes; the line number is kept verbatim after 'L' —
# including sub-line forms like WHS '46-1' (live PB2017 workbook evidence).
_ERA_KEY_RE = re.compile(r"^(\d{4}[A-Z])-([A-Z]+)-L([0-9][0-9A-Za-z-]*)$")


def era_procurement_key(account: str, org: str, line_number: str) -> str:
    """Namespaced era procurement pe_bli: '{account}-{org}-L{line}'.

    All three parts are required — a missing part would silently degrade
    back to a colliding key, so this raises instead.
    """
    account = (account or "").strip()
    org = (org or "").strip()
    line = (line_number or "").strip()
    if not account or not org or not line:
        raise ValueError(
            "era_procurement_key needs account, org and line_number"
            f" (got account={account!r}, org={org!r}, line_number={line_number!r})"
        )
    return f"{account}-{org}-L{line}"


def p40_agency_org(service_agency: str | None) -> str:
    """Workbook org code for an era P-40 XML ServiceAgencyName.

    Raises on unknown names — an unmapped agency must fail the document load
    loudly (and land in the edition manifest), never mint a junk key.
    """
    org = P40_AGENCY_ORGS.get((service_agency or "").strip())
    if org is None:
        raise ValueError(
            f"unmapped era P-40 ServiceAgencyName: {service_agency!r} —"
            " add it to era_keys.P40_AGENCY_ORGS (verify against the"
            " edition's P-1 display org codes first)"
        )
    return org


def is_era_procurement_key(pe_bli: str | None) -> bool:
    """True when pe_bli is a namespaced era procurement key ('3010F-AF-L1').

    The authoritative membership test for the key space this module MINTS —
    exported so consumers stop re-inventing a `-L\\d+$` regex of their own.

    ROADMAP #28 is the consumer that needed it. An era key is a P-1 DISPLAY
    LINE inside one edition's workbook, not a program identity: the module
    docstring above states outright that "cross-edition identity is
    intentionally NOT claimed", because (account, org, line) is unstable
    across editions. A /program/ page is a cross-edition identity claim by
    construction — one URL, one title, a decade of figures under it — so
    these keys must never become pages, however much money they carry
    (1,214 of them in the shipped warehouse; '3010F-AF-L1' alone sums
    $142.6B across PB2017-PB2023 because the era P-1 loader files an
    account's rollup row under its first line number).
    """
    return bool(pe_bli) and _ERA_KEY_RE.match(pe_bli) is not None


def era_key_anchor(pe_bli: str | None) -> str | None:
    """The page-text anchor for a namespaced era key: its P-1 line number.

    Era PDF pages never print the namespaced key; they print the line number
    (provenance behavior-parity with the pre-re-key '70'-style anchors).
    Returns None for anything that is not an era procurement key.
    """
    if not pe_bli:
        return None
    m = _ERA_KEY_RE.match(pe_bli)
    return m.group(3) if m else None
