# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up voice flashcards (doc 24 §3/§10/§13/§14 + spec §5 hardening): the orchestrator —
# server-side grading + apply, card binding/replay guard, server-side attempt ladder, honest
# failed apply, the paraphrase bloom, and corpus-file variants.
# Run out-of-process (AI OFF so grading is the deterministic lexical floor):
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 AI_DISABLED=1 out/pyenv/bin/python -m pytest tests/scores/test_voice_review.py

import json
import os
import tempfile

import pytest

from anki.collection import Collection
from anki.decks import DeckId
from journey import voice_review
from scores.telemetry import sidecar

os.environ["AI_DISABLED"] = (
    "1"  # force the deterministic lexical grader for these tests
)


@pytest.fixture(autouse=True)
def _fresh_session():
    voice_review._reset_session()
    yield
    voice_review._reset_session()


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _add_card(col: Collection, front: str, back: str) -> int:
    note = col.newNote()
    note["Front"] = front
    note["Back"] = back
    col.add_note(note, DeckId(1))
    return note.cards()[0].id


def _serve(col: Collection) -> dict:
    card = voice_review.next_card(col)
    assert card is not None and not card.get("no_variant")
    return card


def test_next_card_hides_the_answer():
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    card = voice_review.next_card(col)
    assert card is not None
    assert (
        "mitochondria" not in card["keeper_line"].lower()
    )  # the Keeper asks the QUESTION
    assert "keeper_line" in card and "card_id" in card
    # the reference answer is never in the next-card payload
    assert "the mitochondria" not in str(card).lower()
    col.close()


def test_empty_queue_returns_none():
    col = _fresh_col()
    assert voice_review.next_card(col) is None
    col.close()


def test_good_answer_grades_and_applies():
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    served = _serve(col)
    res = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="the mitochondria"
    )
    assert res["applied"] is True
    assert res["bucket"] == "good"
    assert res["correct_answer"] == "the mitochondria"
    assert res["recovered"] is False
    # currency is the CLIENT's ledger (spec ruling 4) — the server returns no reward/balance
    assert "reward" not in res and "balance" not in res
    # the review was applied through the real scheduler -> a revlog row exists
    assert col.db.scalar("select count(*) from revlog") == 1
    col.close()


def test_client_cannot_spoof_correctness():
    """A wrong transcript is graded wrong even though the client 'submitted an answer' (§5.2)."""
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    served = _serve(col)
    res = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="the nucleus stores dna"
    )
    assert res["bucket"] in ("dont_know", "ask_again")
    if res["applied"]:
        assert res["rating"] == voice_review.RATING_AGAIN
    col.close()


def test_idk_is_dont_know():
    col = _fresh_col()
    _add_card(col, "q", "some answer")
    served = _serve(col)
    res = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="", idk=True
    )
    assert res["bucket"] == "dont_know"
    assert res["rating"] == voice_review.RATING_AGAIN
    assert res["applied"] is True
    col.close()


def test_spoken_prompt_field_variant_blooms_on_pass():
    """A passed reworded (SpokenPrompt notetype field) variant blooms (§14)."""
    col = _fresh_col()
    m = col.models.by_name("Basic")
    col.models.add_field(m, col.models.new_field(voice_review.SPOKEN_PROMPT_FIELD))
    col.models.save(m)
    note = col.newNote()
    note["Front"] = "What powers the cell?"
    note["Back"] = "the mitochondria"
    note[voice_review.SPOKEN_PROMPT_FIELD] = "Which organelle is the cell's powerhouse?"
    col.add_note(note, DeckId(1))

    card = voice_review.next_card(col)
    assert card is not None
    assert card["is_fresh_variant"] is True
    assert "powerhouse" in card["keeper_line"].lower()

    res = voice_review.grade_answer(
        col, card_id=card["card_id"], transcript="the mitochondria"
    )
    assert res["bucket"] == "good"
    assert res["bloomed"] is True
    col.close()


def test_no_variant_falls_back_to_question_no_bloom():
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    card = voice_review.next_card(col)
    assert card is not None
    assert card["is_fresh_variant"] is False
    res = voice_review.grade_answer(
        col, card_id=card["card_id"], transcript="the mitochondria"
    )
    assert (
        res["bloomed"] is False
    )  # a plain question grows but is not a paraphrase-bloom
    col.close()


