# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up W3.6: readiness 472-528 mapping (point + range + give-up); fill the display seam (§4 / §9 step 3).
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_readiness.py

import os
import tempfile

from anki.collection import Collection

from scores import display, engine, give_up, readiness


def _col():
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    col = Collection(path)
    engine.enable_fsrs(col)
    return col


def test_mapping_on_the_472_528_scale():
    m = readiness.map_to_scale({"acc": 0.5, "acc_range": [0.4, 0.6]}, coverage=1.0)
    assert 472 <= m["point"] <= 528
    assert m["range"][0] <= m["point"] <= m["range"][1]
    # perfect accuracy -> top of scale; zero -> floor
    assert readiness.map_to_scale({"acc": 1.0, "acc_range": [1.0, 1.0]}, coverage=1.0)["point"] == 528
    assert readiness.map_to_scale({"acc": 0.0, "acc_range": [0.0, 0.0]}, coverage=1.0)["point"] == 472


def test_display_available_branch_now_emits_point_and_range(monkeypatch):
    monkeypatch.setattr(give_up, "readiness_available", lambda *a, **k: True)
    col = _col()
    r = display.readiness_display(
        col, [], gate_coverage_fraction=1.0, section_perf={"acc": 0.5, "acc_range": [0.4, 0.6]}
    )
    assert r["available"] is True
    assert isinstance(r["point"], int) and 472 <= r["point"] <= 528
    assert isinstance(r["range"], list) and len(r["range"]) == 2
    col.close()


def test_still_abstains_below_floor():
    col = _col()
    col.decks.id("MCAT::B-B::1A")
    r = display.dashboard(col, "")["readiness"]
    assert r["available"] is False and "point" not in r
    col.close()
