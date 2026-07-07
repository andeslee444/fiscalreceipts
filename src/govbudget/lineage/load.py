"""Load pipeline: assemble lineage edges (stated + inferred) into Postgres.

Fully derived tables — build_lineage TRUNCATEs and rebuilds program_lineage and
program_family from scratch each run, so there are never stale rows.

Sources:
  - Stated edges: detail_narratives (Postgres). evidence_fact_id is the canonical
    narrative fact_id (fact_id_narrative) so it resolves in the site's citation
    universe; evidence_page is LEFT-JOINed from provenance_pages.
  - Inferred edges: fct_decade_series + dim_pe_titles (DuckDB, edition 2026,
    request rows). Deterministic BA-maturation hand-offs, never cited.

Ordering of the narrative query is DETERMINISTIC (fiscal_year desc, pe_bli,
xml_path) so extract_stated_edges' first-seen dedup is reproducible across runs.
"""
from __future__ import annotations

import psycopg

from govbudget.export_site import fact_id_narrative
from govbudget.lineage.extract import extract_stated_edges
from govbudget.lineage.family import build_families
from govbudget.lineage.infer import infer_edges
from govbudget.lineage.model import LineageEdge

_NARRATIVE_SQL = """
select j.sha256 as sha, n.pe_bli, n.kind, n.xml_path, j.fiscal_year, n.body,
       pp.page_number
  from detail_narratives n
  join jbook_documents j on j.id = n.document_id
  left join provenance_pages pp
    on pp.document_sha256 = j.sha256
   and pp.pe_bli = n.pe_bli
   and pp.narrative_kind = n.kind
   and pp.xml_path = n.xml_path
   and pp.target_kind = 'narrative'
 where not n.superseded
   and n.xml_path is not null
 order by j.fiscal_year desc, n.pe_bli, n.xml_path
"""

_SERIES_SQL = """
select f.pe_bli, t.title, f.fy, 'request' as kind, f.amount_thousands as amount
  from fct_decade_series f
  join dim_pe_titles t using(pe_bli)
 where f.edition_year = 2026
   and f.amount_type_kind = 'request'
   and t.title is not null
"""


def _load_stated(dsn: str) -> list[LineageEdge]:
    narratives: list[dict] = []
    with psycopg.connect(dsn) as con:
        for sha, pe_bli, kind, xml_path, fy, body, page in con.execute(_NARRATIVE_SQL):
            narratives.append({
                "pe_bli": pe_bli,
                "fiscal_year": int(fy),
                # canonical narrative fact_id so stated evidence resolves on-site
                "fact_id": fact_id_narrative(sha, pe_bli, kind, xml_path),
                "page": page,
                # cap defends against a pathological unpunctuated-blob body (O(n^2)
                # regex risk); 50k comfortably exceeds any real transfer section.
                "body": (body or "")[:50000],
            })
    return extract_stated_edges(narratives)


def _load_inferred(duckdb_path) -> list[LineageEdge]:
    import duckdb

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        series = [
            {"pe_bli": pe_bli, "title": title, "fy": int(fy), "kind": kind, "amount": amount}
            for pe_bli, title, fy, kind, amount in con.execute(_SERIES_SQL).fetchall()
        ]
    finally:
        con.close()
    return infer_edges(series)


def build_lineage(dsn: str, duckdb_path) -> dict:
    stated = _load_stated(dsn)
    inferred = _load_inferred(duckdb_path)

    # Stated wins: drop any inferred edge whose (from, to) pair already exists stated.
    stated_pairs = {(e.from_pe_bli, e.to_pe_bli) for e in stated}
    kept_inferred = [e for e in inferred if (e.from_pe_bli, e.to_pe_bli) not in stated_pairs]

    # Defensively drop self-loops (no meaningful lineage; would fail a sanity check).
    edges = [e for e in (stated + kept_inferred) if e.from_pe_bli != e.to_pe_bli]

    fams = build_families(edges)

    with psycopg.connect(dsn) as con:
        with con.transaction():
            con.execute("truncate program_lineage")
            con.execute("truncate program_family")
            if edges:
                con.cursor().executemany(
                    "insert into program_lineage (from_pe_bli, to_pe_bli, fiscal_year,"
                    " relation, portion_amount, confidence, evidence_fact_id,"
                    " evidence_sentence, evidence_page, inference_basis)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [(e.from_pe_bli, e.to_pe_bli, e.fiscal_year, e.relation,
                      e.portion_amount, e.confidence, e.evidence_fact_id,
                      e.evidence_sentence, e.evidence_page, e.inference_basis)
                     for e in edges],
                )
            if fams:
                con.cursor().executemany(
                    "insert into program_family (pe_bli, family_id) values (%s, %s)",
                    list(fams.items()),
                )

    return {
        "stated": len(stated),
        "inferred": len(kept_inferred),
        "families": len(set(fams.values())),
        "edges": len(edges),
    }
