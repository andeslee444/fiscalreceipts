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
