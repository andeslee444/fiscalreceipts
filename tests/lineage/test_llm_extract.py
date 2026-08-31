"""ROADMAP #29(a) — the refusal rules, tested against the shapes that motivated them.

Every test here is a REFUSAL the pipeline must make, or the one acceptance it
must not refuse. The refusals are the point: a wrong lineage edge is a false
public claim about where money went, and the 5I review already caught this
subsystem fabricating three of them.
"""
import pytest

from govbudget.lineage.llm_extract import (
    Clause,
    Proposal,
    candidates,
    clause_id,
    estimate_cost,
    load_ratified,
    measure,
    ratified_edges,
    verify,
    write_seed,
)


def _clause(sentence, *, pe="0604827A", nxt="", fact="fid0", fy=2026):
    from govbudget.lineage.llm_extract import PE_TOKEN

    return Clause(
        clause_id=clause_id(fact, sentence),
        pe_bli=pe,
        fiscal_year=fy,
        fact_id=fact,
        page=None,
        sentence=sentence.strip(),
        prev_sentence="",
        next_sentence=nxt,
        codes=tuple(sorted(set(PE_TOKEN.findall(sentence)))),
    )


def _run(clause, frm, to, relation="realigned", **kw):
    p = Proposal(clause.clause_id, frm, to, relation)
    return verify([p], {clause.clause_id: clause}, **kw)


# ---------------------------------------------------------------------------
# The acceptance — a real FY2026 Army clause the regex tier cannot parse
# ---------------------------------------------------------------------------


def test_accepts_a_single_code_first_person_realignment():
    c = _clause(
        "Realignment starting FY2026 to Soldier Borne Sensor (0609345A/A50)"
        " agile funding line",
        pe="0604827A",
    )
    rows, refusals = _run(c, "0604827A", "0609345A")
    assert refusals == []
    assert len(rows) == 1
    assert rows[0]["from_pe_bli"] == "0604827A"
    assert rows[0]["to_pe_bli"] == "0609345A"
    # The seed row ships UNADJUDICATED — a verdict is a human act, never a default.
    assert rows[0]["verdict"] == ""


# ---------------------------------------------------------------------------
# V1 — the fabrication guard
# ---------------------------------------------------------------------------


def test_v1_refuses_an_endpoint_the_sentence_does_not_name():
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    rows, refusals = _run(c, "0604827A", "0603999F")
    assert rows == []
    assert refusals[0].rule == "V1-fabricated-endpoint"
    assert "0603999F" in refusals[0].reason


def test_v1_refuses_a_code_carried_in_from_the_neighbouring_sentence():
    """Context is given to the model for direction, never as an endpoint source."""
    c = _clause(
        "Funding was transferred to PE 0609345A",
        pe="0604827A",
        nxt="PE 0605230F continues unrelated work.",
    )
    rows, refusals = _run(c, "0605230F", "0609345A")
    assert rows == []
    assert refusals[0].rule == "V1-fabricated-endpoint"


# ---------------------------------------------------------------------------
# V2 — the 5I rollup-line incident, made structurally impossible
# ---------------------------------------------------------------------------


def test_v2_refuses_this_pairing_when_the_clause_reports_on_other_programs():
    """The exact 5I defect: a rollup clause naming OTHER PEs, paired with `this`.

    Three of 25 stated edges asserted a wrong predecessor this way. Here the
    clause names two codes and neither is the narrating PE, so the narrating PE
    may not supply an endpoint at all.
    """
    c = _clause(
        "In FY 2026, efforts under PE 0207436F were transferred to PE 0303004F",
        pe="0837300",
    )
    rows, refusals = _run(c, "0837300", "0303004F")
    assert rows == []
    assert refusals[0].rule == "V2-this-pairing-in-multi-code-clause"


def test_v2_allows_the_named_pair_from_that_same_rollup_clause():
    """The sentence's own pair is fine — it is `this` that must stay out."""
    c = _clause(
        "In FY 2026, efforts under PE 0207436F were transferred to PE 0303004F",
        pe="0837300",
    )
    rows, refusals = _run(c, "0207436F", "0303004F")
    assert refusals == []
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# V3 — grain and the numeric-line-item refusal (spec §6.1/§6.3)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "frm,to",
    [
        ("1350", "1250"),          # procurement line items — pe_bli is not unique
        ("0602203F", "622403"),    # a within-PE project code
        ("623145", "622403"),      # project to project
    ],
)
def test_v3_refuses_non_program_element_endpoints(frm, to):
    c = _clause(
        f"Starting in FY 2026 funding transfers from Line Item (LI) {frm} to LI"
        f" {to} and continues 0604827A",
        pe="1350",
    )
    rows, refusals = _run(c, frm, to)
    assert rows == []
    assert refusals[0].rule == "V3-shape"


