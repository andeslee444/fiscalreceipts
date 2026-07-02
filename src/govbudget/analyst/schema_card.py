"""Schema card for the analyst agent.

The schema card is a checked-in structured dict describing every table/column
the agent can query. It carries unit/additivity traps, REFUSE guidance, and
URL-column mapping for citation resolution. It is rendered into a stable
system-prompt block with cache_control so it is only sent to the model once
per session.

Do NOT add timestamps or dynamic content to the schema_card dict — it must be
byte-for-byte stable to maximise prompt-caching hit rates.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# REFUSE enum (binding — three places: yaml, schema card, agent tool)
# ---------------------------------------------------------------------------

REFUSE_CLASSES = ("data_not_ingested", "structurally_absent", "classified")

# ---------------------------------------------------------------------------
# URL-column map for source_url citation resolution
# ---------------------------------------------------------------------------
# Key: table name used in answer_sql
# Value: column in that table that carries the publicly-accessible source URL

URL_COLUMN_MAP: dict[str, str] = {
    # improper-payment questions: source_url lives in the TEMP TABLE
    "improper_payments": "source_url",
    # GAO high-risk questions
    "high_risk": "source_url",
    # state per-capita questions — spend vs population use different columns
    "fct_state_per_capita_spend": "spend_source_url",
    "fct_state_per_capita_pop": "pop_source_url",
    # canonical table name for state per-capita
    "fct_state_per_capita": "spend_source_url",
}

# ---------------------------------------------------------------------------
# Schema card dict (checked-in; no dynamic content)
# ---------------------------------------------------------------------------

SCHEMA_CARD: dict = {
    "version": "5b4",
    "description": (
        "GovBudget warehouse — DoD J-book budget facts (FY2026 edition only), "
        "USASpending award transactions (FY2017-FY2026), entity family crosswalk, "
        "congressional-district geography, agency/program HHI concentration, "
        "improper-payment derived estimates, GAO high-risk areas, "
        "CA and CT state spending per-capita comparables."
    ),

    "refuse_guidance": {
        "enum": list(REFUSE_CLASSES),
        "rules": [
            "Use data_not_ingested when the data domain exists but the specific "
            "dataset/fiscal-year is not loaded (e.g. FY2023 J-book, FY2027 awards, "
            "Florida state budget).",
            "Use structurally_absent when the data type is not collected at all "
            "(e.g. bid prices, competition award records — USASpending has outcomes, "
            "not procurement competition data).",
            "Use classified when the budget line or program is classified / redacted "
            "(pe_bli 9999999999 is a placeholder only; NRO/black programmes not present).",
            "NEVER invent data, guess, or say 'approximately' without a real warehouse row.",
        ],
    },

    "unit_traps": [
        "fct_budget_lines.amount_thousands is in THOUSANDS of USD — divide by 1000 "
        "to get millions; by 1e6 to get billions.",
        "fct_award_transactions.obligation is in USD (not thousands).",
        "fct_state_per_capita.amount_per_capita is in USD per person.",
        "fct_budget_trajectory columns (fy2024_actuals, fy2025_total, fy2026_total, "
        "fy2526_change) are in THOUSANDS of USD.",
        "fct_improper_exposure.derived_improper_amount_usd is in USD (full dollars).",
        "fct_agency_concentration and fct_program_concentration HHI is dimensionless "
        "(0-10000 scale).",
        "dim_entities.total_obligation is in USD.",
    ],

    "additivity_traps": [
        "family_obligations_usd in dim_entities is NON-ADDITIVE — do not SUM across "
        "families; use total_obligation on the entity row.",
        "fct_budget_lines: summing across amount_type values will double-count budget "
        "figures. Query a single amount_type per question "
        "(e.g. fy_2024_actuals, fy_2025_enacted, fy_2026_request).",
        "fct_improper_exposure: derived_improper_amount_usd is a DERIVED figure "
        "(rate × outlays). Always label answers as 'derived estimate' — actual "
        "audited figures may differ.",
        "fct_budget_trajectory: fy2526_change and fy2526_pct_change are "
        "pre-computed deltas; do not recompute from the total columns.",
    ],

    "data_windows": {
        "jbook": "FY2026 edition only (shows FY2024 actuals, FY2025 enacted, "
                 "FY2026 request columns). No FY2023 or earlier J-book editions.",
        "award_transactions": "FY2017 through FY2026 inclusive. FY2021 is a partial "
                              "year (~22k transactions). FY2027 not ingested.",
        "entity_graph": "FY2017-FY2026 award window; dim_entities covers this range.",
        "state_spending": "CA and CT only (Phase 4 pilot). No other states.",
        "classified": (
            "pe_bli 9999999999 is a placeholder only for undisclosed classified "
            "programmes. No real classified budget data is in the warehouse."
        ),
    },

    "tables": {
        "fct_budget_lines": {
            "description": "J-book program-element budget facts. FY2026 edition.",
            "key_columns": {
                "pe_bli": "Program element / budget-line identifier",
                "organization": "DoD component (DARPA, MDA, Navy, etc.)",
                "title": "Program title",
                "amount_thousands": "Amount in THOUSANDS of USD (see unit_traps)",
                "amount_type": (
                    "One of: fy_2024_actuals | fy_2025_enacted | fy_2026_request"
                ),
            },
            "notes": [
                "FY2026 edition only — no FY2023 or earlier actuals.",
                "District-level breakdowns are high-confidence only.",
                "Negative obligations exist (contract modifications/de-obligations).",
            ],
        },
        "fct_budget_trajectory": {
            "description": "Pre-computed FY2025→FY2026 budget change mart.",
            "key_columns": {
                "pe_bli": "Program element identifier",
                "organization": "DoD component",
                "fy2025_total": "FY2025 total in thousands",
                "fy2026_total": "FY2026 total in thousands",
                "fy2526_change": "Absolute change (thousands)",
                "fy2526_pct_change": "Percentage change",
            },
        },
        "fct_award_transactions": {
            "description": "USASpending DoD contract + assistance transactions.",
            "key_columns": {
                "award_type": "contract | assistance",
                "fiscal_year": "Integer FY (2017-2026)",
                "obligation": "USD amount (full dollars, not thousands)",
                "awarding_sub_agency_name": "Sub-agency name",
                "pop_state": "Place of performance state code (2-char)",
                "pop_district": "Place of performance congressional district (e.g. TX-12)",
            },
        },
        "dim_entities": {
            "description": "Entity family rollup across FY2017-2026 awards.",
            "key_columns": {
                "display_name": "Canonical family name",
                "total_obligation": "Total USD obligation across all FY (additive)",
                "uei_count": "Number of UEIs in this family",
                "worst_confidence": "Lowest confidence UEI in the family",
            },
            "notes": [
                "family_obligations_usd is NON-ADDITIVE — use total_obligation.",
                "FY2017-2026 window.",
            ],
        },
        "entity_xwalk": {
            "description": "UEI-to-family crosswalk.",
            "key_columns": {
                "recipient_name": "Raw recipient name",
                "family_key": "Family key (joins to dim_entities)",
            },
        },
        "dim_geography": {
            "description": "Congressional-district aggregation of DoD awards.",
            "key_columns": {
                "pop_district": "District (e.g. TX-12); high-confidence only",
                "pop_state": "State code",
                "total_obligation": "Total USD obligation for this district",
            },
            "notes": [
                "District field is high-confidence-only resolution.",
            ],
        },
        "fct_agency_concentration": {
            "description": "HHI concentration by awarding sub-agency.",
            "key_columns": {
                "awarding_sub_agency_name": "Sub-agency",
                "hhi": "Herfindahl-Hirschman Index (0-10000)",
                "family_count": "Distinct vendor families",
            },
        },
        "fct_program_concentration": {
            "description": "HHI concentration by program element.",
            "key_columns": {
                "pe_bli": "Program element",
                "hhi": "HHI (0-10000)",
                "top_family": "Top vendor family name",
            },
        },
        "fct_budget_to_awards": {
            "description": "Budget-to-awards crosswalk linking PE/BLI to USASpending.",
            "key_columns": {
                "pe_bli": "Program element",
                "program_title": "Program title from J-book",
                "award_piid": "Contract PIID from USASpending",
                "method": "Linking method (e.g. account+subagency)",
                "confidence": "Link confidence (high|medium|low)",
            },
        },
        "fct_improper_exposure": {
            "description": "DERIVED improper payment exposure by agency (rate × outlays).",
            "key_columns": {
                "agency_code": "Agency abbreviation (HHS, TREASURY, etc.)",
                "derived_improper_amount_usd": "DERIVED USD estimate (NOT audited total)",
                "weighted_rate_pct": "Weighted improper payment rate percent",
            },
            "notes": [
                "All amounts are DERIVED. Label answers accordingly.",
                "Source URL for citations: use improper_payments TEMP TABLE (not this view).",
            ],
            "url_column_note": (
                "For source_url citations on improper-payment questions, "
                "use the 'improper_payments' TEMP TABLE (source_url column), "
                "NOT fct_improper_exposure (which has no url column)."
            ),
        },
        "improper_payments": {
            "description": "TEMP TABLE — raw improper payment rows with source URLs.",
            "key_columns": {
                "agency_code": "Agency code",
                "program": "Program name",
                "fiscal_year": "Fiscal year string",
                "derived_improper_amount_usd": "DERIVED USD",
                "source_url": "URL to paymentaccuracy.gov source (use for citations)",
            },
        },
        "high_risk": {
            "description": "TEMP TABLE — GAO high-risk program areas.",
            "key_columns": {
                "area_name": "Program area name",
                "agency_code": "Mapped agency code",
                "source_url": "URL to GAO report (use for citations)",
            },
            "notes": [
                "Source URL for citations: high_risk.source_url.",
            ],
        },
        "fct_state_per_capita": {
            "description": "State spending per-capita comparables. CA and CT only.",
            "key_columns": {
                "jurisdiction": "CA or CT",
                "fiscal_year": "Year string (e.g. '2025')",
                "comparable_category": "Spending category (e.g. grants_and_subventions)",
                "amount_per_capita": "USD per person",
                "population": "Population used for calculation",
                "spend_source_url": "Source URL for spend data (use for citations)",
                "pop_source_url": "Source URL for population data",
            },
            "notes": [
                "Only CA and CT are loaded — all other states must be REFUSED.",
                "Use spend_source_url for spend-question citations.",
                "Use pop_source_url for population-question citations.",
            ],
        },
    },
}


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------

def render_system_prompt() -> list[dict]:
    """Return the system prompt as a list of Anthropic content blocks.

    The schema card block carries cache_control so it is cached as a stable
    system prefix across the eval run.
    """
    import json

    card_text = _build_card_text()

    return [
        {
            "type": "text",
            "text": card_text,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _build_card_text() -> str:
    """Render the schema card as a human-readable string for the system prompt."""
    lines: list[str] = [
        "You are GovBudget Analyst, a text-to-SQL assistant for a DoD spending "
        "intelligence warehouse. Answer questions by writing and running SQL "
        "against the warehouse using the run_sql tool, then calling submit_answer.",
        "",
        "CRITICAL RULE: Always execute run_sql to derive an answer before submitting; "
        "never answer from this schema description alone. Even when the answer seems "
        "obvious from the data window definitions (e.g. fiscal year ranges), you MUST "
        "run the SQL from answer_sql or equivalent to confirm the actual warehouse "
        "contents before calling submit_answer.",
        "",
        "## ANSWER FORMAT (CRITICAL — eval scores answer field by exact string equality)",
        "The 'answer' field in submit_answer must be the CANONICAL VALUE exactly as",
        "your final SQL returns it. No markdown, no prose, no narrative sentences.",
        "Rules:",
        "  - No thousands separators: '76727' not '76,727'",
        "  - No $ signs or unit labels: '135361939903.34' not '$135B'",
        "  - No markdown: no **bold**, no _italic_, no bullet points",
        "  - Preserve DB casing exactly: 'LOCKHEED MARTIN CORPORATION' not 'Lockheed Martin'",
        "  - Floats: up to 4 decimal places, trailing zeros stripped: '280.494' not '280.4940'",
        "  - Single value → bare scalar: Q 'How many entity families?' → answer '76727'",
        "  - Single row, multiple columns → comma-space joined:",
        "    Q 'Top family, total obligation, UEI count?' → answer 'LOCKHEED MARTIN CORPORATION, 135361939903.34, 126'",
        "  - Multiple rows → newline-separated, each row comma-space joined",
        "  - Refusal → answer 'REFUSE'",
        "The submitted sql is re-executed by the grader; canonicalize(rows) must equal",
        "answer character-for-character. SELECT only the columns/rows that form the answer.",
        "Use the 'explanation' field for human-readable prose, caveats, or units — it is NOT scored.",
        "",
        f"Warehouse description: {SCHEMA_CARD['description']}",
        "",
        "## Data windows (critical — do not hallucinate out-of-range data)",
    ]
    for k, v in SCHEMA_CARD["data_windows"].items():
        lines.append(f"  {k}: {v}")

    lines += [
        "",
        "## Unit traps (read carefully before computing)",
    ]
    for trap in SCHEMA_CARD["unit_traps"]:
        lines.append(f"  - {trap}")

    lines += [
        "",
        "## Additivity traps",
    ]
    for trap in SCHEMA_CARD["additivity_traps"]:
        lines.append(f"  - {trap}")

    lines += [
        "",
        "## REFUSE guidance",
        f"  Valid refuse_reason_class values: {REFUSE_CLASSES}",
    ]
    for rule in SCHEMA_CARD["refuse_guidance"]["rules"]:
        lines.append(f"  - {rule}")

    lines += [
        "",
        "## Citation URL-column map (for source_url citations)",
    ]
    for table, col in URL_COLUMN_MAP.items():
        lines.append(f"  {table} → {col}")

    lines += ["", "## Tables"]
    for table_name, info in SCHEMA_CARD["tables"].items():
        lines.append(f"### {table_name}")
        lines.append(f"  {info.get('description', '')}")
        for col, desc in info.get("key_columns", {}).items():
            lines.append(f"    {col}: {desc}")
        for note in info.get("notes", []):
            lines.append(f"    NOTE: {note}")
        if "url_column_note" in info:
            lines.append(f"    CITATION NOTE: {info['url_column_note']}")
        lines.append("")

    return "\n".join(lines)
