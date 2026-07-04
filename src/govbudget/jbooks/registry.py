import re
from urllib.parse import unquote, urljoin

import httpx
import psycopg
from selectolax.parser import HTMLParser

ROLLUP_NAMES = {"r1_display.xlsx", "p1_display.xlsx", "p1r_display.xlsx"}
# Word-bounded exhibit tokens (anywhere in the name). PROCUREMENT is the
# PB2017/PB2018-era full-word spelling of PROC.
FAMILY = {"RDTE": "rdte", "PROC": "procurement", "PROCUREMENT": "procurement"}
# Tokens that are structural, not part of the org name. Built from observed
# real filenames across PB2017–PB2026: Vol1/VOL2B/Vol_3A volume markers,
# PB/PB26/FY19PB cycle markers, years/dates/account codes (0400D), version
# suffixes (v2, FINAL), consolidated-volume phrasing (DAs, of, Exhibits,
# BA1), and JustificationBook in its camel-case, split, MJB, and Master
# variants. The U marker is the books' classification stamp.
_NOISE_TOKEN = re.compile(
    r"(?i)^(vol\w*|pb\d*|fy\d+\w*|\d+[a-z]?|v\d+|ba\d+|master|book|amended"
    r"|base|oco|of|u|das|final|exhibits?|mjb|om|milcon"
    r"|(master)?justification(book)?)$"
)
_TOKEN_SPLIT = re.compile(r"[_\-\s]+")
# Leading numeric index ("01_", "5_", "22-"): on every observed edition these
# are the redundant copy — per-agency duplicates of the consolidated volumes
# (PB2019/PB2020) or consolidated duplicates of the per-agency set (PB2017).
_NUMERIC_INDEX = re.compile(r"^\d+[_-]")
# Word-bounded tokens that mark a token-bearing name as NOT a master J-book:
# DHP = Defense Health Program O&M volumes (their P-1/R-2 sections carry
# RDTE/Procurement in the name); MULTIYEAR = MYP exhibit summaries.
_EXCLUDED_TOKENS = frozenset({"DHP", "MULTIYEAR"})

# Names that would classify (or look classifiable) but must NOT register —
# each is a duplicate of a book already classified for its edition
# (verified live against the comptroller inventories, Phase 5E Task 4).
EXCLUDED_NAMES = frozenset({
    # PB2018: the standalone DTRA book duplicates the U_RDTE Defense-Wide
    # MJB, whose JustificationBookInfoList already includes DTRA.
    "U_RDTE_MasterJustificationBook_Defense_Threat_Reduction_Agency_PB_2018_1.pdf",
    # PB2025/PB2026 consolidated re-issues of the per-agency books (already
    # unclassified today; pinned here so the token rule never picks them up).
    "PB_2025_PDW_VOL_1.pdf",
    "PB_2026_PDW_VOL_1.pdf",
    "PB_2026_RDTE_VOL_5.pdf",
})

# Books whose filenames carry no exhibit token, classified by embedded-XML
# evidence: each PDF's .zzz attachment names its U_RDTE_/U_PROCUREMENT_
# master justification book (downloaded + inspected live, Phase 5E Task 4).
# The PB2018 per-agency books listed here are exactly the ones absent from
# that edition's consolidated Defense-Wide volumes.
EVIDENCE_NAMES = {
    "PB17_OSD_0400D_Master_J-Book_Final.pdf": ("rdte", "OSD"),
    "DARPA_0400D_FY18PB_FINAL.pdf": ("rdte", "DARPA"),
    "OSD_0400_PB_18_Justification_Book_Final.pdf": ("rdte", "OSD"),
    "CBDP_0400D_FY18_PB_FINAL.pdf": ("rdte", "CBDP"),
    # [sic] 'JusticificationBook' — misnamed on the site; embeds
    # U_PROCUREMENT_MasterJustificationBook_Missile_Defense_Agency_PB_2018.
    "U_MasterJusticificationBook_Missile_Defense_Agency_PB_2018_Vol2a_Vol2b.pdf":
        ("procurement", "Missile_Defense_Agency"),
}

