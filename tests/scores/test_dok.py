# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: W9b/T9 — the DOK1->DOK2 unlock predicate = mastery AND a ~4-6 week time floor
# (Decision 35), the time anchor read from immutable revlog history (clock-tamper-resistant).
# Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_dok.py

import os
import tempfile
import time

from anki.collection import Collection
from anki.decks import DeckId

from journey import dok
from scores.telemetry import sidecar


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _answer_one_in(col: Collection, deck_path: str) -> None:
    deck_id = DeckId(col.decks.id(deck_path))  # creating a deck in test SETUP is fine
    note = col.newNote()
    note["Front"] = "q"
    note["Back"] = "a"
    col.add_note(note, deck_id)
    col.decks.set_current(deck_id)  # surface this subdeck's card in the queue
    col.reset()
    card = col.sched.getCard()
    assert card is not None
    col.sched.answerCard(card, 3)  # Good


def test_first_review_anchor_is_the_immutable_revlog_event():
    col = _fresh_col()
    node = "MCAT::B-B::1A"
    _answer_one_in(col, node)
    first = dok.first_review_ms(col, node)
    assert first is not None
    assert first == col.db.scalar("select min(id) from revlog")  # the engine's revlog id, not a settable start
    col.close()


def test_time_floor_gates_on_elapsed_since_first_review():
    col = _fresh_col()
    node = "MCAT::B-B::1A"
    _answer_one_in(col, node)
    t = dok.first_review_ms(col, node) / 1000.0
    assert dok.time_floor_met(col, node, now_s=t + 10) is False           # right after starting
    assert dok.time_floor_met(col, node, now_s=t + 29 * 86400) is True    # 29 days later
    col.close()


def test_time_floor_cannot_be_shortcut_by_claiming_an_earlier_start():
    # There is NO client-settable "start date" — the anchor is min(revlog.id). The only way to clear
    # the floor is genuine elapsed wall-clock past the real first review (clock-tamper resistance).
    col = _fresh_col()
    node = "MCAT::C-P::4A"
    _answer_one_in(col, node)
    t = dok.first_review_ms(col, node) / 1000.0
    # A node with NO reviews has no anchor → never time-floor-met (can't unlock what was never started).
    assert dok.time_floor_met(col, "MCAT::P-S::6A", now_s=t + 999 * 86400) is False
    col.close()


def test_variant_passed_requires_a_correct_fresh_variant():
    col = _fresh_col()
    node = "MCAT::C-P::4A"
    assert dok.variant_passed(col, node) is False
    sidecar.record_item_attempt(col, mode="review", node_id=node, correct=False, is_fresh_variant=True)
    assert dok.variant_passed(col, node) is False   # a wrong variant doesn't count
    sidecar.record_item_attempt(col, mode="review", node_id=node, correct=True, is_fresh_variant=False)
    assert dok.variant_passed(col, node) is False   # correct but not a variant doesn't count
    sidecar.record_item_attempt(col, mode="review", node_id=node, correct=True, is_fresh_variant=True)
    assert dok.variant_passed(col, node) is True
    col.close()


def test_mastery_not_met_without_history():
    col = _fresh_col()
    assert dok.mastery_met(col, "MCAT::P-S::6A") is False  # no FSRS state, no items, no variant pass
    col.close()


def test_unlock_requires_BOTH_mastery_and_time_floor(monkeypatch):
    col = _fresh_col()
    node = "MCAT::B-B::1A"
    monkeypatch.setattr(dok, "mastery_met", lambda c, n: True)
    monkeypatch.setattr(dok, "time_floor_met", lambda c, n, now_s: True)
    assert dok.unlock_dok2(col, node, now_s=0) is True
    monkeypatch.setattr(dok, "time_floor_met", lambda c, n, now_s: False)
    assert dok.unlock_dok2(col, node, now_s=0) is False    # mastery alone is not enough
    monkeypatch.setattr(dok, "time_floor_met", lambda c, n, now_s: True)
    monkeypatch.setattr(dok, "mastery_met", lambda c, n: False)
    assert dok.unlock_dok2(col, node, now_s=0) is False    # time alone is not enough
    col.close()


def test_dok_computation_is_collection_read_only():
    col = _fresh_col()
    node = "MCAT::B-B::1A"
    _answer_one_in(col, node)
    before = (col.db.scalar("select count() from revlog"), col.db.scalar("select scm from col"),
              col.db.all("select * from cards order by id"))
    dok.unlock_dok2(col, node, now_s=time.time())
    dok.variant_passed(col, node)
    dok.mastery_met(col, node)
    dok.first_review_ms(col, node)
    after = (col.db.scalar("select count() from revlog"), col.db.scalar("select scm from col"),
             col.db.all("select * from cards order by id"))
    assert before == after  # the predicate only READS the engine
    col.close()
