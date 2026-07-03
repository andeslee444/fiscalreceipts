"""yearsmatrix-recompute.py — G8 leg (a) helper.

Recomputes sampled /years/ matrix cells INDEPENDENTLY from the parquet lake
(data/site/data/budget_lines.parquet + jbook_details.parquet) so the gate can
compare the rendered payload against a from-source recomputation — the same
trust chain the exporter claims (trajectory pivot == sum of titled detail
lines; project cells == jbook_details rows).

Invoked by site/scripts/gates/yearsmatrix.mjs:
    uv run python site/scripts/gates/yearsmatrix-recompute.py <request.json>

Request JSON:
    {
      "programs": [{"pe_bli": ..., "org": <section org>, "at": <amount_type>}],
      "deltas":   [{"pe_bli": ..., "org": <section org>}],
      "projects": [{"pe_bli": ..., "project_number": ..., "scenario": ...}]
    }

Response JSON (stdout):
    {
      "programs": {"{pe_bli}|{org}|{at}": float|null},
      "deltas":   {"{pe_bli}|{org}": float|null},
      "projects": {"{pe_bli}|{project_number}|{scenario}": float|null}
    }

Program cells: sum(amount_thousands) over budget_lines.parquet detail rows
(title IS NOT NULL — the rollup+detail dedup rule) for
(pe_bli, workbook_org(org), amount_type); null when no rows.
Deltas: fy_2026_total sum − fy_2025_total sum; null unless both exist.
Project cells: jbook_details.parquet amount_millions for
(pe_bli, project_number, scenario) — LAST row in file order (mirrors the
exporter's last-wins dedup, which mirrors the program-page scenarioMap).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb

from govbudget.config import ROOT
from govbudget.jbooks.orgs import workbook_org

BL_PARQUET = ROOT / "data" / "site" / "data" / "budget_lines.parquet"
JD_PARQUET = ROOT / "data" / "site" / "data" / "jbook_details.parquet"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: yearsmatrix-recompute.py <request.json>", file=sys.stderr)
        return 2
    request = json.loads(Path(sys.argv[1]).read_text())

    if not BL_PARQUET.exists() or not JD_PARQUET.exists():
        print(
            f"parquet lake missing: {BL_PARQUET} / {JD_PARQUET}",
            file=sys.stderr,
        )
        return 2

    con = duckdb.connect()
    bl = str(BL_PARQUET).replace("'", "''")
    jd = str(JD_PARQUET).replace("'", "''")

    def _sum_lines(pe_bli: str, org: str, at: str):
        row = con.execute(
            f"select sum(amount_thousands) from read_parquet('{bl}')"
            " where pe_bli = ? and organization = ? and amount_type = ?"
            " and title is not null",
            [pe_bli, workbook_org(org), at],
        ).fetchone()
        return float(row[0]) if row and row[0] is not None else None

    out: dict = {"programs": {}, "deltas": {}, "projects": {}}

    for req in request.get("programs", []):
        pe, org, at = req["pe_bli"], req["org"], req["at"]
        out["programs"][f"{pe}|{org}|{at}"] = _sum_lines(pe, org, at)

    for req in request.get("deltas", []):
        pe, org = req["pe_bli"], req["org"]
        fy25 = _sum_lines(pe, org, "fy_2025_total")
        fy26 = _sum_lines(pe, org, "fy_2026_total")
        out["deltas"][f"{pe}|{org}"] = (
            fy26 - fy25 if fy25 is not None and fy26 is not None else None
        )

    for req in request.get("projects", []):
        pe, pn, scenario = req["pe_bli"], req["project_number"], req["scenario"]
        row = con.execute(
            f"select amount_millions from read_parquet('{jd}', file_row_number=true)"
            " where pe_bli = ? and project_number = ? and scenario = ?"
            " order by file_row_number desc limit 1",
            [pe, pn, scenario],
        ).fetchone()
        out["projects"][f"{pe}|{pn}|{scenario}"] = (
            float(row[0]) if row and row[0] is not None else None
        )

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
