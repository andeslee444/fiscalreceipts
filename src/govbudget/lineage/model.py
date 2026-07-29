from __future__ import annotations
from dataclasses import dataclass

# The BINDING cite-shard edition fence (single source of truth, 2026-07-28).
# Only narratives from THIS edition's J-books enter the site's cite-shard
# universe (export_site's citation pass filters jbook_documents.fiscal_year to
# this year), so a stated lineage edge may only cite a narrative from this
# edition — otherwise its <Cite> would silently fail to resolve on the site.
# Imported by lineage/load.py (stated-edge extraction fence) AND
# verify_lineage.py (leg (a)'s narrative index) so extractor, site, and gate
# can never fence to different editions.
CITED_NARRATIVE_FY = 2026

@dataclass(frozen=True)
class LineageEdge:
    from_pe_bli: str
    to_pe_bli: str
    fiscal_year: int
    relation: str            # matured_ba|realigned|split|merged|renamed|appropriation_transfer
    confidence: str          # stated|inferred
    evidence_fact_id: str | None = None
    evidence_sentence: str | None = None
    evidence_page: int | None = None
    portion_amount: float | None = None
    inference_basis: str | None = None
