"""Phase 5B-3 Task 7b: dossier Batch API pipeline (bundle -> submit -> collect).

Per plan Task 7b + recon §G (anthropic 0.109.1, Batch API):

- build_bundle(pe_bli)  — warehouse fact bundle assembled from the committed
  sidecars: program row (trajectory + its fact_ids, HHI), budget_lines and
  project details (each carries a citable fact_id), narratives IN FULL,
  top-25 lobbying mentions, top-25 awards, feed events for the pe_bli, a
  flows summary when data/site/json/flows/{pe_bli}.json exists, the authored
  category row, and matched news snapshots (title+url+text, capped).  The
  rendered bundle is token-trimmed to <=40k tokens: snapshots shrink first,
  then list caps, then narrative bodies — never the fact_ids.
- Token counting: client.messages.count_tokens when an Anthropic client is
  available (preferred), else the chars/4 heuristic (tests, keyless runs).
- submit() — cost estimator printed per dossier + total at Batch-discounted
  Opus rates ($2.50 in / $12.50 out per MTok; output assumed full
  max_tokens).  <= cost cap ($50) proceeds; above it aborts loudly with
  instructions and creates NO batch.  batch_id + metadata persisted to
  data/research/dossiers-raw/batch_meta.json (COMMITTED dir — paid artifacts
  are re-collectable without re-paying).
- collect() — poll until processing_status == "ended"; archive RAW results
  to data/research/dossiers-raw/{pe_bli}.json; parse + validate the
  structured output; write dossiers to data/site/json/dossiers/{pe_bli}.json;
  errored items are listed loudly.
- Missing ANTHROPIC_API_KEY -> loud SystemExit with the export instruction
  (decision 6: mocked tests pass; the live run is blocked until a key is
  exported).

DOSSIER_SCHEMA (recon §G, cited-or-absent): sections what_it_is /
why_it_matters / players (required, non-empty enforced by the gate) +
recent_developments (may be empty — warehouse-only dossiers are VALID);
every claim is {"text", "citation": {"fact_id"} | {"url"}} with
additionalProperties false throughout.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import time
from pathlib import Path
from typing import Callable

MODEL = "claude-opus-4-8"
MAX_OUTPUT_TOKENS = 16000
BUNDLE_TOKEN_CAP = 40_000
COST_CAP_USD = 50.0

# Batch-discounted Claude Opus rates (recon §G): 50% off $5/$25 per MTok.
BATCH_INPUT_USD_PER_MTOK = 2.50
BATCH_OUTPUT_USD_PER_MTOK = 12.50

TOP_N_LIST = 25            # mentions / awards / project details
SNAPSHOT_TEXT_CAP = 8_000  # chars of article text per snapshot (pre-trim)
MAX_SNAPSHOTS = 8

REQUIRED_SECTIONS: tuple[str, ...] = ("what_it_is", "why_it_matters", "players")
ALL_SECTIONS: tuple[str, ...] = REQUIRED_SECTIONS + ("recent_developments",)

# --------------------------------------------------------------------------
# Structured-output schema (recon §G — cited-or-absent)
# --------------------------------------------------------------------------

_CITATION_SCHEMA: dict = {
    "anyOf": [
        {
            "type": "object",
            "properties": {"fact_id": {"type": "string"}},
            "required": ["fact_id"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
            "additionalProperties": False,
        },
    ],
}

_CLAIM_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "citation": _CITATION_SCHEMA,
    },
    "required": ["text", "citation"],
    "additionalProperties": False,
}

_SECTION_SCHEMA: dict = {
    "type": "object",
    "properties": {"claims": {"type": "array", "items": _CLAIM_SCHEMA}},
    "required": ["claims"],
    "additionalProperties": False,
}

DOSSIER_SCHEMA: dict = {
    "type": "object",
    "properties": {section: _SECTION_SCHEMA for section in ALL_SECTIONS},
    "required": list(ALL_SECTIONS),
    "additionalProperties": False,
}

# --------------------------------------------------------------------------
# Shared system preamble (the honesty contract)
# --------------------------------------------------------------------------

SHARED_PREAMBLE = """\
You write program dossiers for Fiscal Receipts, a spending-intelligence site read by
curious citizens, journalists, and congressional staff. You will receive a
FACT BUNDLE for one defense budget program: warehouse rows (each carrying a
fact_id), J-book narratives (each carrying a fact_id when citable), lobbying
mentions, award recipients, feed events, and possibly cached news snapshots.

The honesty contract — every rule below is enforced mechanically downstream:

1. CITED OR ABSENT. Every claim you write must carry exactly one citation:
   {"fact_id": "..."} or {"url": "..."}. If you cannot cite a statement from
   the bundle, leave it out entirely.
2. fact_id citations may ONLY use fact_id values that literally appear in the
   provided bundle. Never invent, abbreviate, or recombine fact_ids.
3. url citations may ONLY use the url of a news snapshot provided in the
   bundle. Never cite any other URL, even one you are confident exists.
