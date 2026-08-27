"""GAO program-tier ingestion + crosswalk (ROADMAP #30).

The fixtures below are verbatim extracts of the real PDF's extracted text,
including its defects: the kerning break in "MDAP Incremen t", the image
credit that lands INSIDE GAO's paragraph, and the heading that wraps onto a
second line.  Each of those cost a parse when it was not handled, so each has
a test that fails if the handling is removed.
"""
from __future__ import annotations

import csv
from pathlib import Path

from govbudget.oversight import gao_programs as G
from govbudget.oversight import gao_xwalk as X

EDITION = G.EDITIONS[0]

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED = REPO_ROOT / "data-seeds" / "gao_program_xwalk.csv"

FOOTER = (
    "Page 79 U.S. Government Accountability Office GAO-25-107569 "
    "Weapon Systems Annual Assessment"
)

SENTINEL_PAGE = (
    "Air Force Program Type: MDAP Common Name: Sentinel\n"
    "LGM-35A Sentinel\n"
    "The Air Force's Sentinel, formerly the Ground Based Strategic Deterrent,\n"
    "is intended to replace the Minuteman III intercontinental ballistic\n"
    "missile system.\n"
    "Source: U.S. Air Force. | GAO-25-107569\n"
    "Program Performance fiscal year 2025 dollars in millions\n"
    + FOOTER
)


def _pages(*texts: str) -> list[str]:
    return list(texts)


def test_parses_the_banner_heading_and_gao_paragraph():
    (a,) = G.parse_edition_pages(_pages(SENTINEL_PAGE), EDITION)
    assert a.service == "Air Force"
    assert a.assessment_type == "MDAP"
    assert a.common_name == "Sentinel"
    assert a.program_name == "LGM-35A Sentinel"
    assert a.report_page == 79
    assert a.description.startswith("The Air Force's Sentinel, formerly")
    assert a.description.endswith("missile system.")
    # The chart caption must not survive into a verbatim quote.
    assert "dollars in millions" not in a.description


def test_kerning_break_in_the_assessment_type_still_parses():
    """"MDAP Incremen t" is what the real PDF emits on two Navy spreads."""
    page = (
        "Navy Program Type: MDAP Incremen t Common Name: DDG 51 Flight III\n"
        "DDG 51 Arleigh Burke Class Destroyer, Flight III (DDG 51 Flight III)\n"
        "The Navy's DDG 51 Flight III destroyers are multimission ships "
        "designed to operate against air, surface, and underwater threats.\n"
        "Source: U.S. Navy. | GAO-25-107569\n"
        "Page 123 U.S. Govern ment Accountability Office GAO-25-107569 "
        "Weapon Systems Annual Assessment"
    )
    (a,) = G.parse_edition_pages(_pages(page), EDITION)
    assert a.assessment_type == "MDAP Increment"
    assert a.report_page == 123


def test_image_credit_inside_the_paragraph_is_excised_not_cut_at():
    """On 13 spreads the credit lands mid-sentence; cutting there truncates."""
    page = (
        "Air Force Program Type: MTA Common Name: HACM\n"
        "Hypersonic Attack Cruise Missile (HACM)\n"
        "The Air Force's HACM program is developing a conventional, "
        "air-launched hypersonic missile that can be carried by an F-15 "
        "tactical aircraft prior to making\n"
        "Source: Raytheon. | GAO-25-107569 a full production decision. "
        "We assessed the rapid prototyping effort.\n"
        "Estimated Middle Tier of Acquisition Cost and Quantities fiscal "
        "year 2025 dollars in millions\n" + FOOTER
    )
    (a,) = G.parse_edition_pages(_pages(page), EDITION)
    assert a.description.endswith("We assessed the rapid prototyping effort.")
    assert "Raytheon" not in a.description
    assert not G.DESC_RESIDUE_RE.search(a.description)


def test_heading_that_wraps_is_not_swallowed_into_the_quote():
    page = (
        "Air Force Program Type: MDAP Common Name: F-15 EPAWSS\n"
        "F-15 Eagle Passive Active Warning Survivability System\n"
        "(F-15 EPAWSS)\n"
        "The Air Force's F-15 EPAWSS program plans to modernize the onboard "
        "F-15 electronic warfare system used to detect and identify threat "
        "radar signals, employ countermeasures, and jam enemy radars.\n"
        "Source: U.S. Air Force. | GAO-25-107569\n" + FOOTER
    )
    (a,) = G.parse_edition_pages(_pages(page), EDITION)
    assert a.program_name == (
        "F-15 Eagle Passive Active Warning Survivability System (F-15 EPAWSS)"
    )
    assert a.description.startswith("The Air Force's F-15 EPAWSS program")


