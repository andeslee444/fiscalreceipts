"""Generate the ROADMAP #55 flagship-alias curation worksheet.

READ-ONLY: opens the warehouse with read_only=True, makes no network call, and
writes exactly one file (the CSV next to this script). Runnable from anywhere:

    uv run python docs/curation/regen_roadmap_55_worksheet.py

See docs/curation/README.md for the column contract and the provenance of the
term list.
"""
import csv, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
import duckdb
from govbudget.jbooks.orgs import workbook_org

DB = ROOT / "data" / "duckdb" / "govbudget.duckdb"
OUT = Path(__file__).resolve().parent / "roadmap-55-flagship-alias-worksheet.csv"

# Flagship product names, annotated by prime. This is a SUPERSET of the 31 terms
# the 2026-08-21 investigation used (that list was never written down); the nine
# terms whose candidate counts the ROADMAP recorded are reproduced exactly by the
# substring rule below, which is how we know the method matches.
TERMS = [
    # --- RTX (Raytheon / Pratt & Whitney / Collins) ---
    ("Patriot", "RTX"), ("AMRAAM", "RTX"), ("ESSM", "RTX"), ("RAM", "RTX"),
    ("Tomahawk", "RTX"), ("Standard Missile", "RTX"), ("SM-6", "RTX"),
    ("Stinger", "RTX"), ("Javelin", "RTX (JV w/ Lockheed)"), ("TOW", "RTX"),
    ("Excalibur", "RTX"), ("StormBreaker", "RTX"), ("LTAMDS", "RTX"),
    ("NASAMS", "RTX"), ("SPY-6", "RTX"), ("Coyote", "RTX"), ("Paveway", "RTX"),
    ("JSOW", "RTX"), ("Griffin", "RTX"), ("Sidewinder", "RTX"), ("Maverick", "RTX"),
    ("F135", "RTX (Pratt & Whitney)"), ("F119", "RTX (Pratt & Whitney)"),
    ("Next Generation Jammer", "RTX"),
    # --- Boeing ---
    ("F/A-18", "Boeing"), ("Super Hornet", "Boeing"), ("KC-46", "Boeing"),
    ("Apache", "Boeing"), ("AH-64", "Boeing"), ("Chinook", "Boeing"),
    ("CH-47", "Boeing"), ("P-8", "Boeing"), ("Poseidon", "Boeing"),
    ("Harpoon", "Boeing"), ("SLAM-ER", "Boeing"), ("JDAM", "Boeing"),
    ("T-7A", "Boeing"), ("MQ-25", "Boeing"), ("E-7", "Boeing"),
    ("Wedgetail", "Boeing"), ("V-22", "Bell-Boeing"), ("Osprey", "Bell-Boeing"),
    ("F-15EX", "Boeing"), ("B-52", "Boeing"), ("C-17", "Boeing"),
    ("Small Diameter Bomb", "Boeing"),
    # --- Northrop Grumman (the 'Sentinel' case the ROADMAP calls out) ---
    ("Sentinel", "Northrop Grumman"), ("GBSD", "Northrop Grumman"),
    ("B-21", "Northrop Grumman"), ("Global Hawk", "Northrop Grumman"),
    ("Triton", "Northrop Grumman"), ("E-2D", "Northrop Grumman"),
    ("IBCS", "Northrop Grumman"), ("AARGM", "Northrop Grumman"),
    # --- Lockheed (F-35/JSF already seeded; these remain open) ---
    ("Hellfire", "Lockheed Martin"), ("PAC-3", "Lockheed Martin"),
    ("JASSM", "Lockheed Martin"), ("HIMARS", "Lockheed Martin"),
    ("GMLRS", "Lockheed Martin"), ("Trident", "Lockheed Martin"),
    # --- already seeded in dbt/seeds/program_aliases.csv, included so the
    #     worksheet doubles as an audit of the existing seed (seed_conflict) ---
    ("C-130J", "Lockheed Martin — SEEDED"), ("JADC2", "n/a — SEEDED"),
    ("C2BMC", "Lockheed Martin — SEEDED"), ("THAAD", "Lockheed Martin — SEEDED"),
    ("Aegis", "Lockheed Martin — SEEDED"), ("Iron Dome", "RTX/Rafael — SEEDED"),
    ("GBI", "Boeing — SEEDED"), ("SBX", "Boeing/Raytheon — SEEDED"),
    ("MQ-9", "General Atomics — SEEDED"), ("CV-22", "Bell-Boeing — SEEDED"),
    ("F-35", "Lockheed Martin — SEEDED"), ("JSF", "Lockheed Martin — SEEDED"),
]
# Counts the ROADMAP (#55 remainder note, 2026-08-21) recorded — used as a self-check.
ROADMAP_COUNTS = {"PATRIOT":2,"AMRAAM":3,"TOMAHAWK":2,"F/A-18":2,"KC-46":2,
                  "APACHE":2,"HELLFIRE":3,"ESSM":8,"RAM":89,
                  "SENTINEL":1,"HARPOON":1,"STINGER":1}

