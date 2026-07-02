# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# Voice flashcards (doc 24 §3/§9/§16): the score→bucket contract, the never-round-up rule, the
# AI-OFF sentinel, and the semantic clamp. Run out-of-process:
#   out/pyenv/bin/python -m pytest ai/tests/test_grade_buckets.py

from __future__ import annotations

import sys

import pytest

import ai.grade as grade
from ai.grade import (
    ASK_AGAIN_CUTOFF,
    BUCKET_ASK_AGAIN,
    BUCKET_DONT_KNOW,
    BUCKET_GOOD,
    BUCKET_OKAY,
    GOOD_CUTOFF,
    LEXICAL_SENTINEL,
    OKAY_CUTOFF,
    Grade,
    bucket_for,
    grade_spoken,
    lexical_score,
)


def test_ai_grade_module_does_not_import_engine():
    # The ai/ package wall: grading must never pull in the Anki engine.
    assert "anki" not in sys.modules or "anki.collection" not in sys.modules


@pytest.mark.parametrize(
    "score,expected",
    [
        (1.0, BUCKET_GOOD),
        (GOOD_CUTOFF, BUCKET_GOOD),  # exact floor is inclusive
        (GOOD_CUTOFF - 0.001, BUCKET_OKAY),  # never rounds UP into GOOD
        (OKAY_CUTOFF, BUCKET_OKAY),
        (OKAY_CUTOFF - 0.001, BUCKET_ASK_AGAIN),
        (ASK_AGAIN_CUTOFF, BUCKET_ASK_AGAIN),
        (ASK_AGAIN_CUTOFF - 0.001, BUCKET_DONT_KNOW),
        (0.0, BUCKET_DONT_KNOW),
    ],
)
def test_bucket_boundaries_never_round_up(score, expected):
    assert bucket_for(score) == expected


def test_idk_is_always_dont_know():
    assert bucket_for(0.99, idk=True) == BUCKET_DONT_KNOW


def test_lexical_exact_match_is_full_marks():
    assert lexical_score("the mitochondria", "the mitochondria") == 1.0


def test_lexical_empty_transcript_is_zero():
    assert lexical_score("mitochondria", "") == 0.0


def test_lexical_filler_words_are_ignored():
    # "um, well, it's the mitochondria" should grade like "mitochondria".
    assert lexical_score("mitochondria", "um well it's the mitochondria") >= GOOD_CUTOFF


def test_lexical_wrong_answer_scores_low():
    assert (
        lexical_score("mitochondria produce ATP", "the nucleus stores DNA")
        < ASK_AGAIN_CUTOFF
    )


def test_full_sentence_answer_is_not_penalized():
    # Speaking the answer inside a natural fuller sentence still earns GOOD.
    score = lexical_score(
        "the mitochondria", "the mitochondria is the powerhouse of the cell"
    )
    assert score >= GOOD_CUTOFF


def test_keyword_stuffing_is_not_floored():
    # Burying the reference in a wall of junk must NOT be rescued by the complete-recall floor.
    stuffing = "mitochondria " + " ".join(
        f"filler{i} unrelated{i} word{i}" for i in range(30)
    )
    assert lexical_score("mitochondria", stuffing) < GOOD_CUTOFF


def test_grade_ai_off_uses_lexical_and_shows_sentinel(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AI_DISABLED", "1")
    g = grade_spoken("What powers the cell?", "the mitochondria", "the mitochondria")
    assert g.method == "lexical"
    assert g.sentinel == LEXICAL_SENTINEL
    assert g.bucket == BUCKET_GOOD
    assert g.source_id is None  # no AI => no rubric provenance claimed


def test_grade_ai_off_never_emits_fake_semantic_score(monkeypatch):
    monkeypatch.setenv("AI_DISABLED", "1")
    g = grade_spoken(
        "q", "a totally different reference answer", "unrelated words here"
    )
    assert g.method == "lexical"
    assert g.bucket in (BUCKET_DONT_KNOW, BUCKET_ASK_AGAIN)


def test_idk_skips_grading_and_shows_answer(monkeypatch):
    monkeypatch.setenv("AI_DISABLED", "1")
    g = grade_spoken("q", "mitochondria", "anything", idk=True)
    assert g.bucket == BUCKET_DONT_KNOW
    assert g.score_0_100 == 0.0
    assert "mitochondria" in g.key_points_missed


def test_empty_transcript_is_dont_know(monkeypatch):
    monkeypatch.setenv("AI_DISABLED", "1")
    g = grade_spoken("q", "mitochondria", "   ")
    assert g.bucket == BUCKET_DONT_KNOW


def test_semantic_clamped_by_lexical_floor(monkeypatch):
    # A hallucinated 100 with near-zero lexical footing must NOT mint a GOOD.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("AI_DISABLED", raising=False)
    monkeypatch.setattr(grade, "ai_enabled", lambda: True)
    monkeypatch.setattr(
        grade,
        "_semantic_judge",
        lambda *a, **k: (1.0, "looks great", ["all"], [], "grader:test"),
    )
    g = grade_spoken("q", "photosynthesis converts light to sugar", "banana pancakes")
    assert g.method == "semantic"
    assert g.bucket != BUCKET_GOOD  # clamp + disagreement cap keep it out of mastery


def test_semantic_pass_when_lexically_grounded(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("AI_DISABLED", raising=False)
    monkeypatch.setattr(grade, "ai_enabled", lambda: True)
    monkeypatch.setattr(
        grade,
        "_semantic_judge",
        lambda *a, **k: (0.95, "nailed it", ["ATP"], [], "grader:test"),
    )
    g = grade_spoken(
        "What do mitochondria make?", "mitochondria make ATP", "mitochondria make ATP"
    )
    assert g.method == "semantic"
    assert g.bucket == BUCKET_GOOD
    assert g.source_id == "grader:test"  # C2: the rubric/judge carries provenance


def test_semantic_failure_falls_back_to_lexical(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("AI_DISABLED", raising=False)
    monkeypatch.setattr(grade, "ai_enabled", lambda: True)

    def _boom(*a, **k):
        raise RuntimeError("judge down")

    monkeypatch.setattr(grade, "_semantic_judge", _boom)
    g = grade_spoken("q", "the mitochondria", "the mitochondria")
    assert g.method == "lexical"  # honest fallback, no crash
    assert g.bucket == BUCKET_GOOD


def test_grade_is_a_dataclass_contract():
    g = Grade(score_0_100=88.0, bucket=BUCKET_OKAY, method="lexical", rationale="x")
    assert g.key_points_hit == [] and g.key_points_missed == []
