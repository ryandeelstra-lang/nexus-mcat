# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up voice flashcards (doc 24 §3/§10/§13/§14): the orchestrator — server-side grading +
# apply, the reward table, the ask-again ladder, spoof-proofing, and the paraphrase bloom.
# Run out-of-process (AI OFF so grading is the deterministic lexical floor):
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 AI_DISABLED=1 out/pyenv/bin/python -m pytest tests/scores/test_voice_review.py

import os
import tempfile

from anki.collection import Collection
from anki.decks import DeckId

from journey import voice_review
from scores.telemetry import sidecar

os.environ["AI_DISABLED"] = (
    "1"  # force the deterministic lexical grader for these tests
)


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _add_card(col: Collection, front: str, back: str, spoken: str | None = None) -> int:
    note = col.newNote()
    note["Front"] = front
    note["Back"] = back
    col.add_note(note, DeckId(1))
    return note.cards()[0].id


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


def test_good_answer_grades_and_pays(monkeypatch):
    col = _fresh_col()
    cid = _add_card(col, "What powers the cell?", "the mitochondria")
    before_water = sidecar.get_balance(col, "water")
    res = voice_review.grade_answer(
        col, card_id=cid, transcript="the mitochondria", currency="water"
    )
    assert res["applied"] is True
    assert res["bucket"] == "good"
    assert res["reward"] == 3
    assert res["balance"] == before_water + 3
    assert res["correct_answer"] == "the mitochondria"
    # the review was applied through the real scheduler -> a revlog row exists
    assert col.db.scalar("select count(*) from revlog") == 1
    col.close()


def test_client_cannot_spoof_correctness(monkeypatch):
    """A wrong transcript is graded wrong even though the client 'submitted an answer' (§5.2)."""
    col = _fresh_col()
    cid = _add_card(col, "What powers the cell?", "the mitochondria")
    res = voice_review.grade_answer(
        col, card_id=cid, transcript="the nucleus stores dna", currency="seed"
    )
    assert res["bucket"] in ("dont_know", "ask_again")
    assert res["rating"] == voice_review.RATING_AGAIN
    # still paid the honest +1 for showing up, never the +3 of a correct answer
    assert res["reward"] == 1
    col.close()


def test_ask_again_first_attempt_does_not_commit(monkeypatch):
    col = _fresh_col()
    cid = _add_card(
        col, "Name the powerhouse organelle and what it makes", "mitochondria makes ATP"
    )
    # a partial answer that lands in the 40-69 band
    res = voice_review.grade_answer(
        col, card_id=cid, transcript="mitochondria", currency="water", attempt=1
    )
    if res["bucket"] == "ask_again":
        assert res["applied"] is False
        assert "re_prompt" in res
        assert col.db.scalar("select count(*) from revlog") == 0  # not committed yet
    col.close()


def test_idk_is_dont_know_and_pays_one():
    col = _fresh_col()
    cid = _add_card(col, "q", "some answer")
    res = voice_review.grade_answer(
        col, card_id=cid, transcript="", currency="water", idk=True
    )
    assert res["bucket"] == "dont_know"
    assert res["reward"] == 1
    assert res["rating"] == voice_review.RATING_AGAIN
    col.close()


def test_spoken_prompt_variant_blooms_on_pass():
    """A passed reworded (SpokenPrompt) variant is is_fresh_variant -> blooms (§14)."""
    col = _fresh_col()
    # add a SpokenPrompt field to Basic so the Keeper asks a reworded variant
    m = col.models.by_name("Basic")
    col.models.add_field(m, col.models.new_field(voice_review.SPOKEN_PROMPT_FIELD))
    col.models.save(m)
    note = col.newNote()
    note["Front"] = "What powers the cell?"
    note["Back"] = "the mitochondria"
    note[voice_review.SPOKEN_PROMPT_FIELD] = "Which organelle is the cell's powerhouse?"
    col.add_note(note, DeckId(1))
    cid = note.cards()[0].id

    card = voice_review.next_card(col)
    assert card is not None
    assert card["is_fresh_variant"] is True
    assert "powerhouse" in card["keeper_line"].lower()

    res = voice_review.grade_answer(
        col, card_id=cid, transcript="the mitochondria", currency="water"
    )
    assert res["bucket"] == "good"
    assert res["bloomed"] is True
    col.close()


def test_no_variant_field_falls_back_to_question_no_bloom():
    col = _fresh_col()
    cid = _add_card(col, "What powers the cell?", "the mitochondria")
    card = voice_review.next_card(col)
    assert card is not None
    assert card["is_fresh_variant"] is False
    res = voice_review.grade_answer(
        col, card_id=cid, transcript="the mitochondria", currency="water"
    )
    assert (
        res["bloomed"] is False
    )  # a plain question grows but is not a paraphrase-bloom
    col.close()


def test_reward_table_matches_spec():
    # doc 24 §3 reward table — the contract.
    assert voice_review.REWARD_BY_BUCKET["good"] == 3
    assert voice_review.REWARD_BY_BUCKET["okay"] == 2
    assert voice_review.REWARD_BY_BUCKET["dont_know"] == 1
