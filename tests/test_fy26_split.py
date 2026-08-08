"""FY2026 discretionary/reconciliation split — backlog #50 (Task A'4).

The site's FY2026 "Request" figure is disc + reconciliation with no visible
seam: $89.01B of the $385.27B FY2026 corpus total is one-time
reconciliation-bill money, and a YoY rate computed on that combined basis is
not a rate of anything a reader can extrapolate. build_fy26_split is the pure
math; the exporter attaches its output (plus citation-bearing sides) to each
program's program_details sidecar under `fy26_split`.
"""

from govbudget.export_site import build_fy26_split


def test_split_reports_both_components_and_the_discretionary_change():
    s = build_fy26_split(
        fy25_enacted_k=244_121.0, disc_k=1_916.0, recon_k=7_695_000.0
    )
    assert s["total_k"] == 7_696_916.0
    assert s["recon_share"] > 0.999
    assert s["disc_pct_change"] == -99.2
    assert s["has_reconciliation"] is True


def test_a_pure_discretionary_line_carries_no_split():
    s = build_fy26_split(fy25_enacted_k=100.0, disc_k=150.0, recon_k=0.0)
    assert s["has_reconciliation"] is False
    assert s["disc_pct_change"] == 50.0


def test_absent_prior_year_yields_no_change_rather_than_a_fabricated_one():
    """A program with no FY2025 enacted figure has no percentage change — the
    site must render an absence, never a change computed against zero."""
    s = build_fy26_split(fy25_enacted_k=None, disc_k=150.0, recon_k=0.0)
    assert s["disc_pct_change"] is None