4. No speculation. Do not extrapolate beyond what the bundle supports; do not
   fill gaps with background knowledge.
5. Lobbying language is CORRELATIONAL. Mentions show that a filing referenced
   the program — write "lobbying filings referenced…" or "clients reported
   lobbying on…", never that lobbying caused or won anything.
6. recent_developments draws ONLY on the provided news snapshots. If there are
   none (most programs), return an empty claims array — that is a valid,
   complete dossier.
7. Write for a curious citizen: plain language, expand jargon and acronyms on
   first use, explain why a number matters. Budget figures from budget_lines
   and trajectory are in USD thousands unless the row says otherwise.
8. Narrative-derived claims: each narrative row that carries a fact_id field
   is citable — use that fact_id. Narrative rows without a fact_id field are
   provided for context only; do not cite them.

EXPLICIT NEGATIVE RULES (violations cause automatic rejection):
- XML anchors such as ProgramElement[5] or ProgramElement[5]/Project[1] are
  INTERNAL LOCATORS, never citations. Never use them as fact_id or url values.
- Award/contract numbers such as HR001119C0089 or W15P7T20C0024 are CONTRACT
  IDENTIFIERS, not citations. Never use them as fact_id or url values.
- Filing URLs (lda.senate.gov/api/v1/filings/...) are NEVER citable urls.
  Each lobbying mention carries a citable_fact_id — cite that fact_id instead.
  The filing_url field labeled "(reference link, NOT a citable url)" must never
  appear in any citation.
- The ONLY valid url citations are the news-snapshot URLs listed in the
  NEWS SNAPSHOTS section of this bundle. Every other URL is off-limits.
- If an award recipient claim cannot be cited with a fact_id from the bundle,
  omit the claim entirely rather than citing the contract number as a url.

