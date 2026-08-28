"""Lineage flow payload — the /lineage/ identity diagram (ROADMAP #29(c)).

WHAT THIS IS, AND THE ONE THING IT REFUSES TO BE.

#29(c) asks for "a lineage Sankey — reuse the /flow/ renderer — identities as
nodes over time, dollar ribbons for transfers/splits/merges". The first half is
built here. The second half is NOT, and the refusal is the load-bearing part of
this module:

    A Sankey ribbon's width is a dollar amount. The lineage layer's edges are
    narrative assertions about IDENTITY ("PE 0604818A was realigned from PE
    0203728A"), and not one of them carries a transferred amount:
    program_lineage.portion_amount is non-null on ZERO rows, today and at every
    build since the table was created. There is no number to draw.

So every ribbon this module emits is exactly ``RIBBON_W`` units thick, on both
faces, for every edge, in every family. The width encodes nothing because
nothing was stated. That is not a placeholder waiting for real widths — it is
the honest rendering of an identity assertion, and ``verify-lineage`` leg (i)
plus gate 22 leg (g) both measure the BUILT artifact to hold it there.

If ``portion_amount`` ever becomes non-null (that is #29(a)/(d) work), this
module must be changed deliberately: the edge gains an ``amt`` field, the gate's
"every band is RIBBON_W" clause exempts exactly the edges that carry ``amt``,
and the renderer must make a dollar-bearing ribbon read differently from an
identity-only one. Until then ``build_lineage_flow`` RAISES on a non-null
portion_amount rather than silently drawing it as if it were nothing.

WHY THE COLUMNS ARE NOT CALENDAR YEARS. "Identities as nodes over time" invites
an x-axis of fiscal years. Measured against the live data, that axis would lie:
family 11's six DARPA identities ALL carry a request in every FY2017–FY2025,
and family 15's four all start in FY2017 — predecessors and successors coexist
for whole decades, which is exactly why the family funding line refuses to sum
them. Positioning a successor to the right of its predecessor ON A YEAR AXIS
would assert a hand-off date the record does not contain. The columns are
therefore LINEAGE STEPS (longest-path depth over stated edges), the ordering the
documents actually assert, and each ribbon carries the J-book EDITION that
asserts it — which is what ``fiscal_year`` on a lineage edge means (see the
ROADMAP #29(b) note: "an edge's fiscal_year is the edition asserting it, not the
year money moved").

WHAT MONEY IS ON THE PAGE. Not on the ribbons: in the table, one column, one
fiscal year — each identity's own FY2026 request fact, cited, with the same
(basis, fy, measure, entity, edition) declaration the family funding line
already uses. A node-level figure is a fact; an edge-level figure is not.
Identities with no FY2026 request point render an absence, never a zero.

Pure module: no DB, no network, no config. Unit-testable in isolation, and the
caller (export_site step 19b) supplies every input.
"""

from __future__ import annotations

from collections import defaultdict

# ---------------------------------------------------------------------------
# Layout constants (viewBox units). These are the BINDING geometry contract —
# gate 22 leg (g) re-measures the built SVG path strings against RIBBON_W.
# ---------------------------------------------------------------------------

#: Every ribbon band is exactly this thick on BOTH faces. Never derived from a
#: value, because no value exists. Gate 22 leg (g) parses the built `d=` and
#: fails on any deviation.
RIBBON_W = 8.0

#: Identity box. Uniform for every node — a node's size encodes nothing either
#: (in a Sankey, node height is normally a value; here it must not be).
NODE_W = 120.0
NODE_H = 40.0

#: Column pitch = NODE_W + COL_GAP; row pitch inside a column.
COL_GAP = 84.0
ROW_PITCH = 66.0

#: Outer padding so strokes are not clipped by the viewBox edge.
PAD = 5.0

#: Max identity-title characters inside a box before an explicit ellipsis.
#: Deliberate truncation with a "…" reads as truncation; a clipped word reads
#: as a rendering bug (PM Sprint 3 round-1 judging, "Research, Developi").
TITLE_CHARS = 23

#: The one fiscal year the money column publishes. A single FY keeps the table
#: column's (basis, fy, measure) declaration uniform, which is what gate 23
#: leg (e) joins on — a per-row "latest available year" column could not be
#: declared at all.
AMOUNT_FY = 2026
AMOUNT_MEASURE = "request"