# --------------------------------------------------------------------------
# Phase 5G — Navy FY2026 service J-books.
#
# Navy publishes its budget on secnav.navy.mil/fmc/fmb by APPROPRIATION CODE
# (RDTEN, APN, OPN, WPN, SCN, PMC, …), not the DoD RDTE_/PROC_ convention, so
# the word-bounded token rule below returns None for every Navy filename
# (probe evidence: docs/superpowers/reviews/5g-probe/classifier-verdicts.txt).
# The fix mirrors EVIDENCE_NAMES exactly: an explicit filename -> (family, org)
# allowlist. The org is the workbook code 'N' (probe confirmed A/N/F are the
# display-workbook organization codes and 'N' matches budget_lines.organization
# directly — no ORG_ALIASES entry is needed).
#
# Only R&D and procurement JUSTIFICATION books belong here. The appropriation
# glossary (verified against the SECNAV FMB acronyms databook, live 2026-07-04):
#   RDTEN = Research, Development, Test & Evaluation, Navy      -> rdte
#   APN   = Aircraft Procurement, Navy                          -> procurement
#   WPN   = Weapons Procurement, Navy                           -> procurement
#   SCN   = Shipbuilding & Conversion, Navy                     -> procurement
#   OPN   = Other Procurement, Navy                             -> procurement
#   PMC   = Procurement, Marine Corps                           -> procurement
#   PANMC = Procurement of Ammunition, Navy & Marine Corps      -> procurement
NAVY_NAMES: dict[str, tuple[str, str]] = {
    # RDT&E, Navy — five PDFs split by budget activity. Each BA-split PDF
    # embeds the SAME full 252-PE master book (probe sample-extraction.md), so
    # only ONE registers per family; the RDTEN dedup rule (service_fetch.py)
    # selects the lowest-BA volume. Classification is per-file; dedup is a
    # separate registration-time step.
    "RDTEN_BA1-3_Book.pdf": ("rdte", "N"),
    "RDTEN_BA4_Book.pdf": ("rdte", "N"),
    "RDTEN_BA5_Book.pdf": ("rdte", "N"),
    "RDTEN_BA6_Book.pdf": ("rdte", "N"),
    "RDTEN_BA7-8_Book.pdf": ("rdte", "N"),
    # Aircraft Procurement, Navy (three BA-split volumes).
    "APN_BA1-4_Book.pdf": ("procurement", "N"),
    "APN_BA5_Book.pdf": ("procurement", "N"),
    "APN_BA6-7_Book.pdf": ("procurement", "N"),
    # Weapons / Shipbuilding & Conversion.
    "WPN_Book.pdf": ("procurement", "N"),
    "SCN_Book.pdf": ("procurement", "N"),
    # Other Procurement, Navy (five BA-split volumes).
    "OPN_BA1_Book.pdf": ("procurement", "N"),
    "OPN_BA2_Book.pdf": ("procurement", "N"),
    "OPN_BA3_Book.pdf": ("procurement", "N"),
    "OPN_BA4_Book.pdf": ("procurement", "N"),
    "OPN_BA5-8_Book.pdf": ("procurement", "N"),
    # Marine Corps procurement + Navy/Marine Corps ammunition.
    "PMC_Book.pdf": ("procurement", "N"),
    "PANMC_Book.pdf": ("procurement", "N"),
}

