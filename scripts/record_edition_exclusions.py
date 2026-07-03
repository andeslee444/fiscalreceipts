"""Regenerate per-edition J-book exclusion records in the edition manifest.

Adversarial review Finding C (Phase 5E): the classifier's exclusions were
code-only; spec honesty rule 3 says gaps live in
data/research/edition_manifest.json. This script derives them from the LIVE
comptroller indexes: every PDF under an edition's master-J-book directories
(02_Procurement / 03_RDT_and_E) that the registry intentionally does NOT
classify gets an {filename, rule, reason} record:

  numeric-index-duplicate — leading numeric index marks the redundant copy
      (PB2017: consolidated volumes duplicating the loaded per-agency set;
       PB2019/PB2020: per-agency books duplicating the loaded consolidated
       volumes);
  evidence-duplicate      — verified duplicate of a loaded book (PB2018
      account-code per-agency books vs the consolidated DW MJBs whose
      JustificationBookInfoList covers them; the PB2023 02_Procurement
      OSD/CBDP twins whose embedded U_PROCUREMENT_MJB line items are carried
      by PROC_MJB_DW_Vol1 — downloaded + inspected 2026-07-03);
  tokenless-undecidable   — '{ORG}_PB20xx.pdf' twins with no exhibit token
      (PB2021–PB2023); verified 2026-07-03 by per-org detail-count queries:
      every such org's R-1 PEs carry detail rows from the loaded Vol1–5
      consolidated sets (PB2023 OSD/CBDP RDT&E were the two exceptions —
      they now LOAD via registry.EVIDENCE_PATHS, Finding B);
  niche-fund              — JIDF (2093D) / JUON (0303D) / DPA (0360D) fund
      books; per-file reasons state whether the consolidated volumes cover
      the fund or a small honest gap remains.

Idempotent: rules are pattern-derived + the pinned OVERRIDES below;
re-running replaces each edition's list wholesale.

Usage: uv run python scripts/record_edition_exclusions.py
"""
from __future__ import annotations

from urllib.parse import unquote, urljoin

import httpx
from selectolax.parser import HTMLParser

from govbudget import config
from govbudget.cli import jbook_index_urls
from govbudget.jbooks.edition_probe import record_exclusions
from govbudget.jbooks.registry import (
    _NUMERIC_INDEX,
    _classify_by_path,
    _classify_jbook,
)

MANIFEST_PATH = config.RESEARCH_DIR / "edition_manifest.json"
JBOOK_DIRS = ("/02_Procurement/", "/03_RDT_and_E/")

# Pinned per-file rules/reasons that pattern derivation cannot know.
OVERRIDES: dict[tuple[int, str], tuple[str, str]] = {
    (2017, "JIDO_PB17_2093D_J-Book_SCOMBFinal_Feb16.pdf"): (
        "niche-fund",
        "JIDF niche-fund book (2093D); no embedded master-book evidence."
        " PB2017's two P-1 2093D lines ($408M) have no detail rows —"
        " small honest gap (no other PB2017 book carries 2093D).",
    ),
    (2018, "DTRA_JIDF_2093D_PB18JBook_Final_18May17.pdf"): (
        "niche-fund",
        "JIDF niche-fund book (2093D); the loaded DW procurement MJB"
        " carries the 2093D line items (verified: PB2018 details cover"
        " 2093D).",
    ),
    (2018, "DPA_0360D_FY18_PB_v2.pdf"): (
        "niche-fund",
        "DPA niche-fund book (0360D); the loaded DW procurement MJB"
        " carries a single consolidated 0360D line item, so item-level DPA"
        " detail beyond it is a small honest gap (1 of PB2018's 2 P-1"
        " 0360D lines has detail rows).",
    ),
    (2018, "JUONS_0303D_PB18J-Book_Final_17May17.pdf"): (
        "niche-fund",
        "JUON niche-fund book (0303D); the loaded DW procurement MJB"
        " carries the 0303D line item.",
    ),
    (2018, "U_RDTE_MasterJustificationBook_Defense_Threat_Reduction_Agency_PB_2018_1.pdf"): (
        "evidence-duplicate",
        "standalone DTRA MJB duplicating the loaded U_RDTE Defense-Wide"
        " MJB, whose JustificationBookInfoList already includes DTRA"
        " (registry.EXCLUDED_NAMES, verified live Task 4).",
    ),
    (2023, "02_Procurement/OSD_PB2023.pdf"): (
        "evidence-duplicate",
        "tokenless twin; embeds U_PROCUREMENT_MJB_2204261444XAYF_OSD_PB_2023"
        " whose line items are carried by the loaded PROC_MJB_DW_Vol1"
        " (downloaded + inspected 2026-07-03). The 03_RDT_and_E twin is NOT"
        " a duplicate and loads via registry.EVIDENCE_PATHS (Finding B).",
    ),
    (2023, "02_Procurement/CBDP_PB2023.pdf"): (
        "evidence-duplicate",
        "tokenless twin; embeds"
        " U_PROCUREMENT_MJB_2204261421XAYF_CBDP_PB_2023 whose line items"
        " are carried by the loaded PROC_MJB_DW_Vol1 (downloaded +"
        " inspected 2026-07-03). The 03_RDT_and_E twin is NOT a duplicate"
        " and loads via registry.EVIDENCE_PATHS (Finding B).",
    ),
}