def test_v3b_refuses_an_endpoint_absent_from_the_corpus():
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    rows, refusals = _run(c, "0604827A", "0609345A", known_pes={"0604827A"})
    assert rows == []
    assert refusals[0].rule == "V3b-unknown-pe"


# ---------------------------------------------------------------------------
# V5 / V7 / V9
# ---------------------------------------------------------------------------


def test_v5_refuses_a_clause_that_retracts_itself():
    c = _clause(
        "In FY 2026, funds were erroneously transferred into Program Element"
        " (PE) 1203609SF from PE 1203154SF",
        pe="1203609SF",
    )
    rows, refusals = _run(c, "1203154SF", "1203609SF")
    assert rows == []
    assert refusals[0].rule == "V5-retracted"


def test_v7_refuses_a_pair_the_regex_tier_already_states():
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    rows, refusals = _run(
        c, "0604827A", "0609345A", existing_pairs={("0604827A", "0609345A")}
    )
    assert rows == []
    assert refusals[0].rule == "V7-already-stated"


def test_v7_refuses_a_self_loop():
    c = _clause("PE 0604827A was transferred to PE 0604827A", pe="0604827A")
    rows, refusals = _run(c, "0604827A", "0604827A")
    assert rows == []
    assert refusals[0].rule == "V7-self-loop"


def test_v9_refuses_a_pair_the_clauses_own_rules_contradict():
    """One rule set arbitrates one sentence.

    verify_lineage leg (a) refuses any stated edge whose endpoints contradict
    sentence_named_pairs. Refusing it here means the seed never carries a row
    the gate would reject.
    """
    c = _clause(
        "Work transferred from PE 0207436F and was transferred to PE 0303004F",
        pe="0837300",
    )
    rows, refusals = _run(c, "0303004F", "0207436F")
    assert rows == []
    assert refusals[0].rule == "V9-contradicts-named-pairs"


# ---------------------------------------------------------------------------
# Candidate selection — the model never sees a codeless clause
# ---------------------------------------------------------------------------


def test_candidates_require_a_code_so_a_model_can_never_originate_one():
    narratives = [
        {
            "pe_bli": "0604827A",
            "fiscal_year": 2026,
            "fact_id": "f1",
            "page": None,
            # verb, no code -> not a candidate. The Phase-2 title crosswalk is
            # a separate matcher with a separate precision measurement.
            "body": "This effort was transferred to the Advanced Component"
                    " Development program. Realignment to PE 0609345A follows.",
        }
    ]
    got = candidates(narratives)
    assert [c.sentence for c in got] == ["Realignment to PE 0609345A follows."]


def test_candidates_skip_a_codeless_technology_transfer_sentence():
    narratives = [
        {
            "pe_bli": "0605502N", "fiscal_year": 2026, "fact_id": "f2", "page": None,
            "body": "The Small Business Technology Transfer (STTR) program"
                    " requires a set aside.",
        }
    ]
    assert candidates(narratives) == []


# ---------------------------------------------------------------------------
# The seed, and the drift it must surface
# ---------------------------------------------------------------------------


def test_load_ratified_rejects_an_unadjudicated_row(tmp_path):
    seed = tmp_path / "seed.csv"
    write_seed(seed, [{
        "clause_id": "c1", "from_pe_bli": "0604827A", "to_pe_bli": "0609345A",
        "relation": "realigned", "verdict": "", "narrating_pe": "0604827A",
        "fiscal_year": 2026, "evidence_fact_id": "f1",
        "evidence_sentence": "s", "from_title": "", "to_title": "",
        "curator_notes": "",
    }])
    with pytest.raises(ValueError, match="unadjudicated"):
        load_ratified(seed)


def test_ratified_edges_drops_a_row_whose_clause_has_moved(tmp_path):
    seed = tmp_path / "seed.csv"
    rows = [{
        "clause_id": "c1", "from_pe_bli": "0604827A", "to_pe_bli": "0609345A",
        "relation": "realigned", "verdict": "y", "narrating_pe": "0604827A",
        "fiscal_year": 2026, "evidence_fact_id": "f1",
        "evidence_sentence": "Realignment to PE 0609345A follows.",
        "from_title": "", "to_title": "", "curator_notes": "",
    }]
    write_seed(seed, rows)
    live = [{"pe_bli": "0604827A", "fiscal_year": 2026, "fact_id": "f1",
             "page": None, "body": "Realignment to PE 0609345A follows."}]
    assert len(ratified_edges(seed, live)) == 1
    # the body no longer carries the clause -> the edge is NOT minted
    moved = [{"pe_bli": "0604827A", "fiscal_year": 2026, "fact_id": "f1",
              "page": None, "body": "Something else entirely."}]
    assert ratified_edges(seed, moved) == []