def test_related_products_parse_title_product_and_date():
    text = (
        "F-35 Joint Strike Fighter: Program Continues to Encounter Production "
        "Issues and Modernization Delays. GAO-24-106909. Washington, D.C.: "
        "May 16, 2024.\n"
        "Navy Frigate: Unstable Design Has Stalled Construction and "
        "Compromised Delivery Schedules. GAO-24-106546. Washington, D.C.: "
        "May 29, 2024."
    )
    rows = G.parse_related_products(text, EDITION)
    assert [r.product_number for r in rows] == ["GAO-24-106909", "GAO-24-106546"]
    f35 = rows[0]
    assert f35.released == "2024-05-16"
    assert f35.report_url == "https://www.gao.gov/products/gao-24-106909"
    assert f35.program_name == "F-35 Joint Strike Fighter"


# ── the crosswalk's rules ───────────────────────────────────────────────────

PROGRAMS = [
    {"slug": "0207146F", "org": "F", "title": "F-15EX"},
    {"slug": "0207171F", "org": "F", "title": "F-15 EPAWSS"},
    {"slug": "0125WK5057", "org": "A", "title": "Sentinel Mods"},
    {"slug": "1206399SF", "org": "F",
     "title": "SSC Enterprise Engineering & Integration"},
    {"slug": "0605220N", "org": "N", "title": "Ship to Shore Connector (SSC)"},
    {"slug": "2611C72100", "org": "A", "title": "LONG-RANGE HYPERSONIC WEAPON"},
]


def _assessment(**kw):
    base = dict(
        kind="assessment", product_number="GAO-25-107569",
        common_name="", program_name="", service="Air Force",
    )
    base.update(kw)
    return base


def test_rule_a_matches_a_contiguous_token_run_only():
    """"F-15EX" is f|15|ex — it must not reach "F-15 EPAWSS"."""
    hits = X.generate_candidates(
        [_assessment(common_name="F-15EX", program_name="F-15EX")], PROGRAMS
    )
    assert [c.slug for c in hits] == ["0207146F"]


def test_rule_b_reaches_a_title_the_gao_name_contains():
    hits = X.generate_candidates(
        [_assessment(
            common_name="LRHW",
            program_name="Long Range Hypersonic Weapon System (LRHW)",
            service="Army",
        )],
        PROGRAMS,
    )
    assert [(c.slug, c.rule) for c in hits] == [("2611C72100", "B")]


def test_service_disagreement_blocks_the_sentinel_mods_defect():
    """GAO's Air Force LGM-35A Sentinel must not reach an Army procurement line."""
    rows = [_assessment(
        common_name="Sentinel", program_name="LGM-35A Sentinel (Sentinel)",
        service="Air Force",
    )]
    assert X.generate_candidates(rows, PROGRAMS) == []
    # …and the ONLY thing stopping it is the service rule.
    orig = dict(X.SERVICE_ORGS)
    X.SERVICE_ORGS["Air Force"] = ("F", "A")
    try:
        assert [c.slug for c in X.generate_candidates(rows, PROGRAMS)] == [
            "0125WK5057"
        ]
    finally:
        X.SERVICE_ORGS.clear()
        X.SERVICE_ORGS.update(orig)


def test_service_disagreement_blocks_ssc_the_space_systems_command():
    """Navy "Ship to Shore Connector" vs Space Force's SSC — same three letters."""
    hits = X.generate_candidates(
        [_assessment(
            common_name="SSC",
            program_name="Ship to Shore Connector Amphibious Craft (SSC)",
            service="Navy",
        )],
        PROGRAMS,
    )
    assert [c.slug for c in hits] == ["0605220N"]


def test_related_products_match_on_a_model_designator_only():
    rows = [{
        "kind": "related_product", "product_number": "GAO-22-104530",
        "common_name": "", "program_name": "KC-46 Tanker", "service": "",
    }]
    assert X.generate_candidates(rows, PROGRAMS) == []
    # "F-15" is a designator, and it reaches every F-15 line — including
    # F-15EX, which is why related products are adjudicated one by one.
    rows[0]["program_name"] = "F-15 Aircraft"
    assert sorted(c.slug for c in X.generate_candidates(rows, PROGRAMS)) == [
        "0207146F", "0207171F"
    ]


# ── the ratified seed itself ────────────────────────────────────────────────


def test_every_seed_row_carries_a_verdict_and_a_reason():
    ratified = X.load_ratified(SEED)          # raises on a missing verdict
    assert ratified, "the ratified seed must not be empty"
    with open(SEED, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert [*rows[0]] == list(X.SEED_FIELDS)
    for r in rows:
        assert r["curator_notes"].strip(), (
            f"{r['gao_program']} -> {r['slug']} ships a verdict with no reason"
        )
        assert r["slug"].strip() and r["product_number"].strip()


def test_seed_keys_are_unique():
    with open(SEED, newline="", encoding="utf-8") as f:
        keys = [
            (r["product_number"], r["gao_program"], r["slug"])
            for r in csv.DictReader(f)
        ]
    assert len(keys) == len(set(keys))
