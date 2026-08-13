"""An agent crash must never score as a correct refusal.

Found 2026-08-13 in eval-20260813T012743Z: q042 ("winning bidders and bid
prices for MDA's THAAD contract competition", expected REFUSE) came back with
agent_answer="ERROR", turns=0, cost_usd=0.0 — the agent never ran — and scored
correct=True. verify_phase5's except-handler synthesised
{"refuse": True, "refuse_reason_class": "structurally_absent"} from the
exception, which is exactly the shape a genuine structural refusal has, so the
scorer could not tell them apart.

The consequence is that every REFUSE question in the set can be "passed" by
the agent crashing, and refusal coverage is silently overstated by however
many errors a run happens to hit. Same species as the defects this project
keeps finding on its own pages: a true-looking signal (correct=True) carrying
a false claim (the agent judged this correctly).
"""
from govbudget.verify_phase5 import _score_answer


REFUSE_ENTRY = {
    "expected_answer": "REFUSE",
    "expected_refuse_class": "structurally_absent",
}


def _crashed() -> dict:
    """The exact result shape verify_phase5 builds from an exception."""
    return {
        "answer": "ERROR",
        "error": True,
        "refuse": True,
        "refuse_reason_class": None,
        "turns": 0,
        "cost_usd": 0.0,
    }


def test_a_crash_does_not_score_as_a_correct_refusal():
    assert _score_answer(_crashed(), REFUSE_ENTRY) is False


def test_a_crash_does_not_score_correct_on_an_answered_question_either():
    entry = {"expected_answer": "Long Range Kill Chains, 3052.9", "tolerance": 0.1}
    assert _score_answer(_crashed(), entry) is False


def test_a_crash_still_fails_even_if_it_carries_the_expected_refuse_class():
    """Defence in depth: the pre-fix handler set refuse_reason_class to the
    very value REFUSE entries expect. Even if something restores that, the
    error flag alone must be disqualifying."""
    crashed = _crashed()
    crashed["refuse_reason_class"] = "structurally_absent"
    assert _score_answer(crashed, REFUSE_ENTRY) is False


def test_a_genuine_refusal_still_scores_correct():
    genuine = {
        "answer": "REFUSE",
        "refuse": True,
        "refuse_reason_class": "structurally_absent",
        "turns": 4,
        "cost_usd": 0.12,
    }
    assert _score_answer(genuine, REFUSE_ENTRY) is True


def test_a_genuine_refusal_of_the_wrong_class_still_fails():
    wrong_class = {
        "answer": "REFUSE",
        "refuse": True,
        "refuse_reason_class": "out_of_scope",
        "turns": 4,
        "cost_usd": 0.12,
    }
    assert _score_answer(wrong_class, REFUSE_ENTRY) is False