#: Payload ceiling. The whole point of this sidecar is that it is small: 80
#: identities and 52 edges with no sentences and no per-year series.
PAYLOAD_BUDGET_BYTES = 160_000


def _short_title(title: str | None) -> str | None:
    if not title:
        return None
    t = " ".join(title.split())
    if len(t) <= TITLE_CHARS:
        return t
    return t[: TITLE_CHARS - 1].rstrip() + "…"


def _assign_steps(members: list[str], edges: list) -> tuple[dict[str, int], bool]:
    """Longest-path depth over the family's stated edges.

    Kahn's algorithm on the DAG; a node's step is ``max(step(pred)) + 1`` so a
    fan-in lands to the RIGHT of every source that feeds it (family 6's
    four-way merge into 0303005F is the case that matters). Returns
    ``(step_by_pe, cyclic)``.

    CYCLES ARE REAL HERE, not defensive coding: the 5I review recorded
    reciprocal cross-FY stated edges that hung the exporter's chain walk until a
    cycle guard was added. Any node Kahn cannot drain is placed one column past
    the deepest drained node, in sorted order, and the family is flagged
    ``cyclic`` so the page can say so rather than draw a confident line through
    a contradiction.
    """
    member_set = set(members)
    indeg: dict[str, int] = {m: 0 for m in members}
    succs: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        if e.from_pe_bli not in member_set or e.to_pe_bli not in member_set:
            continue
        succs[e.from_pe_bli].append(e.to_pe_bli)
        indeg[e.to_pe_bli] += 1

    step: dict[str, int] = {m: 0 for m in members}
    queue = sorted(m for m in members if indeg[m] == 0)
    drained: set[str] = set()
    while queue:
        n = queue.pop(0)
        drained.add(n)
        for t in sorted(succs.get(n, [])):
            if step[n] + 1 > step[t]:
                step[t] = step[n] + 1
            indeg[t] -= 1
            if indeg[t] == 0:
                queue.append(t)
                queue.sort()

    stuck = [m for m in members if m not in drained]
    if stuck:
        parked = max((step[m] for m in drained), default=-1) + 1
        for m in sorted(stuck):
            step[m] = parked
    return step, bool(stuck)


def _face_bands(count: int, center_y: float) -> list[tuple[float, float]]:
    """``count`` contiguous RIBBON_W bands, centered on a node face.

    RAISES when they cannot fit inside NODE_H. Silently overflowing would draw
    ribbons hanging off their own node, which reads as a rendering error on a
    diagram whose entire claim is that its geometry is meaningless-by-design.
    """
    total = count * RIBBON_W
    if total > NODE_H + 1e-9:
        raise ValueError(
            f"lineage flow: {count} ribbons x {RIBBON_W} = {total} exceeds the"
            f" {NODE_H}-unit node face. Raise NODE_H (and re-measure the page"
            f" weight) or lower RIBBON_W — do NOT let bands overflow the node,"
            f" and do NOT make this node taller than its siblings (a node whose"
            f" height varies reads as a value)."
        )
    top = center_y - total / 2.0
    return [(top + i * RIBBON_W, top + (i + 1) * RIBBON_W) for i in range(count)]


def _r(v: float) -> float:
    return round(v * 100) / 100


