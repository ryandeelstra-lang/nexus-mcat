# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: the Knowledge Garden additive-store wall (Decisions 40-42; docs/26 I5).
# Proves garden state (currency, the pending queue, tutorial beats, paraphrase passes,
# weeds) round-trips through the sidecar and leaves the collection byte-identical — the
# same Decision-19 wall the telemetry sidecar obeys. Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_garden_store.py

import os
import tempfile

from anki.collection import Collection
from anki.decks import DeckId

from scores.telemetry import garden


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _answer_one(col: Collection) -> None:
    note = col.newNote()
    note["Front"] = "q"
    note["Back"] = "a"
    col.add_note(note, DeckId(1))
    card = col.sched.getCard()
    if card is None:
        col.reset()
        card = col.sched.getCard()
    assert card is not None
    col.sched.answerCard(card, 3)


def _snapshot(col: Collection):
    return {
        "revlog": col.db.all("select * from revlog order by id"),
        "cards": col.db.all("select * from cards order by id"),
        "notes": col.db.all("select * from notes order by id"),
        "config": col.db.all("select key, val from config order by key"),
        "scm": col.db.scalar("select scm from col"),
    }


def test_garden_write_is_collection_read_only():
    """Every garden write goes to the sidecar; the collection stays byte-identical."""
    col = _fresh_col()
    _answer_one(col)
    before = _snapshot(col)
    garden.set_state(col, "economy", {"seeds": 40, "water": 80, "xp": 0}, now_ms=1)
    garden.set_state(
        col,
        "pending",
        [{"nodeId": "BB.1A", "deckPath": "MCAT::B-B::1A", "kind": "water", "pours": 2}],
        now_ms=2,
    )
    garden.set_state(col, "tutorial", {"beat": 3, "done": False}, now_ms=3)
    after = _snapshot(col)
    assert before == after
    col.close()


def test_object_and_array_docs_round_trip():
    """Object docs (economy) and array docs (the pending queue) both persist + read back."""
    col = _fresh_col()
    garden.set_state(col, "economy", {"seeds": 39, "water": 86, "xp": 5}, now_ms=1)
    garden.set_state(
        col, "pending", [{"nodeId": "CP.4A", "kind": "plant", "pours": 1}], now_ms=2
    )
    state = garden.get_state(col)
    assert state["economy"] == {"seeds": 39, "water": 86, "xp": 5}
    assert state["pending"] == [{"nodeId": "CP.4A", "kind": "plant", "pours": 1}]
    # single-key read returns just that document
    assert garden.get_state(col, "economy") == {
        "economy": {"seeds": 39, "water": 86, "xp": 5}
    }
    col.close()


def test_upsert_overwrites_same_key():
    col = _fresh_col()
    garden.set_state(col, "economy", {"seeds": 40, "water": 80, "xp": 0}, now_ms=1)
    garden.set_state(col, "economy", {"seeds": 45, "water": 60, "xp": 20}, now_ms=2)
    assert garden.get_state(col, "economy")["economy"]["seeds"] == 45
    col.close()


def test_garden_state_lives_only_in_the_sidecar():
    col = _fresh_col()
    garden.set_state(col, "economy", {"seeds": 40}, now_ms=1)
    names = {r[0] for r in col.db.all("select name from sqlite_master where type='table'")}
    assert "garden_state" not in names  # only in the sidecar file, never the collection
    col.close()