# Navy inventory filenames that are NOT justification books and must never
# register (recorded in edition_manifest under service_2026, rule
# 'non-justification-appropriation'). Each maps to a one-line reason so the
# exclusion is self-documenting (5E manifest exclusions convention).
NAVY_EXCLUSIONS: dict[str, str] = {
    # Operation & Maintenance (Navy / Navy Reserve / Marine Corps / MC Reserve).
    "OMN_Book.pdf": "Operation & Maintenance, Navy — not a justification book",
    "OMN_Vol2_Book.pdf": "Operation & Maintenance, Navy vol.2 — not a justification book",
    "OMNR_Book.pdf": "Operation & Maintenance, Navy Reserve — not a justification book",
    "OMMC_Book.pdf": "Operation & Maintenance, Marine Corps — not a justification book",
    "OMMC_Vol2_Book.pdf": "Operation & Maintenance, Marine Corps vol.2 — not a justification book",
    "OMMCR_Book.pdf": "Operation & Maintenance, Marine Corps Reserve — not a justification book",
    # Military / Reserve Personnel.
    "MPN_Book.pdf": "Military Personnel, Navy — not R/D or procurement",
    "MPMC_Book.pdf": "Military Personnel, Marine Corps — not R/D or procurement",
    "MCNR_Book.pdf": "Military Personnel, Marine Corps Reserve — not R/D or procurement",
    "RPN_Book.pdf": "Reserve Personnel, Navy — not R/D or procurement",
    "RPMC_Book.pdf": "Reserve Personnel, Marine Corps — not R/D or procurement",
    # Military Construction / BRAC / working capital fund.
    "MCON_Book.pdf": "Military Construction, Navy — not R/D or procurement",
    "BRAC_Book.pdf": "Base Realignment & Closure — not R/D or procurement",
    "NWCF_Book.pdf": "Navy Working Capital Fund — revolving fund, not a justification book",
    # Overview / summary / press / supplemental — no exhibit-line detail.
    "Highlights_Book.pdf": "DON budget highlights — overview volume, no R-2/P-40 detail",
    "DON_Budget_Card.pdf": "DON budget card — one-page summary, no detail",
    "DON_Press_Brief.pdf": "DON press brief — summary, no detail",
    "The_Bottom_Line.pdf": "DON 'The Bottom Line' — overview summary, no detail",
    "Supp_Book.pdf": "Supplemental request — not a base R/D or procurement justification book",
}

# Evidence-classified books whose FILENAME is ambiguous across index paths:
# PB2023 publishes tokenless '{ORG}_PB2023.pdf' twins under BOTH
# 02_Procurement/ and 03_RDT_and_E/, so the name alone cannot classify.
# Keyed on the last two URL path segments. The two entries below are the
# only PB2023 per-agency books NOT duplicated by the consolidated volumes:
# the loaded edition had ZERO detail rows for all 104 OSD and all 8 CBDP
# R-1 PEs until these load (adversarial review Finding B). Embedded-XML
# evidence (downloaded + inspected live, 2026-07-03):
#   03_RDT_and_E/OSD_PB2023.pdf  embeds U_RDTE_MJB_2204221117XAYF_OSD_PB_2023
#     → 104 ProgramElements, BudgetYear 2023;
#   03_RDT_and_E/CBDP_PB2023.pdf embeds U_RDTE_MJB_2204211718XAYF_CBDP_PB_2023
#     → 8 ProgramElements, BudgetYear 2023.
# Their 02_Procurement/ twins embed U_PROCUREMENT_MJB books whose line items
# are already carried by PROC_MJB_DW_Vol1_PB_2023 — duplicates, recorded in
# the edition manifest exclusions, never registered.
EVIDENCE_PATHS = {
    "03_RDT_and_E/OSD_PB2023.pdf": ("rdte", "OSD"),
    "03_RDT_and_E/CBDP_PB2023.pdf": ("rdte", "CBDP"),
}


def _classify_by_path(url: str) -> tuple[str, str] | None:
    """EVIDENCE_PATHS lookup on the URL's last two (unquoted) segments."""
    tail = "/".join(unquote(url).rsplit("/", 2)[-2:])
    return EVIDENCE_PATHS.get(tail)