NUMERIC_REASONS = {
    2017: "leading numeric index: consolidated Defense-Wide volume"
          " duplicating the loaded per-agency book set",
    2019: "leading numeric index: per-agency book duplicating the loaded"
          " consolidated volumes",
    2020: "leading numeric index: per-agency book duplicating the loaded"
          " consolidated volumes",
}

EVIDENCE_DUP_2018 = (
    "per-agency account-code book; its org's lines are carried by the"
    " loaded consolidated Defense-Wide MJB (embedded-XML evidence, Task 4:"
    " EVIDENCE_NAMES pins exactly the per-agency books NOT covered)"
)

TOKENLESS_REASON = (
    "tokenless '{ORG}_PB20xx' twin of the loaded consolidated volumes;"
    " verified 2026-07-03: the org's R-1 PEs / P-1 lines carry detail rows"
    " from the Vol1–5 sets"
)


def derive_exclusions(fy: int, names: list[tuple[str, str]]) -> list[dict]:
    """names: (filename, url) pairs of unclassified J-book-directory PDFs."""
    out: list[dict] = []
    for name, url in names:
        subdir = (
            "02_Procurement" if "/02_Procurement/" in unquote(url)
            else "03_RDT_and_E"
        )
        # PB2023 twins share a filename across both directories — qualify
        # PB2023 records with their directory so they stay unambiguous.
        filename = f"{subdir}/{name}" if fy == 2023 else name
        override = OVERRIDES.get((fy, filename))
        if override:
            rule, reason = override
        elif _NUMERIC_INDEX.match(name):
            rule, reason = "numeric-index-duplicate", NUMERIC_REASONS.get(
                fy, "leading numeric index: redundant copy of loaded books"
            )
        elif fy == 2018:
            rule, reason = "evidence-duplicate", EVIDENCE_DUP_2018
        else:
            rule, reason = "tokenless-undecidable", TOKENLESS_REASON
        out.append({"filename": filename, "rule": rule, "reason": reason})
    return out


def main() -> None:
    with httpx.Client(timeout=60) as client:
        for fy in range(2017, 2024):
            names: list[tuple[str, str]] = []
            seen: set[str] = set()
            for index_url in jbook_index_urls(fy):
                r = client.get(index_url, follow_redirects=True)
                r.raise_for_status()
                for a in HTMLParser(r.text).css("a[href]"):
                    href = a.attributes.get("href") or ""
                    url = urljoin(index_url, href)
                    if url in seen:
                        continue
                    seen.add(url)
                    name = unquote(url.rsplit("/", 1)[-1])
                    if not name.lower().endswith(".pdf"):
                        continue
                    if not any(d in unquote(url) for d in JBOOK_DIRS):
                        continue
                    if _classify_by_path(url) or _classify_jbook(name):
                        continue
                    names.append((name, url))
            exclusions = derive_exclusions(fy, names)
            record_exclusions(MANIFEST_PATH, fy, exclusions)
            by_rule: dict[str, int] = {}
            for e in exclusions:
                by_rule[e["rule"]] = by_rule.get(e["rule"], 0) + 1
            print(f"fy{fy}: {len(exclusions)} exclusions {by_rule}")


if __name__ == "__main__":
    main()