def test_ratified_edges_never_carries_a_portion_amount(tmp_path):
    """spec §6.4 — /lineage/ draws one constant ribbon width on this premise."""
    seed = tmp_path / "seed.csv"
    sentence = "FY26 funding ($4.108M) for BA 07 Project 0207418F was"\
               " transferred to BA 07 Project 0207457F"
    write_seed(seed, [{
        "clause_id": "c1", "from_pe_bli": "0207418F", "to_pe_bli": "0207457F",
        "relation": "realigned", "verdict": "y", "narrating_pe": "0207418F",
        "fiscal_year": 2026, "evidence_fact_id": "f1",
        "evidence_sentence": sentence, "from_title": "", "to_title": "",
        "curator_notes": "",
    }])
    live = [{"pe_bli": "0207418F", "fiscal_year": 2026, "fact_id": "f1",
             "page": None, "body": sentence}]
    (edge,) = ratified_edges(seed, live)
    assert edge.portion_amount is None
    assert edge.confidence == "stated"


def test_measure_reports_precision_and_stale_rows():
    rows = [
        {"from_pe_bli": "A", "to_pe_bli": "B", "verdict": "y", "clause_id": "c1"},
        {"from_pe_bli": "C", "to_pe_bli": "D", "verdict": "y", "clause_id": "c2"},
        {"from_pe_bli": "E", "to_pe_bli": "F", "verdict": "n", "clause_id": "c3"},
    ]
    rep = measure(rows, {"c1", "c3"})
    assert (rep.adjudicated, rep.accepted, rep.rejected) == (3, 2, 1)
    assert rep.precision == pytest.approx(2 / 3)
    assert rep.stale == ["C->D (c2)"]


def test_measure_precision_is_zero_on_an_empty_seed_not_one():
    """`0/0` must not read as perfect precision — the empty-array trap."""
    rep = measure([], set())
    assert rep.adjudicated == 0
    assert rep.precision == 0.0


# ---------------------------------------------------------------------------
# Cost — the cap is a ceiling, and says so
# ---------------------------------------------------------------------------


def test_estimate_cost_labels_the_cap_basis_when_no_run_is_archived(tmp_path,
                                                                    monkeypatch):
    import govbudget.lineage.llm_extract as lx

    monkeypatch.setattr(lx, "_observed_mean_output_tokens", lambda *a, **k: None)
    est = estimate_cost([_clause("Realignment to PE 0609345A follows")])
    assert est["output_basis"] == "cap"
    assert est["output_tokens_assumed"] == lx.MAX_OUTPUT_TOKENS


def test_observed_output_tokens_needs_five_samples(tmp_path):
    import json

    from govbudget.lineage.llm_extract import _observed_mean_output_tokens

    raw = tmp_path / "lineage-raw"
    raw.mkdir()
    def _write(n):
        (raw / "results-b.jsonl").write_text("\n".join(
            json.dumps({"custom_id": f"lin-{i}", "result": {
                "type": "succeeded",
                "message": {"usage": {"output_tokens": 200 + i}}}})
            for i in range(n)
        ), encoding="utf-8")
    _write(4)
    assert _observed_mean_output_tokens(raw) is None
    _write(6)
    assert _observed_mean_output_tokens(raw) == round(sum(200 + i for i in range(6)) / 6)


# ---------------------------------------------------------------------------
# V10 / V11 — the two rules the pilot's 90.5% bought
# ---------------------------------------------------------------------------


def test_v11_refuses_the_one_time_adjustment_the_pilot_rejected():
    """The real pilot rejection, verbatim.

    True and correctly cited — and the same paragraph names EGS's actual
    successor. A one-time execution adjustment rendered as "realigned to" is a
    true number wearing a false label.
    """
    c = _clause(
        "There was a one-time technical adjustment in FY 2025 approved by"
        " Congress that moved EGS funding from PE 1206770SF to PE 1206857SF,"
        " Space Rapid Capabilities Office, which improved funding execution in"
        " FY 2025",
        pe="1206772SF",
    )
    rows, refusals = _run(c, "1206770SF", "1206857SF")
    assert rows == []
    assert refusals[0].rule == "V11-transient"
    assert "one-time" in refusals[0].reason


def test_v11_does_not_refuse_a_technical_adjustment_that_stands_up_a_new_pe():
    """The pilot's 0207431F -> 0303010F, which is lineage and must survive.

    This is why TRANSIENT_CUES carries "one-time" and not "technical
    adjustment": the two clauses share the phrase and mean opposite things.
    """
    c = _clause(
        "Congressional technical adjustment transferred 18.733M from CAIS PE"
        " 0207431F in RDT&E for FY25",
        pe="0303010F",
    )
    rows, refusals = _run(c, "0207431F", "0303010F")
    assert refusals == []
    assert len(rows) == 1