con = duckdb.connect(str(DB), read_only=True)
progs = con.execute(
    "select distinct pe_bli, title, org, account, account_title"
    " from dim_programs where title is not null").fetchall()
traj = {(r[0], r[1], r[2]): (r[3], r[4], r[5]) for r in con.execute(
    "select pe_bli, organization, account, fy2026_total, fy2025_total, fy2024_actuals"
    " from fct_budget_trajectory").fetchall()}
seeded = {a.upper(): pe for a, pe in con.execute(
    "select alias, pe_bli from program_aliases").fetchall()}
lob = dict(con.execute(
    "select pe_bli, count(*) from fct_program_lobbying group by 1").fetchall())
lob_kinds = {}
for pe, k, n in con.execute(
        "select pe_bli, evidence_kind, count(*) from fct_program_lobbying"
        " group by 1,2").fetchall():
    lob_kinds.setdefault(pe, {})[k] = n
con.close()

by_pe_org = {}
for (p, o, a), v in traj.items():
    by_pe_org.setdefault((p, o), []).append(v)

def money(pe, org, account):
    wo = workbook_org(org)
    v = traj.get((pe, wo, account))
    if v is None and account is None:
        c = by_pe_org.get((pe, wo), [])
        if len(c) == 1:
            v = c[0]
    return v or (None, None, None)

rows, summary = [], []
for term, vendor in TERMS:
    up = term.upper()
    cands = [p for p in progs if up in (p[1] or "").upper()]
    n = len({p[0] for p in cands})
    tier = ("no_title_match" if n == 0 else "sole_match" if n == 1
            else "ambiguous" if n <= 8 else "unusable_too_many")
    chk = ""
    if up in ROADMAP_COUNTS:
        chk = "matches ROADMAP" if n == ROADMAP_COUNTS[up] else f"DIFFERS (roadmap {ROADMAP_COUNTS[up]})"
    summary.append((term, vendor, n, tier, chk))
    seeded_pe = seeded.get(up, "")
    if not cands:
        rows.append(dict(alias_term=term, vendor=vendor, n_candidates=0,
            curation_tier=tier, roadmap_crosscheck=chk, candidate_pe_bli="",
            candidate_title="", org="", account="", account_title="",
            fy2026_total_thousands="", fy2025_total_thousands="",
            fy2024_actuals_thousands="", program_page="",
            lobbying_mentions_today="", mention_evidence_kinds="",
            seeded_alias_today=seeded_pe or "none",
            resolves_today="nothing — no curated alias and no title to match",
            auto_pick_would_be="", seed_conflict="", pick="", curator_notes=""))
        continue
    for pe, title, org, account, acct_title in sorted(
            cands, key=lambda r: -(money(r[0], r[2], r[3])[0] or 0)):
        f26, f25, f24 = money(pe, org, account)
        rows.append(dict(
            alias_term=term, vendor=vendor, n_candidates=n, curation_tier=tier,
            roadmap_crosscheck=chk, candidate_pe_bli=pe, candidate_title=title,
            org=org or "", account=account or "", account_title=acct_title or "",
            fy2026_total_thousands="" if f26 is None else f"{f26:.0f}",
            fy2025_total_thousands="" if f25 is None else f"{f25:.0f}",
            fy2024_actuals_thousands="" if f24 is None else f"{f24:.0f}",
            program_page=f"/program/{pe}/",
            lobbying_mentions_today=lob.get(pe, 0),
            mention_evidence_kinds=";".join(
                f"{k}={v}" for k, v in sorted(lob_kinds.get(pe, {}).items())),
            seeded_alias_today=seeded_pe or "none",
            resolves_today=(f"alias -> {seeded_pe}" if seeded_pe else
                            "nothing — no curated alias; a lone title token has not "
                            "been evidence since #52"),
            auto_pick_would_be="YES — sole title match (verify: a title match is "
                               "not a correct alias)" if n == 1 else "",
            seed_conflict=("SEEDED ALIAS POINTS AT A DIFFERENT PE — re-check"
                           if seeded_pe and seeded_pe != pe else ""),
            pick="", curator_notes=""))

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)
print(f"wrote {OUT}  rows={len(rows)}  terms={len(TERMS)}")
print(f"{'term':<24}{'vendor':<24}{'n':>4}  tier / crosscheck")
for t, v, n, tier, chk in summary:
    print(f"{t:<24}{v:<24}{n:>4}  {tier}  {chk}")
