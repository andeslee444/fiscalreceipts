"""Program families = connected components over STATED edges only (spec §3).

The funding line (Task 5) sums only the 1:1 chain: a run of stated edges where each hop's
predecessor has exactly one stated out-edge and each successor exactly one stated in-edge,
and neither hop is a split/merge. This helper returns that chain from a start PE.
"""
from __future__ import annotations
from collections import defaultdict
from govbudget.lineage.model import LineageEdge

def build_families(edges: list[LineageEdge]) -> dict[str, int]:
    parent: dict[str, str] = {}
    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)
    for e in edges:
        if e.confidence != "stated":
            continue
        union(e.from_pe_bli, e.to_pe_bli)
    roots = {n: find(n) for n in parent}
    ids = {r: i for i, r in enumerate(sorted(set(roots.values())))}
    return {n: ids[r] for n, r in roots.items()}

def one_to_one_chain(start: str, edges: list[LineageEdge]) -> list[str]:
    stated = [e for e in edges if e.confidence == "stated"]
    out_deg: dict[str, int] = defaultdict(int)
    in_deg: dict[str, int] = defaultdict(int)
    nxt: dict[str, str] = {}
    # out_deg/in_deg/nxt are rebuilt per call; Task 6 calls this once per family, so this is intentional.
    for e in stated:
        out_deg[e.from_pe_bli] += 1
        in_deg[e.to_pe_bli] += 1
    for e in stated:
        # a labeled split/merge, or a PARTIAL transfer (portion_amount set), ends the
        # 1:1 line even at degree 1:1 (spec §5.3: partial transfers never reparent the line)
        if e.relation in ("split", "merged") or e.portion_amount is not None:
            continue
        nxt.setdefault(e.from_pe_bli, e.to_pe_bli)
    chain = [start]
    seen = {start}
    cur = start
    while cur in nxt:
        succ = nxt[cur]
        if out_deg[cur] != 1 or in_deg[succ] != 1 or succ in seen:
            break  # split, merge, or cycle → stop honestly
        chain.append(succ); seen.add(succ); cur = succ
    return chain