def test_plain_front_is_phrased_as_the_keeper_asking():
    """Dialogue-UX rework (2026-07-03): a plain front gets a conversational opener — stable
    per card, the question kept verbatim after it, and NEVER marked as a reworded variant
    (openers are presentation; bloom integrity stays with true paraphrases)."""
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    card = voice_review.next_card(col)
    assert card is not None
    line = card["keeper_line"]
    assert line.endswith("What powers the cell?")
    assert any(line.startswith(o) for o in voice_review._ASK_OPENERS)
    assert card["is_fresh_variant"] is False
    # deterministic: the same card re-served reads the same way
    voice_review._reset_session()
    again = voice_review.next_card(col)
    assert again is not None
    assert again["keeper_line"] == line
    col.close()


def test_authored_variants_stay_verbatim_no_opener(monkeypatch, tmp_path):
    """Authored reworded prompts are already tutor-voiced — no opener is glued on."""
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    front_hash = voice_review._front_hash("What powers the cell?")
    served_plain = voice_review.next_card(col)
    assert served_plain is not None
    vdir = tmp_path / "variants"
    vdir.mkdir()
    (vdir / "test.jsonl").write_text(
        json.dumps(
            {
                "deck_path": served_plain["node_id"],
                "front_hash": front_hash,
                "spoken_prompt": "Which organelle keeps the lights on?",
                "source_id": "openstax-biology-2e",
            }
        )
        + "\n"
    )
    monkeypatch.setattr(voice_review, "_VARIANTS_DIR", vdir)
    monkeypatch.setattr(voice_review, "_variants_cache", None)
    voice_review._reset_session()
    served = voice_review.next_card(col)
    assert served is not None
    assert served["keeper_line"] == "Which organelle keeps the lights on?"
    col.close()


# --- spec §5 hardening -------------------------------------------------------------------------


def test_grade_rejects_unserved_card():
    """Hardening: grading is bound to the card next_card served (anti-replay/farming)."""
    col = _fresh_col()
    _add_card(col, "q", "a")
    res = voice_review.grade_answer(col, card_id=999999, transcript="anything")
    assert res["applied"] is False
    assert res["error"] == "not_served"
    assert col.db.scalar("select count(*) from revlog") == 0
    col.close()


def test_grade_rejects_replay_after_terminal():
    col = _fresh_col()
    _add_card(col, "q", "a")
    served = _serve(col)
    first = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="", idk=True
    )
    assert first["applied"] is True
    replay = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="", idk=True
    )
    assert replay["applied"] is False
    assert replay["error"] == "not_served"
    assert col.db.scalar("select count(*) from revlog") == 1  # only the first landed
    col.close()


def test_attempt_tracked_server_side(monkeypatch):
    """A mid-band answer re-prompts once; the SECOND grade is terminal even if the client lies."""
    col = _fresh_col()
    _add_card(col, "q", "a")
    monkeypatch.setattr(
        voice_review.ai_grade,
        "grade_spoken",
        lambda *a, **k: voice_review.ai_grade.Grade(
            score_0_100=50.0,
            bucket=voice_review.ai_grade.BUCKET_ASK_AGAIN,
            method="lexical",
            rationale="mid",
        ),
    )
    served = _serve(col)
    first = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="partial"
    )
    assert first["applied"] is False and first["re_prompt"]["attempt"] == 2
    assert col.db.scalar("select count(*) from revlog") == 0  # not committed yet
    second = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="partial"
    )
    assert second["applied"] is True
    assert second["bucket"] == "dont_know"  # terminal ask-again falls to AGAIN
    assert second["rating"] == voice_review.RATING_AGAIN
    col.close()


def test_failed_apply_reports_error_and_writes_nothing(monkeypatch):
    """Hardening: if answerCard fails, nothing is logged and applied=False (never silent)."""
    col = _fresh_col()
    _add_card(col, "q", "a")
    served = _serve(col)
    monkeypatch.setattr(voice_review, "_apply_through_scheduler", lambda *a, **k: None)
    res = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="", idk=True
    )
    assert res["applied"] is False
    assert res["error"] == "apply_failed"
    assert sidecar.read_audio_grades(col) == []
    col.close()