def _confirmation(**over):
    from govbudget.lineage.llm_extract import Confirmation

    base = dict(
        clause_id="", from_pe_bli="", to_pe_bli="",
        is_budget_identity_move=True, direction_correct=True,
        is_one_time_or_temporary=False, grain_is_program_element=True,
        supporting_fragment="transferred to PE 0609345A",
    )
    base.update(over)
    return Confirmation(**base)


def test_v10_refuses_when_the_second_read_rejects_the_direction():
    """The pilot's other rejection: an inverted direction on a spending sentence."""
    c = _clause(
        "In addition, following the realignment of FY 2021 resources,"
        " approximately $2.000 million of Systems Engineering (0605142D8Z)"
        " resources will be used to sustain SERC operations",
        pe="0603833D8Z",
    )
    conf = _confirmation(
        clause_id=c.clause_id, from_pe_bli="0603833D8Z", to_pe_bli="0605142D8Z",
        direction_correct=False, supporting_fragment="",
    )
    rows, refusals = _run(
        c, "0603833D8Z", "0605142D8Z",
        confirmations={(c.clause_id, "0603833D8Z", "0605142D8Z"): conf},
    )
    assert rows == []
    assert refusals[0].rule == "V10-unconfirmed"
    assert "direction" in refusals[0].reason


def test_v10_refuses_a_supporting_fragment_that_is_not_verbatim():
    """A quote the sentence does not contain is not evidence, it is a summary."""
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    conf = _confirmation(
        clause_id=c.clause_id, from_pe_bli="0604827A", to_pe_bli="0609345A",
        supporting_fragment="funding moved from 0604827A into 0609345A",
    )
    rows, refusals = _run(
        c, "0604827A", "0609345A",
        confirmations={(c.clause_id, "0604827A", "0609345A"): conf},
    )
    assert rows == []
    assert refusals[0].rule == "V10-unconfirmed"
    assert "verbatim" in refusals[0].reason


def test_v10_refuses_an_unconfirmed_pair_when_confirmation_is_required():
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    rows, refusals = _run(c, "0604827A", "0609345A", require_confirmation=True)
    assert rows == []
    assert refusals[0].rule == "V10-unconfirmed"


def test_v10_ablation_lets_the_same_pair_through_so_it_can_be_measured():
    """The stage's worth is measured by ablation, not asserted (ROADMAP #30)."""
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    rows, refusals = _run(c, "0604827A", "0609345A", require_confirmation=False)
    assert refusals == []
    assert len(rows) == 1


def test_v10_accepts_a_confirmed_pair():
    c = _clause("Funding was transferred to PE 0609345A", pe="0604827A")
    conf = _confirmation(
        clause_id=c.clause_id, from_pe_bli="0604827A", to_pe_bli="0609345A",
    )
    rows, refusals = _run(
        c, "0604827A", "0609345A",
        confirmations={(c.clause_id, "0604827A", "0609345A"): conf},
    )
    assert refusals == []
    assert len(rows) == 1


def test_v10_any_refusal_wins_across_duplicate_clauses():
    """Two identical sentences, two different second reads — the refusal binds.

    Measured in the live corpus: 2 of 52 pairs drew a split verdict from the
    confirmation stage because the same sentence appears in more than one
    narrative and the second read is a model, not a function. Honouring the
    per-clause verdict would let a refused pair in through whichever duplicate
    happened to pass.
    """
    text = "Funding was transferred to PE 0609345A"
    a = _clause(text, pe="0604827A", fact="fidA")
    b = _clause(text, pe="0604827A", fact="fidB")
    clauses = {a.clause_id: a, b.clause_id: b}
    confs = {
        (a.clause_id, "0604827A", "0609345A"): _confirmation(
            clause_id=a.clause_id, from_pe_bli="0604827A", to_pe_bli="0609345A"),
        (b.clause_id, "0604827A", "0609345A"): _confirmation(
            clause_id=b.clause_id, from_pe_bli="0604827A", to_pe_bli="0609345A",
            is_budget_identity_move=False),
    }
    props = [
        Proposal(a.clause_id, "0604827A", "0609345A", "realigned"),
        Proposal(b.clause_id, "0604827A", "0609345A", "realigned"),
    ]
    rows, refusals = verify(props, clauses, confirmations=confs,
                            require_confirmation=True)
    assert rows == []
    assert all(r.rule == "V10-unconfirmed" for r in refusals)
    assert "any refusal is binding" in refusals[0].reason
