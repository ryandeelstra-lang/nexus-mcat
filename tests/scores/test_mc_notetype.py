# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: J0b — the MCAT multiple-choice notetype (built at deck-authoring time) + the
# runtime chosen-distractor capture (sidecar-only, additive). Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_mc_notetype.py

import os
import tempfile

from anki.collection import Collection

from journey import mc_notetype
from scores.telemetry import sidecar


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _snapshot(col: Collection):
    return {
        "revlog": col.db.all("select * from revlog order by id"),
        "cards": col.db.all("select * from cards order by id"),
        "notes": col.db.all("select * from notes order by id"),
        "config": col.db.all("select key, val from config order by key"),
        "scm": col.db.scalar("select scm from col"),
    }


def test_notetype_created_idempotently():
    col = _fresh_col()
    nid1 = mc_notetype.ensure_mcq_notetype(col)
    nid2 = mc_notetype.ensure_mcq_notetype(col)
    assert nid1 == nid2  # second call reuses, never duplicates
    m = col.models.by_name(mc_notetype.MCQ_NOTETYPE_NAME)
    assert m is not None
    field_names = {f["name"] for f in m["flds"]}
    for required in ("Stem", "OptionA", "OptionB", "OptionC", "OptionD", "Correct"):
        assert required in field_names
    col.close()


def test_add_mcq_note_creates_one_card():
    col = _fresh_col()
    mc_notetype.ensure_mcq_notetype(col)
    deck_id = col.decks.id("MCAT::C-P::4A")
    note = mc_notetype.add_mcq_note(
        col, deck_id,
        stem="Which enzyme catalyzes the rate-limiting step of glycolysis?",
        options={"A": "Hexokinase", "B": "PFK-1", "C": "Pyruvate kinase", "D": "Aldolase"},
        correct="B",
        explanation="PFK-1 is the committed, rate-limiting step.",
        source="OpenStax Biology 2e §7.2",
    )
    assert col.card_count() == 1
    assert note["Stem"].startswith("Which enzyme")
    assert note["Correct"] == "B"
    assert note["OptionB"] == "PFK-1"
    col.close()


def test_capture_records_chosen_distractor_when_wrong():
    col = _fresh_col()
    rid = mc_notetype.record_mc_answer(
        col, node_id="C-P::4A", chosen="C", correct="B", total_ms=9100, error_cause="lure-trapped"
    )
    assert rid is not None
    rows = sidecar.read_item_attempts(col, node_id="C-P::4A")
    assert len(rows) == 1
    assert rows[0]["chosen_distractor_id"] == "C"  # the lure they fell for
    assert rows[0]["correct"] == 0
    assert rows[0]["error_cause"] == "lure-trapped"
    col.close()


def test_capture_has_no_distractor_when_correct():
    col = _fresh_col()
    mc_notetype.record_mc_answer(col, node_id="B-B::1D", chosen="A", correct="A")
    rows = sidecar.read_item_attempts(col, node_id="B-B::1D")
    assert rows[0]["correct"] == 1
    assert rows[0]["chosen_distractor_id"] is None  # a correct answer chose no distractor
    col.close()


def test_runtime_capture_is_collection_read_only():
    col = _fresh_col()
    mc_notetype.ensure_mcq_notetype(col)  # build-time install (a legitimate authoring mutation)
    before = _snapshot(col)
    mc_notetype.record_mc_answer(col, node_id="P-S::6A", chosen="D", correct="A")
    after = _snapshot(col)
    assert before == after  # runtime distractor capture goes ONLY to the sidecar
    col.close()