Respond with JSON matching the requested schema: sections what_it_is,
why_it_matters, players, recent_developments, each {"claims": [{"text",
"citation"}]}.
"""


# --------------------------------------------------------------------------
# Token counting — prefer count_tokens, fall back to chars/4
# --------------------------------------------------------------------------


def heuristic_token_count(text: str) -> int:
    """chars/4 heuristic for keyless runs and tests (never tiktoken)."""
    return max(1, math.ceil(len(text) / 4))


def make_token_counter(client=None, *, model: str = MODEL) -> Callable[[str], int]:
    """Token counter for bundle trimming.

    With an Anthropic client: client.messages.count_tokens (preferred).
    Without: the chars/4 heuristic.
    """
    if client is None:
        return heuristic_token_count

    def count(text: str) -> int:
        return client.messages.count_tokens(
            model=model, messages=[{"role": "user", "content": text}]
        ).input_tokens

    return count


def count_request_tokens(bundle_text: str, *, client=None, model: str = MODEL) -> int:
    """Input tokens for one batch request (system preamble + user bundle)."""
    if client is not None:
        return client.messages.count_tokens(
            model=model,
            system=SHARED_PREAMBLE,
            messages=[{"role": "user", "content": bundle_text}],
        ).input_tokens
    return heuristic_token_count(SHARED_PREAMBLE) + heuristic_token_count(bundle_text)


# --------------------------------------------------------------------------
# Bundle building
# --------------------------------------------------------------------------


def _load_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_citations_keyset(site_json_dir: Path) -> set[str] | None:
    """Return the set of fact_ids in citations.json, or None if the file is absent."""
    path = Path(site_json_dir) / "citations.json"
    if not path.exists():
        return None
    return set(_load_json(path).keys())


def _lda_url_to_fact_id(site_json_dir: Path) -> dict[str, str]:
    """Return {filing_url: first_fact_id} for all lda_filing entries in citations.json.

    Used to annotate lobbying mentions with a citable fact_id so the model
    can cite fact_id instead of the non-citable filing_url.
    Only the first (alphabetically-sorted) fact_id per url is returned to give
    a deterministic, stable choice.
    """
    path = Path(site_json_dir) / "citations.json"
    if not path.exists():
        return {}
    mapping: dict[str, list[str]] = {}
    for fact_id, val in _load_json(path).items():
        if isinstance(val, dict) and val.get("kind") == "lda_filing":
            official_url = val.get("official_url", "")
            if official_url:
                mapping.setdefault(official_url, []).append(fact_id)
    # Use the lexicographically-first fact_id per url for determinism
    return {url: sorted(ids)[0] for url, ids in mapping.items()}


def _category_row(categories_csv: Path, pe_bli: str) -> dict | None:
    path = Path(categories_csv)
    if not path.exists():
        return None
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if (row.get("pe_bli") or "").strip() == pe_bli:
                out = {k: (v or "").strip() for k, v in row.items()}
                # source_ref is an internal XML anchor (e.g. 'ProgramElement[52]')
                # — models have cited it verbatim as a fact_id. Never render it.
                out.pop("source_ref", None)
                return out
    return None


def _matched_snapshots(snapshots_dir: Path, pe_bli: str) -> list[dict]:
    """Snapshots whose index entry matched this pe_bli: {title, url, text}."""
    index_path = Path(snapshots_dir) / "index.json"
    if not index_path.exists():
        return []
    index = _load_json(index_path)
    out: list[dict] = []
    seen: set[str] = set()
    for entry in index.get("snapshots", []):
        if entry.get("pe_bli") != pe_bli or entry["sha256"] in seen:
            continue
        seen.add(entry["sha256"])
        snap_path = Path(snapshots_dir) / f"{entry['sha256']}.json"
        if not snap_path.exists():
            continue
        snap = _load_json(snap_path)
        out.append(
            {
                "title": snap.get("title", ""),
                "url": snap.get("url", ""),
                "retrieved_at": snap.get("retrieved_at", ""),
                "text": (snap.get("text") or "")[:SNAPSHOT_TEXT_CAP],
            }
        )
        if len(out) >= MAX_SNAPSHOTS:
            break
    return out


def _assemble(pe_bli: str, *, site_json_dir: Path, snapshots_dir: Path,
              categories_csv: Path,
              citations_keyset: set[str] | None = None,
              lda_url_map: dict[str, str] | None = None) -> dict:
    """Raw (untrimmed) bundle dict from the committed sidecars.

    Bundle hygiene applied here:
    - projects: only rows whose fact_id is in citations_keyset are included;
      absent-fact_id rows are dropped and counted (loud print).
    - narratives: xml_path stripped (internal locator, not citable).
    - mentions: citable_fact_id injected from lda_url_map when available;
      filing_url labeled as "(reference link, NOT a citable url)".
    """
    site_json_dir = Path(site_json_dir)

    program: dict = {}
    programs_path = site_json_dir / "programs.json"
    if programs_path.exists():
        for row in _load_json(programs_path):
            if row.get("pe_bli") == pe_bli:
                program = row
                break

    details_path = site_json_dir / "program_details" / f"{pe_bli}.json"
    details = _load_json(details_path) if details_path.exists() else {}

    feed_events: list[dict] = []
    feed_path = site_json_dir / "feed.json"
    if feed_path.exists():
        # why_url/program_url are internal site anchors (e.g.
        # '/methodology/#feed-…') — models have cited them verbatim as url
        # citations. Strip them; figure_fact_id is the citable identifier.
        feed_events = [
            {k: v for k, v in c.items() if k not in ("why_url", "program_url")}
            for c in _load_json(feed_path).get("cards", [])
            if c.get("pe_bli") == pe_bli
        ]

    flows_summary: dict | None = None
    flows_path = site_json_dir / "flows" / f"{pe_bli}.json"
    if flows_path.exists():
        flows = _load_json(flows_path)
        awards = flows.get("awards", [])
        flows_summary = {
            "award_count": len(awards),
            "total_dollars": sum(a.get("dollars") or 0 for a in awards),
            "top_awards": awards[:10],
        }

    # --- Bundle hygiene: projects ---
    # Only include project detail rows whose fact_id is in citations.json.
    # Rows with zero-amount / AllPriorYears resolution often carry fact_ids that
    # were never exported to citations.json; letting them through causes the
    # model to cite invalid fact_ids.
    raw_projects = sorted(
        details.get("details", []),
        key=lambda d: -abs(d.get("amount_millions") or 0),
    )
    if citations_keyset is not None:
        filtered_projects = [
            p for p in raw_projects if p.get("fact_id") in citations_keyset
        ]
        dropped = len(raw_projects) - len(filtered_projects)
        if dropped:
            print(
                f"dossiers bundle [{pe_bli}]: FILTERED {dropped} project row(s)"
                f" whose fact_id is absent from citations.json"
            )
        projects = filtered_projects[:TOP_N_LIST]
    else:
        projects = raw_projects[:TOP_N_LIST]

    # --- Bundle hygiene: narratives ---
    # Strip xml_path — it is an internal J-book locator (e.g.
    # "ProgramElement[5]/Project[1]"), not a citable identifier.  Leaving it in
    # the bundle invites the model to use it as a url citation.
    # Preserve fact_id when present — it was minted by fact_id_narrative() and
    # resolves in citations.json; narrative-derived claims should cite it.
    clean_narratives = [
        {k: v for k, v in narr.items() if k != "xml_path"}
        for narr in details.get("narratives", [])
    ]
    # Filter narratives by citations_keyset: only include narrative rows whose
    # fact_id resolves (i.e. the citation row was emitted). Rows without a
    # fact_id field are included as context-only (the model is instructed not
    # to cite them).
    if citations_keyset is not None:
        keyed_narr: list[dict] = []
        context_narr: list[dict] = []
        for narr in clean_narratives:
            fid = narr.get("fact_id")
            if fid is None:
                context_narr.append(narr)
            elif fid in citations_keyset:
                keyed_narr.append(narr)
            # else: fact_id present but not in citations_keyset — exclude silently
        clean_narratives = keyed_narr + context_narr

    # --- Bundle hygiene: mentions ---
    # Inject citable_fact_id from the lda_url_map (first lda_filing fact_id for
    # this filing's official_url).  Label filing_url as NOT citable so the model
    # is never tempted to use the API URL as a url citation.
    raw_mentions = details.get("mentions", [])[:TOP_N_LIST]
    if lda_url_map is not None:
        clean_mentions: list[dict] = []
        for m in raw_mentions:
            m_out = dict(m)
            filing_url = m.get("filing_url", "")
            citable_fid = lda_url_map.get(filing_url)
            if citable_fid:
                m_out["citable_fact_id"] = citable_fid
            if filing_url:
                m_out["filing_url"] = f"{filing_url} (reference link, NOT a citable url)"
            clean_mentions.append(m_out)
        mentions = clean_mentions
    else:
        mentions = raw_mentions

    return {
        "pe_bli": pe_bli,
        "program": {
            "title": program.get("title", ""),
            "org": program.get("org", ""),
            "trajectory": program.get("trajectory"),
            "trajectory_fact_ids": program.get("trajectory_fact_ids"),
            "hhi": program.get("hhi"),
        },
        "category": _category_row(categories_csv, pe_bli),
        "budget_lines": details.get("budget_lines", []),
        "projects": projects,
        "narratives": clean_narratives,
        "mentions": mentions,
        "awards": details.get("awards", [])[:TOP_N_LIST],
        "feed_events": feed_events,
        "flows": flows_summary,
        "snapshots": _matched_snapshots(snapshots_dir, pe_bli),
    }


def render_bundle(bundle: dict) -> str:
    title = bundle.get("program", {}).get("title", "")
    header = (
        f"FACT BUNDLE for program {bundle['pe_bli']}"
        + (f" — {title}" if title else "")
        + "\nWrite the dossier from this bundle only.\n\n"
    )
    return header + json.dumps(bundle, ensure_ascii=False, indent=1)


def _truncate_snapshot_texts(bundle: dict, cap: int) -> None:
    for snap in bundle.get("snapshots", []):
        snap["text"] = (snap.get("text") or "")[:cap]


def _truncate_narratives(bundle: dict, cap: int) -> None:
    for narr in bundle.get("narratives", []):
        narr["body"] = (narr.get("body") or "")[:cap]


# Ordered trim stages (recon §G: narratives in full, top-25 mentions/awards —
# snapshots give way first; narrative bodies are touched only as a last
# resort before the hard character cut).
_TRIM_STAGES: list[tuple[str, Callable[[dict], None]]] = [
    ("snapshot_text_4000", lambda b: _truncate_snapshot_texts(b, 4000)),
    ("snapshot_text_2000", lambda b: _truncate_snapshot_texts(b, 2000)),
    ("snapshots_top3", lambda b: b.__setitem__("snapshots", b.get("snapshots", [])[:3])),
    ("snapshot_text_500", lambda b: _truncate_snapshot_texts(b, 500)),
    ("lists_top10", lambda b: (
        b.__setitem__("mentions", b.get("mentions", [])[:10]),
        b.__setitem__("awards", b.get("awards", [])[:10]),
        b.__setitem__("projects", b.get("projects", [])[:10]),
    )),
    ("narratives_2000", lambda b: _truncate_narratives(b, 2000)),
    ("narratives_800", lambda b: _truncate_narratives(b, 800)),
    ("snapshots_dropped", lambda b: b.__setitem__("snapshots", [])),
]


def build_bundle(
    pe_bli: str,
    *,
    site_json_dir: str | Path,
    snapshots_dir: str | Path,
    categories_csv: str | Path,
    token_counter: Callable[[str], int] | None = None,
    token_cap: int = BUNDLE_TOKEN_CAP,
    citations_keyset: set[str] | None = None,
    lda_url_map: dict[str, str] | None = None,
) -> dict:
    """Assemble + token-trim the fact bundle for one program.

    Returns {pe_bli, title, text, tokens, trim_stages}. `token_counter`
    defaults to the chars/4 heuristic; pass make_token_counter(client) to
    count via the API instead (preferred when a key is available).

    citations_keyset: set of fact_ids from citations.json; when provided,
      project detail rows whose fact_id is absent are filtered out and counted.
    lda_url_map: {filing_url: fact_id} from citations.json lda_filing entries;
      when provided, each mention gets a citable_fact_id annotation and the
      filing_url is labeled as NOT citable.
    """
    counter = token_counter or heuristic_token_count
    bundle = _assemble(
        pe_bli,
        site_json_dir=Path(site_json_dir),
        snapshots_dir=Path(snapshots_dir),
        categories_csv=Path(categories_csv),
        citations_keyset=citations_keyset,
        lda_url_map=lda_url_map,
    )

    applied: list[str] = []
    text = render_bundle(bundle)
    tokens = counter(text)
    for name, stage in _TRIM_STAGES:
        if tokens <= token_cap:
            break
        stage(bundle)
        applied.append(name)
        text = render_bundle(bundle)
        tokens = counter(text)
    if tokens > token_cap:
        # Hard guarantee: cut the rendered text itself (chars/4 bound).
        text = text[: token_cap * 4]
        tokens = counter(text)
        applied.append("hard_truncated")

    return {
        "pe_bli": pe_bli,
        "title": bundle.get("program", {}).get("title", ""),
        "text": text,
        "tokens": tokens,
        "trim_stages": applied,
    }


# --------------------------------------------------------------------------
# Cost estimator (recon §G — Batch rates, count_tokens in, full max out)
# --------------------------------------------------------------------------


def _observed_mean_output_tokens() -> int | None:
    """Mean output tokens across archived batch results, or None.

    WHY THIS EXISTS. The estimate used to assume every dossier emits the
    full MAX_OUTPUT_TOKENS. Dossiers do not: measured across the archived
    runs the mean is ~1,700 against a 16,000 cap, so the estimate ran ~6x
    high. That is not a harmless safety margin -- on 2026-08-29 the 15
    dossiers Wave 5's ingestion made necessary were quoted at $3.31,
    deferred as "a paid research run", and actually cost $0.55. The same
    shape deferred the LDA re-pull for months behind a $28.60 quote whose
    real cost was under a dollar.

    An estimate is a claim about a number, and this project has spent a
    long time learning that those are what go wrong. So: predict from what
    was observed, and keep the cap as the CEILING it is.
    """
    import json

    raw_dir = Path(__file__).resolve().parents[3] / "data" / "research" / "dossiers-raw"
    if not raw_dir.is_dir():
        return None

    def _find_usage(obj):
        if isinstance(obj, dict):
            if "output_tokens" in obj:
                return obj
            for v in obj.values():
                found = _find_usage(v)
                if found:
                    return found
        elif isinstance(obj, list):
            for v in obj:
                found = _find_usage(v)
                if found:
                    return found
        return None

    seen: list[int] = []
    for path in raw_dir.glob("*.json"):
        try:
            usage = _find_usage(json.loads(path.read_text()))
        except Exception:
            continue
        if usage and usage.get("output_tokens"):
            seen.append(int(usage["output_tokens"]))
    if len(seen) < 5:  # too few to predict from — fall back to the cap
        return None
    return int(sum(seen) / len(seen))


def estimate_cost(bundles: list[dict], *, client=None, model: str = MODEL) -> dict:
    """Per-dossier + total cost at Batch-discounted Opus rates.

    Input tokens via count_tokens (when a client is given). Output is
    predicted from archived runs when there are at least 5 of them, and
    falls back to MAX_OUTPUT_TOKENS otherwise — see
    _observed_mean_output_tokens for why the cap is the wrong predictor.
    """
    per: list[dict] = []
    observed = _observed_mean_output_tokens()
    out_tokens = observed if observed is not None else MAX_OUTPUT_TOKENS
    output_usd = out_tokens * BATCH_OUTPUT_USD_PER_MTOK / 1_000_000
    for b in bundles:
        input_tokens = count_request_tokens(b["text"], client=client, model=model)
        input_usd = input_tokens * BATCH_INPUT_USD_PER_MTOK / 1_000_000
        per.append(
            {
                "pe_bli": b["pe_bli"],
                "title": b.get("title", ""),
                "input_tokens": input_tokens,
                "output_tokens": out_tokens,
                "input_usd": input_usd,
                "output_usd": output_usd,
                "total_usd": input_usd + output_usd,
            }
        )
    return {
        "per_dossier": per,
        "total_usd": sum(p["total_usd"] for p in per),
        "output_basis": "observed" if observed is not None else "cap",
        "output_tokens_assumed": out_tokens,
    }


def print_estimate(est: dict) -> None:
    for p in est["per_dossier"]:
        print(
            f"dossiers submit: {p['pe_bli']:<12} in={p['input_tokens']:>7,}tok"
            f" out<={p['output_tokens']:,}tok  est ${p['total_usd']:.3f}"
            f"  {p['title'][:48]}"
        )
    basis = est.get("output_basis", "cap")
    assumed = est.get("output_tokens_assumed", MAX_OUTPUT_TOKENS)
    how = (
        f"output predicted at {assumed:,}tok from archived runs"
        if basis == "observed"
        else f"output assumed at the {assumed:,}tok CAP — no archived runs to "
        f"predict from, so this is a ceiling, not a forecast"
    )
    print(
        f"dossiers submit: TOTAL estimated ${est['total_usd']:.2f}"
        f" for {len(est['per_dossier'])} dossiers"
        f" (Batch rates ${BATCH_INPUT_USD_PER_MTOK}/{BATCH_OUTPUT_USD_PER_MTOK} per MTok;"
        f" {how})"
    )


# --------------------------------------------------------------------------
# Client / key handling
# --------------------------------------------------------------------------

_NO_KEY_MESSAGE = """\
dossiers: ANTHROPIC_API_KEY is not set — the live Batch API run is BLOCKED.

