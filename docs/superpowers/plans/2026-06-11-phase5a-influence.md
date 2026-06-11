# Phase 5A: Influence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lobbying → benefits linkage live: Senate LDA filings for the top defense families ingested with filing-UUID provenance, joined to the entity graph and (where the disclosure text names them) to programs; influence marts + `verify-phase5a` gates green.

**Recorded decisions:** (1) Source = Senate LDA REST API (probed live: anonymous access OK at ~15 req/min, permanent filing UUIDs, lobbyist names + covered positions, issue text that names programs — Lockheed 2025: 66 filings, "C-130J", "JASSM funding", "JADC2"). (2) v1 scope = **targeted pulls by client name for the top-100 defense families** by obligation (bounded, polite; a full-year sweep is 108k filings ≈ hours at anonymous rates — later, with a registered key, which requires user action). (3) Program-mention extraction = deterministic token/substring matching of issue text against program titles + BLI/PE identifiers (no LLM in 5A; the alias table in 5B will widen recall). (4) Honesty: influence presented alongside outcomes, never causally; persons appear only with their statutory disclosures.

**Conventions:** as prior phases; recon-first contract style. Baseline: `uv run pytest -q` → 234 passed. Branch `govbudget-phase5a`. LDA politeness: ≤14 req/min, one client, exponential backoff on 429.

---

### Task 1: LDA client (ingestion)

**Files:** `src/govbudget/influence/__init__.py`, `src/govbudget/influence/lda.py`, fixtures (one real filing JSON, trimmed) + `tests/influence/test_lda.py`; CLI `influence pull`.

Contract:
- `fetch_client_filings(client, client_name, *, years) -> list[dict]` — paginated `/api/v1/filings/?client_name=...&filing_year=...`; backoff on 429; raw JSON kept minimal (uuid, url, type, year, period, income, expenses, client name/desc, registrant name, lobbying_activities[(issue code/display, description, government_entities)], lobbyists[(name, covered_position)]).
- `pull_top_families(dsn_or_duckdb, *, out_dir, top_n=100, years=(2024, 2025, 2026))` — top families by obligation from dim_entities → for each, query LDA by the family's display_name AND its most-common raw parent names (dedupe by uuid) → two parquets: `lda_filings.parquet` (one row per filing: uuid, url, client_name, registrant, year, period, income_usd, expenses_usd, family_key_guess) and `lda_activities.parquet` (one row per activity: filing_uuid, issue_code, description, agencies_json, plus exploded `lda_lobbyists.parquet` (filing_uuid, name, covered_position)). All-varchar convention; source_url = filing url.
- Name→family matching at write time via `govbudget.entities.normalize_name` against the family's normalized key; record match_method (exact_family | normalized | none).
- Tests: MockTransport with a real-filing fixture; pagination; backoff; matching goldens (LOCKHEED MARTIN CORPORATION ↔ family LOCKHEED MARTIN).

### Task 2: Program-mention extraction + influence marts

**Files:** `src/govbudget/influence/mentions.py` + tests; dbt: sources + `fct_influence.sql` (family, year: lobbying_income_usd, lobbying_expense_usd, filings_count, obligations_usd joined from dim_entities/awards), `fct_program_lobbying.sql` (pe_bli/title ↔ filing_uuid, matched_term, client family), `dim_lobbyists.sql` (name, covered_position flag revolving_door, filings_count); dbt fixtures.

Contract for mentions: deterministic matcher — candidate terms per program = title tokens (≥5 chars, non-generic) + BLI/PE codes + a small curated seed of known program nicknames (`dbt/seeds/program_aliases.csv`, e.g. JASSM, C-130J, JADC2 → their PEs/BLIs where they exist in dim_programs; only add aliases whose program exists in our data, with notes). Match against activity description text (case-insensitive, word-boundary). Every match row carries filing_uuid + matched_term (citation-ready).

### Task 3: verify-phase5a + THE LOOP + merge

Gates (CLI `verify-phase5a`):
1. `provenance_gate5a`: every lda_filings row has uuid + url; counts reported.
2. `match_gate5a`: ≥80% of the top-50 families have ≥1 matched filing (report unmatched names — some genuinely don't lobby under the family name; gate is on the top-50 set).
3. `influence_gate5a`: fct_influence has ≥30 families with BOTH lobbying dollars and obligations; values positive; no causal language anywhere in mart column names/descriptions (assert column names contain no 'caused'/'because'/'won_due').
4. `mention_gate5a`: ≥10 program-mention rows across ≥3 distinct programs, each resolvable to its filing URL.
THE LOOP: `influence pull` (polite; ~top-100 families × years — expect 30-90 min) → `build` → `verify-phase5a`; iterate. Regression sweep verifies 1–4 + pytest. Final opus review; merge + push.

## Self-Review Notes
- Gates mirror the vision doc's 5A bullets; LLM-free by design (recorded); rate-limit politeness explicit; the unmatched-family report feeds 5B's alias work.
