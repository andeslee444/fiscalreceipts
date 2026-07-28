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

All gate functions take explicit DSNs/paths — never read config. No network.
Exit code 0 iff all three legs pass; nonzero otherwise.
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

    # Degree bookkeeping over the STATED edges + a map from each stated
    # successor PE to the edge(s) that introduced it (its incoming edges).
    in_deg: dict[str, int] = defaultdict(int)
    out_deg: dict[str, int] = defaultdict(int)
    incoming: dict[str, list[LineageEdge]] = defaultdict(list)
    for e in stated:
        in_deg[e.to_pe_bli] += 1
        out_deg[e.from_pe_bli] += 1
        incoming[e.to_pe_bli].append(e)

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

        # SUMMABILITY: root must resolve in the request series.
        if root not in req_pes:
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
        "failures": failures,
    }