Export a key and re-run:

    export ANTHROPIC_API_KEY=sk-ant-...
    uv run python -m govbudget dossiers submit      # then, once ended:
    uv run python -m govbudget dossiers collect

No batch was created and nothing was spent. (The mocked test suite covers
this pipeline end-to-end without a key.)"""


def require_client(client=None):
    """Return a usable Anthropic client or die loudly (decision 6).

    Delegates to govbudget.common.anthropic_client.require_client, passing
    the dossier-specific _NO_KEY_MESSAGE verbatim.
    """
    from govbudget.common.anthropic_client import require_client as _rc

    return _rc(client, message=_NO_KEY_MESSAGE)


# --------------------------------------------------------------------------
# Submit
# --------------------------------------------------------------------------


def build_requests(bundles: list[dict], *, model: str = MODEL) -> list:
    """Batch Request list per recon §G (verbatim shape)."""
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    return [
        Request(
            custom_id=f"dossier-{b['pe_bli']}",
            params=MessageCreateParamsNonStreaming(
                model=model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": SHARED_PREAMBLE,
                        "cache_control": {"type": "ephemeral", "ttl": "1h"},
                    }
                ],
                output_config={
                    "format": {"type": "json_schema", "schema": DOSSIER_SCHEMA}
                },
                messages=[{"role": "user", "content": b["text"]}],
            ),
        )
        for b in bundles
    ]


def submit(
    *,
    duckdb_path: str | Path,
    site_json_dir: str | Path,
    snapshots_dir: str | Path,
    categories_csv: str | Path,
    raw_dir: str | Path,
    client=None,
    cost_cap: float = COST_CAP_USD,
    limit: int = 50,
    pe_blis: list[str] | None = None,
) -> dict:
    """Estimate, cost-gate, and create the dossier batch.

    Aborts (SystemExit) without creating a batch when the key is missing or
    the estimate exceeds `cost_cap`. On success writes
    {raw_dir}/batch_meta.json and returns {batch_id, requests, estimated_usd}.

    pe_blis: restrict the batch to these programs (must be within the
    top-`limit` set) — the retry path for individual gate-rejected dossiers.
    Unknown pe_blis abort loudly rather than silently submitting nothing.
    """
    from govbudget.dossiers.gate import dim_programs_pe_set, pre_batch_check
    from govbudget.dossiers.research import top50

    client = require_client(client)

    programs = top50(duckdb_path, limit=limit)
    if pe_blis is not None:
        wanted = set(pe_blis)
        unknown = wanted - {p[0] for p in programs}
        if unknown:
            raise SystemExit(
                "dossiers submit: --pe-blis not in the"
                f" top-{limit} set: {sorted(unknown)} — ABORTED."
            )
        programs = [p for p in programs if p[0] in wanted]
    pre = pre_batch_check([p[0] for p in programs], dim_programs_pe_set(duckdb_path))
    if not pre["ok"]:
        raise SystemExit(
            "dossiers submit: pre-batch assertion FAILED — pe_blis outside"
            f" dim_programs: {pre['missing']} (recon §C). No batch was created."
        )

    counter = make_token_counter(client)
    # Load hygiene references once — avoids re-reading on every bundle
    site_json_path = Path(site_json_dir)
    cit_keyset = _load_citations_keyset(site_json_path)
    lda_map = _lda_url_to_fact_id(site_json_path)
    if cit_keyset is not None:
        print(
            f"dossiers submit: bundle hygiene active"
            f" — citations keyset={len(cit_keyset)}, lda_url_map={len(lda_map)}"
        )
    bundles = [
        build_bundle(
            pe_bli,
            site_json_dir=site_json_dir,
            snapshots_dir=snapshots_dir,
            categories_csv=categories_csv,
            token_counter=counter,
            citations_keyset=cit_keyset,
            lda_url_map=lda_map,
        )
        for pe_bli, _title, _org, _total in programs
    ]

    est = estimate_cost(bundles, client=client)
    print_estimate(est)
    if est["total_usd"] > cost_cap:
        raise SystemExit(
            f"dossiers submit: estimated ${est['total_usd']:.2f} exceeds the"
            f" ${cost_cap:.2f} cap — ABORTED, no batch created.\n"
            "Trim bundles or, after operator confirmation, re-run with"
            f" --cost-cap {math.ceil(est['total_usd'])}."
        )

    batch = client.messages.batches.create(requests=build_requests(bundles))

    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "batch_id": batch.id,
        "model": MODEL,
        "submitted_at": dt.datetime.now(dt.UTC).isoformat(),
        "request_count": len(bundles),
        "estimated_usd": round(est["total_usd"], 4),
        "pe_blis": [b["pe_bli"] for b in bundles],
        "bundle_tokens": {b["pe_bli"]: b["tokens"] for b in bundles},
        "trim_stages": {
            b["pe_bli"]: b["trim_stages"] for b in bundles if b["trim_stages"]
        },
    }
    (raw_dir / "batch_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"dossiers submit: batch {batch.id} created ({len(bundles)} requests)")
    return {
        "batch_id": batch.id,
        "requests": len(bundles),
        "estimated_usd": est["total_usd"],
    }


# --------------------------------------------------------------------------
# Collect
# --------------------------------------------------------------------------


def validate_dossier(d) -> list[str]:
    """Manual structural validation against DOSSIER_SCHEMA (no jsonschema dep)."""
    if not isinstance(d, dict):
        return ["dossier is not a JSON object"]
    errors: list[str] = []
    extra = set(d) - set(ALL_SECTIONS)
    if extra:
        errors.append(f"unexpected top-level keys: {sorted(extra)}")
    for section in ALL_SECTIONS:
        if section not in d:
            errors.append(f"missing section: {section}")
            continue
        sec = d[section]
        if (
            not isinstance(sec, dict)
            or set(sec) != {"claims"}
            or not isinstance(sec["claims"], list)
        ):
            errors.append(f"{section}: must be exactly {{'claims': [...]}}")
            continue
        for i, claim in enumerate(sec["claims"]):
            errors.extend(_claim_errors(section, i, claim))
    return errors


def _claim_errors(section: str, i: int, claim) -> list[str]:
    where = f"{section}.claims[{i}]"
    if not isinstance(claim, dict):
        return [f"{where}: not an object"]
    if set(claim) != {"text", "citation"}:
        return [f"{where}: keys must be exactly {{text, citation}}"]
    errors: list[str] = []
    if not isinstance(claim["text"], str) or not claim["text"].strip():
        errors.append(f"{where}: text must be a non-empty string")
    citation = claim["citation"]
    valid = (
        isinstance(citation, dict)
        and len(citation) == 1
        and next(iter(citation)) in ("fact_id", "url")
        and isinstance(next(iter(citation.values())), str)
        and next(iter(citation.values())).strip() != ""
    )
    if not valid:
        errors.append(
            f"{where}: citation must be {{'fact_id': str}} or {{'url': str}}"
        )
    return errors


def _to_jsonable(obj):
    """Best-effort JSON conversion for SDK pydantic models and test doubles."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    for attr in ("model_dump", "to_dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return _to_jsonable(fn())
            except Exception:  # pragma: no cover — fall through to __dict__
                pass
    if hasattr(obj, "__dict__"):
        return {k: _to_jsonable(v) for k, v in vars(obj).items()
                if not k.startswith("_")}
    return str(obj)


