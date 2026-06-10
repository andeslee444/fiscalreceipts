"""Deterministic budget-line -> award crosswalk (v1).

Method 1 (account): an award qualifies as a candidate for a budget line when
the line's federal account (e.g. 097-0400) appears in the award's
federal_accounts_funding_this_award list. Method 2 (token overlap): candidate
confidence is raised to 'high' when PE/title tokens overlap the award's
descriptions. Everything lands in budget_line_awards with method + confidence;
nothing is asserted silently. v1 is LLM-free by design (recorded decision).
"""
import re

import duckdb
import psycopg

STOPWORDS = {
    "the", "and", "for", "of", "to", "in", "a", "support", "services", "service",
    "program", "research", "development", "defense", "system", "systems",
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
    min_overlap: int = 1,
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

    con = duckdb.connect()
    upserts = 0
    try:
        for pe_bli, exhibit, fy, account, line_title in lines:
            # Normalize account: strip trailing alpha suffixes (e.g. "0400D" -> "0400")
            # Federal account codes in USASpending are the 4-digit numeric appropriation only.
            norm_account = account.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
            fed_account = f"{treasury_agency}-{norm_account}"
            rows = con.execute(
                f"""
                select award_id_piid,
                       any_value(recipient_name),
                       any_value(recipient_uei),
                       sum(try_cast(federal_action_obligation as double)),
                       any_value(transaction_description),
                       any_value(prime_award_base_transaction_description),
                       any_value(awarding_sub_agency_name)
                from read_parquet('{award_glob}', union_by_name=true)
                where federal_accounts_funding_this_award like '%{fed_account}%'
                  and award_id_piid is not null and award_id_piid <> ''
                group by award_id_piid
                """
            ).fetchall()
            pe_tokens = _tokens(line_title) | title_tokens.get(pe_bli, set())
            with psycopg.connect(dsn) as pg:
                for piid, rname, ruei, obligation, desc1, desc2, sub_agency in rows:
                    award_tokens = _tokens(desc1) | _tokens(desc2)
                    overlap = len(pe_tokens & award_tokens)
                    org_in_subagency = (
                        organization.lower() in (sub_agency or "").lower()
                        or "advanced research projects" in (sub_agency or "").lower()
                    )
                    if overlap >= min_overlap:
                        confidence, method = "high", "account+tokens"
                        rationale = f"account {fed_account}; token overlap {overlap}"
                    elif org_in_subagency:
                        confidence, method = "medium", "account+subagency"
                        rationale = f"account {fed_account}; sub-agency {sub_agency}"
                    else:
                        confidence, method = "low", "account"
                        rationale = f"account {fed_account} only"
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
                        """,
                        (pe_bli, exhibit, fy, organization, piid, rname, ruei,
                         obligation, method, confidence, overlap, rationale),
                    )
                    upserts += 1
    finally:
        con.close()
    return upserts
