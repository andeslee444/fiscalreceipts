import signal
from contextlib import contextmanager

import pytest

from govbudget.lineage.family import build_families, one_to_one_chain
from govbudget.lineage.model import LineageEdge

def _e(a, b, conf="stated", rel="renamed"):
    return LineageEdge(from_pe_bli=a, to_pe_bli=b, fiscal_year=2024, relation=rel, confidence=conf)

@contextmanager
def _hard_timeout(seconds: int):
    """Turn an infinite loop into a test failure instead of a hung suite.

    Uses SIGALRM so we depend on nothing beyond the stdlib (no pytest-timeout).
    """
    def _raise(signum, frame):
        pytest.fail(f"one_to_one_chain did not terminate within {seconds}s (cycle guard regressed)")
    old = signal.signal(signal.SIGALRM, _raise)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)

def test_families_are_connected_components_over_stated_edges_only():
    edges = [_e("A", "B"), _e("B", "C"), _e("X", "Y"),
             _e("C", "Q", conf="inferred")]  # inferred must NOT merge families
    fams = build_families(edges)             # {pe_bli: family_id}
    assert fams["A"] == fams["B"] == fams["C"]
    assert fams["X"] == fams["Y"] != fams["A"]
    assert "Q" not in fams                    # inferred edge did not create a family

def test_one_to_one_chain_excludes_splits_and_merges():
    # A->B is 1:1; B splits to C and D  => chain is [A, B], stops at the split.
    edges = [_e("A", "B"), _e("B", "C", rel="split"), _e("B", "D", rel="split")]
    assert one_to_one_chain("A", edges) == ["A", "B"]

def test_one_to_one_chain_terminates_on_a_cycle():
    # reciprocal stated edges A<->B across years must not loop forever
    edges = [_e("A", "B"), _e("B", "A")]
    with _hard_timeout(5):
        chain = one_to_one_chain("A", edges)
    assert chain == ["A", "B"]  # walks once, then stops when it would revisit A
