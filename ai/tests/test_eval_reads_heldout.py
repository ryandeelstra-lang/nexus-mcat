# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_eval_reads_heldout.py
from ai.eval import metrics, split


def test_metrics_math():
    m = metrics.summarize({"correct-and-useful": 42, "wrong": 3, "correct-but-bad-teaching": 5}, n=50)
    assert m["accuracy"] == 0.84 and m["wrong_answer_rate"] == 0.06 and m["bad_teaching"] == 5 and m["n"] == 50


def test_heldout_is_disjoint_from_tune_and_dev():
    split.assert_disjoint()                       # raises if the partitions overlap
    held = split.load_heldout()
    assert len(held) >= 50
    ids = {g["id"] for g in held}
    tune_dev = set(split.load_ids("tune")) | set(split.load_ids("dev"))
    assert not (ids & tune_dev), "held-out must not overlap tune/dev (no leakage into the reported number)"
