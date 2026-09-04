"""Which program a link on a SHARED BLI code belongs to (ROADMAP #70).

Some pe_bli values in the PB2026 corpus are published by dim_programs more
than once because two genuinely different programs share one numeric code.
They split on one of two axes:

  ACCOUNT   ten keys — same organization, different appropriation account.
            '3010' is LPD Flight II in Shipbuilding & Conversion, Navy
            (1611N) AND Shipboard Tactical Communications in Other
            Procurement, Navy (1810N). Sprint E Task E3 gives each member its
            own page (`3010-SCN` / `3010-OPN`) and turns the bare
            `/program/3010/` into a disambiguation stub.

  ORGANIZATION  three keys ('20', '30', '500') — one account (0300D),
            different organizations (DCSA/DTRA, OSD/DTRA/DMACT, DLA/DHRA).

Both link scripts used to drop every shared key (`display -= collisions`), so
neither member of either kind ever showed an award. The account-split keys can
be resolved — an award's own funding accounts, or the appropriation book its
lexicon narrative lives in, names exactly one member — and this module is the
resolution rule, shared so the FPDS path and the announcement path cannot
drift apart. The organization-split keys cannot: their members share one
account, so no account evidence tells them apart, and they stay excluded.

Every function here is pure — the callers own the SQL.
"""
from collections.abc import Iterable, Mapping


def partition_split_keys(
    rows: Iterable[tuple[str, str | None]],
) -> tuple[dict[str, set[str]], set[str]]:
    """Split dim_programs' (pe_bli, account) rows into the shared keys an
    account CAN resolve and the shared keys it cannot.

    Returns ({pe_bli: {account, ...}}, {pe_bli, ...}) — account-split keys
    first, then every other shared key.

    A key is account-split only when its accounts are all present and
    PAIRWISE DISTINCT, i.e. the account names exactly one of its rows. A key
    with three rows over two accounts (none exist today) would leave one
    account naming two programs, so it is reported as unresolvable rather
    than half-resolved. Keys dim_programs publishes once are in neither
    result: they were never ambiguous.
    """
    by_pe: dict[str, list[str | None]] = {}
    for pe_bli, account in rows:
        by_pe.setdefault(pe_bli, []).append(account)

    account_split: dict[str, set[str]] = {}
    other_split: set[str] = set()
    for pe_bli, accounts in by_pe.items():
        if len(accounts) < 2:
            continue
        if all(accounts) and len(set(accounts)) == len(accounts):
            account_split[pe_bli] = set(accounts)
        else:
            other_split.add(pe_bli)
    return account_split, other_split


def _exactly_one(hits: set[str]) -> str | None:
    """The single element of `hits`, or None when the evidence named zero or
    more than one. Never picks a winner — an ambiguous link is not published
    (the whole point of #70: a link that could belong to either program is
    not evidence about either one)."""
    return next(iter(hits)) if len(hits) == 1 else None


def member_for_award(
    member_fed_accounts: dict[str, set[str]], award_accounts: set[str],
) -> str | None:
    """The ONE member account whose appropriation funds this award.

    member_fed_accounts maps each member's raw budget_lines account code
    ('1611N') to the lake-style federal account keys it covers ('017-1611' —
    see derive_ap_links.fed_accounts_from_codes); award_accounts is the
    award's own federal_accounts_funding_this_award set. Returns None when
    the award's money names both members (it cannot say which line paid) or
    neither (there is no account evidence at all) — including the common case
    of an award whose funding accounts are unknown.
    """
    return _exactly_one({
        account for account, fed in member_fed_accounts.items()
        if fed & award_accounts
    })


def member_for_document(
    document_accounts: set[str], member_accounts: set[str],
) -> str | None:
    """The ONE member a J-book document identifies.

    An announcement link's evidence is a lexicon entry quoting a narrative in
    a specific J-book PDF, and the Navy files one procurement book per
    appropriation (SCN_Book.pdf, OPN_BA1_Book.pdf, …), so the accounts that
    book's own detail rows carry name the member. Returns None when the book
    carries both members' lines, or none of them.
    """
    return _exactly_one(set(document_accounts) & set(member_accounts))


# ---------------------------------------------------------------------------
# Contradictory member evidence between the two loaders
#
# budget_line_awards is unique on (pe_bli, exhibit, fiscal_year, award_piid) —
# `account` is deliberately NOT part of that key, because exactly-one-member
# admission already keeps one award naming at most one member and widening the
# key would PERMIT a future loader to publish one award against both. The cost
# of that choice is that both loaders' `on conflict … do update set
# account=excluded.account` lets whichever runs last move a published link from
# one member's page to the other's, with nothing said.
#
# Two independent evidence routes disagreeing about which of two programs an
# award belongs to is a finding about the evidence, not a tie to be broken by
# run order. These helpers let each loader see the disagreement BEFORE it
# writes, so it can stop inside its transaction and leave the corpus alone.
# ---------------------------------------------------------------------------


class ContradictoryAccountError(RuntimeError):
    """Two evidence routes attributed ONE link to different members of a
    shared BLI code. Raised instead of letting the upsert pick a winner."""


def contradictory_accounts(
    stored: Mapping[tuple, str | None],
    incoming: Iterable[tuple[tuple, str | None]],
) -> list[tuple[tuple, str | None, str | None]]:
    """Which incoming links contradict a member claim that already stands.

    `stored` maps each already-published link's unique key — (pe_bli, exhibit,
    fiscal_year, award_piid), normalized by the caller — to the member account
    it names (None for the ordinary keys, which name no member). `incoming` is
    the same shape for the rows about to be written.

    Returns [(key, standing_account, incoming_account), …] in incoming order,
    for every key whose standing claim is a REAL member (not None) and whose
    incoming row names a different one — including a row that names none at
    all, which would blank the account and drop the link off both member pages
    just as silently. A key with no standing claim is not a contradiction:
    that is the ordinary case of a loader owning a key outright.

    The scan is also self-consistent: two rows in ONE batch disagreeing about
    the same key are reported too, since insertion order would otherwise
    decide it exactly the way run order would.
    """
    conflicts: list[tuple[tuple, str | None, str | None]] = []
    claim: dict[tuple, str | None] = {}
    for key, account in incoming:
        standing = claim[key] if key in claim else stored.get(key)
        if standing is not None and standing != account:
            conflicts.append((key, standing, account))
        claim[key] = account
    return conflicts


def raise_on_contradictory_accounts(
    stored: Mapping[tuple, str | None],
    incoming: Iterable[tuple[tuple, str | None]],
    *,
    loader: str,
) -> None:
    """contradictory_accounts, but it stops the load. `loader` names the
    caller so the message says which run found the disagreement."""
    conflicts = contradictory_accounts(stored, incoming)
    if not conflicts:
        return
    lines = "\n".join(
        f"  {key[0]} {key[3]} ({key[1]} FY{key[2]}): already published against"
        f" account {standing}, this run attributes it to {account}"
        for key, standing, account in conflicts[:20]
    )
    more = "" if len(conflicts) <= 20 else f"\n  … and {len(conflicts) - 20} more"
    raise ContradictoryAccountError(
        f"{loader}: {len(conflicts)} link(s) contradict a member attribution"
        f" that is already published on a shared BLI code. Two evidence routes"
        f" naming DIFFERENT members of one code is a finding about the"
        f" evidence, not a tie for the last loader to break — nothing was"
        f" written. Investigate the pairs below and fix the losing route.\n"
        f"{lines}{more}"
    )
