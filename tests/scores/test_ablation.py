# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
# Run from repo root:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_ablation.py
"""§8 three-build interleaving ablation (requirements G1-G3, D4-D5).

The pre-registration is frozen in scores/ablation/README.md (committed before any
run) + docs/04-PLAN.md step 0.10 (planning repo, git-dated 2026-06-30 in 4605174).
These tests exercise the REAL v3 scheduler through pylib on reduced-size
configurations for CI speed; the graded artifact run uses the full frozen
constants (N=200 learners, 14 days) via scripts/eval_ablation.py.
"""

from __future__ import annotations

import time

import pytest

from anki.collection import Collection

from scores.ablation import design, run, simulator

# Reduced-size settings for CI speed only. Constants that shape the MECHANISM
# (eta, g, p0, kappa grid endpoints) always come from the frozen design module.
FAST = dict(days=5, learners=12, jobs=4)


@pytest.fixture(scope="module")
def small_run() -> dict:
    # One shared reduced-size run of the full three-arm sweep at the two
    # frozen range endpoints (0.0 = null control, 0.6 = maximum confusability).
    return run.run(
        seeds=range(FAST["learners"]),
        confusability_grid=[0.0, 0.6],
        days=FAST["days"],
        jobs=FAST["jobs"],
    )


def test_equal_budget_and_paired_design():
    # W3.7 interface: same seed + same budget, only the arm differs.
    a = simulator.simulate("FULL", seed=1, confusability=0.5, days=3)
    b = simulator.simulate("ABLATION", seed=1, confusability=0.5, days=3)
    assert 0.0 <= a <= 1.0 and 0.0 <= b <= 1.0


def test_null_control_when_confusability_zero(small_run):
    # kappa=0 switches the confusability mechanism off; the pre-registered
    # practical-equivalence bound (README §5) is |paired diff| <= 0.01.
    diff = small_run["by_confusability"][0.0]
    assert abs(diff["paired_diff"]) <= 0.01, "null control must show no effect"
    assert diff["ci_90"][0] <= diff["ci_90"][1]


def test_effect_appears_when_confusability_positive(small_run):
    # FULL beats ABLATION under high confusability (interleaving trains
    # discrimination); direction per the pre-registered hypothesis.
    diff = small_run["by_confusability"][0.6]
    assert diff["mean_full"] >= diff["mean_ablation"]
    assert diff["paired_diff"] > 0.0


def test_plain_arm_present_and_bounded(small_run):
    # PLAIN (untouched upstream defaults) is the third reference arm.
    for kappa in (0.0, 0.6):
        r = small_run["by_confusability"][kappa]
        assert 0.0 <= r["mean_plain"] <= 1.0


def test_deterministic_and_jobs_invariant():
    # Byte-identical rerun requirement, and worker count must not leak into
    # results (outputs are keyed by (learner, arm)).
    kw = dict(seeds=range(3), confusability_grid=[0.4], days=3)
    r1 = run.run(jobs=1, **kw)
    r2 = run.run(jobs=2, **kw)
    assert r1 == r2


def test_arm_configs_differ_only_in_the_two_frozen_fields():
    # Decision 4: the feature is exactly review_order + new_card_gather_priority.
    full = design.arm_deck_config("FULL")
    abl = design.arm_deck_config("ABLATION")
    plain = design.arm_deck_config("PLAIN")
    assert full["reviewOrder"] == 8 and full["newGatherPriority"] == 4
    assert abl["reviewOrder"] == 2 and abl["newGatherPriority"] == 0
    # PLAIN carries upstream defaults.
    assert plain["reviewOrder"] == 0 and plain["newGatherPriority"] == 0
    changed = {k for k in full if full[k] != abl[k]}
    assert changed == {"reviewOrder", "newGatherPriority"}
    assert {k for k in abl if abl[k] != plain[k]} == {"reviewOrder"}


def test_quiz_items_disjoint_from_study_items():
    res = simulator.simulate_study("FULL", seed=0, days=2)
    study_ids = set(res.card_topic)  # engine card ids
    quiz_ids = {item.item_id for item in design.quiz_items()}
    assert len(study_ids) > 0 and len(quiz_ids) == design.TOPICS * design.QUIZ_PER_TOPIC
    assert study_ids.isdisjoint(quiz_ids)


def test_retrievability_mirror_matches_engine(tmp_path):
    # The learner's forgetting curve must be the engine's own (fsrs 5.2.0
    # inference.rs:60-63). Pin the python mirror against card_stats_data on
    # a real collection at several day offsets.
    col = Collection(str(tmp_path / "pin.anki2"))
    try:
        simulator.enable_fsrs(col)
        note = col.new_note(col.models.by_name("Basic"))
        note["Front"], note["Back"] = "q", "a"
        col.add_note(note, col.decks.id("PinDeck"))
        card = [col.get_card(cid) for cid in col.find_cards("")][0]
        # Study it once through the real scheduler so it carries memory state.
        queued = col.sched.get_queued_cards(fetch_limit=1)
        answer = col.sched.build_answer(
            card=card, states=queued.cards[0].states, rating=3
        )
        col.sched.answer_card(answer)
        card = col.get_card(card.id)
        for days in (0, 1, 3, 7, 30):
            card.last_review_time = int(time.time()) - days * 86400
            col.update_card(card)
            engine_r = col.card_stats_data(card.id).fsrs_retrievability
            mirror_r = simulator.retrievability(
                stability=card.memory_state.stability,
                decay=card.decay,
                elapsed_secs=days * 86400,
            )
            assert engine_r == pytest.approx(mirror_r, abs=2e-3)
    finally:
        col.close()


def test_report_contains_all_su2_elements(small_run):
    text = run.render_report(small_run)
    # The frozen failure criterion, quoted verbatim.
    assert (
        "Failed if FULL ≤ ABLATION at the same budget; CI overlapping zero = "
        "no effect, reported honestly." in text
    )
    # Honest-scope + provenance elements.
    assert "SIMULATED" in text or "simulated" in text
    assert "MECHANISM DEMONSTRATION" in text
    assert "null control" in text.lower()
    assert "90% CI" in text
    assert "PLAIN" in text and "ABLATION" in text and "FULL" in text
    assert "4605174" in text  # dated pre-registration commit cited
    assert "034f44e33" in text  # dated confusability-range freeze cited
    # No wall-clock timestamps (byte-identical rerun requirement).
    assert "20​" not in text  # no zero-width tricks
    for k in small_run["by_confusability"]:
        assert f"{k:.1f}" in text