def _first_text(message) -> str | None:
    content = message.get("content") if isinstance(message, dict) else getattr(
        message, "content", None
    )
    for block in content or []:
        btype = block.get("type") if isinstance(block, dict) else getattr(
            block, "type", None
        )
        if btype == "text":
            return block.get("text") if isinstance(block, dict) else getattr(
                block, "text", None
            )
    return None


def _load_reference_sets(
    citations_path: Path | None,
    snapshots_index: Path | None,
) -> tuple[set[str] | None, set[str] | None]:
    """Load fact_ids and snapshot_urls from reference files, or None if absent.

    Returns (fact_ids, snapshot_urls).  Either may be None when the
    corresponding file does not exist — callers must skip membership checks
    for None sets (shape-only mode).
    """
    fact_ids: set[str] | None = None
    if citations_path is not None and Path(citations_path).exists():
        fact_ids = set(_load_json(citations_path).keys())

    snapshot_urls: set[str] | None = None
    if snapshots_index is not None and Path(snapshots_index).exists():
        snapshot_urls = {
            entry["url"]
            for entry in _load_json(snapshots_index).get("snapshots", [])
            if entry.get("url")
        }

    return fact_ids, snapshot_urls


def _check_citation_membership(
    pe_bli: str,
    dossier: dict,
    fact_ids: set[str] | None,
    snapshot_urls: set[str] | None,
) -> list[str]:
    """Return reason strings for any unresolvable citations.

    Checks are skipped when the corresponding reference set is None (reference
    file was absent at collect time).  Mirrors gate.py logic so collect-time
    failures carry the same reason strings as the gate.
    """
    reasons: list[str] = []
    for section in ALL_SECTIONS:
        for i, claim in enumerate(dossier.get(section, {}).get("claims", [])):
            citation = claim.get("citation", {})
            if "fact_id" in citation:
                if fact_ids is not None and citation["fact_id"] not in fact_ids:
                    reasons.append(
                        f"{section}[{i}] fact_id {citation['fact_id']!r} not in citations.json"
                    )
            elif "url" in citation:
                if snapshot_urls is not None and citation["url"] not in snapshot_urls:
                    reasons.append(
                        f"{section}[{i}] url {citation['url']!r} not in snapshots index"
                    )
    return reasons


