# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: readiness/performance must be fed by the PUBLISHED held-out eval artifact or abstain
# (the desktop twin of the phone's HeldOutEval bundle artifact — ScoreKit.swift). Pins the
# 2026-07-05 audit's fake-readiness edge: a gate-open dashboard with NO eval artifact must never
# map the neutral default (acc=0.5 -> "500") — a number derived from no evidence.
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_heldout.py

import os
import tempfile

from anki.collection import Collection
from scores import display, engine, give_up, heldout

# The exact two-line format scripts/eval_performance.py publishes.
ARTIFACT = """== Performance model — held-out exam-style accuracy ==
n_heldout=24  accuracy=0.7083  wrong_rate=0.2917  90% range=[0.5417, 0.8333]  baseline=0.5417
beats_baseline = True
"""


def _col():
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    col = Collection(path)
    engine.enable_fsrs(col)
    return col


def _write_artifact(tmp_path, text=ARTIFACT):
    p = tmp_path / "performance-heldout.txt"
    p.write_text(text, encoding="utf-8")
    return p


def test_loader_parses_the_published_artifact_format(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.ENV_KEY, str(_write_artifact(tmp_path)))
    ev = heldout.load_heldout_eval()
    assert ev is not None
    assert ev["n"] == 24
    assert ev["acc"] == 0.7083
    assert ev["acc_range"] == [0.5417, 0.8333]
    assert ev["baseline"] == 0.5417
    assert ev["wrong_rate"] == 0.2917


def test_loader_returns_none_when_artifact_missing(tmp_path, monkeypatch):
    monkeypatch.setenv(heldout.ENV_KEY, str(tmp_path / "nope.txt"))
    assert heldout.load_heldout_eval() is None


def test_default_path_is_the_repo_published_artifact(monkeypatch):
    # The repo SHIPS a published eval — the default resolution must find and parse it, so the
    # live app (cwd-independent) reads the same artifact the proof bundle cites.
    monkeypatch.delenv(heldout.ENV_KEY, raising=False)
    assert heldout.DEFAULT_ARTIFACT.is_file()
    ev = heldout.load_heldout_eval()
    assert ev is not None and ev["n"] >= give_up.PERFORMANCE_MIN_ITEMS


def test_readiness_display_refuses_the_fabricated_default(monkeypatch):
    # THE audit edge: gate open, no eval -> the old code mapped acc=0.5 into "500". A number
    # derived from no evidence must be an abstention, never a point.
    monkeypatch.setattr(give_up, "readiness_available", lambda *a, **k: True)
    col = _col()
    r = display.readiness_display(col, [], gate_coverage_fraction=1.0, section_perf=None)
    assert r["available"] is False
    assert "no performance evaluation available" in r["reason"]
    assert "point" not in r and "range" not in r
    col.close()


def test_dashboard_readiness_abstains_without_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr(give_up, "readiness_available", lambda *a, **k: True)
    monkeypatch.setenv(heldout.ENV_KEY, str(tmp_path / "missing.txt"))
    col = _col()
    r = display.dashboard(col, "")["readiness"]
    assert r["available"] is False
    assert "no performance evaluation available" in r["reason"]
    assert "point" not in r
    col.close()


def test_dashboard_readiness_maps_the_measured_accuracy_with_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr(give_up, "readiness_available", lambda *a, **k: True)
    monkeypatch.setenv(heldout.ENV_KEY, str(_write_artifact(tmp_path)))
    col = _col()
    r = display.dashboard(col, "")["readiness"]
    assert r["available"] is True
    assert isinstance(r["point"], int) and 472 <= r["point"] <= 528
    assert isinstance(r["range"], list) and r["range"][0] <= r["point"] <= r["range"][1]
    assert r["confidence"] in ("low", "moderate")
    assert "UNVALIDATED" in r["note"]
    assert "held-out" in r["evidence"]
    col.close()


def test_dashboard_performance_surfaces_the_measured_number_with_artifact(tmp_path, monkeypatch):
    # Phone parity (ScoreKit.threeScores): artifact present + n >= floor -> the measured accuracy
    # with its bootstrap range and the majority baseline named; never recomputed, never invented.
    monkeypatch.setenv(heldout.ENV_KEY, str(_write_artifact(tmp_path)))
    col = _col()
    p = display.dashboard(col, "")["performance"]
    assert p["available"] is True
    assert p["point"] == 0.7083
    assert p["range"] == [0.5417, 0.8333]
    assert "baseline" in p["evidence"]
    col.close()


def test_under_floor_eval_abstains_not_maps(tmp_path, monkeypatch):
    # An n=5 eval is a shaky number, not evidence — both scores abstain with the floor named
    # (stricter than the phone, which still maps readiness from an under-floor eval).
    small = ARTIFACT.replace("n_heldout=24", "n_heldout=5")
    monkeypatch.setenv(heldout.ENV_KEY, str(_write_artifact(tmp_path, small)))
    monkeypatch.setattr(give_up, "readiness_available", lambda *a, **k: True)
    col = _col()
    d = display.dashboard(col, "")
    assert d["performance"]["available"] is False
    assert "5 items" in d["performance"]["reason"]
    assert d["readiness"]["available"] is False
    col.close()
