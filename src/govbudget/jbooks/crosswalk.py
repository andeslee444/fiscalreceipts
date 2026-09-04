"""Deterministic budget-line -> award crosswalk (v1).

Method 1 (account): an award qualifies as a candidate for a budget line when
the line's federal account (e.g. 097-0400) appears in the award's
federal_accounts_funding_this_award list. Method 2 (token overlap): candidate
confidence is raised to 'high' when PE/title tokens overlap the award's
descriptions. Everything lands in budget_line_awards with method + confidence;
nothing is asserted silently. v1 is LLM-free by design (recorded decision).

v1 links are account+evidence-scoped; FY attribution is explicit via
fy_start/fy_end or all-loaded-years by default.
"""
import csv
import re
from pathlib import Path

import duckdb
import psycopg

# Sub-agency alias seed: data-seeds/org_subagency_aliases.csv, columns
# organization,alias. Replaces a hardcoded DARPA-only clause (#75) — every
# organization's medium-tier sub-agency match now comes from this file.
# crosswalk.py -> jbooks -> govbudget -> src -> GovBudget (parents[3]).
_ALIASES_CSV = Path(__file__).resolve().parents[3] / "data-seeds" / "org_subagency_aliases.csv"


def _load_subagency_aliases() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    with open(_ALIASES_CSV, newline="") as f:
        for row in csv.DictReader(f):
            organization = (row.get("organization") or "").strip()
            alias = (row.get("alias") or "").strip()
            # 2026-09-04 (#75 fix round 1, finding 5): an empty alias makes
            # `"" in sub_agency` true for EVERY award (empty string is a
            # substring of everything in Python), silently promoting the
            # whole organization's low-tier matches to medium. An empty
            # organization is equally unusable (it can never be looked up
            # by crosswalk_org's own `organization` argument). Fail loudly
            # at load time rather than let either slip through as a no-op
            # alias that quietly inflates confidence.
            if not organization:
                raise ValueError(
                    f"{_ALIASES_CSV}: row with empty organization"
                    f" (alias={row.get('alias')!r})"
                )
            if not alias:
                raise ValueError(
                    f"{_ALIASES_CSV}: empty alias for organization"
                    f" {organization!r} — an empty alias would match every"
                    " award's sub-agency and silently promote the whole"
                    " organization to medium confidence"
                )
            out.setdefault(organization, []).append(alias.lower())
    return out


# Trailing letter on budget accounts is the service designator and maps to
# the treasury agency prefix USAspending uses (verified in the award lake:
# 0400D->097-0400, 1319N->017-1319, 2040A->021-2040, 3600F->057-3600).
AGENCY_BY_LETTER = {"D": "097", "N": "017", "A": "021", "F": "057"}

STOPWORDS = {
    "the", "and", "for", "of", "to", "in", "a", "support", "services", "service",
    "program", "research", "development", "defense", "system", "systems",
    "technology", "technologies", "advanced", "based", "high", "performance",
    "management", "information", "operational", "tactical", "small",
}


def _tokens(text: str | None) -> set[str]:
    if not text:
        return set()
    return {
        t for t in re.split(r"[^a-z0-9]+", text.lower())
        if len(t) > 3 and t not in STOPWORDS
    }


