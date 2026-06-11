-- dim_lobbyists: one row per unique lobbyist name, with filing count and
-- revolving_door flag derived from covered_position disclosure.
--
-- revolving_door = true when covered_position is non-empty and not 'N/A'
-- (statutory disclosure of prior executive/legislative branch position).
-- This flag mirrors the public LDA disclosure; no additional inference.
with lobbyists as (
    select
        name,
        covered_position,
        count(*) as filing_appearances
    from {{ source('influence', 'lda_lobbyists') }}
    where name is not null
      and name <> ''
    group by name, covered_position
),
aggregated as (
    select
        name,
        -- Most recent/non-empty covered_position wins; empty positions ranked last
        first_value(covered_position) over (
            partition by name
            order by
                case when covered_position is not null
                          and covered_position <> ''
                          and upper(covered_position) <> 'N/A'
                     then 0 else 1 end,
                filing_appearances desc
        ) as covered_position,
        sum(filing_appearances) as filings_count
    from lobbyists
    group by name, covered_position, filing_appearances
)
select
    name,
    max(covered_position)   as covered_position,
    sum(filings_count)      as filings_count,
    -- revolving_door: disclosed prior government service position
    bool_or(
        covered_position is not null
        and covered_position <> ''
        and upper(covered_position) <> 'N/A'
    )                       as revolving_door
from aggregated
group by name
