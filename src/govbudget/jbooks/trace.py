"""Gate 6: the holistic trace — budget line -> reconciled detail -> crosswalk
-> award in the lake -> recipient. Every hop must be non-empty; the first
missing hop is reported by name.

Confidence tiers (v1 behaviour, recorded in commit body):
- Preferred: high or medium confidence crosswalk links.
- Fallback: low-confidence (account-level) links are accepted when no
  high/medium link exists for the PE. When low-tier satisfies the crosswalk
  hop the result records a note so callers can surface the tier honestly.
"""
import duckdb
import psycopg


def trace_gate(dsn: str, *, pe_blis: list[str], award_glob: str) -> dict:
    """Walk every hop for each PE in pe_blis.

    Returns:
        {
            "traced": int,           # count of fully-traced PEs
            "failed": list[tuple],   # (pe_bli, hop_description) for each failure
            "notes": list[str],      # informational notes (e.g. low-tier fallbacks)
        }
    """
    traced = 0
    failed: list[tuple[str, str]] = []
    notes: list[str] = []
    con = duckdb.connect()
    try:
        with psycopg.connect(dsn) as pg:
            for pe in pe_blis:
                # Hop 1: budget line exists
                line = pg.execute(
                    "select 1 from budget_lines where pe_bli=%s limit 1", (pe,)
                ).fetchone()
                if not line:
                    failed.append((pe, "budget_line missing"))
                    continue

                # Hop 2: reconciled detail exists
                detail = pg.execute(
                    "select 1 from budget_line_details where pe_bli=%s"
                    " and not superseded and reconciled limit 1", (pe,)
                ).fetchone()
                if not detail:
                    failed.append((pe, "reconciled detail missing"))
                    continue

                # Hop 3: crosswalk link — prefer high/medium, fall back to low
                links_hm = pg.execute(
                    "select award_piid, confidence from budget_line_awards"
                    " where pe_bli=%s and confidence in ('high','medium')", (pe,)
                ).fetchall()
                tier_used = None
                if links_hm:
                    links = links_hm
                    tier_used = "high/medium"
                else:
                    # Low-tier fallback: account-level funding linkage is real
                    # evidence even without title-token overlap.
                    links_low = pg.execute(
                        "select award_piid, confidence from budget_line_awards"
                        " where pe_bli=%s and confidence='low'", (pe,)
                    ).fetchall()
                    if links_low:
                        links = links_low
                        tier_used = "low"
                        notes.append(
                            f"{pe}: crosswalk hop satisfied by low-confidence"
                            " (account-level) links — no high/medium links found"
                        )
                    else:
                        links = []

                if not links:
                    failed.append((pe, "crosswalk link missing"))
                    continue

                # Hop 4: award/recipient present in the lake parquet
                piids = [p for p, _ in links]
                try:
                    found = con.execute(
                        f"select count(*) from read_parquet('{award_glob}', union_by_name=true)"
                        " where award_id_piid = any(?) and recipient_name is not null",
                        [piids],
                    ).fetchone()[0]
                except duckdb.IOException:
                    found = 0

                if not found:
                    failed.append((pe, "award/recipient missing in lake"))
                    continue

                traced += 1
    finally:
        con.close()
    return {"traced": traced, "failed": failed, "notes": notes}