def crosswalk_org(
    dsn: str, *, organization: str, treasury_agency: str, award_glob: str,
    min_overlap: int = 2,
    fy_start: int | None = None,
    fy_end: int | None = None,
) -> int:
    """Crosswalk all of one organization's budget lines against the award lake.

    Returns the number of (pe_bli, award) links upserted.
    """
    with psycopg.connect(dsn) as pg:
        lines = pg.execute(
            "select distinct pe_bli, exhibit, fiscal_year, account, title"
            " from budget_lines where organization=%s",
            (organization,),
        ).fetchall()
        detail_rows = pg.execute(
            "select pe_bli, project_title from budget_line_details"
            " where not superseded",
        ).fetchall()

    title_tokens: dict[str, set[str]] = {}
    for pe_bli, proj_title in detail_rows:
        if pe_bli:
            title_tokens.setdefault(pe_bli, set()).update(_tokens(proj_title))

    aliases = _load_subagency_aliases()
    org_aliases = aliases.get(organization, [organization.lower()])

    con = duckdb.connect()
    upserts = 0
    try:
        for pe_bli, exhibit, fy, account, line_title in lines:
            # Map service-letter suffix to treasury agency prefix.
            # e.g. "1319N" -> agency "017", numeric "1319" -> fed_account "017-1319"
            # Letterless accounts fall back to the caller-supplied treasury_agency.
            if account and account[-1:].isalpha():
                numeric, letter = account[:-1], account[-1].upper()
            else:
                numeric, letter = account, None
            agency = AGENCY_BY_LETTER.get(letter, treasury_agency)
            fed_account = f"{agency}-{numeric}"

            # Optional FY filter on action_date, using the FEDERAL fiscal year
            # (Oct 1 - Sep 30): a Oct-Dec action_date belongs to the NEXT FY,
            # not the calendar year its date string starts with (#75a).
            fy_filter = ""
            if fy_start is not None and fy_end is not None:
                fy_expr = (
                    "(try_cast(substr(action_date,1,4) as integer)"
                    " + case when try_cast(substr(action_date,6,2) as integer)"
                    " >= 10 then 1 else 0 end)"
                )
                fy_filter = f" and {fy_expr} between {fy_start} and {fy_end}"

            rows = con.execute(
                f"""
                select award_id_piid,
                       any_value(recipient_name),
                       any_value(recipient_uei),
                       sum(case when federal_accounts_funding_this_award = '{fed_account}'
                                then try_cast(federal_action_obligation as double) end),
                       any_value(transaction_description),
                       any_value(prime_award_base_transaction_description),
                       any_value(awarding_sub_agency_name)
                from read_parquet('{award_glob}', union_by_name=true)
                where federal_accounts_funding_this_award like '%{fed_account}%'
                  and award_id_piid is not null and award_id_piid <> ''
                  {fy_filter}
                group by award_id_piid
                """
            ).fetchall()
            pe_tokens = _tokens(line_title) | title_tokens.get(pe_bli, set())

            fy_suffix = "" if (fy_start is None or fy_end is None) else ""
            all_years_note = "; all loaded award years" if (fy_start is None and fy_end is None) else ""

            with psycopg.connect(dsn) as pg:
                for piid, rname, ruei, obligation, desc1, desc2, sub_agency in rows:
                    award_tokens = _tokens(desc1) | _tokens(desc2)
                    overlap = len(pe_tokens & award_tokens)
                    org_in_subagency = any(
                        a in (sub_agency or "").lower() for a in org_aliases
                    )
                    if overlap >= min_overlap:
                        confidence, method = "high", "account+tokens"
                        rationale = f"account {fed_account}; token overlap {overlap}{all_years_note}"
                    elif org_in_subagency:
                        confidence, method = "medium", "account+subagency"
                        rationale = f"account {fed_account}; sub-agency {sub_agency}{all_years_note}"
                    else:
                        confidence, method = "low", "account"
                        rationale = f"account {fed_account} only{all_years_note}"
                    pg.execute(
                        """
                        insert into budget_line_awards
                          (pe_bli, exhibit, fiscal_year, organization, award_piid,
                           recipient_name, recipient_uei, matched_obligation,
                           method, confidence, score, rationale)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        on conflict (pe_bli, exhibit, fiscal_year, award_piid)
                        do update set confidence=excluded.confidence,
                                      method=excluded.method,
                                      score=excluded.score,
                                      rationale=excluded.rationale,
                                      matched_obligation=excluded.matched_obligation
                        where budget_line_awards.method in
                              ('account', 'account+subagency', 'account+tokens')
                        """,
                        (pe_bli, exhibit, fy, organization, piid, rname, ruei,
                         obligation, method, confidence, overlap, rationale),
                    )
                    upserts += 1
    finally:
        con.close()
    return upserts
