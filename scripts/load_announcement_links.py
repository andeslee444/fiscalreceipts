"""Load wave-verified announcement-derived (award, PE) links into budget_line_awards.

Evidence chain per link: an official defense.gov daily Contracts announcement
names BOTH the contract number and the program; the program name is one the
PE's own J-book narrative owns (lexicon 'own' entry with verbatim quote);
the pair survived agent triage AND an adversarial refute pass. Published at
'high' with method 'announcement+lexicon'; rationale carries the article
provenance (id/date/url) so the citation panel can point at the source.

Money color guard (2026-09-04): a held-out study measured
'announcement+lexicon' at 54/60 = 90.0%; 3 of 6 refutations were O&M-only
awards attached to RDT&E/procurement lines. Announcement links now
additionally require the award's funding accounts
(federal_accounts_funding_this_award, lake-side) to intersect the target
line's appropriation accounts (budget_lines.account, mapped the same way
derive_ap_links.py does via fed_accounts_from_codes) — see money_color_ok().
A mismatch is skipped, not published, and counted under
skipped['money_color_mismatch']. Subaward links (method 'subaward+lexicon')
are one hop removed (a sub's description, not the award's own funding
account) and keep their existing medium-tier behavior unchanged.

Exclusions mirror derive_ap_links.py: display-universe only, no collision
keys (dim_programs >1 row), no synthetic -L rollup keys.

Source rows (2026-09-04, ROADMAP #71): alongside each published link the
loader writes its evidence STRUCTURALLY to award_link_sources — article_id +
article URL + the archived copy's Wayback URL/timestamp/sha256 for
announcement links, subaward_number for subaward links — so export_site can
mint a first-class kind='announcement' citation instead of pointing the
reader at a generic derived crosswalk row. The rationale prose is unchanged;
this is the same evidence in a shape a citation panel can render.

Usage: uv run python scripts/load_announcement_links.py <wave_result.json>... [--dry-run]
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import psycopg

from derive_ap_links import fed_accounts_from_codes


def money_color_ok(award_accounts: set[str], line_accounts: set[str]) -> bool:
    """True when the award's funding accounts and the target line's
    appropriation accounts share at least one code, i.e. the award's money
    color is consistent with the line it would be linked to.

    Unknown award accounts (empty set, e.g. older PIIDs with NULL
    federal_accounts_funding_this_award) are treated as unknown, not mismatched
    — we do not skip the link. False only when the award's accounts are known
    and disjoint from the line's accounts (the failure mode: O&M-only awards
    attached to RDT&E/procurement lines).

    If the line's accounts are unknown (empty set), we return False because
    we cannot verify the money color match."""
    # Unknown award accounts = don't skip, we don't know if it's wrong
    if not award_accounts:
        return True
    # Known award accounts but unknown line accounts = skip, can't verify
    if not line_accounts:
        return False
    # Both known: match only if they intersect
    return bool(award_accounts & line_accounts)


# Catch-all budget lines ("Items Less Than $5 Million", "Ordnance Items <$5M",
# "Other Support Aircraft") are aggregates, not programs: a link asserting an
# award executes "Items Less Than $5 Million" is content-free, and the $ in
# the title trips the site's currency-in-prose sweep. Never link targets.
CATCHALL_TITLE = re.compile(r"(less than|under|<)\s*\$|^other\b|^miscellaneous", re.I)

ROOT = Path(__file__).resolve().parents[1]
DSN = "postgresql://localhost/govbudget"
ANN_URL = "https://www.defense.gov/News/Contracts/Contract/Article/{id}/"
MANIFEST = ROOT / "data/raw/announcements/manifest.jsonl"
WAYBACK_URL = "https://web.archive.org/web/{ts}/{url}"


def _packet_value(packet: dict, key: str) -> str | None:
    """A packet field, or None when it is absent/blank/the string 'None'.

    The wave-3 (subaward) packets carry the STRING 'None' for the fields that
    only announcement packets have (article_id, date, contractor) — a bare
    .get() would happily build .../Article/None/ out of it.
    """
    v = packet.get(key)
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s != "None" else None


def load_snapshot_manifest(path: Path = MANIFEST) -> dict[str, dict]:
    """article_id → {archive_url, archived_at, sha256} for the archived corpus.

    data/raw/announcements/manifest.jsonl is one JSON object per line with keys
    article_id / original_url / snapshot_ts / sha256 / bytes. It records no
    Wayback URL and no timestamp type, so both are derived from snapshot_ts
    (a %Y%m%d%H%M%S Wayback stamp, UTC). Articles with no manifest line are
    simply absent — the caller writes NULL archive fields rather than inventing
    a snapshot that was never taken.
    """
    out: dict[str, dict] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        m = json.loads(line)
        aid = str(m.get("article_id") or "").strip()
        ts = str(m.get("snapshot_ts") or "").strip()
        url = m.get("original_url")
        if not aid:
            continue
        archived_at = None
        archive_url = None
        if ts and url:
            try:
                archived_at = datetime.strptime(ts, "%Y%m%d%H%M%S").replace(
                    tzinfo=timezone.utc)
            except ValueError:
                archived_at = None
            else:
                archive_url = WAYBACK_URL.format(ts=ts, url=url)
        out[aid] = {
            "archive_url": archive_url,
            "archived_at": archived_at,
            "sha256": m.get("sha256") or None,
        }
    return out


def source_row(piid: str, pe: str, packet: dict, method: str,
               manifest: dict[str, dict]) -> tuple | None:
    """The award_link_sources row for one published link, or None.

    Keyed off the SAME method the link was published with, so source_kind and
    budget_line_awards.method can never disagree. Returns None when the packet
    names no source id (nothing to cite — never a placeholder row).
    """
    if method == "subaward+lexicon":
        sub = _packet_value(packet, "subaward_number")
        if not sub:
            return None
        # No canonical public URL for an FSRS subaward record, and no archived
        # copy: the id is the whole citation until one exists.
        return (piid, pe, "subaward", sub, None, None, None, None)
    aid = _packet_value(packet, "article_id")
    if not aid:
        return None
    snap = manifest.get(aid, {})
    return (piid, pe, "announcement", aid, ANN_URL.format(id=aid),
            snap.get("archive_url"), snap.get("archived_at"), snap.get("sha256"))


def main() -> int:
    dry = "--dry-run" in sys.argv
    paths = [a for a in sys.argv[1:] if not a.startswith("--")]
    surviving = []
    for path in paths:
        surviving.extend(json.load(open(path))["surviving"])

    con = duckdb.connect(str(ROOT / "data/duckdb/govbudget.duckdb"), read_only=True)
    display = {r[0] for r in con.execute("select distinct pe_bli from dim_programs").fetchall()}
    collisions = {r[0] for r in con.execute(
        "select pe_bli from dim_programs group by pe_bli having count(*) > 1").fetchall()}
    con.close()
    synthetic = re.compile(r"-L\d+$")
    with psycopg.connect(DSN) as pg0:
        titles = pg0.execute("select pe_bli, title from budget_lines where title is not null").fetchall()
    catchall = {pe for pe, t in titles if CATCHALL_TITLE.search(t or "")}
    display -= catchall

    # article provenance per (piid, pe) from the wave packets
    prov = {}
    for d in sorted((ROOT / "data/research/announcements").glob("wave*_chunks")):
        for f in sorted(d.glob("chunk_*.json")):
            for p in json.load(open(f)):
                prov.setdefault((p["piid"], p["pe_bli"]), p)

    pairs = []
    skipped = {"not_display_or_catchall": 0, "collision": 0, "synthetic": 0,
               "money_color_mismatch": 0}
    for s in surviving:
        pe, piid = s["pe_bli"], s["piid"]
        if synthetic.search(pe): skipped["synthetic"] += 1; continue
        if pe in collisions: skipped["collision"] += 1; continue
        if pe not in display: skipped["not_display_or_catchall"] += 1; continue
        pairs.append((piid, pe, s.get("reason", "")))
    print(f"surviving {len(surviving)} -> publishable {len(pairs)}; skipped {skipped}")

    # lake evidence for recipients/obligations/funding accounts
    piids = sorted({p for p, _, _ in pairs})
    lake = duckdb.connect()
    lake.execute("create temp table want(piid varchar)")
    lake.executemany("insert into want values (?)", [(p,) for p in piids])
    ev = {r[0]: r[1:] for r in lake.execute(f"""
        select award_id_piid, any_value(recipient_name), any_value(recipient_uei),
               sum(try_cast(federal_action_obligation as double)),
               max(federal_accounts_funding_this_award)
        from read_parquet('{ROOT}/data/parquet/contracts/fy=*/*.parquet', union_by_name=true)
        where award_id_piid in (select piid from want) group by 1""").fetchall()}
    lake.close()

    pg = psycopg.connect(DSN)
    line_meta = {}
    line_fed_accounts = {}
    for pe in {pe for _, pe, _ in pairs}:
        r = pg.execute("select min(exhibit), min(organization) from budget_lines where pe_bli=%s", (pe,)).fetchone()
        line_meta[pe] = (r[0] or "", r[1] or "")
        accounts = pg.execute(
            "select distinct account from budget_lines where pe_bli=%s and account is not null", (pe,),
        ).fetchall()
        line_fed_accounts[pe] = fed_accounts_from_codes(a for (a,) in accounts)

    # Archived-copy provenance for the citation tier (#71): the article the
    # waves actually read, its Wayback snapshot and that copy's sha256.
    manifest = load_snapshot_manifest()

    rows = []
    src_rows = []
    no_source_id = 0
    no_lake_evidence = 0
    for piid, pe, reason in pairs:
        rname, ruei, ob, accts = ev.get(piid, (None, None, None, None))
        if rname is None:
            # the lake does not hold this PIID (formatting variant or pre-FY17
            # award): a link the site cannot back with transactions is not
            # published — counted below, never inserted with a null recipient
            no_lake_evidence += 1
            continue
        p = prov.get((piid, pe), {})
        aid = p.get("article_id")
        rationale = (f"defense.gov contract announcement {aid} ({p.get('date')}): "
                     f"program '{p.get('program_name')}' named for this award "
                     f"[match basis: {p.get('match_basis') or 'exact-name'}]; "
                     f"J-book narrative owns it ({p.get('lexicon_doc')}); "
                     f"triage+adversarial refute survived — {reason[:160]}; "
                     f"url={ANN_URL.format(id=aid)}")
        ex, org = line_meta[pe]
        # Subaward-derived evidence is one hop removed (a sub's description
        # says what the prime is for): publishes at MEDIUM under its own
        # method so the tier states the evidence species. It keeps its
        # existing behavior — no money-color guard (the subaward description
        # is the evidence, not the award's own funding account).
        if (p.get("match_basis") or "") == "subaward-description-exact":
            method, conf = "subaward+lexicon", "medium"
            rationale = rationale.replace("defense.gov contract announcement None (None)",
                                          f"FSRS subaward {p.get('subaward_number')} ({p.get('subawardee')})")
        else:
            # Money color guard: the award's funding accounts must intersect
            # the target line's appropriation accounts. 3 of 6 refutations in
            # the 2026-09-04 held-out study were O&M-only awards attached to
            # RDT&E/procurement lines — a mismatch here is that failure mode.
            award_accounts = {a for a in (accts or "").split(";") if a.strip()}
            if not money_color_ok(award_accounts, line_fed_accounts.get(pe, set())):
                skipped["money_color_mismatch"] += 1
                continue
            method, conf = "announcement+lexicon", "high"
        rows.append((pe, ex, 2026, org, piid, rname, ruei, ob, method, conf, 2, rationale))
        # Structural provenance for the citation tier — same packet, same
        # method decision, so a published link and its source row agree.
        sr = source_row(piid, pe, p, method, manifest)
        if sr is None:
            no_source_id += 1
        else:
            src_rows.append(sr)
    print(f"rows to upsert: {len(rows)}; distinct PEs: {len({r[0] for r in rows})}; "
          f"skipped for no lake evidence: {no_lake_evidence}; "
          f"skipped for money_color_mismatch: {skipped['money_color_mismatch']}")
    n_archived = sum(1 for r in src_rows if r[5])
    print(f"source rows: {len(src_rows)} "
          f"({sum(1 for r in src_rows if r[2] == 'announcement')} announcement, "
          f"{sum(1 for r in src_rows if r[2] == 'subaward')} subaward); "
          f"with archived copy: {n_archived}; links with no source id: {no_source_id}")
    if dry:
        for r in rows[:3]: print("  sample:", r[0], r[4], r[5], "|", r[11][:110])
        for r in src_rows[:3]: print("  source:", r[2], r[3], r[4], "|", (r[7] or "")[:16])
        return 0
    with pg:
        cur = pg.cursor()
        cur.execute("delete from budget_line_awards where method in ('announcement+lexicon','subaward+lexicon')")
        cur.executemany(
            """insert into budget_line_awards
               (pe_bli, exhibit, fiscal_year, organization, award_piid, recipient_name,
                recipient_uei, matched_obligation, method, confidence, score, rationale)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (pe_bli, exhibit, fiscal_year, award_piid) do update set
                 confidence=excluded.confidence, method=excluded.method,
                 score=excluded.score, rationale=excluded.rationale,
                 matched_obligation=excluded.matched_obligation""", rows)
        # Same delete-then-upsert shape as the links above, scoped to the two
        # kinds this loader owns: a link that stops being published must not
        # leave its source row behind for the citation tier to mint from.
        cur.execute("delete from award_link_sources"
                    " where source_kind in ('announcement','subaward')")
        cur.executemany(
            """insert into award_link_sources
               (award_piid, pe_bli, source_kind, source_id, source_url,
                archive_url, archived_at, sha256)
               values (%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (award_piid, pe_bli, source_kind, source_id) do update set
                 source_url=excluded.source_url, archive_url=excluded.archive_url,
                 archived_at=excluded.archived_at, sha256=excluded.sha256""", src_rows)
    with psycopg.connect(DSN) as pg2:
        print("loaded:", pg2.execute("select method, confidence, count(*) from budget_line_awards"
                                     " where method in ('announcement+lexicon','subaward+lexicon') group by 1,2").fetchall())
        print("sources:", pg2.execute("select source_kind, count(*),"
                                      " count(archive_url), count(sha256)"
                                      " from award_link_sources group by 1 order by 1").fetchall())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
