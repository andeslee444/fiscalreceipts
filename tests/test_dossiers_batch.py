"""Phase 5B-3 Task 7b tests: dossier batch pipeline + cited-or-absent gate.

Fully mocked — no network, no ANTHROPIC_API_KEY (plan decision 6). Coverage:
  - DOSSIER_SCHEMA shape (cited-or-absent, additionalProperties false)
  - bundle building (narratives full, top-25 caps, trajectory fact_ids,
    pe-scoped feed events, flows summary, category row, snapshots) + token
    trimming (prefix-of-stages invariant, hard cap guarantee)
  - heuristic vs count_tokens token counting
  - estimator math at Batch rates ($2.50/$12.50 per MTok, full max_tokens out)
  - submit: blocked-on-no-key SystemExit, cost-cap abort (no batch created),
    happy path (requests shape per recon §G, batch_meta.json persisted)
  - collect: poll-until-ended, raw archive, parsed dossier output, errored +
    schema-invalid items listed loudly
  - gate: pass case, unresolvable fact_id/url, <80% warehouse ratio, empty
    required section, missing dossier file, category coverage + source_ref
    resolvability, pre-batch dim_programs assertion
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from types import SimpleNamespace

import duckdb
import pytest

from govbudget.dossiers.batch import (
    ALL_SECTIONS,
    BATCH_INPUT_USD_PER_MTOK,
    BATCH_OUTPUT_USD_PER_MTOK,
    BUNDLE_TOKEN_CAP,
    DOSSIER_SCHEMA,
    MAX_OUTPUT_TOKENS,
    MODEL,
    REQUIRED_SECTIONS,
    SHARED_PREAMBLE,
    _TRIM_STAGES,
    build_bundle,
    build_requests,
    collect,
    estimate_cost,
    heuristic_token_count,
    make_token_counter,
    require_client,
    submit,
    validate_dossier,
)
from govbudget.dossiers.gate import (
    dossier_gate,
    pre_batch_check,
    source_ref_resolvable,
)

PE = "0601101E"
PE2 = "0603183D8Z"
SHA = "ab" * 32
SNAP_URL = "https://example.com/article"


# ---------------------------------------------------------------------------
# Fixtures: sidecars + snapshots + categories + duckdb
# ---------------------------------------------------------------------------


@pytest.fixture()
def site_fixture(tmp_path):
    """tmp data layout mirroring data/site/json + data/research/snapshots."""
    site_json = tmp_path / "site" / "json"
    (site_json / "program_details").mkdir(parents=True)
    (site_json / "flows").mkdir()
    snapshots = tmp_path / "research" / "snapshots"
    snapshots.mkdir(parents=True)

    (site_json / "programs.json").write_text(json.dumps([
        {
            "pe_bli": PE, "title": "Defense Research Sciences", "org": "DARPA",
            "trajectory": {"fy2025_total": 50.0, "fy2026_total": 100.0},
            "trajectory_fact_ids": {"fy2026_total": "traj26fact",
                                    "fy2025_total": "traj25fact"},
            "hhi": {"hhi": 2500.0, "hhi_fact_id": "hhifact",
                    "program_dollars_fact_id": "dollarsfact"},
        },
        {"pe_bli": PE2, "title": "Joint Hypersonic Technology", "org": "OSD",
         "trajectory": {"fy2026_total": 500.0},
         "trajectory_fact_ids": {"fy2026_total": "traj26fact2"}},
    ]))

    (site_json / "program_details" / f"{PE}.json").write_text(json.dumps({
        "narratives": [
            {"kind": "mission", "title": "Mission", "body": "M" * 3000},
            {"kind": "accomplishments", "title": "Acc", "body": "A" * 3000},
        ],
        "mentions": [
            {"client_name": f"CLIENT {i}", "filing_uuid": f"uuid-{i}",
             "description_snippet": "lobbying on research"}
            for i in range(30)
        ],
        "awards": [
            {"award_piid": f"PIID{i}", "confidence": "high",
             "recipient_name": f"VENDOR {i}"}
            for i in range(30)
        ],
        "budget_lines": [
            {"fact_id": "blfact", "amount_thousands": 280494.0,
             "amount_type": "fy_2024_actuals", "organization": "DARPA"},
        ],
        "details": [
            {"fact_id": f"detfact{i}", "project_title": f"PROJ {i}",
             "amount_millions": float(i), "xml_path": f"ProgramElement[0]/Project[{i}]"}
            for i in range(30)
        ],
    }))

    (site_json / "feed.json").write_text(json.dumps({"cards": [
        {"pe_bli": PE, "event_type": "yoy_swing", "figure_fact_id": "feedfact",
         "headline": "swing"},
        {"pe_bli": "0699OTHER", "event_type": "zeroed_fy2026",
         "figure_fact_id": "otherfact", "headline": "other"},
    ], "total": 2}))

    (site_json / "flows" / f"{PE}.json").write_text(json.dumps({"awards": [
        {"piid": f"F{i}", "dollars": 100.0, "family_slug": "indyne",
         "district": "AK-00", "confidence": "high"}
        for i in range(12)
    ]}))

    (site_json / "citations.json").write_text(json.dumps({
        "traj26fact": {"kind": "derived"}, "traj25fact": {"kind": "derived"},
        "traj26fact2": {"kind": "derived"}, "hhifact": {"kind": "derived"},
        "dollarsfact": {"kind": "derived"}, "blfact": {"kind": "workbook"},
        "feedfact": {"kind": "derived"}, "detfact0": {"kind": "jbook_pdf"},
    }))

    (snapshots / "index.json").write_text(json.dumps({"snapshots": [
        {"sha256": SHA, "url": SNAP_URL, "retrieved_at": "2026-06-12T00:00:00Z",
         "title": "Article", "pe_bli": PE, "matched_term": "sciences"},
    ]}))
    (snapshots / f"{SHA}.json").write_text(json.dumps({
        "url": SNAP_URL, "retrieved_at": "2026-06-12T00:00:00Z", "sha256": SHA,
        "title": "Article", "text": "S" * 40_000,
    }))

    categories = tmp_path / "program_categories.csv"
    categories.write_text(
        "pe_bli,category,rationale,source_ref\n"
        f"{PE},default,broad portfolio,ProgramElement[5]\n"
        f"{PE2},hypersonics,hypersonic tech,snapshot:{SHA}\n"
    )

    return SimpleNamespace(
        site_json=site_json, snapshots=snapshots, categories=categories,
        tmp=tmp_path,
    )


@pytest.fixture()
def fixture_duckdb(tmp_path):
    db = tmp_path / "fixture.duckdb"
    con = duckdb.connect(str(db))
    con.execute("create table dim_programs (pe_bli varchar, org varchar,"
                " exhibit_family varchar, project_count bigint,"
                " fy2024_actual_millions double, fully_reconciled boolean,"
                " title varchar)")
    con.execute("create table fct_budget_trajectory (pe_bli varchar,"
                " organization varchar, fy2024_actuals double,"
                " fy2025_total double, fy2026_total double,"
                " fy2526_change double, fy2526_pct_change double)")
    rows = [
        (PE, "DARPA", "Defense Research Sciences", "DARPA", 100.0),
        (PE2, "OSD", "Joint Hypersonic Technology", "OSD", 500.0),
    ]
    for pe, org, title, wb, total in rows:
        con.execute("insert into dim_programs values (?,?,?,?,?,?,?)",
                    [pe, org, "rdte", 1, 1.0, True, title])
        con.execute("insert into fct_budget_trajectory values (?,?,?,?,?,?,?)",
                    [pe, wb, 1.0, 1.0, total, 0.0, 0.0])
    con.close()
    return db


# ---------------------------------------------------------------------------
# Fake Anthropic client (no network)
# ---------------------------------------------------------------------------


def _heuristic_count_call(kw) -> int:
    text = "".join(m["content"] for m in kw.get("messages", []))
    system = kw.get("system") or ""
    if isinstance(system, list):
        system = "".join(b.get("text", "") for b in system)
    return heuristic_token_count(system + text) if system else heuristic_token_count(text)


class FakeBatches:
    def __init__(self, results_items=None, statuses=("ended",)):
        self.created: list = []
        self._results = list(results_items or [])
        self._statuses = list(statuses)

    def create(self, requests):
        self.created.append(requests)
        return SimpleNamespace(id="msgbatch_test123",
                               processing_status="in_progress")

    def retrieve(self, batch_id):
        status = (self._statuses.pop(0) if len(self._statuses) > 1
                  else self._statuses[0])
        return SimpleNamespace(id=batch_id, processing_status=status)

    def results(self, batch_id):
        return iter(self._results)


class FakeMessages:
    def __init__(self, batches, fixed_input_tokens=None):
        self.batches = batches
        self.fixed = fixed_input_tokens
        self.count_calls: list = []

    def count_tokens(self, **kw):
        self.count_calls.append(kw)
        n = self.fixed if self.fixed is not None else _heuristic_count_call(kw)
        return SimpleNamespace(input_tokens=n)


class FakeClient:
    def __init__(self, results_items=None, statuses=("ended",),
                 fixed_input_tokens=None):
        self.batches = FakeBatches(results_items, statuses)
        self.messages = FakeMessages(self.batches, fixed_input_tokens)


def _valid_dossier(url_claims: int = 1, fact_claims: int = 4) -> dict:
    """Schema-valid dossier with controllable warehouse/url claim mix."""
    facts = ["traj26fact", "hhifact", "blfact", "feedfact", "detfact0",
             "traj25fact", "dollarsfact", "traj26fact2"]
    fact_iter = iter(facts * 10)

    def fact_claim():
        return {"text": "A warehouse-cited claim.",
                "citation": {"fact_id": next(fact_iter)}}

    recent = [{"text": "News claim.", "citation": {"url": SNAP_URL}}
              for _ in range(url_claims)]
    n_each = max(1, fact_claims // 3)
    return {
        "what_it_is": {"claims": [fact_claim() for _ in range(n_each)]},
        "why_it_matters": {"claims": [fact_claim() for _ in range(n_each)]},
        "players": {"claims": [fact_claim()
                               for _ in range(fact_claims - 2 * n_each)]},
        "recent_developments": {"claims": recent},
    }


def _succeeded(pe_bli: str, dossier: dict) -> SimpleNamespace:
    return SimpleNamespace(
        custom_id=f"dossier-{pe_bli}",
        result=SimpleNamespace(
            type="succeeded",
            message=SimpleNamespace(
                content=[SimpleNamespace(type="text",
                                         text=json.dumps(dossier))],
                stop_reason="end_turn",
                usage=SimpleNamespace(input_tokens=10, output_tokens=20),
            ),
        ),
    )


def _errored(pe_bli: str) -> SimpleNamespace:
    return SimpleNamespace(
        custom_id=f"dossier-{pe_bli}",
        result=SimpleNamespace(
            type="errored",
            error=SimpleNamespace(type="invalid_request", message="boom"),
        ),
    )


# ---------------------------------------------------------------------------
# Schema shape
# ---------------------------------------------------------------------------


class TestSchema:
    def test_sections_and_required(self):
        assert set(DOSSIER_SCHEMA["properties"]) == set(ALL_SECTIONS)
        assert set(DOSSIER_SCHEMA["required"]) == set(ALL_SECTIONS)
        assert set(REQUIRED_SECTIONS) == {"what_it_is", "why_it_matters",
                                          "players"}
        assert DOSSIER_SCHEMA["additionalProperties"] is False

    def test_claim_and_citation_shape(self):
        section = DOSSIER_SCHEMA["properties"]["what_it_is"]
        assert section["required"] == ["claims"]
        assert section["additionalProperties"] is False
        claim = section["properties"]["claims"]["items"]
        assert set(claim["required"]) == {"text", "citation"}
        assert claim["additionalProperties"] is False
        branches = claim["properties"]["citation"]["anyOf"]
        keys = {tuple(b["required"]) for b in branches}
        assert keys == {("fact_id",), ("url",)}
        assert all(b["additionalProperties"] is False for b in branches)


# ---------------------------------------------------------------------------
# Token counting
# ---------------------------------------------------------------------------


class TestTokenCounting:
    def test_heuristic_is_chars_over_four(self):
        assert heuristic_token_count("abcd" * 3) == 3
        assert heuristic_token_count("abcde") == 2
        assert heuristic_token_count("") == 1

    def test_counter_prefers_count_tokens_when_client_present(self):
        client = FakeClient(fixed_input_tokens=777)
        counter = make_token_counter(client)
        assert counter("anything") == 777
        assert client.messages.count_calls[0]["model"] == MODEL

    def test_counter_falls_back_to_heuristic(self):
        assert make_token_counter(None) is heuristic_token_count


# ---------------------------------------------------------------------------
# Bundle building + trimming
# ---------------------------------------------------------------------------


def _bundle_json(b: dict) -> dict:
    text = b["text"]
    return json.loads(text[text.index("{"):])


class TestBuildBundle:
    def _build(self, fx, **kw):
        return build_bundle(PE, site_json_dir=fx.site_json,
                            snapshots_dir=fx.snapshots,
                            categories_csv=fx.categories, **kw)

    def test_contents(self, site_fixture):
        b = self._build(site_fixture)
        data = _bundle_json(b)
        assert data["pe_bli"] == PE
        # narratives FULL
        assert data["narratives"][0]["body"] == "M" * 3000
        # top-25 caps
        assert len(data["mentions"]) == 25
        assert len(data["awards"]) == 25
        assert len(data["projects"]) == 25
        # trajectory + its fact_ids
        assert data["program"]["trajectory"]["fy2026_total"] == 100.0
        assert data["program"]["trajectory_fact_ids"]["fy2026_total"] == "traj26fact"
        # feed events scoped to this pe_bli
        assert [e["figure_fact_id"] for e in data["feed_events"]] == ["feedfact"]
        # flows summary
        assert data["flows"]["award_count"] == 12
        assert len(data["flows"]["top_awards"]) == 10
        assert data["flows"]["total_dollars"] == pytest.approx(1200.0)
        # category row
        assert data["category"]["category"] == "default"
        # snapshots: title+url+text (capped at the pre-trim cap)
        assert data["snapshots"][0]["url"] == SNAP_URL
        assert data["snapshots"][0]["title"] == "Article"
        assert len(data["snapshots"][0]["text"]) == 8000

    def test_flows_absent_when_no_sidecar(self, site_fixture):
        b = build_bundle(PE2, site_json_dir=site_fixture.site_json,
                         snapshots_dir=site_fixture.snapshots,
                         categories_csv=site_fixture.categories)
        data = _bundle_json(b)
        assert data["flows"] is None
        assert data["snapshots"] == []  # no matched snapshots for PE2

    def test_no_trim_under_default_cap(self, site_fixture):
        b = self._build(site_fixture)
        assert b["tokens"] <= BUNDLE_TOKEN_CAP
        assert b["trim_stages"] == []

    def test_trimming_respects_cap_and_stage_order(self, site_fixture):
        b = self._build(site_fixture, token_cap=3000)
        assert b["tokens"] <= 3000
        assert b["trim_stages"]  # something was trimmed
        stage_names = [name for name, _fn in _TRIM_STAGES]
        applied = [s for s in b["trim_stages"] if s != "hard_truncated"]
        # stages apply strictly in order (a prefix of the stage list)
        assert applied == stage_names[: len(applied)]
        # snapshots give way before narratives are touched
        if "narratives_2000" in applied:
            assert "snapshots_top3" in applied

    def test_hard_truncation_guarantee(self, site_fixture):
        b = self._build(site_fixture, token_cap=100)
        assert b["trim_stages"][-1] == "hard_truncated"
        assert b["tokens"] <= 100

    def test_count_tokens_used_for_trimming_when_client_given(self, site_fixture):
        client = FakeClient()
        counter = make_token_counter(client)
        self._build(site_fixture, token_counter=counter)
        assert client.messages.count_calls  # API counting, not heuristic


# ---------------------------------------------------------------------------
# Estimator math
# ---------------------------------------------------------------------------


class TestEstimator:
    def test_rates(self):
        assert BATCH_INPUT_USD_PER_MTOK == 2.50
        assert BATCH_OUTPUT_USD_PER_MTOK == 12.50
        assert MAX_OUTPUT_TOKENS == 16000

    def test_fixed_token_math(self):
        client = FakeClient(fixed_input_tokens=10_000)
        bundles = [{"pe_bli": "A", "title": "", "text": "x"},
                   {"pe_bli": "B", "title": "", "text": "y"}]
        est = estimate_cost(bundles, client=client)
        p = est["per_dossier"][0]
        assert p["input_tokens"] == 10_000
        assert p["input_usd"] == pytest.approx(0.025)     # 10k * $2.50/MTok
        assert p["output_usd"] == pytest.approx(0.20)     # 16k * $12.50/MTok
        assert p["total_usd"] == pytest.approx(0.225)
        assert est["total_usd"] == pytest.approx(0.45)

    def test_heuristic_path_counts_system_plus_bundle(self):
        text = "a" * 4000  # 1,000 tokens heuristic
        est = estimate_cost([{"pe_bli": "A", "title": "", "text": text}])
        expected = 1000 + math.ceil(len(SHARED_PREAMBLE) / 4)
        assert est["per_dossier"][0]["input_tokens"] == expected

    def test_count_tokens_receives_system_preamble(self):
        client = FakeClient(fixed_input_tokens=5)
        estimate_cost([{"pe_bli": "A", "title": "", "text": "x"}], client=client)
        call = client.messages.count_calls[0]
        assert call["system"] == SHARED_PREAMBLE
        assert call["model"] == MODEL


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------


class TestSubmit:
    def _submit(self, fx, db, client, **kw):
        return submit(
            duckdb_path=db, site_json_dir=fx.site_json,
            snapshots_dir=fx.snapshots, categories_csv=fx.categories,
            raw_dir=fx.tmp / "dossiers-raw", client=client, **kw,
        )

    def test_blocked_without_api_key(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(SystemExit) as exc:
            require_client(None)
        msg = str(exc.value)
        assert "ANTHROPIC_API_KEY" in msg
        assert "export ANTHROPIC_API_KEY" in msg

    def test_submit_blocked_without_api_key(self, site_fixture, fixture_duckdb,
                                             monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(SystemExit) as exc:
            self._submit(site_fixture, fixture_duckdb, None)
        assert "ANTHROPIC_API_KEY" in str(exc.value)

    def test_happy_path_creates_batch_and_meta(self, site_fixture,
                                               fixture_duckdb, capsys):
        client = FakeClient()
        summary = self._submit(site_fixture, fixture_duckdb, client)
        assert summary["batch_id"] == "msgbatch_test123"
        assert summary["requests"] == 2

        # requests per recon §G
        (requests,) = client.batches.created
        ids = sorted(r["custom_id"] for r in requests)
        assert ids == [f"dossier-{PE}", f"dossier-{PE2}"]
        params = requests[0]["params"]
        assert params["model"] == MODEL
        assert params["max_tokens"] == MAX_OUTPUT_TOKENS
        assert params["output_config"]["format"]["schema"] == DOSSIER_SCHEMA
        sys_block = params["system"][0]
        assert sys_block["text"] == SHARED_PREAMBLE
        assert sys_block["cache_control"] == {"type": "ephemeral", "ttl": "1h"}

        # batch_meta.json persisted to the committed raw dir
        meta = json.loads(
            (site_fixture.tmp / "dossiers-raw" / "batch_meta.json").read_text())
        assert meta["batch_id"] == "msgbatch_test123"
        assert meta["request_count"] == 2
        assert set(meta["pe_blis"]) == {PE, PE2}
        assert meta["estimated_usd"] == pytest.approx(summary["estimated_usd"],
                                                      abs=1e-3)

        # per-dossier estimate + total printed
        out = capsys.readouterr().out
        assert PE in out and PE2 in out
        assert "TOTAL estimated $" in out

    def test_cost_cap_abort_creates_no_batch(self, site_fixture,
                                             fixture_duckdb):
        client = FakeClient(fixed_input_tokens=30_000_000)  # ~$75/dossier
        with pytest.raises(SystemExit) as exc:
            self._submit(site_fixture, fixture_duckdb, client)
        assert "exceeds" in str(exc.value)
        assert "no batch created" in str(exc.value).lower()
        assert client.batches.created == []
        assert not (site_fixture.tmp / "dossiers-raw" / "batch_meta.json").exists()

    def test_cost_cap_is_adjustable(self, site_fixture, fixture_duckdb):
        client = FakeClient(fixed_input_tokens=30_000_000)
        summary = self._submit(site_fixture, fixture_duckdb, client,
                               cost_cap=1000.0)
        assert summary["requests"] == 2


# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------


class TestCollect:
    def _meta(self, raw_dir: Path):
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / "batch_meta.json").write_text(json.dumps(
            {"batch_id": "msgbatch_test123", "model": MODEL,
             "request_count": 2, "pe_blis": [PE, PE2]}))

    def test_requires_meta(self, tmp_path):
        client = FakeClient()
        with pytest.raises(SystemExit) as exc:
            collect(raw_dir=tmp_path / "raw", out_dir=tmp_path / "out",
                    client=client)
        assert "submit" in str(exc.value)

    def test_polls_until_ended_then_writes(self, tmp_path, capsys):
        raw, out = tmp_path / "raw", tmp_path / "out"
        self._meta(raw)
        dossier = _valid_dossier()
        client = FakeClient(
            results_items=[_succeeded(PE, dossier), _errored(PE2)],
            statuses=("in_progress", "in_progress", "ended"),
        )
        sleeps: list[float] = []
        summary = collect(raw_dir=raw, out_dir=out, client=client,
                          poll_interval=1.0, sleep=sleeps.append)
        assert sleeps == [1.0, 1.0]

        # raw archive (paid artifact) for the succeeded item
        raw_doc = json.loads((raw / f"{PE}.json").read_text())
        assert raw_doc["custom_id"] == f"dossier-{PE}"
        assert raw_doc["message"]["content"][0]["type"] == "text"

        # parsed dossier written
        parsed = json.loads((out / f"{PE}.json").read_text())
        assert parsed["pe_bli"] == PE
        assert parsed["dossier"] == dossier

        # errored item: loud listing + summary
        assert summary["ok"] is False
        assert summary["succeeded"] == [PE]
        assert summary["failed"][0]["pe_bli"] == PE2
        assert summary["failed"][0]["reason"] == "errored"
        captured = capsys.readouterr().out
        assert f"FAILED {PE2}" in captured
        assert not (out / f"{PE2}.json").exists()

    def test_schema_invalid_result_is_failure_but_raw_archived(self, tmp_path,
                                                               capsys):
        raw, out = tmp_path / "raw", tmp_path / "out"
        self._meta(raw)
        bad = _valid_dossier()
        bad["extra_section"] = {"claims": []}
        client = FakeClient(results_items=[_succeeded(PE, bad)])
        summary = collect(raw_dir=raw, out_dir=out, client=client)
        assert summary["ok"] is False
        assert "schema" in summary["failed"][0]["reason"]
        assert (raw / f"{PE}.json").exists()       # paid artifact kept
        assert not (out / f"{PE}.json").exists()   # but never published
        assert "FAILED" in capsys.readouterr().out

    def test_non_json_text_is_failure(self, tmp_path):
        raw, out = tmp_path / "raw", tmp_path / "out"
        self._meta(raw)
        item = _succeeded(PE, {})
        item.result.message.content[0].text = "not json {"
        client = FakeClient(results_items=[item])
        summary = collect(raw_dir=raw, out_dir=out, client=client)
        assert summary["ok"] is False
        assert "invalid JSON" in summary["failed"][0]["reason"]

    def test_blocked_without_api_key(self, tmp_path, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(SystemExit) as exc:
            collect(raw_dir=tmp_path, out_dir=tmp_path)
        assert "ANTHROPIC_API_KEY" in str(exc.value)


# ---------------------------------------------------------------------------
# validate_dossier
# ---------------------------------------------------------------------------


class TestValidateDossier:
    def test_valid(self):
        assert validate_dossier(_valid_dossier()) == []

    def test_empty_recent_developments_is_valid(self):
        assert validate_dossier(_valid_dossier(url_claims=0)) == []

    def test_missing_section(self):
        d = _valid_dossier()
        del d["players"]
        assert any("missing section: players" in e for e in validate_dossier(d))

    def test_extra_top_level_key(self):
        d = _valid_dossier()
        d["bonus"] = {"claims": []}
        assert any("unexpected top-level" in e for e in validate_dossier(d))

    def test_claim_without_citation(self):
        d = _valid_dossier()
        d["players"]["claims"][0] = {"text": "no cite"}
        assert any("keys must be exactly" in e for e in validate_dossier(d))

    def test_citation_with_both_keys(self):
        d = _valid_dossier()
        d["players"]["claims"][0]["citation"] = {"fact_id": "x", "url": "y"}
        assert any("citation must be" in e for e in validate_dossier(d))

    def test_citation_with_unknown_key(self):
        d = _valid_dossier()
        d["players"]["claims"][0]["citation"] = {"source": "x"}
        assert any("citation must be" in e for e in validate_dossier(d))

    def test_empty_text(self):
        d = _valid_dossier()
        d["players"]["claims"][0]["text"] = "  "
        assert any("non-empty string" in e for e in validate_dossier(d))


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------


@pytest.fixture()
def gate_fixture(site_fixture):
    """Dossier files + the surrounding reference data for gate runs."""
    dossier_dir = site_fixture.tmp / "dossiers"
    dossier_dir.mkdir()
    for pe, url_claims in ((PE, 1), (PE2, 0)):
        (dossier_dir / f"{pe}.json").write_text(json.dumps({
            "pe_bli": pe, "model": MODEL,
            "collected_at": "2026-06-12T00:00:00Z",
            "dossier": _valid_dossier(url_claims=url_claims),
        }))
    return SimpleNamespace(
        dossier_dir=dossier_dir,
        citations=site_fixture.site_json / "citations.json",
        snapshots_index=site_fixture.snapshots / "index.json",
        categories=site_fixture.categories,
        top50=[(PE, "Defense Research Sciences", "DARPA", 100.0),
               (PE2, "Joint Hypersonic Technology", "OSD", 500.0)],
        dim_pe={PE, PE2},
    )


def _run_gate(fx, **kw):
    return dossier_gate(fx.dossier_dir, fx.citations, fx.snapshots_index,
                        fx.categories, fx.top50,
                        dim_programs_pe=fx.dim_pe, **kw)


class TestGate:
    def test_pass(self, gate_fixture):
        res = _run_gate(gate_fixture)
        assert res["ok"], res
        assert res["checks"]["warehouse_ratio"]["ratio"] >= 0.80
        assert res["totals"]["dossiers"] == 2

    def test_recent_developments_may_be_empty(self, gate_fixture):
        # PE2's dossier already has zero recent_developments claims
        res = _run_gate(gate_fixture)
        assert res["checks"]["required_sections"]["ok"]
        assert res["ok"]

    def test_unresolvable_fact_id_fails(self, gate_fixture):
        path = gate_fixture.dossier_dir / f"{PE}.json"
        doc = json.loads(path.read_text())
        doc["dossier"]["players"]["claims"][0]["citation"] = {
            "fact_id": "not-a-real-fact"}
        path.write_text(json.dumps(doc))
        res = _run_gate(gate_fixture)
        assert not res["ok"]
        bad = res["checks"]["citations_resolvable"]
        assert not bad["ok"]
        assert bad["unresolved"][0]["fact_id"] == "not-a-real-fact"

    def test_unresolvable_url_fails(self, gate_fixture):
        path = gate_fixture.dossier_dir / f"{PE}.json"
        doc = json.loads(path.read_text())
        doc["dossier"]["recent_developments"]["claims"][0]["citation"] = {
            "url": "https://not-a-snapshot.example.com/"}
        path.write_text(json.dumps(doc))
        res = _run_gate(gate_fixture)
        assert not res["checks"]["citations_resolvable"]["ok"]

    def test_warehouse_ratio_below_floor_fails(self, gate_fixture):
        # rewrite PE's dossier so url claims dominate: 3 fact + 9 url = 25%+...
        path = gate_fixture.dossier_dir / f"{PE}.json"
        doc = json.loads(path.read_text())
        doc["dossier"] = _valid_dossier(url_claims=9, fact_claims=3)
        path.write_text(json.dumps(doc))
        res = _run_gate(gate_fixture)
        ratio_check = res["checks"]["warehouse_ratio"]
        # corpus-wide: PE has 3 fact + 9 url, PE2 has 4 fact -> 7/16 < 0.8
        assert ratio_check["ratio"] == pytest.approx(7 / 16)
        assert not ratio_check["ok"]
        assert not res["ok"]

    def test_empty_required_section_fails(self, gate_fixture):
        path = gate_fixture.dossier_dir / f"{PE2}.json"
        doc = json.loads(path.read_text())
        doc["dossier"]["players"]["claims"] = []
        path.write_text(json.dumps(doc))
        res = _run_gate(gate_fixture)
        assert not res["checks"]["required_sections"]["ok"]
        assert f"{PE2}: players" in res["checks"]["required_sections"]["empty"]

    def test_missing_dossier_file_fails(self, gate_fixture):
        (gate_fixture.dossier_dir / f"{PE2}.json").unlink()
        res = _run_gate(gate_fixture)
        assert not res["checks"]["dossiers_present"]["ok"]
        assert res["checks"]["dossiers_present"]["missing"] == [PE2]

    def test_missing_category_row_fails(self, gate_fixture, site_fixture):
        site_fixture.categories.write_text(
            "pe_bli,category,rationale,source_ref\n"
            f"{PE},default,broad portfolio,ProgramElement[5]\n")
        res = _run_gate(gate_fixture)
        assert not res["checks"]["categories"]["ok"]
        assert res["checks"]["categories"]["missing"] == [PE2]

    def test_bad_category_source_ref_fails(self, gate_fixture, site_fixture):
        site_fixture.categories.write_text(
            "pe_bli,category,rationale,source_ref\n"
            f"{PE},default,broad portfolio,https://example.com/not-a-ref\n"
            f"{PE2},hypersonics,hypersonic tech,snapshot:{SHA}\n")
        res = _run_gate(gate_fixture)
        cats = res["checks"]["categories"]
        assert not cats["ok"]
        assert any("unresolvable source_ref" in e for e in cats["errors"])

    def test_structure_error_fails(self, gate_fixture):
        (gate_fixture.dossier_dir / f"{PE}.json").write_text(json.dumps({
            "pe_bli": PE, "dossier": {"what_it_is": {"claims": []}}}))
        res = _run_gate(gate_fixture)
        assert not res["checks"]["structure"]["ok"]

    def test_pre_batch_assertion(self, gate_fixture):
        res = pre_batch_check([PE, PE2, "0699ROGUE"], {PE, PE2})
        assert not res["ok"]
        assert res["missing"] == ["0699ROGUE"]
        ok = pre_batch_check([PE, PE2], {PE, PE2})
        assert ok["ok"] and ok["count"] == 2

    def test_gate_includes_pre_batch_when_dim_programs_given(self, gate_fixture):
        gate_fixture.dim_pe = {PE}  # PE2 missing from dim_programs
        res = _run_gate(gate_fixture)
        assert not res["checks"]["pre_batch"]["ok"]
        assert not res["ok"]


class TestSourceRefResolvable:
    SHAS = {SHA}

    def test_snapshot_ref(self):
        assert source_ref_resolvable(f"snapshot:{SHA}", self.SHAS)
        assert not source_ref_resolvable("snapshot:" + "0" * 64, self.SHAS)

    def test_xml_path(self):
        assert source_ref_resolvable("ProgramElement[5]", set())
        assert source_ref_resolvable("ProgramElement[0]/Project[4]", set())
        assert not source_ref_resolvable("ProgramElement", set())

    def test_jbook_ref(self):
        assert source_ref_resolvable("jbook:0601101E:ProgramElement[2]", set())
        assert not source_ref_resolvable("jbook:0601101E:", set())

    def test_lda_ref(self):
        assert source_ref_resolvable(
            "lda:25010ccf-ae87-4723-91e0-ed906eeb69a8", set())
        assert not source_ref_resolvable("lda:nope", set())

    def test_garbage(self):
        assert not source_ref_resolvable("", set())
        assert not source_ref_resolvable("https://example.com", set())


# ---------------------------------------------------------------------------
# build_requests (recon §G shape, no network)
# ---------------------------------------------------------------------------


class TestBuildRequests:
    def test_request_shape(self):
        reqs = build_requests([{"pe_bli": PE, "title": "T", "text": "BUNDLE"}])
        assert len(reqs) == 1
        r = reqs[0]
        assert r["custom_id"] == f"dossier-{PE}"
        p = r["params"]
        assert p["model"] == MODEL
        assert p["max_tokens"] == MAX_OUTPUT_TOKENS
        assert p["messages"] == [{"role": "user", "content": "BUNDLE"}]
        assert p["output_config"]["format"]["type"] == "json_schema"
        assert p["system"][0]["cache_control"]["ttl"] == "1h"


def test_submit_pe_blis_filter_unknown_aborts(monkeypatch, tmp_path):
    """--pe-blis outside the top-N set must abort loudly, never submit nothing."""
    import pytest

    from govbudget.dossiers import batch as B

    monkeypatch.setattr(B, "require_client", lambda c=None: object())
    monkeypatch.setattr(
        B, "top50", None, raising=False
    )  # not used directly; patched via research below
    import govbudget.dossiers.research as R

    monkeypatch.setattr(
        R, "top50", lambda db, limit=50: [("0601101E", "t", "DARPA", 1.0)]
    )
    with pytest.raises(SystemExit, match="not in the"):
        B.submit(
            duckdb_path="x",
            site_json_dir=tmp_path,
            snapshots_dir=tmp_path,
            categories_csv=tmp_path / "c.csv",
            raw_dir=tmp_path,
            client=object(),
            pe_blis=["NOT_A_REAL_PE"],
        )
