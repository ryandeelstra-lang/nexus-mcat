# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: the three honest scores + give-up seam (Block C W8/W9). Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/

import os
import tempfile

import pytest
from anki.collection import Collection
from anki.decks import DeckId

from scores import coverage, display, engine, give_up, memory


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    col = Collection(path)
    engine.enable_fsrs(col)
    return col


def _add(col: Collection, deck_path: str, front: str = "q", back: str = "a") -> int:
    deck_id = col.decks.id(deck_path)
    note = col.newNote()
    note["Front"] = front
    note["Back"] = back
    col.add_note(note, deck_id)
    return deck_id


def _answer_one_in_default(col: Collection) -> None:
    note = col.newNote()
    note["Front"] = "q"
    note["Back"] = "a"
    col.add_note(note, DeckId(1))
    card = col.sched.getCard()
    if card is None:
        col.reset()
        card = col.sched.getCard()
    assert card is not None, "no card queued to answer"
    col.sched.answerCard(card, 3)  # Good


def test_memory_consumes_rpc_not_recompute():
    col = _fresh_col()
    _answer_one_in_default(col)
    topics = engine.mastery_topics(col)
    rpc = {t.deck_name: t.average_recall for t in topics if t.cards_with_state > 0}
    assert rpc, "expected at least one topic with FSRS state after answering"
    assert memory.memory_by_topic(topics) == pytest.approx(rpc)  # consume, not recompute
    assert memory.memory_n(topics) >= 1
    col.close()


def test_dashboard_is_read_only():
    col = _fresh_col()
    _answer_one_in_default(col)
    # The collection's OPEN path already pre-warmed timing (backend/collection.rs), so the first
    # mastery_query is a cache hit; the snapshot proves the dashboard writes nothing of its own.
    before = (col.db.scalar("select count() from revlog"), col.db.scalar("select scm from col"))
    display.dashboard(col, "")
    after = (col.db.scalar("select count() from revlog"), col.db.scalar("select scm from col"))
    assert before == after  # scoring touches nothing
    col.close()


def test_readiness_abstains_below_floor():
    col = _fresh_col()
    _add(col, "MCAT::B-B::1D")
    r = display.dashboard(col, "")["readiness"]
    assert r["available"] is False
    assert "graded reviews" in r["reason"] or "covered" in r["reason"]
    assert r["best_next"] is not None  # a structured next-step, never a fabricated number
    assert "point" not in r  # no readiness float emitted below the floor
    col.close()


def test_coverage_denominators_31_and_34():
    col = _fresh_col()
    for p in ["MCAT::B-B::1D", "MCAT::C-P::4A", "MCAT::P-S::6A"]:
        _add(col, p)
    cov = coverage.coverage(engine.mastery_topics(col), coverage.load_taxonomy())
    assert cov["gate_total"] == 31  # readiness gate denominator
    assert cov["display_total"] == 34  # displayed coverage denominator
    assert cov["gate_covered"] == 3
    assert cov["gate_fraction"] == pytest.approx(3 / 31)
    col.close()


def test_memory_renders_with_range_and_five_elements():
    col = _fresh_col()
    _answer_one_in_default(col)
    m = display.memory_display(col, engine.mastery_topics(col))
    assert m["available"] is True
    assert isinstance(m["range"], list) and len(m["range"]) == 2
    for element in ("evidence", "missing_data", "past_accuracy", "range", "best_next"):
        assert element in m  # the five honesty elements
    col.close()


def test_provenance_negative_control():
    col = _fresh_col()
    _add(col, "MCAT::B-B::1D")
    assert engine.data_provenance(col) == "real"
    assert display.dashboard(col, "")["memory"]["data_provenance"] == "real"
    # Flip the synthetic marker -> provenance flips; a synthetic-marked collection is never 'real'.
    col.set_config(engine.SYNTHETIC_MARKER, True)
    assert engine.data_provenance(col) == "synthetic"
    assert display.memory_display(col, engine.mastery_topics(col))["data_provenance"] == "synthetic"
    col.close()


def test_thresholds_are_the_locked_values():
    assert give_up.READINESS_MIN_GRADED_REVIEWS == 1000
    assert give_up.READINESS_MIN_COVERAGE == 0.75
    assert give_up.PERFORMANCE_MIN_ITEMS == 20


def test_readiness_available_branch_emits_mapped_point_not_a_bare_float(monkeypatch):
    # Block G/W3.6 landed: when the give-up floor is cleared, the readiness payload now carries a
    # 472-528 point + range from the documented map (never a fabricated/bare number). The point must
    # be a real int on the AAMC scale and the honesty elements (evidence/range/note) must be present.
    monkeypatch.setattr(give_up, "readiness_available", lambda *a, **k: True)
    col = _fresh_col()
    r = display.readiness_display(
        col, [], gate_coverage_fraction=1.0, section_perf={"acc": 0.5, "acc_range": [0.4, 0.6]}
    )
    assert r["available"] is True
    assert isinstance(r["point"], int) and 472 <= r["point"] <= 528
    assert isinstance(r["range"], list) and len(r["range"]) == 2
    assert r["range"][0] <= r["point"] <= r["range"][1]
    assert "UNVALIDATED" in r["note"]  # honesty: the map is not validated against real outcomes
    col.close()


def test_provenance_is_one_of_two_typed_values():
    col = _fresh_col()
    assert engine.data_provenance(col) in (engine.REAL, engine.SYNTHETIC)
    assert engine.data_provenance(col) == engine.REAL
    col.set_config(engine.SYNTHETIC_MARKER, True)
    assert engine.data_provenance(col) == engine.SYNTHETIC
    col.close()


def test_performance_does_not_claim_topic_data_it_lacks(tmp_path, monkeypatch):
    # The dashboard has no per-topic context, so a performance ABSTENTION must NOT claim
    # "< N graded items on this topic" — that read as a false statement for every student
    # regardless of their real review history. The per-topic clause is only honest once a real
    # topic_items count is actually supplied. (The artifact is pointed at a missing path so this
    # pins the no-eval abstention; with an artifact present the score is available instead.)
    from scores import heldout

    monkeypatch.setenv(heldout.ENV_KEY, str(tmp_path / "no-artifact.txt"))
    col = _fresh_col()
    _answer_one_in_default(col)
    perf = display.dashboard(col, "")["performance"]
    assert perf["available"] is False
    assert (
        "graded items on this topic" not in perf["reason"]
    ), f"dashboard must not fabricate a per-topic graded-items claim: {perf['reason']!r}"
    # The per-topic seam is preserved: when a real per-topic count IS passed, the clause is honest.
    assert "graded items on this topic" in display.performance_display(col, topic_items=5)["reason"]
    assert (
        "graded items on this topic"
        not in display.performance_display(col, topic_items=25)["reason"]
    )
    col.close()