def _layout(
    *,
    members: list[str],
    edges: list,
    titles_by_pe: dict[str, str],
    page_pes: set[str],
    amounts_by_pe: dict[str, dict],
) -> dict:
    """Node rects + ribbon bands for ONE connected component."""
    step, cyclic = _assign_steps(members, edges)
    by_step: dict[int, list[str]] = defaultdict(list)
    for m in members:
        by_step[step[m]].append(m)
    for s in by_step:
        by_step[s].sort()

    index_of: dict[str, int] = {}
    nodes: list[dict] = []
    for s in sorted(by_step):
        for row, pe in enumerate(by_step[s]):
            x0 = PAD + s * (NODE_W + COL_GAP)
            y0 = PAD + row * ROW_PITCH
            index_of[pe] = len(nodes)
            nodes.append(
                {
                    "pe": pe,
                    "title": titles_by_pe.get(pe),
                    "short": _short_title(titles_by_pe.get(pe)),
                    "step": s,
                    "x0": _r(x0),
                    "x1": _r(x0 + NODE_W),
                    "y0": _r(y0),
                    "y1": _r(y0 + NODE_H),
                    "resolved": pe in page_pes,
                    "amount": amounts_by_pe.get(pe),
                }
            )

    member_set = set(members)
    live = [
        e
        for e in edges
        if e.from_pe_bli in member_set and e.to_pe_bli in member_set
    ]
    # Deterministic ribbon order on each face: by the OTHER endpoint's laid-out
    # position, so bands do not cross each other needlessly.
    def _key(e, other: str) -> tuple:
        n = nodes[index_of[other]]
        return (n["step"], n["y0"], other, e.relation, e.fiscal_year)

    out_by: dict[str, list] = defaultdict(list)
    in_by: dict[str, list] = defaultdict(list)
    for e in live:
        out_by[e.from_pe_bli].append(e)
        in_by[e.to_pe_bli].append(e)
    for pe in out_by:
        out_by[pe].sort(key=lambda e: _key(e, e.to_pe_bli))
    for pe in in_by:
        in_by[pe].sort(key=lambda e: _key(e, e.from_pe_bli))

    src_bands: dict[int, tuple[float, float]] = {}
    tgt_bands: dict[int, tuple[float, float]] = {}
    for pe, es in out_by.items():
        n = nodes[index_of[pe]]
        bands = _face_bands(len(es), (n["y0"] + n["y1"]) / 2.0)
        for e, b in zip(es, bands):
            src_bands[id(e)] = b
    for pe, es in in_by.items():
        n = nodes[index_of[pe]]
        bands = _face_bands(len(es), (n["y0"] + n["y1"]) / 2.0)
        for e, b in zip(es, bands):
            tgt_bands[id(e)] = b

    out_edges: list[dict] = []
    for e in sorted(
        live,
        key=lambda e: (
            nodes[index_of[e.from_pe_bli]]["step"],
            e.from_pe_bli,
            e.to_pe_bli,
            e.relation,
            e.fiscal_year,
        ),
    ):
        sy0, sy1 = src_bands[id(e)]
        ty0, ty1 = tgt_bands[id(e)]
        out_edges.append(
            {
                "s": index_of[e.from_pe_bli],
                "t": index_of[e.to_pe_bli],
                "relation": e.relation,
                "fy": int(e.fiscal_year),
                "confidence": e.confidence,
                "fid": e.evidence_fact_id if e.confidence == "stated" else None,
                "g": [_r(sy0), _r(sy1), _r(ty0), _r(ty1)],
            }
        )

    max_step = max(step.values()) if step else 0
    max_rows = max((len(v) for v in by_step.values()), default=1)
    width = _r(PAD * 2 + (max_step + 1) * NODE_W + max_step * COL_GAP)
    height = _r(PAD * 2 + (max_rows - 1) * ROW_PITCH + NODE_H)
    return {
        "cyclic": cyclic,
        "steps": max_step + 1,
        "width": width,
        "height": height,
        "nodes": nodes,
        "edges": out_edges,
    }


