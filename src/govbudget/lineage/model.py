from __future__ import annotations
from dataclasses import dataclass

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