def test_recovered_flag_on_attempt_two_pass(monkeypatch):
    col = _fresh_col()
    _add_card(col, "q", "a")
    grades = iter(
        [
            voice_review.ai_grade.Grade(
                score_0_100=50.0,
                bucket=voice_review.ai_grade.BUCKET_ASK_AGAIN,
                method="lexical",
                rationale="",
            ),
            voice_review.ai_grade.Grade(
                score_0_100=80.0,
                bucket=voice_review.ai_grade.BUCKET_OKAY,
                method="lexical",
                rationale="",
            ),
        ]
    )
    monkeypatch.setattr(
        voice_review.ai_grade, "grade_spoken", lambda *a, **k: next(grades)
    )
    served = _serve(col)
    voice_review.grade_answer(col, card_id=served["card_id"], transcript="partial")
    second = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="better"
    )
    assert second["applied"] is True
    assert second["bucket"] == "okay"
    assert second["recovered"] is True
    col.close()


# --- variants corpus (spec ruling 5) -----------------------------------------------------------


def test_variant_from_corpus_file(monkeypatch, tmp_path):
    """A variants JSONL row keyed by (deck_path, front_hash) rewords the Keeper's line."""
    col = _fresh_col()
    _add_card(col, "What powers the cell?", "the mitochondria")
    served_plain = voice_review.next_card(col)
    assert served_plain is not None

    front_hash = voice_review._front_hash("What powers the cell?")
    vdir = tmp_path / "variants"
    vdir.mkdir()
    (vdir / "test.jsonl").write_text(
        json.dumps(
            {
                "deck_path": served_plain["node_id"],
                "front_hash": front_hash,
                "spoken_prompt": "Reworded: explain it in your own words.",
                "source_id": "openstax-psychology-2e",
            }
        )
        + "\n"
    )
    monkeypatch.setattr(voice_review, "_VARIANTS_DIR", vdir)
    monkeypatch.setattr(voice_review, "_variants_cache", None)
    voice_review._reset_session()

    served = voice_review.next_card(col)
    assert served is not None
    assert served["keeper_line"] == "Reworded: explain it in your own words."
    assert served["is_fresh_variant"] is True

    res = voice_review.grade_answer(
        col, card_id=served["card_id"], transcript="the mitochondria"
    )
    assert res["bloomed"] is True  # a passed corpus variant blooms like a field variant
    col.close()


def test_prefer_variant_returns_no_variant_marker(monkeypatch, tmp_path):
    """prefer_variant with no variant anywhere in the window returns the honest marker."""
    col = _fresh_col()
    _add_card(col, "q1", "a1")
    monkeypatch.setattr(voice_review, "_VARIANTS_DIR", tmp_path / "empty")
    monkeypatch.setattr(voice_review, "_variants_cache", None)
    res = voice_review.next_card(col, prefer_variant=True)
    assert res == {"no_variant": True}
    col.close()


def test_bad_variants_file_never_breaks_the_loop(monkeypatch, tmp_path):
    vdir = tmp_path / "variants"
    vdir.mkdir()
    (vdir / "broken.jsonl").write_text("{not json\n")
    monkeypatch.setattr(voice_review, "_VARIANTS_DIR", vdir)
    monkeypatch.setattr(voice_review, "_variants_cache", None)
    assert voice_review.load_variants() == {}


@pytest.mark.skipif(
    not (
        voice_review._VARIANTS_DIR.is_dir()
        and any(voice_review._VARIANTS_DIR.glob("*.jsonl"))
    ),
    reason="variants corpus not generated yet (scripts/gen_spoken_variants.py needs ANTHROPIC_API_KEY)",
)
def test_real_variants_corpus_loads(monkeypatch):
    """The shipped corpus indexes without error and every row has provenance (C2)."""
    monkeypatch.setattr(voice_review, "_variants_cache", None)
    index = voice_review.load_variants()
    assert len(index) > 4000
    assert all(row.get("source_id") for row in index.values())