def collect(
    *,
    raw_dir: str | Path,
    out_dir: str | Path,
    client=None,
    poll_interval: float = 60.0,
    sleep: Callable[[float], None] = time.sleep,
    max_polls: int = 1440,
    citations_path: str | Path | None = None,
    snapshots_index: str | Path | None = None,
) -> dict:
    """Poll the batch, archive raw results, write parsed dossiers.

    Raw results -> {raw_dir}/{pe_bli}.json (COMMITTED — re-collectable
    without re-paying); parsed dossiers -> {out_dir}/{pe_bli}.json. Errored
    or schema-invalid items are listed loudly and reported in the summary.

    When citations_path and/or snapshots_index are provided (and the files
    exist), citation membership is validated at collect time: any claim citing
    a fact_id absent from citations.json, or a url absent from the snapshots
    index, is rejected with a "citations: ..." reason and the pe_bli is NOT
    written to out_dir.  This prevents bad dossiers from entering the site.
    Use `dossiers submit --pe-blis <pe_bli>` to retry individual failures.

    When reference files are absent, only shape validation is performed
    (backward-compatible behaviour for test environments without live data).
    """
    client = require_client(client)
    raw_dir = Path(raw_dir)
    out_dir = Path(out_dir)

    # Load reference sets once — None when files are absent (shape-only mode)
    fact_ids, snapshot_urls = _load_reference_sets(
        Path(citations_path) if citations_path is not None else None,
        Path(snapshots_index) if snapshots_index is not None else None,
    )
    membership_active = fact_ids is not None or snapshot_urls is not None
    if membership_active:
        print(
            f"dossiers collect: citation membership checks active"
            f" (fact_ids={len(fact_ids or ())}, snapshot_urls={len(snapshot_urls or ())})"
        )

    meta_path = raw_dir / "batch_meta.json"
    if not meta_path.exists():
        raise SystemExit(
            f"dossiers collect: {meta_path} not found — run `dossiers submit` first."
        )
    meta = _load_json(meta_path)
    batch_id = meta["batch_id"]

    batch = client.messages.batches.retrieve(batch_id)
    polls = 0
    while getattr(batch, "processing_status", None) != "ended":
        polls += 1
        if polls > max_polls:
            raise SystemExit(
                f"dossiers collect: batch {batch_id} still"
                f" {batch.processing_status} after {max_polls} polls — re-run later."
            )
        print(
            f"dossiers collect: batch {batch_id}"
            f" status={batch.processing_status} — waiting {poll_interval:.0f}s"
        )
        sleep(poll_interval)
        batch = client.messages.batches.retrieve(batch_id)

    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    collected_at = dt.datetime.now(dt.UTC).isoformat()
    succeeded: list[str] = []
    failed: list[dict] = []

    for result in client.messages.batches.results(batch_id):
        custom_id = result.custom_id
        pe_bli = custom_id.removeprefix("dossier-")
        rtype = result.result.type
        if rtype != "succeeded":
            error = _to_jsonable(getattr(result.result, "error", None))
            failed.append({"pe_bli": pe_bli, "reason": rtype, "error": error})
            continue

        message = result.result.message
        raw = {
            "custom_id": custom_id,
            "batch_id": batch_id,
            "collected_at": collected_at,
            "message": _to_jsonable(message),
        }
        (raw_dir / f"{pe_bli}.json").write_text(
            json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8"
        )

        text = _first_text(message)
        if text is None:
            failed.append({"pe_bli": pe_bli, "reason": "no text block in response"})
            continue
        try:
            dossier = json.loads(text)
        except json.JSONDecodeError as e:
            failed.append({"pe_bli": pe_bli, "reason": f"invalid JSON: {e}"})
            continue
        errors = validate_dossier(dossier)
        if errors:
            failed.append(
                {"pe_bli": pe_bli, "reason": "schema: " + "; ".join(errors[:5])}
            )
            continue

        # Citation membership check (when reference files are present)
        citation_errors = _check_citation_membership(
            pe_bli, dossier, fact_ids, snapshot_urls
        )
        if citation_errors:
            print(
                f"dossiers collect: {pe_bli} REJECTED — {len(citation_errors)}"
                f" unresolvable citation(s):"
            )
            for msg in citation_errors[:20]:
                print(f"  citations: {msg}")
            if len(citation_errors) > 20:
                print(f"  ... and {len(citation_errors) - 20} more")
            failed.append({
                "pe_bli": pe_bli,
                "reason": "citations: " + "; ".join(citation_errors[:5]),
            })
            print(
                f"  Retry: uv run python -m govbudget dossiers submit"
                f" --pe-blis {pe_bli}"
            )
            continue

        (out_dir / f"{pe_bli}.json").write_text(
            json.dumps(
                {
                    "pe_bli": pe_bli,
                    "model": meta.get("model", MODEL),
                    "collected_at": collected_at,
                    "dossier": dossier,
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        succeeded.append(pe_bli)

    print(
        f"dossiers collect: {len(succeeded)} dossiers written to {out_dir},"
        f" raw archived to {raw_dir}"
    )
    if failed:
        print(f"dossiers collect: {len(failed)} FAILED item(s):")
        for f in failed:
            print(f"  FAILED {f['pe_bli']}: {f['reason']}")
    return {
        "ok": not failed,
        "batch_id": batch_id,
        "succeeded": succeeded,
        "failed": failed,
    }
