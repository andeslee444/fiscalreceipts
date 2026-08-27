"""Program-lineage acceptance gate (program-lineage Task 5).

CLI: verify-lineage. Three honesty legs (spec §7). This gate enforces the
phase's core honesty contract: every gold edge is genuinely cited, families
are exactly the STATED connected components, and the family funding line sums
ONLY the 1:1 chain (never an inferred/split/merge/partial successor). It is
built to FAIL FIRST (recorded proof-can-fail) and must never be a vacuous
always-pass.

  Leg (a) — stated-cite. Every program_lineage row with confidence='stated':
    1. evidence_sentence contains the from_pe_bli OR to_pe_bli token; and
    2. evidence_fact_id RE-DERIVES to a real narrative — there is a
       detail_narratives row (joined to jbook_documents for sha256) with
       fact_id_narrative(sha256, pe_bli, kind, xml_path) == evidence_fact_id
       AND that narrative's body contains evidence_sentence.
    ALL stated edges are checked (there are only ~53), not a sample.

  Leg (b) — family-integrity. Recompute build_families over the LIVE stated
    edges; the resulting partition (which PEs share a family) must EXACTLY
    match the persisted program_family partition — compared by the
    same-family-or-not equivalence relation, not the raw integer ids. A PE in
    a different grouping, a missing PE, or an extra PE is a FAIL.

  Leg (c) — one-to-one-sum. For each multi-member family (target ≥10; all are
    checked and the count is reported): pick the family ROOT (a member with
    STATED in-degree == 0; cyclic-with-no-root families fall back to the
    lexicographically smallest member, noted), compute one_to_one_chain(root),
    and verify:
      - no chain member is the target of a split/merge or a partial-transfer
        edge (one_to_one_chain guarantees this — asserted independently here);
      - no chain member is an INFERRED-edge successor (the honesty property:
        a summed funding total must never pull in an inferred/split/merge/
        partial member) — FAIL if it does;
      - the family funding line is summable: the ROOT resolves in the request
        series, and every chain member either resolves in the request series
        OR is a documented terminal dangling forward-reference (a STATED 1:1
        successor with out-degree 0 that appears nowhere in fct_decade_series
        — a cited destination PE in a not-yet-ingested edition). A missing
        member that is mid-chain, or whose root does not resolve, is a FAIL.

  Leg (d) — funding-point-value (Defect 2, 2026-07-28). Every funding_line
    entry emitted into the BUILT site artifact (data/site/json/program_details/
    *.json) must display EXACTLY the value of the fact it cites: entry.v ==
    the fct_decade_series request row whose source_fact_id == entry.fid (and,
    for the per-member shape, entry.pe/entry.fy must be that fact's own pe/fy).
    This leg deliberately audits the built artifact — not the exporter's
    in-memory inputs — so a regression anywhere between the warehouse and the
    shipped JSON (summing, member mislabeling, stale artifact) FAILS.

  Leg (e) — lake↔DB binding (2026-07-28). The staged jbooks parquet lake
    (program_lineage.parquet + program_family.parquet — what export-site
    actually reads) must EQUAL the Postgres tables: multiset equality on
    (from, to, fy, relation, confidence) and pe-set + partition equality for
    families. A MISSING parquet is a FAIL, never a skip — an un-staged lake
    silently decouples the site from the verified warehouse.

  Leg (f) — no-self-retraction (#53, 2026-08-08). No confidence='stated' edge
    may be backed by a sentence that retracts itself, directly or via its own
    immediate successor within the SAME cited narrative body: re-derive the
    (sentence, next-sentence) window from detail_narratives (the SAME
    narrative index leg (a) resolves the citation against) and re-run
    lineage/extract.py's OWN NEGATION_CUES / _window_is_negated (imported,
    never duplicated — the same one-rule-set discipline sentence_named_pairs
    already enforces for leg (a)) against it. A match is a FAIL. This is a
    drift check on the LIVE, persisted table — extract_stated_edges is
    negation-aware at mint time, so a freshly-rebuilt program_lineage should
    never contain one of these; leg (f) catches a stale/reverted rebuild that
    shipped one anyway. Non-vacuous: zero checkable stated edges is a FAIL.

    NOT implemented: the spec's other proposed clause, "no two edges on one
    program may share an evidence_fact_id." Checked against the LIVE
    program_lineage table before shipping and disproven — evidence_fact_id
    595b7bc230776350 is shared, correctly, by 5 edges (one rollup paragraph
    naming five separate PE-to-PE transfers on one page) and
    76c131e6f01ef8fa by 2 (one PE fanning out to two destinations). A shared
    narrative fact_id is normal, not a defect signature; enforcing uniqueness
    would fail the gate on correct, already-shipped data while adding no
    protection #53 needs (the actual retraction is caught by the negation
    check above regardless of whether its fact_id happens to be shared).

  Leg (g) — artifact cite-resolution (#29(b), 2026-08-27). Every stated edge's
    evidence_fact_id must resolve in the BUILT cite-shards (kind
    'jbook_narrative', naming a source document by sha256 AND official_url),
    and every endpoint that has a program_details sidecar must ship a rail
    entry carrying that same fact_id and the same sentence. Leg (a) proves the
    warehouse row is honest; leg (g) proves the reader can actually open it.
    Both are needed only since #29(b): while extraction was fenced to the one
    citable edition, "the citation resolves" was true by construction.
    Non-vacuous structurally — the population is the shipped stated set, and a
    build where no edge reaches any page FAILS.

  Leg (h) — supersession (#29(b), 2026-08-27). No stated edge may be one that
    a LATER J-book edition takes back — the mirror link stated later, or a
    later clause naming both endpoints with a retraction cue. Re-applies
    lineage/extract.py's OWN superseded_reason (imported, never restated), so
    it is a drift check on the persisted table exactly as leg (f) is. Only
    reachable at all because #29(b) reads ten editions instead of one.

All gate functions take explicit DSNs/paths — never read config. No network.
Exit code 0 iff all legs pass; nonzero otherwise.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from govbudget.export_site import fact_id_narrative
from govbudget.lineage.family import build_families, one_to_one_chain
from govbudget.lineage.model import LineageEdge

# Relations that end a 1:1 line even at degree 1:1 (mirror one_to_one_chain):
# a labeled split/merge, or a PARTIAL transfer (portion_amount set), can never
# reparent the summed funding line.
_NON_11_RELATIONS = ("split", "merged")


# ---------------------------------------------------------------------------
# Shared: read the live edges from program_lineage
# ---------------------------------------------------------------------------


def _load_edges(dsn: str) -> list[LineageEdge]:
    """Read program_lineage into LineageEdges (stated + inferred)."""
    import psycopg

    with psycopg.connect(dsn) as con:
        rows = con.execute(
            "select from_pe_bli, to_pe_bli, fiscal_year, relation, confidence,"
            " evidence_fact_id, evidence_sentence, evidence_page, portion_amount,"
            " inference_basis"
            " from program_lineage"
        ).fetchall()
    return [
        LineageEdge(
            from_pe_bli=r[0],
            to_pe_bli=r[1],
            fiscal_year=int(r[2]),
            relation=r[3],
            confidence=r[4],
            evidence_fact_id=r[5],
            evidence_sentence=r[6],
            evidence_page=r[7],
            portion_amount=(float(r[8]) if r[8] is not None else None),
            inference_basis=r[9],
        )
        for r in rows
    ]


def _load_narrative_index(con) -> dict[str, list[str]]:
    """fact_id -> list of narrative bodies, keyed by the canonical
    fact_id_narrative(sha256, pe_bli, kind, xml_path).

    A fact_id is unique per narrative row, but a list keeps us honest if two
    rows ever collide on the derived id. Shared by leg (a) and leg (c) so both
    apply the SAME citation-resolution rule against the SAME narrative universe.

    UNFENCED across editions (#29(b), 2026-08-27). Through Phase 5I this
    filtered to fiscal_year = CITED_NARRATIVE_FY, because the site's cite-shard
    universe held only PB2026 narratives, so indexing more would have let an
    edge pass leg (a) while shipping a dead <Cite>. export_site now mints a
    citation for every narrative a stated edge cites in ANY edition, so the
    index must span the same ten editions — matching lineage/load.py, which
    extracts from all of them.

    Re-deriving the fact_id here does NOT prove the site can resolve it: that
    is leg (g)'s job, and it asserts against the BUILT cite-shards rather than
    against this query. Keeping the two separate is deliberate — an index that
    both mints the expected id and judges it would agree with itself.
    """
    narratives = con.execute(
        """
        select j.sha256, n.pe_bli, n.kind, n.xml_path, n.body
          from detail_narratives n
          join jbook_documents j on j.id = n.document_id
         where not n.superseded
           and n.xml_path is not null
        """
    ).fetchall()
    fid_to_bodies: dict[str, list[str]] = defaultdict(list)
    for sha, pe_bli, kind, xml_path, body in narratives:
        fid = fact_id_narrative(sha, pe_bli, kind, xml_path)
        fid_to_bodies[fid].append(body or "")
    return fid_to_bodies


def _edge_citation_resolves(
    edge: LineageEdge, fid_to_bodies: dict[str, list[str]]
) -> tuple[bool, str | None]:
    """True iff a stated edge is genuinely cited (spec §7 leg a rule).

    Genuinely cited means ALL of:
      1. evidence_sentence is non-empty and contains the from_pe_bli OR
         to_pe_bli token;
      2. when the evidence_sentence itself names BOTH endpoints (it matches a
         from-direction AND a to-direction rule — decided by the extractor's
         own sentence_named_pairs over the SAME _RULES, never a duplicated
         regex set), the edge's (from_pe_bli, to_pe_bli) is one of the
         sentence-named pairs — an edge whose endpoints contradict its
         both-named sentence is a fabrication (Defect 1, 2026-07-28);
      3. evidence_fact_id is non-empty and present in the narrative index; AND
      4. that narrative's body contains evidence_sentence verbatim.

    Returns (ok, reason) — reason is None on success, else a human-readable
    failure string (so leg (a) can report the specific violation). This is the
    LOCAL citation invariant: leg (c)'s dangling-terminal carve-out reuses it
    so the exemption can never depend on leg (a) having run in the same CLI.
    """
    from govbudget.lineage.extract import sentence_named_pairs

    sent = edge.evidence_sentence
    if not sent:
        return False, "stated edge has no evidence_sentence"
    if edge.from_pe_bli not in sent and edge.to_pe_bli not in sent:
        return False, f"evidence_sentence cites neither PE token: {sent[:120]!r}"
    named = sentence_named_pairs(sent)
    if named and (edge.from_pe_bli, edge.to_pe_bli) not in named:
        return False, (
            f"edge endpoints contradict the both-named sentence — it names"
            f" {sorted(named)} , not"
            f" ({edge.from_pe_bli!r}, {edge.to_pe_bli!r})"
        )
    if not edge.evidence_fact_id:
        return False, "stated edge has no evidence_fact_id"
    bodies = fid_to_bodies.get(edge.evidence_fact_id)
    if not bodies:
        return False, (
            f"evidence_fact_id {edge.evidence_fact_id} re-derives to no narrative"
        )
    if not any(sent in body for body in bodies):
        return False, (
            f"narrative body for fact_id {edge.evidence_fact_id} does not contain"
            f" evidence_sentence"
        )
    return True, None


# ---------------------------------------------------------------------------
# Leg (a): stated-cite — every gold edge is genuinely cited
# ---------------------------------------------------------------------------


def stated_cite_leg(dsn: str) -> dict:
    """Every stated edge cites a real narrative sentence (spec §7 leg a).

    Loads the narrative index once and applies _edge_citation_resolves to every
    stated edge (evidence_sentence contains a PE token AND evidence_fact_id
    re-derives to a narrative whose body contains the sentence). The same helper
    backs leg (c)'s dangling-terminal carve-out, so the two legs share one
    citation-resolution rule.

    Returns: ok, checked, passed, failures [(edge, reason)].
    """
    import psycopg

    edges = _load_edges(dsn)
    stated = [e for e in edges if e.confidence == "stated"]

    with psycopg.connect(dsn) as con:
        fid_to_bodies = _load_narrative_index(con)

    failures: list[tuple[str, str]] = []
    for e in stated:
        grain = f"{e.from_pe_bli}->{e.to_pe_bli} ({e.relation})"
        ok, reason = _edge_citation_resolves(e, fid_to_bodies)
        if not ok:
            failures.append((grain, reason))

    checked = len(stated)
    return {
        "ok": checked > 0 and len(failures) == 0,
        "checked": checked,
        "passed": checked - len(failures),
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Leg (b): family-integrity — families are exactly the stated components
# ---------------------------------------------------------------------------


def _partition_signature(pe_to_group: dict[str, object]) -> dict[str, frozenset]:
    """Map each PE to the frozenset of PEs sharing its group (id-agnostic)."""
    members: dict[object, set] = defaultdict(set)
    for pe, gid in pe_to_group.items():
        members[gid].add(pe)
    return {pe: frozenset(members[gid]) for pe, gid in pe_to_group.items()}


def family_integrity_leg(dsn: str) -> dict:
    """Persisted program_family partition == build_families(live stated edges).

    Compared by the same-family-or-not equivalence relation (each PE's set of
    co-members), so the check is independent of how the integer family_ids
    happen to be assigned. FAIL on any PE in a different grouping, a missing
    PE, or an extra PE.

    Returns: ok, recomputed_pes, persisted_pes, failures [(kind, detail)].
    """
    import psycopg

    edges = _load_edges(dsn)
    stated = [e for e in edges if e.confidence == "stated"]
    recomputed = build_families(stated)

    with psycopg.connect(dsn) as con:
        persisted = {
            pe: fid
            for pe, fid in con.execute("select pe_bli, family_id from program_family")
        }

    failures: list[tuple[str, str]] = []

    rec_pes = set(recomputed)
    per_pes = set(persisted)
    for pe in sorted(rec_pes - per_pes):
        failures.append(("missing", f"PE {pe} in recomputed families but not in program_family"))
    for pe in sorted(per_pes - rec_pes):
        failures.append(("extra", f"PE {pe} in program_family but not in recomputed families"))

    # Compare the equivalence relation on the shared PEs.
    rec_sig = _partition_signature(recomputed)
    per_sig = _partition_signature(persisted)
    for pe in sorted(rec_pes & per_pes):
        # Restrict each signature to the shared universe so a set-membership
        # difference (already reported above) doesn't double-report here.
        rec_group = rec_sig[pe] & (rec_pes & per_pes)
        per_group = per_sig[pe] & (rec_pes & per_pes)
        if rec_group != per_group:
            failures.append(
                ("regroup", f"PE {pe} groups with {sorted(rec_group)} (recomputed)"
                            f" but {sorted(per_group)} (persisted)")
            )

    return {
        "ok": len(failures) == 0 and len(rec_pes) > 0,
        "recomputed_pes": len(rec_pes),
        "persisted_pes": len(per_pes),
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Leg (c): one-to-one-sum — the funding line sums ONLY the 1:1 chain
# ---------------------------------------------------------------------------


def _request_series_pes(duckdb_path: Path) -> tuple[set[str], set[str]]:
    """Return (request-series PEs, all-series PEs) from fct_decade_series.

    request-series = PEs with an amount_type_kind='request' row (the summable
    funding line). all-series = PEs with ANY series row (used to distinguish a
    genuine terminal dangling forward-reference — nowhere in the series — from
    a mid-chain member that exists but lacks a request row, which is a FAIL).
    """
    import duckdb

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        req = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from fct_decade_series"
                " where amount_type_kind = 'request'"
            ).fetchall()
        }
        allp = {
            r[0]
            for r in con.execute(
                "select distinct pe_bli from fct_decade_series"
            ).fetchall()
        }
    finally:
        con.close()
    return req, allp


def one_to_one_sum_leg(
    dsn: str, duckdb_path: Path, *, target_families: int = 10
) -> dict:
    """The family funding line sums ONLY the STATED 1:1 chain (spec §7 leg c).

    For every MULTI-member family (all are checked; families_checked is
    reported and compared to target_families for the ≥10 promise):
      - root = a member with STATED in-degree == 0; if the family is cyclic
        with no in-degree-0 member, fall back to the lexicographically
        smallest member (noted in cyclic_fallbacks);
      - chain = one_to_one_chain(root, stated_edges);
      - HONESTY (the teeth): assert no chain member is the target of a
        split/merge or a partial-transfer edge, and no chain member is an
        INFERRED-edge successor. Either is a FAIL — an inferred/split/merge/
        partial member must never enter a summed funding total;
      - SUMMABILITY: the root must resolve in the request series; every other
        chain member must resolve in the request series OR be a citation-gated
        terminal dangling reference. The carve-out fires ONLY when the member
        has out-degree 0, is absent from the ENTIRE series, AND the STATED edge
        that introduced it (whose to_pe_bli == the member) itself passes
        _edge_citation_resolves. An UNcited/garbage terminal — or a mid-chain
        gap, or a non-resolving root — is a FAIL. Making the exemption depend on
        the incoming edge's own citation keeps leg (c) safe in ISOLATION: a
        caller invoking it standalone (without leg a) can never wave through a
        fabricated terminal.

    Returns: ok, families_checked, target_families, cyclic_fallbacks [str],
             dangling_terminals [(family_root, member)], failures [(grain, reason)].
    """
    import psycopg

    duckdb_path = Path(duckdb_path)
    edges = _load_edges(dsn)
    stated = [e for e in edges if e.confidence == "stated"]

    fams = build_families(stated)
    by_fam: dict[int, list[str]] = defaultdict(list)
    for pe, fid in fams.items():
        by_fam[fid].append(pe)
    multi = {fid: pes for fid, pes in by_fam.items() if len(pes) > 1}

    base = {
        "ok": False,
        "families_checked": 0,
        "target_families": target_families,
        "cyclic_fallbacks": [],
        "dangling_terminals": [],
        "dangling_origins": [],
        "failures": [],
    }
    if not multi:
        return {**base, "reason": "no multi-member families to check"}
    if not duckdb_path.exists():
        return {**base, "reason": f"duckdb warehouse missing: {duckdb_path}"}

    req_pes, all_series_pes = _request_series_pes(duckdb_path)

    # Narrative index — so leg (c)'s dangling-terminal carve-out can require the
    # INCOMING edge to be genuinely cited (the same rule leg a applies).
    with psycopg.connect(dsn) as con:
        fid_to_bodies = _load_narrative_index(con)

    # Degree bookkeeping over the STATED edges + maps from each PE to the
    # edge(s) that introduce it (incoming) / that it asserts (outgoing).
    in_deg: dict[str, int] = defaultdict(int)
    out_deg: dict[str, int] = defaultdict(int)
    incoming: dict[str, list[LineageEdge]] = defaultdict(list)
    outgoing: dict[str, list[LineageEdge]] = defaultdict(list)
    for e in stated:
        in_deg[e.to_pe_bli] += 1
        out_deg[e.from_pe_bli] += 1
        incoming[e.to_pe_bli].append(e)
        outgoing[e.from_pe_bli].append(e)

    # Targets of a split/merge or partial-transfer edge, and INFERRED
    # successors — the members that must NEVER appear in a summed 1:1 chain.
    non_11_targets: set[str] = set()
    for e in stated:
        if e.relation in _NON_11_RELATIONS or e.portion_amount is not None:
            non_11_targets.add(e.to_pe_bli)
    inferred_targets = {e.to_pe_bli for e in edges if e.confidence == "inferred"}

    failures: list[tuple[str, str]] = []
    cyclic_fallbacks: list[str] = []
    dangling_terminals: list[tuple[str, str]] = []
    dangling_origins: list[str] = []

    for fid, pes in sorted(multi.items()):
        roots = sorted(p for p in pes if in_deg[p] == 0)
        if roots:
            root = roots[0]
        else:
            root = sorted(pes)[0]
            cyclic_fallbacks.append(root)
        grain = f"family {fid} root={root}"
        chain = one_to_one_chain(root, stated)

        # HONESTY: no chain member may be a split/merge/partial target or an
        # inferred successor. (The root is the chain's own start; a chain of
        # length 1 trivially satisfies this.)
        for m in chain[1:]:
            if m in non_11_targets:
                failures.append(
                    (grain, f"chain member {m} is the target of a split/merge/"
                            f"partial-transfer edge — must not be summed")
                )
            if m in inferred_targets:
                failures.append(
                    (grain, f"chain member {m} is an INFERRED-edge successor —"
                            f" must not be summed")
                )

        # COMPOSABILITY: the root must resolve in the request series — OR be a
        # citation-gated dangling ORIGIN (2026-07-28, the mirror of the
        # terminal carve-out, forced by Defect-1's corrected extraction: a
        # sentence-named historical source like 0207436F has no ingested
        # series at all). The exemption fires ONLY when the root is absent
        # from the ENTIRE series AND at least one of its OUTGOING stated
        # edges itself passes _edge_citation_resolves — the same LOCAL rule
        # the terminal exemption applies to the incoming edge. This is not a
        # loosening of the funding-line honesty: since Defect 2's fix the
        # funding line is per-member cited points (never a sum pivoting on the
        # root), so an un-ingested cited origin simply contributes no points.
        # An UNcited origin, or a root PRESENT in the series without a request
        # row (a real warehouse gap), still FAILS.
        if root not in req_pes:
            is_uningested = root not in all_series_pes
            outgoing_cited = any(
                _edge_citation_resolves(e, fid_to_bodies)[0] for e in outgoing[root]
            )
            if is_uningested and outgoing_cited:
                dangling_origins.append(root)
            elif is_uningested:
                failures.append(
                    (grain, f"family root {root} is an UNcited dangling origin —"
                            f" no outgoing stated edge resolves to a real cited"
                            f" narrative, so its absence from the series cannot"
                            f" be exempted; the family must not thread a"
                            f" fabricated origin")
                )
            else:
                failures.append(
                    (grain, f"family root {root} does not resolve in the request"
                            f" series (fct_decade_series amount_type_kind='request')")
                )
        for m in chain[1:]:
            if m in req_pes:
                continue
            # Not in the request series. The dangling-terminal carve-out fires
            # ONLY for a genuinely-cited terminal: out-degree 0, absent from the
            # ENTIRE series, AND the STATED edge that introduced m is itself a
            # resolving citation. That last clause makes the exemption a LOCAL
            # invariant of leg (c) — an uncited/garbage terminal is never waved
            # through, even when this leg runs standalone. Anything else
            # (mid-chain, present-but-no-request-row, or uncited) is a FAIL.
            is_terminal = out_deg[m] == 0 and m not in all_series_pes
            incoming_cited = any(
                _edge_citation_resolves(e, fid_to_bodies)[0] for e in incoming[m]
            )
            if is_terminal and incoming_cited:
                dangling_terminals.append((root, m))
            elif is_terminal and not incoming_cited:
                failures.append(
                    (grain, f"chain member {m} is an UNcited dangling terminal —"
                            f" its incoming stated edge does not resolve to a real"
                            f" cited narrative, so it cannot be exempted; the"
                            f" funding line must not sum or thread a fabricated"
                            f" successor")
                )
            else:
                failures.append(
                    (grain, f"chain member {m} does not resolve in the request"
                            f" series and is not a terminal dangling reference"
                            f" (out_deg={out_deg[m]}, in_series={m in all_series_pes})")
                )

    families_checked = len(multi)
    return {
        "ok": (
            families_checked > 0
            and len(failures) == 0
            # If fewer than the target of 10 multi-member families exist we
            # still pass (all are checked), but the caller prints the count.
        ),
        "families_checked": families_checked,
        "target_families": target_families,
        "cyclic_fallbacks": cyclic_fallbacks,
        "dangling_terminals": dangling_terminals,
        "dangling_origins": dangling_origins,
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Leg (d): funding-point-value — every shipped point equals its cited fact
# ---------------------------------------------------------------------------


def funding_point_value_leg(duckdb_path: Path, program_details_dir: Path) -> dict:
    """Every funding_line point in the BUILT sidecars equals its cited fact.

    Reads data/site/json/program_details/*.json (the artifact export-site
    actually shipped — chosen over recomputing the exporter's inputs precisely
    so the gate has teeth against the built file) and, for each
    lineage.family.funding_line entry:
      1. entry.fid must resolve to a fct_decade_series REQUEST grain's citable
         identity — source_fact_id for a single-source grain, or the derived
         decade-sum fact fact_id_derived('decade', '{pe}|{edition}', amount_type)
         for a multi-source grain (the SAME derivation _decade_fact_space
         mints, itself lake-cross-checked with a hard ValueError). An unknown
         fid is a FAIL;
      2. entry.v must EQUAL that grain's recorded amount — a summed/blended
         value the citation does not back (Defect 2) is a FAIL;
      3. when the entry carries the per-member labels (pe / fy), they must be
         the cited grain's own pe_bli / fy — a point labeled one member but
         citing another's fact is a FAIL even if the dollar value coincides.

    Family blocks are duplicated across member pages; EVERY copy is checked.
    Returns: ok, files_scanned, points_checked, failures [(grain, reason)].
    Non-vacuous: zero checkable points is a FAIL (reason reported).
    """
    import json

    import duckdb

    from govbudget.export_site import fact_id_derived

    duckdb_path = Path(duckdb_path)
    program_details_dir = Path(program_details_dir)
    base = {"ok": False, "files_scanned": 0, "points_checked": 0, "failures": []}
    if not duckdb_path.exists():
        return {**base, "reason": f"duckdb warehouse missing: {duckdb_path}"}
    if not program_details_dir.is_dir():
        return {**base, "reason": f"program_details dir missing: {program_details_dir}"}

    con = duckdb.connect(str(duckdb_path), read_only=True)
    try:
        fact_rows = con.execute(
            "select source_fact_id, pe_bli, fy, amount, edition_year,"
            " amount_type, n_source_rows"
            " from fct_decade_series where amount_type_kind = 'request'"
        ).fetchall()
    finally:
        con.close()
    facts: dict[str, tuple[str, int, float]] = {}
    for src_fid, pe, fy, amount, edition, amount_type, n_src in fact_rows:
        if int(n_src or 1) == 1:
            fid = src_fid
        else:  # multi-source grain → the derived decade-sum fact is the cite
            fid = fact_id_derived("decade", f"{pe}|{int(edition)}", amount_type)
        if fid is not None:
            facts[fid] = (pe, int(fy), float(amount))

    failures: list[tuple[str, str]] = []
    files_scanned = 0
    points_checked = 0
    for path in sorted(program_details_dir.glob("*.json")):
        files_scanned += 1
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            failures.append((path.name, f"unreadable sidecar: {exc}"))
            continue
        funding_line = (
            ((doc.get("lineage") or {}).get("family") or {}).get("funding_line") or []
        )
        for i, pt in enumerate(funding_line):
            points_checked += 1
            grain = f"{path.name} funding_line[{i}] fy={pt.get('fy')} fid={pt.get('fid')}"
            fid = pt.get("fid")
            fact = facts.get(fid)
            if fact is None:
                failures.append(
                    (grain, "cites no request fact — fid has no fct_decade_series"
                            " request row (source_fact_id)")
                )
                continue
            fact_pe, fact_fy, fact_amount = fact
            v = pt.get("v")
            if v is None or float(v) != fact_amount:
                failures.append(
                    (grain, f"displayed value {v} does not equal the cited fact's"
                            f" recorded value {fact_amount} (fact {fid}:"
                            f" {fact_pe} FY{fact_fy})")
                )
                continue
            if "pe" in pt and pt["pe"] != fact_pe:
                failures.append(
                    (grain, f"labeled pe {pt['pe']} but the cited fact belongs to"
                            f" {fact_pe} — a point must cite its OWN member's fact")
                )
                continue
            if pt.get("fy") is not None and int(pt["fy"]) != fact_fy:
                failures.append(
                    (grain, f"labeled fy {pt['fy']} but the cited fact is FY{fact_fy}")
                )

    result = {
        "ok": points_checked > 0 and len(failures) == 0,
        "files_scanned": files_scanned,
        "points_checked": points_checked,
        "failures": failures,
    }
    if points_checked == 0:
        result["reason"] = "no funding_line points found in program_details — vacuous"
    return result


# ---------------------------------------------------------------------------
# Leg (e): lake↔DB binding — the staged parquet equals the Postgres tables
# ---------------------------------------------------------------------------


def lake_binding_leg(dsn: str, duckdb_path: Path) -> dict:
    """program_lineage.parquet + program_family.parquet == the Postgres tables.

    export-site reads lineage from the staged jbooks parquet lake, NOT from
    Postgres — so the verified warehouse and the exported site can silently
    diverge if the lake is stale. This leg binds them: multiset equality on
    (from_pe_bli, to_pe_bli, fiscal_year, relation, confidence) for edges, and
    pe-set + same-family-partition equality for families (id-agnostic, like
    leg b). A missing parquet file is a FAIL — never a skip.

    Returns: ok, lineage_rows_db, lineage_rows_lake, family_pes_db,
             family_pes_lake, failures [(kind, reason)].
    """
    from collections import Counter

    import psycopg

    from govbudget.export_site import _stage_parquet_path

    failures: list[tuple[str, str]] = []
    lin_pq = _stage_parquet_path(duckdb_path, "jbooks", "program_lineage.parquet")
    fam_pq = _stage_parquet_path(duckdb_path, "jbooks", "program_family.parquet")
    if lin_pq is None:
        failures.append(("lineage", "program_lineage.parquet missing from the lake"))
    if fam_pq is None:
        failures.append(("family", "program_family.parquet missing from the lake"))

    base = {
        "ok": False,
        "lineage_rows_db": 0,
        "lineage_rows_lake": 0,
        "family_pes_db": 0,
        "family_pes_lake": 0,
        "failures": failures,
    }
    if failures:
        return base

    import duckdb

    con = duckdb.connect()
    try:
        lin_s = str(lin_pq).replace("'", "''")
        fam_s = str(fam_pq).replace("'", "''")
        lake_edges = Counter(
            (r[0], r[1], str(int(r[2])), r[3], r[4])
            for r in con.execute(
                "select from_pe_bli, to_pe_bli, fiscal_year, relation, confidence"
                f" from read_parquet('{lin_s}')"
            ).fetchall()
        )
        lake_fams = {
            r[0]: str(r[1])
            for r in con.execute(
                f"select pe_bli, family_id from read_parquet('{fam_s}')"
            ).fetchall()
        }
    finally:
        con.close()

    with psycopg.connect(dsn) as pg:
        db_edges = Counter(
            (r[0], r[1], str(int(r[2])), r[3], r[4])
            for r in pg.execute(
                "select from_pe_bli, to_pe_bli, fiscal_year, relation, confidence"
                " from program_lineage"
            ).fetchall()
        )
        db_fams = {
            pe: str(fid)
            for pe, fid in pg.execute("select pe_bli, family_id from program_family")
        }

    for row in sorted((db_edges - lake_edges).elements()):
        failures.append(("lineage", f"db-only edge not in lake parquet: {row}"))
    for row in sorted((lake_edges - db_edges).elements()):
        failures.append(("lineage", f"lake-only edge not in Postgres: {row}"))

    db_pes, lake_pes = set(db_fams), set(lake_fams)
    for pe in sorted(db_pes - lake_pes):
        failures.append(("family", f"db-only family PE not in lake parquet: {pe}"))
    for pe in sorted(lake_pes - db_pes):
        failures.append(("family", f"lake-only family PE not in Postgres: {pe}"))
    db_sig = _partition_signature({pe: gid for pe, gid in db_fams.items() if pe in lake_pes})
    lake_sig = _partition_signature({pe: gid for pe, gid in lake_fams.items() if pe in db_pes})
    for pe in sorted(set(db_sig) & set(lake_sig)):
        if db_sig[pe] != lake_sig[pe]:
            failures.append(
                ("family", f"partition drift: PE {pe} groups with"
                           f" {sorted(db_sig[pe])} in Postgres but"
                           f" {sorted(lake_sig[pe])} in the lake")
            )

    n_db_edges = sum(db_edges.values())
    return {
        "ok": len(failures) == 0 and n_db_edges > 0,
        "lineage_rows_db": n_db_edges,
        "lineage_rows_lake": sum(lake_edges.values()),
        "family_pes_db": len(db_pes),
        "family_pes_lake": len(lake_pes),
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Leg (f): no-self-retraction — a stated edge's own citation must not retract
# it (#53, 2026-08-08)
# ---------------------------------------------------------------------------


def no_retraction_leg(dsn: str) -> dict:
    """No stated edge is backed by a sentence that retracts itself (spec §7
    leg f, #53).

    For each stated edge, resolve its evidence_fact_id to the SAME narrative
    bodies leg (a) uses (_load_narrative_index), find the body containing
    evidence_sentence verbatim, split it into sentences with extract.py's OWN
    _SENT regex, locate the matching sentence, and re-run extract.py's OWN
    _window_is_negated against (that sentence, its immediate successor,
    from_pe_bli, to_pe_bli) — imported, never duplicated, so the extractor
    and this gate can never apply different negation rules. A match is a
    FAIL: the row asserts, at the site's strongest evidence tier, a transfer
    its own cited paragraph takes back.

    This is a LIVE-table drift check, not a re-run of extraction:
    extract_stated_edges already refuses to mint a negated edge, so a
    freshly-rebuilt program_lineage should never trip this leg. It exists to
    catch a stale row that survived an old (pre-negation-aware) build, or a
    hand-edited/reverted one.

    Deliberately NOT checked here: "no two edges share an evidence_fact_id"
    (see module docstring for the live-corpus evidence this would fail on
    correct data and is dropped).

    Returns: ok, checked, passed, failures [(grain, reason)].
    """
    import psycopg

    from govbudget.lineage.extract import _SENT, _window_is_negated

    edges = _load_edges(dsn)
    stated = [e for e in edges if e.confidence == "stated"]

    with psycopg.connect(dsn) as con:
        fid_to_bodies = _load_narrative_index(con)

    failures: list[tuple[str, str]] = []
    checked = 0
    for e in stated:
        sent = e.evidence_sentence
        if not sent or not e.evidence_fact_id:
            continue  # leg (a) already reports a missing/absent citation
        checked += 1
        bodies = fid_to_bodies.get(e.evidence_fact_id) or []
        negated = False
        for body in bodies:
            if sent not in body:
                continue
            sents = _SENT.findall(body)
            for i, s in enumerate(sents):
                if s.strip() != sent:
                    continue
                next_sent = sents[i + 1] if i + 1 < len(sents) else None
                if _window_is_negated(sent, next_sent, e.from_pe_bli, e.to_pe_bli):
                    negated = True
        if negated:
            grain = f"{e.from_pe_bli}->{e.to_pe_bli} ({e.relation})"
            failures.append(
                (grain, f"evidence_sentence retracts itself (or its own"
                        f" immediate successor does): {sent[:160]!r}")
            )

    return {
        "ok": checked > 0 and len(failures) == 0,
        "checked": checked,
        "passed": checked - len(failures),
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Leg (g): artifact cite-resolution — every stated edge's citation resolves in
# the BUILT site, not merely in the warehouse (#29(b), 2026-08-27)
# ---------------------------------------------------------------------------


def _shard_lookup(cite_shard_dir: Path, fact_id: str) -> dict | None:
    """The citation record for `fact_id` from the built cite-shards, or None."""
    shard = cite_shard_dir / f"{fact_id[:2]}.json"
    if not shard.is_file():
        return None
    import json

    try:
        data = json.loads(shard.read_text())
    except (OSError, ValueError):
        return None
    rec = data.get(fact_id) if isinstance(data, dict) else None
    return rec if isinstance(rec, dict) else None


def artifact_cite_leg(dsn: str, program_details_dir, cite_shard_dir) -> dict:
    """Every stated edge's citation resolves in the SHIPPED artifact.

    #29(b) removed the PB2026 extraction fence, which is what previously made
    "a stated edge's <Cite> resolves" true by construction: only one edition
    was citable, so only that edition could be extracted from. Now ten editions
    are extractable and a NEW mechanism (export_site §2b′'s lineage-evidence
    union) is what keeps them citable. A mechanism is not a guarantee, so this
    leg checks the guarantee.

    WHY IT READS THE ARTIFACT AND NOT THE EXPORTER'S INPUTS. Leg (a) re-derives
    evidence_fact_id from detail_narratives — a warehouse fact. It cannot see a
    citation that was never written to a shard, a shard that was not rebuilt, or
    a rail entry whose fact_id drifted from the row it came from. Those are
    exactly the ways a citation dies between the warehouse and the reader, and
    they are invisible to any check that shares the exporter's own idea of what
    is cited. So the contract is asserted against the two files a reader's
    browser actually fetches:

      1. CITE-SHARD. data/site/json/cite-shards/{fid[:2]}.json contains the
         edge's evidence_fact_id, its record's kind is 'jbook_narrative', and
         the record names a source document a reader can open — a non-empty
         sha256 AND a non-empty official_url. A record with neither is a dead
         end wearing a citation's clothes. (A page number is NOT required:
         narrative provenance is best-effort and 16 of the 29 edges shipped
         before this change are pageless, citing the document rather than the
         page. Requiring one here would fail honest, already-shipped rows.)
      2. RAIL ENTRY. For each endpoint that HAS a program_details sidecar, the
         sidecar's lineage rail carries this edge with the SAME fact_id and the
         SAME evidence sentence as the warehouse row. This is what catches a
         stale artifact: a shard can resolve while the page shipped an older
         sentence beside it.

    NON-VACUITY is structural, never a pinned literal. The population IS the
    shipped stated-edge set: zero stated edges is a FAIL, and zero edges
    actually rendered on a page is a FAIL (an artifact where nothing reaches a
    reader would otherwise pass every per-edge check trivially). Edges whose
    endpoints have no program page are counted and reported, not failed —
    they cite correctly and simply have nowhere to render.

    Returns: ok, checked, rendered, unrendered [pairs], failures [(grain, why)].
    """
    import json

    program_details_dir = Path(program_details_dir)
    cite_shard_dir = Path(cite_shard_dir)

    edges = _load_edges(dsn)
    stated = [e for e in edges if e.confidence == "stated"]
    failures: list[tuple[str, str]] = []

    if not stated:
        return {"ok": False, "checked": 0, "rendered": 0, "unrendered": [],
                "failures": [], "reason": "no stated edges to check (vacuous)"}
    if not cite_shard_dir.is_dir():
        return {"ok": False, "checked": 0, "rendered": 0, "unrendered": [],
                "failures": [],
                "reason": f"cite-shard directory missing: {cite_shard_dir}"}
    if not program_details_dir.is_dir():
        return {"ok": False, "checked": 0, "rendered": 0, "unrendered": [],
                "failures": [],
                "reason": f"program_details directory missing: {program_details_dir}"}

    # Rail entries from the built sidecars, keyed by (self_pe, other_pe).
    rail_by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for path in sorted(program_details_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        rail = ((payload or {}).get("lineage") or {}).get("rail") or {}
        self_pe = path.stem
        for side in ("predecessors", "successors"):
            for entry in rail.get(side) or []:
                if isinstance(entry, dict) and entry.get("pe"):
                    rail_by_pair[(self_pe, entry["pe"])].append(entry)

    checked = 0
    rendered = 0
    unrendered: list[str] = []
    for e in stated:
        grain = f"{e.from_pe_bli}->{e.to_pe_bli} ({e.relation})"
        fid = e.evidence_fact_id
        if not fid:
            failures.append((grain, "stated edge has no evidence_fact_id"))
            continue
        checked += 1

        rec = _shard_lookup(cite_shard_dir, fid)
        if rec is None:
            failures.append((
                grain,
                f"evidence_fact_id {fid} is absent from the built cite-shard"
                f" {fid[:2]}.json — the site would render a citation marker that"
                f" resolves to nothing",
            ))
        else:
            if rec.get("kind") != "jbook_narrative":
                failures.append((
                    grain,
                    f"cite-shard record for {fid} has kind"
                    f" {rec.get('kind')!r}, not 'jbook_narrative'",
                ))
            if not rec.get("sha256") or not rec.get("official_url"):
                failures.append((
                    grain,
                    f"cite-shard record for {fid} names no openable source"
                    f" (sha256={rec.get('sha256')!r},"
                    f" official_url={rec.get('official_url')!r})",
                ))

        seen_on_a_page = False
        has_a_page = False
        for self_pe, other_pe in ((e.from_pe_bli, e.to_pe_bli),
                                  (e.to_pe_bli, e.from_pe_bli)):
            if not (program_details_dir / f"{self_pe}.json").is_file():
                continue
            has_a_page = True
            entries = rail_by_pair.get((self_pe, other_pe)) or []
            match = [x for x in entries
                     if (x.get("evidence") or {}).get("fact_id") == fid]
            if not match:
                failures.append((
                    grain,
                    f"/program/{self_pe}/ ships no rail entry for {other_pe}"
                    f" citing {fid} (rail has"
                    f" {[ (x.get('evidence') or {}).get('fact_id') for x in entries ]})",
                ))
                continue
            seen_on_a_page = True
            for x in match:
                shipped = (x.get("evidence") or {}).get("sentence")
                if shipped != e.evidence_sentence:
                    failures.append((
                        grain,
                        f"/program/{self_pe}/ ships an evidence sentence that is"
                        f" not the warehouse row's: {str(shipped)[:100]!r}",
                    ))
        if seen_on_a_page:
            rendered += 1
        elif not has_a_page:
            # NOT the same thing as "no rail entry found", and the first cut of
            # this leg conflated them: it reported "neither endpoint has a
            # program page" for edges that had one and were simply missing from
            # its rail — sending the reader to look for a page that exists. An
            # edge lands here ONLY when neither endpoint has a sidecar at all;
            # the has-a-page-but-no-entry case is already a FAIL above.
            unrendered.append(grain)

    return {
        "ok": checked > 0 and rendered > 0 and not failures,
        "checked": checked,
        "rendered": rendered,
        "unrendered": unrendered,
        "failures": failures,
    }


# ---------------------------------------------------------------------------
# Leg (h): supersession — no shipped stated edge is taken back by a later
# edition (#29(b), 2026-08-27)
# ---------------------------------------------------------------------------


def no_supersession_leg(dsn: str) -> dict:
    """No persisted stated edge is contradicted by a LATER J-book edition.

    Fenced extraction could not raise this question: with one edition in
    scope there was no later book to disagree. Reading PB2017–PB2026 makes
    "true in PB2021, reversed by PB2024" a real shape, and shipping such an
    edge as a current fact would be a lie told with a real citation.

    Imports lineage/extract.py's OWN superseded_reason — the same predicate
    lineage/load.py applies at build time — rather than restating its rules
    here. That discipline is not stylistic: a note shipped false on 179 of 319
    pages in this codebase because the exporter, its gate and its unit test
    each re-implemented one wrong scope and then agreed with each other. A leg
    that re-derives the rule cannot catch the rule being wrong; a leg that
    re-applies it catches the TABLE being wrong, which is what a drift check is
    for. Leg (f) already works this way for self-retraction.

    Non-vacuity: zero stated edges is a FAIL.

    Returns: ok, checked, passed, failures [(grain, reason)].
    """
    import psycopg

    from govbudget.lineage.extract import superseded_reason

    edges = _load_edges(dsn)
    stated = [e for e in edges if e.confidence == "stated"]

    with psycopg.connect(dsn) as con:
        narratives = [
            {"fiscal_year": int(fy), "body": body or ""}
            for fy, body in con.execute(
                """
                select j.fiscal_year, n.body
                  from detail_narratives n
                  join jbook_documents j on j.id = n.document_id
                 where not n.superseded and n.xml_path is not null
                """
            ).fetchall()
        ]

    failures: list[tuple[str, str]] = []
    for e in stated:
        reason = superseded_reason(e, stated, narratives)
        if reason is not None:
            failures.append((f"{e.from_pe_bli}->{e.to_pe_bli} ({e.relation})", reason))

    return {
        "ok": len(stated) > 0 and not failures,
        "checked": len(stated),
        "passed": len(stated) - len(failures),
        "failures": failures,
    }
