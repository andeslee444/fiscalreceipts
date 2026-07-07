-- migrations/009_program_family.sql
create table if not exists program_family (
    pe_bli    text primary key,
    family_id int not null
);
create index if not exists ix_program_family_fid on program_family(family_id);
