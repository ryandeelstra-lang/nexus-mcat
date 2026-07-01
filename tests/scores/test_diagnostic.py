# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: W7b — broad-adaptive diagnostic selection FLOOR (deterministic, breadth-first across
# all 4 sections), built on the existing engine (no Rust change). Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_diagnostic.py

import os
import tempfile

from anki.collection import Collection
from anki.decks import DeckId

from journey import diagnostic
from scores import coverage
from scores.telemetry import sidecar


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _one_leaf_per_section() -> dict[str, str]:
    tax = coverage.load_taxonomy()
    picked: dict[str, str] = {}
    for leaf in tax["leaves"]:
        picked.setdefault(leaf["section"], leaf["path"])
    return picked  # {"C-P": "MCAT::C-P::1A", "CARS": ..., "B-B": ..., "P-S": ...}


def _add_basic(col: Collection, deck_path: str, n: int = 1) -> None:
    deck_id = col.decks.id(deck_path)
    for i in range(n):
        note = col.newNote()
        note["Front"] = f"q{i} {deck_path}"
        note["Back"] = f"a{i}"
        col.add_note(note, DeckId(deck_id))


def _section_of(col: Collection, cid: int) -> str:
    return col.decks.name(col.get_card(cid).did).split("::")[1]


def test_plan_touches_all_four_sections():
    col = _fresh_col()
    leaves = _one_leaf_per_section()
    for path in leaves.values():
        _add_basic(col, path, n=2)
    plan = diagnostic.diagnostic_plan(col, max_items=90)
    assert plan, "plan should not be empty"
    sections = {_section_of(col, cid) for cid in plan}
    assert sections == {"C-P", "CARS", "B-B", "P-S"}  # broad: every section represented
    col.close()


def test_plan_is_deterministic():
    col = _fresh_col()
    for path in _one_leaf_per_section().values():
        _add_basic(col, path, n=3)
    assert diagnostic.diagnostic_plan(col, max_items=20) == diagnostic.diagnostic_plan(col, max_items=20)
    col.close()


def test_plan_respects_max_items():
    col = _fresh_col()
    for path in _one_leaf_per_section().values():
        _add_basic(col, path, n=5)
    assert len(diagnostic.diagnostic_plan(col, max_items=3)) == 3
    col.close()


def test_plan_is_breadth_first_one_per_section_before_depth():
    col = _fresh_col()
    for path in _one_leaf_per_section().values():
        _add_basic(col, path, n=3)
    # the first 4 picks span all 4 sections (interleaved), not 3-deep in one section
    first4 = diagnostic.diagnostic_plan(col, max_items=4)
    assert len({_section_of(col, cid) for cid in first4}) == 4
    col.close()


def test_record_diagnostic_answer_lands_in_sidecar_as_diagnostic_mode():
    col = _fresh_col()
    rid = diagnostic.record_diagnostic_answer(col, node_id="C-P::4A", correct=True, total_ms=5200)
    assert rid is not None
    rows = sidecar.read_item_attempts(col, node_id="C-P::4A")
    assert len(rows) == 1
    assert rows[0]["mode"] == "diagnostic"
    assert rows[0]["correct"] == 1
    col.close()


def test_record_diagnostic_answer_is_collection_read_only():
    col = _fresh_col()
    _add_basic(col, _one_leaf_per_section()["B-B"], n=1)
    before = (col.db.scalar("select count() from revlog"), col.db.scalar("select scm from col"),
              col.db.all("select * from cards order by id"))
    diagnostic.record_diagnostic_answer(col, node_id="B-B::1A", correct=False, chosen_distractor_id="C")
    after = (col.db.scalar("select count() from revlog"), col.db.scalar("select scm from col"),
             col.db.all("select * from cards order by id"))
    assert before == after  # diagnostic capture writes only the sidecar
    col.close()
