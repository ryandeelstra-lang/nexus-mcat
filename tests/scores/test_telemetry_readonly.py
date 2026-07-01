# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: J0a — the telemetry sidecar (item_attempts + sessions) read-only-equivalence wall
# (plan step J0a; Decisions 34-38 journey foundation; doc 16). Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_telemetry_readonly.py

import os
import tempfile

from anki.collection import Collection
from anki.decks import DeckId

from scores.telemetry import sidecar


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
    assert card is not None, "no card queued to answer"
    col.sched.answerCard(card, 3)  # Good


def _snapshot(col: Collection):
    """Everything the engine owns that the journey wall must never perturb."""
    return {
        "revlog": col.db.all("select * from revlog order by id"),
        "cards": col.db.all("select * from cards order by id"),
        "notes": col.db.all("select * from notes order by id"),
        "config": col.db.all("select key, val from config order by key"),
        "scm": col.db.scalar("select scm from col"),
    }


def test_sidecar_write_is_collection_read_only():
    """Writing telemetry to the sidecar leaves the collection byte-identical (Decision 19 wall)."""
    col = _fresh_col()
    _answer_one(col)
    before = _snapshot(col)
    sidecar.record_item_attempt(
        col, mode="diagnostic", node_id="B-B::1D", correct=True, total_ms=4200
    )
    sidecar.record_item_attempt(
        col, mode="review", node_id="C-P::4A", correct=False, total_ms=8800,
        chosen_distractor_id="C", is_fresh_variant=True, error_cause="lure-trap",
    )
    sidecar.record_session(
        col, mode="timed", breaks_json="[]", fatigue_slope=-0.12,
        final_section_delta=-0.08, accuracy=0.71, completed_items=59, abandoned=False,
    )
    after = _snapshot(col)
    assert before == after  # the collection is untouched; telemetry lives only in the sidecar
    col.close()


def test_sidecar_path_is_a_separate_file_in_the_same_dir():
    col = _fresh_col()
    p = sidecar.sidecar_path(col)
    assert p != col.path
    assert os.path.dirname(p) == os.path.dirname(os.path.abspath(col.path))
    assert p.endswith(".mcat_sidecar.sqlite")  # keyed to the collection file, beside it
    assert p.startswith(os.path.splitext(os.path.abspath(col.path))[0])
    col.close()


def test_collection_db_has_no_journey_tables():
    col = _fresh_col()
    sidecar.record_item_attempt(col, mode="diagnostic", node_id="B-B::1D", correct=True)
    sidecar.record_session(col, mode="timed")
    names = {r[0] for r in col.db.all("select name from sqlite_master where type='table'")}
    assert "item_attempts" not in names
    assert "sessions" not in names  # they exist ONLY in the sidecar, never the collection
    col.close()


def test_round_trip_and_predicate_indices():
    col = _fresh_col()
    sidecar.record_item_attempt(col, mode="review", node_id="P-S::6A", correct=True, is_fresh_variant=True)
    sidecar.record_item_attempt(col, mode="review", node_id="P-S::6A", correct=False, is_fresh_variant=False)
    rows = sidecar.read_item_attempts(col, node_id="P-S::6A")
    assert len(rows) == 2
    assert {r["correct"] for r in rows} == {0, 1}
    # the indices the DOK predicate (W9b) leans on must exist
    conn = sidecar.connect(col)
    assert conn is not None
    idx = {r[0] for r in conn.execute("select name from sqlite_master where type='index'")}
    assert any("node" in n for n in idx)
    conn.close()
    col.close()


def test_analytics_disabled_is_a_noop(monkeypatch):
    monkeypatch.setenv("ANALYTICS_DISABLED", "1")
    col = _fresh_col()
    rid = sidecar.record_item_attempt(col, mode="review", node_id="B-B::1D", correct=True)
    assert rid is None  # disabled → no write
    assert sidecar.read_item_attempts(col) == []
    assert sidecar.connect(col) is None
    col.close()
