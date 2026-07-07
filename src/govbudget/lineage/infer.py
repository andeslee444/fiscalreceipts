"""Deterministic Inferred edges (spec §4). NEVER cited, NEVER summed into a total.

- ba_maturation_same_title: RDT&E PEs only (06...), same agency suffix, adjacent
  budget activities (BA N -> N+1), a shared normalized title, and a funding
  hand-off (predecessor request tapering from a real prior-year baseline as the
  successor rises).
"""
from __future__ import annotations
import re
from govbudget.lineage.model import LineageEdge

def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()

def _ba_digit(pe: str) -> int | None:
    # Budget activity = 4th char, but ONLY for RDT&E PEs (06... appropriation
    # prefix); returns None for anything else. Procurement P-1 line numbers and
    # O&M codes are NOT RDT&E PEs climbing the RDT&E ladder — matching them would
    # mint spurious maturations. Serial tail is alphanumeric (e.g. 0603ABC,
    # 0604781D8Z), so require '06' + one digit, then capture the 4th char (BA).
    m = re.match(r"06\d(\d)\w*", pe)
    return int(m.group(1)) if m else None

def _agency_suffix(pe: str) -> str:
    m = re.match(r"\d{7}(.*)", pe)
    return m.group(1) if m else ""

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
                if _agency_suffix(frm) != _agency_suffix(to):
                    continue  # a maturation stays within its service/agency; cross-agency same-title is a coincidence, not a maturation
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
