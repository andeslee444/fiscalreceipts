from __future__ import annotations
from dataclasses import dataclass, field

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
    # #53 fix (2026-08-08): a per-EDGE disambiguator, sha256(from|to|fy|
    # relation|sentence)[:16], minted by extract.py's mint(). Deliberately a
    # SEPARATE field from evidence_fact_id, not a replacement for it:
    # evidence_fact_id must stay exactly n['fact_id'] (the narrative's own
    # fact_id_narrative(...) value) because verify_lineage leg (a) re-derives
    # it against detail_narratives and export_site.py hard-raises any stated
    # edge whose evidence_fact_id is not in the site's cite-shard universe —
    # a freshly-minted hash would resolve to neither and silently break
    # citation resolution for every stated edge, not just the retracted one.
    # Two+ edges legitimately sharing ONE evidence_fact_id is normal (verified
    # live against program_lineage: fact_id 595b7bc230776350 backs 5 edges —
    # one rollup paragraph naming five PE-to-PE transfers — and
    # 76c131e6f01ef8fa backs 2 — one PE fanning out to two destinations), so
    # per-edge identity belongs on its own field. compare=False so the many
    # existing `LineageEdge(...) in edges`-style equality tests (which never
    # specify this field) are unaffected. NOT YET persisted to Postgres —
    # program_lineage (migrations/008_program_lineage.sql) has no column for
    # it and lineage/load.py's INSERT does not carry it, so it is dropped on
    # the Postgres round-trip today (_load_edges() reconstructs LineageEdge
    # without it). It exists so a future per-edge citation UI/migration has
    # something ready to key on, and so extract_stated_edges' own output is
    # honestly per-edge without a schema change or an export-site run.
    edge_fact_id: str | None = field(default=None, compare=False)