def build_lineage_flow(
    *,
    edges: list,
    families: dict[str, int],
    titles_by_pe: dict[str, str],
    page_pes: set[str],
    decade_series_by_pe: dict[str, dict],
    cited_fact_ids: set[str],
) -> dict:
    """Build the /lineage/ payload.

    ``edges``    every LineageEdge (stated AND inferred) in the lake.
    ``families`` pe_bli -> family_id, the STATED connected components.
    ``page_pes`` the PE universe that has a built /program/ page (a node not in
                 it renders as an unresolved reference, never a link).
    ``decade_series_by_pe`` export_site's per-PE decade points; the FY2026
                 ``request`` point supplies the table's one money column.
    ``cited_fact_ids`` the cite-shard universe; a figure whose fact_id is not
                 in it is DROPPED rather than shipped uncited.
    """
    for e in edges:
        if getattr(e, "portion_amount", None) is not None:
            raise ValueError(
                f"lineage flow: edge {e.from_pe_bli}->{e.to_pe_bli} carries"
                f" portion_amount={e.portion_amount!r}. This module draws every"
                " ribbon at one constant width because no lineage edge states a"
                " transferred amount. A stated amount now exists, so the"
                " diagram must be changed deliberately (edge gains `amt`; the"
                " gate's constant-width clause exempts amt-bearing edges; the"
                " renderer must make a dollar-bearing ribbon read differently)"
                " — refusing to draw a stated amount as if it were nothing."
            )

    stated = [e for e in edges if e.confidence == "stated"]
    inferred = [e for e in edges if e.confidence != "stated"]

    # Every identity the page draws: family members PLUS the endpoints of the
    # inferred candidates, which are NOT in any family (families are the STATED
    # connected components — an inferred edge never creates one).
    identities = sorted(
        set(families)
        | {e.from_pe_bli for e in inferred}
        | {e.to_pe_bli for e in inferred}
    )

    # ---- the one money column: each identity's FY2026 request fact --------
    amounts_by_pe: dict[str, dict] = {}
    for pe in identities:
        for pt in decade_series_by_pe.get(pe, {}).get("request", []):
            if pt.get("fy") != AMOUNT_FY:
                continue
            fid = pt.get("fid")
            if fid is None or fid not in cited_fact_ids:
                continue
            if pt.get("measure") != AMOUNT_MEASURE:
                # A grain whose mapped measure diverges from "request" cannot
                # sit in a column declaring measure=request (the (fy, measure)
                # group gate 23 leg e joins on). Omitted, not relabelled.
                continue
            amounts_by_pe[pe] = {
                "v": pt["v"],
                "fid": fid,
                "fy": pt["fy"],
                "edition": pt.get("edition"),
                "basis": pt.get("basis"),
                "measure": pt.get("measure"),
            }
            break

    members_by_family: dict[int, list[str]] = defaultdict(list)
    for pe, fam_id in families.items():
        members_by_family[fam_id].append(pe)

    stated_by_family: dict[int, list] = defaultdict(list)
    for e in stated:
        fam_id = families.get(e.from_pe_bli, families.get(e.to_pe_bli))
        if fam_id is not None:
            stated_by_family[fam_id].append(e)

    out_families: list[dict] = []
    for fam_id in sorted(members_by_family):
        members = sorted(members_by_family[fam_id])
        fam_edges = stated_by_family.get(fam_id, [])
        laid = _layout(
            members=members,
            edges=fam_edges,
            titles_by_pe=titles_by_pe,
            page_pes=page_pes,
            amounts_by_pe=amounts_by_pe,
        )
        in_deg: dict[str, int] = defaultdict(int)
        out_deg: dict[str, int] = defaultdict(int)
        for e in fam_edges:
            in_deg[e.to_pe_bli] += 1
            out_deg[e.from_pe_bli] += 1
        roots = sorted(m for m in members if in_deg[m] == 0)
        # has_split mirrors _emit_lineage's rule EXACTLY (labelled split/merge,
        # or any stated fan-out, or any stated fan-in): the same sentence about
        # branching must be true on both surfaces.
        has_split = (
            any(e.relation in ("split", "merged") for e in fam_edges)
            or any(out_deg[m] > 1 for m in members)
            or any(in_deg[m] > 1 for m in members)
        )
        out_families.append(
            {
                "family_id": fam_id,
                "root": roots[0] if roots else min(members),
                "has_split": has_split,
                **laid,
            }
        )

    # ---- inferred candidates: their own 2-node diagrams, never in a family --
    # The rail pools inferred edges into one collapsed, opt-in disclosure and
    # never mixes them into the stated chain. This page keeps that separation
    # literal: a candidate is not drawn in the same picture as a fact.
    candidates: list[dict] = []
    for e in sorted(
        inferred, key=lambda e: (e.from_pe_bli, e.to_pe_bli, e.fiscal_year)
    ):
        pair = [e.from_pe_bli, e.to_pe_bli]
        laid = _layout(
            members=pair,
            edges=[e],
            titles_by_pe=titles_by_pe,
            page_pes=page_pes,
            amounts_by_pe=amounts_by_pe,
        )
        candidates.append(
            {
                "basis": e.inference_basis,
                **laid,
            }
        )

    return {
        "schema_version": 1,
        "ribbon_w": RIBBON_W,
        "node_w": NODE_W,
        "node_h": NODE_H,
        "amount_fy": AMOUNT_FY,
        "amount_measure": AMOUNT_MEASURE,
        "counts": {
            "stated_edges": len(stated),
            "inferred_edges": len(inferred),
            "families": len(out_families),
            "identities": len(identities),
            "identities_linked": sum(1 for p in identities if p in page_pes),
            "identities_unresolved": sum(
                1 for p in identities if p not in page_pes
            ),
            "identities_with_amount": sum(
                1 for p in identities if p in amounts_by_pe
            ),
        },
        "families": out_families,
        "candidates": candidates,
    }