def _classify_jbook(name: str) -> tuple[str, str] | None:
    """Classify a J-book PDF filename -> (exhibit_family, org), or None.

    A word-bounded exhibit token (RDTE / PROC / PROCUREMENT) anywhere in the
    name classifies, with guards for the known non-J-book token bearers.
    Handles every naming convention observed on the comptroller site:

    modern       RDTE_Vol1_DARPA_MasterJustificationBook_PB_2026.pdf
    short        RDTE_CBDP_PB_2026.pdf
    full-word    PROCUREMENT_MasterJustificationBook_Defense_Logistics_Agency_PB_2017.pdf
    org-first    MDA_RDTE_MasterJustificationBook_Missile_Defense_Agency_PB_2017_1.pdf
    U-prefixed   U_RDTE_MasterJustificationBook_Defense-Wide_PB_2018_20170524.pdf
    volume-era   RDTE_DAs_Vol_3A_of_5_OSD_FY19PB-RDTE_Exhibits_BA1-3.pdf
    misnamed     ROC_Vol1_DW_PROC_PB22_Justification_Book_Final.pdf (truncated PROC)

    The org is the noise-stripped tokens BEFORE the exhibit token when any
    survive (org-first names), else the tokens after it.
    """
    name = unquote(name)
    if name in EVIDENCE_NAMES:
        return EVIDENCE_NAMES[name]
    if name in NAVY_NAMES:
        return NAVY_NAMES[name]
    if name in NAVY_EXCLUSIONS:
        return None
    if not name.lower().endswith(".pdf") or name in EXCLUDED_NAMES:
        return None
    if _NUMERIC_INDEX.match(name):
        return None
    tokens = [t for t in _TOKEN_SPLIT.split(name[: -len(".pdf")]) if t]
    if any(t.upper() in _EXCLUDED_TOKENS for t in tokens):
        return None
    idx = family = None
    if (
        len(tokens) >= 2
        and tokens[0].upper() == "ROC"
        and re.fullmatch(r"(?i)vol\w*", tokens[1])
    ):
        # PB2022 misnames: leading 'ROC_Vol*' is a truncated 'PROC_Vol*'.
        idx, family = 0, "procurement"
    else:
        for i, t in enumerate(tokens):
            if t.upper() in FAMILY:
                idx, family = i, FAMILY[t.upper()]
                break
    if idx is None:
        return None

    def _org(ts: list[str]) -> list[str]:
        return [
            t for t in ts if not _NOISE_TOKEN.match(t) and t.upper() not in FAMILY
        ]

    org_tokens = _org(tokens[:idx]) or _org(tokens[idx + 1:])
    if not org_tokens:
        return None
    return family, "_".join(org_tokens)


def discover_documents(client: httpx.Client, index_url: str, *, fiscal_year: int) -> list[dict]:
    r = client.get(index_url, follow_redirects=True)
    r.raise_for_status()
    docs: list[dict] = []
    seen: set[str] = set()
    for a in HTMLParser(r.text).css("a[href]"):
        href = a.attributes.get("href") or ""
        url = urljoin(index_url, href)
        if url in seen:
            continue
        seen.add(url)
        name = unquote(url.rsplit("/", 1)[-1])
        if name.lower() in ROLLUP_NAMES:
            docs.append({
                "org": "DoD", "exhibit_family": "rollup", "fiscal_year": fiscal_year,
                "title": name, "source_url": url,
            })
            continue
        classified = _classify_by_path(url) or _classify_jbook(name)
        if classified:
            family, org = classified
            docs.append({
                "org": org, "exhibit_family": family,
                "fiscal_year": fiscal_year, "title": name, "source_url": url,
            })
    return docs


def upsert_documents(dsn: str, docs: list[dict]) -> int:
    inserted = 0
    with psycopg.connect(dsn) as con:
        for d in docs:
            cur = con.execute(
                """
                insert into jbook_documents (org, exhibit_family, fiscal_year, title, source_url)
                values (%(org)s, %(exhibit_family)s, %(fiscal_year)s, %(title)s, %(source_url)s)
                on conflict (source_url) do nothing
                """,
                d,
            )
            inserted += cur.rowcount
    return inserted
