select * from {{ ref('stg_contracts') }}
union all
select * from {{ ref('stg_assistance') }}
