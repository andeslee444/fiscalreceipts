-- #52 — a single common word is not a naming.
--
-- Every fct_program_lobbying row must carry a non-null evidence_kind in
-- ('pe_literal', 'multi_token', 'alias'), and no row's matched_term may
-- reduce to a single stoplisted word. Returned rows are the FAILURES (dbt
-- singular test convention: zero rows = PASS).
--
-- GENERIC_WORDS below is a snapshot of the Python stoplist in
-- src/govbudget/influence/mentions.py at the time of the #52 fix (2026-08).
-- It is intentionally duplicated here rather than referenced live —dbt tests
-- run in SQL, mentions.py runs in Python, and there is no shared source
-- between them today. If GENERIC_WORDS gains or loses a word in mentions.py,
-- this list must be updated to match or this test can go stale (silently
-- weaker, never silently stronger — a stale SHORTER list here only makes the
-- test miss newly-stoplisted words, it can never wrongly fail a good row).
with generic_words(word) as (
    values
        ('ACQUISITION'), ('ACTIVITIES'), ('ADVANCED'), ('ANALYSIS'), ('ARMED'),
        ('BASED'), ('BASIC'), ('CAPABILITIES'), ('CENTER'), ('CHEMICAL'),
        ('COMMAND'), ('COMMON'), ('CONTROL'), ('CYBER'), ('DEFENSE'),
        ('DEPARTMENT'), ('DEVELOPMENT'), ('DOMAIN'), ('EDUCATION'),
        ('ENTERPRISE'), ('EQUIPMENT'), ('EVALUATION'), ('FEDERAL'),
        ('FOREIGN'), ('FUTURE'), ('GLOBAL'), ('HIGH'), ('INFORMATION'),
        ('INNOVATION'), ('INTEGRATION'), ('INTELLIGENCE'), ('INTERNATIONAL'),
        ('JOINT'), ('LONG'), ('MANAGEMENT'), ('MISSION'), ('NATIONAL'),
        ('NETWORK'), ('NUCLEAR'), ('OFFICE'), ('OPERATIONAL'), ('OPERATIONS'),
        ('OTHER'), ('POLICY'), ('PRODUCTION'), ('PROGRAM'), ('PROGRAMS'),
        ('RAPID'), ('RANGE'), ('RESEARCH'), ('SCIENCE'), ('SECURITY'),
        ('SERVICE'), ('SERVICES'), ('SHORT'), ('SMALL'), ('SPACE'),
        ('SPECIAL'), ('STRATEGIC'), ('STRIKE'), ('SUPPORT'), ('SYSTEM'),
        ('SYSTEMS'), ('TACTICAL'), ('TECHNICAL'), ('TECHNOLOGY'), ('TESTING'),
        ('TRAINING'), ('TRANSITION'), ('UNITED'), ('WARFIGHTING')
),

-- One row per (fct_program_lobbying row, individual "|"-split token of its
-- matched_term). A pe_literal or alias row's matched_term is a single token
-- by construction; a multi_token row's is >=2 tokens joined by "|" (see
-- find_mentions() in mentions.py).
tokens as (
    select
        m.filing_uuid,
        m.pe_bli,
        m.matched_term,
        m.evidence_kind,
        upper(trim(t.token)) as token_upper
    from {{ ref('fct_program_lobbying') }} m
    cross join lateral unnest(string_split(coalesce(m.matched_term, ''), '|')) as t(token)
),

failures as (
    -- (a) evidence_kind missing or outside the three qualifying tiers.
    select filing_uuid, pe_bli, matched_term, evidence_kind,
           'missing_or_invalid_evidence_kind' as failure_reason
    from {{ ref('fct_program_lobbying') }}
    where evidence_kind is null
       or evidence_kind not in ('pe_literal', 'multi_token', 'alias')

    union all

    -- (b) any token of matched_term is a bare stoplisted word — the exact
    -- shape of the original #52 bug (a single common word standing in for
    -- evidence).
    select t.filing_uuid, t.pe_bli, t.matched_term, t.evidence_kind,
           'stoplisted_token_in_matched_term: ' || t.token_upper as failure_reason
    from tokens t
    join generic_words g on g.word = t.token_upper
)

select * from failures
