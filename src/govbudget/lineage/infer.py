"""Deterministic Inferred edges (spec §4). NEVER cited, NEVER summed into a total.

- ba_maturation_same_title: 06Nxxx… and 06(N+1)xxx… share a
  normalized title across adjacent budget activities, with the predecessor's request
  tapering as the successor's rises (a funding hand-off).
"""
from __future__ import annotations
import re
from govbudget.lineage.model import LineageEdge

def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()

def _ba_digit(pe: str) -> int | None:
    # RDT&E PE: 4th char is the budget activity (060[BA]xxx…). Serial tail is
    # alphanumeric (e.g. 0603ABC, 0604781D8Z), so skip 3 digits, capture the 4th.
    m = re.match(r"\d{3}(\d)\w*", pe)
    return int(m.group(1)) if m else None

def infer_edges(series: list[dict]) -> list[LineageEdge]:
    """series rows: pe_bli, title, fy, kind ('request'), amount ($M)."""
    req = [r for r in series if r.get("kind") == "request"]
    by_title: dict[str, list[dict]] = {}
    for r in req:
        by_title.setdefault(_norm_title(r["title"]), []).append(r)
    out: list[LineageEdge] = []
    for title, rows in by_title.items():
        if not title:
            continue
        pes = {r["pe_bli"] for r in rows}
        for frm in pes:
            fba = _ba_digit(frm)
            if fba is None:
                continue
            for to in pes:
                tba = _ba_digit(to)
                if to == frm or tba is None or tba != fba + 1:
                    continue
                # funding hand-off: predecessor tapering AND successor rising in a shared FY
                frm_by_fy = {r["fy"]: r["amount"] for r in rows if r["pe_bli"] == frm}
                to_by_fy = {r["fy"]: r["amount"] for r in rows if r["pe_bli"] == to}
                handoff_fy = next((fy for fy in sorted(to_by_fy)
                                   if to_by_fy[fy] > 0
                                   and (fy - 1) in frm_by_fy
                                   and frm_by_fy.get(fy, 0) < frm_by_fy[fy - 1]), None)
                if handoff_fy is None:
                    continue
                out.append(LineageEdge(
                    from_pe_bli=frm, to_pe_bli=to, fiscal_year=handoff_fy,
                    relation="matured_ba", confidence="inferred",
                    inference_basis="ba_maturation_same_title"))
    return out
